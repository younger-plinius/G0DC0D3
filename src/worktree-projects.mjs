import { modelParameters, activeHistory } from './conversation-controls.mjs';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { readBoundedFile, scopedPath, sha256 } from './broker.mjs';
import { neutralizeRepoGitConfigFlags } from './git.mjs';
import { patchRequestBody } from './providers.mjs';
import { prepareOutboundRequest } from './privacy.mjs';
import { runCommand } from './runner.mjs';

async function git(cwd, args, input) {
  const extraFlags = cwd ? await neutralizeRepoGitConfigFlags(cwd) : [];
  return new Promise((resolve, reject) => {
    const child = execFile(
      '/usr/bin/git',
      [
        '-c', 'core.hooksPath=/dev/null',
        '-c', 'core.fsmonitor=false',
        '-c', 'core.pager=cat',
        '-c', 'diff.external=',
        '-c', 'core.attributesfile=/dev/null',
        '-c', 'core.sshCommand=/usr/bin/false',
        ...extraFlags,
        '--literal-pathspecs',
        ...args,
      ],
      {
        cwd,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
        encoding: 'utf8',
        timeout: 60000,
        maxBuffer: 16 * 1024 * 1024,
      },
      (error, stdout, stderr) =>
        error ? reject(new Error(stderr.trim() || error.message)) : resolve(stdout),
    );
    child.stdin.on('error', () => {}); // Git may reject the arguments before reading stdin.
    child.stdin.end(input);
  });
}

const imageTypes = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
};
const mediaTypes = {
  ...imageTypes,
  pdf: 'application/pdf',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  ogg: 'audio/ogg',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
};
const conflict = (message) => Object.assign(new Error(message), { status: 409 });

async function readSelected({ root, createdFiles = [] }, name) {
  if (
    typeof name !== 'string' ||
    !name ||
    name.includes('\0') ||
    name.split('/').some((part) => !part || ['.', '..', '.git', '.g0dc0d3'].includes(part.toLowerCase()))
  )
    throw new Error('Choose a tracked file.');
  const tracked = await git(root, ['ls-files', '--cached', '-z', '--', name]);
  if (tracked !== name + '\0' && !createdFiles.includes(name)) throw new Error('Choose one tracked file.');
  const target = path.join(root, name);
  if ((await fs.realpath(target)) !== target)
    throw new Error('Linked files are unavailable for preview.');
  const stat = await fs.lstat(target);
  if (stat.size > 12 * 1024 * 1024)
    throw new Error('This file exceeds the 12 MiB preview limit. Open it from the worktree folder.');
  const bytes = await readBoundedFile(target, stat.size, 'PREVIEW_SIZE', { expectedIdentity: stat });
  return bytes;
}

async function checkNewPath(root, name) {
  if (typeof name !== 'string' || name.length > 1024 || /[\u0000-\u001f\u007f]/.test(name) ||
      name.split('/').some(part => ['.git', '.g0dc0d3'].includes(part.toLowerCase())))
    throw new Error('Enter a repository-relative path for the new file.');
  const { stat } = await scopedPath(root, name, { writing: true, withStat: true });
  if (stat || await git(root, ['ls-files', '--cached', '-z', '--', name]))
    throw conflict('This path already exists or is tracked: ' + name);
}

export class WorktreeProjects {
  constructor(store, providers, { outboundOptions = () => ({}) } = {}) {
    this.outboundOptions = outboundOptions;
    this.store = store;
    this.db = store.db;
    this.providers = providers;
    this.directory = path.join(store.dataDir, 'git-worktrees');
    this.jobs = new Map();
    this.attachments = new Map();
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS desktop_worktrees (id TEXT PRIMARY KEY, data TEXT NOT NULL)',
    );
  }
  save(project, event, detail = {}) {
    const write = () => this.db.prepare('INSERT OR REPLACE INTO desktop_worktrees VALUES (?, ?)').run(project.id, JSON.stringify(project));
    if (!event || !project.chatId) { write(); return; }
    this.store.updateTask(project.chatId, task => {
      if (task.codeWorkspace && task.codeWorkspace.id !== project.id) throw conflict('This chat already has a repository.');
      write();
      task.codeWorkspace = { id: project.id, repository: path.basename(project.repository), branch: project.branch };
    }, event, { ...detail, repository: path.basename(project.repository), branch: project.branch });
  }
  buildIntent(chatId, message, messageId) {
    const task = this.store.requireTask(chatId);
    if (task.workspaceKind !== 'conversation' || typeof message !== 'string' || !message.trim() || message.length > 12000 ||
        typeof messageId !== 'string' || !/^[\w-]{1,120}$/.test(messageId)) throw new Error('Choose a chat and enter a build request.');
    const prior = this.db.prepare("SELECT json_extract(data,'$.data.message') AS message FROM events WHERE task_id=? AND json_extract(data,'$.type')='code.intent' AND json_extract(data,'$.data.id')=? LIMIT 1").get(chatId, messageId);
    if (prior) {
      if (prior.message !== message.trim()) throw conflict('This message ID belongs to a different build request.');
      return task;
    }
    return this.store.updateTask(chatId, current => {
      current.codeIntent = { id: messageId, message: message.trim() };
    }, 'code.intent', { id: messageId, message: message.trim() });
  }
  chatMessages(chatId) {
    const task = this.store.requireTask(chatId);
    const turns = (task.followups || []).map(item => ({ role: 'user', text: item.message, time: item.appliedAt || item.createdAt }));
    for (const event of activeHistory(task, this.store.getEvents(chatId)).slice(-200)) {
      const reply = event.data?.response;
      if (event.type === 'model.response' && !event.data.superseded && reply?.type === 'message' && reply.text)
        turns.push({ role: 'assistant', text: reply.text, time: event.time });
      if (event.type === 'code.intent') turns.push({ role: 'user', text: event.data.message, time: event.time });
    }
    turns.sort((a,b) => a.time.localeCompare(b.time));
    return [{ role: 'user', text: task.objective.slice(0, 2500) },
      ...turns.slice(-10).map(({role, text}) => ({role, text: text.slice(0, 1600)}))];
  }
  get(id) {
    const row = this.db.prepare('SELECT data FROM desktop_worktrees WHERE id=?').get(id);
    if (!row) throw Object.assign(new Error('Worktree not found.'), { status: 404 });
    const project = JSON.parse(row.data);
    if (!this.jobs.get(id)?.building) {
      for (const c of project.candidates) if (!c.patch && !c.error) c.error = 'Interrupted before completion.';
    }
    return project;
  }
  list() {
    return this.db
      .prepare('SELECT data FROM desktop_worktrees ORDER BY rowid DESC')
      .all()
      .map((row) => {
        const { id, repository, branch, base, root, chatId } = JSON.parse(row.data);
        return { id, repository, branch, base, root, chatId };
      });
  }
  async attach(chatId, repository) {
    const task = this.store.requireTask(chatId);
    if (task.workspaceKind !== 'conversation') throw conflict('Attach a repository from a conversation.');
    const pending = this.attachments.get(chatId);
    if (pending) {
      if (pending.repository === repository) return pending.result;
      throw conflict('Another repository attachment is in progress.');
    }
    const result = this.create(repository, chatId);
    this.attachments.set(chatId, { repository, result });
    try { return await result; } finally { this.attachments.delete(chatId); }
  }
  async create(repository, chatId) {
    if (typeof repository !== 'string' || !path.isAbsolute(repository))
      throw new Error('Choose a local Git repository.');
    const source = await fs.realpath(repository);
    const top = (await git(source, ['rev-parse', '--show-toplevel'])).trimEnd();
    const attached = chatId && this.store.requireTask(chatId).codeWorkspace;
    if (attached) {
      const previous = this.get(attached.id);
      if (previous.repository === top) return previous;
      throw conflict('This chat already has a different repository.');
    }
    const base = (await git(top, ['rev-parse', '--verify', 'HEAD^{commit}'])).trim();
    const id = randomUUID(),
      branch = 'godcode/' + id.slice(0, 12);
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    const root = path.join(await fs.realpath(this.directory), id);
    const project = { id, repository: top, base, branch, root, candidates: [], ...(chatId ? { chatId } : {}) };
    try {
      await git(top, ['worktree', 'add', '-b', branch, '--', root, base]);
      this.save(project, 'code.attached');
    } catch (error) {
      await git(top, ['worktree', 'remove', '--force', '--', root]).catch(() => {});
      await fs.rm(root, { recursive: true, force: true }).catch(() => {});
      await git(top, ['worktree', 'prune']).catch(() => {});
      await git(top, ['branch', '-D', '--', branch]).catch(() => {});
      throw error;
    }
    return project;
  }
  async inspect(id) {
    const project = this.get(id);
    const files = (await git(project.root, ['ls-files', '-z'])).split('\0').filter(Boolean);
    for (const name of project.createdFiles || []) {
      if (!files.includes(name) && (await fs.lstat(path.join(project.root, name)).catch(() => null))?.isFile()) files.push(name);
    }
    return { ...project, files, building: !!this.jobs.get(id)?.building, busy: this.jobs.has(id) };
  }
  progress(id, after) {
    const { review, candidates } = this.get(id);
    const building = !!this.jobs.get(id)?.building;
    const finished = candidates.filter(c => c.patch || c.error).length;
    const revision = [review?.buildId, finished, building].join(':');
    return revision === after ? { revision, building } : { revision, building, review, candidates };
  }
  stopWaiting(id, buildId) {
    const project = this.get(id);
    if (!buildId || buildId !== project.review?.buildId) throw conflict('The build changed. Reopen its review.');
    const job = this.jobs.get(id);
    if (!job?.building) return { stopping: false };
    if (!project.candidates.some(c => c.patch)) throw conflict('Wait for a reviewable patch first.');
    job.controller.abort(new Error('Stopped waiting for this model.'));
    return { stopping: true };
  }
  async file(id, name) {
    const bytes = await readSelected(this.get(id), name);
    const mime = Object.hasOwn(mediaTypes, name.split('.').pop().toLowerCase())
      ? mediaTypes[name.split('.').pop().toLowerCase()]
      : null;
    if (mime) return { path: name, mime, data: bytes.toString('base64') };
    if (!bytes.includes(0)) {
      try {
        return { path: name, text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) };
      } catch {
        /* Other binary types still have a size and a path in the inspector. */
      }
    }
    return { path: name, bytes: bytes.length };
  }
  async exclusive(id, fn, { checkBranch = true } = {}) {
    if (this.jobs.has(id)) throw conflict('The current worktree operation is still running.');
    const project = this.get(id);
    const controller = new AbortController();
    const job = { controller };
    this.jobs.set(id, job);
    try {
      job.promise = (async () => {
        if (checkBranch && (await git(project.root, ['symbolic-ref', '--short', 'HEAD'])).trim() !== project.branch)
          throw conflict('The worktree branch changed. Open the intended branch first.');
        return fn(project, controller.signal);
      })();
      return await job.promise;
    } finally {
      this.jobs.delete(id);
    }
  }
  async checkPatch(project, patch, inputs) {
    if (!patch?.startsWith('diff --git ') || Buffer.byteLength(patch) > 512 * 1024)
      throw new Error('The model did not return a usable Git diff.');
    if (/^(?:rename |copy |old mode |new mode |deleted file mode |GIT binary patch|Binary files )/m.test(patch))
      throw new Error('Choose text edits or requested new files.');
    const stats = await git(project.root, ['apply', '--numstat', '-z', '--recount', '-'], patch);
    const paths = stats.split('\0').filter(Boolean).map(line => line.replace(/^\d+\t\d+\t/, ''));
    if (!paths.length || paths.some(name => !inputs.some(input => input.path === name)))
      throw new Error('The patch changes a file outside the selection.');
    const summary = await git(project.root, ['-c', 'core.quotePath=false', 'apply', '--summary', '--recount', '-'], patch);
    // Git classifies creations and reports their mode even if optional headers were omitted.
    const prefix = ' create mode 100644 ';
    const requested = inputs.filter(i => i.hash === null && paths.includes(i.path));
    for (const line of summary.split('\n').filter(Boolean)) {
      if (!line.startsWith(prefix))
        throw new Error('Only regular text files can be created. Deletions and mode changes are unavailable.');
      const name = line.slice(prefix.length);
      if (!requested.some(i => name === i.path || name === JSON.stringify(i.path)))
        throw new Error('Select the new file path before generating.');
    }
    await git(project.root, ['apply', '--check', '--recount', '-'], patch);
    return paths;
  }
  async prepare(project, { objective, files = [], newFiles = [], providerIds, parameters }) {
    if (typeof objective !== 'string' || !objective.trim() || objective.length > 30000)
      throw new Error('Enter a build request.');
    if (!Array.isArray(files) || !Array.isArray(newFiles)) throw new Error('Choose files for this build.');
    const paths = [...files, ...newFiles];
    if (!paths.length || paths.length > 32 || new Set(paths).size !== paths.length)
      throw new Error('Select up to 32 distinct text files for this build.');
    if (!Array.isArray(providerIds) || !providerIds.length || providerIds.length > 4 || new Set(providerIds).size !== providerIds.length)
      throw new Error('Select one to four distinct models.');
    const models = providerIds.map(id => this.providers.get(id));
    if (models.some(p => !p?.proposePatch || p.protocol !== 'openai-chat' || p.available === false))
      throw new Error('Select connected Chat Completions models.');
    const sampling = modelParameters(parameters);
    const inputs = [], contents = [];
    let bytes = 0;
    for (const name of files) {
      const data = await readSelected(project, name);
      bytes += data.length;
      if (bytes > 512 * 1024 || data.includes(0)) throw new Error('Select up to 512 KiB of UTF-8 source per request.');
      contents.push({ path: name, content: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(data) });
      inputs.push({ path: name, hash: sha256(data) });
    }
    for (const name of newFiles) {
      await checkNewPath(project.root, name);
      inputs.push({ path: name, hash: null });
    }
    for (const model of models) {
      if (sampling.max_tokens > model.maxOutputTokensCeiling)
        throw new Error((model.label || model.id) + ' supports at most ' + model.maxOutputTokensCeiling + ' output tokens.');
    }
    const conversation = project.chatId ? this.chatMessages(project.chatId) : undefined;
    const input = { objective, files: contents, conversation, parameters: sampling };
    if (newFiles.length) input.newFiles = newFiles;
    const requests = models.map(model => ({
      id: model.id, label: model.label || model.id, endpoint: model.baseUrl ? model.baseUrl + '/chat/completions' : null,
      body: prepareOutboundRequest(model, patchRequestBody(model, input), { ...this.outboundOptions(), onOutbound: undefined }),
    }));
    const fingerprint = sha256(JSON.stringify([project.id, requests, inputs]));
    return { input, inputs, models, preview: { fingerprint, requests } };
  }
  async preview(id, request) {
    const { preview } = await this.prepare(this.get(id), request);
    return preview;
  }
  build(id, request) {
    return this.exclusive(id, async (project, signal) => {
      const { input, inputs, models, preview } = await this.prepare(project, request);
      if (request.fingerprint !== undefined && preview.fingerprint !== request.fingerprint)
        throw conflict('The request changed since preview. Review the updated inputs before sending.');
      project.review = {
        buildId: randomUUID(), objective: input.objective, inputs, providerIds: request.providerIds, parameters: input.parameters,
        intentId: project.chatId ? this.store.requireTask(project.chatId).codeIntent?.id : undefined,
        base: (await git(project.root, ['rev-parse', 'HEAD'])).trim(), fingerprint: preview.fingerprint,
      };
      project.candidates = models.map(model => ({ id: randomUUID(), providerId: model.id, provider: model.label || model.id }));
      this.jobs.get(id).building = true;
      this.save(project);
      await Promise.all(models.map(async (model, i) => {
        const candidate = project.candidates[i];
        const start = Date.now();
        try {
          const patch = await model.proposePatch({ ...input, signal }, this.outboundOptions());
          const paths = await this.checkPatch(project, patch, inputs);
          signal.throwIfAborted();
          Object.assign(candidate, { paths, patch });
        } catch (error) {
          candidate.error = error.message;
        }
        candidate.elapsedMs = Date.now() - start;
        this.save(project);
      }));
      this.save(project, 'code.build', { objective: input.objective, valid: project.candidates.filter(c => c.patch).length, total: models.length });
      return project;
    });
  }
  apply(id, candidateId) {
    return this.exclusive(id, async (project) => {
      const candidate = project.candidates.find((c) => c.id === candidateId);
      if (!candidate?.patch) throw conflict('Choose an available patch.');
      if (project.review.applied) {
        if (project.review.applied === candidateId) return project;
        throw conflict('A candidate from this build has already been applied.');
      }
      if ((await git(project.root, ['rev-parse', 'HEAD'])).trim() !== project.review.base)
        throw conflict('The worktree HEAD changed. Generate a fresh proposal.');
      for (const input of project.review.inputs) {
        if (input.hash === null) { await checkNewPath(project.root, input.path); continue; }
        if (sha256(await readSelected(project, input.path)) !== input.hash)
          throw conflict('The selected files changed. Generate a fresh proposal.');
      }
      const paths = await this.checkPatch(project, candidate.patch, project.review.inputs);
      await git(project.root, ['apply', '--recount', '-'], candidate.patch);
      const created = project.review.inputs.filter(i => i.hash === null && paths.includes(i.path)).map(i => i.path);
      if (created.length) project.createdFiles = [...new Set([...(project.createdFiles || []), ...created])];
      project.review.applied = candidateId;
      delete project.lastCheck;
      this.save(project, 'code.applied', { provider: candidate.provider, files: paths });
      return project;
    });
  }
  check(id, { command, network = false }) {
    return this.exclusive(id, async (project, signal) => {
      const result = await runCommand(
        { workspace: project.root, execution: { enabled: true, network, timeoutMs: 120000 } },
        { command },
        { signal },
      );
      project.lastCheck = { command, exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr, timedOut: result.timedOut,
        cancelled: result.cancelled, truncated: result.truncated, time: new Date().toISOString() };
      this.save(project, 'code.checked', { command, exitCode: result.exitCode, timedOut: result.timedOut, cancelled: result.cancelled });
      return result;
    });
  }
  remove(id, { force = false } = {}) {
    return this.exclusive(id, async (project) => {
      // Git refuses dirty worktrees unless force is explicitly confirmed. The named branch and commits survive removal.
      const exists = await fs.access(project.root).then(() => true, () => false);
      if (exists) {
        try {
          await git(project.repository, ['worktree', 'remove', ...(force ? ['--force'] : []), '--', project.root]);
        } catch (err) {
          if (!force) throw err;
          // Repo moved/deleted or worktree detached: safely remove managed directory inside this.directory.
          const managedBase = await fs.realpath(this.directory).catch(() => null);
          const rootReal = await fs.realpath(project.root).catch(() => null);
          if (managedBase && rootReal && rootReal.startsWith(managedBase + path.sep)) {
            await fs.rm(rootReal, { recursive: true, force: true });
          }
          await git(project.repository, ['worktree', 'prune']).catch(() => {});
        }
      } else {
        await git(project.repository, ['worktree', 'prune']).catch(() => {});
      }
      const forget = () => this.db.prepare('DELETE FROM desktop_worktrees WHERE id = ?').run(id);
      if (project.chatId && this.store.getTask(project.chatId)) {
        this.store.updateTask(project.chatId, task => {
          forget();
          delete task.codeWorkspace;
        }, 'code.removed', { branch: project.branch });
      } else {
        forget();
      }
      return { branch: project.branch };
    }, { checkBranch: false });
  }
  async close() {
    await Promise.allSettled([...this.attachments.values()].map(item => item.result));
    for (const job of this.jobs.values()) job.controller.abort();
    await Promise.allSettled([...this.jobs.values()].map((job) => job.promise));
  }
}
