import { spawn } from 'node:child_process';
import dns from 'node:dns/promises';
import { promises as fs, constants as fsConstants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { DEFAULT_PRIVACY_SETTINGS, checkTargetScope } from './privacy.mjs';
import { isPrivateIp } from './web-fetch.mjs';

const fault = (code, message) => Object.assign(new Error(message), { code });

const CHROMIUM_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Arc.app/Contents/MacOS/Arc',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
  '/usr/local/bin/chromium',
];

const IDLE_TTL_MS = 10 * 60 * 1000;
const MAX_CONSOLE_LOG = 40;
const MAX_EVAL_CHARS = 16000;
const FRAME_EMIT_INTERVAL_MS = 95;

export const DEFAULT_BROWSER_SETTINGS = Object.freeze({
  visibleWindow: false,
  liveMirror: true,
  autoOpenMirror: true,
});

export function normalizeBrowserSettings(input = {}, current = DEFAULT_BROWSER_SETTINGS) {
  const base = { ...DEFAULT_BROWSER_SETTINGS, ...(current && typeof current === 'object' ? current : {}) };
  if (!input || typeof input !== 'object' || Array.isArray(input)) return base;
  return {
    visibleWindow: typeof input.visibleWindow === 'boolean' ? input.visibleWindow : Boolean(base.visibleWindow),
    liveMirror: typeof input.liveMirror === 'boolean' ? input.liveMirror : base.liveMirror !== false,
    autoOpenMirror: typeof input.autoOpenMirror === 'boolean' ? input.autoOpenMirror : base.autoOpenMirror !== false,
  };
}

export function buildChromiumLaunchArgs({
  headless = true,
  viewport = { width: 1280, height: 800 },
  profileDir,
  platform = process.platform,
} = {}) {
  const w = Math.max(320, Math.min(2560, Number(viewport?.width) || 1280));
  const h = Math.max(240, Math.min(2000, Number(viewport?.height) || 800));
  return [
    ...(headless ? ['--headless=new', '--mute-audio', '--hide-scrollbars'] : ['--window-position=80,60']),
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-sync',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-breakpad',
    '--disable-crash-reporter',
    '--disable-domain-reliability',
    '--metrics-recording-only',
    ...(platform === 'linux' && headless ? ['--disable-gpu', '--disable-dev-shm-usage'] : []),
    `--window-size=${w},${h}`,
    '--remote-debugging-port=0',
    '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${profileDir}`,
    'about:blank',
  ];
}

export async function findChromiumBinary(envPath = process.env.G0D_BROWSER_PATH) {
  const list = envPath ? [envPath, ...CHROMIUM_CANDIDATES] : CHROMIUM_CANDIDATES;
  for (const candidate of list) {
    if (!candidate) continue;
    try {
      await fs.access(candidate, fsConstants.X_OK);
      return candidate;
    } catch {}
  }
  return null;
}

function decodeBrowserMappedIpv4(h) {
  const dotted = /^(?:::ffff:|::)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(h);
  if (dotted && net.isIPv4(dotted[1])) return dotted[1];
  const hex = /^(?:::ffff:|::|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(h);
  if (hex) {
    const hi = parseInt(hex[1], 16), lo = parseInt(hex[2], 16);
    return `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`;
  }
  return null;
}

function isLoopbackHost(host) {
  const h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '');
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h.endsWith('.localhost');
}

function isBlockedPrivateHost(host) {
  const h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '');
  if (!h) return true;
  if (isLoopbackHost(h)) return false; // Explicitly allow local dev servers in contained browser
  if (h === '0.0.0.0' || h === '::' || h === 'metadata.google.internal' || h.endsWith('.internal') || h.endsWith('.local')) return true;
  if (net.isIP(h) !== 0) return isPrivateIp(h);
  const mappedV4 = decodeBrowserMappedIpv4(h);
  if (mappedV4) return isPrivateIp(mappedV4);
  return false;
}

export function assertBrowserUrlAllowed(rawUrl, { privacy = DEFAULT_PRIVACY_SETTINGS, onOutbound } = {}) {
  let parsed;
  try { parsed = new URL(String(rawUrl || '').trim()); }
  catch { throw fault('BROWSER_URL_DENIED', 'Provide a valid http:// or https:// URL.'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw fault('BROWSER_URL_DENIED', `Unsupported URL scheme "${parsed.protocol}". Only http:// and https:// are permitted in the contained browser.`);
  }
  const host = parsed.hostname.toLowerCase();
  if (isBlockedPrivateHost(host)) {
    throw fault('SSRF_BLOCKED', `Blocked private network or cloud metadata host "${host}" in contained browser.`);
  }
  const scopeCheck = checkTargetScope(parsed.href, privacy);
  if (!scopeCheck.allowed) {
    onOutbound?.({
      providerId: 'browser',
      host,
      protocol: parsed.protocol.replace(':', ''),
      zdrClass: 'browser-env',
      zdrFlags: ['ephemeral-profile', 'scope-guard'],
      secretsRedacted: 0,
      blocked: true,
      reason: scopeCheck.message,
    });
    throw fault(scopeCheck.code, scopeCheck.message);
  }
  const local = isLoopbackHost(host);
  if (!local && privacy?.localOnly) {
    onOutbound?.({
      providerId: 'browser',
      host,
      protocol: parsed.protocol.replace(':', ''),
      zdrClass: 'browser-env',
      zdrFlags: ['ephemeral-profile'],
      secretsRedacted: 0,
      blocked: true,
      reason: 'Blocked by Local-Only privacy mode (localhost dev servers remain allowed).',
    });
    throw fault('PRIVACY_LOCAL_ONLY', `Local-Only mode blocks external browser navigation to "${host}". Localhost dev servers remain allowed.`);
  }
  if (!local) {
    onOutbound?.({
      providerId: 'browser',
      host,
      protocol: parsed.protocol.replace(':', ''),
      zdrClass: 'browser-env',
      zdrFlags: ['ephemeral-profile'],
      secretsRedacted: 0,
      blocked: false,
    });
  }
  return parsed.toString();
}

export async function assertBrowserUrlDnsAllowed(rawUrl, outboundOpts = {}) {
  const safeUrl = assertBrowserUrlAllowed(rawUrl, outboundOpts);
  const host = new URL(safeUrl).hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (isLoopbackHost(host) || net.isIP(host) !== 0) return safeUrl;
  let records = [];
  try {
    records = await dns.lookup(host, { all: true });
  } catch {
    return safeUrl; // Let Chromium report NXDOMAIN/offline failures natively
  }
  for (const rec of records) {
    if (rec?.address && (isBlockedPrivateHost(rec.address) || isLoopbackHost(rec.address))) {
      throw fault('SSRF_BLOCKED', `Blocked DNS resolution of "${host}" to private/loopback address in contained browser.`);
    }
  }
  return safeUrl;
}

const KEY_MAP = {
  Enter: { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' },
  Tab: { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 },
  Escape: { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 },
  Backspace: { key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 },
  Delete: { key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 },
  Space: { key: ' ', code: 'Space', windowsVirtualKeyCode: 32, text: ' ' },
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38 },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 },
  Home: { key: 'Home', code: 'Home', windowsVirtualKeyCode: 36 },
  End: { key: 'End', code: 'End', windowsVirtualKeyCode: 35 },
  PageUp: { key: 'PageUp', code: 'PageUp', windowsVirtualKeyCode: 33 },
  PageDown: { key: 'PageDown', code: 'PageDown', windowsVirtualKeyCode: 34 },
};

function parseKeySpec(rawKey) {
  const parts = String(rawKey || '').split('+').map(s => s.trim()).filter(Boolean);
  let modifiers = 0;
  let main = parts.pop() || '';
  for (const mod of parts) {
    const m = mod.toLowerCase();
    if (m === 'alt' || m === 'option') modifiers |= 1;
    else if (m === 'control' || m === 'ctrl') modifiers |= 2;
    else if (m === 'meta' || m === 'cmd' || m === 'command') modifiers |= 4;
    else if (m === 'shift') modifiers |= 8;
  }
  const base = KEY_MAP[main] || {
    key: main,
    ...(main.length === 1 ? { text: modifiers ? undefined : main, windowsVirtualKeyCode: main.toUpperCase().charCodeAt(0) } : {}),
  };
  return { ...base, ...(modifiers ? { modifiers } : {}) };
}

const DEEP_QUERY_HELPERS = `
  function collectRoots(root, out) {
    out.push(root);
    const all = root.querySelectorAll ? root.querySelectorAll('*') : [];
    for (const n of all) {
      if (n.shadowRoot) collectRoots(n.shadowRoot, out);
    }
    return out;
  }
  function queryAllDeep(selector, root = document) {
    const roots = collectRoots(root, []);
    const seen = new Set();
    const hits = [];
    for (const r of roots) {
      let list = [];
      try { list = r.querySelectorAll(selector); } catch {}
      for (const el of list) {
        if (!seen.has(el)) { seen.add(el); hits.push(el); }
      }
    }
    return hits;
  }
  function queryOneDeep(selector, root = document) {
    const roots = collectRoots(root, []);
    for (const r of roots) {
      try {
        const hit = r.querySelector(selector);
        if (hit) return hit;
      } catch {}
    }
    return null;
  }
  function deepActiveElement() {
    let active = document.activeElement;
    while (active && active.shadowRoot && active.shadowRoot.activeElement) {
      active = active.shadowRoot.activeElement;
    }
    return active;
  }
`;

const SNAPSHOT_SCRIPT = `(maxChars => {
  ${DEEP_QUERY_HELPERS}
  for (const el of queryAllDeep('[data-g0d-ref]')) el.removeAttribute('data-g0d-ref');
  const sel = 'a[href], button, input, textarea, select, canvas, [role="button"], [role="link"], [role="textbox"], [role="checkbox"], [role="radio"], [role="tab"], [role="combobox"], [role="menuitem"], [contenteditable="true"], summary, [onclick]';
  const nodes = queryAllDeep(sel);
  const vh = window.innerHeight || 800;
  const vw = window.innerWidth || 1280;
  const activeModal = queryOneDeep('dialog[open], [role="dialog"]:not([hidden]), [aria-modal="true"]:not([hidden])');
  const candidates = [];
  for (const el of nodes) {
    const style = window.getComputedStyle(el);
    if (!style || style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const inModal = activeModal ? (activeModal.contains(el) || (el.getRootNode?.()?.host && activeModal.contains(el.getRootNode().host))) : false;
    const inViewport = r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw;
    const priority = inModal ? 0 : inViewport ? 1 : 2;
    candidates.push({ el, r, priority });
  }
  candidates.sort((a, b) => a.priority - b.priority);
  const elements = [];
  let idx = 0;
  for (const { el, r } of candidates) {
    if (elements.length >= 80) break;
    const ref = 'e' + (++idx);
    el.setAttribute('data-g0d-ref', ref);
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute('role') || (tag === 'a' ? 'link' : tag === 'button' ? 'button' : tag);
    const rawText = (el.innerText || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('title') || el.value || (tag === 'canvas' ? 'canvas ' + Math.round(r.width) + 'x' + Math.round(r.height) : '')).replace(/\\s+/g, ' ').trim();
    const isCheck = tag === 'input' && (el.type === 'checkbox' || el.type === 'radio');
    const stateFlags = [];
    if (el.getAttribute('aria-expanded') === 'true') stateFlags.push('expanded');
    if (el.getAttribute('aria-selected') === 'true') stateFlags.push('selected');
    if (el.getAttribute('aria-checked') === 'true') stateFlags.push('checked');
    if (el.getAttribute('aria-invalid') === 'true') stateFlags.push('invalid');
    const selectOpts = tag === 'select'
      ? [...el.options].slice(0, 12).map(o => (o.textContent || o.value || '').trim().slice(0, 60)).filter(Boolean)
      : null;
    const entry = {
      ref,
      tag,
      role,
      text: rawText.slice(0, 120),
      ...(el.type ? { type: String(el.type).slice(0, 32) } : {}),
      ...(el.name ? { name: String(el.name).slice(0, 64) } : {}),
      ...(isCheck ? { value: el.checked ? 'checked' : 'unchecked' } : (tag === 'input' || tag === 'textarea' || tag === 'select' ? { value: String(el.value || '').slice(0, 120) } : {})),
      ...(tag === 'a' && el.href ? { href: String(el.href).slice(0, 240) } : {}),
      ...(el.disabled ? { disabled: true } : {}),
      ...(stateFlags.length ? { state: stateFlags.join(',') } : {}),
      ...(selectOpts?.length ? { options: selectOpts } : {}),
      rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
    };
    elements.push(entry);
  }
  function collectDeepText(root) {
    let out = '';
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (node.nodeType === 1) {
        const tag = node.tagName;
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') continue;
        if (node.shadowRoot) out += ' ' + collectDeepText(node.shadowRoot);
      } else if (node.nodeType === 3) {
        const p = node.parentElement;
        if (!p || p.tagName === 'SCRIPT' || p.tagName === 'STYLE' || p.tagName === 'NOSCRIPT') continue;
        const st = window.getComputedStyle(p);
        if (st && (st.display === 'none' || st.visibility === 'hidden')) continue;
        const t = node.nodeValue.trim();
        if (t) out += (out ? ' ' : '') + t;
      }
    }
    return out;
  }
  let bodyText = (document.body?.innerText || document.documentElement?.textContent || '').replace(/[ \\t]+/g, ' ').replace(/\\n{3,}/g, '\\n\\n').trim();
  const shadowHosts = queryAllDeep('*').filter(el => el.shadowRoot);
  if (shadowHosts.length) {
    const shadowText = shadowHosts.map(h => collectDeepText(h.shadowRoot)).filter(Boolean).join('\\n').replace(/[ \\t]+/g, ' ').trim();
    if (shadowText) bodyText = bodyText ? bodyText + '\\n' + shadowText : shadowText;
  }
  const truncated = bodyText.length > maxChars;
  const maxY = Math.max(0, Math.round((document.documentElement?.scrollHeight || document.body?.scrollHeight || vh) - vh));
  return {
    url: location.href,
    title: document.title || '',
    viewport: { width: vw, height: vh },
    scroll: { x: Math.max(0, Math.round(window.scrollX || 0)), y: Math.max(0, Math.round(window.scrollY || 0)), maxY },
    text: truncated ? bodyText.slice(0, maxChars) + '\\n[…truncated…]' : bodyText,
    truncated,
    elements,
  };
})`;

const CONTAINMENT_INIT_SCRIPT = `(() => {
  // Keep target="_blank" links and window.open() inside the same contained tab so the agent never loses focus.
  const origOpen = window.open;
  window.open = function(url) {
    if (typeof url === 'string' && /^https?:|^\\//i.test(url.trim())) {
      try { location.assign(url); return window; } catch {}
    }
    return null;
  };
  document.addEventListener('click', ev => {
    const a = ev.target && ev.target.closest ? ev.target.closest('a[target="_blank"][href]') : null;
    if (a) a.removeAttribute('target');
  }, true);
})();`;

class CdpSession {
  constructor({ taskId, binaryPath, viewport = { width: 1280, height: 800 }, headless = true, profileDir = null, onEvent = null, onUnexpectedExit = null }) {
    this.taskId = taskId;
    this.binaryPath = binaryPath;
    this.viewport = viewport;
    this.headless = headless !== false;
    this.proc = null;
    this.profileDir = profileDir || null;
    this.onEvent = typeof onEvent === 'function' ? onEvent : null;
    this.onUnexpectedExit = typeof onUnexpectedExit === 'function' ? onUnexpectedExit : null;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
    this.consoleLogs = [];
    this.latestScreenshot = null; // Buffer (PNG)
    this.screenshotSeq = 0;
    this.latestFrame = null; // { buffer: Buffer, mime: string, seq: number, width: number, height: number, time: number }
    this.frameSeq = 0;
    this.lastFrameEmitAt = 0;
    this.screencastActive = false;
    this.screencastDesired = false;
    this.lastAction = null;
    this.lastUrl = 'about:blank';
    this.lastTitle = '';
    this.lastUsedAt = Date.now();
    this.disconnected = false;
    this.closed = false;
    this.cleanupPromise = null;
    this.activeOutboundOpts = {};
    this.lastBlockedNavError = null;
    this.mainFrameId = null;
    this.topLevelIsLoopback = false;
    this.explicitLoopbackNavPending = false;
  }

  touch() { this.lastUsedAt = Date.now(); }

  _emit(evt) {
    if (!this.onEvent) return;
    try { this.onEvent({ taskId: this.taskId, headless: this.headless, viewport: this.viewport, ...evt }); } catch {}
  }

  async start() {
    if (this.closed) throw fault('BROWSER_CLOSED', 'Contained browser session closed.');
    if (!this.profileDir) {
      this.profileDir = await fs.mkdtemp(path.join(os.tmpdir(), `g0dc0d3-browser-${this.taskId.slice(0, 8)}-`));
    }
    if (this.closed) {
      const dir = this.profileDir;
      this.profileDir = null;
      if (dir) await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
      throw fault('BROWSER_CLOSED', 'Contained browser session closed.');
    }
    const args = buildChromiumLaunchArgs({
      headless: this.headless,
      viewport: this.viewport,
      profileDir: this.profileDir,
    });
    this.proc = spawn(this.binaryPath, args, { stdio: ['ignore', 'ignore', 'pipe'], detached: process.platform !== 'win32' });
    if (this.closed) {
      await this.close().catch(() => {});
      throw fault('BROWSER_CLOSED', 'Contained browser session closed.');
    }
    let stderrBuf = '';
    const debugPort = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(fault('BROWSER_LAUNCH_TIMEOUT', 'Contained browser did not open its DevTools port within 25s.')), 25000);
      const onData = chunk => {
        stderrBuf += chunk.toString('utf8');
        const m = /DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//.exec(stderrBuf);
        if (m) {
          clearTimeout(timer);
          this.proc.stderr.off('data', onData);
          this.proc.stderr.resume();
          resolve(Number(m[1]));
        }
      };
      this.proc.stderr.on('data', onData);
      this.proc.once('error', err => { clearTimeout(timer); reject(fault('BROWSER_LAUNCH_FAILED', err.message)); });
      this.proc.once('exit', code => {
        clearTimeout(timer);
        reject(fault('BROWSER_LAUNCH_FAILED', `Contained browser exited early (code ${code}). ${stderrBuf.slice(-300)}`));
      });
    });

    // Discover page target WebSocket on loopback DevTools server
    const targetsRes = await fetch(`http://127.0.0.1:${debugPort}/json/list`, { signal: AbortSignal.timeout(5000) });
    if (!targetsRes.ok) throw fault('BROWSER_LAUNCH_FAILED', `DevTools target list returned HTTP ${targetsRes.status}.`);
    const targets = await targetsRes.json();
    const pageTarget = targets.find(t => t.type === 'page' && t.webSocketDebuggerUrl) || targets.find(t => t.webSocketDebuggerUrl);
    if (!pageTarget?.webSocketDebuggerUrl) throw fault('BROWSER_LAUNCH_FAILED', 'No debuggable browser page target found.');

    await new Promise((resolve, reject) => {
      const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
      this.ws = ws;
      const timer = setTimeout(() => reject(fault('BROWSER_CONNECT_TIMEOUT', 'Timed out connecting to contained browser WebSocket.')), 5000);
      ws.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      ws.addEventListener('error', () => { clearTimeout(timer); reject(fault('BROWSER_CONNECT_FAILED', 'Failed to connect to contained browser WebSocket.')); }, { once: true });
      ws.addEventListener('message', ev => this._onMessage(String(ev.data || '')));
      ws.addEventListener('close', () => {
        this.disconnected = true;
        for (const [, entry] of this.pending) {
          clearTimeout(entry.timer);
          entry.reject(fault('BROWSER_CLOSED', 'Contained browser session closed.'));
        }
        this.pending.clear();
        if (!this.closed && this.onUnexpectedExit) this.onUnexpectedExit(this);
      });
    });
    this.proc.once('exit', () => {
      this.disconnected = true;
      if (!this.closed && this.onUnexpectedExit) this.onUnexpectedExit(this);
    });

    await this.send('Page.enable');
    const frameTree = await this.send('Page.getFrameTree').catch(() => null);
    this.mainFrameId = frameTree?.frameTree?.frame?.id || null;
    await this.send('Runtime.enable');
    await this.send('Network.enable').catch(() => {});
    await this.send('Log.enable').catch(() => {});
    await this.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] }).catch(() => {});
    await this.send('Page.addScriptToEvaluateOnNewDocument', { source: CONTAINMENT_INIT_SCRIPT }).catch(() => {});
    if (this.headless) {
      await this.send('Emulation.setDeviceMetricsOverride', {
        width: this.viewport.width,
        height: this.viewport.height,
        deviceScaleFactor: 1,
        mobile: false,
      });
    }
  }

  async startScreencast({ quality = 68, maxWidth = 1280, maxHeight = 820, everyNthFrame = 1 } = {}) {
    if (this.closed || this.disconnected) return false;
    this.screencastDesired = true;
    if (this.screencastActive) return true;
    try {
      await this.send('Page.startScreencast', {
        format: 'jpeg',
        quality: Math.max(30, Math.min(92, Number(quality) || 68)),
        maxWidth: Math.max(320, Math.min(1600, Number(maxWidth) || 1280)),
        maxHeight: Math.max(240, Math.min(1200, Number(maxHeight) || 820)),
        everyNthFrame: Math.max(1, Math.min(4, Number(everyNthFrame) || 1)),
      }, 5000);
      if (!this.screencastDesired || this.closed || this.disconnected) {
        this.screencastActive = false;
        if (!this.closed && !this.disconnected) {
          await this.send('Page.stopScreencast', {}, 3000).catch(() => {});
        }
        return false;
      }
      this.screencastActive = true;
      this._emit({ type: 'browser.status', active: true, screencastActive: true, url: this.lastUrl, title: this.lastTitle });
    } catch {
      this.screencastActive = false;
    }
    return this.screencastActive;
  }

  async stopScreencast() {
    this.screencastDesired = false;
    const wasActive = this.screencastActive;
    this.screencastActive = false;
    if (wasActive && !this.closed && !this.disconnected) {
      await this.send('Page.stopScreencast', {}, 3000).catch(() => {});
    }
  }

  _onMessage(raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.id && this.pending.has(msg.id)) {
      const entry = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      clearTimeout(entry.timer);
      if (msg.error) entry.reject(fault('BROWSER_CDP_ERROR', msg.error.message || 'CDP command failed.'));
      else entry.resolve(msg.result || {});
      return;
    }
    if (msg.method === 'Runtime.consoleAPICalled') {
      const type = msg.params?.type || 'log';
      if (type === 'error' || type === 'warning') {
        const text = (msg.params?.args || []).map(a => a.value ?? a.description ?? a.type ?? '').join(' ').slice(0, 400);
        this._pushConsole(type === 'warning' ? 'warn' : 'error', text);
      }
    } else if (msg.method === 'Runtime.exceptionThrown') {
      const details = msg.params?.exceptionDetails;
      const text = details?.exception?.description || details?.text || 'Uncaught exception';
      this._pushConsole('error', String(text).slice(0, 400));
    } else if (msg.method === 'Page.javascriptDialogOpening') {
      const dlgType = msg.params?.type || 'alert';
      const dlgMsg = String(msg.params?.message || '').slice(0, 300);
      this._pushConsole('warn', `Auto-accepted JS ${dlgType}: ${dlgMsg}`);
      this.send('Page.handleJavaScriptDialog', {
        accept: true,
        ...(dlgType === 'prompt' ? { promptText: String(msg.params?.defaultPrompt || '') } : {}),
      }, 3000).catch(() => {});
    } else if (msg.method === 'Fetch.requestPaused') {
      void this._handleFetchPaused(msg.params);
    } else if (msg.method === 'Network.responseReceived') {
      const resp = msg.params?.response;
      const status = Number(resp?.status || 0);
      if (status >= 400) {
        const reqUrl = String(resp?.url || '').slice(0, 200);
        const statusText = String(resp?.statusText || '').trim();
        this._pushConsole('network', `HTTP ${status}${statusText ? ` ${statusText}` : ''} ${reqUrl}`.slice(0, 400));
      }
    } else if (msg.method === 'Network.loadingFailed') {
      const errText = String(msg.params?.errorText || '').trim();
      if (errText && !/ERR_BLOCKED_BY_CLIENT|ERR_ABORTED/i.test(errText)) {
        const resType = String(msg.params?.type || 'resource');
        this._pushConsole('network', `Failed ${resType} load: ${errText}`.slice(0, 400));
      }
    } else if (msg.method === 'Page.frameNavigated') {
      const f = msg.params?.frame;
      if (f && (!f.parentId || f.id === this.mainFrameId) && typeof f.url === 'string' && f.url) {
        this.lastUrl = f.url;
        this._emit({ type: 'browser.status', active: true, screencastActive: this.screencastActive, url: this.lastUrl, title: this.lastTitle });
      }
    } else if (msg.method === 'Page.screencastFrame') {
      const p = msg.params || {};
      if (p.sessionId !== undefined) {
        this.send('Page.screencastFrameAck', { sessionId: p.sessionId }, 3000).catch(() => {});
      }
      if (typeof p.data === 'string' && p.data.length) {
        const buf = Buffer.from(p.data, 'base64');
        const seq = ++this.frameSeq;
        const meta = p.metadata || {};
        this.latestFrame = {
          buffer: buf,
          mime: 'image/jpeg',
          seq,
          width: Number(meta.deviceWidth) || this.viewport.width,
          height: Number(meta.deviceHeight) || this.viewport.height,
          time: Date.now(),
        };
        const now = Date.now();
        if (now - this.lastFrameEmitAt >= FRAME_EMIT_INTERVAL_MS) {
          this.lastFrameEmitAt = now;
          this._emit({
            type: 'browser.frame',
            seq,
            url: this.lastUrl,
            title: this.lastTitle,
            frameUrl: `/api/tasks/${encodeURIComponent(this.taskId)}/browser/frame?v=${seq}`,
          });
        }
      }
    } else if (msg.method === 'Log.entryAdded') {
      const e = msg.params?.entry;
      if (e && (e.level === 'error' || e.level === 'warning')) {
        this._pushConsole(e.level === 'warning' ? 'warn' : 'error', String(e.text || '').slice(0, 400));
      }
    }
  }

  async _handleFetchPaused(params) {
    const requestId = params?.requestId;
    if (!requestId) return;
    const reqUrl = String(params?.request?.url || '');
    const isMainFrameDoc = params?.resourceType === 'Document' && (!this.mainFrameId || params?.frameId === this.mainFrameId);
    let allowed = true;
    let blockedErr = null;
    if (/^https?:/i.test(reqUrl)) {
      try {
        await assertBrowserUrlDnsAllowed(reqUrl, this.activeOutboundOpts);
        const reqIsLoopback = isLoopbackHost(new URL(reqUrl).hostname);
        if (reqIsLoopback) {
          if (isMainFrameDoc) {
            const allowLoopbackNav = this.explicitLoopbackNavPending || this.topLevelIsLoopback;
            if (!allowLoopbackNav) {
              allowed = false;
              blockedErr = fault('SSRF_BLOCKED', 'Blocked redirect or cross-origin navigation from external page to loopback host.');
            } else {
              this.topLevelIsLoopback = true;
            }
            this.explicitLoopbackNavPending = false;
          } else if (!this.topLevelIsLoopback) {
            allowed = false;
            blockedErr = fault('SSRF_BLOCKED', 'Blocked cross-origin subframe or resource request from external page to loopback host.');
          }
        } else if (isMainFrameDoc) {
          // Immediately clear loopback trust before loading any external document (closes loopback->external redirect TOCTOU).
          this.topLevelIsLoopback = false;
          this.explicitLoopbackNavPending = false;
        }
      } catch (err) {
        allowed = false;
        blockedErr = err;
        if (isMainFrameDoc) this.explicitLoopbackNavPending = false;
      }
    } else if (/^(?:about:|blob:|data:)/i.test(reqUrl)) {
      if (isMainFrameDoc && /^about:/i.test(reqUrl)) {
        this.topLevelIsLoopback = false;
        this.explicitLoopbackNavPending = false;
      }
    } else {
      allowed = false;
      blockedErr = fault('BROWSER_URL_DENIED', `Blocked restricted browser URL scheme: ${reqUrl.slice(0, 120)}`);
    }
    if (allowed) {
      this.send('Fetch.continueRequest', { requestId }, 3000).catch(() => {});
    } else {
      if (isMainFrameDoc) this.lastBlockedNavError = blockedErr;
      this._pushConsole('warn', `Blocked browser request to restricted URL: ${reqUrl.slice(0, 180)}`);
      this.send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }, 3000).catch(() => {});
    }
  }

  _pushConsole(level, message) {
    if (!message) return;
    this.consoleLogs.push({ level, message, time: new Date().toISOString() });
    if (this.consoleLogs.length > MAX_CONSOLE_LOG) this.consoleLogs.shift();
  }

  send(method, params = {}, timeoutMs = 15000) {
    if (this.closed || this.disconnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(fault('BROWSER_CLOSED', 'Contained browser session is closed.'));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(fault('BROWSER_TIMEOUT', `Browser command ${method} timed out after ${timeoutMs}ms.`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async wait(ms) {
    const clamped = Math.max(0, Math.min(8000, Number(ms) || 0));
    if (clamped > 0) await new Promise(r => setTimeout(r, clamped));
  }

  async waitForLoad(timeoutMs = 15000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const r = await this.send('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true }, 3000);
        if (r?.result?.value === 'complete' || r?.result?.value === 'interactive') return;
      } catch {}
      await this.wait(100);
    }
  }

  async captureScreenshot({ fullPage = false } = {}) {
    const res = await this.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      ...(fullPage ? { captureBeyondViewport: true } : {}),
    }, 15000);
    const buf = Buffer.from(res.data || '', 'base64');
    this.latestScreenshot = buf;
    this.screenshotSeq += 1;
    const fSeq = ++this.frameSeq;
    this.latestFrame = {
      buffer: buf,
      mime: 'image/png',
      seq: fSeq,
      width: this.viewport.width,
      height: this.viewport.height,
      time: Date.now(),
    };
    this._emit({
      type: 'browser.frame',
      seq: fSeq,
      url: this.lastUrl,
      title: this.lastTitle,
      frameUrl: `/api/tasks/${encodeURIComponent(this.taskId)}/browser/frame?v=${fSeq}`,
    });
    return {
      bytes: buf.length,
      seq: this.screenshotSeq,
      screenshotUrl: `/api/tasks/${encodeURIComponent(this.taskId)}/browser/screenshot?v=${this.screenshotSeq}`,
    };
  }

  async snapshot({ maxChars = 8000 } = {}) {
    const limit = Math.max(500, Math.min(24000, Number(maxChars) || 8000));
    let evaluated;
    try {
      evaluated = await this.send('Runtime.evaluate', {
        expression: `(${SNAPSHOT_SCRIPT})(${limit})`,
        returnByValue: true,
      }, 10000);
    } catch (err) {
      if (!/context|destroyed|navigat/i.test(String(err?.message || ''))) throw err;
      await this.waitForLoad(6000);
      await this.wait(250);
      evaluated = await this.send('Runtime.evaluate', {
        expression: `(${SNAPSHOT_SCRIPT})(${limit})`,
        returnByValue: true,
      }, 10000);
    }
    const val = evaluated?.result?.value || { url: this.lastUrl, title: this.lastTitle, viewport: this.viewport, text: '', truncated: false, elements: [] };
    this.lastUrl = val.url || this.lastUrl;
    this.lastTitle = val.title || this.lastTitle;
    return {
      ...val,
      consoleErrors: this.consoleLogs.slice(-15),
    };
  }

  async resolveTargetPoint({ ref, selector, x, y, focus = false }) {
    if (Number.isFinite(x) && Number.isFinite(y)) return { x: Number(x), y: Number(y) };
    const css = ref ? `[data-g0d-ref="${String(ref).replace(/"/g, '')}"]` : selector;
    if (!css) throw fault('BROWSER_TARGET_REQUIRED', 'Provide ref (e.g. "e3"), selector, or x/y coordinates.');
    const expr = `(() => {
      ${DEEP_QUERY_HELPERS}
      const el = queryOneDeep(${JSON.stringify(css)});
      if (!el) return null;
      if (el.disabled) return { disabled: true };
      el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
      if (${Boolean(focus)} && typeof el.focus === 'function') { try { el.focus(); } catch {} }
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, tag: el.tagName.toLowerCase() };
    })()`;
    const res = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true }, 5000);
    const pt = res?.result?.value;
    if (pt?.disabled) throw fault('BROWSER_ELEMENT_DISABLED', `Element is disabled: ${ref || selector}`);
    if (!pt || pt.w < 1 || pt.h < 1) throw fault('BROWSER_ELEMENT_NOT_FOUND', `Element not found or not visible: ${ref || selector}`);
    return pt;
  }

  async open({ url, viewport, waitMs = 350 }, outboundOpts) {
    this.touch();
    const safeUrl = await assertBrowserUrlDnsAllowed(url, outboundOpts);
    if (viewport && Number.isInteger(viewport.width) && Number.isInteger(viewport.height)) {
      this.viewport = {
        width: Math.max(320, Math.min(2560, viewport.width)),
        height: Math.max(320, Math.min(2000, viewport.height)),
      };
      if (this.headless) {
        await this.send('Emulation.setDeviceMetricsOverride', {
          width: this.viewport.width,
          height: this.viewport.height,
          deviceScaleFactor: 1,
          mobile: false,
        });
      }
    }
    this.activeOutboundOpts = outboundOpts || {};
    this.lastAction = { action: 'navigate', label: safeUrl, x: null, y: null, url: safeUrl, time: Date.now() };
    this._emit({ type: 'browser.activity', active: true, ...this.lastAction });
    this.lastBlockedNavError = null;
    const targetIsLoopback = isLoopbackHost(new URL(safeUrl).hostname);
    this.explicitLoopbackNavPending = targetIsLoopback;
    this.topLevelIsLoopback = targetIsLoopback;
    this.consoleLogs.length = 0;
    const nav = await this.send('Page.navigate', { url: safeUrl }, 20000);
    if (this.lastBlockedNavError) {
      const blocked = this.lastBlockedNavError;
      this.lastBlockedNavError = null;
      this.topLevelIsLoopback = false;
      this.explicitLoopbackNavPending = false;
      throw blocked;
    }
    if (nav?.errorText) {
      this.explicitLoopbackNavPending = false;
      throw fault('BROWSER_NAV_FAILED', `Navigation failed: ${nav.errorText}`);
    }
    await this.waitForLoad(15000);
    await this.wait(waitMs);
    if (this.lastBlockedNavError) {
      const blocked = this.lastBlockedNavError;
      this.lastBlockedNavError = null;
      this.topLevelIsLoopback = false;
      this.explicitLoopbackNavPending = false;
      throw blocked;
    }
    const snap = await this.snapshot();
    // Guard against HTTP 302 redirects landing on private LAN, cloud metadata, or external origins in Local-Only mode.
    if (snap.url && snap.url !== 'about:blank') {
      try {
        await assertBrowserUrlDnsAllowed(snap.url, outboundOpts);
        this.topLevelIsLoopback = isLoopbackHost(new URL(snap.url).hostname);
      } catch (err) {
        this.topLevelIsLoopback = false;
        this.explicitLoopbackNavPending = false;
        await this.send('Page.navigate', { url: 'about:blank' }, 5000).catch(() => {});
        throw err;
      }
    } else {
      this.topLevelIsLoopback = false;
      this.explicitLoopbackNavPending = false;
    }
    const shot = await this.captureScreenshot();
    this.lastAction = { action: 'navigate', label: snap.title || snap.url, x: null, y: null, url: snap.url, title: snap.title, time: Date.now() };
    this._emit({ type: 'browser.activity', active: true, ...this.lastAction });
    return { ok: true, ...snap, screenshotUrl: shot.screenshotUrl, screenshotBytes: shot.bytes };
  }

  async act(args, outboundOpts) {
    this.touch();
    this.activeOutboundOpts = outboundOpts || {};
    const action = String(args.action || '').toLowerCase();
    let actPt = null;
    let actLabel = args.ref || args.selector || args.key || (typeof args.text === 'string' ? args.text.slice(0, 40) : '') || action;
    if (action === 'back') {
      await this.send('Runtime.evaluate', { expression: 'history.back()' });
      await this.waitForLoad(4000);
      await this.wait(args.waitMs ?? 350);
    } else if (action === 'forward') {
      await this.send('Runtime.evaluate', { expression: 'history.forward()' });
      await this.waitForLoad(4000);
      await this.wait(args.waitMs ?? 350);
    } else if (action === 'reload') {
      await this.send('Page.reload', { ignoreCache: false });
      await this.waitForLoad(10000);
      await this.wait(args.waitMs ?? 300);
    } else if (action === 'wait') {
      const budgetMs = Math.max(100, Math.min(8000, Number(args.waitMs ?? 3000)));
      const css = args.ref ? `[data-g0d-ref="${String(args.ref).replace(/"/g, '')}"]` : (args.selector || '');
      const wantText = typeof args.text === 'string' && args.text.trim() ? args.text.trim() : '';
      if (!css && !wantText) {
        await this.wait(budgetMs);
      } else {
        const deadline = Date.now() + budgetMs;
        let matched = false;
        while (Date.now() <= deadline) {
          try {
            const probe = await this.send('Runtime.evaluate', {
              expression: `(() => {
                ${DEEP_QUERY_HELPERS}
                const sel = ${JSON.stringify(css)};
                const txt = ${JSON.stringify(wantText.toLowerCase())};
                let selOk = !sel;
                if (sel) {
                  const el = queryOneDeep(sel);
                  if (el) {
                    const st = window.getComputedStyle(el);
                    const r = el.getBoundingClientRect();
                    selOk = Boolean(st && st.display !== 'none' && st.visibility !== 'hidden' && Number(st.opacity) !== 0 && r.width >= 1 && r.height >= 1);
                  }
                }
                let txtOk = !txt;
                if (txt) {
                  let allText = (document.body?.innerText || '').toLowerCase();
                  if (!allText.includes(txt)) {
                    for (const h of queryAllDeep('*')) {
                      if (h.shadowRoot && String(h.shadowRoot.textContent || '').toLowerCase().includes(txt)) { txtOk = true; break; }
                    }
                  } else {
                    txtOk = true;
                  }
                }
                return selOk && txtOk;
              })()`,
              returnByValue: true,
            }, 3000);
            if (probe?.result?.value === true) { matched = true; break; }
          } catch {}
          await this.wait(100);
        }
        if (!matched) {
          throw fault('BROWSER_WAIT_TIMEOUT', `Timed out after ${budgetMs}ms waiting for ${[css ? `selector "${css}"` : '', wantText ? `text "${wantText}"` : ''].filter(Boolean).join(' and ')}.`);
        }
      }
    } else if (action === 'scroll') {
      const dx = Number(args.deltaX) || 0;
      const dy = args.deltaY === undefined ? 500 : (Number(args.deltaY) || 0);
      await this.send('Runtime.evaluate', { expression: `window.scrollBy(${dx}, ${dy})` });
      await this.wait(args.waitMs ?? 200);
    } else if (action === 'hover' || action === 'click' || action === 'double_click') {
      const pt = await this.resolveTargetPoint(args);
      actPt = { x: Math.round(pt.x), y: Math.round(pt.y) };
      this.lastAction = { action, label: actLabel, x: actPt.x, y: actPt.y, url: this.lastUrl, title: this.lastTitle, time: Date.now() };
      this._emit({ type: 'browser.activity', active: true, ...this.lastAction });
      await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pt.x, y: pt.y });
      if (action === 'click' || action === 'double_click') {
        const clicks = action === 'double_click' ? 2 : 1;
        for (let c = 1; c <= clicks; c++) {
          await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'left', clickCount: c });
          await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x, y: pt.y, button: 'left', clickCount: c });
        }
      }
      await this.wait(args.waitMs ?? 300);
    } else if (action === 'type') {
      if (args.ref || args.selector || (Number.isFinite(args.x) && Number.isFinite(args.y))) {
        const pt = await this.resolveTargetPoint({ ...args, focus: true });
        actPt = { x: Math.round(pt.x), y: Math.round(pt.y) };
        this.lastAction = { action: 'type', label: typeof args.text === 'string' ? args.text.slice(0, 36) : actLabel, x: actPt.x, y: actPt.y, url: this.lastUrl, title: this.lastTitle, time: Date.now() };
        this._emit({ type: 'browser.activity', active: true, ...this.lastAction });
        await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pt.x, y: pt.y });
        await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
        await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
      }
      if (args.clear) {
        await this.send('Runtime.evaluate', {
          expression: `(() => {
            ${DEEP_QUERY_HELPERS}
            const el = deepActiveElement();
            if (!el) return;
            if ('value' in el) {
              const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
              const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
              if (setter) setter.call(el, '');
              else el.value = '';
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
            } else if (el.isContentEditable) {
              el.textContent = '';
              el.dispatchEvent(new Event('input', { bubbles: true }));
            }
          })()`,
        });
      }
      if (typeof args.text === 'string' && args.text.length) {
        await this.send('Input.insertText', { text: args.text });
      }
      if (args.submit) {
        const k = KEY_MAP.Enter;
        await this.send('Input.dispatchKeyEvent', { type: 'keyDown', ...k });
        await this.send('Input.dispatchKeyEvent', { type: 'keyUp', ...k });
      }
      await this.wait(args.waitMs ?? 250);
    } else if (action === 'press') {
      const spec = parseKeySpec(args.key);
      await this.send('Input.dispatchKeyEvent', { type: 'keyDown', ...spec });
      await this.send('Input.dispatchKeyEvent', { type: 'keyUp', ...spec });
      await this.wait(args.waitMs ?? 200);
    } else if (action === 'select') {
      const css = args.ref ? `[data-g0d-ref="${String(args.ref).replace(/"/g, '')}"]` : args.selector;
      if (!css) throw fault('BROWSER_TARGET_REQUIRED', 'Provide ref or selector for select action.');
      const res = await this.send('Runtime.evaluate', {
        expression: `(() => {
          ${DEEP_QUERY_HELPERS}
          const el = queryOneDeep(${JSON.stringify(css)});
          if (!el || el.tagName !== 'SELECT') return { ok: false, reason: 'not_found' };
          const want = ${JSON.stringify(String(args.text ?? ''))};
          const opts = [...el.options];
          const match = opts.find(o => o.value === want) || opts.find(o => o.textContent.trim().toLowerCase() === want.trim().toLowerCase());
          if (!match) return { ok: false, reason: 'option_missing', options: opts.slice(0, 12).map(o => o.textContent.trim() + ' (' + o.value + ')') };
          const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
          if (setter) setter.call(el, match.value);
          else el.value = match.value;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return { ok: true };
        })()`,
        returnByValue: true,
      });
      const selOut = res?.result?.value;
      if (!selOut?.ok) {
        if (selOut?.reason === 'option_missing') {
          throw fault('BROWSER_OPTION_NOT_FOUND', `Option "${args.text}" not found on ${args.ref || args.selector}. Available: ${(selOut.options || []).join(', ')}`);
        }
        throw fault('BROWSER_ELEMENT_NOT_FOUND', `Select element not found: ${args.ref || args.selector}`);
      }
      await this.wait(args.waitMs ?? 200);
    } else {
      throw fault('INVALID_TOOL', `Unsupported browser action: ${action}`);
    }

    // Re-check current URL after click/navigation against privacy policy
    const snap = await this.snapshot();
    if (snap.url && snap.url !== 'about:blank') {
      try {
        await assertBrowserUrlDnsAllowed(snap.url, outboundOpts);
        this.topLevelIsLoopback = isLoopbackHost(new URL(snap.url).hostname);
      } catch (err) {
        this.topLevelIsLoopback = false;
        this.explicitLoopbackNavPending = false;
        await this.send('Page.navigate', { url: 'about:blank' }, 5000).catch(() => {});
        throw err;
      }
    } else {
      this.topLevelIsLoopback = false;
      this.explicitLoopbackNavPending = false;
    }
    const shot = await this.captureScreenshot();
    this.lastAction = { action, label: actLabel, x: actPt?.x ?? null, y: actPt?.y ?? null, url: snap.url, title: snap.title, time: Date.now() };
    this._emit({ type: 'browser.activity', active: true, ...this.lastAction });
    return { ok: true, action, ...snap, screenshotUrl: shot.screenshotUrl, screenshotBytes: shot.bytes };
  }

  async evaluate({ expression }) {
    this.touch();
    const res = await this.send('Runtime.evaluate', {
      expression: String(expression || ''),
      awaitPromise: true,
      returnByValue: true,
    }, 8000);
    if (res?.exceptionDetails) {
      throw fault('BROWSER_EVAL_ERROR', String(res.exceptionDetails.exception?.description || res.exceptionDetails.text || 'Evaluation failed').slice(0, 600));
    }
    const val = res?.result?.value;
    const serialized = val === undefined ? 'undefined' : typeof val === 'string' ? val : JSON.stringify(val, null, 2);
    const truncated = serialized.length > MAX_EVAL_CHARS;
    return {
      ok: true,
      url: this.lastUrl,
      result: truncated ? serialized.slice(0, MAX_EVAL_CHARS) + '\n[…truncated…]' : serialized,
      truncated,
    };
  }

  async close({ preserveProfile = false } = {}) {
    if (this.cleanupPromise) return this.cleanupPromise;
    await this.stopScreencast().catch(() => {});
    this.closed = true;
    this.disconnected = true;
    this.cleanupPromise = (async () => {
      try { this.ws?.close(); } catch {}
      this.ws = null;
      const proc = this.proc;
      this.proc = null;
      if (proc && proc.exitCode === null && !proc.killed) {
        const sendSig = sig => {
          try {
            if (process.platform !== 'win32' && Number.isInteger(proc.pid)) process.kill(-proc.pid, sig);
            else proc.kill(sig);
          } catch {}
        };
        sendSig('SIGTERM');
        await new Promise(resolve => {
          const t = setTimeout(() => { sendSig('SIGKILL'); resolve(); }, 1500);
          t.unref?.();
          proc.once('exit', () => { clearTimeout(t); resolve(); });
        });
      }
      this.latestScreenshot = null;
      this.latestFrame = null;
      if (!preserveProfile && this.profileDir) {
        const dir = this.profileDir;
        this.profileDir = null;
        await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
      }
      if (!preserveProfile) {
        this._emit({ type: 'browser.closed', active: false });
      }
    })();
    return this.cleanupPromise;
  }
}

export class BrowserPool {
  constructor({ getSettings = null, onEvent = null, forceHeadless = false } = {}) {
    this.sessions = new Map();
    this.transitions = new Map();
    this.sessionVisibleOverrides = new Map();
    this.screencastWatchers = new Set();
    this.getSettings = typeof getSettings === 'function' ? getSettings : (() => DEFAULT_BROWSER_SETTINGS);
    this.onEvent = typeof onEvent === 'function' ? onEvent : null;
    this.forceHeadless = Boolean(forceHeadless);
    this.reapTimer = setInterval(() => this._reapIdle(), 60 * 1000);
    this.reapTimer.unref?.();
  }

  _serialize(taskId, fn) {
    const prev = this.transitions.get(taskId) || Promise.resolve();
    const next = prev.catch(() => {}).then(fn);
    const wrapped = next.finally(() => {
      if (this.transitions.get(taskId) === wrapped) this.transitions.delete(taskId);
    });
    this.transitions.set(taskId, wrapped);
    return next;
  }

  async _waitTransition(taskId) {
    const t = this.transitions.get(taskId);
    if (t) await t.catch(() => {});
  }

  _isLive(session) {
    return Boolean(session && !session.closed && !session.disconnected && session.ws?.readyState === WebSocket.OPEN);
  }

  _shouldRunHeadless(taskId) {
    if (this.forceHeadless || process.env.G0D_FORCE_HEADLESS === '1' || process.env.NODE_ENV === 'test') return true;
    if (this.sessionVisibleOverrides.has(taskId)) return !this.sessionVisibleOverrides.get(taskId);
    const settings = normalizeBrowserSettings(this.getSettings?.());
    return !settings.visibleWindow;
  }

  _reapIdle() {
    const now = Date.now();
    for (const [taskId, session] of this.sessions) {
      if (now - session.lastUsedAt > IDLE_TTL_MS) {
        this.closeSession(taskId).catch(() => {});
      }
    }
  }

  _handleUnexpectedExit(taskId, deadSession) {
    if (this.sessions.get(taskId) !== deadSession) return;
    this.sessions.delete(taskId);
    deadSession.close().catch(() => {});
  }

  async _launchSession(taskId, viewport, { profileDir = null, headlessOverride = null } = {}) {
    const existing = this.sessions.get(taskId);
    if (this._isLive(existing)) {
      existing.touch();
      return existing;
    }
    if (existing) {
      this.sessions.delete(taskId);
      await existing.close().catch(() => {});
    }
    const binaryPath = await findChromiumBinary();
    if (!binaryPath) {
      throw fault('BROWSER_UNAVAILABLE', 'No Chromium-compatible browser (Chrome, Brave, Chromium, Edge, Arc) was found. Set G0D_BROWSER_PATH to configure one.');
    }
    const headless = typeof headlessOverride === 'boolean' ? headlessOverride : this._shouldRunHeadless(taskId);
    const next = new CdpSession({
      taskId,
      binaryPath,
      viewport,
      headless,
      profileDir,
      onEvent: this.onEvent,
      onUnexpectedExit: (dead) => this._handleUnexpectedExit(taskId, dead),
    });
    this.sessions.set(taskId, next);
    try {
      await next.start();
      const settings = normalizeBrowserSettings(this.getSettings?.());
      if (this.screencastWatchers.has(taskId) && settings.liveMirror) {
        await next.startScreencast().catch(() => {});
      }
      return next;
    } catch (err) {
      if (this.sessions.get(taskId) === next) this.sessions.delete(taskId);
      await next.close().catch(() => {});
      throw err;
    }
  }

  _getOrCreate(taskId, viewport, opts = {}) {
    return this._serialize(taskId, () => this._launchSession(taskId, viewport, opts));
  }

  getLatestScreenshot(taskId) {
    const session = this.sessions.get(taskId);
    if (!this._isLive(session) || !session.latestScreenshot) return null;
    return {
      buffer: session.latestScreenshot,
      seq: session.screenshotSeq,
      url: session.lastUrl,
      title: session.lastTitle,
    };
  }

  getLatestFrame(taskId) {
    const session = this.sessions.get(taskId);
    if (!this._isLive(session)) return null;
    if (session.latestFrame?.buffer) return session.latestFrame;
    if (session.latestScreenshot) {
      return {
        buffer: session.latestScreenshot,
        mime: 'image/png',
        seq: session.screenshotSeq,
        width: session.viewport.width,
        height: session.viewport.height,
        time: session.lastUsedAt,
      };
    }
    return null;
  }

  getStatus(taskId) {
    const settings = normalizeBrowserSettings(this.getSettings?.());
    const session = this.sessions.get(taskId);
    const active = this._isLive(session);
    return {
      active,
      headless: active ? session.headless : this._shouldRunHeadless(taskId),
      visibleWindow: active ? !session.headless : !this._shouldRunHeadless(taskId),
      url: active ? session.lastUrl : null,
      title: active ? session.lastTitle : null,
      viewport: active ? session.viewport : { width: 1280, height: 800 },
      screencastActive: active ? Boolean(session.screencastActive) : false,
      hasFrame: active ? Boolean(session.latestFrame?.buffer || session.latestScreenshot) : false,
      frameSeq: active ? session.frameSeq : 0,
      lastAction: active ? session.lastAction : null,
      consoleErrors: active ? session.consoleLogs.slice(-15) : [],
      settings,
    };
  }

  async setScreencastWatching(taskId, watching) {
    if (watching) this.screencastWatchers.add(taskId);
    else this.screencastWatchers.delete(taskId);
    await this._waitTransition(taskId);
    const session = this.sessions.get(taskId);
    if (!this._isLive(session)) {
      return this.getStatus(taskId);
    }
    const settings = normalizeBrowserSettings(this.getSettings?.());
    if (watching && settings.liveMirror) {
      await session.startScreencast().catch(() => {});
    } else if (!watching) {
      await session.stopScreencast().catch(() => {});
    }
    return this.getStatus(taskId);
  }

  async stopAllScreencasts() {
    await Promise.all([...this.sessions.values()].map(s => s.stopScreencast().catch(() => {})));
  }

  setSessionMode(taskId, { visibleWindow }, outboundOpts = {}) {
    return this._serialize(taskId, async () => {
      const wantVisible = Boolean(visibleWindow);
      this.sessionVisibleOverrides.set(taskId, wantVisible);
      const targetHeadless = (this.forceHeadless || process.env.G0D_FORCE_HEADLESS === '1' || process.env.NODE_ENV === 'test') ? true : !wantVisible;
      const session = this.sessions.get(taskId);
      if (!this._isLive(session)) {
        return this.getStatus(taskId);
      }
      if (session.headless === targetHeadless) return this.getStatus(taskId);
      // Query live location.href before closing so post-login navigation in a visible window is preserved!
      let prevUrl = session.lastUrl;
      try {
        const loc = await session.send('Runtime.evaluate', { expression: 'location.href', returnByValue: true }, 1500);
        if (typeof loc?.result?.value === 'string' && loc.result.value) prevUrl = loc.result.value;
      } catch {}
      const prevViewport = session.viewport;
      const preservedProfileDir = session.profileDir;
      this.sessions.delete(taskId);
      await session.close({ preserveProfile: true });
      let next;
      try {
        next = await this._launchSession(taskId, prevViewport, { profileDir: preservedProfileDir, headlessOverride: targetHeadless });
        if (prevUrl && prevUrl !== 'about:blank') {
          try {
            assertBrowserUrlAllowed(prevUrl, outboundOpts);
            await next.open({ url: prevUrl, waitMs: 250 }, outboundOpts);
          } catch {}
        } else {
          await next.captureScreenshot().catch(() => {});
        }
        if (this.onEvent) {
          try {
            this.onEvent({
              type: 'browser.status',
              taskId,
              active: true,
              headless: next.headless,
              visibleWindow: !next.headless,
              url: next.lastUrl,
              title: next.lastTitle,
              viewport: next.viewport,
              screencastActive: next.screencastActive,
            });
          } catch {}
        }
      } catch (err) {
        if (preservedProfileDir) await fs.rm(preservedProfileDir, { recursive: true, force: true }).catch(() => {});
        throw err;
      }
      return this.getStatus(taskId);
    });
  }

  async open(taskId, args, outboundOpts) {
    // Validate URL before even launching a browser process!
    assertBrowserUrlAllowed(args?.url, outboundOpts);
    const session = await this._getOrCreate(taskId, args?.viewport);
    return await session.open(args, outboundOpts);
  }

  async snapshot(taskId, args) {
    await this._waitTransition(taskId);
    const session = this.sessions.get(taskId);
    if (!this._isLive(session)) throw fault('BROWSER_NOT_OPEN', 'No contained browser session is open for this task. Call browser.open first.');
    session.touch();
    const snap = await session.snapshot(args);
    return {
      ok: true,
      ...snap,
      ...(session.screenshotSeq ? { screenshotUrl: `/api/tasks/${encodeURIComponent(taskId)}/browser/screenshot?v=${session.screenshotSeq}` } : {}),
    };
  }

  async act(taskId, args, outboundOpts) {
    await this._waitTransition(taskId);
    const session = this.sessions.get(taskId);
    if (!this._isLive(session)) throw fault('BROWSER_NOT_OPEN', 'No contained browser session is open for this task. Call browser.open first.');
    return await session.act(args, outboundOpts);
  }

  async screenshot(taskId, args) {
    await this._waitTransition(taskId);
    const session = this.sessions.get(taskId);
    if (!this._isLive(session)) throw fault('BROWSER_NOT_OPEN', 'No contained browser session is open for this task. Call browser.open first.');
    session.touch();
    const shot = await session.captureScreenshot(args);
    return {
      ok: true,
      url: session.lastUrl,
      title: session.lastTitle,
      viewport: session.viewport,
      screenshotUrl: shot.screenshotUrl,
      bytes: shot.bytes,
    };
  }

  async evaluate(taskId, args) {
    await this._waitTransition(taskId);
    const session = this.sessions.get(taskId);
    if (!this._isLive(session)) throw fault('BROWSER_NOT_OPEN', 'No contained browser session is open for this task. Call browser.open first.');
    return await session.evaluate(args);
  }

  closeSession(taskId, { resetPreferences = false } = {}) {
    return this._serialize(taskId, async () => {
      if (resetPreferences) {
        this.sessionVisibleOverrides.delete(taskId);
        this.screencastWatchers.delete(taskId);
      }
      const session = this.sessions.get(taskId);
      if (!session) return { ok: true, closed: false };
      this.sessions.delete(taskId);
      await session.close();
      return { ok: true, closed: true };
    });
  }

  async closeAll() {
    clearInterval(this.reapTimer);
    const all = [...new Set([...this.sessions.keys(), ...this.transitions.keys()])];
    await Promise.all(all.map(id => this.closeSession(id, { resetPreferences: true }).catch(() => {})));
  }
}
