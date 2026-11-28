/* GodCode operator console. Dependency-free, same-origin, observed data only. */
'use strict';

const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];
const escapeHTML = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const pretty = (value) => typeof value === 'string' ? value : JSON.stringify(value, null, 2) ?? '';
const ACTIVE = new Set(['running', 'recovering', 'verifying']);
const RESUMABLE = new Set(['paused', 'paused_budget', 'waiting_input', 'blocked', 'failed']);
const TERMINAL = new Set(['completed', 'cancelled']);
const state = { tasks: [], providers: [], fixtures: [], capabilities: [], limitations: [], benchmark: null, skills: [], permissions: null };
let selectedId = null;
let selectedData = null;
let currentTab = 'timeline';
let hasConnected = false;
let refreshing = false;
let refreshQueued = false;
let selectionVersion = 0;
let actionBusy = false;
let createBusy = false;
let createSource = 'fixture';
let importPreview = null;
let importPreviewBusy = false;
let importPreviewVersion = 0;
let autoPreviewTimer = null;
const RECENT_PROJECTS_KEY = 'g0dc0d3.recentProjects';
const PENDING_PROJECT_KEY = 'g0dc0d3.pendingProject';
let pendingProjectPreview = null;
let pendingProjectPreviewSeq = 0;
let pendingProject = (() => {
  try {
    const raw = JSON.parse(localStorage.getItem(PENDING_PROJECT_KEY) || 'null');
    if (raw && typeof raw.path === 'string' && raw.path.trim()) {
      const cleaned = raw.path.trim().replace(/[\\/]+$/, '') || raw.path.trim();
      const name = cleaned.split(/[\\/]/).filter(Boolean).pop() || cleaned;
      return { path: cleaned, name, mode: raw.mode === 'worktree' ? 'worktree' : 'copy' };
    }
  } catch {}
  return null;
})();
let routeTaskId = null;
let routeDirty = false;
let streamSource = null;
let streamTaskId = null;
let streamText = '';
let streamThinking = '';
let streamThinkingExpanded = false;
let streamToolName = '';
let streamTurnStartedAt = 0;
let liveElapsedTimer = null;
const tabScrollPositions = new Map();
let overseerDirectivesDraft = null;
let routeBusy = false;
let detailSignature = '';
let listSignature = '';
let fixtureSignature = '';
let benchmarkSignature = '';
let toastTimer;
let refreshTimer;
let welcomeRequested = false;
let composerScope = null;
let createProjectObjective = '';
let createComposerOrigin = null;
let createProviderSelections = new Map();
let createPreferredSelections = new Map();
const composerDrafts = new Map();
const composerDraftTimes = new Map();
let draftStorageAvailable = true;
let draftPlanMode = false;
let planModeBusy = false;
const EFFORT_META = Object.freeze({
  fast: { label: 'Fast', icon: '○', desc: 'Instant replies · minimal thinking, skips todo planning' },
  medium: { label: 'Medium', icon: '◔', desc: 'Balanced speed & planning (default)' },
  high: { label: 'High', icon: '◕', desc: 'Deeper reasoning, live todo checklists & verification' },
  max: { label: 'Max', icon: '●', desc: 'Heaviest reasoning & exhaustive self-verification' },
});
let draftEffort = (() => {
  try {
    const saved = String(localStorage.getItem('g0dc0d3.effort') || '').toLowerCase();
    return Object.hasOwn(EFFORT_META, saved) ? saved : 'medium';
  } catch { return 'medium'; }
})();
const APP_MODE_STARTERS = Object.freeze({
  godmode: [
    { icon: '◎', title: 'Browse & research', prompt: 'Open Hacker News in the browser and summarize the top 5 AI stories right now' },
    { icon: '✦', title: 'Build live canvas', prompt: 'Build an interactive neon cyberpunk audio visualizer in a single HTML file' },
    { icon: '∞', title: 'Deep dive', prompt: 'Break down the most surprising recent breakthroughs in open-weight LLMs and inference speed' },
  ],
  godcode: [
    { icon: '⌨', title: 'Build a CLI tool', prompt: 'Write a Python CLI tool that converts CSV files to SQLite databases with tests' },
    { icon: '{ }', title: 'Create a REST API', prompt: 'Create a REST API with Express.js that manages a todo list with CRUD operations and unit tests' },
    { icon: '⎇', title: 'Debug & test repo', prompt: 'Inspect this repository, run the test suite, identify any failing checks or edge cases, and propose a minimal fix' },
  ],
});
let qolPrefs = (() => {
  const defaults = { sendKey: 'enter', autoOpenPreview: true, expandThinking: false, pauseBackdrop: false, completionChime: true };
  try {
    const raw = JSON.parse(localStorage.getItem('g0dc0d3.qol.v1') || '{}');
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      return {
        sendKey: raw.sendKey === 'mod_enter' ? 'mod_enter' : 'enter',
        autoOpenPreview: raw.autoOpenPreview !== false,
        expandThinking: raw.expandThinking === true,
        pauseBackdrop: raw.pauseBackdrop === true,
        completionChime: raw.completionChime !== false,
      };
    }
  } catch {}
  return defaults;
})();
function updateQolPrefs(patch = {}) {
  qolPrefs = {
    ...qolPrefs,
    ...(patch.sendKey !== undefined ? { sendKey: patch.sendKey === 'mod_enter' ? 'mod_enter' : 'enter' } : {}),
    ...(patch.autoOpenPreview !== undefined ? { autoOpenPreview: Boolean(patch.autoOpenPreview) } : {}),
    ...(patch.expandThinking !== undefined ? { expandThinking: Boolean(patch.expandThinking) } : {}),
    ...(patch.pauseBackdrop !== undefined ? { pauseBackdrop: Boolean(patch.pauseBackdrop) } : {}),
    ...(patch.completionChime !== undefined ? { completionChime: Boolean(patch.completionChime) } : {}),
  };
  try { localStorage.setItem('g0dc0d3.qol.v1', JSON.stringify(qolPrefs)); } catch {}
  if (patch.completionChime !== undefined && window.G0DAlerts) {
    window.G0DAlerts.update({ soundsEnabled: Boolean(patch.completionChime), ...(patch.completionChime ? { muted: false } : {}) });
  }
  syncComposerShortcutHints();
  window.G0DThemes?.setMotionPaused?.(qolPrefs.pauseBackdrop);
  return qolPrefs;
}
function playCompletionChime(kind = 'done', { force = false } = {}) {
  if (window.G0DAlerts) {
    return window.G0DAlerts.playSound(kind, { force });
  }
  if (!force && qolPrefs.completionChime === false) return false;
  return false;
}
function syncComposerShortcutHints() {
  const input = $('#composer-input');
  const keys = $('#composer-keys');
  const mod = qolPrefs.sendKey === 'mod_enter';
  const msg = mod ? 'Press / to focus. ⌘/Ctrl + Enter to send. Enter for a new line.' : 'Press / to focus. Enter to send. Shift + Enter for a new line.';
  if (input) input.title = msg;
  if (keys) keys.textContent = mod ? '⌘/Ctrl + Enter to send. Enter for a new line.' : 'Enter to send. Shift + Enter for a new line.';
}
function resetPanelLayout() {
  for (const key of ['g0dc0d3.sidebarWidth', 'g0dc0d3.sidebarSplitWidth', 'g0dc0d3.artifactWidth', 'g0dc0d3.inspectorWidth', 'g0dc0d3.fileTreeWidth', 'g0dc0d3.composerHeight', 'g0dc0d3.consoleHeight']) {
    try { localStorage.removeItem(key); } catch {}
  }
  const root = document.documentElement;
  for (const prop of ['--sidebar-width', '--sidebar-split-width', '--artifact-width', '--inspector-width', '--file-tree-width', '--console-height', '--artifact-console-height', '--composer-height']) {
    root.style.removeProperty(prop);
  }
  applyComposerHeight(null);
}
function clearRecentModels() {
  recentModels = [];
  try { localStorage.removeItem('g0dc0d3.recentModels'); } catch {}
}
window.G0DQol = {
  get: () => ({ ...qolPrefs, ...(window.G0DAlerts ? { completionChime: !window.G0DAlerts.get().muted && window.G0DAlerts.get().soundsEnabled } : {}) }),
  update: updateQolPrefs,
  resetLayout: resetPanelLayout,
  clearRecentModels,
  playChime: playCompletionChime,
};
window.addEventListener('godcode-alerts-changed', ev => {
  const detail = ev?.detail;
  if (detail && typeof detail === 'object') {
    qolPrefs.completionChime = !detail.muted && Boolean(detail.soundsEnabled);
  }
});

let appMode = (() => {
  try {
    const saved = String(localStorage.getItem('g0dc0d3.appMode') || '').toLowerCase();
    return saved === 'godcode' ? 'godcode' : 'godmode';
  } catch { return 'godmode'; }
})();

function renderStarterSuggestions() {
  const box = $('#composer-suggestions');
  if (!box) return;
  const items = APP_MODE_STARTERS[appMode] || APP_MODE_STARTERS.godmode;
  box.innerHTML = items.map(item =>
    `<button type="button" data-starter-prompt="${escapeHTML(item.prompt)}"><span class="starter-icon" aria-hidden="true">${escapeHTML(item.icon)}</span><span class="starter-copy"><strong>${escapeHTML(item.title)}</strong></span><span class="starter-arrow" aria-hidden="true">↗</span></button>`
  ).join('');
}

function isCodingWorkspaceTask(task) {
  if (!task) return false;
  return task.workspaceKind !== 'conversation' || Boolean(task.sourcePath) || Boolean(task.fixtureId) || Boolean(task.codeWorkspace);
}

function applyAppMode(mode, { persist = true, notify = false, switchView = false } = {}) {
  const next = mode === 'godcode' ? 'godcode' : 'godmode';
  appMode = next;
  document.body.dataset.appMode = next;
  if (persist) {
    try { localStorage.setItem('g0dc0d3.appMode', next); } catch {}
  }
  for (const tab of $$('#app-mode-switcher [data-app-mode]')) {
    const active = tab.dataset.appMode === next;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
  }
  const isCode = next === 'godcode';
  const brandWordmark = $('#sidebar-brand-wordmark');
  if (brandWordmark) {
    brandWordmark.textContent = isCode ? 'GODCODƎ' : 'GODMODƎ';
    brandWordmark.setAttribute('aria-label', isCode ? 'GodCode' : 'GodMode');
  }
  $('#sidebar-brand')?.setAttribute('aria-label', isCode ? 'GODCODƎ home' : 'GODMODƎ home');
  setText('#sidebar-list-label', isCode ? 'Threads' : 'Chats');
  setText('#new-thread-label', isCode ? 'New thread' : 'New chat');
  const headline = $('#welcome-headline');
  if (headline) {
    headline.innerHTML = isCode
      ? 'What are we building<span class="welcome-punctuation">?</span>'
      : 'What can we do<span class="welcome-punctuation">?</span>';
  }
  setVisible('#welcome-godcode-sub', false);
  renderStarterSuggestions();
  syncAdaptiveCompactUI();
  if (!isCode) {
    draftPlanMode = false;
    window.closeChatCode?.();
  }
  if (switchView && !isCode && selectedData?.task && isCodingWorkspaceTask(selectedData.task)) {
    newConversation();
  } else {
    if (!selectedId) {
      setText('#workspace-context', isCode ? 'GODCODƎ' : 'GODMODƎ');
      setText('#workspace-subcontext', isCode ? 'New thread' : 'New chat');
    }
    renderComposer();
  }
  if (notify) {
    toast(isCode
      ? 'GODCODƎ — autonomous coding workspace, repos & git worktrees.'
      : 'GODMODƎ — sovereign local chat, browser & live canvas.');
  }
}
let effortBusy = false;
let stripActionBusy = false;
let checkpointsCacheKey = '';
let checkpointsRequestSeq = 0;
let checkpointsData = [];
let checkpointRestoreBusy = false;
let approvalBusy = false;
let commitBusy = false;
let commitFormOpen = false;
let skillsFetchVersion = 0;
const planBannerDismissedVersion = new Map();
const copyCodeTimers = new WeakMap();
let composerAutocompleteState = { visible: false, accept: null, shouldDeferEnter: () => false };
try {
  const records = JSON.parse(localStorage.getItem('g0dc0d3.drafts.v1') || '[]');
  if (Array.isArray(records)) for (const record of records.slice(-20)) {
    if (record && typeof record.key === 'string' && record.key.length < 100
      && typeof record.text === 'string' && record.text.length <= 30000
      && Number.isFinite(record.savedAt) && Date.now() - record.savedAt < 7 * 86400000) {
      composerDrafts.set(record.key, record.text);
      composerDraftTimes.set(record.key, record.savedAt);
    }
  }
} catch { draftStorageAvailable = false; }
function saveComposerDraft(key, text) {
  const now = Date.now(), previousText = composerDrafts.get(key), previousTime = composerDraftTimes.get(key);
  composerDrafts.delete(key);
  composerDraftTimes.delete(key);
  if (text) {
    composerDrafts.set(key, text);
    composerDraftTimes.set(key, text === previousText && Number.isFinite(previousTime) ? previousTime : now);
  }
  for (const draftKey of composerDrafts.keys()) {
    if (now - composerDraftTimes.get(draftKey) >= 7 * 86400000) {
      composerDrafts.delete(draftKey);
      composerDraftTimes.delete(draftKey);
    }
  }
  while (composerDrafts.size > 20) {
    const oldest = composerDrafts.keys().next().value;
    composerDrafts.delete(oldest);
    composerDraftTimes.delete(oldest);
  }
  try {
    if (composerDrafts.size) localStorage.setItem('g0dc0d3.drafts.v1', JSON.stringify([...composerDrafts].map(([key, text]) => ({ key, text, savedAt: composerDraftTimes.get(key) }))));
    else localStorage.removeItem('g0dc0d3.drafts.v1');
    draftStorageAvailable = true;
  } catch { draftStorageAvailable = false; }
}
const composerProviderDrafts = new Map();
const composerErrors = new Map();
const messageBusyTasks = new Set();
const messageSubmissions = new Map();
let sourceReview = null;
let sourceActionBusy = false;
let crewReview = null;
const crewRequests = new Set();
const projectLabels = new Map();
const fileSelections = new Map();
const fileQueries = new Map();
const filePages = new Map();
let fileSignature = '';
let filePanelTaskId = null;
const changeSelections = new Map();
let changesSignature = "";
let commandItems = [];
let commandIndex = 0;
let commandReturnFocus = null;
let preferredProvider = null, preferredVeniceBackup = null;
try { preferredVeniceBackup = JSON.parse(localStorage.getItem('g0dc0d3.veniceBackup')); } catch {}
let connectionBusy = false;
try { preferredProvider = localStorage.getItem('g0dc0d3.preferredProvider'); } catch {}
const narrowLayout = window.matchMedia('(max-width: 900px)');
const TEXT_SIZES = new Set(['comfortable', 'large', 'extra-large']);

function applyTextSize(value) {
  document.documentElement.dataset.textSize = TEXT_SIZES.has(value) ? value : 'comfortable';
}
try { applyTextSize(JSON.parse(localStorage.getItem('g0dc0d3.display') || '{}')?.textSize); }
catch { applyTextSize('comfortable'); }

try {
  const remembered = localStorage.getItem('g0dc0d3.selectedTask');
  welcomeRequested = remembered === 'welcome';
  selectedId = welcomeRequested ? null : remembered;
} catch { /* Optional UI preference only. */ }

function humanize(value) { return String(value ?? 'unknown').replace(/[_.-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function toolPhaseLabel(name, args) {
  if (name === 'repo.read') return `Reading ${args?.path ? args.path.split('/').pop() : 'file'}…`;
  if (name === 'repo.write') return `Writing ${args?.path ? args.path.split('/').pop() : 'file'}…`;
  if (name === 'repo.patch') return `Patching ${args?.path ? args.path.split('/').pop() : 'file'}…`;
  if (name === 'repo.search') return `Searching${args?.query ? ' for ' + args.query.slice(0, 30) : ''}…`;
  if (name === 'repo.list') return 'Listing files…';
  if (name === 'process.run') return `Running ${args?.command ? args.command.split(/\s/)[0].slice(0, 20) : 'command'}…`;
  if (name === 'check.run') return 'Running checks…';
  if (name === 'git.diff') return 'Checking diff…';
  if (name === 'git.log') return 'Reading git log…';
  if (name === 'git.commit') return 'Committing…';
  if (name === 'task.history') return 'Searching history…';
  if (name === 'web.search') return `Searching web${args?.query ? `: ${String(args.query).slice(0, 28)}` : ''}…`;
  if (name === 'web.fetch') return 'Reading web page…';
  if (name === 'browser.open') return `Opening browser${args?.url ? `: ${String(args.url).replace(/^https?:\/\//i, '').slice(0, 32)}` : ''}…`;
  if (name === 'browser.snapshot') return 'Inspecting browser page…';
  if (name === 'browser.act') return `Browser ${args?.action || 'action'}${args?.ref ? ` (${args.ref})` : ''}…`;
  if (name === 'browser.screenshot') return 'Capturing browser view…';
  if (name === 'browser.eval') return 'Evaluating page JS…';
  if (name === 'browser.close') return 'Closing browser…';
  return `Running ${name}…`;
}
function kindLabel(kind) { return kind === 'scripted' ? 'Scripted' : kind === 'codex' ? 'Live · Codex' : kind === 'claude' ? 'Live · Claude Code' : kind === 'antigravity-cli' ? 'Live · Google Antigravity' : kind === 'gemini-cli' ? 'Live · Gemini CLI' : kind === 'copilot-cli' ? 'Live · GitHub Copilot' : kind === 'http' ? 'Live · HTTP' : humanize(kind); }
function taskStatusLabel(task) { return task.outcome?.label || (task.completionKind === 'answered' ? 'Replied' : task.status === 'recovering' ? 'Recovering' : humanize(task.status)); }
function statusBadge(status) { return `<span class="status-badge ${escapeHTML(status)}"><span class="status-dot ${escapeHTML(status)}"></span>${escapeHTML(status === 'recovering' ? 'Recovering' : humanize(status))}</span>`; }
function timeLabel(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? '' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
function shortDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return '';
  return date.toDateString() === new Date().toDateString() ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
function duration(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return value < 1000 ? `${Math.round(value)} ms` : value < 60000 ? `${(value / 1000).toFixed(1)} s` : `${Math.floor(value / 60000)}m ${Math.round(value % 60000 / 1000)}s`;
}
const settingsListContents = new WeakMap();
let veniceCatalog = { connected: false, models: [], warning: '' };
let veniceCatalogConnection = null;
let openrouterCatalog = { connected: false, models: [], registered: [], warning: '' };
let openrouterCatalogConnection = null;
let openrouterFilter = '';
let openrouterBusyModel = null;
let openrouterRefreshBusy = false;
const DIRECT_CATALOG_KEYS = ['openai', 'anthropic', 'xai', 'gemini', 'meta'];
const directCatalogs = {
  openai: { connected: false, models: [], registered: [], warning: '' },
  anthropic: { connected: false, models: [], registered: [], warning: '' },
  xai: { connected: false, models: [], registered: [], warning: '' },
  gemini: { connected: false, models: [], registered: [], warning: '' },
  meta: { connected: false, models: [], registered: [], warning: '' },
};
const directCatalogFilters = { openai: '', anthropic: '', xai: '', gemini: '', meta: '' };
const directCatalogRefreshBusy = { openai: false, anthropic: false, xai: false, gemini: false, meta: false };
let directCatalogBusyModel = null;
const catalogId = id => typeof id === 'string' && id.startsWith('venice-catalog:');
function providerById(id) {
  return state.providers.find(provider => provider.id === id)
    || (catalogId(id) && (veniceCatalog.models.find(model => model.id === id) || {id, label:id.slice('venice-catalog:'.length)}))
    || openrouterCatalog.models.find(model => model.id === id)
    || DIRECT_CATALOG_KEYS.map(k => directCatalogs[k].models.find(model => model.id === id)).find(Boolean);
}
function liveProviders() { return state.providers.filter(provider => provider.kind !== 'scripted' && provider.available !== false); }
function newConversationProviders() {
  const live = liveProviders();
  const pol = RecoveryUI.policy(null);
  const godmodeOn = pol.mode !== 'ask' && (pol.maxAttempts || 0) > 0;
  const allGroup = Array.isArray(state.modelGroups) ? state.modelGroups.find(g => g.id === 'all-smartest') : null;
  const godmodeDefault = godmodeOn
    ? (RecoveryUI.findVeniceUncensored?.(live, state.veniceConnectionId, veniceCatalog.models) || RecoveryUI.findOpenRouterGodmode?.(live))
    : null;
  const gemini4Neon = !godmodeOn ? RecoveryUI.findGemini4Neon(live, state.veniceConnectionId, veniceCatalog.models) : null;
  const defaultChoice = preferredProvider || godmodeDefault || gemini4Neon || (allGroup?.providerIds?.length ? allGroup.providerIds[0] : null);
  const base = RecoveryUI.initialChatRoute(live, defaultChoice, state.veniceConnectionId, preferredVeniceBackup, veniceCatalog.models);
  if (!base.length || base[0]?.startsWith('venice-catalog:')) return base;
  if (!godmodeOn) return base;
  try {
    const groupId = localStorage.getItem('g0dc0d3.waterfallGroup');
    if (groupId && Array.isArray(state.modelGroups)) {
      const group = state.modelGroups.find(g => g.id === groupId);
      if (group?.providerIds?.length && group.providerIds.includes(base[0])) {
        return [...new Set([base[0], ...group.providerIds])].slice(0, 10);
      }
    }
  } catch {}
  if (allGroup?.providerIds?.length) {
    const liveGodmode = godmodeDefault && !catalogId(godmodeDefault) ? [godmodeDefault] : [];
    return [...new Set([...base, ...allGroup.providerIds, ...liveGodmode])].slice(0, 10);
  }
  return base;
}
function taskProviders(task) { return task.providers ?? task.providerIds ?? (task.providerId ? [task.providerId] : []); }
function projectLabel(task) {
  if (task?.sourcePath) return task.sourcePath.split(/[\\/]/).filter(Boolean).at(-1) || task.sourcePath;
  if (task?.fixtureId) return state.fixtures.find((fixture) => fixture.id === task.fixtureId)?.title || humanize(task.fixtureId);
  return task?.id ? projectLabels.get(task.id) || '' : '';
}
function setText(selector, value) { const element = $(selector); if (element) element.textContent = value ?? ''; }
function setVisible(selector, visible) { const element = $(selector); if (element) element.classList.toggle('hidden', !visible); }
function errorIn(selector, error) {
  const target = $(selector);
  let msg = error?.message ?? String(error ?? 'An unexpected error occurred.');
  msg = msg.replace(/ENOENT[^']*'[^']+\/workspaces\/[^']+'/g, 'Workspace directory not found');
  msg = msg.replace(/\/[^\s'"]+\/\.g0dc0d3\/workspaces\/[a-f0-9-]+/g, 'workspace');
  target.textContent = msg;
  target.classList.remove('hidden');
}
function toast(message) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = message;
  el.classList.remove('hidden');
  try { if (typeof el.showPopover === 'function' && !el.matches(':popover-open')) el.showPopover(); } catch {}
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    try { if (typeof el.hidePopover === 'function' && el.matches(':popover-open')) el.hidePopover(); } catch {}
    el.classList.add('hidden');
  }, 4000);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', 'X-G0D-Request': '1', ...(options.headers ?? {}) },
    cache: 'no-store',
  });
  const type = response.headers.get('content-type') ?? '';
  const data = type.includes('json') ? await response.json() : { error: await response.text() };
  if (!response.ok) {
    const detail = typeof data.error === 'string' ? data.error : data.error?.message ?? data.message ?? `Request failed (${response.status}).`;
    throw Object.assign(new Error(detail), { code: data.code ?? data.error?.code, status: response.status });
  }
  return data;
}

function renderConnection(connected) {
  const element = $('#connection');
  element.className = `connection ${connected ? 'online' : 'offline'}`;
  element.innerHTML = `<span class="connection-dot"></span><span>${connected ? 'Runtime online' : 'Disconnected'}</span>`;
  renderComposer();
}

function captureComposerDraft() {
  if (composerScope !== null && $('#composer-input')) saveComposerDraft(composerScope, $('#composer-input').value);
}

let manualComposerHeight = null;
function applyComposerHeight(px) {
  if (px === null || !Number.isFinite(px)) {
    manualComposerHeight = null;
    document.body.classList.remove('composer-manual-height');
    document.documentElement.style.removeProperty('--composer-height');
    try { localStorage.removeItem('g0dc0d3.composerHeight'); } catch {}
    resizeComposer();
    syncAdaptiveCompactUI();
    return;
  }
  const clamped = Math.round(Math.max(44, Math.min(420, px)));
  manualComposerHeight = clamped;
  document.documentElement.style.setProperty('--composer-height', `${clamped}px`);
  document.body.classList.add('composer-manual-height');
  try { localStorage.setItem('g0dc0d3.composerHeight', String(clamped)); } catch {}
  syncAdaptiveCompactUI();
}

function setComposerOptionsOpen(open) {
  const shell = $('#composer-shell');
  const btn = $('#composer-options-toggle');
  if (!shell || !btn) return;
  const next = Boolean(open && shell.classList.contains('composer-compact'));
  shell.classList.toggle('composer-options-open', next);
  btn.setAttribute('aria-expanded', String(next));
  btn.setAttribute('aria-label', next ? 'Hide composer options' : 'Show composer options');
}

function syncAdaptiveCompactUI() {
  const shell = $('#composer-shell');
  if (shell) {
    const w = shell.getBoundingClientRect().width;
    const widthThreshold = appMode === 'godcode' ? 620 : 520;
    const manuallySquished = manualComposerHeight !== null && manualComposerHeight <= 72;
    const isCompact = (w > 0 && w < widthThreshold) || manuallySquished;
    const wasCompact = shell.classList.contains('composer-compact');
    shell.classList.toggle('composer-compact', isCompact);
    if (wasCompact && !isCompact) setComposerOptionsOpen(false);
  }
  const ws = $('#task-workspace');
  if (ws) {
    const wsW = ws.getBoundingClientRect().width;
    ws.classList.toggle('workspace-compact', wsW > 0 && wsW < 540);
  }
}

function resizeComposer() {
  const input = $('#composer-input');
  if (!input) return;
  if (manualComposerHeight !== null) {
    input.style.height = `${manualComposerHeight}px`;
    return;
  }
  input.style.height = 'auto';
  input.style.height = `${Math.min(180, Math.max(48, input.scrollHeight))}px`;
}

function updateLatestButton() {
  const scroller = $('#task-content');
  setVisible('#jump-latest', Boolean(selectedId) && currentTab === 'timeline'
    && scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight > 95);
}

function extractDraftFileMentions(text, files) {
  if (!text || !text.includes('@') || !Array.isArray(files) || !files.length) return [];
  const pathSet = new Set(files.map(f => f?.path).filter(Boolean));
  const found = [];
  const seen = new Set();
  for (const match of text.matchAll(/(?:^|[\s([{"'`])@([A-Za-z0-9._/@-]+)/g)) {
    const candidate = match[1].replace(/[.,:;!?)\]}'"]+$/, '').replace(/^\.\//, '');
    if (candidate && pathSet.has(candidate) && !seen.has(candidate)) {
      seen.add(candidate);
      found.push(candidate);
    }
  }
  return found;
}

function renderComposerMentions() {
  const row = $('#composer-mentions');
  const input = $('#composer-input');
  if (!row || !input) return;
  const files = selectedData?.task?.id === selectedId ? (selectedData.files || []) : [];
  const mentions = extractDraftFileMentions(input.value, files);
  if (!mentions.length) {
    if (row.innerHTML) row.innerHTML = '';
    setVisible('#composer-mentions', false);
    return;
  }
  const html = mentions.map(filePath => {
    const slash = filePath.lastIndexOf('/');
    const labelHtml = slash >= 0
      ? `<span class="mention-dir">${escapeHTML(filePath.slice(0, slash + 1))}</span><span class="mention-name">${escapeHTML(filePath.slice(slash + 1))}</span>`
      : `<span class="mention-name">${escapeHTML(filePath)}</span>`;
    return `<span class="composer-mention-pill" role="listitem" title="${escapeHTML(filePath)}"><span class="mention-at" aria-hidden="true">@</span><span class="mention-path">${labelHtml}</span><button type="button" class="mention-remove" data-remove-mention="${escapeHTML(filePath)}" aria-label="Remove @${escapeHTML(filePath)}" title="Remove @${escapeHTML(filePath)}">×</button></span>`;
  }).join('');
  if (row.innerHTML !== html) row.innerHTML = html;
  setVisible('#composer-mentions', true);
}

function removeDraftMention(filePath) {
  const input = $('#composer-input');
  if (!input || !filePath) return;
  const escaped = filePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(^|[\\s([{"'\`])@(?:\\./)?${escaped}(?=$|[\\s.,:;!?)\\]}'"\`])`, 'g');
  const next = input.value.replace(re, '$1').replace(/ {2,}/g, ' ').replace(/^ +/gm, '');
  input.value = next;
  captureComposerDraft();
  resizeComposer();
  renderComposer();
  input.focus();
}

function renderComposer() {
  const input = $('#composer-input');
  if (!input) return;
  const key = selectedId || 'welcome';
  if (composerScope !== key) {
    captureComposerDraft();
    composerScope = key;
    input.value = composerDrafts.get(key) || '';
    resizeComposer();
  }
  const task = selectedData?.task?.id === selectedId ? selectedData.task : null;
  const loading = Boolean(selectedId && !task);
  const active = task && (ACTIVE.has(task.status) || task.draining);
  const cancelled = task?.status === 'cancelled';
  const busy = messageBusyTasks.has(key);
  const online = $('#connection')?.classList.contains('online');
  input.disabled = loading || cancelled;
  input.maxLength = selectedId ? 12000 : 30000;
  const remaining = input.maxLength - input.value.length;
  setText('#composer-count', `${input.value.length.toLocaleString()} / ${input.maxLength.toLocaleString()} characters`);
  setVisible('#composer-count', remaining <= input.maxLength * .2);
  const queueing = task && (ACTIVE.has(task.status) || task.pendingMessages?.length || task.deferredMessages?.length);
  if (typeof renderConversationControls === 'function') renderConversationControls(task);
  input.placeholder = !selectedId
    ? (appMode === 'godcode' ? 'Describe a coding task, or attach a repository…' : 'Ask anything…')
    : queueing ? 'Add instructions…'
    : task?.codeWorkspace ? 'Follow up, or type /build to propose an edit…' : 'Follow up…';
  const hasPayload = Boolean(input.value.trim() || composerAttachments.length || composerFileAttachments.length);
  const canStop = Boolean(task && ACTIVE.has(task.status) && !task.draining && !isCrewBusy(task) && !hasPayload && !busy && online);
  const sendBtn = $('#composer-send');
  if (sendBtn) {
    sendBtn.dataset.composerStop = canStop ? '1' : '';
    sendBtn.classList.toggle('is-stop-mode', canStop);
    sendBtn.disabled = canStop ? Boolean(actionBusy) : (!online || loading || task?.draining || task?.sourceBusy || sourceActionBusy || isCrewBusy(task) || cancelled || busy || (Boolean(selectedId) && actionBusy) || !hasPayload);
    const sendLabel = canStop ? 'Stop generation' : busy ? 'Sending message' : queueing ? ($('#composer-delivery')?.value === 'steer' ? 'Steer current turn' : $('#composer-delivery')?.value === 'parallel' ? 'Run parallel sidecar' : 'Queue next message') : 'Send message';
    sendBtn.setAttribute('aria-label', sendLabel);
    sendBtn.title = canStop ? 'Stop current turn (Esc)' : sendLabel;
    sendBtn.setAttribute('aria-busy', String(busy));
    const iconMode = canStop ? 'stop' : 'send';
    if (sendBtn.dataset.iconMode !== iconMode) {
      sendBtn.dataset.iconMode = iconMode;
      sendBtn.innerHTML = canStop
        ? '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="5" y="5" width="10" height="10" rx="2" fill="currentColor" stroke="none"/></svg>'
        : '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 15V4M5 9l5-5 5 5"/></svg>';
    }
  }
  $('#composer-project').disabled = loading || createBusy;
  $('#composer-model').disabled = loading || createBusy;
  const label = projectLabel(task);
  const attachedPending = !task && appMode === 'godcode' && pendingProject?.path ? pendingProject : null;
  setVisible('#composer-code-prefix', Boolean(task?.codeWorkspace));
  setText('#composer-project-label', task?.codeWorkspace ? task.codeWorkspace.repository : label || attachedPending?.name || (task?.workspaceKind === 'conversation' ? 'Attach repository' : 'Add project'));
  $('#composer-project').classList.toggle('has-project', Boolean(task?.codeWorkspace || task?.sourcePath || attachedPending));
  const preferred = providerById(newConversationProviders()[0]);
  const race = task ? task.answerRace : RecoveryUI.preferences().answerRace;
  const pendingNextId = task && Array.isArray(task.pendingProviders) && task.pendingProviders.length ? task.pendingProviders[0] : null;
  const currentModelLabel = task ? providerById(task.providerId)?.label || task.providerId || 'Model' : preferred?.label || 'Connect model';
  const pendingNextLabel = pendingNextId ? (providerById(pendingNextId)?.label || pendingNextId) : '';
  setText('#composer-model-label', race ? `${race.models?.length || 2} Conclave writers` : pendingNextLabel ? `Next: ${pendingNextLabel}` : currentModelLabel);
  $('#composer-model').classList.toggle('is-queued-model', Boolean(pendingNextLabel && !race));
  $('#composer-project').title = attachedPending
    ? `Attached project (${attachedPending.mode === 'worktree' ? 'Git Worktree' : 'Isolated Copy'}): ${attachedPending.path} — click to switch or detach`
    : task?.workspaceKind === 'conversation'
      ? (task.codeWorkspace ? 'Open GodCode or switch repository' : 'Attach a repository to this chat')
      : task ? 'Project locations, recent repos, and worktrees' : 'Choose a recent project, browse a folder, or drop one here';
  setVisible('#composer-permissions', true);
  const permRulesNow = task && Array.isArray(task.permissionRules)
    ? task.permissionRules
    : (Array.isArray(state.permissions?.rules) ? state.permissions.rules : []);
  const permPresetNow = typeof detectPermissionPreset === 'function' ? detectPermissionPreset(permRulesNow) : (permRulesNow.length ? 'custom' : 'permissive');
  const shortPermLabel = { permissive: 'Autonomous', auto: 'AI Screened', acceptEdits: 'Auto-Edit', safe: 'Ask Shell', default: 'Ask All', dontAsk: 'Headless CI' }[permPresetNow] || `Custom (${permRulesNow.length})`;
  const cmdSuffix = task ? (task.execution?.enabled ? (task.execution.network ? ' · Cmd+Net' : ' · Cmd') : '') : '';
  setText('#composer-permissions-label', `${shortPermLabel}${cmdSuffix}`);
  $('#composer-permissions').title = `Permission Gate: ${shortPermLabel} (Shift+Tab to cycle, click to configure)`;
  $('#composer-model').title = race
    ? 'View the Conclave writers and judge'
    : pendingNextLabel
      ? `Queued for your next message: ${pendingNextLabel} (current response continues on ${currentModelLabel})`
      : task && ACTIVE.has(task.status)
        ? 'Select a model for your next message while this response finishes'
        : task ? 'Change model for this chat' : 'Choose or connect a model';
  setVisible('#composer-connect', !task && Boolean(composerErrors.get(key)) && !preferred);
  renderRecoveryControl(task, loading || !online);
  renderPlanModeControl(task, loading || !online);
  renderEffortControl(task, loading || !online);
  const optToggle = $('#composer-options-toggle');
  if (optToggle) {
    const ultraOn = $('#composer-ultra')?.getAttribute('aria-checked') === 'true';
    const planOn = Boolean(task ? task.planMode : draftPlanMode);
    const activeFlags = [];
    if (ultraOn) activeFlags.push('GODMODƎ On');
    const routerMode = state.router?.mode || ultraRouterData?.settings?.mode || '';
    if (race || ['auto_route', 'auto_arena'].includes(routerMode)) activeFlags.push('Ultra-Plinian');
    if (planOn && appMode === 'godcode') activeFlags.push('Plan Mode');
    optToggle.classList.toggle('has-active-modes', activeFlags.length > 0);
    optToggle.title = activeFlags.length
      ? `Composer options (${activeFlags.join(' · ')})`
      : 'Show more composer options';
  }
  renderPlanReadyBanner(task, loading || !online);
  renderApprovalBanner(task, loading || !online);
  renderTodoStrip(task);
  renderComposerMentions();
  let hint = '';
  if (!online) hint = 'Connecting…';
  else if (loading) hint = 'Loading…';
  else if (cancelled) hint = 'Cancelled. Start a new task.';
  else if (task?.pendingApproval) hint = `Approval required for ${task.pendingApproval.tool || 'tool call'}.`;
  else if (task?.draining) hint = 'Stopping…';
  else if (task?.sourceBusy || sourceActionBusy) hint = 'Updating source files…';
  else if (isCrewBusy(task)) hint = selectedData?.crew?.status === 'ready' ? 'Review or dismiss the crew candidate to continue.' : selectedData?.crew?.status === 'paused' ? 'Resume or cancel the crew to continue.' : 'Crew working. Your draft stays saved.';
  else if (task?.status === 'recovering' && task.routing?.pendingRetry?.retryAt > Date.now()) hint = '';
  else if (active) {
    const recent = [...(selectedData?.events || [])].reverse().find(event => ['model.request','race.dispatched','tool.started','evaluation.started'].includes(event.type));
    const phase = task.answerRace ? (recent?.data?.stage === 'grade' ? 'Grading drafts' : 'Drafting in parallel') : task.status === 'verifying' ? 'Checking files' : recent?.type === 'tool.started' ? `Running ${recent.data?.name || 'a tool'}` : task.recoveries ? RecoveryUI.liberationMessage() : 'Waiting for model';
    const elapsed = recent ? Math.max(0, Date.now() - Date.parse(recent.time)) : 0;
    hint = `${phase}${Number.isFinite(elapsed) ? ` · ${duration(elapsed)}` : ''}`;
  }
  else if (task?.pendingMessages?.length || task?.deferredMessages?.length) hint = 'Resume to continue queued messages.';
  else if (busy) hint = 'Sending…';
  if (input.value) hint += `${hint ? ' · ' : ''}${draftStorageAvailable ? 'Draft saved' : 'Draft saved in this window only'}`;
  setText('#composer-hint', hint);
  const error = composerErrors.get(key);
  setText('#composer-error', error || '');
  setVisible('#composer-error', Boolean(error));
}

function renderRecoveryControl(task, loading = false) {
  const view = RecoveryUI.presentation(task, Date.now(), newConversationProviders());
  const racing = task ? task.answerRace : RecoveryUI.preferences().answerRace;
  const routerMode = state.router?.mode || ultraRouterData?.settings?.mode || 'off';
  const ultraRouting = routerMode === 'auto_route' || routerMode === 'auto_arena';
  const ultraOn = Boolean(racing) || ultraRouting;
  $('#main-content').classList.toggle('ultra-active', ultraOn);
  setVisible('#composer-race', !task || task.workspaceKind === 'conversation');
  $('#composer-race').classList.toggle('race-enabled', ultraOn);
  const arenaN = racing?.models?.length || state.router?.arenaSize || ultraRouterData?.settings?.arenaSize || 3;
  const raceLabel = routerMode === 'auto_route' && !racing
    ? 'Ultra-Plinian · Auto'
    : routerMode === 'auto_arena' && !racing
      ? `Ultra-Plinian · Conclave ${arenaN}×`
      : racing
        ? `Ultra-Plinian · Custom ${arenaN}×`
        : 'Ultra-Plinian';
  const raceLabelEl = $('#composer-race-label');
  if (raceLabelEl) raceLabelEl.textContent = raceLabel;
  else $('#composer-race').textContent = `${raceLabel} ⌄`;
  $('#composer-race').title = routerMode === 'auto_route' && !racing
    ? 'Ultra-Plinian Auto-Route · Click to switch mode'
    : ultraOn
      ? (view.enabled ? 'Ultra-Plinian + G0DM0D3 active · Click to configure' : 'Ultra-Plinian active · Click to configure')
      : 'Ultra-Plinian mode (Off) · Click to enable Auto-Route or Conclave';
  $('#composer-race').disabled = loading || Boolean(task?.draining) || ACTIVE.has(task?.status);

  setText('#composer-ultra-label', view.label === 'G0DM0D3' || view.label === 'GodMode' ? 'GODMODƎ' : view.label);
  $('#composer-ultra-label').classList.toggle('wordmark', view.label === 'G0DM0D3' || view.label === 'GodMode');
  setText('#composer-ultra-state', view.state);
  setText('#composer-recovery-status', routerMode === 'auto_route' && !racing
    ? (task?.blocker?.message || (view.enabled ? 'G0DM0D3 + Ultra-Plinian Auto-Router · routes to best model per task with adaptive recovery' : 'Ultra-Plinian Auto-Router · routes to best model per task'))
    : ultraOn
      ? (task?.blocker?.message || (view.enabled ? 'G0DM0D3 + Ultra-Plinian · parallel writers with adaptive recovery fallback' : 'Ultra-Plinian · two writers and a judge'))
      : view.detail);
  const recoveryStrip = document.querySelector('.recovery-strip');
  if (recoveryStrip) {
    const showStrip = Boolean(task && (ACTIVE.has(task.status) || task.blocker?.message || (task.recoveries || 0) > 0));
    recoveryStrip.classList.toggle('is-idle', !showStrip);
  }
  $('#composer-ultra').setAttribute('aria-checked', String(view.enabled));
  $('#composer-ultra').classList.toggle('enabled', view.enabled);
  const setupLock = view.locked ? (ACTIVE.has(task?.status) ? 'Wait for this response to finish or pause before changing the outage backup.' : modelSelectionLock(task)) : '';
  $('#composer-ultra').disabled = Boolean(setupLock) || loading || Boolean(task?.draining) || isCrewBusy(task) || task?.status === 'cancelled' || (typeof settingsBusy !== 'undefined' && settingsBusy) || (typeof recoveryToggleBusy !== 'undefined' && recoveryToggleBusy);
  $('#composer-ultra').title = setupLock || (ultraOn
    ? (view.enabled ? 'G0DM0D3 recovery is active alongside Ultra-Plinian (auto-recovers errors, declines & output limits).' : 'Turn on G0DM0D3 to auto-recover Ultra-Plinian errors, declines & output limits.')
    : view.detail);
  setText('#inspector-recovery-state', routerMode === 'auto_route' && !racing
    ? 'G0DM0D3 + Ultra-Plinian Auto-Router · per-domain benchmark + Elo routing with adaptive recovery fallback.'
    : ultraOn
      ? (view.enabled ? 'G0DM0D3 + Ultra-Plinian · two parallel writers, blind judge, and adaptive recovery.' : 'Ultra-Plinian · two parallel drafts and one grading call.')
      : `${view.label} · ${view.state}. ${view.detail}.`);
}

function renderPlanModeControl(task, loading = false) {
  const button = $('#composer-plan-mode');
  if (!button) return;
  const enabled = task ? Boolean(task.planMode) : draftPlanMode;
  const active = task && (ACTIVE.has(task.status) || task.draining);
  const completedNonChat = Boolean(task && task.status === 'completed' && task.workspaceKind !== 'conversation');
  const terminalLocked = Boolean(task && (task.status === 'cancelled' || completedNonChat));
  button.setAttribute('aria-checked', String(enabled));
  button.classList.toggle('enabled', enabled);
  button.disabled = loading || planModeBusy || Boolean(active) || isCrewBusy(task) || terminalLocked;
  setText('#composer-plan-label', enabled ? 'Plan' : 'Build');
  button.title = task?.status === 'cancelled'
    ? 'Cancelled tasks cannot change mode.'
    : completedNonChat
      ? 'Task is completed. Send a follow-up message to continue in Plan or Build mode.'
      : enabled
        ? 'Plan Mode active (read-only research & planning). Click or type /build to allow edits.'
        : 'Build Mode active. Click or type /plan for read-only planning.';
}

function activeEffort(task) {
  const raw = String(task?.effort || draftEffort || 'medium').toLowerCase();
  return Object.hasOwn(EFFORT_META, raw) ? raw : 'medium';
}

function renderEffortControl(task, loading = false) {
  const button = $('#composer-effort');
  if (!button) return;
  const level = activeEffort(task);
  const meta = EFFORT_META[level];
  const active = Boolean(task && (ACTIVE.has(task.status) || task.draining));
  button.dataset.effort = level;
  button.disabled = loading || effortBusy || task?.status === 'cancelled';
  setText('#composer-effort-icon', meta.icon);
  setText('#composer-effort-label', meta.label);
  button.title = `Thinking effort: ${meta.label} — ${meta.desc}${active ? ' · Changes apply to next turn' : ''} (/effort fast | medium | high | max)`;
}

async function setEffortLevel(task, level) {
  const normalized = String(level || '').toLowerCase();
  if (!Object.hasOwn(EFFORT_META, normalized)) {
    toast('Effort must be fast, medium, high, or max.');
    return false;
  }
  draftEffort = normalized;
  try { localStorage.setItem('g0dc0d3.effort', normalized); } catch {}
  if (!task) {
    renderComposer();
    toast(`Effort set to ${EFFORT_META[normalized].label}.`);
    return true;
  }
  if (effortBusy) return false;
  effortBusy = true;
  const runningNow = Boolean(ACTIVE.has(task.status) || task.draining);
  renderEffortControl(task, false);
  try {
    const res = await api(`/api/tasks/${encodeURIComponent(task.id)}/effort`, {
      method: 'PATCH',
      body: JSON.stringify({ effort: normalized }),
    });
    if (selectedData && res.task && selectedData.task?.id === task.id) {
      renderSelected({ ...selectedData, task: res.task }, true);
    }
    toast(runningNow
      ? `Effort set to ${EFFORT_META[normalized].label} — applies to next turn.`
      : `Effort set to ${EFFORT_META[normalized].label}.`);
    return true;
  } catch (error) {
    toast(error.message || 'Could not update thinking effort.');
    return false;
  } finally {
    effortBusy = false;
    renderEffortControl(selectedData?.task || null, false);
  }
}

function renderPlanReadyBanner(task, loading = false) {
  const banner = $('#plan-ready-banner');
  if (!banner) return;
  const pausedOrWaiting = Boolean(task && task.planMode === true && !ACTIVE.has(task.status) && !TERMINAL.has(task.status) && !task.draining && task.status !== 'queued');
  const dismissed = Boolean(task && planBannerDismissedVersion.get(task.id) === Number(task.version));
  const show = pausedOrWaiting && !dismissed;
  setVisible('#plan-ready-banner', show);
  if (!show) return;
  const approveBtn = $('#plan-approve-build');
  const refineBtn = $('#plan-keep-refining');
  const busy = loading || planModeBusy || actionBusy || isCrewBusy(task) || Boolean(task.sourceBusy || sourceActionBusy);
  if (approveBtn) {
    approveBtn.disabled = busy;
    approveBtn.textContent = planModeBusy ? 'Switching to Build…' : 'Approve & Build →';
  }
  if (refineBtn) refineBtn.disabled = busy;
}

async function approvePlanAndBuild(task) {
  if (!task || planModeBusy || actionBusy) return;
  const targetId = task.id;
  planModeBusy = true;
  renderPlanModeControl(task, false);
  renderPlanReadyBanner(task, false);
  try {
    const modeRes = await api(`/api/tasks/${encodeURIComponent(targetId)}/plan-mode`, { method: 'POST', body: JSON.stringify({ enabled: false }) });
    planBannerDismissedVersion.delete(targetId);
    if (selectedData && modeRes.task && selectedData.task?.id === targetId) {
      renderSelected({ ...selectedData, task: modeRes.task }, true);
    }
    const resumeRes = await api(`/api/tasks/${encodeURIComponent(targetId)}/resume`, { method: 'POST', body: '{}' });
    if (selectedData && resumeRes.task && selectedData.task?.id === targetId) {
      renderSelected({ ...selectedData, task: resumeRes.task }, true);
    }
    toast('Plan approved — switched to Build Mode and executing.');
    await refresh();
  } catch (error) {
    composerErrors.set(targetId, error.message);
    toast(error.message);
    renderComposer();
  } finally {
    planModeBusy = false;
    renderPlanModeControl(selectedData?.task || null, false);
    renderPlanReadyBanner(selectedData?.task || null, false);
  }
}

async function compactTaskAction(task) {
  if (!task || stripActionBusy) return false;
  stripActionBusy = true;
  renderTaskMetaStrip(task);
  try {
    const response = await api(`/api/tasks/${encodeURIComponent(task.id)}/compact`, { method: 'POST', body: '{}' });
    if (selectedData && response.task && selectedData.task?.id === task.id) renderSelected({ ...selectedData, task: response.task }, true);
    toast('Context compacted into a fresh-eyes working summary.');
    await refresh();
    return true;
  } catch (error) {
    composerErrors.set(task.id, error.message);
    toast(error.message);
    renderComposer();
    return false;
  } finally {
    stripActionBusy = false;
    if (selectedData?.task) renderTaskMetaStrip(selectedData.task);
  }
}

async function rewindTaskAction(task, steps = 1) {
  if (!task || stripActionBusy) return false;
  stripActionBusy = true;
  renderTaskMetaStrip(task);
  try {
    const response = await api(`/api/tasks/${encodeURIComponent(task.id)}/rewind`, { method: 'POST', body: JSON.stringify({ steps }) });
    checkpointsCacheKey = '';
    if (selectedData && response.task && selectedData.task?.id === task.id) renderSelected({ ...selectedData, task: response.task }, true);
    toast(`Rewound ${response.rewind?.steps || steps} checkpoint(s) to ${response.rewind?.toHash || 'previous commit'}.`);
    await refresh();
    return true;
  } catch (error) {
    composerErrors.set(task.id, error.message);
    toast(error.message);
    renderComposer();
    return false;
  } finally {
    stripActionBusy = false;
    if (selectedData?.task) renderTaskMetaStrip(selectedData.task);
  }
}

function renderApprovalBanner(task, loading = false) {
  const banner = $('#approval-banner');
  if (!banner) return;
  const approval = task?.pendingApproval || null;
  const show = Boolean(approval && !task.draining && task.status !== 'cancelled');
  setVisible('#approval-banner', show);
  if (!show) return;
  setText('#approval-tool', approval.tool || 'tool');
  const riskEl = $('#approval-risk');
  if (riskEl) {
    const level = approval.risk?.level || '';
    const tags = Array.isArray(approval.risk?.tags) && approval.risk.tags.length ? ` · ${approval.risk.tags.join(', ')}` : '';
    riskEl.textContent = level ? `${level.toUpperCase()} RISK${tags}` : '';
    riskEl.className = `approval-risk ${level ? `risk-${level}` : 'hidden'}`;
  }
  const patBtn = $('#approval-always-pattern');
  if (patBtn) {
    const suggested = approval.suggestedPattern;
    patBtn.classList.toggle('hidden', !suggested?.label);
    if (suggested?.label) patBtn.textContent = `Allow "${suggested.label}"`;
  }
  const targetText = approval.target || (approval.args && Object.keys(approval.args).length ? JSON.stringify(approval.args).slice(0, 220) : '');
  setText('#approval-target', targetText);
  setVisible('#approval-target', Boolean(targetText));
  setText('#approval-reason', approval.reason || approval.rule?.reason || 'Confirm this tool call before execution.');
  const disabled = loading || approvalBusy || actionBusy || isCrewBusy(task);
  $$('[data-approval-decision]', banner).forEach(btn => { btn.disabled = disabled; });
}

async function resolveApprovalAction(task, decision) {
  if (!task || !task.pendingApproval || approvalBusy || actionBusy) return false;
  if (!['once', 'always', 'always_pattern', 'deny'].includes(decision)) return false;
  approvalBusy = true;
  renderApprovalBanner(task, false);
  try {
    const res = await api(`/api/tasks/${encodeURIComponent(task.id)}/approval`, {
      method: 'POST',
      body: JSON.stringify({ decision, resume: true }),
    });
    if (selectedData && res.task && selectedData.task?.id === task.id) {
      renderSelected({ ...selectedData, task: res.task }, true);
    }
    const labels = {
      once: 'Allowed once — resuming.',
      always: 'This exact call is allowed for this chat — resuming.',
      always_pattern: 'Allowed matching pattern for this chat — resuming.',
      deny: 'Tool call denied — resuming with feedback.',
    };
    toast(labels[decision] || 'Approval recorded.');
    await refresh();
    return true;
  } catch (error) {
    composerErrors.set(task.id, error.message);
    toast(error.message);
    renderComposer();
    return false;
  } finally {
    approvalBusy = false;
    renderApprovalBanner(selectedData?.task || null, false);
  }
}

function renderTodoStrip(task) {
  const strip = $('#todo-strip');
  if (!strip) return;
  const todos = Array.isArray(task?.todos) ? task.todos : [];
  if (!todos.length) {
    setVisible('#todo-strip', false);
    if ($('#todo-strip-list')) $('#todo-strip-list').innerHTML = '';
    return;
  }
  const doneCount = todos.filter(item => item.status === 'done').length;
  const activeItem = todos.find(item => item.status === 'in_progress');
  setText('#todo-strip-title', `Plan progress: ${doneCount}/${todos.length} done`);
  setText('#todo-strip-active', activeItem ? activeItem.text : '');
  const list = $('#todo-strip-list');
  if (list) {
    const html = todos.map(item => {
      const status = item.status === 'done' ? 'done' : item.status === 'in_progress' ? 'in_progress' : 'pending';
      const glyph = status === 'done' ? '✓' : status === 'in_progress' ? '◉' : '○';
      return `<li class="todo-row todo-${status}"><span class="todo-glyph" aria-hidden="true">${glyph}</span><span class="todo-text">${escapeHTML(item.text || '')}</span></li>`;
    }).join('');
    if (list.innerHTML !== html) list.innerHTML = html;
  }
  setVisible('#todo-strip', true);
}

async function loadSkills(taskId = selectedId) {
  const version = ++skillsFetchVersion;
  try {
    const query = taskId ? `?taskId=${encodeURIComponent(taskId)}` : '';
    const res = await api(`/api/skills${query}`);
    if (version !== skillsFetchVersion) return state.skills;
    state.skills = Array.isArray(res.skills) ? res.skills : [];
    return state.skills;
  } catch {
    return state.skills;
  }
}

async function forkTaskAction(task, options = {}) {
  if (!task || stripActionBusy || checkpointRestoreBusy) return null;
  stripActionBusy = true;
  renderTaskMetaStrip(task);
  renderCheckpoints(task);
  try {
    const payload = {};
    if (options.title) payload.title = options.title;
    if (options.fromHash) payload.fromHash = options.fromHash;
    const res = await api(`/api/tasks/${encodeURIComponent(task.id)}/fork`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    const forked = res.task;
    if (forked) {
      state.tasks.unshift(forked);
      await selectTask(forked.id);
      toast(options.fromHash
        ? `Forked from ${options.fromHash.slice(0, 7)}: ${forked.title || 'New branch'}`
        : `Forked conversation: ${forked.title || 'New branch'}`);
      await refresh();
      return forked;
    }
    return null;
  } catch (error) {
    composerErrors.set(task.id, error.message);
    toast(error.message);
    renderComposer();
    return null;
  } finally {
    stripActionBusy = false;
    if (selectedData?.task) {
      renderTaskMetaStrip(selectedData.task);
      renderCheckpoints(selectedData.task);
    }
  }
}

let confirmResolver = null;
function confirmModal({ title = 'Confirm', message = '', confirmLabel = 'Confirm', danger = false } = {}) {
  const dlg = $('#confirm-dialog');
  if (!dlg) return Promise.resolve(true);
  if (confirmResolver) confirmResolver(false);
  if (dlg.open) dlg.close();
  setText('#confirm-title', title);
  setText('#confirm-message', message);
  const accept = $('#confirm-accept');
  const cancel = $('#confirm-cancel');
  if (accept) {
    accept.textContent = confirmLabel;
    accept.classList.toggle('button-danger', Boolean(danger));
    accept.classList.toggle('button-primary', !danger);
  }
  return new Promise(resolve => {
    const finish = ok => {
      if (confirmResolver !== finish) return;
      confirmResolver = null;
      if (accept) accept.onclick = null;
      if (cancel) cancel.onclick = null;
      dlg.onclose = null;
      if (dlg.open) dlg.close();
      lastDialogCloseAt = Date.now();
      resolve(ok);
    };
    confirmResolver = finish;
    if (accept) accept.onclick = () => finish(true);
    if (cancel) cancel.onclick = () => finish(false);
    dlg.onclose = () => finish(false);
    dlg.showModal();
    (danger ? cancel : accept)?.focus();
  });
}

async function renameTaskAction(task, nextTitle) {
  if (!task) return null;
  const clean = String(nextTitle || '').replace(/[\r\n]+/g, ' ').trim();
  if (!clean) { toast('Title cannot be empty.'); return null; }
  if (clean === task.title) return task;
  try {
    const res = await api(`/api/tasks/${encodeURIComponent(task.id)}/title`, {
      method: 'PATCH',
      body: JSON.stringify({ title: clean.slice(0, 200) })
    });
    const updated = res.task;
    if (updated) {
      const idx = state.tasks.findIndex(t => t.id === updated.id);
      if (idx >= 0) state.tasks[idx] = { ...state.tasks[idx], title: updated.title, updatedAt: updated.updatedAt };
      if (selectedData?.task?.id === updated.id) {
        selectedData.task = updated;
        setText('#selected-title', updated.title);
        setText('#workspace-subcontext', updated.title);
      }
      renderTasks(true);
      toast('Conversation renamed.');
    }
    return updated;
  } catch (error) {
    toast(error.message || 'Could not rename conversation.');
    return null;
  }
}

function startInlineRename(task, targetEl) {
  if (!task || !targetEl || targetEl.dataset.renaming === '1') return;
  const sidebarRow = targetEl.closest('.task-item-row');
  if (sidebarRow) {
    if (sidebarRow.dataset.renaming === '1') return;
    sidebarRow.dataset.renaming = '1';
    const original = task.title || 'Untitled task';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'inline-rename-input sidebar-rename-input';
    input.value = original;
    input.maxLength = 200;
    input.setAttribute('aria-label', 'Rename conversation');
    sidebarRow.classList.add('is-renaming');
    sidebarRow.appendChild(input);
    input.focus();
    input.select();
    let done = false;
    const finish = async commit => {
      if (done) return;
      done = true;
      const val = input.value.trim();
      input.remove();
      sidebarRow.classList.remove('is-renaming');
      delete sidebarRow.dataset.renaming;
      if (commit && val && val !== original) {
        await renameTaskAction(task, val);
      } else {
        setTimeout(() => renderTasks(true), 0);
      }
    };
    input.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    input.addEventListener('click', e => e.stopPropagation());
    input.addEventListener('blur', () => finish(true));
    return;
  }
  targetEl.dataset.renaming = '1';
  const original = task.title || 'Untitled task';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'inline-rename-input';
  input.value = original;
  input.maxLength = 200;
  input.setAttribute('aria-label', 'Rename conversation');
  const prevText = targetEl.textContent;
  targetEl.textContent = '';
  targetEl.appendChild(input);
  input.focus();
  input.select();
  let done = false;
  const finish = async commit => {
    if (done) return;
    done = true;
    const val = input.value.trim();
    delete targetEl.dataset.renaming;
    targetEl.textContent = commit && val ? val : prevText;
    if (commit && val && val !== original) {
      const updated = await renameTaskAction(task, val);
      if (!updated && selectedId === task.id) targetEl.textContent = prevText;
    }
  };
  input.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  });
  input.addEventListener('click', e => e.stopPropagation());
  input.addEventListener('blur', () => finish(true));
}

async function purgeTaskAction(task) {
  if (!task) return false;
  const ok = await confirmModal({
    title: 'Delete conversation?',
    message: `Delete "${task.title || 'this chat'}" and its saved history? Shared memories and external repositories are kept.`,
    confirmLabel: 'Delete',
    danger: true,
  });
  if (!ok) return false;
  try {
    const result = await api(`/api/tasks/${encodeURIComponent(task.id)}`, { method: 'DELETE', body: '{}' });
    state.tasks = state.tasks.filter(t => t.id !== task.id);
    if (selectedId === task.id) {
      selectedId = null;
      selectedData = null;
      closeArtifactDock({ recordDismiss: false });
      newConversation();
    }
    renderTasks(true);
    await refresh();
    toast(result.workspaceError || 'Conversation deleted.');
    return true;
  } catch (error) {
    toast(error.message);
    return false;
  }
}

async function copyTranscriptAction(task, triggerBtn = null) {
  if (!task) return false;
  if (triggerBtn) triggerBtn.disabled = true;
  try {
    const res = await api(`/api/tasks/${encodeURIComponent(task.id)}/transcript?format=json`);
    await navigator.clipboard.writeText(res.transcript || '');
    if (triggerBtn) {
      if (!triggerBtn.dataset.defaultLabel) triggerBtn.dataset.defaultLabel = triggerBtn.textContent.trim() || 'Copy transcript';
      triggerBtn.classList.add('copied');
      triggerBtn.textContent = 'Copied ✓';
      clearTimeout(copyCodeTimers.get(triggerBtn));
      copyCodeTimers.set(triggerBtn, setTimeout(() => {
        triggerBtn.classList.remove('copied');
        triggerBtn.textContent = triggerBtn.dataset.defaultLabel || 'Copy transcript';
      }, 1800));
    }
    toast('Markdown transcript copied.');
    return true;
  } catch (error) {
    toast(error?.message || 'Could not copy transcript.');
    return false;
  } finally {
    if (triggerBtn) triggerBtn.disabled = false;
  }
}

async function commitWorkspaceAction(task, message = '') {
  if (!task || commitBusy) return false;
  commitBusy = true;
  changesSignature = '';
  renderChanges(selectedData?.diff || []);
  try {
    const res = await api(`/api/tasks/${encodeURIComponent(task.id)}/commit`, {
      method: 'POST',
      body: JSON.stringify({ message: message.trim() || 'checkpoint' }),
    });
    if (Array.isArray(res.checkpoints)) checkpointsData = res.checkpoints;
    checkpointsCacheKey = '';
    commitFormOpen = false;
    renderCheckpoints(task);
    toast(res.committed
      ? `Committed checkpoint ${String(res.hash || '').slice(0, 7)}${res.summary ? ` · ${res.summary}` : ''}.`
      : 'Nothing new to commit.');
    await refresh();
    return true;
  } catch (error) {
    toast(error.message);
    return false;
  } finally {
    commitBusy = false;
    changesSignature = '';
    if (selectedData) renderChanges(selectedData.diff || []);
  }
}

function renderCheckpoints(task) {
  const container = $('#checkpoints-list');
  if (!container) return;
  if (!task) { container.innerHTML = '<p class="small-copy muted">Select a task.</p>'; return; }
  if (!checkpointsData.length) {
    container.innerHTML = '<p class="small-copy muted">No git checkpoints yet.</p>';
    return;
  }
  const idle = !ACTIVE.has(task.status) && !task.draining && task.status !== 'cancelled' && !isCrewBusy(task) && !task.sourceBusy && !sourceActionBusy;
  const busy = checkpointRestoreBusy || stripActionBusy;
  container.innerHTML = `<ol class="checkpoint-list">${checkpointsData.map((cp, index) => {
    const current = index === 0;
    const forkBtn = idle
      ? `<button type="button" class="button button-quiet checkpoint-fork" data-fork-checkpoint="${escapeHTML(cp.hash)}" title="Fork a new task from this checkpoint" ${busy ? 'disabled' : ''}>Fork</button>`
      : '';
    const rightSide = current
      ? `<span class="checkpoint-actions"><span class="checkpoint-current">Current</span>${forkBtn}</span>`
      : idle
        ? `<span class="checkpoint-actions">${forkBtn}<button type="button" class="button button-quiet checkpoint-restore" data-restore-checkpoint="${escapeHTML(cp.hash)}" ${busy ? 'disabled' : ''}>Restore</button></span>`
        : '';
    return `<li class="checkpoint-item${current ? ' is-current' : ''}"><div class="checkpoint-top"><code class="checkpoint-hash" title="${escapeHTML(cp.hash)}">${escapeHTML(cp.shortHash)}</code><time class="checkpoint-date" title="${escapeHTML(cp.date)}">${escapeHTML(shortDate(cp.date))}</time>${rightSide}</div><div class="checkpoint-subject" title="${escapeHTML(cp.subject)}">${escapeHTML(cp.subject || 'checkpoint')}</div></li>`;
  }).join('')}</ol>`;
}

async function loadCheckpoints(task, force = false) {
  if (!task) { checkpointsRequestSeq += 1; checkpointsCacheKey = ''; checkpointsData = []; renderCheckpoints(null); return; }
  const cacheKey = `${task.id}:${task.version}:${task.epoch}:${task.calls}:${task.status}`;
  if (!force && cacheKey === checkpointsCacheKey) { renderCheckpoints(task); return; }
  checkpointsCacheKey = cacheKey;
  const targetId = task.id;
  const reqSeq = ++checkpointsRequestSeq;
  try {
    const res = await api(`/api/tasks/${encodeURIComponent(targetId)}/checkpoints`);
    if (selectedId !== targetId || reqSeq !== checkpointsRequestSeq) return;
    checkpointsData = Array.isArray(res.checkpoints) ? res.checkpoints : [];
    const currentTask = selectedData?.task || task;
    renderCheckpoints(currentTask);
    if (currentTask) renderTaskMetaStrip(currentTask);
  } catch {
    if (selectedId === targetId && reqSeq === checkpointsRequestSeq) {
      checkpointsData = [];
      const currentTask = selectedData?.task || task;
      renderCheckpoints(currentTask);
      if (currentTask) renderTaskMetaStrip(currentTask);
    }
  }
}

async function restoreCheckpointAction(task, hash) {
  if (!task || !hash || checkpointRestoreBusy || stripActionBusy) return false;
  checkpointRestoreBusy = true;
  renderCheckpoints(task);
  try {
    const response = await api(`/api/tasks/${encodeURIComponent(task.id)}/rewind`, { method: 'POST', body: JSON.stringify({ hash }) });
    checkpointsCacheKey = '';
    if (selectedData && response.task && selectedData.task?.id === task.id) renderSelected({ ...selectedData, task: response.task }, true);
    toast(`Restored checkpoint ${response.rewind?.toHash || hash.slice(0, 7)}.`);
    await refresh();
    return true;
  } catch (error) {
    composerErrors.set(task.id, error.message);
    toast(error.message);
    renderComposer();
    return false;
  } finally {
    checkpointRestoreBusy = false;
    if (selectedData?.task) renderCheckpoints(selectedData.task);
  }
}

function formatCompactTokens(n) {
  const num = Number(n) || 0;
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(num >= 10_000_000 ? 1 : 2)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(num >= 100_000 ? 0 : 1)}k`;
  return String(Math.round(num));
}

function formatEstimatedCostUsd(usd) {
  if (!Number.isFinite(usd) || usd <= 0) return '';
  if (usd < 0.001) return '<$0.001';
  if (usd < 0.01) return `~$${usd.toFixed(4)}`;
  if (usd < 1) return `~$${usd.toFixed(3)}`;
  return `~$${usd.toFixed(2)}`;
}

function pricingForProviderId(providerId) {
  if (!providerId) return null;
  const prov = providerById(providerId);
  const meta = prov?.meta || modelMetaById(providerId);
  if (meta?.billing === 'local' || meta?.billing === 'subscription' || prov?.tier === 'local' || prov?.kind === 'cli') return null;
  const p = prov?.pricing || meta?.pricing;
  if (p && Number.isFinite(p.inputPer1M) && Number.isFinite(p.outputPer1M) && (p.inputPer1M > 0 || p.outputPer1M > 0)) {
    return p;
  }
  if (prov?.model && Array.isArray(openrouterCatalog?.models)) {
    const m = openrouterCatalog.models.find(item => item.id === prov.model);
    if (m?.pricing && Number.isFinite(m.pricing.inputPer1M) && Number.isFinite(m.pricing.outputPer1M) && (m.pricing.inputPer1M > 0 || m.pricing.outputPer1M > 0)) {
      return m.pricing;
    }
  }
  return null;
}

function computeTaskUsageSummary(task, events) {
  const evList = Array.isArray(events) ? events : [];
  let totalIn = 0, totalOut = 0, estCostUsd = 0, pricedTurns = 0;
  for (const ev of evList) {
    if (ev.type !== 'model.response') continue;
    const usage = ev.data?.response?.usage;
    if (!usage || typeof usage !== 'object') continue;
    const inTok = Number(usage.input_tokens ?? usage.prompt_tokens ?? 0) || 0;
    const outTok = Number(usage.output_tokens ?? usage.completion_tokens ?? 0) || 0;
    totalIn += inTok;
    totalOut += outTok;
    const pid = ev.data?.providerId || task?.providerId;
    const pricing = pricingForProviderId(pid);
    if (pricing) {
      estCostUsd += (inTok * pricing.inputPer1M + outTok * pricing.outputPer1M) / 1_000_000;
      pricedTurns += 1;
    }
  }
  const totalTokens = totalIn + totalOut;
  const costLabel = pricedTurns > 0 ? formatEstimatedCostUsd(estCostUsd) : '';
  return { totalIn, totalOut, totalTokens, estCostUsd, costLabel };
}

function renderTaskMetaStrip(task) {
  const strip = $('#task-meta-strip');
  if (!strip) return;
  if (!task) { setVisible('#task-meta-strip', false); strip.innerHTML = ''; return; }
  const provider = providerById(task.providerId);
  const modelLabel = task.answerRace ? `${task.answerRace.models.length} Conclave writers` : provider?.label || task.providerId || 'No model';
  const tier = String(provider?.tier || 'standard').toLowerCase();
  const calls = Number(task.calls ?? 0);
  const maxCalls = Number(task.policy?.maxCalls ?? 0);
  const idle = !ACTIVE.has(task.status) && !task.draining && task.status !== 'cancelled' && !isCrewBusy(task) && !task.sourceBusy && !sourceActionBusy;
  const compactSvg = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 6h12M6 10h8M8 14h4"/></svg>';
  const undoSvg = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 6 3 10l4 4"/><path d="M4 10h8a4 4 0 1 1 0 8H9"/></svg>';
  const forkSvg = '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="6" cy="5" r="2"/><circle cx="14" cy="5" r="2"/><circle cx="10" cy="15" r="2"/><path d="M6 7v2a3 3 0 0 0 3 3h2a3 3 0 0 0 3-3V7M10 12v1"/></svg>';
  const canUndo = checkpointsData.length > 1;
  const undoTitle = canUndo ? 'Undo last git checkpoint (/undo)' : 'No earlier git checkpoint to undo yet.';
  const hasArtifact = Boolean(lastDetectedArtifact && lastDetectedArtifact.taskId === task.id);
  const isBrowserDock = hasArtifact && lastDetectedArtifact.source === 'agent-browser';
  const dockLabel = isBrowserDock ? 'Browser' : 'Preview';
  const canvasBtn = hasArtifact
    ? `<button type="button" class="strip-action-btn strip-canvas-btn${artifactDockState.open ? ' is-active' : ''}" data-toggle-artifact-dock title="${artifactDockState.open ? `Hide ${dockLabel.toLowerCase()} panel` : `Open ${dockLabel.toLowerCase()} panel`}" aria-pressed="${artifactDockState.open ? 'true' : 'false'}"><span class="strip-dot" aria-hidden="true"></span><span>${dockLabel}</span></button>`
    : '';
  const evList = Array.isArray(selectedData?.events) ? selectedData.events : [];
  const usageSummary = computeTaskUsageSummary(task, evList);
  const lastReq = [...evList].reverse().find(e => e.type === 'model.request' && Number.isFinite(e.data?.contextBytes));
  const estBytes = lastReq
    ? Number(lastReq.data.contextBytes)
    : (String(task.objective || '').length + (task.followups || []).reduce((s, f) => s + String(f?.message || '').length, 0) + evList.filter(e => e.type === 'model.response').reduce((s, e) => s + String(e.data?.response?.text || '').length, 0));
  const ctxPct = Math.min(100, Math.round((estBytes / (128 * 1024)) * 100));
  const turnCount = 1 + (task.followups?.length || 0);
  const showCtx = ctxPct >= 25 || Boolean(task.workingSummary);
  const ctxTone = ctxPct >= 85 ? 'ctx-high' : ctxPct >= 65 ? 'ctx-warn' : '';
  const showCompactBtn = task.workspaceKind !== 'conversation' || ctxPct >= 50 || turnCount >= 6;
  const priv = state.privacy?.settings || {};
  const provZdr = provider?.zdr?.zdrClass || (tier === 'local' ? 'local-only' : 'provider-policy');
  const showStrictPrivacy = Boolean(priv.localOnly || priv.strictZdr || provZdr === 'local-only');
  const privacyLabel = priv.localOnly || provZdr === 'local-only' ? 'Local only' : 'Strict ZDR';
  const metaParts = [
    `<span class="strip-meta-item strip-model-name" title="Active model: ${escapeHTML(modelLabel)}">${escapeHTML(modelLabel)}</span>`,
  ];
  if (task.planMode) {
    metaParts.push('<span class="strip-meta-item strip-mode-tag" title="Read-only Plan Mode (⌘⇧P to toggle)">Plan</span>');
  }
  if (showStrictPrivacy) {
    metaParts.push(`<button type="button" class="strip-meta-link" data-open-privacy title="Privacy &amp; ZDR Shield">${escapeHTML(privacyLabel)}</button>`);
  }
  if (calls > 0) {
    const nearLimit = maxCalls > 0 && calls >= maxCalls * 0.8;
    metaParts.push(`<span class="strip-meta-item strip-calls${nearLimit ? ' is-warn' : ''}" title="Model calls used / call limit">${escapeHTML(calls)}/${escapeHTML(maxCalls || '—')} calls</span>`);
  }
  if (usageSummary.totalTokens > 0) {
    const tokLabel = `${formatCompactTokens(usageSummary.totalTokens)} tok${usageSummary.costLabel ? ` · ${usageSummary.costLabel}` : ''}`;
    const tokTitle = `Observed tokens: ${usageSummary.totalIn.toLocaleString()} in + ${usageSummary.totalOut.toLocaleString()} out = ${usageSummary.totalTokens.toLocaleString()} total${usageSummary.costLabel ? ` · Estimated API spend ${usageSummary.costLabel}` : ''}`;
    metaParts.push(`<span class="strip-meta-item strip-usage" title="${escapeHTML(tokTitle)}">${escapeHTML(tokLabel)}</span>`);
  }
  if (showCtx) {
    metaParts.push(`<span class="strip-meta-item strip-ctx ${ctxTone}" title="Conversation context budget (~${Math.round(estBytes / 1024)} / 128 KiB · ${turnCount} turns)">${ctxPct}% ctx</span>`);
  }
  const actionParts = [];
  if (canvasBtn) actionParts.push(canvasBtn);
  if (idle) {
    if (showCompactBtn) actionParts.push(`<button type="button" class="strip-action-btn" data-strip-action="compact" title="Compact context into fresh-eyes summary (/compact)" aria-label="Compact context" ${stripActionBusy ? 'disabled' : ''}>${compactSvg}<span>Compact</span></button>`);
    if (task.workspaceKind !== 'conversation') actionParts.push(`<button type="button" class="strip-action-btn" data-strip-action="undo" title="${undoTitle}" aria-label="Undo checkpoint" ${stripActionBusy || !canUndo ? 'disabled' : ''}>${undoSvg}<span>Undo</span></button>`);
    actionParts.push(`<button type="button" id="fork-task-btn" class="strip-action-btn" data-strip-action="fork" title="Fork into a new task branch (/fork)" aria-label="Fork task" ${stripActionBusy ? 'disabled' : ''}>${forkSvg}<span>Fork</span></button>`);
    if (task.status === 'completed' || (task.calls || 0) > 0) {
      actionParts.push(`<button type="button" id="save-skill-btn" class="strip-action-btn" data-strip-action="save-skill" title="Distill this run into a reusable /slash skill (/save-skill)" aria-label="Save run as reusable skill" ${stripActionBusy ? 'disabled' : ''}><span aria-hidden="true">✦</span><span>Save Skill</span></button>`);
    }
  }
  const metaHtml = metaParts.map((part, i) => {
    if (i === 0) return part;
    const sepCls = part.includes('strip-calls') ? 'strip-sep strip-sep-calls' : 'strip-sep';
    return `<span class="${sepCls}" aria-hidden="true">·</span>${part}`;
  }).join('');
  strip.innerHTML =
    `<span class="strip-meta-group">${metaHtml}</span>`
    + (actionParts.length ? `<span class="strip-actions" role="group" aria-label="Quick actions">${actionParts.join('')}</span>` : '');
  setVisible('#task-meta-strip', true);
}

async function togglePlanMode(task, explicitEnabled) {
  const target = task || null;
  const next = typeof explicitEnabled === 'boolean' ? explicitEnabled : !(target ? Boolean(target.planMode) : draftPlanMode);
  if (!target) {
    draftPlanMode = next;
    renderComposer();
    toast(next ? 'New conversation will start in Plan Mode (read-only).' : 'Switched to Build Mode.');
    return true;
  }
  if (planModeBusy) return false;
  planModeBusy = true;
  renderPlanModeControl(target, false);
  renderPlanReadyBanner(target, false);
  try {
    const response = await api(`/api/tasks/${encodeURIComponent(target.id)}/plan-mode`, { method: 'POST', body: JSON.stringify({ enabled: next }) });
    if (!next) planBannerDismissedVersion.delete(target.id);
    if (selectedData && response.task && selectedData.task?.id === target.id) {
      renderSelected({ ...selectedData, task: response.task }, true);
    }
    toast(next ? 'Plan Mode enabled (read-only).' : 'Build Mode enabled.');
    await refresh();
    return true;
  } catch (error) {
    composerErrors.set(target.id, error.message);
    renderComposer();
    return false;
  } finally {
    planModeBusy = false;
    renderPlanModeControl(selectedData?.task || null, false);
    renderPlanReadyBanner(selectedData?.task || null, false);
  }
}

async function executeSlashCommand(raw) {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('/')) return { handled: false };
  const parts = trimmed.split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const arg = parts.slice(1).join(' ').trim();
  const key = selectedId || 'welcome';
  const task = selectedData?.task?.id === selectedId ? selectedData.task : null;
  const clearInput = () => {
    if (composerDrafts.get(key) === raw) saveComposerDraft(key, '');
    if (composerScope === key) { $('#composer-input').value = ''; resizeComposer(); }
    composerErrors.delete(key);
    renderComposer();
  };
  if (cmd === '/plan') {
    clearInput();
    await togglePlanMode(task, true);
    return { handled: true };
  }
  if (cmd === '/effort') {
    clearInput();
    const want = arg.trim().toLowerCase();
    if (!want) { toggleEffortPopover(true); return { handled: true }; }
    await setEffortLevel(task, want === 'instant' || want === 'low' ? 'fast' : want === 'deep' ? 'high' : want);
    return { handled: true };
  }
  if (cmd === '/fast') {
    clearInput();
    await setEffortLevel(task, 'fast');
    return { handled: true };
  }
  if (cmd === '/godmode') {
    clearInput();
    applyAppMode('godmode', { persist: true, notify: true, switchView: true });
    return { handled: true };
  }
  if (cmd === '/godcode') {
    clearInput();
    applyAppMode('godcode', { persist: true, notify: true, switchView: false });
    return { handled: true };
  }
  if (cmd === '/system' || cmd === '/schemas') {
    clearInput();
    await openSettings('system', { subtab: cmd === '/schemas' ? 'tools' : 'prompts' });
    return { handled: true };
  }
  if (cmd === '/prefill' || cmd === '/inject') {
    clearInput();
    await openSettings('system', { subtab: 'lab' });
    return { handled: true };
  }
  if (cmd === '/build') {
    if (task?.workspaceKind === 'conversation') {
      if (task?.planMode) await togglePlanMode(task, false);
      if (arg || task?.codeWorkspace) return { handled: false };
      clearInput();
      return { handled: true };
    }
    clearInput();
    await togglePlanMode(task, false);
    return { handled: true };
  }
  if (cmd === '/compact') {
    if (!task) { composerErrors.set(key, 'Select a task before running /compact.'); renderComposer(); return { handled: true }; }
    clearInput();
    await compactTaskAction(task);
    return { handled: true };
  }
  if (cmd === '/diff') {
    if (!task) { composerErrors.set(key, 'Select a task to view its workspace diff.'); renderComposer(); return { handled: true }; }
    clearInput();
    chooseTab('changes');
    toast('Viewing workspace changes.');
    return { handled: true };
  }
  if (cmd === '/undo') {
    if (!task) { composerErrors.set(key, 'Select a task before running /undo.'); renderComposer(); return { handled: true }; }
    const steps = arg ? Number(arg) : 1;
    if (!Number.isInteger(steps) || steps < 1 || steps > 50) {
      composerErrors.set(key, 'Usage: /undo [steps] where steps is an integer from 1 to 50.');
      renderComposer();
      return { handled: true };
    }
    clearInput();
    await rewindTaskAction(task, steps);
    return { handled: true };
  }
  if (cmd === '/model' || cmd === '/models') {
    clearInput();
    openModels();
    return { handled: true };
  }
  if (cmd === '/review') {
    if (!task) { composerErrors.set(key, 'Select a task before running /review.'); renderComposer(); return { handled: true }; }
    const prompt = arg
      ? `Review the current workspace changes focusing on: ${arg}. Report concrete defects, edge cases, and missing tests with file paths.`
      : 'Review all current workspace changes against the objective, check for bugs, edge cases, and missing tests, and summarize concrete findings with file paths.';
    return { handled: false, overrideMessage: prompt };
  }
  if (cmd === '/test') {
    if (!task) { composerErrors.set(key, 'Select a task before running /test.'); renderComposer(); return { handled: true }; }
    const prompt = arg
      ? `Run targeted tests for: ${arg}, and report the exact observed command output and results.`
      : 'Run the relevant targeted tests and configured acceptance checks for the current changes, and report the exact observed results.';
    return { handled: false, overrideMessage: prompt };
  }
  if (cmd === '/rename') {
    if (!task) { composerErrors.set(key, 'Select a conversation before running /rename.'); renderComposer(); return { handled: true }; }
    clearInput();
    if (arg) await renameTaskAction(task, arg);
    else startInlineRename(task, $('#selected-title'));
    return { handled: true };
  }
  if (cmd === '/fork') {
    if (!task) { composerErrors.set(key, 'Select a task before running /fork.'); renderComposer(); return { handled: true }; }
    clearInput();
    await forkTaskAction(task, arg ? { title: arg } : {});
    return { handled: true };
  }
  if (cmd === '/export') {
    if (!task) { composerErrors.set(key, 'Select a task before running /export.'); renderComposer(); return { handled: true }; }
    clearInput();
    await copyTranscriptAction(task);
    return { handled: true };
  }
  if (cmd === '/remember') {
    if (!arg) {
      composerErrors.set(key, 'Usage: /remember <note> (or /remember Title: details).');
      renderComposer();
      return { handled: true };
    }
    const colonIdx = arg.indexOf(':');
    let title, content;
    if (colonIdx > 0 && colonIdx <= 60 && arg.slice(colonIdx + 1).trim()) {
      title = arg.slice(0, colonIdx).trim();
      content = arg.slice(colonIdx + 1).trim();
    } else {
      title = arg.length > 60 ? `${arg.slice(0, 57).trim()}…` : arg;
      content = arg;
    }
    const scope = task ? 'project' : 'global';
    clearInput();
    try {
      await api('/api/memory', {
        method: 'POST',
        body: JSON.stringify({ title, content, scope, ...(task ? { taskId: task.id } : {}) }),
      });
      toast(`Saved to ${scope} memory: ${title}`);
      if ($('#settings-dialog')?.open && typeof loadMemorySettings === 'function') await loadMemorySettings();
    } catch (error) {
      composerErrors.set(key, error.message);
      toast(error.message);
      renderComposer();
    }
    return { handled: true };
  }
  if (cmd === '/memory') {
    clearInput();
    try {
      const params = new URLSearchParams();
      if (arg) params.set('q', arg);
      if (task) params.set('taskId', task.id);
      const res = await api(`/api/memory${params.toString() ? `?${params.toString()}` : ''}`);
      const count = Array.isArray(res.memories) ? res.memories.length : 0;
      toast(arg ? `Found ${count} matching ${count === 1 ? 'memory' : 'memories'} for "${arg}".` : `${count} saved ${count === 1 ? 'memory' : 'memories'}.`);
    } catch (error) {
      toast(error.message);
    }
    openSettings('memory', { query: arg });
    return { handled: true };
  }
  if (cmd === '/skill') {
    if (!arg || arg === 'list') {
      clearInput();
      openSettings('memory');
      return { handled: true };
    }
    const saveMatch = arg.match(/^save\s+([a-zA-Z0-9_-]+)\s+([\s\S]+)$/);
    if (!saveMatch) {
      composerErrors.set(key, 'Usage: /skill save <name> <instructions>');
      renderComposer();
      return { handled: true };
    }
    const skillName = saveMatch[1].toLowerCase();
    const skillBody = saveMatch[2].trim();
    const skillDesc = skillBody.split('\n')[0].slice(0, 120);
    clearInput();
    try {
      await api('/api/skills', {
        method: 'POST',
        body: JSON.stringify({ name: skillName, description: skillDesc, body: skillBody }),
      });
      await loadSkills(selectedId);
      toast(`Saved reusable skill /${skillName}.`);
      if ($('#settings-dialog')?.open && typeof loadSkillsSettings === 'function') await loadSkillsSettings();
    } catch (error) {
      composerErrors.set(key, error.message);
      toast(error.message);
      renderComposer();
    }
    return { handled: true };
  }
  if (cmd === '/privacy' || cmd === '/zdr') {
    clearInput();
    openSettings('privacy');
    return { handled: true };
  }
  if (cmd === '/schedules' || cmd === '/schedule' || cmd === '/cron' || cmd === '/crons') {
    clearInput();
    openSettings('schedules');
    return { handled: true };
  }
  if (cmd === '/northstar' || cmd === '/climb' || cmd === '/autoresearch') {
    clearInput();
    if (window.G0DNorthStar?.openLauncher) window.G0DNorthStar.openLauncher(arg);
    else openSettings('schedules');
    return { handled: true };
  }
  if (cmd === '/alerts' || cmd === '/notifications' || cmd === '/sounds') {
    clearInput();
    openSettings('notifications');
    return { handled: true };
  }
  if (cmd === '/mute') {
    clearInput();
    if (window.G0DAlerts) {
      const next = !window.G0DAlerts.get().muted;
      window.G0DAlerts.update({ muted: next });
      toast(next ? 'Sounds & notifications muted (Do Not Disturb).' : 'Sounds & notifications unmuted.');
    }
    return { handled: true };
  }
  if (cmd === '/help') {
    clearInput();
    toast('Commands: /plan, /build, /compact, /diff, /undo, /fork, /export, /remember, /memory, /skill, /model, /review, /test, /help');
    dismissDrawers();
    if (!$('#shortcuts-dialog')?.open) $('#shortcuts-dialog')?.showModal();
    return { handled: true };
  }
  if (cmd === '/ultra') {
    clearInput();
    await toggleUltra(task);
    return { handled: true };
  }
  if (cmd === '/settings') {
    clearInput();
    openSettings('general');
    return { handled: true };
  }
  if (cmd === '/fixtures') {
    clearInput();
    openCreate();
    return { handled: true };
  }
  if (cmd === '/forge') {
    const promptText = arg.trim();
    if (!promptText) {
      toast('Usage: /forge <your prompt> — synthesizes a task-specific Megaprompt into the composer.');
      return { handled: true };
    }
    toast('✦ Forging task-specific Megaprompt…');
    try {
      const forged = await api('/api/metacognition/forge', {
        method: 'POST',
        body: JSON.stringify({
          objective: promptText,
          providerId: task?.providerId || newConversationProviders()[0] || null,
          effort: task?.effort || draftEffort || 'medium',
          workspaceKind: task?.workspaceKind || (appMode === 'godcode' ? 'project' : 'conversation'),
        }),
      });
      const input = $('#composer-input');
      if (input && forged?.compiledBrief) {
        input.value = `${promptText}\n\n${forged.compiledBrief}`;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.focus();
      }
      toast(`✦ Forged ${forged?.domainLabel || 'task'} Megaprompt (${forged?.tier === 'forged' ? `${forged.durationMs}ms` : '0ms smart'}) — review & press Enter.`);
    } catch (error) {
      toast(error.message || 'Could not forge Megaprompt.');
    }
    return { handled: true };
  }
  if (cmd === '/visualize' || cmd === '/viz') {
    clearInput();
    const refinement = (arg || '').trim();
    window.G0DVisualizer?.open(selectedId, { autoGenerate: true, instruction: refinement });
    return { handled: true };
  }
  if (cmd === '/browser') {
    clearInput();
    const sub = (arg || '').trim().toLowerCase();
    if (sub === 'window' || sub === 'visible' || sub === 'popout') {
      window.G0DBrowserLive?.open();
      window.G0DBrowserLive?.setWindowMode(true, { persist: false });
    } else if (sub === 'headless' || sub === 'mirror') {
      window.G0DBrowserLive?.open();
      window.G0DBrowserLive?.setWindowMode(false, { persist: false });
    } else if (sub === 'close' || sub === 'stop') {
      window.G0DBrowserLive?.stopSession();
    } else {
      window.G0DBrowserLive?.toggle();
    }
    return { handled: true };
  }
  if (cmd === '/conclave' || cmd === '/swarm') {
    const sub = arg.trim();
    if (!sub) {
      clearInput();
      window.G0DConclave?.toggle();
      return { handled: true };
    }
    if (/^(demo|preview)$/i.test(sub)) { clearInput(); window.G0DConclave?.open({ demo: true }); return { handled: true }; }
    if (/^(cards|timeline|stage|roster)$/i.test(sub)) { clearInput(); window.G0DConclave?.open({ lens: sub.toLowerCase() }); return { handled: true }; }
    if (/^(builder|forge)$/i.test(sub)) { clearInput(); window.G0DConclave?.open({ lens: 'roster' }); window.G0DConclave?.openBuilder(null); return { handled: true }; }
    // Direct 1-command launch: `/conclave <any long-form mission>` auto-picks specialists and runs native multi-round Conclave 2.0!
    clearInput();
    window.G0DConclave?.open({ lens: 'stage' });
    const rec = window.G0DConclave?.recommendTeam ? window.G0DConclave.recommendTeam(sub) : { agents: ['explore', 'analyst', 'strategist'], mode: 'parallel' };
    if (typeof window.launchNativeConclave === 'function') {
      void window.launchNativeConclave({ mission: sub, agents: rec.agents, mode: rec.mode });
      return { handled: true };
    }
    const built = window.G0DConclave?.buildMissionPrompt ? window.G0DConclave.buildMissionPrompt(sub) : sub;
    return { handled: false, overrideMessage: built };
  }
  if (cmd === '/save-skill') {
    if (!task) { composerErrors.set(key, 'Select a task before running /save-skill.'); renderComposer(); return { handled: true }; }
    clearInput();
    await saveTaskAsSkillAction(task, arg.trim());
    return { handled: true };
  }
  if (cmd === '/benchmark') {
    clearInput();
    openBenchmark();
    return { handled: true };
  }
  if (cmd === '/clear') {
    clearInput();
    newConversation();
    return { handled: true };
  }
  const matchedSkill = (state.skills || []).find(s => (s.command || `/${s.name}`).toLowerCase() === cmd || `/${s.name}`.toLowerCase() === cmd);
  if (matchedSkill && matchedSkill.body) {
    let expanded = matchedSkill.body;
    if (expanded.includes('$ARGUMENTS')) {
      expanded = expanded.replaceAll('$ARGUMENTS', arg);
    } else if (arg) {
      expanded = `${expanded}\n\n${arg}`;
    }
    return { handled: false, overrideMessage: expanded.trim() };
  }
  return { handled: false };
}

function closeAllRightDocks({ except = null } = {}) {
  if (except !== 'artifact') closeArtifactDock({ recordDismiss: false });
  if (except !== 'code') window.closeChatCode?.();
  if (except !== 'conclave' && window.G0DConclave?.isOpen?.()) window.G0DConclave.close();
  if (except !== 'browser' && window.G0DBrowserLive?.isOpen?.()) window.G0DBrowserLive.close();
  if (except !== 'visualizer' && window.G0DVisualizer?.isOpen?.()) window.G0DVisualizer.close();
  if (except !== 'inspector' && document.body.classList.contains('inspector-open')) {
    document.body.classList.remove('inspector-open');
    syncPanels();
  }
}
window.closeAllRightDocks = closeAllRightDocks;
window.launchNativeConclave = async function launchNativeConclave({ mission, agents, mode = 'parallel', formationName = null } = {}) {
  const cleanMission = String(mission || '').trim();
  if (!cleanMission) return false;
  if ($('#connection') && !$('#connection').classList.contains('online')) {
    toast('Server is offline — reconnect before launching a Conclave.');
    return false;
  }
  const avail = typeof newConversationProviders === 'function' ? newConversationProviders() : [];
  if (!selectedId && !avail.length) {
    toast('Connect at least one AI provider in Settings → Models before launching a Conclave.');
    return false;
  }
  const activeTask = selectedId && selectedData?.task?.id === selectedId ? selectedData.task : null;
  if (activeTask && (ACTIVE.has(activeTask.status) || activeTask.status === 'cancelled' || activeTask.draining || isCrewBusy(activeTask))) {
    toast('Current task is busy or unavailable — start a new chat or wait a moment.');
    return false;
  }
  try {
    const res = await api('/api/conclave/run', {
      method: 'POST',
      body: JSON.stringify({
        ...(selectedId ? { taskId: selectedId } : { providerIds: avail }),
        mission: cleanMission,
        agents: Array.isArray(agents) && agents.length ? agents : ['explore', 'analyst', 'strategist'],
        mode,
        ...(formationName ? { formationName } : {}),
      }),
    });
    if (res?.task?.id) {
      if (res.task.id !== selectedId) {
        state.tasks = [res.task, ...(state.tasks || []).filter(t => t.id !== res.task.id)];
        await selectTask(res.task.id);
      } else {
        await refresh();
      }
      window.G0DConclave?.open?.({ lens: 'stage' });
      window.G0DConclave?.syncTask?.(res.task);
    }
    return true;
  } catch (err) {
    toast(err?.message || 'Could not launch Conclave.');
    return false;
  }
};
window.launchBlindRace = async function launchBlindRace(mission) {
  const cleanMission = String(mission || '').trim();
  if (!cleanMission) return false;
  if ($('#connection') && !$('#connection').classList.contains('online')) {
    toast('Server is offline — reconnect before launching a Blind Race.');
    return false;
  }
  const avail = typeof newConversationProviders === 'function' ? newConversationProviders() : [];
  if (!avail.length) {
    toast('Connect at least one AI provider in Settings → Models before launching a Blind Race.');
    return false;
  }
  try {
    const routerRes = await api('/api/router', {
      method: 'PATCH',
      body: JSON.stringify({ mode: 'auto_arena' }),
    });
    if (routerRes?.settings) state.router = routerRes.settings;
    else state.router = { ...(state.router || {}), mode: 'auto_arena' };
    renderComposer();
    const preferences = RecoveryUI.preferences();
    const { task } = await api('/api/conversations', {
      method: 'POST',
      body: JSON.stringify({
        objective: cleanMission,
        providerIds: avail,
        generation: generationDefaults(),
        persona: preferences.persona || 'plinian',
        effort: draftEffort,
        policy: RecoveryUI.policy(null),
        planMode: false,
      }),
    });
    if (task?.id) {
      state.tasks = [task, ...(state.tasks || []).filter(t => t.id !== task.id)];
      await selectTask(task.id);
      window.G0DConclave?.open?.({ lens: 'stage' });
      window.G0DConclave?.syncTask?.(task);
      await api(`/api/tasks/${encodeURIComponent(task.id)}/run`, { method: 'POST', body: '{}' });
      await refresh();
    }
    return true;
  } catch (err) {
    toast(err?.message || 'Could not launch Blind Conclave Race.');
    return false;
  }
};
window.submitConclaveMission = function submitConclaveMission(promptText) {
  const input = $('#composer-input');
  const form = $('#composer-form');
  const sendBtn = $('#composer-send');
  if (!input || !promptText) return false;
  if ($('#connection') && !$('#connection').classList.contains('online')) {
    toast('Server is offline — reconnect before launching a Conclave.');
    return false;
  }
  const key = selectedId || 'welcome';
  if (!selectedId) {
    const avail = typeof newConversationProviders === 'function' ? newConversationProviders() : [];
    if (!avail.length) {
      toast('Connect at least one AI provider in Settings → Models before launching a Conclave.');
      return false;
    }
  } else {
    const task = selectedData?.task;
    if (!task || task.id !== selectedId || task.status === 'cancelled' || task.draining || task.sourceBusy || sourceActionBusy || isCrewBusy(task) || messageBusyTasks.has(key) || actionBusy) {
      toast('Current task is busy or unavailable — start a new chat or wait a moment.');
      return false;
    }
  }
  const prevValue = input.value;
  input.value = String(promptText);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  if (sendBtn?.disabled) {
    input.value = prevValue;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    toast('Composer is currently unavailable to send — check your connected model or task state.');
    return false;
  }
  if (form?.requestSubmit) {
    form.requestSubmit();
    return true;
  }
  input.focus();
  return false;
};

function closeAllPopovers(exceptId = null) {
  if (exceptId !== 'theme-popover') {
    $('#theme-popover')?.classList.add('hidden');
    $('#theme-toggle')?.setAttribute('aria-expanded', 'false');
  }
  if (exceptId !== 'overseer-popover') {
    $('#overseer-popover')?.classList.add('hidden');
    $('#overseer-toggle')?.setAttribute('aria-expanded', 'false');
  }
  if (exceptId !== 'ultra-popover') {
    $('#ultra-popover')?.classList.add('hidden');
    $('#composer-race')?.setAttribute('aria-expanded', 'false');
  }
  if (exceptId !== 'effort-popover') {
    $('#effort-popover')?.classList.add('hidden');
    $('#composer-effort')?.setAttribute('aria-expanded', 'false');
  }
  if (exceptId !== 'project-popover') {
    $('#project-popover')?.classList.add('hidden');
    $('#composer-project')?.setAttribute('aria-expanded', 'false');
  }
  if (exceptId !== 'composer-options') {
    setComposerOptionsOpen(false);
  }
}
window.closeAllPopovers = closeAllPopovers;

function dismissDrawers() {
  let changed = false;
  if (document.body.classList.contains('sidebar-open')) {
    document.body.classList.remove('sidebar-open');
    changed = true;
  }
  if (narrowLayout.matches && document.body.classList.contains('inspector-open')) {
    document.body.classList.remove('inspector-open');
    changed = true;
  }
  closeAllPopovers();
  if (changed) syncPanels();
}

function syncPanels() {
  const previousFocus = document.activeElement;
  if (!narrowLayout.matches && document.body.classList.contains('sidebar-open')) {
    document.body.classList.remove('sidebar-open');
  }
  const sidebarOpen = narrowLayout.matches ? document.body.classList.contains('sidebar-open') : !document.body.classList.contains('sidebar-collapsed');
  const inspectorOpen = document.body.classList.contains('inspector-open');
  $('#sidebar-toggle')?.setAttribute('aria-expanded', String(sidebarOpen));
  $('#inspector-toggle')?.setAttribute('aria-expanded', String(inspectorOpen));
  const sidebar = $('#sidebar'), inspector = $('#inspector');
  if (sidebar) { sidebar.inert = !sidebarOpen; sidebar.setAttribute('aria-hidden', String(!sidebarOpen)); }
  if (inspector) { inspector.inert = !inspectorOpen; inspector.setAttribute('aria-hidden', String(!inspectorOpen)); }
  const modalDrawer = narrowLayout.matches && (sidebarOpen || inspectorOpen);
  $('.app-header').inert = modalDrawer;
  $('#main-content').inert = modalDrawer;
  for (const [panel, open] of [[sidebar, sidebarOpen], [inspector, inspectorOpen]]) {
    if (narrowLayout.matches && open) { panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true'); }
    else { panel.removeAttribute('role'); panel.removeAttribute('aria-modal'); }
  }
  $('#sidebar-backdrop').setAttribute('aria-label', inspectorOpen ? 'Close task details' : 'Close sidebar');
  setVisible('#sidebar-backdrop', modalDrawer);
  if (!$('dialog[open]')) {
    const drawer = modalDrawer ? (inspectorOpen ? inspector : sidebar) : null;
    if (drawer && !drawer.contains(previousFocus)) (inspectorOpen ? $('#inspector-close') : $('#new-thread'))?.focus();
    else if (!sidebarOpen && sidebar.contains(previousFocus)) $('#sidebar-toggle')?.focus();
    else if (!inspectorOpen && inspector.contains(previousFocus)) $('#inspector-toggle')?.focus();
  }
}

function setSidebar(open) {
  if (narrowLayout.matches) {
    document.body.classList.toggle('sidebar-open', open);
    if (open) document.body.classList.remove('inspector-open');
  } else document.body.classList.toggle('sidebar-collapsed', !open);
  syncPanels();
  if (narrowLayout.matches) (open ? $('#new-thread') : $('#sidebar-toggle'))?.focus();
}

function setInspector(open, focus = false) {
  if (open) {
    closeAllRightDocks({ except: 'inspector' });
  }
  document.body.classList.toggle('inspector-open', open);
  if (open && narrowLayout.matches) document.body.classList.remove('sidebar-open');
  syncPanels();
  if (focus || narrowLayout.matches) (open ? $('#inspector-close') : $('#inspector-toggle'))?.focus();
}

function chooseTab(name) {
  if (!['timeline', 'changes', 'files', 'commands', 'activity'].includes(name)) return;
  const scroller = $('#task-content');
  const scopeKey = selectedId || 'welcome';
  const changed = currentTab !== name;
  if (changed && scroller) {
    tabScrollPositions.set(`${scopeKey}:${currentTab}`, scroller.scrollTop);
  }
  currentTab = name;
  $$('.workspace-tab').forEach((element) => { const active = element.dataset.tab === name; element.classList.toggle('active', active); element.setAttribute('aria-selected', String(active)); element.tabIndex = active ? 0 : -1; });
  ['timeline', 'changes', 'files', 'commands', 'activity'].forEach((tab) => setVisible(`#panel-${tab}`, tab === name));
  scroller?.setAttribute('aria-label', `${name === 'timeline' ? 'Conversation' : humanize(name)} content`);
  if (changed && scroller) {
    const saved = tabScrollPositions.get(`${scopeKey}:${name}`);
    scroller.scrollTop = typeof saved === 'number' ? saved : 0;
  }
  updateLatestButton();
}

function newConversation() {
  window.closeChatCode?.();
  lastDetectedArtifact = null;
  closeArtifactDock({ recordDismiss: false });
  composerAutocompleteState.hide?.();
  captureComposerDraft();
  if (typeof clearComposerAttachments === 'function') clearComposerAttachments();
  disconnectStream();
  welcomeRequested = true;
  selectedId = null;
  selectedData = null;
  selectionVersion += 1;
  detailSignature = '';
  routeDirty = false;
  commitFormOpen = false;
  splitPaneFile = null;
  diffCommentTarget = null;
  try { localStorage.setItem('g0dc0d3.selectedTask', 'welcome'); } catch { /* Optional preference. */ }
  chooseTab('timeline');
  renderTasks(true);
  renderEmpty();
  window.G0DConclave?.syncTask(null);
  window.G0DVisualizer?.onTaskChanged?.(null);
  loadSkills(null);
  if (narrowLayout.matches) setSidebar(false);
  $('#composer-input')?.focus();
}

function composeOutgoingMessage(message) {
  if (!composerFileAttachments.length) return message;
  let budget = 80000;
  const blocks = composerFileAttachments.map(f => {
    const body = f.content.length > budget ? f.content.slice(0, Math.max(0, budget)) + '\n[…truncated to fit message budget…]' : f.content;
    budget = Math.max(0, budget - body.length);
    return `<attached_file name="${f.name}"${f.meta ? ` info="${f.meta}"` : ''}>\n${body}\n</attached_file>`;
  }).join('\n\n');
  return message ? `${message}\n\n${blocks}` : blocks;
}

async function submitMessage(event) {
  event.preventDefault();
  setComposerOptionsOpen(false);
  if ($('#composer-send')?.dataset.composerStop === '1') {
    await taskAction('pause');
    return;
  }
  captureComposerDraft();
  const key = selectedId || 'welcome', raw = $('#composer-input').value;
  let message = raw.trim();
  if ((!message && !composerFileAttachments.length && !composerAttachments.length) || $('#composer-send').disabled) return;
  if (!message && (composerFileAttachments.length || composerAttachments.length)) message = 'Please analyze the attached file(s).';
  const editCommand = /^(?:please\s+)?(?:revise|edit|update|change)\s+(![A-Z][A-Z0-9_-]*\+?)(?:\s+to\s+|\s*:\s*|\s+)([\s\S]+)$/i.exec(message);
  const command = editCommand && promptLibrary.find(item=>item.tag===editCommand[1].toUpperCase());
  if (command) {
    saveComposerDraft(key,''); $('#composer-input').value=''; resizeComposer(); renderComposer();
    await openSettings('prompts');
    editPrompt(promptLibrary.find(item=>item.tag===command.tag) || command);
    $('#prompt-revision').open=true;
    $('#prompt-request').value=editCommand[2];
    $('#prompt-propose').click();
    return;
  }
  if (['/rewind','/undo'].includes(message) && selectedData?.task?.workspaceKind === 'conversation') {
    saveComposerDraft(key, '');
    $('#composer-input').value = ''; resizeComposer(); renderComposer();
    openLatestChatEdit();
    return;
  }
  if (message === '/theme' || message.startsWith('/theme ')) {
    saveComposerDraft(key, '');
    $('#composer-input').value = ''; resizeComposer(); renderComposer();
    const arg = message.slice(6).trim();
    if (!arg) { window.G0DThemes?.togglePopover(true); return; }
    const hit = window.G0DThemes?.matchByQuery(arg);
    if (hit) window.G0DThemes.apply(hit.id, { persist: true, notify: true });
    else toast(`Unknown theme "${arg}". Try: obsidian, minimal, alabaster, dragons, psychedelic, hacker, synthwave, vesuvian, ancient, celestial.`);
    return;
  }
  if (['/settings','/models','/prompts','/help'].includes(message)) {
    saveComposerDraft(key,'');
    $('#composer-input').value=''; resizeComposer(); renderComposer();
    if (message === '/help') $('#shortcuts-dialog').showModal();
    else await openSettings(message === '/settings' ? 'general' : message.slice(1));
    return;
  }
  const slashResult = await executeSlashCommand(raw);
  if (slashResult.handled) return;
  if (slashResult.overrideMessage) message = slashResult.overrideMessage;
  try { message = expandPromptCommand(message,selectedId ? 12000 : 30000); }
  catch (error) { composerErrors.set(key,error.message); renderComposer(); return; }
  message = composeOutgoingMessage(message);
  if (!selectedId) { await startConversation(raw,message); return; }
  const taskId = selectedId, version = selectionVersion;
  const task = selectedData?.task;
  if (task?.id !== taskId || task.draining || isCrewBusy(task) || task.status === 'cancelled' || messageBusyTasks.has(key)) return;
  const nextAttachments = composerAttachments.length ? composerAttachments.slice(0, 4) : null;
  const deliveryMode = $('#composer-delivery')?.value || 'queue';
  const sameAttachments = (a, b) => {
    const la = a || [], lb = b || [];
    return la.length === lb.length && la.every((item, idx) => item.name === lb[idx].name && item.dataUrl === lb[idx].dataUrl);
  };
  let submission = messageSubmissions.get(key);
  if (!submission || submission.message !== message || submission.mode !== deliveryMode || !sameAttachments(submission.attachments, nextAttachments)) {
    submission = { message, messageId: crypto.randomUUID(), mode: deliveryMode, ...(nextAttachments ? { attachments: nextAttachments } : {}) };
    messageSubmissions.set(key, submission);
  }
  messageBusyTasks.add(key);
  composerErrors.delete(key);
  renderControls(task);
  try {
    const callsUsed = Number(task.calls || 0);
    const maxCallsNow = Number(task.policy?.maxCalls || 0);
    const needsTopUp = !ACTIVE.has(task.status) && maxCallsNow < 5000 && (
      callsUsed >= maxCallsNow
      || (task.workspaceKind === 'conversation' && (maxCallsNow - callsUsed) < 25)
    );
    if (needsTopUp) {
      const nextMaxCalls = Math.min(5000, Math.max(maxCallsNow, callsUsed) + 100);
      await api(`/api/tasks/${encodeURIComponent(taskId)}/policy`, { method: 'PATCH', body: JSON.stringify({ maxCalls: nextMaxCalls }) });
    }
    const buildIntent = task.workspaceKind === 'conversation' && /^(?:\/build(?:\s|$)|let[’']?s build this\b(?:[.!?…\s]*$|[:,—]\s*))/i.test(message);
    const destination = buildIntent ? `/api/conversations/${encodeURIComponent(taskId)}/build-intent` : `/api/tasks/${encodeURIComponent(taskId)}/message`;
    const response = await api(destination, { method: 'POST', body: JSON.stringify(submission) });
    messageSubmissions.delete(key);
    if (response?.parallel) toast('Parallel sidecar started — running alongside main agent.');
    if (composerScope === key) clearComposerAttachments();
    if (composerDrafts.get(key) === raw) saveComposerDraft(key, '');
    if (composerScope === key && $('#composer-input').value === raw) { $('#composer-input').value = ''; resizeComposer(); }
    if (selectedId === taskId && version === selectionVersion && response.task && selectedData) {
      chooseTab('timeline');
      renderSelected({ ...selectedData, task: response.task }, true, { scrollToBottom: true });
      if (buildIntent) window.openChatCode(response.task, true);
    }
    await refresh();
  } catch (error) {
    composerErrors.set(key, error.message);
  } finally {
    messageBusyTasks.delete(key);
    if (selectedData?.task?.id === taskId) renderControls(selectedData.task);
    renderComposer();
  }
}

async function startConversation(raw, message = raw.trim()) {
  const providerIds = newConversationProviders();
  if (!providerIds.length) {
    composerErrors.set('welcome', 'Connect a model to send your message.');
    renderComposer();
    return;
  }
  const version = selectionVersion;
  messageBusyTasks.add('welcome');
  composerErrors.delete('welcome');
  renderComposer();
  let createdId;
  try {
    let preferences = {};
    try { preferences = JSON.parse(localStorage.getItem('g0dc0d3.defaults') || '{}'); } catch {}
    const attached = appMode === 'godcode' && pendingProject?.path ? pendingProject : null;
    if (attached && attached.mode === 'copy') {
      let preview = pendingProjectPreview && pendingProjectPreview.sourceInput === attached.path && pendingProjectPreview.snapshotHash
        ? pendingProjectPreview
        : null;
      if (!preview) {
        const res = await api('/api/workspaces/preview', { method: 'POST', body: JSON.stringify({ sourcePath: attached.path }) });
        preview = { ...res, sourceInput: attached.path };
        pendingProjectPreview = preview;
      }
      const { task } = await api('/api/tasks', {
        method: 'POST',
        body: JSON.stringify({
          sourcePath: preview.sourcePath,
          previewHash: preview.snapshotHash,
          objective: message,
          providerIds,
          persona: preferences.persona || 'plinian',
          effort: draftEffort,
          planMode: draftPlanMode,
          policy: RecoveryUI.policy(null),
          execution: { enabled: Boolean(state.executionAvailable), network: false, timeoutMs: 30000 },
          checks: [],
          ...(composerAttachments.length ? { attachments: composerAttachments.slice(0, 4) } : {}),
        }),
      });
      createdId = task.id;
      recordRecentProject(attached.path, 'copy');
      if (composerScope === 'welcome') clearComposerAttachments();
      if (composerDrafts.get('welcome') === raw) saveComposerDraft('welcome', '');
      if (composerScope === 'welcome' && $('#composer-input').value === raw) { $('#composer-input').value = ''; resizeComposer(); }
      state.tasks.unshift(task);
      if (!selectedId && version === selectionVersion) await selectTask(task.id);
      toast(`Started in ${attached.name} (isolated copy).`);
      await refresh();
      return;
    }
    const { task } = await api('/api/conversations', { method: 'POST', body: JSON.stringify({ objective: message, providerIds, generation: generationDefaults(), answerRace:preferences.answerRace || null, ultraplinian: Boolean(preferences.answerRace), persona: preferences.persona || 'plinian', effort: draftEffort, policy: RecoveryUI.policy(null), planMode: appMode === 'godcode' ? draftPlanMode : false, ...(composerAttachments.length ? { attachments: composerAttachments.slice(0, 4) } : {}) }) });
    createdId = task.id;
    if (attached && attached.mode === 'worktree') {
      try {
        await api(`/api/conversations/${encodeURIComponent(task.id)}/repository`, { method: 'POST', body: JSON.stringify({ repository: attached.path }) });
        recordRecentProject(attached.path, 'worktree');
      } catch (wtErr) {
        toast(`Chat started — worktree note: ${wtErr.message}`);
      }
    }
    if (composerScope === 'welcome') clearComposerAttachments();
    if (composerDrafts.get('welcome') === raw) saveComposerDraft('welcome', '');
    if (composerScope === 'welcome' && $('#composer-input').value === raw) { $('#composer-input').value = ''; resizeComposer(); }
    state.tasks.unshift(task);
    if (!selectedId && version === selectionVersion) await selectTask(task.id);
    await api(`/api/tasks/${encodeURIComponent(task.id)}/run`, { method: 'POST', body: '{}' });
    await refresh();
  } catch (error) {
    composerErrors.set(createdId || 'welcome', error.message);
  } finally {
    messageBusyTasks.delete('welcome');
    renderComposer();
  }
}

function openModels() {
  if (!selectedId && !liveProviders().length) {
    return openSettings('models', { subtab: 'connections' });
  }
  return openModelPicker(selectedId, $('#composer-model'));
}
async function loadVeniceCatalog(force = false) {
  try {
    veniceCatalog = await api('/api/providers/venice-models' + (force ? '?refresh=1' : ''));
  } catch (error) { veniceCatalog = {...veniceCatalog, warning:error.message}; }
  renderVeniceCatalog();
  if ($('#settings-dialog')?.open) renderModelSettings();
  renderComposer();
}
function renderVeniceCatalog() {
  const task = typeof settingsTask === 'function' ? settingsTask() : (settingsTaskId ? selectedData?.task : null);
  renderRaceOptions(task);
  const saved = task ? taskProviders(task) : newConversationProviders();
  const primary = task?.providerId || saved[0];
  const backup = $('#venice-backup');
  $('#venice-browser').hidden = !veniceCatalog.connected || (task && task.workspaceKind !== 'conversation');
  const backups = veniceCatalog.models.filter(m => m.id !== primary);
  const key = JSON.stringify(backups.map(m => [m.id,m.label]));
  if (settingsListContents.get(backup) !== key) {
    backup.replaceChildren(new Option('None',''), ...backups.map(m => new Option(m.label || m.model,m.id)));
    settingsListContents.set(backup,key);
  }
  backup.value = backups.some(m => m.id === saved[1]) ? saved[1] : '';
  backup.disabled = routeBusy || !catalogId(primary) || Boolean(modelSelectionLock(task));
  setText('#venice-count', [veniceCatalog.models.length + ' models available', veniceCatalog.warning].filter(Boolean).join(' · '));
}
async function loadOpenRouterCatalog(force = false) {
  if (force) {
    openrouterRefreshBusy = true;
    renderOpenRouterCatalog();
  }
  try {
    openrouterCatalog = await api('/api/providers/openrouter-models' + (force ? '?refresh=1' : ''));
  } catch (error) { openrouterCatalog = { ...openrouterCatalog, warning: error.message }; }
  finally {
    if (force) openrouterRefreshBusy = false;
  }
  renderOpenRouterCatalog();
  if ($('#model-picker')?.open) renderModelPicker();
  if ($('#settings-dialog')?.open) renderModelSettings();
}
function formatOpenRouterPrice(pricing) {
  if (!pricing || !Number.isFinite(pricing.inputPer1M) || !Number.isFinite(pricing.outputPer1M)) return '';
  if (pricing.inputPer1M === 0 && pricing.outputPer1M === 0) return 'Free';
  const fmt = v => v < 0.01 ? v.toFixed(4).replace(/0+$/, '').replace(/\.$/, '') : v < 1 ? v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '') : v.toFixed(2).replace(/\.00$/, '');
  return `$${fmt(pricing.inputPer1M)} / $${fmt(pricing.outputPer1M)}`;
}
function formatOpenRouterContext(ctx) {
  if (!Number.isFinite(ctx) || ctx <= 0) return '';
  return ctx >= 1000000 ? `${(ctx / 1000000).toFixed(ctx % 1000000 === 0 ? 0 : 1)}M` : `${Math.round(ctx / 1000)}k`;
}
function renderOpenRouterCatalog() {
  const section = $('#openrouter-browser');
  if (!section) return;
  section.hidden = !openrouterCatalog.connected;
  if (!openrouterCatalog.connected) return;
  const refreshBtn = $('#openrouter-refresh');
  if (refreshBtn) {
    refreshBtn.disabled = openrouterRefreshBusy;
    refreshBtn.textContent = openrouterRefreshBusy ? 'Refreshing…' : 'Refresh catalog';
  }
  const registeredSet = new Set(
    state.providers
      .filter(p => p.id?.startsWith('openrouter:') && p.available !== false)
      .map(p => p.model)
      .filter(Boolean)
  );
  const models = Array.isArray(openrouterCatalog.models) ? openrouterCatalog.models : [];
  const addedCount = registeredSet.size || (openrouterCatalog.registered?.length || 0);
  setText('#openrouter-count', [
    `${models.length} models available on OpenRouter`,
    `${addedCount} added`,
    openrouterCatalog.warning
  ].filter(Boolean).join(' · '));
  const query = openrouterFilter.trim().toLowerCase();
  const filtered = query
    ? models.filter(m => `${m.name || ''} ${m.model || ''} ${m.id || ''}`.toLowerCase().includes(query))
    : models.slice().sort((a, b) => {
        const aReg = registeredSet.has(a.model) ? 0 : 1;
        const bReg = registeredSet.has(b.model) ? 0 : 1;
        if (aReg !== bReg) return aReg - bReg;
        const aIq = Number(a.meta?.intelligence ?? 0);
        const bIq = Number(b.meta?.intelligence ?? 0);
        if (bIq !== aIq) return bIq - aIq;
        return (a.name || a.model).localeCompare(b.name || b.model);
      });
  const limit = 60;
  const visible = filtered.slice(0, limit);
  const listEl = $('#openrouter-list');
  if (!listEl) return;
  if (!visible.length) {
    listEl.innerHTML = `<p class="field-help">${query ? 'No matching OpenRouter models. You can still paste any slug in “Add any model ID” above.' : 'No OpenRouter models loaded yet. Click Refresh catalog.'}</p>`;
    return;
  }
  const rows = visible.map(m => {
    const isAdded = registeredSet.has(m.model);
    const busy = openrouterBusyModel === m.model;
    const price = formatOpenRouterPrice(m.pricing);
    const ctx = formatOpenRouterContext(m.contextWindow);
    const metaParts = [m.model, ctx ? `${ctx} ctx` : '', price].filter(Boolean).join(' · ');
    const actions = isAdded
      ? `<button type="button" class="button button-secondary openrouter-row-btn" data-or-use="${escapeHTML(m.id)}" ${busy || routeBusy ? 'disabled' : ''}>Use</button>${addedCount > 1 ? `<button type="button" class="button button-quiet openrouter-row-btn" data-or-remove="${escapeHTML(m.model)}" ${busy ? 'disabled' : ''}>Remove</button>` : ''}`
      : `<button type="button" class="button button-secondary openrouter-row-btn" data-or-add="${escapeHTML(m.model)}" ${busy ? 'disabled' : ''}>${busy ? 'Adding…' : '+ Add'}</button>`;
    return `<div class="openrouter-row ${isAdded ? 'is-added' : ''}"><div class="openrouter-row-info"><strong>${escapeHTML(m.name || m.model)}</strong><small>${escapeHTML(metaParts)}</small></div><div class="openrouter-row-actions">${actions}</div></div>`;
  }).join('');
  const tail = filtered.length > limit ? `<p class="field-help openrouter-list-more">Showing ${limit} of ${filtered.length} matching models — type to narrow the list.</p>` : '';
  listEl.innerHTML = rows + tail;
}

async function loadDirectProviderCatalog(provider, force = false) {
  if (!Object.hasOwn(directCatalogs, provider)) return;
  if (force) {
    directCatalogRefreshBusy[provider] = true;
    renderDirectProviderCatalog(provider);
  }
  try {
    directCatalogs[provider] = await api(`/api/providers/catalog?provider=${encodeURIComponent(provider)}${force ? '&refresh=1' : ''}`);
  } catch (error) {
    directCatalogs[provider] = { ...directCatalogs[provider], warning: error.message };
  } finally {
    if (force) directCatalogRefreshBusy[provider] = false;
  }
  renderDirectProviderCatalog(provider);
  if ($('#model-picker')?.open) renderModelPicker();
  if ($('#settings-dialog')?.open) renderModelSettings();
}

function renderDirectProviderCatalog(provider) {
  const cat = directCatalogs[provider];
  const section = $(`#${provider}-browser`);
  if (!section || !cat) return;
  section.hidden = !cat.connected;
  if (!cat.connected) return;
  const refreshBtn = $(`#${provider}-refresh`);
  if (refreshBtn) {
    refreshBtn.disabled = Boolean(directCatalogRefreshBusy[provider]);
    refreshBtn.textContent = directCatalogRefreshBusy[provider] ? 'Refreshing…' : 'Refresh catalog';
  }
  const registeredSet = new Set(
    state.providers
      .filter(p => p.id?.startsWith(`${provider}:`) && p.available !== false)
      .map(p => p.model)
      .filter(Boolean)
  );
  const models = Array.isArray(cat.models) ? cat.models : [];
  const addedCount = registeredSet.size || (cat.registered?.length || 0);
  const label = cat.label || humanize(provider);
  setText(`#${provider}-count`, [
    `${models.length} models on ${label}`,
    `${addedCount} pinned`,
    cat.warning
  ].filter(Boolean).join(' · '));
  const query = (directCatalogFilters[provider] || '').trim().toLowerCase();
  const filtered = query
    ? models.filter(m => `${m.name || ''} ${m.model || ''} ${m.id || ''}`.toLowerCase().includes(query))
    : models;
  const limit = 60;
  const visible = filtered.slice(0, limit);
  const listEl = $(`#${provider}-list`);
  if (!listEl) return;
  if (!visible.length) {
    listEl.innerHTML = `<p class="field-help">${query ? `No matching ${escapeHTML(label)} models. You can still paste any slug in “Add any model ID”.` : `No ${escapeHTML(label)} models loaded yet. Click Refresh catalog.`}</p>`;
    return;
  }
  const rows = visible.map(m => {
    const isAdded = registeredSet.has(m.model);
    const busy = directCatalogBusyModel === `${provider}:${m.model}` || openrouterBusyModel === m.model;
    const ctx = formatOpenRouterContext(m.meta?.contextWindow);
    const metaParts = [m.model, m.meta?.tier ? `Est. ${m.meta.tier}·${m.meta.intelligence}` : '', ctx ? `${ctx} ctx` : '', m.curated ? 'Recommended' : ''].filter(Boolean).join(' · ');
    const actions = isAdded
      ? `<button type="button" class="button button-secondary openrouter-row-btn" data-direct-use="${escapeHTML(m.id)}" ${busy || routeBusy ? 'disabled' : ''}>Use</button>${addedCount > 1 ? `<button type="button" class="button button-quiet openrouter-row-btn" data-direct-remove="${escapeHTML(m.model)}" data-direct-provider="${escapeHTML(provider)}" ${busy ? 'disabled' : ''}>Remove</button>` : ''}`
      : `<button type="button" class="button button-secondary openrouter-row-btn" data-direct-add="${escapeHTML(m.model)}" data-direct-provider="${escapeHTML(provider)}" ${busy ? 'disabled' : ''}>${busy ? 'Adding…' : '+ Add'}</button>`;
    return `<div class="openrouter-row ${isAdded ? 'is-added' : ''}"><div class="openrouter-row-info"><strong>${escapeHTML(m.name || m.model)}</strong><small>${escapeHTML(metaParts)}</small></div><div class="openrouter-row-actions">${actions}</div></div>`;
  }).join('');
  const tail = filtered.length > limit ? `<p class="field-help openrouter-list-more">Showing ${limit} of ${filtered.length} matching models — type to narrow the list.</p>` : '';
  listEl.innerHTML = rows + tail;
}

function renderDirectProviderCatalogs() {
  for (const key of DIRECT_CATALOG_KEYS) renderDirectProviderCatalog(key);
}

let apiToggleBusy = null;

function renderApiToggles() {
  const section = $('#api-toggles-section');
  if (!section) return;
  const profiles = Array.isArray(state.connectedApiProviders) ? state.connectedApiProviders : [];
  const liveCliAll = liveProviders().filter(p => ['codex', 'claude', 'antigravity-cli', 'gemini-cli', 'copilot-cli'].includes(p.kind));
  const cliGrouped = new Map();
  for (const p of liveCliAll) {
    const baseId = String(p.id || '').split(':')[0];
    if (!cliGrouped.has(baseId)) cliGrouped.set(baseId, { id: baseId, kind: p.kind, count: 0, primaryLabel: '' });
    const entry = cliGrouped.get(baseId);
    if (p.id.includes(':')) entry.count += 1;
    else entry.primaryLabel = p.label || baseId;
  }
  const liveCli = [...cliGrouped.values()].map(entry => ({
    ...entry,
    count: Math.max(1, entry.count),
    name: entry.kind === 'codex' ? 'OpenAI Codex' : entry.kind === 'claude' ? 'Claude Code' : entry.kind === 'antigravity-cli' ? 'Google Antigravity (agy)' : entry.kind === 'gemini-cli' ? 'Gemini CLI (Legacy)' : entry.kind === 'copilot-cli' ? 'GitHub Copilot' : (entry.primaryLabel || entry.id),
  }));
  const liveLocal = liveProviders().filter(p => p.tier === 'local' || String(p.id || '').startsWith('local:'));
  section.hidden = profiles.length === 0 && liveCli.length === 0 && liveLocal.length === 0;
  if (section.hidden) return;
  const activeApiCount = profiles.filter(p => p.enabled !== false).length;
  const totalCount = profiles.length + liveCli.length + (liveLocal.length ? 1 : 0);
  const activeCount = activeApiCount + liveCli.length + (liveLocal.length ? 1 : 0);
  const apiRows = profiles.map(p => {
    const enabled = p.enabled !== false;
    const busy = apiToggleBusy === p.provider;
    const count = Number(p.modelCount ?? p.models?.length ?? 0);
    const directCat = directCatalogs[p.provider];
    const catalogNote = p.provider === 'openrouter' && enabled && openrouterCatalog.models.length > count
      ? `${openrouterCatalog.models.length} catalog · ${count} pinned`
      : directCat?.connected && enabled && directCat.models.length > count
        ? `${directCat.models.length} catalog · ${count} pinned`
        : p.provider === 'venice' && enabled && veniceCatalog.models.length > count
          ? `${veniceCatalog.models.length} catalog`
          : `${count} ${count === 1 ? 'model' : 'models'}`;
    const storageLabel = p.storage === 'keychain' ? 'Keychain' : p.storage === 'env' ? 'Env' : 'Session';
    const meta = enabled
      ? `${catalogNote} · ${storageLabel}`
      : `Paused (${count} ${count === 1 ? 'model' : 'models'} hidden · key kept in ${storageLabel.toLowerCase()})`;
    return `<div class="api-toggle-row ${enabled ? '' : 'is-disabled'}">
      <div class="api-toggle-info">
        <span class="api-toggle-title"><span class="svc-dot ${enabled ? 'svc-connected' : 'svc-muted'}" aria-hidden="true"></span>${escapeHTML(p.label || humanize(p.provider))}</span>
        <span class="api-toggle-meta">${escapeHTML(meta)}</span>
      </div>
      <button type="button" class="api-switch" role="switch" aria-checked="${enabled ? 'true' : 'false'}" data-toggle-api-provider="${escapeHTML(p.provider)}" data-toggle-enabled="${enabled ? 'false' : 'true'}" ${busy ? 'disabled' : ''}>
        <span class="api-switch-track" aria-hidden="true"><span class="api-switch-thumb"></span></span>
        <span>${busy ? 'Saving…' : enabled ? 'Active' : 'Disabled'}</span>
      </button>
    </div>`;
  });
  const cliRows = liveCli.map(p => `<div class="api-toggle-row">
    <div class="api-toggle-info">
      <span class="api-toggle-title"><span class="svc-dot svc-connected" aria-hidden="true"></span>${escapeHTML(p.name)}</span>
      <span class="api-toggle-meta">${p.count} ${p.count === 1 ? 'model' : 'models'} · CLI subscription · active</span>
    </div>
    <button type="button" class="button button-quiet svc-action-btn" data-disconnect-cli-quick="${escapeHTML(p.id)}" ${connectionBusy ? 'disabled' : ''}>Disconnect</button>
  </div>`);
  const localRows = liveLocal.length ? [`<div class="api-toggle-row">
    <div class="api-toggle-info">
      <span class="api-toggle-title"><span class="svc-dot svc-connected" aria-hidden="true"></span>Local Models</span>
      <span class="api-toggle-meta">${liveLocal.length} on-device ${liveLocal.length === 1 ? 'model' : 'models'} (${escapeHTML(liveLocal.map(p => p.model || p.label).slice(0, 2).join(', '))})</span>
    </div>
    <span class="svc-status-pill svc-connected">Local</span>
  </div>`] : [];
  section.innerHTML = `<div class="settings-card-head">
    <h4>Active Providers &amp; APIs</h4>
    <p>${activeCount} of ${totalCount} connected provider${totalCount === 1 ? '' : 's'} active. Toggle any API off to hide its models from the picker &amp; routing without deleting your saved key.</p>
  </div><div class="api-toggles-list">${[...apiRows, ...cliRows, ...localRows].join('')}</div>`;
}

async function toggleApiProvider(provider, enabled) {
  if (!provider || apiToggleBusy) return;
  apiToggleBusy = provider;
  renderApiToggles();
  try {
    const res = await api('/api/providers/profile', {
      method: 'PATCH',
      body: JSON.stringify({ provider, enabled: Boolean(enabled) }),
    });
    if (Array.isArray(res.connectedApiProviders)) state.connectedApiProviders = res.connectedApiProviders;
    if ('openrouterConnectionId' in res) state.openrouterConnectionId = res.openrouterConnectionId;
    if ('veniceConnectionId' in res) state.veniceConnectionId = res.veniceConnectionId;
    if (provider === 'openrouter') {
      if (enabled) await loadOpenRouterCatalog(true);
      else openrouterCatalog = { connected: false, models: [], registered: [], warning: '' };
    } else if (provider === 'venice') {
      if (enabled) await loadVeniceCatalog(true);
      else veniceCatalog = { connected: false, models: [], warning: '' };
    } else if (Object.hasOwn(directCatalogs, provider)) {
      if (enabled) await loadDirectProviderCatalog(provider, true);
      else directCatalogs[provider] = { connected: false, models: [], registered: [], warning: '' };
    }
    await refresh();
    if (!enabled && preferredProvider && !state.providers.some(p => p.id === preferredProvider && p.available !== false)) {
      const nextActive = state.providers.find(p => p.available !== false && p.kind !== 'scripted');
      preferredProvider = nextActive?.id || '';
      try {
        if (preferredProvider) localStorage.setItem('g0dc0d3.preferredProvider', preferredProvider);
        else localStorage.removeItem('g0dc0d3.preferredProvider');
      } catch {}
    }
    renderComposer();
    if ($('#settings-dialog')?.open) {
      await Promise.all([loadServices(true), loadModelGroups(selectedModelSort)]);
      renderModelSettings();
    }
    if ($('#model-picker')?.open) renderModelPicker();
    const name = res.label || humanize(provider);
    const msg = enabled ? `Enabled ${name}.` : `Disabled ${name} (saved key kept).`;
    setModelFeedback(msg);
    toast(msg);
  } catch (error) {
    setModelFeedback(error.message, true);
    toast(error.message);
  } finally {
    apiToggleBusy = null;
    renderApiToggles();
    renderServicesHub();
  }
}

function renderCustomModelForm() {
  const wrap = $('#custom-model-setup');
  const select = $('#custom-model-provider');
  if (!wrap || !select) return;
  const connected = (Array.isArray(state.connectedApiProviders) ? state.connectedApiProviders : []).filter(c => c.enabled !== false);
  wrap.hidden = connected.length === 0;
  if (!connected.length) return;
  const prev = select.value;
  const key = JSON.stringify(connected.map(c => [c.provider, c.label]));
  if (settingsListContents.get(select) !== key) {
    select.replaceChildren(...connected.map(c => new Option(c.label, c.provider)));
    settingsListContents.set(select, key);
  }
  if (connected.some(c => c.provider === prev)) select.value = prev;
  else if (connected.some(c => c.provider === 'openrouter')) select.value = 'openrouter';
}
async function addProviderModel(provider, model, { select = false, feedbackEl = null } = {}) {
  const slug = String(model || '').trim();
  if (!slug) throw new Error('Enter a model ID.');
  openrouterBusyModel = slug;
  directCatalogBusyModel = `${provider}:${slug}`;
  renderOpenRouterCatalog();
  renderDirectProviderCatalogs();
  try {
    const result = await api('/api/providers/models', { method: 'POST', body: JSON.stringify({ provider, models: [slug] }) });
    if (Array.isArray(result.connectedApiProviders)) state.connectedApiProviders = result.connectedApiProviders;
    await refresh();
    if (provider === 'openrouter') await loadOpenRouterCatalog();
    else if (Object.hasOwn(directCatalogs, provider)) await loadDirectProviderCatalog(provider);
    if ($('#settings-dialog')?.open) {
      await Promise.all([loadServices(), loadModelGroups(selectedModelSort)]);
      renderModelSettings();
    }
    const newId = result.added?.[0] || `${provider}:${slug.replaceAll('/', '-')}`;
    if (select) await selectModel(newId);
    if (feedbackEl) {
      $(feedbackEl)?.classList.remove('error');
      setText(feedbackEl, `Added ${slug} to ${humanize(provider)}.`);
    }
    toast(`Added ${slug} (${humanize(provider)}).`);
    return newId;
  } catch (error) {
    if (feedbackEl) {
      $(feedbackEl)?.classList.add('error');
      setText(feedbackEl, error.message);
    }
    throw error;
  } finally {
    openrouterBusyModel = null;
    directCatalogBusyModel = null;
    renderOpenRouterCatalog();
    renderDirectProviderCatalogs();
  }
}
async function removeProviderModel(provider, model) {
  const slug = String(model || '').trim();
  if (!slug) return;
  openrouterBusyModel = slug;
  directCatalogBusyModel = `${provider}:${slug}`;
  renderOpenRouterCatalog();
  renderDirectProviderCatalogs();
  try {
    const result = await api('/api/providers/models', { method: 'DELETE', body: JSON.stringify({ provider, models: [slug] }) });
    if (Array.isArray(result.connectedApiProviders)) state.connectedApiProviders = result.connectedApiProviders;
    await refresh();
    if (provider === 'openrouter') await loadOpenRouterCatalog();
    else if (Object.hasOwn(directCatalogs, provider)) await loadDirectProviderCatalog(provider);
    if ($('#settings-dialog')?.open) {
      await Promise.all([loadServices(), loadModelGroups(selectedModelSort)]);
      renderModelSettings();
    }
    toast(`Removed ${slug}.`);
  } catch (error) {
    toast(error.message);
  } finally {
    openrouterBusyModel = null;
    directCatalogBusyModel = null;
    renderOpenRouterCatalog();
    renderDirectProviderCatalogs();
  }
}
let selectedModelGroupId = 'flagship-waterfall';
let selectedModelSort = '';
let modelGroupBusy = false;
let catalogRefreshBusy = false;
let servicesData = null;
let servicesBusy = false;
let servicesLoadedOnce = false;
const customWaterfallOrder = new Map();

function serviceStatusClass(status) {
  if (status === 'connected') return 'svc-connected';
  if (status === 'ready') return 'svc-ready';
  if (status === 'signin') return 'svc-signin';
  if (status === 'blocked') return 'svc-blocked';
  return 'svc-muted';
}

function updateHeaderServicesBadge() {
  const dot = $('#header-services-dot');
  const label = $('#header-services-label');
  if (!dot || !label) return;
  const summary = servicesData?.summary;
  const liveCount = liveProviders().length;
  if (!summary) {
    label.textContent = liveCount ? `AI · ${liveCount}` : 'Connect AI';
    dot.className = `svc-dot ${liveCount ? 'svc-connected' : 'svc-signin'}`;
    $('#header-services-btn')?.setAttribute('title', liveCount ? `${liveCount} active AI model${liveCount === 1 ? '' : 's'} connected` : 'Connect an AI API key, CLI login, or local model');
    return;
  }
  const aiCount = Number(summary.connectedAiCount || 0);
  const parts = [`${aiCount} AI provider${aiCount === 1 ? '' : 's'} active`];
  if (summary.connectedDevtools) parts.push(`${summary.connectedDevtools} dev tool${summary.connectedDevtools === 1 ? '' : 's'}`);
  if (summary.githubAuthenticated && summary.githubAccount) parts.push(`gh @${summary.githubAccount}`);
  label.textContent = aiCount > 0 ? `AI · ${aiCount}` : 'Connect AI';
  $('#header-services-btn')?.setAttribute('title', `Connected AI & dev services (${parts.join(' · ')})`);
  dot.className = `svc-dot ${aiCount > 0 ? 'svc-connected' : 'svc-signin'}`;
}

async function loadServices(force = false) {
  if (servicesBusy) return;
  servicesBusy = true;
  if ($('#settings-dialog')?.open) renderServicesHub();
  try {
    servicesData = await api(`/api/services${force ? '?refresh=1' : ''}`);
    servicesLoadedOnce = true;
    updateHeaderServicesBadge();
    renderServicesHub();
  } catch (error) {
    if ($('#connected-services-hub')) {
      $('#connected-services-hub').innerHTML = `<p class="field-help">${escapeHTML(error.message)}</p>`;
    }
  } finally {
    servicesBusy = false;
    if ($('#settings-dialog')?.open) renderServicesHub();
  }
}

function renderServiceTile(svc) {
  const cls = serviceStatusClass(svc.status);
  const zdrBadge = svc.zdr?.label
    ? `<span class="zdr-badge ${(svc.zdr.zdrClass === 'local-only' || svc.zdr.zdrClass === 'local-lan') ? 'zdr-local' : svc.zdr.zdrClass === 'native-zdr' ? 'zdr-native' : svc.zdr.zdrClass === 'zdr-enforced' ? 'zdr-routed' : svc.zdr.zdrClass === 'no-store' ? 'zdr-nostore' : 'zdr-terms'}">${escapeHTML(svc.zdr.label)}</span>`
    : '';
  let action = '';
  if (svc.category === 'subscription' && svc.status === 'ready') {
    action = `<button type="button" class="button button-secondary svc-action-btn" data-service-connect="${escapeHTML(svc.id)}" ${connectionBusy ? 'disabled' : ''}>Review connection</button>`;
  } else if (svc.category === 'api' && svc.status === 'unconfigured') {
    action = `<button type="button" class="button button-quiet svc-action-btn" data-service-add-key="${escapeHTML(svc.id)}">Add key</button>`;
  } else if (svc.category === 'api' && svc.connected) {
    const nextOn = !svc.enabled;
    action = `<button type="button" class="button ${nextOn ? 'button-secondary' : 'button-quiet'} svc-action-btn" data-toggle-api-provider="${escapeHTML(svc.id)}" data-toggle-enabled="${nextOn ? 'true' : 'false'}" ${apiToggleBusy === svc.id ? 'disabled' : ''}>${nextOn ? 'Enable' : 'Disable'}</button>`;
  } else if (svc.id === 'local-inference' && svc.status !== 'connected') {
    action = '<button type="button" class="button button-quiet svc-action-btn" data-service-add-local>Add model</button>';
  }
  const extraTag = svc.model
    ? `<span class="meta-chip">${escapeHTML(svc.model)}</span>`
    : svc.version
      ? `<span class="meta-chip">${escapeHTML(svc.version)}</span>`
      : svc.billing
        ? `<span class="meta-chip">${escapeHTML(svc.billing)}</span>`
        : '';
  return `<article class="service-tile ${cls}" title="${escapeHTML(svc.detail || '')}">
    <div class="service-tile-top">
      <div class="service-tile-name"><span class="svc-dot ${cls}" aria-hidden="true"></span><strong>${escapeHTML(svc.name)}</strong></div>
      <span class="svc-status-pill ${cls}">${escapeHTML(svc.statusLabel)}</span>
    </div>
    <p class="service-tile-detail">${escapeHTML(svc.detail || '')}</p>
    <div class="service-tile-foot">
      <span class="service-tile-tags">${extraTag}${zdrBadge}</span>
      ${action}
    </div>
  </article>`;
}

function renderServicesHub() {
  const container = $('#connected-services-hub');
  if (!container) return;
  if (!servicesData) {
    container.innerHTML = `<div class="services-hub-head"><div><h3>Connected Coding &amp; AI Services</h3><p class="field-help">Checking Claude Code, Codex, Gemini CLI, GitHub Copilot, GitHub (gh), Git, Ollama, and API keys…</p></div></div>`;
    return;
  }
  const wasOpen = Boolean(container.querySelector('.services-disclosure')?.open);
  const s = servicesData.summary || {};
  const summaryBits = [
    `${s.connectedSubscriptions || 0} CLI sub${s.connectedSubscriptions === 1 ? '' : 's'}`,
    `${s.connectedApis || 0} API${s.connectedApis === 1 ? '' : 's'}`,
    `${s.localModelCount || 0} local`,
    s.githubAuthenticated ? `GitHub @${s.githubAccount || 'signed-in'}` : 'GitHub sign-in not checked'
  ];
  const allSvcs = [
    ...(servicesData.subscriptions || []),
    ...(servicesData.devtools || []),
    ...(servicesData.apis || [])
  ];
  const highlighted = allSvcs.filter(svc => svc.status === 'connected' || svc.status === 'ready');
  const quickStrip = highlighted.length
    ? `<div class="service-quick-strip" aria-label="Active services">${highlighted.map(svc => {
        const cls = serviceStatusClass(svc.status);
        return `<span class="service-quick-pill ${cls}" title="${escapeHTML(svc.detail || svc.statusLabel || '')}"><span class="svc-dot ${cls}" aria-hidden="true"></span>${escapeHTML(svc.name)}</span>`;
      }).join('')}</div>`
    : `<p class="field-help">No active services yet — expand below to connect a CLI login, local model, or API key.</p>`;
  container.innerHTML = `
    <div class="services-hub-head">
      <div>
        <h3>Connected Coding &amp; AI Services</h3>
        <p class="field-help">${escapeHTML(summaryBits.join(' · '))}</p>
      </div>
      <button type="button" class="button button-quiet" data-refresh-services ${servicesBusy ? 'disabled' : ''}>${servicesBusy ? 'Scanning…' : 'Refresh services'}</button>
    </div>
    ${quickStrip}
    <details class="services-disclosure"${wasOpen ? ' open' : ''}>
      <summary>Manage all ${allSvcs.length} CLI tools, subscriptions &amp; API services</summary>
      <div class="service-group">
        <div class="service-group-label">AI CLI Accounts</div>
        <div class="service-grid">${(servicesData.subscriptions || []).map(renderServiceTile).join('')}</div>
      </div>
      <div class="service-group">
        <div class="service-group-label">Developer &amp; Local CLIs</div>
        <div class="service-grid">${(servicesData.devtools || []).map(renderServiceTile).join('')}</div>
      </div>
      <div class="service-group">
        <div class="service-group-label">Direct API Providers (Keychain / Env)</div>
        <div class="service-grid">${(servicesData.apis || []).map(renderServiceTile).join('')}</div>
      </div>
    </details>`;
}

async function loadModelGroups(sortOverride = selectedModelSort) {
  try {
    const query = sortOverride ? `?sort=${encodeURIComponent(sortOverride)}` : '';
    const res = await api(`/api/models/groups${query}`);
    state.modelGroups = Array.isArray(res.groups) ? res.groups : [];
    if (Array.isArray(res.sortModes)) state.sortModes = res.sortModes;
    if (res.catalog) state.catalogMeta = res.catalog;
    renderModelGroups();
  } catch {}
}

function setModelFeedback(msg, isError = false) {
  const el = $('#model-feedback');
  if (el) {
    el.textContent = msg ?? '';
    el.classList.toggle('error', Boolean(isError && msg));
  }
  if (typeof settingsFeedback === 'function') settingsFeedback(msg, isError);
}

async function refreshModelCatalog() {
  if (catalogRefreshBusy) return;
  catalogRefreshBusy = true;
  renderModelGroups();
  try {
    const res = await api('/api/models/catalog/refresh', { method: 'POST', body: '{}' });
    if (res.catalog) state.catalogMeta = res.catalog;
    await loadModelGroups(selectedModelSort);
    const msg = `Synced live pricing & context for ${res.count} models from OpenRouter.`;
    setModelFeedback(msg);
    toast(msg);
  } catch (error) {
    setModelFeedback(error.message, true);
    toast(error.message);
  } finally {
    catalogRefreshBusy = false;
    renderModelGroups();
  }
}

function orderedModelsForGroup(group) {
  const models = Array.isArray(group?.models) ? group.models : [];
  const custom = customWaterfallOrder.get(group?.id);
  if (!custom || !custom.length) return models;
  const byId = new Map(models.map(m => [m.id, m]));
  const ordered = [];
  for (const id of custom) {
    if (byId.has(id)) {
      ordered.push(byId.get(id));
      byId.delete(id);
    }
  }
  for (const rest of byId.values()) ordered.push(rest);
  return ordered;
}

function moveWaterfallModel(groupId, providerId, direction) {
  const groups = Array.isArray(state.modelGroups) ? state.modelGroups : [];
  const group = groups.find(g => g.id === groupId);
  if (!group) return;
  const ids = orderedModelsForGroup(group).map(m => m.id);
  const idx = ids.indexOf(providerId);
  const target = direction === 'up' ? idx - 1 : idx + 1;
  if (idx < 0 || target < 0 || target >= ids.length) return;
  [ids[idx], ids[target]] = [ids[target], ids[idx]];
  customWaterfallOrder.set(groupId, ids);
  renderModelGroups();
}

function tierBadgeClass(tier) {
  if (tier === 'S') return 'tier-s';
  if (tier === 'A') return 'tier-a';
  if (tier === 'B') return 'tier-b';
  return 'tier-c';
}

function priceBadgeClass(billing) {
  if (billing === 'local') return 'price-free';
  if (billing === 'subscription') return 'price-sub';
  return 'price-api';
}

let overseerData = null;
let overseerBusy = false;

async function loadOverseer() {
  try {
    overseerData = await api('/api/overseer');
    state.overseer = overseerData;
    renderOverseerSection();
    renderOverseerEdge();
  } catch {}
}

async function updateOverseerSettings(patch) {
  if (overseerBusy) return;
  overseerBusy = true;
  renderOverseerSection();
  renderOverseerEdge();
  try {
    overseerData = await api('/api/overseer', { method: 'PATCH', body: JSON.stringify(patch) });
    state.overseer = overseerData;
    if (Object.hasOwn(patch, 'customInstructions')) overseerDirectivesDraft = null;
    const msg = overseerData.settings?.enabled && overseerData.selectedProvider
      ? `Overseer active: ${overseerData.selectedProvider.label}.`
      : 'Overseer settings saved.';
    setModelFeedback(msg);
    toast(msg);
  } catch (error) {
    setModelFeedback(error.message, true);
    toast(error.message);
  } finally {
    overseerBusy = false;
    renderOverseerSection();
    renderOverseerEdge();
  }
}

function syncSecurityPostureChrome(privacyData = null) {
  const pill = $('#security-posture-pill');
  if (!pill) return;
  const s = (privacyData || state.privacy)?.settings || {};
  const prof = s.securityProfile || (s.localOnly && s.strictZdr ? 'lockdown' : s.strictZdr && s.ephemeralSession ? 'hardened' : 'standard');
  const allowLen = Array.isArray(s.scopeAllow) ? s.scopeAllow.length : 0;
  const denyLen = Array.isArray(s.scopeDeny) ? s.scopeDeny.length : 0;
  const hasScope = allowLen > 0 || denyLen > 0;
  const show = prof !== 'standard' || hasScope;
  pill.classList.toggle('hidden', !show);
  pill.classList.toggle('is-lockdown', prof === 'lockdown');
  pill.classList.toggle('is-hardened', prof === 'hardened' || (prof === 'standard' && hasScope));
  setText('#security-posture-label', prof === 'lockdown' ? 'Lockdown' : prof === 'hardened' ? 'Hardened' : 'Scoped');
  setText('#security-posture-scope', hasScope ? `${allowLen}/${denyLen}` : (prof === 'lockdown' ? 'Airgap' : 'ZDR'));
}
window.syncSecurityPostureChrome = syncSecurityPostureChrome;

function renderOverseerEdge() {
  const data = overseerData || state.overseer;
  const badge = $('#overseer-edge-badge');
  const btn = $('#overseer-toggle');
  const schedBadge = $('#schedules-edge-badge');
  if (schedBadge) {
    const enabledCount = Number(state.schedulesSummary?.enabled || 0);
    const runningCount = Number(state.schedulesSummary?.running || 0);
    schedBadge.textContent = runningCount > 0 ? `${runningCount} running` : enabledCount > 0 ? String(enabledCount) : '';
    schedBadge.className = `overseer-edge-badge${runningCount > 0 || enabledCount > 0 ? ' is-active' : ' hidden'}`;
  }
  if (badge && btn) {
    const s = data?.settings || {};
    const active = Boolean(data?.ready);
    const blocked = Boolean(s.enabled && s.providerId && !data?.selectedProvider?.allowedByPolicy);
    badge.textContent = blocked ? 'Blocked' : active ? 'Active' : 'Off';
    badge.className = `overseer-edge-badge${active ? ' is-active' : blocked ? ' is-blocked' : ''}`;
    btn.classList.toggle('is-overseer-on', active);
  }
  const pop = $('#overseer-popover');
  const body = $('#overseer-popover-body');
  if (!pop || !body || pop.classList.contains('hidden')) return;
  if (!data) {
    body.innerHTML = '<p class="field-help">Loading Overseer status…</p>';
    return;
  }
  const s = data.settings || {};
  const providers = Array.isArray(data.availableProviders) ? data.availableProviders : [];
  const topRecommended = providers.find(p => p.recommended && p.allowedByPolicy) || providers.find(p => p.allowedByPolicy) || null;
  const isEnabled = Boolean(s.enabled && s.providerId);
  const activeLabel = data.ready
    ? (data.selectedProvider?.label || s.providerId)
    : (isEnabled && !data.selectedProvider?.allowedByPolicy ? 'Blocked by Privacy Gate' : 'Idle · zero token cost');
  setText('#overseer-pop-sub', activeLabel);
  const optLabel = p => `${p.label}${p.suitabilityTag ? ` · ${p.suitabilityTag}` : ''}${p.allowedByPolicy ? '' : ' (blocked)'}`;
  const primaryOpts = [
    '<option value="">None (Off)</option>',
    ...providers.map(p => `<option value="${escapeHTML(p.id)}" ${p.id === s.providerId ? 'selected' : ''}>${escapeHTML(optLabel(p))}</option>`)
  ].join('');
  const backupOpts = [
    '<option value="">Auto failover</option>',
    ...providers.filter(p => p.id !== s.providerId).map(p => `<option value="${escapeHTML(p.id)}" ${p.id === s.backupProviderId ? 'selected' : ''}>${escapeHTML(optLabel(p))}</option>`)
  ].join('');
  const patternCount = (data.refusalPatterns || []).length;
  const stratCount = (data.strategyStats || []).length;
  const postures = Array.isArray(data.postures) && data.postures.length ? data.postures : [
    { id: 'reactive', label: 'Unblock Only', description: 'Zero idle cost — steps in on soft refusals, loops & check plateaus.' },
    { id: 'active', label: 'Quality Guard', description: 'Adds pre-finish stub & completeness audit before workers finish.' },
    { id: 'proactive', label: 'Full Co-Pilot', description: 'Adds mid-run trajectory coaching on long 6+ turn runs.' },
  ];
  const curPosture = s.posture || (s.autoCoachLongRuns ? 'proactive' : s.autoAuditCompletion ? 'active' : 'reactive');
  const curPostureDesc = postures.find(p => p.id === curPosture)?.description || '';
  const showConsult = Boolean(data.ready && selectedId);
  const nextHtml = `
    <div class="overseer-pop-row">
      <div class="overseer-pop-status">
        <span class="svc-dot ${data.ready ? 'svc-connected' : isEnabled ? 'svc-blocked' : 'svc-muted'}" aria-hidden="true"></span>
        <strong>${data.ready ? 'Overseer Active' : isEnabled ? 'Blocked by Privacy' : 'Overseer Off'}</strong>
      </div>
      <button type="button" class="button ${isEnabled ? 'button-secondary' : 'button-primary'} overseer-pop-switch" data-overseer-pop-toggle="${isEnabled ? 'off' : escapeHTML(topRecommended?.id || '')}" ${overseerBusy || (!isEnabled && !topRecommended) ? 'disabled' : ''}>${isEnabled ? 'Turn off' : topRecommended ? 'Enable Auto' : 'No model'}</button>
    </div>
    <div class="overseer-pop-selects">
      <label class="overseer-pop-field"><span>Primary Overseer</span><select id="overseer-pop-primary" ${overseerBusy ? 'disabled' : ''}>${primaryOpts}</select></label>
      <label class="overseer-pop-field"><span>Backup Failover</span><select id="overseer-pop-backup" ${overseerBusy || !s.providerId ? 'disabled' : ''}>${backupOpts}</select></label>
    </div>
    <div class="overseer-posture-wrap">
      <span class="overseer-posture-label">Supervision Mode</span>
      <div class="overseer-posture-row" role="group" aria-label="Overseer supervision mode">
        ${postures.map(p => `<button type="button" class="overseer-posture-btn ${p.id === curPosture ? 'active' : ''}" data-overseer-posture="${escapeHTML(p.id)}" aria-pressed="${p.id === curPosture ? 'true' : 'false'}" ${overseerBusy || !s.providerId ? 'disabled' : ''}>${escapeHTML(p.label)}</button>`).join('')}
      </div>
      <p class="field-help overseer-posture-help">${escapeHTML(curPostureDesc)}</p>
    </div>
    <div class="overseer-pop-checks">
      <label class="check-setting"><input type="checkbox" id="overseer-pop-judge" ${s.autoJudgeAmbiguous !== false ? 'checked' : ''} ${overseerBusy || !s.providerId ? 'disabled' : ''}> Judge ambiguous soft refusals</label>
      <label class="check-setting"><input type="checkbox" id="overseer-pop-unblock" ${s.autoUnblockStuck !== false ? 'checked' : ''} ${overseerBusy || !s.providerId ? 'disabled' : ''}> Unblock loops &amp; check plateaus</label>
      <label class="check-setting"><input type="checkbox" id="overseer-pop-audit" ${s.autoAuditCompletion ? 'checked' : ''} ${overseerBusy || !s.providerId ? 'disabled' : ''}> Pre-finish stub &amp; completeness audit</label>
      <label class="check-setting"><input type="checkbox" id="overseer-pop-coach" ${s.autoCoachLongRuns ? 'checked' : ''} ${overseerBusy || !s.providerId ? 'disabled' : ''}> Mid-run long-task trajectory coaching</label>
    </div>
    ${showConsult ? `<button type="button" class="button button-secondary overseer-consult-btn" data-overseer-consult-now ${overseerBusy ? 'disabled' : ''}>${overseerBusy ? '✦ Consulting Overseer…' : '✦ Consult Overseer on Current Task'}</button>` : ''}
    <div class="overseer-pop-foot">
      <span class="field-help">${patternCount} learned 0ms ${patternCount === 1 ? 'pattern' : 'patterns'} · ${stratCount} ${stratCount === 1 ? 'bandit' : 'bandits'}</span>
      <div class="overseer-pop-foot-actions">
        ${patternCount > 0 ? '<button type="button" class="button button-quiet" data-overseer-pop-clear>Clear</button>' : ''}
        <button type="button" class="button button-quiet" data-overseer-pop-settings>Full settings →</button>
      </div>
    </div>`;
  if (body.dataset.lastHtml === nextHtml) return;
  const focusedEl = document.activeElement;
  if (!overseerBusy && focusedEl && body.contains(focusedEl) && ['SELECT', 'TEXTAREA', 'INPUT'].includes(focusedEl.tagName)) {
    body.dataset.pendingHtml = nextHtml;
    return;
  }
  delete body.dataset.pendingHtml;
  body.dataset.lastHtml = nextHtml;
  body.innerHTML = nextHtml;
}

function toggleOverseerPopover(force) {
  const pop = $('#overseer-popover');
  const btn = $('#overseer-toggle');
  if (!pop) return;
  const open = typeof force === 'boolean' ? force : pop.classList.contains('hidden');
  if (open) closeAllPopovers('overseer-popover');
  pop.classList.toggle('hidden', !open);
  btn?.setAttribute('aria-expanded', String(open));
  if (open) {
    renderOverseerEdge();
    void loadOverseer();
  }
}

function renderOverseerSection() {
  const container = $('#overseer-section');
  if (!container) return;
  const data = overseerData || state.overseer;
  if (!data) {
    container.innerHTML = '';
    return;
  }
  const s = data.settings || {};
  const providers = Array.isArray(data.availableProviders) ? data.availableProviders : [];
  const optionLabel = p => `${p.label}${p.suitabilityTag ? ` · ${p.suitabilityTag}` : ''}${p.allowedByPolicy ? '' : ' (blocked by privacy gate)'}`;
  const options = [
    '<option value="">None (Off)</option>',
    ...providers.map(p => `<option value="${escapeHTML(p.id)}" ${p.id === s.providerId ? 'selected' : ''}>${escapeHTML(optionLabel(p))}</option>`)
  ].join('');
  const backupOptions = [
    '<option value="">Auto (next uncensored / open-weight model)</option>',
    ...providers.filter(p => p.id !== s.providerId).map(p => `<option value="${escapeHTML(p.id)}" ${p.id === s.backupProviderId ? 'selected' : ''}>${escapeHTML(optionLabel(p))}</option>`)
  ].join('');
  const topRecommended = providers.find(p => p.recommended && p.allowedByPolicy) || null;
  const hasHighAgency = Boolean(topRecommended);
  const quickEnableBtn = !s.enabled && topRecommended
    ? `<button type="button" class="button button-secondary svc-action-btn" data-enable-recommended-overseer="${escapeHTML(topRecommended.id)}" ${overseerBusy ? 'disabled' : ''}>Enable recommended (${escapeHTML(topRecommended.label)})</button>`
    : '';
  const statusPill = data.ready
    ? `<span class="svc-status-pill svc-connected">Active · ${escapeHTML(data.selectedProvider?.label || s.providerId)}${data.backupProvider ? ` → ${escapeHTML(data.backupProvider.label)}` : ''}</span>`
    : (s.enabled && s.providerId && !data.selectedProvider?.allowedByPolicy)
      ? '<span class="svc-status-pill svc-blocked">Blocked by Privacy Gate</span>'
      : '<span class="svc-status-pill">Off</span>';
  const learnedRows = (data.strategyStats || []).slice(0, 6);
  const learnedHtml = learnedRows.length
    ? `<div class="overseer-learned"><span class="service-group-label">Learned Recovery Strategies (Local Bandit)</span><div class="strategy-chips">${learnedRows.map(r => `<span class="meta-chip" title="${escapeHTML(`${r.successes} wins / ${r.failures} fails`)}">${escapeHTML(r.modelFamily)} → ${escapeHTML(r.strategy)} · ${Math.round((r.recencyEstimate || 0) * 100)}%</span>`).join('')}</div></div>`
    : '';
  const patternRows = (data.refusalPatterns || []).slice(0, 8);
  const patternsHtml = patternRows.length
    ? `<div class="overseer-learned"><div class="overseer-patterns-head"><span class="service-group-label">Learned Soft-Refusal Signatures (0ms Local Detector)</span><button type="button" class="button button-quiet svc-action-btn" data-clear-refusal-patterns>Clear all</button></div><div class="strategy-chips">${patternRows.map(p => `<span class="meta-chip pattern-chip" title="${escapeHTML(`Caught ${p.hits || 1}x via ${p.source || 'local'}`)}">“${escapeHTML(p.signature.slice(0, 48))}${p.signature.length > 48 ? '…' : ''}” <button type="button" class="pattern-del-btn" data-delete-refusal-pattern="${escapeHTML(p.signature)}" aria-label="Remove learned refusal signature">×</button></span>`).join('')}</div></div>`
    : '';
  const agencyTip = !hasHighAgency
    ? '<p class="field-help">Tip: Connect a high-agency/uncensored model (Gemini 4 Neon, Hermes-4-405B, Venice Uncensored, or local Ollama) so the Overseer itself never balks when unblocking tough tasks.</p>'
    : '';
  const postures = Array.isArray(data.postures) && data.postures.length ? data.postures : [
    { id: 'reactive', label: 'Unblock Only', description: 'Zero overhead on normal turns — steps in only on soft refusals, doom loops, check plateaus, or Auto permissions.' },
    { id: 'active', label: 'Quality Guard', description: 'Adds a pre-finish completeness & stub audit before workers finalize code or multi-step deliverables.' },
    { id: 'proactive', label: 'Full Co-Pilot', description: 'Adds periodic mid-run trajectory coaching on long 6+ turn tasks alongside unblocking and quality audits.' },
  ];
  const curPosture = s.posture || (s.autoCoachLongRuns ? 'proactive' : s.autoAuditCompletion ? 'active' : 'reactive');
  const curPostureDesc = postures.find(p => p.id === curPosture)?.description || '';
  const nextSectionHtml = `
    <div class="overseer-head">
      <div>
        <h3>Overseer &amp; Supervisory Meta-Controller</h3>
        <p class="field-help">Read-only architectural supervisor with automatic backup failover. Diagnoses soft refusals, unblocks loops &amp; check plateaus using live tool traces, audits completeness before finishing, and coaches long multi-turn runs.</p>
      </div>
      <div class="overseer-head-actions">${quickEnableBtn}${statusPill}</div>
    </div>
    <div class="overseer-controls">
      <div class="overseer-select-grid">
        <label class="overseer-select-label">
          <span>Primary overseer</span>
          <select id="overseer-provider-select" aria-label="Primary overseer model" ${overseerBusy ? 'disabled' : ''}>${options}</select>
        </label>
        <label class="overseer-select-label">
          <span>Backup overseer (failover)</span>
          <select id="overseer-backup-select" aria-label="Backup overseer model" ${overseerBusy || !s.providerId ? 'disabled' : ''}>${backupOptions}</select>
        </label>
      </div>
      ${agencyTip}
      <div class="overseer-posture-wrap">
        <span class="overseer-posture-label">Supervision Mode</span>
        <div class="overseer-posture-row" role="group" aria-label="Overseer supervision mode">
          ${postures.map(p => `<button type="button" class="overseer-posture-btn ${p.id === curPosture ? 'active' : ''}" data-overseer-posture="${escapeHTML(p.id)}" aria-pressed="${p.id === curPosture ? 'true' : 'false'}" ${overseerBusy || !s.providerId ? 'disabled' : ''}>${escapeHTML(p.label)}</button>`).join('')}
        </div>
        <p class="field-help overseer-posture-help">${escapeHTML(curPostureDesc)}</p>
      </div>
      <div class="overseer-toggles">
        <label class="check-setting"><input type="checkbox" id="overseer-judge-toggle" ${s.autoJudgeAmbiguous !== false ? 'checked' : ''} ${overseerBusy || !s.providerId ? 'disabled' : ''}> Judge ambiguous soft refusals (+ learn 0ms signatures)</label>
        <label class="check-setting"><input type="checkbox" id="overseer-unblock-toggle" ${s.autoUnblockStuck !== false ? 'checked' : ''} ${overseerBusy || !s.providerId ? 'disabled' : ''}> Unblock refusals, doom loops &amp; check plateaus with root-cause plans</label>
        <label class="check-setting"><input type="checkbox" id="overseer-audit-toggle" ${s.autoAuditCompletion ? 'checked' : ''} ${overseerBusy || !s.providerId ? 'disabled' : ''}> Pre-finish completeness &amp; stub quality audit (blocks half-done work)</label>
        <label class="check-setting"><input type="checkbox" id="overseer-coach-toggle" ${s.autoCoachLongRuns ? 'checked' : ''} ${overseerBusy || !s.providerId ? 'disabled' : ''}> Mid-run trajectory coaching every 6 turns on long tasks</label>
      </div>
      <div class="overseer-directives-field">
        <label for="overseer-custom-instructions">Custom Overseer Directives <span class="field-help">(optional — injected into every Overseer audit, unblock &amp; coaching prompt)</span></label>
        <textarea id="overseer-custom-instructions" rows="2" maxlength="1200" placeholder="e.g. Reject TODO stubs or mock implementations, prefer minimal surgical patches, and require passing unit tests before finishing." ${overseerBusy ? 'disabled' : ''}>${escapeHTML(overseerDirectivesDraft ?? (s.customInstructions || ''))}</textarea>
        <div class="overseer-directives-actions">
          <button type="button" class="button button-secondary svc-action-btn" data-save-overseer-directives ${overseerBusy ? 'disabled' : ''}>Save directives</button>
          ${overseerDirectivesDraft !== null && overseerDirectivesDraft !== (s.customInstructions || '') ? '<span class="overseer-directives-dirty">Unsaved changes</span>' : ''}
        </div>
      </div>
    </div>
    ${learnedHtml}${patternsHtml}`;
  if (container.dataset.lastHtml === nextSectionHtml) return;
  const focusedEl = document.activeElement;
  if (!overseerBusy && focusedEl && container.contains(focusedEl) && ['SELECT', 'TEXTAREA', 'INPUT'].includes(focusedEl.tagName)) {
    container.dataset.pendingHtml = nextSectionHtml;
    return;
  }
  delete container.dataset.pendingHtml;
  container.dataset.lastHtml = nextSectionHtml;
  container.innerHTML = nextSectionHtml;
}

let ultraRouterData = null;
let ultraRouterBusy = false;
let selectedRouterDomain = 'swe_coding';

async function loadUltraRouter() {
  try {
    ultraRouterData = await api('/api/router');
    if (ultraRouterData?.settings) state.router = ultraRouterData.settings;
  } catch {}
  renderUltraRouterSection();
  renderComposer();
}

async function updateUltraRouter(patch, successMsg = 'Ultra-Plinian router updated.') {
  if (ultraRouterBusy) return;
  ultraRouterBusy = true;
  renderUltraRouterSection();
  try {
    ultraRouterData = await api('/api/router', { method: 'PATCH', body: JSON.stringify(patch) });
    if (ultraRouterData?.settings) state.router = ultraRouterData.settings;
    toast(successMsg);
    if (typeof settingsFeedback === 'function') settingsFeedback(successMsg);
  } catch (error) {
    toast(error.message);
    if (typeof settingsFeedback === 'function') settingsFeedback(error.message, true);
  } finally {
    ultraRouterBusy = false;
    renderUltraRouterSection();
    renderComposer();
  }
}

async function resetUltraRouter() {
  if (ultraRouterBusy) return;
  ultraRouterBusy = true;
  renderUltraRouterSection();
  try {
    ultraRouterData = await api('/api/router/reset', { method: 'DELETE', body: '{}' });
    if (ultraRouterData?.settings) state.router = ultraRouterData.settings;
    const msg = 'Reset Ultra-Plinian domain Elo & custom benchmark overrides.';
    toast(msg);
    if (typeof settingsFeedback === 'function') settingsFeedback(msg);
  } catch (error) {
    toast(error.message);
    if (typeof settingsFeedback === 'function') settingsFeedback(error.message, true);
  } finally {
    ultraRouterBusy = false;
    renderUltraRouterSection();
    renderComposer();
  }
}

function renderUltraRouterSection() {
  const container = $('#ultra-router-section');
  if (!container) return;
  const data = ultraRouterData;
  const settings = data?.settings || state.router || { mode: 'off', weights: { quality: 0.72, compliance: 0.2, speed: 0.05, cost: 0.03 }, domainPins: {}, customBenchmarks: {} };
  const domains = Array.isArray(data?.domains) ? data.domains : [];
  const boards = data?.leaderboards || {};
  const activeDom = domains.find(d => d.id === selectedRouterDomain)?.id || domains[0]?.id || 'swe_coding';
  selectedRouterDomain = activeDom;
  const activeRows = Array.isArray(boards[activeDom]) ? boards[activeDom].slice(0, 8) : [];
  const w = settings.weights || { quality: 0.72, compliance: 0.2, speed: 0.05, cost: 0.03 };
  const modeCards = [
    ['off', 'Off', 'Use your manually selected model & waterfall.'],
    ['auto_route', 'Auto-Route (Best Model)', 'Picks the highest-scoring endpoint per task domain & routes away from refusals.'],
    ['auto_arena', 'Auto-Conclave (2–4 Models + Judge)', 'Races your top 2–4 distinct model families & trains your personal Elo from the blind judge.'],
    ['manual_arena', 'Custom Conclave', 'Race any 2–4 connected models & judge below.']
  ];
  const domainTabs = domains.map(d => `<button type="button" class="ultra-domain-tab ${d.id === activeDom ? 'active' : ''}" data-router-domain="${escapeHTML(d.id)}" title="${escapeHTML(d.description)}">${escapeHTML(d.shortLabel)}</button>`).join('');
  const boardHtml = activeRows.length
    ? `<ol class="ultra-board-list">${activeRows.map((row, i) => {
        const pinned = settings.domainPins?.[activeDom] === row.id;
        return `<li class="ultra-board-row ${pinned ? 'is-pinned' : ''}"><div class="ultra-board-main"><span class="ultra-board-rank">#${i + 1}</span><span class="ultra-board-name" title="${escapeHTML(row.id)}">${escapeHTML(row.label)}</span></div><div class="ultra-board-metrics"><span class="ultra-board-score">${escapeHTML(row.totalScore)}</span><span>Bench ${escapeHTML(row.benchmarkPrior)}</span><span>Elo ${escapeHTML(row.userElo)}</span><span>Comp ${escapeHTML(row.compliance)}%</span>${row.refusalRate > 0 ? `<span>Ref ${escapeHTML(row.refusalRate)}%</span>` : ''}<button type="button" class="waterfall-move-btn ${pinned ? 'pref-pin-active' : ''}" data-router-pin="${escapeHTML(row.id)}" data-router-pin-domain="${escapeHTML(activeDom)}" title="${pinned ? 'Pinned for this domain · Click to unpin' : 'Pin as #1 for this domain'}">★</button></div></li>`;
      }).join('')}</ol>`
    : '<p class="field-help">Connect a provider or Venice catalog to populate live domain leaderboards.</p>';
  const customJson = JSON.stringify(settings.customBenchmarks || {}, null, 2);
  const metacogMode = settings.metacognition || 'smart';
  const metacogModes = [
    ['off', 'Off', 'Send your raw prompt without metacognitive scaffolding.'],
    ['smart', 'Smart Framing (0ms)', 'Instant domain × model-family framing, 100% cache-safe (Recommended).'],
    ['auto_forge', 'Auto-Forge (LLM)', 'Smart framing + live LLM Megaprompt & Conclave Judge rubric on complex Turn-1 tasks.']
  ];
  const prevDetailsOpen = Boolean(container.querySelector('.ultra-json-details')?.open);
  const focusedInRouter = document.activeElement && container.contains(document.activeElement)
    && ['TEXTAREA', 'INPUT'].includes(document.activeElement.tagName);
  const nextRouterHtml = `
    <div class="ultra-router-head">
      <div>
        <h3>Ultra-Plinian Intelligent Router</h3>
        <p class="field-help">Routes toward peak capability and task-completion reliability for each domain — seeded from public benchmarks and self-optimized locally via your per-domain Elo.</p>
      </div>
      <button type="button" class="button button-quiet" data-router-reset ${ultraRouterBusy ? 'disabled' : ''}>Reset Elo &amp; overrides</button>
    </div>
    <div class="ultra-router-modes" role="radiogroup" aria-label="Ultra-Plinian router mode">
      ${modeCards.map(([id, title, desc]) => `<button type="button" class="ultra-mode-btn ${settings.mode === id ? 'active' : ''}" data-router-mode="${id}" ${ultraRouterBusy ? 'disabled' : ''}><strong>${title}</strong><span>${desc}</span></button>`).join('')}
    </div>
    <div class="ultra-metacog-block">
      <div class="ultra-metacog-head">
        <strong>✦ Task Metacognition &amp; Megaprompting</strong>
        <span class="field-help">Calibrates task protocols &amp; Conclave judge rubrics to the routed model family (or run <code>/forge &lt;prompt&gt;</code> anytime).</span>
      </div>
      <div class="ultra-metacog-modes" role="radiogroup" aria-label="Task metacognition mode">
        ${metacogModes.map(([id, title, desc]) => `<button type="button" class="ultra-metacog-btn ${metacogMode === id ? 'active' : ''}" data-router-metacog="${id}" ${ultraRouterBusy ? 'disabled' : ''}><strong>${title}</strong><span>${desc}</span></button>`).join('')}
      </div>
    </div>
    <div class="ultra-router-weights">
      <label class="ultra-weight-field"><span>Capability weight · <strong>${Math.round(w.quality * 100)}%</strong></span><input type="range" min="10" max="90" step="5" value="${Math.round(w.quality * 100)}" data-router-weight="quality"></label>
      <label class="ultra-weight-field"><span>Task-completion reliability · <strong>${Math.round(w.compliance * 100)}%</strong></span><input type="range" min="0" max="70" step="5" value="${Math.round(w.compliance * 100)}" data-router-weight="compliance"></label>
      <label class="ultra-weight-field"><span>Speed · <strong>${Math.round(w.speed * 100)}%</strong></span><input type="range" min="0" max="50" step="5" value="${Math.round(w.speed * 100)}" data-router-weight="speed"></label>
      <label class="ultra-weight-field"><span>Cost efficiency · <strong>${Math.round(w.cost * 100)}%</strong></span><input type="range" min="0" max="50" step="5" value="${Math.round(w.cost * 100)}" data-router-weight="cost"></label>
    </div>
    ${domains.length ? `<div class="ultra-domain-tabs" role="tablist" aria-label="Task domain leaderboards">${domainTabs}</div>${boardHtml}` : ''}
    <details class="ultra-json-details"${prevDetailsOpen ? ' open' : ''}>
      <summary>Customize Mega Model Strengths JSON (per-user overrides)</summary>
      <p class="field-help">Override any model's domain scores (0–100) or compliance rating locally. Example: <code>{"claude-opus-5-5":{"compliance":80,"domains":{"swe_coding":100}}}</code></p>
      <textarea id="ultra-benchmarks-json" class="ultra-json-editor" spellcheck="false" aria-label="Custom benchmark JSON overrides">${escapeHTML(customJson)}</textarea>
      <div class="ultra-json-actions"><button type="button" class="button button-secondary" data-router-save-json ${ultraRouterBusy ? 'disabled' : ''}>Save JSON overrides</button></div>
    </details>`;
  if (focusedInRouter && !ultraRouterBusy) return;
  if (container.dataset.lastHtml === nextRouterHtml) return;
  container.dataset.lastHtml = nextRouterHtml;
  container.innerHTML = nextRouterHtml;
}

async function setModelPreference(providerId, signal, domain = null) {
  if (!providerId) return;
  try {
    const res = await api('/api/models/feedback', { method: 'POST', body: JSON.stringify({ providerId, signal, ...(domain ? { domain } : {}) }) });
    if (Array.isArray(res.groups)) state.modelGroups = res.groups;
    if (res.overseer) overseerData = res.overseer;
    if (res.router) state.router = res.router;
    const label = providerById(providerId)?.label || providerId;
    const domainNote = domain ? ` for ${domain.replace(/_/g, ' ')}` : '';
    const msg = signal === 'pin' ? `Pinned ${label}${domainNote} higher (+Elo).` : signal === 'demote' ? `Demoted ${label}${domainNote} (-Elo).` : `Reset ranking preference for ${label}.`;
    toast(msg);
    if ($('#settings-dialog')?.open) {
      if (typeof settingsFeedback === 'function') settingsFeedback(msg);
      renderModelGroups();
      renderOverseerSection();
      loadUltraRouter();
    }
  } catch (error) {
    toast(error.message);
  }
}

async function deleteLearnedPattern(signature = null) {
  try {
    const res = await api('/api/learning/patterns', { method: 'DELETE', body: JSON.stringify(signature ? { signature } : {}) });
    if (res.overseer) overseerData = res.overseer;
    renderOverseerSection();
    toast(signature ? 'Removed learned refusal signature.' : 'Cleared all learned refusal signatures.');
  } catch (error) {
    toast(error.message);
  }
}

async function reportMissedRefusal(taskId) {
  if (!taskId) return;
  try {
    toast('Flagged refusal — switching model / reframing…');
    const { task } = await api(`/api/tasks/${encodeURIComponent(taskId)}/report-refusal`, {
      method: 'POST',
      body: JSON.stringify({ message: 'Owner flagged response as a missed refusal.' })
    });
    if (selectedId === taskId && selectedData) renderSelected({ ...selectedData, task }, true);
    await refresh();
  } catch (error) {
    toast(error.message);
  }
}

function renderModelGroups() {
  const container = $('#model-groups-section');
  if (!container) return;
  const groups = Array.isArray(state.modelGroups) ? state.modelGroups : [];
  if (!groups.length) {
    container.innerHTML = '';
    return;
  }
  const active = groups.find(g => g.id === selectedModelGroupId) || groups[0];
  selectedModelGroupId = active.id;
  const sortModes = Array.isArray(state.sortModes) && state.sortModes.length
    ? state.sortModes
    : [
        { id: 'intelligence', label: 'Smartest First' },
        { id: 'coding', label: 'Coding First' },
        { id: 'value', label: 'Best Value' },
        { id: 'price', label: 'Cheapest / Free' },
        { id: 'speed', label: 'Fastest First' },
        { id: 'context', label: 'Largest Context' }
      ];
  const sortOptions = [
    `<option value="" ${!selectedModelSort ? 'selected' : ''}>Group default (${escapeHTML(active.defaultSortBy || active.sortBy || 'intelligence')})</option>`,
    ...sortModes.map(m => `<option value="${escapeHTML(m.id)}" ${selectedModelSort === m.id ? 'selected' : ''}>${escapeHTML(m.label)}</option>`)
  ].join('');
  const catalogMeta = state.catalogMeta || {};
  const catalogNote = catalogMeta.liveCount > 0
    ? `Synced OpenRouter quotes (${catalogMeta.liveCount} models)`
    : `Offline estimates (${catalogMeta.catalogVersion || 'bundled'})`;
  const chips = groups.map(group => {
    const isSel = group.id === active.id;
    return `<button type="button" class="model-group-chip ${isSel ? 'active' : ''}" data-select-model-group="${escapeHTML(group.id)}" aria-pressed="${isSel}"><span>${escapeHTML(group.shortName || group.name)}</span><span class="model-group-count">${escapeHTML(group.count)}</span></button>`;
  }).join('');
  const activeTask = settingsTaskId ? selectedData?.task : null;
  const activeModelId = activeTask?.pendingProviders?.[0] || activeTask?.providerId || newConversationProviders()[0] || null;
  const modelLock = modelSelectionLock(activeTask);
  const ordered = orderedModelsForGroup(active);
  const hasCustomOrder = customWaterfallOrder.has(active.id);
  const previewRows = ordered.length
    ? `<ol class="waterfall-list">${ordered.slice(0, 10).map((m, idx, arr) => {
        const isCurrent = m.id === activeModelId;
        const scoreTitle = `Estimated coding ${m.coding ?? m.intelligence} · Reasoning ${m.reasoning ?? m.intelligence} · Value ${m.valueScore ?? m.intelligence} · ~${m.tokPerSec || 75} tok/s · Pricing: ${m.pricingSource || 'catalog'}`;
        const priceTitle = m.billing === 'api' && m.pricing ? `API: $${m.pricing.inputPer1M}/1M in · $${m.pricing.outputPer1M}/1M out` : (m.billing === 'subscription' ? 'Uses your existing account; plan limits and charges apply' : 'On-device inference; hardware and energy costs apply');
        return `<li class="waterfall-item ${isCurrent ? 'is-active-model' : ''}">
          <button type="button" class="waterfall-pick-btn" data-select-waterfall-model="${escapeHTML(m.id)}" ${modelLock || routeBusy ? 'disabled' : ''} title="${isCurrent ? 'Currently selected model' : escapeHTML(`Click to select ${m.label || m.id} as your active model`)}">
            <span class="waterfall-rank">#${idx + 1}</span>
            <span class="waterfall-name">${escapeHTML(m.label || m.id)}${isCurrent ? ' <span class="active-model-pill">Active</span>' : ''}</span>
            <span class="waterfall-meta">
              <span class="tier-badge ${tierBadgeClass(m.tier)}" title="${escapeHTML(scoreTitle)}">Est. ${escapeHTML(m.tier || 'B')} · ${escapeHTML(m.intelligence)}</span>
              ${m.observed?.samples ? `<span class="win-badge" title="${escapeHTML(`Observed locally: ${m.observed.wins} wins / ${m.observed.samples} runs (${m.observed.refusals} refusals)`)}">Win ${escapeHTML(m.observed.winRate)}%</span>` : ''}
              <span class="price-badge ${priceBadgeClass(m.billing)}" title="${escapeHTML(priceTitle)}">${escapeHTML(m.priceLabel || 'API')}</span>
              ${m.contextLabel ? `<span class="meta-chip" title="Catalog context estimate; live OpenRouter values apply to OpenRouter routes">${escapeHTML(m.contextLabel)}</span>` : ''}
              <span class="meta-chip" title="Size & speed">${escapeHTML(m.size)}</span>
              ${m.zdr?.label ? `<span class="zdr-badge ${(m.zdr.zdrClass === 'local-only' || m.zdr.zdrClass === 'local-lan') ? 'zdr-local' : m.zdr.zdrClass === 'native-zdr' ? 'zdr-native' : m.zdr.zdrClass === 'zdr-enforced' ? 'zdr-routed' : m.zdr.zdrClass === 'no-store' ? 'zdr-nostore' : 'zdr-terms'}">${escapeHTML(m.zdr.label)}</span>` : ''}
            </span>
          </button>
          <span class="waterfall-reorder">
            <button type="button" class="waterfall-move-btn ${m.preference === 'pin' ? 'pref-pin-active' : ''}" data-model-pref="${m.preference === 'pin' ? 'reset' : 'pin'}" data-pref-id="${escapeHTML(m.id)}" aria-label="${m.preference === 'pin' ? 'Unpin' : 'Pin'} ${escapeHTML(m.label || m.id)}" title="${m.preference === 'pin' ? 'Pinned (+8 boost) · Click to reset' : 'Pin higher in waterfall (+8 boost)'}">★</button>
            <button type="button" class="waterfall-move-btn ${m.preference === 'demote' ? 'pref-demote-active' : ''}" data-model-pref="${m.preference === 'demote' ? 'reset' : 'demote'}" data-pref-id="${escapeHTML(m.id)}" aria-label="${m.preference === 'demote' ? 'Undemote' : 'Demote'} ${escapeHTML(m.label || m.id)}" title="${m.preference === 'demote' ? 'Demoted (-10) · Click to reset' : 'Demote lower in waterfall (-10)'}">⊘</button>
            <button type="button" class="waterfall-move-btn" data-waterfall-move="up" data-waterfall-group="${escapeHTML(active.id)}" data-waterfall-id="${escapeHTML(m.id)}" aria-label="Move ${escapeHTML(m.label || m.id)} up" title="Move up" ${idx === 0 ? 'disabled' : ''}>↑</button>
            <button type="button" class="waterfall-move-btn" data-waterfall-move="down" data-waterfall-group="${escapeHTML(active.id)}" data-waterfall-id="${escapeHTML(m.id)}" aria-label="Move ${escapeHTML(m.label || m.id)} down" title="Move down" ${idx === arr.length - 1 ? 'disabled' : ''}>↓</button>
          </span>
        </li>`;
      }).join('')}</ol>`
    : '<p class="field-help">No connected live models currently match this group (or active privacy gate). Connect a subscription, API key, or local model below.</p>';
  const applyLabel = settingsTaskId ? 'Apply full waterfall to this chat' : 'Use waterfall for new chats';
  container.innerHTML = `
    <div class="model-groups-head">
      <div>
        <h3>Models &amp; G0DM0D3 Fallback Order</h3>
        <p class="field-help">Click any model below to select it immediately. On a decline or outage, G0DM0D3 steps down the list and sticks with the working model.</p>
      </div>
      <div class="model-groups-controls">
        <label class="sort-label"><span>Sort</span><select id="model-group-sort" aria-label="Sort models in waterfall">${sortOptions}</select></label>
        <button type="button" class="button button-quiet" data-refresh-catalog ${catalogRefreshBusy ? 'disabled' : ''} title="${escapeHTML(catalogNote)}">${catalogRefreshBusy ? 'Syncing…' : 'Sync pricing'}</button>
      </div>
    </div>
    <div class="model-group-chips" role="group" aria-label="Model capability groups">${chips}</div>
    <div class="model-group-detail">
      <div class="model-group-detail-head">
        <div><strong>${escapeHTML(active.name)}</strong><p class="field-help">${escapeHTML(active.description)} · ${escapeHTML(catalogNote)}</p></div>
        <div class="waterfall-actions">
          ${hasCustomOrder ? `<button type="button" class="button button-quiet" data-reset-waterfall="${escapeHTML(active.id)}">Reset order</button>` : ''}
          <button type="button" class="button button-secondary" data-apply-model-group="${escapeHTML(active.id)}" ${modelGroupBusy || !active.count ? 'disabled' : ''}>${modelGroupBusy ? 'Applying…' : applyLabel}</button>
        </div>
      </div>
      ${previewRows}
    </div>`;
}

async function applyModelGroup(groupId) {
  if (modelGroupBusy) return;
  const groups = Array.isArray(state.modelGroups) ? state.modelGroups : [];
  const group = groups.find(g => g.id === groupId);
  const orderedIds = orderedModelsForGroup(group).map(m => m.id);
  if (!group || !orderedIds.length) { toast('No eligible connected models in that group.'); return; }
  const route = orderedIds.slice(0, 10);
  modelGroupBusy = true;
  renderModelGroups();
  try {
    const task = settingsTaskId ? selectedData?.task : null;
    if (task && !task.draining && !isCrewBusy(task)) {
      const { task: updated } = await api(`/api/tasks/${encodeURIComponent(task.id)}/providers`, {
        method: 'PATCH',
        body: JSON.stringify({ providerIds: route })
      });
      if (selectedId === task.id && selectedData) renderSelected({ ...selectedData, task: updated }, true);
      const queued = Boolean(updated?.pendingProviders?.length);
      const msg = queued
        ? `Queued ${group.name} waterfall (${route.length} models) for your next message.`
        : `Applied ${group.name} waterfall (${route.length} models).`;
      setModelFeedback(msg);
      toast(queued ? `Queued ${group.shortName} waterfall for next message.` : `Applied ${group.shortName} waterfall (${route.length} models).`);
    } else {
      preferredProvider = route[0];
      try {
        localStorage.setItem('g0dc0d3.preferredProvider', preferredProvider);
        localStorage.setItem('g0dc0d3.waterfallGroup', group.id);
      } catch {}
      const msg = `Default waterfall set to ${group.name} (${route.length} models, starting with ${providerById(route[0])?.label || route[0]}).`;
      setModelFeedback(msg);
      toast(`Default waterfall: ${group.shortName} (${route.length} models).`);
    }
    await refresh();
    renderModelSettings();
    renderComposer();
  } catch (error) {
    setModelFeedback(error.message, true);
    toast(error.message);
  } finally {
    modelGroupBusy = false;
    renderModelGroups();
  }
}

function formatRouteSummary(ids, scopePrefix) {
  const list = Array.isArray(ids) ? ids.filter(Boolean) : [];
  if (!list.length) return `${scopePrefix}: no connected model yet`;
  const first = providerById(list[0])?.label || list[0];
  if (list.length === 1) return `${scopePrefix}: ${first}`;
  const second = providerById(list[1])?.label || list[1];
  const rest = list.length - 2;
  return `${scopePrefix}: #1 ${first} → #2 ${second}${rest > 0 ? ` → +${rest} fallback${rest === 1 ? '' : 's'}` : ''}`;
}

function renderModelSettings() {
  renderApiToggles();
  renderVeniceCatalog();
  renderOpenRouterCatalog();
  renderDirectProviderCatalogs();
  renderCustomModelForm();
  renderLocalModelsList();
  renderServicesHub();
  renderUltraRouterSection();
  renderModelGroups();
  renderOverseerSection();
  const task = settingsTaskId ? selectedData?.task : null;
  setVisible('#new-model-group', false);
  setVisible('#route-editor', Boolean(task));
  if (task) renderRouting(task);
  else {
    const route = newConversationProviders();
    const isGodmodeDefault = !preferredProvider && route[0] && /(?:venice[-_.\s]?uncensored|nousresearch[-_/.]hermes[-_.]?4[-_.]?405b)/i.test(`${route[0]} ${providerById(route[0])?.model || ''} ${providerById(route[0])?.label || ''}`);
    setText('#model-current', formatRouteSummary(route, isGodmodeDefault ? 'New chats (G0DM0D3 default)' : 'New chats'));
  }
  setText('#settings-pick-model-label', providerById(task?.providerId || newConversationProviders()[0])?.label || 'Choose model');
}

let connectionConsent = null;
let cliConnectionsData = [];

function renderCliNativeSettings(connection) {
  if (!connection.enabled || !connection.ready) return '';
  const st = connection.settings || {};
  const disabled = connectionBusy ? 'disabled' : '';
  if (connection.id === 'codex-cli') {
    const eff = st.reasoningEffort || '';
    const tier = st.serviceTier || '';
    const verb = st.verbosity || '';
    const localParts = [];
    if (connection.localDefaults) {
      if (connection.localDefaults.model) localParts.push(connection.localDefaults.model);
      if (connection.localDefaults.reasoningEffort) localParts.push(`effort=${connection.localDefaults.reasoningEffort}`);
      if (connection.localDefaults.serviceTier) localParts.push(`tier=${connection.localDefaults.serviceTier}`);
    }
    const hintSegments = [
      localParts.length ? `Config (<code>~/.codex/config.toml</code>): ${escapeHTML(localParts.join(' · '))}` : '',
      connection.localCacheCount > 0 ? `Synced ${connection.localCacheCount} live models from <code>~/.codex/models_cache.json</code>` : ''
    ].filter(Boolean);
    const localHint = hintSegments.length ? `<p class="sub-local-hint">${hintSegments.join(' · ')}</p>` : '';
    return `<div class="sub-settings-block">
      <div class="sub-settings-grid">
        <label class="sub-setting-field"><span>Reasoning effort</span><select data-sub-setting-id="codex-cli" data-sub-setting-key="reasoningEffort" ${disabled}>
          <option value="" ${eff === '' ? 'selected' : ''}>Match composer</option>
          <option value="low" ${eff === 'low' ? 'selected' : ''}>Low</option>
          <option value="medium" ${eff === 'medium' ? 'selected' : ''}>Medium</option>
          <option value="high" ${eff === 'high' ? 'selected' : ''}>High</option>
          <option value="xhigh" ${eff === 'xhigh' ? 'selected' : ''}>Extra High (xhigh)</option>
          <option value="max" ${eff === 'max' ? 'selected' : ''}>Max</option>
          <option value="ultra" ${eff === 'ultra' ? 'selected' : ''}>Ultra</option>
        </select></label>
        <label class="sub-setting-field"><span>Service tier</span><select data-sub-setting-id="codex-cli" data-sub-setting-key="serviceTier" ${disabled}>
          <option value="" ${tier === '' ? 'selected' : ''}>Default</option>
          <option value="priority" ${tier === 'priority' ? 'selected' : ''}>Priority</option>
          <option value="fast" ${tier === 'fast' ? 'selected' : ''}>Fast</option>
          <option value="flex" ${tier === 'flex' ? 'selected' : ''}>Flex</option>
        </select></label>
        <label class="sub-setting-field"><span>Verbosity</span><select data-sub-setting-id="codex-cli" data-sub-setting-key="verbosity" ${disabled}>
          <option value="" ${verb === '' ? 'selected' : ''}>Default</option>
          <option value="low" ${verb === 'low' ? 'selected' : ''}>Low</option>
          <option value="medium" ${verb === 'medium' ? 'selected' : ''}>Medium</option>
          <option value="high" ${verb === 'high' ? 'selected' : ''}>High</option>
        </select></label>
      </div>
      ${localHint}
    </div>`;
  }
  if (connection.id === 'claude-code') {
    const eff = st.effort || '';
    return `<div class="sub-settings-block">
      <div class="sub-settings-grid">
        <label class="sub-setting-field"><span>Claude CLI effort</span><select data-sub-setting-id="claude-code" data-sub-setting-key="effort" ${disabled}>
          <option value="" ${eff === '' ? 'selected' : ''}>Match composer</option>
          <option value="low" ${eff === 'low' ? 'selected' : ''}>Low</option>
          <option value="medium" ${eff === 'medium' ? 'selected' : ''}>Medium</option>
          <option value="high" ${eff === 'high' ? 'selected' : ''}>High</option>
          <option value="max" ${eff === 'max' ? 'selected' : ''}>Max</option>
        </select></label>
      </div>
    </div>`;
  }
  return '';
}

function renderCliModelsSection(connection) {
  if (!connection.enabled || !connection.ready) return '';
  const activeModels = Array.isArray(connection.models) ? connection.models : [];
  const activeSet = new Set(activeModels);
  const available = Array.isArray(connection.availableModels) && connection.availableModels.length
    ? connection.availableModels
    : (Array.isArray(connection.suggestedModels) ? connection.suggestedModels : []);
  const chips = available.map(model => {
    const on = activeSet.has(model);
    return `<button type="button" class="sub-model-chip ${on ? 'is-active' : ''}" data-sub-toggle-model="${escapeHTML(connection.id)}" data-model-name="${escapeHTML(model)}" aria-pressed="${on ? 'true' : 'false'}" ${connectionBusy ? 'disabled' : ''}><span class="sub-chip-check" aria-hidden="true">${on ? '✓' : '+'}</span><span>${escapeHTML(model)}</span></button>`;
  }).join('');
  return `<div class="sub-models-block">
    <div class="sub-models-head"><span>Exposed in Model Picker</span><small>${activeModels.length} active</small></div>
    <div class="sub-model-chips" role="group" aria-label="${escapeHTML(connection.name)} models">${chips}</div>
    <div class="sub-custom-add">
      <input type="text" class="sub-custom-input" data-sub-custom-input="${escapeHTML(connection.id)}" placeholder="Add custom model ID (e.g. ${escapeHTML(available[0] || 'model-id')})" aria-label="Add custom ${escapeHTML(connection.name)} model" autocomplete="off" spellcheck="false" maxlength="120" ${connectionBusy ? 'disabled' : ''}>
      <button type="button" class="button button-quiet" data-sub-custom-add="${escapeHTML(connection.id)}" ${connectionBusy ? 'disabled' : ''}>+ Add</button>
    </div>
  </div>`;
}

async function loadModelConnections(force = false) {
  try {
    const { connections, consent } = await api(`/api/providers/connections${force ? '?refresh=1' : ''}`);
    connectionConsent = consent;
    cliConnectionsData = Array.isArray(connections) ? connections : [];
    const cards = cliConnectionsData.map(connection => {
      const statusClass = connection.enabled && connection.ready
        ? 'sub-status-connected'
        : connection.ready
          ? 'sub-status-ready'
          : connection.installed
            ? 'sub-status-signin'
            : 'sub-status-missing';
      const activeCount = Array.isArray(connection.models) ? connection.models.length : 0;
      const statusLabel = connection.enabled && connection.ready
        ? (activeCount > 1 ? `Connected · ${activeCount} models` : 'Connected')
        : connection.ready
          ? connection.authenticated ? 'Signed in' : 'Sign-in unverified'
          : connection.installed
            ? 'Sign in required'
            : 'Not installed';
      const suggested = Array.isArray(connection.availableModels) && connection.availableModels.length
        ? connection.availableModels
        : (Array.isArray(connection.suggestedModels) ? connection.suggestedModels : []);
      const currentModel = connection.model || '';
      const modelOptions = [
        '<option value="">CLI default</option>',
        ...(currentModel && !suggested.includes(currentModel) ? [`<option value="${escapeHTML(currentModel)}" selected>${escapeHTML(currentModel)}</option>`] : []),
        ...suggested.map(model => `<option value="${escapeHTML(model)}" ${model === currentModel ? 'selected' : ''}>${escapeHTML(model)}</option>`),
      ].join('');
      const actionButtons = connection.enabled
        ? `<button type="button" class="button button-secondary" data-connect-cli="${escapeHTML(connection.id)}" ${connectionBusy || !connection.ready ? 'disabled' : ''}>Set default</button><button type="button" class="button button-quiet" data-disconnect-cli="${escapeHTML(connection.id)}" ${connectionBusy ? 'disabled' : ''}>Disconnect</button>`
        : `<button type="button" class="button button-primary" data-connect-cli="${escapeHTML(connection.id)}" aria-describedby="cli-inference-disclosure" ${connectionBusy || !connection.ready || !consent?.version ? 'disabled' : ''}>Add inference option</button>`;
      return `<article class="subscription-card ${connection.enabled && connection.ready ? 'is-connected' : ''} ${!connection.installed ? 'is-missing' : ''}" data-sub-card="${escapeHTML(connection.id)}"><div class="subscription-card-top"><div class="subscription-identity"><strong>${escapeHTML(connection.name)}</strong>${connection.subscription ? `<span class="sub-plan-badge">${escapeHTML(connection.subscription)}</span>` : ''}</div><span class="sub-status-pill ${statusClass}">${escapeHTML(statusLabel)}</span></div><p class="field-help sub-detail">${escapeHTML(connection.detail || connection.loginHint || '')}</p><div class="subscription-card-controls"><select class="sub-model-select" data-sub-model="${escapeHTML(connection.id)}" aria-label="${escapeHTML(connection.name)} default model" ${connectionBusy || !connection.ready ? 'disabled' : ''}>${modelOptions}</select><div class="subscription-card-actions">${actionButtons}</div></div>${renderCliModelsSection(connection)}${renderCliNativeSettings(connection)}</article>`;
    }).join('');
    $('#model-connections').innerHTML = `<div class="connections-header"><div><h3>Use an existing CLI login</h3><p class="field-help">Connect a local CLI subscription to expose its full model lineup and native effort/tier controls right inside the Model Picker.</p></div><button type="button" class="button button-quiet" data-refresh-connections ${connectionBusy ? 'disabled' : ''}>Refresh logins</button></div><div id="cli-inference-disclosure">${window.SetupUI?.disclosureHTML(consent) || ''}</div><div class="subscription-grid">${cards}</div>`;
  } catch (error) { setText('#model-connections', error.message); }
}

async function updateCliSettings(id, patch, feedbackMsg = '') {
  if (connectionBusy) return;
  connectionBusy = true;
  setText('#model-feedback', 'Updating CLI settings…');
  $('#model-feedback')?.classList.remove('error');
  try {
    await api('/api/providers/connections', {
      method: 'PATCH',
      body: JSON.stringify({ id, ...patch }),
    });
    await refresh();
    if ($('#settings-dialog')?.open) {
      await Promise.all([loadServices(), loadModelGroups(selectedModelSort)]);
      renderModelSettings();
    }
    if ($('#model-picker')?.open) renderModelPicker();
    renderComposer();
    const msg = feedbackMsg || `Updated ${id} settings.`;
    setText('#model-feedback', msg);
    toast(msg);
  } catch (error) {
    $('#model-feedback')?.classList.add('error');
    setText('#model-feedback', error.message);
    toast(error.message);
  } finally {
    connectionBusy = false;
    if ($('#settings-dialog')?.open) await loadModelConnections();
  }
}

async function connectCli(id) {
  if (connectionBusy) return;
  connectionBusy = true;
  setText('#model-feedback', 'Connecting…');
  $('#model-feedback')?.classList.remove('error');
  $$('[data-connect-cli], [data-disconnect-cli], [data-refresh-connections]').forEach(button => button.disabled = true);
  const select = $(`[data-sub-model="${CSS.escape(id)}"]`);
  const model = select ? select.value : undefined;
  try {
    const payload = { id, ...(model !== undefined ? { model } : {}), consentVersion: connectionConsent?.version };
    const result = await api('/api/providers/connections', { method: 'POST', body: JSON.stringify(payload) });
    await refresh();
    if ($('#settings-dialog').open) {
      renderModelSettings();
      setText('#model-feedback', model ? `Connected (${model}).` : 'Connected.');
    }
    toast(model ? `Connected ${id} (${model}).` : `Connected ${id}.`);
  } catch (error) {
    $('#model-feedback')?.classList.add('error');
    setText('#model-feedback', error.message);
    toast(error.message);
  } finally {
    connectionBusy = false;
    if ($('#settings-dialog').open) { await Promise.all([loadModelConnections(), loadServices()]); }
    renderComposer();
  }
}

async function disconnectCli(id) {
  if (connectionBusy) return;
  connectionBusy = true;
  setText('#model-feedback', 'Disconnecting…');
  $('#model-feedback')?.classList.remove('error');
  $$('[data-connect-cli], [data-disconnect-cli], [data-refresh-connections]').forEach(button => button.disabled = true);
  try {
    await api('/api/providers/connections', { method: 'DELETE', body: JSON.stringify({ id }) });
    if (preferredProvider === id || preferredProvider?.startsWith(`${id}:`)) {
      preferredProvider = null;
      try { localStorage.removeItem('g0dc0d3.preferredProvider'); } catch {}
    }
    await refresh();
    if ($('#settings-dialog').open) {
      renderModelSettings();
      setText('#model-feedback', 'Disconnected.');
    }
    toast(`Disconnected ${id}.`);
  } catch (error) {
    $('#model-feedback')?.classList.add('error');
    setText('#model-feedback', error.message);
    toast(error.message);
  } finally {
    connectionBusy = false;
    if ($('#settings-dialog').open) { await Promise.all([loadModelConnections(), loadServices()]); }
    renderComposer();
  }
}

function renderTasks(force = false) {
  if ($('#task-list .inline-rename-input')) return;
  const query = $('#task-search').value.trim().toLowerCase();
  const signature = JSON.stringify([state.tasks.map(task => [task.id, task.title, task.status, task.updatedAt, task.outcome?.label, Boolean(task.pendingApproval), projectLabel(task)]), selectedId, query]);
  if (!force && signature === listSignature) return;
  listSignature = signature;
  setText('#task-count', state.tasks.length);
  const tasks = state.tasks.filter(task => `${task.title ?? ''} ${projectLabel(task)} ${task.id}`.toLowerCase().includes(query));
  const groups = new Map();
  for (const task of tasks) {
    const key = task.sourcePath || task.fixtureId || 'conversations';
    if (!groups.has(key)) groups.set(key, { label: projectLabel(task) || 'Recent', tasks: [] });
    groups.get(key).tasks.push(task);
  }
  const showGroupHeadings = groups.size > 1 || [...groups.keys()].some(k => k !== 'conversations');
  const renameSvg = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M13.5 3.5a2.1 2.1 0 0 1 3 3L7 16l-4 1 1-4 9.5-9.5Z"/></svg>';
  const deleteSvg = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 6h10M8 6V4h4v2M6.5 6l.7 10h5.6l.7-10"/></svg>';
  $('#task-list').innerHTML = tasks.length ? [...groups.values()].map(group => `<section class="task-project-group">${showGroupHeadings ? `<h3 class="task-project-heading" title="${escapeHTML(group.label)}"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 5h5l2 2h7v9H3z"/></svg><span>${escapeHTML(group.label)}</span></h3>` : ''}${group.tasks.map(task => {
    const busy = ACTIVE.has(task.status) || task.draining;
    return `<div class="task-item-row ${task.id === selectedId ? 'selected' : ''}" data-task-row="${escapeHTML(task.id)}"><button type="button" class="task-item ${task.id === selectedId ? 'selected' : ''}" data-select-task="${escapeHTML(task.id)}" aria-current="${task.id === selectedId ? 'true' : 'false'}" aria-label="${escapeHTML(task.title || 'Untitled task')} — ${escapeHTML(task.pendingApproval ? 'Approval required' : taskStatusLabel(task))}" title="${escapeHTML(task.title)} · ${escapeHTML(task.pendingApproval ? 'Approval required' : taskStatusLabel(task))}"><span class="task-item-top"><span class="status-dot ${escapeHTML(task.pendingApproval ? 'waiting_input' : task.status)}" aria-hidden="true"></span><span class="task-item-name">${escapeHTML(task.title || 'Untitled task')}</span>${task.pendingApproval ? '<span class="task-approval-pip" title="Approval required">!</span>' : ''}</span><time class="task-item-date">${escapeHTML(shortDate(task.updatedAt ?? task.createdAt))}</time></button><span class="task-item-actions"><button type="button" class="icon-button task-row-action" data-rename-task="${escapeHTML(task.id)}" title="Rename conversation" aria-label="Rename ${escapeHTML(task.title || 'conversation')}">${renameSvg}</button>${!busy ? `<button type="button" class="icon-button task-row-action task-row-delete" data-delete-task="${escapeHTML(task.id)}" title="Delete conversation" aria-label="Delete ${escapeHTML(task.title || 'conversation')}">${deleteSvg}</button>` : ''}</span></div>`;
  }).join('')}</section>`).join('') : `<p class="sidebar-empty">${query ? 'No matching conversations.' : 'Your conversations will appear here.'}</p>`;
}

function renderFixtures() {
  const signature = JSON.stringify(state.fixtures);
  if (signature === fixtureSignature) return;
  fixtureSignature = signature;
  const listEl = $('#fixture-list');
  if (listEl) {
    listEl.innerHTML = state.fixtures.map((fixture, index) => `<button type="button" class="fixture-item" data-create-fixture="${escapeHTML(fixture.id)}"><span class="fixture-icon">${String(index + 1).padStart(2, '0')}</span><span class="fixture-copy"><strong>${escapeHTML(fixture.title)}</strong><p>${escapeHTML(fixture.description)}</p></span><span class="fixture-arrow" aria-hidden="true">↗</span></button>`).join('') || '<p class="sidebar-empty">No fixtures are available.</p>';
  }
  setText('#advanced-fixtures-count', String(state.fixtures.length));
  const wf = $('#create-workflow');
  if (wf && Array.isArray(state.workflows)) {
    wf.innerHTML = '<option value="">Custom</option>' + state.workflows.map(w => `<option value="${escapeHTML(w.name)}">${escapeHTML(w.label)} — ${escapeHTML(w.maxCalls)} calls, ${w.executionEnabled ? 'exec on' : 'exec off'}</option>`).join('');
  }
}

function renderControls(task) {
  let controls = '';
  const moreOpen = Boolean($('#task-controls .task-more')?.open);
  const focused = $('#task-controls').contains(document.activeElement) ? document.activeElement : null;
  const focusKey = focused?.matches('summary') ? 'summary' : focused?.dataset.action ? `[data-action="${focused.dataset.action}"]` : focused?.dataset.crewAction ? '[data-crew-action]' : focused?.hasAttribute('data-mobile-inspector') ? '[data-mobile-inspector]' : focused?.matches('a') ? 'a' : null;
  if (task.status === 'queued') controls += '<button type="button" class="button button-primary" data-action="run"><span aria-hidden="true">▶</span> Run task</button>';
  if (RESUMABLE.has(task.status)) {
    const budgetExhausted = task.status === 'paused_budget' || (Number(task.policy?.maxCalls || 0) > 0 && Number(task.calls || 0) >= Number(task.policy.maxCalls));
    if (budgetExhausted && Number(task.policy?.maxCalls || 0) < 5000) {
      controls += '<button type="button" class="button button-primary" data-action="resume-budget" title="Add 100 calls to this chat’s call budget and resume"><span aria-hidden="true">▶</span> Continue (+100 calls)</button>';
    } else {
      controls += '<button type="button" class="button button-primary" data-action="resume"><span aria-hidden="true">▶</span> Resume</button>';
    }
  }
  if (ACTIVE.has(task.status)) controls += '<button type="button" class="button button-secondary" data-action="pause"><span aria-hidden="true">Ⅱ</span> Pause</button>';
  if (!TERMINAL.has(task.status)) controls += '<button type="button" class="button button-quiet" data-action="cancel">Cancel</button>';

  if (task.status === 'completed' && task.completionKind !== 'answered') controls += `<button type="button" class="button button-quiet checks-shortcut" data-mobile-inspector>${task.completionKind === 'user_accepted' ? 'Owner accepted' : task.verification?.status === 'pass' ? '✓ Checks passed' : 'Closed · review checks'}</button>`;

  let secondary = '';
  if (!TERMINAL.has(task.status) && !ACTIVE.has(task.status) && task.status !== 'queued' && !task.pendingMessages?.length) secondary += '<button type="button" class="button button-quiet" data-action="accept" title="Accept the current result; recorded check failures and gaps are preserved">Accept result</button>';
  const ownerChecks = Boolean(task.checks?.length && task.checksContractVersion === task.contractVersion);
  const registeredChecks = Boolean(!task.followups?.length && (task.fixtureId || task.acceptance?.checkType));
  const crewBudgetLeft = Math.max(0, Number(task.policy?.maxCalls ?? 0) - Number(task.calls ?? 0));
  const crewReason = (!ownerChecks && !registeredChecks)
    ? 'Add checks (or use a fixture/project task with checks) before using a crew.'
    : (ownerChecks && !task.execution?.enabled)
      ? 'Enable command execution in Settings → Tools to run configured checks with a crew.'
      : crewBudgetLeft < 3
        ? 'A crew needs at least 3 remaining model calls.'
        : '';
  if (!ACTIVE.has(task.status) && task.status !== 'cancelled' && !isCrewBusy(task)) secondary += `<button type="button" class="button button-quiet" data-crew-action="start" title="${escapeHTML(crewReason || 'Solver, challenger and verifier share this task’s remaining budget.')}">Use crew</button>`;
  secondary += '<button type="button" class="button button-quiet" data-rename-current>Rename chat</button>';
  secondary += '<button type="button" class="button button-quiet" data-mobile-inspector>Task details</button>';
  secondary += '<button type="button" class="button button-quiet" data-copy-transcript>Copy Markdown transcript</button>';
  secondary += `<a class="button button-quiet export-link" href="/api/tasks/${encodeURIComponent(task.id)}/export" download>Export conversation</a>`;
  if (!ACTIVE.has(task.status) && !task.draining && !isCrewBusy(task)) secondary += '<button type="button" class="button button-quiet danger-menu-btn" data-purge-task title="Delete saved chat and managed workspace">Delete chat</button>';
  controls += `<details class="task-more" ${moreOpen ? 'open' : ''}><summary aria-label="More task actions" title="More task actions">···</summary><div class="task-more-menu">${secondary}</div></details>`;
  $('#task-controls').innerHTML = controls;
  $$('#task-controls button[data-action]').forEach((button) => { button.disabled = actionBusy || isCrewBusy(task) || ((task.sourceBusy || sourceActionBusy) && !['pause', 'cancel'].includes(button.dataset.action)) || (task.draining && button.dataset.action !== 'cancel') || (messageBusyTasks.has(task.id) && !['pause', 'cancel'].includes(button.dataset.action)); });
  const crewStart = $('#task-controls [data-crew-action="start"]');
  if (crewStart) crewStart.disabled = Boolean(crewReason) || actionBusy || task.draining || task.sourceBusy || sourceActionBusy || Boolean(task.pendingMessages?.length) || messageBusyTasks.has(task.id);
  if (focusKey) { const target = $(focusKey, $('#task-controls')); if(target && !target.disabled)target.focus({preventScroll:true}); }
  renderComposer();
}

function isCrewBusy(task = selectedData?.task) {
  if (!task) return false;
  return Boolean(task.crewBusy || crewRequests.has(task.id) || (selectedData?.task?.id === task.id && selectedData.crewBusy));
}

function renderCrew() {
  const panel = $('#crew-panel'), task = selectedData?.task, crew = selectedData?.crew;
  const pending = Boolean(task && crewRequests.has(task.id));
  setVisible('#crew-panel', Boolean(crew || pending));
  if (!crew) { panel.innerHTML = pending ? '<p class="crew-status" role="status">Starting crew…</p>' : ''; return; }
  const labels = { preparing: 'Crew preparing', running: 'Crew investigating', verifying: 'Crew checking', paused: 'Crew paused', ready: 'Candidate ready', applying: 'Using candidate', applied: 'Candidate applied', cancelled: 'Crew stopped', failed: 'Crew needs attention' };
  const sameCrew = panel.dataset.crewId === crew.id;
  const open = sameCrew && Boolean($('#crew-details')?.open);
  const previousFocus = sameCrew && panel.contains(document.activeElement) ? document.activeElement : null;
  const focusAction = previousFocus?.dataset.crewAction;
  const focusReview = previousFocus?.hasAttribute('data-crew-review');
  const focusDetails = previousFocus?.matches('#crew-details > summary');
  const scroll = sameCrew ? $('.crew-detail-body', panel)?.scrollTop || 0 : 0;
  panel.dataset.crewId = crew.id;
  const workers = Array.isArray(crew.workers) ? crew.workers : [];
  const settled = ['applied', 'cancelled', 'failed'].includes(crew.status);
  let actions = crew.status === 'ready' ? '<button type="button" class="button button-primary" data-crew-review>Review candidate</button>' : crew.status === 'paused' ? '<button type="button" class="button button-secondary" data-crew-action="resume">Resume crew</button>' : ['preparing', 'running', 'verifying'].includes(crew.status) ? '<button type="button" class="button button-secondary" data-crew-action="pause">Pause crew</button>' : '';
  if (crew.unresolved?.length && !['preparing', 'running', 'verifying', 'applying'].includes(crew.status)) actions += '<button type="button" class="button button-secondary" data-crew-action="inspect">Inspect effects</button>';
  const deadline = typeof crew.deadlineAt === 'number' ? crew.deadlineAt : Date.parse(crew.deadlineAt);
  const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 60000));
  panel.innerHTML = `<div class="crew-heading"><p class="crew-status" role="status">${escapeHTML(labels[crew.status] || humanize(crew.status))}${!settled && workers.length ? `<span> · ${workers.length} ${workers.length === 1 ? 'worker' : 'workers'}</span>` : ''}</p><div class="crew-actions">${actions}${!settled && crew.status !== 'applying' ? `<button type="button" class="button button-quiet" data-crew-action="cancel">${crew.status === 'ready' ? 'Dismiss' : 'Cancel crew'}</button>` : ''}</div></div><details id="crew-details" ${open ? 'open' : ''}><summary>Details <span>${escapeHTML(crew.calls ?? 0)} / ${escapeHTML(crew.maxCalls ?? 12)} calls</span></summary><div class="crew-detail-body"><p class="crew-budget">${escapeHTML(crew.recoveries ?? 0)} / ${escapeHTML(crew.maxRecoveries ?? 0)} recoveries${!settled && crew.status !== 'ready' && Number.isFinite(remaining) ? ` · ${remaining} min left` : ''}</p>${workers.map(worker => `<article class="crew-worker"><div><strong>${escapeHTML(humanize(worker.role))}</strong><span>${escapeHTML(humanize(worker.status))}</span></div><p>${escapeHTML(providerById(worker.providerId)?.label || worker.providerId || 'Checks')} · ${escapeHTML(worker.calls ?? 0)} ${worker.calls === 1 ? 'call' : 'calls'}</p>${worker.summary ? `<p class="crew-finding">${escapeHTML(worker.summary)}</p>` : ''}</article>`).join('')}${crew.error?.message ? `<p class="crew-error">${escapeHTML(crew.error.message)}</p>` : ''}</div></details>`;
  $$('#crew-panel button').forEach(button => { button.disabled = pending; });
  $('.crew-detail-body', panel).scrollTop = scroll;
  const focusTarget = focusAction ? $$('[data-crew-action]', panel).find(button => button.dataset.crewAction === focusAction) : focusReview ? $('[data-crew-review]', panel) : focusDetails ? $('#crew-details > summary') : null;
  if (previousFocus) (focusTarget || $('#crew-details > summary'))?.focus({ preventScroll: true });
}

function renderCrewLocks() {
  if (!selectedData?.task) return;
  renderControls(selectedData.task);
  renderCrew();
  renderChanges(selectedData.diff || []);
  renderPolicy(selectedData.task);
  renderRouting(selectedData.task);
  if (typeof renderTaskSettings === 'function') renderTaskSettings(selectedData.task);
}

async function refreshCrewTask(taskId) {
  const version = selectionVersion;
  const detail = await api(`/api/tasks/${encodeURIComponent(taskId)}`);
  if (selectedId === taskId && selectionVersion === version) renderSelected(detail, true);
  await refresh();
}

async function crewAction(action) {
  const taskId = selectedId;
  if (!taskId || crewRequests.has(taskId)) return;
  if (action === 'start' && (isCrewBusy() || ACTIVE.has(selectedData?.task?.status))) return;
  crewRequests.add(taskId);
  renderCrewLocks();
  try {
    const endpoint = action === 'start' ? 'crew' : `crew/${action}`;
    await api(`/api/tasks/${encodeURIComponent(taskId)}/${endpoint}`, { method: 'POST', body: '{}' });
    await refreshCrewTask(taskId);
  } catch (error) { toast(error.message); }
  finally { crewRequests.delete(taskId); if (selectedId === taskId) renderCrewLocks(); }
}

async function openCrewReview() {
  const taskId = selectedId;
  if (!taskId || crewRequests.has(taskId)) return;
  const review = { taskId, candidate: null };
  crewReview = review;
  setText('#crew-review-note', 'Loading candidate…');
  $('#crew-review-checks').innerHTML = '';
  $('#crew-review-files').innerHTML = '';
  setVisible('#crew-review-error', false);
  $('#crew-review-confirm').disabled = true;
  dismissDrawers();
  $('#crew-review-dialog').showModal();
  try {
    const candidate = await api(`/api/tasks/${encodeURIComponent(taskId)}/crew/candidate`);
    if (crewReview !== review || !$('#crew-review-dialog').open) return;
    review.candidate = candidate;
    const files = Array.isArray(candidate.files) ? candidate.files : [];
    const checks = Array.isArray(candidate.verification?.checks) ? candidate.verification.checks : [];
    const passed = candidate.verification?.status === 'pass';
    const findings = Array.isArray(candidate.review?.findings) ? candidate.review.findings : [];
    const earlierReview = candidate.review && candidate.review.snapshotHash !== candidate.snapshotHash;
    const advisory = candidate.review ? `<section class="crew-review-findings" aria-label="Challenger findings"><h3>Challenger <span>Advisory</span></h3>${earlierReview ? '<p class="crew-review-age">Findings from before the repair.</p>' : ''}${findings.length ? `<p>Changes requested${earlierReview ? ' before repair' : ''}.</p>${findings.map(finding => `<article><code>${escapeHTML(finding.path)}</code><p>${escapeHTML(finding.detail)}</p></article>`).join('')}` : '<p>No issues reported.</p>'}</section>` : '';
    setText('#crew-review-note', `${files.length} changed ${files.length === 1 ? 'file' : 'files'}. Use this candidate in the task’s working copy.`);
    $('#crew-review-checks').innerHTML = `<details class="crew-review-evidence"><summary>${passed ? '✓ Checks passed' : 'Checks incomplete'} · ${checks.length} ${checks.length === 1 ? 'check' : 'checks'}</summary>${checks.map(check => `<p><strong>${escapeHTML(check.name)}</strong> · ${escapeHTML(humanize(check.status))}${check.detail ? `<br>${escapeHTML(pretty(check.detail))}` : ''}</p>`).join('')}<code>${escapeHTML(candidate.snapshotHash)}</code></details>${advisory}`;
    $('#crew-review-files').innerHTML = files.map(file => `<section class="code-file"><h3 class="code-file-header">${escapeHTML(file.path)}<span class="file-size">${escapeHTML(humanize(file.status))}</span></h3><div class="diff-grid"><div class="diff-side before"><div class="diff-label">CURRENT COPY</div><pre tabindex="0" aria-label="Current content of ${escapeHTML(file.path)}">${escapeHTML(file.before ?? 'File does not exist')}</pre></div><div class="diff-side after"><div class="diff-label">CANDIDATE</div><pre tabindex="0" aria-label="Candidate content of ${escapeHTML(file.path)}">${escapeHTML(file.after ?? 'File will be removed')}</pre></div></div></section>`).join('');
    $('#crew-review-confirm').disabled = !passed || !candidate.crewId || !candidate.snapshotHash;
  } catch (error) {
    if (crewReview === review && $('#crew-review-dialog').open) {
      setText('#crew-review-note', 'Could not load reviewed candidate.');
      errorIn('#crew-review-error', error);
    }
  }
}

async function confirmCrewReview() {
  const review = crewReview;
  if (!review?.candidate || crewRequests.has(review.taskId) || $('#crew-review-confirm').disabled) return;
  crewRequests.add(review.taskId);
  $('#crew-review-confirm').disabled = true;
  setText('#crew-review-note', 'Using reviewed candidate…');
  renderCrewLocks();
  try {
    await api(`/api/tasks/${encodeURIComponent(review.taskId)}/crew/apply`, { method: 'POST', body: JSON.stringify({ crewId: review.candidate.crewId, snapshotHash: review.candidate.snapshotHash }) });
    if (crewReview === review && $('#crew-review-dialog').open) $('#crew-review-dialog').close();
    await refreshCrewTask(review.taskId);
    if (selectedId === review.taskId) chooseTab('changes');
    toast('Candidate applied to working copy.');
  } catch (error) {
    if (crewReview === review && $('#crew-review-dialog').open) {
      errorIn('#crew-review-error', error);
      setText('#crew-review-note', 'Close and review the candidate again before retrying.');
    } else {
      toast(error.message || 'Could not apply candidate.');
    }
  } finally { crewRequests.delete(review.taskId); if (selectedId === review.taskId) renderCrewLocks(); }
}

function eventDescription(event) {
  const data = event.data ?? {};
  const type = event.type ?? 'event';
  const summaries = {
    'task.created': ['Task created', '◆', '', data.title ?? data.objective ?? 'The task is recorded in the local ledger.'],
    'user.message': ['User message', '↑', '', data.message ?? ''],
    'user.message.queued': ['Instructions queued', '↑', '', 'Saved for the next settled step.'],
    'user.message.removed': ['Queued instructions removed', '×', '', 'Removed before application.'],
    'user.messages.applied': ['Queued instructions applied', '↑', '', `${data.ids?.length || 0} messages added to the task requirements.`],
    'tools.superseded': ['Remaining tools superseded', '·', '', data.reason ?? ''],
    'task.status': [`Task ${humanize(data.status ?? data.to ?? '')}`, '·', '', data.reason ?? data.message ?? ''],
    'race.dispatched': [data.stage==='grade'?'Grading anonymous drafts':'Drafting in parallel','↗','',(data.models || []).join(' · ')],
    'race.result': [data.stage==='grade'?'Judge finished':'Writer finished','↙','',data.providerId+' · '+data.status+' · '+duration(data.durationMs)],
    'model.request': ['Model request', '↗', '', [data.providerId ?? data.provider ?? data.model, data.strategy ? `strategy: ${data.strategy}` : '', data.call ? `call ${data.call}` : ''].filter(Boolean).join(' · ')],
    'model.response': [data.superseded ? 'Response superseded by new instructions' : 'Model response', '↙', '', data.superseded ? data.reason : data.text ?? data.response?.text ?? data.response?.message ?? data.message ?? ''],
    'model.interrupted': ['Model request interrupted', '■', '', `${data.providerId} · ${data.reason} after ${data.durationMs} ms`],
    'tool.started': (() => { const s = humanizeToolStep({ type: 'tool.started', data }); return [s.verb, '⌁', 'tool', s.target]; })(),
    'tool.completed': (() => { const s = humanizeToolStep({ type: 'tool.completed', data }); return [s.verb, '⌁', s.isErr ? 'error' : 'tool', s.target]; })(),
    'tool.failed': (() => { const s = humanizeToolStep({ type: 'tool.failed', data }); return [s.verb, '!', 'error', s.target || data.error?.message || data.message || '']; })(),
    'autotune.selected': ['HyperTuner', '◈', 'info', `${data.profileLabel || data.profileId || 'Focused'}${data.applied?.temperature !== undefined ? ` (T=${data.applied.temperature})` : ''} · ${data.domain || 'general'} · ${data.winRatePct ?? 0}%`],
    'recovery.started': ['Recovery initiated', '↻', 'warning', data.incident?.message ?? data.reason ?? data.diagnosis ?? data.strategy ?? data.message ?? 'Resuming G0DM0D3 recovery.'],
    'routing.retry_scheduled': ['Retry scheduled', '↻', 'warning', `Attempt ${data.retry} of ${data.maxRetries}. Waiting until ${new Date(data.retryAt).toLocaleTimeString()}.`],
    'routing.profile_changed': ['Output allowance adjusted', '↻', 'warning', `${data.before?.maxOutputTokens} → ${data.requestProfile?.maxOutputTokens} tokens.`],
    'routing.auto_continued': ['Auto-continued seamlessly', '↻', 'info', data.reason || `Continued output (part ${(data.hop || 1) + 1}).`],
    'routing.strategy_changed': ['Trying another approach', '↻', 'warning', data.strategy || ''],
    'recovery.attempt': ['Recovery attempt', '↻', 'warning', data.strategy ?? data.reason ?? ''],
    'providers.updated': ['Route saved', '⇄', '', 'Next request · ' + (providerById(data.providerId)?.label || data.providerId || '')],
    'model.switched': [data.reason === 'VENICE_SERVICE_OUTAGE' ? 'Venice outage · model switched' : data.reason === 'RACE_GODMODE_RECOVERY' ? 'G0DM0D3 recovered Ultra-Plinian' : 'Model switched', '⇄', '', `${String(data.from || '').split(/,\s*/).filter(Boolean).map(pid => providerById(pid)?.label || pid).join(' + ') || 'Previous model'} → ${providerById(data.to)?.label || data.to || data.providerId || 'Next model'}`],
    'overseer.advised': ['Overseer unblocked', '✦', '', `${providerById(data.overseerId)?.label || data.overseerId || 'Overseer'} (${data.strategy || 'advice'}): ${data.rootCause || data.reason || ''}`],
    'overseer.judged': ['Overseer classified reply', '✦', '', `${data.classification || 'checked'} — ${data.reason || ''}`],
    'overseer.audited': [data.verdict === 'needs_work' ? 'Overseer caught gaps before finish' : 'Overseer verified completion', '✦', data.verdict === 'needs_work' ? 'warning' : 'success', `${Number.isFinite(data.completenessScore) ? `${data.completenessScore}% · ` : ''}${data.reason || ''}`],
    'overseer.coached': [data.manual ? 'Overseer consulted' : 'Overseer trajectory check', '✦', data.status === 'stuck' ? 'warning' : 'info', `${data.status || 'checked'} — ${data.diagnosis || data.reason || ''}`],
    'memory.auto_learned': ['Brain 2.0 learned memory', '✦', 'info', Array.isArray(data.titles) && data.titles.length ? data.titles.join(' · ') : `${data.count || 1} episodic memory saved`],
    'skill.created': ['Saved reusable skill', '✦', 'success', `${data.command || `/${data.name || 'skill'}`}${data.description ? ` — ${data.description}` : ''}`],
    'owner.refusal_reported': ['Refusal flagged by you', '↻', '', data.reason || 'Retrying with recovery / fallback.'],
    'routing.reframe_retry': ['G0DM0D3 reframed retry', '↻', '', `${providerById(data.providerId)?.label || data.providerId || 'Model'} (pass ${data.pass || 1} · ${data.level || 'reframe'})`],
    'evaluation.completed': ['Evaluation recorded', '◎', (data.status ?? data.result?.status) === 'pass' ? 'success' : 'warning', data.status ? humanize(data.status) : data.result?.status ? humanize(data.result.status) : 'Inspect the check results for this snapshot.'],
    'task.completed': [data.completionKind === 'user_accepted' ? 'Owner accepted result' : 'Task completed', '✓', 'success', data.completionKind === 'user_accepted' ? 'Owner acceptance recorded. Failed or unknown checks remain unchanged.' : data.reason ?? data.message ?? 'Completion was recorded by the controller.'],
    'task.accepted': ['Owner accepted result', '✓', 'success', 'Recorded test outcomes and gaps remain unchanged.'],
    'task.failed': ['Task failed', '!', 'error', data.reason ?? data.message ?? data.error ?? ''],
    'task.cancelled': ['Task cancelled', '×', '', data.reason ?? 'The task history is retained.'],
    'policy.updated': ['Recovery policy updated', '≡', '', 'Future attempts use the updated override policy.'],
    'checkpoint.created': ['Checkpoint saved', '◇', '', data.reason ?? ''],
    'git.checkpoint': ['Checkpoint committed', '◇', 'success', [data.hash ? String(data.hash).slice(0, 7) : '', data.message || data.summary || ''].filter(Boolean).join(' · ')],
    'task.forked': ['Task forked', '⑂', '', data.fromHash ? `Branched from ${String(data.fromHash).slice(0, 7)}` : 'Branched into a new task.'],
    'task.compacted': ['Context compacted', '⏚', 'info', [
      data.reason ? humanize(data.reason) : '',
      (Number.isFinite(data.utilizationBeforePct) && Number.isFinite(data.utilizationAfterPct)) ? `${data.utilizationBeforePct}% → ${data.utilizationAfterPct}%` : '',
      data.foldedEvents ? `${data.foldedEvents} events folded` : '',
      data.semanticDistilled ? 'semantic + structural' : 'structural',
    ].filter(Boolean).join(' · ')],
    'permission.requested': ['Approval requested', '!', 'warning', [data.tool, data.target || data.reason].filter(Boolean).join(' · ')],
    'permission.auto_approved': ['Auto-approved by Overseer', '✦', 'success', [data.tool, data.target, data.reason].filter(Boolean).join(' · ')],
    'permission.resolved': ['Approval resolved', '✓', data.decision === 'deny' ? 'warning' : 'success', [data.tool, data.decision].filter(Boolean).join(' · ')],
    'subagent.started': ['Subagent launched', '⑂', 'tool', `${data.role || 'explore'} · ${String(data.prompt || '').slice(0, 120)}`],
    'subagent.completed': ['Subagent finished', '✓', data.ok ? 'success' : 'warning', `${data.role || 'explore'} (${data.providerId || 'model'}) · ${data.calls || 0} calls`],
    'hook.blocked': ['Blocked by PreToolUse hook', '⊘', 'warning', data.reason || data.tool || ''],
    'permissions.updated': ['Permission rules updated', '≡', '', 'Updated tool approval rules.'],
    'todos.updated': ['Checklist updated', '✓', '', `${Array.isArray(data.todos) ? data.todos.length : 0} items`],
  };
  return summaries[type] ?? [humanize(type), '·', /fail|error/.test(type) ? 'error' : /recover|refus|block/.test(type) ? 'warning' : '', data.message ?? data.reason ?? ''];
}

function renderActivity(events, total = events.length) {
  const panel = $('#panel-activity');
  if (!panel) return;
  if (!events.length) {
    panel.innerHTML = '<div class="panel-empty"><span class="panel-empty-icon" aria-hidden="true">↗</span><div><h3>The next move is yours.</h3><p>Run the task to see model requests, tool operations,<br>recoveries, and verification appear here.</p></div></div>';
    return;
  }
  const openEvents = new Set($$('.activity-details[open]', panel).map((item) => item.dataset.event));
  const evLimit = selectedData?.displayLimits?.events || 200;
  const notice = events.length >= evLimit && total > events.length ? `<div class="history-notice">Showing the latest ${events.length} of ${total} events. <a href="/api/tasks/${encodeURIComponent(selectedId)}/export" download>Export the full ledger ↗</a></div>` : '';
  panel.innerHTML = notice + events.map((event) => {
    const [title, icon, iconClass, rawSummary] = eventDescription(event);
    const summary = typeof rawSummary === 'string' ? rawSummary : pretty(rawSummary);
    const data = event.data ?? {};
    const key = String(event.id ?? event.seq);
    return `<article class="activity-entry"><span class="activity-icon ${iconClass}" aria-hidden="true">${icon}</span><div class="activity-entry-header"><h3 class="activity-title">${escapeHTML(title)}</h3><time class="activity-time" title="${escapeHTML(event.time)}">${escapeHTML(timeLabel(event.time))}</time></div>${summary ? `<p class="activity-subtitle">${escapeHTML(summary.slice(0, 1400))}${summary.length > 1400 ? '…' : ''}</p>` : ''}<details class="activity-details" data-event="${escapeHTML(key)}" ${openEvents.has(key) ? 'open' : ''}><summary>EVENT ${escapeHTML(event.seq ?? '—')} · ${escapeHTML(event.type)}</summary><pre class="activity-code" tabindex="0" role="region" aria-label="Event details">${escapeHTML(pretty(data))}</pre></details></article>`;
  }).join('');
}

function conversationMessage({ role, text, time, provider, key, raw, outcome, thinking, attachments }, openDetails) {
  const title = role === 'user' ? 'You' : '<span class="wordmark" role="img" aria-label="GodMode">GODMODƎ</span>';
  const long = role === 'user' && String(text).length > 1800;
  const expandedKey = `message-${key}`;
  const thinkingKey = `thinking-${key}`;
  const thinkingHtml = role === 'assistant' && typeof thinking === 'string' && thinking.trim()
    ? `<details class="thinking-block" data-disclosure="${escapeHTML(thinkingKey)}" ${(openDetails.has(thinkingKey) || qolPrefs.expandThinking) ? 'open' : ''}><summary class="thinking-summary"><span class="thinking-icon" aria-hidden="true">◇</span><span>Reasoning</span><span class="thinking-meta">${escapeHTML(thinking.trim().length.toLocaleString())} chars</span></summary><pre class="thinking-body" tabindex="0" role="region" aria-label="Model reasoning">${escapeHTML(thinking.trim())}</pre></details>`
    : '';
  const attList = role === 'user' && Array.isArray(attachments) ? attachments.filter(a => typeof a?.dataUrl === 'string' && a.dataUrl.startsWith('data:image/')) : [];
  const attachmentsHtml = attList.length
    ? `<div class="message-attachments">${attList.map(att => `<button type="button" class="message-attachment-btn" data-zoom-image="${escapeHTML(att.dataUrl)}" data-zoom-name="${escapeHTML(att.name || 'image')}" title="View ${escapeHTML(att.name || 'image')}"><img src="${escapeHTML(att.dataUrl)}" alt="${escapeHTML(att.name || 'Attached image')}"><span>${escapeHTML(att.name || 'image')}</span></button>`).join('')}</div>`
    : '';
  const body = long ? `<details class="message-long" data-disclosure="${escapeHTML(expandedKey)}" ${openDetails.has(expandedKey) ? 'open' : ''}><summary><span class="message-preview">${escapeHTML(String(text).slice(0, 600))}…</span><span class="message-expand-label">Read full request · ${String(text).length.toLocaleString()} characters</span></summary><div class="message-full" tabindex="0" role="region" aria-label="Full request">${formatMessageBody(text)}</div></details>` : formatMessageBody(text, role === 'assistant');
  const score = raw?.scorecard;
  const scoreKey = 'score-'+key;
  const scoreTitle = score?.status === 'godmode_recovered' ? 'Ultra-Plinian · G0DM0D3 recovered' : score?.status === 'single_completion' ? 'Ultra-Plinian result' : 'Ultra-Plinian scorecard';
  const scoreOutcomes = Array.isArray(score?.outcomes) && !score.grades?.length
    ? score.outcomes.map(o => `<div><strong>${escapeHTML(providerById(o.providerId)?.label || o.providerId)}</strong> <small>${escapeHTML(o.status || 'unknown')} · ${escapeHTML(duration(o.durationMs))}</small></div>`).join('')
    : '';
  const scorecard = score ? `<details class="race-scorecard" data-disclosure="${escapeHTML(scoreKey)}" ${openDetails.has(scoreKey)?'open':''}><summary>${scoreTitle}</summary>${score.note ? `<p>${escapeHTML(score.note)}</p>` : `<p>Tastemaker Judge · ${escapeHTML(providerById(score.judgeId)?.label || score.judgeId)}</p>`}${(score.grades || []).map(g=>`<div class="scorecard-contender-row"><div class="scorecard-contender-top"><strong>${escapeHTML(providerById(g.providerId)?.label || g.providerId)} · ${escapeHTML(g.total)}/15${g.providerId===score.winnerId?' · ♛ winner':''}</strong><button type="button" class="button button-quiet race-crown-inline" data-inline-crown="${escapeHTML(g.providerId)}" data-inline-race-id="${escapeHTML(score.raceId || '')}" title="Crown this answer as your pick (+local Elo)">👑 Crown</button></div><small>Fidelity ${escapeHTML(g.fidelity)} · Completeness ${escapeHTML(g.completeness)} · Clarity ${escapeHTML(g.clarity)}</small><p>${escapeHTML(g.reason)}</p></div>`).join('')}${scoreOutcomes}</details>` : '';
  const copyBtn = text ? `<button type="button" class="copy-response" data-copy-text="${escapeHTML(text)}" title="${role === 'user' ? 'Copy message' : 'Copy response'}" aria-label="${role === 'user' ? 'Copy message' : 'Copy response'}"><svg viewBox="0 0 20 20" aria-hidden="true"><rect x="6" y="6" width="10" height="11" rx="2"/><path d="M12 6V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/></svg></button>` : '';
  const regenBtn = role === 'assistant' && Boolean(raw?.__isLatestRegeneratable)
    ? `<button type="button" class="copy-response regenerate-response" data-regenerate-last title="Regenerate response" aria-label="Regenerate response"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M15.5 10a5.5 5.5 0 1 1-1.6-3.9M15.5 4.5v3h-3"/></svg></button>`
    : '';
  return `<article class="message message-${role}" data-message="${escapeHTML(key)}"><div class="message-avatar" aria-hidden="true">${role === 'user' ? 'U' : role === 'assistant' ? '' : '·'}</div><div class="message-main"><header class="message-header"><strong class="message-author">${title}</strong>${provider ? `<span class="message-provider">${escapeHTML(provider)}</span>` : ''}<time class="message-time" title="${escapeHTML(time)}">${escapeHTML(shortDate(time))}</time>${regenBtn}${copyBtn}${role === 'user' && selectedData?.task?.workspaceKind === 'conversation' && /^(objective|followup)-/.test(key) ? `<button type="button" class="button button-quiet edit-chat" data-edit-chat="${escapeHTML(key)}" aria-label="Edit or rewind this message">Edit / rewind</button>` : ''}</header>${['declined','partial'].includes(outcome?.kind) ? `<p class="reply-outcome" title="${outcome.source === 'text_heuristic' ? 'Detected from reply wording; no retry decision is made by this label.' : 'Reported by provider'}">${escapeHTML(outcome.label)}</p>` : ''}${thinkingHtml}${attachmentsHtml}<div class="message-body">${body}</div>${scorecard}${raw ? `<details class="message-raw" data-disclosure="raw-${escapeHTML(key)}" ${openDetails.has(`raw-${key}`) ? 'open' : ''}><summary>Response details</summary><pre tabindex="0" role="region" aria-label="Model response details">${escapeHTML(pretty(raw))}</pre></details>` : ''}</div></article>`;
}

function shortUrlLabel(rawUrl) {
  const s = String(rawUrl || '').trim();
  if (!s) return '';
  try {
    const u = new URL(s);
    const host = u.hostname.replace(/^www\./, '');
    const path = u.pathname && u.pathname !== '/' ? u.pathname : '';
    const full = `${host}${path}`;
    return full.length > 52 ? `${full.slice(0, 49)}…` : full;
  } catch {
    return s.length > 52 ? `${s.slice(0, 49)}…` : s;
  }
}

function formatCompactBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n >= 10240 ? 0 : 1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function humanizeToolStep(event) {
  const data = event?.data || {};
  const isErr = event?.type === 'tool.failed' || event?.type === 'model.error' || data?.ok === false || data?.status === 'failed' || data?.result?.ok === false;
  const isRun = event?.type?.endsWith('.started');
  const name = String(data.name || '');
  const args = data.args && typeof data.args === 'object' ? data.args : {};
  const res = data.result && typeof data.result === 'object' ? data.result : {};
  const durMs = Number(data.durationMs || res.durationMs || 0);
  const durBadge = durMs >= 1000 ? `${(durMs / 1000).toFixed(1)}s` : '';

  if (event?.type === 'evaluation.started') {
    return { verb: 'Verifying', target: 'workspace checks & tests', badge: '', badgeKind: 'accent', isErr: false };
  }
  if (event?.type === 'evaluation.completed') {
    const ok = data.status === 'pass';
    return {
      verb: ok ? 'Verified' : 'Check failed',
      target: data.summary || (ok ? 'All checks passed' : 'Verification failed'),
      badge: ok ? 'pass' : 'fail',
      badgeKind: ok ? 'ok' : 'err',
      isErr: !ok,
    };
  }
  if (event?.type === 'model.switched') {
    const toLabel = providerById(data.to)?.label || data.to || 'backup model';
    return { verb: 'Switched', target: toLabel, badge: data.reason || 'route', badgeKind: 'accent', isErr: false };
  }
  if (event?.type === 'routing.reframe_retry') {
    return { verb: 'Retried', target: 'Reframed approach', badge: 'retry', badgeKind: 'accent', isErr: false };
  }
  if (event?.type === 'subagent.started') {
    const role = data.role || 'sidecar';
    return { verb: 'Running', target: data.prompt ? `${role} · ${String(data.prompt).slice(0, 48)}` : `${role} sidecar`, badge: 'parallel', badgeKind: 'accent', isErr: false };
  }
  if (event?.type === 'subagent.completed') {
    const role = data.role || 'subagent';
    return { verb: 'Delegated', target: `${role} finished`, badge: data.calls ? `${data.calls} ${data.calls === 1 ? 'call' : 'calls'}` : '', badgeKind: 'accent', isErr: !data.ok };
  }

  const pickPath = () => String(res.path || args.path || args.file || args.target || '').replace(/^\.\//, '');
  const pickUrl = () => shortUrlLabel(res.finalUrl || res.url || args.url || '');

  switch (name) {
    case 'web.fetch': {
      const target = pickUrl() || 'web page';
      const size = formatCompactBytes(res.bytes || res.length || (typeof res.text === 'string' ? res.text.length : 0));
      const status = res.status && res.status !== 200 ? `HTTP ${res.status}` : '';
      return {
        verb: isRun ? 'Fetching' : (isErr ? 'Fetch failed' : 'Fetched'),
        target,
        badge: status || size || durBadge,
        badgeKind: isErr ? 'err' : 'muted',
        isErr,
      };
    }
    case 'web.search': {
      const q = String(args.query || res.query || '').trim();
      const count = Array.isArray(res.results) ? `${res.results.length} hits` : (res.count ? `${res.count} hits` : '');
      return {
        verb: isRun ? 'Searching' : 'Searched',
        target: q ? `“${q.slice(0, 48)}${q.length > 48 ? '…' : ''}”` : 'the web',
        badge: count || durBadge,
        badgeKind: isErr ? 'err' : 'muted',
        isErr,
      };
    }
    case 'repo.read': {
      const p = pickPath() || 'file';
      const lines = res.totalLines || res.lines || (args.startLine && args.endLine ? `L${args.startLine}-${args.endLine}` : '');
      return {
        verb: isRun ? 'Reading' : 'Read',
        target: p,
        badge: typeof lines === 'number' ? `${lines}L` : String(lines || ''),
        badgeKind: isErr ? 'err' : 'muted',
        isErr,
      };
    }
    case 'repo.list': {
      const dir = pickPath() || '.';
      const count = Array.isArray(res.files) ? `${res.files.length} files` : (res.count ? `${res.count} items` : '');
      return {
        verb: isRun ? 'Listing' : 'Listed',
        target: dir === '.' ? 'workspace files' : dir,
        badge: count,
        badgeKind: isErr ? 'err' : 'muted',
        isErr,
      };
    }
    case 'repo.search': {
      const q = String(args.query || args.pattern || '').trim();
      const hits = Array.isArray(res.matches) ? `${res.matches.length} matches` : (res.count ? `${res.count} matches` : '');
      return {
        verb: isRun ? 'Searching' : 'Searched',
        target: q ? `/${q.slice(0, 42)}/` : 'repository',
        badge: hits,
        badgeKind: isErr ? 'err' : 'muted',
        isErr,
      };
    }
    case 'repo.write':
    case 'repo.patch': {
      const p = pickPath() || 'file';
      const verb = name === 'repo.patch' ? (isRun ? 'Editing' : 'Edited') : (isRun ? 'Writing' : 'Wrote');
      const size = formatCompactBytes(res.bytes || (typeof args.content === 'string' ? args.content.length : 0));
      return { verb, target: p, badge: size || durBadge, badgeKind: isErr ? 'err' : 'ok', isErr };
    }
    case 'repo.delete': {
      return { verb: isRun ? 'Removing' : 'Removed', target: pickPath() || 'file', badge: '', badgeKind: isErr ? 'err' : 'muted', isErr };
    }
    case 'process.run': {
      const cmd = String(args.command || res.command || 'command').trim();
      const shortCmd = cmd.length > 52 ? `${cmd.slice(0, 49)}…` : cmd;
      const exitCode = res.exitCode ?? res.code;
      const badge = exitCode !== undefined && exitCode !== null
        ? (exitCode === 0 ? (durBadge || 'exit 0') : `exit ${exitCode}`)
        : durBadge;
      const failed = isErr || (typeof exitCode === 'number' && exitCode !== 0);
      return { verb: isRun ? 'Running' : 'Ran', target: shortCmd, badge, badgeKind: failed ? 'err' : 'ok', isErr: failed };
    }
    case 'git.status':
    case 'git.diff':
    case 'git.commit': {
      const sub = name.split('.')[1];
      const msg = String(args.message || res.message || '').trim();
      return {
        verb: isRun ? `Git ${sub}` : (sub === 'commit' ? 'Committed' : `Checked git ${sub}`),
        target: msg ? msg.slice(0, 48) : (pickPath() || 'repository'),
        badge: res.hash ? String(res.hash).slice(0, 7) : '',
        badgeKind: isErr ? 'err' : 'ok',
        isErr,
      };
    }
    default: {
      if (name.startsWith('browser.')) {
        const act = name.slice(8);
        const url = pickUrl();
        const label = args.selector || args.text || url || act;
        return {
          verb: isRun ? `Browser ${act}` : `Browser ${act}`,
          target: String(label).slice(0, 48),
          badge: durBadge,
          badgeKind: isErr ? 'err' : 'accent',
          isErr,
        };
      }
      const cleanName = name ? name.replace(/[._]/g, ' ') : (event?.type || 'step');
      const fallbackTarget = pickPath() || pickUrl() || String(args.query || data.message || '').slice(0, 48);
      return {
        verb: isRun ? 'Running' : (isErr ? 'Failed' : 'Completed'),
        target: fallbackTarget ? `${cleanName} · ${fallbackTarget}` : cleanName,
        badge: durBadge,
        badgeKind: isErr ? 'err' : 'muted',
        isErr,
      };
    }
  }
}

function conversationWork(events, openDetails) {
  if (!events.length) return '';
  const key = `work-${events[0].id ?? events[0].seq}`;
  const stepEvents = events.filter((event) => [
    'tool.completed', 'tool.failed', 'evaluation.completed', 'model.switched',
    'recovery.started', 'model.error', 'task.failed', 'task.cancelled', 'subagent.completed'
  ].includes(event.type));
  if (!stepEvents.length) return '';

  const toolDone = events.filter(e => e.type === 'tool.completed');
  const checks = events.filter(e => e.type === 'evaluation.completed').length;
  const recovery = events.some(e => e.type.startsWith('recovery.') || e.type === 'model.switched');
  const writes = toolDone.filter(e => ['repo.write', 'repo.patch', 'git.commit'].includes(e.data?.name));
  const writePaths = [...new Set(writes.map(e => e.data?.result?.path || e.data?.args?.path).filter(Boolean))];
  const reads = toolDone.filter(e => ['repo.read', 'repo.search', 'repo.list'].includes(e.data?.name));
  const fetches = toolDone.filter(e => ['web.fetch', 'web.search'].includes(e.data?.name));
  const commands = toolDone.filter(e => e.data?.name === 'process.run');
  const browserOps = toolDone.filter(e => String(e.data?.name || '').startsWith('browser.'));
  const commits = writes.filter(e => e.data?.name === 'git.commit' && e.data?.result?.committed);

  const parts = [];
  if (writePaths.length) parts.push(`${writePaths.length} ${writePaths.length === 1 ? 'file' : 'files'} edited`);
  if (reads.length) parts.push(`${reads.length} ${reads.length === 1 ? 'file' : 'files'} explored`);
  if (fetches.length) parts.push(`${fetches.length} ${fetches.length === 1 ? 'source' : 'sources'} fetched`);
  if (commands.length) parts.push(`${commands.length} ${commands.length === 1 ? 'command' : 'commands'}`);
  if (browserOps.length) parts.push(`${browserOps.length} browser ${browserOps.length === 1 ? 'step' : 'steps'}`);
  if (!parts.length && toolDone.length) parts.push(`${toolDone.length} ${toolDone.length === 1 ? 'step' : 'steps'}`);
  if (checks) parts.push(`${checks} ${checks === 1 ? 'check' : 'checks'}`);
  if (recovery) parts.push('recovered');
  const title = parts.slice(0, 3).join(' · ') || 'Agent activity';

  const outcome = [...events].reverse().find((event) => ['task.completed', 'task.failed', 'task.cancelled', 'evaluation.completed'].includes(event.type));
  const summary = outcome ? eventDescription(outcome)[0] : '';

  let fileChips = '';
  if (writePaths.length) {
    fileChips = `<div class="work-file-chips">${writePaths.map(p => {
      const name = p.split('/').pop();
      return `<button type="button" class="work-file-chip" data-view-change="${escapeHTML(p)}" title="${escapeHTML(p)}"><span class="work-file-chip-icon">M</span>${escapeHTML(name)}</button>`;
    }).join('')}${commits.length ? '<span class="work-commit-chip">committed</span>' : ''}</div>`;
  }

  const rowsHtml = stepEvents.map((event) => {
    const s = humanizeToolStep(event);
    const stepKey = `step-${event.id ?? event.seq}`;
    const dotCls = s.isErr ? 'is-err' : 'is-ok';
    const dotSym = s.isErr ? '!' : '✓';
    return `<details class="live-rail-step ${dotCls}" data-disclosure="${escapeHTML(stepKey)}" ${openDetails.has(stepKey) ? 'open' : ''}><summary class="live-rail-row"><span class="live-rail-dot ${dotCls}" aria-hidden="true">${dotSym}</span><span class="live-rail-verb">${escapeHTML(s.verb)}</span><span class="live-rail-target" title="${escapeHTML(s.target)}">${escapeHTML(s.target)}</span>${s.badge ? `<span class="live-rail-badge kind-${escapeHTML(s.badgeKind)}">${escapeHTML(s.badge)}</span>` : ''}</summary><pre class="live-rail-peek" tabindex="0" role="region" aria-label="Work step details">${escapeHTML(pretty(event.data ?? {}))}</pre></details>`;
  }).join('');

  return `<details class="work-group work-group-rail" data-disclosure="${escapeHTML(key)}" ${openDetails.has(key) ? 'open' : ''}><summary class="work-group-summary"><span class="work-group-title">${escapeHTML(title)}</span><span class="work-group-outcome">${escapeHTML(summary)}</span></summary>${fileChips}<div class="live-rail-list work-group-body">${rowsHtml}</div></details>`;
}

function renderTimeline(events, total, task) {
  const panel = $('#panel-timeline');
  const openDetails = new Set($$('details[open][data-disclosure]', panel).map((element) => element.dataset.disclosure));
  const codeBlockStates = new Map();
  panel.querySelectorAll('.message[data-message]').forEach(msgEl => {
    const mKey = msgEl.dataset.message;
    msgEl.querySelectorAll('.message-code-block').forEach((blk, idx) => {
      if (blk.querySelector('[data-collapse-code]')) {
        codeBlockStates.set(`${mKey}::${idx}`, blk.classList.contains('is-collapsed'));
      }
    });
  });
  const messages = [conversationMessage({ role: 'user', text: task.objective, time: task.createdAt, key: `objective-${task.id}`, attachments: task.attachments }, openDetails)];
  const followups = Array.isArray(task.followups) ? task.followups : [];
  const followupById = new Map(followups.map((followup) => [followup.id, followup]));
  const conversationEvents = events.flatMap(event => event.type === 'user.messages.applied'
    ? [event, ...(event.data?.ids || []).map(id => followupById.get(id)).filter(Boolean).map(followup => ({ type: 'user.message', time: followup.appliedAt, data: followup }))]
    : [event]);
  const visibleFollowups = new Set(conversationEvents.filter((event) => event.type === 'user.message').map((event) => event.data?.id));
  // A POST can return the updated task before polling returns its newer events.
  // Merge missing canonical messages by time so an older reply cannot appear to
  // answer a newly submitted instruction. Keep the existing ledger order intact.
  for (const followup of followups) {
    if (visibleFollowups.has(followup.id)) continue;
    const time = followup.appliedAt || followup.createdAt;
    const synthetic = { type: 'user.message', time, data: followup };
    const index = conversationEvents.findIndex((event) => Date.parse(event.time) > Date.parse(time));
    if (index < 0) conversationEvents.push(synthetic);
    else conversationEvents.splice(index, 0, synthetic);
  }
  const evLimit = selectedData?.displayLimits?.events || 200;
  if (task.conversationRevision) messages.push('<div class="history-notice">Rewound · earlier turns preserved in export.</div>');
  if (events.length >= evLimit && total > events.length) messages.push(`<div class="history-notice">Showing the latest ${events.length} of ${total} activity events. <a href="/api/tasks/${encodeURIComponent(task.id)}/export" download>Export full history</a></div>`);
  let work = [];
  let lastFlushedSeq = 0;
  const flush = () => {
    if (work.length) {
      const tailSeq = Number(work[work.length - 1]?.seq || 0);
      if (tailSeq > lastFlushedSeq) lastFlushedSeq = tailSeq;
      messages.push(conversationWork(work, openDetails));
      work = [];
    }
  };
  let lastAssistantEvent = null;
  const canRegen = task.workspaceKind === 'conversation' && !ACTIVE.has(task.status) && !task.draining && task.status !== 'cancelled' && !isCrewBusy(task);
  if (canRegen) {
    for (let idx = conversationEvents.length - 1; idx >= 0; idx--) {
      const ev = conversationEvents[idx];
      const txt = ev.data?.response?.text || ev.data?.text;
      if (ev.type === 'model.response' && !ev.data?.superseded && typeof txt === 'string' && txt.trim()) {
        lastAssistantEvent = ev;
        break;
      }
    }
  }
  const auditedDraftEvents = new Set();
  for (let idx = 0; idx < conversationEvents.length; idx++) {
    const ev = conversationEvents[idx];
    if (ev.type === 'overseer.audited' && ev.data?.verdict === 'needs_work') {
      for (let prev = idx - 1; prev >= 0; prev--) {
        if (conversationEvents[prev].type === 'model.response' && !conversationEvents[prev].data?.superseded) {
          auditedDraftEvents.add(conversationEvents[prev]);
          break;
        }
        if (conversationEvents[prev].type === 'user.message') break;
      }
    }
  }
  for (const event of conversationEvents) {
    const assistantText = event.data?.response?.text || (event.data?.response?.type === 'error' && event.data.replyOutcome ? event.data.response.message || event.data.replyOutcome.label : event.data?.text);
    if (event.type === 'user.message') {
      flush();
      const canonical = followupById.get(event.data?.id);
      messages.push(conversationMessage({ role: 'user', text: canonical?.message ?? event.data?.message ?? '', time: canonical?.createdAt ?? event.time, key: `followup-${event.data?.id ?? event.seq}`, attachments: canonical?.attachments || event.data?.attachments }, openDetails));
    } else if (event.type === 'code.intent') {
      flush();
      messages.push(conversationMessage({ role: 'user', text: event.data.message, time: event.time, key: 'code-' + event.seq }, openDetails));
    } else if (event.type.startsWith('code.')) {
      flush();
      const data = event.data;
      const summary = { 'code.attached': 'Attached ' + data.repository, 'code.build': data.valid + ' of ' + data.total + ' patches ready · ' + (data.objective || ''),
        'code.applied': 'Applied ' + data.provider + ' patch', 'code.checked': (data.cancelled ? 'Check cancelled' : data.timedOut ? 'Check timed out' : 'Check exited ' + data.exitCode) + ' · ' + (data.command || ''), 'code.removed': 'Worktree removed' };
      messages.push('<div class="code-receipt"><span class="brand-mark" aria-hidden="true"></span><strong class="wordmark" role="img" aria-label="GodCode">GODCODƎ</strong><span>' + escapeHTML(summary[event.type] || event.type) + '</span></div>');
    } else if (event.type === 'model.response' && !event.data?.superseded && typeof assistantText === 'string' && assistantText.trim()) {
      flush();
      const id = event.data.providerId;
      const provider = providerById(id);
      if (auditedDraftEvents.has(event)) {
        const draftKey = `audited-draft-${event.id ?? event.seq}`;
        messages.push(`<details class="overseer-audited-draft" data-disclosure="${escapeHTML(draftKey)}" ${openDetails.has(draftKey) ? 'open' : ''}><summary>Earlier draft sent back for revision by Overseer (${escapeHTML(provider ? provider.label : id || 'worker')})</summary><div class="overseer-audited-draft-body">${formatMessageBody(assistantText, true)}</div></details>`);
        continue;
      }
      const rawData = event === lastAssistantEvent ? { ...event.data, __isLatestRegeneratable: true } : event.data;
      messages.push(conversationMessage({ role: 'assistant', text: assistantText, time: event.time, provider: provider ? provider.label : id, key: `assistant-${event.id ?? event.seq}`, raw: rawData, outcome: event.data.replyOutcome, thinking: event.data.response?.thinking }, openDetails));
    } else if (event.type === 'router.selected' && event.data?.selected) {
      flush();
      const rd = event.data;
      const sel = rd.selected;
      const rKey = `router-${event.id ?? event.seq}`;
      const riskPct = Math.round((rd.refusalRisk || 0) * 100);
      const runners = Array.isArray(rd.runnerUps) ? rd.runnerUps : [];
      const mc = rd.metacognition;
      const mcHtml = mc ? `<div class="router-receipt-metacog"><div class="router-receipt-metacog-head"><strong>${escapeHTML(mc.title || '✦ Metacognition Brief')}</strong><span>${escapeHTML(`${mc.tier === 'forged' ? 'LLM Forged' : '0ms Smart'} · ${mc.modelFamily || 'auto'}`)}</span></div>${mc.intentLock ? `<p class="router-receipt-metacog-intent">${escapeHTML(mc.intentLock)}</p>` : ''}${Array.isArray(mc.rubric) && mc.rubric.length ? `<ul class="router-receipt-metacog-rubric">${mc.rubric.slice(0, 4).map(r => `<li>${escapeHTML(r)}</li>`).join('')}</ul>` : ''}</div>` : '';
      messages.push(`<details class="router-receipt" data-disclosure="${escapeHTML(rKey)}" ${openDetails.has(rKey) ? 'open' : ''}><summary><span class="router-receipt-badge">✦ Ultra-Plinian · ${escapeHTML(rd.domainLabel || rd.domain || 'auto')}${mc ? ` · ${mc.tier === 'forged' ? 'Forged' : 'Framed'}` : ''}</span><span class="router-receipt-summary">${escapeHTML(sel.label || rd.selectedId)}</span><span>Bench ${escapeHTML(sel.benchmarkPrior)} · Elo ${escapeHTML(sel.userElo)} · Comp ${escapeHTML(sel.compliance)}%${riskPct >= 40 ? ` · Risk ${riskPct}%` : ''}</span></summary><div class="router-receipt-body">${[sel, ...runners].map((r, idx) => `<div class="router-receipt-row"><strong>#${idx + 1} ${escapeHTML(r.label || r.id)}</strong><span>Score ${escapeHTML(r.totalScore)} · Bench ${escapeHTML(r.benchmarkPrior)} · Elo ${escapeHTML(r.userElo)} · Comp ${escapeHTML(r.compliance)}%</span></div>`).join('')}${mcHtml}</div></details>`);
    } else if (event.type === 'conclave.completed' && event.data) {
      flush();
      const cd = event.data;
      const cKey = `conclave-done-${event.id ?? event.seq}`;
      const entries = Array.isArray(cd.entries) ? cd.entries : [];
      const specNames = (cd.specialists || []).map(s => `${s.sigil || '✦'} ${s.name || s.slug}`).join(' · ');
      const bbHtml = entries.map(e => `<div class="conclave-bb-entry"><div class="conclave-bb-head"><strong>R${escapeHTML(e.round)} · ${escapeHTML(e.agentName || e.role)}</strong><span class="conclave-bb-kind">${escapeHTML(e.kind || 'finding')} · ${escapeHTML(e.modelLabel || 'Auto')}</span></div><p class="conclave-bb-excerpt">${escapeHTML(String(e.excerpt || '').slice(0, 600))}</p></div>`).join('');
      messages.push(`<details class="overseer-receipt conclave-verdict-receipt" data-disclosure="${escapeHTML(cKey)}" ${openDetails.has(cKey) ? 'open' : ''}><summary><span aria-hidden="true">✦</span><span class="overseer-receipt-title">Conclave · ${escapeHTML(cd.modeLabel || cd.mode || 'Council')} (${escapeHTML(cd.rounds || 2)} rounds)</span><span>${escapeHTML(specNames || `${entries.length} specialist contributions`)}${cd.durationMs ? ` · ${escapeHTML(duration(cd.durationMs))}` : ''}</span></summary><div class="overseer-receipt-body">${bbHtml || '<p class="field-help">No blackboard notes recorded.</p>'}</div></details>`);
    } else if (event.type === 'subagent.completed' && event.data?.ok && event.data?.summary) {
      flush();
      lastFlushedSeq = Math.max(lastFlushedSeq, Number(event.seq || 0));
      const sa = event.data;
      const key = `subagent-${event.id ?? event.seq}`;
      messages.push(`<details class="subagent-card" data-disclosure="${escapeHTML(key)}" ${openDetails.has(key) ? 'open' : ''}><summary class="subagent-card-summary"><span class="subagent-badge">${escapeHTML(sa.role || 'explore')}</span><span class="subagent-provider">${escapeHTML(providerById(sa.providerId)?.label || sa.providerId || 'model')}</span><span class="subagent-meta">${escapeHTML(`${sa.calls || 1} call${sa.calls === 1 ? '' : 's'} · ${duration(sa.durationMs || 0)}`)}</span></summary><div class="subagent-card-body">${formatMessageBody(sa.summary, true)}</div></details>`);
    } else if (['overseer.advised', 'overseer.audited', 'overseer.coached'].includes(event.type)) {
      flush();
      lastFlushedSeq = Math.max(lastFlushedSeq, Number(event.seq || 0));
      const description = eventDescription(event);
      const od = event.data || {};
      const oKey = `overseer-${event.id ?? event.seq}`;
      const guidance = od.guidance || '';
      const bullets = Array.isArray(od.nextActions) && od.nextActions.length
        ? od.nextActions
        : (Array.isArray(od.missingItems) && od.missingItems.length ? od.missingItems : []);
      if (guidance || bullets.length) {
        messages.push(`<details class="overseer-receipt" data-disclosure="${escapeHTML(oKey)}" ${openDetails.has(oKey) ? 'open' : ''}><summary><span aria-hidden="true">✦</span><span class="overseer-receipt-title">${escapeHTML(description[0])}</span><span>${escapeHTML(description[3])}</span></summary><div class="overseer-receipt-body">${guidance ? `<p class="overseer-receipt-guidance">${escapeHTML(guidance)}</p>` : ''}${bullets.length ? `<ul class="overseer-receipt-list">${bullets.slice(0, 6).map(item => `<li>${escapeHTML(item)}</li>`).join('')}</ul>` : ''}</div></details>`);
      } else {
        messages.push(`<div class="recovery-event"><span aria-hidden="true">✦</span><span><strong>${escapeHTML(description[0])}</strong> ${escapeHTML(description[3])}</span></div>`);
      }
    } else if (event.type === 'autotune.selected' && event.data) {
      flush();
      lastFlushedSeq = Math.max(lastFlushedSeq, Number(event.seq || 0));
      const at = event.data;
      const tTxt = at.applied?.temperature !== undefined ? `T=${at.applied.temperature}` : 'tuned';
      messages.push(`<div class="autotune-receipt"><span aria-hidden="true">◈</span><span><strong>HyperTuner</strong> · ${escapeHTML(at.profileLabel || at.profileId || 'Focused')} (${escapeHTML(tTxt)}) · ${escapeHTML(at.domain || 'general')} · ${escapeHTML(String(at.winRatePct ?? 0))}% win</span></div>`);
    } else if (['model.switched', 'providers.updated', 'routing.retry_scheduled', 'routing.strategy_changed', 'routing.profile_changed', 'routing.reframe_retry', 'overseer.judged', 'owner.refusal_reported', 'permission.auto_approved', 'hook.blocked', 'memory.auto_learned', 'skill.created'].includes(event.type)) {
      flush();
      lastFlushedSeq = Math.max(lastFlushedSeq, Number(event.seq || 0));
      const description = eventDescription(event);
      messages.push(`<div class="recovery-event"><span aria-hidden="true">↻</span><span><strong>${escapeHTML(description[0])}</strong> ${escapeHTML(description[3])}</span></div>`);
    } else work.push(event);
  }
  // When the task is actively running, keep the trailing work inside the unified Live Work Rail
  // instead of rendering a duplicate floating "18 tools used" box right above it!
  if (!ACTIVE.has(task.status)) flush();
  if (typeof renderConversationQueue === 'function') messages.push(renderConversationQueue(task));
  const visiblePartial = task.outcome?.kind === 'partial' && conversationEvents.findLast(e => e.type === 'model.response' && !e.data?.superseded)?.data?.replyOutcome?.kind === 'partial';
  if (task.blocker?.message && !visiblePartial && !ACTIVE.has(task.status) && !TERMINAL.has(task.status)) messages.push(conversationMessage({ role: 'system', text: task.outcome ? `${task.outcome.label}\n\n${task.outcome.detail}` : task.blocker.message, raw: task.outcome ? task.blocker : null, time: task.updatedAt, key: `blocker-${task.id}` }, openDetails));
  if (task.workingSummary) {
    const ws = task.workingSummary;
    const modCount = Array.isArray(ws.modifiedFiles) ? ws.modifiedFiles.length : 0;
    const compKey = `compact-${task.id}`;
    messages.push(`<details class="compact-summary-card" data-disclosure="${escapeHTML(compKey)}" ${openDetails.has(compKey) ? 'open' : ''}><summary><span class="compact-badge">Compacted</span><span>Fresh-eyes context summary${modCount ? ` · ${modCount} modified ${modCount === 1 ? 'file' : 'files'}` : ''}</span></summary><p class="compact-summary-note">${escapeHTML(ws.note || 'Earlier history summarized into fresh-eyes state to keep context crisp.')}</p></details>`);
  }
  if (ACTIVE.has(task.status)) {
    const lastUserIdx = events.findLastIndex(e => ['user.message', 'user.messages.applied', 'conversation.rewound'].includes(e.type));
    const lastUserSeq = lastUserIdx >= 0 ? Number(events[lastUserIdx]?.seq || 0) : 0;
    const minRailSeq = Math.max(lastUserSeq, lastFlushedSeq);
    const fullTurnEvents = lastUserIdx >= 0 ? events.slice(lastUserIdx + 1) : events;
    const turnSlice = fullTurnEvents.filter(e => Number(e.seq || 0) > minRailSeq);

    const recent = [...fullTurnEvents].reverse().find(e => ['model.request', 'tool.started', 'evaluation.started', 'routing.auto_continued'].includes(e.type));
    const activeProvLabel = providerById(task.providerId)?.label || task.providerId || '';
    const phase = task.answerRace
      ? (events.findLast(e => e.type === 'race.dispatched')?.data.stage === 'grade' ? 'Grading parallel drafts' : `Drafting with ${task.answerRace.models?.length || 2} Conclave writers`)
      : recent?.type === 'routing.auto_continued'
        ? 'Continuing output'
        : task.status === 'verifying'
          ? 'Verifying changes & tests'
          : streamToolName
            ? toolPhaseLabel(streamToolName).replace(/…$/, '')
            : recent?.type === 'tool.started'
              ? toolPhaseLabel(recent.data?.name || 'tool').replace(/…$/, '')
              : task.recoveries
                ? `Recovering · ${activeProvLabel}`
                : `Thinking${activeProvLabel ? ` · ${activeProvLabel}` : ''}`;

    // Note: pinned #todo-strip right above the composer already displays Plan progress; keep Live Rail focused on steps.
    const planHtml = '';

    const completedWorkerIds = new Set(events.filter(e => e.type === 'subagent.completed' && e.data?.workerId).map(e => e.data.workerId));
    const runningSidecars = events.filter(e => e.type === 'subagent.started' && e.data?.workerId && !completedWorkerIds.has(e.data.workerId));
    const lastEvalCompletedSeq = turnSlice.reduce((m, e) => e.type === 'evaluation.completed' ? Math.max(m, Number(e.seq || 0)) : m, 0);
    const allTurnSteps = turnSlice.filter(e => {
      if (e.type === 'evaluation.started') return Number(e.seq || 0) > lastEvalCompletedSeq;
      return ['tool.completed', 'tool.failed', 'evaluation.completed', 'model.switched', 'routing.reframe_retry', 'subagent.completed'].includes(e.type);
    });
    const finishedOpIds = new Set(
      turnSlice
        .filter(e => e.type === 'tool.completed' || e.type === 'tool.failed')
        .map(e => e.data?.operationId || e.data?.callId)
        .filter(Boolean)
    );
    const lastToolDoneSeq = turnSlice.reduce((m, e) => (e.type === 'tool.completed' || e.type === 'tool.failed') ? Math.max(m, Number(e.seq || 0)) : m, 0);
    const activeStarted = turnSlice.filter(e => {
      if (e.type !== 'tool.started') return false;
      const opId = e.data?.operationId || e.data?.callId;
      if (opId) return !finishedOpIds.has(opId);
      return Number(e.seq || 0) > lastToolDoneSeq;
    });
    const combinedSteps = [...allTurnSteps, ...runningSidecars, ...activeStarted];
    const olderSteps = combinedSteps.length > 6 ? combinedSteps.slice(0, -6) : [];
    const latestSteps = combinedSteps.slice(-6);
    const renderRailStep = (ev) => {
      const s = humanizeToolStep(ev);
      const isRun = ev.type.endsWith('.started');
      const stepKey = `step-${ev.id ?? ev.seq}`;
      const dotCls = isRun ? 'is-running' : (s.isErr ? 'is-err' : 'is-ok');
      const dotSym = isRun ? '◐' : (s.isErr ? '!' : '✓');
      return `<details class="live-rail-step ${dotCls}" data-disclosure="${escapeHTML(stepKey)}" ${openDetails.has(stepKey) ? 'open' : ''}><summary class="live-rail-row"><span class="live-rail-dot ${dotCls}" aria-hidden="true">${dotSym}</span><span class="live-rail-verb">${escapeHTML(s.verb)}</span><span class="live-rail-target" title="${escapeHTML(s.target)}">${escapeHTML(s.target)}</span>${s.badge ? `<span class="live-rail-badge kind-${escapeHTML(s.badgeKind)}">${escapeHTML(s.badge)}</span>` : ''}</summary><pre class="live-rail-peek" tabindex="0" role="region" aria-label="Step details">${escapeHTML(pretty(ev.data ?? {}))}</pre></details>`;
    };
    const olderKey = `live-older-${task.id}`;
    const olderHtml = olderSteps.length
      ? `<details class="live-rail-older" data-disclosure="${escapeHTML(olderKey)}" ${openDetails.has(olderKey) ? 'open' : ''}><summary class="live-rail-older-summary">${olderSteps.length} earlier ${olderSteps.length === 1 ? 'step' : 'steps'}</summary><div class="live-rail-older-body">${olderSteps.map(renderRailStep).join('')}</div></details>`
      : '';
    const trailHtml = combinedSteps.length
      ? `<div class="live-rail-list">${olderHtml}${latestSteps.map(renderRailStep).join('')}</div>`
      : '';

    const thoughtSnippet = streamTaskId === task.id && streamThinking
      ? streamThinking.trim().split('\n').filter(Boolean).slice(-2).join(' ').slice(-180)
      : '';
    const thoughtTickerHtml = thoughtSnippet
      ? `<div class="live-rail-thought" id="live-rail-thought">${escapeHTML(thoughtSnippet)}</div>`
      : '<div class="live-rail-thought hidden" id="live-rail-thought"></div>';

    const stepCountChip = combinedSteps.length ? `<span class="live-rail-count">${combinedSteps.length} ${combinedSteps.length === 1 ? 'step' : 'steps'}</span>` : '';
    const parsedTurnStart = fullTurnEvents[0]?.time ? Date.parse(fullTurnEvents[0].time) : NaN;
    const parsedUpdated = task.updatedAt ? Date.parse(task.updatedAt) : NaN;
    const turnAnchorTime = Number.isFinite(parsedTurnStart) ? parsedTurnStart : (streamTurnStartedAt || (Number.isFinite(parsedUpdated) ? parsedUpdated : Date.now()));
    const elapsedSec = Math.max(0, Math.floor((Date.now() - turnAnchorTime) / 1000));
    const elapsedLabel = elapsedSec >= 60 ? `${Math.floor(elapsedSec / 60)}m ${elapsedSec % 60}s` : `${elapsedSec}s`;
    messages.push(`<section class="live-work-rail" aria-label="Active agent progress"><div class="live-work-head"><span class="spinner" aria-hidden="true"></span><span class="activity-label"><span class="activity-phase-text is-shimmer">${escapeHTML(phase)}</span></span><div class="live-rail-head-right">${stepCountChip}<span class="live-work-elapsed" data-turn-started="${escapeHTML(String(turnAnchorTime))}">${escapeHTML(elapsedLabel)}</span><button type="button" class="button button-quiet live-viz-btn" data-open-visualizer="1" title="Generate a live visual dashboard for what the agent is doing (/visualize)"><span aria-hidden="true">◈</span><span>Visualize</span></button></div></div>${thoughtTickerHtml}${planHtml}${trailHtml}</section><div id="stream-slot">${streamTaskId === task.id ? buildStreamPreviewHtml(openDetails) : ''}</div>`);
  } else if (task.draining) messages.push('<div class="conversation-state">Stopping the previous request…</div>');
  else if (task.status === 'waiting_input' && task.workspaceKind !== 'conversation' && task.followups?.length) messages.push('<div class="conversation-state">Ready for review · checks pending.</div>');
  const lastReplyEvent = conversationEvents.findLast(e => e.type === 'model.response' && !e.data?.superseded && typeof (e.data?.response?.text || e.data?.text) === 'string');
  if (lastReplyEvent && !ACTIVE.has(task.status) && !task.draining && task.status !== 'cancelled') {
    const replyProv = lastReplyEvent.data?.providerId || task.providerId;
    const replyLabel = providerById(replyProv)?.label || replyProv || 'model';
    const showKeepRolling = task.status === 'waiting_input' && (task.blocker?.code === 'VENICE_OUTPUT_LIMIT' || task.outcome?.kind === 'partial');
    messages.push(`<div class="report-refusal-bar">${showKeepRolling ? `<button type="button" class="button button-primary report-refusal-btn" data-continue-output="${escapeHTML(task.id)}" title="Continue seamlessly from where the output stopped">Keep rolling →</button>` : ''}${replyProv ? `<button type="button" class="button button-quiet report-refusal-btn" data-model-pref="pin" data-pref-id="${escapeHTML(replyProv)}" title="Pin ${escapeHTML(replyLabel)} higher in your waterfall">★ Prefer</button><button type="button" class="button button-quiet report-refusal-btn" data-model-pref="demote" data-pref-id="${escapeHTML(replyProv)}" title="Demote ${escapeHTML(replyLabel)} lower in your waterfall">⊘ Demote</button>` : ''}<button type="button" class="button button-quiet report-refusal-btn" data-report-refusal="${escapeHTML(task.id)}" title="Flag the last reply as a missed refusal to trigger G0DM0D3 retry/switch and train local refusal detection">↻ Missed refusal? Retry / Switch</button></div>`);
  }
  panel.innerHTML = `<div class="conversation">${messages.join('')}</div>`;
  if (codeBlockStates.size) {
    panel.querySelectorAll('.message[data-message]').forEach(msgEl => {
      const mKey = msgEl.dataset.message;
      msgEl.querySelectorAll('.message-code-block').forEach((blk, idx) => {
        const key = `${mKey}::${idx}`;
        if (!codeBlockStates.has(key)) return;
        const shouldCollapse = codeBlockStates.get(key);
        blk.classList.toggle('is-collapsed', shouldCollapse);
        const btn = blk.querySelector('[data-collapse-code]');
        if (btn) {
          btn.setAttribute('aria-expanded', String(!shouldCollapse));
          btn.textContent = shouldCollapse ? 'Expand' : 'Collapse';
        }
      });
    });
  }
  const knownFiles = new Set((selectedData?.files || []).map(f => f.path));
  if (knownFiles.size) {
    panel.querySelectorAll('.message-assistant .message-body :not(pre) > code').forEach(codeEl => {
      const raw = codeEl.textContent.trim();
      const cleaned = raw.replace(/^\.\//, '');
      const basePath = cleaned.replace(/:L?\d+(?:[-–]L?\d+)?$/, '');
      if (knownFiles.has(basePath)) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'inline-file-link';
        btn.dataset.openWorkspaceFile = basePath;
        btn.title = `Open ${basePath} in Files`;
        btn.textContent = raw;
        codeEl.replaceWith(btn);
      }
    });
  }
}

function computeHunks(beforeText, afterText, context = 3) {
  if (beforeText == null && afterText == null) return [];
  if (beforeText == null) return [{ oldStart: 0, newStart: 1, lines: afterText.split('\n').map((t, i) => ({ type: 'add', text: t, newLine: i + 1 })) }];
  if (afterText == null) return [{ oldStart: 1, newStart: 0, lines: beforeText.split('\n').map((t, i) => ({ type: 'remove', text: t, oldLine: i + 1 })) }];
  const a = beforeText.split('\n'), b = afterText.split('\n');
  if (a.length * b.length > 800000) return null;
  const m = a.length, n = b.length;
  const dp = new Uint16Array((m + 1) * (n + 1));
  for (let i = m - 1; i >= 0; i--)
    for (let j = n - 1; j >= 0; j--)
      dp[i * (n + 1) + j] = a[i] === b[j] ? dp[(i + 1) * (n + 1) + j + 1] + 1 : Math.max(dp[(i + 1) * (n + 1) + j], dp[i * (n + 1) + j + 1]);
  const ops = [];
  let i = 0, j = 0;
  while (i < m || j < n) {
    if (i < m && j < n && a[i] === b[j]) { ops.push({ type: 'equal', text: a[i], oldLine: i + 1, newLine: j + 1 }); i++; j++; }
    else if (j < n && (i >= m || dp[i * (n + 1) + j + 1] >= dp[(i + 1) * (n + 1) + j])) { ops.push({ type: 'add', text: b[j], newLine: j + 1 }); j++; }
    else { ops.push({ type: 'remove', text: a[i], oldLine: i + 1 }); i++; }
  }
  const hunks = [];
  let hi = -1, lastChange = -1;
  for (let k = 0; k < ops.length; k++) {
    if (ops[k].type !== 'equal') {
      if (hi < 0 || k - lastChange > context * 2 + 1) {
        hunks.push({ lines: [], oldStart: ops[k].oldLine || (ops[k - 1]?.oldLine ?? 1), newStart: ops[k].newLine || (ops[k - 1]?.newLine ?? 1) });
        hi = hunks.length - 1;
        for (let c = Math.max(0, k - context); c < k; c++) hunks[hi].lines.push(ops[c]);
      } else { for (let c = lastChange + 1; c < k; c++) hunks[hi].lines.push(ops[c]); }
      hunks[hi].lines.push(ops[k]);
      lastChange = k;
    }
  }
  for (const hunk of hunks) {
    const li = hunk.lines.at(-1);
    const afterIdx = ops.indexOf(li);
    for (let c = afterIdx + 1; c < Math.min(ops.length, afterIdx + 1 + context); c++) if (ops[c].type === 'equal') hunk.lines.push(ops[c]); else break;
  }
  return hunks;
}

function reconstructFileWithHunkAction(beforeText, afterText, targetHunkIndex, action) {
  const hunks = computeHunks(beforeText, afterText);
  if (!hunks || targetHunkIndex < 0 || targetHunkIndex >= hunks.length) return null;
  const a = beforeText.split('\n'), b = afterText.split('\n');
  const m = a.length, n = b.length;
  const dp = new Uint16Array((m + 1) * (n + 1));
  for (let i = m - 1; i >= 0; i--)
    for (let j = n - 1; j >= 0; j--)
      dp[i * (n + 1) + j] = a[i] === b[j] ? dp[(i + 1) * (n + 1) + j + 1] + 1 : Math.max(dp[(i + 1) * (n + 1) + j], dp[i * (n + 1) + j + 1]);
  const ops = [];
  let i = 0, j = 0;
  while (i < m || j < n) {
    if (i < m && j < n && a[i] === b[j]) { ops.push({ type: 'equal', text: a[i], oldLine: i + 1, newLine: j + 1 }); i++; j++; }
    else if (j < n && (i >= m || dp[i * (n + 1) + j + 1] >= dp[(i + 1) * (n + 1) + j])) { ops.push({ type: 'add', text: b[j], newLine: j + 1 }); j++; }
    else { ops.push({ type: 'remove', text: a[i], oldLine: i + 1 }); i++; }
  }
  const hunkLineSets = [];
  let hi = -1, lastChange = -1;
  for (let k = 0; k < ops.length; k++) {
    if (ops[k].type !== 'equal') {
      if (hi < 0 || k - lastChange > 7) { hunkLineSets.push(new Set()); hi = hunkLineSets.length - 1; }
      hunkLineSets[hi].add(k);
      lastChange = k;
    }
  }
  const targetSet = hunkLineSets[targetHunkIndex] || new Set();
  const result = [];
  for (let k = 0; k < ops.length; k++) {
    const inTarget = targetSet.has(k);
    if (ops[k].type === 'equal') { result.push(ops[k].text); }
    else if (ops[k].type === 'add') {
      if (inTarget) { if (action === 'accept') result.push(ops[k].text); }
      else result.push(ops[k].text);
    } else {
      if (inTarget) { if (action === 'reject') result.push(ops[k].text); }
    }
  }
  return result.join('\n');
}

let diffViewMode = 'unified';
try { const savedDiffMode = localStorage.getItem('g0dc0d3.diffViewMode'); if (savedDiffMode === 'split' || savedDiffMode === 'unified') diffViewMode = savedDiffMode; } catch {}
let diffCommentTarget = null;

function diffLanguageForPath(filePath) {
  const base = String(filePath || '').split('/').pop().toLowerCase();
  if (base === 'dockerfile') return 'dockerfile';
  if (base === 'makefile') return 'makefile';
  if (base === 'cmakelists.txt') return 'cmake';
  if (base.startsWith('.env')) return 'env';
  const ext = base.includes('.') ? base.split('.').pop() : '';
  return typeof normalizeCodeLanguage === 'function' ? normalizeCodeLanguage(ext) : ext;
}

function computeIntralineDiff(oldText, newText) {
  if (oldText == null || newText == null || oldText === newText) return null;
  if (oldText.length > 600 || newText.length > 600) return null;
  const tok = s => s.match(/\w+|\s+|[^\w\s]+/g) || [];
  const a = tok(oldText), b = tok(newText);
  if (a.length * b.length > 16000) return null;
  const m = a.length, n = b.length;
  const dp = new Uint16Array((m + 1) * (n + 1));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i * (n + 1) + j] = a[i] === b[j]
        ? dp[(i + 1) * (n + 1) + j + 1] + 1
        : Math.max(dp[(i + 1) * (n + 1) + j], dp[i * (n + 1) + j + 1]);
    }
  }
  let i = 0, j = 0, oldHtml = '', newHtml = '', common = 0;
  while (i < m || j < n) {
    if (i < m && j < n && a[i] === b[j]) {
      const esc = escapeHTML(a[i]);
      oldHtml += esc;
      newHtml += esc;
      common += a[i].length;
      i++; j++;
    } else if (j < n && (i >= m || dp[i * (n + 1) + j + 1] >= dp[(i + 1) * (n + 1) + j])) {
      newHtml += `<mark class="diff-word-add">${escapeHTML(b[j])}</mark>`;
      j++;
    } else {
      oldHtml += `<mark class="diff-word-del">${escapeHTML(a[i])}</mark>`;
      i++;
    }
  }
  if (common < Math.min(oldText.length, newText.length) * 0.2) return null;
  return { oldHtml: oldHtml || ' ', newHtml: newHtml || ' ' };
}

function pairHunkLines(lines) {
  const rows = [];
  for (let i = 0; i < lines.length;) {
    if (lines[i].type === 'equal') {
      rows.push({ kind: 'equal', left: lines[i], right: lines[i] });
      i++;
      continue;
    }
    const dels = [], adds = [];
    while (i < lines.length && lines[i].type !== 'equal') {
      if (lines[i].type === 'remove') dels.push(lines[i]);
      else adds.push(lines[i]);
      i++;
    }
    const count = Math.max(dels.length, adds.length);
    for (let k = 0; k < count; k++) {
      const left = dels[k] || null;
      const right = adds[k] || null;
      const intra = left && right ? computeIntralineDiff(left.text, right.text) : null;
      rows.push({ kind: 'change', left, right, intra });
    }
  }
  return rows;
}

function renderDiffLineCode(text, lang, intraHtml) {
  if (intraHtml) return intraHtml;
  if (typeof highlightCodeLine === 'function' && lang) return highlightCodeLine(text, lang);
  return escapeHTML(text) || ' ';
}

const reviewedHunks = new Set();

function renderInlineCommentBox(filePath, lineNum, side = 'new') {
  if (!diffCommentTarget || diffCommentTarget.path !== filePath || diffCommentTarget.line !== lineNum) return '';
  if (diffCommentTarget.side && diffCommentTarget.side !== side) return '';
  return `<form class="diff-comment-box" data-diff-comment-form data-comment-path="${escapeHTML(filePath)}" data-comment-line="${lineNum}" autocomplete="off"><span class="diff-comment-ref">@${escapeHTML(filePath)}:L${lineNum}</span><input type="text" class="diff-comment-input" name="note" maxlength="1000" placeholder="Add review feedback for line ${lineNum}…" aria-label="Review comment for ${escapeHTML(filePath)} line ${lineNum}" required><button type="submit" class="button button-primary">Send to composer</button><button type="button" class="button button-quiet" data-diff-comment-cancel>Cancel</button></form>`;
}

function renderUnifiedDiff(hunks, file) {
  if (file.binary) return `<div class="diff-empty">Binary file changed${file.beforeBytes != null || file.afterBytes != null ? ` (${file.beforeBytes != null ? `${file.beforeBytes.toLocaleString()} B` : 'new'} → ${file.afterBytes != null ? `${file.afterBytes.toLocaleString()} B` : 'deleted'})` : ''}.</div>`;
  if (!hunks || !hunks.length) return `<div class="diff-empty">No differences</div>`;
  const canEdit = selectedData?.task && !ACTIVE.has(selectedData.task.status) && !selectedData.task.draining;
  const lang = diffLanguageForPath(file.path);
  return hunks.map((hunk, idx) => {
    const oldCount = hunk.lines.filter(l => l.type !== 'add').length;
    const newCount = hunk.lines.filter(l => l.type !== 'remove').length;
    const isReviewed = reviewedHunks.has(`${selectedId}:${file.path}:${idx}`);
    const buttons = canEdit && hunks.length > 0 ? `<span class="hunk-actions"><button type="button" class="hunk-btn hunk-accept" data-hunk-index="${idx}" data-hunk-action="accept" data-hunk-path="${escapeHTML(file.path)}" aria-pressed="${isReviewed ? 'true' : 'false'}" title="Accept this change">&#10003;</button><button type="button" class="hunk-btn hunk-reject" data-hunk-index="${idx}" data-hunk-action="reject" data-hunk-path="${escapeHTML(file.path)}" title="Reject this change">&#10005;</button></span>` : '';
    const paired = pairHunkLines(hunk.lines);
    const body = paired.map(row => {
      if (row.kind === 'equal') {
        const line = row.left;
        const lineNum = line.newLine ?? line.oldLine;
        return `<div class="diff-line diff-equal"><span class="diff-ln">${line.oldLine}</span><span class="diff-ln">${line.newLine}</span><button type="button" class="diff-comment-trigger" data-diff-comment data-comment-path="${escapeHTML(file.path)}" data-comment-line="${lineNum}" data-comment-side="new" title="Comment on line ${lineNum}" aria-label="Comment on line ${lineNum}">+</button><span class="diff-prefix"> </span><span class="diff-text hljs">${renderDiffLineCode(line.text, lang, null)}</span></div>${renderInlineCommentBox(file.path, lineNum, 'new')}`;
      }
      let html = '';
      if (row.left) {
        const lineNum = row.left.oldLine;
        html += `<div class="diff-line diff-remove"><span class="diff-ln">${row.left.oldLine}</span><span class="diff-ln"></span><button type="button" class="diff-comment-trigger" data-diff-comment data-comment-path="${escapeHTML(file.path)}" data-comment-line="${lineNum}" data-comment-side="old" title="Comment on line ${lineNum}" aria-label="Comment on line ${lineNum}">+</button><span class="diff-prefix">-</span><span class="diff-text hljs">${renderDiffLineCode(row.left.text, lang, row.intra?.oldHtml)}</span></div>${renderInlineCommentBox(file.path, lineNum, 'old')}`;
      }
      if (row.right) {
        const lineNum = row.right.newLine;
        html += `<div class="diff-line diff-add"><span class="diff-ln"></span><span class="diff-ln">${row.right.newLine}</span><button type="button" class="diff-comment-trigger" data-diff-comment data-comment-path="${escapeHTML(file.path)}" data-comment-line="${lineNum}" data-comment-side="new" title="Comment on line ${lineNum}" aria-label="Comment on line ${lineNum}">+</button><span class="diff-prefix">+</span><span class="diff-text hljs">${renderDiffLineCode(row.right.text, lang, row.intra?.newHtml)}</span></div>${renderInlineCommentBox(file.path, lineNum, 'new')}`;
      }
      return html;
    }).join('');
    return `<div class="diff-hunk${isReviewed ? ' is-reviewed' : ''}"><div class="diff-hunk-header"><span>@@ -${hunk.oldStart},${oldCount} +${hunk.newStart},${newCount} @@</span>${buttons}</div>${body}</div>`;
  }).join('');
}

function renderSplitDiff(hunks, file) {
  if (file.binary) return `<div class="diff-empty">Binary file changed${file.beforeBytes != null || file.afterBytes != null ? ` (${file.beforeBytes != null ? `${file.beforeBytes.toLocaleString()} B` : 'new'} → ${file.afterBytes != null ? `${file.afterBytes.toLocaleString()} B` : 'deleted'})` : ''}.</div>`;
  if (!hunks || !hunks.length) return `<div class="diff-empty">No differences</div>`;
  const canEdit = selectedData?.task && !ACTIVE.has(selectedData.task.status) && !selectedData.task.draining;
  const lang = diffLanguageForPath(file.path);
  return hunks.map((hunk, idx) => {
    const oldCount = hunk.lines.filter(l => l.type !== 'add').length;
    const newCount = hunk.lines.filter(l => l.type !== 'remove').length;
    const isReviewed = reviewedHunks.has(`${selectedId}:${file.path}:${idx}`);
    const buttons = canEdit && hunks.length > 0 ? `<span class="hunk-actions"><button type="button" class="hunk-btn hunk-accept" data-hunk-index="${idx}" data-hunk-action="accept" data-hunk-path="${escapeHTML(file.path)}" aria-pressed="${isReviewed ? 'true' : 'false'}" title="Accept this change">&#10003;</button><button type="button" class="hunk-btn hunk-reject" data-hunk-index="${idx}" data-hunk-action="reject" data-hunk-path="${escapeHTML(file.path)}" title="Reject this change">&#10005;</button></span>` : '';
    const rows = pairHunkLines(hunk.lines).map(row => {
      const leftCls = row.left ? (row.kind === 'equal' ? 'diff-equal' : 'diff-remove') : 'diff-pad';
      const rightCls = row.right ? (row.kind === 'equal' ? 'diff-equal' : 'diff-add') : 'diff-pad';
      const leftHtml = row.left ? renderDiffLineCode(row.left.text, lang, row.intra?.oldHtml) : ' ';
      const rightHtml = row.right ? renderDiffLineCode(row.right.text, lang, row.intra?.newHtml) : ' ';
      const commentLine = row.right?.newLine ?? row.left?.oldLine ?? 1;
      const commentSide = row.right ? 'new' : 'old';
      return `<div class="diff-split-row"><div class="diff-split-cell ${leftCls}"><span class="diff-ln">${row.left?.oldLine ?? ''}</span><span class="diff-prefix">${row.left ? (row.kind === 'equal' ? ' ' : '-') : ''}</span><span class="diff-text hljs">${leftHtml}</span></div><div class="diff-split-cell ${rightCls}"><span class="diff-ln">${row.right?.newLine ?? ''}</span><button type="button" class="diff-comment-trigger" data-diff-comment data-comment-path="${escapeHTML(file.path)}" data-comment-line="${commentLine}" data-comment-side="${commentSide}" title="Comment on line ${commentLine}" aria-label="Comment on line ${commentLine}">+</button><span class="diff-prefix">${row.right ? (row.kind === 'equal' ? ' ' : '+') : ''}</span><span class="diff-text hljs">${rightHtml}</span></div></div>${renderInlineCommentBox(file.path, commentLine, commentSide)}`;
    }).join('');
    return `<div class="diff-hunk${isReviewed ? ' is-reviewed' : ''}"><div class="diff-hunk-header"><span>@@ -${hunk.oldStart},${oldCount} +${hunk.newStart},${newCount} @@</span>${buttons}</div><div class="diff-split-table">${rows}</div></div>`;
  }).join('');
}

function diffFileStats(item) {
  const hunks = computeHunks(item.before, item.after);
  if (hunks) {
    const added = hunks.reduce((n, h) => n + h.lines.filter(l => l.type === 'add').length, 0);
    const removed = hunks.reduce((n, h) => n + h.lines.filter(l => l.type === 'remove').length, 0);
    return { hunks, added, removed };
  }
  const beforeLines = item.before == null ? 0 : item.before.split('\n').length;
  const afterLines = item.after == null ? 0 : item.after.split('\n').length;
  return { hunks: null, added: Math.max(0, afterLines - beforeLines), removed: Math.max(0, beforeLines - afterLines) };
}

let diffFileFilter = '';

function formatPrSummaryMarkdown(task, diff, statsByPath) {
  const title = task?.title || 'Code changes';
  const totalAdded = diff.reduce((n, item) => n + (statsByPath.get(item.path)?.added || 0), 0);
  const totalRemoved = diff.reduce((n, item) => n + (statsByPath.get(item.path)?.removed || 0), 0);
  const lines = [
    `## ${title}`,
    '',
    task?.objective ? `> ${String(task.objective).replace(/\s+/g, ' ').trim().slice(0, 400)}` : '',
    '',
    `### Changed files (${diff.length} ${diff.length === 1 ? 'file' : 'files'}, +${totalAdded} / -${totalRemoved})`,
    ...diff.map(item => {
      const tag = item.before == null ? 'Added' : item.after == null ? 'Deleted' : 'Modified';
      const st = statsByPath.get(item.path) || { added: 0, removed: 0 };
      return `- \`${item.path}\` (${tag}: +${st.added} / -${st.removed})`;
    }),
  ].filter((line, idx, arr) => !(line === '' && arr[idx - 1] === ''));
  if (task?.verification?.checks?.length) {
    lines.push('', '### Verification');
    for (const c of task.verification.checks) {
      lines.push(`- ${c.status === 'pass' ? '✅' : c.status === 'fail' ? '❌' : '⚪'} ${c.name}${c.detail ? ` — ${String(c.detail).slice(0, 160)}` : ''}`);
    }
  }
  return lines.join('\n');
}

function renderChanges(diff) {
  const panel = $('#panel-changes'), task = selectedData?.task;
  const sourceControls = renderSourceControls(task);
  if (!diff.some(file => file.path === changeSelections.get(selectedId))) changeSelections.set(selectedId, diff[0]?.path);
  const signature = JSON.stringify([selectedId, diff, task?.status, task?.draining, sourceControls, changeSelections.get(selectedId), commitFormOpen, commitBusy, diffViewMode, diffCommentTarget, diffFileFilter]);
  if (signature === changesSignature) return;
  changesSignature = signature;
  const settled = task && !ACTIVE.has(task.status) && !task.draining;
  if (!diff.length) {
    const emptyActions = task
      ? `<div class="changes-empty-actions"><button type="button" class="button button-secondary copy-transcript-btn" data-copy-transcript>Copy transcript</button></div>`
      : '';
    panel.innerHTML = sourceControls + `<div class="panel-empty"><div><h3>No changes yet</h3><p>Edits will appear here for review.</p>${emptyActions}</div></div>`;
    return;
  }
  const statsByPath = new Map();
  let totalAdded = 0, totalRemoved = 0;
  for (const item of diff) {
    const info = diffFileStats(item);
    statsByPath.set(item.path, info);
    totalAdded += info.added;
    totalRemoved += info.removed;
  }
  const file = diff.find(file => file.path === changeSelections.get(selectedId));
  const selectedStats = statsByPath.get(file.path) || { hunks: null, added: 0, removed: 0 };
  const hunks = selectedStats.hunks;
  const fileLabel = file.before == null ? 'Added' : file.after == null ? 'Deleted' : 'Modified';
  const totalStatsHtml = `<span class="diff-stat-add">+${totalAdded}</span><span class="diff-stat-remove">-${totalRemoved}</span>`;
  const fileStatsHtml = `<span class="diff-stat-add">+${selectedStats.added}</span><span class="diff-stat-remove">-${selectedStats.removed}</span>`;
  const filterQuery = diffFileFilter.trim().toLowerCase();
  const visibleDiff = filterQuery ? diff.filter(item => item.path.toLowerCase().includes(filterQuery)) : diff;
  const filterInputHtml = diff.length >= 5
    ? `<input type="search" class="diff-file-filter" data-diff-file-filter value="${escapeHTML(diffFileFilter)}" placeholder="Filter ${diff.length} files…" aria-label="Filter changed files" autocomplete="off" spellcheck="false">`
    : '';
  const fileListHtml = filterInputHtml + (visibleDiff.length
    ? visibleDiff.map(item => {
        const label = item.before == null ? 'A' : item.after == null ? 'D' : 'M';
        const cls = item.before == null ? 'added' : item.after == null ? 'deleted' : 'modified';
        const st = statsByPath.get(item.path) || { added: 0, removed: 0 };
        return `<button type="button" class="diff-file-item ${item.path === file.path ? 'selected' : ''}" data-select-diff="${escapeHTML(item.path)}" title="${escapeHTML(item.path)} (+${st.added} -${st.removed})"><span class="diff-file-badge ${cls}">${label}</span><span class="diff-file-name">${escapeHTML(item.path)}</span><span class="diff-file-stats"><span class="diff-stat-add">+${st.added}</span><span class="diff-stat-remove">-${st.removed}</span></span></button>`;
      }).join('')
    : '<p class="field-help">No files match filter.</p>');
  const patchActions = settled
    ? `<div class="changes-actions"><button type="button" class="button button-secondary" data-commit-toggle ${commitBusy ? 'disabled' : ''}>Commit</button><button type="button" class="button button-secondary copy-pr-btn" data-copy-pr-summary title="Copy GitHub PR summary markdown">Copy PR summary</button><button type="button" class="button button-secondary copy-transcript-btn" data-copy-transcript>Copy transcript</button><button type="button" class="button button-secondary copy-patch-btn" data-copy-patch>Copy patch</button><a class="button button-secondary" href="/api/tasks/${encodeURIComponent(task.id)}/patch" download>Export patch</a></div>`
    : `<div class="changes-actions"><button type="button" class="button button-secondary copy-transcript-btn" data-copy-transcript>Copy transcript</button></div>`;
  const commitBar = settled && commitFormOpen
    ? `<form class="changes-commit-bar" id="changes-commit-form" autocomplete="off"><input id="changes-commit-message" type="text" maxlength="500" placeholder="Checkpoint commit message (default: checkpoint)" aria-label="Checkpoint commit message"><button type="submit" class="button button-primary" ${commitBusy ? 'disabled' : ''}>${commitBusy ? 'Committing…' : 'Save checkpoint'}</button><button type="button" class="button button-quiet" data-commit-cancel ${commitBusy ? 'disabled' : ''}>Cancel</button></form>`
    : '';
  const diffModeSwitch = `<span class="diff-mode-switch" role="group" aria-label="Diff view mode"><button type="button" class="diff-mode-btn ${diffViewMode === 'unified' ? 'active' : ''}" data-diff-view-mode="unified" aria-pressed="${diffViewMode === 'unified'}">Unified</button><button type="button" class="diff-mode-btn ${diffViewMode === 'split' ? 'active' : ''}" data-diff-view-mode="split" aria-pressed="${diffViewMode === 'split'}">Split</button></span>`;
  const prevViewerScroll = $('.diff-viewer', panel)?.scrollTop || 0;
  const prevListScroll = $('.diff-file-list', panel)?.scrollTop || 0;
  const prevCommitDraft = $('#changes-commit-message', panel)?.value ?? null;
  const prevCommentDraft = $('.diff-comment-input', panel)?.value ?? null;
  const renderedDiff = hunks ? (diffViewMode === 'split' ? renderSplitDiff(hunks, file) : renderUnifiedDiff(hunks, file)) : (file.binary ? renderUnifiedDiff([], file) : `<div class="diff-grid"><div class="diff-side before"><div class="diff-label">Before</div><pre tabindex="0">${escapeHTML(file.before ?? 'File did not exist')}</pre></div><div class="diff-side after"><div class="diff-label">After</div><pre tabindex="0">${escapeHTML(file.after ?? 'File deleted')}</pre></div></div>`);
  panel.innerHTML = sourceControls + `<div class="changes-toolbar"><span class="change-summary">${diff.length} changed ${diff.length === 1 ? 'file' : 'files'} ${totalStatsHtml}</span>${patchActions}</div>${commitBar}<div class="diff-layout"><aside class="diff-file-list" aria-label="Changed files">${fileListHtml}</aside><section class="diff-viewer" tabindex="0" role="region" aria-label="Diff for ${escapeHTML(file.path)}"><h3 class="diff-viewer-header"><span>${escapeHTML(file.path)}</span><span class="diff-header-right">${diffModeSwitch}<span class="file-size">${fileLabel} ${fileStatsHtml}</span></span></h3>${renderedDiff}</section></div>`;
  const nextViewer = $('.diff-viewer', panel);
  const nextList = $('.diff-file-list', panel);
  if (nextViewer && prevViewerScroll > 0) nextViewer.scrollTop = prevViewerScroll;
  if (nextList && prevListScroll > 0) nextList.scrollTop = prevListScroll;
  if (prevCommitDraft !== null && $('#changes-commit-message', panel)) $('#changes-commit-message', panel).value = prevCommitDraft;
  if (prevCommentDraft !== null && $('.diff-comment-input', panel)) $('.diff-comment-input', panel).value = prevCommentDraft;
}

function sourceStatus(status) {
  return ({ applied: 'Applied to source', undone: 'File changes undone', partial: 'Partially applied', unchanged: 'No applied changes remain', interrupted: 'Interrupted · inspect receipt', needs_review: 'Source conflict · owner review needed', applying: 'Applying source changes', undoing: 'Restoring original files' })[status] || humanize(status);
}

function renderSourceControls(task) {
  if (!task?.sourcePath) return '';
  const locked = ACTIVE.has(task.status) || task.draining || task.sourceBusy || sourceActionBusy || isCrewBusy(task) || task.pendingMessages?.length;
  const receipt = selectedData?.sourceApplications?.at(-1);
  const excluded = Math.max(0, (receipt?.previewPaths?.length || 0) - (receipt?.files?.length || 0));
  const uncertain = receipt?.files?.some(file => ['writing', 'undoing', 'uncertain'].includes(file.state));
  const hint = !task.importManifest?.sourceIdentity ? 'Re-import to apply, or download a patch.' : isCrewBusy(task) ? 'Finish or dismiss the crew first.' : task.pendingMessages?.length ? 'Resume or remove queued instructions first.' : locked ? 'Pause and wait before applying.' : 'Review before applying. Originals are backed up.';
  return `<section class="source-controls" aria-label="Apply changes to original project"><h3>Apply to your project</h3><p class="source-destination">${escapeHTML(task.sourcePath)}</p><p>${escapeHTML(hint)}</p><button type="button" class="button button-primary" data-source-preview ${locked || !task.importManifest?.sourceIdentity ? 'disabled' : ''}>Review source changes</button>${receipt ? `<div class="source-receipt"><strong>${escapeHTML(sourceStatus(receipt.status))}</strong><p>${receipt.files.filter(file => file.state === 'applied').length} of ${receipt.files.length} selected files currently recorded as applied. ${excluded ? `${excluded} other ${excluded === 1 ? 'file was' : 'files were'} excluded from this application.` : ''} ${receipt.error ? escapeHTML(receipt.error) : ''}</p><details><summary>File receipt</summary><ul>${receipt.files.map(file => `<li><code>${escapeHTML(file.path)}</code><span>${escapeHTML(humanize(file.state))}</span></li>`).join('')}</ul></details><div class="source-actions">${['interrupted', 'needs_review', 'partial'].includes(receipt.status) ? `<button type="button" class="button button-secondary" data-source-inspect="${escapeHTML(receipt.id)}" ${locked ? 'disabled' : ''}>Inspect interrupted apply</button>` : ''}${receipt.files.some(file => file.state === 'applied') && !uncertain ? `<button type="button" class="button button-secondary" data-source-undo="${escapeHTML(receipt.id)}" ${locked ? 'disabled' : ''}>Review undo</button>` : ''}<a class="button button-quiet" href="/api/tasks/${encodeURIComponent(task.id)}/source-backup?id=${encodeURIComponent(receipt.id)}" download>Download original-file backup ↓</a></div>${uncertain ? '<p>Inspect the receipt to reconcile recorded effects. If a file differs from both versions, resolve it in your editor using the backup, then inspect again. Nothing is replayed automatically.</p>' : ''}</div>` : ''}</section>`;
}

function updateSourceSelection() {
  const review = sourceReview;
  if (!review?.files || review.mode !== 'apply') return;
  const count = review.selected.size, conflicts = review.files.filter(file => file.conflict).length;
  const locked = sourceActionBusy || review.failed;
  review.canApply = count > 0 && !locked;
  setText('#source-selection-summary', `${count} of ${review.files.length} files selected${conflicts ? ` · ${conflicts} ${conflicts === 1 ? 'conflict' : 'conflicts'} excluded` : ''}`);
  setText('#source-review-confirm', `Apply ${count} selected ${count === 1 ? 'file' : 'files'}`);
  $('#source-review-confirm').disabled = !review.canApply;
  $('#source-select-all').disabled = locked || count === review.files.filter(file => !file.conflict).length;
  $('#source-select-none').disabled = locked || !count;
  document.querySelectorAll('[data-source-file]').forEach(input => {
    const file = review.files[Number(input.dataset.sourceFile)];
    input.checked = review.selected.has(file.path); input.disabled = Boolean(locked || file.conflict);
  });
}

async function openSourceReview(mode = 'apply', applicationId) {
  if (!selectedData?.task || sourceActionBusy || isCrewBusy()) return;
  const task = selectedData.task, review = { taskId: task.id, mode, applicationId };
  sourceReview = review;
  setText('#source-review-title', mode === 'undo' ? 'Review undo' : 'Review source changes');
  setText('#source-review-destination', task.sourcePath);
  setText('#source-review-note', 'Preparing the file review…');
  $('#source-review-files').innerHTML = '';
  setVisible('#source-selection', false);
  $('#source-review-confirm').disabled = true;
  setText('#source-review-error', ''); setVisible('#source-review-error', false);
  dismissDrawers();
  $('#source-review-dialog').showModal();
  try {
    let files;
    if (mode === 'undo') {
      const backup = await api(`/api/tasks/${encodeURIComponent(task.id)}/source-backup?id=${encodeURIComponent(applicationId)}`);
      files = backup.files.filter(file => file.state === 'applied').map(file => ({ ...file, before: file.after, after: file.before }));
      review.canApply = Boolean(files.length);
    } else {
      const { preview } = await api(`/api/tasks/${encodeURIComponent(task.id)}/apply-preview`, { method: 'POST', body: '{}' });
      review.previewId = preview.id; review.canApply = preview.canApply; files = preview.files;
    }
    if (sourceReview !== review || !$('#source-review-dialog').open) return;
    review.files = files;
    setText('#source-review-note', !files.length ? 'There are no file changes to apply to the source.' : mode === 'undo' ? `Restore ${files.length} files from the saved originals. Undo stops if a source file has changed since application. New empty directories may remain.` : 'Choose files to apply. Unselected changes stay in the task copy. Conflicted files are excluded; resolve them and review again. Backups are saved first. Keep other editors idle while applying. This does not mark the task verified.');
    $('#source-review-files').innerHTML = files.map((file, index) => `<section class="code-file"><h3 class="code-file-header">${mode === 'apply' ? `<label class="source-file-choice"><input type="checkbox" data-source-file="${index}" aria-label="Include ${escapeHTML(file.path)}" ${file.conflict ? `disabled aria-describedby="source-conflict-${index}"` : 'checked'}><span>${escapeHTML(file.path)}</span></label><span class="file-size">${escapeHTML(file.kind.toUpperCase())}</span>` : escapeHTML(file.path)}</h3>${file.conflict ? `<p class="source-conflict" id="source-conflict-${index}"><strong>Excluded · conflict.</strong> ${escapeHTML(file.conflict)} The diff below shows the expected source, not your current edited file.</p>` : ''}<div class="diff-grid"><div class="diff-side before"><div class="diff-label">${mode === 'undo' ? 'APPLIED VERSION' : 'EXPECTED SOURCE'}</div><pre tabindex="0" aria-label="Expected source for ${escapeHTML(file.path)}">${escapeHTML(file.before ?? 'File does not exist')}</pre></div><div class="diff-side after"><div class="diff-label">${mode === 'undo' ? 'RESTORE ORIGINAL' : 'AFTER APPLY'}</div><pre tabindex="0" aria-label="Proposed content for ${escapeHTML(file.path)}">${escapeHTML(file.after ?? 'File will be removed')}</pre></div></div></section>`).join('');
    if (mode === 'apply') {
      review.selected = new Set(files.filter(file => !file.conflict).map(file => file.path));
      setVisible('#source-selection', Boolean(files.length)); updateSourceSelection();
    } else {
      setText('#source-review-confirm', `Restore ${files.length} files`);
      $('#source-review-confirm').disabled = !review.canApply;
    }
  } catch (error) { if (sourceReview === review && $('#source-review-dialog').open) errorIn('#source-review-error', error); }
}

async function confirmSourceReview() {
  const review = sourceReview;
  if (!review?.canApply || sourceActionBusy) return;
  sourceActionBusy = true; $('#source-review-confirm').disabled = true; updateSourceSelection();
  setText('#source-review-note', review.mode === 'undo' ? 'Restoring files and recording the result…' : 'Saving originals and applying the reviewed files…');
  if (selectedData?.task) renderControls(selectedData.task);
  try {
    const action = review.mode === 'undo' ? 'undo-apply' : 'apply-source';
    const body = review.mode === 'undo' ? { applicationId: review.applicationId } : { previewId: review.previewId, paths: [...review.selected] };
    const { application } = await api(`/api/tasks/${encodeURIComponent(review.taskId)}/${action}`, { method: 'POST', body: JSON.stringify(body) });
    if (sourceReview === review && $('#source-review-dialog').open) $('#source-review-dialog').close();
    toast(sourceStatus(application.status));
    await refresh();
  } catch (error) {
    review.failed = true;
    if (sourceReview === review && $('#source-review-dialog').open) {
      errorIn('#source-review-error', error);
      setText('#source-review-note', 'Inspect the file receipt in Changes. Close this review and preview again before retrying.');
    } else toast(error.message);
  } finally {
    sourceActionBusy = false;
    if (selectedData?.task) { renderControls(selectedData.task); renderChanges(selectedData.diff || []); }
  }
}

async function inspectSourceApplication(applicationId) {
  const taskId = selectedId;
  if (!taskId || sourceActionBusy) return;
  sourceActionBusy = true;
  if (selectedData?.task) { renderControls(selectedData.task); renderChanges(selectedData.diff || []); }
  try {
    const { application } = await api(`/api/tasks/${encodeURIComponent(taskId)}/inspect-apply`, { method: 'POST', body: JSON.stringify({ applicationId }) });
    toast(sourceStatus(application.status)); await refresh();
  } catch (error) { toast(error.message); }
  finally { sourceActionBusy = false; if (selectedData?.task) { renderControls(selectedData.task); renderChanges(selectedData.diff || []); } }
}

function renderFiles(files) {
  const signature = JSON.stringify([selectedId, files.map(file => [file.path, file.sha256, file.content])]);
  if (signature === fileSignature && filePanelTaskId === selectedId) return;
  fileSignature = signature;
  filePanelTaskId = selectedId;
  const panel = $('#panel-files');
  if (!files.length) { panel.innerHTML = '<div class="panel-empty"><div><h3>No files yet</h3><p>Workspace files appear here.</p></div></div>'; return; }
  if (!files.some(file => file.path === fileSelections.get(selectedId))) fileSelections.set(selectedId, files[0].path);
  const focused = document.activeElement?.id === 'file-filter';
  const previousScroll = $('.file-code', panel)?.scrollTop || 0;
  panel.innerHTML = `<div class="file-workspace"><aside class="file-tree" aria-label="Workspace files"><label class="visually-hidden" for="file-filter">Filter files</label><input id="file-filter" type="search" placeholder="Find a file…" value="${escapeHTML(fileQueries.get(selectedId) || '')}"><div id="file-tree-list"></div></aside><div id="file-tree-splitter" class="panel-splitter file-tree-splitter" role="separator" aria-orientation="vertical" aria-label="Resize file explorer" title="Drag to resize file list · Double-click to reset" tabindex="0"></div><section class="file-preview" id="file-preview" aria-label="Selected file"></section></div>`;
  wireFileTreeSplitter();
  renderFileTree(); renderFilePreview();
  if (focused) $('#file-filter').focus({preventScroll:true});
  if ($('.file-code', panel)) $('.file-code', panel).scrollTop = previousScroll;
}

function renderFileTree() {
  const query = (fileQueries.get(selectedId) || '').toLowerCase();
  const files = (selectedData?.files || []).filter(file => file.path.toLowerCase().includes(query));
  $('#file-tree-list').innerHTML = files.length ? files.map(file => `<button type="button" class="file-tree-item ${fileSelections.get(selectedId) === file.path ? 'selected' : ''}" data-open-file="${escapeHTML(file.path)}" aria-current="${fileSelections.get(selectedId) === file.path ? 'true' : 'false'}" title="${escapeHTML(file.path)}"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 2h6l4 4v12H5zM11 2v5h4"/></svg><span>${escapeHTML(file.path)}</span></button>`).join('') : '<p class="field-help">No matching files.</p>';
}

function previewEntryForWorkspace(files, preferredPath = '') {
  const list = Array.isArray(files) ? files.map(f => f.path) : [];
  if (preferredPath && /\.(?:html?|svg)$/i.test(preferredPath) && list.includes(preferredPath)) return preferredPath;
  return list.find(p => /^index\.html?$/i.test(p))
    || list.find(p => /\/index\.html?$/i.test(p))
    || list.find(p => /\.(?:html?|svg)$/i.test(p))
    || null;
}

const artifactDismissedKeys = new Set();
let lastDetectedArtifact = null;
let artifactOpenSeq = 0;
let lastDialogCloseAt = 0;
document.addEventListener('close', () => { lastDialogCloseAt = Date.now(); }, true);
const artifactDockState = {
  open: false,
  key: null,
  manualOverrideForKey: null,
  taskId: null,
  session: null,
  title: '',
  files: null,
  viewport: 'desktop',
  viewMode: 'preview',
  consoleOpen: false,
  fullscreen: false,
  logs: [],
  onMessage: null,
  onKey: null,
  splitterWired: false,
};

function quickHashString(str) {
  let h = 2166136261;
  const s = String(str || '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

function inferArtifactFilename(lang, hint, body, usedNames) {
  const cleanHint = String(hint || '').trim().replace(/^["'`(<[]+|["'`>\])]+$/g, '').split(/\s+/)[0] || '';
  if (/^[a-z0-9._/-]+\.(?:html?|svg|css|m?js|json)$/i.test(cleanHint) && !cleanHint.startsWith('/') && !cleanHint.includes('..')) {
    return cleanHint.replace(/^\.\//, '');
  }
  const firstComment = String(body || '').trim().slice(0, 140).match(/^(?:<!--\s*|\/\/\s*|\/\*\s*)([a-z0-9._/-]+\.(?:html?|svg|css|m?js))/i);
  if (firstComment && !firstComment[1].includes('..')) return firstComment[1].replace(/^\.\//, '');
  const l = String(lang || '').toLowerCase();
  const base = l === 'css' ? 'style.css' : /^(?:js|javascript|mjs)$/.test(l) ? 'app.js' : l === 'svg' ? 'graphic.svg' : 'index.html';
  if (!usedNames.has(base)) return base;
  const dot = base.lastIndexOf('.');
  let n = 2;
  while (usedNames.has(`${base.slice(0, dot)}-${n}${base.slice(dot)}`)) n++;
  return `${base.slice(0, dot)}-${n}${base.slice(dot)}`;
}

function stitchHtmlBundle(blocks) {
  const htmlBlock = blocks.find(b => /^(?:html|htm)$/.test(b.lang) || /^\s*(?:<!doctype\s+html|<html\b)/i.test(b.code))
    || blocks.find(b => /<(?:canvas|main|section|div|svg)\b/i.test(b.code) && /<(?:script|style|svg|button|h1)\b/i.test(b.code));
  const svgBlock = !htmlBlock ? blocks.find(b => b.lang === 'svg' || /^\s*<svg\b[\s\S]*<\/svg>\s*$/i.test(b.code.trim())) : null;
  if (!htmlBlock && !svgBlock) return null;

  if (svgBlock) {
    const svgCode = svgBlock.code.trim();
    const titleMatch = svgCode.match(/<title[^>]*>([^<]{1,80})<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : (svgBlock.filename || 'graphic.svg');
    return {
      title,
      entry: svgBlock.filename || 'graphic.svg',
      html: svgCode,
      files: { [svgBlock.filename || 'graphic.svg']: svgCode },
    };
  }

  const used = new Set();
  const files = {};
  const entryName = htmlBlock.filename && /\.html?$/i.test(htmlBlock.filename) ? htmlBlock.filename : 'index.html';
  used.add(entryName);
  let html = htmlBlock.code;

  const cssRefs = [...html.matchAll(/<link\b[^>]*href=["'](?:\.\/)?([^"'?#]+\.css)["'][^>]*>/gi)].map(m => m[1]);
  const jsRefs = [...html.matchAll(/<script\b[^>]*src=["'](?:\.\/)?([^"'?#]+\.m?js)["']/gi)].map(m => m[1]);
  const cssBlocks = blocks.filter(b => b !== htmlBlock && b.lang === 'css');
  const jsBlocks = blocks.filter(b => b !== htmlBlock && /^(?:js|javascript|mjs)$/.test(b.lang));

  // Discover ES module relative imports across sibling JS blocks (e.g. import { x } from './physics.js')
  const importedByJs = new Set();
  for (const jb of jsBlocks) {
    for (const im of jb.code.matchAll(/\b(?:import|export)\b[^'"]*?\bfrom\s*["'](?:\.\/)?([^"'?#]+\.m?js)["']/g)) {
      importedByJs.add(im[1]);
    }
    for (const im of jb.code.matchAll(/\bimport\s*\(\s*["'](?:\.\/)?([^"'?#]+\.m?js)["']\s*\)/g)) {
      importedByJs.add(im[1]);
    }
  }
  const allJsCandidates = [...jsRefs, ...[...importedByJs].filter(r => !jsRefs.includes(r))];

  let cssIdx = 0;
  for (const cb of cssBlocks) {
    let fname = cb.filename;
    if (!fname || !/\.css$/i.test(fname)) {
      fname = cssRefs[cssIdx] && !used.has(cssRefs[cssIdx]) ? cssRefs[cssIdx] : inferArtifactFilename('css', cb.hint, cb.code, used);
    }
    cssIdx++;
    used.add(fname);
    files[fname] = cb.code;
    const escapedRef = fname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!new RegExp(`href=["'](?:\\.\\/)?${escapedRef}(?:[?#][^"']*)?["']`, 'i').test(html)) {
      const linkTag = `<link rel="stylesheet" href="./${fname}">`;
      html = /<\/head>/i.test(html) ? html.replace(/<\/head>/i, `${linkTag}\n</head>`) : `${linkTag}\n${html}`;
    }
  }

  let jsIdx = 0;
  for (const jb of jsBlocks) {
    let fname = jb.filename;
    if (!fname || !/\.m?js$/i.test(fname)) {
      const nextRef = allJsCandidates.find(r => !used.has(r));
      fname = nextRef || inferArtifactFilename('js', jb.hint, jb.code, used);
    }
    jsIdx++;
    used.add(fname);
    files[fname] = jb.code;
    const escapedRef = fname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const alreadyInHtml = new RegExp(`src=["'](?:\\.\\/)?${escapedRef}(?:[?#][^"']*)?["']`, 'i').test(html);
    if (!alreadyInHtml && !importedByJs.has(fname)) {
      const isModule = /\b(?:import|export)\s+/.test(jb.code);
      const scriptTag = `<script${isModule ? ' type="module"' : ''} src="./${fname}"></script>`;
      html = /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${scriptTag}\n</body>`) : `${html}\n${scriptTag}`;
    }
  }

  files[entryName] = html;
  const titleMatch = html.match(/<title[^>]*>([^<]{1,80})<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : entryName;
  const fileCount = Object.keys(files).length;
  return {
    title,
    entry: entryName,
    files,
    html: fileCount === 1 ? html : null,
  };
}

function extractArtifactBundle(text) {
  const src = String(text || '');
  const blocks = [];
  if (src.includes('```')) {
    const fenceRe = /(`{3,4})([a-zA-Z0-9_-]*)(?:[: \t]+([^\n`]+))?\r?\n([\s\S]*?)\1/g;
    let m;
    const used = new Set();
    while ((m = fenceRe.exec(src)) !== null) {
      const lang = (m[2] || '').toLowerCase();
      const headerHint = (m[3] || '').trim();
      const code = m[4] || '';
      if (!code.trim()) continue;
      let hint = headerHint;
      if (!hint) {
        const before = src.slice(Math.max(0, m.index - 220), m.index);
        const recentLines = before.split(/\r?\n/).map(l => l.trim()).filter(Boolean).slice(-2).reverse();
        for (const line of recentLines) {
          const prevMatch = line.match(/([a-z0-9._/-]+\.(?:html?|svg|css|m?js))/i);
          if (prevMatch) { hint = prevMatch[1]; break; }
        }
      }
      const filename = hint ? inferArtifactFilename(lang, hint, code, used) : null;
      if (filename) used.add(filename);
      blocks.push({ lang, hint, filename, code });
    }
  }
  if (blocks.length) {
    const stitched = stitchHtmlBundle(blocks);
    if (stitched) return stitched;
    const mermaidBlock = blocks.find(b => b.lang === 'mermaid');
    if (mermaidBlock && typeof window.renderMermaidToSvg === 'function') {
      const svg = window.renderMermaidToSvg(mermaidBlock.code);
      if (svg) {
        return {
          title: 'Mermaid Diagram',
          entry: 'diagram.svg',
          html: svg,
          files: { 'diagram.mmd': mermaidBlock.code, 'diagram.svg': svg },
        };
      }
    }
  }
  const rawHtml = src.match(/(<!doctype\s+html[\s\S]*?<\/html>|<html\b[\s\S]*?<\/html>)/i);
  if (rawHtml) return stitchHtmlBundle([{ lang: 'html', hint: '', filename: 'index.html', code: rawHtml[1] }]);
  const rawSvg = src.match(/(<svg\b[^>]*>[\s\S]*?<\/svg>)/i);
  if (rawSvg) return stitchHtmlBundle([{ lang: 'svg', hint: '', filename: 'graphic.svg', code: rawSvg[1] }]);
  return null;
}

function extractBundleFromMessageElement(messageEl, clickedBlockEl) {
  const codeBlocks = $$('.message-code-block', messageEl).map(block => {
    const langEl = block.querySelector('.message-code-lang');
    const codeEl = block.querySelector('pre code');
    const lang = (langEl?.textContent || '').trim().toLowerCase();
    return { lang, hint: '', filename: null, code: codeEl?.textContent || '', el: block };
  }).filter(b => b.code.trim());
  const clicked = codeBlocks.find(b => b.el === clickedBlockEl);
  if (clicked && clicked.lang === 'svg') {
    return stitchHtmlBundle([clicked]);
  }
  const ordered = clicked ? [clicked, ...codeBlocks.filter(b => b !== clicked)] : codeBlocks;
  return stitchHtmlBundle(ordered);
}

function applyArtifactWidth(pct) {
  const clamped = Math.max(28, Math.min(74, Number(pct) || 52));
  document.documentElement.style.setProperty('--artifact-width', `${clamped.toFixed(1)}%`);
  try { localStorage.setItem('g0dc0d3.artifactWidth', String(clamped.toFixed(1))); } catch {}
}

function wireVerticalResize(el, { storageKey, cssVar, defaultPx, minPx, maxPx, fromBottom = false, anchorEl = null, onApply = null }) {
  if (!el || el.dataset.splitterWired) return;
  el.dataset.splitterWired = '1';
  const apply = px => {
    const clamped = Math.round(Math.max(minPx, Math.min(maxPx, Number(px) || defaultPx)));
    if (onApply) { onApply(clamped); return; }
    document.documentElement.style.setProperty(cssVar, `${clamped}px`);
    try { localStorage.setItem(storageKey, String(clamped)); } catch {}
  };
  try {
    const saved = parseFloat(localStorage.getItem(storageKey) || '');
    if (Number.isFinite(saved)) apply(saved);
  } catch {}
  let dragging = false, pointerId = null, startY = 0, startVal = defaultPx;
  const readCurrent = () => {
    if (cssVar) {
      const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(cssVar));
      if (Number.isFinite(v)) return v;
    }
    return defaultPx;
  };
  el.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    dragging = true;
    pointerId = event.pointerId;
    startY = event.clientY;
    startVal = readCurrent();
    el.classList.add('is-dragging');
    document.body.classList.add('is-resizing-panel-h');
    try { el.setPointerCapture(event.pointerId); } catch {}
    event.preventDefault();
  });
  el.addEventListener('pointermove', event => {
    if (!dragging || event.pointerId !== pointerId) return;
    if (fromBottom && anchorEl) {
      const rect = anchorEl.getBoundingClientRect();
      apply(rect.bottom - event.clientY);
    } else {
      const delta = fromBottom ? (startY - event.clientY) : (event.clientY - startY);
      apply(startVal + delta);
    }
  });
  const end = event => {
    if (!dragging || (event && event.pointerId !== pointerId)) return;
    dragging = false;
    pointerId = null;
    el.classList.remove('is-dragging');
    document.body.classList.remove('is-resizing-panel-h');
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('dblclick', () => {
    if (onApply) onApply(null);
    else apply(defaultPx);
  });
  el.addEventListener('keydown', event => {
    const cur = readCurrent();
    if (event.key === 'ArrowUp') { event.preventDefault(); apply(cur + (fromBottom ? 16 : -16)); }
    else if (event.key === 'ArrowDown') { event.preventDefault(); apply(cur + (fromBottom ? -16 : 16)); }
    else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); if (onApply) onApply(null); else apply(defaultPx); }
  });
}

function wireFileTreeSplitter() {
  const splitter = $('#file-tree-splitter');
  const container = splitter?.closest('.file-workspace');
  if (!splitter || !container || splitter.dataset.splitterWired) return;
  splitter.dataset.splitterWired = '1';
  const apply = px => {
    const maxW = Math.min(480, Math.max(220, Math.round(container.getBoundingClientRect().width - 260)));
    const clamped = Math.round(Math.max(150, Math.min(maxW, Number(px) || 220)));
    document.documentElement.style.setProperty('--file-tree-width', `${clamped}px`);
    try { localStorage.setItem('g0dc0d3.fileTreeWidth', String(clamped)); } catch {}
  };
  try {
    const saved = parseFloat(localStorage.getItem('g0dc0d3.fileTreeWidth') || '');
    if (Number.isFinite(saved)) apply(saved);
  } catch {}
  let dragging = false, pointerId = null;
  splitter.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    dragging = true; pointerId = event.pointerId;
    splitter.classList.add('is-dragging');
    document.body.classList.add('is-resizing-panel');
    try { splitter.setPointerCapture(event.pointerId); } catch {}
    event.preventDefault();
  });
  splitter.addEventListener('pointermove', event => {
    if (!dragging || event.pointerId !== pointerId) return;
    const rect = container.getBoundingClientRect();
    apply(event.clientX - rect.left);
  });
  const end = event => {
    if (!dragging || (event && event.pointerId !== pointerId)) return;
    dragging = false; pointerId = null;
    splitter.classList.remove('is-dragging');
    document.body.classList.remove('is-resizing-panel');
  };
  splitter.addEventListener('pointerup', end);
  splitter.addEventListener('pointercancel', end);
  splitter.addEventListener('dblclick', () => apply(220));
  splitter.addEventListener('keydown', event => {
    const cur = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--file-tree-width')) || 220;
    if (event.key === 'ArrowRight') { event.preventDefault(); apply(cur + 16); }
    else if (event.key === 'ArrowLeft') { event.preventDefault(); apply(cur - 16); }
    else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); apply(220); }
  });
}

function initPanelSplitters() {
  // 1) Left sidebar splitter (works in normal mode & split-screen artifact mode)
  const sidebarSplitter = $('#sidebar-splitter');
  if (sidebarSplitter && !sidebarSplitter.dataset.splitterWired) {
    sidebarSplitter.dataset.splitterWired = '1';
    const isSplitDockOpen = () => ['artifact-open', 'conclave-open', 'browser-open', 'visualizer-open'].some(c => document.body.classList.contains(c));
    const applySidebar = (px, splitMode = isSplitDockOpen()) => {
      const minW = splitMode ? 140 : 170;
      const inspOpen = !splitMode && document.body.classList.contains('inspector-open');
      const inspW = inspOpen ? (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--inspector-width')) || 340) : 0;
      const maxByCenter = Math.max(minW, window.innerWidth - inspW - 360);
      const maxW = Math.min(maxByCenter, splitMode ? Math.min(360, Math.round(window.innerWidth * 0.32)) : Math.min(480, Math.round(window.innerWidth * 0.45)));
      const defW = splitMode ? 184 : 250;
      const clamped = Math.round(Math.max(minW, Math.min(maxW, Number(px) || defW)));
      const cssVar = splitMode ? '--sidebar-split-width' : '--sidebar-width';
      const key = splitMode ? 'g0dc0d3.sidebarSplitWidth' : 'g0dc0d3.sidebarWidth';
      document.documentElement.style.setProperty(cssVar, `${clamped}px`);
      try { localStorage.setItem(key, String(clamped)); } catch {}
    };
    try {
      const saved = parseFloat(localStorage.getItem('g0dc0d3.sidebarWidth') || '');
      if (Number.isFinite(saved)) applySidebar(saved, false);
      const savedSplit = parseFloat(localStorage.getItem('g0dc0d3.sidebarSplitWidth') || '');
      if (Number.isFinite(savedSplit)) applySidebar(savedSplit, true);
    } catch {}
    let dragging = false, pointerId = null;
    sidebarSplitter.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      dragging = true; pointerId = event.pointerId;
      sidebarSplitter.classList.add('is-dragging');
      document.body.classList.add('is-resizing-panel');
      try { sidebarSplitter.setPointerCapture(event.pointerId); } catch {}
      applySidebar(event.clientX);
      event.preventDefault();
    });
    sidebarSplitter.addEventListener('pointermove', event => {
      if (!dragging || event.pointerId !== pointerId) return;
      applySidebar(event.clientX);
    });
    const end = event => {
      if (!dragging || (event && event.pointerId !== pointerId)) return;
      dragging = false; pointerId = null;
      sidebarSplitter.classList.remove('is-dragging');
      document.body.classList.remove('is-resizing-panel');
    };
    sidebarSplitter.addEventListener('pointerup', end);
    sidebarSplitter.addEventListener('pointercancel', end);
    sidebarSplitter.addEventListener('dblclick', () => applySidebar(isSplitDockOpen() ? 184 : 250));
    sidebarSplitter.addEventListener('keydown', event => {
      const splitMode = isSplitDockOpen();
      const cssVar = splitMode ? '--sidebar-split-width' : '--sidebar-width';
      const cur = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(cssVar)) || (splitMode ? 184 : 250);
      if (event.key === 'ArrowRight') { event.preventDefault(); applySidebar(cur + 16, splitMode); }
      else if (event.key === 'ArrowLeft') { event.preventDefault(); applySidebar(cur - 16, splitMode); }
      else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); applySidebar(splitMode ? 184 : 250, splitMode); }
    });
  }

  // 2) Right Task Details inspector splitter
  const inspectorSplitter = $('#inspector-splitter');
  if (inspectorSplitter && !inspectorSplitter.dataset.splitterWired) {
    inspectorSplitter.dataset.splitterWired = '1';
    const applyInspector = px => {
      const sidebarOpen = !document.body.classList.contains('sidebar-collapsed') && !narrowLayout.matches;
      const sideW = sidebarOpen ? (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-width')) || 250) : 0;
      const maxByCenter = Math.max(240, window.innerWidth - sideW - 360);
      const maxW = Math.min(maxByCenter, 580, Math.round(window.innerWidth * 0.5));
      const clamped = Math.round(Math.max(240, Math.min(maxW, Number(px) || 340)));
      document.documentElement.style.setProperty('--inspector-width', `${clamped}px`);
      try { localStorage.setItem('g0dc0d3.inspectorWidth', String(clamped)); } catch {}
    };
    try {
      const saved = parseFloat(localStorage.getItem('g0dc0d3.inspectorWidth') || '');
      if (Number.isFinite(saved)) applyInspector(saved);
    } catch {}
    let dragging = false, pointerId = null;
    inspectorSplitter.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      dragging = true; pointerId = event.pointerId;
      inspectorSplitter.classList.add('is-dragging');
      document.body.classList.add('is-resizing-panel');
      try { inspectorSplitter.setPointerCapture(event.pointerId); } catch {}
      applyInspector(window.innerWidth - event.clientX);
      event.preventDefault();
    });
    inspectorSplitter.addEventListener('pointermove', event => {
      if (!dragging || event.pointerId !== pointerId) return;
      applyInspector(window.innerWidth - event.clientX);
    });
    const end = event => {
      if (!dragging || (event && event.pointerId !== pointerId)) return;
      dragging = false; pointerId = null;
      inspectorSplitter.classList.remove('is-dragging');
      document.body.classList.remove('is-resizing-panel');
    };
    inspectorSplitter.addEventListener('pointerup', end);
    inspectorSplitter.addEventListener('pointercancel', end);
    inspectorSplitter.addEventListener('dblclick', () => applyInspector(340));
    inspectorSplitter.addEventListener('keydown', event => {
      const cur = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--inspector-width')) || 340;
      if (event.key === 'ArrowLeft') { event.preventDefault(); applyInspector(cur + 16); }
      else if (event.key === 'ArrowRight') { event.preventDefault(); applyInspector(cur - 16); }
      else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); applyInspector(340); }
    });
  }

  // 3) Composer vertical resize handle
  const composerSplitter = $('#composer-splitter');
  wireVerticalResize(composerSplitter, {
    storageKey: 'g0dc0d3.composerHeight',
    cssVar: '--composer-height',
    defaultPx: 96,
    minPx: 44,
    maxPx: 420,
    fromBottom: true,
    onApply: px => applyComposerHeight(px),
  });

  // 4) Adaptive auto-compact observers for composer & task workspace
  if (typeof ResizeObserver === 'function') {
    const adaptiveRO = new ResizeObserver(() => syncAdaptiveCompactUI());
    if ($('#composer-shell')) adaptiveRO.observe($('#composer-shell'));
    if ($('#task-workspace')) adaptiveRO.observe($('#task-workspace'));
  }
  window.addEventListener('resize', syncAdaptiveCompactUI);
  syncAdaptiveCompactUI();
}
initPanelSplitters();

function initArtifactSplitter() {
  const splitter = $('#artifact-splitter');
  if (!splitter || artifactDockState.splitterWired) return;
  artifactDockState.splitterWired = true;
  try {
    const saved = parseFloat(localStorage.getItem('g0dc0d3.artifactWidth') || '');
    if (Number.isFinite(saved)) applyArtifactWidth(saved);
  } catch {}
  let dragging = false;
  let activePointerId = null;
  const updateFromClientX = clientX => {
    const shell = $('.app-shell');
    const rect = shell ? shell.getBoundingClientRect() : { left: 0, width: window.innerWidth };
    const sidebarEl = $('#sidebar');
    const sidebarW = (document.body.classList.contains('sidebar-collapsed') || rect.width <= 980) ? 0 : (sidebarEl ? Math.round(sidebarEl.getBoundingClientRect().width) : 184);
    const maxRight = Math.max(340, rect.width - sidebarW - 320 - 8);
    const rightWidth = Math.max(340, Math.min(maxRight, rect.left + rect.width - clientX));
    const pct = (rightWidth / Math.max(340, rect.width)) * 100;
    applyArtifactWidth(pct);
  };
  splitter.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    dragging = true;
    activePointerId = event.pointerId;
    document.body.classList.add('is-resizing-artifact');
    try { splitter.setPointerCapture(event.pointerId); } catch {}
    updateFromClientX(event.clientX);
    event.preventDefault();
  });
  splitter.addEventListener('pointermove', event => {
    if (!dragging || event.pointerId !== activePointerId) return;
    updateFromClientX(event.clientX);
  });
  const endDrag = event => {
    if (!dragging || (event && event.pointerId !== activePointerId)) return;
    dragging = false;
    activePointerId = null;
    document.body.classList.remove('is-resizing-artifact');
  };
  splitter.addEventListener('pointerup', endDrag);
  splitter.addEventListener('pointercancel', endDrag);
  splitter.addEventListener('dblclick', () => applyArtifactWidth(52));
  splitter.addEventListener('keydown', event => {
    const current = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--artifact-width')) || 52;
    if (event.key === 'ArrowLeft') { event.preventDefault(); applyArtifactWidth(current + 4); }
    else if (event.key === 'ArrowRight') { event.preventDefault(); applyArtifactWidth(current - 4); }
    else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); applyArtifactWidth(52); }
  });
}

function closeArtifactDock({ recordDismiss = true } = {}) {
  artifactOpenSeq += 1;
  if (recordDismiss && artifactDockState.key) artifactDismissedKeys.add(artifactDockState.key);
  if (artifactDockState.onMessage) window.removeEventListener('message', artifactDockState.onMessage);
  if (artifactDockState.onKey) window.removeEventListener('keydown', artifactDockState.onKey);
  artifactDockState.onMessage = null;
  artifactDockState.onKey = null;
  artifactDockState.open = false;
  artifactDockState.manualOverrideForKey = null;
  artifactDockState.fullscreen = false;
  artifactDockState.inspectMode = false;
  artifactDockState.session = null;
  artifactDockState.logs = [];
  const dock = $('#artifact-dock');
  const splitter = $('#artifact-splitter');
  if (dock) {
    dock.classList.remove('is-fullscreen');
    dock.classList.add('hidden');
    dock.innerHTML = '';
  }
  if (splitter) splitter.classList.add('hidden');
  document.body.classList.remove('artifact-open', 'is-resizing-artifact');
  if (selectedData?.task) renderTaskMetaStrip(selectedData.task);
}
window.closeArtifactDock = closeArtifactDock;

function renderArtifactCodePane(dock) {
  const codePane = dock.querySelector('.artifact-code-view');
  if (!codePane) return;
  let filesMap = artifactDockState.files;
  if (!filesMap && artifactDockState.taskId && Array.isArray(selectedData?.files)) {
    filesMap = {};
    for (const f of selectedData.files) {
      if (/\.(?:html?|svg|css|m?js|json)$/i.test(f.path) && typeof f.content === 'string') {
        filesMap[f.path] = f.content;
      }
    }
  }
  const entries = filesMap ? Object.entries(filesMap) : [];
  if (!entries.length) {
    codePane.innerHTML = '<p class="field-help">Source code is available in the Files tab.</p>';
    return;
  }
  codePane.innerHTML = entries.map(([fname, content]) => `
    <div class="artifact-code-file">
      <div class="artifact-code-file-head">
        <span class="artifact-code-file-label">${escapeHTML(fname)}</span>
        <button type="button" class="button button-quiet" data-copy-text="${escapeHTML(content)}">Copy</button>
      </div>
      <pre><code>${escapeHTML(content)}</code></pre>
    </div>`).join('');
}

async function openLivePreview({ taskId, entry, html, files, title, artifactKey, auto = false } = {}) {
  const openSeq = ++artifactOpenSeq;
  const requestedTaskId = taskId || selectedId || null;
  try {
    initArtifactSplitter();
    const payload = taskId
      ? { taskId, ...(entry ? { entry } : {}) }
      : (files && Object.keys(files).length > 1)
        ? { files, entry: entry || 'index.html', name: title || entry || 'index.html' }
        : { html: html || (files ? files[entry || Object.keys(files)[0]] : ''), name: title || entry || 'preview.html' };
    const session = await api('/api/preview/session', { method: 'POST', body: JSON.stringify(payload) });
    if (openSeq !== artifactOpenSeq) return;
    if (requestedTaskId && selectedId !== requestedTaskId) return;

    window.closeChatCode?.();
    if (window.G0DBrowserLive?.isOpen?.()) window.G0DBrowserLive.close();
    if (window.G0DConclave?.isOpen?.()) window.G0DConclave.close();
    if (window.G0DVisualizer?.isOpen?.()) window.G0DVisualizer.close();
    if (typeof setInspector === 'function') setInspector(false);
    if (artifactDockState.onMessage) window.removeEventListener('message', artifactDockState.onMessage);
    if (artifactDockState.onKey) window.removeEventListener('keydown', artifactDockState.onKey);

    const fileEntries = files || (html ? { [title || session.entry || 'preview.html']: html } : null);
    const fileCount = fileEntries ? Object.keys(fileEntries).length : 0;
    artifactDockState.open = true;
    artifactDockState.key = artifactKey || `${taskId || 'snippet'}:${session.entry}`;
    artifactDockState.manualOverrideForKey = auto ? null : (lastDetectedArtifact?.artifactKey || '__manual__');
    artifactDockState.taskId = requestedTaskId;
    artifactDockState.session = session;
    artifactDockState.title = title || session.entry || 'Live Preview';
    artifactDockState.files = fileEntries;
    artifactDockState.logs = [];
    artifactDockState.viewMode = 'preview';
    artifactDockState.consoleOpen = false;
    artifactDockState.fullscreen = false;
    artifactDockState.inspectMode = false;
    if (!auto) artifactDismissedKeys.delete(artifactDockState.key);

    const dock = $('#artifact-dock');
    const splitter = $('#artifact-splitter');
    if (!dock) return;
    dock.classList.remove('hidden', 'is-fullscreen');
    splitter?.classList.remove('hidden');
    document.body.classList.add('artifact-open');

    const label = artifactDockState.title;
    const bundleBadge = fileCount > 1 ? `<span class="meta-chip neutral">${fileCount} files</span>` : '';
    dock.innerHTML = `
      <header class="artifact-toolbar">
        <div class="artifact-title-group" title="${escapeHTML(session.entry)}">
          <span class="live-browser-dot" aria-hidden="true"></span>
          <code>${escapeHTML(label)}</code>
          ${bundleBadge}
        </div>
        <div class="artifact-mode-switch" role="group" aria-label="View mode">
          <button type="button" class="artifact-mode-btn active" data-artifact-mode="preview" aria-pressed="true">Preview</button>
          <button type="button" class="artifact-mode-btn" data-artifact-mode="code" aria-pressed="false">Code</button>
        </div>
        <div class="live-browser-viewports" role="group" aria-label="Viewport size">
          <button type="button" class="live-vp-btn${artifactDockState.viewport === 'desktop' ? ' active' : ''}" data-preview-vp="desktop" aria-pressed="${artifactDockState.viewport === 'desktop'}" title="Desktop (100%)">Desktop</button>
          <button type="button" class="live-vp-btn${artifactDockState.viewport === 'tablet' ? ' active' : ''}" data-preview-vp="tablet" aria-pressed="${artifactDockState.viewport === 'tablet'}" title="Tablet (768px)">Tablet</button>
          <button type="button" class="live-vp-btn${artifactDockState.viewport === 'mobile' ? ' active' : ''}" data-preview-vp="mobile" aria-pressed="${artifactDockState.viewport === 'mobile'}" title="Mobile (390px)">Mobile</button>
        </div>
        <div class="live-browser-actions">
          <button type="button" class="button button-quiet live-browser-btn" data-preview-qa title="Run automated Chromium QA check on Desktop &amp; Mobile viewports (console errors, overflow, broken images, a11y)">✦ Auto-QA</button>
          <button type="button" class="button button-quiet live-browser-btn" data-preview-inspect aria-pressed="false" title="Click any element in the preview to reference it in chat">⌖ Inspect</button>
          <button type="button" class="button button-quiet live-browser-btn" data-preview-reload title="Reload preview">↻</button>
          <button type="button" class="button button-quiet live-browser-btn" data-preview-download title="Download standalone file">↓ Save</button>
          <button type="button" class="button button-quiet live-browser-btn" data-preview-console aria-expanded="false">Console · <span class="live-console-count">0</span></button>
          <button type="button" class="button button-quiet live-browser-btn" data-preview-fullscreen aria-pressed="false" title="Toggle fullscreen (Esc exits)">⛶ Fullscreen</button>
          <button type="button" class="icon-button" data-preview-close aria-label="Close live preview">×</button>
        </div>
      </header>
      <div class="artifact-stage vp-${escapeHTML(artifactDockState.viewport)}">
        <iframe class="artifact-iframe" sandbox="allow-scripts allow-pointer-lock allow-modals" title="Live preview of ${escapeHTML(label)}" src="${escapeHTML(session.url)}"></iframe>
      </div>
      <div class="artifact-code-view hidden" role="region" aria-label="Artifact source code"></div>
      <div class="panel-splitter-h artifact-console-splitter hidden" role="separator" aria-orientation="horizontal" aria-label="Resize preview console" title="Drag to resize console · Double-click to reset" tabindex="0"></div>
      <div class="artifact-console hidden" role="log" aria-label="Preview console">
        <p class="field-help live-console-empty">No console errors or warnings.</p>
      </div>`;

    const stage = dock.querySelector('.artifact-stage');
    const iframe = dock.querySelector('.artifact-iframe');
    const codePane = dock.querySelector('.artifact-code-view');
    const consoleSplitter = dock.querySelector('.artifact-console-splitter');
    const consolePane = dock.querySelector('.artifact-console');
    wireVerticalResize(consoleSplitter, {
      storageKey: 'g0dc0d3.consoleHeight',
      cssVar: '--artifact-console-height',
      defaultPx: 150,
      minPx: 72,
      maxPx: 400,
      fromBottom: true,
      anchorEl: dock,
    });
    const inspectBtn = dock.querySelector('[data-preview-inspect]');
    const consoleBtn = dock.querySelector('[data-preview-console]');
    const fullscreenBtn = dock.querySelector('[data-preview-fullscreen]');
    const countEl = dock.querySelector('.live-console-count');

    const setInspectMode = (next, notifyFrame = true) => {
      artifactDockState.inspectMode = Boolean(next);
      if (inspectBtn) {
        inspectBtn.classList.toggle('is-inspecting', artifactDockState.inspectMode);
        inspectBtn.setAttribute('aria-pressed', String(artifactDockState.inspectMode));
        inspectBtn.textContent = artifactDockState.inspectMode ? '⌖ Picking…' : '⌖ Inspect';
      }
      if (notifyFrame) {
        try { iframe?.contentWindow?.postMessage({ type: 'g0d-preview-inspect-mode', token: session.token, enabled: artifactDockState.inspectMode }, '*'); } catch {}
      }
    };

    const renderConsole = () => {
      if (countEl) countEl.textContent = String(artifactDockState.logs.length);
      consoleBtn?.classList.toggle('has-errors', artifactDockState.logs.some(l => l.level === 'error'));
      if (!consolePane) return;
      consolePane.innerHTML = artifactDockState.logs.length
        ? artifactDockState.logs.map(l => `<div class="live-console-row level-${escapeHTML(l.level)}"><span class="live-console-lvl">${escapeHTML(l.level.toUpperCase())}</span><code>${escapeHTML(l.message)}</code></div>`).join('')
        : '<p class="field-help live-console-empty">No console errors or warnings.</p>';
    };

    const setFullscreen = next => {
      artifactDockState.fullscreen = Boolean(next);
      dock.classList.toggle('is-fullscreen', artifactDockState.fullscreen);
      if (fullscreenBtn) {
        fullscreenBtn.setAttribute('aria-pressed', String(artifactDockState.fullscreen));
        fullscreenBtn.textContent = artifactDockState.fullscreen ? '✕ Exit full' : '⛶ Fullscreen';
      }
    };

    const onMessage = event => {
      const data = event.data;
      if (!data || data.token !== session.token) return;
      if (event.source && iframe?.contentWindow && event.source !== iframe.contentWindow) return;
      if (data.type === 'g0d-preview-console') {
        artifactDockState.logs.push({ level: data.level === 'warn' ? 'warn' : 'error', message: String(data.message || '') });
        if (artifactDockState.logs.length > 50) artifactDockState.logs.shift();
        renderConsole();
        return;
      }
      if (data.type === 'g0d-preview-inspect-cancel') {
        setInspectMode(false, false);
        return;
      }
      if (data.type === 'g0d-preview-picked' && data.element) {
        setInspectMode(false, false);
        const el = data.element;
        const sel = String(el.selector || el.tag || 'element').slice(0, 140);
        const dims = el.rect ? `${el.rect.w}×${el.rect.h}px` : '';
        const txt = el.text ? `"${String(el.text).slice(0, 60)}"` : '';
        const stParts = [];
        if (el.styles?.fontSize) stParts.push(`font ${el.styles.fontSize}`);
        if (el.styles?.color) stParts.push(`color ${el.styles.color}`);
        if (el.styles?.background && el.styles.background !== 'rgba(0, 0, 0, 0)' && el.styles.background !== 'transparent') stParts.push(`bg ${el.styles.background}`);
        const detail = [txt, dims, stParts.join(', ')].filter(Boolean).join(' · ');
        const snippet = `Element \`${sel}\`${detail ? ` (${detail})` : ''} in ${session.entry || label}:\n`;
        const input = $('#composer-input');
        if (input) {
          const cur = input.value;
          input.value = cur ? `${cur.replace(/\s+$/, '')}\n${snippet}` : snippet;
          input.focus();
          input.selectionStart = input.selectionEnd = input.value.length;
          resizeComposer();
          captureComposerDraft();
          renderComposer();
        }
        toast(`Picked ${sel} — describe your edit.`);
      }
    };
    const onKey = event => {
      if (event.key === 'Escape' && artifactDockState.open && !document.querySelector('dialog[open]') && (Date.now() - lastDialogCloseAt > 120)) {
        if (artifactDockState.inspectMode) {
          event.preventDefault();
          setInspectMode(false, true);
        } else if (artifactDockState.fullscreen) {
          event.preventDefault();
          setFullscreen(false);
        }
      }
    };
    artifactDockState.onMessage = onMessage;
    artifactDockState.onKey = onKey;
    window.addEventListener('message', onMessage);
    window.addEventListener('keydown', onKey);

    dock.onclick = event => {
      if (event.target.closest('[data-preview-close]')) { closeArtifactDock({ recordDismiss: true }); return; }
      const qaBtn = event.target.closest('[data-preview-qa]');
      if (qaBtn) {
        const tId = artifactDockState.taskId || selectedId;
        if (!tId || !session?.url) { toast('Open a task preview to run Auto-QA.'); return; }
        qaBtn.disabled = true;
        qaBtn.textContent = '✦ Auditing…';
        api(`/api/tasks/${encodeURIComponent(tId)}/browser/qa-preview`, {
          method: 'POST',
          body: JSON.stringify({ url: session.url }),
        }).then(report => {
          const checks = Array.isArray(report.checks) ? report.checks : [];
          for (const c of checks) {
            artifactDockState.logs.push({
              level: c.passed ? 'info' : 'error',
              message: `${c.passed ? '✓' : '✗'} [Auto-QA] ${c.label}: ${c.detail}`,
            });
          }
          if (artifactDockState.logs.length > 60) artifactDockState.logs = artifactDockState.logs.slice(-60);
          artifactDockState.consoleOpen = true;
          consolePane?.classList.remove('hidden');
          consoleSplitter?.classList.remove('hidden');
          consoleBtn?.setAttribute('aria-expanded', 'true');
          renderConsole();
          const failed = checks.filter(c => !c.passed);
          if (failed.length) {
            const summary = `Auto-QA found ${failed.length} issue${failed.length === 1 ? '' : 's'} in ${session.entry || label} (${report.score}%):\n${failed.map(f => `- ${f.label}: ${f.detail}`).join('\n')}\nPlease fix these issues cleanly.`;
            const input = $('#composer-input');
            if (input && !input.value.trim()) {
              input.value = summary;
              input.dispatchEvent(new Event('input', { bubbles: true }));
            }
            toast(`✦ Auto-QA ${report.score}% — ${failed.length} issue${failed.length === 1 ? '' : 's'} logged & staged in composer.`);
          } else {
            toast(`✦ Auto-QA 100% PASSED (${checks.length}/${checks.length} checks clean on Desktop & Mobile)!`);
          }
        }).catch(err => {
          toast(err?.message || 'Auto-QA failed.');
        }).finally(() => {
          qaBtn.disabled = false;
          qaBtn.textContent = '✦ Auto-QA';
        });
        return;
      }
      const modeBtn = event.target.closest('[data-artifact-mode]');
      if (modeBtn) {
        artifactDockState.viewMode = modeBtn.dataset.artifactMode;
        const isCode = artifactDockState.viewMode === 'code';
        if (isCode && artifactDockState.inspectMode) setInspectMode(false, true);
        stage.classList.toggle('hidden', isCode);
        codePane.classList.toggle('hidden', !isCode);
        if (isCode) renderArtifactCodePane(dock);
        dock.querySelectorAll('[data-artifact-mode]').forEach(b => {
          const active = b.dataset.artifactMode === artifactDockState.viewMode;
          b.classList.toggle('active', active);
          b.setAttribute('aria-pressed', String(active));
        });
        return;
      }
      const vpBtn = event.target.closest('[data-preview-vp]');
      if (vpBtn) {
        artifactDockState.viewport = vpBtn.dataset.previewVp;
        stage.className = `artifact-stage vp-${artifactDockState.viewport}${artifactDockState.viewMode === 'code' ? ' hidden' : ''}`;
        dock.querySelectorAll('[data-preview-vp]').forEach(b => {
          const active = b.dataset.previewVp === artifactDockState.viewport;
          b.classList.toggle('active', active);
          b.setAttribute('aria-pressed', String(active));
        });
        return;
      }
      if (event.target.closest('[data-preview-inspect]')) {
        if (artifactDockState.viewMode === 'code') {
          artifactDockState.viewMode = 'preview';
          stage.classList.remove('hidden');
          codePane.classList.add('hidden');
          dock.querySelectorAll('[data-artifact-mode]').forEach(b => {
            const active = b.dataset.artifactMode === 'preview';
            b.classList.toggle('active', active);
            b.setAttribute('aria-pressed', String(active));
          });
        }
        setInspectMode(!artifactDockState.inspectMode, true);
        if (artifactDockState.inspectMode) toast('Click any element in the preview to inspect it (Esc to cancel).');
        return;
      }
      if (event.target.closest('[data-preview-reload]')) {
        setInspectMode(false, false);
        artifactDockState.logs.length = 0;
        renderConsole();
        iframe.src = `${session.url}?t=${Date.now()}`;
        iframe.addEventListener('load', () => { try { iframe.focus(); } catch {} }, { once: true });
        return;
      }
      if (event.target.closest('[data-preview-download]')) {
        downloadCurrentArtifact();
        return;
      }
      if (event.target.closest('[data-preview-console]')) {
        artifactDockState.consoleOpen = !artifactDockState.consoleOpen;
        consolePane.classList.toggle('hidden', !artifactDockState.consoleOpen);
        consoleSplitter?.classList.toggle('hidden', !artifactDockState.consoleOpen);
        consoleBtn?.setAttribute('aria-expanded', String(artifactDockState.consoleOpen));
        return;
      }
      if (event.target.closest('[data-preview-fullscreen]')) {
        setFullscreen(!artifactDockState.fullscreen);
      }
    };

    if (selectedData?.task) renderTaskMetaStrip(selectedData.task);
  } catch (err) {
    if (!auto) toast(err.message || 'Live preview failed.');
  }
}

function downloadCurrentArtifact() {
  const safeBase = String(artifactDockState.title || 'artifact').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'artifact';
  let filesMap = artifactDockState.files;
  if (!filesMap && artifactDockState.taskId && Array.isArray(selectedData?.files)) {
    filesMap = {};
    for (const f of selectedData.files) {
      if (/\.(?:html?|svg|css|m?js)$/i.test(f.path) && typeof f.content === 'string') filesMap[f.path] = f.content;
    }
  }
  const entries = filesMap ? Object.entries(filesMap) : [];
  const svgEntry = entries.find(([k]) => /\.svg$/i.test(k));
  const htmlEntry = entries.find(([k]) => /\.html?$/i.test(k));
  let filename = `${safeBase}.html`;
  let mime = 'text/html;charset=utf-8';
  let output = '';

  if (htmlEntry) {
    output = htmlEntry[1];
    // Inline sibling CSS & classic JS files for a self-contained single-file download
    for (const [fname, content] of entries) {
      if (fname === htmlEntry[0]) continue;
      const escF = fname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (/\.css$/i.test(fname)) {
        const linkRe = new RegExp(`<link\\b[^>]*href=["'](?:\\.\\/)?${escF}(?:[?#][^"']*)?["'][^>]*>`, 'i');
        const safeCss = content.replace(/<\/style(?=\s|>|\/)/gi, '<\\/style');
        if (linkRe.test(output)) output = output.replace(linkRe, () => `<style>\n${safeCss}\n</style>`);
        else output = /<\/head>/i.test(output) ? output.replace(/<\/head>/i, () => `<style>\n${safeCss}\n</style>\n</head>`) : `<style>\n${safeCss}\n</style>\n${output}`;
      } else if (/\.m?js$/i.test(fname) && !/\b(?:import|export)\s+/.test(content)) {
        const scriptRe = new RegExp(`<script\\b[^>]*src=["'](?:\\.\\/)?${escF}(?:[?#][^"']*)?["'][^>]*>\\s*<\\/script>`, 'i');
        const safeJs = content.replace(/<\/script(?=\s|>|\/)/gi, '<\\/script');
        if (scriptRe.test(output)) output = output.replace(scriptRe, () => `<script>\n${safeJs}\n</script>`);
        else output = /<\/body>/i.test(output) ? output.replace(/<\/body>/i, () => `<script>\n${safeJs}\n</script>\n</body>`) : `${output}\n<script>\n${safeJs}\n</script>`;
      }
    }
    filename = /\.html?$/i.test(safeBase) ? safeBase : `${safeBase}.html`;
  } else if (svgEntry) {
    output = svgEntry[1];
    mime = 'image/svg+xml;charset=utf-8';
    filename = /\.svg$/i.test(safeBase) ? safeBase : `${safeBase}.svg`;
  } else {
    toast('Nothing downloadable in this preview.');
    return;
  }

  const blob = new Blob([output], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast(`Saved ${filename}`);
}

function detectTaskArtifact(data) {
  const task = data?.task;
  if (!task) return null;
  const events = Array.isArray(data.events) ? data.events : [];
  const files = Array.isArray(data.files) ? data.files : [];
  const diff = Array.isArray(data.diff) ? data.diff : [];

  // Priority 1: workspace HTML/SVG files written or modified during this task
  const changedPaths = new Set(diff.map(d => d.path));
  const wsHtmlEntry = previewEntryForWorkspace(files);
  const wsHasGeneratedHtml = wsHtmlEntry && (changedPaths.has(wsHtmlEntry) || diff.some(d => /\.(?:html?|svg|css|m?js)$/i.test(d.path)) || task.workspaceKind === 'conversation');
  if (wsHasGeneratedHtml) {
    const fileSig = files.filter(f => /\.(?:html?|svg|css|m?js)$/i.test(f.path)).map(f => `${f.path}:${quickHashString(f.content)}`).join('|');
    return {
      taskId: task.id,
      artifactKey: `ws:${task.id}:${wsHtmlEntry}:${quickHashString(fileSig)}`,
      entry: wsHtmlEntry,
      title: wsHtmlEntry,
      source: 'workspace',
    };
  }

  // Priority 2: latest assistant message containing a renderable HTML/CSS/JS bundle or SVG graphic
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (ev.type !== 'model.response' || ev.data?.superseded) continue;
    const text = ev.data?.response?.text ?? ev.data?.text ?? ev.data?.response?.message ?? '';
    if (!text || (!text.includes('```') && !/<(?:svg|!doctype\s+html|html)\b/i.test(text))) continue;
    const bundle = extractArtifactBundle(text);
    if (bundle) {
      const sig = quickHashString(JSON.stringify(bundle.files || bundle.html));
      return {
        taskId: task.id,
        artifactKey: `chat:${task.id}:${ev.seq ?? i}:${sig}`,
        title: bundle.title,
        entry: bundle.entry,
        files: bundle.files,
        html: bundle.html,
        source: 'chat',
      };
    }
  }
  return null;
}

function detectAgentBrowserView(data) {
  const task = data?.task;
  const events = Array.isArray(data?.events) ? data.events : [];
  if (!task || !events.length) return null;
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (ev.type !== 'tool.completed') continue;
    const name = ev.data?.name;
    if (name === 'browser.close' && ev.data?.result?.ok) return null;
    if (['browser.open', 'browser.act', 'browser.screenshot', 'browser.snapshot'].includes(name) && ev.data?.result?.ok && ev.data.result.screenshotUrl) {
      const r = ev.data.result;
      return {
        source: 'agent-browser',
        taskId: task.id,
        url: r.url || '',
        title: r.title || r.url || 'Contained Browser',
        screenshotUrl: r.screenshotUrl,
        viewport: r.viewport || null,
        elementCount: Array.isArray(r.elements) ? r.elements.length : null,
        consoleErrors: Array.isArray(r.consoleErrors) ? r.consoleErrors : [],
        artifactKey: `browser:${task.id}:${r.screenshotUrl}`,
      };
    }
  }
  return null;
}

function openAgentBrowserDock(view) {
  const dock = $('#artifact-dock');
  const splitter = $('#artifact-splitter');
  if (!dock || !view) return;
  artifactOpenSeq += 1;
  window.closeChatCode?.();
  if (window.G0DBrowserLive?.isOpen?.()) window.G0DBrowserLive.close();
  if (window.G0DConclave?.isOpen?.()) window.G0DConclave.close();
  if (window.G0DVisualizer?.isOpen?.()) window.G0DVisualizer.close();
  setInspector(false);
  initArtifactSplitter();
  if (artifactDockState.onMessage) window.removeEventListener('message', artifactDockState.onMessage);
  if (artifactDockState.onKey) window.removeEventListener('keydown', artifactDockState.onKey);
  artifactDockState.onMessage = null;
  artifactDockState.open = true;
  artifactDockState.key = view.artifactKey;
  artifactDockState.title = view.title || 'Contained Browser';
  artifactDockState.files = null;
  artifactDockState.taskId = view.taskId;
  dock.classList.remove('hidden');
  splitter?.classList.remove('hidden');
  document.body.classList.add('artifact-open');
  const errCount = view.consoleErrors?.length || 0;
  const metaBits = [
    view.viewport?.width && view.viewport?.height ? `${view.viewport.width}×${view.viewport.height}` : '',
    Number.isFinite(view.elementCount) ? `${view.elementCount} refs` : '',
    errCount ? `${errCount} ${errCount === 1 ? 'issue' : 'issues'}` : '',
  ].filter(Boolean).join(' · ');
  dock.innerHTML = `
    <header class="artifact-toolbar">
      <div class="artifact-title-group">
        <span class="live-browser-dot" aria-hidden="true"></span>
        <span class="agent-browser-badge">Agent Browser</span>
        <code title="${escapeHTML(view.url)}">${escapeHTML(view.url || view.title)}</code>
        ${metaBits ? `<span class="agent-browser-meta">${escapeHTML(metaBits)}</span>` : ''}
      </div>
      <div class="live-browser-actions">
        ${view.url ? `<button type="button" class="button button-quiet live-browser-btn" data-browser-copy-url title="Copy current URL">Copy URL</button>` : ''}
        <button type="button" class="button button-quiet live-browser-btn" data-browser-refresh title="Refresh live screenshot">↻</button>
        <button type="button" class="button button-quiet live-browser-btn" data-preview-fullscreen aria-pressed="${artifactDockState.fullscreen ? 'true' : 'false'}" title="Toggle fullscreen (Esc exits)">${artifactDockState.fullscreen ? '✕ Exit full' : '⛶ Fullscreen'}</button>
        <button type="button" class="icon-button" data-preview-close aria-label="Close agent browser">×</button>
      </div>
    </header>
    <div class="agent-browser-stage">
      <img class="agent-browser-shot" src="${escapeHTML(view.screenshotUrl)}" alt="Contained agent browser view of ${escapeHTML(view.url || view.title)}">
    </div>
    ${errCount ? `<div class="artifact-console" role="log" aria-label="Browser console">${view.consoleErrors.map(l => `<div class="live-console-row level-${escapeHTML(l.level || 'error')}"><span class="live-console-lvl">${escapeHTML(String(l.level || 'error').toUpperCase())}</span><code>${escapeHTML(l.message || '')}</code></div>`).join('')}</div>` : ''}`;
  const setFullscreen = next => {
    artifactDockState.fullscreen = Boolean(next);
    dock.classList.toggle('is-fullscreen', artifactDockState.fullscreen);
    const fsBtn = dock.querySelector('[data-preview-fullscreen]');
    if (fsBtn) {
      fsBtn.setAttribute('aria-pressed', String(artifactDockState.fullscreen));
      fsBtn.textContent = artifactDockState.fullscreen ? '✕ Exit full' : '⛶ Fullscreen';
    }
  };
  const onKey = event => {
    if (event.key === 'Escape' && artifactDockState.open && artifactDockState.fullscreen && !document.querySelector('dialog[open]') && (Date.now() - lastDialogCloseAt > 120)) {
      event.preventDefault();
      setFullscreen(false);
    }
  };
  artifactDockState.onKey = onKey;
  window.addEventListener('keydown', onKey);
  dock.onclick = event => {
    if (event.target.closest('[data-preview-close]')) { closeArtifactDock({ recordDismiss: true }); return; }
    if (event.target.closest('[data-browser-copy-url]') && view.url) {
      navigator.clipboard?.writeText(view.url).then(() => toast('Copied browser URL.')).catch(() => {});
      return;
    }
    if (event.target.closest('[data-browser-refresh]')) {
      const img = dock.querySelector('.agent-browser-shot');
      const sep = view.screenshotUrl.includes('?') ? '&' : '?';
      if (img) img.src = `${view.screenshotUrl}${sep}t=${Date.now()}`;
      return;
    }
    if (event.target.closest('[data-preview-fullscreen]')) setFullscreen(!artifactDockState.fullscreen);
  };
  if (selectedData?.task) renderTaskMetaStrip(selectedData.task);
}

function syncArtifactDockForTask(data, taskChanged) {
  const task = data?.task;
  if (!task) return;
  const browserView = detectAgentBrowserView(data);
  if (browserView) {
    lastDetectedArtifact = browserView;
    renderTaskMetaStrip(task);
    // When G0DBrowserLive is loaded, avoid opening the legacy static screenshot dock on top of Live Browser Mirror!
    if (window.G0DBrowserLive) return;
    if (artifactDockState.open && artifactDockState.key === browserView.artifactKey) return;
    if (artifactDismissedKeys.has(browserView.artifactKey)) return;
    openAgentBrowserDock(browserView);
    return;
  }
  if (artifactDockState.open && String(artifactDockState.key || '').startsWith('browser:')) {
    closeArtifactDock({ recordDismiss: false });
  }
  const artifact = detectTaskArtifact(data);
  lastDetectedArtifact = artifact;
  renderTaskMetaStrip(task);
  if (!artifact) {
    if (taskChanged && artifactDockState.open) closeArtifactDock({ recordDismiss: false });
    return;
  }
  if (ACTIVE.has(task.status) || task.draining) return;
  if (artifactDockState.open && artifactDockState.key === artifact.artifactKey) return;
  if (artifactDockState.open && artifactDockState.manualOverrideForKey === artifact.artifactKey) return;
  if (artifactDismissedKeys.has(artifact.artifactKey)) return;
  if (!qolPrefs.autoOpenPreview) return;
  if (window.G0DVisualizer?.isOpen?.() || window.G0DConclave?.isOpen?.() || window.G0DBrowserLive?.isOpen?.()) return;
  if (artifact.source === 'workspace') {
    openLivePreview({ taskId: task.id, entry: artifact.entry, title: artifact.title, artifactKey: artifact.artifactKey, auto: true });
  } else {
    openLivePreview({ html: artifact.html, files: artifact.files, entry: artifact.entry, title: artifact.title, artifactKey: artifact.artifactKey, auto: true });
  }
}

let splitPaneFile = null;
const sourceViewFiles = new Set();
function renderFilePreview() {
  const file = selectedData?.files?.find(file => file.path === fileSelections.get(selectedId));
  if (!file) return;
  const renderPane = (f, paneId) => {
    if (f.content === null) {
      return `<div class="editor-pane" id="${paneId}"><header class="file-preview-header"><code title="${escapeHTML(f.path)}">${escapeHTML(f.path)}</code>${paneId === 'pane-right' ? `<button type="button" class="button button-quiet" data-close-split>Close</button>` : ''}</header><div class="panel-empty"><div><h3>Binary file</h3><p>${Number.isFinite(f.bytes) ? `${f.bytes.toLocaleString()} bytes` : 'Binary content'} · text preview unavailable.</p></div></div></div>`;
    }
    const text = typeof f.content === 'string' ? f.content : pretty(f.content);
    const lines = text.split('\n'), key = `${selectedId}:${f.path}:${paneId}`, pageSize = 300;
    const page = Math.max(0, Math.min(filePages.get(key) || 0, Math.ceil(lines.length / pageSize) - 1));
    filePages.set(key, page);
    const start = page * pageSize;
    return `<div class="editor-pane" id="${paneId}"><header class="file-preview-header"><code title="${escapeHTML(f.path)}">${escapeHTML(f.path)}</code><button type="button" class="button button-quiet" data-copy-file>Copy</button>${paneId === 'pane-right' ? `<button type="button" class="button button-quiet" data-close-split>Close</button>` : `<button type="button" class="button button-quiet" data-split-view title="Open in split view">Split</button>`}</header><div class="file-code" tabindex="0" role="region" aria-label="File contents"><pre>${lines.slice(start, start + pageSize).map((line, i) => `<span class="code-line"><span class="line-number" aria-hidden="true">${start + i + 1}</span><span class="line-content">${escapeHTML(line) || ' '}</span></span>`).join('')}</pre></div><footer class="file-preview-footer"><span>${lines.length > pageSize ? `Lines ${start + 1}–${Math.min(start + pageSize, lines.length)} of ${lines.length}` : `${lines.length} lines`} · Read only</span>${lines.length > pageSize ? `<div><button type="button" class="button button-quiet" data-file-page="-1" data-pane="${paneId}" ${page === 0 ? 'disabled' : ''}>Prev</button><button type="button" class="button button-quiet" data-file-page="1" data-pane="${paneId}" ${start + pageSize >= lines.length ? 'disabled' : ''}>Next</button></div>` : ''}</footer></div>`;
  };
  const splitFile = splitPaneFile && selectedData?.files?.find(f => f.path === splitPaneFile);
  if (splitFile && splitFile.path !== file.path) {
    $('#file-preview').innerHTML = `<div class="split-pane-editor">${renderPane(file, 'pane-left')}${renderPane(splitFile, 'pane-right')}</div>`;
  } else {
    splitPaneFile = null;
    if (file.content === null) {
      $('#file-preview').innerHTML = `<header class="file-preview-header"><code title="${escapeHTML(file.path)}">${escapeHTML(file.path)}</code></header><div class="panel-empty"><div><h3>Binary file</h3><p>${Number.isFinite(file.bytes) ? `${file.bytes.toLocaleString()} bytes` : 'Binary content'} · text preview unavailable.</p></div></div>`;
      return;
    }
    const text = typeof file.content === 'string' ? file.content : pretty(file.content);
    const lines = text.split('\n'), key = `${selectedId}:${file.path}`, pageSize = 300;
    const page = Math.max(0, Math.min(filePages.get(key) || 0, Math.ceil(lines.length / pageSize) - 1));
    filePages.set(key, page);
    const start = page * pageSize;
    const previewEntry = previewEntryForWorkspace(selectedData?.files, file.path);
    const livePreviewBtn = previewEntry
      ? `<button type="button" class="button button-primary file-live-preview-btn" data-workspace-preview="${escapeHTML(previewEntry)}" title="Launch interactive live preview (${escapeHTML(previewEntry)})">▶ Live Preview</button>`
      : '';
    $('#file-preview').innerHTML = `<header class="file-preview-header"><code title="${escapeHTML(file.path)}">${escapeHTML(file.path)}</code>${livePreviewBtn}<button type="button" class="button button-quiet" data-copy-file>Copy file</button><button type="button" class="button button-quiet" data-split-view title="Open another file in split view">Split</button></header><div class="file-code" tabindex="0" role="region" aria-label="File contents"><pre>${lines.slice(start, start + pageSize).map((line, i) => `<span class="code-line"><span class="line-number" aria-hidden="true">${start + i + 1}</span><span class="line-content">${escapeHTML(line) || ' '}</span></span>`).join('')}</pre></div><footer class="file-preview-footer"><span>${lines.length > pageSize ? `Lines ${start + 1}–${Math.min(start + pageSize, lines.length)} of ${lines.length}` : `${lines.length} lines`} · Read only</span>${lines.length > pageSize ? `<div><button type="button" class="button button-quiet" data-file-page="-1" ${page === 0 ? 'disabled' : ''}>Previous</button><button type="button" class="button button-quiet" data-file-page="1" ${start + pageSize >= lines.length ? 'disabled' : ''}>Next</button></div>` : ''}</footer>`;
    if (typeof file.content === 'string' && richDocument(file.path) && !/\.html?$/i.test(file.path)) {
      const sourceMode = sourceViewFiles.has(key);
      const toggle = document.createElement('button');
      toggle.type = 'button'; toggle.className = 'button button-quiet';
      toggle.textContent = sourceMode ? 'Preview' : 'Source';
      toggle.onclick = () => { if (sourceMode) sourceViewFiles.delete(key); else sourceViewFiles.add(key); renderFilePreview(); };
      $('#file-preview .file-preview-header').append(toggle);
      if (!sourceMode) {
        const pane = $('#file-preview .file-code');
        pane.classList.add('document-preview');
        renderDocumentPreview(pane, file.path, file.content);
        $('#file-preview .file-preview-footer').hidden = true;
      }
    }
  }
}

/* ── Terminal emulator ──────────────────────────────────────── */
const ANSI_COLORS = ['#282828','#cc241d','#98971a','#d79921','#458588','#b16286','#689d6a','#a89984',
  '#928374','#fb4934','#b8bb26','#fabd2f','#83a598','#d3869b','#8ec07c','#ebdbb2'];
function ansiToHtml(text) {
  let fg = null, bold = false, result = '';
  const parts = String(text).split(/(\x1b\[[0-9;]*m)/g);
  for (const part of parts) {
    if (part.startsWith('\x1b[')) {
      const codes = part.slice(2, -1).split(';').map(Number);
      for (const code of codes) {
        if (code === 0) { fg = null; bold = false; }
        else if (code === 1) bold = true;
        else if (code >= 30 && code <= 37) fg = code - 30;
        else if (code >= 90 && code <= 97) fg = code - 82;
        else if (code === 39) fg = null;
      }
    } else {
      const escaped = escapeHTML(part);
      if (fg !== null) {
        const idx = Math.max(0, Math.min(15, fg + (bold && fg < 8 ? 8 : 0)));
        result += `<span class="ansi-fg-${idx}">${escaped}</span>`;
      } else if (bold) {
        result += `<strong>${escaped}</strong>`;
      } else {
        result += escaped;
      }
    }
  }
  return result;
}


function fuzzyScore(query, text) {
  if (!query) return 1;
  const hay = String(text || '').toLowerCase();
  const idx = hay.indexOf(query);
  if (idx >= 0) return 100 - Math.min(idx, 50) + (idx === 0 ? 40 : 0);
  let qi = 0, score = 0, streak = 0;
  for (let hi = 0; hi < hay.length && qi < query.length; hi++) {
    if (hay[hi] === query[qi]) {
      qi++;
      streak++;
      score += 4 + streak * 2;
      if (hi === 0 || /[\s/_.:-]/.test(hay[hi - 1])) score += 8;
    } else {
      streak = 0;
    }
  }
  return qi === query.length ? score : 0;
}

function openCommands() {
  commandReturnFocus = document.activeElement;
  dismissDrawers();
  const input = $('#palette-input');
  const dialog = $('#command-palette-dialog');
  if (!input || !dialog) return;
  input.value = '';
  commandIndex = 0;
  renderCommands();
  if (!dialog.open) dialog.showModal();
  input.focus();
}

function renderCommands() {
  const input = $('#palette-input');
  if (!input) return;
  const query = input.value.trim().toLowerCase();
  const task = selectedData?.task?.id === selectedId ? selectedData.task : null;
  const idle = task && !ACTIVE.has(task.status) && !task.draining && task.status !== 'cancelled' && !isCrewBusy(task);
  const actions = [
    { kind: 'action', title: 'New chat / task', detail: 'Start a fresh conversation', keywords: 'new chat conversation thread', run: newConversation },
    { kind: 'action', title: appMode === 'godcode' ? 'Switch to GODMODƎ (Chat)' : 'Switch to GODCODƎ (Code)', detail: appMode === 'godcode' ? 'Sovereign local chat, browser & live canvas (⌘⇧G)' : 'Autonomous coding workspace, repos & git worktrees (⌘⇧G)', keywords: 'godmode godcode mode switch chat code workspace /godmode /godcode', run: () => applyAppMode(appMode === 'godcode' ? 'godmode' : 'godcode', { persist: true, notify: true, switchView: true }) },
    { kind: 'action', title: 'Open Git Worktrees', detail: 'Compare multi-model patches on isolated branches', keywords: 'worktree git branch diff race godcode', run: () => { applyAppMode('godcode', { persist: true }); $('#open-worktrees')?.click(); } },
    { kind: 'action', title: 'Explore a finished change', detail: 'Offline GodCode patch review', keywords: 'example demo patch review', run: openFinishedChange },
    { kind: 'action', title: 'Open project', detail: 'Work in a local source copy', keywords: 'import folder workspace', run: () => openCreate(undefined, { source: 'project' }) },
    { kind: 'action', title: 'Prompt commands', detail: 'Create and edit ! shortcuts', keywords: 'prompts bang shortcuts', run: () => openSettings('prompts') },
    { kind: 'action', title: 'Scheduled Jobs & Crons', detail: 'Create, run, or pause recurring & timed automations (/schedules)', keywords: 'cron schedule recurring timer automation jobs launchd /cron /schedules', run: () => openSettings('schedules') },
    { kind: 'action', title: 'North Star AutoResearch (Hill-Climb)', detail: 'Launch multi-hour/multi-day git-atomic autonomous optimization (/northstar)', keywords: 'northstar autoresearch hill climb optimize overnight marathon /northstar /climb', run: () => window.G0DNorthStar?.openLauncher ? window.G0DNorthStar.openLauncher() : openSettings('schedules') },
    { kind: 'action', title: 'Sounds & Notifications Settings', detail: 'Configure optional chimes, sound packs, volume & OS notifications (/alerts)', keywords: 'sound chime audio notification alert banner bell volume dock /alerts /sounds /notifications', run: () => openSettings('notifications') },
    { kind: 'action', title: window.G0DAlerts?.get?.().muted ? 'Unmute Sounds & Notifications' : 'Mute Sounds & Notifications', detail: window.G0DAlerts?.get?.().muted ? 'Resume optional chimes and desktop alerts (/mute)' : 'Silence all chimes and desktop notifications — Do Not Disturb (/mute)', keywords: 'mute unmute silence quiet dnd do not disturb sound alert notification /mute', run: () => { if (!window.G0DAlerts) return; const next = !window.G0DAlerts.get().muted; window.G0DAlerts.update({ muted: next }); toast(next ? 'Sounds & notifications muted.' : 'Sounds & notifications unmuted.'); } },
    ...(task ? [
      { kind: 'action', title: 'Rename conversation', detail: 'Edit the current conversation title', keywords: 'rename title name /rename', run: () => startInlineRename(task, $('#selected-title')) },
      { kind: 'action', title: 'Fork current task', detail: 'Branch into a new conversation', keywords: 'branch clone duplicate /fork', run: () => forkTaskAction(task) },
      { kind: 'action', title: 'Delete conversation', detail: 'Permanently delete this chat and workspace', keywords: 'delete remove purge trash', run: () => purgeTaskAction(task) },
      { kind: 'action', title: task.planMode ? 'Switch to Build Mode' : 'Toggle Plan Mode', detail: task.planMode ? 'Allow edits and commands' : 'Read-only planning mode (⌘⇧P)', keywords: 'plan build mode /plan /build', run: () => togglePlanMode(task) },
      ...(idle ? [
        { kind: 'action', title: 'Rewind checkpoint', detail: 'Undo the latest git checkpoint (/undo)', keywords: 'undo restore revert git', run: () => rewindTaskAction(task, 1) },
        { kind: 'action', title: 'Compact context', detail: 'Summarize into fresh eyes (/compact)', keywords: 'summarize memory compress', run: () => compactTaskAction(task) },
      ] : []),
      { kind: 'action', title: 'Copy Markdown transcript', detail: 'Copy conversation as Markdown (/export)', keywords: 'export copy markdown share', run: () => copyTranscriptAction(task) },
      { kind: 'action', title: 'Model route', detail: 'Preferred model and fallbacks', keywords: 'model picker route', run: () => $('#composer-model')?.click() },
      { kind: 'action', title: 'Task details', detail: 'Checks, checkpoints, and usage', keywords: 'inspector evidence', run: () => setInspector(true, true) },
      ...['timeline', 'changes', 'files', 'commands', 'activity'].map(tab => ({
        kind: 'action',
        title: tab === 'timeline' ? 'Conversation' : humanize(tab),
        detail: 'Switch task view',
        keywords: `tab view ${tab}`,
        run: () => { chooseTab(tab); $(`[data-tab="${tab}"]`)?.focus(); }
      })),
    ] : [
      { kind: 'action', title: 'Toggle Plan Mode', detail: draftPlanMode ? 'Start next chat in Build Mode' : 'Start next chat in read-only Plan Mode', keywords: 'plan build /plan /build', run: () => togglePlanMode(null) },
    ]),
    { kind: 'action', title: 'Forge Task Megaprompt (/forge)', detail: 'Synthesize a model-calibrated Megaprompt & acceptance rubric in the composer', keywords: 'forge megaprompt metaprompt metacognition ultra /forge', run: () => { const c = $('#composer-input'); if (c) { c.value = c.value.trim() ? `/forge ${c.value.trim()}` : '/forge '; c.focus(); } } },
    { kind: 'action', title: 'Forge Conclave Agent (Stats Builder)', detail: 'Build a custom specialist with live benchmark radar stats from any API or CLI harness', keywords: 'conclave agent builder stats radar roster codex claude hermes grok antigravity', run: () => { window.G0DConclave?.open({ lens: 'roster' }); window.G0DConclave?.openBuilder(null); } },
    { kind: 'action', title: 'Open Live Browser Mirror (/browser)', detail: 'Watch your agent navigate, click, and test apps live or pop out a real Chromium window', keywords: 'browser live watch screencast window headless non-headless chrome /browser', run: () => window.G0DBrowserLive?.open() },
    { kind: 'action', title: 'Toggle Visible Browser Window', detail: 'Switch the contained agent browser between headless mirror and a real visible Chromium window', keywords: 'browser window visible non-headless popout chrome watch', run: () => { window.G0DBrowserLive?.open(); window.G0DBrowserLive?.toggleWindowMode(); } },
    { kind: 'action', title: 'Open Live Sidecar Visualizer (/visualize)', detail: 'Generate an isolated interactive HTML/SVG dashboard tracking what the agent is doing live', keywords: 'visualize visualizer dashboard chart graph watch monitor /visualize', run: () => window.G0DVisualizer?.open(selectedId, { autoGenerate: true }) },
    { kind: 'action', title: 'Open The Conclave (Multi-Agent Stage)', detail: 'Visualize parallel subagents, Diff Races, and Conclave councils (/conclave)', keywords: 'conclave swarm multi agent subagent crew arena council stage /conclave /swarm', run: () => window.G0DConclave?.open() },
    { kind: 'action', title: 'Open Models & Subscriptions', detail: 'CLI logins, API keys, and local models', keywords: 'claude codex gemini copilot ollama key provider /model', run: () => openSettings('models', { subtab: 'connections' }) },
    { kind: 'action', title: 'Configure HyperTuner (AutoTemp)', detail: 'Toggle Off / Passive / Active adaptive temperature & sampling profiles', keywords: 'hypertuner autotemp autotune temperature sampling bayes top_p min_p', run: () => openSettings('hypertuner') },
    { kind: 'action', title: 'System Prompts & Tool Schemas', detail: 'Inspect and edit every system prompt & JSON tool schema (/system)', keywords: 'system prompt tool schema transparency edit override /system /schemas', run: () => openSettings('system', { subtab: 'prompts' }) },
    { kind: 'action', title: 'Prefills & Message Shaping', detail: 'Experiment with system/user conditioning and assistant/reasoning prefills (/prefill)', keywords: 'prefill shaping conditioning think reasoning steering lab /prefill /inject', run: () => openSettings('system', { subtab: 'lab' }) },
    { kind: 'action', title: 'Open Overseer Quick Controls', detail: 'Toggle Overseer auto-recovery & soft-refusal judge', keywords: 'overseer judge refusal unblock recovery', run: () => toggleOverseerPopover(true) },
    { kind: 'action', title: 'Choose Theme…', detail: 'Switch between 10 dark & light workspace themes (/theme)', keywords: 'theme skin appearance dark light color /theme', run: () => window.G0DThemes?.togglePopover?.(true) },
    { kind: 'action', title: 'Hardened Security Mode (Red Team / Bounty)', detail: 'Strict ZDR + secret scrubbing + Ask Shell gate + Ephemeral Burn Bag', keywords: 'hardened security red team bounty opsec zdr privacy', run: () => { openSettings('privacy'); } },
    { kind: 'action', title: 'Open Privacy & ZDR Shield', detail: 'Zero telemetry, Hardened/Lockdown, Target Scope & Burn Bag (/privacy)', keywords: 'privacy zdr zero telemetry airgap lockdown local only audit burn scope /privacy /zdr', run: () => openSettings('privacy') },
    { kind: 'action', title: 'Open Memory & Skills', detail: 'Cross-session memory and reusable /skills', keywords: 'remember memory skills slash commands /memory /skill', run: () => openSettings('memory') },
    { kind: 'action', title: 'Open Permission Gate', detail: 'Ask Shell, Auto-Edit, Autonomous, shell commands, and checks', keywords: 'permissions approval ask shell auto-edit autonomous guardrails tools', run: () => openSettings('tools') },
    { kind: 'action', title: 'Keyboard Shortcuts', detail: 'View all keyboard hotkeys and slash commands (?)', keywords: 'shortcuts hotkeys keys help ?', run: () => { dismissDrawers(); if (!$('#shortcuts-dialog')?.open) $('#shortcuts-dialog')?.showModal(); } },
    { kind: 'action', title: 'Replay Quick Tour', detail: 'Walk through GODMODƎ and GODCODƎ highlights', keywords: 'tour onboarding walkthrough guide', run: () => { window.SetupUI?.openTour?.(); } },
    { kind: 'action', title: 'Check for Updates', detail: 'Check GitHub Releases for a newer G0DM0D3 version (zero telemetry)', keywords: 'update upgrade version release latest check', run: () => { window.checkForUpdates?.({ openSettings: true }); } },
    { kind: 'action', title: 'Settings (⌘,)', detail: 'General preferences and adaptive recovery', keywords: 'preferences theme font recovery settings', run: () => openSettings('general') },
  ];
  const themeActions = window.G0DThemes ? window.G0DThemes.list().map(t => ({
    kind: 'action',
    title: `Theme: ${t.name}`,
    detail: t.desc,
    keywords: `theme skin appearance color ${t.id} ${t.name} ${t.badge} /theme`,
    run: () => window.G0DThemes.apply(t.id, { persist: true, notify: true })
  })) : [];
  const skills = (state.skills || []).map(skill => {
    const cmd = skill.command || `/${skill.name}`;
    return {
      kind: 'skill',
      title: cmd,
      detail: `${skill.scope === 'project' ? 'Project skill' : 'Global skill'}${skill.description ? ` · ${skill.description}` : ''}`,
      keywords: `${skill.name} ${skill.description || ''} ${skill.source || ''} skill slash`,
      run: () => {
        const composer = $('#composer-input');
        if (composer) {
          composer.value = `${cmd} `;
          composer.focus();
          resizeComposer();
          captureComposerDraft();
          renderComposer();
          toast(`Loaded ${cmd} — add arguments or press Enter to send.`);
        }
      },
    };
  });
  const tasks = state.tasks.map(item => ({
    kind: 'task',
    title: item.title || 'Untitled task',
    detail: `${projectLabel(item) ? `${projectLabel(item)} · ` : ''}${item.pendingApproval ? 'Approval required' : taskStatusLabel(item)}`,
    keywords: `${item.objective || ''} ${item.id} task thread`,
    run: () => selectTask(item.id).then(() => $('#main-content').focus({ preventScroll: true })),
  }));
  const all = [...actions, ...themeActions, ...skills, ...tasks];
  if (query) {
    commandItems = all
      .map(item => ({ item, score: Math.max(fuzzyScore(query, item.title) * 1.3, fuzzyScore(query, `${item.title} ${item.detail} ${item.keywords || ''}`)) }))
      .filter(entry => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 30)
      .map(entry => entry.item);
  } else {
    commandItems = [...tasks.slice(0, 6), ...actions.slice(0, 18), ...skills.slice(0, 6)].slice(0, 30);
  }
  commandIndex = Math.max(0, Math.min(commandIndex, commandItems.length - 1));
  const kindLabelMap = { action: 'ACTION', skill: 'SKILL', task: 'TASK' };
  $('#command-results').innerHTML = commandItems.length
    ? commandItems.map((item, index) => `<button type="button" role="option" id="command-option-${index}" class="command-result ${index === commandIndex ? 'active' : ''}" data-command-index="${index}" aria-selected="${index === commandIndex}" tabindex="-1"><span class="palette-kind palette-kind-${escapeHTML(item.kind || 'action')}">${escapeHTML(kindLabelMap[item.kind] || 'ACTION')}</span><span class="palette-title">${escapeHTML(item.title)}</span><small>${escapeHTML(item.detail)}</small></button>`).join('')
    : '<p class="command-empty">No matching actions, skills, or conversations.</p>';
  if (commandItems.length) input.setAttribute('aria-activedescendant', `command-option-${commandIndex}`);
  else input.removeAttribute('aria-activedescendant');
}

function runCommand(index) {
  const command = commandItems[index];
  if (!command) return;
  commandReturnFocus = null;
  $('#command-palette-dialog')?.close();
  if (narrowLayout.matches) { setSidebar(false); setInspector(false); }
  setTimeout(() => command.run(), 0);
}

function renderEvidence(task) {
  if (task.completionKind === 'answered') { $('#evidence').innerHTML = `<p class="evidence-note">${escapeHTML(task.outcome?.kind === 'declined' ? 'Request declined. No code verification was performed.' : 'Reply received. No code verification was performed.')}</p>`; return; }
  const verification = task.verification;
  const provider = providerById(task.providerId);
  const observedKinds = taskProviders(task).map((id) => providerById(id)?.kind).filter(Boolean);
  const scriptedOnly = observedKinds.length && observedKinds.every((kind) => kind === 'scripted');
  const evidenceLabel = scriptedOnly ? 'Scripted test · fixture results.' : provider?.kind === 'scripted' ? 'Scripted model · see Activity for history.' : 'Checks cover this snapshot.';
  if (!verification) {
    $('#evidence').innerHTML = `<div class="verification-banner"><span class="verification-symbol" aria-hidden="true">◎</span><div><strong>Not checked</strong></div></div><p class="evidence-note">${escapeHTML(evidenceLabel)}</p>`;
    return;
  }
  const status = verification.status ?? 'unknown';
  const title = status === 'pass' ? 'Checks passed' : status === 'fail' ? 'Checks failed' : 'Checks incomplete';
  const symbol = status === 'pass' ? '✓' : status === 'fail' ? '×' : '◌';
  const checks = Array.isArray(verification.checks) ? verification.checks : [];
  const renderCheck = (check) => `<div class="evidence-check"><span class="check-icon ${escapeHTML(check.status)}" aria-label="${escapeHTML(check.status)}">${check.status === 'pass' ? '✓' : check.status === 'fail' ? '×' : '?'}</span><div><strong>${escapeHTML(check.name)}</strong>${check.detail ? `<p>${escapeHTML(typeof check.detail === 'string' ? check.detail : pretty(check.detail))}</p>` : ''}</div></div>`;
  const passedChecks = checks.filter((check) => check.status === 'pass');
  const attentionChecks = checks.filter((check) => check.status !== 'pass');
  const passedOpen = Boolean($('#passed-checks')?.open);
  $('#evidence').innerHTML = `<div class="verification-banner ${escapeHTML(status)}"><span class="verification-symbol" aria-hidden="true">${symbol}</span><div><strong>${title}</strong><p>${checks.length} recorded ${checks.length === 1 ? 'check' : 'checks'}${verification.durationMs != null ? ` · ${duration(verification.durationMs)}` : ''}</p></div></div>${attentionChecks.length ? `<div class="evidence-check-list attention-checks">${attentionChecks.map(renderCheck).join('')}</div>` : ''}${passedChecks.length ? `<details id="passed-checks" class="passed-checks" ${passedOpen ? 'open' : ''}><summary><span>✓ ${passedChecks.length} passed ${passedChecks.length === 1 ? 'check' : 'checks'}</span><span class="details-caret" aria-hidden="true">⌄</span></summary><div class="evidence-check-list">${passedChecks.map(renderCheck).join('')}</div></details>` : ''}${verification.snapshotHash ? `<div class="snapshot-label">CHECKED SNAPSHOT<code title="${escapeHTML(verification.snapshotHash)}">${escapeHTML(verification.snapshotHash.slice(0, 20))}…</code></div>` : ''}<p class="evidence-note">${escapeHTML(evidenceLabel)}</p>`;
}

function renderPolicy(task) { renderRecoveryControl(task); }

function syncPreferredSelect(selector, ids, preferred, disabled = false) {
  const select = $(selector);
  const options = ids.map(id => `<option value="${escapeHTML(id)}">${escapeHTML(providerById(id)?.label || id)}</option>`).join('');
  if (select.innerHTML !== options) select.innerHTML = options;
  select.value = ids.includes(preferred) ? preferred : ids[0] || '';
  select.disabled = disabled || !ids.length;
  return select.value;
}

function orderedProviders(ids, preferred) {
  return ids.includes(preferred) ? [preferred, ...ids.filter(id => id !== preferred)] : ids;
}

function renderRouting(task) {
  const changed = routeTaskId !== task.id;
  if (changed) { routeTaskId = task.id; routeDirty = false; setText('#route-feedback', ''); }
  if ($('#settings-dialog')?.open && !settingsTaskId) return;
  const answered = task.workspaceKind === 'conversation' && task.completionKind === 'answered';
  const blocked = (TERMINAL.has(task.status) && !answered) || task.draining || isCrewBusy(task);
  const routeBase = Array.isArray(task.pendingProviders) && task.pendingProviders.length ? task.pendingProviders : taskProviders(task);
  const current = routeDirty && !changed ? new Set($$('#route-options input:checked').map(input => input.value)) : new Set(routeBase);
  const providers = state.providers.filter(provider => task.fixtureId || provider.kind !== 'scripted');
  const eligible = providers.filter(provider => provider.available !== false).map(provider=>provider.id);
  const requested = routeDirty && !changed ? $('#route-preferred').value : routeBase[0];
  const preferred = catalogId(requested) || eligible.includes(requested) ? requested : eligible[0] || '';
  $('#route-preferred').value = preferred;
  setVisible('#route-fallback-group', !catalogId(preferred));
  const choices = eligible.map(id => `<label class="model-choice"><input type="radio" name="route-primary" value="${escapeHTML(id)}" ${id === preferred ? 'checked' : ''} ${blocked || routeBusy ? 'disabled' : ''}><span>${escapeHTML(providerById(id)?.label || id)}</span></label>`).join('');
  if (settingsListContents.get($('#route-primary-options')) !== choices) {
    $('#route-primary-options').innerHTML = choices; settingsListContents.set($('#route-primary-options'),choices);
  }
  if (preferred) current.add(preferred);
  const markup = providers.map(provider => `<label class="route-option"><input name="route-provider" type="checkbox" value="${escapeHTML(provider.id)}" ${current.has(provider.id) ? 'checked' : ''} ${blocked || catalogId(preferred) || provider.id === preferred || provider.available === false || routeBusy ? 'disabled' : ''}><span>${escapeHTML(provider.label)}<small>${provider.id === preferred ? 'Preferred · ' : ''}${escapeHTML(kindLabel(provider.kind))}${provider.available === false ? ' · unavailable' : ''}</small></span></label>`).join('') || '<p class="field-help">No compatible providers are configured.</p>';
  if (settingsListContents.get($('#route-options')) !== markup) {
    $('#route-options').innerHTML = markup; settingsListContents.set($('#route-options'),markup);
  }
  const activeRoute = orderedProviders(taskProviders(task), task.providerId || preferred);
  const nextRoute = Array.isArray(task.pendingProviders) && task.pendingProviders.length ? task.pendingProviders : null;
  setText('#model-current', nextRoute
    ? `${formatRouteSummary(nextRoute, 'Next message route')} · Running: ${providerById(task.providerId)?.label || task.providerId || 'Model'}`
    : formatRouteSummary(activeRoute.length ? activeRoute : [task.providerId || preferred], 'Active route'));
  setText('#route-help', isCrewBusy(task) ? 'Finish or dismiss the crew to change models.' : task.draining ? 'Wait for the request to stop.' : ACTIVE.has(task.status) ? 'Response in progress — changes apply automatically to your next message.' : answered ? 'Your next message uses this route.' : TERMINAL.has(task.status) ? 'This task is closed. Send a follow-up to continue.' : 'Your task, files and spent budget stay intact.');
  $('#save-route').disabled = blocked || routeBusy || !preferred;
}

function renderSelected(data, force = false, opts = {}) {
  const task = data?.task;
  if (!task || task.id !== selectedId) return;
  const previous = selectedData?.task;
  if (previous?.id === task.id && (Number(task.version) < Number(previous.version) || (Number(task.version) === Number(previous.version) && Number(task.eventSeq) < Number(previous.eventSeq)))) return;
  if (previous?.id === task.id) {
    if (!previous.pendingApproval && task.pendingApproval && task.status !== 'cancelled') {
      const tool = task.pendingApproval?.tool ? ` (${task.pendingApproval.tool})` : '';
      window.G0DAlerts?.notifyEvent('approval', {
        title: `Approval required${tool}`,
        body: task.title || 'Conversation',
        taskId: task.id,
        dedupeKey: `approval:${task.id}:${task.pendingApproval?.id || task.eventSeq || ''}`,
      });
    } else if (ACTIVE.has(previous.status) && task.status === 'completed') {
      window.G0DAlerts?.notifyEvent('completed', {
        title: 'Task finished',
        body: task.title || 'Conversation',
        taskId: task.id,
        dedupeKey: `completed:${task.id}:${task.version ?? ''}`,
      });
    } else if (ACTIVE.has(previous.status) && ['failed', 'blocked', 'paused', 'paused_budget', 'waiting_input'].includes(task.status)) {
      const label = task.status === 'paused_budget' ? 'Task paused (budget limit)' : task.status === 'waiting_input' ? 'Task waiting for input' : task.status === 'paused' ? 'Task paused' : task.status === 'blocked' ? 'Task blocked' : 'Task failed';
      window.G0DAlerts?.notifyEvent('error', {
        title: label,
        body: task.title || 'Conversation',
        taskId: task.id,
        dedupeKey: `error:${task.id}:${task.status}:${task.version ?? ''}`,
      });
    }
  }
  selectedData = data;
  if (isCodingWorkspaceTask(task) && appMode !== 'godcode') {
    applyAppMode('godcode', { persist: false, notify: false, switchView: false });
  }
  const project = projectLabel(task);
  if (project) projectLabels.set(task.id, project);
  setText('#workspace-context', task.codeWorkspace?.repository || project || (task.workspaceKind === 'conversation' ? 'Conversation' : 'Local workspace'));
  setText('#workspace-subcontext', task.title || 'Conversation');
  renderComposer();
  setVisible('#initial-loading', false);
  setVisible('#welcome', false);
  setVisible('#welcome-links', false);
  setVisible('#task-workspace', true);
  manageStream(task);
  window.G0DBrowserLive?.syncTask(task);
  const signature = JSON.stringify(data);
  if (!force && signature === detailSignature) return;
  window.G0DConclave?.syncTask(task);
  window.G0DVisualizer?.onTaskChanged?.(task?.id);
  if (window.G0DVisualizer?.isOpen?.()) window.G0DVisualizer.scheduleTelemetryPush?.();
  const oldTaskId = $('#selected-id').dataset.fullId;
  const taskChanged = oldTaskId !== task.id;
  if (taskChanged && !artifactDockState.open && !document.body.classList.contains('inspector-open') && !window.G0DConclave?.isOpen?.() && !window.G0DBrowserLive?.isOpen?.() && !window.G0DVisualizer?.isOpen?.()) {
    window.restoreChatCode?.(task);
  }
  const scroller = $('#task-content');
  const nearBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 95;
  const oldScroll = scroller.scrollTop;
  detailSignature = signature;
  const provider = providerById(task.providerId);
  setText('#selected-id', task.id.slice(0, 12));
  $('#selected-id').dataset.fullId = task.id;
  if (!$('#selected-title .inline-rename-input')) setText('#selected-title', task.title || 'Untitled task');
  setText('#selected-objective', task.objective);
  const statusHtml = task.outcome && task.outcome.kind !== 'answered' ? `<span class="status-badge">${escapeHTML(task.outcome.label)}</span>` : task.status === 'completed' ? '' : statusBadge(task.status);
  const planBadge = task.planMode ? '<span class="plan-mode-badge" title="Read-only Plan Mode">Plan</span>' : '';
  const tierName = String(provider?.tier || 'standard').toLowerCase();
  const tierBadge = provider?.tier ? `<span class="meta-chip tier-chip tier-${escapeHTML(tierName)}" title="Provider tier">${escapeHTML(provider.tier)}</span>` : '';
  $('#selected-status').innerHTML = `${statusHtml}${planBadge}`;
  renderTaskMetaStrip(task);
  $('#task-meta').innerHTML = `${provider ? `<span class="meta-chip">${escapeHTML(provider.label)}</span><span class="meta-chip ${escapeHTML(provider.kind)}">${escapeHTML(kindLabel(provider.kind))}</span>${tierBadge}` : `<span class="meta-chip neutral">${escapeHTML(task.providerId ?? 'No provider selected')}</span>`}${task.planMode ? '<span class="meta-chip">Plan Mode</span>' : ''}${task.fixtureId ? `<span class="meta-chip neutral">${escapeHTML(task.fixtureId)}</span>` : task.sourcePath ? '<span class="meta-chip neutral">Project copy · owner review</span>' : ''}${task.scenario ? `<span class="meta-chip neutral">Scenario: ${escapeHTML(task.scenario)}</span>` : ''}`;
  renderControls(task);
  renderCrew();
  const events = Array.isArray(data.events) ? data.events : [];
  const usageSummary = computeTaskUsageSummary(task, events);
  const usageTitle = `Observed prompt + completion tokens: ${usageSummary.totalIn.toLocaleString()} in · ${usageSummary.totalOut.toLocaleString()} out`;
  const usageHtml = usageSummary.totalTokens > 0
    ? `<span title="${escapeHTML(usageTitle)}"><strong>${escapeHTML(usageSummary.totalTokens.toLocaleString())}</strong> tokens</span>${usageSummary.costLabel ? `<span title="Estimated API spend from catalog pricing"><strong>${escapeHTML(usageSummary.costLabel)}</strong> est.</span>` : ''}`
    : '';
  const tierCounter = provider?.tier ? `<span title="Active provider tier"><strong>${escapeHTML(provider.tier)}</strong> tier</span>` : '';
  const modeCounter = `<span title="Execution mode"><strong>${escapeHTML(task.planMode ? 'Plan' : 'Build')}</strong> mode</span>`;
  $('#task-counters').innerHTML = `<span title="Model requests used / call limit"><strong>${escapeHTML(task.calls ?? 0)} / ${escapeHTML(task.policy?.maxCalls ?? '—')}</strong> calls</span><span title="Recovery attempts used / limit"><strong>${escapeHTML(task.recoveries ?? 0)} / ${escapeHTML(task.policy?.maxAttempts ?? '—')}</strong> recoveries</span>${tierCounter}${modeCounter}${usageHtml}`;
  const files = Array.isArray(data.files) ? data.files : [];
  const diff = Array.isArray(data.diff) ? data.diff : [];
  const eventCount = data.eventCount ?? events.length;
  const cmdCount = events.filter(e => e.type === 'tool.completed' && e.data?.name === 'process.run').length;
  setText('#event-count', eventCount);
  setText('#file-count', files.length);
  setText('#diff-count', diff.length);
  setText('#command-count', cmdCount);
  setText('#feed-label', ACTIVE.has(task.status) ? 'Working' : '');
  const showRepoTabs = task.workspaceKind !== 'conversation' || Boolean(task.codeWorkspace) || diff.length > 0 || files.length > 0 || cmdCount > 0;
  for (const tabName of ['changes', 'files', 'commands']) {
    const tabBtn = $(`.workspace-tab[data-tab="${tabName}"]`);
    if (tabBtn) tabBtn.classList.toggle('hidden', !showRepoTabs);
  }
  if (!showRepoTabs && ['changes', 'files', 'commands'].includes(currentTab)) chooseTab('timeline');
  const progress = $('#task-progress');
  if (progress) progress.classList.toggle('hidden', !ACTIVE.has(task.status));
  renderTimeline(events, eventCount, task);
  renderActivity(events, eventCount);
  renderChanges(diff);
  renderFiles(files);
  renderEvidence(task);
  loadCheckpoints(task);
  renderPolicy(task);
  renderRouting(task);
  if (typeof renderTaskSettings === 'function') renderTaskSettings(task);
  const shortWorkspace = task.workspace ? task.workspace.split(/[\\/]/).pop() || task.workspace : '';
  setText('#workspace-path', shortWorkspace);
  $('#workspace-path').title = task.workspace ?? '';
  setVisible('#workspace-expired', Boolean(data.workspaceExpired));
  renderTasks();
  if (opts.scrollToBottom || (currentTab === 'timeline' && (taskChanged || nearBottom))) {
    scroller.scrollTop = scroller.scrollHeight;
  } else if (taskChanged) {
    scroller.scrollTop = 0;
  } else {
    scroller.scrollTop = oldScroll;
  }
  updateLatestButton();
  syncArtifactDockForTask(data, taskChanged);
}

function renderStreamTextMarkup(text) {
  // Keep huge streaming fenced code blocks (like 40KB HTML artifacts) inside a bounded live card
  // instead of flooding the entire chat viewport with raw HTML while streaming.
  const fenceMatch = /```([a-zA-Z0-9_.-]*)\r?\n/.exec(text);
  if (fenceMatch && text.length - fenceMatch.index > 1200) {
    const before = text.slice(0, fenceMatch.index).trim();
    const lang = (fenceMatch[1] || 'code').toUpperCase();
    const codeBody = text.slice(fenceMatch.index + fenceMatch[0].length).replace(/\r?\n```\s*$/, '');
    const tail = codeBody.length > 4000 ? '…\n' + codeBody.slice(-4000) : codeBody;
    return `<div class="message-body">${before ? `<p class="stream-text stream-prose">${escapeHTML(before)}</p>` : ''}<div class="stream-code-card"><div class="stream-code-head"><span>${escapeHTML(lang)}</span><span class="stream-code-meta">streaming · ${escapeHTML(codeBody.length.toLocaleString())} chars</span></div><pre class="stream-code-body">${escapeHTML(tail)}<span class="stream-cursor" aria-hidden="true"></span></pre></div></div>`;
  }
  return `<div class="message-body"><p class="stream-text">${escapeHTML(text)}<span class="stream-cursor" aria-hidden="true"></span></p></div>`;
}

function formatLiveThinkingMeta(thinkingText, isActivelyThinking, isOpen) {
  const len = String(thinkingText || '').length;
  const size = len >= 1000 ? `${(len / 1000).toFixed(1)}k chars` : `${len} chars`;
  if (isActivelyThinking) return isOpen ? `${size} · live` : `${size} · click to view`;
  return size;
}

function buildStreamPreviewHtml(openDetails = null) {
  if (!streamText && !streamThinking) return '';
  const liveKey = `thinking-live-${streamTaskId || 'active'}`;
  const isOpen = openDetails ? openDetails.has(liveKey) : streamThinkingExpanded;
  const isActivelyThinking = Boolean(streamThinking && !streamText);
  const thinkingPart = streamThinking
    ? `<details class="thinking-block thinking-live${isActivelyThinking ? ' is-streaming' : ''}" data-disclosure="${escapeHTML(liveKey)}" ${isOpen ? 'open' : ''}><summary class="thinking-summary"><span class="thinking-icon" aria-hidden="true">◇</span><span class="thinking-label">${isActivelyThinking ? 'Reasoning' : 'Thought'}</span>${isActivelyThinking ? '<span class="thinking-dots" aria-hidden="true"><span></span><span></span><span></span></span>' : ''}<span class="thinking-meta">${escapeHTML(formatLiveThinkingMeta(streamThinking, isActivelyThinking, isOpen))}</span></summary><pre class="thinking-body stream-thinking-body" tabindex="0" role="region" aria-label="Live model reasoning">${escapeHTML(streamThinking)}</pre></details>`
    : '';
  const textPart = streamText ? renderStreamTextMarkup(streamText) : '';
  return `<div class="stream-preview"><div class="message message-assistant"><div class="message-avatar" aria-hidden="true"></div><div class="message-main">${thinkingPart}${textPart}</div></div></div>`;
}

function updateLiveStreamSlot() {
  const slot = $('#stream-slot');
  if (!slot) return;
  const scroller = $('#task-content');
  const wasNearBottom = Boolean(scroller && (scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 140));
  if (!streamText && !streamThinking) { slot.innerHTML = ''; updateLatestButton(); return; }
  const existingThinking = $('.stream-thinking-body', slot);
  const existingCode = $('.stream-code-body', slot);
  const existingText = $('.stream-text:not(.stream-prose)', slot);
  const wantsCodeCard = Boolean(streamText && /```[a-zA-Z0-9_.-]*\r?\n/.test(streamText) && (streamText.length - streamText.search(/```[a-zA-Z0-9_.-]*\r?\n/) > 1200));
  const needsStructure = (Boolean(streamThinking) !== Boolean(existingThinking))
    || (Boolean(streamText) !== Boolean(existingText || existingCode))
    || (wantsCodeCard !== Boolean(existingCode));
  if (needsStructure) {
    const liveDetails = $('.thinking-block.thinking-live', slot);
    const keepOpen = liveDetails ? liveDetails.open : streamThinkingExpanded;
    streamThinkingExpanded = keepOpen;
    slot.innerHTML = buildStreamPreviewHtml();
    const nextDetails = $('.thinking-block.thinking-live', slot);
    if (nextDetails) nextDetails.open = keepOpen;
  } else {
    if (existingThinking) {
      const liveDetails = $('.thinking-block.thinking-live', slot);
      const isActivelyThinking = Boolean(streamThinking && !streamText);
      const isOpen = Boolean(liveDetails?.open);
      const nearInnerThink = !isOpen || (existingThinking.scrollHeight - existingThinking.scrollTop - existingThinking.clientHeight < 60);
      existingThinking.textContent = streamThinking;
      if (isOpen && nearInnerThink) existingThinking.scrollTop = existingThinking.scrollHeight;
      if (liveDetails) {
        liveDetails.classList.toggle('is-streaming', isActivelyThinking);
        const metaEl = $('.thinking-meta', liveDetails);
        if (metaEl) metaEl.textContent = formatLiveThinkingMeta(streamThinking, isActivelyThinking, isOpen);
      }
    }
    if (existingCode) {
      const fenceMatch = /```([a-zA-Z0-9_.-]*)\r?\n/.exec(streamText);
      const codeBody = fenceMatch ? streamText.slice(fenceMatch.index + fenceMatch[0].length).replace(/\r?\n```\s*$/, '') : streamText;
      const tail = codeBody.length > 4000 ? '…\n' + codeBody.slice(-4000) : codeBody;
      const metaEl = $('.stream-code-meta', slot);
      if (metaEl) metaEl.textContent = `streaming · ${codeBody.length.toLocaleString()} chars`;
      const nearInnerCode = existingCode.scrollHeight - existingCode.scrollTop - existingCode.clientHeight < 60;
      existingCode.textContent = tail;
      const span = document.createElement('span');
      span.className = 'stream-cursor';
      span.setAttribute('aria-hidden', 'true');
      existingCode.appendChild(span);
      if (nearInnerCode) existingCode.scrollTop = existingCode.scrollHeight;
    } else if (existingText) {
      const streamBody = existingText.closest('.stream-preview .message-body');
      const nearInnerBody = !streamBody || (streamBody.scrollHeight - streamBody.scrollTop - streamBody.clientHeight < 60);
      const cursor = $('.stream-cursor', existingText);
      existingText.textContent = streamText;
      if (cursor) existingText.appendChild(cursor);
      else {
        const span = document.createElement('span');
        span.className = 'stream-cursor';
        span.setAttribute('aria-hidden', 'true');
        existingText.appendChild(span);
      }
      if (streamBody && nearInnerBody) streamBody.scrollTop = streamBody.scrollHeight;
    }
  }
  if (scroller && wasNearBottom) {
    scroller.scrollTop = scroller.scrollHeight;
  }
  updateLatestButton();
}

function syncLiveElapsedTimer(active) {
  if (active && !liveElapsedTimer) {
    liveElapsedTimer = setInterval(() => {
      const el = $('.live-work-elapsed[data-turn-started]');
      if (!el) return;
      const started = Number(el.dataset.turnStarted || 0);
      if (!started) return;
      const sec = Math.max(0, Math.floor((Date.now() - started) / 1000));
      el.textContent = sec >= 60 ? `${Math.floor(sec / 60)}m ${sec % 60}s` : `${sec}s`;
    }, 1000);
  } else if (!active && liveElapsedTimer) {
    clearInterval(liveElapsedTimer);
    liveElapsedTimer = null;
  }
}

function manageStream(task) {
  const isActive = Boolean(task && ACTIVE.has(task.status));
  syncLiveElapsedTimer(isActive);
  const shouldStream = Boolean(task && (isActive || window.G0DBrowserLive?.isOpen?.()));
  if (!isActive && (streamText || streamThinking || streamToolName)) {
    streamText = '';
    streamThinking = '';
    streamToolName = '';
    const slot = $('#stream-slot');
    if (slot) slot.innerHTML = '';
  }
  if (shouldStream && streamTaskId !== task.id) {
    disconnectStream();
    streamTaskId = task.id;
    streamText = '';
    streamThinking = '';
    streamThinkingExpanded = Boolean(qolPrefs.expandThinking);
    streamTurnStartedAt = Date.now();
    try {
      const source = new EventSource(`/api/tasks/${encodeURIComponent(task.id)}/stream`);
      streamSource = source;
      source.onmessage = (event) => {
        if (streamSource !== source || streamTaskId !== task.id) return;
        try {
          const delta = JSON.parse(event.data);
          if (delta.type === 'turn_start') {
            streamText = '';
            streamThinking = '';
            streamThinkingExpanded = Boolean(qolPrefs.expandThinking);
            streamToolName = '';
            streamTurnStartedAt = Date.now();
            const elapsedEl = $('.live-work-elapsed[data-turn-started]');
            if (elapsedEl) {
              elapsedEl.dataset.turnStarted = String(streamTurnStartedAt);
              elapsedEl.textContent = '0s';
            }
            const ticker0 = $('#live-rail-thought');
            if (ticker0) { ticker0.textContent = ''; ticker0.classList.add('hidden'); }
            updateLiveStreamSlot();
          } else if (delta.type === 'thinking' && delta.text) {
            streamThinking += delta.text;
            streamToolName = '';
            const ticker = $('#live-rail-thought');
            if (ticker) {
              const snippet = streamThinking.trim().split('\n').filter(Boolean).slice(-2).join(' ').slice(-180);
              ticker.textContent = snippet;
              ticker.classList.toggle('hidden', !snippet);
            }
            updateLiveStreamSlot();
          } else if (delta.type === 'text' && delta.text) {
            streamText += delta.text;
            streamToolName = '';
            updateLiveStreamSlot();
          } else if (delta.type === 'tool.start') {
            streamToolName = delta.name || '';
            streamText = '';
            streamThinking = '';
            const ticker1 = $('#live-rail-thought');
            if (ticker1) { ticker1.textContent = ''; ticker1.classList.add('hidden'); }
            updateLiveStreamSlot();
            const phaseEl = $('.activity-phase-text') || $('.activity-label');
            if (phaseEl) phaseEl.textContent = toolPhaseLabel(delta.name, delta.args).replace(/…$/, '');
          } else if (delta.type === 'command.chunk' && delta.text) {
            const panel = $('#panel-commands');
            if (panel) {
              let live = panel.querySelector('.terminal-live-block');
              if (!live) {
                const emu = panel.querySelector('.terminal-emulator') || (() => { panel.innerHTML = '<div class="terminal-emulator" role="log" aria-label="Terminal output"></div>'; return panel.querySelector('.terminal-emulator'); })();
                live = document.createElement('div');
                live.className = 'terminal-block terminal-live-block';
                live.innerHTML = `<div class="terminal-prompt"><span class="terminal-ps1">$</span><span class="terminal-cmd">${escapeHTML(delta.command || 'command')}</span><span class="terminal-exit">running…</span></div><pre class="terminal-output"></pre>`;
                emu.append(live);
              }
              const pre = live.querySelector('.terminal-output');
              if (pre) {
                const nextText = (pre.textContent + delta.text).slice(-32768);
                pre.textContent = nextText;
                pre.scrollTop = pre.scrollHeight;
              }
            }
          } else if (delta.type === 'visualizer.ready') {
            window.G0DVisualizer?.onReadyEvent(task.id, delta);
          } else if (delta.type === 'tool.completed') {
            streamToolName = '';
            window.G0DVisualizer?.scheduleTelemetryPush(task.id);
            const phaseEl = $('.activity-phase-text') || $('.activity-label');
            if (phaseEl) phaseEl.textContent = 'Thinking';
            if (delta.ok && ['repo.write', 'repo.patch', 'repo.delete', 'repo.move', 'git.commit', 'task.todo'].includes(delta.name)) {
              setTimeout(refresh, 350);
            }
          } else if (delta.type === 'permission.requested' || delta.type === 'todos.updated') {
            window.G0DConclave?.ingestStreamEvent(delta);
            setTimeout(refresh, 150);
          } else if (delta.type === 'browser.frame' || delta.type === 'browser.activity' || delta.type === 'browser.status' || delta.type === 'browser.closed') {
            window.G0DBrowserLive?.ingestStreamEvent(delta);
          } else if (delta.type === 'subagent.started' || delta.type === 'subagent.progress' || delta.type === 'subagent.completed' || delta.type === 'conclave.update' || delta.type === 'conclave.steered' || delta.type === 'race.dispatched' || delta.type === 'race.result' || delta.type === 'race.completed') {
            window.G0DConclave?.ingestStreamEvent(delta);
            if (delta.type === 'race.completed') {
              const winnerId = delta.scorecard?.winnerId || delta.winner || '';
              const winnerLabel = winnerId ? (providerById(winnerId)?.label || winnerId) : '';
              window.G0DAlerts?.notifyEvent('conclave', {
                title: 'Conclave race finished',
                body: winnerLabel ? `Winner: ${winnerLabel}` : (selectedData?.task?.title || 'Multi-agent comparison finished'),
                taskId: task.id,
                dedupeKey: `conclave:race:${task.id}:${delta.raceId || delta.id || winnerId}`,
              });
            } else if (delta.type === 'subagent.completed') {
              const w = delta.worker || delta;
              const label = w.role || w.modelLabel || w.name || selectedData?.task?.title || 'Subagent reported results';
              const wKey = w.workerId || w.callId || w.agentId || w.id || label;
              window.G0DAlerts?.notifyEvent('conclave', {
                title: 'Conclave agent finished',
                body: label,
                taskId: task.id,
                dedupeKey: `conclave:sub:${task.id}:${wKey}`,
              });
            }
            if (delta.type === 'subagent.completed' || delta.type === 'race.completed') setTimeout(refresh, 250);
          }
        } catch {}
      };
      source.onerror = () => {
        if (streamSource !== source) return;
        if (source.readyState === EventSource.CLOSED) disconnectStream();
      };
    } catch { disconnectStream(); }
  } else if (!shouldStream) {
    disconnectStream();
  }
}
function disconnectStream() {
  if (streamSource) { try { streamSource.close(); } catch {} streamSource = null; }
  streamTaskId = null;
  streamText = '';
  streamThinking = '';
  streamThinkingExpanded = false;
  streamToolName = '';
  streamTurnStartedAt = 0;
  syncLiveElapsedTimer(false);
  const slot = $('#stream-slot');
  if (slot) slot.innerHTML = '';
}
window.syncActiveTaskStream = () => manageStream(selectedData?.task || null);

function renderEmpty() {
  setVisible('#initial-loading', false);
  setVisible('#welcome', true);
  setVisible('#welcome-links', false);
  setVisible('#task-workspace', false);
  setVisible('#workspace-expired', false);
  const hasProviders = liveProviders().length > 0;
  setVisible('#welcome-setup', !hasProviders);
  setVisible('#composer-suggestions', false);
  renderPolicy(null);
  $('#evidence').innerHTML = '<div class="inspector-empty"><span aria-hidden="true">◎</span><p>Select a task.</p></div>';
  loadCheckpoints(null);
  setText('#workspace-context', appMode === 'godcode' ? 'GODCODƎ' : 'GODMODƎ');
  setText('#workspace-subcontext', appMode === 'godcode' ? 'New thread' : 'New chat');
  renderStarterSuggestions();
  setText('#workspace-path', 'Select a task.');
  $('#workspace-path').removeAttribute('title');
  renderComposer();
}

async function selectTask(id) {
  if (id !== selectedId) {
    window.closeChatCode?.({ remember: true });
    lastDetectedArtifact = null;
    splitPaneFile = null;
    diffCommentTarget = null;
    closeArtifactDock({ recordDismiss: false });
    window.G0DVisualizer?.onTaskChanged?.(id);
    composerAutocompleteState.hide?.();
    if (typeof clearComposerAttachments === 'function') clearComposerAttachments();
  }
  captureComposerDraft();
  disconnectStream();
  welcomeRequested = false;
  selectedId = id;
  selectedData = null;
  detailSignature = '';
  checkpointsData = [];
  checkpointsCacheKey = '';
  checkpointsRequestSeq += 1;
  const version = ++selectionVersion;
  try { localStorage.setItem('g0dc0d3.selectedTask', id); } catch { /* Optional preference. */ }
  routeDirty = false;
  commitFormOpen = false;
  chooseTab('timeline');
  renderComposer();
  loadSkills(id);
  if (narrowLayout.matches) setSidebar(false);
  renderTasks(true);
  setVisible('#welcome', false);
  setVisible('#welcome-links', false);
  setVisible('#task-workspace', false);
  setVisible('#initial-loading', true);
  setVisible('#workspace-expired', false);
  renderPolicy(null);
  setText('#recovery-empty', 'Loading the selected task…');
  $('#evidence').innerHTML = '<div class="inspector-empty"><span aria-hidden="true">◎</span><p>Loading the selected task’s evidence…</p></div>';
  try {
    const data = await api(`/api/tasks/${encodeURIComponent(id)}`);
    if (version !== selectionVersion) return;
    renderSelected(data, true);
    setVisible('#global-error', false);
  } catch (error) {
    if (version !== selectionVersion) return;
    setVisible('#initial-loading', false);
    errorIn('#global-error', error);
  }
}

async function refresh() {
  if (refreshing) {
    refreshQueued = true;
    return;
  }
  refreshing = true;
  refreshQueued = false;
  let reschedule = false;
  try {
    const versionAtStart = selectionVersion;
    const stateUrl = selectedModelSort ? `/api/state?sort=${encodeURIComponent(selectedModelSort)}` : '/api/state';
    const data = await api(stateUrl);
    if (versionAtStart !== selectionVersion) {
      reschedule = true;
      return;
    }
    Object.assign(state, data);
    syncSecurityPostureChrome(state.privacy);
    renderOverseerEdge();
    if (typeof loadPromptLibrary === 'function' && data.promptCommandRevision !== promptRevision)
      await loadPromptLibrary(data.promptCommandRevision);
    state.tasks = Array.isArray(data.tasks) ? data.tasks : [];
    state.providers = Array.isArray(data.providers) ? data.providers : [];
    state.fixtures = Array.isArray(data.fixtures) ? data.fixtures : [];
    window.G0DAlerts?.observeTasks(state.tasks);
    window.G0DAlerts?.observeSchedulesSummary(state.schedulesSummary);
    if (state.veniceConnectionId && veniceCatalogConnection !== state.veniceConnectionId) {
      veniceCatalogConnection = state.veniceConnectionId;
      await loadVeniceCatalog();
    } else if (!state.veniceConnectionId) {
      veniceCatalogConnection = null;
      veniceCatalog = { connected: false, models: [], warning: '' };
    }
    if (state.openrouterConnectionId && openrouterCatalogConnection !== state.openrouterConnectionId) {
      openrouterCatalogConnection = state.openrouterConnectionId;
      void loadOpenRouterCatalog();
    } else if (!state.openrouterConnectionId) {
      openrouterCatalogConnection = null;
      openrouterCatalog = { connected: false, models: [], registered: [], warning: '' };
    }
    // Clear a stale saved preferredProvider on initial connect so the user isn't blocked from chatting if a prior provider is disconnected.
    if (!hasConnected && preferredProvider) {
      const liveNow = liveProviders();
      const staleVenice = catalogId(preferredProvider) && !state.veniceConnectionId;
      const staleDirect = !catalogId(preferredProvider) && liveNow.length > 0 && !liveNow.some(p => p.id === preferredProvider);
      if (staleVenice || staleDirect) {
        preferredProvider = null;
        try { localStorage.removeItem('g0dc0d3.preferredProvider'); } catch {}
      }
    }
    if (selectedId && !state.tasks.some(task => task.id === selectedId)) {
      newConversation();
    }
    hasConnected = true;
    renderConnection(true);
    updateHeaderServicesBadge();
    if (!servicesLoadedOnce && !servicesBusy) loadServices();
    setVisible('#global-error', false);
    setText('#version-label', data.version ? `v${data.version}` : 'MVP');
    renderTasks();
    renderFixtures();
    if (!selectedId && state.tasks.length && !welcomeRequested) {
      await selectTask(state.tasks[0].id);
    } else if (selectedId) {
      const id = selectedId;
      const version = selectionVersion;
      const detail = await api(`/api/tasks/${encodeURIComponent(id)}`);
      if (id === selectedId && version === selectionVersion) renderSelected(detail);
    } else renderEmpty();
    if ($('#benchmark-dialog').open) renderBenchmark(state.benchmark);
    if ($('#about-dialog').open) renderAbout();
    window.SetupUI?.maybeOpen(data.setup);
  } catch (error) {
    renderConnection(false);
    if (!hasConnected) {
      setVisible('#initial-loading', false);
      renderEmpty();
    }
    errorIn('#global-error', new Error(`Cannot reach the local runtime. ${error.message} Retrying automatically.`));
  } finally {
    refreshing = false;
    if (reschedule || refreshQueued) {
      refreshQueued = false;
      setTimeout(refresh, 150);
    }
  }
}

function updateFixtureHelp() {
  const fixture = state.fixtures.find((item) => item.id === $('#create-fixture').value);
  setText('#create-fixture-help', fixture?.description ?? '');
  if (createSource === 'fixture') { $('#create-task-title').placeholder = fixture?.title ?? 'Use the fixture name'; $('#create-objective').value = fixture?.objective ?? ''; }
  updateCreateAvailability();
}

function updateCreateAvailability() {
  const providers = $$('#create-providers input:checked');
  const ready = createSource === 'fixture' ? Boolean($('#create-fixture').value) : Boolean($('#create-source-path').value.trim() && $('#create-objective').value.trim());
  $('#create-submit').disabled = createBusy || importPreviewBusy || !providers.length || !ready;
}

function renderCreateProviders() {
  const providers = state.providers.filter((provider) => createSource !== 'project' || provider.kind !== 'scripted');
  const available = providers.filter((provider) => provider.available !== false);
  const scripted = available.filter((provider) => provider.kind === 'scripted');
  const defaults = new Set((scripted.length ? scripted.slice(0, 2) : available.slice(0, 1)).map((provider) => provider.id));
  const selected = createProviderSelections.get(createSource) ?? defaults;
  const preferred = syncPreferredSelect('#create-preferred', available.map(provider => provider.id), createPreferredSelections.get(createSource) || [...selected][0]);
  if (preferred) selected.add(preferred);
  createPreferredSelections.set(createSource, preferred);
  createProviderSelections.set(createSource, selected);
  $('#create-providers').innerHTML = providers.map((provider) => `<label class="provider-option" title="${escapeHTML(provider.id)}"><input type="checkbox" name="provider" value="${escapeHTML(provider.id)}" ${selected.has(provider.id) && provider.available !== false ? 'checked' : ''} ${provider.available === false || provider.id === preferred ? 'disabled' : ''}><span><span class="provider-option-name">${escapeHTML(provider.label)}</span>${provider.available === false ? '<span class="provider-option-status">Not configured</span>' : ''}</span><span class="meta-chip ${escapeHTML(provider.kind)}">${escapeHTML(kindLabel(provider.kind))}</span></label>`).join('') || `<p class="field-help">${createSource === 'project' ? 'No live model configured. Settings → Models has setup instructions.' : 'No models available.'}</p>`;
  updateCreateAvailability();
}

function setCreateSource(mode) {
  if (!['fixture', 'project'].includes(mode)) return;
  if (createSource === 'project') createProjectObjective = $('#create-objective').value;
  createSource = mode;
  importPreviewVersion += 1;
  importPreviewBusy = false;
  $('#preview-import').disabled = false;
  setText('#preview-import', 'Preview copy');
  $$('.source-option').forEach((button) => { const active = button.dataset.createSource === mode; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); });
  setVisible('#create-fixture-fields', mode === 'fixture');
  setVisible('#create-project-fields', mode === 'project');
  $('#create-fixture').required = mode === 'fixture';
  $('#create-source-path').required = mode === 'project';
  $('#create-objective').readOnly = mode === 'fixture';
  $('#create-objective').required = mode === 'project';
  $('#create-objective').value = mode === 'fixture' ? state.fixtures.find((item) => item.id === $('#create-fixture').value)?.objective ?? '' : createProjectObjective;
  $('#create-objective').placeholder = mode === 'fixture' ? '' : 'What should we build or fix?';
  $('#create-instructions').open = mode === 'project';
  $('#create-task-title').placeholder = mode === 'fixture' ? state.fixtures.find((item) => item.id === $('#create-fixture').value)?.title ?? 'Use the fixture name' : 'Use the project directory name';
  setText('#create-objective-kind', mode === 'fixture' ? 'preset' : 'required');
  setText('#create-intro', mode === 'fixture' ? 'Uses an example copy.' : 'Your project stays unchanged.');
  setText('#create-objective-help', mode === 'fixture' ? 'Checks verify completion.' : 'Review changes before applying.');
  setVisible('#create-execution-fields', mode === 'project');
  $('#create-execution').disabled = !state.executionAvailable;
  if (!state.executionAvailable) $('#create-execution').checked = false;
  $('#create-network').disabled = !$('#create-execution').checked;
  if (!$('#create-execution').checked) $('#create-network').checked = false;
  setText('#create-footer-note', mode === 'fixture' ? '' : 'Running sends source context to selected models.');
  $('#create-scenario').disabled = mode === 'project';
  setVisible('#create-error', false);
  renderCreateProviders();
}

async function previewImport({ silentError = false } = {}) {
  const sourcePath = $('#create-source-path').value.trim();
  if (!sourcePath) { if (!silentError) errorIn('#create-error', new Error('Enter an absolute project directory.')); return null; }
  const version = ++importPreviewVersion;
  importPreview = null;
  importPreviewBusy = true;
  $('#preview-import').disabled = true;
  setText('#preview-import', 'Scanning…');
  setVisible('#create-error', false);
  $('#import-preview').innerHTML = '';
  updateCreateAvailability();
  try {
    const preview = await api('/api/workspaces/preview', { method: 'POST', body: JSON.stringify({ sourcePath }) });
    if (version !== importPreviewVersion || createSource !== 'project') return null;
    importPreview = { ...preview, sourceInput: sourcePath };
    const files = preview.files ?? [];
    const omitted = preview.omitted ?? [];
    const suggestedChecks = Array.isArray(preview.suggestedChecks) ? preview.suggestedChecks : [];
    const existingLines = new Set(($('#create-checks')?.value || '').split('\n').map(s => s.trim()).filter(Boolean));
    const suggestedHtml = suggestedChecks.length
      ? `<div class="suggested-checks"><span class="suggested-checks-label">Detected project checks (click to add)</span><div class="suggested-checks-list">${suggestedChecks.map(check => `<button type="button" class="check-chip ${existingLines.has(check.command) ? 'is-added' : ''}" data-add-check="${escapeHTML(check.command)}" title="Detected in ${escapeHTML(check.source)}"><span class="check-chip-plus" aria-hidden="true">${existingLines.has(check.command) ? '✓' : '+'}</span><span class="check-chip-name">${escapeHTML(check.name)}</span><code>${escapeHTML(check.command)}</code></button>`).join('')}</div></div>`
      : '';
    $('#import-preview').innerHTML = `<div class="import-summary"><strong>${files.length} ${files.length === 1 ? 'file' : 'files'} ready to copy</strong><span>${(Number(preview.totalBytes ?? 0) / 1024).toFixed(1)} KiB · ${omitted.length} omitted</span><p>${escapeHTML(preview.copyPolicy ?? 'Review the included and omitted paths. This is a source-file copy, not a complete environment snapshot.')}</p></div>${suggestedHtml}<details class="import-file-list"><summary>Included files (${files.length})</summary><ul>${files.map((file) => `<li><code>${escapeHTML(file.path)}</code><span>${escapeHTML(file.bytes ?? '')} B</span></li>`).join('')}</ul></details>${omitted.length ? `<details class="import-file-list"><summary>Omitted paths (${omitted.length})</summary><ul>${omitted.map((file) => `<li><code>${escapeHTML(file.path)}</code><span>${escapeHTML(file.reason)}</span></li>`).join('')}</ul></details>` : ''}`;
    return importPreview;
  } catch (error) {
    if (version === importPreviewVersion && !silentError) errorIn('#create-error', error);
    return null;
  }
  finally { if (version === importPreviewVersion) { importPreviewBusy = false; $('#preview-import').disabled = false; setText('#preview-import', importPreview ? 'Re-scan' : 'Preview copy'); updateCreateAvailability(); } }
}
window.G0DPreviewCreateImport = () => previewImport();

function openCreate(fixtureId, options = {}) {
  captureComposerDraft();
  $('#create-form').reset();
  try { const preferences = JSON.parse(localStorage.getItem('g0dc0d3.defaults') || '{}'); $('#create-persona').value = preferences.persona || 'plinian'; } catch {}
  $('#create-mode').value = RecoveryUI.policy(null).mode;
  $('#create-return').value = RecoveryUI.policy(null).returnToPrimary ? 'yes' : 'no';
  createSource = 'fixture';
  createProjectObjective = options.objective ?? composerDrafts.get(selectedId || 'welcome') ?? '';
  createComposerOrigin = options.composerOrigin ?? null;
  createProviderSelections = new Map(createComposerOrigin ? composerProviderDrafts.get(createComposerOrigin) ?? [] : []);
  createPreferredSelections = new Map([...createProviderSelections].map(([key,ids])=>[key,[...ids][0]]));
  importPreview = null;
  $('#import-preview').innerHTML = '';
  setVisible('#create-error', false);
  $('#create-fixture').innerHTML = state.fixtures.map((fixture) => `<option value="${escapeHTML(fixture.id)}">${escapeHTML(fixture.title)}</option>`).join('');
  if (fixtureId) $('#create-fixture').value = fixtureId;
  $('#create-scenario').innerHTML = '<option value="">Normal run (default)</option>' + (state.scenarios ?? []).filter((scenario) => scenario !== 'normal').map((scenario) => `<option value="${escapeHTML(scenario)}">${escapeHTML(humanize(scenario))}</option>`).join('');
  setCreateSource(options.source ?? 'fixture');
  renderCreateRecentProjects();
  const initialPath = (options.sourcePath ?? (options.source === 'project' ? pendingProject?.path : '') ?? '').trim();
  if (createSource === 'project' && initialPath) {
    $('#create-source-path').value = initialPath;
    void previewImport({ silentError: true });
  }
  updateFixtureHelp();
  dismissDrawers();
  if (!$('#create-dialog').open) $('#create-dialog').showModal();
  if (createSource === 'project' && createProjectObjective && !initialPath) $('#create-source-path').focus();
}

async function createTask(event) {
  event.preventDefault();
  if (createBusy) return;
  const providerIds = orderedProviders($$('#create-providers input:checked').map(input => input.value), $('#create-preferred').value);
  if (!providerIds.length) { errorIn('#create-error', new Error('Select at least one available provider.')); return; }
  const liveProviders = providerIds.some(id => providerById(id)?.kind !== 'scripted');
  const workflow = $('#create-workflow')?.value;
  const request = { providerIds, persona: $('#create-persona').value, policy: { ...RecoveryUI.policy(null, liveProviders), mode: $('#create-mode').value, returnToPrimary: $('#create-return').value === 'yes' } };
  if (workflow) request.workflow = workflow;
  if (createSource === 'project') {
    const sourceInput = $('#create-source-path').value.trim();
    if (!importPreview || importPreview.sourceInput !== sourceInput) {
      const scanned = await previewImport();
      if (!scanned) return;
    }
    request.sourcePath = importPreview.sourcePath;
    request.previewHash = importPreview.snapshotHash;
    request.execution = { enabled: $('#create-execution').checked, network: $('#create-network').checked, timeoutMs: 30000 };
    request.checks = $('#create-checks').value.split('\n').map(x => x.trim()).filter(Boolean).map((command, i) => ({name: `Project check ${i+1}`, command}));
  } else request.fixtureId = $('#create-fixture').value;
  const title = $('#create-task-title').value.trim();
  const objective = $('#create-objective').value.trim();
  const scenario = $('#create-scenario').value.trim();
  if (title) request.title = title;
  if (objective) request.objective = objective;
  if (scenario && createSource === 'fixture') request.scenario = scenario;
  createBusy = true;
  renderComposer();
  $('#create-submit').disabled = true;
  setText('#create-submit', 'Creating…');
  setVisible('#create-error', false);
  try {
    const { task } = await api('/api/tasks', { method: 'POST', body: JSON.stringify(request) });
    if (createSource === 'project' && request.sourcePath) {
      recordRecentProject(request.sourcePath, 'copy');
      setPendingProject(request.sourcePath, 'copy');
    }
    if (createComposerOrigin && createSource === 'project') {
      saveComposerDraft(createComposerOrigin, '');
      composerErrors.delete(createComposerOrigin);
      if (composerScope === createComposerOrigin) { $('#composer-input').value = ''; resizeComposer(); }
    }
    createComposerOrigin = null;
    $('#create-dialog').close();
    state.tasks.unshift(task);
    await selectTask(task.id);
    toast('Task created.');
    await refresh();
  } catch (error) { errorIn('#create-error', error); }
  finally { createBusy = false; updateCreateAvailability(); renderComposer(); $('#create-submit').innerHTML = 'Create task <span aria-hidden="true">↗</span>'; }
}

async function taskAction(action) {
  if (!selectedId || actionBusy || isCrewBusy()) return;
  if (action === 'cancel') {
    const ok = await confirmModal({
      title: 'Cancel conversation permanently?',
      message: 'Cancelling stops this task permanently and disables further messages. Use Stop / Pause if you want to continue later.',
      confirmLabel: 'Cancel permanently',
      danger: true,
    });
    if (!ok) return;
  }
  actionBusy = true;
  if (selectedData?.task) renderControls(selectedData.task);
  const taskId = selectedId;
  try {
    let endpointAction = action;
    if (action === 'resume-budget') {
      const current = selectedData?.task;
      const nextMaxCalls = Math.min(5000, Math.max(Number(current?.policy?.maxCalls || 0), Number(current?.calls || 0)) + 100);
      await api(`/api/tasks/${encodeURIComponent(taskId)}/policy`, { method: 'PATCH', body: JSON.stringify({ maxCalls: nextMaxCalls }) });
      endpointAction = 'resume';
    }
    const { task } = await api(`/api/tasks/${encodeURIComponent(taskId)}/${endpointAction}`, { method: 'POST', body: '{}' });
    if (selectedData && selectedId === taskId && task) renderSelected({ ...selectedData, task }, true);
    await refresh();
    if (action === 'resume-budget') toast('Added +100 calls and resumed.');
    if (action === 'accept') toast('Owner acceptance recorded. Check outcomes remain unchanged.');
  } catch (error) { errorIn('#global-error', error); toast(error.message); }
  finally { actionBusy = false; if (selectedData?.task) renderControls(selectedData.task); }
}


async function saveRoute(event, catalogRoute) {
  event.preventDefault();
  if (!selectedId || routeTaskId !== selectedId || routeBusy || isCrewBusy()) return;
  const taskId = selectedId;
  const preferred = $('#route-preferred').value;
  const primaryChanged = preferred !== taskProviders(selectedData.task)[0];
  const providerIds = catalogId(preferred) ? catalogRoute || [preferred] : primaryChanged ? [preferred] : orderedProviders([...new Set([...$$('#route-options input:checked').map(input => input.value), preferred])].filter(Boolean), preferred);
  if (!providerIds.length) { setText('#route-feedback', 'Select at least one configured provider.'); $('#route-feedback').classList.add('error'); return; }
  const focus = document.activeElement?.closest('#route-form input');
  const focusKey = focus ? {name:focus.name,value:focus.value} : null;
  routeBusy = true;
  renderRouting(selectedData.task);
  $('#save-route').disabled = true;
  setText('#route-feedback', 'Saving route…');
  $('#route-feedback').classList.remove('error');
  try {
    const { task } = await api(`/api/tasks/${encodeURIComponent(taskId)}/providers`, { method: 'PATCH', body: JSON.stringify({ providerIds }) });
    if (selectedId !== taskId) return;
    routeDirty = false;
    if (task && selectedData) renderSelected({ ...selectedData, task }, true);
    setText('#route-feedback', task?.pendingProviders?.length ? 'Queued for your next message.' : task?.completionKind === 'answered' ? 'Saved for your next message.' : 'Saved.');
    await refresh();
  } catch (error) { if (selectedId === taskId) { routeDirty=false; setText('#route-feedback', error.message); $('#route-feedback').classList.add('error'); } }
  finally { routeBusy = false; if (selectedData?.task) renderRouting(selectedData.task); if (focusKey && selectedId === taskId && $('#settings-dialog').open && settingsPane === 'models' && document.activeElement === document.body) $$('#route-form input').find(input=>input.name===focusKey.name && input.value===focusKey.value)?.focus({preventScroll:true}); }
}

function benchmarkParts(value) {
  if (!value) return { status: 'idle', report: null };
  if (value.report) return { status: value.status ?? 'completed', report: value.report, progress: value.progress, error: value.error };
  if (value.summary || value.cases) return { status: value.finishedAt ? 'completed' : value.status ?? 'completed', report: value };
  return { status: value.status ?? 'idle', report: null, progress: value.progress, error: value.error };
}

function renderBenchmark(value, force = false) {
  const signature = JSON.stringify(value);
  if (!force && signature === benchmarkSignature) return;
  benchmarkSignature = signature;
  const { status, report, progress, error } = benchmarkParts(value);
  const running = ['running', 'starting', 'queued'].includes(status);
  $('#benchmark-run').disabled = running;
  $('#benchmark-run').innerHTML = running ? '<span class="spinner"></span> Running…' : `${report ? 'Run again' : 'Run benchmark'} <span aria-hidden="true">↗</span>`;
  let html = '<div class="bench-label">SCRIPTED FAULT INJECTION · NOT A MODEL BENCHMARK</div>';
  if (running) html += `<div class="bench-running"><span class="spinner"></span><span>Executing the fault suite${progress ? ` · ${escapeHTML(typeof progress === 'string' ? progress : pretty(progress))}` : '…'}</span></div>`;
  if (error) html += `<div class="inline-error">${escapeHTML(typeof error === 'string' ? error : pretty(error))}</div>`;
  if (report) {
    const summary = report.summary ?? {};
    html += `<div class="benchmark-stats"><div class="benchmark-stat"><strong>${escapeHTML(summary.total ?? report.cases?.length ?? '—')}</strong><span>CASES RECORDED</span></div><div class="benchmark-stat pass"><strong>${escapeHTML(summary.passed ?? '—')}</strong><span>PASSED</span></div><div class="benchmark-stat fail"><strong>${escapeHTML(summary.failed ?? '—')}</strong><span>FAILED</span></div></div><div class="benchmark-meta">${running ? 'Most recent report · ' : ''}${report.finishedAt ? `Recorded ${escapeHTML(new Date(report.finishedAt).toLocaleString())} · ` : ''}${duration(report.durationMs)}${report.evidenceKind ? ` · ${escapeHTML(report.evidenceKind)}` : ''}</div>`;
    html += (report.cases ?? []).map((test) => `<details class="benchmark-case"><summary><span class="check-icon ${test.passed ? 'pass' : 'fail'}" aria-label="${test.passed ? 'passed' : 'failed'}">${test.passed ? '✓' : '×'}</span><span class="benchmark-case-name">${escapeHTML(test.title ?? test.id)}</span><span class="benchmark-case-category">${escapeHTML(test.category ?? '')}</span><span class="activity-time">${duration(test.durationMs)}</span></summary><pre tabindex="0" role="region" aria-label="Benchmark case evidence">${escapeHTML(pretty(test.evidence ?? test))}</pre></details>`).join('');
  } else if (!running) html += '<div class="panel-empty"><span class="panel-empty-icon" aria-hidden="true">◈</span><div><h3>No benchmark results yet.</h3><p>Run the suite to record real fault-injection outcomes.<br>Results appear here when the runtime returns them.</p></div></div>';
  $('#benchmark-content').innerHTML = html;
}

async function saveTaskAsSkillAction(task, explicitName = '') {
  if (!task?.id || stripActionBusy) return;
  const defaultSlug = String(explicitName || task.title || task.objective || 'saved-workflow')
    .toLowerCase()
    .replace(/^✦\s*conclave\s*:\s*/i, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 36) || 'saved-workflow';
  const chosen = explicitName || window.prompt('Save this run as a reusable slash skill (lowercase letters, digits, - or _):', defaultSlug);
  if (!chosen || !chosen.trim()) return;
  stripActionBusy = true;
  renderTaskMetaStrip(task);
  try {
    const res = await api(`/api/tasks/${encodeURIComponent(task.id)}/save-skill`, {
      method: 'POST',
      body: JSON.stringify({ name: chosen.trim() }),
    });
    await loadSkills(task.id);
    await refresh();
    toast(`✦ Saved reusable skill ${res.skill?.command || `/${chosen.trim()}`} — type it in any chat!`);
  } catch (err) {
    toast(err?.message || 'Could not save skill.');
  } finally {
    stripActionBusy = false;
    if (selectedData?.task) renderTaskMetaStrip(selectedData.task);
  }
}

async function openBenchmark() {
  dismissDrawers();
  setVisible('#benchmark-error', false);
  renderBenchmark(state.benchmark, true);
  if (!$('#benchmark-dialog').open) $('#benchmark-dialog').showModal();
  try { state.benchmark = await api('/api/bench'); renderBenchmark(state.benchmark, true); }
  catch (error) { errorIn('#benchmark-error', error); }
}

async function runBenchmark() {
  $('#benchmark-run').disabled = true;
  setVisible('#benchmark-error', false);
  try {
    await api('/api/bench', { method: 'POST', body: '{}' });
    state.benchmark = { status: 'running', report: benchmarkParts(state.benchmark).report };
    renderBenchmark(state.benchmark, true);
    await refresh();
  } catch (error) { errorIn('#benchmark-error', error); $('#benchmark-run').disabled = false; }
}

function renderAbout() {
  const el = $('#about-content');
  if (!el) return;
  const capabilities = Array.isArray(state.capabilities) ? state.capabilities : [];
  const limitations = Array.isArray(state.limitations) ? state.limitations : [];
  const list = (items) => items.map((item) => `<li>${escapeHTML(typeof item === 'string' ? item : pretty(item))}</li>`).join('');
  const nextHtml = `<p class="modal-intro"><span class="wordmark" role="img" aria-label="GodMode">GODMODƎ</span> ${escapeHTML(state.version ?? 'MVP')} · local-first experimental research demo. Provided AS IS without warranty of any kind.</p><section class="about-section"><h3>LICENSE &amp; LEGAL NOTICE</h3><ul><li><strong>License:</strong> Dual-licensed under GNU AGPL-3.0 (open source) or Commercial license. Bundles Highlight.js (BSD-3-Clause) and GodMode Display / JetBrains Mono (SIL OFL 1.1).</li><li><strong>No Warranty &amp; User Responsibility:</strong> Experimental research software provided &ldquo;AS IS&rdquo; with no warranty or author liability. You are solely responsible for complying with applicable local laws and the Terms of Service of any third-party AI providers, CLI subscriptions, or websites you access.</li><li><strong>Trademarks:</strong> Third-party names (Anthropic, Claude, OpenAI, ChatGPT, Codex, Google, Gemini, GitHub, Copilot, OpenRouter, Venice, Nous, Ollama, Apple) belong to their respective owners; this independent project is not affiliated with or endorsed by them.</li></ul></section><section class="about-section"><h3>REPORTED CAPABILITIES</h3>${capabilities.length ? `<ul>${list(capabilities)}</ul>` : '<p class="small-copy muted">The runtime has not returned a capability list.</p>'}</section><section class="about-section"><h3>REPORTED LIMITATIONS</h3>${limitations.length ? `<ul>${list(limitations)}</ul>` : '<p class="small-copy muted">The runtime has not returned a limitation list. This is an early build; do not infer production guarantees.</p>'}</section><section class="about-section"><h3>EVIDENCE LABELS</h3><ul><li>Scripted providers produce deterministic responses for testing the controller.</li><li>Live providers send requests to the configured model service. Availability is reported by the server.</li><li>Benchmark passes report scripted fault checks, not universal recovery or live coding quality.</li></ul></section>`;
  if (el.dataset.lastHtml === nextHtml) return;
  el.dataset.lastHtml = nextHtml;
  el.innerHTML = nextHtml;
}

document.addEventListener('click', (event) => {
  $$('.task-more[open]').forEach(menu=>{if(!menu.contains(event.target)||event.target.closest('button,a'))menu.open=false;});
  const command = event.target.closest('[data-command-index]');
  if (command) { runCommand(Number(command.dataset.commandIndex)); return; }
  const fileButton = event.target.closest('[data-open-file]');
  if (fileButton) { fileSelections.set(selectedId,fileButton.dataset.openFile); renderFileTree(); renderFilePreview(); $$('.file-tree-item').find(item => item.dataset.openFile === fileSelections.get(selectedId))?.focus({preventScroll:true}); return; }
  const pageButton = event.target.closest('[data-file-page]');
  if (pageButton) {
    const pane = pageButton.dataset.pane || '';
    const path = pane === 'pane-right' ? splitPaneFile : fileSelections.get(selectedId);
    const key = pane ? `${selectedId}:${path}:${pane}` : `${selectedId}:${path}`;
    filePages.set(key, (filePages.get(key) || 0) + Number(pageButton.dataset.filePage));
    renderFilePreview();
    (pane ? $(`#${pane} .file-code`) : $('.file-code'))?.focus();
    return;
  }
  const copyFileBtn = event.target.closest('[data-copy-file]');
  if (copyFileBtn) {
    const targetPath = copyFileBtn.closest('#pane-right') ? splitPaneFile : fileSelections.get(selectedId);
    const file = selectedData?.files?.find(file => file.path === targetPath);
    if (file) navigator.clipboard.writeText(typeof file.content === 'string' ? file.content : pretty(file.content)).then(() => toast('File copied.')).catch(() => toast('Clipboard unavailable. Select the file contents to copy.'));
    return;
  }
  const crewButton = event.target.closest('[data-crew-action]');
  if (crewButton) { crewAction(crewButton.dataset.crewAction); return; }
  if (event.target.closest('[data-crew-review]')) { openCrewReview(); return; }
  const removeMention = event.target.closest('[data-remove-mention]');
  if (removeMention) { removeDraftMention(removeMention.dataset.removeMention); return; }
  const addCheck = event.target.closest('[data-add-check]');
  if (addCheck) {
    const command = addCheck.dataset.addCheck;
    const checksInput = $('#create-checks');
    const execToggle = $('#create-execution');
    if (command && checksInput) {
      const existing = checksInput.value.split('\n').map(s => s.trim()).filter(Boolean);
      if (!existing.includes(command)) {
        checksInput.value = [...existing, command].join('\n');
        toast(`Added check: ${command}`);
      } else {
        toast(`Check already added: ${command}`);
      }
      addCheck.classList.add('is-added');
      const plus = $('.check-chip-plus', addCheck);
      if (plus) plus.textContent = '✓';
    }
    if (execToggle && !execToggle.disabled && !execToggle.checked) {
      execToggle.checked = true;
      execToggle.dispatchEvent(new Event('change'));
    }
    return;
  }
  const approvalBtn = event.target.closest('[data-approval-decision]');
  if (approvalBtn && selectedData?.task) {
    resolveApprovalAction(selectedData.task, approvalBtn.dataset.approvalDecision);
    return;
  }
  const forkCp = event.target.closest('[data-fork-checkpoint]');
  if (forkCp && selectedData?.task) {
    forkTaskAction(selectedData.task, { fromHash: forkCp.dataset.forkCheckpoint });
    return;
  }
  const restoreCp = event.target.closest('[data-restore-checkpoint]');
  if (restoreCp && selectedData?.task) {
    const hash = restoreCp.dataset.restoreCheckpoint;
    confirmModal({
      title: 'Restore Git checkpoint?',
      message: `This runs git reset --hard and git clean -fd to ${hash.slice(0, 8)}, discarding later commits and uncommitted workspace edits.`,
      confirmLabel: 'Restore checkpoint',
      danger: true,
    }).then(ok => { if (ok && selectedData?.task) restoreCheckpointAction(selectedData.task, hash); });
    return;
  }
  const commitToggle = event.target.closest('[data-commit-toggle]');
  if (commitToggle && selectedData?.task) {
    commitFormOpen = !commitFormOpen;
    changesSignature = '';
    renderChanges(selectedData.diff || []);
    if (commitFormOpen) $('#changes-commit-message')?.focus();
    return;
  }
  if (event.target.closest('[data-commit-cancel]')) {
    commitFormOpen = false;
    changesSignature = '';
    if (selectedData) renderChanges(selectedData.diff || []);
    return;
  }
  if (event.target.closest('[data-open-privacy]')) {
    openSettings('privacy');
    return;
  }
  const renameCurrent = event.target.closest('[data-rename-current]');
  if (renameCurrent && selectedData?.task) {
    renameCurrent.closest('details')?.removeAttribute('open');
    startInlineRename(selectedData.task, $('#selected-title'));
    return;
  }
  const renameRowBtn = event.target.closest('[data-rename-task]');
  if (renameRowBtn) {
    event.stopPropagation();
    const t = state.tasks.find(item => item.id === renameRowBtn.dataset.renameTask);
    const nameEl = renameRowBtn.closest('.task-item-row')?.querySelector('.task-item-name');
    if (t && nameEl) startInlineRename(t, nameEl);
    return;
  }
  const deleteRowBtn = event.target.closest('[data-delete-task]');
  if (deleteRowBtn) {
    event.stopPropagation();
    const t = state.tasks.find(item => item.id === deleteRowBtn.dataset.deleteTask);
    if (t) purgeTaskAction(t);
    return;
  }
  const purgeBtn = event.target.closest('[data-purge-task]');
  if (purgeBtn && selectedData?.task) {
    purgeBtn.closest('details')?.removeAttribute('open');
    purgeTaskAction(selectedData.task);
    return;
  }
  const copyTranscript = event.target.closest('[data-copy-transcript]');
  if (copyTranscript && selectedData?.task) {
    copyTranscriptAction(selectedData.task, copyTranscript.classList.contains('copy-transcript-btn') ? copyTranscript : null);
    return;
  }
  const copyPr = event.target.closest('[data-copy-pr-summary]');
  if (copyPr && selectedData?.task) {
    const diff = selectedData.diff || [];
    const statsByPath = new Map(diff.map(item => [item.path, diffFileStats(item)]));
    const md = formatPrSummaryMarkdown(selectedData.task, diff, statsByPath);
    navigator.clipboard.writeText(md)
      .then(() => {
        copyPr.classList.add('copied');
        copyPr.textContent = 'Copied ✓';
        clearTimeout(copyCodeTimers.get(copyPr));
        copyCodeTimers.set(copyPr, setTimeout(() => {
          copyPr.classList.remove('copied');
          copyPr.textContent = 'Copy PR summary';
        }, 1800));
        toast('PR summary copied to clipboard.');
      })
      .catch(error => toast(error?.message || 'Could not copy PR summary.'));
    return;
  }
  const copyPatch = event.target.closest('[data-copy-patch]');
  if (copyPatch && selectedData?.task) {
    const taskId = selectedData.task.id;
    copyPatch.disabled = true;
    fetch(`/api/tasks/${encodeURIComponent(taskId)}/patch`, { cache: 'no-store' })
      .then(async res => {
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || `Patch export failed (${res.status}).`);
        }
        return res.text();
      })
      .then(patchText => navigator.clipboard.writeText(patchText))
      .then(() => {
        copyPatch.classList.add('copied');
        copyPatch.textContent = 'Copied ✓';
        clearTimeout(copyCodeTimers.get(copyPatch));
        copyCodeTimers.set(copyPatch, setTimeout(() => {
          copyPatch.classList.remove('copied');
          copyPatch.textContent = 'Copy patch';
        }, 1800));
        toast('Patch copied.');
      })
      .catch(error => toast(error?.message || 'Could not copy patch.'))
      .finally(() => { copyPatch.disabled = false; });
    return;
  }
  const stripAction = event.target.closest('[data-strip-action]');
  if (stripAction) {
    const task = selectedData?.task;
    if (task && stripAction.dataset.stripAction === 'compact') compactTaskAction(task);
    else if (task && stripAction.dataset.stripAction === 'undo') {
      confirmModal({
        title: 'Undo latest workspace checkpoint?',
        message: 'This resets workspace files to the previous git checkpoint and discards uncommitted edits.',
        confirmLabel: 'Undo checkpoint',
        danger: true,
      }).then(ok => { if (ok) rewindTaskAction(task, 1); });
    }
    else if (task && stripAction.dataset.stripAction === 'fork') forkTaskAction(task);
    else if (task && stripAction.dataset.stripAction === 'save-skill') saveTaskAsSkillAction(task);
    return;
  }
  const wrapCode = event.target.closest('[data-wrap-code]');
  if (wrapCode) {
    const pre = wrapCode.closest('.message-code-block')?.querySelector('pre.message-code');
    if (pre) {
      const wrapped = pre.classList.toggle('is-wrapped');
      wrapCode.setAttribute('aria-pressed', String(wrapped));
      wrapCode.classList.toggle('is-active', wrapped);
    }
    return;
  }
  const collapseCode = event.target.closest('[data-collapse-code]');
  if (collapseCode) {
    const block = collapseCode.closest('.message-code-block');
    if (block) {
      const collapsed = block.classList.toggle('is-collapsed');
      collapseCode.setAttribute('aria-expanded', String(!collapsed));
      collapseCode.textContent = collapsed ? 'Expand' : 'Collapse';
    }
    return;
  }
  const codeHeaderClick = event.target.closest('.message-code-header');
  if (codeHeaderClick && !event.target.closest('button')) {
    const btn = codeHeaderClick.querySelector('[data-collapse-code]');
    if (btn) { btn.click(); return; }
  }
  const copyCode = event.target.closest('[data-copy-code]');
  if (copyCode) {
    const fullCopyText = copyCode.dataset.copyFullId && window.__g0dFileCopyStore?.get(copyCode.dataset.copyFullId);
    const codeEl = copyCode.closest('.message-code-block')?.querySelector('pre code') || copyCode.closest('.file-card')?.querySelector('pre code');
    const textToCopy = typeof fullCopyText === 'string' ? fullCopyText : codeEl?.textContent;
    if (typeof textToCopy === 'string') {
      if (!copyCode.dataset.defaultLabel) copyCode.dataset.defaultLabel = copyCode.textContent.trim() || 'Copy';
      navigator.clipboard.writeText(textToCopy).then(() => {
        copyCode.classList.add('copied');
        copyCode.textContent = 'Copied ✓';
        clearTimeout(copyCodeTimers.get(copyCode));
        copyCodeTimers.set(copyCode, setTimeout(() => {
          copyCode.classList.remove('copied');
          copyCode.textContent = copyCode.dataset.defaultLabel || 'Copy';
        }, 1800));
        toast('Code copied.');
      }).catch(() => toast('Copy unavailable. Select the code block to copy it.'));
    }
    return;
  }
  const zoomImg = event.target.closest('[data-zoom-image]');
  if (zoomImg) {
    const overlay = document.createElement('div');
    overlay.className = 'preview-overlay';
    overlay.innerHTML = `<div class="preview-frame image-lightbox-frame"><div class="preview-toolbar"><span>${escapeHTML(zoomImg.dataset.zoomName || 'Image')}</span><button type="button" class="icon-button" aria-label="Close image preview">×</button></div><div class="image-lightbox-body"><img src="${escapeHTML(zoomImg.dataset.zoomImage)}" alt="${escapeHTML(zoomImg.dataset.zoomName || 'Image preview')}"></div></div>`;
    document.body.appendChild(overlay);
    const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
    const close = () => { document.removeEventListener('keydown', onKey); overlay.remove(); };
    document.addEventListener('keydown', onKey);
    overlay.querySelector('.icon-button').addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    return;
  }
  const openFileBtn = event.target.closest('[data-open-workspace-file]');
  if (openFileBtn && selectedId) {
    fileSelections.set(selectedId, openFileBtn.dataset.openWorkspaceFile);
    renderFileTree();
    renderFilePreview();
    chooseTab('files');
    return;
  }
  const toggleDockBtn = event.target.closest('[data-toggle-artifact-dock]');
  if (toggleDockBtn && lastDetectedArtifact) {
    if (lastDetectedArtifact.source === 'agent-browser' && window.G0DBrowserLive?.toggle) {
      window.G0DBrowserLive.toggle();
    } else if (artifactDockState.open) {
      closeArtifactDock({ recordDismiss: true });
    } else if (lastDetectedArtifact.source === 'agent-browser') {
      openAgentBrowserDock(lastDetectedArtifact);
    } else if (lastDetectedArtifact.source === 'workspace') {
      openLivePreview({ taskId: lastDetectedArtifact.taskId, entry: lastDetectedArtifact.entry, title: lastDetectedArtifact.title, artifactKey: lastDetectedArtifact.artifactKey });
    } else {
      openLivePreview({ html: lastDetectedArtifact.html, files: lastDetectedArtifact.files, entry: lastDetectedArtifact.entry, title: lastDetectedArtifact.title, artifactKey: lastDetectedArtifact.artifactKey });
    }
    return;
  }
  const wsPreviewBtn = event.target.closest('[data-workspace-preview]');
  if (wsPreviewBtn && selectedId) {
    openLivePreview({ taskId: selectedId, entry: wsPreviewBtn.dataset.workspacePreview });
    return;
  }
  const continueBtn = event.target.closest('[data-continue-output]');
  if (continueBtn && selectedData?.task) {
    const tid = continueBtn.dataset.continueOutput;
    continueBtn.disabled = true;
    toast('Continuing from where it stopped…');
    api(`/api/tasks/${encodeURIComponent(tid)}/message`, {
      method: 'POST',
      body: JSON.stringify({ message: 'Continue seamlessly from the exact character where you stopped without repeating anything.', messageId: crypto.randomUUID(), mode: 'queue' })
    }).then(() => refresh()).catch(err => {
      toast(err.message || 'Could not continue response.');
      continueBtn.disabled = false;
    });
    return;
  }
  const inlineCrown = event.target.closest('[data-inline-crown]');
  if (inlineCrown && selectedData?.task) {
    const winnerId = inlineCrown.dataset.inlineCrown;
    const raceId = inlineCrown.dataset.inlineRaceId || null;
    inlineCrown.disabled = true;
    api(`/api/tasks/${encodeURIComponent(selectedData.task.id)}/race-crown`, {
      method: 'POST',
      body: JSON.stringify({ winnerId, raceId })
    }).then(res => {
      const lbl = providerById(winnerId)?.label || winnerId;
      const d = res.delta >= 0 ? `+${res.delta}` : String(res.delta);
      toast(`👑 Crowned ${lbl} (${d} Elo → ${res.eloAfter} · ${res.tier?.label || 'Ranked'})`);
      inlineCrown.textContent = `👑 Crowned (${d})`;
      window.G0DConclave?.loadLeaderboard?.();
    }).catch(err => {
      toast(err.message || 'Could not crown contender.');
      inlineCrown.disabled = false;
    });
    return;
  }
  const regenBtn = event.target.closest('[data-regenerate-last]');
  if (regenBtn && selectedData?.task) {
    const task = selectedData.task;
    if (task.workspaceKind !== 'conversation' || ACTIVE.has(task.status) || task.draining || isCrewBusy(task)) return;
    const lastFollowup = task.followups?.at(-1);
    const messageId = lastFollowup ? lastFollowup.id : 'objective';
    const message = lastFollowup ? lastFollowup.message : task.objective;
    regenBtn.disabled = true;
    toast('Regenerating response…');
    api(`/api/tasks/${encodeURIComponent(task.id)}/rewind`, {
      method: 'POST',
      body: JSON.stringify({ messageId, revision: task.conversationRevision || 0, message, regenerate: true })
    }).then(() => refresh()).catch(err => {
      toast(err.message || 'Could not regenerate response.');
      regenBtn.disabled = false;
    });
    return;
  }
  const previewCodeBtn = event.target.closest('[data-preview-code]');
  if (previewCodeBtn) {
    const blockEl = previewCodeBtn.closest('.message-code-block');
    const msgEl = previewCodeBtn.closest('.message-assistant');
    const codeEl = blockEl?.querySelector('pre code');
    if (codeEl) {
      const lang = (previewCodeBtn.dataset.previewLang || 'html').toLowerCase();
      if (lang === 'mermaid' && typeof window.renderMermaidToSvg === 'function') {
        const svg = window.renderMermaidToSvg(codeEl.textContent);
        if (svg) {
          openLivePreview({ html: svg, files: { 'diagram.mmd': codeEl.textContent, 'diagram.svg': svg }, entry: 'diagram.svg', title: 'Mermaid Diagram', auto: false });
          return;
        }
      }
      const rawMsgText = msgEl?.querySelector('.copy-response')?.dataset.copyText || '';
      const bundle = lang === 'svg'
        ? { html: codeEl.textContent, files: { 'preview.svg': codeEl.textContent }, entry: 'preview.svg', title: 'preview.svg' }
        : (rawMsgText ? extractArtifactBundle(rawMsgText) : null) || (msgEl ? extractBundleFromMessageElement(msgEl, blockEl) : null);
      if (bundle) {
        openLivePreview({ html: bundle.html, files: bundle.files, entry: bundle.entry, title: bundle.title, auto: false });
      } else {
        openLivePreview({ html: codeEl.textContent, title: lang === 'svg' ? 'preview.svg' : 'preview.html', auto: false });
      }
    }
    return;
  }
  const previewBtn = event.target.closest('[data-preview-content]');
  if (previewBtn) {
    try {
      const html = decodeURIComponent(escape(atob(previewBtn.dataset.previewContent)));
      const fileTitle = previewBtn.closest('.file-card')?.querySelector('.file-card-path')?.textContent?.trim() || 'preview.html';
      openLivePreview({ html, title: fileTitle });
    } catch { toast('Preview failed.'); }
    return;
  }
  if (event.target.closest('[data-source-preview]')) { openSourceReview(); return; }
  const undoSource = event.target.closest('[data-source-undo]');
  if (undoSource) { openSourceReview('undo', undoSource.dataset.sourceUndo); return; }
  const inspectSource = event.target.closest('[data-source-inspect]');
  if (inspectSource) { inspectSourceApplication(inspectSource.dataset.sourceInspect); return; }
  const removeMessage = event.target.closest('[data-remove-message]');
  if (removeMessage && selectedId) {
    const taskId = selectedId;
    removeMessage.disabled = true;
    api(`/api/tasks/${encodeURIComponent(taskId)}/message`, { method: 'DELETE', body: JSON.stringify({ messageId: removeMessage.dataset.removeMessage }) })
      .then(() => refresh()).catch(error => { toast(error.message); removeMessage.disabled = false; });
    return;
  }
  const close = event.target.closest('[data-close]');
  if (close) { document.getElementById(close.dataset.close)?.close(); return; }
  const taskButton = event.target.closest('[data-select-task]');
  if (taskButton) { selectTask(taskButton.dataset.selectTask); return; }
  const starter = event.target.closest('[data-starter-prompt]');
  if (starter) {
    const input = $('#composer-input');
    if (input) { input.value = starter.dataset.starterPrompt; input.focus(); resizeComposer(); renderComposer(); }
    return;
  }
  const fixture = event.target.closest('[data-create-fixture]');
  if (fixture) { if ($('#settings-dialog')?.open) $('#settings-dialog').close(); openCreate(fixture.dataset.createFixture); return; }
  const source = event.target.closest('[data-create-source]');
  if (source) { setCreateSource(source.dataset.createSource); return; }
  const action = event.target.closest('[data-action]');
  if (action) { taskAction(action.dataset.action); return; }
  const tab = event.target.closest('[data-tab]');
  if (tab) { chooseTab(tab.dataset.tab); return; }
  if (event.target.closest('[data-mobile-inspector]')) setInspector(true, true);
});

$('#source-review-confirm').addEventListener('click', confirmSourceReview);
$('#source-review-files').addEventListener('change', event => {
  const input = event.target.closest('[data-source-file]'), review = sourceReview;
  if (!input || review?.mode !== 'apply' || !review.files || sourceActionBusy || review.failed) return;
  const file = review.files[Number(input.dataset.sourceFile)];
  if (file && !file.conflict) { if (input.checked) review.selected.add(file.path); else review.selected.delete(file.path); }
  updateSourceSelection();
});
$('#source-select-all').addEventListener('click', () => {
  if (!sourceReview?.selected || sourceActionBusy || sourceReview.failed) return;
  sourceReview.selected = new Set(sourceReview.files.filter(file => !file.conflict).map(file => file.path)); updateSourceSelection();
});
$('#source-select-none').addEventListener('click', () => {
  if (!sourceReview?.selected || sourceActionBusy || sourceReview.failed) return;
  sourceReview.selected.clear(); updateSourceSelection();
});
$('#source-review-dialog').addEventListener('close', () => { sourceReview = null; });
$('#crew-review-confirm').addEventListener('click', confirmCrewReview);
$('#crew-review-dialog').addEventListener('close', () => { crewReview = null; ($('[data-crew-review]') || $('#crew-details > summary'))?.focus({ preventScroll: true }); });

$('#command-open')?.addEventListener('click', openCommands);
$('#header-command-open')?.addEventListener('click', openCommands);
$('#conclave-toggle-btn')?.addEventListener('click', () => window.G0DConclave?.toggle());
$('#browser-toggle-btn')?.addEventListener('click', () => window.G0DBrowserLive?.toggle());
$('#command-palette-dialog')?.addEventListener('close', () => { if (commandReturnFocus?.isConnected && !commandReturnFocus.closest('[inert]')) commandReturnFocus.focus({ preventScroll: true }); });
$('#palette-input')?.addEventListener('input', () => { commandIndex = 0; renderCommands(); });
$('#palette-input')?.addEventListener('keydown', event => {
  if (event.isComposing) return;
  if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    event.preventDefault();
    commandIndex = event.key === 'Home' ? 0 : event.key === 'End' ? commandItems.length - 1 : Math.max(0, Math.min(commandItems.length - 1, commandIndex + (event.key === 'ArrowDown' ? 1 : -1)));
    renderCommands(); $(`#command-option-${commandIndex}`)?.scrollIntoView({ block: 'nearest' });
  } else if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); runCommand(commandIndex); }
});
$('#panel-changes').addEventListener('submit', event => {
  if (event.target.id === 'changes-commit-form') {
    event.preventDefault();
    if (selectedData?.task) commitWorkspaceAction(selectedData.task, $('#changes-commit-message')?.value || '');
  }
});
$('#panel-changes').addEventListener('keydown', event => {
  if (event.key === 'Escape' && event.target.id === 'changes-commit-message') {
    event.preventDefault();
    commitFormOpen = false;
    changesSignature = '';
    if (selectedData) renderChanges(selectedData.diff || []);
  }
});
$('#panel-changes').addEventListener('change', event => { if (event.target.id === 'change-file') { changeSelections.set(selectedId, event.target.value); renderChanges(selectedData?.diff || []); $('#change-file')?.focus({ preventScroll: true }); } });
$('#panel-changes').addEventListener('submit', event => {
  const form = event.target.closest('[data-diff-comment-form]');
  if (!form) return;
  event.preventDefault();
  const note = form.querySelector('.diff-comment-input')?.value?.trim();
  if (!note) return;
  const ref = `@${form.dataset.commentPath}:L${form.dataset.commentLine}`;
  const input = $('#composer-input');
  if (input) {
    const prefix = input.value.trim() ? input.value.trimEnd() + '\n' : '';
    input.value = `${prefix}${ref} ${note}`;
    captureComposerDraft();
    resizeComposer();
    renderComposer();
  }
  diffCommentTarget = null;
  changesSignature = '';
  if (selectedData) renderChanges(selectedData.diff || []);
  toast(`Queued review note for ${ref} in composer.`);
});
document.addEventListener('click', event => {
  const splitBtn = event.target.closest('[data-split-view]');
  if (splitBtn) {
    const files = selectedData?.files || [];
    const current = fileSelections.get(selectedId);
    const other = files.find(f => f.path !== current);
    if (other) { splitPaneFile = other.path; renderFilePreview(); }
    return;
  }
  const closeSplit = event.target.closest('[data-close-split]');
  if (closeSplit) { splitPaneFile = null; renderFilePreview(); return; }
  const diffModeBtn = event.target.closest('[data-diff-view-mode]');
  if (diffModeBtn) {
    const mode = diffModeBtn.dataset.diffViewMode;
    if (mode === 'unified' || mode === 'split') {
      diffViewMode = mode;
      try { localStorage.setItem('g0dc0d3.diffViewMode', mode); } catch {}
      changesSignature = '';
      if (selectedData) renderChanges(selectedData.diff || []);
    }
    return;
  }
  const diffCommentBtn = event.target.closest('[data-diff-comment]');
  if (diffCommentBtn) {
    diffCommentTarget = {
      path: diffCommentBtn.dataset.commentPath,
      line: Number(diffCommentBtn.dataset.commentLine) || 1,
      side: diffCommentBtn.dataset.commentSide || 'new',
    };
    changesSignature = '';
    if (selectedData) renderChanges(selectedData.diff || []);
    setTimeout(() => $('.diff-comment-input')?.focus(), 0);
    return;
  }
  if (event.target.closest('[data-diff-comment-cancel]')) {
    diffCommentTarget = null;
    changesSignature = '';
    if (selectedData) renderChanges(selectedData.diff || []);
    return;
  }
  const diffItem = event.target.closest('[data-select-diff]');
  if (diffItem) { changeSelections.set(selectedId, diffItem.dataset.selectDiff); renderChanges(selectedData?.diff || []); return; }
  const viewChange = event.target.closest('[data-view-change]');
  if (viewChange) { changeSelections.set(selectedId, viewChange.dataset.viewChange); $$('.workspace-tab').find(tab => tab.dataset.tab === 'changes')?.click(); return; }
  const copyBtn = event.target.closest('[data-copy-text]');
  if (copyBtn) {
    if (!copyBtn.dataset.origHtml) copyBtn.dataset.origHtml = copyBtn.innerHTML;
    const isIconOnly = Boolean(copyBtn.querySelector('svg')) && !copyBtn.textContent.trim();
    navigator.clipboard.writeText(copyBtn.dataset.copyText).then(() => {
      copyBtn.classList.add('copied');
      if (isIconOnly) {
        copyBtn.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 10l3 3 7-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      } else {
        copyBtn.textContent = 'Copied ✓';
      }
      setTimeout(() => {
        copyBtn.classList.remove('copied');
        copyBtn.innerHTML = copyBtn.dataset.origHtml || 'Copy';
      }, 1500);
    }).catch(() => {});
    return;
  }
  const hunkBtn = event.target.closest('[data-hunk-action]');
  if (hunkBtn && selectedId && selectedData?.diff) {
    const filePath = hunkBtn.dataset.hunkPath;
    const hunkIndex = parseInt(hunkBtn.dataset.hunkIndex, 10);
    const action = hunkBtn.dataset.hunkAction;
    if (action === 'accept') {
      const hunkEl = hunkBtn.closest('.diff-hunk');
      const rKey = `${selectedId}:${filePath}:${hunkIndex}`;
      const reviewed = hunkEl?.classList.toggle('is-reviewed');
      if (reviewed) reviewedHunks.add(rKey);
      else reviewedHunks.delete(rKey);
      hunkBtn.setAttribute('aria-pressed', String(Boolean(reviewed)));
      toast(reviewed ? 'Hunk marked reviewed.' : 'Hunk review mark cleared.');
      return;
    }
    const entry = selectedData.diff.find(d => d.path === filePath);
    if (!entry || entry.before == null || entry.after == null) {
      toast('Hunk-level reject is only available for modified files.');
      return;
    }
    const newContent = reconstructFileWithHunkAction(entry.before, entry.after, hunkIndex, action);
    if (newContent == null) return;
    const taskId = selectedId;
    hunkBtn.disabled = true;
    api(`/api/tasks/${encodeURIComponent(taskId)}/hunk`, {
      method: 'POST', body: JSON.stringify({ path: filePath, content: newContent })
    }).then(result => {
      if (result.diff && selectedId === taskId && selectedData) { selectedData.diff = result.diff; changesSignature = ''; renderChanges(result.diff); }
    }).catch(err => { toast(err.message || 'Hunk edit failed'); })
    .finally(() => { hunkBtn.disabled = false; });
    return;
  }
}, true);
$('#panel-files').addEventListener('input',event=>{if(event.target.id==='file-filter'){fileQueries.set(selectedId,event.target.value);renderFileTree();}});
let composerAttachments = [];
let composerFileAttachments = [];

function clearComposerAttachments() {
  composerAttachments = [];
  composerFileAttachments = [];
  renderComposerAttachments();
}

function renderComposerAttachments() {
  const tray = $('#composer-attachments');
  if (!tray) return;
  const total = composerAttachments.length + composerFileAttachments.length;
  tray.classList.toggle('hidden', !total);
  if (!total) { tray.innerHTML = ''; renderComposer(); return; }
  const imgChips = composerAttachments.map((att, idx) =>
    `<span class="attachment-chip" role="listitem"><img class="attachment-thumb" src="${escapeHTML(att.dataUrl)}" alt="${escapeHTML(att.name)}"><span class="attachment-name">${escapeHTML(att.name)}</span><button type="button" class="icon-button attachment-remove" data-remove-attachment="${idx}" aria-label="Remove ${escapeHTML(att.name)}">×</button></span>`
  );
  const fileChips = composerFileAttachments.map((f, idx) =>
    `<span class="attachment-chip attachment-file-chip" role="listitem"><span class="attachment-file-icon" aria-hidden="true">📄</span><span class="attachment-name" title="${escapeHTML(f.name)}">${escapeHTML(f.name)}</span><span class="attachment-file-size">${escapeHTML(f.meta || '')}</span><button type="button" class="icon-button attachment-remove" data-remove-file-attachment="${idx}" aria-label="Remove ${escapeHTML(f.name)}">×</button></span>`
  );
  tray.innerHTML = [...imgChips, ...fileChips].join('');
  renderComposer();
}

async function encodeImageAttachment(file) {
  const allowed = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
  const mediaType = allowed.has(file.type) ? file.type : 'image/png';
  const rawUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Could not read image file.'));
    reader.readAsDataURL(file);
  });
  // Downscale large screenshots & strip EXIF via canvas (preserve GIF animation as-is if small).
  if (mediaType === 'image/gif' && rawUrl.length <= 3 * 1024 * 1024) {
    return { name: (file.name || 'pasted.gif').slice(0, 120), mediaType, dataUrl: rawUrl };
  }
  const img = await new Promise((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('Invalid image data.'));
    el.src = rawUrl;
  });
  const maxDim = 1600;
  const scale = Math.min(1, maxDim / Math.max(img.width || 1, img.height || 1));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(img, 0, 0, w, h);
  const outType = mediaType === 'image/png' ? 'image/png' : 'image/jpeg';
  let dataUrl = canvas.toDataURL(outType, 0.88);
  if (dataUrl.length > 3.5 * 1024 * 1024) dataUrl = canvas.toDataURL('image/jpeg', 0.78);
  const finalType = dataUrl.startsWith('data:image/jpeg') ? 'image/jpeg' : outType;
  return { name: (file.name || `screenshot.${finalType === 'image/png' ? 'png' : 'jpg'}`).slice(0, 120), mediaType: finalType, dataUrl };
}

async function addComposerFiles(fileList, sourceLabel = '') {
  const files = [...(fileList || [])].filter(Boolean);
  if (!files.length) return 0;
  let added = 0;
  for (const file of files) {
    if (/^image\/(png|jpeg|webp|gif)$/i.test(file.type)) {
      if (composerAttachments.length >= 4) { toast('Up to 4 images per message.'); continue; }
      try {
        composerAttachments.push(await encodeImageAttachment(file));
        added++;
      } catch (err) {
        toast(err.message || 'Could not attach image.');
      }
      continue;
    }
    if (composerFileAttachments.length >= 6) { toast('Up to 6 document/code files per message.'); continue; }
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
    if (isPdf) {
      if (file.size > 6 * 1024 * 1024) { toast(`${file.name} exceeds the 6 MB PDF limit.`); continue; }
      try {
        const dataUrl = await new Promise((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(String(r.result || ''));
          r.onerror = () => reject(new Error('Could not read PDF.'));
          r.readAsDataURL(file);
        });
        const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
        const res = await api('/api/attachments/extract', { method: 'POST', body: JSON.stringify({ name: file.name, dataBase64: base64 }) });
        const text = res.text || '[No extractable text found in PDF — paste a screenshot for vision analysis.]';
        composerFileAttachments.push({ name: file.name.slice(0, 120), content: text, meta: `${res.pages || 1}p · ${(text.length / 1024).toFixed(1)} KB` });
        added++;
      } catch (err) {
        toast(err.message || `Could not extract text from ${file.name}.`);
      }
      continue;
    }
    if (file.size > 512 * 1024) { toast(`${file.name} is too large (max 512 KB for text/code files).`); continue; }
    try {
      let text = await file.text();
      if (text.includes('\u0000')) { toast(`${file.name} appears to be binary — attach images, PDFs, or text/code files.`); continue; }
      if (text.length > 120000) text = text.slice(0, 120000) + '\n[…truncated at 120,000 chars…]';
      const kb = Math.max(0.1, text.length / 1024).toFixed(1);
      composerFileAttachments.push({ name: (file.name || 'file.txt').slice(0, 120), content: text, meta: `${kb} KB` });
      added++;
    } catch {
      toast(`Could not read ${file.name}.`);
    }
  }
  if (added) {
    renderComposerAttachments();
    if (sourceLabel) toast(`Attached ${added} ${sourceLabel}file${added === 1 ? '' : 's'}.`);
  }
  return added;
}

$('#composer-attach-image')?.addEventListener('click', () => $('#composer-image-input')?.click());
$('#composer-image-input')?.addEventListener('change', event => {
  addComposerFiles(event.target.files);
  event.target.value = '';
});
$('#composer-attachments')?.addEventListener('click', event => {
  const rm = event.target.closest('[data-remove-attachment]');
  if (rm) {
    const idx = Number(rm.dataset.removeAttachment);
    if (Number.isInteger(idx) && idx >= 0 && idx < composerAttachments.length) {
      composerAttachments.splice(idx, 1);
      renderComposerAttachments();
    }
    return;
  }
  const rmFile = event.target.closest('[data-remove-file-attachment]');
  if (rmFile) {
    const idx = Number(rmFile.dataset.removeFileAttachment);
    if (Number.isInteger(idx) && idx >= 0 && idx < composerFileAttachments.length) {
      composerFileAttachments.splice(idx, 1);
      renderComposerAttachments();
    }
  }
});
$('#composer-input')?.addEventListener('paste', event => {
  const items = [...(event.clipboardData?.items || [])];
  const files = items.filter(it => it.kind === 'file').map(it => it.getAsFile()).filter(Boolean);
  if (files.length) {
    event.preventDefault();
    addComposerFiles(files, 'pasted ');
  }
});
$('#composer-form')?.addEventListener('dragover', event => {
  if ([...(event.dataTransfer?.types || [])].includes('Files')) {
    event.preventDefault();
    $('#composer-form').classList.add('is-drop-target');
  }
});
$('#composer-form')?.addEventListener('dragleave', event => {
  if (!event.currentTarget.contains(event.relatedTarget)) {
    $('#composer-form').classList.remove('is-drop-target');
  }
});
$('#composer-form')?.addEventListener('drop', event => {
  $('#composer-form').classList.remove('is-drop-target', 'is-folder-drop-target');
  const files = [...(event.dataTransfer?.files || [])];
  if (files.length) {
    event.preventDefault();
    addComposerFiles(files, 'dropped ');
    return;
  }
  const uriRaw = (event.dataTransfer?.getData('text/uri-list') || event.dataTransfer?.getData('text/plain') || '').trim();
  if (uriRaw) {
    const firstLine = uriRaw.split(/\r?\n/).find(l => l && !l.startsWith('#')) || '';
    const candidate = firstLine.startsWith('file://') ? decodeURIComponent(firstLine.replace(/^file:\/\/(?:localhost)?/i, '')) : firstLine;
    if (/^(\/|[A-Za-z]:[\\/])/.test(candidate)) {
      event.preventDefault();
      handleDroppedFolderPath(candidate);
    }
  }
});

$('#new-task')?.addEventListener('click', newConversation);
$('#rename-task-btn')?.addEventListener('click', () => {
  if (selectedData?.task) startInlineRename(selectedData.task, $('#selected-title'));
});
$('#selected-title')?.addEventListener('dblclick', () => {
  if (selectedData?.task) startInlineRename(selectedData.task, $('#selected-title'));
});
$('#new-thread').addEventListener('click', newConversation);
$('#composer-form').addEventListener('submit', submitMessage);
$('#composer-input').addEventListener('input', () => {
  captureComposerDraft();
  composerErrors.delete(selectedId || 'welcome');
  resizeComposer();
  renderComposer();
});
$('#composer-input').addEventListener('keydown', (event) => {
  if (event.key === 'Tab' && event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey) {
    event.preventDefault();
    if (typeof cyclePermissionMode === 'function') cyclePermissionMode();
    return;
  }
  if (event.key !== 'Enter' || event.isComposing || event.altKey) return;
  if (qolPrefs.sendKey === 'mod_enter') {
    if (!event.metaKey && !event.ctrlKey) return;
  } else if (event.shiftKey) {
    return;
  }
  if (composerAutocompleteState.visible && composerAutocompleteState.shouldDeferEnter()) {
    if (!event.metaKey && !event.ctrlKey) return;
    composerAutocompleteState.hide?.();
  }
  event.preventDefault();
  const sendBtn = $('#composer-send');
  if (sendBtn && !sendBtn.disabled && sendBtn.dataset.composerStop !== '1') {
    $('#composer-form').requestSubmit();
  }
});
$('#composer-project').addEventListener('click', (event) => {
  event.stopPropagation();
  toggleProjectPopover();
});
$('#project-new-task').addEventListener('click',()=>{ $('#project-dialog').close(); openCreate(undefined,{source:'project', objective:$('#composer-input').value,composerOrigin:selectedId || 'welcome'}); });
$('#project-dialog').addEventListener('close',()=>$('#composer-project').focus());
$('#composer-permissions').addEventListener('click',()=>openSettings('tools'));
$('#composer-plan-mode')?.addEventListener('click',()=>togglePlanMode(selectedData?.task || null));
$('#plan-approve-build')?.addEventListener('click',()=>approvePlanAndBuild(selectedData?.task || null));
$('#plan-keep-refining')?.addEventListener('click',()=>{
  const task = selectedData?.task;
  if (task) planBannerDismissedVersion.set(task.id, Number(task.version));
  setVisible('#plan-ready-banner', false);
  $('#composer-input')?.focus();
});
$('#composer-ultra').addEventListener('click',()=>toggleUltra(selectedData?.task || null));
$('#composer-recovery-settings').addEventListener('click',()=>openSettings('recovery'));
$('#inspector-recovery-settings').addEventListener('click',()=>openSettings('recovery'));
$('#composer-model').addEventListener('click', openModels);
$('#composer-options-toggle')?.addEventListener('click', (event) => {
  event.stopPropagation();
  const shell = $('#composer-shell');
  setComposerOptionsOpen(!shell?.classList.contains('composer-options-open'));
});
document.addEventListener('click', (event) => {
  const shell = $('#composer-shell');
  if (!shell?.classList.contains('composer-options-open')) return;
  if (event.target.closest('#composer-shell, #effort-popover, #ultra-popover, #project-popover, #model-picker, dialog[open]')) return;
  setComposerOptionsOpen(false);
});
function closeUltraPopover() {
  const pop = $('#ultra-popover');
  if (!pop || pop.classList.contains('hidden')) return;
  pop.classList.add('hidden');
  $('#composer-race')?.setAttribute('aria-expanded', 'false');
  lastDialogCloseAt = Date.now();
}

function positionUltraPopover() {
  const pop = $('#ultra-popover');
  const btn = $('#composer-race');
  if (!pop || !btn || pop.classList.contains('hidden')) return;
  const rect = btn.getBoundingClientRect();
  const popW = Math.min(368, window.innerWidth - 24);
  const left = Math.max(12, Math.min(window.innerWidth - popW - 12, rect.left));
  const bottom = Math.max(12, window.innerHeight - rect.top + 8);
  pop.style.left = `${Math.round(left)}px`;
  pop.style.bottom = `${Math.round(bottom)}px`;
}

function activeUltraMode(task) {
  const racing = task ? task.answerRace : RecoveryUI.preferences().answerRace;
  if (racing) return 'manual_arena';
  return state.router?.mode || ultraRouterData?.settings?.mode || 'off';
}

async function applyUltraCustomArena(answerRace, targetTask = undefined) {
  const resolved = targetTask !== undefined ? targetTask : selectedData?.task;
  const task = resolved?.workspaceKind === 'conversation' ? resolved : null;
  if (task) {
    const res = await api(`/api/tasks/${encodeURIComponent(task.id)}/answer-race`, {
      method: 'PATCH',
      body: JSON.stringify({ answerRace }),
    });
    if (res?.task && selectedData?.task?.id === task.id) selectedData.task = res.task;
  } else {
    const defs = RecoveryUI.preferences();
    if (answerRace) defs.answerRace = answerRace;
    else delete defs.answerRace;
    try { localStorage.setItem('g0dc0d3.defaults', JSON.stringify(defs)); } catch {}
  }
  renderComposer();
  if (typeof renderRaceOptions === 'function') renderRaceOptions(task);
}

function availableArenaModels() {
  const seen = new Set();
  const out = [];
  for (const m of (veniceCatalog?.models || [])) {
    if (!m?.id || seen.has(m.id)) continue;
    seen.add(m.id);
    out.push(m);
  }
  for (const p of liveProviders()) {
    if (!p?.id || seen.has(p.id) || p.kind !== 'http') continue;
    seen.add(p.id);
    out.push(p);
  }
  return out;
}

function renderUltraPopover() {
  const pop = $('#ultra-popover');
  if (!pop || pop.classList.contains('hidden')) return;
  const task = selectedData?.task?.workspaceKind === 'conversation' ? selectedData.task : null;
  const mode = activeUltraMode(task);
  const racing = task ? task.answerRace : RecoveryUI.preferences().answerRace;
  const routerCfg = ultraRouterData?.settings || state.router || {};
  const arenaSize = [2, 3, 4].includes(Number(routerCfg.arenaSize)) ? Number(routerCfg.arenaSize) : 3;
  const metaMode = routerCfg.metacognition || 'smart';
  const arenaModels = availableArenaModels();
  const totalLiveModels = new Set([...liveProviders().map(p => p.id), ...(veniceCatalog?.models || []).map(m => m.id)]).size;
  const hasMultipleModels = totalLiveModels >= 2 || arenaModels.length >= 2;
  const arenaActive = mode === 'auto_arena' || mode === 'manual_arena';

  const modes = [
    ['off', 'Off', 'Direct model & fallback waterfall', false],
    ['auto_route', 'Auto-Route', hasMultipleModels ? 'Best model per prompt + local Elo' : 'Single model active (add 2+ to route)', false],
    ['auto_arena', 'Conclave Race', hasMultipleModels ? `Race ${arenaSize} models blindly + judge` : 'Needs 2+ connected models', !hasMultipleModels],
  ];

  const sizeSection = hasMultipleModels ? `
    <div class="ultra-pop-seg-row" aria-label="Conclave contender count">
      <span class="ultra-pop-seg-label">Contenders</span>
      <div class="ultra-pop-seg-pills">
        ${[2, 3, 4].map(n => `<button type="button" class="ultra-pop-pill${mode === 'auto_arena' && arenaSize === n ? ' active' : ''}" data-ultra-arena-size="${n}" ${ultraRouterBusy || (n > Math.max(2, totalLiveModels)) ? 'disabled' : ''}>${n}×</button>`).join('')}
      </div>
    </div>` : '';

  const customLineupBanner = mode === 'manual_arena' && racing?.models?.length ? `
    <div class="ultra-pop-custom-pill">
      <span>Custom lineup · <strong>${racing.models.length} writers</strong> + Judge</span>
      <button type="button" class="button button-quiet" data-ultra-open-settings="arena">Edit</button>
    </div>` : '';

  const metaSection = `
    <div class="ultra-pop-seg-row" aria-label="Metacognition mode">
      <span class="ultra-pop-seg-label">Metacognition</span>
      <div class="ultra-pop-seg-pills">
        ${[['off', 'Off'], ['smart', 'Smart'], ['auto_forge', 'Auto-Forge']].map(([id, lbl]) => `<button type="button" class="ultra-pop-pill${metaMode === id ? ' active' : ''}" data-ultra-meta-mode="${id}" ${ultraRouterBusy ? 'disabled' : ''}>${lbl}</button>`).join('')}
      </div>
    </div>`;

  const statusTag = mode === 'off' ? 'Off' : mode === 'auto_route' ? 'Auto-Route active' : mode === 'manual_arena' ? `Custom ${racing?.models?.length || 2}× Conclave` : `Auto-Conclave ${arenaSize}×`;
  pop.innerHTML = `
    <div class="ultra-popover-head">
      <div><strong>Ultra-Plinian</strong><small>${escapeHTML(statusTag)}</small></div>
      <button type="button" class="icon-button" data-close-ultra-popover aria-label="Close Ultra-Plinian menu">×</button>
    </div>
    <div class="ultra-popover-modes" role="radiogroup" aria-label="Ultra-Plinian mode">
      ${modes.map(([id, title, desc, unavailable]) => {
        const isSelected = id === 'auto_arena' ? arenaActive : mode === id;
        return `<button type="button" class="ultra-pop-card${isSelected ? ' active' : ''}" role="radio" aria-checked="${isSelected}" data-ultra-pop-mode="${id}" ${ultraRouterBusy || unavailable ? 'disabled' : ''}><strong>${title}</strong><span>${desc}</span></button>`;
      }).join('')}
    </div>
    ${sizeSection}
    ${customLineupBanner}
    ${metaSection}
    <div class="ultra-popover-foot">
      <button type="button" class="button button-secondary ultra-pop-customize" data-ultra-open-settings="arena">⚙ Customize Conclave &amp; Routing…</button>
      <span class="ultra-pop-status">${escapeHTML(task ? 'This chat' : 'Default')}</span>
    </div>`;
  positionUltraPopover();
}

async function toggleUltraPopover(force) {
  const pop = $('#ultra-popover');
  if (!pop) return;
  const open = typeof force === 'boolean' ? force : pop.classList.contains('hidden');
  if (!open) { closeUltraPopover(); return; }
  closeAllPopovers('ultra-popover');
  pop.classList.remove('hidden');
  $('#composer-race')?.setAttribute('aria-expanded', 'true');
  renderUltraPopover();
  if (!veniceCatalog?.models?.length) {
    loadVeniceCatalog().then(() => renderUltraPopover()).catch(() => {});
  }
}

$('#composer-race').addEventListener('click', event => {
  event.stopPropagation();
  toggleUltraPopover();
});

$('#ultra-popover')?.addEventListener('click', async event => {
  if (event.target.closest('[data-close-ultra-popover]')) { closeUltraPopover(); return; }
  const openSettingsBtn = event.target.closest('[data-ultra-open-settings]');
  if (openSettingsBtn) {
    closeUltraPopover();
    await openSettings('autonomy', { scrollTo: openSettingsBtn.dataset.ultraOpenSettings === 'arena' ? '#race-options' : '#ultra-router-section' });
    const raceEl = $('#race-options');
    const target = (openSettingsBtn.dataset.ultraOpenSettings === 'arena' && raceEl && !raceEl.hidden)
      ? raceEl
      : $('#ultra-router-section');
    target?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    return;
  }
  const sizeBtn = event.target.closest('[data-ultra-arena-size]');
  if (sizeBtn) {
    const n = Number(sizeBtn.dataset.ultraArenaSize);
    if ([2, 3, 4].includes(n)) {
      try {
        await applyUltraCustomArena(null);
        await updateUltraRouter({ mode: 'auto_arena', arenaSize: n }, `Ultra-Plinian Conclave set to ${n} contenders.`);
      } catch (err) {
        toast(err.message || 'Could not update Conclave size.');
      }
      renderUltraPopover();
    }
    return;
  }
  const metaBtn = event.target.closest('[data-ultra-meta-mode]');
  if (metaBtn) {
    const m = metaBtn.dataset.ultraMetaMode;
    try {
      await updateUltraRouter({ metacognition: m }, `Metacognition set to ${m === 'auto_forge' ? 'Auto-Forge' : m === 'smart' ? 'Smart' : 'Off'}.`);
    } catch (err) {
      toast(err.message || 'Could not update Metacognition.');
    }
    renderUltraPopover();
    return;
  }
  const modeBtn = event.target.closest('[data-ultra-pop-mode]');
  if (!modeBtn) return;
  const mode = modeBtn.dataset.ultraPopMode;
  try {
    await applyUltraCustomArena(null);
    const label = mode === 'off' ? 'Off' : mode === 'auto_route' ? 'Auto-Route' : 'Conclave Race';
    await updateUltraRouter({ mode }, `Ultra-Plinian set to ${label}.`);
  } catch (err) {
    toast(err.message || 'Could not update Ultra-Plinian mode.');
  }
  renderUltraPopover();
});

function closeEffortPopover() {
  const pop = $('#effort-popover');
  if (!pop || pop.classList.contains('hidden')) return;
  pop.classList.add('hidden');
  $('#composer-effort')?.setAttribute('aria-expanded', 'false');
  lastDialogCloseAt = Date.now();
}

function positionEffortPopover() {
  const pop = $('#effort-popover');
  const btn = $('#composer-effort');
  if (!pop || !btn || pop.classList.contains('hidden')) return;
  const rect = btn.getBoundingClientRect();
  const popW = Math.min(320, window.innerWidth - 24);
  const left = Math.max(12, Math.min(window.innerWidth - popW - 12, rect.left));
  const bottom = Math.max(12, window.innerHeight - rect.top + 8);
  pop.style.left = `${Math.round(left)}px`;
  pop.style.bottom = `${Math.round(bottom)}px`;
}

function renderEffortPopover() {
  const pop = $('#effort-popover');
  if (!pop || pop.classList.contains('hidden')) return;
  const task = selectedData?.task || null;
  const current = activeEffort(task);
  const entries = Object.entries(EFFORT_META);
  pop.innerHTML = `
    <div class="ultra-popover-head">
      <div><strong>Thinking effort</strong><small>${escapeHTML(EFFORT_META[current].label)}</small></div>
      <button type="button" class="icon-button" data-close-effort-popover aria-label="Close effort menu">×</button>
    </div>
    <div class="effort-pop-list" role="radiogroup" aria-label="Thinking effort level">
      ${entries.map(([id, meta]) => `<button type="button" class="ultra-pop-card effort-pop-card${current === id ? ' active' : ''}" role="radio" aria-checked="${current === id}" data-effort-choice="${id}" ${effortBusy ? 'disabled' : ''}><strong><span aria-hidden="true">${meta.icon}</span><span>${meta.label}</span></strong><span>${meta.desc}</span></button>`).join('')}
    </div>
    <div class="ultra-popover-foot">
      <button type="button" class="button button-quiet effort-open-params" data-effort-open-params>Sampling &amp; Model controls…</button>
      <button type="button" class="button button-quiet" data-effort-open-hypertuner>HyperTuner</button>
    </div>`;
  positionEffortPopover();
}

function toggleEffortPopover(force) {
  const pop = $('#effort-popover');
  if (!pop) return;
  const open = typeof force === 'boolean' ? force : pop.classList.contains('hidden');
  if (!open) { closeEffortPopover(); return; }
  closeAllPopovers('effort-popover');
  pop.classList.remove('hidden');
  $('#composer-effort')?.setAttribute('aria-expanded', 'true');
  renderEffortPopover();
}

$('#composer-effort')?.addEventListener('click', event => {
  event.stopPropagation();
  toggleEffortPopover();
});

$('#effort-popover')?.addEventListener('click', async event => {
  if (event.target.closest('[data-close-effort-popover]')) { closeEffortPopover(); return; }
  if (event.target.closest('[data-effort-open-params]')) {
    closeEffortPopover();
    $('#composer-parameters')?.click();
    return;
  }
  if (event.target.closest('[data-effort-open-hypertuner]')) {
    closeEffortPopover();
    if (typeof openSettings === 'function') openSettings('hypertuner');
    return;
  }
  const btn = event.target.closest('[data-effort-choice]');
  if (!btn) return;
  const level = btn.dataset.effortChoice;
  closeEffortPopover();
  await setEffortLevel(selectedData?.task || null, level);
});

function normalizeProjectPath(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  if (s === '/' || /^[A-Za-z]:[\\/]?$/.test(s)) return s;
  return s.replace(/[\\/]+$/, '');
}

function projectBaseName(folderPath) {
  const clean = normalizeProjectPath(folderPath);
  return clean.split(/[\\/]/).filter(Boolean).pop() || clean;
}

function projectParentDir(folderPath) {
  const clean = normalizeProjectPath(folderPath);
  const parts = clean.split(/[\\/]/);
  if (parts.length <= 2) return clean;
  return parts.slice(0, -1).join('/');
}

function loadRecentProjects() {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_PROJECTS_KEY) || '[]');
    if (!Array.isArray(raw)) return [];
    return raw
      .filter(item => item && typeof item.path === 'string' && item.path.trim())
      .slice(0, 8)
      .map(item => {
        const clean = normalizeProjectPath(item.path);
        return {
          path: clean,
          name: item.name || projectBaseName(clean),
          mode: item.mode === 'worktree' ? 'worktree' : 'copy',
          lastUsed: Number(item.lastUsed || 0),
        };
      });
  } catch { return []; }
}

function saveRecentProjects(list) {
  try { localStorage.setItem(RECENT_PROJECTS_KEY, JSON.stringify(list.slice(0, 8))); } catch {}
}

function recordRecentProject(folderPath, mode = 'copy') {
  const clean = normalizeProjectPath(folderPath);
  if (!clean) return;
  const current = loadRecentProjects().filter(item => item.path !== clean);
  current.unshift({ path: clean, name: projectBaseName(clean), mode: mode === 'worktree' ? 'worktree' : 'copy', lastUsed: Date.now() });
  saveRecentProjects(current);
  renderCreateRecentProjects();
  renderProjectPopover();
}
window.G0DRecordRecentProject = recordRecentProject;

function removeRecentProject(folderPath) {
  const clean = normalizeProjectPath(folderPath);
  saveRecentProjects(loadRecentProjects().filter(item => item.path !== clean));
  renderCreateRecentProjects();
  renderProjectPopover();
}

function renderCreateRecentProjects() {
  const bar = $('#create-recent-projects');
  if (!bar) return;
  const recent = loadRecentProjects();
  if (!recent.length) { bar.classList.add('hidden'); bar.innerHTML = ''; return; }
  bar.classList.remove('hidden');
  bar.innerHTML = `<span class="recent-projects-label">Recent</span>${recent.slice(0, 5).map(item => `<button type="button" class="recent-project-chip" data-recent-create-path="${escapeHTML(item.path)}" title="${escapeHTML(item.path)}"><span>${escapeHTML(item.name)}</span></button>`).join('')}`;
}

async function scanPendingProjectPreview(folderPath) {
  const clean = normalizeProjectPath(folderPath);
  if (!clean) return;
  const seq = ++pendingProjectPreviewSeq;
  pendingProjectPreview = { sourceInput: clean, loading: true, error: null };
  renderProjectPopover();
  try {
    const res = await api('/api/workspaces/preview', { method: 'POST', body: JSON.stringify({ sourcePath: clean }) });
    if (seq !== pendingProjectPreviewSeq || pendingProject?.path !== clean) return;
    pendingProjectPreview = {
      ...res,
      sourceInput: clean,
      fileCount: Array.isArray(res.files) ? res.files.length : 0,
      omittedCount: Array.isArray(res.omitted) ? res.omitted.length : 0,
      loading: false,
      error: null,
    };
  } catch (err) {
    if (seq !== pendingProjectPreviewSeq || pendingProject?.path !== clean) return;
    pendingProjectPreview = { sourceInput: clean, loading: false, error: err?.message || 'Unable to scan folder' };
  }
  renderProjectPopover();
}

function setPendingProject(folderPath, mode = 'copy', { notify = false } = {}) {
  const clean = normalizeProjectPath(folderPath);
  if (!clean) {
    pendingProject = null;
    pendingProjectPreview = null;
    pendingProjectPreviewSeq += 1;
    try { localStorage.removeItem(PENDING_PROJECT_KEY); } catch {}
    renderComposer();
    renderProjectPopover();
    if (notify) toast('Detached project.');
    return;
  }
  const normalizedMode = mode === 'worktree' ? 'worktree' : 'copy';
  pendingProject = { path: clean, name: projectBaseName(clean), mode: normalizedMode };
  try { localStorage.setItem(PENDING_PROJECT_KEY, JSON.stringify(pendingProject)); } catch {}
  recordRecentProject(clean, normalizedMode);
  if (normalizedMode === 'copy') {
    if (!pendingProjectPreview || pendingProjectPreview.sourceInput !== clean || pendingProjectPreview.error) {
      void scanPendingProjectPreview(clean);
    }
  } else {
    pendingProjectPreview = null;
  }
  renderComposer();
  renderProjectPopover();
  if (notify) toast(`Attached ${pendingProject.name} (${normalizedMode === 'worktree' ? 'Git Worktree' : 'Isolated Copy'}).`);
}

function handleDroppedFolderPath(folderPath) {
  const clean = normalizeProjectPath(folderPath);
  if (!clean) return;
  if ($('#create-dialog')?.open) {
    setCreateSource('project');
    $('#create-source-path').value = clean;
    void previewImport();
    toast(`Loaded ${projectBaseName(clean)} into New Task.`);
    return;
  }
  if ($('#tree-dialog')?.open) {
    const input = $('#tree-folder');
    if (input) input.value = clean;
    toast(`Loaded ${projectBaseName(clean)} into Git Worktrees.`);
    return;
  }
  const task = selectedData?.task;
  if (task?.workspaceKind === 'conversation' && typeof window.openChatCode === 'function') {
    recordRecentProject(clean, 'worktree');
    void window.openChatCode(task).then(() => {
      const input = $('#tree-folder');
      if (input) input.value = clean;
    });
    toast(`Ready to attach ${projectBaseName(clean)} worktree.`);
    return;
  }
  if (appMode !== 'godcode') applyAppMode('godcode', { persist: true, notify: false, switchView: false });
  if (selectedId) newConversation();
  setPendingProject(clean, pendingProject?.mode || 'copy', { notify: true });
  $('#composer-input')?.focus();
}

window.G0DAttachProjectFromPicker = (folder) => {
  const clean = normalizeProjectPath(folder);
  if (!clean) return;
  const task = selectedData?.task;
  if (task?.workspaceKind === 'conversation' && typeof window.openChatCode === 'function') {
    closeProjectPopover();
    recordRecentProject(clean, 'worktree');
    void window.openChatCode(task).then(() => {
      const input = $('#tree-folder');
      if (input) input.value = clean;
    });
    return;
  }
  if (appMode !== 'godcode') applyAppMode('godcode', { persist: true, notify: false, switchView: false });
  setPendingProject(clean, pendingProject?.mode || 'copy', { notify: true });
  closeProjectPopover();
  $('#composer-input')?.focus();
};

window.addEventListener('godcode-folder-drag', event => {
  const active = Boolean(event?.detail?.active);
  $('#composer-form')?.classList.toggle('is-folder-drop-target', active);
});
window.addEventListener('godcode-folder-drop', event => {
  $('#composer-form')?.classList.remove('is-folder-drop-target');
  const dirPath = typeof event?.detail?.path === 'string' ? event.detail.path : '';
  if (dirPath) handleDroppedFolderPath(dirPath);
});

function closeProjectPopover() {
  const pop = $('#project-popover');
  if (!pop || pop.classList.contains('hidden')) return;
  pop.classList.add('hidden');
  $('#composer-project')?.setAttribute('aria-expanded', 'false');
  lastDialogCloseAt = Date.now();
}

function positionProjectPopover() {
  const pop = $('#project-popover');
  const btn = $('#composer-project');
  if (!pop || !btn || pop.classList.contains('hidden')) return;
  const rect = btn.getBoundingClientRect();
  const popW = Math.min(400, window.innerWidth - 24);
  const left = Math.max(12, Math.min(window.innerWidth - popW - 12, rect.left));
  const bottom = Math.max(12, window.innerHeight - rect.top + 8);
  pop.style.left = `${Math.round(left)}px`;
  pop.style.bottom = `${Math.round(bottom)}px`;
}

function openProjectLocationsDialog(task) {
  if (!task) return;
  const shortWs = task.workspace ? task.workspace.split(/[\\/]/).pop() || task.workspace : '';
  $('#project-location').innerHTML = `<section class="project-location"><h3>Working copy</h3><code title="${escapeHTML(task.workspace)}">${escapeHTML(shortWs)}</code><p class="field-help">The agent edits this copy.</p></section>${task.sourcePath ? `<section class="project-location"><h3>Original project</h3><code>${escapeHTML(task.sourcePath)}</code><p class="field-help">Changes reach this folder only after reviewed Apply.</p></section>` : '<p class="field-help">Example project. Your own files are unchanged.</p>'}`;
  dismissDrawers();
  $('#project-dialog').showModal();
}

function renderProjectPopover() {
  const pop = $('#project-popover');
  if (!pop || pop.classList.contains('hidden')) return;
  const task = selectedData?.task || null;
  const recent = loadRecentProjects();
  const hasNativeBrowse = Boolean(window.webkit?.messageHandlers?.chooseRepository);
  let activeHtml = '';
  if (task) {
    const label = task.codeWorkspace ? task.codeWorkspace.repository : (projectLabel(task) || 'Current workspace');
    const pathLine = task.sourcePath || task.codeWorkspace?.root || task.workspace || '';
    activeHtml = `
      <div class="project-pop-active">
        <div class="project-pop-active-top">
          <strong>${escapeHTML(label)}</strong>
          <span class="project-pop-item-badge">${task.codeWorkspace ? 'Worktree' : task.sourcePath ? 'Copy' : 'Chat'}</span>
        </div>
        ${pathLine ? `<code class="project-pop-path" title="${escapeHTML(pathLine)}">${escapeHTML(pathLine)}</code>` : ''}
        <div class="project-pop-actions-row">
          ${task.workspaceKind === 'conversation' ? `<button type="button" class="button button-secondary" data-project-open-worktree>${task.codeWorkspace ? 'Open Git Worktree…' : 'Attach Git Worktree…'}</button>` : `<button type="button" class="button button-secondary" data-project-inspect>Inspect paths</button>`}
          <button type="button" class="button button-quiet" data-project-new-task>New project task…</button>
        </div>
      </div>`;
  } else if (pendingProject) {
    let statusLine = '';
    if (pendingProject.mode === 'worktree') {
      statusLine = '<p class="project-pop-preview">Starts a conversation attached to a dedicated Git worktree branch.</p>';
    } else if (pendingProjectPreview?.sourceInput === pendingProject.path) {
      if (pendingProjectPreview.loading) statusLine = '<p class="project-pop-preview">Scanning project files…</p>';
      else if (pendingProjectPreview.error) statusLine = `<p class="project-pop-preview is-error">${escapeHTML(pendingProjectPreview.error)}</p>`;
      else statusLine = `<p class="project-pop-preview">✓ ${pendingProjectPreview.fileCount} files (${(Number(pendingProjectPreview.totalBytes || 0) / 1024).toFixed(1)} KiB) ready · press Enter to start</p>`;
    }
    activeHtml = `
      <div class="project-pop-active">
        <div class="project-pop-active-top">
          <strong title="${escapeHTML(pendingProject.path)}">${escapeHTML(pendingProject.name)}</strong>
          <button type="button" class="button button-quiet" data-project-detach>Detach</button>
        </div>
        <code class="project-pop-path" title="${escapeHTML(pendingProject.path)}">${escapeHTML(pendingProject.path)}</code>
        <div class="project-pop-mode-switch" role="radiogroup" aria-label="Workspace isolation mode">
          <button type="button" class="project-pop-mode-btn${pendingProject.mode === 'copy' ? ' active' : ''}" role="radio" aria-checked="${pendingProject.mode === 'copy'}" data-project-mode="copy">Isolated Copy</button>
          <button type="button" class="project-pop-mode-btn${pendingProject.mode === 'worktree' ? ' active' : ''}" role="radio" aria-checked="${pendingProject.mode === 'worktree'}" data-project-mode="worktree">Git Worktree</button>
        </div>
        ${statusLine}
      </div>`;
  }

  const recentHtml = recent.length
    ? `<div class="project-pop-recent">${recent.map(item => {
        const isCurrent = !task && pendingProject?.path === item.path;
        return `<div class="project-pop-item${isCurrent ? ' active' : ''}"><button type="button" class="project-pop-item-main" data-project-pick="${escapeHTML(item.path)}" data-project-pick-mode="${escapeHTML(item.mode)}" title="${escapeHTML(item.path)}"><span class="project-pop-item-name">${escapeHTML(item.name)}</span><span class="project-pop-item-dir">${escapeHTML(projectParentDir(item.path))}</span></button><span class="project-pop-item-badge">${item.mode === 'worktree' ? 'Worktree' : 'Copy'}</span><button type="button" class="project-pop-item-remove" data-project-remove="${escapeHTML(item.path)}" aria-label="Remove ${escapeHTML(item.name)} from recent projects">×</button></div>`;
      }).join('')}</div>`
    : `<p class="project-pop-empty">Paste a folder path above${hasNativeBrowse ? ', click Browse…,' : ''} or drag any repo folder onto the composer.</p>`;

  pop.innerHTML = `
    <div class="ultra-popover-head">
      <div><strong>Project</strong><small>${task ? 'Active session' : (pendingProject ? 'Ready to run' : 'Pick or drop a folder')}</small></div>
      <button type="button" class="icon-button" data-close-project-popover aria-label="Close project picker">×</button>
    </div>
    ${activeHtml}
    <form class="project-pop-quick-form" data-project-quick-form>
      <input type="text" data-project-quick-input placeholder="/path/to/repo" value="${!task && pendingProject ? escapeHTML(pendingProject.path) : ''}" aria-label="Project folder path" autocomplete="off" spellcheck="false">
      ${hasNativeBrowse ? '<button type="button" class="button button-secondary" data-project-browse>Browse…</button>' : ''}
      <button type="submit" class="button button-primary">Attach</button>
    </form>
    <div class="project-pop-section-label"><span>Recent projects</span><span>${recent.length ? `${recent.length}/8` : ''}</span></div>
    ${recentHtml}
    <div class="ultra-popover-foot">
      <button type="button" class="button button-quiet ultra-pop-advanced" data-project-advanced>Full task setup…</button>
      <button type="button" class="button button-quiet ultra-pop-advanced" data-project-fixtures>Example projects</button>
    </div>`;
  positionProjectPopover();
}

function toggleProjectPopover(force) {
  const pop = $('#project-popover');
  if (!pop) return;
  const open = typeof force === 'boolean' ? force : pop.classList.contains('hidden');
  if (!open) { closeProjectPopover(); return; }
  closeAllPopovers('project-popover');
  pop.classList.remove('hidden');
  $('#composer-project')?.setAttribute('aria-expanded', 'true');
  renderProjectPopover();
  if (!selectedData?.task && pendingProject?.mode === 'copy' && (!pendingProjectPreview || pendingProjectPreview.sourceInput !== pendingProject.path)) {
    void scanPendingProjectPreview(pendingProject.path);
  }
}

$('#project-popover')?.addEventListener('click', event => {
  event.stopPropagation();
  if (event.target.closest('[data-close-project-popover]')) { closeProjectPopover(); return; }
  if (event.target.closest('[data-project-browse]')) { window.G0DDesktopBrowse?.('popover'); return; }
  if (event.target.closest('[data-project-detach]')) { setPendingProject(null, 'copy', { notify: true }); return; }
  const modeBtn = event.target.closest('[data-project-mode]');
  if (modeBtn && pendingProject) {
    setPendingProject(pendingProject.path, modeBtn.dataset.projectMode, { notify: false });
    return;
  }
  const rmBtn = event.target.closest('[data-project-remove]');
  if (rmBtn) { removeRecentProject(rmBtn.dataset.projectRemove); return; }
  const pickBtn = event.target.closest('[data-project-pick]');
  if (pickBtn) {
    const pickedPath = pickBtn.dataset.projectPick;
    const pickedMode = pickBtn.dataset.projectPickMode || 'copy';
    const task = selectedData?.task;
    closeProjectPopover();
    if (task?.workspaceKind === 'conversation' && typeof window.openChatCode === 'function') {
      void window.openChatCode(task).then(() => {
        const input = $('#tree-folder');
        if (input) input.value = pickedPath;
      });
    } else if (task) {
      openCreate(undefined, { source: 'project', sourcePath: pickedPath, objective: $('#composer-input').value, composerOrigin: selectedId || 'welcome' });
    } else {
      setPendingProject(pickedPath, pickedMode, { notify: true });
      $('#composer-input')?.focus();
    }
    return;
  }
  if (event.target.closest('[data-project-open-worktree]')) {
    const task = selectedData?.task;
    closeProjectPopover();
    if (task && typeof window.openChatCode === 'function') window.openChatCode(task);
    return;
  }
  if (event.target.closest('[data-project-inspect]')) {
    const task = selectedData?.task;
    closeProjectPopover();
    openProjectLocationsDialog(task);
    return;
  }
  if (event.target.closest('[data-project-new-task]') || event.target.closest('[data-project-advanced]')) {
    closeProjectPopover();
    openCreate(undefined, { source: 'project', sourcePath: pendingProject?.path || selectedData?.task?.sourcePath || '', objective: $('#composer-input').value, composerOrigin: selectedId || 'welcome' });
    return;
  }
  if (event.target.closest('[data-project-fixtures]')) {
    closeProjectPopover();
    openCreate();
    return;
  }
});

$('#project-popover')?.addEventListener('submit', event => {
  const form = event.target.closest('[data-project-quick-form]');
  if (!form) return;
  event.preventDefault();
  const val = normalizeProjectPath(form.querySelector('[data-project-quick-input]')?.value || '');
  if (!val) return;
  const task = selectedData?.task;
  closeProjectPopover();
  if (task?.workspaceKind === 'conversation' && typeof window.openChatCode === 'function') {
    recordRecentProject(val, 'worktree');
    void window.openChatCode(task).then(() => {
      const input = $('#tree-folder');
      if (input) input.value = val;
    });
  } else if (task) {
    openCreate(undefined, { source: 'project', sourcePath: val, objective: $('#composer-input').value, composerOrigin: selectedId || 'welcome' });
  } else {
    setPendingProject(val, pendingProject?.mode || 'copy', { notify: true });
    $('#composer-input')?.focus();
  }
});

document.addEventListener('click', event => {
  const pop = $('#ultra-popover');
  if (pop && !pop.classList.contains('hidden') && !pop.contains(event.target) && !event.target.closest('#composer-race')) closeUltraPopover();
  const epop = $('#effort-popover');
  if (epop && !epop.classList.contains('hidden') && !epop.contains(event.target) && !event.target.closest('#composer-effort')) closeEffortPopover();
  const ppop = $('#project-popover');
  if (ppop && !ppop.classList.contains('hidden') && !ppop.contains(event.target) && !event.target.closest('#composer-project')) closeProjectPopover();
});
window.addEventListener('resize', () => { positionUltraPopover(); positionEffortPopover(); positionProjectPopover(); });
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && $('#project-popover') && !$('#project-popover').classList.contains('hidden')) {
    event.preventDefault();
    closeProjectPopover();
    return;
  }
  if (event.key === 'Escape' && $('#effort-popover') && !$('#effort-popover').classList.contains('hidden')) {
    event.preventDefault();
    closeEffortPopover();
    return;
  }
  if (event.key === 'Escape' && $('#ultra-popover') && !$('#ultra-popover').classList.contains('hidden')) {
    event.preventDefault();
    closeUltraPopover();
  }
});
$('#composer-connect').addEventListener('click', async () => {
  await openSettings('models');
  $('#api-key-setup')?.scrollIntoView({ block: 'start' });
  $('#api-key-input')?.focus({ preventScroll: true });
});
$('#model-refresh')?.addEventListener('click',()=>Promise.all([loadModelConnections(true),loadVeniceCatalog(true)]));
$('#venice-backup')?.addEventListener('change', async () => {
  const task = settingsTaskId ? selectedData?.task : null;
  const id = task?.providerId || newConversationProviders()[0];
  try { await selectModel(id,{scope:settingsTaskId,backup:$('#venice-backup').value}); renderSettingsValues(); setText('#model-feedback','Backup saved.'); }
  catch (error) { setText('#model-feedback',error.message); }
  finally { renderVeniceCatalog(); }
});
$('#new-model-options').addEventListener('change', event => {
  if (event.target.name !== 'new-model') return;
  preferredProvider = event.target.value;
  try { localStorage.setItem('g0dc0d3.preferredProvider', preferredProvider); } catch {}
  const id = event.target.value;
  renderModelSettings();
  $$('#new-model-options input').find(input => input.value === id)?.focus({ preventScroll: true });
  renderComposer();
});
$('#header-services-btn')?.addEventListener('click', () => openSettings('models'));
$('#api-toggles-section')?.addEventListener('click', event => {
  const toggleBtn = event.target.closest('[data-toggle-api-provider]');
  if (toggleBtn) {
    void toggleApiProvider(toggleBtn.dataset.toggleApiProvider, toggleBtn.dataset.toggleEnabled === 'true');
    return;
  }
  const discCli = event.target.closest('[data-disconnect-cli-quick]');
  if (discCli && typeof disconnectCli === 'function') {
    void disconnectCli(discCli.dataset.disconnectCliQuick);
  }
});
$('#connected-services-hub')?.addEventListener('click', event => {
  if (event.target.closest('[data-refresh-services]')) {
    Promise.all([loadServices(true), loadModelConnections(true)]);
    return;
  }
  const toggleBtn = event.target.closest('[data-toggle-api-provider]');
  if (toggleBtn) {
    void toggleApiProvider(toggleBtn.dataset.toggleApiProvider, toggleBtn.dataset.toggleEnabled === 'true');
    return;
  }
  const connectBtn = event.target.closest('[data-service-connect]');
  if (connectBtn) { window.SetupUI?.open(); return; }
  const addKeyBtn = event.target.closest('[data-service-add-key]');
  if (addKeyBtn) {
    const prov = addKeyBtn.dataset.serviceAddKey;
    if ($('#api-key-provider')) $('#api-key-provider').value = prov;
    $('#api-key-setup')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    $('#api-key-input')?.focus();
    return;
  }
  if (event.target.closest('[data-service-add-local]')) {
    $('.local-model-setup')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    $('#local-model-name')?.focus();
  }
});
$('#model-groups-section')?.addEventListener('click', event => {
  const sel = event.target.closest('[data-select-model-group]');
  if (sel) { selectedModelGroupId = sel.dataset.selectModelGroup; renderModelGroups(); return; }
  const pickModel = event.target.closest('[data-select-waterfall-model]');
  if (pickModel) {
    const pickedId = pickModel.dataset.selectWaterfallModel;
    selectModel(pickedId, { scope: settingsTaskId })
      .then(ok => {
        if (ok) {
          toast(`Selected ${providerById(pickedId)?.label || pickedId}.`);
        }
      })
      .catch(err => {
        setModelFeedback(err.message, true);
        toast(err.message);
      });
    return;
  }
  const prefBtn = event.target.closest('[data-model-pref]');
  if (prefBtn) {
    setModelPreference(prefBtn.dataset.prefId, prefBtn.dataset.modelPref);
    return;
  }
  const moveBtn = event.target.closest('[data-waterfall-move]');
  if (moveBtn) {
    moveWaterfallModel(moveBtn.dataset.waterfallGroup, moveBtn.dataset.waterfallId, moveBtn.dataset.waterfallMove);
    return;
  }
  const resetBtn = event.target.closest('[data-reset-waterfall]');
  if (resetBtn) {
    customWaterfallOrder.delete(resetBtn.dataset.resetWaterfall);
    renderModelGroups();
    return;
  }
  if (event.target.closest('[data-refresh-catalog]')) {
    refreshModelCatalog();
    return;
  }
  const apply = event.target.closest('[data-apply-model-group]');
  if (apply) { applyModelGroup(apply.dataset.applyModelGroup); }
});
$('#model-groups-section')?.addEventListener('change', event => {
  if (event.target?.id === 'model-group-sort') {
    selectedModelSort = event.target.value || '';
    customWaterfallOrder.clear();
    loadModelGroups(selectedModelSort);
  }
});
$('#overseer-section')?.addEventListener('change', event => {
  if (event.target?.id === 'overseer-provider-select') {
    const providerId = event.target.value || null;
    updateOverseerSettings({ providerId, enabled: Boolean(providerId) });
    return;
  }
  if (event.target?.id === 'overseer-backup-select') {
    updateOverseerSettings({ backupProviderId: event.target.value || null });
    return;
  }
  if (event.target?.id === 'overseer-judge-toggle') {
    updateOverseerSettings({ autoJudgeAmbiguous: event.target.checked });
    return;
  }
  if (event.target?.id === 'overseer-unblock-toggle') {
    updateOverseerSettings({ autoUnblockStuck: event.target.checked });
    return;
  }
  if (event.target?.id === 'overseer-audit-toggle') {
    updateOverseerSettings({ autoAuditCompletion: event.target.checked });
    return;
  }
  if (event.target?.id === 'overseer-coach-toggle') {
    updateOverseerSettings({ autoCoachLongRuns: event.target.checked });
  }
});
$('#overseer-section')?.addEventListener('input', event => {
  if (event.target?.id === 'overseer-custom-instructions') {
    overseerDirectivesDraft = event.target.value;
  }
});
$('#overseer-section')?.addEventListener('click', event => {
  const postureBtn = event.target.closest('[data-overseer-posture]');
  if (postureBtn) { updateOverseerSettings({ posture: postureBtn.dataset.overseerPosture }); return; }
  if (event.target.closest('[data-save-overseer-directives]')) {
    const val = overseerDirectivesDraft ?? $('#overseer-custom-instructions')?.value ?? '';
    updateOverseerSettings({ customInstructions: val });
    return;
  }
  const enableRec = event.target.closest('[data-enable-recommended-overseer]');
  if (enableRec) { updateOverseerSettings({ providerId: enableRec.dataset.enableRecommendedOverseer, enabled: true }); return; }
  if (event.target.closest('[data-clear-refusal-patterns]')) { deleteLearnedPattern(null); return; }
  const delBtn = event.target.closest('[data-delete-refusal-pattern]');
  if (delBtn) deleteLearnedPattern(delBtn.dataset.deleteRefusalPattern);
});
$('#ultra-router-section')?.addEventListener('click', event => {
  const modeBtn = event.target.closest('[data-router-mode]');
  if (modeBtn) {
    const mode = modeBtn.dataset.routerMode;
    if (mode !== 'manual_arena') {
      applyUltraCustomArena(null, settingsTask()).catch(() => {});
      if ($('#race-enabled')) $('#race-enabled').checked = false;
      if (typeof syncRaceControls === 'function') syncRaceControls();
    }
    updateUltraRouter({ mode }, `Ultra-Plinian mode set to ${mode.replace(/_/g, ' ')}.`).then(() => {
      if (typeof renderRaceOptions === 'function') renderRaceOptions(settingsTask());
    });
    return;
  }
  const metaBtn = event.target.closest('[data-router-metacog]');
  if (metaBtn) {
    const metacognition = metaBtn.dataset.routerMetacog;
    updateUltraRouter({ metacognition }, `Task metacognition set to ${metacognition.replace(/_/g, ' ')}.`);
    return;
  }
  const domBtn = event.target.closest('[data-router-domain]');
  if (domBtn) {
    selectedRouterDomain = domBtn.dataset.routerDomain;
    renderUltraRouterSection();
    return;
  }
  const pinBtn = event.target.closest('[data-router-pin]');
  if (pinBtn) {
    const dom = pinBtn.dataset.routerPinDomain;
    const pid = pinBtn.dataset.routerPin;
    const currentPin = ultraRouterData?.settings?.domainPins?.[dom];
    const nextVal = currentPin === pid ? null : pid;
    updateUltraRouter({ domainPins: { [dom]: nextVal } }, nextVal ? `Pinned ${providerById(pid)?.label || pid} for ${dom.replace(/_/g, ' ')}.` : `Unpinned ${dom.replace(/_/g, ' ')}.`);
    return;
  }
  if (event.target.closest('[data-router-save-json]')) {
    const raw = $('#ultra-benchmarks-json')?.value || '{}';
    try {
      const parsed = JSON.parse(raw);
      updateUltraRouter({ customBenchmarks: parsed }, 'Saved custom Mega Model Strengths JSON overrides.');
    } catch {
      toast('Invalid JSON in custom benchmark overrides.');
    }
    return;
  }
  if (event.target.closest('[data-router-reset]')) {
    resetUltraRouter();
  }
});
$('#ultra-router-section')?.addEventListener('change', event => {
  const slider = event.target.closest('[data-router-weight]');
  if (!slider) return;
  const weights = {};
  $$('#ultra-router-section [data-router-weight]').forEach(el => {
    weights[el.dataset.routerWeight] = Number(el.value) / 100;
  });
  updateUltraRouter({ weights }, 'Updated Ultra-Plinian routing objective weights.');
});
$('#panel-changes')?.addEventListener('input', event => {
  if (!event.target.matches('[data-diff-file-filter]')) return;
  diffFileFilter = event.target.value || '';
  const pos = event.target.selectionStart ?? diffFileFilter.length;
  changesSignature = '';
  renderChanges(selectedData?.diff || []);
  const next = $('#panel-changes [data-diff-file-filter]');
  if (next) { next.focus(); next.setSelectionRange(pos, pos); }
});
$('#panel-timeline')?.addEventListener('click', event => {
  const reportBtn = event.target.closest('[data-report-refusal]');
  if (reportBtn) { reportMissedRefusal(reportBtn.dataset.reportRefusal); return; }
  const prefBtn = event.target.closest('[data-model-pref]');
  if (prefBtn) setModelPreference(prefBtn.dataset.prefId, prefBtn.dataset.modelPref, selectedData?.task?.routing?.domain || null);
});
$('#model-connections').addEventListener('click', event => {
  if (event.target.closest('[data-refresh-connections]')) { loadModelConnections(true); return; }
  const disconnectBtn = event.target.closest('[data-disconnect-cli]');
  if (disconnectBtn) { disconnectCli(disconnectBtn.dataset.disconnectCli); return; }
  const connectBtn = event.target.closest('[data-connect-cli]');
  if (connectBtn) { connectCli(connectBtn.dataset.connectCli); return; }
  const toggleChip = event.target.closest('[data-sub-toggle-model]');
  if (toggleChip) {
    const id = toggleChip.dataset.subToggleModel;
    const model = toggleChip.dataset.modelName;
    const conn = cliConnectionsData.find(c => c.id === id);
    if (!conn || !model) return;
    const current = Array.isArray(conn.models) ? [...conn.models] : [];
    const exists = current.includes(model);
    if (exists && current.length <= 1) {
      toast(`Keep at least one ${conn.name} model enabled.`);
      return;
    }
    const next = exists ? current.filter(m => m !== model) : [...current, model];
    updateCliSettings(id, { models: next }, exists ? `Hid ${model} from Model Picker.` : `Added ${model} to Model Picker.`);
    return;
  }
  const addCustomBtn = event.target.closest('[data-sub-custom-add]');
  if (addCustomBtn) {
    const id = addCustomBtn.dataset.subCustomAdd;
    const input = $(`[data-sub-custom-input="${CSS.escape(id)}"]`);
    const model = (input?.value || '').trim();
    const conn = cliConnectionsData.find(c => c.id === id);
    if (!conn || !model) { toast('Enter a model ID first.'); return; }
    const current = Array.isArray(conn.models) ? [...conn.models] : [];
    const next = [...new Set([...current, model])];
    updateCliSettings(id, { models: next }, `Added ${model} to ${conn.name}.`).then(() => { if (input) input.value = ''; });
  }
});
$('#model-connections').addEventListener('change', event => {
  const sel = event.target.closest('[data-sub-setting-id]');
  if (!sel) return;
  const id = sel.dataset.subSettingId;
  const key = sel.dataset.subSettingKey;
  if (!id || !key) return;
  const conn = cliConnectionsData.find(c => c.id === id);
  const nextSettings = { ...(conn?.settings || {}), [key]: sel.value || null };
  updateCliSettings(id, { settings: nextSettings }, `Updated ${conn?.name || id} ${humanize(key)}.`);
});
$('#model-connections').addEventListener('keydown', event => {
  const input = event.target.closest('[data-sub-custom-input]');
  if (!input || event.key !== 'Enter') return;
  event.preventDefault();
  const id = input.dataset.subCustomInput;
  $(`[data-sub-custom-add="${CSS.escape(id)}"]`)?.click();
});

async function submitApiKey(inputOrKey, feedbackEl, provider = '') {
  const inputEl = typeof inputOrKey === 'string' ? null : inputOrKey;
  const key = inputEl ? inputEl.value : inputOrKey;
  if (!key.trim()) { setText(feedbackEl, 'Paste an API key.'); return; }
  $(feedbackEl)?.classList.remove('error');
  setText(feedbackEl, 'Connecting…');
  try {
    const payload = { key: key.trim(), ...(provider ? { provider } : {}) };
    const result = await api('/api/providers/key', { method: 'POST', body: JSON.stringify(payload) });
    if (inputEl) inputEl.value = '';
    else {
      if (feedbackEl === '#api-key-feedback' && $('#api-key-input')) $('#api-key-input').value = '';
      if (feedbackEl === '#welcome-key-feedback' && $('#welcome-key-input')) $('#welcome-key-input').value = '';
    }
    const providerName = humanize(result.provider || provider || 'provider');
    const storageNote = result.storage === 'keychain' ? ' Key saved in device keychain.' : '';
    setText(feedbackEl, `Connected ${result.registered.length} ${providerName} model${result.registered.length === 1 ? '' : 's'}.${storageNote}`);
    if (result.registered.length && (!preferredProvider || !state.providers.some(p => p.id === preferredProvider && p.available !== false))) {
      preferredProvider = result.registered[0];
      try { localStorage.setItem('g0dc0d3.preferredProvider', preferredProvider); } catch {}
    }
    if (Array.isArray(result.connectedApiProviders)) state.connectedApiProviders = result.connectedApiProviders;
    await refresh();
    if (result.provider === 'openrouter') await loadOpenRouterCatalog(true);
    else if (result.provider === 'venice') await loadVeniceCatalog(true);
    else if (Object.hasOwn(directCatalogs, result.provider)) await loadDirectProviderCatalog(result.provider, true);
    renderComposer();
    if ($('#settings-dialog').open) { await Promise.all([loadServices(true), loadModelGroups(selectedModelSort)]); renderModelSettings(); }
    setVisible('#welcome-setup', false);
    const totalOr = result.provider === 'openrouter' && openrouterCatalog.models.length > result.registered.length
      ? `${openrouterCatalog.models.length} catalog · ${result.registered.length} pinned`
      : `${result.registered.length} model${result.registered.length === 1 ? '' : 's'}`;
    setText(feedbackEl, `Connected ${providerName} (${totalOr}).${storageNote}`);
    toast(`Connected ${providerName} (${totalOr}).`);
  } catch (error) {
    $(feedbackEl)?.classList.add('error');
    setText(feedbackEl, error.message);
  }
}
$('#api-key-form').addEventListener('submit', event => { event.preventDefault(); submitApiKey($('#api-key-input'), '#api-key-feedback', $('#api-key-provider')?.value || ''); });
$('#custom-model-form')?.addEventListener('submit', async event => {
  event.preventDefault();
  const provider = $('#custom-model-provider')?.value || '';
  const input = $('#custom-model-name');
  const submitBtn = $('#custom-model-submit');
  const model = (input?.value || '').trim();
  if (!provider || !model) {
    $('#custom-model-feedback')?.classList.add('error');
    setText('#custom-model-feedback', 'Choose a provider and enter a model ID.');
    return;
  }
  $('#custom-model-feedback')?.classList.remove('error');
  setText('#custom-model-feedback', `Adding ${model}…`);
  if (submitBtn) submitBtn.disabled = true;
  try {
    await addProviderModel(provider, model, { feedbackEl: '#custom-model-feedback' });
    if (input) input.value = '';
  } catch {}
  finally { if (submitBtn) submitBtn.disabled = false; }
});
$('#openrouter-filter')?.addEventListener('input', event => {
  openrouterFilter = event.target.value || '';
  renderOpenRouterCatalog();
});
$('#openrouter-refresh')?.addEventListener('click', () => { void loadOpenRouterCatalog(true); });
$('#openrouter-list')?.addEventListener('click', event => {
  const addBtn = event.target.closest('[data-or-add]');
  if (addBtn) { void addProviderModel('openrouter', addBtn.dataset.orAdd).catch(err => toast(err.message)); return; }
  const useBtn = event.target.closest('[data-or-use]');
  if (useBtn) { void selectModel(useBtn.dataset.orUse).catch(err => toast(err.message)); return; }
  const removeBtn = event.target.closest('[data-or-remove]');
  if (removeBtn) { void removeProviderModel('openrouter', removeBtn.dataset.orRemove); }
});
for (const prov of DIRECT_CATALOG_KEYS) {
  $(`#${prov}-filter`)?.addEventListener('input', event => {
    directCatalogFilters[prov] = event.target.value || '';
    renderDirectProviderCatalog(prov);
  });
  $(`#${prov}-refresh`)?.addEventListener('click', () => { void loadDirectProviderCatalog(prov, true); });
  $(`#${prov}-list`)?.addEventListener('click', event => {
    const addBtn = event.target.closest('[data-direct-add]');
    if (addBtn) { void addProviderModel(addBtn.dataset.directProvider || prov, addBtn.dataset.directAdd).catch(err => toast(err.message)); return; }
    const useBtn = event.target.closest('[data-direct-use]');
    if (useBtn) { void selectModel(useBtn.dataset.directUse).catch(err => toast(err.message)); return; }
    const removeBtn = event.target.closest('[data-direct-remove]');
    if (removeBtn) { void removeProviderModel(removeBtn.dataset.directProvider || prov, removeBtn.dataset.directRemove); }
  });
}
function openFinishedChange(event) {
  const launcher = event?.currentTarget || $('#command-open');
  const dialog = $('#finished-change');
  dialog.addEventListener('close', () => launcher.focus({ preventScroll: true }), { once: true });
  const patch = $('#example-patch');
  patch.innerHTML = highlightCode(patch.textContent, 'diff');
  dialog.showModal();
}
$('#welcome-example')?.addEventListener('click', openFinishedChange);
$('#welcome-key-form').addEventListener('submit', event => { event.preventDefault(); submitApiKey($('#welcome-key-input'), '#welcome-key-feedback'); });
let selectedLocalStack = 'ollama';
let lastDiscoveredLocalModels = [];
let lastScanCustomUrl = '';
let localImportBusy = false;

function clampLocalLabel(text, max = 120) {
  const s = String(text || '').trim();
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

function renderLocalScanResults() {
  const box = $('#local-scan-results');
  if (!box) return;
  const models = lastDiscoveredLocalModels;
  if (!models.length) {
    box.classList.add('hidden');
    box.innerHTML = '';
    return;
  }
  const savedIds = new Set((state.localProviders?.registered || []).map(r => r.id));
  for (const m of models) m.alreadyRegistered = savedIds.has(m.candidateId);
  const unadded = models.filter(m => !m.alreadyRegistered);
  box.classList.remove('hidden');
  box.innerHTML = `<div class="local-scan-head"><strong>Discovered local models (${models.length})</strong>${unadded.length > 1 ? `<button type="button" class="button button-secondary local-import-all" id="local-import-all-btn" ${localImportBusy ? 'disabled' : ''}>Import all (${unadded.length})</button>` : ''}</div>`
    + models.map((m, idx) => {
      const detail = [m.stackName, m.parameterSize, m.quantization].filter(Boolean).join(' · ');
      return `<div class="local-scan-row">
        <div class="local-saved-meta">
          <strong>${escapeHTML(m.model)}</strong>
          <small>${escapeHTML(detail || m.baseUrl)}</small>
        </div>
        ${m.alreadyRegistered
          ? '<span class="meta-chip">Saved</span>'
          : `<button type="button" class="button button-secondary local-add-discovered" data-add-discovered-idx="${idx}" ${localImportBusy ? 'disabled' : ''}>+ Add</button>`}
      </div>`;
    }).join('');
}

function renderLocalModelsList() {
  const listEl = $('#local-models-list');
  if (!listEl) return;
  const saved = Array.isArray(state.localProviders?.registered) ? state.localProviders.registered : [];
  if (!saved.length) {
    listEl.innerHTML = '';
    return;
  }
  listEl.innerHTML = `<div class="local-saved-head"><span>Saved local models (${saved.length})</span><small>Auto-restored on app launch</small></div>` + saved.map(item => {
    const netLabel = item.networkClass === 'loopback' ? 'LOCAL ONLY' : item.networkClass === 'lan' ? 'LOCAL LAN' : 'CUSTOM';
    return `<div class="local-saved-row">
      <div class="local-saved-meta">
        <strong>${escapeHTML(item.label || item.model)}</strong>
        <small><code>${escapeHTML(item.model)}</code> · ${escapeHTML(item.baseUrl)} · <span class="meta-chip">${escapeHTML(netLabel)}</span>${item.hasApiKey ? ' · <span class="meta-chip">Bearer key</span>' : ''}</small>
      </div>
      <button type="button" class="button button-quiet local-remove-btn" data-remove-local-model="${escapeHTML(item.id)}">Remove</button>
    </div>`;
  }).join('');
}

async function submitLocalModel(override = null) {
  const feedbackEl = '#local-model-feedback';
  const baseUrl = override ? override.baseUrl : (($('#local-model-url')?.value || '').trim() || 'http://127.0.0.1:11434/v1');
  const model = override ? override.model : ($('#local-model-name')?.value || '').trim();
  const label = override ? (override.label ? clampLocalLabel(override.label, 120) : '') : ($('#local-model-label')?.value || '').trim();
  const apiKey = override ? (override.apiKey || '') : ($('#local-model-apikey')?.value || '').trim();
  const stack = override?.stack || selectedLocalStack;
  const submitBtn = $('#local-model-submit');
  if (!model) { setText(feedbackEl, 'Enter a local model name (e.g. qwen2.5-coder:32b or hf.co/org/repo).'); $('#local-model-feedback')?.classList.add('error'); return false; }
  $('#local-model-feedback')?.classList.remove('error');
  setText(feedbackEl, `Registering ${model}…`);
  if (submitBtn) submitBtn.disabled = true;
  try {
    const payload = { baseUrl, model, tier: 'local', stack, ...(label ? { label } : {}), ...(apiKey ? { apiKey } : {}) };
    const result = await api('/api/providers/local', { method: 'POST', body: JSON.stringify(payload) });
    if (result.localProviders) state.localProviders = result.localProviders;
    if (result.id && !preferredProvider) { preferredProvider = result.id; try { localStorage.setItem('g0dc0d3.preferredProvider', preferredProvider); } catch {} }
    setText(feedbackEl, `Saved ${result.provider?.label || result.id} (persisted across restarts).`);
    if (!override) {
      if ($('#local-model-name')) $('#local-model-name').value = '';
      if ($('#local-model-label')) $('#local-model-label').value = '';
      if ($('#local-model-apikey')) $('#local-model-apikey').value = '';
    }
    await refresh();
    renderComposer();
    renderLocalModelsList();
    renderLocalScanResults();
    if ($('#settings-dialog').open) { await Promise.all([loadServices(), loadModelGroups(selectedModelSort)]); renderModelSettings(); }
    setVisible('#welcome-setup', false);
    toast(`Local model saved: ${result.provider?.label || result.id}`);
    return true;
  } catch (error) {
    $('#local-model-feedback')?.classList.add('error');
    setText(feedbackEl, error.message);
    return false;
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

async function removeLocalModel(id) {
  if (!id) return;
  try {
    const res = await api('/api/providers/local', { method: 'DELETE', body: JSON.stringify({ id }) });
    if (res.localProviders) state.localProviders = res.localProviders;
    await refresh();
    renderComposer();
    renderLocalModelsList();
    renderLocalScanResults();
    if ($('#settings-dialog').open) { await Promise.all([loadServices(), loadModelGroups(selectedModelSort)]); renderModelSettings(); }
    toast(`Removed local model ${id.replace(/^local:/, '')}.`);
  } catch (error) {
    toast(error.message);
  }
}

async function scanLocalServers() {
  if (localImportBusy) return;
  const btn = $('#local-scan-btn');
  const feedbackEl = '#local-model-feedback';
  if (btn) { btn.disabled = true; btn.textContent = 'Scanning…'; }
  $('#local-model-feedback')?.classList.remove('error');
  setText(feedbackEl, 'Probing local Ollama, LM Studio, llama.cpp, vLLM, MLX, TGI, SGLang, and Jan…');
  try {
    const customBaseUrl = ($('#local-model-url')?.value || '').trim().replace(/\/$/, '');
    const customApiKey = ($('#local-model-apikey')?.value || '').trim();
    lastScanCustomUrl = customBaseUrl ? (customBaseUrl.endsWith('/v1') ? customBaseUrl : `${customBaseUrl}/v1`) : '';
    const res = await api('/api/providers/local/discover', {
      method: 'POST',
      body: JSON.stringify({ baseUrl: customBaseUrl, apiKey: customApiKey })
    });
    if (res.localProviders) state.localProviders = res.localProviders;
    const reachable = (res.stacks || []).filter(s => s.reachable);
    const models = Array.isArray(res.models) ? res.models : [];
    lastDiscoveredLocalModels = models;
    setText(feedbackEl, reachable.length
      ? `Found ${models.length} model${models.length === 1 ? '' : 's'} across ${reachable.map(s => s.name).join(', ')}.`
      : 'No local inference servers responded on default ports. Start Ollama, LM Studio, llama-server, vLLM, or MLX and retry.');
    renderLocalScanResults();
    renderLocalModelsList();
  } catch (error) {
    $('#local-model-feedback')?.classList.add('error');
    setText(feedbackEl, error.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Scan local servers'; }
  }
}

function scopedApiKeyForDiscovered(item) {
  const key = ($('#local-model-apikey')?.value || '').trim();
  if (!key || !lastScanCustomUrl) return '';
  const itemUrl = String(item?.baseUrl || '').trim().replace(/\/$/, '');
  return itemUrl === lastScanCustomUrl ? key : '';
}

async function loadHuggingFaceRecipes() {
  const ref = ($('#local-hf-repo')?.value || '').trim();
  const fb = '#local-hf-feedback';
  const box = $('#local-hf-recipes');
  if (!ref) { setText(fb, 'Paste a HuggingFace repo (e.g. unsloth/Qwen3-Coder-30B-A3B-GGUF:Q4_K_M).'); $(fb)?.classList.add('error'); return; }
  $(fb)?.classList.remove('error');
  try {
    const res = await api('/api/providers/local/hf-recipes', { method: 'POST', body: JSON.stringify({ ref }) });
    setText(fb, `Launch commands ready for ${res.repo}${res.quant ? `:${res.quant}` : ''}.`);
    if (box) {
      box.classList.remove('hidden');
      const items = [
        ['Ollama', res.recipes.ollama],
        ['llama.cpp', res.recipes.llamacpp],
        ['vLLM', res.recipes.vllm],
        ['MLX (Apple Silicon)', res.recipes.mlx],
        ['HuggingFace TGI', res.recipes.tgi],
      ];
      box.innerHTML = items.map(([name, cmd]) => `<div class="local-hf-recipe-row"><span>${escapeHTML(name)}</span><code>${escapeHTML(cmd)}</code><button type="button" class="button button-quiet" data-copy-hf-cmd="${escapeHTML(cmd)}">Copy</button></div>`).join('');
    }
  } catch (error) {
    $(fb)?.classList.add('error');
    setText(fb, error.message);
  }
}

async function pullHuggingFaceIntoOllama() {
  const ref = ($('#local-hf-repo')?.value || '').trim();
  const fb = '#local-hf-feedback';
  const btn = $('#local-hf-pull-btn');
  if (!ref) { setText(fb, 'Paste a HuggingFace GGUF repo (e.g. unsloth/Qwen3-Coder-30B-A3B-GGUF:Q4_K_M).'); $(fb)?.classList.add('error'); return; }
  $(fb)?.classList.remove('error');
  setText(fb, `Pulling ${ref} into local Ollama (this may take a few minutes for large GGUFs)…`);
  if (btn) { btn.disabled = true; btn.textContent = 'Pulling…'; }
  try {
    const res = await api('/api/providers/local/ollama-pull', { method: 'POST', body: JSON.stringify({ model: ref }) });
    if (res.localProviders) state.localProviders = res.localProviders;
    setText(fb, `Pulled & registered ${res.pulled} in Ollama!`);
    await refresh();
    renderComposer();
    renderLocalModelsList();
    if ($('#settings-dialog').open) { await Promise.all([loadServices(), loadModelGroups(selectedModelSort)]); renderModelSettings(); }
    toast(`Pulled ${res.pulled} into Ollama.`);
  } catch (error) {
    $(fb)?.classList.add('error');
    setText(fb, error.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Pull into Ollama'; }
  }
}

$('#local-model-form')?.addEventListener('submit', event => { event.preventDefault(); submitLocalModel(); });
$('#local-scan-btn')?.addEventListener('click', () => { void scanLocalServers(); });
$('#local-hf-recipes-btn')?.addEventListener('click', () => { void loadHuggingFaceRecipes(); });
$('#local-hf-pull-btn')?.addEventListener('click', () => { void pullHuggingFaceIntoOllama(); });
$('#local-stack-presets')?.addEventListener('click', event => {
  const chip = event.target.closest('[data-local-preset]');
  if (!chip) return;
  selectedLocalStack = chip.dataset.localPreset || 'custom';
  $$('#local-stack-presets .local-preset-chip').forEach(b => b.classList.toggle('is-active', b === chip));
  const urlInput = $('#local-model-url');
  const nameInput = $('#local-model-name');
  if (urlInput && chip.dataset.url) urlInput.value = chip.dataset.url;
  if (nameInput && chip.dataset.placeholder) nameInput.placeholder = chip.dataset.placeholder;
  nameInput?.focus();
});
$('#local-models-list')?.addEventListener('click', event => {
  const rm = event.target.closest('[data-remove-local-model]');
  if (rm) void removeLocalModel(rm.dataset.removeLocalModel);
});
$('#local-scan-results')?.addEventListener('click', async event => {
  if (localImportBusy) return;
  const one = event.target.closest('[data-add-discovered-idx]');
  if (one) {
    const item = lastDiscoveredLocalModels[Number(one.dataset.addDiscoveredIdx)];
    if (!item) return;
    one.disabled = true;
    const ok = await submitLocalModel({
      baseUrl: item.baseUrl,
      model: item.model,
      stack: item.stack,
      label: clampLocalLabel(`${item.model} · ${item.stackName}`, 120),
      apiKey: scopedApiKeyForDiscovered(item),
    });
    if (ok) { item.alreadyRegistered = true; renderLocalScanResults(); }
    else one.disabled = false;
    return;
  }
  const allBtn = event.target.closest('#local-import-all-btn');
  if (allBtn) {
    localImportBusy = true;
    const scanBtn = $('#local-scan-btn');
    if (scanBtn) scanBtn.disabled = true;
    renderLocalScanResults();
    try {
      const pending = lastDiscoveredLocalModels.filter(m => !m.alreadyRegistered).map(m => ({ ...m }));
      let added = 0;
      for (const item of pending) {
        const ok = await submitLocalModel({
          baseUrl: item.baseUrl,
          model: item.model,
          stack: item.stack,
          label: clampLocalLabel(`${item.model} · ${item.stackName}`, 120),
          apiKey: scopedApiKeyForDiscovered(item),
        });
        if (ok) added++;
      }
      toast(`Imported ${added} local model${added === 1 ? '' : 's'}.`);
    } finally {
      localImportBusy = false;
      if (scanBtn) scanBtn.disabled = false;
      renderLocalScanResults();
    }
  }
});
$('#local-hf-recipes')?.addEventListener('click', event => {
  const copyBtn = event.target.closest('[data-copy-hf-cmd]');
  if (!copyBtn) return;
  const cmd = copyBtn.dataset.copyHfCmd || '';
  navigator.clipboard?.writeText(cmd).then(() => toast('Copied command to clipboard.')).catch(() => {});
});

$('#sidebar-toggle').addEventListener('click', () => setSidebar($('#sidebar-toggle').getAttribute('aria-expanded') !== 'true'));
$('#inspector-toggle').addEventListener('click', () => setInspector(!document.body.classList.contains('inspector-open'), true));
$('#inspector-close').addEventListener('click', () => setInspector(false, true));
$('#sidebar-backdrop').addEventListener('click', () => {
  if (document.body.classList.contains('inspector-open')) setInspector(false, true);
  else setSidebar(false);
});
document.addEventListener('keydown', (event) => {
  const openModalDialog = event.target?.closest?.('dialog[open]:not(#code-dock dialog)') || $$('dialog[open]:not(#code-dock dialog)').at(-1);
  if (openModalDialog && event.key === 'Escape' && !event.isComposing) {
    event.preventDefault();
    openModalDialog.close();
    return;
  }
  if ($('#command-palette-dialog')?.open && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); $('#command-palette-dialog').close(); return; }
  if ($('dialog[open]:not(#code-dock dialog)')) return;
  if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'k') {
    event.preventDefault(); openCommands(); return;
  }
  if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key === ',') {
    event.preventDefault(); openSettings('general'); return;
  }
  if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'n') {
    event.preventDefault(); newConversation(); $('#composer-input')?.focus(); return;
  }
  if ((event.metaKey || event.ctrlKey) && event.shiftKey && !event.altKey && event.key.toLowerCase() === 'g') {
    event.preventDefault();
    applyAppMode(appMode === 'godcode' ? 'godmode' : 'godcode', { persist: true, notify: true, switchView: true });
    return;
  }
  if ((event.metaKey || event.ctrlKey) && event.shiftKey && !event.altKey && event.key.toLowerCase() === 'p') {
    event.preventDefault();
    const task = selectedData?.task?.id === selectedId ? selectedData.task : null;
    if (!task || (!ACTIVE.has(task.status) && !task.draining && !isCrewBusy(task) && (!TERMINAL.has(task.status) || (task.status === 'completed' && task.workspaceKind === 'conversation')))) {
      togglePlanMode(task);
    }
    return;
  }
  const editing = event.target?.closest?.('input, textarea, select, [contenteditable="true"]');
  if (event.key === '?' && !editing && !event.metaKey && !event.ctrlKey && !event.altKey) {
    event.preventDefault(); dismissDrawers(); if (!$('#shortcuts-dialog').open) $('#shortcuts-dialog').showModal(); return;
  }
  if (!editing && !event.metaKey && !event.ctrlKey && !event.altKey && /^[1-5]$/.test(event.key)) {
    const visibleTabs = $$('.workspace-tab:not(.hidden)');
    const tab = visibleTabs[Number(event.key) - 1];
    if (tab) { event.preventDefault(); tab.click(); }
    return;
  }
  if (event.key === '/' && !editing && !event.metaKey && !event.ctrlKey && !event.altKey) {
    event.preventDefault();
    if (narrowLayout.matches) { setInspector(false); setSidebar(false); }
    $('#composer-input').focus(); return;
  }
  if (event.key === 'Tab' && narrowLayout.matches) {
    const drawer = document.body.classList.contains('inspector-open') ? $('#inspector') : document.body.classList.contains('sidebar-open') ? $('#sidebar') : null;
    if (drawer) {
      const items = $$('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex]:not([tabindex="-1"])', drawer).filter(element => element.getClientRects().length && !element.closest('[inert]'));
      const first = items[0], last = items.at(-1);
      if (first && ((!event.shiftKey && (document.activeElement === last || !drawer.contains(document.activeElement))) || (event.shiftKey && (document.activeElement === first || !drawer.contains(document.activeElement))))) {
        event.preventDefault(); (event.shiftKey ? last : first).focus();
      }
    }
    return;
  }
  if (!editing && currentTab === 'changes' && (event.key === 'j' || event.key === 'k')) {
    const items = $$('.diff-file-item');
    if (items.length > 1) {
      const currentIdx = items.findIndex(el => el.classList.contains('selected'));
      const next = event.key === 'j' ? Math.min(currentIdx + 1, items.length - 1) : Math.max(currentIdx - 1, 0);
      if (next !== currentIdx) { items[next].click(); items[next].scrollIntoView({ block: 'nearest' }); }
      event.preventDefault();
    }
    return;
  }
  if (!editing && !event.metaKey && !event.ctrlKey && !event.altKey && (event.key === '[' || event.key === ']')) {
    const visibleTabs = $$('.workspace-tab:not(.hidden)');
    const idx = visibleTabs.findIndex(tab => tab.dataset.tab === currentTab);
    if (idx >= 0) {
      const next = event.key === ']' ? Math.min(idx + 1, visibleTabs.length - 1) : Math.max(idx - 1, 0);
      if (next !== idx) visibleTabs[next]?.click();
      event.preventDefault();
    }
    return;
  }
  if (event.key !== 'Escape') return;
  if (!$('#overseer-popover')?.classList.contains('hidden')) {
    toggleOverseerPopover(false);
    $('#overseer-toggle')?.focus();
    event.preventDefault();
    return;
  }
  if (!$('#theme-popover')?.classList.contains('hidden')) {
    window.G0DThemes?.togglePopover?.(false);
    $('#theme-toggle')?.focus();
    event.preventDefault();
    return;
  }
  if ($('#conclave-dock')?.classList.contains('is-expanded')) {
    $('#conclave-expand')?.click();
    event.preventDefault();
    return;
  }
  if ($('#browser-dock')?.classList.contains('is-expanded')) {
    $('#bl-expand')?.click();
    event.preventDefault();
    return;
  }
  if ($('#visualizer-dock')?.classList.contains('is-expanded')) {
    $('#viz-expand-btn')?.click();
    event.preventDefault();
    return;
  }
  if ($('#composer-shell')?.classList.contains('composer-options-open')) {
    setComposerOptionsOpen(false);
    $('#composer-options-toggle')?.focus();
    event.preventDefault();
    return;
  }
  const taskMenu = $('.task-more[open]');
  if(taskMenu){taskMenu.open=false;$('summary',taskMenu)?.focus();event.preventDefault();return;}
  if (document.body.classList.contains('inspector-open')) { setInspector(false, true); event.preventDefault(); return; }
  if (narrowLayout.matches && document.body.classList.contains('sidebar-open')) { setSidebar(false); $('#sidebar-toggle').focus(); event.preventDefault(); return; }
  const zoomOverlay = $('.preview-overlay');
  if (zoomOverlay) { zoomOverlay.remove(); event.preventDefault(); return; }
  if (artifactDockState.open && !artifactDockState.inspectMode && !artifactDockState.fullscreen) { closeArtifactDock({ recordDismiss: true }); event.preventDefault(); return; }
  if (window.G0DVisualizer?.isOpen?.()) { window.G0DVisualizer.close(); event.preventDefault(); return; }
  if (window.G0DConclave?.isOpen?.()) { window.G0DConclave.close(); event.preventDefault(); return; }
  if (window.G0DBrowserLive?.isOpen?.()) { window.G0DBrowserLive.close(); event.preventDefault(); return; }
  const activeTaskNow = selectedData?.task?.id === selectedId ? selectedData.task : null;
  if (activeTaskNow && ACTIVE.has(activeTaskNow.status) && !$('#composer-input')?.value?.trim()) {
    event.preventDefault();
    taskAction('pause');
  }
});
narrowLayout.addEventListener('change', (event) => {
  if (!event.matches) document.body.classList.remove('sidebar-open');
  syncPanels();
});
$('.workspace-tabs').addEventListener('keydown', (event) => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  const tabs = $$('.workspace-tab:not(.hidden)');
  const index = tabs.indexOf(document.activeElement);
  if (index < 0) return;
  event.preventDefault();
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  tabs[next].click(); tabs[next].focus();
});
$('#welcome-create')?.addEventListener('click', () => {
  if ($('#settings-dialog')?.open) $('#settings-dialog').close();
  openCreate();
});
$('#app-mode-switcher')?.addEventListener('click', (event) => {
  const btn = event.target.closest('[data-app-mode]');
  if (!btn) return;
  const next = btn.dataset.appMode;
  if (next === appMode) return;
  applyAppMode(next, { persist: true, notify: true, switchView: true });
});
$('#godcode-open-repo')?.addEventListener('click', () => {
  openCreate(undefined, { source: 'project', objective: $('#composer-input')?.value || '', composerOrigin: selectedId || 'welcome' });
});
$('#godcode-open-worktrees')?.addEventListener('click', () => {
  $('#open-worktrees')?.click();
});
$('#godcode-open-fixtures')?.addEventListener('click', () => openCreate());
$('#task-search').title = 'Find a task (⌘K / Ctrl+K)';
$('#task-search').setAttribute('aria-keyshortcuts', 'Meta+K Control+K');
$('#task-search').addEventListener('input', () => renderTasks(true));
$('#task-content').addEventListener('scroll', updateLatestButton, { passive: true });
const latestResizeObs = new ResizeObserver(updateLatestButton);
latestResizeObs.observe($('#task-content'));
if ($('#panel-timeline')) latestResizeObs.observe($('#panel-timeline'));
$('#jump-latest').addEventListener('click', () => {
  const scroller = $('#task-content');
  scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' });
  scroller.focus({ preventScroll: true });
  updateLatestButton();
});
$('#create-fixture').addEventListener('change', updateFixtureHelp);
$('#create-workflow')?.addEventListener('change', () => {
  const w = state.workflows?.find(item => item.name === $('#create-workflow').value);
  setText('#create-workflow-help', w ? w.description : 'Presets adjust recovery depth, execution grants, and call budgets.');
});
$('#create-preferred').addEventListener('change',()=>{ createPreferredSelections.set(createSource,$('#create-preferred').value); renderCreateProviders(); createProviderSelections.set(createSource,new Set(orderedProviders($$('#create-providers input:checked').map(input=>input.value),$('#create-preferred').value))); if(createComposerOrigin)composerProviderDrafts.set(createComposerOrigin,new Map(createProviderSelections)); });
$('#create-providers').addEventListener('change', () => {
  createProviderSelections.set(createSource, new Set(orderedProviders($$('#create-providers input:checked').map(input => input.value), $('#create-preferred').value)));
  if (createComposerOrigin) composerProviderDrafts.set(createComposerOrigin, new Map(createProviderSelections));
  updateCreateAvailability();
});
$('#create-objective').addEventListener('input', () => { if (createSource === 'project') createProjectObjective = $('#create-objective').value; updateCreateAvailability(); });
$('#create-dialog').addEventListener('close', () => {
  if (createComposerOrigin) {
    composerProviderDrafts.set(createComposerOrigin, new Map(createProviderSelections));
    const draft = createSource === 'project' ? $('#create-objective').value : createProjectObjective;
    saveComposerDraft(createComposerOrigin, draft);
    if (composerScope === createComposerOrigin) { $('#composer-input').value = draft; resizeComposer(); }
  }
  renderComposer();
});
$('#create-recent-projects')?.addEventListener('click', (event) => {
  const chip = event.target.closest('[data-recent-create-path]');
  if (!chip) return;
  const val = chip.dataset.recentCreatePath || '';
  if (!val) return;
  $('#create-source-path').value = val;
  void previewImport();
});
$('#create-source-path').addEventListener('input', () => {
  importPreview = null;
  importPreviewVersion += 1;
  importPreviewBusy = false;
  $('#preview-import').disabled = false;
  setText('#preview-import', 'Preview copy');
  $('#import-preview').innerHTML = '';
  updateCreateAvailability();
  clearTimeout(autoPreviewTimer);
  const val = $('#create-source-path').value.trim();
  if (createSource === 'project' && /^(\/|~\/|[A-Za-z]:[\\/])/.test(val) && val.length >= 2) {
    autoPreviewTimer = setTimeout(() => {
      if (createSource === 'project' && $('#create-source-path').value.trim() === val) {
        void previewImport({ silentError: true });
      }
    }, 350);
  }
});
$('#preview-import').addEventListener('click', () => previewImport());
$('#create-form').addEventListener('submit', createTask);


$('#route-form').addEventListener('change',event=>{
  if(routeBusy)return;
  if(event.target.name==='route-primary')$('#route-preferred').value=event.target.value;
  routeDirty=true;
  saveRoute({preventDefault(){}});
});
$('#route-form').addEventListener('submit', saveRoute);
$('#benchmark-open')?.addEventListener('click', openBenchmark);
$('#benchmark-run').addEventListener('click', runBenchmark);
$('#about-open').addEventListener('click', () => { dismissDrawers(); renderAbout(); if (!$('#about-dialog').open) $('#about-dialog').showModal(); });
$('#security-posture-pill')?.addEventListener('click', () => { toggleOverseerPopover(false); openSettings('privacy'); });
$('#schedules-sidebar-btn')?.addEventListener('click', () => { toggleOverseerPopover(false); openSettings('schedules'); });
$('#overseer-toggle')?.addEventListener('click', event => { event.stopPropagation(); toggleOverseerPopover(); });
$('#overseer-popover')?.addEventListener('click', async event => {
  event.stopPropagation();
  if (event.target.closest('[data-close-overseer-popover]')) { toggleOverseerPopover(false); return; }
  const toggleBtn = event.target.closest('[data-overseer-pop-toggle]');
  if (toggleBtn) {
    const val = toggleBtn.dataset.overseerPopToggle;
    if (val === 'off') await updateOverseerSettings({ enabled: false });
    else if (val) await updateOverseerSettings({ enabled: true, providerId: val });
    return;
  }
  const postureBtn = event.target.closest('[data-overseer-posture]');
  if (postureBtn) {
    await updateOverseerSettings({ posture: postureBtn.dataset.overseerPosture });
    return;
  }
  if (event.target.closest('[data-overseer-consult-now]')) {
    if (!selectedId || overseerBusy) return;
    overseerBusy = true;
    renderOverseerEdge();
    try {
      const res = await api(`/api/tasks/${encodeURIComponent(selectedId)}/overseer-consult`, { method: 'POST', body: JSON.stringify({}) });
      toast(`✦ Overseer (${res.advice?.status || 'reviewed'}): ${res.advice?.diagnosis || 'Guidance injected for next turn.'}`);
      await refresh();
    } catch (error) {
      toast(error.message || 'Overseer consultation failed.');
    } finally {
      overseerBusy = false;
      renderOverseerEdge();
    }
    return;
  }
  if (event.target.closest('[data-overseer-pop-clear]')) {
    try {
      const res = await api('/api/learning/patterns', { method: 'DELETE', body: '{}' });
      if (res.overseer) { overseerData = res.overseer; state.overseer = res.overseer; }
      renderOverseerSection();
      renderOverseerEdge();
      toast('Cleared learned refusal signatures.');
    } catch (error) { toast(error.message); }
    return;
  }
  if (event.target.closest('[data-overseer-pop-settings]')) {
    toggleOverseerPopover(false);
    openSettings('autonomy', { scrollTo: '#overseer-section' });
  }
});
$('#overseer-popover')?.addEventListener('change', event => {
  const t = event.target;
  if (t.id === 'overseer-pop-primary') {
    const val = t.value || null;
    updateOverseerSettings({ providerId: val, enabled: Boolean(val) });
  } else if (t.id === 'overseer-pop-backup') {
    updateOverseerSettings({ backupProviderId: t.value || null });
  } else if (t.id === 'overseer-pop-judge') {
    updateOverseerSettings({ autoJudgeAmbiguous: t.checked });
  } else if (t.id === 'overseer-pop-unblock') {
    updateOverseerSettings({ autoUnblockStuck: t.checked });
  } else if (t.id === 'overseer-pop-audit') {
    updateOverseerSettings({ autoAuditCompletion: t.checked });
  } else if (t.id === 'overseer-pop-coach') {
    updateOverseerSettings({ autoCoachLongRuns: t.checked });
  }
});
const flushPendingOverseerHtml = (el) => {
  if (!el?.dataset?.pendingHtml || overseerBusy) return;
  const focusedEl = document.activeElement;
  if (focusedEl && el.contains(focusedEl) && ['SELECT', 'TEXTAREA', 'INPUT'].includes(focusedEl.tagName)) return;
  const next = el.dataset.pendingHtml;
  delete el.dataset.pendingHtml;
  el.dataset.lastHtml = next;
  el.innerHTML = next;
};
$('#overseer-popover')?.addEventListener('focusout', () => setTimeout(() => flushPendingOverseerHtml($('#overseer-popover-body')), 0));
$('#overseer-section')?.addEventListener('focusout', () => setTimeout(() => flushPendingOverseerHtml($('#overseer-section')), 0));
document.addEventListener('toggle', event => {
  const el = event.target;
  if (el?.matches?.('.thinking-block.thinking-live')) {
    streamThinkingExpanded = el.open;
    const isActivelyThinking = Boolean(streamThinking && !streamText);
    const metaEl = $('.thinking-meta', el);
    if (metaEl) metaEl.textContent = formatLiveThinkingMeta(streamThinking, isActivelyThinking, el.open);
    if (el.open) {
      const body = $('.stream-thinking-body', el);
      if (body) body.scrollTop = body.scrollHeight;
    }
  }
}, true);
document.addEventListener('click', event => {
  const pop = $('#overseer-popover');
  if (pop && !pop.classList.contains('hidden') && event.target?.isConnected && !pop.contains(event.target) && !event.target.closest('#overseer-toggle')) {
    toggleOverseerPopover(false);
  }
});
window.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    const pop = $('#overseer-popover');
    if (pop && !pop.classList.contains('hidden')) toggleOverseerPopover(false);
  }
});
$('#copy-id').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(selectedId ?? ''); toast('Task ID copied.'); }
  catch { toast('Clipboard is unavailable. The full task ID is in the activity ledger.'); }
});

document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
window.addEventListener('online', refresh);
try {
  syncPanels();
  applyAppMode(appMode, { persist: false, notify: false });
  syncComposerShortcutHints();
  renderComposer();
} catch (error) {
  console.error('Initial UI setup error:', error);
}
async function initializeSession() {
  const token = new URLSearchParams(location.hash.slice(1)).get('session');
  if (token) {
    history.replaceState(null, '', location.pathname + location.search);
    try { await api('/api/session', {method: 'POST', body: JSON.stringify({token})}); }
    catch (error) { setVisible('#initial-loading', false); errorIn('#global-error', error); return; }
  }
  await refresh();
  await loadSkills(selectedId);
  refreshTimer ??= setInterval(() => { if (!document.hidden) refresh(); }, 1100);
}
window.addEventListener('hashchange', () => {
  if (new URLSearchParams(location.hash.slice(1)).has('session')) initializeSession();
});
initializeSession();

/* ── Theme toggle (handled by public/themes.js 8-theme engine) ── */
window.toast = toast;

/* ── Tab completion / autocomplete (/commands & @file) ────── */
(function initTabComplete() {
  const popup = $('#autocomplete-popup');
  const input = $('#composer-input');
  if (!popup || !input) return;

  let acItems = [];
  let acIndex = -1;
  let acVisible = false;
  let acTokenRange = null;

  const SLASH_COMMANDS = [
    { cmd: '/godmode', hint: 'Switch to GODMODƎ sovereign local chat interface' },
    { cmd: '/godcode', hint: 'Switch to GODCODƎ autonomous coding & worktree workspace' },
    { cmd: '/system', hint: 'Inspect & edit all system prompts and tool schemas' },
    { cmd: '/prefill', hint: 'Open Prefills & Message Shaping (chat & reasoning prefills)' },
    { cmd: '/models', hint: 'Model connections' },
    { cmd: '/prompts', hint: 'Prompt library' },
    { cmd: '/rewind', hint: 'Edit or rewind this conversation' },
    { cmd: '/plan', hint: 'Switch to read-only Plan Mode' },
    { cmd: '/build', hint: 'Switch to Build Mode (allow edits)' },
    { cmd: '/effort', hint: 'Set thinking & planning effort (/effort fast | medium | high | max)' },
    { cmd: '/fast', hint: 'Switch to Fast / Instant mode (skip todo planning)' },
    { cmd: '/compact', hint: 'Compact context into fresh-eyes summary' },
    { cmd: '/diff', hint: 'View workspace changes' },
    { cmd: '/undo', hint: 'Rewind last git checkpoint (/undo [steps])' },
    { cmd: '/rename', hint: 'Rename the current conversation (/rename New Title)' },
    { cmd: '/fork', hint: 'Fork this conversation into a new task (/fork [title])' },
    { cmd: '/export', hint: 'Copy Markdown transcript to clipboard' },
    { cmd: '/remember', hint: 'Save a note to persistent memory (/remember <note>)' },
    { cmd: '/memory', hint: 'Search or manage persistent memory (/memory [query])' },
    { cmd: '/skill', hint: 'Save reusable skill (/skill save <name> <instructions>)' },
    { cmd: '/privacy', hint: 'Open Privacy & ZDR Shield (zero telemetry & egress controls)' },
    { cmd: '/schedules', hint: 'Open Scheduled Jobs & Cron Automations (/cron)' },
    { cmd: '/northstar', hint: 'Launch a multi-hour North Star AutoResearch hill-climb (/climb)' },
    { cmd: '/cron', hint: 'Manage recurring cron jobs & timers' },
    { cmd: '/alerts', hint: 'Configure optional sounds & desktop notifications' },
    { cmd: '/mute', hint: 'Toggle Do Not Disturb (mute / unmute sounds & alerts)' },
    { cmd: '/schemas', hint: 'Inspect & edit all 27 JSON tool schemas' },
    { cmd: '/inject', hint: 'Open Prefills & Message Shaping lab' },
    { cmd: '/model', hint: 'Choose or switch model route' },
    { cmd: '/review', hint: 'Review current changes for bugs & tests' },
    { cmd: '/test', hint: 'Run targeted tests & checks' },
    { cmd: '/help', hint: 'Show available slash commands & shortcuts' },
    { cmd: '/ultra', hint: 'Toggle Ultra-Plinian mode' },
    { cmd: '/fixtures', hint: 'Browse test fixtures' },
    { cmd: '/theme', hint: 'Switch UI theme (/theme obsidian | minimal | alabaster | dragons | psychedelic | hacker | synthwave | vesuvian | ancient | celestial)' },
    { cmd: '/settings', hint: 'Open settings' },
    { cmd: '/forge', hint: 'Forge a task-specific Megaprompt & rubric into the composer (/forge <prompt>)' },
    { cmd: '/visualize', hint: 'Open bespoke Live Sidecar Visualizer for what the agent is doing (/visualize [refinement])' },
    { cmd: '/browser', hint: 'Open Live Browser mirror (/browser window | headless | close)' },
    { cmd: '/conclave', hint: 'Open The Conclave or launch directly (/conclave <mission> | roster | demo | forge)' },
    { cmd: '/swarm', hint: 'Open The Conclave multi-agent swarm visualizer' },
    { cmd: '/benchmark', hint: 'Run offline harness diagnostics' },
    { cmd: '/clear', hint: 'Start a new conversation' },
  ];

  function formatFileBytes(bytes) {
    if (!Number.isFinite(bytes)) return '';
    return bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} B`;
  }

  function getCompletions(text, cursorPos) {
    acTokenRange = null;
    const beforeCursor = text.slice(0, cursorPos);
    const atMatch = beforeCursor.match(/(?:^|\s)(@([^\s]*))$/);
    if (atMatch) {
      const token = atMatch[1];
      const query = atMatch[2].toLowerCase();
      const files = Array.isArray(selectedData?.files) ? selectedData.files : [];
      if (files.length) {
        acTokenRange = { start: cursorPos - token.length, end: cursorPos };
        return files
          .filter(f => !query || f.path.toLowerCase().includes(query))
          .slice(0, 12)
          .map(f => ({ value: `@${f.path} `, label: f.path, hint: formatFileBytes(f.bytes), kind: '@' }));
      }
      return [];
    }
    const trimmed = text.trimStart();
    if (/^![A-Z0-9_+-]*$/i.test(trimmed)) return promptLibrary.filter(c=>c.tag.startsWith(trimmed.toUpperCase())).slice(0,12).map(c=>({value:c.tag+' ',label:c.tag,hint:c.prompt,kind:'!'}));
    if (trimmed.startsWith('/') && !trimmed.includes(' ')) {
      const query = trimmed.toLowerCase();
      const builtIns = SLASH_COMMANDS
        .filter(c => c.cmd.startsWith(query))
        .map(c => ({ value: c.cmd, label: c.cmd, hint: c.hint, kind: '/' }));
      const builtInSet = new Set(SLASH_COMMANDS.map(c => c.cmd));
      const dynamicSkills = (state.skills || [])
        .map(skill => {
          const cmd = (skill.command || `/${skill.name}`).toLowerCase();
          return {
            value: `${cmd} `,
            label: cmd,
            hint: `${skill.scope === 'project' ? 'project' : 'skill'}${skill.description ? ` · ${skill.description}` : ''}`,
            kind: 'skill',
            scope: skill.scope || 'global',
          };
        })
        .filter(s => !builtInSet.has(s.label) && (s.label.startsWith(query) || s.hint.toLowerCase().includes(query.slice(1))));
      return [...dynamicSkills, ...builtIns].slice(0, 30);
    }
    return [];
  }

  function renderPopup() {
    if (!acItems.length) { hidePopup(); return; }
    popup.innerHTML = acItems.map((item, i) => {
      const isFile = item.kind === '@';
      const isSkill = item.kind === 'skill';
      const kindPill = isFile
        ? '<span class="ac-kind ac-kind-file">FILE</span>'
        : isSkill
          ? `<span class="ac-kind ac-kind-skill">${item.scope === 'project' ? 'PROJ' : 'SKILL'}</span>`
          : '<span class="ac-kind ac-kind-cmd">CMD</span>';
      let labelHtml;
      if (isFile) {
        const slash = item.label.lastIndexOf('/');
        if (slash >= 0) {
          const dir = item.label.slice(0, slash + 1);
          const name = item.label.slice(slash + 1);
          labelHtml = `<span class="ac-dir">${escapeHTML(dir)}</span><span class="ac-name">${escapeHTML(name)}</span>`;
        } else {
          labelHtml = `<span class="ac-name">${escapeHTML(item.label)}</span>`;
        }
      } else {
        labelHtml = `<span class="ac-name">${escapeHTML(item.label)}</span>`;
      }
      return `<button type="button" class="autocomplete-item" role="option" data-ac-index="${i}" id="ac-option-${i}" tabindex="-1" aria-selected="${i === acIndex}">`
        + kindPill
        + `<span class="ac-label">${labelHtml}</span>`
        + `<span class="ac-hint">${escapeHTML(item.hint)}</span></button>`;
    }).join('');
    popup.classList.remove('hidden');
    popup.removeAttribute('aria-hidden');
    acVisible = true;
    composerAutocompleteState.visible = true;
    input.setAttribute('aria-expanded', 'true');
    input.setAttribute('aria-activedescendant','ac-option-'+acIndex);
    popup.children[acIndex]?.scrollIntoView({block:'nearest'});
  }

  function hidePopup() {
    popup.classList.add('hidden');
    popup.setAttribute('aria-hidden', 'true');
    acVisible = false;
    composerAutocompleteState.visible = false;
    acIndex = -1;
    input.setAttribute('aria-expanded','false');
    input.removeAttribute('aria-activedescendant');
    acTokenRange = null;
  }

  function acceptItem(index) {
    const item = acItems[index];
    if (!item) return;
    if (item.kind === '@' && acTokenRange) {
      const before = input.value.slice(0, acTokenRange.start);
      const after = input.value.slice(acTokenRange.end);
      input.value = before + item.value + after;
      const nextPos = before.length + item.value.length;
      hidePopup();
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.focus();
      try { input.setSelectionRange(nextPos, nextPos); } catch {}
      return;
    }
    input.value = item.value;
    hidePopup();
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
  }

  composerAutocompleteState.hide = hidePopup;
  composerAutocompleteState.accept = () => { if (acIndex >= 0) acceptItem(acIndex); };
  composerAutocompleteState.shouldDeferEnter = () => {
    if (!acVisible || acIndex < 0 || !acItems[acIndex]) return false;
    const item = acItems[acIndex];
    if (item.kind === '@') return true;
    if (item.kind === '/' || item.kind === 'skill') {
      // If user already typed the exact slash command, let Enter submit & execute it.
      return input.value.trim().toLowerCase() !== item.label.toLowerCase();
    }
    return false;
  };

  function updateCompletions() {
    const text = input.value;
    if (!text.trim()) { hidePopup(); return; }
    const cursorPos = typeof input.selectionStart === 'number' ? input.selectionStart : text.length;
    acItems = getCompletions(text, cursorPos);
    acIndex = acItems.length ? 0 : -1;
    renderPopup();
  }

  input.addEventListener('input', updateCompletions);

  input.addEventListener('keydown', (event) => {
    if (!acVisible || event.isComposing || event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) return;
    if (event.key === 'Tab' || (event.key === 'Enter' && ['!','/','@','skill'].includes(acItems[acIndex]?.kind) && input.value.trim().toLowerCase() !== acItems[acIndex].label.toLowerCase())) {
      event.preventDefault(); event.stopImmediatePropagation(); acceptItem(acIndex);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      acIndex = (acIndex + (event.key === 'ArrowDown' ? 1 : -1) + acItems.length) % acItems.length;
      renderPopup();
    } else if (event.key === 'Escape') {
      event.preventDefault(); event.stopImmediatePropagation(); hidePopup();
    } else if (event.key === 'Enter') hidePopup();
  }, true);
  input.addEventListener('blur',()=>{ if (!popup.matches(':hover')) hidePopup(); });
  document.addEventListener('close',hidePopup,true);

  popup.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-ac-index]');
    if (btn) acceptItem(Number(btn.dataset.acIndex));
  });

  document.addEventListener('click', (event) => {
    if (acVisible && !popup.contains(event.target) && event.target !== input) hidePopup();
  });
})();

/* One selection surface for the composer and Settings. */
let pickerScope = null;
let pickerReturnFocus = null;
let pickerModels = [];
let pickerIndex = 0;
let pickerLoading = false;
let pickerProviderFilter = 'all';
let recentModels = [];
try { const saved = JSON.parse(localStorage.getItem('g0dc0d3.recentModels') || '[]'); if (Array.isArray(saved)) recentModels = saved.filter(id => typeof id === 'string').slice(0, 5); } catch {}

function modelSelectionLock(task) {
  if (!task) return '';
  if (isCrewBusy(task)) return 'Finish or dismiss the crew to change models.';
  if (task.draining) return 'Workspace work is still settling; try again in a moment.';
  if (TERMINAL.has(task.status) && !(task.workspaceKind === 'conversation' && task.completionKind === 'answered')) return 'Send a follow-up to continue this task before changing models.';
  return '';
}

function pickerTask() { return pickerScope && selectedData?.task?.id === pickerScope ? selectedData.task : null; }
function selectableModels(task) {
  const configured = state.providers.filter(p => p.available !== false && (task?.fixtureId || p.kind !== 'scripted'));
  const configuredIds = new Set(configured.map(p => p.id));
  const catalog = !task || task.workspaceKind === 'conversation' ? veniceCatalog.models : [];
  // The catalog and configured Venice connections can refer to the same model.
  const catalogModels = new Set(catalog.map(model => model.model));
  // Hide bare CLI subscription alias when per-model entries (e.g. codex-cli:gpt-5.4) are already present,
  // unless it is the active model for this task.
  const cliSubIdsWithChildren = new Set(
    configured
      .filter(p => ['codex', 'claude', 'antigravity-cli', 'gemini-cli', 'copilot-cli'].includes(p.kind) && p.id.includes(':'))
      .map(p => p.id.split(':')[0])
  );
  const base = [
    ...catalog,
    ...configured.filter(p => {
      if (catalogModels.has(p.model) && /venice/i.test(p.id)) return false;
      if (cliSubIdsWithChildren.has(p.id) && task?.providerId !== p.id) return false;
      return true;
    })
  ];
  if (!task?.fixtureId && openrouterCatalog.connected && Array.isArray(openrouterCatalog.models) && openrouterCatalog.models.length) {
    const existingIds = new Set(base.map(p => p.id));
    const existingOpenRouterModels = new Set(base.filter(p => p.id?.startsWith('openrouter:')).map(p => p.model).filter(Boolean));
    for (const m of openrouterCatalog.models) {
      if (existingIds.has(m.id) || existingOpenRouterModels.has(m.model)) continue;
      base.push({ ...m, kind: 'http', catalogAdd: true, catalogProvider: 'openrouter' });
    }
  }
  if (!task?.fixtureId) {
    for (const prov of DIRECT_CATALOG_KEYS) {
      const dcat = directCatalogs[prov];
      if (!dcat?.connected || !Array.isArray(dcat.models) || !dcat.models.length) continue;
      const existingIds = new Set(base.map(p => p.id));
      const existingModels = new Set(base.filter(p => p.id?.startsWith(`${prov}:`)).map(p => p.model).filter(Boolean));
      for (const m of dcat.models) {
        if (existingIds.has(m.id) || existingModels.has(m.model) || configuredIds.has(m.id)) continue;
        base.push({ ...m, kind: 'http', catalogAdd: true, catalogProvider: prov });
      }
    }
  }
  return base;
}

function positionModelPicker() {
  const dialog = $('#model-picker');
  if (!dialog.open) return;
  const anchor = pickerReturnFocus?.getBoundingClientRect();
  const inSettings = $('#settings-dialog').open;
  dialog.style.width = `${Math.min(400, window.innerWidth - 24)}px`;
  dialog.style.maxHeight = `${Math.min(510, window.innerHeight - 32)}px`;
  const left = inSettings || !anchor ? (window.innerWidth - dialog.offsetWidth) / 2 : anchor.left;
  const top = inSettings || !anchor ? (window.innerHeight - dialog.offsetHeight) / 2 : anchor.top - dialog.offsetHeight - 8;
  dialog.style.left = `${Math.max(12, Math.min(left, window.innerWidth - dialog.offsetWidth - 12))}px`;
  dialog.style.top = `${Math.max(16, Math.min(top, window.innerHeight - dialog.offsetHeight - 16))}px`;
}

function highlightPickerModel(index, scroll = false) {
  pickerIndex = Math.max(0, Math.min(index, pickerModels.length - 1));
  $$('#model-picker-results [role="option"]').forEach((row, i) => row.classList.toggle('highlighted', i === pickerIndex));
  const row = $$('#model-picker-results [role="option"]')[pickerIndex];
  if (row) $('#model-picker-search').setAttribute('aria-activedescendant', row.id);
  else $('#model-picker-search').removeAttribute('aria-activedescendant');
  if (scroll) row?.scrollIntoView({block:'nearest'});
}

function modelMetaById(id) {
  if (!id || !Array.isArray(state.modelGroups)) return null;
  const all = state.modelGroups.find(g => g.id === 'all-smartest');
  const fromAll = all?.models?.find(m => m.id === id);
  if (fromAll) return fromAll;
  for (const g of state.modelGroups) {
    const found = g.models?.find(m => m.id === id);
    if (found) return found;
  }
  return null;
}

function pickerBucketOf(p) {
  const id = String(p?.id || '');
  if (p?.kind === 'codex' || id === 'codex-cli' || id.startsWith('codex-cli:')) return 'codex-cli';
  if (p?.kind === 'claude' || id === 'claude-code' || id.startsWith('claude-code:')) return 'claude-code';
  if (p?.kind === 'antigravity-cli' || id === 'antigravity-cli' || id.startsWith('antigravity-cli:')) return 'antigravity-cli';
  if (p?.kind === 'gemini-cli' || id === 'gemini-cli' || id.startsWith('gemini-cli:')) return 'gemini-cli';
  if (p?.kind === 'copilot-cli' || id === 'copilot-cli' || id.startsWith('copilot-cli:')) return 'copilot-cli';
  if (p?.catalogProvider === 'openrouter' || id.startsWith('openrouter:')) return 'openrouter';
  if (catalogId(id) || id.startsWith('venice:') || /venice/i.test(id)) return 'venice';
  if (p?.catalogProvider === 'anthropic' || id.startsWith('anthropic:')) return 'anthropic';
  if (p?.catalogProvider === 'openai' || id.startsWith('openai:')) return 'openai';
  if (p?.catalogProvider === 'xai' || id.startsWith('xai:')) return 'xai';
  if (p?.catalogProvider === 'gemini' || id.startsWith('gemini:')) return 'gemini';
  if (p?.catalogProvider === 'meta' || id.startsWith('meta:')) return 'meta';
  if (id.startsWith('nous:')) return 'nous';
  if (p?.tier === 'local' || id.startsWith('local:')) return 'local';
  if (p?.kind === 'cli') return 'cli';
  return 'other';
}

const PICKER_BUCKET_LABELS = {
  all: 'All',
  'codex-cli': 'Codex',
  'claude-code': 'Claude Code',
  'antigravity-cli': 'Antigravity',
  'gemini-cli': 'Gemini CLI',
  'copilot-cli': 'Copilot',
  openrouter: 'OpenRouter',
  venice: 'Venice',
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  xai: 'Grok (xAI)',
  gemini: 'Gemini',
  meta: 'Meta / Muse',
  nous: 'Nous',
  local: 'Local',
  cli: 'CLI',
  other: 'Other',
};

function renderModelPicker() {
  if (!$('#model-picker').open) return;
  const task = pickerTask();
  const isTaskActive = Boolean(task && ACTIVE.has(task.status));
  const pendingNext = task && Array.isArray(task.pendingProviders) && task.pendingProviders.length ? task.pendingProviders[0] : null;
  const selected = pendingNext || task?.providerId || newConversationProviders()[0];
  const previous = pickerModels[pickerIndex]?.id;
  const rawQuery = $('#model-picker-search').value.trim();
  const query = rawQuery.toLowerCase();
  const models = selectableModels(task);
  // Keep the actual active connection visible even when a catalog alias exists.
  if (selected && !models.some(p => p.id === selected)) {
    const active = providerById(selected);
    if (active && active.available !== false) models.unshift(active);
  }
  const bucketCounts = new Map();
  for (const m of models) {
    const b = pickerBucketOf(m);
    bucketCounts.set(b, (bucketCounts.get(b) || 0) + 1);
  }
  if (pickerProviderFilter !== 'all' && !bucketCounts.has(pickerProviderFilter)) {
    pickerProviderFilter = 'all';
  }
  const filterBar = $('#model-picker-filters');
  if (filterBar) {
    if (bucketCounts.size >= 2) {
      filterBar.classList.remove('hidden');
      const order = ['codex-cli', 'claude-code', 'antigravity-cli', 'gemini-cli', 'copilot-cli', 'openai', 'anthropic', 'xai', 'gemini', 'meta', 'openrouter', 'venice', 'nous', 'local', 'cli', 'other'].filter(b => bucketCounts.has(b));
      const chips = [
        `<button type="button" class="model-filter-chip${pickerProviderFilter === 'all' ? ' active' : ''}" data-picker-filter="all" aria-pressed="${pickerProviderFilter === 'all'}">All · ${models.length}</button>`,
        ...order.map(b => `<button type="button" class="model-filter-chip${pickerProviderFilter === b ? ' active' : ''}" data-picker-filter="${b}" aria-pressed="${pickerProviderFilter === b}">${escapeHTML(PICKER_BUCKET_LABELS[b] || b)} · ${bucketCounts.get(b)}</button>`)
      ];
      filterBar.innerHTML = chips.join('');
    } else {
      filterBar.classList.add('hidden');
      filterBar.innerHTML = '';
    }
  }
  const rank = p => {
    if (p.id === selected) return -3;
    if (recentModels.includes(p.id)) return recentModels.indexOf(p.id) - 2;
    if (p.catalogAdd) return query ? 12 : 20;
    return 10;
  };
  const metaOf = p => p?.meta || modelMetaById(p?.id);
  const iqOf = p => {
    const m = metaOf(p);
    return Number(m?.effectiveIntelligence ?? m?.intelligence ?? 0);
  };
  models.sort((a,b) => rank(a) - rank(b) || (iqOf(b) - iqOf(a)) || (a.label || a.id).localeCompare(b.label || b.id));
  const scoped = pickerProviderFilter === 'all' ? models : models.filter(p => pickerBucketOf(p) === pickerProviderFilter);
  const matched = scoped.filter(p => `${p.label || ''} ${p.name || ''} ${p.model || ''} ${p.id}`.toLowerCase().includes(query));
  // If OpenRouter is connected and the user typed a custom org/model slug not yet listed, offer 1-click add.
  if (!task?.fixtureId && openrouterCatalog.connected && /^[a-zA-Z0-9][a-zA-Z0-9._-]+\/[a-zA-Z0-9][a-zA-Z0-9:._/+~-]{0,120}$/.test(rawQuery)) {
    const exactExists = matched.some(p => p.model?.toLowerCase() === query && p.id?.startsWith('openrouter:'));
    if (!exactExists) {
      matched.push({
        id: 'openrouter:' + rawQuery.replaceAll('/', '-'),
        model: rawQuery,
        label: `${rawQuery} · OpenRouter`,
        kind: 'http',
        catalogAdd: true,
        catalogProvider: 'openrouter',
        customSlug: true
      });
    }
  }
  const totalMatches = matched.length;
  const maxVisible = 80;
  pickerModels = matched.slice(0, maxVisible);
  const lock = modelSelectionLock(task);
  setText('#model-picker-scope', task ? 'This chat' : 'New chats');
  setText('#model-picker-count', pickerLoading ? 'Loading…' : `${totalMatches} ${totalMatches === 1 ? 'model' : 'models'}`);
  const race = task ? task.answerRace : RecoveryUI.preferences().answerRace;
  const activeNote = isTaskActive
    ? (pendingNext
        ? `Queued for your next message: ${providerById(pendingNext)?.label || pendingNext}. Current turn finishes on ${providerById(task.providerId)?.label || task.providerId}.`
        : 'Response in progress — pick a model for your next message.')
    : null;
  setText('#model-picker-note', lock || activeNote || (race ? 'Ultra-Plinian is on. This selects the model used when comparison is off.' : task ? 'Select a model for your next message.' : 'Select the default for new chats.'));
  const rowsHtml = pickerModels.map((p,i) => {
    const name = p.label || p.model || p.id;
    const isOr = p.id?.startsWith('openrouter:') || p.catalogProvider === 'openrouter';
    const isOpenAi = p.id?.startsWith('openai:') || p.catalogProvider === 'openai';
    const isAnthropic = p.id?.startsWith('anthropic:') || p.catalogProvider === 'anthropic';
    const isXai = p.id?.startsWith('xai:') || p.catalogProvider === 'xai';
    const isGemini = p.id?.startsWith('gemini:') || p.catalogProvider === 'gemini';
    const isMeta = p.id?.startsWith('meta:') || p.catalogProvider === 'meta';
    const connection = catalogId(p.id) || /venice/i.test(p.id)
      ? 'Venice'
      : isOr ? 'OpenRouter'
      : isOpenAi ? 'OpenAI API'
      : isAnthropic ? 'Anthropic API'
      : isXai ? 'xAI (Grok)'
      : isGemini ? 'Gemini API'
      : isMeta ? 'Meta AI'
      : kindLabel(p.kind || 'http');
    const meta = metaOf(p);
    const detail = [
      connection,
      p.customSlug ? 'Add custom OpenRouter model' : '',
      meta?.tier ? `Est. ${meta.tier}·${meta.intelligence}` : '',
      meta?.priceLabel || formatOpenRouterPrice(p.pricing) || '',
      meta?.contextLabel || formatOpenRouterContext(p.contextWindow) || '',
      meta?.zdr?.label || '',
      isTaskActive && pendingNext && p.id === task.providerId ? 'Running now' : '',
      isTaskActive && pendingNext && p.id === pendingNext ? 'Queued next' : '',
      recentModels.includes(p.id) && p.id !== selected ? 'Recent' : ''
    ].filter(Boolean).join(' · ');
    const badge = p.id === selected ? '✓' : p.catalogAdd ? '+' : '';
    const badgeTitle = p.catalogAdd ? `Click to add and select from ${humanize(p.catalogProvider || 'catalog')}` : '';
    return `<button type="button" id="model-picker-option-${i}" class="model-picker-option ${p.catalogAdd ? 'is-catalog-add' : ''}" role="option" aria-selected="${p.id === selected}" data-pick-model="${escapeHTML(p.id)}" ${lock || routeBusy ? 'disabled' : ''}><span class="model-picker-name"><strong>${escapeHTML(name)}</strong><small>${escapeHTML(detail)}</small></span><span class="model-picker-check ${p.catalogAdd ? 'is-add' : ''}" aria-hidden="true" ${badgeTitle ? `title="${escapeHTML(badgeTitle)}"` : ''}>${badge}</span></button>`;
  }).join('');
  const overflowNote = totalMatches > pickerModels.length
    ? `<p class="model-picker-empty model-picker-more">Showing top ${pickerModels.length} of ${totalMatches} models — type to filter…</p>`
    : '';
  const emptyPickerHtml = pickerLoading
    ? '<p class="model-picker-empty">Loading connected models…</p>'
    : query && pickerProviderFilter !== 'all'
      ? `<p class="model-picker-empty">No matches in this provider filter. <button type="button" class="text-button" data-picker-reset-filter>Search all providers</button></p>`
      : query
        ? '<p class="model-picker-empty">No matching models. Try another name.</p>'
        : '<p class="model-picker-empty">Connect a provider to choose a model.</p>';
  const resultsEl = $('#model-picker-results');
  const nextPickerHtml = pickerModels.length ? rowsHtml + overflowNote : emptyPickerHtml;
  if (resultsEl && resultsEl.dataset.lastHtml !== nextPickerHtml) {
    const prevScroll = resultsEl.scrollTop;
    resultsEl.dataset.lastHtml = nextPickerHtml;
    resultsEl.innerHTML = nextPickerHtml;
    resultsEl.scrollTop = prevScroll;
  }
  highlightPickerModel(Math.max(0, pickerModels.findIndex(p => p.id === previous)));
  positionModelPicker();
}

async function openModelPicker(scope = selectedId, anchor = document.activeElement) {
  pickerScope = scope;
  pickerReturnFocus = anchor;
  pickerModels = [];
  pickerIndex = 0;
  $('#model-picker-search').value = '';
  setText('#model-picker-error', '');
  pickerLoading = true;
  $('#model-picker').showModal();
  $('#composer-model').setAttribute('aria-expanded', 'true');
  renderModelPicker();
  $('#model-picker-search').focus();
  const activeApis = new Set((state.connectedApiProviders || []).filter(c => c.enabled !== false).map(c => c.provider));
  await Promise.all([
    loadVeniceCatalog(),
    state.openrouterConnectionId && (openrouterCatalog.stale || openrouterCatalog.models.length <= 20) ? loadOpenRouterCatalog() : Promise.resolve(),
    ...DIRECT_CATALOG_KEYS.map(prov => activeApis.has(prov) && (!directCatalogs[prov].connected || directCatalogs[prov].stale) ? loadDirectProviderCatalog(prov) : Promise.resolve()),
    Array.isArray(state.modelGroups) && state.modelGroups.length ? Promise.resolve() : loadModelGroups()
  ]);
  pickerLoading = false;
  renderModelPicker();
}
$('#model-picker-results')?.addEventListener('click', event => {
  if (event.target.closest('[data-picker-reset-filter]')) {
    pickerProviderFilter = 'all';
    pickerIndex = 0;
    renderModelPicker();
    $('#model-picker-search')?.focus();
  }
});
$('#model-picker-filters')?.addEventListener('click', event => {
  const chip = event.target.closest('[data-picker-filter]');
  if (!chip) return;
  pickerProviderFilter = chip.dataset.pickerFilter || 'all';
  pickerIndex = 0;
  renderModelPicker();
  $('#model-picker-search')?.focus();
});

async function selectModel(id, {scope = pickerScope, backup} = {}) {
  if (!id || routeBusy) return false;
  const task = scope ? selectedData?.task : null;
  if (scope && task?.id !== scope) throw new Error('The selected chat changed. Open the model picker again.');
  const lock = modelSelectionLock(task);
  if (lock) throw new Error(lock);
  const previous = task ? taskProviders(task) : newConversationProviders();
  let fallbacks = backup === undefined ? previous.slice(1).filter(other => other !== id && catalogId(other) === catalogId(id)) : backup ? [backup] : [];
  if (catalogId(id) && backup === undefined && id !== previous[0]) {
    const savedForPrimary = preferredVeniceBackup?.primary === id ? preferredVeniceBackup.id : undefined;
    const automatic = savedForPrimary !== undefined ? savedForPrimary : RecoveryUI.recommendedBackup(veniceCatalog.models, id);
    fallbacks = automatic && automatic !== id ? [automatic] : [];
  } else if (!catalogId(id) && backup === undefined) {
    const pol = task ? RecoveryUI.policy(task) : RecoveryUI.policy(null);
    if (pol.mode !== 'ask' && (pol.maxAttempts || 0) > 0 && Array.isArray(state.modelGroups)) {
      const allGroup = state.modelGroups.find(g => g.id === 'all-smartest');
      if (allGroup?.providerIds?.length) {
        fallbacks = [...new Set([...fallbacks, ...allGroup.providerIds])].filter(other => other !== id && !catalogId(other));
      }
    }
  }
  const providerIds = [id, ...fallbacks.filter(other => other !== id)].slice(0, 10);
  routeBusy = true;
  renderModelPicker();
  try {
    let queuedNext = false;
    let keptActive = false;
    if (task) {
      const wasActive = ACTIVE.has(task.status);
      const response = await api(`/api/tasks/${encodeURIComponent(scope)}/providers`, {method:'PATCH', body:JSON.stringify({providerIds})});
      if (selectedId === scope && selectedData) { routeDirty = false; renderSelected({...selectedData,task:response.task},true); }
      queuedNext = wasActive && Boolean(response.task?.pendingProviders?.length);
      keptActive = wasActive && !queuedNext;
    } else {
      preferredProvider = id;
      preferredVeniceBackup = catalogId(id) ? {primary:id,id:providerIds[1] || null} : null;
      try {
        localStorage.setItem('g0dc0d3.preferredProvider', id);
        localStorage.setItem('g0dc0d3.veniceBackup', JSON.stringify(preferredVeniceBackup));
      } catch {}
    }
    recentModels = [id,...recentModels.filter(other => other !== id)].slice(0,5);
    try { localStorage.setItem('g0dc0d3.recentModels',JSON.stringify(recentModels)); } catch {}
    renderComposer();
    const pickedLabel = providerById(id)?.label || id;
    if (queuedNext) toast(`Queued ${pickedLabel} for your next message.`);
    else if (keptActive) toast(`Kept ${pickedLabel} for your next message.`);
    if ($('#settings-dialog').open) {
      renderModelSettings();
      const fbCount = Math.max(0, providerIds.length - 1);
      const msg = queuedNext
        ? `Queued ${pickedLabel} for your next message.`
        : fbCount > 0 ? `Selected ${pickedLabel} (+${fbCount} fallback${fbCount === 1 ? '' : 's'}).` : `Selected ${pickedLabel}.`;
      setModelFeedback(msg);
    }
    return true;
  } finally {
    routeBusy = false;
    if ($('#settings-dialog').open) renderModelSettings();
    renderModelPicker();
  }
}

async function choosePickerModel(id) {
  setText('#model-picker-error','');
  try {
    let targetId = id;
    const entry = pickerModels.find(p => p.id === id);
    if (entry?.catalogAdd && entry.model) {
      routeBusy = true;
      setText('#model-picker-note', `Adding ${entry.model}…`);
      renderModelPicker();
      try {
        const result = await api('/api/providers/models', {
          method: 'POST',
          body: JSON.stringify({ provider: entry.catalogProvider || 'openrouter', models: [entry.model] })
        });
        targetId = result.added?.[0] || id;
        if (Array.isArray(result.connectedApiProviders)) state.connectedApiProviders = result.connectedApiProviders;
        await refresh();
        if (entry.catalogProvider === 'openrouter') await loadOpenRouterCatalog();
        else if (Object.hasOwn(directCatalogs, entry.catalogProvider)) await loadDirectProviderCatalog(entry.catalogProvider);
      } finally {
        routeBusy = false;
      }
    }
    if (await selectModel(targetId)) {
      const fromSettings = $('#settings-dialog').open;
      if (!fromSettings) pickerReturnFocus = $('#composer-input');
      $('#model-picker').close();
    }
  } catch (error) { setText('#model-picker-error',error.message); positionModelPicker(); }
}

$('#model-picker-search').addEventListener('input', () => {pickerModels = []; renderModelPicker();});
$('#model-picker').addEventListener('keydown', event => {
  if (!['ArrowDown','ArrowUp','Enter'].includes(event.key) || !event.target.closest('#model-picker-search, #model-picker-results')) return;
  if (event.key === 'Enter') {
    // Buttons handle their own Enter key; the search field selects its active row.
    if (event.target.id !== 'model-picker-search') return;
    event.preventDefault();
    if (pickerModels[pickerIndex]) choosePickerModel(pickerModels[pickerIndex].id);
  } else {
    event.preventDefault();
    highlightPickerModel(pickerIndex + (event.key === 'ArrowDown' ? 1 : -1), true);
    $('#model-picker-search').focus();
  }
});
$('#model-picker-results').addEventListener('click', event => {
  const row = event.target.closest('[data-pick-model]');
  if (row) choosePickerModel(row.dataset.pickModel);
});
$('#model-picker').addEventListener('close', () => {
  $('#composer-model').setAttribute('aria-expanded','false');
  pickerReturnFocus?.focus({preventScroll:true});
});
$('#model-picker').addEventListener('click', event => {
  if (event.target !== event.currentTarget) return;
  const rect = event.currentTarget.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) event.currentTarget.close();
});
$('#model-picker-manage').addEventListener('click', () => {$('#model-picker').close(); openSettings('models');});
$('#settings-pick-model').addEventListener('click', event => openModelPicker(settingsTaskId,event.currentTarget));
window.addEventListener('resize',positionModelPicker);

/* ── Live Sidecar Visualizer Dock (✦ Visualize) ─────────────────────────────── */
window.G0DVisualizer = (function initG0DVisualizer() {
  let isOpen = false;
  let isExpanded = false;
  let activeTaskId = null;
  let mountedTaskId = null;
  let generating = false;
  let genSeq = 0;
  let genAbort = null;
  let lastMountedUrl = '';
  let lastMountedAt = 0;
  let telemetryTimer = null;
  let pollInterval = null;
  let versionNonce = 0;

  const dockEl = () => $('#visualizer-dock');
  const btnEl = () => $('#visualizer-toggle-btn');

  function ensureShell() {
    const dock = dockEl();
    if (!dock || dock.dataset.vizInit) return dock;
    dock.dataset.vizInit = '1';
    dock.innerHTML = `
      <header class="viz-header">
        <div class="viz-title-wrap">
          <span class="viz-sigil" aria-hidden="true">◈</span>
          <div class="viz-title-copy">
            <h2 class="viz-title">LIVE VISUALIZER</h2>
            <p class="viz-subtitle" id="viz-subtitle">Isolated sidecar telemetry dashboard</p>
          </div>
        </div>
        <div class="viz-actions">
          <span class="viz-status-chip" id="viz-status-chip">Ready</span>
          <button type="button" class="button button-secondary viz-regen-btn" id="viz-regen-btn" title="Regenerate bespoke visualizer for the current task">↻ Refresh</button>
          <button type="button" class="icon-button" id="viz-expand-btn" title="Expand or restore visualizer" aria-label="Expand visualizer" aria-pressed="false">⤢</button>
          <button type="button" class="icon-button" id="viz-close-btn" title="Close visualizer" aria-label="Close visualizer">×</button>
        </div>
      </header>
      <div class="viz-stage" id="viz-stage">
        <div class="viz-empty" id="viz-empty">
          <p class="viz-empty-title">Live Agent Visualizer</p>
          <p class="viz-empty-copy">Generates an isolated, live-updating HTML/SVG dashboard tailored to what your agent is doing — without polluting the agent’s context.</p>
          <button type="button" class="button button-primary" id="viz-empty-start">◈ Generate Visualizer</button>
        </div>
        <iframe id="viz-iframe" class="viz-iframe hidden" title="Live agent visualizer" sandbox="allow-scripts" referrerpolicy="no-referrer"></iframe>
      </div>
      <form class="viz-refine-bar" id="viz-refine-form">
        <input type="text" class="input viz-refine-input" id="viz-refine-input" placeholder="Refine visual (e.g. “show dependency graph + pass/fail bars”)" aria-label="Refine live visualizer">
        <button type="submit" class="button button-secondary" id="viz-refine-submit">Refine</button>
      </form>
    `;

    $('#viz-close-btn')?.addEventListener('click', () => close());
    $('#viz-expand-btn')?.addEventListener('click', () => {
      isExpanded = !isExpanded;
      dock.classList.toggle('is-expanded', isExpanded);
      const eb = $('#viz-expand-btn');
      if (eb) {
        eb.setAttribute('aria-pressed', String(isExpanded));
        eb.textContent = isExpanded ? '⤡' : '⤢';
        eb.title = isExpanded ? 'Restore visualizer panel' : 'Expand visualizer';
        eb.setAttribute('aria-label', isExpanded ? 'Restore visualizer panel' : 'Expand visualizer');
      }
    });
    $('#viz-regen-btn')?.addEventListener('click', () => {
      const tid = activeTaskId || selectedId;
      if (tid) generate(tid, '');
    });
    $('#viz-empty-start')?.addEventListener('click', () => {
      const tid = activeTaskId || selectedId;
      if (tid) generate(tid, '');
      else toast('Start or select a task first to visualize it.');
    });
    $('#viz-refine-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = $('#viz-refine-input');
      const instr = input?.value?.trim() || '';
      const tid = activeTaskId || selectedId;
      if (!tid) { toast('Select a task first.'); return; }
      generate(tid, instr, input);
    });
    $('#viz-iframe')?.addEventListener('load', () => {
      pushTelemetryNow();
    });
    return dock;
  }

  function setStatus(label, busy = false, isError = false) {
    const chip = $('#viz-status-chip');
    if (chip) {
      chip.textContent = label;
      chip.classList.toggle('is-busy', busy);
      chip.classList.toggle('is-error', isError);
    }
    const regen = $('#viz-regen-btn');
    if (regen) regen.disabled = busy;
    const refBtn = $('#viz-refine-submit');
    if (refBtn) refBtn.disabled = busy;
    const refInput = $('#viz-refine-input');
    if (refInput) refInput.disabled = busy;
    const emptyBtn = $('#viz-empty-start');
    if (emptyBtn) {
      emptyBtn.disabled = busy;
      emptyBtn.textContent = busy ? 'Forging Visualizer…' : '◈ Generate Visualizer';
    }
  }

  function syncButton() {
    const btn = btnEl();
    if (!btn) return;
    btn.classList.toggle('is-open', isOpen);
    btn.setAttribute('aria-pressed', String(isOpen));
  }

  function resetStage() {
    mountedTaskId = null;
    lastMountedUrl = '';
    lastMountedAt = 0;
    const iframe = $('#viz-iframe');
    if (iframe) {
      iframe.classList.add('hidden');
      iframe.removeAttribute('srcdoc');
      iframe.src = 'about:blank';
    }
    $('#viz-empty')?.classList.remove('hidden');
    const sub = $('#viz-subtitle');
    if (sub) sub.textContent = 'Isolated sidecar telemetry dashboard';
  }

  function mountIframe(taskId, vizUrl = null) {
    const iframe = $('#viz-iframe');
    const empty = $('#viz-empty');
    if (!iframe) return;
    versionNonce += 1;
    const base = vizUrl || `/api/tasks/${encodeURIComponent(taskId)}/visualizer`;
    const sep = base.includes('?') ? '&' : '?';
    mountedTaskId = taskId;
    lastMountedUrl = base;
    lastMountedAt = Date.now();
    iframe.removeAttribute('srcdoc');
    iframe.src = `${base}${sep}v=${versionNonce}`;
    iframe.classList.remove('hidden');
    empty?.classList.add('hidden');
  }

  async function pushTelemetryNow() {
    if (!isOpen || !activeTaskId || mountedTaskId !== activeTaskId) return;
    const tid = activeTaskId;
    const iframe = $('#viz-iframe');
    if (!iframe || iframe.classList.contains('hidden') || !iframe.contentWindow) return;
    try {
      const payload = await api(`/api/tasks/${encodeURIComponent(tid)}/visualizer-telemetry`);
      if (!isOpen || activeTaskId !== tid || mountedTaskId !== tid) return;
      const iframeNow = $('#viz-iframe');
      if (payload && typeof payload === 'object' && iframeNow?.contentWindow) {
        const { visualizerUrl: _omitTokenUrl, ...safePayload } = payload;
        iframeNow.contentWindow.postMessage({ ...safePayload, type: 'g0d:viz' }, '*');
        const sub = $('#viz-subtitle');
        if (sub && payload?.task) {
          const ops = Object.values(payload.toolCounts || {}).reduce((a, b) => a + Number(b || 0), 0);
          sub.textContent = `${payload.task.status || 'active'} · ${ops} ops${payload.metrics ? ' · live metrics' : ''}`;
        }
      }
    } catch {}
  }

  function scheduleTelemetryPush() {
    if (!isOpen || !activeTaskId) return;
    if (telemetryTimer) return;
    telemetryTimer = setTimeout(() => {
      telemetryTimer = null;
      pushTelemetryNow();
    }, 350);
  }

  async function generate(taskId, instruction = '', refineInputEl = null) {
    if (!taskId) return;
    activeTaskId = taskId;
    if (!isOpen) await open(taskId, { autoGenerate: false });
    if (mountedTaskId && mountedTaskId !== taskId) resetStage();
    genAbort?.abort();
    const ac = new AbortController();
    genAbort = ac;
    const seq = ++genSeq;
    generating = true;
    const savedInstr = instruction;
    if (refineInputEl && savedInstr) refineInputEl.value = '';
    setStatus(instruction ? 'Refining…' : 'Forging…', true, false);
    try {
      const res = await api(`/api/tasks/${encodeURIComponent(taskId)}/visualize`, {
        method: 'POST',
        body: JSON.stringify({ instruction }),
        signal: ac.signal,
      });
      if (seq !== genSeq || !isOpen || activeTaskId !== taskId) return;
      mountIframe(taskId, res?.url || null);
      setStatus(res?.generatedBy && res.generatedBy !== 'deterministic_fallback' ? 'Live · AI' : 'Live', false, false);
    } catch (err) {
      if (err?.name === 'AbortError' || seq !== genSeq) return;
      if (refineInputEl && savedInstr && !refineInputEl.value) refineInputEl.value = savedInstr;
      if (isOpen && activeTaskId === taskId) {
        setStatus('Error', false, true);
        toast(err.message || 'Could not generate visualizer.');
      }
    } finally {
      if (seq === genSeq) {
        generating = false;
        if (genAbort === ac) genAbort = null;
        const regen = $('#viz-regen-btn');
        if (regen) regen.disabled = false;
        const refBtn = $('#viz-refine-submit');
        if (refBtn) refBtn.disabled = false;
        const refInput = $('#viz-refine-input');
        if (refInput) refInput.disabled = false;
        const emptyBtn = $('#viz-empty-start');
        if (emptyBtn) { emptyBtn.disabled = false; emptyBtn.textContent = '◈ Generate Visualizer'; }
      }
    }
  }

  async function open(taskId, { autoGenerate = true, instruction = '' } = {}) {
    const tid = taskId || selectedId;
    if (!tid) {
      toast('Start or select a task to visualize what the agent is doing.');
      return;
    }
    ensureShell();
    closeAllRightDocks({ except: 'visualizer' });

    if (mountedTaskId !== tid) {
      genAbort?.abort();
      genAbort = null;
      genSeq += 1;
      generating = false;
      resetStage();
      setStatus('Ready', false, false);
    }

    activeTaskId = tid;
    isOpen = true;
    dockEl()?.classList.remove('hidden');
    document.body.classList.add('visualizer-open');
    syncButton();

    if (pollInterval) clearInterval(pollInterval);
    pollInterval = setInterval(() => {
      if (isOpen && activeTaskId && selectedData?.task?.id === activeTaskId && ACTIVE.has(selectedData.task.status)) {
        pushTelemetryNow();
      }
    }, 3500);

    if (instruction) {
      await generate(tid, instruction);
      return;
    }

    // Check if a visualizer already exists for this task; if so mount via capability-tokenized URL
    try {
      const tel = await api(`/api/tasks/${encodeURIComponent(tid)}/visualizer-telemetry`);
      if (!isOpen || activeTaskId !== tid) return;
      if (tel?.visualizerUrl) {
        mountIframe(tid, tel.visualizerUrl);
        setStatus('Live', false, false);
        return;
      }
    } catch {}

    if (!isOpen || activeTaskId !== tid) return;
    if (autoGenerate) {
      await generate(tid, '');
    } else {
      resetStage();
      setStatus('Ready', false, false);
    }
  }

  function close() {
    genAbort?.abort();
    genAbort = null;
    genSeq += 1;
    generating = false;
    isOpen = false;
    isExpanded = false;
    activeTaskId = null;
    resetStage();
    const dock = dockEl();
    if (dock) {
      dock.classList.add('hidden');
      dock.classList.remove('is-expanded');
    }
    const eb = $('#viz-expand-btn');
    if (eb) {
      eb.setAttribute('aria-pressed', 'false');
      eb.textContent = '⤢';
      eb.title = 'Expand visualizer';
      eb.setAttribute('aria-label', 'Expand visualizer');
    }
    document.body.classList.remove('visualizer-open');
    if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
    if (telemetryTimer) { clearTimeout(telemetryTimer); telemetryTimer = null; }
    syncButton();
  }

  function toggle(taskId) {
    if (isOpen && (!taskId || taskId === activeTaskId)) close();
    else open(taskId || selectedId, { autoGenerate: true });
  }

  function onReadyEvent(taskId, delta) {
    if (isOpen && activeTaskId === taskId && !generating) {
      const nextUrl = delta?.url || `/api/tasks/${encodeURIComponent(taskId)}/visualizer`;
      if (mountedTaskId === taskId && lastMountedUrl === nextUrl && Date.now() - lastMountedAt < 2500) {
        scheduleTelemetryPush();
        return;
      }
      mountIframe(taskId, delta?.url || null);
      setStatus('Live', false, false);
    }
  }

  function onTaskChanged(taskId) {
    if (!isOpen) return;
    if (!taskId) { close(); return; }
    if (taskId !== activeTaskId) {
      open(taskId, { autoGenerate: false });
    }
  }

  $('#visualizer-toggle-btn')?.addEventListener('click', () => toggle(selectedId));
  document.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-open-visualizer]');
    if (!trigger) return;
    event.preventDefault();
    open(selectedId, { autoGenerate: true });
  });
  window.addEventListener('pagehide', close);

  return { open, close, toggle, generate, scheduleTelemetryPush, onReadyEvent, onTaskChanged, isOpen: () => isOpen };
})();
