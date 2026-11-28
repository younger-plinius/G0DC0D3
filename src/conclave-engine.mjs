import { randomUUID } from 'node:crypto';
import { discoverSubagents, runSpecialistSubagent } from './subagents.mjs';
import { checkProviderPrivacyAllowed, DEFAULT_PRIVACY_SETTINGS } from './privacy.mjs';
import { detectRefusal } from './routing.mjs';

export const CONCLAVE_MODES = Object.freeze(['parallel', 'critique', 'debate']);

const MODE_LABELS = Object.freeze({
  parallel: 'Parallel Squad',
  critique: 'Draft & Critique',
  debate: 'Council Debate',
});

export function normalizeConclaveRunInput(input = {}) {
  const mission = String(input.mission || '').trim().slice(0, 12000);
  if (!mission) {
    throw Object.assign(new Error('Provide a mission description to launch a Conclave.'), { code: 'INVALID_CONCLAVE', status: 400 });
  }
  const rawMode = String(input.mode || 'parallel').trim().toLowerCase();
  const mode = CONCLAVE_MODES.includes(rawMode) ? rawMode : 'parallel';
  const rawAgents = Array.isArray(input.agents) ? input.agents : [];
  const agents = [...new Set(rawAgents.map(s => String(s || '').trim().toLowerCase()).filter(Boolean))].slice(0, 4);
  const formationName = typeof input.formationName === 'string' && input.formationName.trim()
    ? input.formationName.trim().slice(0, 64)
    : null;
  return {
    mission,
    mode,
    agents: agents.length ? agents : ['explore', 'analyst', 'strategist'],
    formationName,
  };
}

function selectSynthesisProviders(runtime, task, privacy) {
  const ordered = [];
  const seen = new Set();
  const pushIfAllowed = (pid) => {
    if (!pid || seen.has(pid)) return;
    const p = runtime.providers.get(pid) || runtime.catalog?.get?.(pid);
    if (!p || p.available === false || p.closed) return;
    if (!checkProviderPrivacyAllowed(p, privacy).allowed) return;
    seen.add(pid);
    ordered.push(p);
  };
  pushIfAllowed(task.providerId);
  for (const pid of (task.providers || [])) pushIfAllowed(pid);
  for (const p of runtime.providers.values()) {
    if (p.kind !== 'scripted') pushIfAllowed(p.id);
  }
  for (const p of runtime.providers.values()) pushIfAllowed(p.id);
  return ordered;
}

function buildFallbackDigest(mission, mode, blackboard) {
  const modeLabel = MODE_LABELS[mode] || 'Conclave';
  const sections = [];
  const byRound = new Map();
  for (const entry of blackboard) {
    const key = `${entry.round} · ${entry.roundLabel}`;
    if (!byRound.has(key)) byRound.set(key, []);
    byRound.get(key).push(entry);
  }
  for (const [roundKey, entries] of byRound.entries()) {
    sections.push(`### Round ${roundKey}`);
    for (const e of entries) {
      sections.push(`#### ${e.agentName} (\`${e.role}\` · ${e.modelLabel || 'Auto'})\n${e.content || '_No output recorded._'}`);
    }
  }
  return `## ✦ ${modeLabel} Findings\n\n**Mission:** ${mission}\n\n${sections.join('\n\n')}`;
}

async function synthesizeVerdict({ runtime, task, mission, mode, formationName, blackboard, signal, onDelta }) {
  const privacy = runtime.getPrivacy?.()?.settings || DEFAULT_PRIVACY_SETTINGS;
  const candidates = selectSynthesisProviders(runtime, task, privacy);
  if (!candidates.length) {
    return { text: buildFallbackDigest(mission, mode, blackboard), providerId: task.providerId || null, modelLabel: null };
  }

  const modeLabel = MODE_LABELS[mode] || 'Parallel Squad';
  const transcript = blackboard.map(e => (
    `[Round ${e.round} · ${e.roundLabel} | ${e.agentName} (${e.role}) · ${e.kind.toUpperCase()}]\n${String(e.content || '').slice(0, 6000)}`
  )).join('\n\n---\n\n');

  const synthDirective = mode === 'debate'
    ? 'Synthesize a decisive Council Verdict. Explicitly compare the strongest arguments from Round 1 and the sharpest peer rebuttals from Round 2, identify points of consensus vs. unresolved tradeoffs, and deliver a clear, evidence-backed final recommendation with concrete next steps.'
    : mode === 'critique'
      ? 'Produce the final resolved deliverable by integrating every valid Round 2 peer critique into the Round 1 draft. Lead directly with the complete, polished final output, followed by a concise "Critiques Addressed" summary.'
      : 'Synthesize all specialist deliverables from the Parallel Squad into one unified, complete, deeply actionable final deliverable. Eliminate redundancy, resolve any contradictions, and preserve every concrete detail, file path, number, or step.';

  const systemPrompt = [
    `You are the Lead Synthesizer for a G0DM0D3 Conclave (${modeLabel}${formationName ? ` · "${formationName}"` : ''}).`,
    synthDirective,
    'Write clearly in structured Markdown. Do not mention internal prompt plumbing or JSON schemas. Deliver the complete, ready-to-use result directly.'
  ].join('\n\n');

  const userPrompt = `Mission:\n${mission}\n\nShared Conclave Blackboard (${blackboard.length} specialist contributions):\n\n${transcript}`;

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  const outbound = typeof runtime.outboundOptions === 'function' ? runtime.outboundOptions() : { privacy };
  for (const provider of candidates.slice(0, 3)) {
    if (signal?.aborted) throw Object.assign(new Error('Conclave cancelled.'), { code: 'cancelled' });
    try {
      let res;
      if (typeof provider.draft === 'function') {
        res = await provider.draft(messages, signal, 6144, {}, { ...outbound, onDelta });
      } else {
        res = await provider.turn({
          task: { ...task, objective: userPrompt, planMode: false },
          files: [],
          history: [],
          tools: [],
        }, { signal, ...outbound, onDelta });
      }
      if (signal?.aborted) throw Object.assign(new Error('Conclave cancelled.'), { code: 'cancelled' });
      const refused = res?.finish === 'refusal' || Boolean(detectRefusal(res));
      if (!refused && res && res.type === 'message' && typeof res.text === 'string' && res.text.trim()) {
        return { text: res.text.trim(), providerId: provider.id, modelLabel: provider.label || provider.model || provider.id, usage: res.usage || null };
      }
    } catch (err) {
      if (signal?.aborted || err?.code === 'cancelled') throw err;
    }
  }

  if (signal?.aborted) throw Object.assign(new Error('Conclave cancelled.'), { code: 'cancelled' });
  return { text: buildFallbackDigest(mission, mode, blackboard), providerId: candidates[0]?.id || task.providerId || null, modelLabel: candidates[0]?.label || null };
}

function buildRound1Prompt(mission, mode, spec, index, total) {
  const name = spec.displayName || spec.name;
  if (mode === 'critique') {
    if (index === 0) {
      return [
        `You are the LEAD DRAFTER (${name}) in Round 1 of a Draft & Critique Conclave.`,
        `Produce the complete, high-craft first draft / primary solution for the mission below. Be thorough, concrete, and structured — your peers will stress-test and critique this draft in Round 2.`,
        `Mission:\n${mission}`,
      ].join('\n\n');
    }
    return [
      `You are an INDEPENDENT ANALYST & CRITIC (${name}) in Round 1 of a Draft & Critique Conclave.`,
      `Before seeing the lead draft, independently map the critical requirements, edge cases, failure modes, and acceptance criteria from your specialty (${spec.description || spec.name}) so your Round 2 critique is anchored in first principles.`,
      `Mission:\n${mission}`,
    ].join('\n\n');
  }
  if (mode === 'debate') {
    const lenses = [
      'Advocate the highest-leverage / boldest strategy, detailing concrete upside and execution path.',
      'Act as the rigorous skeptic & red-team devil’s advocate: expose hidden risks, failure modes, and stronger alternatives.',
      'Champion the most pragmatic, low-risk, high-reliability path with concrete milestones and fallback options.',
      'Evaluate long-term second-order effects, edge cases, and non-obvious constraints others overlook.',
    ];
    return [
      `You are Council Member #${index + 1} of ${total} (${name}) in Round 1 of a Council Debate Conclave.`,
      `Lens: ${lenses[index % lenses.length]}`,
      `Write a sharp, evidence-backed opening position paper from your discipline. Your peers will cross-examine your position in Round 2.`,
      `Mission:\n${mission}`,
    ].join('\n\n');
  }
  return [
    `You are Specialist #${index + 1} of ${total} (${name}) in a Parallel Squad Conclave.`,
    `Own your discipline's slice of the mission (${spec.description || spec.name}) and deliver concrete, ready-to-integrate work — cite exact file paths/line numbers if inspecting a workspace, or concrete numbers/plans/drafts for analytical & writing missions.`,
    `Mission:\n${mission}`,
  ].join('\n\n');
}

function buildRound2Prompt(mission, mode, spec, round1Entries) {
  const name = spec.displayName || spec.name;
  const board = round1Entries.map(e => (
    `### ${e.agentName} (\`${e.role}\`)\n${String(e.content || '').slice(0, 4500)}`
  )).join('\n\n---\n\n');

  if (mode === 'critique') {
    return [
      `You are the PEER CRITIC (${name}) in Round 2 of a Draft & Critique Conclave.`,
      `Read the Round 1 Lead Draft and analysis on the Shared Blackboard below. Deliver a ruthless, constructive critique organized into:\n1. **Critical Gaps / Bugs / Wrong Assumptions**\n2. **Concrete Fixes & Stronger Alternatives**\n3. **What Already Works Well (Keep)**`,
      `Mission:\n${mission}`,
      `Shared Blackboard (Round 1):\n${board}`,
    ].join('\n\n');
  }
  return [
    `You are Council Member (${name}) in Round 2 (Peer Cross-Examination) of a Council Debate Conclave.`,
    `Read EVERY peer's Round 1 position on the Shared Blackboard below. Write a crisp cross-examination:\n1. **Where Peers Are Wrong / Missing Evidence** (name the specialist and rebut directly)\n2. **Where You Concede or Update Your Position**\n3. **Your Refined Final Recommendation & Decisive Tradeoff**`,
    `Mission:\n${mission}`,
    `Shared Blackboard (Round 1 Positions):\n${board}`,
  ].join('\n\n');
}

export async function runConclaveSession({
  runtime,
  taskId,
  mission,
  agents = ['explore', 'analyst', 'strategist'],
  mode = 'parallel',
  formationName = null,
  recordUserMessage = true,
  signal,
}) {
  const startedMs = Date.now();
  const conclaveRunId = `conclave_${randomUUID().slice(0, 10)}`;
  const task = runtime.getTask(taskId);
  const discovered = await discoverSubagents(task, runtime);
  const roster = await runtime.getConclaveRoster().catch(() => ({ agents: [] }));
  const rosterBySlug = new Map((roster.agents || []).map(a => [a.slug.toLowerCase(), a]));

  const specs = agents.map(slug => {
    const key = String(slug || '').toLowerCase();
    const sub = discovered.get(key);
    const rost = rosterBySlug.get(key);
    return {
      slug: key,
      name: key,
      displayName: rost?.name || sub?.displayName || key,
      sigil: rost?.sigil || '✦',
      description: sub?.description || rost?.description || `Specialist (${key})`,
      modelHint: rost?.resolvedProviderId || rost?.providerId || sub?.model || null,
    };
  });

  const totalRounds = mode === 'parallel' ? 2 : 3;
  const modeLabel = MODE_LABELS[mode] || 'Parallel Squad';
  const blackboard = [];

  // Record user's mission & mark task running
  if (recordUserMessage) {
    const followupId = randomUUID();
    const nowIso = new Date().toISOString();
    runtime.store.updateTask(taskId, current => {
      current.status = 'running';
      current.epoch += 1;
      current.blocker = null;
      current.completionKind = null;
      delete current.completedAt;
      current.contractVersion = (current.contractVersion || 1) + 1;
      current.followups = [...(current.followups || []), {
        id: followupId,
        message: `✦ Conclave (${modeLabel}): ${mission}`,
        createdAt: nowIso,
        appliedAt: nowIso,
        contractVersion: current.contractVersion,
      }];
      return current;
    }, 'user.message', { id: followupId, message: `✦ Conclave (${modeLabel}): ${mission}`, conclaveRunId, source: 'owner' });
  } else {
    runtime.store.updateTask(taskId, current => {
      current.status = 'running';
      current.epoch += 1;
      current.blocker = null;
      current.completionKind = null;
      delete current.completedAt;
      return current;
    }, 'task.status', { status: 'running', conclaveRunId });
  }

  const liveMeta = {
    runId: conclaveRunId,
    mode,
    modeLabel,
    formationName,
    mission: mission.slice(0, 600),
    round: 1,
    totalRounds,
    phase: 'Starting Conclave…',
    specialists: specs.map(s => ({ slug: s.slug, name: s.displayName, sigil: s.sigil })),
    blackboard,
    startedAt: new Date(startedMs).toISOString(),
  };
  runtime._conclaveRuns.set(taskId, liveMeta);
  runtime.store.appendEvent(taskId, 'conclave.started', {
    conclaveRunId, mode, modeLabel, formationName, mission: mission.slice(0, 600),
    totalRounds, specialists: liveMeta.specialists,
  });
  runtime._emitStream(taskId, { type: 'conclave.update', conclaveRunId, round: 1, totalRounds, phase: liveMeta.phase, mode });

  let activeMap = runtime.activeSubagents.get(taskId);
  if (!activeMap) {
    activeMap = new Map();
    runtime.activeSubagents.set(taskId, activeMap);
  }

  const runRound = async (round, roundLabel, jobs) => {
    if (signal?.aborted) throw Object.assign(new Error('Conclave cancelled.'), { code: 'cancelled' });
    liveMeta.round = round;
    liveMeta.phase = `Round ${round}/${totalRounds} · ${roundLabel}`;
    runtime._emitStream(taskId, { type: 'conclave.update', conclaveRunId, round, totalRounds, phase: liveMeta.phase, mode });

    const roundEntries = await Promise.all(jobs.map(async (job, idx) => {
      const workerId = `c2-r${round}-${job.spec.slug}-${idx + 1}`;
      const wStart = new Date().toISOString();
      const initialState = {
        workerId,
        callId: workerId,
        kind: 'subagent',
        role: job.spec.slug,
        round,
        roundLabel,
        prompt: job.prompt.slice(0, 400),
        status: 'thinking',
        providerId: null,
        modelLabel: null,
        tool: '',
        target: '',
        files: [],
        tools: [],
        streamTail: '',
        calls: 0,
        startedAt: wStart,
        durationMs: 0,
      };
      activeMap.set(workerId, initialState);
      runtime.store.appendEvent(taskId, 'subagent.started', {
        workerId, callId: workerId, role: job.spec.slug, round, roundLabel,
        prompt: job.prompt.slice(0, 400), startedAt: wStart, conclaveRunId,
      });
      runtime._emitStream(taskId, { type: 'subagent.started', worker: initialState });

      let done = false;
      try {
        const res = await runSpecialistSubagent({
          runtime,
          parentTask: runtime.getTask(taskId),
          role: job.spec.slug,
          prompt: job.prompt,
          modelHint: job.spec.modelHint,
          workerId,
          signal,
          onProgress: (prog) => {
            if (done) return;
            const merged = { ...initialState, ...prog, kind: 'subagent', callId: workerId, round, roundLabel };
            activeMap.set(workerId, merged);
            runtime._emitStream(taskId, { type: 'subagent.progress', worker: merged });
          },
        });
        const content = String(res?.summary || res?.error?.message || '').trim();
        const entry = {
          id: `${workerId}-bb`,
          round,
          roundLabel,
          workerId,
          role: job.spec.slug,
          agentName: job.spec.displayName,
          sigil: job.spec.sigil,
          providerId: res?.providerId || null,
          modelLabel: res?.modelLabel || res?.providerId || 'Auto',
          kind: job.kind,
          ok: Boolean(res?.ok),
          content: content.slice(0, 8000),
          durationMs: res?.durationMs || 0,
          createdAt: new Date().toISOString(),
        };
        if (signal?.aborted || res?.code === 'SUBAGENT_CANCELLED' || res?.code === 'HARNESS_CANCELLED') {
          throw Object.assign(new Error('Conclave cancelled.'), { code: 'cancelled' });
        }
        blackboard.push(entry);
        runtime.store.appendEvent(taskId, 'subagent.completed', {
          workerId, callId: workerId, round, roundLabel, conclaveRunId, ...res,
        });
        runtime.recordConclaveAgentRun(job.spec.slug, { ok: Boolean(res?.ok), durationMs: res?.durationMs || 0 });
        runtime._emitStream(taskId, {
          type: 'subagent.completed',
          worker: { ...initialState, ...res, round, roundLabel, status: res?.ok ? 'completed' : 'failed' },
        });
        return entry;
      } finally {
        done = true;
        activeMap.delete(workerId);
        runtime._workerSteers.delete(`${taskId}:${workerId}`);
      }
    }));

    runtime.store.appendEvent(taskId, 'conclave.round', {
      conclaveRunId,
      mode,
      round,
      totalRounds,
      roundLabel,
      entries: roundEntries.map(e => ({
        id: e.id,
        round: e.round,
        roundLabel: e.roundLabel,
        workerId: e.workerId,
        role: e.role,
        agentName: e.agentName,
        sigil: e.sigil,
        modelLabel: e.modelLabel,
        kind: e.kind,
        ok: e.ok,
        excerpt: e.content.slice(0, 1200),
        durationMs: e.durationMs,
      })),
    });
    runtime._emitStream(taskId, { type: 'conclave.update', conclaveRunId, round, totalRounds, phase: liveMeta.phase, mode });
    return roundEntries;
  };

  try {
    // Round 1: Parallel independent work / drafting / opening positions
    const r1Label = mode === 'debate'
      ? 'Independent Positions'
      : mode === 'critique'
        ? 'Lead Draft & Independent Analysis'
        : 'Parallel Specialist Execution';
    const r1Entries = await runRound(1, r1Label, specs.map((spec, idx) => ({
      spec,
      kind: mode === 'critique' ? (idx === 0 ? 'draft' : 'analysis') : mode === 'debate' ? 'position' : 'finding',
      prompt: buildRound1Prompt(mission, mode, spec, idx, specs.length),
    })));

    // Round 2: Real Peer Critique or Peer Cross-Examination (reads actual Round 1 Blackboard!)
    if (mode === 'critique') {
      const critics = specs.length > 1 ? specs.slice(1) : specs;
      await runRound(2, 'Peer Critique Pass', critics.map(spec => ({
        spec,
        kind: 'critique',
        prompt: buildRound2Prompt(mission, 'critique', spec, r1Entries),
      })));
    } else if (mode === 'debate') {
      await runRound(2, 'Peer Cross-Examination', specs.map(spec => ({
        spec,
        kind: 'rebuttal',
        prompt: buildRound2Prompt(mission, 'debate', spec, r1Entries),
      })));
    }

    // Final Round: Synthesized Verdict / Resolved Deliverable
    const synthRound = totalRounds;
    liveMeta.round = synthRound;
    liveMeta.phase = `Round ${synthRound}/${totalRounds} · Synthesizing Verdict`;
    runtime._emitStream(taskId, { type: 'conclave.update', conclaveRunId, round: synthRound, totalRounds, phase: liveMeta.phase, mode });
    runtime._emitStream(taskId, { type: 'turn_start' });

    const synth = await synthesizeVerdict({
      runtime,
      task: runtime.getTask(taskId),
      mission,
      mode,
      formationName,
      blackboard,
      signal,
      onDelta: (delta) => {
        if (delta && typeof delta === 'object') runtime._emitStream(taskId, delta);
      },
    });

    const totalDurationMs = Date.now() - startedMs;
    const summaryData = {
      conclaveRunId,
      mode,
      modeLabel,
      formationName,
      rounds: totalRounds,
      durationMs: totalDurationMs,
      specialists: liveMeta.specialists,
      entries: blackboard.map(e => ({
        id: e.id,
        round: e.round,
        roundLabel: e.roundLabel,
        role: e.role,
        agentName: e.agentName,
        sigil: e.sigil,
        modelLabel: e.modelLabel,
        kind: e.kind,
        ok: e.ok,
        excerpt: e.content.slice(0, 1200),
        durationMs: e.durationMs,
      })),
    };

    if (signal?.aborted) throw Object.assign(new Error('Conclave cancelled.'), { code: 'cancelled' });
    runtime.store.appendEvent(taskId, 'conclave.completed', summaryData);
    runtime.store.appendEvent(taskId, 'model.response', {
      providerId: synth.providerId || task.providerId || null,
      response: {
        type: 'message',
        text: synth.text,
        finish: 'done',
        ...(synth.usage ? { usage: synth.usage } : {}),
      },
      conclave: {
        runId: conclaveRunId,
        mode,
        modeLabel,
        rounds: totalRounds,
        specialistCount: specs.length,
      },
    });

    const finished = runtime.store.updateTask(taskId, current => {
      current.status = 'completed';
      current.completionKind = 'answered';
      current.completedAt = new Date().toISOString();
      current.calls = (current.calls || 0) + 1;
      current.blocker = null;
      return current;
    }, 'task.status', { status: 'completed', conclaveRunId });

    runtime._emitStream(taskId, { type: 'conclave.update', conclaveRunId, round: totalRounds, totalRounds, phase: 'Completed', mode });
    try { runtime.autoLearnFromTask?.(taskId); } catch {}
    return { task: finished, conclaveRunId, blackboard, text: synth.text };
  } catch (err) {
    const aborted = signal?.aborted || err?.code === 'cancelled';
    const nextStatus = aborted ? 'paused' : 'failed';
    runtime.store.updateTask(taskId, current => {
      if (current.status !== 'cancelled') {
        current.status = nextStatus;
        current.blocker = aborted ? null : { code: err?.code || 'CONCLAVE_FAILED', message: err?.message || 'Conclave run failed.' };
      }
      return current;
    }, 'task.status', { status: nextStatus, conclaveRunId, ...(aborted ? {} : { error: err?.message }) });
    throw err;
  } finally {
    if (activeMap.size === 0) runtime.activeSubagents.delete(taskId);
    runtime._conclaveRuns.delete(taskId);
    runtime._liveTurn.delete(taskId);
    try { runtime._promotePendingProviders?.(taskId); } catch {}
  }
}
