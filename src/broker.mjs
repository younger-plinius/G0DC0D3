import { regexSearch } from './regex-search.mjs';
import { TOOLS, validateTool } from './tool-schema.mjs';
import { runCommand, validateExecution, validateChecks } from './runner.mjs';
import { gitDiff, gitLog, gitCommit, hasGit } from './git.mjs';
import { MemoryStore } from './memory.mjs';
import { safeWebFetch, safeWebSearch } from './web-fetch.mjs';
import { BrowserPool } from './browser-env.mjs';
export { TOOLS } from './tool-schema.mjs';
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs, constants } from 'node:fs';
import path from 'node:path';

export const sha256 = value => createHash('sha256').update(value).digest('hex');
function decodeText(bytes) {
  if (bytes.includes(0)) return null;
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { return null; }
}
const excluded = new Set(['.git', '.g0dc0d3', 'node_modules']);
const error = (code, message) => Object.assign(new Error(message), { code });
const activeStates = new Set(['running', 'recovering', 'verifying']);
export const READ_ONLY_TOOLS = new Set(['repo.list', 'repo.read', 'repo.search', 'repo.glob', 'git.diff', 'git.log', 'task.history', 'memory.search', 'web.fetch', 'web.search', 'browser.snapshot', 'browser.screenshot']);
export const PLAN_MODE_TOOLS = new Set([...READ_ONLY_TOOLS, 'task.todo', 'agent.spawn', 'browser.open', 'browser.close']);
const challengerTools = new Set(['repo.list', 'repo.read', 'repo.search', 'repo.glob', 'task.history']);
const mutatingFileOps = new Set(['repo.write', 'repo.patch', 'repo.delete', 'repo.move']);
export const conversationWithoutChecks = task => task?.workspaceKind === 'conversation' && !task.fixtureId && !task.sourcePath && !task.checks?.length;
export const taskTools = task => task?.crewMember?.role === 'challenger' ? TOOLS.filter(tool => challengerTools.has(tool.name))
  : task?.planMode === true ? TOOLS.filter(tool => PLAN_MODE_TOOLS.has(tool.name))
    : conversationWithoutChecks(task) ? TOOLS.filter(tool => tool.name !== 'check.run') : TOOLS;

function escapeRegexLiteral(ch) {
  return /[.+^$()|[\]\\]/.test(ch) ? '\\' + ch : ch;
}

export function compileGlob(pattern) {
  if (typeof pattern !== 'string' || !pattern.length || pattern.length > 200 || pattern.includes('\0') || pattern.includes('\\') || pattern.startsWith('/')) {
    throw error('INVALID_TOOL', 'Glob pattern must be a bounded repository-relative pattern without backslashes or NUL bytes.');
  }
  if (pattern.split('/').some(segment => segment === '..')) {
    throw error('INVALID_TOOL', 'Glob pattern cannot contain parent directory traversal.');
  }
  const normalized = pattern.replace(/(?:\*\*\/)+/g, '**/').replace(/\*{3,}/g, '**');
  let wildcardCount = 0;
  const convertSegment = (segment, allowBraces) => {
    let re = '';
    for (let i = 0; i < segment.length; i++) {
      const ch = segment[i];
      if (segment.slice(i, i + 3) === '**/') {
        if (++wildcardCount > 12) throw error('INVALID_TOOL', 'Glob pattern contains too many wildcard segments.');
        re += '(?:.+/)?'; i += 2; continue;
      }
      if (segment.slice(i, i + 2) === '**') {
        if (++wildcardCount > 12) throw error('INVALID_TOOL', 'Glob pattern contains too many wildcard segments.');
        re += '.*'; i += 1; continue;
      }
      if (ch === '*') {
        if (++wildcardCount > 12) throw error('INVALID_TOOL', 'Glob pattern contains too many wildcard segments.');
        re += '[^/]*'; continue;
      }
      if (ch === '?') { re += '[^/]'; continue; }
      if (ch === '{') {
        if (!allowBraces) throw error('INVALID_TOOL', 'Nested brace expressions are not supported in glob patterns.');
        const close = segment.indexOf('}', i + 1);
        if (close < 0) throw error('INVALID_TOOL', 'Unclosed brace expression in glob pattern.');
        const inner = segment.slice(i + 1, close);
        if (inner.includes('{')) throw error('INVALID_TOOL', 'Nested brace expressions are not supported in glob patterns.');
        const parts = inner.split(',');
        if (parts.length > 20 || parts.some(part => !part.length)) throw error('INVALID_TOOL', 'Brace expression must contain 1–20 non-empty alternatives.');
        re += `(?:${parts.map(part => convertSegment(part, false)).join('|')})`;
        i = close;
        continue;
      }
      if (ch === '}') throw error('INVALID_TOOL', 'Unmatched closing brace in glob pattern.');
      re += escapeRegexLiteral(ch);
    }
    return re;
  };
  const regex = new RegExp(`^${convertSegment(normalized, true)}$`);
  return candidate => regex.test(candidate);
}

async function globWorkspace(workspace, matcher, { limit = 200, maxFileBytes = 256 * 1024, expectedRoot } = {}) {
  const root = await fs.realpath(workspace);
  if (expectedRoot && root !== path.resolve(expectedRoot)) throw error('WORKSPACE_CHANGED', 'Canonical task workspace was replaced or redirected.');
  const files = [];
  let truncated = false;
  const visit = async relative => {
    if (truncated) return;
    const directory = path.join(root, relative);
    if (await fs.realpath(directory) !== directory) throw error('SNAPSHOT_CHANGED', 'A workspace directory was redirected.');
    const entries = (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'));
    for (const entry of entries) {
      if (truncated) break;
      const lowerName = entry.name.toLowerCase();
      if (excluded.has(lowerName) || lowerName.startsWith('.g0d-write-')) continue;
      if (entry.isSymbolicLink()) continue;
      const name = relative ? relative + '/' + entry.name : entry.name;
      if (entry.isDirectory()) { await visit(name); continue; }
      if (!entry.isFile()) continue;
      if (!matcher(name)) continue;
      if (files.length >= limit) { truncated = true; break; }
      const filename = path.join(root, name);
      if (await fs.realpath(filename) !== filename) throw error('SNAPSHOT_CHANGED', 'A workspace file was redirected.');
      const inspected = await fs.lstat(filename);
      const data = await readBoundedFile(filename, maxFileBytes, 'READ_LIMIT', { expectedIdentity: inspected });
      files.push({ path: name, sha256: sha256(data), bytes: data.length });
    }
  };
  await visit('');
  return { files, truncated };
}

async function checkSyntaxDiagnostics(filePath, target, content) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.json') {
    try { JSON.parse(content); return null; }
    catch (cause) {
      const msg = String(cause?.message || 'Invalid JSON').slice(0, 400);
      let line = null;
      const lineMatch = msg.match(/line\s+(\d+)/i);
      if (lineMatch) line = Math.max(1, Number(lineMatch[1]));
      else {
        const posMatch = msg.match(/position\s+(\d+)/i);
        if (posMatch) {
          const pos = Number(posMatch[1]);
          if (Number.isFinite(pos) && pos >= 0) line = content.slice(0, pos).split('\n').length;
        }
      }
      return [{ line, message: msg }];
    }
  }
  if (!['.js', '.mjs', '.cjs'].includes(ext)) return null;
  return new Promise(resolve => {
    execFile(process.execPath, ['--check', target], { timeout: 2000, maxBuffer: 16384 }, (err, _stdout, stderr) => {
      if (!err || err.killed || err.signal) return resolve(null);
      const text = String(stderr || err.message || '').trim();
      if (!text) return resolve([{ line: null, message: 'Syntax error detected by node --check.' }]);
      const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
      let line = null;
      const firstLineMatch = lines[0]?.match(/:(\d+)(?::\d+)?$/);
      if (firstLineMatch) line = Math.max(1, Number(firstLineMatch[1]));
      const syntaxLine = lines.find(l => /SyntaxError|Error:/i.test(l)) || lines.at(-1) || text;
      resolve([{ line, message: syntaxLine.slice(0, 400) }]);
    });
  });
}
export async function readBoundedFile(target, maxBytes = 256 * 1024, limitCode = 'READ_LIMIT', { expectedIdentity } = {}) {
  let handle;
  try { handle = await fs.open(target, constants.O_RDONLY | (constants.O_NOFOLLOW || 0)); }
  catch (cause) { if (cause.code === 'ELOOP') throw error('SYMLINK_DENIED', 'Symbolic links are not supported by scoped tools.'); throw cause; }
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw error('PATH_DENIED', 'Only regular files are supported.');
    if (expectedIdentity && (stat.dev !== expectedIdentity.dev || stat.ino !== expectedIdentity.ino || (expectedIdentity.size !== undefined && stat.size !== expectedIdentity.size) || (expectedIdentity.mtimeMs !== undefined && stat.mtimeMs !== expectedIdentity.mtimeMs))) throw error('FILE_CHANGED_DURING_READ', 'Opened file does not match the previously inspected inode.');
    if (stat.size > maxBytes) throw error(limitCode, `File exceeds the ${maxBytes}-byte limit.`);
    const buffer = Buffer.alloc(Math.min(stat.size, maxBytes) + 1);
    let read = 0;
    while (read < buffer.length) {
      const result = await handle.read(buffer, read, buffer.length - read, read);
      if (!result.bytesRead) break;
      read += result.bytesRead;
    }
    if (read > maxBytes) throw error(limitCode, `File exceeds the ${maxBytes}-byte limit.`);
    const after = await handle.stat();
    if (after.size !== read || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) throw error('FILE_CHANGED_DURING_READ', 'File changed during capture; retry from a fresh snapshot.');
    return buffer.subarray(0, read);
  } finally { await handle.close(); }
}
export const stableJson = value => {
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stableJson(value[key])).join(',') + '}';
  return JSON.stringify(value);
};

export function bindVerification(result, before, after) {
  if (!result || !['pass', 'fail', 'unknown'].includes(result.status) || !Array.isArray(result.checks) || result.checks.length === 0) return { status: 'unknown', snapshotHash: after.snapshotHash, checks: [{ name: 'evaluator contract', status: 'unknown', detail: 'Invalid or empty evaluation result.' }] };
  if (result.status === 'pass' && (before.snapshotHash !== after.snapshotHash || result.snapshotHash !== after.snapshotHash || result.checks.some(check => check.status !== 'pass'))) return { ...result, status: 'unknown', checks: [...result.checks, { name: 'snapshot binding', status: 'unknown', detail: 'Checks did not certify the unchanged current snapshot.' }] };
  return result;
}

/** Owner checks each receive the owner command cap, plus bounded setup/drain
 * overhead per command and final snapshot time. Fixture probes keep their 10s cap.
 */
export function evaluationTimeoutMs(task) {
  if (!task.checks?.length) return 10000;
  const checks = validateChecks(task.checks), execution = validateExecution(task.execution);
  return 2000 + checks.length * (execution.timeoutMs + 5000);
}

/** Bound controller waiting even when an evaluator fails to honor cancellation. */
export async function evaluateBounded(evaluator, task, { signal, timeoutMs = evaluationTimeoutMs(task) } = {}) {
  if (signal?.aborted) throw error('EVALUATION_CANCELLED', 'Evaluation cancelled.');
  const controller = new AbortController();
  let timer, abort;
  const stopped = new Promise((_, reject) => {
    abort = () => { controller.abort(signal?.reason); reject(error('EVALUATION_CANCELLED', 'Evaluation cancelled.')); };
    signal?.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => { controller.abort(); reject(error('EVALUATION_TIMEOUT', `Evaluation exceeded ${timeoutMs} ms.`)); }, timeoutMs);
  });
  try { return await Promise.race([Promise.resolve().then(() => evaluator(task, { signal: controller.signal, timeoutMs })), stopped]); }
  finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}

export async function scopedPath(workspace, relative, { writing = false, withStat = false } = {}) {
  if (typeof relative !== 'string' || !relative || relative.includes('\0') || path.isAbsolute(relative) || relative.includes('\\')) throw error('PATH_DENIED', 'Use a nonempty repository-relative path.');
  const components = relative.split('/');
  if (components.some(part => {
    const lower = part.toLowerCase();
    return !part || part === '.' || part === '..' || excluded.has(lower) || lower.startsWith('.g0d-write-');
  })) throw error('PATH_DENIED', 'Path contains a protected or traversal component.');
  const root = await fs.realpath(workspace);
  if (path.resolve(workspace) !== root) throw error('WORKSPACE_CHANGED', 'Canonical task workspace was replaced or redirected.');
  let current = root;
  let finalStat;
  for (let i = 0; i < components.length; i++) {
    current = path.join(current, components[i]);
    try {
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink()) throw error('SYMLINK_DENIED', 'Symbolic links are not supported by scoped tools.');
      if (i < components.length - 1 && !stat.isDirectory()) throw error('PATH_DENIED', 'A parent path is not a directory.');
      if (i === components.length - 1 && !stat.isFile()) throw error('PATH_DENIED', 'Target must be a regular file.');
      if (i === components.length - 1) finalStat = stat;
    } catch (cause) {
      if (cause.code !== 'ENOENT') throw cause;
      if (!writing && i < components.length - 1) throw cause;
    }
  }
  if (!current.startsWith(root + path.sep)) throw error('PATH_DENIED', 'Path escapes workspace.');
  return withStat ? { target: current, stat: finalStat } : current;
}

export async function snapshotWorkspace(workspace, limits = {}) {
  const { maxFiles = 200, maxFileBytes = 256 * 1024, maxTotalBytes = 2 * 1024 * 1024, expectedRoot } = limits;
  const root = await fs.realpath(workspace);
  if (expectedRoot && root !== path.resolve(expectedRoot)) throw error('WORKSPACE_CHANGED', 'Canonical task workspace was replaced or redirected.');
  const files = [];
  let totalBytes = 0;
  const visit = async relative => {
    const directory = path.join(root, relative);
    if (await fs.realpath(directory) !== directory) throw error('SNAPSHOT_CHANGED', 'A snapshot directory was redirected.');
    const entries = (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'));
    if (await fs.realpath(directory) !== directory) throw error('SNAPSHOT_CHANGED', 'A snapshot directory changed during enumeration.');
    for (const entry of entries) {
      const lowerName = entry.name.toLowerCase();
      if (excluded.has(lowerName) || lowerName.startsWith('.g0d-write-')) continue;
      const name = relative ? relative + '/' + entry.name : entry.name;
      if (entry.isSymbolicLink()) throw error('SNAPSHOT_UNSUPPORTED', `Cannot certify symbolic link: ${name}`);
      if (entry.isDirectory()) { await visit(name); continue; }
      if (!entry.isFile()) throw error('SNAPSHOT_UNSUPPORTED', `Cannot certify special file: ${name}`);
      const filename = path.join(root, name);
      if (await fs.realpath(filename) !== filename) throw error('SNAPSHOT_CHANGED', 'A snapshot file was redirected.');
      const inspected = await fs.lstat(filename);
      const content = await readBoundedFile(filename, maxFileBytes, 'SNAPSHOT_LIMIT', { expectedIdentity: inspected });
      if (await fs.realpath(filename) !== filename) throw error('SNAPSHOT_CHANGED', 'A snapshot file changed during capture.');
      totalBytes += content.length;
      if (content.length > maxFileBytes || totalBytes > maxTotalBytes || files.length >= maxFiles) throw error('SNAPSHOT_LIMIT', 'Project exceeds this MVP snapshot limit.');
      files.push({ path: name, content: decodeText(content), sha256: sha256(content), bytes: content.length });
    }
  };
  await visit('');
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return { snapshotHash: sha256(JSON.stringify(files.map(({ path, sha256 }) => [path, sha256]))), files, totalBytes };
}

export class Broker {
  constructor({ store, evaluator, faultInjector, memory, browser }) { this.store = store; this.evaluator = evaluator; this.faultInjector = faultInjector; this.memory = memory || new MemoryStore(store); this.browser = browser || new BrowserPool(); this.locks = new Map(); }
  async close() { await this.browser.closeAll(); }
  assertCurrent(taskId, epoch, signal) {
    const task = this.store.requireTask(taskId);
    if (signal?.aborted || task.epoch !== epoch || !activeStates.has(task.status)) throw error('STALE_RUN', 'Run no longer owns tool dispatch.');
    if (task.crewMember) {
      const crew = this.store.getCrew(task.crewMember.runId);
      const parent = this.store.getTask(task.crewMember.parentId);
      if (!crew || crew.parentId !== task.crewMember.parentId || crew.members?.[task.crewMember.role] !== task.id || !parent || parent.epoch !== crew.parentEpoch
        || !['running', 'verifying'].includes(crew.status) || !Number.isFinite(crew.deadlineAt) || Date.now() >= crew.deadlineAt)
        throw error('STALE_RUN', 'Crew no longer owns tool dispatch.');
    }
    return task;
  }
  async execute(taskId, call, options = {}) {
    const previous = this.locks.get(taskId) || Promise.resolve();
    const execution = previous.catch(() => {}).then(() => this._execute(taskId, call, options));
    this.locks.set(taskId, execution);
    try { return await execution; } finally { if (this.locks.get(taskId) === execution) this.locks.delete(taskId); }
  }
  async executeReadBatch(taskId, calls, options = {}) {
    const previous = this.locks.get(taskId) || Promise.resolve();
    const execution = previous.catch(() => {}).then(() => this._executeReadBatch(taskId, calls, options));
    this.locks.set(taskId, execution);
    try { return await execution; } finally { if (this.locks.get(taskId) === execution) this.locks.delete(taskId); }
  }
  async _runReadOnly(task, taskId, call, { signal, outbound } = {}) {
    if (call.name === 'repo.list') {
      const snapshot = await snapshotWorkspace(task.workspace, { expectedRoot: task.workspace });
      return { ok: true, files: snapshot.files.map(({ path, sha256, bytes }) => ({ path, sha256, bytes })) };
    }
    if (call.name === 'repo.read') {
      const inspected = await scopedPath(task.workspace, call.args.path, { withStat: true });
      const data = await readBoundedFile(inspected.target, 256 * 1024, 'READ_LIMIT', { expectedIdentity: inspected.stat });
      const text = decodeText(data);
      if (text === null) throw error('READ_LIMIT', 'Only valid UTF-8 files without NUL bytes and up to 256 KiB are supported.');
      const lineMode = call.args.startLine !== undefined || call.args.endLine !== undefined;
      if (lineMode) {
        if (call.args.startLine !== undefined && call.args.endLine !== undefined && call.args.endLine < call.args.startLine) {
          throw error('INVALID_TOOL', 'endLine must be greater than or equal to startLine.');
        }
        const lineStarts = [0];
        for (let i = 0; i < text.length; i++) if (text[i] === '\n') lineStarts.push(i + 1);
        const totalLines = text.length === 0 ? 0 : (text.endsWith('\n') ? lineStarts.length - 1 : lineStarts.length);
        const startLine = call.args.startLine ?? 1;
        const maxEndLine = startLine + 499;
        const requestedEnd = call.args.endLine !== undefined ? Math.min(call.args.endLine, maxEndLine) : maxEndLine;
        if (totalLines === 0 || startLine > totalLines) {
          return {
            ok: true, path: call.args.path, content: '', sha256: sha256(data),
            offset: text.length, totalChars: text.length, nextOffset: null,
            truncated: startLine > 1 && text.length > 0,
            startLine, endLine: totalLines === 0 ? 0 : Math.min(requestedEnd, totalLines), totalLines
          };
        }
        const endLine = Math.min(requestedEnd, totalLines);
        const startChar = lineStarts[startLine - 1];
        const endCharRaw = endLine < totalLines ? lineStarts[endLine] : text.length;
        const maxChars = call.args.limit || 65536;
        const endChar = Math.min(endCharRaw, startChar + maxChars);
        let actualEndLine = endLine;
        if (endChar < endCharRaw) {
          actualEndLine = startLine;
          while (actualEndLine < endLine && lineStarts[actualEndLine] < endChar) actualEndLine += 1;
        }
        return {
          ok: true, path: call.args.path, content: text.slice(startChar, endChar), sha256: sha256(data),
          offset: startChar, totalChars: text.length, nextOffset: endChar < text.length ? endChar : null,
          truncated: startChar > 0 || endChar < text.length,
          startLine, endLine: actualEndLine, totalLines
        };
      }
      const offset = call.args.offset || 0, limit = call.args.limit || 8192;
      const end = Math.min(offset + limit, text.length);
      return { ok: true, path: call.args.path, content: text.slice(offset, end), sha256: sha256(data), offset, totalChars: text.length, nextOffset: end < text.length ? end : null, truncated: offset > 0 || end < text.length };
    }
    if (call.name === 'repo.search') {
      if (call.args.path) await scopedPath(task.workspace, call.args.path);
      const globMatcher = call.args.glob ? compileGlob(call.args.glob) : null;
      const snapshot = await snapshotWorkspace(task.workspace, { expectedRoot: task.workspace });
      const files = snapshot.files.filter(file => file.content !== null
        && (!call.args.path || file.path === call.args.path)
        && (!globMatcher || globMatcher(file.path)));
      const matches = [], limit = call.args.limit ?? 40; let truncated = false;
      if (call.args.regex) return regexSearch(files, call.args.query, limit, { signal });
      for (const file of files) {
        const lines = file.content.split('\n');
        for (let line = 0; line < lines.length; line++) {
          const index = lines[line].indexOf(call.args.query);
          if (index >= 0) {
            if (matches.length === limit) { truncated = true; break; }
            matches.push({ path: file.path, line: line + 1, text: lines[line].slice(Math.max(0, index - 80), index + 240), sha256: file.sha256 });
          }
        }
        if (truncated) break;
      }
      return { ok: true, matches, truncated };
    }
    if (call.name === 'repo.glob') {
      const matcher = compileGlob(call.args.pattern);
      const { files, truncated } = await globWorkspace(task.workspace, matcher, { limit: call.args.limit ?? 200, expectedRoot: task.workspace });
      return { ok: true, files, truncated };
    }
    if (call.name === 'task.history') {
      return this.store.searchEvents(taskId, call.args);
    }
    if (call.name === 'memory.search') {
      const requestedScope = call.args.scope || 'all';
      const projectScope = `project:${task.sourcePath || task.workspace}`;
      const scope = requestedScope === 'global' ? 'global' : projectScope;
      const includeGlobal = requestedScope === 'all';
      return this.memory.searchMemories({
        query: call.args.query || '',
        scope,
        includeGlobal,
        limit: call.args.limit ?? 10
      });
    }
    if (call.name === 'git.diff') {
      const diff = await hasGit(task.workspace) ? await gitDiff(task.workspace) : '';
      return { ok: true, diff };
    }
    if (call.name === 'git.log') {
      const limit = call.args.limit || 20;
      const log = await hasGit(task.workspace) ? await gitLog(task.workspace, { limit }) : '';
      return { ok: true, log };
    }
    if (call.name === 'web.fetch') {
      const res = await safeWebFetch(call.args, { signal, ...(outbound || {}) });
      return res?.ok ? { ...res, untrustedExternalContent: true } : res;
    }
    if (call.name === 'web.search') {
      const res = await safeWebSearch(call.args, { signal, ...(outbound || {}) });
      return res?.ok ? { ...res, untrustedExternalContent: true } : res;
    }
    if (call.name === 'browser.snapshot') {
      const res = await this.browser.snapshot(taskId, call.args);
      return res?.ok ? { ...res, untrustedExternalContent: true } : res;
    }
    if (call.name === 'browser.screenshot') {
      return await this.browser.screenshot(taskId, call.args);
    }
    throw error('INVALID_TOOL', `Unsupported read-only tool: ${call.name}`);
  }
  async _executeReadBatch(taskId, calls, { epoch, signal, outbound } = {}) {
    const task = this.assertCurrent(taskId, epoch, signal);
    if (!Array.isArray(calls) || !calls.length) return [];
    const allowed = new Set(taskTools(task).map(tool => tool.name));
    const entries = [];
    const batchSeen = new Map();
    let hasFresh = false;
    for (const call of calls) {
      if (!call || typeof call.id !== 'string' || !call.id || call.id.length > 240 || !READ_ONLY_TOOLS.has(call.name) || !call.args || typeof call.args !== 'object' || Array.isArray(call.args)) {
        throw error('INVALID_TOOL', 'Read batch accepts valid read-only tool calls only.');
      }
      if (!allowed.has(call.name)) throw error('PERMISSION_DENIED', 'Tool is not permitted in the current task mode.');
      validateTool(call.name, call.args);
      const argsHash = sha256(stableJson(call.args));
      const id = `${taskId}:${call.id}`;
      if (batchSeen.has(id)) {
        const prev = batchSeen.get(id);
        if (prev.name !== call.name || prev.argsHash !== argsHash) throw error('OPERATION_ID_COLLISION', 'A tool call ID was reused with different arguments.');
        entries.push({ call, id, argsHash, aliasOf: prev });
        continue;
      }
      let operation = this.store.getOperation(id);
      if (operation) {
        if (operation.name !== call.name || operation.argsHash !== argsHash) throw error('OPERATION_ID_COLLISION', 'A tool call ID was reused with different arguments.');
        if (operation.status === 'succeeded' || operation.status === 'failed') {
          this.store.appendEvent(taskId, 'tool.reused', { operationId: id, status: operation.status });
          const entry = { call, id, argsHash, reused: true, result: operation.result };
          batchSeen.set(id, { name: call.name, argsHash, entry });
          entries.push(entry);
          continue;
        }
        operation = await this.reconcile(operation);
        if (operation.status === 'succeeded' || operation.status === 'failed') {
          const entry = { call, id, argsHash, reused: true, result: operation.result };
          batchSeen.set(id, { name: call.name, argsHash, entry });
          entries.push(entry);
          continue;
        }
        throw error('OUTCOME_UNKNOWN', 'A previous tool operation has an unresolved outcome.');
      }
      hasFresh = true;
      const entry = { call, id, argsHash, reused: false, operation: null };
      batchSeen.set(id, { name: call.name, argsHash, entry });
      entries.push(entry);
    }
    if (hasFresh && this.store.getOperations(taskId).some(other => !['succeeded', 'failed'].includes(other.status))) {
      throw error('OUTCOME_UNKNOWN', 'Resolve this task’s pending or uncertain tool effects before dispatching another operation.');
    }
    const freshEntries = entries.filter(entry => !entry.reused && !entry.aliasOf);
    for (const entry of freshEntries) {
      entry.operation = { id: entry.id, taskId, callId: entry.call.id, name: entry.call.name, args: entry.call.args, argsHash: entry.argsHash, epoch, status: 'prepared', createdAt: new Date().toISOString() };
      this.store.putOperation(entry.operation, 'tool.started');
    }
    const outcomes = await Promise.all(freshEntries.map(async entry => {
      try {
        if (this.faultInjector) await this.faultInjector('after_prepare', { taskId, operation: entry.operation });
        this.assertCurrent(taskId, epoch, signal);
        const result = await this._runReadOnly(task, taskId, entry.call, { signal, outbound });
        validateTool(entry.call.name, result, { result: true });
        return { entry, ok: true, result };
      } catch (cause) {
        return { entry, ok: false, cause };
      }
    }));
    let fatalCause = null;
    for (const outcome of outcomes) {
      const { entry } = outcome;
      if (outcome.ok) {
        entry.operation.status = 'succeeded';
        entry.operation.result = outcome.result;
        entry.operation.finishedAt = new Date().toISOString();
        this.store.putOperation(entry.operation, 'tool.completed', { operationId: entry.id, name: entry.operation.name, result: outcome.result });
        entry.result = outcome.result;
      } else {
        const cause = outcome.cause;
        entry.operation.status = 'failed';
        entry.operation.result = { ok: false, error: { code: cause.code || 'TOOL_ERROR', message: cause.message } };
        entry.operation.finishedAt = new Date().toISOString();
        this.store.putOperation(entry.operation, 'tool.completed', { operationId: entry.id, name: entry.operation.name, status: entry.operation.status, result: entry.operation.result });
        entry.result = entry.operation.result;
        if (!fatalCause && (cause.code === 'STALE_RUN' || cause.simulateCrash)) fatalCause = cause;
      }
    }
    if (fatalCause) throw fatalCause;
    return entries.map(entry => entry.aliasOf ? entry.aliasOf.entry.result : entry.result);
  }
  async _execute(taskId, call, { epoch, signal, expectedHash, onOutput, outbound } = {}) {
    const task = this.assertCurrent(taskId, epoch, signal);
    if (!call || typeof call.id !== 'string' || !call.id || call.id.length > 240 || !TOOLS.some(tool => tool.name === call.name) || !call.args || typeof call.args !== 'object' || Array.isArray(call.args)) throw error('INVALID_TOOL', 'Invalid tool call identity, name, or arguments.');
    // A stale check request can receive a no-effect explanation, but never
    // gains execution permission or bypasses the Challenger's read-only role.
    const unavailableCheck = call.name === 'check.run' && conversationWithoutChecks(task) && task.crewMember?.role !== 'challenger' && task.planMode !== true;
    if (!taskTools(task).some(tool => tool.name === call.name) && !unavailableCheck) {
      throw error('PERMISSION_DENIED', task.planMode === true
        ? 'Plan mode is read-only; switch to build mode before editing files or running commands.'
        : 'Tool is not permitted in the current task mode.');
    }
    validateTool(call.name, call.args);
    const argsHash = sha256(stableJson(call.args));
    const id = `${taskId}:${call.id}`;
    let operation = this.store.getOperation(id);
    if (operation) {
      if (operation.name !== call.name || operation.argsHash !== argsHash) throw error('OPERATION_ID_COLLISION', 'A tool call ID was reused with different arguments.');
      if (operation.status === 'succeeded' || operation.status === 'failed') {
        this.store.appendEvent(taskId, 'tool.reused', { operationId: id, status: operation.status });
        return operation.result;
      }
      operation = await this.reconcile(operation);
      if (operation.status === 'succeeded' || operation.status === 'failed') return operation.result;
      throw error('OUTCOME_UNKNOWN', 'A previous tool operation has an unresolved outcome.');
    }
    // A new logical operation cannot pass an unresolved effect elsewhere in
    // this task, even if a controller incorrectly attempts a provider fallback.
    // Cached settled results and same-ID reconciliation above remain safe.
    if (this.store.getOperations(taskId).some(other => !['succeeded', 'failed'].includes(other.status))) throw error('OUTCOME_UNKNOWN', 'Resolve this task’s pending or uncertain tool effects before dispatching another operation.');
    operation = { id, taskId, callId: call.id, name: call.name, args: call.args, argsHash, epoch, status: 'prepared', createdAt: new Date().toISOString() };
    this.store.putOperation(operation, 'tool.started');
    try {
      if (this.faultInjector) await this.faultInjector('after_prepare', { taskId, operation });
      this.assertCurrent(taskId, epoch, signal);
      let result;
      if (READ_ONLY_TOOLS.has(call.name)) {
        result = await this._runReadOnly(task, taskId, call, { signal, outbound });
      } else if (call.name === 'repo.write' || call.name === 'repo.patch') {
        if (call.name === 'repo.write' && (typeof call.args.content !== 'string' || call.args.content.includes('\0') || Buffer.byteLength(call.args.content) > 256 * 1024)) throw error('INVALID_TOOL', 'Write content must be a UTF-8 text string without NUL bytes up to 256 KiB.');
        const inspected = await scopedPath(task.workspace, call.args.path, { writing: true, withStat: true });
        const target = inspected.target;
        const previous = await readBoundedFile(target, 256 * 1024, 'READ_LIMIT', { expectedIdentity: inspected.stat }).catch(cause => { if (cause.code === 'ENOENT') return null; throw cause; });
        const previousMode = previous === null ? 0o644 : (inspected.stat?.mode ?? 0o644) & 0o777;
        const preHash = previous === null ? null : sha256(previous);
        const effectiveExpectedHash = Object.hasOwn(call.args, 'expectedHash') ? call.args.expectedHash : expectedHash;
        if (effectiveExpectedHash !== undefined && effectiveExpectedHash !== preHash) throw error('PREIMAGE_MISMATCH', 'File changed since the expected snapshot; read it again.');
        let content = call.args.content;
        if (call.name === 'repo.patch') {
          const text = previous === null ? null : decodeText(previous);
          if (text === null) throw error('PATCH_TARGET_INVALID', 'Patch target must be an existing UTF-8 text file.');
          const hasEdits = Array.isArray(call.args.edits);
          const hasSingle = Object.hasOwn(call.args, 'oldText') || Object.hasOwn(call.args, 'newText');
          if ((hasEdits && hasSingle) || (!hasEdits && (!Object.hasOwn(call.args, 'oldText') || !Object.hasOwn(call.args, 'newText')))) {
            throw error('INVALID_TOOL', 'Provide either oldText and newText or a non-empty edits array.');
          }
          const hunks = hasEdits ? call.args.edits : [{ oldText: call.args.oldText, newText: call.args.newText }];
          if (!hunks.length) throw error('INVALID_TOOL', 'edits must contain at least one hunk.');
          content = text;
          for (let i = 0; i < hunks.length; i++) {
            const hunk = hunks[i];
            const index = content.indexOf(hunk.oldText);
            if (index < 0 || content.indexOf(hunk.oldText, index + 1) >= 0) {
              throw error('PATCH_AMBIGUOUS', hasEdits ? `edits[${i}].oldText must occur exactly once in the current file.` : 'oldText must occur exactly once in the current file.');
            }
            content = content.slice(0, index) + hunk.newText + content.slice(index + hunk.oldText.length);
          }
          if (content.includes('\0')) throw error('INVALID_TOOL', 'Patched file cannot contain NUL bytes.');
          if (Buffer.byteLength(content) > 256 * 1024) throw error('INVALID_TOOL', 'Patched file exceeds 256 KiB.');
        }
        operation.preHash = preHash;
        operation.postHash = sha256(content);
        // Preparation failures are known failures: no target rename has been
        // attempted yet. Persist the intended hashes before preparing the file.
        this.store.putOperation(operation);
        this.assertCurrent(taskId, epoch, signal);
        await fs.mkdir(path.dirname(target), { recursive: true });
        const temporary = path.join(path.dirname(target), `.g0d-write-${randomUUID()}`);
        try {
          const handle = await fs.open(temporary, 'wx', previousMode);
          try { await handle.writeFile(content); await handle.chmod(previousMode); await handle.sync(); } finally { await handle.close(); }
          this.assertCurrent(taskId, epoch, signal);
          const beforeWrite = await scopedPath(task.workspace, call.args.path, { writing: true, withStat: true });
          const immediatelyBefore = await readBoundedFile(target, 256 * 1024, 'READ_LIMIT', { expectedIdentity: beforeWrite.stat }).catch(cause => { if (cause.code === 'ENOENT') return null; throw cause; });
          if ((immediatelyBefore === null ? null : sha256(immediatelyBefore)) !== preHash) throw error('PREIMAGE_MISMATCH', 'File changed during write preparation.');
          this.assertCurrent(taskId, epoch, signal);
          // Invalidate before the possible effect, not after the whole model
          // response: pause or process death can interrupt a multi-write batch.
          if (this.store.requireTask(taskId).verification) this.store.updateTask(taskId, current => { current.verification = null; return current; });
          operation.status = 'dispatching';
          this.store.putOperation(operation);
          await fs.rename(temporary, target);
          operation.effectObserved = true;
          if (this.faultInjector) await this.faultInjector('after_effect', { taskId, operation });
          const diagnostics = await checkSyntaxDiagnostics(call.args.path, target, content).catch(() => null);
          result = { ok: true, path: call.args.path, sha256: operation.postHash, bytes: Buffer.byteLength(content), ...(diagnostics?.length ? { diagnostics } : {}) };
        } finally { await fs.unlink(temporary).catch(() => {}); }
      } else if (call.name === 'repo.delete') {
        const inspected = await scopedPath(task.workspace, call.args.path, { withStat: true });
        const previous = await readBoundedFile(inspected.target, 256 * 1024, 'READ_LIMIT', { expectedIdentity: inspected.stat });
        const preHash = sha256(previous);
        if (call.args.expectedHash !== preHash) throw error('PREIMAGE_MISMATCH', 'File changed since the expected snapshot; read it again.');
        operation.preHash = preHash;
        operation.postHash = null;
        this.store.putOperation(operation);
        this.assertCurrent(taskId, epoch, signal);
        const beforeDelete = await scopedPath(task.workspace, call.args.path, { withStat: true });
        const immediatelyBefore = await readBoundedFile(beforeDelete.target, 256 * 1024, 'READ_LIMIT', { expectedIdentity: beforeDelete.stat });
        if (sha256(immediatelyBefore) !== preHash) throw error('PREIMAGE_MISMATCH', 'File changed during delete preparation.');
        this.assertCurrent(taskId, epoch, signal);
        if (this.store.requireTask(taskId).verification) this.store.updateTask(taskId, current => { current.verification = null; return current; });
        operation.status = 'dispatching';
        this.store.putOperation(operation);
        await fs.unlink(beforeDelete.target);
        operation.effectObserved = true;
        if (this.faultInjector) await this.faultInjector('after_effect', { taskId, operation });
        result = { ok: true, path: call.args.path, deleted: true, sha256: preHash };
      } else if (call.name === 'repo.move') {
        if (call.args.from === call.args.to) throw error('INVALID_TOOL', 'Source and destination paths must differ.');
        const src = await scopedPath(task.workspace, call.args.from, { withStat: true });
        const dst = await scopedPath(task.workspace, call.args.to, { writing: true, withStat: true });
        if (dst.stat) throw error('PATH_EXISTS', 'Destination file already exists.');
        const previous = await readBoundedFile(src.target, 256 * 1024, 'READ_LIMIT', { expectedIdentity: src.stat });
        const preHash = sha256(previous);
        if (call.args.expectedHash !== preHash) throw error('PREIMAGE_MISMATCH', 'Source file changed since the expected snapshot; read it again.');
        operation.preHash = preHash;
        operation.postHash = preHash;
        operation.bytes = previous.length;
        this.store.putOperation(operation);
        this.assertCurrent(taskId, epoch, signal);
        await fs.mkdir(path.dirname(dst.target), { recursive: true });
        const srcBefore = await scopedPath(task.workspace, call.args.from, { withStat: true });
        const dstBefore = await scopedPath(task.workspace, call.args.to, { writing: true, withStat: true });
        if (dstBefore.stat) throw error('PATH_EXISTS', 'Destination file appeared during move preparation.');
        const srcData = await readBoundedFile(srcBefore.target, 256 * 1024, 'READ_LIMIT', { expectedIdentity: srcBefore.stat });
        if (sha256(srcData) !== preHash) throw error('PREIMAGE_MISMATCH', 'Source file changed during move preparation.');
        this.assertCurrent(taskId, epoch, signal);
        if (this.store.requireTask(taskId).verification) this.store.updateTask(taskId, current => { current.verification = null; return current; });
        operation.status = 'dispatching';
        this.store.putOperation(operation);
        await fs.rename(srcBefore.target, dstBefore.target);
        operation.effectObserved = true;
        if (this.faultInjector) await this.faultInjector('after_effect', { taskId, operation });
        result = { ok: true, from: call.args.from, to: call.args.to, sha256: preHash, bytes: previous.length };
      } else if (call.name === 'process.run') {
        // General commands may change any copied source. Invalidate evidence
        // before launch and journal dispatch; a crash is never safely replayable.
        this.assertCurrent(taskId, epoch, signal);
        if (this.store.requireTask(taskId).verification) this.store.updateTask(taskId, current => { current.verification = null; return current; });
        operation.status = 'dispatching'; this.store.putOperation(operation);
        result = await runCommand(task, call.args, { signal, onOutput });
        operation.executionResult = result;
        if (result.detachedObserved || result.drainUncertain) throw error('EXECUTION_OUTCOME_UNKNOWN', 'Detached activity or uncertain command drainage was observed. Cleanup was attempted; owner review is required before continuing.');
        operation.status = 'effect_recorded';
        if (this.faultInjector) await this.faultInjector('after_effect', { taskId, operation });
      } else if (call.name === 'git.commit') {
        if (!await hasGit(task.workspace)) result = { ok: true, committed: false, hash: null, summary: 'No git repository in this workspace.' };
        else {
          this.assertCurrent(taskId, epoch, signal);
          result = await gitCommit(task.workspace, { message: call.args.message });
        }
      } else if (call.name === 'task.todo') {
        this.assertCurrent(taskId, epoch, signal);
        const items = call.args.items.map(item => ({ id: item.id, text: item.text, status: item.status }));
        const done = items.filter(item => item.status === 'done').length;
        const inProgress = items.filter(item => item.status === 'in_progress').length;
        const pending = items.filter(item => item.status === 'pending').length;
        const summary = { count: items.length, done, inProgress, pending, items };
        this.store.updateTask(taskId, current => { current.todos = items; return current; }, 'task.todo', summary);
        result = { ok: true, ...summary };
      } else if (call.name === 'memory.save') {
        this.assertCurrent(taskId, epoch, signal);
        if (outbound?.privacy?.ephemeralSession) {
          result = { ok: false, error: { code: 'EPHEMERAL_SESSION', message: 'Ephemeral / Burn Bag mode is active — cross-session memory writes are paused.' } };
        } else {
          const resolvedScope = call.args.scope === 'project' ? `project:${task.sourcePath || task.workspace}` : 'global';
          result = this.memory.saveMemory({
            title: call.args.title,
            content: call.args.content,
            scope: resolvedScope,
            tags: call.args.tags || []
          });
        }
      } else if (call.name === 'memory.delete') {
        this.assertCurrent(taskId, epoch, signal);
        result = this.memory.deleteMemory(call.args.id);
      } else if (call.name === 'browser.open') {
        this.assertCurrent(taskId, epoch, signal);
        const res = await this.browser.open(taskId, call.args, outbound || {});
        result = res?.ok ? { ...res, untrustedExternalContent: true } : res;
      } else if (call.name === 'browser.act') {
        this.assertCurrent(taskId, epoch, signal);
        const res = await this.browser.act(taskId, call.args, outbound || {});
        result = res?.ok ? { ...res, untrustedExternalContent: true } : res;
      } else if (call.name === 'browser.eval') {
        this.assertCurrent(taskId, epoch, signal);
        const res = await this.browser.evaluate(taskId, call.args);
        result = res?.ok ? { ...res, untrustedExternalContent: true } : res;
      } else if (call.name === 'browser.close') {
        result = await this.browser.closeSession(taskId);
      } else if (call.name === 'agent.spawn') {
        result = { ok: false, error: { code: 'SUBAGENT_RUNTIME_REQUIRED', message: 'agent.spawn requires an active Runtime controller.' } };
      } else if (unavailableCheck) {
        const snapshot = await snapshotWorkspace(task.workspace, { expectedRoot: task.workspace });
        result = { status: 'unknown', code: 'NO_CONFIGURED_CHECKS', snapshotHash: snapshot.snapshotHash, checks: [{ name: 'conversation', status: 'unknown', detail: 'No owner checks are configured. No evaluator or command ran. Answer the request directly; artifacts still require owner review.' }] };
      } else {
        if (task.checks?.length) {
          operation.customCommands = true; operation.status = 'dispatching'; this.store.putOperation(operation);
          if (this.store.requireTask(taskId).verification) this.store.updateTask(taskId, current => { current.verification = null; return current; });
        }
        const before = await snapshotWorkspace(task.workspace, { expectedRoot: task.workspace });
        if (!this.evaluator) result = { status: 'unknown', snapshotHash: before.snapshotHash, checks: [{ name: 'configured evaluator', status: 'unknown', detail: 'No evaluator configured.' }] };
        else result = await evaluateBounded(this.evaluator, this.store.requireTask(taskId), { signal });
        const after = await snapshotWorkspace(task.workspace, { expectedRoot: task.workspace });
        result = bindVerification(result, before, after);
        if (result.code === 'EXECUTION_OUTCOME_UNKNOWN') throw error(result.code, 'Check command lifecycle needs owner review.');
        if (operation.customCommands) operation.status = 'effect_recorded';
        if (this.store.requireTask(taskId).epoch === epoch) this.store.updateTask(taskId, current => { current.verification = result; return current; }, 'evaluation.completed', result);
      }
      validateTool(call.name, result, { result: true });
      operation.status = 'succeeded';
      operation.result = result;
      operation.finishedAt = new Date().toISOString();
      this.store.putOperation(operation, 'tool.completed', { operationId: id, name: operation.name, result });
      return result;
    } catch (cause) {
      const preDispatchFailure = ['EXECUTION_DENIED', 'ISOLATION_UNAVAILABLE', 'INVALID_EXECUTION', 'INVALID_TOOL', 'PATH_DENIED', 'WORKSPACE_CHANGED', 'EXECUTION_CANCELLED'].includes(cause.code);
      const uncertain = operation.effectObserved || operation.status === 'dispatching' && !preDispatchFailure || (call.name === 'process.run' || operation.customCommands) && operation.status === 'effect_recorded';
      operation.status = uncertain ? 'outcome_unknown' : 'failed';
      operation.result = { ok: false, error: { code: cause.code || 'TOOL_ERROR', message: cause.message } };
      operation.finishedAt = new Date().toISOString();
      this.store.putOperation(operation, 'tool.completed', { operationId: id, name: operation.name, status: operation.status, result: operation.result });
      if (cause.code === 'STALE_RUN' || uncertain || cause.simulateCrash) throw cause;
      return operation.result;
    }
  }
  async reconcile(operation) {
    if (['repo.write', 'repo.patch'].includes(operation.name) && operation.postHash) {
      const task = this.store.requireTask(operation.taskId);
      try {
        const inspected = await scopedPath(task.workspace, operation.args.path, { writing: true, withStat: true });
        const data = await readBoundedFile(inspected.target, 256 * 1024, 'READ_LIMIT', { expectedIdentity: inspected.stat }).catch(cause => { if (cause.code === 'ENOENT') return null; throw cause; });
        const hash = data === null ? null : sha256(data);
        if (hash === operation.postHash) {
          operation.status = 'succeeded';
          operation.result = { ok: true, path: operation.args.path, sha256: hash, reconciled: true };
        } else if (hash === operation.preHash) {
          operation.status = 'failed';
          operation.result = { ok: false, error: { code: 'INTERRUPTED_BEFORE_EFFECT', message: 'Expected write did not occur; a new explicit attempt may be scheduled.' }, reconciled: true };
        } else operation.status = 'outcome_unknown';
      } catch { operation.status = 'outcome_unknown'; }
    } else if (operation.name === 'repo.delete' && operation.preHash) {
      const task = this.store.requireTask(operation.taskId);
      try {
        const inspected = await scopedPath(task.workspace, operation.args.path, { writing: true, withStat: true });
        const data = await readBoundedFile(inspected.target, 256 * 1024, 'READ_LIMIT', { expectedIdentity: inspected.stat }).catch(cause => { if (cause.code === 'ENOENT') return null; throw cause; });
        if (data === null) {
          operation.status = 'succeeded';
          operation.result = { ok: true, path: operation.args.path, deleted: true, sha256: operation.preHash, reconciled: true };
        } else if (sha256(data) === operation.preHash) {
          operation.status = 'failed';
          operation.result = { ok: false, error: { code: 'INTERRUPTED_BEFORE_EFFECT', message: 'Expected delete did not occur; a new explicit attempt may be scheduled.' }, reconciled: true };
        } else operation.status = 'outcome_unknown';
      } catch { operation.status = 'outcome_unknown'; }
    } else if (operation.name === 'repo.move' && operation.preHash && operation.postHash) {
      const task = this.store.requireTask(operation.taskId);
      try {
        const src = await scopedPath(task.workspace, operation.args.from, { writing: true, withStat: true });
        const dst = await scopedPath(task.workspace, operation.args.to, { writing: true, withStat: true });
        const srcData = await readBoundedFile(src.target, 256 * 1024, 'READ_LIMIT', { expectedIdentity: src.stat }).catch(cause => { if (cause.code === 'ENOENT') return null; throw cause; });
        const dstData = await readBoundedFile(dst.target, 256 * 1024, 'READ_LIMIT', { expectedIdentity: dst.stat }).catch(cause => { if (cause.code === 'ENOENT') return null; throw cause; });
        if (srcData === null && dstData !== null && sha256(dstData) === operation.postHash) {
          operation.status = 'succeeded';
          operation.result = { ok: true, from: operation.args.from, to: operation.args.to, sha256: operation.postHash, bytes: operation.bytes ?? dstData.length, reconciled: true };
        } else if (srcData !== null && sha256(srcData) === operation.preHash && dstData === null) {
          operation.status = 'failed';
          operation.result = { ok: false, error: { code: 'INTERRUPTED_BEFORE_EFFECT', message: 'Expected move did not occur; a new explicit attempt may be scheduled.' }, reconciled: true };
        } else operation.status = 'outcome_unknown';
      } catch { operation.status = 'outcome_unknown'; }
    } else if ((operation.name === 'process.run' || operation.customCommands) && operation.status !== 'prepared') {
      operation.status = 'outcome_unknown';
      operation.result = { ok: false, error: { code: 'OUTCOME_UNKNOWN', message: 'Command may have changed files before interruption. Never replay automatically; inspect the workspace and resolve the operation.' } };
    } else if (operation.status === 'prepared' || !mutatingFileOps.has(operation.name)) {
      operation.status = 'failed';
      operation.result = { ok: false, error: { code: 'INTERRUPTED', message: 'Read-only operation interrupted before a recorded result.' }, reconciled: true };
    }
    this.store.putOperation(operation, 'tool.reconciled', { operationId: operation.id, status: operation.status, result: operation.result });
    return operation;
  }
  async reconcileTask(taskId) {
    for (const operation of this.store.getOperations(taskId)) if (!['succeeded', 'failed'].includes(operation.status)) await this.reconcile(operation);
    return this.store.getOperations(taskId).filter(operation => operation.status === 'outcome_unknown');
  }
}
