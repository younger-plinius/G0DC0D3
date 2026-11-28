import { promises as fs, constants as fsConstants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { HttpProvider } from './providers.mjs';
import { isLoopbackUrl, isPrivateLanUrl } from './privacy.mjs';

const MAX_LOCAL_MODELS = 64;
const MAX_SAVED_FILE_BYTES = 1024 * 1024;
const MAX_PROBE_RESPONSE_BYTES = 2 * 1024 * 1024;
const DEFAULT_DISCOVER_TIMEOUT_MS = 1500;
const DEFAULT_PULL_TIMEOUT_MS = 15 * 60 * 1000;

export const LOCAL_STACK_PRESETS = Object.freeze([
  {
    id: 'ollama',
    name: 'Ollama',
    baseUrl: 'http://127.0.0.1:11434/v1',
    probeUrl: 'http://127.0.0.1:11434/api/tags',
    probeKind: 'ollama',
    placeholder: 'qwen2.5-coder:32b or hf.co/org/repo:Q4_K_M',
    supportsHfPull: true,
    launchHint: 'ollama serve'
  },
  {
    id: 'lmstudio',
    name: 'LM Studio',
    baseUrl: 'http://127.0.0.1:1234/v1',
    probeUrl: 'http://127.0.0.1:1234/v1/models',
    probeKind: 'openai',
    placeholder: 'qwen2.5-coder-32b-instruct',
    supportsHfPull: false,
    launchHint: 'Start Local Server in LM Studio (port 1234)'
  },
  {
    id: 'llamacpp',
    name: 'llama.cpp',
    baseUrl: 'http://127.0.0.1:8080/v1',
    probeUrl: 'http://127.0.0.1:8080/v1/models',
    probeKind: 'openai',
    placeholder: 'hf.co/unsloth/Qwen3-Coder-30B-A3B-GGUF',
    supportsHfPull: false,
    launchHint: 'llama-server -hf <org>/<repo> --port 8080 --jinja'
  },
  {
    id: 'vllm',
    name: 'vLLM',
    baseUrl: 'http://127.0.0.1:8000/v1',
    probeUrl: 'http://127.0.0.1:8000/v1/models',
    probeKind: 'openai',
    placeholder: 'Qwen/Qwen3-Coder-30B-A3B-Instruct',
    supportsHfPull: false,
    launchHint: 'vllm serve <org>/<repo> --port 8000 --enable-auto-tool-choice'
  },
  {
    id: 'mlx',
    name: 'MLX (Apple Silicon)',
    baseUrl: 'http://127.0.0.1:8081/v1',
    probeUrl: 'http://127.0.0.1:8081/v1/models',
    probeKind: 'openai',
    placeholder: 'mlx-community/Qwen3-Coder-30B-A3B-4bit',
    supportsHfPull: false,
    launchHint: 'mlx_lm.server --model <org>/<repo> --port 8081'
  },
  {
    id: 'tgi',
    name: 'HuggingFace TGI',
    baseUrl: 'http://127.0.0.1:8082/v1',
    probeUrl: 'http://127.0.0.1:8082/v1/models',
    probeKind: 'openai',
    placeholder: 'meta-llama/Llama-4-Scout-17B-16E-Instruct',
    supportsHfPull: false,
    launchHint: 'text-generation-launcher --model-id <org>/<repo> --port 8082'
  },
  {
    id: 'sglang',
    name: 'SGLang',
    baseUrl: 'http://127.0.0.1:30000/v1',
    probeUrl: 'http://127.0.0.1:30000/v1/models',
    probeKind: 'openai',
    placeholder: 'deepseek-ai/DeepSeek-R1-Distill-Qwen-32B',
    supportsHfPull: false,
    launchHint: 'python -m sglang.launch_server --model-path <org>/<repo> --port 30000'
  },
  {
    id: 'jan',
    name: 'Jan',
    baseUrl: 'http://127.0.0.1:1337/v1',
    probeUrl: 'http://127.0.0.1:1337/v1/models',
    probeKind: 'openai',
    placeholder: 'qwen2.5-coder-14b',
    supportsHfPull: false,
    launchHint: 'Enable Local API Server in Jan (port 1337)'
  }
]);

const PRESET_BY_ID = new Map(LOCAL_STACK_PRESETS.map(p => [p.id, p]));

const fault = (message, status = 400, code = 'LOCAL_PROVIDER_ERROR') => Object.assign(new Error(message), { status, code });

function parseStrictEndpointUrl(raw, { requireLoopback = false, requireHttpsForRemote = true, label = 'baseUrl' } = {}) {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 512 || /[\x00-\x1f\x7f]/.test(raw)) {
    throw fault(`Provide a valid http:// or https:// ${label}.`);
  }
  let parsed;
  try { parsed = new URL(raw.trim()); } catch { throw fault(`Provide a valid http:// or https:// ${label}.`); }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw fault(`${label} must use http:// or https://.`);
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash || raw.includes('?') || raw.includes('#')) {
    throw fault(`${label} cannot include embedded credentials, query parameters, or fragments.`);
  }
  if (requireLoopback && parsed.pathname && parsed.pathname !== '/') {
    throw fault(`${label} cannot include a custom path.`);
  }
  const cleanHref = parsed.href.replace(/\/$/, '');
  const loopback = isLoopbackUrl(cleanHref);
  const lan = isPrivateLanUrl(cleanHref);
  if (requireLoopback && !loopback) {
    throw fault(`${label} is restricted to local loopback endpoints (127.0.0.1 / localhost).`, 403);
  }
  if (requireHttpsForRemote && !loopback && !lan && parsed.protocol !== 'https:') {
    throw fault(`Remote ${label} endpoints must use https:// (plain http:// is allowed only on loopback or private LAN).`);
  }
  return { parsed, href: cleanHref, loopback, lan };
}

export function inferStackFromUrl(baseUrl) {
  try {
    const u = new URL(baseUrl);
    const port = u.port || (u.protocol === 'https:' ? '443' : '80');
    if (port === '11434') return 'ollama';
    if (port === '1234') return 'lmstudio';
    if (port === '8000') return 'vllm';
    if (port === '8081') return 'mlx';
    if (port === '8082') return 'tgi';
    if (port === '30000') return 'sglang';
    if (port === '1337') return 'jan';
    if (port === '8080') return 'llamacpp';
  } catch {}
  return 'custom';
}

export function normalizeHuggingFaceRef(raw) {
  const s = String(raw || '').trim();
  if (!s || s.length > 220 || /[\x00-\x1f\x7f\s]/.test(s)) {
    throw fault('Enter a valid HuggingFace repo (e.g. unsloth/Qwen3-Coder-30B-A3B-GGUF or hf.co/org/repo:Q4_K_M).');
  }
  let cleaned = s
    .replace(/^https?:\/\/(?:www\.)?(?:huggingface\.co|hf\.co)\//i, '')
    .replace(/^hf\.co\//i, '')
    .replace(/[?#].*$/, '')
    .replace(/^\/+|\/+$/g, '');
  // Strip /tree/... or /blob/... suffixes if a browser URL was pasted
  cleaned = cleaned.replace(/\/(?:tree|blob|resolve)\/.*$/i, '');
  const parts = cleaned.split(':');
  if (parts.length > 2) {
    throw fault('HuggingFace model must be in "org/repo" or "hf.co/org/repo[:quant]" format.');
  }
  const [repoPart, quantPart] = parts;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*\/[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(repoPart || '')) {
    throw fault('HuggingFace model must be in "org/repo" or "hf.co/org/repo[:quant]" format.');
  }
  if (quantPart !== undefined && !/^[a-zA-Z0-9._-]{1,48}$/.test(quantPart)) {
    throw fault('Quantization tag must contain only letters, digits, dots, hyphens, or underscores.');
  }
  const ollamaTag = quantPart ? `hf.co/${repoPart}:${quantPart}` : `hf.co/${repoPart}`;
  if (ollamaTag.length > 200) {
    throw fault('HuggingFace model identifier exceeds maximum length (200 characters).');
  }
  return {
    repo: repoPart,
    quant: quantPart || null,
    ollamaTag,
    recipes: {
      ollama: `ollama pull ${ollamaTag}`,
      llamacpp: `llama-server -hf ${quantPart ? `${repoPart}:${quantPart}` : repoPart} --port 8080 --jinja`,
      vllm: `vllm serve ${repoPart} --port 8000 --enable-auto-tool-choice`,
      mlx: `mlx_lm.server --model ${repoPart} --port 8081`,
      tgi: `text-generation-launcher --model-id ${repoPart} --port 8082`
    }
  };
}

function clampLabel(text, max = 120) {
  const s = String(text || '').trim();
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

function normalizeLocalInput(body = {}) {
  const rawBaseUrl = body.baseUrl === undefined || body.baseUrl === '' ? 'http://127.0.0.1:11434/v1' : body.baseUrl;
  const { href: baseUrlStr } = parseStrictEndpointUrl(rawBaseUrl, { requireHttpsForRemote: true, label: 'baseUrl' });
  const model = typeof body.model === 'string' ? body.model.trim() : '';
  if (!model || model.length > 200 || /[\x00-\x1f\x7f]/.test(model)) {
    throw fault('Provide a valid non-empty model name.');
  }
  const stack = (typeof body.stack === 'string' && PRESET_BY_ID.has(body.stack)) ? body.stack : inferStackFromUrl(baseUrlStr);
  const stackName = PRESET_BY_ID.get(stack)?.name || 'Local';
  let label = body.label;
  if (label !== undefined && label !== null && label !== '') {
    if (typeof label !== 'string' || label.trim().length > 120 || /[\x00-\x1f\x7f]/.test(label)) {
      throw fault('Label must be a short string without control characters.');
    }
    label = label.trim();
  } else {
    label = clampLabel(`${model} · ${stackName}`, 120);
  }
  const tier = body.tier === undefined || body.tier === '' ? 'local' : body.tier;
  if (typeof tier !== 'string' || !['local', 'standard', 'frontier'].includes(tier)) {
    throw fault('Tier must be local, standard, or frontier.');
  }
  let apiKey = null;
  if (body.apiKey !== undefined && body.apiKey !== null && body.apiKey !== '') {
    if (typeof body.apiKey !== 'string' || body.apiKey.length > 512 || /[\x00-\x1f\x7f]/.test(body.apiKey)) {
      throw fault('Optional local API key must be a valid single-line token.');
    }
    apiKey = body.apiKey.trim() || null;
  }
  const rawMaxOut = Number(body.maxOutputTokens);
  const maxOutputTokens = Number.isFinite(rawMaxOut) && rawMaxOut >= 512 && rawMaxOut <= 65536 ? Math.round(rawMaxOut) : 8192;
  const slug = model.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'model';
  const id = `local:${slug}`;
  return {
    id,
    model,
    baseUrl: baseUrlStr,
    label,
    tier,
    stack,
    maxOutputTokens,
    apiKey,
    createdAt: new Date().toISOString()
  };
}

function publicEntry(entry) {
  return {
    id: entry.id,
    model: entry.model,
    baseUrl: entry.baseUrl,
    label: entry.label,
    tier: entry.tier,
    stack: entry.stack || inferStackFromUrl(entry.baseUrl),
    maxOutputTokens: entry.maxOutputTokens || 8192,
    hasApiKey: Boolean(entry.apiKey),
    networkClass: isLoopbackUrl(entry.baseUrl) ? 'loopback' : isPrivateLanUrl(entry.baseUrl) ? 'lan' : 'remote',
    createdAt: entry.createdAt || null
  };
}

async function readCappedJson(response, maxBytes = MAX_PROBE_RESPONSE_BYTES) {
  if (response.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const buf = Buffer.isBuffer(value) ? value : Buffer.from(value);
        total += buf.byteLength;
        if (total > maxBytes) {
          await reader.cancel().catch(() => {});
          return null;
        }
        chunks.push(buf);
      }
      return JSON.parse(Buffer.concat(chunks, total).toString('utf8'));
    } catch {
      return null;
    }
  }
  // Fallback for test doubles implementing response.json() without ReadableStream body
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function probeEndpoint({ id, name, baseUrl, probeUrl, probeKind = 'openai', apiKey = null, timeoutMs = DEFAULT_DISCOVER_TIMEOUT_MS, fetchImpl = fetch }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = { accept: 'application/json' };
    if (apiKey) headers.authorization = `Bearer ${apiKey}`;
    const response = await fetchImpl(probeUrl, { method: 'GET', headers, redirect: 'error', signal: controller.signal });
    if (!response.ok) return { id, name, baseUrl, reachable: false, status: response.status, models: [] };
    const json = await readCappedJson(response, MAX_PROBE_RESPONSE_BYTES);
    if (!json || typeof json !== 'object') return { id, name, baseUrl, reachable: true, models: [] };

    const models = [];
    if (probeKind === 'ollama' && Array.isArray(json.models)) {
      for (const m of json.models) {
        const modelName = String(m?.name || m?.model || '').trim();
        if (!modelName) continue;
        models.push({
          stack: id,
          stackName: name,
          baseUrl,
          model: modelName,
          sizeBytes: Number.isFinite(Number(m.size)) ? Number(m.size) : null,
          family: m.details?.family || null,
          parameterSize: m.details?.parameter_size || null,
          quantization: m.details?.quantization_level || null,
        });
      }
    } else if (Array.isArray(json.data)) {
      for (const m of json.data) {
        const modelName = String(m?.id || '').trim();
        if (!modelName) continue;
        models.push({
          stack: id,
          stackName: name,
          baseUrl,
          model: modelName,
          sizeBytes: null,
          family: m.owned_by || null,
          parameterSize: null,
          quantization: null,
        });
      }
    } else if (Array.isArray(json.models)) {
      for (const m of json.models) {
        const modelName = String(typeof m === 'string' ? m : (m?.id || m?.name || '')).trim();
        if (!modelName) continue;
        models.push({ stack: id, stackName: name, baseUrl, model: modelName, sizeBytes: null, family: null, parameterSize: null, quantization: null });
      }
    }
    return { id, name, baseUrl, reachable: true, models };
  } catch {
    return { id, name, baseUrl, reachable: false, models: [] };
  } finally {
    clearTimeout(timer);
  }
}

async function readSavedFileSafe(filename) {
  let handle;
  try {
    const flags = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0);
    handle = await fs.open(filename, flags);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_SAVED_FILE_BYTES) return null;
    const raw = await handle.readFile({ encoding: 'utf8' });
    return JSON.parse(raw);
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => {});
  }
}

export async function createLocalProviderManager({ dataDir, providers, fetchImpl = fetch } = {}) {
  const filename = dataDir ? path.join(dataDir, 'local-providers.json') : null;
  const entries = new Map();
  let saveQueue = Promise.resolve();

  const buildProvider = (entry) => new HttpProvider({
    id: entry.id,
    label: entry.label,
    protocol: 'openai-chat',
    baseUrl: entry.baseUrl,
    model: entry.model,
    ...(entry.apiKey ? { credential: entry.apiKey } : { apiKeyEnv: undefined }),
    tier: entry.tier || 'local',
    allowPrivateHttp: true,
    timeoutMs: 180000,
    maxOutputTokens: entry.maxOutputTokens || 8192,
    maxOutputTokensCeiling: Math.max(32768, entry.maxOutputTokens || 8192),
  });

  const save = () => {
    if (!filename) return Promise.resolve();
    const run = async () => {
      await fs.mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
      const tmp = `${filename}.${randomUUID()}.tmp`;
      const payload = { version: 1, providers: [...entries.values()] };
      try {
        await fs.writeFile(tmp, JSON.stringify(payload, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
        await fs.rename(tmp, filename);
      } finally {
        await fs.rm(tmp, { force: true }).catch(() => {});
      }
    };
    const next = saveQueue.then(run, run);
    saveQueue = next.catch(() => {});
    return next;
  };

  // Restore persisted local providers on startup
  if (filename) {
    const raw = await readSavedFileSafe(filename);
    const saved = Array.isArray(raw?.providers) ? raw.providers : [];
    for (const item of saved.slice(0, MAX_LOCAL_MODELS)) {
      try {
        const entry = normalizeLocalInput(item);
        if (item.createdAt) entry.createdAt = item.createdAt;
        const provider = buildProvider(entry);
        entries.set(entry.id, entry);
        if (!providers.has(entry.id)) providers.set(entry.id, provider);
      } catch {}
    }
  }

  return {
    presets: LOCAL_STACK_PRESETS,

    secrets() {
      return [...entries.values()].map(e => e.apiKey).filter(Boolean);
    },

    list() {
      return {
        presets: LOCAL_STACK_PRESETS,
        registered: [...entries.values()].map(publicEntry),
      };
    },

    async register(input) {
      const entry = normalizeLocalInput(input);
      // Only carry over existing saved apiKey when updating the EXACT SAME baseUrl (prevents cross-origin token leak!)
      const existing = entries.get(entry.id);
      if (!entry.apiKey && input.keepExistingApiKey !== false && existing?.apiKey && existing.baseUrl === entry.baseUrl && input.apiKey === undefined) {
        entry.apiKey = existing.apiKey;
      }
      if (!entries.has(entry.id) && entries.size >= MAX_LOCAL_MODELS) {
        throw fault(`At most ${MAX_LOCAL_MODELS} local models can be saved.`);
      }
      // Instantiate new provider BEFORE closing the previous one so a rejected update never destroys an active provider.
      const provider = buildProvider(entry);
      const prev = providers.get(entry.id);
      providers.set(entry.id, provider);
      entries.set(entry.id, entry);
      if (prev && prev !== provider) prev.close?.();
      await save();
      return {
        id: entry.id,
        registered: [entry.id],
        entry: publicEntry(entry),
        provider: {
          id: provider.id,
          label: provider.label,
          kind: provider.kind,
          available: provider.available,
          tier: provider.tier,
        },
      };
    },

    async remove(id) {
      const key = String(id || '').trim();
      if (!key.startsWith('local:')) throw fault('Only local: providers can be removed here.');
      const existed = entries.delete(key) || providers.has(key);
      const prev = providers.get(key);
      if (prev) prev.close?.();
      providers.delete(key);
      if (!existed) throw fault('Local provider not found.', 404);
      await save();
      return { removed: key };
    },

    async discover({ customBaseUrl = '', customApiKey = '', timeoutMs = DEFAULT_DISCOVER_TIMEOUT_MS, privacy = null } = {}) {
      const cleanKey = typeof customApiKey === 'string' && !/[\x00-\x1f\x7f]/.test(customApiKey) ? customApiKey.trim().slice(0, 512) : '';
      const targets = LOCAL_STACK_PRESETS.map(p => ({
        id: p.id,
        name: p.name,
        baseUrl: p.baseUrl,
        probeUrl: p.probeUrl,
        probeKind: p.probeKind,
        apiKey: null,
      }));
      const rawCustom = String(customBaseUrl || '').trim();
      if (rawCustom) {
        const { parsed, href: cleanCustom, loopback, lan } = parseStrictEndpointUrl(rawCustom, { requireHttpsForRemote: true, label: 'custom scan URL' });
        if (privacy?.localOnly && !loopback && !lan) {
          throw fault('Local-Only Airgap Mode only allows scanning loopback or private LAN servers.', 403, 'PRIVACY_LOCAL_ONLY');
        }
        const matchedPreset = targets.find(t => t.baseUrl.replace(/\/$/, '') === cleanCustom || t.baseUrl.replace(/\/v1\/?$/, '') === cleanCustom);
        if (matchedPreset) {
          if (cleanKey) matchedPreset.apiKey = cleanKey;
        } else {
          const probeUrl = cleanCustom.endsWith('/v1') ? `${cleanCustom}/models` : `${cleanCustom}/v1/models`;
          targets.push({
            id: inferStackFromUrl(cleanCustom),
            name: `Custom (${parsed.host})`,
            baseUrl: cleanCustom.endsWith('/v1') ? cleanCustom : `${cleanCustom}/v1`,
            probeUrl,
            probeKind: 'openai',
            apiKey: cleanKey || null,
          });
        }
      }

      const results = await Promise.all(targets.map(t => probeEndpoint({ ...t, timeoutMs, fetchImpl })));
      const seen = new Set();
      const discovered = [];
      for (const r of results) {
        for (const m of r.models) {
          const key = `${m.baseUrl}::${m.model}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const slug = m.model.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'model';
          const candidateId = `local:${slug}`;
          discovered.push({
            ...m,
            candidateId,
            alreadyRegistered: entries.has(candidateId) || providers.has(candidateId),
          });
        }
      }
      return {
        stacks: results.map(({ id, name, baseUrl, reachable, models }) => ({ id, name, baseUrl, reachable, modelCount: models.length })),
        models: discovered,
      };
    },

    huggingfaceRecipes(rawRef) {
      return normalizeHuggingFaceRef(rawRef);
    },

    async pullOllamaModel({ model, baseUrl = 'http://127.0.0.1:11434', privacy = null, timeoutMs = DEFAULT_PULL_TIMEOUT_MS } = {}) {
      if (privacy?.localOnly) {
        throw fault('Cannot download models from the internet while Local-Only Airgap Mode is enabled.', 403, 'PRIVACY_LOCAL_ONLY');
      }
      const raw = String(model || '').trim();
      if (!raw || raw.length > 220 || /[\x00-\x1f\x7f\s]/.test(raw)) {
        throw fault('Provide a valid Ollama model or HuggingFace GGUF repo (e.g. hf.co/org/repo:Q4_K_M).');
      }
      let pullName = raw;
      const isExplicitHf = /^https?:\/\/(?:www\.)?(?:huggingface\.co|hf\.co)\//i.test(raw) || /^hf\.co\//i.test(raw);
      // Treat two-segment org/repo (without a registry host dot in segment 1) as a HuggingFace GGUF repo shorthand
      const looksLikeHfShort = !isExplicitHf && /^[a-zA-Z0-9][a-zA-Z0-9_-]*\/[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(raw) && raw.split('/').length === 2;
      if (isExplicitHf || looksLikeHfShort) {
        pullName = normalizeHuggingFaceRef(raw).ollamaTag;
      } else if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/.test(raw)) {
        throw fault('Invalid Ollama model name.');
      }

      const rawBase = String(baseUrl || 'http://127.0.0.1:11434').trim().replace(/\/v1\/?$/i, '');
      const { parsed } = parseStrictEndpointUrl(rawBase, { requireLoopback: true, label: 'Ollama baseUrl' });
      const cleanOrigin = `${parsed.protocol}//${parsed.host}`;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let data;
      try {
        const response = await fetchImpl(`${cleanOrigin}/api/pull`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: pullName, stream: false }),
          redirect: 'error',
          signal: controller.signal,
        });
        if (!response.ok) {
          const text = await response.text().catch(() => '');
          throw fault(`Ollama pull failed (HTTP ${response.status})${text ? `: ${text.slice(0, 180)}` : ''}. Is Ollama running?`, 502);
        }
        data = await readCappedJson(response, MAX_PROBE_RESPONSE_BYTES) || {};
      } finally {
        clearTimeout(timer);
      }
      if (data?.error) throw fault(`Ollama pull failed: ${String(data.error).slice(0, 180)}`, 502);

      // Automatically register the freshly pulled model in G0DC0D3
      const registered = await this.register({
        baseUrl: `${cleanOrigin}/v1`,
        model: pullName,
        label: clampLabel(`${pullName.replace(/^hf\.co\//i, '')} · Ollama`, 120),
        stack: 'ollama',
        tier: 'local',
      });
      return {
        pulled: pullName,
        status: data?.status || 'success',
        ...registered,
      };
    },
  };
}
