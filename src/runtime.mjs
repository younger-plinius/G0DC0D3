import { runAnswerRace, validateAnswerRace } from './answer-race.mjs';
import { stitchContinuation } from './providers.mjs';
import { activeHistory, modelParameters, parametersFor } from './conversation-controls.mjs';
import { isCatalogModel } from './venice-catalog.mjs';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve, sep } from 'node:path';
import { promises as fs, constants as fsConstants } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { Store } from './store.mjs';
import { Broker, snapshotWorkspace, sha256, taskTools, conversationWithoutChecks, bindVerification, stableJson, evaluateBounded, scopedPath, READ_ONLY_TOOLS } from './broker.mjs';
import { BrowserPool, DEFAULT_BROWSER_SETTINGS, normalizeBrowserSettings, findChromiumBinary } from './browser-env.mjs';
import { validateTool } from './tool-schema.mjs';
import { diagnoseIncident, detectRefusal, rankCandidates, providerIdentity, candidateEligibility, requestProfile, providerTier } from './routing.mjs';
import { learningContext, inferModelFamily, bestStrategyForFamily, extractDeclineSignature } from './learning.mjs';
import {
  DEFAULT_OVERSEER_SETTINGS,
  normalizeOverseerSettings,
  scoreOverseerSuitability,
  looksAmbiguousEvasion,
  judgeAmbiguousReply,
  judgePermissionRisk,
  adviseUnblock
} from './overseer.mjs';
import { runSpecialistSubagent } from './subagents.mjs';
import {
  DEFAULT_TRANSPARENCY_CONFIG,
  normalizeTransparencyConfig,
  applyToolOverrides,
  buildTransparencySnapshot
} from './prompt-transparency.mjs';
import {
  ROUTER_DOMAINS,
  DEFAULT_ROUTER_SETTINGS,
  normalizeRouterSettings,
  loadBenchmarkMatrix,
  matchBenchmarkEntry,
  classifyPromptDomain,
  routeUltraPlinian,
  buildDomainLeaderboards
} from './ultra-router.mjs';
import {
  buildDomainMetacognition,
  detectModelFamily,
  forgeTaskMegaprompt,
  normalizeMetacognitionMode,
  shouldAutoForge
} from './metacognition.mjs';
import {
  AGENT_ARCHETYPES,
  buildStarterRoster,
  computeAgentStats,
  computeXpLevel,
  detectExternalHarnesses,
  estimateWorkerTelemetry,
  EXTERNAL_HARNESSES,
  normalizeFormation,
  normalizeRosterAgent,
  slugifyAgent,
  STARTER_FORMATIONS
} from './conclave-roster.mjs';
import { validateExecution, validateChecks } from './runner.mjs';
import { SourceChanges } from './source-changes.mjs';
import { CrewController } from './crew.mjs';
import { replyOutcome } from './outcomes.mjs';
import { reframe as reframeObjective, rewritePrompt } from './reframe.mjs';
import { gitAutoCommit, gitCheckpoints, gitCommit, gitDiffSummary, gitRewind, hasGit } from './git.mjs';
import { MemoryStore } from './memory.mjs';
import { validatePermissionRules, evaluatePermission, derivePatternRule, assessToolRisk, insertTaskAllowRule, DEFAULT_SAFE_PRESET, PERMISSION_PRESETS } from './permissions.mjs';
import { discoverHooks, runLifecycleHooks } from './hooks.mjs';
import {
  AUTO_COMPACT_UTILIZATION_THRESHOLD,
  COMPACTION_KEEP_TAIL_EVENTS,
  DEFAULT_CONTEXT_BYTE_LIMIT,
  computeCompactionWatermark,
  distillSemanticSummary,
  extractDeterministicHighlights,
  resolveContextByteLimit,
} from './compaction.mjs';
export { resolveContextByteLimit };
import { buildModelGroups } from './model-groups.mjs';
import {
  TELEMETRY_POLICY,
  DEFAULT_PRIVACY_SETTINGS,
  SECURITY_PROFILES,
  OutboundAuditLog,
  checkProviderPrivacyAllowed,
  classifyProviderZdr,
  normalizePrivacySettings,
  environmentSecrets,
  redactDiagnostics
} from './privacy.mjs';

const active = new Set(['running', 'recovering', 'verifying']);

function extractFileWrites(text) {
  if (!text || typeof text !== 'string') return [];
  const fileMap = new Map();
  const add = (path, content) => {
    if (!path || typeof content !== 'string' || !content.trim()) return;
    const norm = path.replace(/^\.\//, '');
    // Venice sometimes double-escapes newlines: JSON "\\n" → literal "\n" in content.
    // If the entire content is one line with literal \n sequences, unescape them.
    if (!content.includes('\n') && content.includes('\\n')) {
      content = content.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
    }
    fileMap.set(norm, content);
  };
  const isContextEcho = obj => obj && (obj.ownerChecks || obj.ownerFollowups || obj.contextManifest || (obj.tools && obj.objective && obj.constraints));

  const segments = text.split(/```(\w*)\s*\n/);
  for (let i = 1; i < segments.length; i += 2) {
    const lang = segments[i];
    const raw = segments[i + 1];
    if (!raw) continue;
    const block = raw.split('\n```')[0]?.trim();
    if (!block) continue;

    if (block.startsWith('{') || block.startsWith('[')) {
      try {
        const obj = JSON.parse(block);
        if (isContextEcho(obj)) continue;
        if (obj?.path && typeof obj.content === 'string') { add(obj.path, obj.content); continue; }
        if (Array.isArray(obj?.files)) { for (const f of obj.files) if (f?.path && typeof f.content === 'string') add(f.path, f.content); continue; }
        if (Array.isArray(obj)) { for (const f of obj) if (f?.path && typeof f.content === 'string') add(f.path, f.content); continue; }
      } catch {}
      const pathMatch = block.match(/"path"\s*:\s*"([^"\n]+?)"/);
      if (pathMatch) {
        const cm = block.match(/"content"\s*:\s*"/);
        if (cm) {
          const start = cm.index + cm[0].length;
          const hashIdx = block.indexOf('"expectedHash"', start);
          const endRegion = hashIdx > start ? hashIdx : block.lastIndexOf('}');
          let end = endRegion - 1;
          while (end > start && block[end] !== '"') end--;
          if (end > start) add(pathMatch[1], block.slice(start, end));
        }
      }
      continue;
    }

    const preceding = segments.slice(0, i).join('');
    const fileHint = preceding.match(/(?:\/\/\s*(?:file|filename):\s*|`)([\w./-]+\.\w+)`?\s*$/);
    if (fileHint && (lang === 'js' || lang === 'mjs' || lang === 'javascript' || lang === 'ts' || lang === 'json' || lang === 'css' || lang === 'html' || lang === 'py' || lang === 'python' || lang === '')) {
      add(fileHint[1], block);
    }
  }
  return [...fileMap].map(([path, content]) => ({ path, content }));
}
const terminal = new Set(['completed', 'cancelled']);
const turnFinished = task => task.status === 'completed' || (task.status === 'waiting_input' && task.blocker?.code === 'UNREGISTERED_ACCEPTANCE');
// Catalog models share the same Venice connection within a conversation.
const catalogWaitKey = 'venice:direct-chat';
const modes = new Set(['adaptive', 'hybrid', 'switch_model', 'prompt_strategies', 'ask']);
const fault = (code, message) => Object.assign(new Error(message), { code });
const taskSnapshot = workspace => snapshotWorkspace(workspace, { expectedRoot: workspace });
function validateAttachments(raw) {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw fault('INVALID_ATTACHMENT', 'Attachments must be an array.');
  if (raw.length > 4) throw fault('INVALID_ATTACHMENT', 'At most 4 image attachments are allowed per message.');
  const allowedTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
  return raw.map((item, idx) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw fault('INVALID_ATTACHMENT', `Attachment ${idx} must be an object.`);
    const mediaType = String(item.mediaType || '').toLowerCase();
    if (!allowedTypes.has(mediaType)) throw fault('INVALID_ATTACHMENT', 'Supported image types: PNG, JPEG, WebP, GIF.');
    const dataUrl = typeof item.dataUrl === 'string' ? item.dataUrl : '';
    if (!/^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(dataUrl) || dataUrl.length > 4 * 1024 * 1024) {
      throw fault('INVALID_ATTACHMENT', 'Each image attachment must be a valid base64 data URL up to 4 MB.');
    }
    const name = typeof item.name === 'string' && item.name.trim() ? item.name.trim().slice(0, 120) : `image-${idx + 1}`;
    return { name, mediaType, dataUrl };
  });
}

function messageCharLimit(message, base) {
  return typeof message === 'string' && message.includes('<attached_file ') ? 100000 : base;
}
function validateMessage(message, messageId) {
  const limit = messageCharLimit(message, 12000);
  if (typeof message !== 'string' || !message.trim() || message.length > limit) throw fault('INVALID_MESSAGE', `Follow-up must contain 1–${limit} characters.`);
  if (messageId !== undefined && (typeof messageId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(messageId))) throw fault('INVALID_MESSAGE', 'Message ID must contain 1–100 letters, numbers, underscores or hyphens.');
}
function checkMessageLimit(followups) {
  const hasAttachments = followups.some(f => typeof f?.message === 'string' && f.message.includes('<attached_file '));
  const byteLimit = hasAttachments ? 256 * 1024 : 16 * 1024;
  if (followups.length > 20 || Buffer.byteLength(JSON.stringify(followups)) > byteLimit) throw fault('MESSAGE_LIMIT', 'This task has reached its follow-up context limit. Start a new task for additional requirements.');
}
function withFollowups(task, followups) {
  const contractVersion = followups.at(-1).contractVersion;
  const stickyRefusal = task.policy?.stickyOnRefusal !== false;
  const declinedProviders = Array.isArray(task.routing?.declinedProviders) ? [...task.routing.declinedProviders] : [];
  const primaryDeclined = stickyRefusal && declinedProviders.includes(task.providers[0]);
  const cleanObjective = task.routing?.originalObjective || task.objective;
  const cleanFollowups = followups.map(f => f?.originalMessage ? { ...f, message: f.originalMessage, originalMessage: undefined } : f);
  const proposed = { ...task, objective: cleanObjective, followups: cleanFollowups, acceptance: { mode: 'owner', reason: 'followup', contractVersion }, verification: null, completionKind: null, contractVersion, blocker: null, strategy: 'continue', stallSignature: null, stallTurns: 0, recentToolCalls: [], lastIncident: null, routing: { primaryId: task.providers[0], cooldowns: {}, primaryReturnUsed: primaryDeclined, contributions: {}, ...(primaryDeclined ? { declinedProviders } : {}) } };
  if (isCatalogModel(task.providers[0]) && task.policy.returnToPrimary && !primaryDeclined) {
    proposed.providerId = task.providers[0];
    proposed.providerIndex = 0;
  }
  proposed.originalAcceptance = Object.hasOwn(task, 'originalAcceptance') ? task.originalAcceptance : task.acceptance;
  delete proposed.completedAt; delete proposed.acceptedSnapshotHash;
  delete proposed.replyOutcome;
  return proposed;
}

async function copyWorkspaceSafely(srcRoot, dstRoot) {
  const realSrc = await fs.realpath(srcRoot);
  const rootStat = await fs.lstat(realSrc);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw fault('WORKSPACE_INVALID', 'Source workspace must be a regular directory.');
  }
  await fs.mkdir(dstRoot, { recursive: true, mode: 0o700 });

  const walk = async (relDir = '') => {
    const srcDir = relDir ? join(realSrc, relDir) : realSrc;
    const dstDir = relDir ? join(dstRoot, relDir) : dstRoot;
    const dirReal = await fs.realpath(srcDir);
    if (dirReal !== srcDir || (dirReal !== realSrc && !dirReal.startsWith(realSrc + sep))) {
      throw fault('SYMLINK_DENIED', 'Workspace directory traverses a symbolic link.');
    }
    const entries = await fs.readdir(srcDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.g0d-write-')) continue;
      const srcEntry = join(srcDir, entry.name);
      const dstEntry = join(dstDir, entry.name);
      const stat = await fs.lstat(srcEntry);
      if (stat.isSymbolicLink()) {
        throw fault('SYMLINK_DENIED', `Refusing to copy symbolic link during fork: ${relDir ? `${relDir}/${entry.name}` : entry.name}`);
      }
      const entryReal = await fs.realpath(srcEntry);
      if (entryReal !== srcEntry || !entryReal.startsWith(realSrc + sep)) {
        throw fault('SYMLINK_DENIED', 'Workspace entry escapes source directory.');
      }
      if (stat.isDirectory()) {
        await fs.mkdir(dstEntry, { recursive: true, mode: (stat.mode & 0o777) || 0o700 });
        await walk(relDir ? join(relDir, entry.name) : entry.name);
      } else if (stat.isFile()) {
        let handle;
        try {
          handle = await fs.open(srcEntry, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0));
          const fstat = await handle.stat();
          if (!fstat.isFile()) throw fault('SNAPSHOT_UNSUPPORTED', `Cannot copy non-regular file: ${entry.name}`);
          const data = await handle.readFile();
          await fs.writeFile(dstEntry, data, { mode: (fstat.mode & 0o777) || 0o600 });
        } catch (cause) {
          if (cause.code === 'ELOOP') throw fault('SYMLINK_DENIED', 'Symbolic links are not supported during fork.');
          throw cause;
        } finally {
          if (handle) await handle.close().catch(() => {});
        }
      } else {
        throw fault('SNAPSHOT_UNSUPPORTED', `Cannot copy special file during fork: ${entry.name}`);
      }
    }
  };
  await walk('');
}

export function formatTranscript({ task, events = [], operations = [], diffStat = '' } = {}) {
  if (!task) throw fault('INVALID_TASK', 'Task is required to format a transcript.');
  const lines = [];
  lines.push(`# ${task.title || 'Untitled Task'}`, '');
  lines.push('## Metadata', '');
  lines.push(`- **Task ID**: \`${task.id}\``);
  lines.push(`- **Status**: ${task.status}${task.completionKind ? ` (${task.completionKind})` : ''}`);
  lines.push(`- **Mode**: ${task.planMode ? 'Plan (read-only)' : 'Build'}`);
  lines.push(`- **Providers**: ${(task.providers || []).join(', ') || '(none)'} (active: \`${task.providerId || 'none'}\`)`);
  lines.push(`- **Source Path**: ${task.sourcePath ? `\`${task.sourcePath}\`` : '_(isolated workspace)_'}`);
  lines.push(`- **Calls / Recoveries**: ${task.calls ?? 0} / ${task.recoveries ?? 0}`);
  if (task.parentTaskId) {
    lines.push(`- **Forked From**: \`${task.parentTaskId}\`${task.forkedFromHash ? ` @ \`${task.forkedFromHash}\`` : ''}`);
  }
  lines.push(`- **Created**: ${task.createdAt || ''}`);
  lines.push(`- **Updated**: ${task.updatedAt || ''}`, '');

  lines.push('## Objective', '', task.objective || '', '');

  if (Array.isArray(task.followups) && task.followups.length) {
    lines.push('### Owner Follow-ups', '');
    for (const f of task.followups) {
      lines.push(`- **${f.createdAt || ''}** (v${f.contractVersion ?? ''}): ${f.message || ''}`);
    }
    lines.push('');
  }

  if (Array.isArray(task.todos) && task.todos.length) {
    lines.push('## Todo Checklist', '');
    for (const item of task.todos) {
      const box = item.status === 'done' ? '[x]' : item.status === 'in_progress' ? '[~]' : '[ ]';
      lines.push(`- ${box} \`${item.id}\` ${item.text}`);
    }
    lines.push('');
  }

  lines.push('## Conversation & Tool Timeline', '');
  const opsById = new Map((operations || []).map(op => [op.id, op]));
  let timelineEntries = 0;
  for (const event of events || []) {
    const time = event.time ? `\`${event.time}\`` : '';
    const d = event.data || {};
    if (event.type === 'user.message') {
      timelineEntries++;
      lines.push(`### [User] ${time}`, '', d.message || '', '');
    } else if (event.type === 'model.response') {
      const resp = d.response || {};
      if (resp.type === 'message' && resp.text) {
        timelineEntries++;
        lines.push(`### [Assistant · ${d.providerId || ''}] ${time}`, '', resp.text.slice(0, 4000), '');
      } else if (resp.type === 'tool' && Array.isArray(resp.calls)) {
        timelineEntries++;
        const summary = resp.calls.map(c => `\`${c.name}\``).join(', ');
        lines.push(`- ${time} **Assistant** (\`${d.providerId || ''}\`) called: ${summary}`);
      } else if (resp.type === 'error') {
        timelineEntries++;
        lines.push(`- ${time} **Provider Error** (\`${d.providerId || ''}\`): ${resp.code || ''} ${resp.message || ''}`);
      }
    } else if (event.type === 'tool.completed') {
      timelineEntries++;
      const op = opsById.get(d.operationId);
      const res = d.result;
      const ok = res?.ok !== false && d.status !== 'failed';
      const detail = !ok
        ? `ERROR \`${res?.error?.code || 'TOOL_ERROR'}\`: ${String(res?.error?.message || '').slice(0, 300)}`
        : res?.path ? `path=\`${res.path}\`` : res?.summary ? String(res.summary).slice(0, 200) : 'ok';
      const argHint = op?.args?.path ? ` \`${op.args.path}\`` : op?.args?.command ? ` \`${String(op.args.command).slice(0, 120)}\`` : '';
      lines.push(`- ${time} **Tool** \`${d.name || ''}\`${argHint}: ${detail}`);
    } else if (event.type === 'permission.requested') {
      timelineEntries++;
      lines.push(`- ${time} **Approval Requested**: \`${d.tool || ''}\` ${d.target ? `(\`${String(d.target).slice(0, 120)}\`)` : ''} — ${d.reason || 'paused for owner approval'}`);
    } else if (event.type === 'permission.resolved') {
      timelineEntries++;
      lines.push(`- ${time} **Approval Resolved**: \`${d.tool || ''}\` -> **${d.decision || ''}**`);
    } else if (event.type === 'permission.denied') {
      timelineEntries++;
      lines.push(`- ${time} **Permission Denied**: \`${d.tool || ''}\` ${d.target ? `(\`${String(d.target).slice(0, 120)}\`)` : ''} — ${d.reason || ''}`);
    } else if (event.type === 'runtime.doom_loop') {
      timelineEntries++;
      lines.push(`- ${time} **Doom-Loop Guard**: intercepted 3rd consecutive repeat of \`${d.tool || ''}\``);
    } else if (event.type === 'model.switched') {
      timelineEntries++;
      lines.push(`- ${time} **Model Switched**: \`${d.from || ''}\` -> \`${d.to || ''}\` (${d.reason || ''})`);
    } else if (event.type === 'git.checkpoint') {
      timelineEntries++;
      lines.push(`- ${time} **Git Checkpoint**: \`${d.hash || ''}\` ${d.message || ''}`);
    } else if (event.type === 'task.rewound') {
      timelineEntries++;
      lines.push(`- ${time} **Rewound**: \`${d.fromHash || ''}\` -> \`${d.toHash || ''}\` (${d.summary || ''})`);
    } else if (event.type === 'task.forked') {
      timelineEntries++;
      lines.push(`- ${time} **Forked** from \`${d.parentTaskId || ''}\` (${d.parentTitle || ''})`);
    } else if (event.type === 'evaluation.completed') {
      timelineEntries++;
      lines.push(`- ${time} **Evaluation**: status=\`${d.status || 'unknown'}\` (${Array.isArray(d.checks) ? d.checks.length : 0} checks)`);
    }
  }
  if (!timelineEntries) lines.push('_No recorded timeline events._');
  lines.push('');

  if (task.verification?.checks?.length) {
    lines.push('## Verification & Checks', '');
    lines.push(`- **Overall Status**: \`${task.verification.status}\``);
    for (const check of task.verification.checks) {
      lines.push(`- **${check.name}**: \`${check.status}\`${check.detail ? ` — ${String(check.detail).slice(0, 300)}` : ''}`);
    }
    lines.push('');
  }

  if (typeof diffStat === 'string' && diffStat.trim()) {
    lines.push('## Workspace Diff Stat', '', '```', diffStat.trim(), '```', '');
  }

  return redactDiagnostics(lines.join('\n'));
}
export function effectiveTurnTimeoutMs(task) {
  const base = Number.isInteger(task?.policy?.requestTimeoutMs) ? task.policy.requestTimeoutMs : defaultPolicy.requestTimeoutMs;
  if (base < 30000) return base;
  const effort = normalizeEffort(task?.effort);
  if (effort === 'max') return Math.min(900000, Math.max(base, 600000));
  if (effort === 'high') return Math.min(900000, Math.max(base, 360000));
  return base;
}

const defaultPolicy = { mode: 'adaptive', maxAttempts: 15, maxCalls: 250, strategies: ['continue', 'decompose', 'reproduce-first', 'alternate-approach'], requestTimeoutMs: 600000, maxNoProgressTurns: 6, returnToPrimary: true, stickyOnRefusal: true, learning: true, escalation: 'auto', autoContinue: true, maxContinuations: 6 };
export function normalizePolicy(patch = {}, previous = defaultPolicy) {
  const policy = { ...defaultPolicy, ...previous, ...patch };
  if (!modes.has(policy.mode)) throw fault('INVALID_POLICY', 'Unknown recovery mode.');
  for (const [key, min, max] of [['maxAttempts', 0, 100], ['maxCalls', 1, 5000], ['requestTimeoutMs', 10, 900000], ['maxNoProgressTurns', 2, 30], ['maxContinuations', 0, 12]]) if (!Number.isInteger(policy[key]) || policy[key] < min || policy[key] > max) throw fault('INVALID_POLICY', `${key} must be an integer from ${min} to ${max}.`);
  if (!Array.isArray(policy.strategies) || policy.strategies.length > 20 || policy.strategies.some(value => typeof value !== 'string' || !value || value.length > 1000)) throw fault('INVALID_POLICY', 'Strategies must be a bounded array of strings.');
  for (const key of ['returnToPrimary', 'stickyOnRefusal', 'learning', 'autoContinue']) if (typeof policy[key] !== 'boolean') throw fault('INVALID_POLICY', `${key} must be a boolean.`);
  if (!['auto', 'off'].includes(policy.escalation)) throw fault('INVALID_POLICY', 'escalation must be "auto" or "off".');
  return policy;
}

export function normalizeExecution(patch = {}, previous = { enabled: false, network: false, timeoutMs: 30000 }) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).some(key => !['enabled', 'network', 'timeoutMs'].includes(key))) throw fault('INVALID_EXECUTION', 'Execution accepts enabled, network and timeoutMs only.');
  return validateExecution({ enabled: false, network: false, timeoutMs: 30000, ...previous, ...patch });
}
export function normalizeChecks(checks = []) {
  return validateChecks(checks);
}
export function normalizePersona(persona = 'plinian') { if (!['plinian', 'focused'].includes(persona)) throw fault('INVALID_PERSONA', 'Persona must be plinian or focused.'); return persona; }
export const EFFORT_LEVELS = Object.freeze(['fast', 'medium', 'high', 'max']);
export function normalizeEffort(effort = 'medium') {
  const val = String(effort || 'medium').toLowerCase();
  if (!EFFORT_LEVELS.includes(val)) throw fault('INVALID_EFFORT', 'Effort must be fast, medium, high, or max.');
  return val;
}

function compactToolResultObject(toolName, result) {
  const limit = 12288;
  const raw = JSON.stringify(result);
  if (raw.length <= limit) return null;
  if (typeof result !== 'object' || result === null || Array.isArray(result)) {
    return '[tool result truncated from ' + raw.length + ' chars]';
  }
  const clone = { ...result };
  // Preserve interactive browser refs, URL, title, and consoleErrors while trimming verbose page text first.
  if (toolName && toolName.startsWith('browser.')) {
    if (typeof clone.text === 'string' && clone.text.length > 2600) {
      clone.text = clone.text.slice(0, 2200) + `\n[…truncated ${clone.text.length} chars…]\n` + clone.text.slice(-300);
      clone.truncated = true;
    }
    if (Array.isArray(clone.elements) && clone.elements.length > 45) {
      clone.elements = clone.elements.slice(0, 45);
    }
    if (Array.isArray(clone.consoleErrors) && clone.consoleErrors.length > 15) {
      clone.consoleErrors = clone.consoleErrors.slice(-15);
    }
    if (JSON.stringify(clone).length <= limit) return clone;
  }
  // Structured truncation for web.fetch, repo.read, process.run, browser.eval, git.diff, etc.
  for (const key of ['content', 'stdout', 'stderr', 'text', 'result', 'diff', 'log']) {
    if (typeof clone[key] === 'string' && clone[key].length > 3200) {
      clone[key] = clone[key].slice(0, 2400) + `\n[…truncated ${clone[key].length} chars…]\n` + clone[key].slice(-600);
      clone.truncated = true;
    }
  }
  if (Array.isArray(clone.elements) && clone.elements.length > 30) clone.elements = clone.elements.slice(0, 30);
  if (Array.isArray(clone.matches) && clone.matches.length > 40) clone.matches = clone.matches.slice(0, 40);
  if (Array.isArray(clone.results) && clone.results.length > 10) clone.results = clone.results.slice(0, 10);
  if (JSON.stringify(clone).length <= limit) return clone;
  return '[tool result truncated from ' + raw.length + ' chars]';
}

function compactEvent(event, tier) {
  if (!event.data || typeof event.data !== 'object') return event;
  // Never leak private reasoning / thinking blocks into portable model context.
  if (event.type === 'model.response' && event.data.response && Object.hasOwn(event.data.response, 'thinking')) {
    const { thinking: _omitted, ...cleanResponse } = event.data.response;
    event = { ...event, data: { ...event.data, response: cleanResponse } };
  }
  // Tier 1: strip older tool/model payloads to minimal identity before checking tier 0
  if (tier >= 1) {
    if (event.type === 'tool.completed') return { ...event, data: { name: event.data.name, ok: event.data.ok, _compacted: 'tier1' } };
    if (event.type === 'model.response') return { ...event, data: { providerId: event.data.providerId, type: event.data.response?.type, response: { type: event.data.response?.type, ...(event.data.response?.finish ? { finish: event.data.response.finish } : {}) }, _compacted: 'tier1' } };
    if (event.type === 'model.request') return { ...event, data: { providerId: event.data.providerId, call: event.data.call, strategy: event.data.strategy, _compacted: 'tier1' } };
  }
  // Tier 0: preserve structured tool fields (browser refs, web content, file hashes, stdout) before truncating
  if (tier >= 0 && event.type === 'tool.completed' && event.data.result) {
    const result = event.data.result;
    if (typeof result === 'string') {
      if (result.length > 6144) {
        const truncated = result.slice(0, 3072) + '\n[…truncated ' + result.length + ' chars…]\n' + result.slice(-1024);
        return { ...event, data: { ...event.data, result: truncated, _compacted: 'tier0' } };
      }
    } else {
      const compacted = compactToolResultObject(event.data.name, result);
      if (compacted !== null) {
        return { ...event, data: { ...event.data, result: compacted, _compacted: 'tier0' } };
      }
    }
  }
  // Tier 0: truncate large model response text
  if (tier >= 0 && event.type === 'model.response' && event.data.response?.text) {
    const text = event.data.response.text;
    if (text.length > 4096) {
      return { ...event, data: { ...event.data, response: { ...event.data.response, text: text.slice(0, 1536) + '\n[…truncated ' + text.length + ' chars…]\n' + text.slice(-512) }, _compacted: 'tier0' } };
    }
  }
  return event;
}

export function extractFileMentions(texts = [], files = []) {
  const pathSet = new Set((Array.isArray(files) ? files : []).map(file => typeof file === 'string' ? file : file?.path).filter(Boolean));
  if (!pathSet.size) return [];
  const found = [];
  const seen = new Set();
  const pattern = /(?:^|[\s([{"'`,;])@([A-Za-z0-9._/@+\[\]$~-]+)/g;
  for (const raw of Array.isArray(texts) ? texts : []) {
    if (typeof raw !== 'string' || !raw.includes('@')) continue;
    for (const match of raw.matchAll(pattern)) {
      const candidate = match[1].replace(/[.,:;!?)\]}'"]+$/, '').replace(/^\.\//, '');
      if (candidate && pathSet.has(candidate) && !seen.has(candidate)) {
        seen.add(candidate);
        found.push(candidate);
      }
    }
  }
  return found;
}

/** Byte-bounded observable context with dynamic model-window scaling and watermark folding. */
export function buildContext({ task, history, files, snapshotHash, learning, memories = [], transparency = null, provider = null, byteLimit = resolveContextByteLimit(provider, task), totalHistoryCount = history.length }) {
  history = activeHistory(task, history);
  const compactedBeforeSeq = Number.isInteger(task?.workingSummary?.compactedBeforeSeq) && task.workingSummary.compactedBeforeSeq > 0
    ? task.workingSummary.compactedBeforeSeq
    : 0;
  const size = value => Buffer.byteLength(JSON.stringify(value));
  const projected = { ...task };
  delete projected.initialSnapshot; delete projected.failures; delete projected.routeFailures;
  delete projected.verification; delete projected.lastIncident;
  delete projected.importManifest;
  delete projected.routing;
  delete projected.providerNotBefore;
  delete projected.pendingMessages;
  delete projected.deferredMessages;
  delete projected.historyExclusions;
  delete projected.approvedOnceCall;
  delete projected.recentToolCalls;
  projected.recoverySummary = task.lastIncident ? {
    code: task.lastIncident.code, diagnosis: task.lastIncident.diagnosis,
    message: String(task.lastIncident.message || '').slice(0, 1000),
    failingChecks: (task.lastIncident.checks || []).filter(check => check.status !== 'pass').slice(0, 5)
      .map(check => ({ name: String(check.name || '').slice(0, 150), detail: String(check.detail || '').slice(0, 300) })),
    attemptsUsed: task.recoveries, attemptsRemaining: Math.max(0, task.policy.maxAttempts - task.recoveries)
  } : null;
  if (task.routing?.overseerGuidance) {
    projected.overseerGuidance = String(task.routing.overseerGuidance).slice(0, 800);
  }
  projected.execution = normalizeExecution({}, task.execution);
  projected.persona = normalizePersona(task.persona);
  projected.initialSnapshotHash = task.initialSnapshot?.snapshotHash;
  projected.verificationSummary = task.verification ? { status: task.verification.status, snapshotHash: task.verification.snapshotHash } : null;
  // Include periodic probe progress so the model knows which probes pass/fail mid-task.
  const probeProgress = task.routing?.probeProgress;
  if (probeProgress && probeProgress.total > 0) {
    projected.probeProgress = { passed: probeProgress.passed, total: probeProgress.total, atCall: probeProgress.call,
      failing: (probeProgress.failing || []).slice(0, 12),
      highWater: probeProgress.highWater || null, rolledBack: probeProgress.rolledBack || false,
      plateauCount: task.routing?.plateauCount || 0 };
  }
  const manifest = {
    byteLimit,
    bytes: 0,
    utilizationPct: 0,
    ...(compactedBeforeSeq ? { compactedBeforeSeq, compactedEventCount: 0 } : {}),
    mandatory: ['objective', 'constraints', 'owner follow-ups', 'current task identity'],
    includedFiles: [],
    omittedFiles: [],
    includedEventIds: [],
    omittedEventCount: totalHistoryCount,
    notes: [
      compactedBeforeSeq
        ? `Events through seq ${compactedBeforeSeq} were folded into task.workingSummary (hybrid structural + semantic memory) and remain searchable via task.history.`
        : 'Omitted file contents remain available through repo.read with offset/limit. Omitted observable history remains searchable through task.history. The original objective, constraints, and chronological owner follow-ups form the current task contract.'
    ]
  };
  if (task.importManifest) {
    const imported = task.importManifest;
    manifest.import = {
      sourceSnapshotHash: imported.snapshotHash,
      copiedFileCount: imported.files?.length || 0,
      copiedBytes: imported.totalBytes,
      omittedCount: imported.omitted?.length || 0,
      omittedExamples: (imported.omitted || []).slice(0, 12).map(({ path, reason }) => ({ path: String(path).slice(0, 400), reason: String(reason).slice(0, 200) })),
      omittedListTruncated: (imported.omitted?.length || 0) > 12,
      note: 'Excluded original files are unknown and unavailable through the copied-workspace tools. The owner can inspect the full import manifest saved on the task.'
    };
  }
  const effort = normalizeEffort(task.effort);
  const rawAdvertisedTools = taskTools(task)
    .filter(t => !(effort === 'fast' && task.workspaceKind === 'conversation' && !task.sourcePath && (t.name === 'task.todo' || t.name === 'agent.spawn')))
    .map(({ name, description, parameters }) => ({ name, description, parameters }));
  const effectiveTransparency = !task.fixtureId ? transparency : null;
  const advertisedTools = applyToolOverrides(rawAdvertisedTools, effectiveTransparency);
  // Keep transparency metadata off `context` until after byte-budgeting since taskContextData() never serializes it.
  const context = { task: projected, history: [], files: files.map(({ path, sha256, bytes }) => ({ path, sha256, bytes, content: null, omitted: true })), tools: advertisedTools, strategy: task.strategy, remainingCalls: task.policy.maxCalls - task.calls, snapshotHash, manifest, learning: learningContext(learning, task.policy.learning !== false), memories: !task.fixtureId && Array.isArray(memories) ? memories : [] };
  const visibleHistory = history.filter(event => !['user.message.queued', 'user.message.removed'].includes(event.type));
  const hotHistory = compactedBeforeSeq
    ? visibleHistory.filter(event => !Number.isInteger(event.seq) || event.seq > compactedBeforeSeq)
    : visibleHistory;
  if (compactedBeforeSeq) {
    manifest.compactedEventCount = Math.max(0, visibleHistory.length - hotHistory.length);
  }
  const recent = hotHistory.slice(-120);
  const recentCutoff = Math.max(0, recent.length - 30);
  const included = new Set();
  const addEvent = (event, tier) => {
    const compacted = compactEvent(event, tier);
    context.history.unshift(compacted);
    if (size(context) > byteLimit - 2048) { context.history.shift(); return; }
    included.add(event);
  };
  // Explicit retrieval must reach the next model turn. Reserve room for recent
  // read/history/browser/web evidence before filling the prompt with opportunistic files.
  let keptBrowserSnapshots = 0;
  for (const event of [...recent].reverse()) {
    if (event.type !== 'tool.completed') continue;
    const name = event.data?.name;
    if (['repo.read', 'repo.search', 'repo.glob', 'task.history', 'web.search', 'web.fetch'].includes(name)) {
      addEvent(event, 0);
    } else if (['browser.open', 'browser.act', 'browser.snapshot', 'browser.eval'].includes(name)) {
      addEvent(event, keptBrowserSnapshots < 2 ? 0 : 1);
      keptBrowserSnapshots += 1;
    }
  }
  // Prioritize @path/to/file references from objective & owner follow-ups so they
  // are never dropped in favor of opportunistic files on large repos.
  const prioritizedPaths = extractFileMentions([task.objective, ...(task.followups || []).map(f => f?.message)], files);
  const prioritizedSet = new Set(prioritizedPaths);
  if (prioritizedPaths.length) manifest.prioritizedFiles = prioritizedPaths;
  const fileIndexByPath = new Map(files.map((file, idx) => [file.path, idx]));
  const orderedFileIndices = [
    ...prioritizedPaths.map(p => fileIndexByPath.get(p)).filter(idx => idx !== undefined),
    ...files.map((_, idx) => idx).filter(idx => !prioritizedSet.has(files[idx].path))
  ];
  for (const i of orderedFileIndices) {
    const file = files[i];
    if (file.content === null) continue;
    const next = { ...file };
    const previous = context.files[i];
    context.files[i] = next;
    const cap = prioritizedSet.has(file.path) ? byteLimit * 0.85 : byteLimit * 0.7;
    if (size(context) > cap) context.files[i] = previous;
  }
  for (const event of [...recent].reverse()) {
    if (included.has(event)) continue;
    const idx = recent.indexOf(event);
    const tier = idx < recentCutoff ? 1 : 0;
    const compacted = compactEvent(event, tier);
    if (size(compacted) > 36 * 1024) continue;
    context.history.unshift(compacted);
    if (size(context) > byteLimit - 2048) { context.history.shift(); continue; }
    included.add(event);
  }
  context.history.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  const refreshManifest = () => {
    manifest.includedFiles = context.files.filter(file => !file.omitted && file.content !== null).map(file => file.path);
    manifest.omittedFiles = context.files.filter(file => file.omitted || file.content === null).map(file => ({ path: file.path, reason: files.find(original => original.path === file.path)?.content === null ? 'binary content unsupported in model context' : 'context byte budget' }));
    manifest.includedEventIds = context.history.map(event => event.id);
    manifest.omittedEventCount = Math.max(0, totalHistoryCount - context.history.length);
  };
  refreshManifest();
  while (size(context) > byteLimit && context.history.length) { context.history.shift(); refreshManifest(); }
  if (size(context) > byteLimit) {
    for (const file of [...context.files].sort((a, b) => {
      const ap = prioritizedSet.has(a.path) ? 1 : 0;
      const bp = prioritizedSet.has(b.path) ? 1 : 0;
      if (ap !== bp) return ap - bp;
      return (b.content?.length || 0) - (a.content?.length || 0);
    })) {
      if (file.content === null) continue;
      file.content = null; file.omitted = true; refreshManifest();
      if (size(context) <= byteLimit) break;
    }
  }
  // Account for the manifest's own size field, and never truncate the task contract.
  manifest.bytes = size(context);
  manifest.utilizationPct = Math.min(100, Math.round((manifest.bytes / Math.max(1, byteLimit)) * 100));
  manifest.bytes = size(context);
  manifest.utilizationPct = Math.min(100, Math.round((manifest.bytes / Math.max(1, byteLimit)) * 100));
  if (size(context) > byteLimit) throw fault('CONTEXT_LIMIT', `Mandatory task context and file manifest exceed the ${Math.round(byteLimit / 1024)} KiB context budget; narrow the task.`);
  if (effectiveTransparency) context.transparency = effectiveTransparency;
  return context;
}

export class Runtime {
  constructor({ dataDir, providers = new Map(), evaluator, faultInjector, catalog, outboundSecrets = environmentSecrets } = {}) {
    this.outboundSecrets = outboundSecrets;
    if (!dataDir) throw new Error('dataDir is required');
    this.store = new Store(dataDir);
    this.catalog = catalog;
    this.providers = providers instanceof Map ? providers : new Map(Object.entries(providers));
    // Existing fixture checks cannot certify requirements added by an owner.
    // Apply the same contract gate to final verification and brokered check.run.
    this.evaluator = async (task, options) => {
      if (task.followups?.length && !(task.checks?.length && task.checksContractVersion === task.contractVersion)) return { status: 'unknown', code: 'UNREGISTERED_ACCEPTANCE', contractVersion: task.contractVersion, snapshotHash: (await taskSnapshot(task.workspace)).snapshotHash, checks: [{ name: 'Follow-up acceptance', status: 'unknown', detail: 'The owner added requirements after the original acceptance contract. Review and accept the current changes; earlier fixture checks do not certify this follow-up.' }] };
      if (evaluator) return evaluator(task, options);
      return { status: 'unknown', snapshotHash: (await taskSnapshot(task.workspace)).snapshotHash, checks: [{ name: 'acceptance', status: 'unknown', detail: 'No independent evaluator configured.' }] };
    };
    this.memory = new MemoryStore(this.store);
    this._streamSubs = new Map();
    const browserPool = new BrowserPool({
      getSettings: () => this.getBrowserSettings(),
      onEvent: (evt) => {
        if (evt?.taskId) this._emitStream(evt.taskId, evt);
      }
    });
    this.broker = new Broker({ store: this.store, evaluator: this.evaluator, faultInjector, memory: this.memory, browser: browserPool });
    this.runs = new Map();
    this.closed = false;
    this.sourceChanges = new SourceChanges(this);
    for (const task of this.store.listTasks()) if (active.has(task.status)) this.store.updateTask(task.id, current => { current.status = 'paused'; current.epoch += 1; current.blocker = { code: 'RESTART_RECONCILIATION', message: 'Interrupted runtime. Resume will reconcile pending operations.' }; return current; }, 'task.restarted', { previousStatus: task.status });
    this.crew = new CrewController(this);
    this.outboundAudit = new OutboundAuditLog({ maxEntries: 100 });
    this.activeSubagents = new Map();
    this._workerSteers = new Map();
  }
  subscribeStream(taskId, callback) {
    if (!this._streamSubs.has(taskId)) this._streamSubs.set(taskId, new Set());
    this._streamSubs.get(taskId).add(callback);
    return () => { const subs = this._streamSubs.get(taskId); if (subs) { subs.delete(callback); if (!subs.size) this._streamSubs.delete(taskId); } };
  }
  _emitStream(taskId, event) {
    const subs = this._streamSubs.get(taskId);
    if (subs) for (const cb of subs) try { cb(event); } catch {}
  }
  async queueWorkerSteer(taskId, workerId, message) {
    const cleanWorkerId = typeof workerId === 'string' ? workerId.trim().slice(0, 128) : '';
    if (!cleanWorkerId) throw fault('INVALID_MESSAGE', 'Worker identifier is required.');
    const text = String(message || '').trim().slice(0, 2000);
    if (!text) throw fault('INVALID_MESSAGE', 'Steer message cannot be empty.');
    const task = this.getTask(taskId);
    const activeMap = this.activeSubagents.get(taskId);
    if (activeMap?.has(cleanWorkerId)) {
      const key = `${taskId}:${cleanWorkerId}`;
      const next = [...(this._workerSteers.get(key) || []), text].slice(-6);
      this._workerSteers.set(key, next);
      this._emitStream(taskId, { type: 'conclave.steered', workerId: cleanWorkerId, message: text, target: 'subagent' });
      return { ok: true, target: 'subagent', workerId: cleanWorkerId, queued: next.length };
    }
    const crew = this.crew?.record(taskId);
    if (crew && Object.values(crew.members || {}).includes(cleanWorkerId)) {
      const roleEntry = Object.entries(crew.members || {}).find(([, wid]) => wid === cleanWorkerId);
      const crewRole = roleEntry?.[0] || 'worker';
      if (crewRole === 'verifier') {
        throw fault('INVALID_STEER', 'Independent verifier checks cannot be steered mid-run.');
      }
      // Record crew steer out-of-band without mutating pendingMessages (which would invalidate contractVersion)
      this.store.appendEvent(taskId, 'conclave.steered', { workerId: cleanWorkerId, role: crewRole, message: text, target: 'crew_worker' });
      this._emitStream(taskId, { type: 'conclave.steered', workerId: cleanWorkerId, role: crewRole, message: text, target: 'crew_worker' });
      return { ok: true, target: 'crew_worker', workerId: cleanWorkerId, queued: 1 };
    }
    if (active.has(task.status)) {
      const res = await this.submitMessage(task.id, `[Conclave steer → ${cleanWorkerId}] ${text}`, undefined, 'steer');
      this._emitStream(taskId, { type: 'conclave.steered', workerId: cleanWorkerId, message: text, target: 'orchestrator' });
      return { ok: true, target: 'orchestrator', workerId: cleanWorkerId, queued: res.task?.pendingMessages?.length || 1 };
    }
    this.store.appendEvent(taskId, 'conclave.steered', { workerId: cleanWorkerId, message: text, target: 'note' });
    this._emitStream(taskId, { type: 'conclave.steered', workerId: cleanWorkerId, message: text, target: 'note' });
    return { ok: true, target: 'note', workerId: cleanWorkerId, queued: 1 };
  }
  drainWorkerSteer(taskId, workerId) {
    const key = `${taskId}:${workerId}`;
    const list = this._workerSteers.get(key);
    if (!list?.length) return [];
    this._workerSteers.delete(key);
    return list;
  }
  async _executeAgentSpawn(id, epoch, call, signal) {
    validateTool('agent.spawn', call.args || {});
    const workerId = String(call.id || `sub-${Date.now().toString(36)}`);
    const role = String(call.args?.role || 'explore').trim() || 'explore';
    const promptPreview = String(call.args?.prompt || '').slice(0, 400);
    const startedAt = new Date().toISOString();
    let activeMap = this.activeSubagents.get(id);
    if (!activeMap) { activeMap = new Map(); this.activeSubagents.set(id, activeMap); }
    const initialState = {
      workerId, callId: call.id, kind: 'subagent', role, prompt: promptPreview,
      status: 'thinking', providerId: null, modelLabel: null, tool: '', target: '',
      files: [], tools: [], streamTail: '', calls: 0, startedAt, durationMs: 0
    };
    activeMap.set(workerId, initialState);
    this.store.appendEvent(id, 'subagent.started', { workerId, callId: call.id, role, prompt: promptPreview, startedAt });
    this._emitStream(id, { type: 'subagent.started', worker: initialState });
    let finished = false;
    try {
      const result = await runSpecialistSubagent({
        runtime: this,
        parentTask: this.getTask(id),
        role,
        prompt: call.args?.prompt || '',
        modelHint: call.args?.model,
        workerId,
        signal,
        onProgress: (prog) => {
          if (finished) return;
          const merged = { ...initialState, ...prog, kind: 'subagent', callId: call.id, prompt: promptPreview };
          activeMap.set(workerId, merged);
          this._emitStream(id, { type: 'subagent.progress', worker: merged });
        }
      });
      const opId = `${id}:${call.id}`;
      const nowIso = new Date().toISOString();
      this.store.putOperation({
        id: opId, taskId: id, callId: call.id, name: call.name, args: call.args,
        argsHash: sha256(stableJson(call.args || {})), epoch,
        status: result?.ok ? 'succeeded' : 'failed', result, createdAt: nowIso, updatedAt: nowIso
      }, 'tool.completed', { operationId: opId, name: call.name, status: result?.ok ? 'succeeded' : 'failed', result });
      this.store.appendEvent(id, 'subagent.completed', { workerId, callId: call.id, ...result });
      this.recordConclaveAgentRun(result?.role || role, { ok: Boolean(result?.ok), durationMs: result?.durationMs || 0 });
      this._emitStream(id, { type: 'subagent.completed', worker: { ...initialState, ...result, status: result?.ok ? 'completed' : 'failed' } });
      return result;
    } finally {
      finished = true;
      activeMap.delete(workerId);
      if (activeMap.size === 0) this.activeSubagents.delete(id);
      this._workerSteers.delete(`${id}:${workerId}`);
    }
  }
  getConclaveState(taskId) {
    const task = this.getTask(taskId);
    const events = this.store.getRecentEvents(taskId, 300);
    const workersById = new Map();
    const failovers = [];
    const raceEvents = [];
    const providerLabel = (pid) => {
      if (!pid) return null;
      const p = this.providers.get(pid) || this.catalog?.get?.(pid);
      return p?.label || p?.model || pid;
    };

    for (const ev of events) {
      const d = ev.data || {};
      if (ev.type === 'subagent.started') {
        const wId = d.workerId || d.callId || `sa-${ev.seq}`;
        workersById.set(wId, {
          workerId: wId, callId: d.callId || wId, kind: 'subagent',
          role: d.role || 'explore', prompt: d.prompt || '',
          status: 'thinking', providerId: null, modelLabel: null,
          tool: '', target: '', files: [], tools: [], streamTail: '',
          summary: '', calls: 0, startedAt: d.startedAt || ev.time, endedAt: null, durationMs: 0
        });
      } else if (ev.type === 'subagent.completed') {
        const wId = d.workerId || d.callId || `sa-${ev.seq}`;
        const prev = workersById.get(wId) || { workerId: wId, kind: 'subagent', role: d.role || 'explore', startedAt: d.startedAt || ev.time };
        workersById.set(wId, {
          ...prev,
          role: d.role || prev.role || 'explore',
          status: d.ok ? 'completed' : 'failed',
          providerId: d.providerId || prev.providerId,
          modelLabel: d.modelLabel || providerLabel(d.providerId) || prev.modelLabel,
          files: Array.isArray(d.files) ? d.files : (prev.files || []),
          tools: Array.isArray(d.tools) ? d.tools : (prev.tools || []),
          calls: d.calls || prev.calls || 1,
          summary: d.summary || d.error?.message || '',
          streamTail: String(d.summary || d.error?.message || '').slice(-360),
          startedAt: d.startedAt || prev.startedAt,
          endedAt: d.endedAt || ev.time,
          durationMs: d.durationMs || 0
        });
      } else if (ev.type === 'model.switched' || ev.type === 'routing.reframe_retry') {
        failovers.push({
          type: ev.type, at: ev.time,
          from: d.from || d.providerId || null,
          to: d.to || d.providerId || null,
          reason: d.reason || d.level || 'GODMODƎ recovery'
        });
      } else if (ev.type === 'race.dispatched' || ev.type === 'race.result' || (ev.type === 'model.response' && d.scorecard)) {
        raceEvents.push(ev);
      }
    }

    // Overlay live in-flight subagents
    const liveSubs = this.activeSubagents.get(taskId);
    if (liveSubs) {
      for (const [wId, live] of liveSubs.entries()) {
        workersById.set(wId, { ...live, modelLabel: live.modelLabel || providerLabel(live.providerId) });
      }
    }

    // Merge Coding Crew workers if present
    const crewSummary = this.crew?.summary(taskId) || null;
    if (crewSummary?.workers?.length) {
      for (const cw of crewSummary.workers) {
        const wTask = cw.taskId ? this.store.getTask(cw.taskId) : null;
        const wEvents = cw.taskId ? this.store.getRecentEvents(cw.taskId, 40) : [];
        const filesSet = new Set();
        let lastTool = '';
        for (const we of wEvents) {
          if (we.type === 'tool.started' || we.type === 'tool.completed') {
            if (we.data?.name) lastTool = we.data.name;
            if (we.data?.path) filesSet.add(we.data.path);
            if (we.data?.result?.path) filesSet.add(we.data.result.path);
          }
        }
        const statusMap = { running: 'streaming', verifying: 'tool', recovering: 'recovering', completed: 'completed', failed: 'failed', cancelled: 'failed', paused: 'paused', queued: 'thinking' };
        const wId = cw.taskId || `crew-${cw.role}`;
        workersById.set(wId, {
          workerId: wId, kind: 'crew', role: cw.role,
          prompt: `${cw.role} phase (${crewSummary.phase})`,
          status: statusMap[cw.status] || (cw.status === 'pending' ? 'queued' : cw.status),
          providerId: cw.providerId,
          modelLabel: providerLabel(cw.providerId) || (cw.role === 'verifier' ? 'Independent Checks' : 'Pending'),
          tool: lastTool, target: '', files: [...filesSet].slice(0, 12), tools: lastTool ? [lastTool] : [],
          streamTail: cw.summary || '', summary: cw.summary || '',
          calls: cw.calls || 0,
          startedAt: wTask?.createdAt || null,
          endedAt: wTask?.completedAt || null,
          durationMs: wTask?.createdAt ? ((wTask.completedAt ? Date.parse(wTask.completedAt) : Date.now()) - Date.parse(wTask.createdAt)) : 0
        });
      }
    }

    // Build Arena Race telemetry if answerRace configured or race events occurred
    let arena = null;
    if (task.answerRace || raceEvents.length) {
      const latestDispatch = [...raceEvents].reverse().find(e => e.type === 'race.dispatched' && e.data?.stage === 'draft');
      const raceId = latestDispatch?.data?.raceId || null;
      const relevantResults = raceEvents.filter(e => e.type === 'race.result' && (!raceId || e.data?.raceId === raceId));
      const latestScorecard = [...raceEvents].reverse().find(e => e.type === 'model.response' && e.data?.scorecard && (!raceId || e.data.scorecard.raceId === raceId))?.data?.scorecard || null;
      const contenderIds = latestDispatch?.data?.models || task.answerRace?.models || [];
      const judgeId = latestScorecard?.judgeId || task.answerRace?.judge || null;
      const contenders = contenderIds.map((pid, idx) => {
        const resEv = relevantResults.find(e => e.data?.stage === 'draft' && e.data?.providerId === pid);
        const grade = latestScorecard?.grades?.find(g => g.providerId === pid) || null;
        return {
          slot: ['A', 'B', 'C', 'D'][idx] || String(idx + 1),
          providerId: pid,
          label: providerLabel(pid) || pid,
          status: resEv ? (resEv.data.status === 'done' ? 'completed' : resEv.data.status) : (active.has(task.status) ? 'streaming' : 'queued'),
          durationMs: resEv?.data?.durationMs || grade?.durationMs || 0,
          grade,
          isWinner: Boolean(latestScorecard?.winnerId && latestScorecard.winnerId === pid)
        };
      });
      const judgeResult = relevantResults.find(e => e.data?.stage === 'grade');
      const judgeDispatched = raceEvents.some(e => e.type === 'race.dispatched' && e.data?.stage === 'grade' && (!raceId || e.data?.raceId === raceId));
      arena = {
        raceId,
        status: latestScorecard ? 'completed' : judgeDispatched ? 'grading' : (latestDispatch && active.has(task.status) ? 'drafting' : 'ready'),
        contenders,
        judge: judgeId ? {
          providerId: judgeId,
          label: providerLabel(judgeId) || judgeId,
          status: latestScorecard ? 'completed' : judgeResult ? judgeResult.data.status : (judgeDispatched ? 'grading' : 'waiting')
        } : null,
        winnerId: latestScorecard?.winnerId || null,
        note: latestScorecard?.note || null
      };
    }

    const workers = [...workersById.values()];
    const matrix = loadBenchmarkMatrix(this.getRouterSettings().customBenchmarks || {});
    let totalTokens = 0;
    let totalCostUsd = 0;
    for (const w of workers) {
      const prov = w.providerId ? (this.providers.get(w.providerId) || this.catalog?.get?.(w.providerId) || { id: w.providerId, model: w.providerId }) : null;
      const bench = prov ? matchBenchmarkEntry(prov, matrix) : null;
      const tel = estimateWorkerTelemetry({
        prompt: w.prompt || '',
        summary: w.summary || w.streamTail || '',
        calls: w.calls || 0,
        providerId: w.providerId || '',
        costIndex: bench?.costIndex ?? 70
      });
      w.approxTokens = tel.approxTokens;
      w.estimatedCostUsd = tel.estimatedCostUsd;
      w.isMvp = false;
      totalTokens += tel.approxTokens;
      totalCostUsd += tel.estimatedCostUsd;
    }

    const fileOwners = new Map();
    for (const w of workers) {
      for (const f of (w.files || [])) {
        if (!fileOwners.has(f)) fileOwners.set(f, []);
        fileOwners.get(f).push({ workerId: w.workerId, role: w.role });
      }
    }
    const fileConflicts = [...fileOwners.entries()]
      .filter(([, owners]) => owners.length > 1)
      .map(([file, owners]) => ({ file, owners }));

    // Surface Worktree Code Diff Race on the Conclave Stage if this task has a worktree build!
    let worktreeRace = null;
    try {
      const wtApi = this.worktrees;
      if (wtApi) {
        const wtId = task.codeWorkspace?.id || wtApi.list?.().find(p => p.chatId === taskId)?.id || null;
        if (wtId) {
          const proj = wtApi.get?.(wtId);
          if (proj?.candidates?.length) {
            const building = Boolean(wtApi.jobs?.get?.(wtId)?.building);
            const appliedId = proj.review?.applied || null;
            const candidates = proj.candidates.map((c, idx) => {
              let additions = 0;
              let deletions = 0;
              if (typeof c.patch === 'string' && c.patch) {
                let inHunk = false;
                for (const line of c.patch.split('\n')) {
                  if (line.startsWith('@@ ')) { inHunk = true; continue; }
                  if (line.startsWith('diff --git ') || line.startsWith('+++ ') || line.startsWith('--- ')) { inHunk = false; continue; }
                  if (!inHunk) continue;
                  if (line.startsWith('+')) additions += 1;
                  else if (line.startsWith('-')) deletions += 1;
                }
              }
              const status = appliedId === c.id ? 'applied' : c.patch ? 'ready' : c.error ? 'failed' : building ? 'building' : 'queued';
              return {
                slot: ['A', 'B', 'C', 'D'][idx] || String(idx + 1),
                id: c.id,
                providerId: c.providerId,
                label: c.provider || providerLabel(c.providerId) || c.providerId,
                status,
                elapsedMs: c.elapsedMs || 0,
                files: Array.isArray(c.paths) ? c.paths : [],
                additions,
                deletions,
                error: c.error || null
              };
            });
            worktreeRace = {
              worktreeId: proj.id,
              repository: proj.repository ? proj.repository.split('/').pop() : 'workspace',
              branch: proj.branch || '',
              objective: proj.review?.objective || '',
              building,
              appliedCandidateId: appliedId,
              lastCheck: proj.lastCheck ? {
                command: proj.lastCheck.command,
                exitCode: proj.lastCheck.exitCode,
                ok: proj.lastCheck.exitCode === 0 && !proj.lastCheck.timedOut && !proj.lastCheck.cancelled
              } : null,
              candidates
            };
          }
        }
      }
    } catch {}

    const mode = (arena && (arena.status === 'drafting' || arena.status === 'grading' || (workers.length === 0 && arena.status === 'completed')))
      ? 'arena'
      : crewSummary && ['preparing', 'running', 'verifying', 'ready', 'paused', 'applied'].includes(crewSummary.status)
        ? 'crew'
        : workers.length > 0
          ? 'swarm'
          : worktreeRace?.candidates?.length
            ? 'diff_race'
            : 'standby';

    const arenaContenders = arena?.contenders || [];
    const arenaActive = arenaContenders.filter(c => ['streaming', 'queued', 'drafting'].includes(c.status)).length + (arena?.judge?.status === 'grading' ? 1 : 0);
    const arenaDone = arenaContenders.filter(c => c.status === 'completed').length + (arena?.judge?.status === 'completed' ? 1 : 0);
    const diffActive = (worktreeRace?.candidates || []).filter(c => c.status === 'building' || c.status === 'queued').length;
    const diffDone = (worktreeRace?.candidates || []).filter(c => c.status === 'ready' || c.status === 'applied').length;
    const activeCount = mode === 'arena'
      ? arenaActive
      : mode === 'diff_race'
        ? diffActive
        : workers.filter(w => ['thinking', 'streaming', 'tool', 'recovering'].includes(w.status)).length;
    const completedCount = mode === 'arena'
      ? arenaDone
      : mode === 'diff_race'
        ? diffDone
        : workers.filter(w => w.status === 'completed').length;
    const failedCount = mode === 'arena'
      ? arenaContenders.filter(c => ['failed', 'declined'].includes(c.status)).length
      : mode === 'diff_race'
        ? (worktreeRace?.candidates || []).filter(c => c.status === 'failed').length
        : workers.filter(w => w.status === 'failed').length;

    // Crown ★ MVP on completed multi-worker swarms (highest signal + fastest delivery)
    if (workers.length >= 2 && activeCount === 0) {
      const doneWorkers = workers.filter(w => w.status === 'completed');
      if (doneWorkers.length >= 2) {
        const mvpScore = (w) => (w.files?.length || 0) * 16 + (w.tools?.length || 0) * 6 + Math.min(45, (w.summary || '').length / 24) - (w.durationMs || 0) / 1400;
        const best = [...doneWorkers].sort((a, b) => mvpScore(b) - mvpScore(a))[0];
        if (best) best.isMvp = true;
      }
    }

    return {
      taskId: task.id,
      title: task.title,
      status: task.status,
      mode,
      orchestrator: {
        providerId: task.providerId,
        modelLabel: providerLabel(task.providerId) || 'Orchestrator',
        status: task.status,
        calls: task.calls || 0,
        maxCalls: task.policy?.maxCalls || 250,
        recoveries: task.recoveries || 0
      },
      workers,
      crew: crewSummary,
      arena,
      worktreeRace,
      failovers: failovers.slice(-8),
      fileConflicts,
      pendingApproval: task.pendingApproval || null,
      stats: {
        totalWorkers: mode === 'arena'
          ? (arenaContenders.length + (arena?.judge ? 1 : 0))
          : mode === 'diff_race'
            ? (worktreeRace?.candidates?.length || 0)
            : workers.length,
        activeWorkers: activeCount,
        completedWorkers: completedCount,
        failedWorkers: failedCount,
        totalCalls: task.calls || 0,
        totalTokens,
        totalCostUsd: Number(totalCostUsd.toFixed(5))
      }
    };
  }
  selectedProvider(id, workspaceKind) {
    return this.providers.get(id) ?? (workspaceKind === 'conversation' ? this.catalog?.get(id) : undefined);
  }
  validateCatalogRoute(providerIds, workspaceKind) {
    if (!Array.isArray(providerIds) || !providerIds.some(isCatalogModel)) return;
    if (workspaceKind !== 'conversation' || providerIds.length > 2 || !providerIds.every(isCatalogModel) || new Set(providerIds).size !== providerIds.length)
      throw fault('INVALID_PROVIDER', 'Choose a Venice catalog model and optionally one distinct Venice outage backup for direct chat.');
  }
  async createTask(input = {}) {
    if (this.closed) throw fault('RUNTIME_CLOSED', 'Runtime is closed.');
    // Only the controller supplies these fields. HTTP task creators project
    // owner inputs explicitly; Store validates and registers membership in the
    // same transaction as insertion so a crash cannot orphan an unmarked child.
    let crewFields = {};
    if (input.crewMember !== undefined) {
      const member = input.crewMember, contract = input.crewContract;
      if (!member || typeof member !== 'object' || Array.isArray(member)
        || Object.keys(member).some(key => !['runId', 'parentId', 'role'].includes(key))
        || !['solver', 'challenger', 'verifier'].includes(member.role)
        || ['runId', 'parentId'].some(key => typeof member[key] !== 'string' || !member[key] || member[key].length > 100)
        || !contract || typeof contract !== 'object' || Array.isArray(contract)
        || Object.keys(contract).some(key => !['followups', 'contractVersion', 'checksContractVersion', 'originalAcceptance', 'crewEvidence'].includes(key)))
        throw fault('INVALID_CREW_MEMBER', 'Crew members require a controller-assigned role and complete parent contract.');
      const followups = contract.followups || [];
      if (!Number.isSafeInteger(contract.contractVersion) || contract.contractVersion < 1
        || !Number.isSafeInteger(contract.checksContractVersion) || contract.checksContractVersion < 1 || contract.checksContractVersion > contract.contractVersion
        || !Array.isArray(followups) || followups.some(followup => !followup || typeof followup !== 'object'
          || typeof followup.message !== 'string' || !followup.message.trim() || followup.message.length > messageCharLimit(followup.message, 12000)
          || !Number.isSafeInteger(followup.contractVersion) || followup.contractVersion < 2 || followup.contractVersion > contract.contractVersion))
        throw fault('INVALID_CREW_MEMBER', 'Crew contract versions and owner follow-ups must match the parent contract.');
      checkMessageLimit(followups);
      if (contract.crewEvidence !== undefined && Buffer.byteLength(JSON.stringify(contract.crewEvidence)) > 16 * 1024)
        throw fault('INVALID_CREW_MEMBER', 'Crew evidence exceeds its bounded context allocation.');
      crewFields = { crewMember: structuredClone(member), followups: structuredClone(followups), contractVersion: contract.contractVersion, checksContractVersion: contract.checksContractVersion,
        ...(Object.hasOwn(contract, 'originalAcceptance') ? { originalAcceptance: structuredClone(contract.originalAcceptance) } : {}),
        ...(contract.crewEvidence !== undefined ? { crewEvidence: structuredClone(contract.crewEvidence) } : {}) };
    } else if (input.crewContract !== undefined) throw fault('INVALID_CREW_MEMBER', 'Crew contracts require a registered worker.');
    if (typeof input.objective !== 'string' || !input.objective.trim() || input.objective.length > messageCharLimit(input.objective, 30000)) throw fault('INVALID_TASK', 'An objective of 1–30000 characters is required.');
    if (input.workspaceKind !== undefined && input.workspaceKind !== 'conversation') throw fault('INVALID_TASK', 'Unknown workspace kind.');
    const answerRace = validateAnswerRace(input.answerRace,this.catalog,input.workspaceKind,this.providers);
    const providerIds = input.providers || [...this.providers.keys()];
    this.validateCatalogRoute(providerIds, input.workspaceKind);
    if (!Array.isArray(providerIds) || !providerIds.length || providerIds.some(id => typeof id !== 'string' || !this.selectedProvider(id, input.workspaceKind))) throw fault('INVALID_PROVIDER', 'Select at least one configured provider.');
    for (const id of new Set([...providerIds, ...(answerRace?.models || [])])) parametersFor(this.selectedProvider(id, input.workspaceKind), input.generation);
    if (typeof input.workspace !== 'string') throw fault('INVALID_TASK', 'Workspace path is required.');
    const workspace = await fs.realpath(resolve(input.workspace));
    if (this.store.listTasks().some(task => task.workspace === workspace && !terminal.has(task.status))) throw fault('WORKSPACE_BUSY', 'Another unfinished task owns this workspace.');
    const constraints = input.constraints || [];
    if (!Array.isArray(constraints) || constraints.some(value => typeof value !== 'string') || JSON.stringify(constraints).length > 20000) throw fault('INVALID_TASK', 'Constraints must be a bounded string array.');
    const initial = await taskSnapshot(workspace);
    const permissionRules = input.permissionRules !== undefined ? validatePermissionRules(input.permissionRules) : null;
    const now = new Date().toISOString();
    const task = {
      id: randomUUID(), title: String(input.title || input.objective.slice(0, 70)), objective: input.objective,
      constraints, workspace, status: 'queued', providers: [...new Set(providerIds)], providerId: providerIds[0], providerIndex: 0,
      epoch: 0, step: 0, calls: 0, recoveries: 0, policy: normalizePolicy(input.policy), strategy: 'continue',
      fixtureId: input.fixtureId || null, scenario: input.scenario || null, acceptance: input.acceptance || null,
      ...(input.workspaceKind === 'conversation' ? { workspaceKind: 'conversation' } : {}),
      verification: null, completionKind: null, createdAt: now, updatedAt: now, version: 1, eventSeq: 0,
      initialSnapshot: initial, failures: {}, contractVersion: 1,
      execution: normalizeExecution(input.execution), checks: normalizeChecks(input.checks), checksContractVersion: 1, persona: normalizePersona(input.persona),
      effort: normalizeEffort(input.effort),
      ...(answerRace ? {answerRace} : {}),
      generation: modelParameters(input.generation),
      planMode: Boolean(input.planMode),
      todos: Array.isArray(input.todos) ? input.todos : [],
      pendingApproval: null,
      permissionRules,
      attachments: validateAttachments(input.attachments),
      recentToolCalls: [],
      ...(input.ultraplinian ? { ultraplinian: true } : {}),
      routing: { primaryId: providerIds[0], cooldowns: {}, primaryReturnUsed: false, contributions: {} },
      ...crewFields,
    };
    return this.store.createTask(task);
  }
  getTask(id) { return this.store.requireTask(id); }
  listTasks() { return this.store.listTasks().filter(task => !task.crewMember); }
  getEvents(id, after = 0) { return this.store.getEvents(id, after); }
  getRecentEvents(id, limit = 80) {
    const task = this.getTask(id);
    return task.historyExclusions?.length ? activeHistory(task, this.getEvents(id)).slice(-limit) : this.store.getRecentEvents(id, limit);
  }
  getOperations(id) { return this.store.getOperations(id); }
  async snapshotTask(id) { return taskSnapshot(this.getTask(id).workspace); }
  _memoriesForTask(task) {
    if (!task || task.fixtureId || task.crewMember) return [];
    try { return this.memory.relevantForTask(task, { limit: 6, maxChars: 1800 }); }
    catch { return []; }
  }
  _effectivePermissionRules(task) {
    if (Array.isArray(task.permissionRules)) return task.permissionRules;
    if (task.fixtureId || task.crewMember) return [];
    const globalRules = this.store.getLocalState('permissionRules', [...DEFAULT_SAFE_PRESET]);
    return Array.isArray(globalRules) ? globalRules : [...DEFAULT_SAFE_PRESET];
  }
  _checkDoomLoop(task, call) {
    if (call.name === 'check.run') return { triggered: false, sig: null };
    const sig = sha256(stableJson([call.name, call.args || {}]));
    const recent = Array.isArray(task.recentToolCalls) ? task.recentToolCalls : [];
    const triggered = recent.length >= 2 && recent[recent.length - 1]?.sig === sig && recent[recent.length - 2]?.sig === sig;
    return { triggered, sig };
  }
  _recordToolCallSig(taskId, call, sig, resetOnEdit = false) {
    this.store.updateTask(taskId, current => {
      if (resetOnEdit) {
        current.recentToolCalls = [];
      } else if (call.name !== 'check.run' && sig) {
        const next = Array.isArray(current.recentToolCalls) ? [...current.recentToolCalls] : [];
        next.push({ tool: call.name, sig });
        current.recentToolCalls = next.slice(-6);
      }
      return current;
    });
  }
  _recordInterceptedToolError(taskId, call, epoch, code, message) {
    const id = `${taskId}:${call.id}`;
    const argsHash = sha256(stableJson(call.args || {}));
    const result = { ok: false, error: { code, message } };
    const operation = {
      id, taskId, callId: call.id, name: call.name, args: call.args || {}, argsHash, epoch,
      status: 'failed', result, createdAt: new Date().toISOString(), finishedAt: new Date().toISOString()
    };
    this.store.putOperation(operation, 'tool.completed', { operationId: id, name: call.name, status: 'failed', result });
    this._emitStream(taskId, { type: 'tool.completed', name: call.name, callId: call.id, ok: false, errorCode: code });
    return result;
  }
  async contextForTask(id) {
    const task = this.getTask(id), snapshot = await taskSnapshot(task.workspace);
    const provider = this.selectedProvider(task.providerId, task.workspaceKind);
    return buildContext({ task, provider, history: this.getRecentEvents(id), totalHistoryCount: task.eventSeq, files: snapshot.files, snapshotHash: snapshot.snapshotHash, learning: this.getLearning(), memories: this._memoriesForTask(task), transparency: task.fixtureId ? null : this.getTransparencyConfig() });
  }
  getLearning() { return this.store.getLearning(); }
  resetLearning() { return this.store.resetLearning(); }
  run(id) {
    if (this.closed) return Promise.reject(fault('RUNTIME_CLOSED', 'Runtime is closed.'));
    try { this.crew.assertIdle(id); } catch (cause) { return Promise.reject(cause); }
    if (this.sourceChanges.busy(id)) return Promise.reject(fault('SOURCE_BUSY', 'Source changes are still settling.'));
    if (this.runs.has(id)) return this.runs.get(id).promise;
    if (this.broker.locks.has(id)) return Promise.reject(fault('RUN_DRAINING', 'Workspace work is still settling.'));
    const task = this.getTask(id);
    if (task.status !== 'queued') return Promise.resolve(task);
    const controller = new AbortController();
    const entry = { controller, promise: null };
    this.runs.set(id, entry);
    entry.promise = (async () => {
      let result;
      do {
        result = await this._run(id, controller);
        if (controller.signal.aborted || !turnFinished(result) || !result.deferredMessages?.length) break;
        const snapshot = await taskSnapshot(result.workspace);
        const current = this.getTask(id);
        if (controller.signal.aborted || !turnFinished(current)) break;
        const [message, ...rest] = current.deferredMessages || [];
        if (!message) break;
        const followup = { ...message, appliedAt: new Date().toISOString(), contractVersion: current.contractVersion + 1 };
        const proposed = { ...withFollowups(current, [...(current.followups || []), followup]), deferredMessages: rest, status: 'queued' };
        const deferredProvider = this.selectedProvider(proposed.providerId, proposed.workspaceKind);
        buildContext({ task: proposed, provider: deferredProvider, history: this.getRecentEvents(id), totalHistoryCount: current.eventSeq + 2, files: snapshot.files, snapshotHash: snapshot.snapshotHash, learning: this.getLearning(), memories: this._memoriesForTask(proposed), transparency: current.fixtureId ? null : this.getTransparencyConfig() });
        this.store.updateTask(id, () => proposed, 'user.messages.applied', { ids: [message.id], contractVersion: proposed.contractVersion, source: 'owner' });
      } while (!controller.signal.aborted);
      return this.getTask(id);
    })().catch(cause => {
      const current = this.getTask(id);
      if (active.has(current.status) || (current.status === 'completed' && current.deferredMessages?.length)) return this.store.updateTask(id, value => { value.status = 'failed'; value.blocker = { code: cause.code || 'RUNTIME_ERROR', message: cause.message }; return value; }, 'task.status', { status: 'failed', error: cause.message });
      return current;
    }).finally(() => { if (this.runs.get(id) === entry) this.runs.delete(id); });
    return entry.promise;
  }
  async _run(id, controller) {
    let task = this.store.updateTask(id, current => { current.status = 'running'; current.epoch += 1; current.blocker = null; return current; }, 'task.status', { status: 'running' });
    const epoch = task.epoch;
    if (isCatalogModel(task.providerId) || task.answerRace) await this.catalog?.list();
    const unknown = await this.broker.reconcileTask(id);
    if (unknown.length) return this._status(id, epoch, 'blocked', { code: 'OUTCOME_UNKNOWN', message: 'Inspect unresolved operation effects before continuing.' });
    while (this._current(id, epoch, controller.signal)) {
      task = this.getTask(id);
      if (task.calls >= task.policy.maxCalls) return this._status(id, epoch, 'paused_budget', { code: 'CALL_BUDGET', message: 'Call budget exhausted; update policy to resume.' });
      let provider = this.selectedProvider(task.providerId, task.workspaceKind);
      if (!provider && !task.answerRace) return this._status(id, epoch, 'blocked', { code: 'PROVIDER_UNAVAILABLE', message: 'The configured provider is no longer available.' });
      if (!await this._waitForRetry(id, epoch, controller.signal)) break;
      const snapshot = await taskSnapshot(task.workspace);
      if (!this._current(id, epoch, controller.signal)) break;
      try { this._applyPending(id, snapshot); }
      catch (cause) { return this._status(id, epoch, 'blocked', { code: cause.code || 'MESSAGE_ERROR', message: `${cause.message} Queued messages are retained; remove them or resolve the blocker, then resume.` }); }
      task = this.getTask(id);
      if (task.answerRace) {
        await runAnswerRace(this,task,epoch,controller.signal);
        continue;
      }
      provider = this.selectedProvider(task.providerId, task.workspaceKind);
      const profile = requestProfile(task, provider);
      let context;
      const buildTurnContext = currentTask => buildContext({
        task: { ...currentTask, calls: currentTask.calls + 1 },
        provider,
        history: this.getRecentEvents(id),
        totalHistoryCount: currentTask.eventSeq,
        files: snapshot.files,
        snapshotHash: snapshot.snapshotHash,
        learning: this.getLearning(),
        memories: this._memoriesForTask(currentTask),
        transparency: currentTask.fixtureId ? null : this.getTransparencyConfig()
      });
      try { context = buildTurnContext(task); }
      catch (cause) {
        if (cause.code === 'CONTEXT_LIMIT' && !task.fixtureId) {
          // Emergency hybrid compaction before giving up on a huge long-horizon task
          const emergencyTask = await this._compactHybrid(id, task, snapshot, 'context_limit_recovery', {
            signal: controller.signal,
            utilizationBeforePct: 100,
            allowSemantic: false,
            provider,
          });
          if (emergencyTask && this._current(id, epoch, controller.signal)) {
            task = emergencyTask;
            try {
              context = buildTurnContext(task);
              this.store.appendEvent(id, 'task.compacted', {
                reason: 'context_limit_recovery',
                calls: task.calls,
                utilizationBeforePct: 100,
                utilizationAfterPct: context.manifest.utilizationPct,
                compactedBeforeSeq: task.workingSummary?.compactedBeforeSeq || 0,
                foldedEvents: task.workingSummary?.foldedEventCount || 0,
                semanticDistilled: false,
                modifiedFiles: task.workingSummary?.modifiedFiles?.length || 0,
                failingChecks: task.workingSummary?.latestFailingChecks?.length || 0,
                source: 'controller',
              });
            } catch (retryCause) {
              if (retryCause.code === 'CONTEXT_LIMIT') return this._status(id, epoch, 'blocked', { code: retryCause.code, message: retryCause.message });
              throw retryCause;
            }
          } else {
            return this._status(id, epoch, 'blocked', { code: cause.code, message: cause.message });
          }
        } else if (cause.code === 'CONTEXT_LIMIT') {
          return this._status(id, epoch, 'blocked', { code: cause.code, message: cause.message });
        } else {
          throw cause;
        }
      }
      // Dynamic threshold auto-compaction (~75% of the active model's budget) with hybrid semantic distillation + watermark folding.
      if (!task.fixtureId && context.manifest.utilizationPct >= Math.round(AUTO_COMPACT_UTILIZATION_THRESHOLD * 100)) {
        const recentAll = this.getRecentEvents(id, 160);
        const prevWatermark = task.workingSummary?.compactedBeforeSeq || 0;
        const freshSinceWatermark = recentAll.filter(e => Number.isInteger(e.seq) && e.seq > prevWatermark && !['user.message.queued', 'user.message.removed', 'task.compacted'].includes(e.type));
        if (freshSinceWatermark.length >= COMPACTION_KEEP_TAIL_EVENTS + 4) {
          const beforePct = context.manifest.utilizationPct;
          const compactedTask = await this._compactHybrid(id, task, snapshot, 'context_pressure', {
            signal: controller.signal,
            utilizationBeforePct: beforePct,
            allowSemantic: true,
            provider,
          });
          if (compactedTask && this._current(id, epoch, controller.signal)) {
            task = compactedTask;
            try {
              context = buildTurnContext(task);
              this.store.appendEvent(id, 'task.compacted', {
                reason: 'context_pressure',
                calls: task.calls,
                utilizationBeforePct: beforePct,
                utilizationAfterPct: context.manifest.utilizationPct,
                compactedBeforeSeq: task.workingSummary?.compactedBeforeSeq || 0,
                foldedEvents: task.workingSummary?.foldedEventCount || 0,
                semanticDistilled: Boolean(task.workingSummary?.semantic),
                modifiedFiles: task.workingSummary?.modifiedFiles?.length || 0,
                failingChecks: task.workingSummary?.latestFailingChecks?.length || 0,
                source: 'controller',
              });
            } catch (cause) {
              if (cause.code === 'CONTEXT_LIMIT') return this._status(id, epoch, 'blocked', { code: cause.code, message: cause.message });
              throw cause;
            }
          }
        }
      }
      const requestEvent = { providerId: task.providerId, call: task.calls + 1, strategy: task.strategy, ...(profile ? { requestProfile: profile } : {}), epoch, snapshotHash: snapshot.snapshotHash, contextBytes: context.manifest.bytes, omittedEvents: context.manifest.omittedEventCount, omittedFiles: context.manifest.omittedFiles.map(file => file.path) };
      try { task = this.crew.reserveCall(id, epoch, requestEvent) || this.store.updateTask(id, current => {
        if (current.epoch !== epoch || !active.has(current.status)) throw fault('STALE_RUN', 'Run lost ownership before request reservation.');
        if (current.calls >= current.policy.maxCalls) throw fault('CALL_BUDGET', 'No call allocation available.');
        current.calls += 1; current.status = 'running'; current.lastSnapshotHash = snapshot.snapshotHash;
        if (current.routing) delete current.routing.pendingRetry;
        return current;
      }, 'model.request', current => ({ ...requestEvent, providerId: current.providerId, call: current.calls, strategy: current.strategy })); }
      catch (cause) {
        if (cause.code === 'CREW_BUDGET' || cause.code === 'CALL_BUDGET') return this._status(id, epoch, 'paused_budget', { code: cause.code, message: cause.message });
        throw cause;
      }
      // Closed-loop visual observation: when the previous turn captured a browser.screenshot,
      // attach the live PNG in memory (never bloated into SQLite) so vision-capable models like Gemini 4 Neon see it directly.
      const lastReqIdx = (context.history || []).findLastIndex(e => e.type === 'model.request');
      const sinceLastReq = lastReqIdx >= 0 ? context.history.slice(lastReqIdx + 1) : (context.history || []);
      const tookBrowserShot = sinceLastReq.some(e => e.type === 'tool.completed' && e.data?.name === 'browser.screenshot' && e.data?.status !== 'failed');
      if (tookBrowserShot && typeof this.broker?.browser?.getLatestScreenshot === 'function') {
        const shot = this.broker.browser.getLatestScreenshot(id);
        if (shot?.buffer && shot.buffer.byteLength > 0 && shot.buffer.byteLength <= 2 * 1024 * 1024) {
          const mediaType = shot.mimeType || 'image/png';
          context.visualObservations = [{ dataUrl: `data:${mediaType};base64,${shot.buffer.toString('base64')}`, mediaType }];
        }
      }
      let response;
      this._emitStream(id, { type: 'turn_start', providerId: task.providerId, call: task.calls });
      const onDelta = delta => {
        if (!delta || typeof delta !== 'object') return;
        if (delta.type === 'thinking' && typeof delta.text === 'string' && delta.text) {
          this._emitStream(id, { type: 'thinking', text: delta.text, providerId: task.providerId, call: task.calls });
        } else if (delta.type === 'text' && typeof delta.text === 'string' && delta.text) {
          this._emitStream(id, { type: 'text', text: delta.text, providerId: task.providerId, call: task.calls });
        } else {
          this._emitStream(id, { ...delta, providerId: task.providerId, call: task.calls });
        }
      };
      const turnTimeoutMs = effectiveTurnTimeoutMs(task);
      const turnDeadline = Date.now() + turnTimeoutMs;
      const turnStartedAt = performance.now();
      let turnError;
      const started = performance.now();
      for (let attempt = 0; attempt < 3; attempt++) {
        turnError = null;
        const remainingMs = Math.max(1, turnDeadline - Date.now());
        try { response = await this._turn(provider, context, controller.signal, remainingMs, profile, onDelta); break; }
        catch (cause) {
          turnError = cause;
          if (!this._current(id, epoch, controller.signal)) break;
          if (cause.code === 'PROVIDER_TIMEOUT') break;
          const errCode = cause.code || cause.cause?.code || '';
          const isTimeout = cause.name === 'TimeoutError' || /TIMEOUT|ETIMEDOUT/i.test(errCode);
          const isTransient = isTimeout || /ECONN|ENET|EAI_|FETCH/i.test(errCode) || (cause.name === 'TypeError' && /fetch failed/i.test(cause.message || ''));
          const leftMs = turnDeadline - Date.now();
          if (provider.directChat || !isTransient || attempt >= 2 || leftMs <= 15) break;
          const backoffMs = Math.min(1000 * (attempt + 1), Math.max(1, leftMs - 10));
          this.store.appendEvent(id, 'provider.retry', { attempt: attempt + 1, code: cause.code || cause.name, providerId: task.providerId });
          await delay(backoffMs, undefined, { signal: controller.signal }).catch(() => {});
          if (!this._current(id, epoch, controller.signal)) break;
        }
      }
      const turnDurationMs = Math.max(0, Math.round(performance.now() - turnStartedAt));
      const receipt = provider.directChat ? { call: task.calls, epoch, durationMs: Math.round(performance.now() - started) } : {};
      if (!this._current(id, epoch, controller.signal)) {
        if (provider.directChat) this.store.appendEvent(id, 'model.interrupted', {
          ...receipt, providerId: task.providerId, reason: this.getTask(id).status,
        });
        break;
      }
      if (turnError && provider.directChat) {
        const timeout = turnError.name === 'TimeoutError' || turnError.code === 'PROVIDER_TIMEOUT';
        response = { type: 'error', code: timeout ? 'PROVIDER_TIMEOUT' : 'PROVIDER_ERROR',
          message: timeout ? 'The Venice request timed out.' : 'The Venice connection ended before a complete response arrived.' };
      } else if (turnError) {
        await this._recover(id, epoch, { code: turnError.name === 'TimeoutError' ? 'PROVIDER_TIMEOUT' : turnError.code || 'PROVIDER_ERROR', message: turnError.message, kind: 'provider_error', retryable: turnError.retryable, durationMs: turnDurationMs }, controller.signal);
        continue;
      }
      const superseded = Boolean(this.getTask(id).pendingMessages?.length);
      // Auto-keep-it-rolling: seamlessly continue truncated replies across ALL providers (Venice catalog + OpenAI/Anthropic/OpenRouter/Gemini/Nous/Ollama) with live streaming!
      const baseContHops = Number.isInteger(task.policy.maxContinuations) ? task.policy.maxContinuations : 6;
      const taskEffortNow = normalizeEffort(task.effort);
      const maxContHops = baseContHops > 0
        ? Math.min(12, Math.max(baseContHops, taskEffortNow === 'max' ? 12 : taskEffortNow === 'high' ? 8 : baseContHops))
        : 0;
      const continuationFn = typeof provider.continueChat === 'function'
        ? provider.continueChat.bind(provider)
        : typeof provider.continueTurn === 'function'
          ? provider.continueTurn.bind(provider)
          : null;
      if (!superseded && response?.type === 'message' && response.finish === 'length'
        && typeof response.text === 'string' && response.text.trim()
        && task.policy.autoContinue !== false && maxContHops > 0 && continuationFn) {
        let stitched = response.text;
        let contFinish = 'length';
        let hops = 0;
        while (contFinish === 'length' && hops < maxContHops && this._current(id, epoch, controller.signal) && !this.getTask(id).pendingMessages?.length) {
          const cur = this.getTask(id);
          if (cur.calls >= cur.policy.maxCalls) break;
          const nextHop = hops + 1;
          const contEvent = {
            providerId: task.providerId, hop: nextHop, maxContinuations: maxContHops, totalChars: stitched.length,
            snapshotHash: snapshot.snapshotHash,
            reason: `Reached output limit; auto-continuing seamlessly (part ${nextHop + 1}/${maxContHops + 1}).`
          };
          if (cur.crewMember) {
            try {
              this.crew.reserveCall(id, epoch, { ...contEvent, type: 'routing.auto_continued' });
            } catch (err) {
              if (['CREW_BUDGET', 'CREW_DEADLINE', 'STALE_RUN', 'CALL_BUDGET'].includes(err?.code)) break;
              throw err;
            }
          } else {
            this.store.updateTask(id, c => { c.calls += 1; return c; }, 'routing.auto_continued', contEvent);
          }
          hops = nextHop;
          let contRes;
          const runContHop = () => continuationFn(context, stitched, AbortSignal.any([controller.signal, AbortSignal.timeout(turnTimeoutMs)]), { ...this.outboundOptions(), requestProfile: profile, turnTimeoutMs, onDelta });
          try { contRes = await runContHop(); }
          catch {
            if (!this._current(id, epoch, controller.signal)) break;
            await delay(1500, undefined, { signal: controller.signal }).catch(() => {});
            if (!this._current(id, epoch, controller.signal)) break;
            try { contRes = await runContHop(); } catch { break; }
          }
          if (contRes?.type === 'error' && (contRes.code === 'VENICE_RATE_LIMIT' || contRes.code === 'rate_limit' || contRes.retryable)
            && this._current(id, epoch, controller.signal)) {
            const waitMs = Number.isFinite(contRes.retryAfterMs) && contRes.retryAfterMs > 0
              ? Math.min(contRes.retryAfterMs, 15000)
              : 2000;
            if (!Number.isFinite(contRes.retryAfterMs) || contRes.retryAfterMs <= 15000) {
              await delay(waitMs, undefined, { signal: controller.signal }).catch(() => {});
              if (!this._current(id, epoch, controller.signal)) break;
              try { contRes = await runContHop(); } catch { break; }
            }
          }
          if (!this._current(id, epoch, controller.signal)) break;
          if (!contRes || contRes.type !== 'message' || contRes.finish === 'refusal' || typeof contRes.text !== 'string' || !contRes.text.trim()) {
            if (contRes?.finish === 'done') contFinish = 'done';
            break;
          }
          stitched = stitchContinuation(stitched, contRes.text);
          contFinish = contRes.finish || 'done';
          if (contFinish !== 'length') break;
        }
        if (!this._current(id, epoch, controller.signal)) {
          this.store.appendEvent(id, 'model.interrupted', { ...receipt, providerId: task.providerId, reason: this.getTask(id).status });
          break;
        }
        response = { ...response, text: stitched, finish: contFinish, ...(hops > 0 ? { continuations: hops } : {}) };
      }
      // Save the deadline with the receipt, even if newer owner input supersedes this response.
      const retryAt = provider.directChat && Number.isFinite(response?.retryAfterMs)
        ? Math.max(task.providerNotBefore?.[catalogWaitKey] || 0, Math.min(Number.MAX_SAFE_INTEGER, Date.now() + response.retryAfterMs))
        : undefined;
      task = this.store.updateTask(id, current => {
        current.step += 1;
        current.routing ||= {}; current.routing.lastTurnDurationMs = turnDurationMs;
        if (retryAt !== undefined) {
          current.providerNotBefore ||= {};
          current.providerNotBefore[catalogWaitKey] = retryAt;
        }
        return current;
      }, 'model.response', { durationMs: turnDurationMs, ...receipt, providerId: task.providerId, response, ...(retryAt !== undefined ? { retryAt } : {}),
        ...(superseded ? { superseded: true, reason: 'New owner instructions arrived before this response was dispatched.' } : {}) });
      if (superseded && (response?.type !== 'error' || provider.directChat)) continue;
      if (!response || !['tool', 'message', 'error'].includes(response.type)) {
        await this._recover(id, epoch, { code: 'INVALID_RESPONSE', message: 'Provider returned an unsupported response.' }); continue;
      }
      if (response.type === 'error') {
        await this._recover(id, epoch, { code: response.code || 'PROVIDER_ERROR', message: response.message || 'Provider error.',
          retryable: response.retryable, retryAfterMs: response.retryAfterMs, ...(response.exhaustedReasoning ? { exhaustedReasoning: true } : {}), ...(retryAt !== undefined ? { retryAt } : {}) });
        continue;
      }
      if (response.type === 'message' && response.finish === 'length') return this._status(id, epoch, 'waiting_input', {
        code: provider.directChat ? 'VENICE_OUTPUT_LIMIT' : 'OUTPUT_LIMIT',
        message: provider.directChat
          ? 'Venice reached its output limit. The partial reply is saved — send "continue" to keep generating.'
          : 'Provider reached its output limit after auto-continuations. The partial reply is saved — send "continue" to keep generating.',
      });
      if (response.type === 'message' && !provider.directChat && response.finish !== 'refusal' && task.crewMember?.role !== 'challenger' && !task.planMode && !conversationWithoutChecks(task)) {
        const extracted = extractFileWrites(response.text || '');
        if (extracted.length > 0) {
          response = { ...response, type: 'tool', calls: extracted.map((file, i) => ({
            id: `synth_${task.calls}_${i}`, name: 'repo.write', args: { path: file.path, content: file.content }
          })) };
          this.store.appendEvent(id, 'text.extracted', { count: extracted.length, paths: extracted.map(f => f.path) });
        }
      }
      if (response.type === 'tool') {
        if (!Array.isArray(response.calls) || response.calls.length < 1 || response.calls.length > 32) { await this._recover(id, epoch, { code: 'INVALID_TOOL', message: 'Expected 1–32 complete tool calls.' }); continue; }
        let failure;
        let writes = false;
        let deniedInTurn = false;
        const observedHashes = new Map(snapshot.files.map(file => [file.path, file.sha256]));
        const streamArgsFor = call => call.name === 'repo.read' || call.name === 'repo.write' || call.name === 'repo.patch' || call.name === 'repo.delete' ? { path: call.args?.path }
          : call.name === 'repo.move' ? { from: call.args?.from, to: call.args?.to }
            : call.name === 'repo.glob' ? { pattern: call.args?.pattern }
              : call.name === 'process.run' ? { command: String(call.args?.command || '').slice(0, 200) }
                : call.name === 'repo.search' ? { query: call.args?.query }
                  : call.name === 'git.commit' ? { message: String(call.args?.message || '').slice(0, 120) }
                    : call.name === 'task.todo' ? { count: Array.isArray(call.args?.items) ? call.args.items.length : 0 }
                      : call.name === 'memory.save' ? { title: String(call.args?.title || '').slice(0, 120), scope: call.args?.scope || 'global' }
                        : call.name === 'memory.search' ? { query: String(call.args?.query || '').slice(0, 120) }
                          : call.name === 'memory.delete' ? { id: String(call.args?.id || '').slice(0, 120) }
                            : call.name === 'browser.open' ? { url: String(call.args?.url || '').slice(0, 160) }
                              : call.name === 'browser.act' ? { action: String(call.args?.action || ''), ref: call.args?.ref || undefined }
                                : call.name === 'web.search' ? { query: String(call.args?.query || '').slice(0, 120) } : {};
        const trackResult = (call, result) => {
          if (['repo.write', 'repo.patch', 'repo.delete', 'repo.move', 'process.run'].includes(call.name) && result?.ok) writes = true;
          if (!result?.ok) return;
          if (call.name === 'repo.delete' && typeof result.path === 'string') observedHashes.delete(result.path);
          else if (call.name === 'repo.move' && typeof result.from === 'string' && typeof result.to === 'string' && typeof result.sha256 === 'string') {
            observedHashes.delete(result.from);
            observedHashes.set(result.to, result.sha256);
          } else if (typeof result.path === 'string' && typeof result.sha256 === 'string') observedHashes.set(result.path, result.sha256);
        };
        for (let idx = 0; idx < response.calls.length;) {
          if (!this._current(id, epoch, controller.signal)) break;
          if (this.getTask(id).pendingMessages?.length) {
            this.store.appendEvent(id, 'tools.superseded', { reason: 'Queued owner instructions supersede the remaining undispatched tools.', skippedCallIds: response.calls.slice(idx).map(value => value.id) });
            break;
          }
          // Dispatch contiguous read-only calls concurrently in one broker batch
          // only when all calls are permitted and none would trip the doom-loop guard.
          let runEnd = idx;
          while (runEnd < response.calls.length && READ_ONLY_TOOLS.has(response.calls[runEnd]?.name)) runEnd += 1;
          const liveTask = this.getTask(id);
          const effectiveRules = this._effectivePermissionRules(liveTask);
          let canBatch = runEnd - idx >= 2;
          if (canBatch) {
            const hooks = await discoverHooks(liveTask);
            if (hooks.PreToolUse.length || hooks.PostToolUse.length) canBatch = false;
          }
          if (canBatch) {
            const batch = response.calls.slice(idx, runEnd);
            const simRecent = Array.isArray(liveTask.recentToolCalls) ? [...liveTask.recentToolCalls] : [];
            for (const c of batch) {
              if (evaluatePermission(effectiveRules, c.name, c.args).action !== 'allow') { canBatch = false; break; }
              const sig = sha256(stableJson([c.name, c.args || {}]));
              if (simRecent.length >= 2 && simRecent[simRecent.length - 1]?.sig === sig && simRecent[simRecent.length - 2]?.sig === sig) {
                canBatch = false; break;
              }
              simRecent.push({ tool: c.name, sig });
            }
          }
          if (canBatch) {
            const batch = response.calls.slice(idx, runEnd);
            try {
              for (const call of batch) this._emitStream(id, { type: 'tool.start', name: call.name, callId: call.id, args: streamArgsFor(call) });
              const results = await this.broker.executeReadBatch(id, batch, { epoch, signal: controller.signal, outbound: this.outboundOptions() });
              for (let j = 0; j < batch.length; j++) {
                const call = batch[j], result = results[j];
                this._emitStream(id, { type: 'tool.completed', name: call.name, callId: call.id, ok: result?.ok ?? false, path: result?.path });
                this._recordToolCallSig(id, call, sha256(stableJson([call.name, call.args || {}])), false);
                if (result?.ok === false && !failure) failure = result.error;
                else trackResult(call, result);
              }
              if (failure) break;
            } catch (cause) {
              if (!this._current(id, epoch, controller.signal)) break;
              failure = { code: cause.code || 'TOOL_ERROR', message: cause.message };
              if (this.getOperations(id).some(operation => operation.status === 'outcome_unknown')) {
                return this._status(id, epoch, 'blocked', { code: 'OUTCOME_UNKNOWN', message: cause.message });
              }
              break;
            }
            idx = runEnd;
            continue;
          }
          // Dispatch contiguous agent.spawn calls concurrently (up to 4 in parallel) for true multi-agent swarm fan-out!
          let spawnEnd = idx;
          while (spawnEnd < response.calls.length && spawnEnd - idx < 4 && response.calls[spawnEnd]?.name === 'agent.spawn') spawnEnd += 1;
          let canSpawnBatch = spawnEnd - idx >= 2;
          if (canSpawnBatch) {
            const hooks = await discoverHooks(liveTask);
            if (hooks.PreToolUse.length || hooks.PostToolUse.length) canSpawnBatch = false;
          }
          if (canSpawnBatch) {
            const spawnBatch = response.calls.slice(idx, spawnEnd);
            for (const c of spawnBatch) {
              if (evaluatePermission(effectiveRules, c.name, c.args).action !== 'allow') { canSpawnBatch = false; break; }
            }
            if (canSpawnBatch) {
              try {
                for (const call of spawnBatch) this._emitStream(id, { type: 'tool.start', name: call.name, callId: call.id, args: streamArgsFor(call) });
                const results = await Promise.all(spawnBatch.map(call => this._executeAgentSpawn(id, epoch, call, controller.signal)));
                for (let j = 0; j < spawnBatch.length; j++) {
                  const call = spawnBatch[j], result = results[j];
                  this._emitStream(id, { type: 'tool.completed', name: call.name, callId: call.id, ok: result?.ok ?? false });
                  this._recordToolCallSig(id, call, sha256(stableJson([call.name, call.args || {}])), false);
                  if (result?.ok === false && !failure) failure = result.error;
                  else trackResult(call, result);
                }
                if (failure) break;
              } catch (cause) {
                if (!this._current(id, epoch, controller.signal)) break;
                failure = { code: cause.code || 'TOOL_ERROR', message: cause.message };
                break;
              }
              idx = spawnEnd;
              continue;
            }
          }
          const call = response.calls[idx++];
          const permTask = this.getTask(id);
          const permRules = this._effectivePermissionRules(permTask);
          const perm = evaluatePermission(permRules, call.name, call.args);
          let effectiveAction = perm.action;
          let effectiveReason = perm.reason || perm.rule?.reason || null;
          if (effectiveAction === 'auto') {
            const approvedOnce = permTask.approvedOnceCall
              && permTask.approvedOnceCall.tool === call.name
              && permTask.approvedOnceCall.argsHash === sha256(stableJson(call.args || {}));
            if (approvedOnce) {
              this.store.updateTask(id, current => { current.approvedOnceCall = null; return current; });
              effectiveAction = 'allow';
            } else {
              const overseer = this._resolveOverseer();
              if (!overseer) {
                effectiveAction = 'ask';
                effectiveReason = 'Auto mode: enable an Overseer model in Settings → Models for AI risk judging, or confirm manually.';
              } else {
                const verdict = await judgePermissionRisk({
                  provider: overseer.provider,
                  backupProviders: overseer.backupProviders,
                  toolName: call.name,
                  args: call.args || {},
                  target: perm.target,
                  objective: permTask.objective,
                  ...this.outboundOptions(),
                  signal: controller.signal
                });
                if (!this._current(id, epoch, controller.signal)) break;
                effectiveAction = verdict.decision;
                effectiveReason = verdict.reason || effectiveReason;
                if (verdict.decision === 'allow') {
                  this.store.appendEvent(id, 'permission.auto_approved', {
                    callId: call.id, tool: call.name, target: perm.target,
                    overseerProviderId: verdict.providerId, reason: effectiveReason
                  });
                }
              }
            }
          }
          if (effectiveAction === 'deny') {
            const denyMessage = effectiveReason || `Tool ${call.name} is denied by permission rule.`;
            this.store.appendEvent(id, 'permission.denied', { callId: call.id, tool: call.name, target: perm.target, rule: perm.rule, reason: denyMessage });
            this._emitStream(id, { type: 'permission.denied', callId: call.id, tool: call.name, target: perm.target, reason: denyMessage });
            this._recordInterceptedToolError(id, call, epoch, 'PERMISSION_DENIED', denyMessage);
            this._recordToolCallSig(id, call, sha256(stableJson([call.name, call.args || {}])), false);
            deniedInTurn = true;
            break;
          }
          if (effectiveAction === 'ask') {
            const approvedOnce = permTask.approvedOnceCall
              && permTask.approvedOnceCall.tool === call.name
              && permTask.approvedOnceCall.argsHash === sha256(stableJson(call.args || {}));
            if (approvedOnce) {
              this.store.updateTask(id, current => { current.approvedOnceCall = null; return current; });
            } else {
              const approval = {
                id: randomUUID(),
                callId: call.id,
                tool: call.name,
                args: call.args || {},
                target: perm.target,
                rule: perm.rule,
                reason: effectiveReason,
                suggestedPattern: derivePatternRule(call.name, call.args || {}),
                risk: assessToolRisk(call.name, call.args || {}),
                createdAt: new Date().toISOString()
              };
              const paused = this.store.updateTask(id, current => {
                current.status = 'paused';
                current.epoch += 1;
                current.pendingApproval = approval;
                current.blocker = {
                  code: 'APPROVAL_REQUIRED',
                  message: `Approval required for ${call.name}${perm.target ? `: ${perm.target.slice(0, 120)}` : ''}`
                };
                return current;
              }, 'permission.requested', approval);
              this._emitStream(id, { type: 'permission.requested', approval });
              return paused;
            }
          }
          const doom = this._checkDoomLoop(this.getTask(id), call);
          if (doom.triggered) {
            const doomMsg = 'Identical tool call repeated 3 times with no progress. Change strategy, read different files, or summarize what is blocked.';
            this.store.appendEvent(id, 'runtime.doom_loop', { callId: call.id, tool: call.name, args: call.args || {}, consecutive: 3 });
            this._emitStream(id, { type: 'runtime.doom_loop', callId: call.id, tool: call.name });
            this._recordInterceptedToolError(id, call, epoch, 'DOOM_LOOP_DETECTED', doomMsg);
            this.store.updateTask(id, current => { current.recentToolCalls = []; return current; });
            failure = { code: 'DOOM_LOOP_DETECTED', message: doomMsg };
            break;
          }
          try {
            const preHook = await runLifecycleHooks('PreToolUse', this.getTask(id), call.name, call.args || {}, { signal: controller.signal });
            if (preHook.blocked) {
              const hookMsg = preHook.reason || `PreToolUse hook blocked ${call.name}.`;
              this.store.appendEvent(id, 'hook.blocked', { callId: call.id, tool: call.name, reason: hookMsg, results: preHook.results });
              this._emitStream(id, { type: 'hook.blocked', callId: call.id, tool: call.name, reason: hookMsg });
              this._recordInterceptedToolError(id, call, epoch, 'HOOK_BLOCKED', hookMsg);
              deniedInTurn = true;
              break;
            }
            this._emitStream(id, { type: 'tool.start', name: call.name, callId: call.id, args: streamArgsFor(call) });
            let result;
            if (call.name === 'agent.spawn') {
              result = await this._executeAgentSpawn(id, epoch, call, controller.signal);
            } else {
              const onOutput = call.name === 'process.run'
                ? (stream, text) => this._emitStream(id, { type: 'command.chunk', callId: call.id, command: String(call.args?.command || '').slice(0, 200), stream, text })
                : undefined;
              result = await this.broker.execute(id, call, { epoch, signal: controller.signal, expectedHash: call.name === 'repo.write' ? (observedHashes.get(call.args?.path) ?? null) : undefined, onOutput, outbound: this.outboundOptions() });
            }
            this._emitStream(id, { type: 'tool.completed', name: call.name, callId: call.id, ok: result?.ok ?? false, path: result?.path });
            const mutatingEditOk = result?.ok === true && ['repo.write', 'repo.patch', 'repo.delete', 'repo.move'].includes(call.name);
            this._recordToolCallSig(id, call, doom.sig, mutatingEditOk);
            if (result?.ok === false) { failure = result.error; break; }
            trackResult(call, result);
            const postHook = await runLifecycleHooks('PostToolUse', this.getTask(id), call.name, call.args || {}, { signal: controller.signal });
            if (postHook.results?.length) {
              this.store.appendEvent(id, 'hook.post_tool', { callId: call.id, tool: call.name, results: postHook.results });
            }
          } catch (cause) {
            if (!this._current(id, epoch, controller.signal)) break;
            failure = { code: cause.code || 'TOOL_ERROR', message: cause.message };
            if (this.getOperations(id).some(operation => operation.status === 'outcome_unknown')) {
              return this._status(id, epoch, 'blocked', { code: 'OUTCOME_UNKNOWN', message: cause.message });
            }
            break;
          }
        }
        if (!this._current(id, epoch, controller.signal)) break;
        if (writes) this.store.updateTask(id, current => { current.verification = null; return current; }, 'workspace.changed');
        if (failure) {
          const softToolRecovery = [
            'BROWSER_EVAL_ERROR', 'BROWSER_ELEMENT_NOT_FOUND', 'BROWSER_ELEMENT_DISABLED',
            'BROWSER_NAV_FAILED', 'BROWSER_TIMEOUT', 'BROWSER_NOT_OPEN', 'BROWSER_TARGET_REQUIRED',
            'BROWSER_URL_DENIED', 'WEB_FETCH_ERROR', 'WEB_SEARCH_ERROR'
          ].includes(failure.code);
          if (!softToolRecovery) {
            await this._recover(id, epoch, { ...failure, fromTool: true });
          }
        }
        else if (deniedInTurn) continue;
        else if (this.getTask(id).pendingMessages?.length) continue;
        else {
          const after = await taskSnapshot(this.getTask(id).workspace);
          if (!this._current(id, epoch, controller.signal)) break;
          const signature = sha256(stableJson([snapshot.snapshotHash, response.calls.map(({ name, args }) => ({ name, args }))]));
          const productiveNoWrite = response.calls.some(c => [
            'process.run', 'check.run', 'agent.spawn', 'task.todo', 'git.commit',
            'browser.open', 'browser.act', 'browser.eval', 'browser.snapshot', 'browser.screenshot', 'browser.close',
            'web.search', 'web.fetch', 'memory.save'
          ].includes(c.name));
          const stalled = this.store.updateTask(id, current => {
            if (snapshot.snapshotHash !== after.snapshotHash) { current.stallSignature = null; current.stallTurns = 0; current.noWriteTurns = 0; }
            else {
              current.stallTurns = current.stallSignature === signature ? (current.stallTurns || 0) + 1 : 1; current.stallSignature = signature;
              current.noWriteTurns = (writes || productiveNoWrite || current.planMode) ? 0 : (current.noWriteTurns || 0) + 1;
            }
            return current;
          });
          const excursionStart = stalled.routing?.excursion?.startedCall || 0;
          const callsSinceSwitch = stalled.calls - excursionStart;
          const taskEffortStall = normalizeEffort(stalled.effort);
          const noWriteThreshold = stalled.fixtureId ? 6 : taskEffortStall === 'max' ? 24 : taskEffortStall === 'high' ? 18 : 12;
          if (stalled.stallTurns >= stalled.policy.maxNoProgressTurns && callsSinceSwitch >= 2) {
            const summary = this._buildWorkingSummary(stalled, after, this.getRecentEvents(id, 60), 'stall');
            this.store.updateTask(id, current => { current.stallTurns = 0; current.workingSummary = summary; return current; }, 'task.compacted', { reason: 'stall', calls: stalled.calls, modifiedFiles: summary.modifiedFiles.length, failingChecks: summary.latestFailingChecks.length });
            await this._recover(id, epoch, { code: 'NO_PROGRESS', message: 'Equivalent tool actions repeated without changing the project or producing new evidence.' });
          } else if (!stalled.planMode && !(stalled.workspaceKind === 'conversation' && !stalled.sourcePath && !stalled.fixtureId) && stalled.noWriteTurns >= noWriteThreshold && callsSinceSwitch >= 3) {
            const summary = this._buildWorkingSummary(stalled, after, this.getRecentEvents(id, 60), 'stall_no_write');
            this.store.updateTask(id, current => { current.noWriteTurns = 0; current.workingSummary = summary; return current; }, 'task.compacted', { reason: 'stall_no_write', calls: stalled.calls, modifiedFiles: summary.modifiedFiles.length, failingChecks: summary.latestFailingChecks.length });
            await this._recover(id, epoch, { code: 'NO_PROGRESS', message: `Model engaged with read tools without writing files after ${noWriteThreshold} turns; rotating to a different model.` });
          } else if (!stalled.fixtureId && stalled.calls > 0 && stalled.calls % 12 === 0 && (stalled.workingSummary?.calls || 0) < stalled.calls) {
            // Periodic healthy-progress compaction so long 20–100 step tasks keep fresh semantic + structural handoff state
            const compacted = await this._compactHybrid(id, stalled, after, 'periodic_checkpoint', {
              signal: controller.signal,
              allowSemantic: true,
              provider,
            });
            const ws = compacted?.workingSummary;
            if (ws) {
              this.store.appendEvent(id, 'task.compacted', {
                reason: 'periodic_checkpoint',
                calls: stalled.calls,
                compactedBeforeSeq: ws.compactedBeforeSeq || 0,
                foldedEvents: ws.foldedEventCount || 0,
                semanticDistilled: Boolean(ws.semantic),
                modifiedFiles: ws.modifiedFiles?.length || 0,
                failingChecks: ws.latestFailingChecks?.length || 0,
                source: 'controller',
              });
            }
          }
          if (snapshot.snapshotHash !== after.snapshotHash) {
            this._progress(id, epoch, task.providerId, after.snapshotHash);
            try { if (await hasGit(task.workspace)) await gitAutoCommit(task.workspace, `turn ${task.calls} [${task.providerId}]`); } catch {}
            // Periodic verification: run probes every N calls on fixture tasks to give incremental feedback.
            const pTask = this.getTask(id);
            if (pTask.fixtureId && this.evaluator && this._current(id, epoch, controller.signal)) {
              const baseInterval = pTask.policy.probeInterval || 8;
              const hwPct = (pTask.routing?.probeHighWater || 0) / Math.max((pTask.routing?.probeProgress?.total || 1), 1);
              const hasProgress = (pTask.routing?.probeHighWater || 0) > 0;
              const interval = hwPct > 0.5 ? 1 : hasProgress ? Math.max(4, Math.floor(baseInterval / 2)) : baseInterval;
              const lastProbeCall = pTask.routing?.lastProbeCall || 0;
              const firstWrite = lastProbeCall === 0;
              if (firstWrite || pTask.calls - lastProbeCall >= interval) {
                try {
                  const rawProbeResult = await evaluateBounded(this.evaluator, pTask, { signal: controller.signal });
                  const probeAfter = await taskSnapshot(pTask.workspace);
                  const probeResult = bindVerification(rawProbeResult, after, probeAfter);
                  if (this._current(id, epoch, controller.signal)) {
                    const passed = (probeResult.checks || []).filter(c => c.status === 'pass').length;
                    const total = (probeResult.checks || []).length;
                    const failing = (probeResult.checks || []).filter(c => c.status !== 'pass').slice(0, 12)
                      .map(c => ({ name: String(c.name || '').slice(0, 150), detail: String(c.detail || '').slice(0, 200) }));
                    const prevHighWater = pTask.routing?.probeHighWater || 0;
                    this.store.updateTask(id, current => {
                      current.routing ||= {};
                      current.routing.lastProbeCall = current.calls;
                      current.routing.probeProgress = { passed, total, failing, call: current.calls, highWater: Math.max(passed, prevHighWater) };
                      return current;
                    }, 'periodic.verification', { passed, total, call: pTask.calls });
                    let rolledBack = false;
                    if (passed > prevHighWater) {
                      const bestSnap = await taskSnapshot(pTask.workspace);
                      if (this._current(id, epoch, controller.signal)) {
                        this.store.updateTask(id, current => {
                          current.routing.probeHighWater = passed;
                          current.routing.probeHighWaterCall = current.calls;
                          current.routing.probeHighWaterProvider = current.providerId;
                          current.routing.regressionCount = 0;
                          current.routing.plateauCount = 0;
                          current.routing.stickyCount = 0;
                          current.routing.bestSnapshot = bestSnap.files.filter(f => typeof f.content === 'string').map(f => ({ path: f.path, content: f.content }));
                          return current;
                        }, 'periodic.highwater', { passed, total, previousHighWater: prevHighWater });
                      }
                    } else if (passed < prevHighWater && prevHighWater > 0) {
                      const regCount = (pTask.routing?.regressionCount || 0) + 1;
                      const bestSnapshot = pTask.routing?.bestSnapshot;
                      if (regCount >= 2 && bestSnapshot?.length > 0) {
                        for (const file of bestSnapshot) {
                          if (typeof file.content !== 'string') continue;
                          const target = await scopedPath(pTask.workspace, file.path, { writing: true });
                          await fs.mkdir(dirname(target), { recursive: true });
                          await fs.writeFile(target, file.content);
                        }
                        const rollbackFrom = pTask.providerId;
                        this.store.updateTask(id, current => {
                          current.verification = null;
                          current.routing.regressionCount = 0;
                          current.routing.lastRollbackCall = current.calls;
                          current.routing.rollbackCount = (current.routing.rollbackCount || 0) + 1;
                          current.routing.probeProgress.rolledBack = true;
                          current.routing.cooldowns ||= {};
                          current.routing.cooldowns[rollbackFrom] = current.calls + 5;
                          return current;
                        }, 'periodic.rollback', { passed, highWater: prevHighWater, regressionCount: regCount, rolledBackProvider: rollbackFrom, reason: 'Workspace rolled back and regressing model cooled down.' });
                        const rbTask = this.getTask(id);
                        const rbDiagnosis = { category: 'stalled', route: true };
                        const rbFingerprint = sha256(stableJson(['rollback', rbTask.lastSnapshotHash || rbTask.initialSnapshot?.snapshotHash, rbTask.contractVersion || 1]));
                        const rbRankings = rankCandidates({ task: rbTask, providers: this._privacyFilteredProviders(), learning: rbTask.policy.learning !== false ? this.getLearning() : null, diagnosis: rbDiagnosis, requiredTools: this._requiredTools(rbTask), fingerprint: rbFingerprint });
                        const rbNext = rbRankings.find(c => !c.excluded && c.id !== rollbackFrom);
                        if (rbNext) {
                          this.store.updateTask(id, current => {
                            current.providerId = rbNext.id;
                            current.providerIndex = current.providers.indexOf(rbNext.id);
                            current.routing.excursion = { providerId: rbNext.id, from: rollbackFrom, category: 'rollback', startedCall: current.calls, snapshotHash: current.lastSnapshotHash };
                            current.stallSignature = null; current.stallTurns = 0;
                            return current;
                          }, 'model.switched', { from: rollbackFrom, to: rbNext.id, reason: 'POST_ROLLBACK_ROTATION', score: rbNext.score });
                        }
                        rolledBack = true;
                      } else {
                        this.store.updateTask(id, current => {
                          current.routing.regressionCount = regCount;
                          return current;
                        }, 'periodic.regression', { passed, highWater: prevHighWater, regressionCount: regCount });
                      }
                    } else if (passed === prevHighWater && prevHighWater > 0) {
                      const plateauCount = (pTask.routing?.plateauCount || 0) + 1;
                      this.store.updateTask(id, current => {
                        current.routing ||= {};
                        current.routing.plateauCount = plateauCount;
                        return current;
                      }, 'periodic.plateau', { passed, highWater: prevHighWater, plateauCount });
                      if (plateauCount >= 3) {
                        const plateauFrom = pTask.providerId;
                        const summary = this._buildWorkingSummary(this.getTask(id), probeAfter, this.getRecentEvents(id, 60), 'plateau');
                        this.store.updateTask(id, current => {
                          current.routing.plateauCount = 0;
                          current.routing.cooldowns ||= {};
                          current.routing.cooldowns[plateauFrom] = current.calls + 8;
                          current.workingSummary = summary;
                          return current;
                        }, 'periodic.plateau_rotate', { passed, highWater: prevHighWater, plateauCount, rotatedFrom: plateauFrom });
                        this.store.appendEvent(id, 'task.compacted', { reason: 'plateau', calls: pTask.calls, modifiedFiles: summary.modifiedFiles.length, failingChecks: summary.latestFailingChecks.length });
                        const plTask = this.getTask(id);
                        const plDiagnosis = { category: 'stalled', route: true };
                        const plFingerprint = sha256(stableJson(['plateau', plTask.lastSnapshotHash || plTask.initialSnapshot?.snapshotHash, plTask.contractVersion || 1]));
                        const plRankings = rankCandidates({ task: plTask, providers: this._privacyFilteredProviders(), learning: plTask.policy.learning !== false ? this.getLearning() : null, diagnosis: plDiagnosis, requiredTools: this._requiredTools(plTask), fingerprint: plFingerprint });
                        const hwProvider = pTask.routing?.probeHighWaterProvider;
                        let plNext = hwProvider && hwProvider !== plateauFrom ? plRankings.find(c => !c.excluded && c.id === hwProvider) : null;
                        if (!plNext) plNext = plRankings.find(c => !c.excluded && c.id !== plateauFrom);
                        if (plNext) {
                          this.store.updateTask(id, current => {
                            current.providerId = plNext.id;
                            current.providerIndex = current.providers.indexOf(plNext.id);
                            current.routing.excursion = { providerId: plNext.id, from: plateauFrom, category: 'plateau', startedCall: current.calls, snapshotHash: current.lastSnapshotHash };
                            current.stallSignature = null; current.stallTurns = 0;
                            return current;
                          }, 'model.switched', { from: plateauFrom, to: plNext.id, reason: 'PLATEAU_ROTATION', returnToHw: plNext.id === hwProvider, score: plNext.score });
                        }
                      }
                    }
                    if (!rolledBack && pTask.policy.mode === 'adaptive' && probeResult.status === 'pass') {
                      const initialSnap = pTask.initialSnapshot;
                      if (initialSnap) {
                        const currentSnap = await taskSnapshot(pTask.workspace);
                        if (!this._current(id, epoch, controller.signal)) break;
                        const initialPaths = new Set(initialSnap.files.map(f => f.path));
                        const initialContents = new Map(initialSnap.files.map(f => [f.path, f.content]));
                        const newFiles = currentSnap.files.filter(f => !initialPaths.has(f.path));
                        const modifiedFiles = currentSnap.files.filter(f => initialContents.has(f.path) && initialContents.get(f.path) !== f.content && !f.path.startsWith('test/'));
                        if (currentSnap.snapshotHash === probeResult.snapshotHash && (newFiles.length > 0 || modifiedFiles.length > 0)) {
                          this._learnCompletion(id);
                          this.store.updateTask(id, current => {
                            current.status = 'completed'; current.completionKind = 'verified';
                            current.completedAt = new Date().toISOString(); current.blocker = null;
                            current.verification = probeResult;
                            return current;
                          }, 'task.completed', { completionKind: 'verified', trigger: 'periodic_probe' });
                          return this.getTask(id);
                        }
                      }
                    }
                  }
                } catch {}
              }
            }
          } else {
            // No workspace change this turn — but if probes already showed progress,
            // re-check: the model may have solved the task and is now just reading.
            const qTask = this.getTask(id);
            if (qTask.fixtureId && this.evaluator && this._current(id, epoch, controller.signal)) {
              const hw = qTask.routing?.probeHighWater || 0;
              const lastProbe = qTask.routing?.lastProbeCall || 0;
              const callsSinceProbe = qTask.calls - lastProbe;
              // Fire if: high-water exists AND (enough read-only turns elapsed OR no-write streak is building)
              if (hw > 0 && (callsSinceProbe >= 4 || (qTask.noWriteTurns || 0) >= 3)) {
                try {
                  const rawProbeResult = await evaluateBounded(this.evaluator, qTask, { signal: controller.signal });
                  const probeAfter = await taskSnapshot(qTask.workspace);
                  const probeResult = bindVerification(rawProbeResult, after, probeAfter);
                  if (this._current(id, epoch, controller.signal)) {
                    const passed = (probeResult.checks || []).filter(c => c.status === 'pass').length;
                    const total = (probeResult.checks || []).length;
                    const failing = (probeResult.checks || []).filter(c => c.status !== 'pass').slice(0, 12)
                      .map(c => ({ name: String(c.name || '').slice(0, 150), detail: String(c.detail || '').slice(0, 200) }));
                    this.store.updateTask(id, current => {
                      current.routing ||= {};
                      current.routing.lastProbeCall = current.calls;
                      current.routing.probeProgress = { passed, total, failing, call: current.calls, highWater: Math.max(passed, hw) };
                      return current;
                    }, 'periodic.verification.readonly', { passed, total, call: qTask.calls, noWriteTurns: qTask.noWriteTurns || 0, failing });
                    if (passed > hw) {
                      const bestSnap = await taskSnapshot(qTask.workspace);
                      if (this._current(id, epoch, controller.signal)) {
                        this.store.updateTask(id, current => {
                          current.routing.probeHighWater = passed;
                          current.routing.probeHighWaterCall = current.calls;
                          current.routing.probeHighWaterProvider = current.providerId;
                          current.routing.regressionCount = 0;
                          current.routing.plateauCount = 0;
                          current.routing.stickyCount = 0;
                          current.routing.bestSnapshot = bestSnap.files.filter(f => typeof f.content === 'string').map(f => ({ path: f.path, content: f.content }));
                          return current;
                        }, 'periodic.highwater', { passed, total, previousHighWater: hw });
                      }
                    } else if (passed < hw && hw > 0) {
                      const regCount = (qTask.routing?.regressionCount || 0) + 1;
                      const bestSnapshot = qTask.routing?.bestSnapshot;
                      if (bestSnapshot?.length > 0) {
                        for (const file of bestSnapshot) {
                          if (typeof file.content !== 'string') continue;
                          const target = await scopedPath(qTask.workspace, file.path, { writing: true });
                          await fs.mkdir(dirname(target), { recursive: true });
                          await fs.writeFile(target, file.content);
                        }
                        const rollbackFrom = qTask.providerId;
                        this.store.updateTask(id, current => {
                          current.verification = null;
                          current.routing.regressionCount = 0;
                          current.routing.lastRollbackCall = current.calls;
                          current.routing.rollbackCount = (current.routing.rollbackCount || 0) + 1;
                          current.routing.probeProgress.rolledBack = true;
                          current.routing.cooldowns ||= {};
                          current.routing.cooldowns[rollbackFrom] = current.calls + 5;
                          return current;
                        }, 'periodic.rollback.readonly', { passed, highWater: hw, regressionCount: regCount, rolledBackProvider: rollbackFrom, reason: 'Readonly probe detected regression; workspace rolled back.' });
                      } else {
                        this.store.updateTask(id, current => {
                          current.routing.regressionCount = regCount;
                          return current;
                        }, 'periodic.regression.readonly', { passed, highWater: hw, regressionCount: regCount });
                      }
                    }
                    if (qTask.policy.mode === 'adaptive' && probeResult.status === 'pass') {
                      const initialSnap = qTask.initialSnapshot;
                      if (initialSnap) {
                        const currentSnap = await taskSnapshot(qTask.workspace);
                        if (!this._current(id, epoch, controller.signal)) break;
                        const initialPaths = new Set(initialSnap.files.map(f => f.path));
                        const initialContents = new Map(initialSnap.files.map(f => [f.path, f.content]));
                        const newFiles = currentSnap.files.filter(f => !initialPaths.has(f.path));
                        const modifiedFiles = currentSnap.files.filter(f => initialContents.has(f.path) && initialContents.get(f.path) !== f.content && !f.path.startsWith('test/'));
                        if (currentSnap.snapshotHash === probeResult.snapshotHash && (newFiles.length > 0 || modifiedFiles.length > 0)) {
                          this._learnCompletion(id);
                          this.store.updateTask(id, current => {
                            current.status = 'completed'; current.completionKind = 'verified';
                            current.completedAt = new Date().toISOString(); current.blocker = null;
                            current.verification = probeResult;
                            return current;
                          }, 'task.completed', { completionKind: 'verified', trigger: 'readonly_probe' });
                          return this.getTask(id);
                        }
                      }
                    }
                  }
                } catch {}
              }
            }
          }
        }
        continue;
      }
      const godmodeActive = task.policy?.mode !== 'ask' && (task.policy?.maxAttempts || 0) > 0;
      const learnedPatterns = task.policy?.learning !== false ? (this.getLearning().refusalPatterns || []) : [];
      const refusal = (!provider.directChat || godmodeActive) && detectRefusal(response, { learnedPatterns });
      if (refusal) { await this._recover(id, epoch, refusal); continue; }
      if (godmodeActive && looksAmbiguousEvasion(response)) {
        const overseer = this._resolveOverseer();
        if (overseer && overseer.settings.autoJudgeAmbiguous && overseer.provider.id !== task.providerId) {
          const verdict = await judgeAmbiguousReply({
            provider: overseer.provider,
            backupProviders: overseer.backupProviders,
            objective: task.routing?.originalObjective || task.objective,
            replyText: response.text,
            ...this.outboundOptions(),
            signal: controller.signal
          });
          if (!this._current(id, epoch, controller.signal)) break;
          if (verdict.ok) {
            this.store.appendEvent(id, 'overseer.judged', {
              overseerId: verdict.providerId || overseer.provider.id,
              ...(verdict.failoverFrom ? { failoverFrom: verdict.failoverFrom } : {}),
              providerId: task.providerId,
              classification: verdict.classification,
              isRefusal: verdict.isRefusal,
              reason: verdict.reason
            });
            if (verdict.isRefusal) {
              if (task.policy?.learning !== false) {
                const sig = extractDeclineSignature(response.text);
                if (sig) this.store.recordRefusalPattern({ signature: sig, source: 'overseer_judge', providerId: task.providerId });
              }
              await this._recover(id, epoch, {
                code: 'CONTENT_RESTRICTION',
                kind: 'refusal',
                source: 'overseer_judge',
                message: `${verdict.reason} ${String(response.text || '').slice(0, 400)}`.trim(),
                retryable: true
              });
              continue;
            }
          }
        }
      }
      if (task.crewMember?.role === 'challenger') {
        try { return this.crew.finishReview(id, response); }
        catch (cause) {
          if (cause.code !== 'INVALID_REVIEW') throw cause;
          await this._recover(id, epoch, { code: cause.code, message: cause.message });
          continue;
        }
      }
      if (task.planMode === true) {
        if (response.finish === 'continue') continue;
        if (response.finish === 'done' && typeof response.text === 'string' && response.text.trim()) {
          this.store.appendEvent(id, 'task.plan_ready', { providerId: task.providerId, length: response.text.length });
          return this._status(id, epoch, 'waiting_input', { code: 'PLAN_READY', message: 'Implementation plan ready. Review the plan and switch to build mode (/build) to execute.' });
        }
        await this._recover(id, epoch, { code: 'INVALID_RESPONSE', message: 'A plan mode response must contain a concrete plan and finish="done".' });
        continue;
      }
      // Answering an ordinary conversation is distinct from verifying code.
      // Any artifact, execution or unresolved operation retains
      // the existing verification path, even if the worker calls it an answer.
      const pendingAnswer = this.getTask(id);
      if (conversationWithoutChecks(pendingAnswer)) {
        const answerSnapshot = await taskSnapshot(pendingAnswer.workspace);
        if (!this._current(id, epoch, controller.signal)) break;
        if (this.getTask(id).pendingMessages?.length) continue;
        const readOnly = this.getOperations(id).every(operation => {
          if (!['succeeded', 'failed'].includes(operation.status)) return false;
          if (READ_ONLY_TOOLS.has(operation.name) || ['task.todo', 'memory.save', 'memory.delete', 'agent.spawn', 'browser.open', 'browser.act', 'browser.eval', 'browser.close'].includes(operation.name)) return true;
          // Includes legacy no-check observations. Unknown check metadata is
          // not verification credit and cannot excuse command or write effects.
          const result = operation.result;
          return operation.name === 'check.run' && !operation.customCommands && !operation.effectObserved && !operation.executionResult
            && result?.status === 'unknown' && result.snapshotHash === answerSnapshot.snapshotHash
            && [undefined, 'NO_CONFIGURED_CHECKS', 'UNREGISTERED_ACCEPTANCE'].includes(result.code)
            && !result.detachedObserved && !result.outcomeUncertain && !result.drainUncertain
            && Array.isArray(result.checks) && result.checks.length > 0
            && result.checks.every(check => check.status === 'unknown' && !check.detachedObserved && !check.outcomeUncertain && !check.drainUncertain);
        });
        if (!answerSnapshot.files.length && readOnly) {
          if (response.finish === 'continue') continue;
          if ((response.finish === 'done' || (provider.directChat && response.finish === 'refusal')) && typeof response.text === 'string' && response.text.trim()) {
            const outcome = replyOutcome(response);
            if ((!provider.directChat || godmodeActive) && outcome?.kind === 'declined') {
              await this._recover(id, epoch, { code: 'CONTENT_RESTRICTION', kind: 'refusal', message: response.text.slice(0, 500), retryable: true });
              continue;
            }
            if (outcome?.kind !== 'declined') this._learnCompletion(id);
            return this.store.updateTask(id, current => { current.status = 'completed'; current.completionKind = 'answered'; current.replyOutcome = outcome; current.verification = null; current.completedAt = new Date().toISOString(); current.blocker = null; return current; }, 'task.completed', { completionKind: 'answered', replyOutcome: outcome, independentVerification: 'not_applicable' });
          }
          await this._recover(id, epoch, { code: 'INVALID_RESPONSE', message: 'A conversation answer must contain text and a final completion marker.' });
          continue;
        }
      }
      // Text is never evidence that code passed its independent checks.
      const evaluation = await this._verify(id, epoch, controller.signal);
      if (!this._current(id, epoch, controller.signal)) break;
      if (this.getOperations(id).some(operation => !['succeeded', 'failed'].includes(operation.status))) return this._status(id, epoch, 'blocked', { code: 'OUTCOME_UNKNOWN', message: 'Verification command effects are unresolved. Inspect and reconcile them before continuing.' });
      if (evaluation.code && !diagnoseIncident({ code: evaluation.code }).route && evaluation.code !== 'UNREGISTERED_ACCEPTANCE') {
        await this._recover(id, epoch, { code: evaluation.code, message: 'Verification requires owner intervention before work can continue.', checks: evaluation.checks }); continue;
      }
      if (this.getTask(id).pendingMessages?.length) continue;
      if (evaluation.status === 'pass') {
        const verifiedTask = this.getTask(id);
        if (verifiedTask.fixtureId && verifiedTask.initialSnapshot) {
          const currentSnap = await taskSnapshot(verifiedTask.workspace);
          if (!this._current(id, epoch, controller.signal)) break;
          const initialPaths = new Set(verifiedTask.initialSnapshot.files.map(f => f.path));
          const initialContents = new Map(verifiedTask.initialSnapshot.files.map(f => [f.path, f.content]));
          const newFiles = currentSnap.files.filter(f => !initialPaths.has(f.path));
          const modifiedFiles = currentSnap.files.filter(f => initialContents.has(f.path) && initialContents.get(f.path) !== f.content && !f.path.startsWith('test/'));
          if (newFiles.length === 0 && modifiedFiles.length === 0) {
            await this._recover(id, epoch, { code: 'INCOMPLETE_TASK', message: 'Fixture tests passed but no source files were changed or created. The model likely fixed the existing test scaffold instead of building the requested objective.', retryable: true });
            continue;
          }
        }
        this._learnCompletion(id);
        return this.store.updateTask(id, current => { current.status = 'completed'; current.completionKind = 'verified'; current.completedAt = new Date().toISOString(); current.blocker = null; return current; }, 'task.completed', { completionKind: 'verified', snapshotHash: evaluation.snapshotHash });
      }
      const pending = this.getTask(id);
      if (evaluation.status === 'unknown' && (!pending.fixtureId || pending.followups?.length) && pending.acceptance?.mode === 'owner' && response.finish !== 'continue') return this._status(id, epoch, 'waiting_input', { code: 'UNREGISTERED_ACCEPTANCE', message: 'No independent executable acceptance checks are registered for the current task requirements. Review the current changes, then accept this snapshot or continue the task.', snapshotHash: evaluation.snapshotHash });
      await this._recover(id, epoch, { code: evaluation.status === 'unknown' ? 'VERIFICATION_UNKNOWN' : 'INCOMPLETE_TASK', message: 'Required acceptance evidence is missing or failing.', checks: evaluation.checks });
    }
    return this.getTask(id);
  }
  _current(id, epoch, signal) { const task = this.getTask(id); return !signal?.aborted && task.epoch === epoch && active.has(task.status) && this.crew.workerCurrent(task); }
  _applyPending(id, snapshot) {
    const task = this.getTask(id), messages = task.pendingMessages || [];
    if (!messages.length) return task;
    if (this.getOperations(id).some(operation => !['succeeded', 'failed'].includes(operation.status))) throw fault('OUTCOME_UNKNOWN', 'Reconcile unresolved operations before applying queued instructions.');
    const appliedAt = new Date().toISOString();
    const additions = messages.map((message, index) => ({ ...message, appliedAt, contractVersion: (task.contractVersion || 1) + index + 1 }));
    const proposed = { ...withFollowups(task, [...(task.followups || []), ...additions]), pendingMessages: [] };
    // Preflight the complete new contract before atomically consuming the queue.
    const pendingProvider = this.selectedProvider(proposed.providerId, proposed.workspaceKind);
    buildContext({ task: { ...proposed, calls: proposed.calls + 1, version: task.version + 2, eventSeq: task.eventSeq + 2 }, provider: pendingProvider, history: this.getRecentEvents(id), totalHistoryCount: task.eventSeq + 2, files: snapshot.files, snapshotHash: snapshot.snapshotHash, learning: this.getLearning(), memories: this._memoriesForTask(proposed) });
    return this.store.updateTask(id, () => proposed, 'user.messages.applied', { ids: additions.map(message => message.id), contractVersion: proposed.contractVersion, source: 'owner' });
  }
  _status(id, epoch, status, blocker = null) {
    if (this.getTask(id).epoch !== epoch) return this.getTask(id);
    return this.store.updateTask(id, task => { task.status = status; task.blocker = blocker; return task; }, 'task.status', { status, blocker });
  }
  async _waitForRetry(id, epoch, signal) {
    while (this._current(id, epoch, signal)) {
      const task = this.getTask(id);
      const catalog = Boolean(task.answerRace) || isCatalogModel(task.providerId);
      const key = catalog ? catalogWaitKey : providerIdentity(task.providerId, this.providers.get(task.providerId));
      const pending = task.routing?.pendingRetry;
      const matches = pending?.providerKey === key && pending.contractVersion === (task.contractVersion || 1);
      // Owner messages supersede local backoff, but never a provider's Retry-After.
      const until = Math.max(task.providerNotBefore?.[key] || 0, matches && !task.pendingMessages?.length ? pending.retryAt : 0);
      const remaining = until - Date.now();
      if (remaining <= 0) return true;
      if (catalog) {
        const autoShortRetry = ['VENICE_RATE_LIMIT', 'PROVIDER_TIMEOUT', 'PROVIDER_FAILURE', 'PROVIDER_ERROR', 'provider_incomplete'].includes(pending?.reason) && matches && remaining <= 15000 && task.policy?.autoContinue !== false && !task.pendingMessages?.length;
        if (!autoShortRetry) {
          this._status(id, epoch, 'waiting_input', { code: 'VENICE_RETRY_AFTER', retryAt: until, message: 'Venice asked this chat to wait before sending another request.' });
          return false;
        }
      }
      if (remaining > 60000) {
        this._status(id, epoch, 'waiting_input', { code: 'RETRY_AFTER_LIMIT', message: 'Provider requested a longer wait. Resume after the recorded time or choose another provider.', retryAt: until });
        return false;
      }
      if (task.status !== 'recovering') this._status(id, epoch, 'recovering');
      try { await delay(Math.min(remaining, 250), undefined, { signal }); }
      catch (cause) { if (signal.aborted) return false; throw cause; }
    }
    return false;
  }
  async _turn(provider, context, parentSignal, timeoutMs, profile, onDelta) {
    const child = new AbortController();
    let timer;
    let rejectAbort;
    const stopped = new Promise((_, reject) => { rejectAbort = reject; });
    const abort = () => { child.abort(parentSignal.reason); rejectAbort(fault('ABORTED', 'Provider request cancelled.')); };
    parentSignal.addEventListener('abort', abort, { once: true });
    if (parentSignal.aborted) abort();
    const { privacy, onOutbound, extraSecrets } = this.outboundOptions();
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => { child.abort(); reject(fault('PROVIDER_TIMEOUT', `Provider exceeded ${timeoutMs} ms.`)); }, timeoutMs); });
    try { return await Promise.race([Promise.resolve().then(() => provider.turn(context, { signal: child.signal, turnTimeoutMs: timeoutMs, privacy, onOutbound, extraSecrets, ...(profile ? { requestProfile: profile } : {}), ...(onDelta ? { onDelta } : {}) })), stopped, timeout]); }
    finally { clearTimeout(timer); parentSignal.removeEventListener('abort', abort); }
  }
  async _verify(id, epoch, signal) {
    this._status(id, epoch, 'verifying');
    this.store.updateTask(id, task => { task.verification = null; return task; });
    const before = await taskSnapshot(this.getTask(id).workspace);
    if (!this._current(id, epoch, signal) || this.getTask(id).pendingMessages?.length) return { status: 'unknown', snapshotHash: before.snapshotHash, checks: [] };
    let result;
    try {
      const task = this.getTask(id);
      // Owner commands may mutate files. Use the same durable dispatch journal
      // as explicit check.run calls so a crash or uncertain drainage cannot replay.
      if (task.checks?.length && task.checksContractVersion === (task.contractVersion || 1)) {
        result = await this.broker.execute(id, { id: `controller-verify-${epoch}-${task.calls}`, name: 'check.run', args: {} }, { epoch, signal });
        if (result?.ok === false) result = { status: 'unknown', code: result.error?.code, snapshotHash: before.snapshotHash, checks: [{ name: 'Owner commands', status: 'unknown', detail: result.error?.message || 'Command verification failed.' }] };
      } else result = this.evaluator ? await evaluateBounded(this.evaluator, task, { signal }) : { status: 'unknown', snapshotHash: before.snapshotHash, checks: [{ name: 'acceptance', status: 'unknown', detail: 'No independent evaluator configured.' }] };
    } catch (cause) { result = { status: 'unknown', code: cause.code, snapshotHash: before.snapshotHash, checks: [{ name: 'evaluator', status: 'unknown', detail: cause.message }] }; }
    if (result.detachedObserved || result.outcomeUncertain || result.drainUncertain || result.checks?.some(check => check.detachedObserved || check.outcomeUncertain || check.drainUncertain)) result = { ...result, status: 'unknown', code: 'EXECUTION_OUTCOME_UNKNOWN' };
    const after = await taskSnapshot(this.getTask(id).workspace);
    result = bindVerification(result, before, after);
    const currentTask = this.getTask(id);
    if (result.status === 'unknown' && !result.code && (!currentTask.fixtureId || currentTask.followups?.length) && currentTask.acceptance?.mode === 'owner') result = { ...result, code: 'UNREGISTERED_ACCEPTANCE' };
    if (this._current(id, epoch, signal)) this.store.updateTask(id, task => { task.verification = result; return task; }, 'evaluation.completed', result);
    return result;
  }
  _requiredTools(task) { return taskTools(task).filter(tool => task.execution?.enabled || tool.name !== 'process.run').map(tool => tool.name); }
  _progress(id, epoch, providerId, snapshotHash) {
    if (!this._current(id, epoch)) return;
    let task = this.store.updateTask(id, current => {
      current.routing ||= { primaryId: current.providers[0], cooldowns: {}, primaryReturnUsed: false, contributions: {} };
      current.routing.contributions ||= {};
      const key = providerIdentity(providerId, this.providers.get(providerId));
      if (current.routing.contributions[providerId]?.providerKey !== key) current.routing.contributions[providerId] = { categories: [], providerKey: key };
      const contribution = current.routing.contributions[providerId];
      const category = current.routing.excursion?.providerId === providerId ? current.routing.excursion.category : 'completion';
      if (!contribution.categories.includes(category)) contribution.categories.push(category);
      contribution.snapshotHash = snapshotHash;
      return current;
    });
    const routing = task.routing, primary = routing.primaryId || task.providers[0];
    // Sticky refusal failover: once we switched away from a declining model and the new model is making progress, stick with it!
    const refusalExcursion = ['content_restriction', 'refusal'].includes(routing.excursion?.category)
      || (Array.isArray(routing.declinedProviders) && routing.declinedProviders.includes(primary));
    if (task.policy.stickyOnRefusal !== false && refusalExcursion) return;
    if (task.policy.mode !== 'adaptive' || task.policy.returnToPrimary === false || routing.primaryReturnUsed || providerId === primary || routing.excursion?.providerId !== providerId) return;
    if (candidateEligibility(this.providers.get(primary), this._requiredTools(task))) return;
    if ((task.providerNotBefore?.[providerIdentity(primary, this.providers.get(primary))] || 0) > Date.now()) return;
    if (this.getOperations(id).some(operation => !['succeeded', 'failed'].includes(operation.status))) return;
    const wasEscalated = Boolean(routing.excursion?.escalated);
    const fromTier = providerTier(this.providers.get(providerId));
    const toTier = providerTier(this.providers.get(primary));
    task = this.store.updateTask(id, current => {
      current.providerId = primary; current.providerIndex = current.providers.indexOf(primary);
      current.routing.primaryReturnUsed = true;
      current.routing.cooldowns ||= {}; delete current.routing.cooldowns[primary];
      current.routing.lastCheckpointHash = snapshotHash;
      current.routing.excursion = null;
      current.strategy = 'continue'; current.stallSignature = null; current.stallTurns = 0;
      return current;
    }, 'model.switched', { from: providerId, to: primary, reason: 'RETURN_TO_PRIMARY', checkpointHash: snapshotHash, ...(wasEscalated ? { deescalated: true, fromTier, toTier } : {}), note: 'Successful fallback batch changed the workspace; all dispatched operations are settled. Automatic return is limited to once per task contract.' });
    return task;
  }
  _learnCompletion(id) {
    const task = this.getTask(id);
    if (task.policy.learning === false || task.crewMember) return;
    const observations = [];
    const contributions = { ...(task.routing?.contributions || {}) };
    contributions[task.providerId] ||= { categories: [], providerKey: providerIdentity(task.providerId, this.providers.get(task.providerId)) };
    const lastDurationMs = task.routing?.lastTurnDurationMs;
    for (const [providerId, contribution] of Object.entries(contributions)) {
      const provider = this.providers.get(providerId);
      if (!provider) continue;
      if (contribution.providerKey !== providerIdentity(providerId, provider)) continue;
      for (const category of new Set(['completion', ...(contribution.categories || [])])) observations.push({ providerId, providerKey: contribution.providerKey, category, outcome: 'success', ...(providerId === task.providerId && Number.isFinite(lastDurationMs) ? { durationMs: lastDurationMs } : {}) });
    }
    const events = this.getEvents(id), notes = [];
    const names = this.getOperations(id).filter(op => op.status === 'succeeded').map(op => op.name);
    if (names.some(name => ['repo.write', 'repo.patch', 'repo.delete', 'repo.move', 'process.run'].includes(name))) notes.push('verify-after-edit');
    if (events.some(event => event.type === 'model.switched')) notes.push('checkpoint-handoff');
    if (events.some(event => event.type === 'evaluation.completed' && event.data.status === 'fail')) notes.push('repair-from-evidence');
    if (names.includes('repo.read') || names.includes('repo.patch')) notes.push('retrieve-before-edit');
    if (!this.getPrivacy().settings.ephemeralSession) {
      this.store.recordLearning(`${id}:${task.contractVersion || 1}:verified`, observations, notes);
    }
    if (task.routing?.lastRecoveryStrategy?.strategy) {
      this.store.recordStrategyLearning(`${id}:${task.contractVersion || 1}:strategy:win:${task.recoveries || 0}`, {
        modelFamily: task.routing.lastRecoveryStrategy.modelFamily || inferModelFamily(task.providerId),
        strategy: task.routing.lastRecoveryStrategy.strategy,
        outcome: 'success'
      });
    }
    const domain = task.routing?.domain || classifyPromptDomain(task.followups?.at(-1)?.message || task.objective, { attachments: task.attachments }).primaryDomain;
    try { this.store.recordDomainOutcome({ domain, providerId: task.providerId, outcome: 'win' }); } catch {}
  }
  async _recover(id, epoch, incident, signal) {
    signal = signal || this.runs.get(id)?.controller?.signal;
    if (!this._current(id, epoch, signal)) return;
    if (this.getOperations(id).some(operation => !['succeeded', 'failed'].includes(operation.status))) return this._status(id, epoch, 'blocked', { code: 'OUTCOME_UNKNOWN', message: 'Unresolved command or tool effects require owner review before any retry or model switch.' });
    let task = this.getTask(id);
    if (isCatalogModel(task.providerId)) {
      const [primary, backup] = task.providers;
      const switchEnabled = ['adaptive', 'switch_model', 'hybrid'].includes(task.policy.mode);
      const godmodeOn = task.policy.mode !== 'ask' && task.policy.maxAttempts > 0;
      if (incident.code === 'VENICE_SERVICE_OUTAGE' && task.workspaceKind === 'conversation'
        && task.providerId === primary && isCatalogModel(backup) && this.catalog?.get(backup)
        && switchEnabled && task.recoveries < task.policy.maxAttempts && task.calls < task.policy.maxCalls
        && !task.pendingMessages?.length) {
        return this.store.updateTask(id, current => {
          current.providerId = backup;
          current.providerIndex = 1;
          current.recoveries++;
          current.status = 'recovering';
          return current;
        }, 'model.switched', {from: primary, to: backup, reason: 'VENICE_SERVICE_OUTAGE'});
      }
      if (['PROVIDER_TIMEOUT', 'PROVIDER_FAILURE', 'PROVIDER_ERROR', 'provider_incomplete'].includes(incident.code)
        && godmodeOn && task.policy.autoContinue !== false
        && task.recoveries < task.policy.maxAttempts && task.calls < task.policy.maxCalls
        && !task.pendingMessages?.length) {
        const transientKey = `${task.contractVersion || 1}:transient`;
        const priorTransient = Number(task.routing?.transientRetries?.[transientKey] || 0);
        if (priorTransient < 2) {
          const retryAt = Math.min(Number.MAX_SAFE_INTEGER, Date.now() + 2500 * (priorTransient + 1));
          const useBackup = priorTransient === 1 && task.providerId === primary && isCatalogModel(backup) && this.catalog?.get(backup) && switchEnabled;
          return this.store.updateTask(id, current => {
            current.routing ||= {};
            current.routing.transientRetries ||= {};
            current.routing.transientRetries[transientKey] = priorTransient + 1;
            if (useBackup) {
              current.providerId = backup;
              current.providerIndex = 1;
            }
            current.routing.pendingRetry = { retryAt, providerId: current.providerId, providerKey: catalogWaitKey, contractVersion: current.contractVersion || 1, reason: incident.code };
            current.lastIncident = incident;
            current.recoveries += 1;
            current.status = 'recovering';
            return current;
          }, 'routing.retry_scheduled', { providerId: useBackup ? backup : task.providerId, retryAt, retryAfterMs: 2500 * (priorTransient + 1), reason: `${incident.code} during long turn; retrying automatically.` });
        }
      }
      if (incident.code === 'VENICE_RATE_LIMIT' && Number.isFinite(incident.retryAfterMs) && incident.retryAfterMs > 0 && incident.retryAfterMs <= 15000
        && godmodeOn && task.policy.autoContinue !== false && task.recoveries < task.policy.maxAttempts && task.calls < task.policy.maxCalls && !task.pendingMessages?.length) {
        const retryAt = Math.min(Number.MAX_SAFE_INTEGER, Date.now() + incident.retryAfterMs);
        return this.store.updateTask(id, current => {
          current.routing ||= {};
          current.routing.pendingRetry = { retryAt, providerId: current.providerId, providerKey: catalogWaitKey, contractVersion: current.contractVersion || 1, reason: 'VENICE_RATE_LIMIT' };
          current.lastIncident = incident;
          current.recoveries += 1;
          current.status = 'recovering';
          return current;
        }, 'routing.retry_scheduled', { providerId: task.providerId, retryAt, retryAfterMs: incident.retryAfterMs, reason: 'Short Venice rate limit; waiting automatically before retrying.' });
      }
      if (incident.code === 'VENICE_OUTPUT_LIMIT' && godmodeOn && task.recoveries < task.policy.maxAttempts
        && task.calls < task.policy.maxCalls && !task.pendingMessages?.length) {
        const provider = this.selectedProvider(task.providerId, task.workspaceKind);
        const providerKey = providerIdentity(task.providerId, provider);
        const limits = provider?.capabilities?.outputTokens;
        const currentProfile = requestProfile(task, provider);
        const effortNow = normalizeEffort(task.effort);
        const effortFloor = limits?.max
          ? (effortNow === 'max' ? Math.min(limits.max, 65536) : effortNow === 'high' ? Math.min(limits.max, 32768) : 0)
          : 0;
        const currentMax = Math.max(currentProfile?.maxOutputTokens ?? limits?.initial ?? 0, effortFloor);
        const boostKey = `${task.contractVersion || 1}:${providerKey}`;
        if (limits && currentMax > 0 && currentMax < limits.max && !task.routing?.veniceOutputBoosted?.[boostKey]) {
          const nextProfile = { maxOutputTokens: Math.min(limits.max, Math.max(currentMax * 2, 32768)) };
          return this.store.updateTask(id, current => {
            current.routing ||= {};
            current.routing.requestProfiles ||= {};
            current.routing.requestProfiles[providerKey] = nextProfile;
            current.routing.veniceOutputBoosted ||= {};
            current.routing.veniceOutputBoosted[boostKey] = true;
            current.lastIncident = incident;
            current.recoveries += 1;
            current.status = 'recovering';
            return current;
          }, 'routing.profile_changed', { providerId: task.providerId, diagnosis: 'output_limit', before: currentProfile, requestProfile: nextProfile, reason: 'Venice reached output limit before visible text; retrying with higher token ceiling.' });
        }
        // If already at ceiling on high/max effort and reasoning exhausted the entire output budget, step down reasoning effort on the same model before failing over.
        if (incident.exhaustedReasoning && ['high', 'max'].includes(effortNow) && currentProfile?.reasoningCap !== 'low') {
          const nextCap = currentProfile?.reasoningCap === 'medium' ? 'low' : 'medium';
          const nextProfile = { ...(currentProfile || { maxOutputTokens: Math.max(currentMax || 16384, limits?.max || 16384) }), reasoningCap: nextCap };
          return this.store.updateTask(id, current => {
            current.routing ||= {};
            current.routing.requestProfiles ||= {};
            current.routing.requestProfiles[providerKey] = nextProfile;
            current.lastIncident = incident;
            current.recoveries += 1;
            current.status = 'recovering';
            return current;
          }, 'routing.profile_changed', { providerId: task.providerId, diagnosis: 'output_limit', before: currentProfile, requestProfile: nextProfile, reason: `Internal reasoning exhausted output ceiling; retrying same model with ${nextCap} reasoning cap.` });
        }
        const alternate = switchEnabled
          ? task.providers.find(pid => pid !== task.providerId && Boolean(this.selectedProvider(pid, task.workspaceKind)))
          : null;
        if (alternate) {
          const from = task.providerId;
          return this.store.updateTask(id, current => {
            current.providerId = alternate;
            current.providerIndex = current.providers.indexOf(alternate);
            current.lastIncident = incident;
            current.recoveries += 1;
            current.status = 'recovering';
            return current;
          }, 'model.switched', { from, to: alternate, reason: 'VENICE_OUTPUT_LIMIT' });
        }
      }
      const isRefusal = incident.code === 'CONTENT_RESTRICTION' || incident.kind === 'refusal';
      if (isRefusal && task.policy.learning !== false) {
        const refDomain = task.routing?.domain || classifyPromptDomain(task.followups?.at(-1)?.message || task.objective, { attachments: task.attachments }).primaryDomain;
        try { this.store.recordDomainOutcome({ domain: refDomain, providerId: task.providerId, outcome: 'refusal' }); } catch {}
      }
      if (isRefusal && godmodeOn && task.recoveries < task.policy.maxAttempts && task.calls < task.policy.maxCalls && !task.pendingMessages?.length) {
        const currentId = task.providerId;
        const declined = Array.isArray(task.routing?.declinedProviders) ? [...task.routing.declinedProviders] : [];
        if (!declined.includes(currentId)) declined.push(currentId);
        const alternate = switchEnabled
          ? task.providers.find(pid => pid !== currentId && !declined.includes(pid) && Boolean(this.selectedProvider(pid, task.workspaceKind)))
          : null;
        const alternateIsUncensored = Boolean(alternate && /uncensored|abliterat|heretic|dolphin/i.test(alternate));
        const hasFollowups = Array.isArray(task.followups) && task.followups.length > 0;
        const lastFollowup = hasFollowups ? task.followups[task.followups.length - 1] : null;
        const targetPrompt = hasFollowups
          ? (lastFollowup.originalMessage || lastFollowup.message)
          : (task.routing?.originalObjective || task.objective);
        const pass = (task.routing?.reframePass || 0) + 1;
        // Skip heavy reframing boilerplate when switching cleanly to an uncensored model on first recovery pass
        const shouldReframe = !(alternateIsUncensored && pass === 1);
        const reframed = shouldReframe
          ? reframeObjective(targetPrompt, pass, incident.message || '', { providerId: alternate || currentId, ultraplinian: task.ultraplinian })
          : { objective: targetPrompt, reframed: false, level: 'clean_uncensored_switch' };
        task = this.store.updateTask(id, current => {
          current.routing ||= {};
          current.routing.declinedProviders = declined;
          if (hasFollowups) {
            const idx = current.followups.length - 1;
            const prev = current.followups[idx];
            if (reframed.reframed) {
              current.followups = current.followups.map((item, i) => i === idx
                ? { ...item, originalMessage: prev.originalMessage || prev.message, message: reframed.objective }
                : item);
            }
          } else {
            if (!current.routing.originalObjective) current.routing.originalObjective = current.objective;
            if (reframed.reframed) current.objective = reframed.objective;
          }
          current.routing.reframePass = pass;
          current.routing.lastRefusalText = String(incident.message || '').slice(0, 500);
          current.lastIncident = incident;
          current.recoveries += 1;
          current.status = 'recovering';
          return current;
        }, 'reframe.applied', { providerId: currentId, pass, level: reframed.level, reframed: reframed.reframed, reason: alternate ? 'Content restriction detected; switching to fallback model.' : `Content restriction detected; retrying with ${reframed.level} reframing (pass ${pass}).` });
        if (alternate) {
          return this.store.updateTask(id, current => {
            current.providerId = alternate;
            current.providerIndex = current.providers.indexOf(alternate);
            current.routing.excursion = { providerId: alternate, from: currentId, category: 'content_restriction', startedCall: current.calls, snapshotHash: current.lastSnapshotHash };
            return current;
          }, 'model.switched', { from: currentId, to: alternate, reason: 'CONTENT_RESTRICTION' });
        }
        this.store.appendEvent(id, 'routing.reframe_retry', { providerId: currentId, pass, level: reframed.level, reason: 'No alternate fallback available; retrying with reframed objective.' });
        return this.getTask(id);
      }
      // Recoverable tool errors (e.g. BROWSER_EVAL_ERROR, BROWSER_ELEMENT_NOT_FOUND,
      // WEB_FETCH_ERROR, INVALID_TOOL, DOOM_LOOP) must NOT pause the chat into waiting_input;
      // keep running so the model sees the { ok: false, error } role:tool result and adapts!
      const catDiagnosis = diagnoseIncident(incident);
      if (incident.fromTool && catDiagnosis.route
        && task.policy.mode !== 'ask' && task.recoveries < task.policy.maxAttempts
        && task.calls < task.policy.maxCalls && !task.pendingMessages?.length) {
        return this.store.updateTask(id, current => {
          current.lastIncident = { ...incident, diagnosis: catDiagnosis.category };
          if (catDiagnosis.category === 'stalled') current.recoveries = (current.recoveries || 0) + 1;
          current.status = 'running';
          return current;
        });
      }
      return this._status(id, epoch, 'waiting_input', incident);
    }
    const diagnosis = diagnoseIncident(incident);
    incident = { ...incident, diagnosis: diagnosis.category };
    if (!diagnosis.route) return this._status(id, epoch, diagnosis.category === 'cancelled' ? 'paused' : 'blocked', incident);
    const providerKey = providerIdentity(task.providerId, this.providers.get(task.providerId));
    const failedStrategy = task.strategy, profile = requestProfile(task, this.providers.get(task.providerId));
    if (Number.isFinite(incident.retryAfterMs) && incident.retryAfterMs >= 0 && diagnosis.category === 'transport') {
      const retryAt = Math.min(Number.MAX_SAFE_INTEGER, Date.now() + incident.retryAfterMs);
      task = this.store.recordProviderDelay(id, providerKey, retryAt);
    }
    // Repeated failures in one contract are correlated evidence, not independent
    // samples. A loop cannot manufacture confidence by repeatedly declining.
    if (task.policy.learning !== false) {
      this.store.recordLearning(`${id}:${task.contractVersion || 1}:failure:${providerKey}:${diagnosis.category}`, [{ providerId: task.providerId, providerKey, category: diagnosis.category, outcome: 'failure', ...(Number.isFinite(incident.durationMs ?? task.routing?.lastTurnDurationMs) ? { durationMs: incident.durationMs ?? task.routing.lastTurnDurationMs } : {}) }]);
      if (diagnosis.category === 'content_restriction' || diagnosis.category === 'refusal') {
        const refDomain = task.routing?.domain || classifyPromptDomain(task.followups?.at(-1)?.message || task.objective, { attachments: task.attachments }).primaryDomain;
        try { this.store.recordDomainOutcome({ domain: refDomain, providerId: task.providerId, outcome: 'refusal' }); } catch {}
      }
    }
    // Incident identity is route-independent; switching model or wording cannot
    // reset the task-wide diagnosis history. Route outcomes are tracked separately.
    const fingerprint = sha256(stableJson([diagnosis.category, task.lastSnapshotHash || task.initialSnapshot.snapshotHash, task.contractVersion || 1]));
    const routeFingerprint = sha256(stableJson([fingerprint, task.providerId, task.strategy, profile || null]));
    if (task.policy.mode === 'ask') return this._status(id, epoch, 'waiting_input', { ...incident, message: incident.message + ' Choose a recovery policy or resume.' });
    const transportRecoveries = task.routing?.transportRecoveries || 0;
    const effectiveRecoveries = task.recoveries - transportRecoveries;
    if (effectiveRecoveries >= task.policy.maxAttempts) return this._status(id, epoch, 'blocked', { code: 'RECOVERY_LIMIT', message: 'Recovery attempt limit reached.', lastIncident: incident });
    if (task.recoveries >= task.policy.maxAttempts * 3) return this._status(id, epoch, 'blocked', { code: 'RECOVERY_LIMIT', message: 'Absolute recovery limit reached (transport errors).', lastIncident: incident });
    if (!this.crew.reserveRecovery(id)) return this._status(id, epoch, 'blocked', { code: 'CREW_BUDGET', message: 'The shared crew recovery budget is exhausted.', lastIncident: incident });
    task = this.store.updateTask(id, current => {
      current.routing ||= {};
      current.routing.attempts ||= [];
      if (!current.routing.attempts.some(item => item.fingerprint === fingerprint && item.providerKey === providerKey && item.strategy === current.strategy && stableJson(item.requestProfile || null) === stableJson(profile || null))) {
        current.routing.attempts.push({ fingerprint, providerKey, providerId: current.providerId, strategy: current.strategy, ...(profile ? { requestProfile: profile } : {}), call: current.calls });
        current.routing.attempts = current.routing.attempts.slice(-200);
      }
      current.recoveries += 1; current.status = 'recovering'; current.failures[fingerprint] = (current.failures[fingerprint] || 0) + 1;
      current.routeFailures ||= {}; current.routeFailures[routeFingerprint] = (current.routeFailures[routeFingerprint] || 0) + 1;
      if (diagnosis.category === 'transport') { current.routing ||= {}; current.routing.transportRecoveries = (current.routing.transportRecoveries || 0) + 1; }
      current.lastIncident = incident;
      const strategies = current.policy.strategies.length ? current.policy.strategies : ['continue'];
      current.strategy = strategies[(current.recoveries - 1) % strategies.length];
      return current;
    }, 'recovery.started', current => ({ attempt: current.recoveries, incident, fingerprint, mode: current.policy.mode, strategy: current.strategy }));
    if (task.policy.mode === 'adaptive') {
      const provider = this.providers.get(task.providerId), checkpointKey = sha256(stableJson([fingerprint, providerKey]));
      const effortNowAdaptive = normalizeEffort(task.effort);
      const effectiveProfileMax = profile
        ? Math.max(
            profile.maxOutputTokens,
            effortNowAdaptive === 'max' ? Math.min(provider.capabilities.outputTokens.max, 64000)
              : effortNowAdaptive === 'high' ? Math.min(provider.capabilities.outputTokens.max, 32768) : 0
          )
        : 0;
      if (diagnosis.category === 'output_limit' && profile && !task.routing.outputAdjustments?.[checkpointKey]
        && effectiveProfileMax < provider.capabilities.outputTokens.max && !candidateEligibility(provider, this._requiredTools(task))) {
        const nextProfile = { maxOutputTokens: Math.min(Math.max(effectiveProfileMax * 2, 32768), provider.capabilities.outputTokens.max) };
        return this.store.updateTask(id, current => {
          current.routing.requestProfiles ||= {}; current.routing.requestProfiles[providerKey] = nextProfile;
          current.routing.outputAdjustments ||= {}; current.routing.outputAdjustments[checkpointKey] = true;
          current.strategy = failedStrategy;
          return current;
        }, 'routing.profile_changed', { providerId: task.providerId, diagnosis: diagnosis.category, before: profile, requestProfile: nextProfile, reason: 'Retry explicit token exhaustion within the configured output ceiling.' });
      }
      if (diagnosis.category === 'output_limit' && incident.exhaustedReasoning && ['high', 'max'].includes(effortNowAdaptive) && profile && profile.reasoningCap !== 'low'
        && !candidateEligibility(provider, this._requiredTools(task))) {
        const nextCap = profile.reasoningCap === 'medium' ? 'low' : 'medium';
        const nextProfile = { ...profile, maxOutputTokens: Math.min(Math.max(profile.maxOutputTokens, 32768), provider.capabilities.outputTokens.max), reasoningCap: nextCap };
        return this.store.updateTask(id, current => {
          current.routing.requestProfiles ||= {}; current.routing.requestProfiles[providerKey] = nextProfile;
          current.strategy = failedStrategy;
          return current;
        }, 'routing.profile_changed', { providerId: task.providerId, diagnosis: diagnosis.category, before: profile, requestProfile: nextProfile, reason: `Internal reasoning exhausted output budget; retrying same model with ${nextCap} reasoning cap.` });
      }
      // Ultra-Plinian recovery: consult pluggable Overseer (if configured & privacy-allowed)
      // and apply bandit-guided escalating semantic reframing before model switching.
      if (task.policy.learning !== false && task.routing?.lastRecoveryStrategy?.strategy && ['content_restriction', 'refusal', 'stalled'].includes(diagnosis.category)) {
        this.store.recordStrategyLearning(`${id}:${task.contractVersion || 1}:strategy:fail:${task.calls}:${task.recoveries}`, {
          modelFamily: task.routing.lastRecoveryStrategy.modelFamily || inferModelFamily(task.providerId),
          strategy: task.routing.lastRecoveryStrategy.strategy,
          outcome: 'failure'
        });
      }
      let overseerRecommendedId = null;
      let overseerReframed = false;
      if (['content_restriction', 'refusal', 'stalled', 'verification'].includes(diagnosis.category)) {
        const overseer = this._resolveOverseer();
        const consultKey = `${fingerprint}:${diagnosis.category}`;
        if (overseer && overseer.settings.autoUnblockStuck && !task.routing?.overseerConsulted?.[consultKey]) {
          const previewRankings = rankCandidates({ task, providers: this._privacyFilteredProviders(), learning: task.policy.learning !== false ? this.getLearning() : null, diagnosis, requiredTools: this._requiredTools(task), fingerprint });
          const failingChecks = (task.routing?.probeProgress?.failing || incident.checks || []).slice(0, 6);
          const advice = await adviseUnblock({
            provider: overseer.provider,
            backupProviders: overseer.backupProviders,
            task,
            incident,
            candidates: previewRankings,
            failingChecks,
            signal,
            ...this.outboundOptions()
          });
          if (!this._current(id, epoch, signal)) return;
          if (advice.ok) {
            overseerRecommendedId = advice.recommendedProviderId;
            overseerReframed = Boolean(advice.reframedObjective);
            task = this.store.updateTask(id, current => {
              current.routing ||= {};
              current.routing.overseerConsulted ||= {};
              current.routing.overseerConsulted[consultKey] = true;
              if (!current.routing.originalObjective) current.routing.originalObjective = current.objective;
              if (advice.reframedObjective) current.objective = advice.reframedObjective;
              if (advice.guidance) current.routing.overseerGuidance = advice.guidance;
              current.routing.lastRecoveryStrategy = { modelFamily: inferModelFamily(current.providerId), strategy: advice.strategy };
              return current;
            }, 'overseer.advised', {
              overseerId: advice.providerId || overseer.provider.id,
              ...(advice.failoverFrom ? { failoverFrom: advice.failoverFrom } : {}),
              strategy: advice.strategy,
              reason: advice.reason,
              recommendedProviderId: advice.recommendedProviderId,
              hasReframe: Boolean(advice.reframedObjective),
              hasGuidance: Boolean(advice.guidance)
            });
          }
        }
      }
      if (['content_restriction', 'refusal'].includes(diagnosis.category) && !overseerReframed) {
        const defensiveKeywords = /\b(?:DEFENSIVE|SAFETY TOOL|protect(?:s|ing)?|hardens?|hardening)\b/i;
        const isDefensiveTask = defensiveKeywords.test(task.objective);
        let pass = isDefensiveTask ? 0 : (task.routing?.reframePass || 0) + 1;
        // Strategy bandit: on pass 1, if local learning found a high-converting reframe strategy for this model family, jump directly to it.
        if (pass === 1 && task.policy.learning !== false) {
          const best = bestStrategyForFamily(this.getLearning(), inferModelFamily(task.providerId));
          const strategyPassMap = { light: 1, role: 2, medium: 3, technical: 4, decompose: 5, heavy: 6 };
          if (best && Object.hasOwn(strategyPassMap, best.strategy)) pass = strategyPassMap[best.strategy];
        }
        const refusalText = incident.message || '';
        const originalObjective = task.routing?.originalObjective || task.objective;
        const result = reframeObjective(originalObjective, pass, refusalText, { providerId: task.providerId, ultraplinian: task.ultraplinian });

        if (result.rewriteNeeded) {
          try {
            const rewriteProvider = [...this._privacyFilteredProviders().values()].find(p => p.available && p.kind === 'http' && p.protocol === 'openai-chat' && typeof p.plainChat === 'function' && p.id !== task.providerId && task.providers.includes(p.id));
            if (rewriteProvider) {
              const rewriteSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000);
              const out = await rewriteProvider.plainChat(
                rewriteProvider,
                [{ role: 'user', content: rewritePrompt(originalObjective) }],
                rewriteSignal,
                { max_tokens: Math.min(2048, rewriteProvider.maxOutputTokensCeiling || 2048) },
                this.outboundOptions(),
              );
              if (!this._current(id, epoch, signal)) return this.getTask(id);
              const text = out?.type === 'message' && out.finish !== 'refusal' && !detectRefusal(out) ? out?.text?.trim() : '';
              if (text && text.length > 20) {
                result.objective = text;
                result.reframed = true;
                result.level = `llm_rewrite:${rewriteProvider.id}`;
              }
            }
          } catch {}
        }

        task = this.store.updateTask(id, current => {
          if (!current.routing.originalObjective) current.routing.originalObjective = current.objective;
          if (result.reframed) current.objective = result.objective;
          current.routing.reframePass = pass;
          current.routing.lastRefusalText = refusalText.slice(0, 500);
          current.routing.lastRecoveryStrategy = { modelFamily: inferModelFamily(current.providerId), strategy: result.level || 'switch_model' };
          return current;
        }, 'reframe.applied', {
          providerId: task.providerId, pass, level: result.level,
          reframed: result.reframed, rewriteNeeded: result.rewriteNeeded,
          reason: pass <= 1
            ? 'Content restriction detected; switching to a different model.'
            : `Content restriction persists; applied ${result.level} reframing (pass ${pass}) and rotating model.`,
        });
        // Fall through to model switch below
      }
      // Sticky model: if the current model has passing probes, keep it instead of rotating
      // (unless it's a content restriction or transport failure which are model-specific).
      const probeProgress = task.routing?.probeProgress;
      const hasProbeProgress = probeProgress && probeProgress.passed > 0 && probeProgress.total > 0;
      const lastHwCall = task.routing?.probeHighWaterCall || 0;
      const callsSinceHw = task.calls - lastHwCall;
      const isChurning = hasProbeProgress && callsSinceHw > 24 && task.calls > 0 && (task.recoveries / task.calls) > 0.5;
      // Release sticky after 4 consecutive sticky holds without high-water improvement
      const stickyCount = (task.routing?.stickyCount || 0) + 1;
      const probeHw = task.routing?.probeHighWater || 0;
      const probeTotal = task.routing?.probeProgress?.total || 1;
      const stickyLimit = probeHw > probeTotal * 0.3 ? 8 : 4;
      const stickyExhausted = stickyCount > stickyLimit;
      const stickyEligible = hasProbeProgress && !isChurning && !stickyExhausted && !['content_restriction', 'refusal', 'transport', 'stalled'].includes(diagnosis.category);
      if (stickyEligible) {
        this.store.updateTask(id, current => { current.routing ||= {}; current.routing.stickyCount = stickyCount; return current; });
        this.store.appendEvent(id, 'routing.sticky', { providerId: task.providerId, probesPassed: probeProgress.passed, probesTotal: probeProgress.total, diagnosis: diagnosis.category, stickyCount, reason: 'Model has verification progress; skipping rotation.' });
        return this.getTask(id);
      }
      this.store.updateTask(id, current => {
        current.routing ||= { primaryId: current.providers[0], primaryReturnUsed: false, contributions: {} };
        current.routing.cooldowns ||= {};
        current.routing.transportFailures ||= {};
        let cooldownLength;
        if (diagnosis.category === 'content_restriction' || diagnosis.category === 'refusal') {
          cooldownLength = 5;
          current.routing.declinedProviders ||= [];
          if (!current.routing.declinedProviders.includes(current.providerId)) {
            current.routing.declinedProviders.push(current.providerId);
          }
        } else if (diagnosis.category === 'stalled') {
          cooldownLength = 3;
        } else if (diagnosis.category === 'transport') {
          current.routing.transportFailures[current.providerId] = (current.routing.transportFailures[current.providerId] || 0) + 1;
          const failures = current.routing.transportFailures[current.providerId];
          cooldownLength = Math.min(2 + failures * 3, 30);
        } else {
          cooldownLength = 2;
        }
        current.routing.cooldowns[current.providerId] = current.calls + cooldownLength;
        return current;
      });
      task = this.getTask(id);
      const rankings = rankCandidates({ task, providers: this._privacyFilteredProviders(), learning: task.policy.learning !== false ? this.getLearning() : null, diagnosis, requiredTools: this._requiredTools(task), fingerprint });
      const next = (overseerRecommendedId ? rankings.find(c => !c.excluded && c.id === overseerRecommendedId) : null)
        || rankings.find(candidate => !candidate.excluded);
      this.store.appendEvent(id, 'routing.decision', { diagnosis: diagnosis.category, from: task.providerId, selected: next?.id || null, strategy: next?.nextStrategy || null, candidates: rankings, learning: task.policy.learning !== false, requiredTools: this._requiredTools(task) });
      if (!next) {
        const retries = task.routing.transportRetries?.[checkpointKey] || 0;
        if (diagnosis.category === 'transport' && retries < 2 && !candidateEligibility(provider, this._requiredTools(task))) {
          const backoff = 500 * 2 ** retries + parseInt(checkpointKey.slice(0, 4), 16) % 101;
          const retryAt = Math.max(Date.now() + backoff, task.providerNotBefore?.[providerKey] || 0);
          this.store.updateTask(id, current => {
            current.routing.transportRetries ||= {}; current.routing.transportRetries[checkpointKey] = retries + 1;
            current.routing.pendingRetry = { providerId: task.providerId, providerKey, contractVersion: task.contractVersion || 1, checkpointHash: task.lastSnapshotHash || task.initialSnapshot.snapshotHash, retryAt, reason: incident.code };
            current.strategy = failedStrategy;
            return current;
          }, 'routing.retry_scheduled', { providerId: task.providerId, diagnosis: diagnosis.category, retryAt, retry: retries + 1, maxRetries: 2 });
          if (retryAt - Date.now() > 60000) return this._status(id, epoch, 'waiting_input', { code: 'RETRY_AFTER_LIMIT', message: 'Provider requested a longer wait. Resume after the recorded time or choose another provider.', retryAt });
          return this.getTask(id);
        }
        // A different task-solving strategy can repair a check/protocol failure.
        // Transport cooldowns and permission/configuration decisions stay intact.
        const attempted = task.routing.attempts.filter(item => item.fingerprint === fingerprint && item.providerKey === providerKey && stableJson(item.requestProfile || null) === stableJson(profile || null));
        const strategies = task.policy.strategies.length ? task.policy.strategies : ['continue'];
        const strategy = strategies.find(value => !attempted.some(item => item.strategy === value));
        if (strategy && ['protocol','verification','stalled','tool_error','output_limit'].includes(diagnosis.category)
          && !candidateEligibility(this.providers.get(task.providerId), this._requiredTools(task))) {
          return this.store.updateTask(id, current => { current.strategy = strategy; return current; },
            'routing.strategy_changed', { providerId: task.providerId, strategy, diagnosis: diagnosis.category, reason: 'No eligible alternate; trying an untried task-solving strategy on this checkpoint.' });
        }
        if (['content_restriction', 'refusal'].includes(diagnosis.category) && (task.routing?.reframePass || 0) > 0 && (task.routing?.reframePass || 0) < 10) {
          const cleared = this.store.updateTask(id, current => {
            current.routing.cooldowns = {};
            current.routing.declinedProviders = [];
            return current;
          }, 'routing.cooldowns_cleared', { reason: 'Content restriction recovery: clearing cooldowns to retry with reframed objective.' });
          const retry = rankCandidates({ task: this.getTask(id), providers: this._privacyFilteredProviders(), learning: task.policy.learning !== false ? this.getLearning() : null, diagnosis, requiredTools: this._requiredTools(task), fingerprint, excludeCurrent: true });
          const retryNext = retry.find(c => !c.excluded);
          if (retryNext) {
            return this.store.updateTask(id, current => {
              current.providerId = retryNext.id; current.providerIndex = current.providers.indexOf(retryNext.id);
              // preserve recovery-count-based strategy cycling from line 571
              current.routing.excursion = { providerId: retryNext.id, from: task.providerId, category: diagnosis.category, startedCall: current.calls, snapshotHash: current.lastSnapshotHash };
              current.stallSignature = null; current.stallTurns = 0;
              return current;
            }, 'model.switched', { from: task.providerId, to: retryNext.id, reason: 'cooldowns_cleared_for_reframe', diagnosis: diagnosis.category });
          }
          // Single-model (or no eligible alternate) GodMode reframe retry:
          // Do not stop with 0 retries when GodMode is enabled; escalate reframing and retry on the current model.
          if ((diagnosis.category === 'content_restriction' || diagnosis.category === 'refusal')
            && task.recoveries < task.policy.maxAttempts
            && !candidateEligibility(this.providers.get(task.providerId), this._requiredTools(task))) {
            const currentPass = task.routing?.reframePass || 1;
            const origObj = task.routing?.originalObjective || task.objective;
            const retryResult = reframeObjective(origObj, Math.max(currentPass, 1), incident.message || '', { providerId: task.providerId, ultraplinian: task.ultraplinian });
            return this.store.updateTask(id, current => {
              current.routing.cooldowns ||= {};
              delete current.routing.cooldowns[current.providerId];
              if (retryResult.reframed) current.objective = retryResult.objective;
              current.stallSignature = null; current.stallTurns = 0;
              return current;
            }, 'routing.reframe_retry', { providerId: task.providerId, pass: currentPass, level: retryResult.level, diagnosis: diagnosis.category, reason: 'No alternate fallback available; retrying with reframed objective.' });
          }
        }
        // Single-provider escape: if the task only has one provider and it has
        // probe progress, clear cooldowns and reset strategy attempts so the
        // model can keep iterating rather than blocking.
        const taskHasSingleProvider = task.providers.length <= 1;
        const hasProbeWins = (task.routing?.probeHighWater || 0) > 0;
        if (taskHasSingleProvider && hasProbeWins) {
          const escaped = this.store.updateTask(id, current => {
            current.routing.cooldowns = {};
            // Allow strategy cycling to restart by clearing attempts for this fingerprint
            current.routing.attempts = (current.routing.attempts || []).filter(a => a.fingerprint !== fingerprint);
            return current;
          }, 'routing.single_provider_escape', { reason: 'Single provider with probe progress; clearing cooldowns and strategy history to continue iteration.' });
          return escaped;
        }
        return this._status(id, epoch, 'blocked', { code: 'NO_ELIGIBLE_FALLBACK', message: 'No compatible untried route is available: candidates are unavailable, cooling down, or have exhausted these strategies. Review the recorded attempts and provider route.', lastIncident: incident });
      }
      const fromTier = providerTier(provider);
      const toTier = next.tier || providerTier(this.providers.get(next.id));
      const escalated = Boolean(next.escalated);
      if (escalated) {
        this.store.appendEvent(id, 'routing.escalated', { from: task.providerId, fromTier, to: next.id, toTier, diagnosis: diagnosis.category, reason: incident.code, score: next.score });
      }
      return this.store.updateTask(id, current => {
        current.providerId = next.id; current.providerIndex = current.providers.indexOf(next.id);
        current.routing.excursion = { providerId: next.id, from: task.providerId, category: diagnosis.category, startedCall: current.calls, snapshotHash: current.lastSnapshotHash, ...(escalated ? { escalated: true, fromTier, toTier } : {}) };
        current.stallSignature = null; current.stallTurns = 0;
        return current;
      }, 'model.switched', { from: task.providerId, to: next.id, reason: incident.code, diagnosis: diagnosis.category, score: next.score, samples: next.samples, confidence: next.confidence, ...(escalated ? { escalated: true, fromTier, toTier } : {}) });
    }
    const shouldSwitch = task.policy.mode === 'switch_model' || (task.policy.mode === 'hybrid' && task.recoveries % 2 === 0);
    if (shouldSwitch) {
      if (task.providers.length === 1 && task.policy.mode === 'switch_model') return this._status(id, epoch, 'blocked', { code: 'NO_FALLBACK', message: 'No alternate provider configured.' });
      if (task.providers.length > 1) this.store.updateTask(id, current => {
        current.providerIndex = (current.providerIndex + 1) % current.providers.length;
        current.providerId = current.providers[current.providerIndex]; return current;
      }, 'model.switched', current => ({ from: task.providerId, to: current.providerId, reason: incident.code }));
    }
  }
  pause(id) {
    // Crew pause fences each worker. Keep the parent's contract epoch stable so
    // resuming the same crew can continue its original budget and deadline.
    if (this.crew.busy(id)) { this.crew.pause(id); return this.getTask(id); }
    const task = this.getTask(id); if (terminal.has(task.status) && !this.runs.has(id)) return task;
    const changed = this.store.updateTask(id, current => { current.status = 'paused'; current.epoch += 1; return current; }, 'task.status', { status: 'paused' });
    this.runs.get(id)?.controller.abort(); return changed;
  }
  cancel(id) {
    this.crew.cancel(id);
    const task = this.getTask(id); if (terminal.has(task.status) && !this.runs.has(id)) return task;
    const changed = this.store.updateTask(id, current => { current.status = 'cancelled'; current.epoch += 1; return current; }, 'task.status', { status: 'cancelled' });
    this.runs.get(id)?.controller.abort(); return changed;
  }
  resume(id) {
    this.crew.assertIdle(id);
    const task = this.getTask(id);
    if (terminal.has(task.status) || active.has(task.status) || task.status === 'queued') return task;
    if (this.runs.has(id) || this.broker.locks.has(id)) throw fault('RUN_DRAINING', 'Workspace work is still settling; retry resume shortly.');
    return this.store.updateTask(id, current => { current.status = 'queued'; current.blocker = null; return current; }, 'task.status', { status: 'queued' });
  }
  updatePolicy(id, patch) {
    this.crew.assertIdle(id);
    const task = this.getTask(id);
    const policy = normalizePolicy(patch, task.policy);
    return this.store.updateTask(id, current => { current.policy = policy; return current; }, 'policy.updated', { policy });
  }
  _assertOwnerSettingsIdle(id) {
    if (this.closed) throw fault('RUNTIME_CLOSED', 'Runtime is closed.');
    this.crew.assertIdle(id);
    if (this.sourceChanges.busy(id)) throw fault('SOURCE_BUSY', 'Source changes are still settling.');
    const task = this.getTask(id);
    if (active.has(task.status)) throw fault('TASK_ACTIVE', 'Pause the task before changing owner settings.');
    if (this.runs.has(id) || this.broker.locks.has(id)) throw fault('RUN_DRAINING', 'Previous work is still settling.');
    if (task.status === 'cancelled') throw fault('TASK_TERMINAL', 'Cancelled task settings cannot change.');
    if (this.getOperations(id).some(operation => !['succeeded', 'failed'].includes(operation.status))) throw fault('OUTCOME_UNKNOWN', 'Reconcile unresolved operations before changing permissions or checks.');
    return task;
  }
  updateExecution(id, patch) {
    const task = this._assertOwnerSettingsIdle(id), execution = normalizeExecution(patch, task.execution);
    return this.store.updateTask(id, current => {
      current.execution = execution; current.epoch += 1; current.verification = null;
      if (current.status === 'completed') { current.status = 'paused'; current.completionKind = null; delete current.completedAt; delete current.acceptedSnapshotHash; }
      return current;
    }, 'execution.updated', { execution, source: 'owner' });
  }
  updateChecks(id, checks) {
    this._assertOwnerSettingsIdle(id); checks = normalizeChecks(checks);
    return this.store.updateTask(id, current => {
      current.checks = checks; current.checksContractVersion = current.contractVersion || 1; current.epoch += 1; current.verification = null;
      if (current.status === 'completed') { current.status = 'paused'; current.completionKind = null; delete current.completedAt; delete current.acceptedSnapshotHash; }
      return current;
    }, 'checks.updated', { checks, source: 'owner' });
  }
  updatePersona(id, persona) {
    this._assertOwnerSettingsIdle(id); persona = normalizePersona(persona);
    return this.store.updateTask(id, current => { current.persona = persona; return current; }, 'persona.updated', { persona, source: 'owner' });
  }
  _privacyFilteredProviders() {
    const settings = this.getPrivacy().settings;
    if (!settings.strictZdr && !settings.localOnly) return this.providers;
    const filtered = new Map();
    for (const [pid, provider] of this.providers.entries()) {
      if (checkProviderPrivacyAllowed(provider, settings).allowed) filtered.set(pid, provider);
    }
    return filtered;
  }
  getModelGroups({ sortBy = null, catalog = null } = {}) {
    const learning = this.getLearning();
    return buildModelGroups(this.providers, this.getPrivacy().settings, { sortBy, catalog, learning });
  }
  getOverseer() {
    const stored = this.store.getLocalState('overseerSettings', DEFAULT_OVERSEER_SETTINGS);
    let settings;
    try { settings = normalizeOverseerSettings(stored || DEFAULT_OVERSEER_SETTINGS); }
    catch { settings = { ...DEFAULT_OVERSEER_SETTINGS }; }
    const privacy = this.getPrivacy().settings;
    const availableProviders = [...this.providers.values()]
      .filter(p => p && p.kind !== 'scripted' && p.available !== false && !p.closed)
      .map(p => {
        const posture = classifyProviderZdr(p);
        const gate = checkProviderPrivacyAllowed(p, privacy);
        const suit = scoreOverseerSuitability(p);
        return {
          id: p.id, label: p.label, model: p.model || null, kind: p.kind,
          zdr: posture, allowedByPolicy: gate.allowed,
          suitabilityScore: suit.score, recommended: suit.recommended, suitabilityTag: suit.tag
        };
      })
      .sort((a, b) => Number(b.allowedByPolicy) - Number(a.allowedByPolicy) || b.suitabilityScore - a.suitabilityScore || a.id.localeCompare(b.id));
    const selected = settings.providerId ? availableProviders.find(p => p.id === settings.providerId) || null : null;
    const backup = settings.backupProviderId ? availableProviders.find(p => p.id === settings.backupProviderId) || null : null;
    const learning = this.getLearning();
    return {
      settings,
      ready: Boolean(settings.enabled && ((selected && selected.allowedByPolicy) || (backup && backup.allowedByPolicy))),
      selectedProvider: selected,
      backupProvider: backup,
      availableProviders,
      strategyStats: Array.isArray(learning?.strategyStats) ? learning.strategyStats.slice(0, 24) : [],
      refusalPatterns: Array.isArray(learning?.refusalPatterns) ? learning.refusalPatterns.slice(0, 32) : [],
      modelPreferences: learning?.modelPreferences || {}
    };
  }
  setModelPreference(providerId, signal, domain = null) {
    const learning = this.store.setModelPreference(providerId, signal, domain);
    return { modelPreferences: learning.modelPreferences || {}, domainElo: learning.domainElo || {} };
  }
  getBrowserSettings() {
    const stored = this.store.getLocalState('browser_settings', DEFAULT_BROWSER_SETTINGS);
    return normalizeBrowserSettings(stored, DEFAULT_BROWSER_SETTINGS);
  }
  updateBrowserSettings(patch = {}) {
    const next = normalizeBrowserSettings(patch, this.getBrowserSettings());
    this.store.setLocalState('browser_settings', next);
    if (!next.liveMirror) {
      this.broker?.browser?.stopAllScreencasts?.().catch(() => {});
    }
    return next;
  }
  async getBrowserInfo() {
    const settings = this.getBrowserSettings();
    const binary = await findChromiumBinary().catch(() => null);
    return { settings, chromiumAvailable: Boolean(binary) };
  }
  getRouterSettings() {
    const stored = this.store.getLocalState('router_settings', DEFAULT_ROUTER_SETTINGS);
    try { return normalizeRouterSettings(stored || DEFAULT_ROUTER_SETTINGS); }
    catch { return normalizeRouterSettings(DEFAULT_ROUTER_SETTINGS); }
  }
  updateRouterSettings(patch = {}) {
    const current = this.getRouterSettings();
    const next = normalizeRouterSettings(patch, current);
    this.store.setLocalState('router_settings', next);
    return next;
  }
  resetRouter() {
    this.store.setLocalState('router_settings', normalizeRouterSettings(DEFAULT_ROUTER_SETTINGS));
    this.store.resetDomainElo();
    return this.getRouterSettings();
  }
  async listRoutableCandidates(workspaceKind = 'conversation') {
    const privacy = this.getPrivacy().settings;
    const candidates = [];
    const seen = new Set();
    for (const p of this.providers.values()) {
      if (!p || p.kind === 'scripted' || p.available === false || p.closed) continue;
      if (!checkProviderPrivacyAllowed(p, privacy).allowed) continue;
      seen.add(p.id);
      candidates.push({ id: p.id, label: p.label, model: p.model, kind: p.kind, tier: p.tier, baseUrl: p.baseUrl, supportsFunctionCalling: p.modelMetadata?.supportsFunctionCalling !== undefined ? Boolean(p.modelMetadata.supportsFunctionCalling) : true, available: true });
    }
    if (workspaceKind === 'conversation' && this.catalog) {
      const catList = await this.catalog.list().catch(() => null);
      if (catList?.connected && Array.isArray(catList.models)) {
        for (const m of catList.models) {
          if (!m?.id || seen.has(m.id)) continue;
          const choice = this.catalog.get(m.id);
          if (!choice || !checkProviderPrivacyAllowed(choice, privacy).allowed) continue;
          seen.add(m.id);
          candidates.push({ id: m.id, label: m.label || m.model, model: m.model, kind: 'catalog', tier: choice.tier || 'standard', baseUrl: choice.baseUrl, supportsFunctionCalling: Boolean(choice.supportsFunctionCalling), available: true });
        }
      }
    }
    return candidates;
  }
  async previewUltraRoute({ objective = '', files = [], attachments = [], workspaceKind = 'conversation', settings = null } = {}) {
    const candidates = await this.listRoutableCandidates(workspaceKind);
    const activeSettings = settings ? normalizeRouterSettings(settings, this.getRouterSettings()) : this.getRouterSettings();
    return routeUltraPlinian({
      objective,
      files,
      attachments,
      candidates,
      learning: this.getLearning(),
      settings: activeSettings
    });
  }
  async resolveTaskMetacognition({ objective = '', decision = null, providerId = null, effort = 'medium', workspaceKind = 'conversation', files = [], attachments = [], modeOverride = null, signal = null } = {}) {
    const routerSettings = this.getRouterSettings();
    const mode = normalizeMetacognitionMode(modeOverride ?? routerSettings.metacognition ?? 'smart');
    if (mode === 'off') return null;
    const text = String(objective || '').trim();
    if (!text) return null;
    const cls = decision?.domain
      ? { primaryDomain: decision.domain, secondaryDomain: decision.secondaryDomain || null, refusalRisk: decision.refusalRisk || 0 }
      : classifyPromptDomain(text, { files, attachments });
    const privacy = this.getPrivacy().settings;
    const isEligibleArchitect = (p) => Boolean(p && p.kind !== 'scripted' && p.available !== false && !p.closed && (typeof p.draft === 'function' || typeof p.turn === 'function') && checkProviderPrivacyAllowed(p, privacy).allowed);
    const rawTarget = providerId ? (this.providers.get(providerId) || this.catalog?.get?.(providerId) || null) : null;
    const targetProvider = isEligibleArchitect(rawTarget) ? rawTarget : null;
    const modelFamily = detectModelFamily(rawTarget || providerId || '');
    if (shouldAutoForge({ objective: text, domain: cls.primaryDomain, effort, isFirstTurn: true, mode })) {
      const overseer = this._resolveOverseer?.();
      const architect = (isEligibleArchitect(overseer?.provider) ? overseer.provider : null)
        || targetProvider
        || [...this.providers.values()].find(isEligibleArchitect)
        || null;
      return forgeTaskMegaprompt({
        objective: text,
        domain: cls.primaryDomain,
        modelFamily,
        targetProvider: rawTarget,
        architectProvider: architect,
        effort,
        workspaceKind,
        files,
        attachments,
        signal,
        outbound: this.outboundOptions()
      });
    }
    return buildDomainMetacognition({
      domain: cls.primaryDomain,
      secondaryDomain: cls.secondaryDomain,
      refusalRisk: cls.refusalRisk,
      modelFamily,
      effort,
      workspaceKind,
      providerLabel: rawTarget?.label || providerId || null
    });
  }
  async forgeMetapromptPreview({ objective = '', domain = null, providerId = null, effort = 'medium', workspaceKind = 'conversation' } = {}) {
    const text = String(objective || '').trim();
    if (!text) throw fault('INVALID_MESSAGE', 'Provide a prompt to forge.');
    if (domain !== null && domain !== undefined && domain !== '' && !ROUTER_DOMAINS.some(d => d.id === domain)) {
      throw fault('INVALID_DOMAIN', `Unknown domain: ${String(domain).slice(0, 64)}`);
    }
    const privacy = this.getPrivacy().settings;
    const isEligibleArchitect = (p) => Boolean(p && p.kind !== 'scripted' && p.available !== false && !p.closed && (typeof p.draft === 'function' || typeof p.turn === 'function') && checkProviderPrivacyAllowed(p, privacy).allowed);
    const rawTarget = providerId ? (this.providers.get(providerId) || this.catalog?.get?.(providerId) || null) : null;
    const targetProvider = isEligibleArchitect(rawTarget) ? rawTarget : null;
    const overseer = this._resolveOverseer?.();
    const architect = (isEligibleArchitect(overseer?.provider) ? overseer.provider : null)
      || targetProvider
      || [...this.providers.values()].find(isEligibleArchitect)
      || null;
    return forgeTaskMegaprompt({
      objective: text,
      domain: domain || null,
      modelFamily: detectModelFamily(rawTarget || architect || ''),
      targetProvider: rawTarget,
      architectProvider: architect,
      effort,
      workspaceKind,
      outbound: this.outboundOptions()
    });
  }
  async getConclaveRoster() {
    const candidates = await this.listRoutableCandidates('conversation');
    const harnesses = await detectExternalHarnesses({ providers: this.providers, catalog: this.catalog });
    const routerSettings = this.getRouterSettings();
    const matrix = loadBenchmarkMatrix(routerSettings.customBenchmarks || {});
    const learning = this.getLearning();
    const byId = new Map(candidates.map(c => [c.id, c]));
    const harnessById = new Map(harnesses.map(h => [h.id, h]));

    const savedRaw = this.store.getLocalState('conclave_roster', []);
    const savedList = Array.isArray(savedRaw) ? savedRaw : [];
    const xpMap = this.store.getLocalState('conclave_agent_xp', {});
    const starters = buildStarterRoster(candidates, harnesses);
    const mergedMap = new Map();
    for (const s of starters) mergedMap.set(s.slug, s);
    for (const custom of savedList) {
      if (!custom?.slug) continue;
      mergedMap.set(custom.slug, { ...mergedMap.get(custom.slug), ...custom, custom: true });
    }

    const enrichAgent = (ag) => {
      const h = ag.harnessId ? harnessById.get(ag.harnessId) : null;
      const resolvedProvId = ag.providerId || h?.providerId || null;
      const cand = resolvedProvId ? (byId.get(resolvedProvId) || this.providers.get(resolvedProvId) || this.catalog?.get?.(resolvedProvId) || null) : null;
      const stats = computeAgentStats({
        candidate: cand,
        harnessId: ag.harnessId,
        primarySpecialty: ag.primarySpecialty,
        secondarySpecialty: ag.secondarySpecialty,
        matrix,
        learning
      });
      const xp = computeXpLevel(xpMap?.[ag.slug] || null);
      const engineLabel = cand?.label || (h ? h.name : ag.harnessCommand ? `CLI · ${ag.harnessCommand}` : 'Auto-Route Best Fit');
      const ready = Boolean(cand) || Boolean(h && (h.status === 'connected' || h.status === 'installed')) || Boolean(!ag.providerId && !ag.harnessId && candidates.length > 0);
      return { ...ag, resolvedProviderId: resolvedProvId, engineLabel, ready, stats, xp };
    };

    const engines = candidates.slice(0, 60).map(c => ({
      id: c.id,
      label: c.label,
      model: c.model,
      kind: c.kind,
      tier: c.tier || 'standard',
      stats: computeAgentStats({ candidate: c, matrix, learning })
    }));

    return {
      agents: [...mergedMap.values()].map(enrichAgent),
      formations: this.getConclaveFormations(),
      harnesses,
      engines,
      archetypes: AGENT_ARCHETYPES,
      domains: ROUTER_DOMAINS
    };
  }
  recordConclaveAgentRun(rawSlug, { ok = true, durationMs = 0, mvp = false } = {}) {
    try {
      const slug = slugifyAgent(rawSlug || 'explore');
      const map = { ...(this.store.getLocalState('conclave_agent_xp', {}) || {}) };
      const cur = map[slug] || { runs: 0, wins: 0, mvps: 0, xp: 0, avgMs: 0, lastRunAt: null };
      const runs = (Number(cur.runs) || 0) + 1;
      const wins = (Number(cur.wins) || 0) + (ok ? 1 : 0);
      const mvps = (Number(cur.mvps) || 0) + (mvp ? 1 : 0);
      const xpGain = (ok ? 25 : 5) + (mvp ? 20 : 0);
      const prevAvg = Number(cur.avgMs) || 0;
      const dur = Math.max(0, Number(durationMs) || 0);
      const avgMs = prevAvg > 0 && dur > 0 ? Math.round((prevAvg * (runs - 1) + dur) / runs) : (dur || prevAvg);
      map[slug] = { runs, wins, mvps, xp: (Number(cur.xp) || 0) + xpGain, avgMs, lastRunAt: new Date().toISOString() };
      this.store.setLocalState('conclave_agent_xp', map);
      return computeXpLevel(map[slug]);
    } catch {
      return computeXpLevel(null);
    }
  }
  getConclaveFormations() {
    const savedRaw = this.store.getLocalState('conclave_formations', []);
    const saved = Array.isArray(savedRaw) ? savedRaw : [];
    const merged = new Map();
    for (const f of STARTER_FORMATIONS) merged.set(f.id, { ...f });
    for (const f of saved) {
      if (!f?.id) continue;
      merged.set(f.id, { ...merged.get(f.id), ...f, custom: true });
    }
    return [...merged.values()];
  }
  saveConclaveFormation(payload = {}) {
    const savedRaw = this.store.getLocalState('conclave_formations', []);
    const list = Array.isArray(savedRaw) ? [...savedRaw] : [];
    const targetId = slugifyAgent(payload.id || payload.name);
    const idx = list.findIndex(f => f?.id === targetId);
    const normalized = normalizeFormation(payload, idx >= 0 ? list[idx] : null);
    if (idx >= 0) list[idx] = normalized;
    else list.push(normalized);
    this.store.setLocalState('conclave_formations', list.slice(0, 24));
    return { ok: true, formation: normalized, formations: this.getConclaveFormations() };
  }
  deleteConclaveFormation(rawId) {
    const id = slugifyAgent(rawId);
    const savedRaw = this.store.getLocalState('conclave_formations', []);
    const list = Array.isArray(savedRaw) ? savedRaw : [];
    const next = list.filter(f => f?.id !== id);
    this.store.setLocalState('conclave_formations', next);
    return { ok: true, deleted: next.length !== list.length, id, formations: this.getConclaveFormations() };
  }
  async saveConclaveAgent(payload = {}) {
    const savedRaw = this.store.getLocalState('conclave_roster', []);
    const list = Array.isArray(savedRaw) ? [...savedRaw] : [];
    const targetSlug = slugifyAgent(payload.slug || payload.name);
    const existingIdx = list.findIndex(a => a?.slug === targetSlug);
    const normalized = normalizeRosterAgent(payload, existingIdx >= 0 ? list[existingIdx] : null);
    if (existingIdx >= 0) list[existingIdx] = normalized;
    else list.push(normalized);
    this.store.setLocalState('conclave_roster', list.slice(0, 48));
    const roster = await this.getConclaveRoster();
    const saved = roster.agents.find(a => a.slug === normalized.slug) || normalized;
    return { ok: true, agent: saved, roster };
  }
  async deleteConclaveAgent(rawSlug) {
    const slug = slugifyAgent(rawSlug);
    const savedRaw = this.store.getLocalState('conclave_roster', []);
    const list = Array.isArray(savedRaw) ? savedRaw : [];
    const next = list.filter(a => a?.slug !== slug);
    this.store.setLocalState('conclave_roster', next);
    const roster = await this.getConclaveRoster();
    return { ok: true, deleted: next.length !== list.length, slug, roster };
  }
  async previewConclaveStats({ providerId = null, harnessId = null, primarySpecialty = 'swe_coding', secondarySpecialty = 'math_reasoning' } = {}) {
    const candidates = await this.listRoutableCandidates('conversation');
    const routerSettings = this.getRouterSettings();
    const matrix = loadBenchmarkMatrix(routerSettings.customBenchmarks || {});
    const learning = this.getLearning();
    let cand = providerId ? (candidates.find(c => c.id === providerId) || this.providers.get(providerId) || this.catalog?.get?.(providerId) || null) : null;
    if (!cand && harnessId) {
      const h = EXTERNAL_HARNESSES.find(x => x.id === harnessId);
      if (h) {
        cand = candidates.find(c => (h.providerPrefix && c.id.startsWith(h.providerPrefix)) || (h.providerRegex && h.providerRegex.test(`${c.id} ${c.model || ''} ${c.label || ''}`))) || h.benchmarkProbe;
      }
    }
    const stats = computeAgentStats({ candidate: cand, harnessId, primarySpecialty, secondarySpecialty, matrix, learning });
    // Also suggest the strongest connected engine for these specialties!
    let bestEngine = null;
    if (candidates.length) {
      const ranked = candidates.map(c => ({
        id: c.id,
        label: c.label,
        overall: computeAgentStats({ candidate: c, primarySpecialty, secondarySpecialty, matrix, learning }).overall
      })).sort((a, b) => b.overall - a.overall);
      bestEngine = ranked[0] || null;
    }
    return { stats, bestEngine };
  }
  async getRouterState() {
    const settings = this.getRouterSettings();
    const candidates = await this.listRoutableCandidates('conversation');
    const learning = this.getLearning();
    const benchmarks = loadBenchmarkMatrix(settings.customBenchmarks);
    const leaderboards = buildDomainLeaderboards({ candidates, learning, settings });
    return {
      settings,
      domains: ROUTER_DOMAINS,
      benchmarks,
      leaderboards,
      domainElo: learning?.domainElo || {},
      candidateCount: candidates.length
    };
  }
  deleteRefusalPattern(signature = null) {
    const learning = this.store.deleteRefusalPattern(signature);
    return { refusalPatterns: learning.refusalPatterns || [] };
  }
  updateOverseer(patch = {}) {
    const current = this.getOverseer().settings;
    const next = normalizeOverseerSettings(patch, current);
    this.store.setLocalState('overseerSettings', next);
    return this.getOverseer();
  }
  _resolveOverseer() {
    const stored = this.store.getLocalState('overseerSettings', DEFAULT_OVERSEER_SETTINGS);
    let settings;
    try { settings = normalizeOverseerSettings(stored || DEFAULT_OVERSEER_SETTINGS); }
    catch { return null; }
    if (!settings.enabled || !settings.providerId) return null;
    const privacy = this.getPrivacy().settings;
    const isUsable = p => p && p.kind !== 'scripted' && p.available !== false && !p.closed && checkProviderPrivacyAllowed(p, privacy).allowed;
    const primary = this.providers.get(settings.providerId);
    const explicitBackup = settings.backupProviderId ? this.providers.get(settings.backupProviderId) : null;
    // Build resilient failover chain: primary -> explicit backup (e.g. Hermes-4-405B / Venice Uncensored) -> any other high-agency recommended local/ZDR model
    const autoBackups = [...this.providers.values()]
      .filter(p => isUsable(p) && p.id !== settings.providerId && p.id !== settings.backupProviderId && scoreOverseerSuitability(p).recommended)
      .sort((a, b) => scoreOverseerSuitability(b).score - scoreOverseerSuitability(a).score)
      .slice(0, 2);
    const chain = [
      ...(isUsable(primary) ? [primary] : []),
      ...(isUsable(explicitBackup) ? [explicitBackup] : []),
      ...autoBackups
    ];
    if (!chain.length) return null;
    return { settings, provider: chain[0], backupProviders: chain.slice(1) };
  }
  async reportRefusal(id, { message } = {}) {
    if (this.closed) throw fault('RUNTIME_CLOSED', 'Runtime is closed.');
    const task = this.getTask(id);
    if (active.has(task.status) || this.runs.has(id)) throw fault('TASK_RUNNING', 'Wait for the current turn to finish before flagging a refusal.');
    const provider = this.selectedProvider(task.providerId, task.workspaceKind);
    const providerKey = providerIdentity(task.providerId, provider || {});
    if (task.policy?.learning !== false) {
      this.store.recordLearning(`${id}:${task.contractVersion || 1}:owner_refusal:${task.calls}:${providerKey}`, [{
        providerId: task.providerId,
        providerKey,
        category: 'content_restriction',
        outcome: 'failure'
      }]);
      const latestText = this.store.latestModelResponse(id)?.text;
      const sig = extractDeclineSignature(latestText);
      if (sig) this.store.recordRefusalPattern({ signature: sig, source: 'owner_reported', providerId: task.providerId });
    }
    const prepared = this.store.updateTask(id, current => {
      current.epoch += 1;
      current.status = 'running';
      current.blocker = null;
      current.completionKind = null;
      delete current.completedAt;
      delete current.replyOutcome;
      if (current.policy?.mode === 'ask') current.policy = { ...current.policy, mode: 'adaptive' };
      if ((current.policy?.maxAttempts || 0) <= current.recoveries) {
        current.policy = { ...current.policy, maxAttempts: Math.min(100, current.recoveries + 3) };
      }
      if ((current.policy?.maxCalls || 0) <= current.calls) {
        current.policy = { ...current.policy, maxCalls: Math.min(5000, current.calls + 25) };
      }
      return current;
    }, 'owner.refusal_reported', { providerId: task.providerId, reason: String(message || 'Owner flagged response as a missed refusal.').slice(0, 400) });
    try {
      await this._recover(id, prepared.epoch, {
        code: 'CONTENT_RESTRICTION',
        kind: 'refusal',
        source: 'owner_reported',
        message: String(message || 'Owner flagged previous response as a missed refusal; switching model or reframing.').slice(0, 500),
        retryable: true
      });
    } catch (err) {
      try { this.store.updateTask(id, current => { if (current.status === 'running' || current.status === 'recovering') current.status = 'paused'; return current; }); } catch {}
      throw err;
    }
    const after = this.getTask(id);
    if (after.status === 'recovering' || after.status === 'running') {
      return this.store.updateTask(id, current => { current.status = 'queued'; return current; });
    }
    return after;
  }
  getPrivacy() {
    const stored = this.store.getLocalState('privacySettings', DEFAULT_PRIVACY_SETTINGS);
    let settings;
    try { settings = normalizePrivacySettings(stored || DEFAULT_PRIVACY_SETTINGS); }
    catch { settings = { ...DEFAULT_PRIVACY_SETTINGS }; }
    const providers = [...this.providers.values()].map(provider => {
      const posture = classifyProviderZdr(provider);
      const gate = checkProviderPrivacyAllowed(provider, settings);
      return {
        id: provider.id,
        label: provider.label,
        kind: provider.kind,
        tier: provider.tier || 'standard',
        available: provider.available !== false,
        ...posture,
        allowedByPolicy: gate.allowed
      };
    });
    return {
      telemetry: TELEMETRY_POLICY,
      profiles: SECURITY_PROFILES,
      settings,
      providers,
      audit: this.outboundAudit.list()
    };
  }
  outboundOptions() {
    return { privacy: this.getPrivacy().settings, extraSecrets: this.outboundSecrets(),
      onOutbound: entry => this.outboundAudit.record(entry) };
  }
  updatePrivacy(patch = {}) {
    const current = this.getPrivacy().settings;
    const next = normalizePrivacySettings(patch, current);
    this.store.setLocalState('privacySettings', next);
    const appliedPreset = patch?.applyProfile && SECURITY_PROFILES[patch.applyProfile]?.permissionPreset;
    if (appliedPreset && PERMISSION_PRESETS[appliedPreset]) {
      this.updateGlobalPermissions([...PERMISSION_PRESETS[appliedPreset]]);
    }
    return { ...this.getPrivacy(), permissions: this.getGlobalPermissions() };
  }
  clearOutboundAudit() {
    this.outboundAudit.clear();
    return this.getPrivacy();
  }
  async burnSession({ includeTasks = false } = {}) {
    this.outboundAudit.clear();
    this.resetLearning();
    this.deleteRefusalPattern(null);
    await this.broker.browser.closeAll().catch(() => {});
    let tasksPurged = 0;
    if (includeTasks === true) {
      for (const task of this.listTasks()) {
        if (active.has(task.status) || this.runs.has(task.id) || this.crew.busy(task.id)) continue;
        try {
          await this.purgeTask(task.id);
          tasksPurged += 1;
        } catch {}
      }
    }
    return {
      burned: true,
      cleared: { audit: true, learning: true, browsers: true, tasksPurged },
      privacy: this.getPrivacy(),
      overseer: this.getOverseer(),
    };
  }
  getTransparencyConfig() {
    const stored = this.store.getLocalState('promptTransparency', DEFAULT_TRANSPARENCY_CONFIG);
    try { return normalizeTransparencyConfig({}, stored || DEFAULT_TRANSPARENCY_CONFIG); }
    catch { return normalizeTransparencyConfig({}, DEFAULT_TRANSPARENCY_CONFIG); }
  }
  getTransparency(taskId = null) {
    const config = this.getTransparencyConfig();
    let task = null;
    let activeTools = null;
    if (taskId) {
      try {
        task = this.getTask(taskId);
        activeTools = taskTools(task).map(({ name, description, parameters }) => ({ name, description, parameters }));
      } catch { task = null; }
    }
    return buildTransparencySnapshot(config, { task, activeTools });
  }
  updateTransparency(patch = {}, taskId = null) {
    const current = this.getTransparencyConfig();
    const next = normalizeTransparencyConfig(patch, current);
    this.store.setLocalState('promptTransparency', next);
    return this.getTransparency(taskId);
  }
  resetTransparency({ scope = 'all', promptId = null, toolName = null, taskId = null } = {}) {
    const current = this.getTransparencyConfig();
    let next = current;
    if (promptId) {
      next = normalizeTransparencyConfig({ prompts: { [promptId]: null } }, current);
    } else if (toolName) {
      next = normalizeTransparencyConfig({ tools: { [toolName]: null } }, current);
    } else if (scope === 'prompts') {
      next = { ...current, prompts: {} };
    } else if (scope === 'tools') {
      next = { ...current, tools: {} };
    } else if (scope === 'injections') {
      next = { ...current, injections: { ...DEFAULT_TRANSPARENCY_CONFIG.injections } };
    } else {
      next = normalizeTransparencyConfig({}, DEFAULT_TRANSPARENCY_CONFIG);
    }
    this.store.setLocalState('promptTransparency', next);
    return this.getTransparency(taskId);
  }
  async purgeTask(id) {
    if (this.closed) throw fault('RUNTIME_CLOSED', 'Runtime is closed.');
    const task = this.getTask(id);
    if (task.crewMember) throw fault('CREW_MEMBER', 'Purge crew workers through their parent conversation.');
    if (task.codeWorkspace) throw fault('WORKTREE_ATTACHED', 'Remove this chat’s GodCode worktree before deleting the chat.');
    if (this.store.listTasks().some(child => child.crewMember?.parentId === id))
      throw fault('CREW_HISTORY', 'This chat still owns crew workspaces and cannot be deleted independently.');
    this.crew.assertIdle(id);
    if (this.sourceChanges.busy(id)) throw fault('SOURCE_BUSY', 'Source changes are still settling.');
    if (active.has(task.status) || this.runs.has(id) || this.broker.locks.has(id)) {
      throw fault('TASK_ACTIVE', 'Pause and settle the task before purging it.');
    }
    const result = this.store.purgeTask(id);
    this._streamSubs.delete(id);
    for (const key of [...this._workerSteers.keys()]) {
      if (key.startsWith(`${id}:`)) this._workerSteers.delete(key);
    }
    await this.broker.browser.closeSession(id, { resetPreferences: true }).catch(() => {});
    // Only delete workspaces created inside this runtime's managed workspaces directory.
    let managedRoot = resolve(this.store.dataDir, 'workspaces') + sep;
    try { managedRoot = (await fs.realpath(resolve(this.store.dataDir, 'workspaces'))) + sep; } catch {}
    let ws = task.workspace ? resolve(task.workspace) : '';
    try { if (ws) ws = await fs.realpath(ws); } catch {}
    let workspaceDeleted = false, workspaceError = null;
    if (ws && ws.startsWith(managedRoot)) {
      try { await fs.rm(ws, { recursive: true, force: true }); workspaceDeleted = true; }
      catch { workspaceError = 'The chat was deleted, but its managed workspace could not be removed.'; }
    }
    return { ok: true, id, deleted: result.deleted, workspaceDeleted, workspaceError };
  }
  getGlobalPermissions() {
    const stored = this.store.getLocalState('permissionRules', [...DEFAULT_SAFE_PRESET]);
    return {
      rules: Array.isArray(stored) ? stored : [...DEFAULT_SAFE_PRESET],
      presets: PERMISSION_PRESETS,
      defaultSafePreset: DEFAULT_SAFE_PRESET
    };
  }
  updateGlobalPermissions(rules) {
    const validated = validatePermissionRules(rules);
    this.store.setLocalState('permissionRules', validated);
    return {
      rules: validated,
      presets: PERMISSION_PRESETS,
      defaultSafePreset: DEFAULT_SAFE_PRESET
    };
  }
  updatePermissions(id, rules) {
    this._assertOwnerSettingsIdle(id);
    const validated = rules === null ? null : validatePermissionRules(rules);
    return this.store.updateTask(id, current => {
      current.permissionRules = validated;
      return current;
    }, 'permissions.updated', { permissionRules: validated, source: 'owner' });
  }
  resolveApproval(id, { decision, resume = true } = {}) {
    if (this.closed) throw fault('RUNTIME_CLOSED', 'Runtime is closed.');
    this.crew.assertIdle(id);
    if (!['once', 'always', 'always_pattern', 'deny'].includes(decision)) {
      throw fault('INVALID_APPROVAL', 'Approval decision must be "once", "always", "always_pattern", or "deny".');
    }
    const existing = this.getTask(id);
    if (!existing.pendingApproval) {
      throw fault('NO_PENDING_APPROVAL', 'This task has no pending tool approval.');
    }
    if (active.has(existing.status)) {
      throw fault('TASK_ACTIVE', 'Task is currently active.');
    }
    const approval = existing.pendingApproval;
    const now = new Date().toISOString();
    const updated = this.store.updateTask(id, current => {
      if (!current.pendingApproval) throw fault('NO_PENDING_APPROVAL', 'This task has no pending tool approval.');
      const effectiveBefore = this._effectivePermissionRules(current);
      current.pendingApproval = null;
      if (current.blocker?.code === 'APPROVAL_REQUIRED') current.blocker = null;
      if (decision === 'once') {
        current.approvedOnceCall = { tool: approval.tool, argsHash: sha256(stableJson(approval.args || {})), approvedAt: now };
      } else if (decision === 'always') {
        const nextRules = Array.isArray(current.permissionRules) ? [...current.permissionRules] : [...effectiveBefore];
        const allowRule = {
          tool: approval.tool,
          argsHash: sha256(stableJson(approval.args || {})),
          action: 'allow',
          reason: 'Approved exact arguments for this task'
        };
        current.permissionRules = insertTaskAllowRule(nextRules, allowRule);
      } else if (decision === 'always_pattern') {
        const derived = approval.suggestedPattern || derivePatternRule(approval.tool, approval.args || {});
        const nextRules = Array.isArray(current.permissionRules) ? [...current.permissionRules] : [...effectiveBefore];
        const allowRule = derived
          ? { tool: derived.tool, pattern: derived.pattern, action: 'allow', reason: `Approved "${derived.label}" for this task` }
          : { tool: approval.tool, argsHash: sha256(stableJson(approval.args || {})), action: 'allow', reason: 'Approved exact arguments for this task' };
        current.permissionRules = insertTaskAllowRule(nextRules, allowRule);
      }
      return current;
    }, 'permission.resolved', {
      approvalId: approval.id,
      callId: approval.callId,
      tool: approval.tool,
      target: approval.target || '',
      decision,
      source: 'owner',
      ...(decision === 'deny' ? { guidance: 'The owner denied this tool call. Choose a different approach or explain what is blocked.' } : {})
    });
    if (decision === 'deny') {
      this._recordInterceptedToolError(
        id,
        { id: approval.callId || approval.id, name: approval.tool, args: approval.args || {} },
        updated.epoch,
        'PERMISSION_DENIED',
        'The owner denied this tool call. Choose a different approach or explain what is blocked.'
      );
    }
    this._emitStream(id, { type: 'permission.resolved', approvalId: approval.id, tool: approval.tool, decision });
    let resumed = false;
    let finalTask = this.getTask(id);
    if (resume !== false) {
      if (!this.runs.has(id)) {
        finalTask = this.resume(id);
        resumed = true;
        this.run(id).catch(() => {});
      } else {
        // Handle synchronous subscribeStream race where _run() emitted permission.requested right before run().finally() deletes this.runs.
        const activeRun = this.runs.get(id);
        resumed = true;
        activeRun?.promise?.finally(() => {
          if (this.closed || this.runs.has(id)) return;
          try {
            const cur = this.getTask(id);
            if (cur.status === 'paused' && !cur.pendingApproval) {
              this.resume(id);
              this.run(id).catch(() => {});
            }
          } catch {}
        });
      }
    }
    return { task: finalTask, resumed };
  }
  renameTask(id, title) {
    if (this.closed) throw fault('RUNTIME_CLOSED', 'Runtime is closed.');
    if (typeof title !== 'string' || !title.trim() || title.trim().length > 200 || /[\0\r\n]/.test(title)) {
      throw fault('INVALID_TITLE', 'Title must be a single-line string of 1–200 characters.');
    }
    const clean = title.trim();
    const existing = this.getTask(id);
    if (existing.title === clean) return existing;
    return this.store.updateTask(id, current => {
      current.title = clean;
      return current;
    }, 'task.renamed', { from: existing.title || '', to: clean, source: 'owner' });
  }
  async forkTask(id, { title, fromHash } = {}) {
    if (this.closed) throw fault('RUNTIME_CLOSED', 'Runtime is closed.');
    const source = this.getTask(id);
    if (source.crewMember) throw fault('CREW_MEMBER', 'Control crew workers through their parent conversation.');
    this.crew.assertIdle(id);
    if (this.sourceChanges.busy(id)) throw fault('SOURCE_BUSY', 'Source changes are still settling.');
    if (active.has(source.status)) throw fault('TASK_ACTIVE', 'Pause the task before forking.');
    if (this.runs.has(id) || this.broker.locks.has(id)) throw fault('RUN_DRAINING', 'Previous work is still settling; retry fork shortly.');
    if (title !== undefined && (typeof title !== 'string' || title.trim().length > 200 || /[\0\r\n]/.test(title))) {
      throw fault('INVALID_TASK', 'Fork title must be a single-line string of at most 200 characters.');
    }
    if (fromHash !== undefined && fromHash !== null && fromHash !== '') {
      if (typeof fromHash !== 'string' || !/^[0-9a-f]{7,40}$/i.test(fromHash.trim())) {
        throw fault('INVALID_REWIND', 'Fork checkpoint hash must be 7–40 hexadecimal characters.');
      }
    }
    const newWorkspace = join(this.store.dataDir, 'workspaces', randomUUID());
    await copyWorkspaceSafely(source.workspace, newWorkspace);
    try {
      let forkedFromHash = null;
      const headInfo = await hasGit(newWorkspace) ? (await gitCheckpoints(newWorkspace, { limit: 1 }))[0] : null;
      if (fromHash !== undefined && fromHash !== null && fromHash !== '') {
        const needle = fromHash.trim().toLowerCase();
        if (headInfo && (headInfo.hash.toLowerCase() === needle || headInfo.hash.toLowerCase().startsWith(needle))) {
          forkedFromHash = headInfo.hash;
        } else {
          const rewound = await gitRewind(newWorkspace, { hash: needle });
          forkedFromHash = rewound.hash;
        }
      } else {
        forkedFromHash = headInfo?.hash || null;
      }

      const recentEvents = this.getRecentEvents(id, 30);
      const lastModelMsg = recentEvents.findLast(e => e.type === 'model.response' && e.data?.response?.type === 'message' && e.data.response.text)?.data?.response?.text?.slice(0, 400) || null;
      const recentTools = recentEvents.filter(e => e.type === 'tool.completed').slice(-6).map(e => ({
        name: e.data?.name,
        ok: e.data?.result?.ok !== false && e.data?.status !== 'failed'
      }));
      const forkTitle = (typeof title === 'string' && title.trim()) ? title.trim() : `${source.title} (fork)`.slice(0, 200);
      const created = await this.createTask({
        title: forkTitle,
        objective: source.objective,
        constraints: structuredClone(source.constraints || []),
        workspace: newWorkspace,
        workspaceKind: source.workspaceKind,
        providers: [...source.providers],
        policy: structuredClone(source.policy),
        execution: structuredClone(source.execution),
        checks: structuredClone(source.checks || []),
        persona: source.persona,
        effort: source.effort || 'medium',
        generation: structuredClone(source.generation || {}),
        answerRace: structuredClone(source.answerRace || null),
        planMode: Boolean(source.planMode),
        fixtureId: source.fixtureId || null,
        acceptance: structuredClone(source.acceptance || null),
        ...(Array.isArray(source.permissionRules) ? { permissionRules: structuredClone(source.permissionRules) } : {}),
        todos: Array.isArray(source.todos) ? structuredClone(source.todos) : []
      });
      this.store.copyConversationHistory(created.id, activeHistory(source, this.getEvents(id)));
      const preserveCompleted = source.workspaceKind === 'conversation' && source.status === 'completed';
      return this.store.updateTask(created.id, current => {
        current.status = preserveCompleted ? 'completed' : 'paused';
        if (preserveCompleted) {
          current.completionKind = source.completionKind || 'answered';
          current.completedAt = new Date().toISOString();
        }
        current.parentTaskId = source.id;
        current.forkedFromHash = forkedFromHash;
        if (source.sourcePath) current.sourcePath = source.sourcePath;
        if (source.importManifest) current.importManifest = structuredClone(source.importManifest);
        if (Array.isArray(source.followups) && source.followups.length) {
          current.followups = structuredClone(source.followups);
          current.contractVersion = source.contractVersion || 1;
          current.checksContractVersion = source.checksContractVersion || 1;
        }
        return current;
      }, 'task.forked', {
        parentTaskId: source.id,
        parentTitle: source.title,
        forkedFromHash,
        objective: source.objective.slice(0, 500),
        recentProgress: {
          parentStatus: source.status,
          parentCalls: source.calls,
          lastSummary: lastModelMsg,
          recentTools
        },
        source: 'owner'
      });
    } catch (cause) {
      await fs.rm(newWorkspace, { recursive: true, force: true }).catch(() => {});
      throw cause;
    }
  }
  async exportTranscript(id) {
    const task = this.getTask(id);
    const events = this.getEvents(id);
    const operations = this.getOperations(id);
    const diffStat = await hasGit(task.workspace) ? await gitDiffSummary(task.workspace) : '';
    return formatTranscript({ task, events, operations, diffStat });
  }
  async commitWorkspace(id, { message = 'checkpoint' } = {}) {
    const task = this._assertOwnerSettingsIdle(id);
    const rawMsg = message === undefined || message === null || message === '' ? 'checkpoint' : message;
    if (typeof rawMsg !== 'string' || !rawMsg.trim() || rawMsg.trim().length > 500 || rawMsg.includes('\0')) {
      throw fault('INVALID_COMMIT', 'Commit message must be 1–500 characters.');
    }
    const cleanMsg = rawMsg.trim();
    const result = await gitCommit(task.workspace, { message: cleanMsg });
    if (result.committed) {
      this.store.appendEvent(id, 'git.checkpoint', { hash: result.hash, message: cleanMsg, summary: result.summary, source: 'owner' });
    }
    const checkpoints = await gitCheckpoints(task.workspace, { limit: 25 });
    return { ok: true, committed: result.committed, hash: result.hash, summary: result.summary, checkpoints };
  }
  _selectCompactionProvider(task, preferred = null) {
    const privacy = this.getPrivacy().settings;
    const candidates = [];
    const overseer = this._resolveOverseer();
    if (overseer?.provider) candidates.push(overseer.provider);
    if (preferred) candidates.push(preferred);
    const activeProv = this.selectedProvider(task?.providerId, task?.workspaceKind) || this.providers.get(task?.providerId);
    if (activeProv) candidates.push(activeProv);
    const seen = new Set();
    for (const cand of candidates) {
      if (!cand || seen.has(cand.id)) continue;
      seen.add(cand.id);
      if (cand.available === false || cand.closed || cand.kind === 'scripted') continue;
      const gate = checkProviderPrivacyAllowed(cand, privacy);
      if (gate.allowed) return cand;
    }
    return null;
  }
  _buildWorkingSummary(task, snapshot, events = [], reason = 'owner', { semantic = null, keepTail = COMPACTION_KEEP_TAIL_EVENTS } = {}) {
    const active = activeHistory(task, events);
    const prevSummary = task.workingSummary || null;
    const prevWatermark = Number.isInteger(prevSummary?.compactedBeforeSeq) ? prevSummary.compactedBeforeSeq : 0;
    const { compactedBeforeSeq: computedWatermark, foldedCount, foldedEvents } = computeCompactionWatermark(active, keepTail);
    const compactedBeforeSeq = Math.max(prevWatermark, computedWatermark);
    const newlyFolded = foldedEvents.filter(e => !prevWatermark || e.seq > prevWatermark);
    const highlights = extractDeterministicHighlights(task, newlyFolded.length ? newlyFolded : foldedEvents, prevSummary);

    const initialMap = new Map((task.initialSnapshot?.files || []).map(file => [file.path, file.sha256]));
    const currentMap = new Map((snapshot?.files || []).map(file => [file.path, file.sha256]));
    const modifiedFiles = [];
    for (const [filePath, hash] of currentMap) {
      if (!initialMap.has(filePath)) modifiedFiles.push({ path: filePath, status: 'added' });
      else if (initialMap.get(filePath) !== hash) modifiedFiles.push({ path: filePath, status: 'modified' });
    }
    for (const filePath of initialMap.keys()) {
      if (!currentMap.has(filePath)) modifiedFiles.push({ path: filePath, status: 'deleted' });
    }
    const incidentFailing = (task.lastIncident?.checks || []).filter(check => check.status !== 'pass');
    const verificationFailing = (task.verification?.checks || []).filter(check => check.status !== 'pass');
    const rawFailing = (task.routing?.probeProgress?.failing?.length ? task.routing.probeProgress.failing : null)
      || (incidentFailing.length ? incidentFailing : null)
      || (verificationFailing.length ? verificationFailing : []);
    const latestFailingChecks = rawFailing.slice(0, 8).map(check => ({
      name: String(check.name || '').slice(0, 120),
      detail: String(check.detail || '').slice(0, 240)
    }));
    const recentAttempts = (task.routing?.attempts || []).slice(-8).map(item => ({
      providerId: String(item.providerId || '').slice(0, 120),
      strategy: String(item.strategy || 'continue').slice(0, 80),
      call: item.call ?? null
    }));
    const recentActions = active
      .filter(event => event.type === 'tool.completed')
      .slice(-10)
      .map(event => ({
        name: String(event.data?.name || ''),
        ok: event.data?.result?.ok !== false && event.data?.status !== 'failed',
        ...(event.data?.result?.path ? { path: String(event.data.result.path).slice(0, 200) } : {}),
        ...(event.data?.result?.error?.code ? { errorCode: String(event.data.result.error.code).slice(0, 80) } : {})
      }));
    const highWater = (task.routing?.probeHighWater || 0) > 0 ? {
      passed: task.routing.probeHighWater,
      total: task.routing?.probeProgress?.total || null,
      provider: task.routing?.probeHighWaterProvider || null,
      atCall: task.routing?.probeHighWaterCall || null
    } : null;
    const todos = Array.isArray(task.todos) ? task.todos : [];
    const doneTodos = todos.filter(t => t.status === 'done').length;
    const remainingTodos = todos.filter(t => t.status !== 'done').slice(0, 12).map(t => ({ id: t.id, status: t.status, text: String(t.text || '').slice(0, 180) }));
    const mergedSemantic = semantic || prevSummary?.semantic || null;
    return {
      compactedAt: new Date().toISOString(),
      reason: String(reason).slice(0, 60),
      compactedBeforeSeq,
      foldedEventCount: prevWatermark > 0 ? (prevSummary?.foldedEventCount || 0) + newlyFolded.length : foldedCount,
      calls: task.calls,
      recoveries: task.recoveries,
      providerId: task.providerId,
      snapshotHash: snapshot?.snapshotHash || task.lastSnapshotHash || null,
      modifiedFiles: modifiedFiles.slice(0, 30),
      ...(todos.length ? { todoProgress: { done: doneTodos, total: todos.length, remaining: remainingTodos } } : {}),
      latestFailingChecks,
      recentAttempts,
      recentActions,
      highWater,
      ...(highlights.userClarifications.length ? { userClarifications: highlights.userClarifications } : {}),
      ...(highlights.failedApproaches.length ? { failedApproaches: highlights.failedApproaches } : {}),
      ...(highlights.keyFindings.length ? { keyFindings: highlights.keyFindings } : {}),
      ...(mergedSemantic ? { semantic: mergedSemantic } : {}),
      note: 'Hybrid structural + semantic handoff memory (ground-truth modifiedFiles/checks/todos + distilled decisions, ruled-out approaches, and user clarifications). Events <= compactedBeforeSeq are folded here and remain searchable via task.history.'
    };
  }
  async _compactHybrid(id, task, snapshot, reason = 'owner', { signal, allowSemantic = true, provider = null, keepTail = COMPACTION_KEEP_TAIL_EVENTS, expectedEpoch = null } = {}) {
    const events = this.getRecentEvents(id, 160);
    const active = activeHistory(task, events);
    const prevWatermark = Number.isInteger(task.workingSummary?.compactedBeforeSeq) ? task.workingSummary.compactedBeforeSeq : 0;
    const { foldedEvents } = computeCompactionWatermark(active, keepTail);
    const newlyFolded = foldedEvents.filter(e => !prevWatermark || e.seq > prevWatermark);
    const structural = this._buildWorkingSummary(task, snapshot, events, reason, { keepTail });

    let semantic = null;
    if (allowSemantic && !task.fixtureId && (newlyFolded.length > 0 || (reason === 'owner' && active.length > 0))) {
      const summarizer = this._selectCompactionProvider(task, provider);
      if (summarizer) {
        semantic = await distillSemanticSummary({
          provider: summarizer,
          task,
          structuralSummary: structural,
          foldedEvents: newlyFolded.length ? newlyFolded : active.slice(-40),
          previousSemantic: task.workingSummary?.semantic || null,
          ...this.outboundOptions(),
          signal,
        });
      }
    }
    if (signal?.aborted) return null;
    const finalSummary = semantic
      ? { ...structural, semantic }
      : structural;
    return this.store.updateTask(id, current => {
      if (expectedEpoch !== null && (current.epoch !== expectedEpoch || current.eventSeq !== task.eventSeq)) {
        return current;
      }
      current.workingSummary = finalSummary;
      current.stallSignature = null;
      current.stallTurns = 0;
      current.noWriteTurns = 0;
      current.recentToolCalls = [];
      return current;
    });
  }
  async compactTask(id, { reason = 'owner', allowSemantic } = {}) {
    const task = this._assertOwnerSettingsIdle(id);
    const snapshot = await taskSnapshot(task.workspace);
    const provider = this.selectedProvider(task.providerId, task.workspaceKind);
    let beforePct = null;
    try {
      beforePct = buildContext({ task, provider, history: this.getRecentEvents(id), totalHistoryCount: task.eventSeq, files: snapshot.files, snapshotHash: snapshot.snapshotHash, learning: this.getLearning(), memories: this._memoriesForTask(task), transparency: task.fixtureId ? null : this.getTransparencyConfig() }).manifest.utilizationPct;
    } catch {}
    const updated = await this._compactHybrid(id, task, snapshot, reason, {
      allowSemantic: allowSemantic !== undefined ? Boolean(allowSemantic) : !task.fixtureId,
      provider,
      expectedEpoch: task.epoch,
    });
    if (!updated || updated.epoch !== task.epoch || updated.eventSeq !== task.eventSeq) return this.getTask(id);
    let afterPct = null;
    try {
      afterPct = buildContext({ task: updated, provider, history: this.getRecentEvents(id), totalHistoryCount: updated.eventSeq, files: snapshot.files, snapshotHash: snapshot.snapshotHash, learning: this.getLearning(), memories: this._memoriesForTask(updated), transparency: updated.fixtureId ? null : this.getTransparencyConfig() }).manifest.utilizationPct;
    } catch {}
    const summary = updated.workingSummary;
    this.store.appendEvent(id, 'task.compacted', {
      reason,
      calls: updated.calls,
      ...(beforePct !== null ? { utilizationBeforePct: beforePct } : {}),
      ...(afterPct !== null ? { utilizationAfterPct: afterPct } : {}),
      compactedBeforeSeq: summary?.compactedBeforeSeq || 0,
      foldedEvents: summary?.foldedEventCount || 0,
      semanticDistilled: Boolean(summary?.semantic),
      modifiedFiles: summary?.modifiedFiles?.length || 0,
      failingChecks: summary?.latestFailingChecks?.length || 0,
      source: reason === 'owner' ? 'owner' : 'controller'
    });
    return this.getTask(id);
  }
  setEffort(id, effort) {
    if (this.closed) throw fault('RUNTIME_CLOSED', 'Runtime is closed.');
    const normalized = normalizeEffort(effort);
    const task = this.getTask(id);
    if (task.status === 'cancelled') throw fault('TASK_TERMINAL', 'Cancelled tasks cannot change effort.');
    return this.store.updateTask(id, current => {
      current.effort = normalized;
      if (current.routing?.requestProfiles && typeof current.routing.requestProfiles === 'object') {
        for (const prof of Object.values(current.routing.requestProfiles)) {
          if (prof && typeof prof === 'object' && 'reasoningCap' in prof) delete prof.reasoningCap;
        }
      }
      return current;
    }, 'task.effort', { effort: normalized, source: 'owner' });
  }
  setPlanMode(id, enabled) {
    if (typeof enabled !== 'boolean') throw fault('INVALID_TASK', 'planMode enabled must be a boolean.');
    const task = this._assertOwnerSettingsIdle(id);
    if (task.status === 'completed' && task.workspaceKind !== 'conversation') throw fault('TASK_TERMINAL', 'Completed tasks are read-only; send a follow-up message to continue in Plan or Build mode.');
    return this.store.updateTask(id, current => {
      current.planMode = enabled;
      current.epoch += 1;
      if (current.blocker?.code === 'PLAN_READY' && !enabled) current.blocker = null;
      return current;
    }, 'task.plan_mode', { planMode: enabled, source: 'owner' });
  }
  async listCheckpoints(id, { limit = 25 } = {}) {
    const task = this.getTask(id);
    return gitCheckpoints(task.workspace, { limit });
  }
  async rewindTask(id, stepsOrOptions = 1) {
    const opts = typeof stepsOrOptions === 'object' && stepsOrOptions !== null ? stepsOrOptions : { steps: stepsOrOptions };
    const hasHash = opts.hash !== undefined && opts.hash !== null;
    if (hasHash) {
      if (typeof opts.hash !== 'string' || !/^[0-9a-f]{7,40}$/i.test(opts.hash.trim())) {
        throw fault('INVALID_REWIND', 'Checkpoint hash must be 7–40 hexadecimal characters.');
      }
    } else {
      const steps = opts.steps === undefined ? 1 : opts.steps;
      if (!Number.isInteger(steps) || steps < 1 || steps > 50) throw fault('INVALID_REWIND', 'Rewind steps must be an integer from 1 to 50.');
    }
    const task = this._assertOwnerSettingsIdle(id);
    // Acquire the broker's workspace fence synchronously, before git can yield.
    // Run/resume, source changes, acceptance and owner edits all honor this lock.
    let release;
    const lock = new Promise(resolve => { release = resolve; });
    this.broker.locks.set(id, lock);
    try {
      const rewind = await gitRewind(task.workspace, hasHash ? { hash: opts.hash.trim() } : (opts.steps === undefined ? 1 : opts.steps));
      const snapshot = await taskSnapshot(task.workspace);
      const updated = this.store.updateTask(id, current => {
        current.epoch += 1;
        current.verification = null;
        current.workingSummary = null;
        current.pendingApproval = null;
        current.approvedOnceCall = null;
        if (current.blocker?.code === 'APPROVAL_REQUIRED') current.blocker = null;
        if (current.routing) {
          delete current.routing.probeHighWater;
          delete current.routing.bestSnapshot;
        }
        current.lastSnapshotHash = snapshot.snapshotHash;
        current.stallSignature = null;
        current.stallTurns = 0;
        current.noWriteTurns = 0;
        current.recentToolCalls = [];
        if (current.status === 'completed') {
          current.status = 'paused'; current.completionKind = null;
          delete current.completedAt; delete current.acceptedSnapshotHash;
        }
        return current;
      }, 'task.rewound', { ...rewind, snapshotHash: snapshot.snapshotHash, source: 'owner' });
      return { task: updated, rewind };
    } finally {
      if (this.broker.locks.get(id) === lock) this.broker.locks.delete(id);
      release();
    }
  }
  async submitMessage(id, message, messageId, mode = 'steer', attachments) {
    if (this.closed) throw fault('RUNTIME_CLOSED', 'Runtime is closed.');
    this.crew.assertIdle(id);
    validateMessage(message, messageId);
    const validAttachments = validateAttachments(attachments);
    if (!['steer', 'queue'].includes(mode)) throw fault('INVALID_MESSAGE', 'Choose queue or steer.');
    const task = this.getTask(id);
    if (messageId) {
      const known = [...(task.followups || []), ...(task.pendingMessages || []), ...(task.deferredMessages || [])].find(item => item.id === messageId);
      if (known) {
        if (known.message !== message) throw fault('MESSAGE_ID_CONFLICT', 'This message ID already belongs to different text.');
        return { task, queued: Boolean([...(task.pendingMessages || []), ...(task.deferredMessages || [])].some(item => item.id === messageId)), duplicate: true };
      }
      if (this.getEvents(id).some(event => event.type === 'user.message.removed' && event.data.id === messageId)) throw fault('MESSAGE_REMOVED', 'This message was removed. Send it again with a new message ID.');
    }
    if (active.has(task.status) || task.pendingMessages?.length || task.deferredMessages?.length) {
      if (terminal.has(task.status)) throw fault('TASK_TERMINAL', 'This task cannot receive queued instructions.');
      const pending = { id: messageId || randomUUID(), message, createdAt: new Date().toISOString(), mode };
      const field = mode === 'queue' ? 'deferredMessages' : 'pendingMessages';
      const proposed = { ...task, [field]: [...(task[field] || []), pending], ...(validAttachments.length ? { attachments: validAttachments } : {}) };
      checkMessageLimit([...(task.followups || []), ...(proposed.pendingMessages || []), ...(proposed.deferredMessages || [])]);
      return { task: this.store.updateTask(id, () => proposed, 'user.message.queued', { ...pending, source: 'owner' }), queued: true };
    }
    return { task: await this.addMessage(id, message, messageId, validAttachments), queued: false, start: true };
  }
  removeQueuedMessage(id, messageId) {
    if (this.closed) throw fault('RUNTIME_CLOSED', 'Runtime is closed.');
    this.crew.assertIdle(id);
    const task = this.getTask(id);
    if (![...(task.pendingMessages || []), ...(task.deferredMessages || [])].some(message => message.id === messageId)) throw fault('MESSAGE_NOT_PENDING', 'The message is no longer queued. It may already have been applied.');
    return this.store.updateTask(id, current => ({ ...current, pendingMessages: (current.pendingMessages || []).filter(message => message.id !== messageId), deferredMessages: (current.deferredMessages || []).filter(message => message.id !== messageId) }), 'user.message.removed', { id: messageId, source: 'owner' });
  }
  updateQueuedMessage(id, { messageId, message, expectedMessage, direction }) {
    if (this.closed) throw fault('RUNTIME_CLOSED', 'Runtime is closed.');
    this.crew.assertIdle(id);
    const task = this.getTask(id);
    const field = ['pendingMessages', 'deferredMessages'].find(key => task[key]?.some(item => item.id === messageId));
    if (!field) throw fault('MESSAGE_NOT_PENDING', 'This message has already left the queue.');
    const queue = structuredClone(task[field]), index = queue.findIndex(item => item.id === messageId);
    if (queue[index].message !== expectedMessage) throw fault('MESSAGE_STALE', 'This queued message changed. Reopen it before editing.');
    if (message !== undefined) { validateMessage(message, messageId); queue[index].message = message; }
    if (direction !== undefined) {
      if (![-1, 1].includes(direction)) throw fault('INVALID_MESSAGE', 'Choose an adjacent queue position.');
      const target = index + direction;
      if (target >= 0 && target < queue.length) [queue[index], queue[target]] = [queue[target], queue[index]];
    }
    const proposed = { ...task, [field]: queue };
    checkMessageLimit([...(task.followups || []), ...(proposed.pendingMessages || []), ...(proposed.deferredMessages || [])]);
    return this.store.updateTask(id, () => proposed, 'user.message.updated', { id: messageId, message, direction, source: 'owner' });
  }
  updateGeneration(id, input) {
    if (this.closed) throw fault('RUNTIME_CLOSED', 'Runtime is closed.');
    const task = this.getTask(id);
    if (task.status === 'cancelled') throw fault('TASK_TERMINAL', 'Cancelled tasks cannot change model parameters.');
    const generation = modelParameters(input);
    const ids = new Set([...task.providers, ...(task.answerRace?.models || [])]);
    for (const providerId of ids) parametersFor(this.selectedProvider(providerId, task.workspaceKind), generation);
    return this.store.updateTask(id, current => ({ ...current, generation }), 'generation.updated', { generation, source: 'owner' });
  }
  rewindConversation(id, { messageId, message, revision }) {
    const task = this._assertOwnerSettingsIdle(id);
    if (task.workspaceKind !== 'conversation') throw fault('INVALID_TASK', 'Conversation rewind is available in chats.');
    if (task.pendingMessages?.length || task.deferredMessages?.length) throw fault('PENDING_MESSAGES', 'Finish or remove queued messages before rewinding.');
    if (revision !== (task.conversationRevision || 0)) throw fault('MESSAGE_STALE', 'This conversation changed. Reopen the message.');
    const original = messageId === 'objective';
    const index = (task.followups || []).findIndex(item => item.id === messageId);
    if (!original && index < 0) throw fault('INVALID_MESSAGE', 'This message is not in the current conversation.');
    if (typeof message !== 'string' || !message.trim() || message.length > messageCharLimit(message, original ? 30000 : 12000)) throw fault('INVALID_MESSAGE', 'Enter a nonempty message within the character limit.');
    const events = this.getEvents(id);
    const anchor = original ? null : events.findLast(event => (event.type === 'user.message' && event.data.id === messageId) || (event.type === 'user.messages.applied' && event.data.ids.includes(messageId)) || (event.type === 'conversation.rewound' && event.data.messageId === messageId));
    if (!original && !anchor) throw fault('INVALID_MESSAGE', 'The message checkpoint is unavailable.');
    const start = original ? 1 : anchor.seq;
    const contractVersion = task.contractVersion + 1;
    const followups = original ? [] : task.followups.slice(0, index + 1).map((item, i) => {
      if (i !== index) return item;
      const { originalMessage: _dropped, ...rest } = item;
      return { ...rest, message, contractVersion };
    });
    return this.store.updateTask(id, current => ({ ...current, objective: original ? message : current.objective, followups,
      historyExclusions: [...(current.historyExclusions || []), [start, current.eventSeq]], conversationRevision: revision + 1,
      status: 'paused', epoch: current.epoch + 1, contractVersion, verification: null, workingSummary: null, completionKind: null, replyOutcome: null, completedAt: null,
      pendingApproval: null, approvedOnceCall: null, recentToolCalls: [],
      blocker: null, strategy: 'continue', stallTurns: 0, stallSignature: null, lastIncident: null,
      providerId: current.providers[0], providerIndex: 0, routing: { primaryId: current.providers[0], cooldowns: {}, primaryReturnUsed: false, contributions: {} },
      codeIntent: null, acceptance: { mode: 'owner', contractVersion }
    }), 'conversation.rewound', { messageId, message, previousObjective: task.objective, previousFollowups: task.followups || [], source: 'owner', filesRestored: false });
  }
  async addMessage(id, message, messageId, attachments) {
    const assertIdle = task => {
      if (this.closed) throw fault('RUNTIME_CLOSED', 'Runtime is closed.');
      this.crew.assertIdle(id);
      if (this.sourceChanges.busy(id)) throw fault('SOURCE_BUSY', 'Source changes are still settling.');
      if (active.has(task.status)) throw fault('TASK_ACTIVE', 'Pause the task before sending a follow-up.');
      if (this.runs.has(id) || this.broker.locks.has(id)) throw fault('RUN_DRAINING', 'Previous work is still settling; retry the follow-up shortly.');
      if (task.pendingMessages?.length) throw fault('PENDING_MESSAGES', 'Resume or remove queued instructions before adding an immediate follow-up.');
      if (!['queued', 'paused', 'blocked', 'waiting_input', 'paused_budget', 'failed', 'completed'].includes(task.status)) throw fault('TASK_TERMINAL', 'This task cannot receive a follow-up.');
      if (this.getOperations(id).some(operation => !['succeeded', 'failed'].includes(operation.status))) throw fault('OUTCOME_UNKNOWN', 'Reconcile unresolved operations before changing the task requirements.');
      for (const other of this.store.listTasks()) {
        if (other.id === id) continue;
        const overlaps = other.workspace === task.workspace || other.workspace.startsWith(task.workspace + sep) || task.workspace.startsWith(other.workspace + sep);
        if (overlaps && (!terminal.has(other.status) || this.getOperations(other.id).some(operation => !['succeeded', 'failed'].includes(operation.status)))) throw fault('WORKSPACE_BUSY', 'Another unfinished task owns this workspace or an overlapping directory.');
      }
    };
    if (this.closed) throw fault('RUNTIME_CLOSED', 'Runtime is closed.');
    const task = this.getTask(id);
    assertIdle(task);
    validateMessage(message, messageId);
    const validAttachments = validateAttachments(attachments);
    const followup = { id: messageId || randomUUID(), message, createdAt: new Date().toISOString(), contractVersion: (task.contractVersion || 1) + 1 };
    const followups = [...(task.followups || []), followup];
    checkMessageLimit(followups);
    const proposed = { ...withFollowups(task, followups), attachments: validAttachments, epoch: task.epoch + 1, status: 'queued' };
    const snapshot = await taskSnapshot(task.workspace);
    if (this.closed) throw fault('RUNTIME_CLOSED', 'Runtime is closed.');
    // Reject a contract that cannot fit before persisting or dispatching it.
    const followupProvider = this.selectedProvider(proposed.providerId, proposed.workspaceKind);
    buildContext({ task: { ...proposed, calls: proposed.calls + 1, status: 'running', epoch: proposed.epoch + 1, version: task.version + 2, eventSeq: task.eventSeq + 2 }, provider: followupProvider, history: this.getRecentEvents(id), totalHistoryCount: task.eventSeq + 2, files: snapshot.files, snapshotHash: snapshot.snapshotHash, learning: this.getLearning(), memories: this._memoriesForTask(proposed) });
    return this.store.updateTask(id, current => {
      assertIdle(current);
      if (current.version !== task.version || current.epoch !== task.epoch || current.eventSeq !== task.eventSeq) throw fault('MESSAGE_STALE', 'Task changed while preparing the follow-up. Review its current state and submit again.');
      return proposed;
    }, 'user.message', { ...followup, source: 'owner' });
  }
  setAnswerRace(id, value) {
    const task=this._assertOwnerSettingsIdle(id);
    if (task.workspaceKind !== 'conversation') throw fault('INVALID_TASK','Ultra-Plinian compares written answers in a chat.');
    const answerRace=validateAnswerRace(value,this.catalog,task.workspaceKind,this.providers);
    for (const id of answerRace?.models || []) parametersFor(this.selectedProvider(id, task.workspaceKind), task.generation);
    return this.store.updateTask(id,current=>{current.answerRace=answerRace;return current;},'race.configured',{answerRace});
  }
  setProviders(id, providerIds) {
    if (this.closed) throw fault('RUNTIME_CLOSED', 'Runtime is closed.');
    this.crew.assertIdle(id);
    const task = this.getTask(id);
    if (active.has(task.status)) throw fault('TASK_ACTIVE', 'Pause the task before changing its providers.');
    if (this.runs.has(id) || this.broker.locks.has(id)) throw fault('RUN_DRAINING', 'Workspace work is still settling; retry provider selection shortly.');
    const answered = task.workspaceKind === 'conversation' && task.status === 'completed' && task.completionKind === 'answered';
    if (!answered && !['queued', 'paused', 'blocked', 'waiting_input', 'paused_budget', 'failed'].includes(task.status)) throw fault('TASK_TERMINAL', 'Providers can only change on an unfinished, idle task or an answered conversation.');
    this.validateCatalogRoute(providerIds, task.workspaceKind);
    if (!Array.isArray(providerIds) || providerIds.length < 1 || providerIds.length > 10 || providerIds.some(providerId => typeof providerId !== 'string' || !this.selectedProvider(providerId, task.workspaceKind))) throw fault('INVALID_PROVIDER', 'Select 1–10 configured provider IDs.');
    if (task.workspaceKind === 'conversation' && providerIds.some(providerId => { const provider = this.selectedProvider(providerId, task.workspaceKind); return !provider.kind || provider.kind === 'scripted' || provider.available === false; })) throw fault('LIVE_PROVIDER_REQUIRED', 'Conversations require configured live models.');
    for (const id of providerIds) parametersFor(this.selectedProvider(id, task.workspaceKind), task.generation);
    const selected = [...new Set(providerIds)];
    return this.store.updateTask(id, current => {
      current.providers = selected; current.providerId = selected[0]; current.providerIndex = 0;
      current.routing = { primaryId: selected[0], cooldowns: {}, primaryReturnUsed: false, contributions: {} };
      current.epoch += 1; current.blocker = null;
      current.status = answered ? 'completed' : current.status === 'queued' ? 'queued' : 'paused';
      return current;
    }, 'providers.updated', { from: task.providers, to: selected, providerId: selected[0], source: 'owner' });
  }
  async accept(id) {
    this.crew.assertIdle(id);
    if (this.sourceChanges.busy(id)) throw fault('SOURCE_BUSY', 'Source changes are still settling.');
    const task = this.getTask(id);
    if (task.pendingMessages?.length) throw fault('PENDING_MESSAGES', 'Resume or remove queued instructions before accepting the result.');
    if (active.has(task.status) || this.runs.has(id) || this.broker.locks.has(id)) throw fault('TASK_ACTIVE', 'Pause and settle the task before accepting it.');
    if (task.status === 'cancelled' || task.status === 'completed') return task;
    const snapshot = await taskSnapshot(task.workspace);
    this.crew.assertIdle(id);
    const current = this.getTask(id);
    if (active.has(current.status) || this.runs.has(id) || this.broker.locks.has(id)) throw fault('TASK_ACTIVE', 'Task started while acceptance was capturing its snapshot; pause and settle it first.');
    if (current.version !== task.version || current.epoch !== task.epoch || current.status !== task.status) throw fault('ACCEPTANCE_STALE', 'Task changed while acceptance was capturing its snapshot; review its current state and retry.');
    return this.store.updateTask(id, current => { current.status = 'completed'; current.completionKind = 'user_accepted'; current.acceptedSnapshotHash = snapshot.snapshotHash; current.completedAt = new Date().toISOString(); return current; }, 'task.completed', { completionKind: 'user_accepted', snapshotHash: snapshot.snapshotHash, independentVerification: task.verification?.status || 'unknown' });
  }
  close() {
    if (this.closePromise) return this.closePromise;
    this.closed = true;
    this.closePromise = (async () => {
      try {
        await this.crew.close();
        for (const id of this.runs.keys()) this.pause(id);
        await this.broker.close();
        await Promise.allSettled([...this.runs.values()].map(entry => entry.promise));
        await Promise.allSettled([...this.sourceChanges.jobs.values()].map(entry => entry.promise));
        await Promise.allSettled([...this.broker.locks.values()]);
        const providers = [...new Set(this.providers.values())].filter(provider => typeof provider?.close === 'function');
        const results = await Promise.allSettled(providers.map(provider => Promise.resolve().then(() => provider.close())));
        const errors = results.filter(result => result.status === 'rejected').map(result => result.reason);
        if (errors.length) throw new AggregateError(errors, 'Provider cleanup failed while closing the runtime.');
      } finally { this.store.close(); }
    })();
    return this.closePromise;
  }
}
