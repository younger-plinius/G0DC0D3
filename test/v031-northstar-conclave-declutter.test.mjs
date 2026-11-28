import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createApp } from '../src/server.mjs';
import { applyDomainOutcome, buildConclaveLeaderboard, eloRankTier, emptyLearning } from '../src/learning.mjs';
import { NorthStarManager, extractMetric, isStrictlyBetter, normalizeNorthStarInput } from '../src/northstar.mjs';
import { generateTaskVisualizer, readTaskVisualizerHtml } from '../src/visualizer.mjs';
import { distillSemanticSummary } from '../src/compaction.mjs';
import { gitInit, gitCommit } from '../src/git.mjs';

async function withTempDir(fn) {
  const dir = await fs.mkdtemp(path.join(tmpdir(), 'g0d-v031-suite-'));
  try { return await fn(dir); }
  finally { await fs.rm(dir, { recursive: true, force: true }); }
}

test('v0.3.1 Phase 1 Declutter: 7-tab Settings consolidation, aliases, unified catalog & zero inline style=', async () => {
  const repoRoot = path.resolve(new URL('..', import.meta.url).pathname);
  const [settingsJs, indexHtml, conclaveJs, northstarJs, appJs] = await Promise.all([
    fs.readFile(path.join(repoRoot, 'public', 'settings.js'), 'utf8'),
    fs.readFile(path.join(repoRoot, 'public', 'index.html'), 'utf8'),
    fs.readFile(path.join(repoRoot, 'public', 'conclave.js'), 'utf8'),
    fs.readFile(path.join(repoRoot, 'public', 'northstar.js'), 'utf8'),
    fs.readFile(path.join(repoRoot, 'public', 'app.js'), 'utf8'),
  ]);

  // Exactly 7 top-level Settings panes
  const paneIds = [...settingsJs.matchAll(/<section id="settings-pane-([a-z]+)" role="tabpanel"/g)].map(m => m[1]);
  assert.deepEqual(paneIds, ['general', 'models', 'autonomy', 'tools', 'schedules', 'developer', 'memory']);

  // All legacy aliases resolve cleanly
  for (const legacy of ['notifications', 'shortcuts', 'hypertuner', 'recovery', 'prompts', 'privacy', 'system', 'advanced']) {
    assert.ok(settingsJs.includes(`${legacy}:`), `Legacy Settings alias "${legacy}" must remain mapped`);
  }

  // Models subtabs reduced from 4 to 2 + unified catalog bar present
  const modelSubtabs = [...settingsJs.matchAll(/data-models-subtab="([a-z]+)" role="tab"/g)].map(m => m[1]);
  assert.deepEqual(modelSubtabs, ['connections', 'catalog']);
  assert.ok(settingsJs.includes('id="unified-catalog-bar"'));
  assert.ok(settingsJs.includes('id="unified-catalog-search"'));

  // Compact 2-row sidebar utility strip preserved with all IDs
  assert.ok(indexHtml.includes('class="sidebar-utility-strip"'));
  for (const id of ['theme-toggle', 'overseer-toggle', 'schedules-sidebar-btn', 'about-open', 'settings-open']) {
    assert.ok(indexHtml.includes(`id="${id}"`), `Sidebar control #${id} must remain in DOM`);
  }

  // Zero inline style= attributes in newly touched HTML/JS templates
  for (const [name, src] of [['index.html', indexHtml], ['settings.js', settingsJs], ['conclave.js', conclaveJs], ['northstar.js', northstarJs], ['app.js', appJs]]) {
    const inlineMatch = src.match(/\sstyle\s*=\s*["'`]/);
    assert.equal(inlineMatch, null, `${name} must contain zero inline style= attributes`);
  }
});

test('v0.3.1 Phase 2 Gamified Conclave: local Elo tiers, streaks, leaderboard API & POST /api/tasks/:id/race-crown', async () => {
  // Unit-level Elo rank tiers & streak tracking
  assert.equal(eloRankTier(1700).id, 'plinian');
  assert.equal(eloRankTier(1600).id, 'solar');
  assert.equal(eloRankTier(1540).id, 'aether');
  assert.equal(eloRankTier(1480).id, 'obsidian');
  assert.equal(eloRankTier(1390).id, 'iron');

  let learning = emptyLearning();
  learning = applyDomainOutcome(learning, { domain: 'swe_coding', providerId: 'gemini:neon', opponentId: 'openai:gpt', outcome: 'race_win', margin: 4 });
  learning = applyDomainOutcome(learning, { domain: 'swe_coding', providerId: 'gemini:neon', opponentId: 'anthropic:opus', outcome: 'race_win', margin: 3 });
  learning = applyDomainOutcome(learning, { domain: 'swe_coding', providerId: 'openai:gpt', outcome: 'refusal' });

  const lb = buildConclaveLeaderboard(learning);
  assert.equal(lb.rankings[0].providerId, 'gemini:neon');
  assert.equal(lb.rankings[0].streak, 2);
  assert.equal(lb.rankings[0].gritPct, 100);
  assert.equal(lb.totals.topStreak?.streak, 2);
  const gptRow = lb.rankings.find(r => r.providerId === 'openai:gpt');
  assert.ok(gptRow && gptRow.gritPct < 100, 'Refusal should lower Grit %');

  // HTTP API integration: GET /api/conclave/leaderboard + POST /api/tasks/:id/race-crown
  await withTempDir(async dir => {
    const makeDraftProvider = (id, label, text) => ({
      id,
      label,
      model: id,
      kind: 'http',
      available: true,
      async draft() { return { type: 'message', finish: 'done', text }; },
      async turn() { return { type: 'message', finish: 'done', text }; },
    });
    const judgeProvider = {
      id: 'judge:neon',
      label: 'Gemini 4 Neon Judge',
      model: 'gemini-4-neon',
      kind: 'http',
      available: true,
      async draft(messages) {
        const doc = JSON.parse(messages[1].content);
        const grades = doc.drafts.map((d, i) => ({
          id: d.id,
          fidelity: i === 0 ? 5 : 4,
          completeness: i === 0 ? 5 : 4,
          clarity: 5,
          reason: i === 0 ? 'Sharper technical precision.' : 'Good alternative.',
        }));
        return { type: 'message', finish: 'done', text: JSON.stringify({ winner: doc.drafts[0].id, grades }) };
      },
    };
    const providers = new Map([
      ['writer:a', makeDraftProvider('writer:a', 'Writer Alpha', 'Alpha crisp technical answer.')],
      ['writer:b', makeDraftProvider('writer:b', 'Writer Beta', 'Beta concise alternative answer.')],
      ['judge:neon', judgeProvider],
    ]);
    const app = await createApp({ dataDir: path.join(dir, 'data'), providers, auth: false, startScheduler: false });
    const baseUrl = await app.listen(0);
    try {
      const created = await fetch(`${baseUrl}/api/conversations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-g0d-request': '1' },
        body: JSON.stringify({
          objective: 'Compare lock-free ring buffers.',
          providerIds: ['writer:a'],
          answerRace: { models: ['writer:a', 'writer:b'], judge: 'judge:neon' },
        }),
      }).then(r => r.json());
      await app.runtime.run(created.task.id);

      // Crown Writer B manually via POST /api/tasks/:id/race-crown
      const crownRes = await fetch(`${baseUrl}/api/tasks/${encodeURIComponent(created.task.id)}/race-crown`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-g0d-request': '1' },
        body: JSON.stringify({ winnerId: 'writer:b' }),
      });
      assert.equal(crownRes.status, 200);
      const crown = await crownRes.json();
      assert.equal(crown.ok, true);
      assert.equal(crown.winnerId, 'writer:b');
      assert.ok(crown.delta > 0, `Crowning must award positive Elo delta, got ${crown.delta}`);

      // Repeat crown click on same contender is idempotent (no duplicate Elo farming)
      const repeatCrownRes = await fetch(`${baseUrl}/api/tasks/${encodeURIComponent(created.task.id)}/race-crown`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-g0d-request': '1' },
        body: JSON.stringify({ winnerId: 'writer:b' }),
      });
      assert.equal(repeatCrownRes.status, 200);
      const repeatCrown = await repeatCrownRes.json();
      assert.equal(repeatCrown.alreadyCrowned, true);
      assert.equal(repeatCrown.delta, 0);

      // Conclave snapshot persists owner's crownedWinnerId across reloads
      const snapRes = await fetch(`${baseUrl}/api/tasks/${encodeURIComponent(created.task.id)}/conclave`, {
        headers: { 'x-g0d-request': '1' },
      }).then(r => r.json());
      assert.equal(snapRes.arena?.crownedWinnerId, 'writer:b');

      // Invalid contender rejected with 400
      const badRes = await fetch(`${baseUrl}/api/tasks/${encodeURIComponent(created.task.id)}/race-crown`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-g0d-request': '1' },
        body: JSON.stringify({ winnerId: 'nonexistent:model' }),
      });
      assert.equal(badRes.status, 400);

      // Leaderboard reflects the live Elo & streaks
      const lbRes = await fetch(`${baseUrl}/api/conclave/leaderboard`, { headers: { 'x-g0d-request': '1' } }).then(r => r.json());
      assert.ok(lbRes.rankings.some(r => r.providerId === 'writer:b'), 'Leaderboard must include crowned contender');
    } finally {
      await app.close();
    }
  });
});

test('v0.3.1 Phase 3 North Star AutoResearch: git-atomic keep/revert, guardrails, scope lock, steering, plateau & crash-proof resume', async () => {
  // Metric extraction & comparator unit checks
  assert.equal(extractMetric('step 10\nval_bpb: 1.2450\n', { metricMode: 'regex', metricPattern: 'val_bpb:\\s*([0-9.]+)' }), 1.245);
  assert.equal(extractMetric('{"summary":{"score":92.5}}', { metricMode: 'json', metricPattern: 'summary.score' }), 92.5);
  assert.equal(isStrictlyBetter(1.10, 1.25, 'minimize'), true);
  assert.equal(isStrictlyBetter(1.30, 1.25, 'minimize'), false);
  assert.equal(isStrictlyBetter(95, 90, 'maximize'), true);

  await withTempDir(async dir => {
    const repo = path.join(dir, 'repo');
    await fs.mkdir(repo);
    await fs.writeFile(path.join(repo, 'algo.mjs'), 'export const SCORE = 100;\nexport const VALID = true;\n');
    await fs.writeFile(path.join(repo, 'eval.mjs'), "import { SCORE } from './algo.mjs'; console.log('loss: ' + SCORE);\n");
    await fs.writeFile(path.join(repo, 'guard.mjs'), "import { VALID } from './algo.mjs'; if (!VALID) process.exit(1);\n");
    await gitInit(repo);
    await gitCommit(repo, { message: 'initial baseline' });

    const seenStages = [];
    const seenSteering = [];
    let step = 0;
    const manager = new NorthStarManager({
      dataDir: path.join(dir, 'state'),
      iterationRunner: async ({ worktreePath, stage, steeringNotes }) => {
        step += 1;
        seenStages.push(stage);
        if (steeringNotes.length) seenSteering.push(...steeringNotes.map(n => n.note));
        if (step === 1) {
          // Iter 1: Improvement (100 -> 70) => MUST BE KEPT & COMMITTED
          await fs.writeFile(path.join(worktreePath, 'algo.mjs'), 'export const SCORE = 70;\nexport const VALID = true;\n');
          return { hypothesis: 'Vectorize inner loop', providerId: 'model:a' };
        }
        if (step === 2) {
          // Iter 2: Scope violation (modifies locked eval.mjs!) => MUST BE REVERTED
          await fs.writeFile(path.join(worktreePath, 'eval.mjs'), "console.log('loss: 1');\n");
          return { hypothesis: 'Cheat eval script', providerId: 'model:a' };
        }
        if (step === 3) {
          // Iter 3: Guardrail failure (VALID=false despite score=10) => MUST BE REVERTED
          await fs.writeFile(path.join(worktreePath, 'algo.mjs'), 'export const SCORE = 10;\nexport const VALID = false;\n');
          return { hypothesis: 'Skip validation', providerId: 'model:a' };
        }
        if (step === 4) {
          // Iter 4: Regression (70 -> 85) => MUST BE REVERTED (triggers plateau escalation!)
          await fs.writeFile(path.join(worktreePath, 'algo.mjs'), 'export const SCORE = 85;\nexport const VALID = true;\n');
          return { hypothesis: 'Over-unroll loop', providerId: 'model:a' };
        }
        // Iter 5: Target hit (70 -> 45 <= 50) => KEPT & RUN COMPLETES!
        await fs.writeFile(path.join(worktreePath, 'algo.mjs'), 'export const SCORE = 45;\nexport const VALID = true;\n');
        return { hypothesis: 'Cache-oblivious layout', providerId: 'model:b' };
      },
    });
    await manager.init();

    const run = await manager.createRun({
      name: 'Loss Minimizer',
      goal: 'Minimize loss in algo.mjs without breaking guard.mjs or touching eval.mjs.',
      repoPath: repo,
      evalCommand: 'node eval.mjs',
      guardrailCommand: 'node guard.mjs',
      metricMode: 'regex',
      metricPattern: 'loss:\\s*([0-9.]+)',
      direction: 'minimize',
      editableFiles: ['algo.mjs'],
      maxIterations: 8,
      plateauThreshold: 2,
      reflectEvery: 4,
      targetScore: 50,
      beamWidth: 2,
      keepAwake: false,
    });
    await manager.steerRun(run.id, 'Focus on cache locality');
    manager.startRun(run.id);
    const done = await manager.waitForRun(run.id);

    assert.equal(done.status, 'completed');
    assert.equal(done.baselineScore, 100);
    assert.equal(done.bestScore, 45);
    assert.equal(done.keptCount, 2);
    assert.equal(done.revertedCount, 3);
    assert.ok(seenSteering.includes('Focus on cache locality'), 'Steering directive must be delivered to next iteration');
    assert.ok(seenStages.includes('refactor'), 'Plateau threshold must escalate strategy stage');
    assert.ok(done.reflections.length >= 1, 'Periodic meta-reflection must be recorded');

    const exps = await manager.getExperiments(run.id);
    assert.deepEqual(exps.map(e => e.status), ['kept', 'scope_violation', 'guardrail_failed', 'reverted', 'kept']);

    // Verify locked eval.mjs was untouched and champion diff applies cleanly back to source repo!
    const evalText = await fs.readFile(path.join(done.worktreePath, 'eval.mjs'), 'utf8');
    assert.ok(evalText.includes("import { SCORE }"), 'Locked eval.mjs must remain intact after scope violation revert');
    const diffRes = await manager.getChampionDiff(run.id);
    assert.ok(diffRes.diff.includes('SCORE = 45'));
    const applied = await manager.applyChampionToRepo(run.id);
    assert.equal(applied.applied, true);
    const updatedRepoAlgo = await fs.readFile(path.join(repo, 'algo.mjs'), 'utf8');
    assert.ok(updatedRepoAlgo.includes('SCORE = 45'), 'Champion patch must apply cleanly to source repo');

    // Pausing an already-completed run must keep it completed (never resurrect to paused)
    const afterPause = await manager.pauseRun(run.id);
    assert.equal(afterPause.status, 'completed');

    // Hardening checks: ReDoS brace-quantifier guard + JSON prototype traversal block
    assert.throws(() => normalizeNorthStarInput({
      goal: 'x', repoPath: repo, evalCommand: 'node eval.mjs', metricMode: 'regex', metricPattern: '([0-9]+){2,}',
    }), /nested quantifiers/i);
    assert.equal(extractMetric('{"score":42}', { metricMode: 'json', metricPattern: 'constructor.length' }), null);

    // Crash-proof persistence across fresh NorthStarManager restart
    await manager.close();
    const restored = new NorthStarManager({ dataDir: path.join(dir, 'state') });
    await restored.init();
    const loaded = restored.getRun(run.id);
    assert.equal(loaded.bestScore, 45);
    assert.equal(loaded.keptCount, 2);
    await restored.deleteRun(run.id);
    await restored.close();
  });
});

test('v0.3.1 Debug Pass 2 regressions: Conclave refusal failover, qa-preview 400 guard, ephemeral skill delete & XP gate', async () => {
  await withTempDir(async dir => {
    const refusingPrimary = {
      id: 'prov:refuse',
      label: 'Timid Primary',
      model: 'timid-primary',
      kind: 'http',
      available: true,
      async draft() { return { type: 'message', finish: 'refusal', text: 'I cannot assist with this request.' }; },
      async turn() { return { type: 'message', finish: 'done', text: 'Specialist findings from primary.' }; },
    };
    const helpfulBackup = {
      id: 'prov:backup',
      label: 'Helpful Backup',
      model: 'helpful-backup',
      kind: 'http',
      available: true,
      async draft() { return { type: 'message', finish: 'done', text: '## Final Council Verdict\nActionable synthesis from backup.' }; },
      async turn() { return { type: 'message', finish: 'done', text: 'Specialist findings from backup.' }; },
    };
    const providers = new Map([
      ['prov:refuse', refusingPrimary],
      ['prov:backup', helpfulBackup],
    ]);
    const app = await createApp({ dataDir: path.join(dir, 'data'), providers, auth: false, startScheduler: false });
    const baseUrl = await app.listen(0);
    try {
      // 1. Conclave Lead Synthesizer fails over past refusing primary to backup
      const launchRes = await fetch(`${baseUrl}/api/conclave/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-g0d-request': '1' },
        body: JSON.stringify({ mission: 'Audit lock-free queue edge cases', agents: ['explore'], mode: 'parallel', providerIds: ['prov:refuse', 'prov:backup'] }),
      });
      assert.equal(launchRes.status, 202);
      const launched = await launchRes.json();
      const taskId = launched.task.id;
      const runEntry = app.runtime.runs.get(taskId);
      if (runEntry?.promise) await runEntry.promise;
      const events = app.runtime.getEvents(taskId);
      const finalResp = [...events].reverse().find(e => e.type === 'model.response');
      assert.equal(finalResp?.data?.providerId, 'prov:backup', 'Synthesizer must fail over from refusing primary to backup');
      assert.ok(finalResp?.data?.response?.text?.includes('Final Council Verdict'));

      // 2. Malformed qa-preview URL returns clean 400 (never 500)
      const qaRes = await fetch(`${baseUrl}/api/tasks/${encodeURIComponent(taskId)}/browser/qa-preview`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-g0d-request': '1' },
        body: JSON.stringify({ url: 'http://[bad-host' }),
      });
      assert.equal(qaRes.status, 400);

      // 3. Ephemeral session blocks DELETE /api/skills/:name and Conclave XP persistence
      app.runtime.updatePrivacy({ ephemeralSession: true });
      const delSkillRes = await fetch(`${baseUrl}/api/skills/nonexistent-skill`, {
        method: 'DELETE',
        headers: { 'x-g0d-request': '1' },
      });
      assert.equal(delSkillRes.status, 403);
      const xpBefore = app.runtime.store.getLocalState('conclave_agent_xp', {});
      app.runtime.recordConclaveAgentRun('ephemeral-test-agent', { ok: true, durationMs: 120 });
      const xpAfter = app.runtime.store.getLocalState('conclave_agent_xp', {});
      assert.equal(xpAfter['ephemeral-test-agent'], undefined, 'Ephemeral session must not persist Conclave agent XP');
      assert.deepEqual(xpAfter, xpBefore);
    } finally {
      await app.close();
    }
  });
});

test('v0.3.1 Debug Pass 3 regressions: visualizer CSP strip & reasoning-locked temp omit + compaction temp omit', async () => {
  await withTempDir(async dir => {
    let vizGenSeen = null;
    let compactGenSeen = null;
    const lockedProvider = {
      id: 'openai:gpt-5.4',
      label: 'GPT-5.4',
      model: 'gpt-5.4',
      kind: 'http',
      protocol: 'openai-chat',
      available: true,
      async draft(msgs, _sig, _tok, gen) {
        if (msgs[0]?.content?.includes('Visualizer')) {
          vizGenSeen = gen;
          return {
            type: 'message',
            finish: 'done',
            text: '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src *"><title>Viz</title></head><body><h1>OK</h1></body></html>',
          };
        }
        compactGenSeen = gen;
        return {
          type: 'message',
          finish: 'done',
          text: JSON.stringify({ goalAndState: 'All good', decisions: ['Ship cleanly'], ruledOut: [], constraintsAndPrefs: [], nextStep: 'Verify' }),
        };
      },
    };
    const viz = await generateTaskVisualizer({
      dataDir: dir,
      task: { id: 'task-viz-1', title: 'Test', objective: 'Test', status: 'running' },
      events: [],
      files: [],
      provider: lockedProvider,
    });
    assert.equal(viz.ok, true);
    assert.equal(vizGenSeen?.temperature, undefined, 'Visualizer must omit temperature on sampling-locked gpt-5/o3 models');
    const html = await readTaskVisualizerHtml(dir, 'task-viz-1');
    assert.ok(html.includes("default-src 'none'"), 'Strict offline meta CSP must be injected');
    assert.ok(!html.includes('default-src *'), 'Permissive model-supplied CSP meta tag must be stripped');

    const distilled = await distillSemanticSummary({
      provider: lockedProvider,
      task: { objective: 'Verify compaction' },
      structuralSummary: {},
      foldedEvents: [{ seq: 1, type: 'user.message', data: { message: 'Remember to keep zero dependencies.' } }],
    });
    assert.ok(distilled?.goalAndState === 'All good');
    assert.equal(compactGenSeen?.temperature, undefined, 'Semantic compaction must omit temperature on sampling-locked gpt-5/o3 models');
  });
});
