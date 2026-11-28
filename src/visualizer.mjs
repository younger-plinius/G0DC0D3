/**
 * G0DC0D3 Live Sidecar Visualizer (`✦ Visualize`).
 *
 * Generates a self-contained, bespoke interactive HTML/SVG/JS dashboard tailored to
 * whatever task the agent is currently performing, stored privately in `<dataDir>/visualizers/`
 * (zero Git working tree pollution) and rendered inside a strict CSP-sandboxed iframe
 * (`sandbox="allow-scripts"`, no `allow-same-origin`).
 *
 * The host UI pushes live read-only state snapshots via `postMessage({ type: 'g0d:viz', ... })`
 * on every SSE event so the bespoke dashboard animates and updates in real time.
 */

import { promises as fs, constants as fsConstants } from 'node:fs';
import path from 'node:path';

export const VISUALIZER_CSP = [
  "sandbox allow-scripts",
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data:",
  "font-src data:",
  "connect-src 'none'",
  "frame-ancestors 'self'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

const MAX_VIZ_HTML_BYTES = 256 * 1024;
const MAX_METRICS_BYTES = 64 * 1024;

function safeTaskFileId(taskId) {
  return String(taskId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80) || 'default';
}

export function visualizerFilePath(dataDir, taskId) {
  return path.join(dataDir, 'visualizers', `${safeTaskFileId(taskId)}.html`);
}

/** Reads optional domain-specific telemetry written by the main agent to `.g0dc0d3/viz-metrics.json`. */
export async function readOptionalVizMetrics(workspace) {
  if (!workspace || typeof workspace !== 'string') return null;
  let fh = null;
  try {
    const wsReal = await fs.realpath(workspace);
    const dirPath = path.join(wsReal, '.g0dc0d3');
    const dirSt = await fs.lstat(dirPath);
    if (!dirSt.isDirectory() || dirSt.isSymbolicLink()) return null;
    const dirReal = await fs.realpath(dirPath);
    if (dirReal !== dirPath && !dirReal.startsWith(wsReal + path.sep)) return null;
    const metricsPath = path.join(dirReal, 'viz-metrics.json');
    const flags = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0) | (fsConstants.O_NONBLOCK || 0);
    fh = await fs.open(metricsPath, flags);
    const st = await fh.stat();
    if (!st.isFile() || st.size > MAX_METRICS_BYTES) return null;
    const buf = Buffer.alloc(Math.min(st.size, MAX_METRICS_BYTES));
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    return JSON.parse(buf.subarray(0, bytesRead).toString('utf8'));
  } catch {
    return null;
  } finally {
    await fh?.close().catch(() => {});
  }
}

/** Builds a clean, bounded read-only telemetry payload safe to send to both the generator and live iframe. */
export async function buildVisualizerPayload(task, events = [], files = []) {
  const recentEvents = (Array.isArray(events) ? events : []).slice(-60).map(e => {
    const d = e?.data || {};
    return {
      seq: e?.seq ?? null,
      type: e?.type || '',
      time: e?.time || null,
      tool: d.name || d.tool || null,
      path: d.result?.path || d.args?.path || null,
      command: typeof d.args?.command === 'string' ? d.args.command.slice(0, 120) : null,
      url: typeof d.args?.url === 'string' ? d.args.url.slice(0, 140) : null,
      ok: d.result?.ok ?? (d.status !== 'failed'),
      durationMs: Number.isFinite(Number(d.durationMs ?? d.result?.durationMs)) ? Math.max(0, Math.round(Number(d.durationMs ?? d.result?.durationMs))) : null,
    };
  });

  const toolCounts = {};
  const touchedFiles = new Set();
  for (const ev of recentEvents) {
    if (ev.type === 'tool.completed' && ev.tool) {
      toolCounts[ev.tool] = (toolCounts[ev.tool] || 0) + 1;
      if (ev.path) touchedFiles.add(ev.path);
    }
  }

  const metrics = await readOptionalVizMetrics(task?.workspace);

  return {
    type: 'g0d:viz',
    updatedAt: new Date().toISOString(),
    task: {
      id: task?.id || '',
      title: String(task?.title || '').slice(0, 140),
      objective: String(task?.objective || '').slice(0, 800),
      status: task?.status || 'idle',
      calls: Number(task?.calls || 0),
      planMode: Boolean(task?.planMode),
      effort: task?.effort || 'medium',
      providerId: task?.providerId || null,
      todos: Array.isArray(task?.todos) ? task.todos.slice(0, 16).map(t => ({ text: String(t?.text || '').slice(0, 140), status: t?.status || 'pending' })) : [],
      verification: task?.verification ? {
        status: task.verification.status,
        checks: Array.isArray(task.verification.checks) ? task.verification.checks.slice(0, 20).map(c => ({ name: String(c?.name || '').slice(0, 80), status: c?.status || 'unknown' })) : [],
      } : null,
    },
    toolCounts,
    touchedFiles: [...touchedFiles].slice(0, 30),
    fileCount: Array.isArray(files) ? files.length : 0,
    files: (Array.isArray(files) ? files : []).slice(0, 30).map(f => ({ path: f.path, bytes: f.bytes })),
    events: recentEvents.slice(-30),
    metrics,
  };
}

function escapeHtmlBasic(str) {
  return String(str ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** Deterministic, rich fallback visualizer (works instantaneously even offline or if a model omits HTML). */
export function buildFallbackVisualizerHtml(payload) {
  const safeJson = JSON.stringify(payload)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  const title = escapeHtmlBasic(payload?.task?.title || 'Live Agent Visualizer');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
  :root { --bg:#0d1016; --panel:#141923; --line:#232a38; --text:#e6ecf5; --muted:#8b97ad; --accent:#a78bfa; --ok:#4ade80; --warn:#fbbf24; --err:#f87171; }
  * { box-sizing:border-box; }
  body { margin:0; padding:16px; background:var(--bg); color:var(--text); font:13px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
  .head { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:14px; padding-bottom:12px; border-bottom:1px solid var(--line); }
  .title { font-size:15px; font-weight:700; margin:0; }
  .pill { font-size:11px; font-weight:600; padding:3px 9px; border-radius:999px; background:rgba(167,139,250,.18); color:#c4b5fd; border:1px solid rgba(167,139,250,.35); text-transform:uppercase; letter-spacing:.04em; }
  .pill.completed { background:rgba(74,222,128,.16); color:var(--ok); border-color:rgba(74,222,128,.35); }
  .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(130px,1fr)); gap:10px; margin-bottom:14px; }
  .stat { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:10px 12px; }
  .stat-k { color:var(--muted); font-size:11px; text-transform:uppercase; letter-spacing:.05em; }
  .stat-v { font-size:20px; font-weight:700; margin-top:3px; font-variant-numeric:tabular-nums; }
  .card { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:12px; margin-bottom:12px; }
  .card h3 { margin:0 0 8px; font-size:12px; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); }
  .bars { display:flex; flex-direction:column; gap:6px; }
  .bar-row { display:grid; grid-template-columns:110px 1fr 34px; align-items:center; gap:8px; font-size:12px; }
  .bar-track { height:8px; background:#1c2331; border-radius:999px; overflow:hidden; }
  .bar-fill { height:100%; background:linear-gradient(90deg,#8b5cf6,#38bdf8); border-radius:999px; transition:width .35s ease; }
  .chips { display:flex; flex-wrap:wrap; gap:6px; }
  .chip { padding:3px 8px; border-radius:6px; background:#1a2130; border:1px solid var(--line); font:11px ui-monospace,SFMono-Regular,Menlo,monospace; color:#cbd5e1; }
  .timeline { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:6px; max-height:240px; overflow:auto; }
  .timeline li { display:flex; justify-content:space-between; gap:8px; font-size:12px; padding:5px 8px; border-radius:6px; background:#111620; border:1px solid rgba(255,255,255,.04); }
  .mono { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; color:#cbd5e1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .muted { color:var(--muted); }
  .ok { color:var(--ok); } .err { color:var(--err); }
</style>
</head>
<body>
<div class="head">
  <div>
    <h1 class="title" id="v-title">${title}</h1>
    <div class="muted" id="v-obj" style="margin-top:2px;font-size:12px;"></div>
  </div>
  <span class="pill" id="v-status">live</span>
</div>
<div class="grid">
  <div class="stat"><div class="stat-k">Model Turns</div><div class="stat-v" id="v-calls">0</div></div>
  <div class="stat"><div class="stat-k">Tool Ops</div><div class="stat-v" id="v-tools">0</div></div>
  <div class="stat"><div class="stat-k">Files Touched</div><div class="stat-v" id="v-files">0</div></div>
  <div class="stat"><div class="stat-k">Verification</div><div class="stat-v" id="v-verif">—</div></div>
</div>
<div class="card"><h3>Tool Activity Breakdown</h3><div class="bars" id="v-bars"></div></div>
<div class="card" id="v-metrics-card" hidden><h3>Live Domain Metrics</h3><pre class="mono" id="v-metrics" style="white-space:pre-wrap;margin:0;font-size:11px;"></pre></div>
<div class="card"><h3>Touched Workspace Files</h3><div class="chips" id="v-chips"></div></div>
<div class="card"><h3>Live Event Stream</h3><ul class="timeline" id="v-events"></ul></div>
<script>
const INITIAL = ${safeJson};
function esc(s){return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function render(data){
  if(!data||!data.task)return;
  const t=data.task;
  document.getElementById('v-title').textContent=t.title||'Live Agent Visualizer';
  document.getElementById('v-obj').textContent=(t.objective||'').slice(0,220);
  const st=document.getElementById('v-status');
  st.textContent=t.status||'live';
  st.className='pill '+(t.status||'');
  document.getElementById('v-calls').textContent=String(t.calls||0);
  const counts=data.toolCounts||{};
  const totalTools=Object.values(counts).reduce((a,b)=>a+b,0);
  document.getElementById('v-tools').textContent=String(totalTools);
  const touched=data.touchedFiles||[];
  document.getElementById('v-files').textContent=String(touched.length);
  const ver=t.verification?.status||'—';
  document.getElementById('v-verif').textContent=ver.toUpperCase();
  const maxC=Math.max(1,...Object.values(counts));
  const bars=document.getElementById('v-bars');
  bars.innerHTML=Object.keys(counts).length
    ? Object.entries(counts).sort((a,b)=>b[1]-a[1]).map(([k,v])=>'<div class="bar-row"><span class="mono">'+esc(k)+'</span><div class="bar-track"><div class="bar-fill" style="width:'+Math.round((v/maxC)*100)+'%"></div></div><span class="muted">'+v+'</span></div>').join('')
    : '<div class="muted">Waiting for tool activity…</div>';
  const chips=document.getElementById('v-chips');
  chips.innerHTML=touched.length ? touched.map(f=>'<span class="chip">'+esc(f)+'</span>').join('') : '<span class="muted">No files modified yet</span>';
  const mc=document.getElementById('v-metrics-card');
  if(data.metrics){ mc.hidden=false; document.getElementById('v-metrics').textContent=JSON.stringify(data.metrics,null,2); }
  else { mc.hidden=true; }
  const evs=(data.events||[]).filter(e=>e.tool||e.type==='evaluation.completed'||e.type==='model.request').slice(-18).reverse();
  document.getElementById('v-events').innerHTML=evs.length
    ? evs.map(e=>'<li><span class="mono">'+(e.ok===false?'<span class="err">!</span> ':'<span class="ok">✓</span> ')+esc(e.tool||e.type)+(e.path?' · '+esc(e.path):e.url?' · '+esc(e.url):e.command?' · '+esc(e.command):'')+'</span><span class="muted">'+(typeof e.durationMs==='number'&&Number.isFinite(e.durationMs)?esc(String(e.durationMs))+'ms':'')+'</span></li>').join('')
    : '<li class="muted">Live telemetry connected…</li>';
}
render(INITIAL);
window.addEventListener('message',ev=>{ if(ev.data&&ev.data.type==='g0d:viz') render(ev.data); });
</script>
</body>
</html>`;
}

function extractHtmlDocument(rawText) {
  if (typeof rawText !== 'string' || !rawText.trim()) return null;
  const trimmed = rawText.trim();
  const fenced = trimmed.match(/```(?:html)?\s*([\s\S]*)```/i);
  const candidate = (fenced ? fenced[1] : trimmed).trim();
  const docStart = candidate.search(/<!doctype\s+html|<html[\s>]/i);
  if (docStart < 0) return null;
  const doc = candidate.slice(docStart).trim();
  if (!/<\/html>/i.test(doc)) return null;
  if (Buffer.byteLength(doc, 'utf8') > MAX_VIZ_HTML_BYTES) return null;
  // Block external script/iframe/redirect/plugin/network-exfil tags in generated visualizer HTML
  if (
    /<script[^>]+src\s*=/i.test(doc)
    || /<iframe[\s>]/i.test(doc)
    || /<link[^>]+href\s*=\s*["']?(?:https?:)?\/\//i.test(doc)
    || /<meta[^>]+http-equiv\s*=\s*["']?refresh/i.test(doc)
    || /<base[\s>]/i.test(doc)
    || /<(?:object|embed)[\s>]/i.test(doc)
  ) {
    return null;
  }
  return doc;
}

/**
 * Generates (or refines) a bespoke live HTML/SVG/JS visualizer for `task` via a lightweight
 * sidecar `.draft()` call, falling back cleanly to the rich deterministic telemetry dashboard.
 */
const VISUALIZER_META_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none';";

function injectMetaCsp(doc) {
  if (!doc) return doc;
  // Strip any model-supplied CSP meta tags so an LLM can never weaken our strict offline sandbox policy.
  const stripped = doc.replace(/<meta\b[^>]*http-equiv\s*=\s*["']?content-security-policy["']?[^>]*>/gi, '');
  const tag = `<meta http-equiv="Content-Security-Policy" content="${VISUALIZER_META_CSP}">`;
  if (/<head[\s>]/i.test(stripped)) return stripped.replace(/<head([^>]*)>/i, `<head$1>\n${tag}`);
  return `${tag}\n${stripped}`;
}

export async function generateTaskVisualizer({
  dataDir,
  task,
  events = [],
  files = [],
  provider = null,
  instruction = '',
  outbound = {},
  signal = null,
} = {}) {
  const payload = await buildVisualizerPayload(task, events, files);
  let html = null;
  let generatedBy = 'deterministic_fallback';

  if (provider && typeof provider.draft === 'function') {
    const sysPrompt = [
      'You are G0DC0D3 Live Visualizer — a bespoke interactive UI/SVG dashboard synthesizer.',
      'Return ONLY a single complete, self-contained HTML5 document (`<!doctype html><html>...</html>`) with inline <style> and <script>.',
      'STRICT SECURITY RULES: NO external URLs, NO <script src=...>, NO <link href="http...">, NO <iframe>, NO fetch(). Everything must work 100% offline inside a strict CSP sandbox.',
      'DESIGN RULES:',
      '- Tailor the visualization specifically to what the agent is currently doing (e.g. interactive architecture/file dependency SVG graph, live test pass/fail matrix, research source map, benchmark bar/line chart, state-machine pipeline, or live metrics board).',
      '- Use a sleek dark-mode aesthetic (#0d1016 background, #141923 cards, #a78bfa accent, #4ade80 green, crisp sans + monospace typography).',
      '- Embed the initial JSON snapshot directly AND listen for live updates via `window.addEventListener("message", (e) => { if (e.data && e.data.type === "g0d:viz") render(e.data); });` so the dashboard updates smoothly in real time.',
      '- Keep it fast, clean, responsive, and under 35 KB. Escape all dynamic strings before inserting into HTML.',
    ].join('\n');

    const userPrompt = [
      `Current live task telemetry snapshot (JSON):\n${JSON.stringify(payload).slice(0, 12000)}`,
      instruction ? `User refinement instruction: ${String(instruction).slice(0, 400)}` : 'Design the most illuminating, bespoke live visualization for this exact task.',
    ].join('\n\n');

    try {
      const modelBase = String(provider.model || provider.id || '').toLowerCase().split('/').pop();
      const samplingLocked = /^(?:o1|o3|o4|gpt-[56])(?:$|[.-])/.test(modelBase);
      const res = await provider.draft(
        [{ role: 'system', content: sysPrompt }, { role: 'user', content: userPrompt }],
        signal,
        4096,
        samplingLocked ? {} : { temperature: 0.45 },
        outbound
      );
      if (res?.type === 'message' && typeof res.text === 'string') {
        const extracted = extractHtmlDocument(res.text);
        if (extracted) {
          html = extracted;
          generatedBy = provider.label || provider.model || provider.id || 'sidecar';
        }
      }
    } catch (err) {
      if (signal?.aborted || err?.name === 'AbortError') {
        throw Object.assign(new Error('Visualizer generation cancelled.'), { name: 'AbortError', code: 'VISUALIZER_CANCELLED' });
      }
    }
  }
  if (signal?.aborted) {
    throw Object.assign(new Error('Visualizer generation cancelled.'), { name: 'AbortError', code: 'VISUALIZER_CANCELLED' });
  }

  if (!html) html = buildFallbackVisualizerHtml(payload);
  html = injectMetaCsp(html);

  const filePath = visualizerFilePath(dataDir, task?.id);
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  try {
    await fs.writeFile(tmpPath, html, { encoding: 'utf8', mode: 0o600 });
    await fs.rename(tmpPath, filePath);
  } finally {
    await fs.rm(tmpPath, { force: true }).catch(() => {});
  }

  return {
    ok: true,
    taskId: task?.id,
    generatedBy,
    bytes: Buffer.byteLength(html, 'utf8'),
    url: `/api/tasks/${encodeURIComponent(task?.id || '')}/visualizer`,
    payload,
  };
}

export async function readTaskVisualizerHtml(dataDir, taskId) {
  try {
    return await fs.readFile(visualizerFilePath(dataDir, taskId), 'utf8');
  } catch {
    return null;
  }
}

export async function deleteTaskVisualizer(dataDir, taskId) {
  try { await fs.unlink(visualizerFilePath(dataDir, taskId)); } catch {}
}
