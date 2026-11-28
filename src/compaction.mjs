import { checkProviderPrivacyAllowed, DEFAULT_PRIVACY_SETTINGS } from './privacy.mjs';
import { parameterLimits } from './conversation-controls.mjs';

/**
 * SOTA Hybrid Context Compaction Engine for G0DC0D3.
 *
 * Combines:
 * 1. Model-aware dynamic context byte budgets (scales from 28 KiB on 16K local models
 *    up to 384 KiB on 400K–1M frontier models, while keeping 128 KiB default for tests).
 * 2. True history watermark folding (`compactedBeforeSeq`) that keeps a verbatim tail
 *    window while archiving older turns into SQLite (still queryable via `task.history`).
 * 3. Deterministic zero-hallucination ground truth (SHA-256 modifiedFiles, failingChecks,
 *    todoProgress, userClarifications, failedApproaches, keyFindings).
 * 4. Optional privacy-gated, timeout-bounded LLM semantic distillation (decisions,
 *    ruled-out hypotheses, user preferences, and exact next step) that chains across
 *    multiple compactions with graceful zero-failure fallback to deterministic Layer A.
 */

export const DEFAULT_CONTEXT_BYTE_LIMIT = 128 * 1024;
export const AUTO_COMPACT_UTILIZATION_THRESHOLD = 0.75;
export const COMPACTION_KEEP_TAIL_EVENTS = 8;

/**
 * Resolve a safe JSON byte budget for the active provider's real context window.
 * Roughly ~4 bytes/token for mixed code+JSON, reserving generous headroom for
 * system prompt, tool schemas, and output tokens.
 */
export function resolveContextByteLimit(provider, task = null) {
  if (task?.fixtureId) return DEFAULT_CONTEXT_BYTE_LIMIT;
  const ctxWin = Number(
    provider?.modelMetadata?.contextWindow
    || provider?.contextWindow
    || 0
  );
  if (!Number.isFinite(ctxWin) || ctxWin <= 0) return DEFAULT_CONTEXT_BYTE_LIMIT;
  if (ctxWin <= 16384) return 28 * 1024;
  if (ctxWin <= 32768) return 48 * 1024;
  if (ctxWin <= 65536) return 96 * 1024;
  if (ctxWin <= 131072) return 160 * 1024;
  if (ctxWin <= 270000) return 256 * 1024;
  if (ctxWin <= 520000) return 384 * 1024;
  return 768 * 1024;
}

/**
 * Compute the watermark sequence number to fold behind, keeping the newest
 * `keepTail` observable events verbatim in hot context.
 */
export function computeCompactionWatermark(events = [], keepTail = COMPACTION_KEEP_TAIL_EVENTS) {
  const observable = (Array.isArray(events) ? events : [])
    .filter(e => e && Number.isInteger(e.seq) && !['user.message.queued', 'user.message.removed', 'task.compacted'].includes(e.type))
    .sort((a, b) => a.seq - b.seq);
  if (observable.length <= keepTail) return { compactedBeforeSeq: 0, foldedCount: 0, foldedEvents: [] };
  const cutoffIdx = observable.length - keepTail;
  const foldedEvents = observable.slice(0, cutoffIdx);
  const compactedBeforeSeq = foldedEvents[foldedEvents.length - 1]?.seq || 0;
  return { compactedBeforeSeq, foldedCount: foldedEvents.length, foldedEvents };
}

/**
 * Deterministic Layer-A semantic extraction (zero latency, $0, offline-safe).
 * Extracts user clarifications, failed approaches/errors, and key assistant conclusions
 * from events being folded behind the compaction watermark.
 */
export function extractDeterministicHighlights(task, foldedEvents = [], previousSummary = null) {
  const prevClarifications = Array.isArray(previousSummary?.userClarifications) ? previousSummary.userClarifications : [];
  const prevFailed = Array.isArray(previousSummary?.failedApproaches) ? previousSummary.failedApproaches : [];
  const prevFindings = Array.isArray(previousSummary?.keyFindings) ? previousSummary.keyFindings : [];

  const clarifications = [...prevClarifications];
  const seenClar = new Set(clarifications.map(s => s.toLowerCase()));
  const pushClar = raw => {
    const clean = String(raw || '').replace(/\s+/g, ' ').trim().slice(0, 260);
    if (!clean || clean.length < 4) return;
    const k = clean.toLowerCase();
    if (seenClar.has(k)) return;
    seenClar.add(k);
    clarifications.push(clean);
  };

  for (const f of (task?.followups || [])) {
    pushClar(typeof f === 'string' ? f : f?.message);
  }
  for (const ev of foldedEvents) {
    if (ev.type === 'user.message' || ev.type === 'user.followup') {
      pushClar(ev.data?.message || ev.data?.text);
    }
  }

  const failedApproaches = [...prevFailed];
  const seenFail = new Set(failedApproaches.map(s => s.toLowerCase()));
  const pushFail = raw => {
    const clean = String(raw || '').replace(/\s+/g, ' ').trim().slice(0, 220);
    if (!clean) return;
    const k = clean.toLowerCase();
    if (seenFail.has(k)) return;
    seenFail.add(k);
    failedApproaches.push(clean);
  };

  const keyFindings = [...prevFindings];
  const seenFind = new Set(keyFindings.map(s => s.toLowerCase()));
  const pushFind = raw => {
    const clean = String(raw || '').replace(/\s+/g, ' ').trim().slice(0, 280);
    if (!clean || clean.length < 24) return;
    const k = clean.toLowerCase();
    if (seenFind.has(k)) return;
    seenFind.add(k);
    keyFindings.push(clean);
  };

  for (const ev of foldedEvents) {
    if (ev.type === 'tool.completed') {
      const ok = ev.data?.result?.ok !== false && ev.data?.status !== 'failed';
      if (!ok) {
        const name = ev.data?.name || 'tool';
        const code = ev.data?.result?.error?.code || ev.data?.error?.code || 'ERROR';
        const msg = ev.data?.result?.error?.message || ev.data?.error?.message || '';
        pushFail(`${name} failed (${code})${msg ? ': ' + msg.slice(0, 120) : ''}`);
      }
    } else if (ev.type === 'recovery.started' || ev.type === 'recovery.attempt') {
      const reason = ev.data?.reason || ev.data?.diagnosis || ev.data?.incident?.code || '';
      const strat = ev.data?.strategy ? ` [${ev.data.strategy}]` : '';
      if (reason) pushFail(`Recovery${strat}: ${reason}`);
    } else if (ev.type === 'model.response' && ev.data?.response?.type === 'message' && ev.data?.response?.text) {
      const text = String(ev.data.response.text).trim();
      if (text && !/^```/.test(text)) {
        const firstLine = text.split(/\n{2,}/)[0].replace(/\s+/g, ' ').trim();
        pushFind(firstLine);
      }
    }
  }

  return {
    userClarifications: clarifications.slice(-8),
    failedApproaches: failedApproaches.slice(-8),
    keyFindings: keyFindings.slice(-6),
  };
}

function parseJsonObject(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function sanitizeStringList(value, maxItems = 6, maxChars = 220) {
  if (!Array.isArray(value)) return [];
  const out = [];
  const seen = new Set();
  for (const item of value) {
    const clean = String(item || '').replace(/\s+/g, ' ').trim().slice(0, maxChars);
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
    if (out.length >= maxItems) break;
  }
  return out;
}

function formatTranscriptForDistillation(foldedEvents = [], maxChars = 14000) {
  const lines = [];
  let total = 0;
  for (const ev of foldedEvents) {
    let line = '';
    if (ev.type === 'user.message' || ev.type === 'user.followup') {
      line = `USER: ${String(ev.data?.message || ev.data?.text || '').replace(/\s+/g, ' ').slice(0, 600)}`;
    } else if (ev.type === 'model.response') {
      const r = ev.data?.response;
      if (r?.type === 'message' && r.text) {
        line = `ASSISTANT: ${String(r.text).replace(/\s+/g, ' ').slice(0, 700)}`;
      } else if ((r?.type === 'tool' || r?.type === 'tool_calls') && Array.isArray(r.calls)) {
        line = `ASSISTANT_TOOLS: ${r.calls.map(c => c.name).join(', ')}`;
      }
    } else if (ev.type === 'tool.completed') {
      const name = ev.data?.name || 'tool';
      const ok = ev.data?.result?.ok !== false && ev.data?.status !== 'failed';
      const pathHint = ev.data?.result?.path || ev.data?.args?.path || ev.data?.result?.url || '';
      const errHint = !ok ? ` ERR=${ev.data?.result?.error?.code || ev.data?.error?.code || 'FAIL'}: ${String(ev.data?.result?.error?.message || ev.data?.error?.message || '').slice(0, 140)}` : '';
      line = `TOOL ${name} (${ok ? 'ok' : 'fail'})${pathHint ? ' ' + String(pathHint).slice(0, 120) : ''}${errHint}`;
    } else if (ev.type === 'evaluation.completed') {
      line = `CHECK: status=${ev.data?.status || 'unknown'}`;
    }
    if (!line) continue;
    if (total + line.length + 1 > maxChars) break;
    lines.push(line);
    total += line.length + 1;
  }
  return lines.join('\n');
}

const COMPACTION_SYSTEM_PROMPT = [
  'You are the Context Compactor. Distill folded conversation history into a concise, high-signal handoff memory JSON so the next model turn can continue seamlessly without losing decisions, root causes, or user preferences.',
  'Rules:',
  '- Do NOT invent file edits or passing tests; rely strictly on the provided transcript and structural summary.',
  '- Merge prior semantic memory with new folded events so critical earlier decisions are retained.',
  '- Return ONLY raw valid JSON matching this exact schema (no markdown fences, no commentary):',
  '{"goalAndState":"1-2 concise sentences","decisions":["concrete decision"],"ruledOut":["hypothesis or approach already tried and ruled out"],"constraintsAndPrefs":["user preference or constraint stated mid-chat"],"nextStep":"single concrete next step to resume"}'
].join('\n');

/**
 * Optional Layer-B LLM semantic distillation.
 * Privacy-gated, timeout-bounded (18s), never throws, returns null on skip/failure.
 */
export async function distillSemanticSummary({
  provider,
  task,
  structuralSummary,
  foldedEvents = [],
  previousSemantic = null,
  privacy = DEFAULT_PRIVACY_SETTINGS,
  onOutbound,
  extraSecrets,
  signal,
  timeoutMs = 18000,
}) {
  if (!provider || provider.available === false || provider.closed) return null;
  if (provider.kind === 'scripted') return null;
  if (signal?.aborted) return null;
  const gate = checkProviderPrivacyAllowed(provider, privacy);
  if (!gate.allowed) return null;

  const transcript = formatTranscriptForDistillation(foldedEvents, 14000);
  if (!transcript && !previousSemantic) return null;

  const userPayload = JSON.stringify({
    objective: String(task?.objective || '').slice(0, 1200),
    previousMemory: previousSemantic || null,
    modifiedFiles: (structuralSummary?.modifiedFiles || []).slice(0, 20),
    remainingTodos: (structuralSummary?.todoProgress?.remaining || []).slice(0, 8),
    failingChecks: (structuralSummary?.latestFailingChecks || []).slice(0, 5),
    foldedTranscript: transcript,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener?.('abort', onAbort, { once: true });

  try {
    let rawText = '';
    const limits = parameterLimits(provider)?.fields || {};
    const maxCap = Number.isInteger(limits.max_tokens?.max) && limits.max_tokens.max > 0 ? limits.max_tokens.max : 900;
    const clampedTokens = Math.min(900, maxCap, Number.isInteger(provider.maxOutputTokensCeiling) && provider.maxOutputTokensCeiling > 0 ? provider.maxOutputTokensCeiling : 900);
    const tempField = limits.temperature;
    const baseModel = String(provider.model || provider.id || '').toLowerCase().split('/').pop();
    const samplingLocked = /^(?:o1|o3|o4|gpt-[56])(?:$|[.-])/.test(baseModel);
    const tempOpt = (samplingLocked || tempField?.supported === false)
      ? {}
      : { temperature: Math.min(Number.isFinite(tempField?.max) ? tempField.max : 2, Math.max(Number.isFinite(tempField?.min) ? tempField.min : 0, 0.1)) };
    const outboundOpts = { privacy, onOutbound, ...(extraSecrets ? { extraSecrets } : {}) };
    if (typeof provider.draft === 'function') {
      const res = await provider.draft(
        [{ role: 'system', content: COMPACTION_SYSTEM_PROMPT }, { role: 'user', content: userPayload }],
        controller.signal,
        clampedTokens,
        tempOpt,
        outboundOpts
      );
      if (res?.type === 'error') return null;
      rawText = String(res?.text || '');
    } else if (typeof provider.plainChat === 'function' && provider.protocol === 'openai-chat') {
      const res = await provider.plainChat(
        provider,
        [{ role: 'system', content: COMPACTION_SYSTEM_PROMPT }, { role: 'user', content: userPayload }],
        controller.signal,
        { max_tokens: clampedTokens, ...tempOpt },
        outboundOpts
      );
      if (res?.type === 'error') return null;
      rawText = String(res?.text || '');
    } else if (typeof provider.turn === 'function') {
      const res = await provider.turn({
        task: {
          id: 'context-compactor',
          title: 'Context Compaction',
          workspace: task?.workspace,
          objective: `${COMPACTION_SYSTEM_PROMPT}\n\n${userPayload}`,
          constraints: ['Return ONLY valid JSON. Do not call tools.'],
          status: 'running',
          calls: 0,
          recoveries: 0,
          persona: 'focused',
        },
        files: [],
        history: [],
        events: [],
        tools: [],
      }, { signal: controller.signal, ...outboundOpts, turnTimeoutMs: timeoutMs });
      if (res?.type === 'error') return null;
      rawText = String(res?.text || '');
    } else {
      return null;
    }

    const json = parseJsonObject(rawText);
    if (!json) return null;
    const goalAndState = String(json.goalAndState || '').replace(/\s+/g, ' ').trim().slice(0, 420);
    const nextStep = String(json.nextStep || '').replace(/\s+/g, ' ').trim().slice(0, 260);
    const decisions = sanitizeStringList(json.decisions, 6, 220);
    const ruledOut = sanitizeStringList(json.ruledOut, 6, 220);
    const constraintsAndPrefs = sanitizeStringList(json.constraintsAndPrefs, 6, 220);
    if (!goalAndState && !decisions.length && !ruledOut.length && !nextStep) return null;

    return {
      distilledBy: provider.id,
      distilledAt: new Date().toISOString(),
      ...(goalAndState ? { goalAndState } : {}),
      ...(decisions.length ? { decisions } : {}),
      ...(ruledOut.length ? { ruledOut } : {}),
      ...(constraintsAndPrefs.length ? { constraintsAndPrefs } : {}),
      ...(nextStep ? { nextStep } : {}),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.('abort', onAbort);
  }
}
