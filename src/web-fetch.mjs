import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import zlib from 'node:zlib';
import { DEFAULT_PRIVACY_SETTINGS, checkTargetScope } from './privacy.mjs';

const MAX_REDIRECTS = 3;
const MAX_RESPONSE_BYTES = 512 * 1024;
const DEFAULT_MAX_CHARS = 12000;
const HARD_MAX_CHARS = 24000;

function fault(code, message) {
  return Object.assign(new Error(message), { code });
}

function parseIpv6Groups(raw) {
  let s = String(raw || '').toLowerCase().replace(/^\[|\]$/g, '');
  const zoneIdx = s.indexOf('%');
  if (zoneIdx >= 0) s = s.slice(0, zoneIdx);
  if (!net.isIPv6(s)) return null;
  // Convert trailing IPv4 dotted quad into two 16-bit hex groups
  const lastColon = s.lastIndexOf(':');
  if (lastColon >= 0 && s.slice(lastColon + 1).includes('.')) {
    const v4 = s.slice(lastColon + 1);
    if (!net.isIPv4(v4)) return null;
    const [a, b, c, d] = v4.split('.').map(Number);
    s = `${s.slice(0, lastColon)}:${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = halves.length === 2 ? 8 - left.length - right.length : 0;
  if (missing < 0 || (halves.length === 1 && left.length !== 8)) return null;
  const full = [...left, ...Array(missing).fill('0'), ...right];
  if (full.length !== 8) return null;
  const groups = full.map(g => parseInt(g, 16));
  return groups.some(n => Number.isNaN(n) || n < 0 || n > 0xffff) ? null : groups;
}

function groupsToIpv4(hi, lo) {
  return `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`;
}

export function decodeMappedIpv4(ip) {
  const s = String(ip || '').toLowerCase().replace(/^\[|\]$/g, '');
  const groups = parseIpv6Groups(s);
  if (!groups) return null;
  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups;
  // ::ffff:0:0/96 (IPv4-mapped) or ::/96 (IPv4-compatible, excluding :: and ::1)
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && (g5 === 0xffff || (g5 === 0 && (g6 !== 0 || g7 > 1)))) {
    return groupsToIpv4(g6, g7);
  }
  // ::ffff:0:0:0/96 (RFC 2765 IPv4-translated)
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0xffff && g5 === 0) {
    return groupsToIpv4(g6, g7);
  }
  // 64:ff9b::/96 (NAT64 well-known)
  if (g0 === 0x0064 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) {
    return groupsToIpv4(g6, g7);
  }
  return null;
}

export function isPrivateIp(ip) {
  const raw = String(ip || '').toLowerCase().replace(/^\[|\]$/g, '');
  const mapped = decodeMappedIpv4(raw);
  const cleaned = mapped || raw;
  if (net.isIPv4(cleaned)) {
    const parts = cleaned.split('.').map(Number);
    if (parts.length !== 4 || parts.some(Number.isNaN)) return true;
    const [a, b, c] = parts;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a === 198 && (b === 18 || b === 19)) return true; // RFC 2544 benchmarking / VPN proxies
    if (a === 192 && b === 0 && (c === 0 || c === 2)) return true; // IETF protocol / TEST-NET-1
    if (a === 198 && b === 51 && c === 100) return true; // TEST-NET-2
    if (a === 203 && b === 0 && c === 113) return true; // TEST-NET-3
    if (a >= 224) return true; // Multicast / reserved
    return false;
  }
  const groups = parseIpv6Groups(raw);
  if (groups) {
    const [g0, g1, g2, g3, g4, g5, g6, g7] = groups;
    if (groups.every(g => g === 0)) return true; // ::
    if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0 && g6 === 0 && g7 === 1) return true; // ::1
    if (g0 === 0x0064 && g1 === 0xff9b) return true; // NAT64 well-known & local-use (64:ff9b::/96, 64:ff9b:1::/48)
    if (g0 === 0x0100 && g1 === 0 && g2 === 0 && g3 === 0) return true; // RFC 6666 discard-only 100::/64
    if (g0 === 0x2002) return true; // RFC 3056 6to4 (embeds arbitrary IPv4)
    if (g0 === 0x2001 && (g1 === 0x0db8 || g1 === 0x0000)) return true; // Documentation / Teredo
    if ((g0 & 0xfe00) === 0xfc00) return true; // ULA fc00::/7
    if ((g0 & 0xffc0) === 0xfe80) return true; // Link-local fe80::/10
    if ((g0 & 0xff00) === 0xff00) return true; // Multicast ff00::/8
    return false;
  }
  return true;
}

async function readBoundedResponseBuffer(res, maxBytes = MAX_RESPONSE_BYTES) {
  if (!res.body || typeof res.body[Symbol.asyncIterator] !== 'function') {
    const buf = Buffer.from(await res.arrayBuffer());
    return { buffer: buf.subarray(0, maxBytes), exceeded: buf.length > maxBytes };
  }
  const chunks = [];
  let total = 0;
  let exceeded = false;
  for await (const chunk of res.body) {
    const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    if (total + b.length > maxBytes) {
      const keep = maxBytes - total;
      if (keep > 0) chunks.push(b.subarray(0, keep));
      exceeded = true;
      try { await res.body.cancel?.(); } catch {}
      break;
    }
    chunks.push(b);
    total += b.length;
  }
  return { buffer: Buffer.concat(chunks), exceeded };
}

export async function validateSafePublicUrl(rawUrl, lookup = dns.lookup) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim() || rawUrl.length > 2048) {
    throw fault('INVALID_URL', 'Provide a valid HTTP(S) URL up to 2048 characters.');
  }
  let parsed;
  try { parsed = new URL(rawUrl.trim()); } catch {
    throw fault('INVALID_URL', 'Invalid URL format.');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw fault('INVALID_URL', 'Only http:// and https:// URLs are allowed.');
  }
  if (parsed.username || parsed.password) {
    throw fault('INVALID_URL', 'Embedded credentials in URLs are not allowed.');
  }
  const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
  const bareHost = host.replace(/^\[|\]$/g, '');
  if (!bareHost || bareHost === 'localhost' || bareHost.endsWith('.localhost') || bareHost.endsWith('.local') || bareHost.endsWith('.internal')) {
    throw fault('SSRF_BLOCKED', `Blocked private/local hostname: ${bareHost || 'empty'}`);
  }
  if (net.isIP(bareHost)) {
    if (isPrivateIp(bareHost)) throw fault('SSRF_BLOCKED', `Blocked private IP address: ${bareHost}`);
    Object.defineProperty(parsed, '_validatedAddress', { value: { address: bareHost, family: net.isIP(bareHost) }, enumerable: false });
    return parsed;
  }
  let records;
  try {
    records = await lookup(host, { all: true });
  } catch {
    throw fault('DNS_FAILED', `Could not resolve hostname: ${host}`);
  }
  if (!Array.isArray(records) || !records.length) {
    throw fault('DNS_FAILED', `No DNS records returned for ${host}`);
  }
  for (const rec of records) {
    if (isPrivateIp(rec.address)) {
      throw fault('SSRF_BLOCKED', `Blocked host ${host} resolving to private IP ${rec.address}.`);
    }
  }
  const validatedRecords = records.map(rec => ({ address: rec.address, family: rec.family || net.isIP(rec.address) || 4 }));
  Object.defineProperty(parsed, '_validatedAddresses', {
    value: validatedRecords,
    enumerable: false
  });
  Object.defineProperty(parsed, '_validatedAddress', {
    value: validatedRecords[0],
    enumerable: false
  });
  return parsed;
}

function stripPairedHtmlTag(input, tagName) {
  const lower = input.toLowerCase();
  const openNeedle = `<${tagName}`;
  const closeNeedle = `</${tagName}>`;
  let out = '';
  let pos = 0;
  while (pos < input.length) {
    const start = lower.indexOf(openNeedle, pos);
    if (start < 0) { out += input.slice(pos); break; }
    const nextChar = lower[start + openNeedle.length];
    if (nextChar && !/[\s>/]/.test(nextChar)) {
      out += input.slice(pos, start + openNeedle.length);
      pos = start + openNeedle.length;
      continue;
    }
    const openEnd = lower.indexOf('>', start + openNeedle.length);
    if (openEnd < 0) { out += input.slice(pos); break; }
    if (input[openEnd - 1] === '/') {
      out += input.slice(pos, start) + ' ';
      pos = openEnd + 1;
      continue;
    }
    const closeStart = lower.indexOf(closeNeedle, openEnd + 1);
    if (closeStart < 0) {
      out += input.slice(pos, start);
      break;
    }
    out += input.slice(pos, start) + ' ';
    pos = closeStart + closeNeedle.length;
  }
  return out;
}

function extractTitleLinear(raw) {
  const lower = raw.toLowerCase();
  let pos = 0;
  while (pos < raw.length) {
    const start = lower.indexOf('<title', pos);
    if (start < 0) return '';
    const nextChar = lower[start + 6];
    if (nextChar && !/[\s>]/.test(nextChar)) { pos = start + 6; continue; }
    const openEnd = lower.indexOf('>', start + 6);
    if (openEnd < 0) return '';
    const closeStart = lower.indexOf('</title>', openEnd + 1);
    if (closeStart < 0) return '';
    return raw.slice(openEnd + 1, closeStart).replace(/\s+/g, ' ').trim();
  }
  return '';
}

export function htmlToReadableText(html) {
  const raw = String(html || '');
  const title = extractTitleLinear(raw);
  let stripped = raw;
  for (const tag of ['script', 'style', 'noscript', 'svg', 'iframe', 'title']) {
    stripped = stripPairedHtmlTag(stripped, tag);
  }
  let text = stripped
    .replace(/<\/(?:p|div|li|tr|h[1-6]|section|article|blockquote|pre|br)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { title, text };
}

function pinnedHttpGet(targetUrl, { headers, signal, maxBytes = MAX_RESPONSE_BYTES }) {
  const pinnedList = targetUrl._validatedAddresses || (targetUrl._validatedAddress ? [targetUrl._validatedAddress] : null);
  const pinned = pinnedList?.[0] || null;
  const bareHost = targetUrl.hostname.replace(/^\[|\]$/g, '');
  const isIpHost = net.isIP(bareHost) !== 0;
  return new Promise((resolve, reject) => {
    const mod = targetUrl.protocol === 'https:' ? https : http;
    const req = mod.request({
      protocol: targetUrl.protocol,
      hostname: bareHost,
      port: targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80),
      path: `${targetUrl.pathname}${targetUrl.search}`,
      method: 'GET',
      headers,
      signal,
      ...(targetUrl.protocol === 'https:' && !isIpHost ? { servername: bareHost } : {}),
      ...(pinned ? {
        lookup(_host, opts, cb) {
          if (typeof opts === 'function') { opts(null, pinned.address, pinned.family); return; }
          if (opts?.all) { cb(null, pinnedList.map(r => ({ address: r.address, family: r.family }))); return; }
          cb(null, pinned.address, pinned.family);
        }
      } : {})
    }, res => {
      const status = res.statusCode || 0;
      const respHeaders = new Headers();
      for (const [k, v] of Object.entries(res.headers || {})) {
        if (Array.isArray(v)) { for (const item of v) respHeaders.append(k, item); }
        else if (typeof v === 'string') respHeaders.set(k, v);
      }
      if ([301, 302, 303, 307, 308].includes(status)) {
        res.destroy();
        resolve({ status, headers: respHeaders, buffer: Buffer.alloc(0), exceeded: false });
        return;
      }
      const chunks = [];
      let total = 0;
      let exceeded = false;
      res.on('data', chunk => {
        const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        if (total + b.length > maxBytes) {
          const keep = maxBytes - total;
          if (keep > 0) chunks.push(b.subarray(0, keep));
          exceeded = true;
          res.destroy();
          resolve({ status, headers: respHeaders, buffer: Buffer.concat(chunks), exceeded: true });
          return;
        }
        chunks.push(b);
        total += b.length;
      });
      res.on('end', () => resolve({ status, headers: respHeaders, buffer: Buffer.concat(chunks), exceeded }));
      res.on('error', err => {
        if (exceeded) resolve({ status, headers: respHeaders, buffer: Buffer.concat(chunks), exceeded: true });
        else reject(err);
      });
    });
    req.on('error', reject);
    req.end();
  });
}

export async function safeWebFetch({ url, maxChars = DEFAULT_MAX_CHARS } = {}, { privacy = DEFAULT_PRIVACY_SETTINGS, onOutbound, signal, fetchImpl = fetch, lookup = dns.lookup } = {}) {
  const boundedMax = Math.max(256, Math.min(HARD_MAX_CHARS, Number(maxChars) || DEFAULT_MAX_CHARS));
  if (privacy?.localOnly) {
    onOutbound?.({ providerId: 'web.fetch', host: String(url || '').slice(0, 120), protocol: 'http', zdrClass: 'web-fetch', zdrFlags: [], secretsRedacted: 0, blocked: true, reason: 'Blocked by Local-Only privacy mode.' });
    throw fault('PRIVACY_LOCAL_ONLY', 'Local-only inference is enabled; outbound web.fetch is blocked.');
  }
  let currentUrl = await validateSafePublicUrl(url, lookup);
  const timeout = AbortSignal.timeout(15000);
  const combinedSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const reqHeaders = { 'user-agent': 'G0DC0D3/0.2 (research-harness)', 'accept': 'text/markdown, text/plain, text/html, application/json;q=0.9' };

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const scopeCheck = checkTargetScope(currentUrl.href, privacy);
    if (!scopeCheck.allowed) {
      onOutbound?.({ providerId: 'web.fetch', host: currentUrl.hostname, protocol: currentUrl.protocol.replace(':', ''), zdrClass: 'web-fetch', zdrFlags: ['scope-guard'], secretsRedacted: 0, blocked: true, reason: scopeCheck.message });
      throw fault(scopeCheck.code, scopeCheck.message);
    }
    onOutbound?.({ providerId: 'web.fetch', host: currentUrl.hostname, protocol: currentUrl.protocol.replace(':', ''), zdrClass: 'web-fetch', zdrFlags: ['ssrf-checked', 'dns-pinned'], secretsRedacted: 0, blocked: false });
    let status, respHeaders, buf, exceeded;
    if (fetchImpl === fetch && currentUrl._validatedAddress) {
      ({ status, headers: respHeaders, buffer: buf, exceeded } = await pinnedHttpGet(currentUrl, { headers: reqHeaders, signal: combinedSignal }));
    } else {
      const res = await fetchImpl(currentUrl.href, {
        method: 'GET',
        redirect: 'manual',
        signal: combinedSignal,
        headers: reqHeaders
      });
      status = res.status;
      respHeaders = res.headers;
      if ([301, 302, 303, 307, 308].includes(status)) {
        try { await res.body?.cancel?.(); } catch {}
        buf = Buffer.alloc(0);
        exceeded = false;
      } else {
        ({ buffer: buf, exceeded } = await readBoundedResponseBuffer(res, MAX_RESPONSE_BYTES));
      }
    }
    if ([301, 302, 303, 307, 308].includes(status)) {
      const location = respHeaders.get('location');
      if (!location || hop === MAX_REDIRECTS) throw fault('TOO_MANY_REDIRECTS', 'Redirect limit exceeded.');
      currentUrl = await validateSafePublicUrl(new URL(location, currentUrl).href, lookup);
      continue;
    }
    const contentType = String(respHeaders.get('content-type') || 'text/plain').toLowerCase();
    const sliced = buf.toString('utf8');
    let title = '';
    let content = sliced;
    if (contentType.includes('text/html') || /^\s*<!doctype html|^\s*<html/i.test(sliced)) {
      const parsed = htmlToReadableText(sliced);
      title = parsed.title;
      content = parsed.text;
    }
    const truncated = content.length > boundedMax || exceeded;
    return {
      ok: true,
      url: currentUrl.href,
      status,
      contentType: contentType.split(';')[0].trim(),
      ...(title ? { title: title.slice(0, 200) } : {}),
      content: content.slice(0, boundedMax),
      truncated
    };
  }
  throw fault('TOO_MANY_REDIRECTS', 'Redirect limit exceeded.');
}

function decodeHtmlEntities(str) {
  return String(str || '')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&#x27;/gi, "'")
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number(n);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
    });
}

function unwrapSearchHref(rawHref) {
  const cleaned = decodeHtmlEntities(rawHref).trim();
  try {
    const u = new URL(cleaned.startsWith('//') ? 'https:' + cleaned : cleaned, 'https://html.duckduckgo.com');
    const uddg = u.searchParams.get('uddg');
    if (uddg && /^https?:\/\//i.test(uddg)) return uddg;
    if (/^https?:\/\//i.test(u.href) && !u.hostname.endsWith('duckduckgo.com')) return u.href;
  } catch {}
  return /^https?:\/\//i.test(cleaned) ? cleaned : '';
}

export function parseDuckDuckGoHtml(html, limit = 6) {
  const results = [];
  const raw = String(html || '');
  const blocks = raw.split(/class="result\b[^"]*"/i).slice(1);
  for (const block of blocks) {
    if (results.length >= limit) break;
    const linkMatch = /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(block)
      || /href="([^"]+)"[^>]*class="result__a"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
    if (!linkMatch) continue;
    const url = unwrapSearchHref(linkMatch[1]);
    const title = decodeHtmlEntities(linkMatch[2].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    if (!url || !title) continue;
    const snipMatch = /class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|div|span)>/i.exec(block);
    const snippet = snipMatch
      ? decodeHtmlEntities(snipMatch[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim().slice(0, 420)
      : '';
    results.push({ title: title.slice(0, 200), url: url.slice(0, 1024), snippet });
  }
  return results;
}

export async function safeWebSearch({ query, limit = 6 } = {}, { privacy = DEFAULT_PRIVACY_SETTINGS, onOutbound, signal, fetchImpl = fetch } = {}) {
  const q = String(query || '').trim();
  if (!q || q.length > 300) throw fault('INVALID_QUERY', 'Provide a search query between 1 and 300 characters.');
  const maxResults = Math.max(1, Math.min(10, Number(limit) || 6));
  if (privacy?.localOnly) {
    onOutbound?.({ providerId: 'web.search', host: 'html.duckduckgo.com', protocol: 'https', zdrClass: 'web-search', zdrFlags: [], secretsRedacted: 0, blocked: true, reason: 'Blocked by Local-Only privacy mode.' });
    throw fault('PRIVACY_LOCAL_ONLY', 'Local-only inference is enabled; outbound web.search is blocked.');
  }
  const endpoint = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`;
  const timeout = AbortSignal.timeout(15000);
  const combinedSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  onOutbound?.({ providerId: 'web.search', host: 'html.duckduckgo.com', protocol: 'https', zdrClass: 'web-search', zdrFlags: ['zero-tracking-search'], secretsRedacted: 0, blocked: false });
  const res = await fetchImpl(endpoint, {
    method: 'GET',
    signal: combinedSignal,
    headers: { 'user-agent': 'G0DC0D3/0.2 (research-harness)', 'accept': 'text/html' }
  });
  if (!res.ok) { try { await res.body?.cancel?.(); } catch {} throw fault('SEARCH_FAILED', `Web search returned HTTP ${res.status}.`); }
  const { buffer: htmlBuf } = await readBoundedResponseBuffer(res, MAX_RESPONSE_BYTES);
  const html = htmlBuf.toString('utf8');
  const results = parseDuckDuckGoHtml(html, maxResults);
  return { ok: true, query: q, results };
}

function unescapePdfLiteral(str) {
  return str
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\\\\/g, '\\')
    .replace(/\\([0-7]{1,3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)));
}

function extractTextOps(chunk) {
  const out = [];
  let m;
  const re = /\(((?:\\.|[^\\()])*)\)\s*Tj|\[((?:[^\[\]()]|\((?:\\.|[^\\()])*\))*)\]\s*TJ/g;
  while ((m = re.exec(chunk)) !== null) {
    if (m[1] !== undefined) {
      out.push(unescapePdfLiteral(m[1]));
    } else if (m[2] !== undefined) {
      let part = '';
      const sub = /\(((?:\\.|[^\\()])*)\)|(-?\d+(?:\.\d+)?)/g;
      let sm;
      while ((sm = sub.exec(m[2])) !== null) {
        if (sm[1] !== undefined) part += unescapePdfLiteral(sm[1]);
        else if (Number(sm[2]) < -120) part += ' ';
      }
      if (part) out.push(part);
    }
  }
  return out.join(' ');
}

export function extractPdfText(buffer, maxChars = 48000) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || '');
  if (buf.length < 8 || !buf.subarray(0, 8).toString('latin1').includes('%PDF')) {
    throw fault('INVALID_PDF', 'File does not look like a valid PDF.');
  }
  const latin = buf.toString('latin1');
  const pieces = [];
  let pages = (latin.match(/\/Type\s*\/Page\b/g) || []).length || 1;

  // Extract from compressed FlateDecode streams as well as uncompressed content streams (bounded against zip bombs)
  const MAX_DECOMPRESSED_STREAM = 2 * 1024 * 1024;
  const MAX_TOTAL_DECOMPRESSED = 8 * 1024 * 1024;
  let totalDecompressed = 0;
  let streamCount = 0;
  let pos = 0;
  while (pos < latin.length && streamCount < 200 && totalDecompressed < MAX_TOTAL_DECOMPRESSED) {
    const start = latin.indexOf('stream', pos);
    if (start < 0) break;
    let bodyStart = start + 6;
    if (latin[bodyStart] === '\r' && latin[bodyStart + 1] === '\n') bodyStart += 2;
    else if (latin[bodyStart] === '\n') bodyStart += 1;
    else { pos = bodyStart; continue; }
    const end = latin.indexOf('endstream', bodyStart);
    if (end < 0) break;
    let bodyEnd = end;
    if (bodyEnd > bodyStart && latin[bodyEnd - 1] === '\n') bodyEnd -= 1;
    if (bodyEnd > bodyStart && latin[bodyEnd - 1] === '\r') bodyEnd -= 1;
    pos = end + 9;
    streamCount += 1;
    const rawSlice = latin.slice(bodyStart, bodyEnd);
    const rawStream = Buffer.from(rawSlice, 'latin1');
    let decoded = null;
    try {
      const inflated = zlib.inflateSync(rawStream, { maxOutputLength: MAX_DECOMPRESSED_STREAM });
      totalDecompressed += inflated.length;
      decoded = inflated.toString('latin1');
    } catch (err) {
      if (err?.code === 'ERR_BUFFER_TOO_LARGE') {
        totalDecompressed += MAX_DECOMPRESSED_STREAM;
      } else {
        try {
          const inflated = zlib.inflateRawSync(rawStream, { maxOutputLength: MAX_DECOMPRESSED_STREAM });
          totalDecompressed += inflated.length;
          decoded = inflated.toString('latin1');
        } catch (err2) {
          if (err2?.code === 'ERR_BUFFER_TOO_LARGE') totalDecompressed += MAX_DECOMPRESSED_STREAM;
          else decoded = rawSlice.length <= MAX_DECOMPRESSED_STREAM ? rawSlice : null;
        }
      }
    }
    if (decoded && (decoded.includes('Tj') || decoded.includes('TJ'))) {
      const txt = extractTextOps(decoded).replace(/[^\x09\x0a\x0d\x20-\x7e\u00a0-\u024f]/g, ' ').replace(/[ \t]+/g, ' ').trim();
      if (txt) pieces.push(txt);
    }
    if (pieces.join('\n').length > maxChars * 1.5) break;
  }

  let text = pieces.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
  const truncated = text.length > maxChars;
  if (truncated) text = text.slice(0, maxChars);
  return { ok: true, pages, text, truncated };
}
