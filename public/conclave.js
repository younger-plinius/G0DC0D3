'use strict';

(function initG0DConclave() {
  const ROLE_COLORS = {
    explore: '#60a5fa',
    builder: '#34d399',
    designer: '#f472b6',
    reviewer: '#a78bfa',
    analyst: '#38bdf8',
    strategist: '#fbbf24',
    uncensored: '#f472b6',
    solver: '#34d399',
    challenger: '#fbbf24',
    verifier: '#2dd4bf',
    judge: '#f59e0b',
    default: '#c084fc',
  };

  const CONCLAVE_MODES = [
    { id: 'parallel', label: '◈ Parallel Squad', hint: 'Specialists tackle distinct angles concurrently, then the lead synthesizes one cohesive deliverable.' },
    { id: 'critique', label: '⚡ Draft & Critique', hint: 'Lead specialist builds or drafts while reviewers stress-test edge cases, logic, and polish.' },
    { id: 'debate',   label: '⚖ Council Debate',  hint: 'Specialists argue competing options and tradeoffs before converging on a verified recommendation.' },
    { id: 'race',     label: '⚔ Blind Race',      hint: 'Race 2–4 distinct model families blind head-to-head; our tastemaker Judge grades and awards local Elo.' },
  ];

  const LONG_FORM_TEMPLATES = [
    { id: 'fullstack',   icon: '⌘', label: 'Full-Stack Build',   mode: 'critique', agents: ['builder', 'designer', 'reviewer'],    prompt: 'Design and build a complete end-to-end feature with clean API contracts, responsive UI, and automated tests for: ' },
    { id: 'audit',       icon: '◈', label: 'Codebase Audit',     mode: 'parallel', agents: ['explore', 'reviewer', 'builder'],     prompt: 'Map this codebase architecture, audit for subtle bugs and technical debt, and produce a safe step-by-step refactor plan for: ' },
    { id: 'research',    icon: '◎', label: 'Deep Research',      mode: 'parallel', agents: ['explore', 'analyst', 'strategist'],   prompt: 'Conduct a thorough multi-source research report with comparison tables, key tradeoffs, and concrete recommendations on: ' },
    { id: 'design',      icon: '✦', label: 'UI & Design System', mode: 'critique', agents: ['designer', 'builder', 'reviewer'],    prompt: 'Create a cohesive UI design system, interactive layout prototype, and accessibility review for: ' },
    { id: 'quant',       icon: 'λ', label: 'Data & Quant Model', mode: 'critique', agents: ['analyst', 'explore', 'strategist'],   prompt: 'Build a rigorous quantitative analysis with explicit assumptions, sensitivity scenarios, and an executive summary for: ' },
    { id: 'rfc',         icon: '▤', label: 'Architecture RFC',   mode: 'debate',   agents: ['explore', 'analyst', 'strategist'],   prompt: 'Author a complete technical RFC comparing competing architectures, failure modes, scaling limits, and migration phases for: ' },
    { id: 'gtm',         icon: 'Δ', label: 'Launch & GTM Plan',  mode: 'parallel', agents: ['strategist', 'explore', 'designer'],  prompt: 'Develop a full go-to-market strategy covering positioning, audience segments, launch assets, and rollout milestones for: ' },
    { id: 'incident',    icon: '⚡', label: 'Root-Cause Triage',  mode: 'parallel', agents: ['explore', 'reviewer', 'analyst'],     prompt: 'Investigate the root cause across code paths and logs, verify reproduction steps, and propose a hardened permanent fix for: ' },
    { id: 'migration',   icon: '⇄', label: 'Migration Roadmap',  mode: 'debate',   agents: ['explore', 'builder', 'analyst'],      prompt: 'Design a zero-downtime multi-phase migration plan with rollback gates, data validation checks, and risk mitigation for: ' },
    { id: 'decision',    icon: '⚖', label: 'Decision Council',   mode: 'debate',   agents: ['explore', 'analyst', 'strategist'],   prompt: 'Run a devil’s-advocate debate weighing competing options, hidden risks, and second-order effects to reach a clear verdict on: ' },
  ];

  const DEFAULT_STARTER_AGENTS = [
    { slug: 'explore',    name: 'Research Analyst',     sigil: '◈', primarySpecialty: 'long_context' },
    { slug: 'builder',    name: 'Full-Stack Builder',   sigil: '⌘', primarySpecialty: 'swe_coding' },
    { slug: 'designer',   name: 'UI & Design Engineer', sigil: '✦', primarySpecialty: 'frontend_ui' },
    { slug: 'reviewer',   name: 'Code & QA Reviewer',   sigil: '⚡', primarySpecialty: 'swe_coding' },
    { slug: 'analyst',    name: 'Data & Math Reasoner', sigil: 'λ', primarySpecialty: 'math_reasoning' },
    { slug: 'strategist', name: 'Writer & Strategist',  sigil: 'Δ', primarySpecialty: 'creative_writing' },
  ];

  let launchMission = '';
  let launchMode = 'parallel'; // 'parallel' | 'critique' | 'debate'
  let launchManualTeam = false;
  let launchManualMode = false;
  let launchReasonLabel = '';
  let launchTeam = new Set(['explore', 'builder', 'reviewer']);
  let activeTemplateId = null;
  let forceShowLaunchpad = false;

  const STATUS_META = {
    thinking:   { label: 'Thinking',   tone: 'violet', active: true },
    streaming:  { label: 'Streaming',  tone: 'violet', active: true },
    tool:       { label: 'Tool',       tone: 'amber',  active: true },
    recovering: { label: 'GODMODƎ',    tone: 'gold',   active: true },
    completed:  { label: 'Verified',   tone: 'sage',   active: false },
    failed:     { label: 'Failed',     tone: 'coral',  active: false },
    paused:     { label: 'Paused',     tone: 'amber',  active: false },
    queued:     { label: 'Queued',     tone: 'muted',  active: false },
  };

  let isOpenState = false;
  let isExpanded = false;
  let activeLens = 'stage'; // 'stage' | 'cards' | 'timeline'
  let currentTaskId = null;
  let data = null;
  let selectedWorkerId = null;
  let hoveredWorkerId = null;
  let demoMode = false;
  let demoTimer = null;
  let rafId = null;
  let animPhase = 0;
  let lastFrameMs = 0;
  let autoOpenedTaskIds = new Set();
  let stageHitTargets = [];
  let timelineHitTargets = [];
  let fetchToken = 0;
  let rosterData = null;
  let selectedSquad = new Set();
  let builderOpen = false;
  let builderDraft = null;
  let builderStats = null;
  let builderBestEngine = null;
  let formationFormOpen = false;
  let replayPlaying = false;
  let replayProgress = 100; // 0..100
  let blindMode = false;
  let blindRevealedRaceId = null;
  let leaderboardData = null;
  let crownedByRace = new Map();
  const SIGILS = ['✦', '⚡', '◈', '⛨', '⌘', 'λ', 'Ω', 'Δ'];

  function rankTierForElo(elo = 1500) {
    const v = Number(elo) || 1500;
    if (v >= 1660) return { id: 'plinian', label: 'Plinian', sigil: '✦' };
    if (v >= 1580) return { id: 'solar', label: 'Solar', sigil: '☀' };
    if (v >= 1520) return { id: 'aether', label: 'Aether', sigil: '◈' };
    if (v >= 1450) return { id: 'obsidian', label: 'Obsidian', sigil: '◆' };
    return { id: 'iron', label: 'Iron', sigil: '◇' };
  }

  function playTactileCue(kind = 'completed') {
    try {
      const cfg = window.G0DAlerts?.getSettings?.();
      if (cfg && cfg.soundsEnabled && !cfg.muted) {
        window.G0DAlerts.playSound(kind, { force: false });
      }
    } catch {}
  }

  function computeSquadSynergy(slugs) {
    const allAgents = rosterData?.agents?.length ? rosterData.agents : DEFAULT_STARTER_AGENTS;
    const picked = [...slugs].map(s => allAgents.find(a => a.slug === s)).filter(Boolean);
    if (!picked.length) return { ovr: 0, tier: rankTierForElo(1500), families: 0, specs: [], hint: 'Pick 1–4 specialists' };
    const specs = [...new Set(picked.map(a => String(a.primarySpecialty || 'general').replace(/_/g, ' ')))];
    const engines = new Set(picked.map(a => a.engineLabel || a.resolvedProviderId || a.slug));
    const avgOvr = Math.round(picked.reduce((s, a) => s + Number(a.stats?.overall || 86), 0) / picked.length);
    const estElo = 1380 + Math.round((avgOvr - 70) * 10);
    const diversityBonus = engines.size >= 3 ? '+3 Family Synergy' : engines.size === 2 ? '+2 Dual-Family' : 'Single Engine';
    return { ovr: avgOvr, tier: rankTierForElo(estElo), families: engines.size, specs, diversityBonus };
  }

  const esc = (s) => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const fmtTokens = (n) => {
    const v = Number(n || 0);
    if (!v) return '';
    return v >= 1000 ? `~${(v / 1000).toFixed(1)}k tok` : `~${v} tok`;
  };
  const fmtCost = (usd) => {
    const v = Number(usd || 0);
    if (!v) return 'Free';
    if (v < 0.001) return '<$0.001';
    return `$${v.toFixed(3)}`;
  };

  const fmtMs = (ms) => {
    const n = Number(ms || 0);
    if (!n || n < 0) return '0.0s';
    if (n < 1000) return `${Math.round(n)}ms`;
    if (n < 60000) return `${(n / 1000).toFixed(1)}s`;
    return `${Math.floor(n / 60000)}m ${Math.round((n % 60000) / 1000)}s`;
  };

  const shortModel = (label) => {
    if (!label) return 'Auto';
    return String(label).replace(/\s*·\s*(OpenRouter|Venice|Anthropic|OpenAI|Gemini|Nous).*$/i, '').slice(0, 24);
  };

  const roleColor = (role) => ROLE_COLORS[String(role || '').toLowerCase()] || ROLE_COLORS.default;
  const statusInfo = (status) => STATUS_META[String(status || 'queued').toLowerCase()] || STATUS_META.queued;

  function themePalette() {
    const cs = getComputedStyle(document.documentElement);
    const isLight = document.documentElement.dataset.theme === 'light';
    return {
      isLight,
      bg: cs.getPropertyValue('--surface').trim() || (isLight ? '#f7f5f0' : '#121315'),
      panel: cs.getPropertyValue('--panel').trim() || (isLight ? '#ffffff' : '#191b1f'),
      line: cs.getPropertyValue('--line').trim() || (isLight ? 'rgba(20,24,31,0.12)' : 'rgba(255,255,255,0.1)'),
      text: cs.getPropertyValue('--text').trim() || (isLight ? '#18191b' : '#f4f4f6'),
      muted: cs.getPropertyValue('--text-muted').trim() || (isLight ? '#646873' : '#8d92a0'),
      violet: cs.getPropertyValue('--violet').trim() || (isLight ? '#6d28d9' : '#a78bfa'),
      sage: cs.getPropertyValue('--sage').trim() || (isLight ? '#15803d' : '#4ade80'),
      amber: '#f59e0b',
      gold: '#fbbf24',
      coral: '#f87171',
      blue: '#60a5fa',
    };
  }

  function motionReduced() {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return true;
    try {
      const qol = window.G0DQol?.get?.();
      if (qol?.pauseBackdrop) return true;
    } catch {}
    return false;
  }

  function dockEl() { return document.getElementById('conclave-dock'); }

  function ensureShell() {
    const dock = dockEl();
    if (!dock || dock.dataset.conclaveInit) return dock;
    dock.dataset.conclaveInit = '1';
    dock.innerHTML = `
      <header class="conclave-header">
        <div class="conclave-title-wrap">
          <span class="conclave-sigil" aria-hidden="true">✦</span>
          <div class="conclave-title-copy">
            <h2 class="conclave-title">THE CONCLAVE</h2>
            <p class="conclave-subtitle" id="conclave-subtitle">Multi-Agent Conclave Stage</p>
          </div>
        </div>
        <div class="conclave-header-controls">
          <div class="conclave-lenses" role="tablist" aria-label="Conclave views">
            <button type="button" class="conclave-lens active" role="tab" aria-selected="true" data-conclave-lens="stage">✦ Stage</button>
            <button type="button" class="conclave-lens" role="tab" aria-selected="false" data-conclave-lens="cards">▤ Cards</button>
            <button type="button" class="conclave-lens" role="tab" aria-selected="false" data-conclave-lens="timeline">◫ Timeline</button>
            <button type="button" class="conclave-lens" role="tab" aria-selected="false" data-conclave-lens="roster">⛨ Roster</button>
            <button type="button" class="conclave-lens" role="tab" aria-selected="false" data-conclave-lens="ranks">🏆 Ranks</button>
          </div>
          <button type="button" class="icon-button conclave-expand-btn" id="conclave-expand" title="Expand or restore Conclave stage" aria-label="Expand Conclave stage" aria-pressed="false">⤢</button>
          <button type="button" class="icon-button" id="conclave-close" title="Close Conclave" aria-label="Close Conclave">×</button>
        </div>
      </header>
      <div class="conclave-telemetry-bar" id="conclave-telemetry-bar">
        <span class="conclave-mode-pill" id="conclave-mode-pill">Standby</span>
        <div class="conclave-stat"><span class="conclave-stat-label">Active</span><strong id="conclave-stat-active">0</strong></div>
        <div class="conclave-stat"><span class="conclave-stat-label">Done</span><strong id="conclave-stat-done">0</strong></div>
        <div class="conclave-stat"><span class="conclave-stat-label">Calls</span><strong id="conclave-stat-calls">0</strong></div>
        <div class="conclave-stat"><span class="conclave-stat-label">Overlaps</span><strong id="conclave-stat-conflicts">0</strong></div>
        <div class="conclave-stat hidden" id="conclave-stat-cost-wrap"><span class="conclave-stat-label">Cost</span><strong id="conclave-stat-cost">$0.000</strong></div>
        <div class="conclave-telemetry-actions">
          <button type="button" class="button button-quiet hidden" id="conclave-new-mission-btn" title="Configure and launch another Conclave mission">+ New Mission</button>
          <button type="button" class="button button-quiet conclave-demo-toggle" id="conclave-demo-btn" title="Preview an interactive multi-agent constellation">Preview Swarm</button>
        </div>
      </div>
      <div class="conclave-replay-bar hidden" id="conclave-replay-bar" aria-label="Conclave Time-Travel Replay">
        <button type="button" class="button button-quiet conclave-replay-btn" id="conclave-replay-toggle">▶ Replay 4×</button>
        <input type="range" class="conclave-replay-scrub" id="conclave-replay-scrub" min="0" max="100" value="100" aria-label="Scrub replay timeline">
        <span class="conclave-replay-time" id="conclave-replay-time">LIVE</span>
      </div>
      <div class="conclave-approval-strip hidden" id="conclave-approval-strip" role="alert">
        <div class="conclave-approval-copy">
          <span class="conclave-approval-badge">Approval Needed</span>
          <code id="conclave-approval-tool"></code>
          <span id="conclave-approval-reason"></span>
        </div>
        <div class="conclave-approval-btns">
          <button type="button" class="button button-primary" data-conclave-approve="once">Allow once</button>
          <button type="button" class="button button-danger" data-conclave-approve="deny">Deny</button>
        </div>
      </div>
      <div class="conclave-stage-body">
        <section class="conclave-view conclave-stage-view" id="conclave-view-stage" role="tabpanel">
          <canvas id="conclave-canvas" class="conclave-canvas" aria-label="Interactive multi-agent constellation stage"></canvas>
          <div class="conclave-standby-bar hidden" id="conclave-standby-bar">
            <div class="clp-head">
              <div>
                <h3 class="clp-title">Start a Conclave</h3>
                <p class="conclave-standby-copy">Describe any long-form goal — Conclave auto-picks the right specialists and runs them together live.</p>
              </div>
              <button type="button" class="button button-quiet clp-auto-btn" id="conclave-auto-pick" title="Auto-select best specialists for your mission">✦ Auto-Pick</button>
            </div>
            <div class="clp-templates" id="conclave-templates" aria-label="Long-form task starters">
              ${LONG_FORM_TEMPLATES.map(t => `<button type="button" class="clp-tpl-chip" data-conclave-template="${esc(t.id)}" aria-pressed="false" title="${esc(t.prompt)}"><span>${esc(t.icon)}</span>${esc(t.label)}</button>`).join('')}
            </div>
            <textarea id="conclave-mission-input" class="clp-mission-input" rows="3" maxlength="4000" placeholder="What long-form mission should your team tackle? (e.g. Audit our auth flow and write a refactor plan, or draft a Q3 GTM launch brief…)" aria-label="Conclave mission goal"></textarea>
            <div class="clp-row">
              <div class="clp-section-label"><span>Team</span><span class="clp-team-meta" id="conclave-team-meta">Auto-matched</span></div>
              <div class="clp-team-pills" id="conclave-team-pills" role="group" aria-label="Select specialists"></div>
              <div class="conclave-synergy-bar" id="conclave-synergy-bar" aria-live="polite"></div>
            </div>
            <div class="clp-row">
              <div class="clp-section-label"><span>How they work</span></div>
              <div class="clp-mode-tabs" role="group" aria-label="Conclave workflow mode">
                ${CONCLAVE_MODES.map(m => `<button type="button" class="clp-mode-btn ${m.id === launchMode ? 'active' : ''}" data-conclave-mode="${esc(m.id)}" aria-pressed="${m.id === launchMode ? 'true' : 'false'}">${esc(m.label)}</button>`).join('')}
              </div>
              <p class="clp-mode-hint" id="conclave-mode-hint"></p>
            </div>
            <div class="clp-actions">
              <button type="button" class="button button-primary clp-launch-btn" id="conclave-launch-btn">✦ Launch Conclave →</button>
              <button type="button" class="button button-secondary" id="conclave-stage-to-composer" title="Load orchestrated brief into chat composer to review first">Edit in Chat</button>
              <div class="clp-links">
                <button type="button" class="button button-quiet" data-conclave-preset="roster">⛨ Roster</button>
                <button type="button" class="button button-quiet" data-conclave-preset="forge">⚒ Forge</button>
                <button type="button" class="button button-quiet" data-conclave-preset="arena">⚡ Race</button>
              </div>
            </div>
            <div class="conclave-standby-formations hidden" id="conclave-standby-formations"></div>
          </div>
          <div class="conclave-diff-actions hidden" id="conclave-diff-actions"></div>
          <div class="conclave-round-banner hidden" id="conclave-round-banner" aria-live="polite"></div>
          <div class="conclave-live-ticker hidden" id="conclave-live-ticker" aria-label="Live latent activity feed"></div>
          <div class="conclave-legend" id="conclave-legend">
            <span><i class="p-dot p-dot-violet"></i>Streaming</span>
            <span><i class="p-dot p-dot-amber"></i>Tool</span>
            <span><i class="p-dot p-dot-gold"></i>GODMODƎ</span>
            <span><i class="p-dot p-dot-sage"></i>Verified</span>
            <span class="conclave-legend-hint">Click any node to inspect or steer</span>
          </div>
        </section>
        <section class="conclave-view conclave-cards-view hidden" id="conclave-view-cards" role="tabpanel"></section>
        <section class="conclave-view conclave-timeline-view hidden" id="conclave-view-timeline" role="tabpanel">
          <canvas id="conclave-timeline-canvas" class="conclave-timeline-canvas" aria-label="Parallel worker execution timeline"></canvas>
          <div class="conclave-timeline-empty hidden" id="conclave-timeline-empty">No worker runs recorded yet. Launch a squad or click <strong>Preview Swarm</strong> above.</div>
        </section>
        <section class="conclave-view conclave-roster-view hidden" id="conclave-view-roster" role="tabpanel"></section>
        <section class="conclave-view conclave-ranks-view hidden" id="conclave-view-ranks" role="tabpanel"></section>
      </div>
      <section class="conclave-inspector hidden" id="conclave-inspector" aria-label="Worker inspector">
        <header class="conclave-inspector-head">
          <div class="conclave-inspector-title">
            <span class="conclave-role-chip" id="pi-role">explore</span>
            <strong id="pi-model">Model</strong>
            <span class="conclave-status-pill" id="pi-status">Streaming</span>
          </div>
          <button type="button" class="icon-button" id="pi-close" aria-label="Close worker inspector">×</button>
        </header>
        <div class="conclave-inspector-meta" id="pi-meta"></div>
        <div class="conclave-inspector-files hidden" id="pi-files"></div>
        <pre class="conclave-inspector-output" id="pi-output"></pre>
        <form class="conclave-steer-form" id="pi-steer-form" autocomplete="off">
          <input type="text" id="pi-steer-input" placeholder="Steer this worker or redirect its focus…" aria-label="Steer worker" maxlength="1000">
          <button type="submit" class="button button-primary">Steer →</button>
        </form>
      </section>
    `;

    dock.addEventListener('click', (e) => {
      const lensBtn = e.target.closest('[data-conclave-lens]');
      if (lensBtn) { setLens(lensBtn.dataset.conclaveLens); return; }
      if (e.target.closest('#conclave-close')) { close(); return; }
      if (e.target.closest('#conclave-expand')) { toggleExpand(); return; }
      if (e.target.closest('#pi-close')) { selectWorker(null); return; }
      if (e.target.closest('#conclave-demo-btn')) { forceShowLaunchpad = false; toggleDemo(); return; }
      if (e.target.closest('#conclave-new-mission-btn')) { forceShowLaunchpad = !forceShowLaunchpad; setLens('stage'); renderAll(); if (forceShowLaunchpad) document.getElementById('conclave-mission-input')?.focus(); return; }
      if (e.target.closest('#conclave-replay-toggle')) { toggleReplay(); return; }
      if (e.target.closest('[data-conclave-blind-toggle]')) {
        blindMode = !blindMode;
        if (!blindMode && data?.arena?.raceId) blindRevealedRaceId = data.arena.raceId;
        renderCards();
        return;
      }
      const crownBtn = e.target.closest('[data-conclave-crown]');
      if (crownBtn) {
        crownContender(crownBtn.dataset.conclaveCrown, crownBtn.dataset.conclaveRaceId || null);
        return;
      }
      if (e.target.closest('[data-conclave-copy-match]')) {
        copyMatchCard();
        return;
      }
      if (e.target.closest('#conclave-ranks-refresh')) {
        loadLeaderboard();
        return;
      }
      const preset = e.target.closest('[data-conclave-preset]');
      if (preset) { triggerPreset(preset.dataset.conclavePreset); return; }
      const tplBtn = e.target.closest('[data-conclave-template]');
      if (tplBtn) { applyLaunchTemplate(tplBtn.dataset.conclaveTemplate); return; }
      const teamChip = e.target.closest('[data-launch-agent]');
      if (teamChip) { toggleLaunchAgent(teamChip.dataset.launchAgent); return; }
      const modeBtn = e.target.closest('[data-conclave-mode]');
      if (modeBtn) { setLaunchMode(modeBtn.dataset.conclaveMode); return; }
      if (e.target.closest('#conclave-auto-pick')) {
        activeTemplateId = null;
        launchManualTeam = false;
        launchManualMode = false;
        applyAutoRecommendation(launchMission || document.getElementById('conclave-mission-input')?.value || '');
        if (typeof window.toast === 'function') window.toast('✦ Auto-matched specialists to your mission.');
        return;
      }
      if (e.target.closest('#conclave-launch-btn')) { launchConclaveFromPad({ autoSend: true }); return; }
      if (e.target.closest('#conclave-stage-to-composer')) { launchConclaveFromPad({ autoSend: false }); return; }
      const formLaunch = e.target.closest('[data-formation-launch]');
      if (formLaunch) { deployFormation(formLaunch.dataset.formationLaunch); return; }
      const formDel = e.target.closest('[data-formation-delete]');
      if (formDel) { e.stopPropagation(); deleteFormation(formDel.dataset.formationDelete); return; }
      const adoptBtn = e.target.closest('[data-diff-adopt]');
      if (adoptBtn) { adoptDiffCandidate(adoptBtn.dataset.diffWt, adoptBtn.dataset.diffAdopt); return; }
      const cardBtn = e.target.closest('[data-conclave-select]');
      if (cardBtn) { selectWorker(cardBtn.dataset.conclaveSelect); return; }
      const tickerRow = e.target.closest('[data-ticker-select]');
      if (tickerRow) { selectWorker(tickerRow.dataset.tickerSelect); return; }
      const approveBtn = e.target.closest('[data-conclave-approve]');
      if (approveBtn) { resolveApprovalFromConclave(approveBtn.dataset.conclaveApprove); return; }
      if (e.target.closest('#roster-forge-new')) { openBuilder(null); return; }
      if (e.target.closest('#roster-deploy-squad')) { deploySelectedSquad(); return; }
      if (e.target.closest('#roster-save-formation-toggle')) { formationFormOpen = !formationFormOpen; renderRosterView(); return; }
      if (e.target.closest('#rf-cancel')) { formationFormOpen = false; renderRosterView(); return; }
      const harnessChip = e.target.closest('[data-roster-harness]');
      if (harnessChip) { openBuilderForHarness(harnessChip.dataset.rosterHarness); return; }
      const archBtn = e.target.closest('[data-pb-archetype]');
      if (archBtn) { applyArchetypeToDraft(archBtn.dataset.pbArchetype); return; }
      const sigilBtn = e.target.closest('[data-pb-sigil]');
      if (sigilBtn && builderDraft) { syncDraftTextFieldsFromDom(); builderDraft.sigil = sigilBtn.dataset.pbSigil; renderRosterView(); return; }
      if (e.target.closest('#pb-best-fit')) { applyBestFitEngine(); return; }
      if (e.target.closest('#pb-cancel')) { builderOpen = false; renderRosterView(); return; }
      if (e.target.closest('#pb-delete') && builderDraft?.slug) { deleteRosterAgent(builderDraft.slug); return; }
      const editAg = e.target.closest('[data-roster-edit]');
      if (editAg) { openBuilder(editAg.dataset.rosterEdit); return; }
      const sqBtn = e.target.closest('[data-roster-squad]');
      if (sqBtn) { toggleSquadMember(sqBtn.dataset.rosterSquad); return; }
      const spawnAg = e.target.closest('[data-roster-spawn]');
      if (spawnAg) { deploySingleAgent(spawnAg.dataset.rosterSpawn); return; }
    });

    dock.addEventListener('change', (e) => {
      if (!builderOpen || !builderDraft) return;
      if (e.target.id === 'pb-engine') {
        const val = e.target.value || '';
        if (val.startsWith('api::')) {
          builderDraft.engineType = 'api';
          builderDraft.providerId = val.slice(5);
          builderDraft.harnessId = null;
          builderDraft.harnessCommand = '';
        } else if (val.startsWith('harness::')) {
          builderDraft.engineType = 'harness';
          builderDraft.harnessId = val.slice(9);
          const h = (rosterData?.harnesses || []).find(x => x.id === builderDraft.harnessId);
          builderDraft.providerId = h?.providerId || null;
          builderDraft.harnessCommand = h?.command || '';
        } else if (val === 'custom_cli') {
          builderDraft.engineType = 'custom_cli';
          builderDraft.providerId = null;
          builderDraft.harnessId = null;
        } else {
          builderDraft.engineType = 'api';
          builderDraft.providerId = null;
          builderDraft.harnessId = null;
          builderDraft.harnessCommand = '';
        }
        refreshBuilderStats();
        return;
      }
      if (e.target.id === 'pb-primary') { builderDraft.primarySpecialty = e.target.value; refreshBuilderStats(); return; }
      if (e.target.id === 'pb-secondary') { builderDraft.secondarySpecialty = e.target.value; refreshBuilderStats(); return; }
      if (e.target.id === 'pb-autonomy') { builderDraft.autonomy = e.target.value; return; }
      if (e.target.id === 'pb-effort') { builderDraft.effort = e.target.value; return; }
    });

    dock.addEventListener('input', (e) => {
      if (e.target.id === 'conclave-mission-input') {
        launchMission = e.target.value;
        if (!launchMission.trim()) {
          activeTemplateId = null;
          launchManualTeam = false;
          launchManualMode = false;
          applyAutoRecommendation('');
          return;
        }
        if (activeTemplateId) {
          const tpl = LONG_FORM_TEMPLATES.find(t => t.id === activeTemplateId);
          if (!tpl || !launchMission.startsWith(tpl.prompt.trim())) {
            activeTemplateId = null;
          } else {
            return;
          }
        }
        if (!launchManualTeam) applyAutoRecommendation(launchMission);
        else renderLaunchpadControls();
        return;
      }
      if (e.target.id === 'conclave-replay-scrub') {
        replayPlaying = false;
        replayProgress = Math.max(0, Math.min(100, Number(e.target.value) || 0));
        updateReplayBar();
        renderLiveTicker();
        if (activeLens === 'stage') drawStage();
        if (activeLens === 'timeline') drawTimeline();
      }
    });

    dock.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (forceShowLaunchpad) {
          e.preventDefault();
          e.stopPropagation();
          forceShowLaunchpad = false;
          renderAll();
          return;
        }
        if (builderOpen) {
          e.preventDefault();
          e.stopPropagation();
          builderOpen = false;
          renderRosterView();
          return;
        }
        if (selectedWorkerId) {
          e.preventDefault();
          e.stopPropagation();
          selectWorker(null);
          return;
        }
      }
      if (e.target.id === 'conclave-mission-input' && !e.isComposing && (e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        launchConclaveFromPad({ autoSend: true });
      }
    });

    dock.addEventListener('submit', (e) => {
      if (e.target.id === 'pb-form') {
        e.preventDefault();
        saveBuilderAgent();
      } else if (e.target.id === 'rf-form') {
        e.preventDefault();
        saveFormationFromForm();
      }
    });

    dock.querySelector('#pi-steer-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = dock.querySelector('#pi-steer-input');
      const msg = (input?.value || '').trim();
      if (!msg || !selectedWorkerId) return;
      if (demoMode) {
        const w = (data?.workers || []).find(x => x.workerId === selectedWorkerId);
        if (w) {
          w.streamTail = `${w.streamTail || ''}\n[Operator steer] ${msg}`.trim();
          w.summary = w.streamTail;
        }
        input.value = '';
        renderInspector();
        renderCards();
        if (typeof window.toast === 'function') window.toast(`Steered ${selectedWorkerId} (demo).`);
        return;
      }
      if (!currentTaskId) return;
      try {
        const res = await fetch(`/api/tasks/${encodeURIComponent(currentTaskId)}/conclave/steer`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-g0d-request': '1' },
          body: JSON.stringify({ workerId: selectedWorkerId, message: msg }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || 'Failed to steer worker.');
        input.value = '';
        if (json.conclave) { data = json.conclave; renderAll(); }
        if (typeof window.toast === 'function') {
          window.toast(json.target === 'note'
            ? `Recorded note for ${selectedWorkerId} (worker is no longer active).`
            : `Steer sent to ${selectedWorkerId}.`);
        }
      } catch (err) {
        if (typeof window.toast === 'function') window.toast(err.message || 'Steer failed.');
      }
    });

    const stageCanvas = dock.querySelector('#conclave-canvas');
    stageCanvas?.addEventListener('mousemove', (e) => {
      const rect = stageCanvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const hit = stageHitTargets.find(t => Math.hypot(mx - t.x, my - t.y) <= t.r + 6);
      const nextId = hit ? hit.workerId : null;
      if (nextId !== hoveredWorkerId) {
        hoveredWorkerId = nextId;
        stageCanvas.classList.toggle('is-pointer', Boolean(nextId));
        if (motionReduced()) drawStage();
      }
    });
    stageCanvas?.addEventListener('click', (e) => {
      const rect = stageCanvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const hit = stageHitTargets.find(t => Math.hypot(mx - t.x, my - t.y) <= t.r + 8);
      if (hit) {
        selectWorker(hit.workerId);
      }
    });

    const tlCanvas = dock.querySelector('#conclave-timeline-canvas');
    tlCanvas?.addEventListener('click', (e) => {
      const rect = tlCanvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const hit = timelineHitTargets.find(t => mx >= t.x && mx <= t.x + t.w && my >= t.y && my <= t.y + t.h);
      if (hit) selectWorker(hit.workerId);
    });

    window.addEventListener('resize', () => {
      if (!isOpenState) return;
      if (activeLens === 'stage') drawStage();
      if (activeLens === 'timeline') drawTimeline();
    });

    renderLaunchpadControls();
    return dock;
  }

  async function resolveApprovalFromConclave(decision) {
    if (!currentTaskId || !data?.pendingApproval) return;
    try {
      const res = await fetch(`/api/tasks/${encodeURIComponent(currentTaskId)}/approval`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-g0d-request': '1' },
        body: JSON.stringify({ decision, resume: true }),
      });
      if (!res.ok) throw new Error('Approval action failed.');
      if (typeof window.toast === 'function') window.toast(decision === 'deny' ? 'Denied — resuming with feedback.' : 'Allowed once — resuming.');
      await loadSnapshot(currentTaskId);
      if (typeof window.refresh === 'function') window.refresh();
    } catch (err) {
      if (typeof window.toast === 'function') window.toast(err.message);
    }
  }

  function triggerPreset(preset) {
    if (preset === 'roster') {
      setLens('roster');
      return;
    }
    if (preset === 'forge') {
      setLens('roster');
      openBuilder(null);
      return;
    }
    const input = document.getElementById('composer-input');
    if (preset === 'research') {
      const prompt = 'Use parallel agent.spawn subagents (explore, reviewer, and uncensored) to simultaneously map the architecture, audit for bugs/security edge cases, and synthesize a concrete action plan.';
      if (input) {
        input.value = prompt;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.focus();
      }
      if (typeof window.toast === 'function') window.toast('Parallel Research Squad prompt ready in composer — press Enter to launch.');
      return;
    }
    if (preset === 'crew') {
      const crewBtn = document.querySelector('#task-controls [data-crew-action="start"]');
      if (crewBtn && !crewBtn.disabled) {
        crewBtn.click();
        return;
      }
      if (input) {
        input.value = 'Coordinate a build-and-review pass: spawn an explore subagent to locate target files, implement the changes cleanly, then spawn a reviewer subagent to audit the diff before concluding.';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.focus();
      }
      if (typeof window.toast === 'function') window.toast('Code & Review workflow loaded into composer (or attach checks to run an isolated Coding Crew).');
      return;
    }
    if (preset === 'arena') {
      if (typeof window.openSettings === 'function') window.openSettings('autonomy', { scrollTo: '#ultra-router-section' });
      else if (typeof window.toast === 'function') window.toast('Open Settings → Autonomy & Tuning to configure Head-to-Head Conclave.');
    }
  }

  function buildDemoState(tick = 0) {
    const now = Date.now();
    const base = now - 14000;
    const cycle = tick % 6;
    if (cycle === 5) {
      // Showcase Head-to-Head Conclave Race mode on cycle 5!
      return {
        taskId: 'demo',
        title: 'Conclave Preview · Ultra-Plinian Race',
        status: 'completed',
        mode: 'arena',
        orchestrator: { modelLabel: 'Ultra-Plinian Router', status: 'completed', calls: 3, maxCalls: 250, recoveries: 0 },
        workers: [],
        arena: {
          raceId: 'demo-race-1',
          status: 'completed',
          winnerId: 'gemini:gemini-4-neon',
          contenders: [
            { slot: 'A', providerId: 'gemini:gemini-4-neon', label: 'Gemini 4 Neon', status: 'completed', durationMs: 4120, isWinner: true, grade: { id: 'A', fidelity: 5, completeness: 5, clarity: 5, total: 15, reason: 'Deepest architectural precision and zero-dependency implementation.' } },
            { slot: 'B', providerId: 'openrouter:claude-sonnet-5.5', label: 'Claude Sonnet 5.5', status: 'completed', durationMs: 4860, isWinner: false, grade: { id: 'B', fidelity: 5, completeness: 4, clarity: 5, total: 14, reason: 'Clean structure, slightly less thorough on edge cases.' } },
            { slot: 'C', providerId: 'openai:gpt-5.4', label: 'GPT-5.4', status: 'completed', durationMs: 4410, isWinner: false, grade: { id: 'C', fidelity: 4, completeness: 5, clarity: 4, total: 13, reason: 'Strong coverage, slightly denser explanation.' } },
          ],
          judge: { providerId: 'venice:hermes-4-405b', label: 'Hermes 4 405B', status: 'completed' },
          note: 'Blind judge crowned Contender A across 3 frontier models (15/15 vs 14/15 vs 13/15).',
        },
        failovers: [],
        fileConflicts: [],
        pendingApproval: null,
        stats: { totalWorkers: 4, activeWorkers: 0, completedWorkers: 4, failedWorkers: 0, totalCalls: 4 },
      };
    }
    const w1Status = cycle >= 3 ? 'completed' : cycle >= 1 ? 'tool' : 'streaming';
    const w2Status = cycle >= 4 ? 'completed' : cycle === 2 ? 'recovering' : 'streaming';
    const w3Status = cycle >= 4 ? 'completed' : cycle >= 2 ? 'tool' : 'thinking';
    return {
      taskId: 'demo',
      title: 'Conclave Live Preview',
      status: cycle >= 4 ? 'completed' : 'running',
      mode: 'swarm',
      orchestrator: { modelLabel: 'Gemini 4 Neon', status: cycle >= 4 ? 'completed' : 'running', calls: 5 + cycle, maxCalls: 250, recoveries: cycle >= 2 ? 1 : 0 },
      workers: [
        {
          workerId: 'demo-explore', kind: 'subagent', role: 'explore',
          modelLabel: 'Gemini 4 Neon', status: w1Status,
          tool: w1Status === 'tool' ? 'repo.search' : '', target: 'src/runtime.mjs',
          files: ['src/runtime.mjs', 'src/providers.mjs'], tools: ['repo.glob', 'repo.search', 'repo.read'],
          calls: 2, approxTokens: 1420, estimatedCostUsd: 0.0021, isMvp: cycle >= 4,
          startedAt: new Date(base).toISOString(), endedAt: w1Status === 'completed' ? new Date(base + 6200).toISOString() : null,
          durationMs: w1Status === 'completed' ? 6200 : 3200 + cycle * 900,
          streamTail: 'Mapped tool dispatch loop in src/runtime.mjs:1169 and Gemini wire serializer in src/providers.mjs:442.',
          summary: 'Mapped tool dispatch loop in src/runtime.mjs:1169 and Gemini wire serializer in src/providers.mjs:442. Found 2 parallelizable batch paths.',
        },
        {
          workerId: 'demo-reviewer', kind: 'subagent', role: 'reviewer',
          modelLabel: 'Claude Sonnet 5.5', status: w2Status,
          tool: w2Status === 'tool' ? 'git.diff' : '', target: 'src/runtime.mjs',
          files: ['src/runtime.mjs', 'src/server.mjs'], tools: ['git.diff', 'repo.read'],
          calls: 2, approxTokens: 1680, estimatedCostUsd: 0.0054, isMvp: false,
          startedAt: new Date(base + 400).toISOString(), endedAt: w2Status === 'completed' ? new Date(base + 9800).toISOString() : null,
          durationMs: w2Status === 'completed' ? 9400 : 2900 + cycle * 1100,
          streamTail: w2Status === 'recovering' ? 'GODMODƎ surge: switching fallback route after transient 429…' : 'Audited SSE cleanup on disconnect and verified zero inline style= CSP compliance.',
          summary: 'Audited SSE cleanup on disconnect and verified zero inline style= CSP compliance across public/conclave.js and public/settings.js.',
        },
        {
          workerId: 'demo-verifier', kind: 'subagent', role: 'verifier',
          modelLabel: 'Hermes 4 405B', status: w3Status,
          tool: w3Status === 'tool' ? 'repo.read' : '', target: 'test/conclave.test.mjs',
          files: ['test/conclave.test.mjs'], tools: ['repo.read'],
          calls: 1, approxTokens: 980, estimatedCostUsd: 0.0018, isMvp: false,
          startedAt: new Date(base + 900).toISOString(), endedAt: w3Status === 'completed' ? new Date(base + 11200).toISOString() : null,
          durationMs: w3Status === 'completed' ? 10300 : 2200 + cycle * 1200,
          streamTail: 'Verifying parallel agent.spawn fan-out assertions and headless Chromium stage rendering…',
          summary: 'All parallel fan-out assertions, SSE worker telemetry streams, and Conclave canvas hit-tests verified green.',
        },
      ],
      arena: null,
      failovers: cycle >= 2 ? [{ type: 'model.switched', at: new Date(base + 4000).toISOString(), from: 'primary', to: 'fallback', reason: 'GODMODƎ recovery' }] : [],
      fileConflicts: [{ file: 'src/runtime.mjs', owners: [{ workerId: 'demo-explore', role: 'explore' }, { workerId: 'demo-reviewer', role: 'reviewer' }] }],
      pendingApproval: null,
      stats: {
        totalWorkers: 3,
        activeWorkers: [w1Status, w2Status, w3Status].filter(s => s !== 'completed').length,
        completedWorkers: [w1Status, w2Status, w3Status].filter(s => s === 'completed').length,
        failedWorkers: 0,
        totalCalls: 5 + cycle,
        totalTokens: 4080,
        totalCostUsd: 0.0093,
      },
    };
  }

  function startDemo(initialTick = 1) {
    stopDemo();
    demoMode = true;
    replayPlaying = false;
    replayProgress = 100;
    let tick = initialTick;
    data = buildDemoState(tick);
    if (!selectedWorkerId && data.workers[0]) selectedWorkerId = null;
    updateDemoButton();
    renderAll();
    if (!motionReduced()) {
      demoTimer = setInterval(() => {
        if (!demoMode || !isOpenState) return;
        tick += 1;
        data = buildDemoState(tick);
        renderAll();
      }, 2800);
    }
  }

  function stopDemo() {
    demoMode = false;
    if (demoTimer) { clearInterval(demoTimer); demoTimer = null; }
    updateDemoButton();
  }

  function toggleDemo() {
    if (demoMode) {
      stopDemo();
      if (currentTaskId) loadSnapshot(currentTaskId);
      else { data = null; renderAll(); }
    } else {
      startDemo(1);
    }
  }

  function updateDemoButton() {
    const btn = document.getElementById('conclave-demo-btn');
    if (!btn) return;
    btn.textContent = demoMode ? 'Exit Demo' : 'Preview';
    btn.classList.toggle('is-active', demoMode);
  }

  function toggleExpand() {
    isExpanded = !isExpanded;
    const dock = dockEl();
    dock?.classList.toggle('is-expanded', isExpanded);
    const btn = document.getElementById('conclave-expand');
    if (btn) btn.setAttribute('aria-pressed', String(isExpanded));
    requestAnimationFrame(() => {
      if (activeLens === 'stage') drawStage();
      if (activeLens === 'timeline') drawTimeline();
    });
  }

  function setLens(lens) {
    activeLens = ['stage', 'cards', 'timeline', 'roster', 'ranks'].includes(lens) ? lens : 'stage';
    const dock = dockEl();
    if (!dock) return;
    dock.querySelectorAll('[data-conclave-lens]').forEach(btn => {
      const on = btn.dataset.conclaveLens === activeLens;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-selected', String(on));
    });
    dock.querySelector('#conclave-view-stage')?.classList.toggle('hidden', activeLens !== 'stage');
    dock.querySelector('#conclave-view-cards')?.classList.toggle('hidden', activeLens !== 'cards');
    dock.querySelector('#conclave-view-timeline')?.classList.toggle('hidden', activeLens !== 'timeline');
    dock.querySelector('#conclave-view-roster')?.classList.toggle('hidden', activeLens !== 'roster');
    dock.querySelector('#conclave-view-ranks')?.classList.toggle('hidden', activeLens !== 'ranks');
    if (activeLens === 'stage') { drawStage(); startLoop(); }
    if (activeLens === 'cards') renderCards();
    if (activeLens === 'timeline') drawTimeline();
    if (activeLens === 'roster') loadRoster();
    if (activeLens === 'ranks') loadLeaderboard();
    updateReplayBar();
  }

  function selectWorker(workerId) {
    selectedWorkerId = workerId || null;
    renderInspector();
    if (activeLens === 'stage') drawStage();
    if (activeLens === 'cards') renderCards();
  }

  function canReplay(src = data) {
    if (!src) return false;
    if (src.mode === 'arena' && src.arena?.status === 'completed') return true;
    if ((src.workers || []).length > 0 && (src.stats?.activeWorkers || 0) === 0) return true;
    return false;
  }

  function toggleReplay() {
    if (!canReplay()) return;
    if (replayPlaying) {
      replayPlaying = false;
    } else {
      if (replayProgress >= 99) replayProgress = 0;
      replayPlaying = true;
      startLoop();
    }
    updateReplayBar();
    if (activeLens === 'stage') drawStage();
    if (activeLens === 'timeline') drawTimeline();
  }

  function updateReplayBar() {
    const bar = document.getElementById('conclave-replay-bar');
    if (!bar) return;
    const show = canReplay() && (activeLens === 'stage' || activeLens === 'timeline');
    bar.classList.toggle('hidden', !show);
    if (!show) return;
    const btn = document.getElementById('conclave-replay-toggle');
    if (btn) {
      btn.textContent = replayPlaying ? '❚❚ Pause' : (replayProgress < 100 ? '▶ Resume 4×' : '▶ Replay 4×');
      btn.classList.toggle('is-active', replayPlaying);
    }
    const scrub = document.getElementById('conclave-replay-scrub');
    if (scrub) scrub.value = String(Math.round(replayProgress));
    const timeEl = document.getElementById('conclave-replay-time');
    if (timeEl) {
      if (replayProgress >= 100 && !replayPlaying) {
        timeEl.textContent = 'DONE · 4×';
      } else {
        const span = computeReplaySpanMs(data);
        timeEl.textContent = `${fmtMs((replayProgress / 100) * span)} / ${fmtMs(span)} · 4×`;
      }
    }
  }

  function resolveWorkerTimes(workers) {
    const parsedStarts = workers.map(wk => {
      const t = wk.startedAt ? Date.parse(wk.startedAt) : NaN;
      return Number.isFinite(t) ? t : null;
    });
    const validStarts = parsedStarts.filter(t => t !== null);
    const anchor = validStarts.length ? Math.min(...validStarts) : Date.now() - Math.max(1200, ...workers.map(w => Number(w.durationMs) || 1200));
    return workers.map((wk, idx) => {
      const dur = Math.max(400, Number(wk.durationMs) || 1200);
      const s = parsedStarts[idx] !== null ? parsedStarts[idx] : anchor;
      const parsedEnd = wk.endedAt ? Date.parse(wk.endedAt) : NaN;
      const e = Number.isFinite(parsedEnd) && parsedEnd >= s ? Math.max(s + 400, parsedEnd) : s + dur;
      return { wk, s, e };
    });
  }

  function computeReplaySpanMs(src) {
    if (!src) return 4000;
    if (src.mode === 'arena' && src.arena?.contenders?.length) {
      return Math.max(1500, ...src.arena.contenders.map(c => Number(c.durationMs) || 2000));
    }
    const ws = src.workers || [];
    if (!ws.length) return 4000;
    const times = resolveWorkerTimes(ws);
    const minT = Math.min(...times.map(t => t.s));
    const maxT = Math.max(...times.map(t => t.e), minT + 1000);
    return Math.max(1200, maxT - minT);
  }

  function getEffectiveData() {
    if (!data || !canReplay(data) || (replayProgress >= 100 && !replayPlaying)) return data;
    const frac = Math.max(0, Math.min(1, replayProgress / 100));
    if (data.mode === 'arena' && data.arena) {
      const contenders = (data.arena.contenders || []).map((c) => {
        const maxD = Math.max(1000, ...(data.arena.contenders || []).map(x => x.durationMs || 2000));
        const ratio = Math.min(1, (frac * maxD * 1.12) / Math.max(600, c.durationMs || 2000));
        const revealed = frac >= 0.88;
        return {
          ...c,
          _replayProg: ratio,
          _replayGradeRevealed: revealed,
          status: ratio >= 1 ? c.status : 'streaming',
          isWinner: revealed ? c.isWinner : false,
        };
      });
      return {
        ...data,
        arena: {
          ...data.arena,
          contenders,
          winnerId: frac >= 0.88 ? data.arena.winnerId : null,
          note: frac >= 0.88 ? data.arena.note : (frac >= 0.65 ? 'Blind judge evaluating fidelity, completeness & clarity…' : 'Contenders drafting independently in parallel…'),
          judge: data.arena.judge ? { ...data.arena.judge, status: frac >= 0.88 ? 'completed' : frac >= 0.65 ? 'grading' : 'waiting' } : null,
        },
      };
    }
    const ws = data.workers || [];
    if (!ws.length) return data;
    const times = resolveWorkerTimes(ws);
    const minT = Math.min(...times.map(t => t.s));
    const maxT = Math.max(...times.map(t => t.e), minT + 1000);
    const cursorT = minT + frac * (maxT - minT);
    const projected = ws.map((wk, idx) => {
      const { s, e } = times[idx];
      if (cursorT < s) return { ...wk, status: 'queued', tool: '', isMvp: false, _replayFrac: 0 };
      if (cursorT >= e || frac >= 0.995) return { ...wk, _replayFrac: 1 };
      const localP = (cursorT - s) / Math.max(1, e - s);
      const status = localP < 0.2 ? 'thinking' : (localP < 0.65 && wk.tools?.length) ? 'tool' : 'streaming';
      const tool = status === 'tool' ? (wk.tools[Math.min(wk.tools.length - 1, Math.floor(localP * wk.tools.length))] || wk.tool || 'tool') : '';
      return { ...wk, status, tool, isMvp: false, _replayFrac: localP };
    });
    return { ...data, workers: projected, _replayCursorFrac: frac };
  }

  function startLoop() {
    if (rafId !== null || !isOpenState) return;
    if (!replayPlaying && (activeLens !== 'stage' || motionReduced())) return;
    lastFrameMs = performance.now();
    const tick = (now) => {
      if (!isOpenState) { rafId = null; return; }
      if (!replayPlaying && (activeLens !== 'stage' || motionReduced())) { rafId = null; return; }
      if (document.hidden) {
        lastFrameMs = now;
        rafId = requestAnimationFrame(tick);
        return;
      }
      const dt = Math.min(0.05, Math.max(0, (now - lastFrameMs) / 1000));
      lastFrameMs = now;
      if (replayPlaying) {
        const spanSec = Math.max(1.2, computeReplaySpanMs(data) / 1000);
        const speedPctPerSec = Math.max(18, Math.min(55, (400 / spanSec)));
        replayProgress = Math.min(100, replayProgress + dt * speedPctPerSec);
        if (replayProgress >= 100) replayPlaying = false;
        updateReplayBar();
        renderLiveTicker();
        if (activeLens === 'stage') drawStage();
        if (activeLens === 'timeline') drawTimeline();
      } else if (!motionReduced() && activeLens === 'stage') {
        animPhase = (animPhase + dt * 0.72) % 1000;
        drawStage();
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
  }

  function stopLoop() {
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
  }

  function open(options = {}) {
    const dock = ensureShell();
    if (!dock) return;
    // Hide all other right-hand docks cleanly so split-screen never collides
    if (typeof window.closeAllRightDocks === 'function') window.closeAllRightDocks({ except: 'conclave' });
    else {
      window.closeArtifactDock?.({ recordDismiss: false });
      if (window.G0DBrowserLive?.isOpen?.()) window.G0DBrowserLive.close();
      window.closeChatCode?.();
    }
    isOpenState = true;
    if (!options.launchpad) forceShowLaunchpad = false;
    dock.classList.remove('hidden');
    document.body.classList.add('conclave-open');
    if (options.lens) setLens(options.lens);
    if (options.demo) startDemo(options.demoTick ?? 1);
    else if (currentTaskId && !demoMode) loadSnapshot(currentTaskId);
    else renderAll();
    updateHeaderBadge();
    startLoop();
  }

  function close() {
    isOpenState = false;
    forceShowLaunchpad = false;
    replayPlaying = false;
    stopDemo();
    stopLoop();
    const dock = dockEl();
    if (dock) {
      dock.classList.add('hidden');
      dock.classList.remove('is-expanded');
    }
    isExpanded = false;
    document.body.classList.remove('conclave-open');
    updateHeaderBadge();
  }

  function toggle(options = {}) {
    if (isOpenState) close();
    else open(options);
  }

  function updateHeaderBadge() {
    const btn = document.getElementById('conclave-toggle-btn');
    if (!btn) return;
    btn.classList.toggle('is-open', isOpenState);
    btn.setAttribute('aria-pressed', String(isOpenState));
    const badge = btn.querySelector('.conclave-btn-count');
    if (!badge) return;
    const active = data?.stats?.activeWorkers || 0;
    const total = data?.stats?.totalWorkers || (data?.arena?.contenders?.length || 0);
    if (active > 0) {
      badge.textContent = String(active);
      badge.className = 'conclave-btn-count is-live';
    } else if (total > 0) {
      badge.textContent = String(total);
      badge.className = 'conclave-btn-count';
    } else {
      badge.textContent = '';
      badge.className = 'conclave-btn-count hidden';
    }
  }

  function recommendTeam(rawMission = '') {
    const text = String(rawMission || '').toLowerCase();
    if (!text.trim()) {
      return { agents: ['explore', 'builder', 'reviewer'], mode: 'parallel', reason: 'Balanced default squad' };
    }
    const rules = [
      { re: /\b(ui|ux|design|css|layout|dashboard|landing page|theme|prototype|figma|components?|visual|frontend|accessibility|tokens?)\b/g, agents: ['designer', 'builder', 'reviewer'], mode: 'critique', reason: 'Design & UI build' },
      { re: /\b(financial|revenue|forecast|quant|quantitative|statistics?|statistical|metrics?|sql|datasets?|benchmarks?|algorithms?|math|proof|simulations?|unit economics|sensitivity)\b/g, agents: ['analyst', 'explore', 'strategist'], mode: 'critique', reason: 'Quantitative & analytical' },
      { re: /\b(gtm|go-to-market|marketing|launch|positioning|pitch|memo|blog|whitepaper|essay|documentation|copy|strategy|proposal|narrative|rollout)\b/g, agents: ['strategist', 'explore', 'designer'], mode: 'parallel', reason: 'Strategy & writing' },
      { re: /\b(outage|incident|postmortem|crash|memory leak|race condition|deadlock|stack traces?|debug|root cause|bugs?)\b/g, agents: ['explore', 'reviewer', 'analyst'], mode: 'parallel', reason: 'Incident & root-cause triage' },
      { re: /\b(migrat\w*|upgrade|re-architect|rewrite|cutover|zero-downtime|postgres|kubernetes|cloud|monolith|microservices|rollback)\b/g, agents: ['explore', 'builder', 'analyst'], mode: 'debate', reason: 'Migration & architecture' },
      { re: /\b(rfc|tradeoffs?|should we|decide|decision|pros and cons|debate|devil|red-team|adversarial|legal|compliance|verdict|open-source)\b/g, agents: ['explore', 'analyst', 'strategist'], mode: 'debate', reason: 'Multi-perspective decision' },
      { re: /\b(research|competitors?|market|landscape|literature|survey|synthesize|investigate|deep dive|report|teardown)\b/g, agents: ['explore', 'analyst', 'strategist'], mode: 'parallel', reason: 'Deep research & synthesis' },
      { re: /\b(audit|review|refactor|cleanup|security|hardening|tech debt|test coverage|regressions?)\b/g, agents: ['explore', 'reviewer', 'builder'], mode: 'parallel', reason: 'Audit & refactor' },
      { re: /\b(build|implement|feature|apis?|backend|endpoints?|full-stack|fullstack|app|service|cli|plugin|webhooks?)\b/g, agents: ['builder', 'designer', 'reviewer'], mode: 'critique', reason: 'End-to-end engineering' },
    ];
    let best = null;
    let bestScore = 0;
    for (const r of rules) {
      const matches = text.match(r.re);
      const score = matches ? new Set(matches).size : 0;
      if (score > bestScore) {
        bestScore = score;
        best = r;
      }
    }
    if (best) return { agents: best.agents, mode: best.mode, reason: best.reason };
    return { agents: ['explore', 'analyst', 'strategist'], mode: 'parallel', reason: 'General long-form synthesis' };
  }

  function applyAutoRecommendation(text) {
    const rec = recommendTeam(text);
    const available = new Set((rosterData?.agents || []).map(a => a.slug));
    const filtered = available.size ? rec.agents.filter(s => available.has(s)) : rec.agents;
    launchTeam = new Set(filtered.length ? filtered : ['explore', 'reviewer']);
    if (!launchManualMode) launchMode = rec.mode;
    launchReasonLabel = rec.reason;
    renderLaunchpadControls(rec.reason);
  }

  function applyLaunchTemplate(templateId) {
    const tpl = LONG_FORM_TEMPLATES.find(t => t.id === templateId);
    if (!tpl) return;
    activeTemplateId = tpl.id;
    launchManualTeam = false;
    launchManualMode = false;
    launchMode = tpl.mode;
    launchReasonLabel = tpl.label;
    const available = new Set((rosterData?.agents || []).map(a => a.slug));
    const picked = available.size ? tpl.agents.filter(s => available.has(s)) : tpl.agents;
    launchTeam = new Set(picked.length ? picked : tpl.agents);
    launchMission = tpl.prompt;
    const input = document.getElementById('conclave-mission-input');
    if (input) {
      input.value = tpl.prompt;
      input.focus();
      input.setSelectionRange(tpl.prompt.length, tpl.prompt.length);
    }
    renderLaunchpadControls(tpl.label);
  }

  function toggleLaunchAgent(slug) {
    if (!slug) return;
    launchManualTeam = true;
    launchReasonLabel = 'Custom squad';
    if (launchTeam.has(slug)) {
      if (launchTeam.size <= 1) {
        if (typeof window.toast === 'function') window.toast('Keep at least 1 specialist in the Conclave.');
        return;
      }
      launchTeam.delete(slug);
    } else {
      if (launchTeam.size >= 4) {
        if (typeof window.toast === 'function') window.toast('Up to 4 specialists per Conclave run.');
        return;
      }
      launchTeam.add(slug);
    }
    renderLaunchpadControls('Custom squad');
  }

  function setLaunchMode(mode) {
    if (!CONCLAVE_MODES.some(m => m.id === mode)) return;
    launchManualMode = true;
    launchMode = mode;
    renderLaunchpadControls();
  }

  function buildMissionPrompt(missionText, { slugs = null, mode = null, formationName = null } = {}) {
    const cleanMission = String(missionText || '').trim();
    const rec = recommendTeam(cleanMission);
    const chosenMode = mode || rec.mode || 'parallel';
    const chosenSlugs = Array.isArray(slugs) && slugs.length ? slugs : rec.agents;
    const allAgents = rosterData?.agents?.length ? rosterData.agents : DEFAULT_STARTER_AGENTS;
    const resolved = chosenSlugs.map(slug => {
      const found = allAgents.find(a => a.slug === slug);
      return found || { slug, name: slug, primarySpecialty: 'general', resolvedProviderId: null, engineLabel: 'Auto' };
    });
    const rosterLines = resolved.map(a =>
      `- agent.spawn(role: "${a.slug}"${a.resolvedProviderId ? `, model: "${a.resolvedProviderId}"` : ''}) — ${a.name} (${String(a.primarySpecialty || 'general').replace(/_/g, ' ')})`
    );
    const modeProtocol = chosenMode === 'critique'
      ? 'Workflow (Draft & Critique): Spawn the lead specialist(s) to draft/build the core solution while the reviewer/analyst specialists independently stress-test edge cases, assumptions, and quality. Resolve every valid critique before delivering the final output.'
      : chosenMode === 'debate'
        ? 'Workflow (Council Debate): Have each specialist independently argue a distinct perspective, competing option, or risk profile in parallel via agent.spawn. Explicitly compare tradeoffs, resolve disagreements, and deliver a unified, evidence-backed recommendation.'
        : 'Workflow (Parallel Squad): Dispatch all listed specialists concurrently via agent.spawn on non-overlapping slices of the mission, then synthesize their findings into one complete, actionable final deliverable.';
    const heading = formationName
      ? `Convene Conclave Formation "${formationName}" (${resolved.length} specialist${resolved.length === 1 ? '' : 's'})`
      : `Convene a Conclave (${resolved.length} specialist${resolved.length === 1 ? '' : 's'})`;
    return `${heading}:\n${rosterLines.join('\n')}\n\n${modeProtocol}\n\nMission:\n${cleanMission || '[Describe your goal here]'}`;
  }

  async function launchConclaveFromPad({ autoSend = true } = {}) {
    const input = document.getElementById('conclave-mission-input');
    const mission = (input?.value ?? launchMission ?? '').trim();
    if (!mission) {
      if (typeof window.toast === 'function') window.toast('Describe your mission first (or click any starter chip above).');
      input?.focus();
      return;
    }
    stopDemo();
    const slugs = [...launchTeam];
    const chosenMode = launchMode;
    playTactileCue('conclave');
    if (chosenMode === 'race') {
      if (autoSend && typeof window.launchBlindRace === 'function') {
        const btn = document.getElementById('conclave-launch-btn');
        if (btn) { btn.disabled = true; btn.textContent = '⚔ Launching race…'; }
        const launched = await window.launchBlindRace(mission);
        if (btn) { btn.disabled = false; btn.textContent = '✦ Launch Conclave →'; }
        if (!launched) return;
        if (isExpanded) toggleExpand();
        forceShowLaunchpad = false;
        activeTemplateId = null;
        if (input) input.value = '';
        launchMission = '';
        renderAll();
        if (typeof window.toast === 'function') window.toast('⚔ Blind Conclave Race launched!');
        return;
      }
      try {
        const res = await fetch('/api/router', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json', 'x-g0d-request': '1' },
          body: JSON.stringify({ mode: 'auto_arena' }),
        });
        const rJson = await res.json().catch(() => null);
        if (window.state) window.state.router = rJson?.settings || { ...(window.state.router || {}), mode: 'auto_arena' };
      } catch {}
      const composer = document.getElementById('composer-input');
      if (composer) {
        if (isExpanded) toggleExpand();
        forceShowLaunchpad = false;
        composer.value = mission;
        composer.dispatchEvent(new Event('input', { bubbles: true }));
        if (autoSend) {
          const form = document.getElementById('composer-form');
          if (form?.requestSubmit) form.requestSubmit();
        }
        if (input) input.value = '';
        launchMission = '';
        if (typeof window.toast === 'function') window.toast('⚔ Blind Race loaded into chat — press Enter to launch.');
        return;
      }
    }
    if (autoSend && typeof window.launchNativeConclave === 'function') {
      const btn = document.getElementById('conclave-launch-btn');
      if (btn) { btn.disabled = true; btn.textContent = '✦ Convening council…'; }
      const launched = await window.launchNativeConclave({ mission, agents: slugs, mode: chosenMode });
      if (btn) { btn.disabled = false; btn.textContent = '✦ Launch Conclave →'; }
      if (!launched) return;
      if (isExpanded) toggleExpand();
      forceShowLaunchpad = false;
      activeTemplateId = null;
      launchManualTeam = false;
      launchManualMode = false;
      launchReasonLabel = '';
      if (input) input.value = '';
      launchMission = '';
      renderAll();
      if (typeof window.toast === 'function') window.toast(`✦ Conclave launched (${slugs.length} specialists · ${chosenMode})!`);
      return;
    }
    const prompt = buildMissionPrompt(mission, { slugs, mode: chosenMode });
    if (autoSend && typeof window.submitConclaveMission === 'function') {
      const sent = window.submitConclaveMission(prompt);
      if (!sent) return;
      if (isExpanded) toggleExpand();
      forceShowLaunchpad = false;
      activeTemplateId = null;
      launchManualTeam = false;
      launchManualMode = false;
      launchReasonLabel = '';
      if (input) input.value = '';
      launchMission = '';
      renderAll();
      if (typeof window.toast === 'function') window.toast(`✦ Conclave launched (${slugs.length} specialists · ${chosenMode})!`);
      return;
    }
    const composer = document.getElementById('composer-input');
    if (composer) {
      if (isExpanded) toggleExpand();
      composer.value = prompt;
      composer.dispatchEvent(new Event('input', { bubbles: true }));
      composer.focus();
      composer.setSelectionRange(prompt.length, prompt.length);
      if (autoSend) {
        const form = document.getElementById('composer-form');
        if (form?.requestSubmit) form.requestSubmit();
      } else if (typeof window.toast === 'function') {
        window.toast(`✦ Loaded ${slugs.length}-specialist brief into chat — review and press Enter.`);
      }
    }
  }

  function renderLaunchpadControls(reasonLabel = null) {
    if (reasonLabel !== null) launchReasonLabel = reasonLabel;
    const pillsWrap = document.getElementById('conclave-team-pills');
    const metaEl = document.getElementById('conclave-team-meta');
    const modeHintEl = document.getElementById('conclave-mode-hint');
    const agents = rosterData?.agents?.length ? rosterData.agents : DEFAULT_STARTER_AGENTS;
    if (pillsWrap) {
      const pillsHtml = agents.map(a => {
        const active = launchTeam.has(a.slug);
        return `<button type="button" class="clp-agent-pill ${active ? 'active' : ''}" data-launch-agent="${esc(a.slug)}" aria-pressed="${active ? 'true' : 'false'}" title="${esc(`${a.name}${a.engineLabel ? ` · ${a.engineLabel}` : ''}`)}"><span>${esc(a.sigil || '✦')}</span>${esc(a.name)}</button>`;
      }).join('');
      if (pillsWrap.dataset.lastHtml !== pillsHtml) {
        pillsWrap.dataset.lastHtml = pillsHtml;
        pillsWrap.innerHTML = pillsHtml;
      }
    }
    if (metaEl) {
      const tag = launchReasonLabel || (launchManualTeam ? 'Custom' : 'Auto-matched');
      metaEl.textContent = `${launchTeam.size} selected · ${tag}`;
    }
    const synergyEl = document.getElementById('conclave-synergy-bar');
    if (synergyEl) {
      if (launchMode === 'race') {
        const raceHtml = `<span class="elo-tier-badge tier-aether">⚔ Blind Race</span><span class="conclave-synergy-pill">Auto-selects 2–4 distinct model families</span><span class="conclave-synergy-pill">Tastemaker Judge + Local Elo</span>`;
        if (synergyEl.dataset.lastHtml !== raceHtml) { synergyEl.dataset.lastHtml = raceHtml; synergyEl.innerHTML = raceHtml; }
      } else {
        const syn = computeSquadSynergy(launchTeam);
        const synHtml = `<span class="elo-tier-badge tier-${esc(syn.tier.id)}">${esc(syn.tier.sigil)} ${esc(syn.tier.label)} · OVR ${esc(syn.ovr)}</span><span class="conclave-synergy-pill">${esc(syn.diversityBonus)}</span>${syn.specs.slice(0, 3).map(s => `<span class="conclave-synergy-pill">✓ ${esc(s)}</span>`).join('')}`;
        if (synergyEl.dataset.lastHtml !== synHtml) { synergyEl.dataset.lastHtml = synHtml; synergyEl.innerHTML = synHtml; }
      }
    }
    const modeObj = CONCLAVE_MODES.find(m => m.id === launchMode) || CONCLAVE_MODES[0];
    if (modeHintEl) modeHintEl.textContent = modeObj.hint;
    const dock = dockEl();
    dock?.querySelectorAll('[data-conclave-mode]').forEach(btn => {
      const on = btn.dataset.conclaveMode === launchMode;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', String(on));
    });
    dock?.querySelectorAll('[data-conclave-template]').forEach(btn => {
      const on = btn.dataset.conclaveTemplate === activeTemplateId;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', String(on));
    });
  }

  function renderStandbyFormations() {
    renderLaunchpadControls();
    const wrap = document.getElementById('conclave-standby-formations');
    if (!wrap) return;
    const formations = rosterData?.formations || [];
    wrap.classList.toggle('hidden', !formations.length);
    if (!formations.length) {
      wrap.dataset.lastHtml = '';
      return;
    }
    const html = `<span class="conclave-sf-label">Saved Presets</span>${formations.slice(0, 4).map(f => `<button type="button" class="conclave-formation-chip" data-formation-launch="${esc(f.id)}" title="${esc(`${f.name}: ${f.agents.join(', ')}`)}">${esc(f.sigil || '✦')} ${esc(f.name)} <small>${esc(f.agents.length)}</small></button>`).join('')}`;
    if (wrap.dataset.lastHtml !== html) {
      wrap.dataset.lastHtml = html;
      wrap.innerHTML = html;
    }
  }

  function renderLiveTicker() {
    const el = document.getElementById('conclave-live-ticker');
    if (!el) return;
    const viewData = getEffectiveData();
    const workers = viewData?.workers || [];
    const show = activeLens === 'stage' && !forceShowLaunchpad && (viewData?.mode === 'swarm' || viewData?.mode === 'crew') && workers.length > 0;
    el.classList.toggle('hidden', !show);
    if (!show) {
      el.dataset.lastHtml = '';
      return;
    }
    const html = workers.slice(0, 4).map(wk => {
      const st = statusInfo(wk.status);
      const isSel = wk.workerId === selectedWorkerId;
      const actionBadge = wk.status === 'recovering'
        ? '⚡ GODMODƎ surge'
        : wk.tool && st.active
          ? `⌁ ${wk.tool}${wk.target ? ` ${wk.target.split('/').pop()}` : ''}`
          : wk.isMvp
            ? '★ MVP'
            : st.label;
      const thought = String(wk.streamTail || wk.summary || wk.prompt || 'Reasoning in latent space…').replace(/\s+/g, ' ').slice(0, 88);
      return `<button type="button" class="plt-row tone-${st.tone} ${isSel ? 'is-selected' : ''}" data-ticker-select="${esc(wk.workerId)}" title="Click to inspect &amp; steer ${esc(wk.role)}">
        <i class="plt-dot ${st.active ? 'is-pulsing' : ''}"></i>
        <span class="plt-role">${esc(wk.role)}</span>
        <span class="plt-phase">${esc(actionBadge)}</span>
        <span class="plt-thought">${esc(thought)}</span>
        <span class="plt-time">${fmtMs(wk.durationMs)}</span>
      </button>`;
    }).join('');
    if (el.dataset.lastHtml === html) return;
    el.dataset.lastHtml = html;
    el.innerHTML = html;
  }

  function renderDiffActionsBar() {
    const bar = document.getElementById('conclave-diff-actions');
    if (!bar) return;
    const race = data?.worktreeRace;
    const show = Boolean(race?.candidates?.length) && activeLens === 'stage' && !forceShowLaunchpad;
    bar.classList.toggle('hidden', !show);
    if (!show) {
      bar.dataset.lastHtml = '';
      return;
    }
    const applied = race.appliedCandidateId;
    const html = `<div class="pda-head"><strong>Code Diff Race</strong><span>${esc(race.repository)} · ${esc(race.branch)}</span>${race.lastCheck ? `<span class="conclave-status-pill tone-${race.lastCheck.ok ? 'sage' : 'coral'}">${race.lastCheck.ok ? 'Checks ✓' : 'Checks ✗'}</span>` : ''}</div><div class="pda-btns">${race.candidates.map(c => {
      const isApplied = applied === c.id;
      const canAdopt = c.status === 'ready' && !applied;
      return `<button type="button" class="button ${isApplied ? 'button-primary' : 'button-secondary'} pda-btn" data-diff-wt="${esc(race.worktreeId)}" data-diff-adopt="${esc(c.id)}" ${canAdopt ? '' : 'disabled'}>${isApplied ? '✓ Adopted' : c.status === 'failed' ? '✗ Failed' : `✓ Adopt ${esc(c.slot)} (+${c.additions}/-${c.deletions})`}</button>`;
    }).join('')}</div>`;
    if (bar.dataset.lastHtml === html) return;
    bar.dataset.lastHtml = html;
    bar.innerHTML = html;
  }

  async function adoptDiffCandidate(worktreeId, candidateId) {
    if (!worktreeId || !candidateId) return;
    try {
      const res = await fetch(`/api/worktrees/${encodeURIComponent(worktreeId)}/apply`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-g0d-request': '1' },
        body: JSON.stringify({ candidateId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not apply patch.');
      if (typeof window.toast === 'function') window.toast('✓ Winner patch adopted cleanly into worktree!');
      if (currentTaskId) await loadSnapshot(currentTaskId);
      if (typeof window.refresh === 'function') window.refresh();
    } catch (err) {
      if (typeof window.toast === 'function') window.toast(err.message || 'Patch apply failed.');
    }
  }

  function renderAll() {
    if (!dockEl()?.dataset.conclaveInit) return;
    const mode = data?.mode || 'standby';
    const modeLabels = { arena: 'Conclave Race', crew: 'Coding Crew', swarm: 'Constellation', diff_race: 'Diff Race', standby: 'Standby' };
    const pill = document.getElementById('conclave-mode-pill');
    if (pill) {
      pill.textContent = demoMode ? `${modeLabels[mode] || 'Preview'} · Demo` : (modeLabels[mode] || 'Standby');
      pill.className = `conclave-mode-pill mode-${mode}`;
    }
    const sub = document.getElementById('conclave-subtitle');
    if (sub) {
      sub.textContent = data?.title
        ? `${data.title} · ${data.orchestrator?.modelLabel ? shortModel(data.orchestrator.modelLabel) : 'Orchestrator'}`
        : 'Multi-Agent Conclave Stage';
    }
    const setT = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = String(v); };
    setT('conclave-stat-active', data?.stats?.activeWorkers ?? 0);
    setT('conclave-stat-done', data?.stats?.completedWorkers ?? 0);
    setT('conclave-stat-calls', data?.stats?.totalCalls ?? 0);
    setT('conclave-stat-conflicts', data?.fileConflicts?.length ?? 0);

    // Token / Cost telemetry pill
    const costWrap = document.getElementById('conclave-stat-cost-wrap');
    if (costWrap) {
      const toks = data?.stats?.totalTokens || 0;
      costWrap.classList.toggle('hidden', toks <= 0);
      if (toks > 0) {
        setT('conclave-stat-cost', fmtCost(data?.stats?.totalCostUsd));
        costWrap.title = `${fmtCost(data?.stats?.totalCostUsd)} estimated · ${fmtTokens(toks)}`;
      }
    }
    const legendEl = document.getElementById('conclave-legend');
    if (legendEl) legendEl.classList.toggle('hidden', mode === 'diff_race' || mode === 'standby' || forceShowLaunchpad);

    // Polish trim: only show Preview Swarm in Standby or while Demo is active
    const demoBtn = document.getElementById('conclave-demo-btn');
    if (demoBtn) demoBtn.classList.toggle('hidden', mode !== 'standby' && !demoMode);

    // Pending approval strip
    const apprStrip = document.getElementById('conclave-approval-strip');
    if (apprStrip) {
      const appr = data?.pendingApproval;
      apprStrip.classList.toggle('hidden', !appr);
      if (appr) {
        setT('conclave-approval-tool', appr.tool || 'tool');
        setT('conclave-approval-reason', appr.target || appr.reason || 'Confirmation required');
      }
    }

    const newMissionBtn = document.getElementById('conclave-new-mission-btn');
    if (newMissionBtn) {
      const showNewBtn = mode !== 'standby' && !demoMode;
      newMissionBtn.classList.toggle('hidden', !showNewBtn);
      newMissionBtn.textContent = forceShowLaunchpad ? '← Live Stage' : '+ New Mission';
      newMissionBtn.setAttribute('aria-pressed', String(forceShowLaunchpad));
    }

    const standbyBar = document.getElementById('conclave-standby-bar');
    if (standbyBar) {
      const showPad = mode === 'standby' || forceShowLaunchpad;
      standbyBar.classList.toggle('hidden', !showPad);
      if (showPad) {
        if (!rosterData) loadRoster(false).then(renderStandbyFormations);
        else renderStandbyFormations();
      }
    }

    const roundBanner = document.getElementById('conclave-round-banner');
    if (roundBanner) {
      const cs = data?.conclaveSession;
      const showRound = Boolean(cs && activeLens === 'stage' && !forceShowLaunchpad && !demoMode);
      roundBanner.classList.toggle('hidden', !showRound);
      if (showRound) {
        const html = `<span class="crb-badge">✦ ${esc(cs.modeLabel || cs.mode)}</span><strong class="crb-phase">${esc(cs.phase || `Round ${cs.round}/${cs.totalRounds}`)}</strong><span class="crb-count">${esc((cs.blackboard || []).length)} blackboard notes</span>`;
        if (roundBanner.dataset.lastHtml !== html) {
          roundBanner.dataset.lastHtml = html;
          roundBanner.innerHTML = html;
        }
      }
    }

    updateReplayBar();
    renderDiffActionsBar();
    renderLiveTicker();
    updateHeaderBadge();
    if (activeLens === 'stage') drawStage();
    if (activeLens === 'cards') renderCards();
    if (activeLens === 'timeline') drawTimeline();
    renderInspector();
  }

  function renderCards() {
    const el = document.getElementById('conclave-view-cards');
    if (!el) return;
    const commitCards = (html) => {
      if (el.dataset.lastHtml === html) return;
      el.dataset.lastHtml = html;
      el.innerHTML = html;
    };
    if (data?.mode === 'arena' && data?.arena) {
      const arena = data.arena;
      const raceId = arena.raceId || '';
      const hideNames = blindMode && blindRevealedRaceId !== raceId;
      const crownedId = crownedByRace.get(raceId) || arena.crownedWinnerId || null;
      const effectiveWinner = crownedId || arena.winnerId || null;
      const hasFinished = (arena.contenders || []).some(c => c.status === 'completed' || c.grade);
      const toolbarHtml = `<div class="conclave-race-toolbar">
        <button type="button" class="button button-quiet" data-conclave-blind-toggle>${hideNames ? '👁 Reveal Models' : '🙈 Blind Mode'}</button>
        ${hasFinished ? '<button type="button" class="button button-quiet conclave-match-card-btn" data-conclave-copy-match>📋 Copy Match Card</button>' : ''}
      </div>`;
      commitCards(`${toolbarHtml}<div class="conclave-cards-grid">${(arena.contenders || []).map(c => {
        const isWinner = effectiveWinner ? c.providerId === effectiveWinner : Boolean(c.isWinner);
        const isCrowned = crownedId && c.providerId === crownedId;
        const displayName = hideNames ? `Contender ${c.slot}` : c.label;
        const canCrown = Boolean(currentTaskId && c.providerId && (c.status === 'completed' || c.grade));
        return `<article class="conclave-card ${isWinner ? 'is-winner' : ''}">
          <header class="conclave-card-head">
            <span class="conclave-role-chip">Contender ${esc(c.slot)}</span>
            <span class="conclave-status-pill tone-${isWinner ? 'gold' : c.status === 'completed' ? 'sage' : 'violet'}">${esc(isCrowned ? '👑 Crowned' : isWinner ? '♛ Winner' : c.status)}</span>
          </header>
          <strong class="conclave-card-model">${esc(displayName)}</strong>
          <p class="conclave-card-meta">${fmtMs(c.durationMs)}${c.grade ? ` · Score ${c.grade.total}/15 (F${c.grade.fidelity} C${c.grade.completeness} L${c.grade.clarity})` : ''}</p>
          ${c.grade?.reason ? `<p class="conclave-card-tail">${esc(c.grade.reason)}</p>` : ''}
          ${canCrown ? `<footer class="conclave-card-foot"><button type="button" class="button ${isCrowned ? 'button-primary' : 'button-secondary'} race-crown-btn" data-conclave-crown="${esc(c.providerId)}" data-conclave-race-id="${esc(raceId)}">${isCrowned ? '👑 Crowned (+Elo)' : '👑 Crown Winner'}</button></footer>` : ''}
        </article>`;
      }).join('')}${arena.judge ? `
        <article class="conclave-card">
          <header class="conclave-card-head">
            <span class="conclave-role-chip">Tastemaker Judge</span>
            <span class="conclave-status-pill tone-amber">${esc(arena.judge.status)}</span>
          </header>
          <strong class="conclave-card-model">${esc(hideNames ? 'Blind Judge' : arena.judge.label)}</strong>
          <p class="conclave-card-tail">${esc(arena.note || 'Evaluates drafts blindly for fidelity, completeness, and clarity.')}</p>
        </article>` : ''}</div>`);
      return;
    }
    if (data?.mode === 'diff_race' && data?.worktreeRace?.candidates?.length) {
      const race = data.worktreeRace;
      const applied = race.appliedCandidateId;
      commitCards(`<div class="conclave-cards-grid">${race.candidates.map(c => {
        const isApplied = applied === c.id;
        const canAdopt = c.status === 'ready' && !applied;
        return `<article class="conclave-card ${isApplied ? 'is-winner' : ''}">
          <header class="conclave-card-head">
            <span class="conclave-role-chip">Patch ${esc(c.slot)}</span>
            <span class="conclave-status-pill tone-${isApplied ? 'gold' : c.status === 'ready' ? 'sage' : c.status === 'failed' ? 'coral' : 'violet'}">${esc(isApplied ? '✓ Adopted' : c.status === 'ready' ? 'Patch Ready' : c.status)}</span>
          </header>
          <strong class="conclave-card-model">${esc(c.label)}</strong>
          <p class="conclave-card-meta">+${c.additions} / -${c.deletions} lines · ${fmtMs(c.elapsedMs)}</p>
          ${c.error ? `<p class="conclave-card-tail">${esc(c.error)}</p>` : ''}
          ${c.files?.length ? `<div class="conclave-file-chips">${c.files.slice(0, 4).map(f => `<span class="conclave-file-chip">${esc(f.split('/').pop())}</span>`).join('')}</div>` : ''}
          <footer class="conclave-card-foot">
            <button type="button" class="button ${isApplied ? 'button-primary' : 'button-secondary'}" data-diff-wt="${esc(race.worktreeId)}" data-diff-adopt="${esc(c.id)}" ${canAdopt ? '' : 'disabled'}>${isApplied ? '✓ Winner Adopted' : '✓ Adopt Winner Patch'}</button>
          </footer>
        </article>`;
      }).join('')}</div>`);
      return;
    }
    const workers = data?.workers || [];
    if (!workers.length) {
      commitCards('<div class="conclave-empty-cards"><p>No active or completed workers yet. Switch to <strong>✦ Stage</strong> to launch a Parallel Research Squad or click <strong>Preview Swarm</strong>.</p></div>');
      return;
    }
    const conflictFiles = new Set((data?.fileConflicts || []).map(c => c.file));
    const bbEntries = data?.conclaveSession?.blackboard || [];
    const bbHtml = bbEntries.length ? `
      <section class="conclave-blackboard" aria-label="Shared Conclave Blackboard">
        <div class="conclave-bb-title"><strong>✦ Shared Blackboard</strong><span>${esc(data.conclaveSession.modeLabel || 'Conclave')} · ${bbEntries.length} ${bbEntries.length === 1 ? 'note' : 'notes'}</span></div>
        <div class="conclave-bb-list">${bbEntries.map(e => `
          <details class="conclave-bb-entry">
            <summary class="conclave-bb-head"><strong>R${esc(e.round)} · ${esc(e.sigil || '✦')} ${esc(e.agentName || e.role)}</strong><span class="conclave-bb-kind">${esc(e.kind || 'finding')} · ${esc(shortModel(e.modelLabel || 'Auto'))}</span></summary>
            <p class="conclave-bb-excerpt">${esc(String(e.excerpt || '').slice(0, 900))}</p>
          </details>`).join('')}</div>
      </section>` : '';
    commitCards(`<div class="conclave-cards-grid">${workers.map(w => {
      const st = statusInfo(w.status);
      const selected = w.workerId === selectedWorkerId;
      const files = (w.files || []).slice(0, 4);
      const snippet = w.streamTail || w.summary || w.prompt || 'Awaiting output…';
      const costBits = w.approxTokens ? ` · ${fmtTokens(w.approxTokens)} · ${fmtCost(w.estimatedCostUsd)}` : '';
      return `<article class="conclave-card ${selected ? 'is-selected' : ''} ${w.isMvp ? 'is-winner' : ''} tone-${st.tone}">
        <header class="conclave-card-head">
          <div class="conclave-card-badges">
            <span class="conclave-role-chip">${esc(w.role)}</span>
            ${w.isMvp ? '<span class="conclave-mvp-badge">★ MVP</span>' : ''}
          </div>
          <span class="conclave-status-pill tone-${st.tone}">${esc(w.tool && st.active ? w.tool : st.label)}</span>
        </header>
        <strong class="conclave-card-model">${esc(shortModel(w.modelLabel || w.providerId || 'Auto'))}</strong>
        <p class="conclave-card-meta">${esc(`${w.calls || 0} call${w.calls === 1 ? '' : 's'} · ${fmtMs(w.durationMs)}${costBits}`)}</p>
        <p class="conclave-card-tail">${esc(snippet.slice(0, 180))}</p>
        ${files.length ? `<div class="conclave-file-chips">${files.map(f => `<span class="conclave-file-chip ${conflictFiles.has(f) ? 'is-conflict' : ''}">${esc(f.split('/').pop())}</span>`).join('')}</div>` : ''}
        <footer class="conclave-card-foot">
          <button type="button" class="button button-secondary" data-conclave-select="${esc(w.workerId)}">${selected ? 'Inspecting' : 'Inspect & Steer'}</button>
        </footer>
      </article>`;
    }).join('')}</div>${bbHtml}`);
  }

  function renderInspector() {
    const panel = document.getElementById('conclave-inspector');
    if (!panel) return;
    const worker = (data?.workers || []).find(w => w.workerId === selectedWorkerId);
    if (!worker) {
      panel.classList.add('hidden');
      return;
    }
    panel.classList.remove('hidden');
    const st = statusInfo(worker.status);
    const setT = (id, v) => {
      const el = document.getElementById(id);
      const next = String(v);
      if (el && el.textContent !== next) el.textContent = next;
    };
    setT('pi-role', worker.role || 'worker');
    setT('pi-model', worker.modelLabel || worker.providerId || 'Auto');
    const stEl = document.getElementById('pi-status');
    if (stEl) {
      const nextLabel = worker.tool && st.active ? `${st.label} · ${worker.tool}` : st.label;
      if (stEl.textContent !== nextLabel) stEl.textContent = nextLabel;
      const nextCls = `conclave-status-pill tone-${st.tone}`;
      if (stEl.className !== nextCls) stEl.className = nextCls;
    }
    setT('pi-meta', `${worker.kind === 'crew' ? 'Coding Crew' : worker.viaHarness ? 'External CLI Harness' : 'Specialist Subagent'} · ${worker.calls || 0} calls · ${fmtMs(worker.durationMs)}${worker.approxTokens ? ` · ${fmtTokens(worker.approxTokens)} (${fmtCost(worker.estimatedCostUsd)})` : ''}${worker.isMvp ? ' · ★ MVP' : ''}${worker.tools?.length ? ` · Tools: ${[...new Set(worker.tools)].join(', ')}` : ''}`);
    const filesEl = document.getElementById('pi-files');
    if (filesEl) {
      const files = worker.files || [];
      filesEl.classList.toggle('hidden', files.length === 0);
      const filesHtml = files.map(f => `<span class="conclave-file-chip">${esc(f)}</span>`).join('');
      if (filesEl.dataset.lastHtml !== filesHtml) {
        filesEl.dataset.lastHtml = filesHtml;
        filesEl.innerHTML = filesHtml;
      }
    }
    const outEl = document.getElementById('pi-output');
    const nextOut = String(worker.summary || worker.streamTail || worker.prompt || 'Working…');
    const sel = window.getSelection?.();
    const selectingOutput = Boolean(outEl && sel && !sel.isCollapsed && outEl.contains(sel.anchorNode));
    if (outEl && outEl.textContent !== nextOut && !selectingOutput) outEl.textContent = nextOut;
  }

  function prepCanvas(canvas) {
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(260, Math.round(rect.width));
    const h = Math.max(220, Math.round(rect.height));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h };
  }

  function drawRoundedRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
  }

  function drawStage() {
    const canvas = document.getElementById('conclave-canvas');
    const prep = prepCanvas(canvas);
    if (!prep) return;
    const { ctx, w, h } = prep;
    const pal = themePalette();
    stageHitTargets = [];

    ctx.clearRect(0, 0, w, h);

    // Subtle radial atmospheric glow
    const grad = ctx.createRadialGradient(w * 0.5, h * 0.48, 12, w * 0.5, h * 0.48, Math.max(w, h) * 0.62);
    grad.addColorStop(0, pal.isLight ? 'rgba(109, 40, 217, 0.08)' : 'rgba(167, 139, 250, 0.12)');
    grad.addColorStop(0.55, pal.isLight ? 'rgba(21, 128, 61, 0.03)' : 'rgba(74, 222, 128, 0.04)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // Subtle dot grid
    ctx.fillStyle = pal.isLight ? 'rgba(24,25,27,0.06)' : 'rgba(255,255,255,0.055)';
    for (let gx = 20; gx < w; gx += 28) {
      for (let gy = 20; gy < h; gy += 28) {
        ctx.fillRect(gx, gy, 1.2, 1.2);
      }
    }

    const viewData = getEffectiveData();
    if (viewData?.mode === 'arena' && viewData?.arena) {
      drawArenaRace(ctx, w, h, pal, viewData.arena);
      return;
    }
    if (viewData?.mode === 'diff_race' && viewData?.worktreeRace) {
      drawDiffRace(ctx, w, h, pal, viewData.worktreeRace);
      return;
    }

    const cx = w * 0.5;
    const hasTicker = (viewData?.mode === 'swarm' || viewData?.mode === 'crew') && (viewData?.workers || []).length > 0;
    const cy = viewData?.mode === 'standby' ? h * 0.35 : hasTicker ? h * 0.38 : h * 0.48;
    const rx = Math.min(w * 0.33, 215);
    const ry = Math.min(h * (hasTicker ? 0.25 : 0.31), hasTicker ? 132 : 148);

    // Latent-space harmonic resonance ripples & soft ambient stardust
    ctx.save();
    for (let ring = 0; ring < 3; ring++) {
      const wave = ((animPhase * 0.28 + ring / 3) % 1);
      const alpha = (1 - wave) * (pal.isLight ? 0.08 : 0.11);
      ctx.strokeStyle = pal.isLight ? `rgba(109, 40, 217, ${alpha.toFixed(3)})` : `rgba(167, 139, 250, ${alpha.toFixed(3)})`;
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx * (0.28 + wave * 0.92), ry * (0.28 + wave * 0.92), 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Subtle orbital guides
    ctx.strokeStyle = pal.isLight ? 'rgba(24,25,27,0.10)' : 'rgba(255,255,255,0.09)';
    ctx.setLineDash([4, 6]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx * 0.52, ry * 0.52, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    const workers = (viewData?.workers || []).length
      ? viewData.workers
      : [
          { workerId: '_ghost_1', role: 'explore', modelLabel: 'Standby', status: 'queued', ghost: true },
          { workerId: '_ghost_2', role: 'reviewer', modelLabel: 'Standby', status: 'queued', ghost: true },
          { workerId: '_ghost_3', role: 'verifier', modelLabel: 'Standby', status: 'queued', ghost: true },
        ];

    const coords = new Map();
    const count = workers.length;
    const standbyDrift = workers[0]?.ghost ? Math.sin(animPhase * 0.35) * 0.08 : 0;
    workers.forEach((wk, i) => {
      const angle = -Math.PI / 2 + standbyDrift + (i * Math.PI * 2) / Math.max(1, count);
      const x = cx + Math.cos(angle) * rx;
      const y = cy + Math.sin(angle) * ry;
      coords.set(wk.workerId, { x, y, angle });
    });

    // Soft inter-agent latent attention web (links active peers gently)
    if (!workers[0]?.ghost && workers.length >= 2) {
      ctx.save();
      ctx.strokeStyle = pal.isLight ? 'rgba(109, 40, 217, 0.09)' : 'rgba(167, 139, 250, 0.12)';
      ctx.lineWidth = 1;
      for (let i = 0; i < workers.length; i++) {
        for (let j = i + 1; j < workers.length; j++) {
          const pA = coords.get(workers[i].workerId);
          const pB = coords.get(workers[j].workerId);
          if (!pA || !pB) continue;
          ctx.beginPath();
          ctx.moveTo(pA.x, pA.y);
          ctx.lineTo(pB.x, pB.y);
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    // Labeled shared-file overlap arcs between workers touching the same file
    for (const conflict of (data?.fileConflicts || [])) {
      const a = coords.get(conflict.owners[0]?.workerId);
      const b = coords.get(conflict.owners[1]?.workerId);
      if (a && b) {
        const ctrlX = (a.x + b.x) / 2 + (cx - (a.x + b.x) / 2) * 0.35;
        const ctrlY = (a.y + b.y) / 2 - 22;
        ctx.save();
        ctx.strokeStyle = 'rgba(245, 158, 11, 0.62)';
        ctx.lineWidth = 1.7;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.quadraticCurveTo(ctrlX, ctrlY, b.x, b.y);
        ctx.stroke();
        ctx.setLineDash([]);
        // Labeled overlap pill right on arc midpoint
        const midX = 0.25 * a.x + 0.5 * ctrlX + 0.25 * b.x;
        const midY = 0.25 * a.y + 0.5 * ctrlY + 0.25 * b.y;
        const fname = `⚠ ${String(conflict.file || '').split('/').pop()}`.slice(0, 18);
        ctx.font = '600 9px ui-monospace, SFMono-Regular, monospace';
        const fw = ctx.measureText(fname).width + 12;
        ctx.fillStyle = pal.isLight ? 'rgba(255, 251, 235, 0.96)' : 'rgba(34, 24, 12, 0.92)';
        ctx.strokeStyle = 'rgba(245, 158, 11, 0.65)';
        ctx.lineWidth = 1;
        drawRoundedRect(ctx, midX - fw / 2, midY - 8, fw, 16, 8);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = pal.amber;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(fname, midX, midY + 0.5);
        ctx.restore();
      }
    }

    // Draw bi-directional signal conduits + GODMODƎ golden lightning surge
    workers.forEach((wk, idx) => {
      const pos = coords.get(wk.workerId);
      if (!pos) return;
      const st = statusInfo(wk.status);
      const stroke = wk.ghost
        ? (pal.isLight ? 'rgba(24,25,27,0.12)' : 'rgba(255,255,255,0.12)')
        : st.tone === 'gold' ? pal.gold
        : st.tone === 'amber' ? pal.amber
        : st.tone === 'sage' ? pal.sage
        : st.tone === 'coral' ? pal.coral
        : roleColor(wk.role);

      const mx = (cx + pos.x) / 2 + (pos.y - cy) * 0.14;
      const my = (cy + pos.y) / 2 - (pos.x - cx) * 0.14;

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.quadraticCurveTo(mx, my, pos.x, pos.y);
      ctx.strokeStyle = stroke;
      ctx.globalAlpha = wk.ghost ? 0.5 : st.active ? 0.68 : 0.36;
      ctx.lineWidth = st.active ? 2.2 : 1.4;
      ctx.stroke();

      // GODMODƎ golden recovery lightning bypass arc
      if (wk.status === 'recovering' && !wk.ghost) {
        ctx.beginPath();
        ctx.globalAlpha = 0.85;
        ctx.strokeStyle = pal.gold;
        ctx.lineWidth = 1.6;
        for (let s = 0; s <= 10; s++) {
          const t = s / 10;
          const u = 1 - t;
          const bx = u * u * cx + 2 * u * t * mx + t * t * pos.x;
          const by = u * u * cy + 2 * u * t * my + t * t * pos.y;
          const jitter = s > 0 && s < 10 ? Math.sin(animPhase * 18 + s * 2.7 + idx) * 6 : 0;
          if (s === 0) ctx.moveTo(bx, by);
          else ctx.lineTo(bx + jitter, by - jitter * 0.7);
        }
        ctx.stroke();
      }

      // Bi-directional travelling luminous energy packets (dispatch out + synthesis return!)
      if (st.active && !wk.ghost) {
        for (let p = 0; p < 2; p++) {
          const tOut = (animPhase * 0.68 + idx * 0.23 + p * 0.5) % 1;
          const u = 1 - tOut;
          const px = u * u * cx + 2 * u * tOut * mx + tOut * tOut * pos.x;
          const py = u * u * cy + 2 * u * tOut * my + tOut * tOut * pos.y;
          ctx.globalAlpha = 0.95;
          ctx.fillStyle = st.tone === 'gold' ? pal.gold : stroke;
          ctx.beginPath();
          ctx.arc(px, py, 3.4, 0, Math.PI * 2);
          ctx.fill();
        }
        // Return insight spark flowing back to GODMODƎ nucleus
        const tBack = 1 - ((animPhase * 0.45 + idx * 0.37) % 1);
        const ub = 1 - tBack;
        const rpx = ub * ub * cx + 2 * ub * tBack * mx + tBack * tBack * pos.x;
        const rpy = ub * ub * cy + 2 * ub * tBack * my + tBack * tBack * pos.y;
        ctx.globalAlpha = 0.72;
        ctx.fillStyle = pal.sage;
        ctx.beginPath();
        ctx.arc(rpx, rpy, 2.4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    });

    // Draw Peer Clash Arcs during Round 2+ Critique / Debate sessions
    const cs = viewData?.conclaveSession;
    if (cs && (cs.mode === 'critique' || cs.mode === 'debate') && (Number(cs.round || 1) >= 2 || (cs.blackboard || []).some(b => Number(b.round || 1) >= 2)) && workers.length >= 2) {
      ctx.save();
      for (let i = 0; i < workers.length; i++) {
        const a = coords.get(workers[i].workerId);
        const b = coords.get(workers[(i + 1) % workers.length].workerId);
        if (!a || !b) continue;
        const midX = (a.x + b.x) / 2 + (cx - (a.x + b.x) / 2) * 0.25;
        const midY = (a.y + b.y) / 2 + (cy - (a.y + b.y) / 2) * 0.25;
        ctx.strokeStyle = cs.mode === 'debate' ? pal.amber : pal.gold;
        ctx.lineWidth = 1.6;
        ctx.globalAlpha = 0.52 + 0.25 * Math.sin(animPhase * 3.5 + i);
        ctx.setLineDash([4, 4]);
        ctx.lineDashOffset = -animPhase * 22;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.quadraticCurveTo(midX, midY, b.x, b.y);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Draw Central Orchestrator Nucleus
    const coreR = 40;
    const pulse = 1 + Math.sin(animPhase * 2.4) * 0.08;
    ctx.save();
    const coreHalo = ctx.createRadialGradient(cx, cy, 8, cx, cy, coreR * 1.9 * pulse);
    coreHalo.addColorStop(0, pal.isLight ? 'rgba(109, 40, 217, 0.20)' : 'rgba(167, 139, 250, 0.32)');
    coreHalo.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = coreHalo;
    ctx.beginPath();
    ctx.arc(cx, cy, coreR * 1.9 * pulse, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = pal.panel;
    ctx.strokeStyle = pal.violet;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = pal.text;
    ctx.font = '700 11px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('GODMODƎ', cx, cy - 6);
    ctx.fillStyle = pal.muted;
    ctx.font = '500 9px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillText(shortModel(data?.orchestrator?.modelLabel || 'Orchestrator').slice(0, 13), cx, cy + 10);
    ctx.restore();

    // Draw Orbiting Worker Nodes
    workers.forEach((wk) => {
      const pos = coords.get(wk.workerId);
      if (!pos) return;
      const st = statusInfo(wk.status);
      const r = wk.ghost ? 25 : 30;
      const isSel = wk.workerId === selectedWorkerId;
      const isHov = wk.workerId === hoveredWorkerId;
      const color = wk.ghost ? pal.muted
        : st.tone === 'sage' ? pal.sage
        : st.tone === 'amber' ? pal.amber
        : st.tone === 'gold' ? pal.gold
        : st.tone === 'coral' ? pal.coral
        : roleColor(wk.role);

      if (!wk.ghost) stageHitTargets.push({ workerId: wk.workerId, x: pos.x, y: pos.y, r });

      ctx.save();
      if (st.active && !wk.ghost) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.globalAlpha = 0.45 + 0.3 * Math.sin(animPhase * 4);
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, r + 6 + Math.sin(animPhase * 4) * 2, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (isSel || isHov) {
        ctx.strokeStyle = pal.text;
        ctx.lineWidth = 1.6;
        ctx.globalAlpha = 0.7;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, r + 9, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.globalAlpha = wk.ghost ? 0.55 : 1;
      ctx.fillStyle = pal.panel;
      ctx.strokeStyle = color;
      ctx.lineWidth = isSel ? 2.6 : 2;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Node glyph
      ctx.fillStyle = color;
      ctx.font = '700 12px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const glyph = wk.ghost ? '◌' : st.tone === 'sage' ? '✓' : st.tone === 'coral' ? '!' : st.tone === 'gold' ? '⚡' : st.tone === 'amber' ? '⌁' : '✦';
      ctx.fillText(glyph, pos.x, pos.y - 4);

      const roleTxt = String(wk.role || 'agent').toUpperCase().slice(0, 11);
      ctx.fillStyle = pal.text;
      ctx.font = roleTxt.length >= 9 ? '600 8px ui-monospace, SFMono-Regular, monospace' : '600 9px ui-monospace, SFMono-Regular, monospace';
      ctx.fillText(roleTxt, pos.x, pos.y + 10);

      // Caption pill beneath node
      const caption = wk.ghost
        ? 'ready'
        : wk.tool && st.active
          ? wk.tool
          : `${shortModel(wk.modelLabel || wk.providerId || 'Auto').slice(0, 16)}`;
      ctx.font = '500 10px -apple-system, BlinkMacSystemFont, sans-serif';
      const tw = Math.min(136, ctx.measureText(caption).width + 16);
      const pillX = pos.x - tw / 2;
      const pillY = pos.y + r + 8;
      ctx.fillStyle = pal.isLight ? 'rgba(255,255,255,0.9)' : 'rgba(18,19,22,0.88)';
      ctx.strokeStyle = pal.line;
      ctx.lineWidth = 1;
      drawRoundedRect(ctx, pillX, pillY, tw, 20, 10);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = pal.text;
      ctx.fillText(caption, pos.x, pillY + 10.5);

      // Rotating velocity arc + orbiting tool sparks for active workers
      if (st.active && !wk.ghost) {
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.4;
        ctx.lineCap = 'round';
        ctx.globalAlpha = 0.92;
        const arcStart = animPhase * 2.8 + (wk.workerId?.length || 1);
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, r + 5, arcStart, arcStart + Math.PI * 0.72);
        ctx.stroke();
        if (wk.status === 'tool') {
          for (let sp = 0; sp < 3; sp++) {
            const sa = -animPhase * 3.4 + (sp * Math.PI * 2) / 3;
            ctx.fillStyle = pal.amber;
            ctx.beginPath();
            ctx.arc(pos.x + Math.cos(sa) * (r + 9), pos.y + Math.sin(sa) * (r + 9), 2.3, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.restore();
      }

      // Golden ★ MVP crown OR live elapsed stopwatch pill above node
      if (!wk.ghost && wk.isMvp) {
        ctx.fillStyle = 'rgba(251, 191, 36, 0.18)';
        ctx.strokeStyle = pal.gold;
        ctx.lineWidth = 1.2;
        drawRoundedRect(ctx, pos.x - 24, pos.y - r - 23, 48, 16, 8);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = pal.gold;
        ctx.font = '700 8.5px ui-monospace, SFMono-Regular, monospace';
        ctx.fillText('★ MVP', pos.x, pos.y - r - 14.5);
      } else if (!wk.ghost && wk.durationMs > 0) {
        const tLabel = fmtMs(wk.durationMs);
        ctx.font = '600 8.5px ui-monospace, SFMono-Regular, monospace';
        const etw = Math.max(34, ctx.measureText(tLabel).width + 10);
        ctx.fillStyle = pal.isLight ? 'rgba(255,255,255,0.92)' : 'rgba(18,19,22,0.88)';
        ctx.strokeStyle = st.active ? color : pal.line;
        ctx.lineWidth = 1;
        drawRoundedRect(ctx, pos.x - etw / 2, pos.y - r - 22, etw, 15, 7);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = st.active ? color : pal.muted;
        ctx.fillText(tLabel, pos.x, pos.y - r - 14);
      }

      // File territory chip if present
      if (!wk.ghost && wk.files?.length) {
        const fLabel = wk.files[0].split('/').pop() + (wk.files.length > 1 ? ` +${wk.files.length - 1}` : '');
        ctx.fillStyle = pal.muted;
        ctx.font = '500 9px ui-monospace, SFMono-Regular, monospace';
        ctx.fillText(fLabel.slice(0, 22), pos.x, pillY + 29);
      }
      ctx.restore();
    });
  }

  function drawDiffRace(ctx, w, h, pal, race) {
    const cands = race.candidates || [];
    const leftX = 28;
    const rightPad = 28;
    const trackW = Math.max(140, w - leftX - rightPad);
    ctx.save();
    ctx.fillStyle = pal.muted;
    ctx.font = '600 10px ui-monospace, SFMono-Regular, monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`CODE DIFF RACE · ${String(race.repository || 'worktree').toUpperCase()} (${race.branch || 'branch'})`, leftX, 26);
    ctx.restore();

    const visible = cands.slice(0, 4);
    const maxLines = Math.max(1, ...visible.map(c => (c.additions || 0) + (c.deletions || 0)));
    const readyTimes = visible.filter(c => (c.status === 'ready' || c.status === 'applied') && c.elapsedMs > 0).map(c => c.elapsedMs);
    const fastestMs = readyTimes.length > 1 ? Math.min(...readyTimes) : null;
    const readyTotals = visible.filter(c => c.status === 'ready' || c.status === 'applied').map(c => (c.additions || 0) + (c.deletions || 0));
    const tightestTotal = readyTotals.length > 1 ? Math.min(...readyTotals) : null;

    const laneStep = Math.min(112, Math.max(76, (h - 150) / Math.max(1, visible.length)));
    const totalBlockH = laneStep * visible.length;
    const startY = Math.max(64, (h - 90 - totalBlockH) / 2 + 24);

    visible.forEach((c, idx) => {
      const ly = startY + idx * laneStep;
      const done = c.status === 'ready' || c.status === 'applied';
      const failed = c.status === 'failed';
      const isApplied = c.status === 'applied';
      const totalChg = (c.additions || 0) + (c.deletions || 0);
      const isFastest = done && fastestMs !== null && c.elapsedMs === fastestMs;
      const isTightest = done && tightestTotal !== null && totalChg === tightestTotal && totalChg < maxLines;

      ctx.save();
      // Subtle lane card backdrop
      ctx.fillStyle = pal.isLight ? 'rgba(255,255,255,0.68)' : 'rgba(255,255,255,0.025)';
      ctx.strokeStyle = isApplied ? pal.gold : pal.line;
      ctx.lineWidth = isApplied ? 1.5 : 1;
      drawRoundedRect(ctx, leftX - 10, ly - 32, trackW + 20, 74, 12);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = pal.text;
      ctx.font = '600 12px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.textAlign = 'left';
      const badge = isApplied ? ' · ♛ ADOPTED' : isTightest ? ' · ✦ SURGICAL' : isFastest ? ' · ⚡ FASTEST' : '';
      ctx.fillText(`${c.slot} · ${shortModel(c.label)}${badge}`, leftX, ly - 14);

      ctx.fillStyle = isApplied ? pal.gold : done ? pal.sage : pal.muted;
      ctx.font = '600 11px ui-monospace, SFMono-Regular, monospace';
      ctx.textAlign = 'right';
      const statTxt = done ? `+${c.additions} / -${c.deletions} · ${fmtMs(c.elapsedMs)}` : failed ? 'FAILED' : 'GENERATING PATCH…';
      ctx.fillText(statTxt, leftX + trackW, ly - 14);

      // Track rail
      ctx.fillStyle = pal.isLight ? 'rgba(24,25,27,0.08)' : 'rgba(255,255,255,0.08)';
      drawRoundedRect(ctx, leftX, ly - 2, trackW, 14, 7);
      ctx.fill();

      if (done && totalChg > 0) {
        // Proportional stacked emerald (+additions) + coral (-deletions) bar!
        const footprintW = Math.max(48, trackW * (0.35 + 0.65 * (totalChg / maxLines)));
        const addW = Math.max(c.additions ? 10 : 0, footprintW * (c.additions / totalChg));
        const delW = Math.max(c.deletions ? 8 : 0, footprintW - addW);
        ctx.fillStyle = isApplied ? pal.gold : pal.sage;
        drawRoundedRect(ctx, leftX, ly - 2, addW, 14, delW > 0 ? [7, 0, 0, 7] : 7);
        ctx.fill();
        if (delW > 0) {
          ctx.fillStyle = pal.coral;
          drawRoundedRect(ctx, leftX + addW, ly - 2, delW, 14, [0, 7, 7, 0]);
          ctx.fill();
        }
      } else {
        const sweep = (animPhase * 0.28 + idx * 0.19) % 1;
        const prog = failed ? 0.35 : (0.18 + 0.72 * sweep);
        ctx.fillStyle = failed ? pal.coral : pal.violet;
        drawRoundedRect(ctx, leftX, ly - 2, Math.max(18, trackW * prog), 14, 7);
        ctx.fill();
      }

      if (c.files?.length) {
        ctx.fillStyle = pal.muted;
        ctx.font = '500 9.5px ui-monospace, SFMono-Regular, monospace';
        ctx.textAlign = 'left';
        ctx.fillText(`Files: ${c.files.slice(0, 3).map(f => f.split('/').pop()).join(' · ')}`, leftX, ly + 26);
      }
      ctx.restore();
    });
  }

  function drawArenaRace(ctx, w, h, pal, arena) {
    const contenders = (arena.contenders || []).slice(0, 4);
    const n = Math.max(2, contenders.length);
    const leftX = 26;
    const judgeX = w - 80;
    const trackW = Math.max(130, judgeX - leftX - 46);
    const laneColors = [pal.violet, pal.blue, '#2dd4bf', '#f472b6'];
    const cardH = n >= 4 ? 64 : n === 3 ? 72 : 82;
    const gap = n >= 4 ? 10 : 14;
    const totalH = n * cardH + (n - 1) * gap;
    const topStart = Math.max(46, (h - 76 - totalH) / 2 + 14);
    const centerY = topStart + totalH / 2;

    // Header title inside stage
    ctx.save();
    ctx.fillStyle = pal.muted;
    ctx.font = '600 10px ui-monospace, SFMono-Regular, monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`ULTRA-PLINIAN ${n}-WAY CONCLAVE RACE`, leftX, 24);
    ctx.restore();

    contenders.forEach((c, idx) => {
      const cardTop = topStart + idx * (cardH + gap);
      const ly = cardTop + (n >= 4 ? 26 : 32);
      const done = c.status === 'completed';
      const failed = c.status === 'declined' || c.status === 'failed';
      const gradeRevealed = c._replayGradeRevealed !== undefined ? c._replayGradeRevealed : Boolean(c.grade);
      const arenaSweep = (animPhase * 0.26 + idx * 0.21) % 1;
      const prog = typeof c._replayProg === 'number'
        ? c._replayProg
        : done ? 1 : failed ? 0.45 : (0.18 + 0.72 * arenaSweep);
      const color = c.isWinner ? pal.gold : done ? pal.sage : failed ? pal.coral : (laneColors[idx] || pal.violet);

      ctx.save();
      // Subtle lane panel
      ctx.fillStyle = pal.isLight ? 'rgba(255,255,255,0.72)' : 'rgba(255,255,255,0.025)';
      ctx.strokeStyle = c.isWinner ? pal.gold : pal.line;
      ctx.lineWidth = c.isWinner ? 1.5 : 1;
      drawRoundedRect(ctx, leftX - 10, cardTop, trackW + 20, cardH, 11);
      ctx.fill();
      ctx.stroke();

      // Label above track
      ctx.fillStyle = pal.text;
      ctx.font = '600 11.5px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(`${c.isWinner ? '♛ ' : ''}${c.slot} · ${c.label}`, leftX, ly - 11);

      // Duration / Score right-aligned
      ctx.fillStyle = c.isWinner ? pal.gold : pal.muted;
      ctx.font = '600 10.5px ui-monospace, SFMono-Regular, monospace';
      ctx.textAlign = 'right';
      const rightTxt = (c.grade && gradeRevealed)
        ? `${c.grade.total}/15 · ${fmtMs(c.durationMs)}`
        : (done ? `READY · ${fmtMs(c.durationMs)}` : 'DRAFTING…');
      ctx.fillText(rightTxt, leftX + trackW, ly - 11);

      // Track rail
      ctx.fillStyle = pal.isLight ? 'rgba(24,25,27,0.08)' : 'rgba(255,255,255,0.08)';
      drawRoundedRect(ctx, leftX, ly - 2, trackW, 11, 5.5);
      ctx.fill();

      // Active velocity bar + glowing lead tip while streaming
      const barW = Math.max(16, trackW * prog);
      ctx.fillStyle = color;
      drawRoundedRect(ctx, leftX, ly - 2, barW, 11, 5.5);
      ctx.fill();
      if (!done && !failed) {
        ctx.fillStyle = '#ffffff';
        ctx.globalAlpha = 0.85;
        ctx.beginPath();
        ctx.arc(leftX + barW - 5, ly + 3.5, 2.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      // Converging smooth S-curve wire to Blind Judge
      ctx.strokeStyle = color;
      ctx.globalAlpha = c.isWinner ? 0.92 : 0.42;
      ctx.lineWidth = c.isWinner ? 2.2 : 1.4;
      const sx = leftX + trackW + 10;
      const wireY = cardTop + cardH / 2;
      ctx.beginPath();
      ctx.moveTo(sx, wireY);
      ctx.bezierCurveTo(sx + 24, wireY, judgeX - 46, centerY, judgeX - 30, centerY);
      ctx.stroke();

      if (c.grade && gradeRevealed) {
        ctx.globalAlpha = 1;
        const rubrics = [
          ['Fidelity', c.grade.fidelity],
          ['Complete', c.grade.completeness],
          ['Clarity', c.grade.clarity]
        ];
        const colW = Math.floor(trackW / 3);
        const rY = ly + (n >= 4 ? 20 : 23);
        rubrics.forEach(([lbl, val], ri) => {
          const rx0 = leftX + ri * colW;
          ctx.fillStyle = pal.muted;
          ctx.font = '500 9px ui-monospace, SFMono-Regular, monospace';
          ctx.textAlign = 'left';
          ctx.fillText(`${lbl} ${val}/5`, rx0, rY);
          ctx.fillStyle = pal.isLight ? 'rgba(24,25,27,0.1)' : 'rgba(255,255,255,0.1)';
          drawRoundedRect(ctx, rx0, rY + 5, colW - 14, 3.5, 2);
          ctx.fill();
          ctx.fillStyle = color;
          drawRoundedRect(ctx, rx0, rY + 5, ((colW - 14) * Math.max(0, Math.min(5, val))) / 5, 3.5, 2);
          ctx.fill();
        });
      } else {
        ctx.globalAlpha = 1;
        ctx.fillStyle = pal.muted;
        ctx.font = '500 9px ui-monospace, SFMono-Regular, monospace';
        ctx.textAlign = 'left';
        ctx.fillText(done ? 'Submitted blindly to Judge — awaiting rubric scores…' : 'Streaming independent draft in isolated lane…', leftX, ly + 22);
      }
      ctx.restore();
    });

    // Blind Judge Diamond Node with gentle halo
    const jy = centerY;
    ctx.save();
    const jHalo = ctx.createRadialGradient(judgeX, jy, 6, judgeX, jy, 50);
    jHalo.addColorStop(0, arena.winnerId ? 'rgba(251, 191, 36, 0.28)' : 'rgba(245, 158, 11, 0.22)');
    jHalo.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = jHalo;
    ctx.beginPath();
    ctx.arc(judgeX, jy, 50, 0, Math.PI * 2);
    ctx.fill();

    ctx.translate(judgeX, jy);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = pal.panel;
    ctx.strokeStyle = arena.winnerId ? pal.gold : pal.amber;
    ctx.lineWidth = 2.4;
    drawRoundedRect(ctx, -25, -25, 50, 50, 9);
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.fillStyle = arena.winnerId ? pal.gold : pal.amber;
    ctx.font = '700 13px ui-monospace, SFMono-Regular, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(arena.winnerId ? '♛' : '⚖', judgeX, jy - 3);
    ctx.fillStyle = pal.text;
    ctx.font = '600 9px ui-monospace, SFMono-Regular, monospace';
    ctx.fillText('JUDGE', judgeX, jy + 12);
    if (arena.judge?.label) {
      ctx.fillStyle = pal.muted;
      ctx.font = '500 9.5px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.fillText(shortModel(arena.judge.label).slice(0, 14), judgeX, jy + 46);
    }

    // Verdict / live phase banner neatly anchored below all lanes
    if (arena.note) {
      const bannerY = Math.min(h - 46, topStart + totalH + 26);
      ctx.fillStyle = pal.isLight ? 'rgba(255,255,255,0.82)' : 'rgba(255,255,255,0.035)';
      ctx.strokeStyle = arena.winnerId ? pal.gold : pal.line;
      ctx.lineWidth = 1;
      drawRoundedRect(ctx, leftX - 10, bannerY - 14, w - leftX * 2 + 20, 28, 8);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = arena.winnerId ? pal.gold : pal.text;
      ctx.font = '600 10.5px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(arena.note.slice(0, 82), w / 2, bannerY + 1);
    }
    ctx.restore();
  }

  function drawTimeline() {
    const canvas = document.getElementById('conclave-timeline-canvas');
    const emptyEl = document.getElementById('conclave-timeline-empty');
    const viewData = getEffectiveData();
    const workers = viewData?.workers || [];
    if (emptyEl) emptyEl.classList.toggle('hidden', workers.length > 0);
    if (canvas) canvas.classList.toggle('hidden', workers.length === 0);
    if (!workers.length) return;
    const prep = prepCanvas(canvas);
    if (!prep) return;
    const { ctx, w, h } = prep;
    const pal = themePalette();
    timelineHitTargets = [];
    ctx.clearRect(0, 0, w, h);

    const times = resolveWorkerTimes(workers);
    const minT = Math.min(...times.map(t => t.s));
    const maxT = Math.max(...times.map(t => t.e), minT + 1000);
    const span = Math.max(1000, maxT - minT);

    const labelW = 116;
    const padR = 20;
    const barAreaW = Math.max(100, w - labelW - padR);
    const rowH = 42;
    const topPad = 28;

    // Time axis header
    ctx.fillStyle = pal.muted;
    ctx.font = '500 10px ui-monospace, SFMono-Regular, monospace';
    ctx.textAlign = 'left';
    ctx.fillText('0.0s', labelW, 16);
    ctx.textAlign = 'center';
    ctx.fillText(fmtMs(span / 2), labelW + barAreaW / 2, 16);
    ctx.textAlign = 'right';
    ctx.fillText(fmtMs(span), labelW + barAreaW, 16);

    times.forEach(({ wk, s, e }, idx) => {
      const y = topPad + idx * rowH;
      if (y + rowH > h) return;
      const st = statusInfo(wk.status);
      const x1 = labelW + ((s - minT) / span) * barAreaW;
      const fullBw = Math.max(24, ((e - s) / span) * barAreaW);
      const replayScale = typeof wk._replayFrac === 'number' ? Math.max(0.06, wk._replayFrac) : 1;
      const bw = Math.max(10, fullBw * replayScale);
      const color = wk.isMvp ? pal.gold : st.tone === 'sage' ? pal.sage : st.tone === 'amber' ? pal.amber : st.tone === 'gold' ? pal.gold : st.tone === 'coral' ? pal.coral : roleColor(wk.role);

      timelineHitTargets.push({ workerId: wk.workerId, x: 8, y, w: w - 16, h: rowH - 6 });

      // Row divider
      ctx.strokeStyle = pal.line;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(8, y + rowH - 6);
      ctx.lineTo(w - 8, y + rowH - 6);
      ctx.stroke();

      // Label
      ctx.fillStyle = wk.isMvp ? pal.gold : pal.text;
      ctx.font = '600 11px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(`${wk.isMvp ? '★ ' : ''}${String(wk.role || 'worker').toUpperCase()}`, 12, y + 14);
      ctx.fillStyle = pal.muted;
      ctx.font = '500 9.5px ui-monospace, SFMono-Regular, monospace';
      ctx.fillText(shortModel(wk.modelLabel || wk.providerId || 'Auto').slice(0, 14), 12, y + 28);

      // Swimlane bar
      ctx.fillStyle = color;
      ctx.globalAlpha = wk.workerId === selectedWorkerId ? 0.98 : 0.78;
      drawRoundedRect(ctx, x1, y + 7, bw, 22, 6);
      ctx.fill();
      ctx.globalAlpha = 1;

      const barTxt = `${st.label} · ${fmtMs(wk.durationMs || (e - s))}`;
      if (bw > 74) {
        ctx.fillStyle = pal.isLight ? '#ffffff' : '#0c0d10';
        ctx.font = '700 10px ui-monospace, SFMono-Regular, monospace';
        ctx.textAlign = 'left';
        ctx.fillText(barTxt, x1 + 8, y + 21);
      } else {
        ctx.fillStyle = pal.muted;
        ctx.font = '600 10px ui-monospace, SFMono-Regular, monospace';
        ctx.textAlign = 'left';
        ctx.fillText(barTxt, x1 + bw + 8, y + 21);
      }
    });

    // Vertical playhead line during Time-Travel Replay
    if (typeof viewData?._replayCursorFrac === 'number' && viewData._replayCursorFrac < 1) {
      const px = labelW + viewData._replayCursorFrac * barAreaW;
      ctx.save();
      ctx.strokeStyle = pal.gold;
      ctx.lineWidth = 1.8;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(px, topPad - 6);
      ctx.lineTo(px, Math.min(h - 6, topPad + times.length * rowH));
      ctx.stroke();
      ctx.restore();
    }
  }

  async function loadSnapshot(taskId) {
    if (!taskId || demoMode) return;
    const token = ++fetchToken;
    try {
      const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/conclave`);
      if (!res.ok || token !== fetchToken) return;
      data = await res.json();
      if (data?.arena?.raceId && data.arena.crownedWinnerId) {
        crownedByRace.set(data.arena.raceId, data.arena.crownedWinnerId);
      }
      renderAll();
      // Auto-open gently if multiple workers or an active arena/crew are running for the first time on this task
      const autoTrigger = (data.stats?.activeWorkers >= 2) || (data.mode === 'crew' && data.crew?.status === 'running') || (data.mode === 'arena' && (data.arena?.status === 'drafting' || data.arena?.status === 'grading'));
      if (autoTrigger && !isOpenState && !autoOpenedTaskIds.has(taskId)) {
        autoOpenedTaskIds.add(taskId);
        open();
      }
    } catch {}
  }

  function syncTask(task) {
    const nextId = task?.id || null;
    if (nextId !== currentTaskId) {
      currentTaskId = nextId;
      selectedWorkerId = null;
      forceShowLaunchpad = false;
      replayPlaying = false;
      replayProgress = 100;
      if (demoMode) stopDemo();
      data = null;
    }
    if (nextId && !demoMode) {
      loadSnapshot(nextId);
    } else {
      renderAll();
      updateHeaderBadge();
    }
  }

  function ingestStreamEvent(delta) {
    if (!delta || !currentTaskId) return;
    if (demoMode && (delta.type === 'subagent.started' || delta.type === 'race.dispatched' || delta.type === 'race.contender')) {
      stopDemo();
      data = null;
    }
    if (demoMode) return;
    if (delta.type === 'subagent.started' || delta.type === 'subagent.progress' || delta.type === 'subagent.completed') {
      if (delta.type === 'subagent.started') forceShowLaunchpad = false;
      const wk = delta.worker;
      if (!wk?.workerId) return;
      if (!data) {
        data = {
          taskId: currentTaskId, title: '', status: 'running', mode: 'swarm',
          orchestrator: { modelLabel: 'Orchestrator', status: 'running', calls: 0, maxCalls: 250, recoveries: 0 },
          workers: [], arena: null, failovers: [], fileConflicts: [], pendingApproval: null,
          stats: { totalWorkers: 0, activeWorkers: 0, completedWorkers: 0, failedWorkers: 0, totalCalls: 0 },
        };
      }
      const idx = data.workers.findIndex(w => w.workerId === wk.workerId);
      if (idx >= 0) data.workers[idx] = { ...data.workers[idx], ...wk };
      else data.workers.push(wk);
      data.mode = data.crew ? 'crew' : 'swarm';
      data.stats.totalWorkers = data.workers.length;
      data.stats.activeWorkers = data.workers.filter(w => ['thinking', 'streaming', 'tool', 'recovering'].includes(w.status)).length;
      data.stats.completedWorkers = data.workers.filter(w => w.status === 'completed').length;
      if (data.stats.activeWorkers >= 2 && !isOpenState && !autoOpenedTaskIds.has(currentTaskId)) {
        autoOpenedTaskIds.add(currentTaskId);
        open();
      }
      renderAll();
      return;
    }
    if (delta.type === 'conclave.update' || delta.type === 'conclave.steered' || delta.type === 'race.dispatched' || delta.type === 'race.result' || delta.type === 'race.completed' || delta.type === 'race.crowned' || delta.type === 'permission.requested') {
      loadSnapshot(currentTaskId);
    }
  }

  // ── Conclave Agent Stats Builder & Cross-Harness Roster ──
  function drawRadarChart(canvas, stats, { compact = false } = {}) {
    if (!canvas || !stats?.radar) return;
    const w = compact ? 92 : 196;
    const h = compact ? 84 : 176;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const pal = themePalette();
    const axes = [
      { key: 'swe', label: 'SWE' },
      { key: 'ui', label: 'UI' },
      { key: 'math', label: 'MATH' },
      { key: 'sec', label: 'SEC' },
      { key: 'prose', label: 'PROSE' },
      { key: 'agency', label: 'AGY' },
    ];
    const cx = w / 2;
    const cy = h / 2;
    const radius = compact ? 29 : 58;
    const n = axes.length;

    // Concentric hex web rings (33%, 66%, 100%)
    [0.33, 0.66, 1].forEach((ring, ri) => {
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const ang = -Math.PI / 2 + (i * Math.PI * 2) / n;
        const x = cx + Math.cos(ang) * radius * ring;
        const y = cy + Math.sin(ang) * radius * ring;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.strokeStyle = pal.isLight ? 'rgba(24,25,27,0.12)' : 'rgba(255,255,255,0.11)';
      ctx.lineWidth = ri === 2 ? 1.2 : 0.8;
      ctx.stroke();
    });

    // Radial spokes + axis labels
    axes.forEach((ax, i) => {
      const ang = -Math.PI / 2 + (i * Math.PI * 2) / n;
      const x = cx + Math.cos(ang) * radius;
      const y = cy + Math.sin(ang) * radius;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(x, y);
      ctx.strokeStyle = pal.isLight ? 'rgba(24,25,27,0.09)' : 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 0.8;
      ctx.stroke();

      const lx = cx + Math.cos(ang) * (radius + (compact ? 11 : 18));
      const ly = cy + Math.sin(ang) * (radius + (compact ? 9 : 15));
      ctx.fillStyle = pal.muted;
      ctx.font = compact ? '600 7.5px ui-monospace, SFMono-Regular, monospace' : '600 9px ui-monospace, SFMono-Regular, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(compact ? ax.label.slice(0, 3) : `${ax.label} ${stats.radar[ax.key] ?? 0}`, lx, ly);
    });

    // Data polygon
    const fillTone = stats.overall >= 92 ? (pal.isLight ? 'rgba(217, 119, 6, 0.24)' : 'rgba(251, 191, 36, 0.24)')
      : (pal.isLight ? 'rgba(109, 40, 217, 0.22)' : 'rgba(167, 139, 250, 0.28)');
    const strokeTone = stats.overall >= 92 ? pal.gold : pal.violet;

    ctx.beginPath();
    axes.forEach((ax, i) => {
      const val = Math.max(12, Math.min(100, Number(stats.radar[ax.key] ?? 70))) / 100;
      const ang = -Math.PI / 2 + (i * Math.PI * 2) / n;
      const x = cx + Math.cos(ang) * radius * val;
      const y = cy + Math.sin(ang) * radius * val;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.fillStyle = fillTone;
    ctx.fill();
    ctx.strokeStyle = strokeTone;
    ctx.lineWidth = compact ? 1.6 : 2.1;
    ctx.stroke();

    // Glowing vertices
    axes.forEach((ax, i) => {
      const val = Math.max(12, Math.min(100, Number(stats.radar[ax.key] ?? 70))) / 100;
      const ang = -Math.PI / 2 + (i * Math.PI * 2) / n;
      const x = cx + Math.cos(ang) * radius * val;
      const y = cy + Math.sin(ang) * radius * val;
      ctx.fillStyle = strokeTone;
      ctx.beginPath();
      ctx.arc(x, y, compact ? 2.1 : 3.2, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  let rosterLoadInFlight = null;
  async function loadRoster(force = false) {
    if (rosterData && !force) {
      renderRosterView();
      return true;
    }
    if (rosterLoadInFlight && !force) return rosterLoadInFlight;
    rosterLoadInFlight = (async () => {
      try {
        const res = await fetch('/api/conclave/roster');
        if (!res.ok) return false;
        rosterData = await res.json();
        renderRosterView();
        return true;
      } catch {
        return false;
      } finally {
        rosterLoadInFlight = null;
      }
    })();
    return rosterLoadInFlight;
  }

  function openBuilder(slug = null) {
    if (!rosterData) {
      loadRoster(true).then((ok) => { if (ok && rosterData) openBuilder(slug); });
      return;
    }
    const existing = slug ? (rosterData.agents || []).find(a => a.slug === slug) : null;
    if (existing) {
      builderDraft = { ...existing };
      builderStats = existing.stats || null;
    } else {
      const firstEngine = rosterData.engines?.[0] || null;
      builderDraft = {
        slug: '',
        name: '',
        sigil: '✦',
        engineType: 'api',
        providerId: firstEngine?.id || null,
        harnessId: null,
        harnessCommand: '',
        primarySpecialty: 'swe_coding',
        secondarySpecialty: 'math_reasoning',
        autonomy: 'read_only',
        effort: 'high',
        instructions: 'Deliver surgical, evidence-backed engineering output with zero hand-waving.',
        custom: false,
      };
      builderStats = firstEngine?.stats || null;
    }
    builderOpen = true;
    renderRosterView();
    refreshBuilderStats();
  }

  function openBuilderForHarness(harnessId) {
    if (!rosterData) return;
    const h = (rosterData.harnesses || []).find(x => x.id === harnessId);
    if (!h) return;
    builderDraft = {
      slug: `${h.id.replace(/[^a-z0-9]+/gi, '-')}-agent`,
      name: `${h.shortName} Specialist`,
      sigil: '⚡',
      engineType: 'harness',
      providerId: h.providerId || null,
      harnessId: h.id,
      harnessCommand: h.command || '',
      primarySpecialty: h.id === 'hermes' || h.id === 'grok' ? 'security_research' : 'swe_coding',
      secondarySpecialty: 'math_reasoning',
      autonomy: 'external_harness',
      effort: 'high',
      instructions: `Coordinate directly via ${h.name} (${h.command}). Focus on deep precision, clean diffs, and independent verification.`,
      custom: false,
    };
    builderStats = h.stats || null;
    builderOpen = true;
    renderRosterView();
    refreshBuilderStats();
  }

  function applyArchetypeToDraft(archetypeId) {
    if (!rosterData || !builderDraft) return;
    syncDraftTextFieldsFromDom();
    const arch = (rosterData.archetypes || []).find(a => a.id === archetypeId);
    if (!arch) return;
    builderDraft.name = builderDraft.name || arch.name;
    builderDraft.sigil = arch.sigil;
    builderDraft.primarySpecialty = arch.primarySpecialty;
    builderDraft.secondarySpecialty = arch.secondarySpecialty;
    builderDraft.autonomy = arch.autonomy;
    builderDraft.effort = arch.effort;
    builderDraft.instructions = arch.instructions;
    renderRosterView();
    refreshBuilderStats();
  }

  async function refreshBuilderStats() {
    if (!builderDraft) return;
    try {
      const res = await fetch('/api/conclave/stats/preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-g0d-request': '1' },
        body: JSON.stringify({
          providerId: builderDraft.providerId || null,
          harnessId: builderDraft.harnessId || null,
          primarySpecialty: builderDraft.primarySpecialty,
          secondarySpecialty: builderDraft.secondarySpecialty,
        }),
      });
      if (!res.ok) return;
      const json = await res.json();
      builderStats = json.stats || builderStats;
      builderBestEngine = json.bestEngine || null;
      updateBuilderStatsDom();
    } catch {}
  }

  function applyBestFitEngine() {
    if (!builderDraft || !builderBestEngine?.id) {
      if (typeof window.toast === 'function') window.toast('Connect an API or CLI harness to auto-pick the strongest engine.');
      return;
    }
    syncDraftTextFieldsFromDom();
    builderDraft.engineType = 'api';
    builderDraft.providerId = builderBestEngine.id;
    builderDraft.harnessId = null;
    renderRosterView();
    refreshBuilderStats();
    if (typeof window.toast === 'function') window.toast(`Selected strongest match: ${builderBestEngine.label} (OVR ${builderBestEngine.overall}).`);
  }

  function syncDraftTextFieldsFromDom() {
    if (!builderDraft) return;
    const nameEl = document.getElementById('pb-name');
    const cmdEl = document.getElementById('pb-custom-cmd');
    const instEl = document.getElementById('pb-instructions');
    if (nameEl) builderDraft.name = nameEl.value.trim();
    if (cmdEl) builderDraft.harnessCommand = cmdEl.value.trim();
    if (instEl) builderDraft.instructions = instEl.value.trim();
  }

  async function saveBuilderAgent() {
    syncDraftTextFieldsFromDom();
    if (!builderDraft?.name) {
      if (typeof window.toast === 'function') window.toast('Give your agent a name first.');
      document.getElementById('pb-name')?.focus();
      return;
    }
    try {
      const res = await fetch('/api/conclave/roster', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-g0d-request': '1' },
        body: JSON.stringify(builderDraft),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not save agent.');
      rosterData = json.roster;
      builderOpen = false;
      builderDraft = null;
      renderRosterView();
      if (typeof window.toast === 'function') window.toast(`✦ Forged "${json.agent.name}" (OVR ${json.agent.stats?.overall ?? ''}) — ready for agent.spawn & Squad Deploy.`);
    } catch (err) {
      if (typeof window.toast === 'function') window.toast(err.message || 'Save failed.');
    }
  }

  async function deleteRosterAgent(slug) {
    try {
      const res = await fetch(`/api/conclave/roster/${encodeURIComponent(slug)}`, {
        method: 'DELETE',
        headers: { 'x-g0d-request': '1' },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not delete agent.');
      rosterData = json.roster;
      selectedSquad.delete(slug);
      launchTeam.delete(slug);
      builderOpen = false;
      builderDraft = null;
      renderRosterView();
      renderStandbyFormations();
      if (typeof window.toast === 'function') window.toast(`Removed custom agent "${slug}".`);
    } catch (err) {
      if (typeof window.toast === 'function') window.toast(err.message || 'Delete failed.');
    }
  }

  function toggleSquadMember(slug) {
    if (selectedSquad.has(slug)) selectedSquad.delete(slug);
    else if (selectedSquad.size < 4) selectedSquad.add(slug);
    else if (typeof window.toast === 'function') window.toast('Up to 4 parallel agents per Conclave Squad.');
    renderRosterView();
  }

  function deploySquadSlugs(slugs) {
    const agents = (rosterData?.agents || []).filter(a => slugs.includes(a.slug));
    if (!agents.length) return;
    const lines = agents.map(a => `- agent.spawn(role: "${a.slug}"${a.resolvedProviderId ? `, model: "${a.resolvedProviderId}"` : ''}) — ${a.name} [${a.engineLabel}, OVR ${a.stats?.overall || 85}, ${a.primarySpecialty.replace(/_/g, ' ')}]`);
    const prompt = `Convene a parallel Conclave Squad (${agents.length} specialist${agents.length === 1 ? '' : 's'}) using agent.spawn concurrently:\n${lines.join('\n')}\n\nSynthesize their findings and deliver a verified final result for: `;
    const input = document.getElementById('composer-input');
    if (input) {
      if (isExpanded) toggleExpand();
      const existing = input.value.trim();
      const nextVal = existing ? `${prompt}${existing}` : prompt;
      input.value = nextVal;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.focus();
      input.setSelectionRange(nextVal.length, nextVal.length);
    }
    if (typeof window.toast === 'function') window.toast(`✦ Loaded ${agents.length}-agent Conclave Squad into composer — add your goal and press Enter!`);
  }

  function deploySelectedSquad() {
    if (!selectedSquad.size) {
      const fallback = (rosterData?.agents || []).slice(0, 3).map(a => a.slug);
      deploySquadSlugs(fallback);
      return;
    }
    deploySquadSlugs([...selectedSquad]);
  }

  function deploySingleAgent(slug) {
    const ag = (rosterData?.agents || DEFAULT_STARTER_AGENTS).find(a => a.slug === slug);
    stopDemo();
    launchManualTeam = true;
    launchTeam = new Set([slug]);
    forceShowLaunchpad = true;
    setLens('stage');
    renderAll();
    renderLaunchpadControls(ag?.name || slug);
    const padInput = document.getElementById('conclave-mission-input');
    if (padInput) {
      padInput.focus();
      if (typeof window.toast === 'function') window.toast(`✦ Selected ${ag?.name || slug} — describe your mission and click Launch Conclave.`);
      return;
    }
    deploySquadSlugs([slug]);
  }

  async function saveFormationFromForm() {
    const nameEl = document.getElementById('rf-name');
    const goalEl = document.getElementById('rf-goal');
    const name = (nameEl?.value || '').trim();
    if (!name) {
      if (typeof window.toast === 'function') window.toast('Name your formation first.');
      nameEl?.focus();
      return;
    }
    const slugs = selectedSquad.size ? [...selectedSquad] : (rosterData?.agents || []).slice(0, 3).map(a => a.slug);
    try {
      const res = await fetch('/api/conclave/formations', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-g0d-request': '1' },
        body: JSON.stringify({ name, sigil: '⚔', agents: slugs, goal: (goalEl?.value || '').trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not save formation.');
      if (rosterData) rosterData.formations = json.formations;
      formationFormOpen = false;
      renderRosterView();
      renderStandbyFormations();
      if (typeof window.toast === 'function') window.toast(`⚔ Saved formation "${json.formation.name}" (${slugs.length} agents).`);
    } catch (err) {
      if (typeof window.toast === 'function') window.toast(err.message || 'Save formation failed.');
    }
  }

  async function deleteFormation(id) {
    try {
      const res = await fetch(`/api/conclave/formations/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { 'x-g0d-request': '1' },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not delete formation.');
      if (rosterData) rosterData.formations = json.formations;
      renderRosterView();
      renderStandbyFormations();
      if (typeof window.toast === 'function') window.toast(`Removed formation "${id}".`);
    } catch (err) {
      if (typeof window.toast === 'function') window.toast(err.message || 'Delete failed.');
    }
  }

  async function deployFormation(id) {
    const f = (rosterData?.formations || []).find(x => x.id === id);
    if (!f) return;
    stopDemo();
    const mission = f.goal || launchMission || '';
    if (f.goal && typeof window.launchNativeConclave === 'function') {
      const launched = await window.launchNativeConclave({ mission: f.goal, agents: f.agents, mode: 'parallel', formationName: f.name });
      if (!launched) return;
      if (isExpanded) toggleExpand();
      forceShowLaunchpad = false;
      setLens('stage');
      renderAll();
      if (typeof window.toast === 'function') window.toast(`${f.sigil || '✦'} Launched "${f.name}" (${f.agents.length} specialists)!`);
      return;
    }
    const prompt = buildMissionPrompt(mission, { slugs: f.agents, mode: 'parallel', formationName: f.name });
    if (f.goal && typeof window.submitConclaveMission === 'function') {
      const sent = window.submitConclaveMission(prompt);
      if (!sent) return;
      if (isExpanded) toggleExpand();
      forceShowLaunchpad = false;
      setLens('stage');
      renderAll();
      if (typeof window.toast === 'function') window.toast(`${f.sigil || '✦'} Launched "${f.name}" (${f.agents.length} specialists)!`);
      return;
    }
    // No preset goal yet — bring them cleanly into the Stage Launchpad with these exact agents pre-selected!
    stopDemo();
    launchManualTeam = true;
    launchTeam = new Set(f.agents);
    forceShowLaunchpad = true;
    setLens('stage');
    renderAll();
    renderLaunchpadControls(f.name);
    const padInput = document.getElementById('conclave-mission-input');
    if (padInput) {
      padInput.focus();
      if (typeof window.toast === 'function') window.toast(`${f.sigil || '✦'} Selected "${f.name}" — type your mission and click Launch Conclave.`);
      return;
    }
    const input = document.getElementById('composer-input');
    if (input) {
      if (isExpanded) toggleExpand();
      input.value = prompt;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.focus();
      input.setSelectionRange(prompt.length, prompt.length);
    }
  }

  const fmtCtx = (n) => {
    const v = Number(n) || 128000;
    return v >= 1000000 ? `${(v / 1000000).toFixed(v % 1000000 === 0 ? 0 : 1)}M ctx` : `${Math.round(v / 1000)}K ctx`;
  };
  function updateBuilderStatsDom() {
    const st = builderStats;
    if (!st) return;
    const setT = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = String(val); };
    setT('pb-ovr-num', st.overall ?? 85);
    setT('pb-tier-badge', st.tier || 'A+');
    setT('pb-family-label', `${st.family || 'Model'} · ${fmtCtx(st.contextWindow)}`);
    setT('pb-speed-val', `${st.speed ?? 75}`);
    setT('pb-cost-val', `${st.costIndex ?? 70}`);
    const sp = document.getElementById('pb-speed-bar');
    if (sp) sp.value = st.speed ?? 75;
    const cp = document.getElementById('pb-cost-bar');
    if (cp) cp.value = st.costIndex ?? 70;
    const customWrap = document.getElementById('pb-custom-cmd-wrap');
    if (customWrap) customWrap.classList.toggle('hidden', builderDraft?.engineType !== 'custom_cli');
    drawRadarChart(document.getElementById('pb-radar-canvas'), st, { compact: false });
  }

  function renderRosterView() {
    const el = document.getElementById('conclave-view-roster');
    if (!el) return;
    if (!rosterData) {
      el.innerHTML = '<div class="conclave-empty-cards"><p>Loading Conclave Roster &amp; real benchmark matrix…</p></div>';
      return;
    }
    const agents = rosterData.agents || [];
    const harnesses = rosterData.harnesses || [];
    const engines = rosterData.engines || [];
    const domains = rosterData.domains || [];
    const archetypes = rosterData.archetypes || [];
    const domainOpts = (selected) => domains.map(d => `<option value="${esc(d.id)}" ${d.id === selected ? 'selected' : ''}>${esc(d.shortLabel)}</option>`).join('');

    if (builderOpen && builderDraft) syncDraftTextFieldsFromDom();

    const currentEngineVal = builderDraft
      ? (builderDraft.engineType === 'custom_cli' ? 'custom_cli' : builderDraft.engineType === 'harness' && builderDraft.harnessId ? `harness::${builderDraft.harnessId}` : builderDraft.providerId ? `api::${builderDraft.providerId}` : '')
      : '';

    const builderHtml = builderOpen && builderDraft ? `
      <section class="pb-panel" id="conclave-builder" aria-label="Agent Stats Builder">
        <header class="pb-head">
          <div>
            <h3>⚒ Forge Conclave Agent</h3>
            <p>Stats are calculated live from real benchmark priors &amp; your local per-domain Elo.</p>
          </div>
          <button type="button" class="button button-quiet" id="pb-best-fit" title="Auto-select highest OVR engine for these specialties">✦ Best Fit</button>
        </header>
        <div class="pb-archetypes">
          ${archetypes.map(a => `<button type="button" class="pb-arch-pill" data-pb-archetype="${esc(a.id)}">${esc(a.sigil)} ${esc(a.name)}</button>`).join('')}
        </div>
        <div class="pb-hero">
          <canvas id="pb-radar-canvas" class="pb-radar-canvas" width="196" height="176" aria-label="Live 6-axis agent stat radar"></canvas>
          <div class="pb-readout">
            <div class="pb-ovr-row">
              <span class="pb-ovr-label">OVR</span>
              <strong class="pb-ovr-num" id="pb-ovr-num">${esc(builderStats?.overall ?? 85)}</strong>
              <span class="pb-tier-badge" id="pb-tier-badge">${esc(builderStats?.tier || 'A+')}</span>
            </div>
            <p class="pb-family" id="pb-family-label">${esc(builderStats?.family || 'Model')} · ${fmtCtx(builderStats?.contextWindow)}</p>
            <div class="pb-meter-row"><span>Speed</span><progress id="pb-speed-bar" max="100" value="${esc(builderStats?.speed ?? 75)}"></progress><strong id="pb-speed-val">${esc(builderStats?.speed ?? 75)}</strong></div>
            <div class="pb-meter-row"><span>Efficiency</span><progress id="pb-cost-bar" max="100" value="${esc(builderStats?.costIndex ?? 70)}"></progress><strong id="pb-cost-val">${esc(builderStats?.costIndex ?? 70)}</strong></div>
          </div>
        </div>
        <form id="pb-form" class="pb-form" autocomplete="off">
          <div class="pb-row-two">
            <label>Agent Name<input type="text" id="pb-name" value="${esc(builderDraft.name || '')}" placeholder="e.g. Product Strategist" maxlength="64" required></label>
            <div class="pb-sigil-field">
              <span>Sigil</span>
              <div class="pb-sigil-row">${SIGILS.map(s => `<button type="button" class="pb-sigil-btn ${builderDraft.sigil === s ? 'active' : ''}" data-pb-sigil="${esc(s)}">${esc(s)}</button>`).join('')}</div>
            </div>
          </div>
          <label>Backing Engine or External Harness
            <select id="pb-engine">
              <option value="" ${!currentEngineVal ? 'selected' : ''}>Auto-Route Best Connected Engine</option>
              ${engines.length ? `<optgroup label="Connected Raw APIs &amp; Stack Models">${engines.map(e => `<option value="api::${esc(e.id)}" ${currentEngineVal === `api::${e.id}` ? 'selected' : ''}>${esc(e.label)} (OVR ${esc(e.stats?.overall ?? 80)})</option>`).join('')}</optgroup>` : ''}
              <optgroup label="External Harnesses (Codex, Claude Code, Antigravity, Hermes, Grok…)">
                ${harnesses.map(h => `<option value="harness::${esc(h.id)}" ${currentEngineVal === `harness::${h.id}` ? 'selected' : ''}>${esc(h.name)} · ${h.status === 'connected' ? 'Connected' : h.status === 'installed' ? 'CLI Installed' : 'Bridge'} (OVR ${esc(h.stats?.overall ?? 85)})</option>`).join('')}
              </optgroup>
              <option value="custom_cli" ${currentEngineVal === 'custom_cli' ? 'selected' : ''}>Custom Local CLI Harness Bridge…</option>
            </select>
          </label>
          <label id="pb-custom-cmd-wrap" class="${builderDraft.engineType === 'custom_cli' ? '' : 'hidden'}">Local Harness Command<input type="text" id="pb-custom-cmd" value="${esc(builderDraft.harnessCommand || '')}" placeholder="e.g. agy, codex, claude, hermes, grok" maxlength="120"></label>
          <div class="pb-row-two">
            <label>Primary Specialty<select id="pb-primary">${domainOpts(builderDraft.primarySpecialty)}</select></label>
            <label>Secondary Specialty<select id="pb-secondary">${domainOpts(builderDraft.secondarySpecialty)}</select></label>
          </div>
          <div class="pb-row-two">
            <label>Autonomy
              <select id="pb-autonomy">
                <option value="read_only" ${builderDraft.autonomy === 'read_only' ? 'selected' : ''}>Read-Only Specialist</option>
                <option value="workspace_builder" ${builderDraft.autonomy === 'workspace_builder' ? 'selected' : ''}>Workspace Builder</option>
                <option value="external_harness" ${builderDraft.autonomy === 'external_harness' ? 'selected' : ''}>External Harness Delegate</option>
              </select>
            </label>
            <label>Reasoning Effort
              <select id="pb-effort">
                <option value="fast" ${builderDraft.effort === 'fast' ? 'selected' : ''}>Fast</option>
                <option value="medium" ${builderDraft.effort === 'medium' ? 'selected' : ''}>Medium</option>
                <option value="high" ${builderDraft.effort === 'high' ? 'selected' : ''}>High</option>
                <option value="max" ${builderDraft.effort === 'max' ? 'selected' : ''}>Max</option>
              </select>
            </label>
          </div>
          <label>System Directives<textarea id="pb-instructions" rows="2" maxlength="4000" placeholder="Role instructions injected when spawned…">${esc(builderDraft.instructions || '')}</textarea></label>
          <div class="pb-actions">
            <button type="submit" class="button button-primary" id="pb-save">Save to Conclave</button>
            <button type="button" class="button button-secondary" id="pb-cancel">Cancel</button>
            ${builderDraft.custom && !builderDraft.builtin ? '<button type="button" class="button button-danger" id="pb-delete">Delete</button>' : ''}
          </div>
        </form>
      </section>` : '';

    const prevRfName = document.getElementById('rf-name')?.value ?? null;
    const prevRfGoal = document.getElementById('rf-goal')?.value ?? null;
    const formations = rosterData.formations || [];
    const formationFormHtml = formationFormOpen ? `
      <form id="rf-form" class="rf-form" autocomplete="off">
        <div class="rf-row">
          <input type="text" id="rf-name" placeholder="Formation name (e.g. Security Swarm)" maxlength="48" value="${esc(prevRfName || '')}" required>
          <input type="text" id="rf-goal" placeholder="Optional starter mission prompt…" maxlength="400" value="${esc(prevRfGoal || '')}">
        </div>
        <div class="rf-actions">
          <span class="rf-hint">Saves ${selectedSquad.size ? `${selectedSquad.size} selected` : 'top 3'} roster agents as a 1-click preset</span>
          <button type="submit" class="button button-primary" id="rf-save">Save Formation</button>
          <button type="button" class="button button-quiet" id="rf-cancel">Cancel</button>
        </div>
      </form>` : '';

    el.innerHTML = `
      <div class="roster-toolbar">
        <button type="button" class="button button-primary" id="roster-forge-new">+ Forge Agent</button>
        <div class="roster-squad-tray">
          <span class="roster-squad-count">Squad · ${selectedSquad.size}/4</span>
          <button type="button" class="button button-quiet" id="roster-save-formation-toggle" title="Save selected agents as a 1-click formation">+ Formation</button>
          <button type="button" class="button button-secondary" id="roster-deploy-squad">✦ Deploy Squad</button>
        </div>
      </div>
      ${formationFormHtml}
      <div class="roster-formations" aria-label="Saved 1-click formations">
        <span class="roster-strip-label">Formations</span>
        <div class="roster-harness-pills">
          ${formations.map(f => `<span class="conclave-formation-wrap"><button type="button" class="conclave-formation-chip" data-formation-launch="${esc(f.id)}" title="${esc(`${f.name}: ${f.agents.join(', ')}`)}">${esc(f.sigil || '✦')} ${esc(f.name)} <small>${esc(f.agents.length)}</small></button>${f.custom && !f.builtin ? `<button type="button" class="conclave-formation-del" data-formation-delete="${esc(f.id)}" aria-label="Delete formation ${esc(f.name)}">×</button>` : ''}</span>`).join('')}
        </div>
      </div>
      <div class="roster-harnesses" aria-label="External harnesses and bridges">
        <span class="roster-strip-label">Harnesses</span>
        <div class="roster-harness-pills">
          ${harnesses.map(h => `<button type="button" class="roster-harness-pill status-${esc(h.status)}" data-roster-harness="${esc(h.id)}" title="${esc(`${h.name} (${h.status}) — click to forge an agent for this harness`)}"><i class="rh-dot"></i><span>${esc(h.shortName)}</span><small>${esc(h.stats?.overall ?? 85)}</small></button>`).join('')}
        </div>
      </div>
      ${builderHtml}
      <div class="roster-grid" id="conclave-roster-grid">
        ${agents.map(ag => {
          const inSquad = selectedSquad.has(ag.slug);
          const r = ag.stats?.radar || {};
          const xp = ag.xp || { level: 1, xp: 0, runs: 0 };
          return `<article class="roster-card ${inSquad ? 'is-in-squad' : ''}">
            <header class="roster-card-head">
              <div class="roster-card-id">
                <span class="roster-sigil">${esc(ag.sigil || '✦')}</span>
                <div>
                  <strong>${esc(ag.name)}</strong>
                  <small>${esc(ag.engineLabel)}</small>
                </div>
              </div>
              <div class="roster-badges-col">
                <span class="roster-ovr-pill tier-${esc(String(ag.stats?.tier || 'A').replace('+', 'p'))}">OVR ${esc(ag.stats?.overall ?? 85)} · ${esc(ag.stats?.tier || 'A')}</span>
                <span class="roster-xp-pill" title="${esc(`${xp.xp} XP · ${xp.runs} runs`)}">Lv.${esc(xp.level)}${xp.runs ? ` · ${xp.runs}r` : ''}</span>
              </div>
            </header>
            <div class="roster-card-body">
              <canvas class="roster-mini-radar" data-mini-radar="${esc(ag.slug)}" width="92" height="84" aria-hidden="true"></canvas>
              <div class="roster-stat-grid">
                <span>SWE <strong>${esc(r.swe ?? 80)}</strong></span>
                <span>UI <strong>${esc(r.ui ?? 78)}</strong></span>
                <span>MTH <strong>${esc(r.math ?? 78)}</strong></span>
                <span>SEC <strong>${esc(r.sec ?? 75)}</strong></span>
                <span>WRI <strong>${esc(r.prose ?? 78)}</strong></span>
                <span>AGY <strong>${esc(r.agency ?? 72)}</strong></span>
              </div>
            </div>
            <div class="roster-tags">
              <span class="conclave-file-chip">${esc(ag.primarySpecialty.replace(/_/g, ' '))}</span>
              <span class="conclave-file-chip">${esc(ag.autonomy === 'external_harness' ? 'harness' : ag.autonomy === 'workspace_builder' ? 'builder' : 'read-only')}</span>
              <span class="conclave-status-pill tone-${ag.ready ? 'sage' : 'amber'}">${ag.ready ? 'Ready' : 'Bridge'}</span>
            </div>
            <footer class="roster-card-foot">
              <button type="button" class="button ${inSquad ? 'button-primary' : 'button-secondary'}" data-roster-squad="${esc(ag.slug)}">${inSquad ? '✓ In Squad' : '+ Squad'}</button>
              <button type="button" class="button button-quiet" data-roster-edit="${esc(ag.slug)}">Edit</button>
              <button type="button" class="button button-quiet" data-roster-spawn="${esc(ag.slug)}">Spawn →</button>
            </footer>
          </article>`;
        }).join('')}
      </div>
    `;

    // Paint all Retina radar canvases (builder + each roster card!)
    if (builderOpen && builderStats) {
      drawRadarChart(document.getElementById('pb-radar-canvas'), builderStats, { compact: false });
    }
    el.querySelectorAll('canvas[data-mini-radar]').forEach(cv => {
      const ag = agents.find(a => a.slug === cv.dataset.miniRadar);
      if (ag?.stats) drawRadarChart(cv, ag.stats, { compact: true });
    });
  }

  async function crownContender(providerId, raceId = null) {
    if (!currentTaskId || !providerId) return;
    try {
      const res = await fetch(`/api/tasks/${encodeURIComponent(currentTaskId)}/race-crown`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-g0d-request': '1' },
        body: JSON.stringify({ winnerId: providerId, raceId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not crown contender.');
      if (json.raceId) crownedByRace.set(json.raceId, providerId);
      blindRevealedRaceId = json.raceId || blindRevealedRaceId;
      playTactileCue('conclave');
      const deltaTxt = json.delta >= 0 ? `+${json.delta}` : String(json.delta);
      const label = (data?.arena?.contenders || []).find(c => c.providerId === providerId)?.label || providerId;
      if (typeof window.toast === 'function') {
        window.toast(`👑 Crowned ${label} (${deltaTxt} Elo → ${json.eloAfter} · ${json.tier?.label || 'Ranked'})`);
      }
      renderCards();
      loadLeaderboard();
    } catch (err) {
      if (typeof window.toast === 'function') window.toast(err.message || 'Crown failed.');
    }
  }

  function copyMatchCard() {
    const arena = data?.arena;
    if (!arena?.contenders?.length) return;
    const lines = [
      `## ✦ G0DM0D3 Conclave Match Card`,
      `**Judge:** ${arena.judge?.label || 'Blind Judge'}`,
      '',
      '| Slot | Model | Score | Fidelity | Complete | Clarity | Latency |',
      '|---|---|---:|---:|---:|---:|---:|',
      ...arena.contenders.map(c => {
        const crown = (crownedByRace.get(arena.raceId || '') || arena.winnerId) === c.providerId ? ' 👑' : '';
        const g = c.grade;
        return `| ${c.slot} | ${c.label}${crown} | ${g ? `${g.total}/15` : c.status} | ${g ? g.fidelity : '—'} | ${g ? g.completeness : '—'} | ${g ? g.clarity : '—'} | ${fmtMs(c.durationMs)} |`;
      }),
    ];
    const md = lines.join('\n');
    navigator.clipboard?.writeText(md).then(
      () => { if (typeof window.toast === 'function') window.toast('📋 Copied Conclave Match Card to clipboard.'); },
      () => { if (typeof window.toast === 'function') window.toast('Clipboard unavailable.'); }
    );
  }

  async function loadLeaderboard() {
    const el = document.getElementById('conclave-view-ranks');
    if (el && !leaderboardData) {
      el.innerHTML = '<div class="conclave-empty-cards"><p>Loading local Elo leaderboard…</p></div>';
    }
    try {
      const res = await fetch('/api/conclave/leaderboard', { headers: { 'x-g0d-request': '1' } });
      if (!res.ok) throw new Error('Could not load leaderboard.');
      leaderboardData = await res.json();
      renderRanksView();
    } catch (err) {
      if (el) el.innerHTML = `<div class="conclave-empty-cards"><p>${esc(err.message || 'Leaderboard unavailable.')}</p></div>`;
    }
  }

  function renderRanksView() {
    const el = document.getElementById('conclave-view-ranks');
    if (!el) return;
    const lb = leaderboardData || { rankings: [], domainTop: {}, totals: { models: 0, matches: 0, refusals: 0, topStreak: null } };
    const rows = lb.rankings || [];
    const streakBanner = lb.totals?.topStreak
      ? `<span class="conclave-streak-pill">🔥 ${esc(lb.totals.topStreak.label)} · ${esc(lb.totals.topStreak.streak)}W streak</span>`
      : '';
    const html = `
      <div class="conclave-ranks-head">
        <div>
          <h3>🏆 Local Conclave Ranks</h3>
          <p>Real Elo, Grit (non-refusal), and streaks computed purely from your local runs — zero telemetry.</p>
        </div>
        <div class="conclave-ranks-actions">
          ${streakBanner}
          <button type="button" class="button button-quiet" id="conclave-ranks-refresh">Refresh</button>
        </div>
      </div>
      ${rows.length ? `<ol class="conclave-ranks-list">${rows.map((r, i) => `
        <li class="conclave-rank-row">
          <span class="conclave-rank-pos">#${i + 1}</span>
          <div class="conclave-rank-id">
            <strong>${esc(r.label)}</strong>
            <small>${esc(`${r.wins}W – ${r.losses}L · ${r.winRate}% win · Grit ${r.gritPct}%`)}</small>
          </div>
          <div class="conclave-rank-badges">
            ${r.streak >= 2 ? `<span class="conclave-streak-pill">🔥 ${esc(r.streak)}W</span>` : ''}
            <span class="elo-tier-badge tier-${esc(r.tier?.id || 'obsidian')}">${esc(r.tier?.sigil || '◆')} ${esc(r.tier?.label || 'Obsidian')}</span>
            <strong class="conclave-rank-elo">${esc(r.elo)}</strong>
          </div>
        </li>`).join('')}</ol>` : '<div class="conclave-empty-cards"><p>Run a <strong>⚔ Blind Race</strong>, <strong>Conclave Squad</strong>, or <strong>North Star</strong> hill-climb to populate your personal local Elo leaderboard.</p></div>'}
    `;
    if (el.dataset.lastHtml !== html) {
      el.dataset.lastHtml = html;
      el.innerHTML = html;
    }
  }

  window.G0DConclave = {
    open,
    close,
    toggle,
    setLens,
    syncTask,
    ingestStreamEvent,
    loadSnapshot,
    loadRoster,
    loadLeaderboard,
    crownContender,
    openBuilder,
    startDemo,
    stopDemo,
    recommendTeam,
    buildMissionPrompt,
    launchConclaveFromPad,
    templates: LONG_FORM_TEMPLATES,
    modes: CONCLAVE_MODES,
    isOpen: () => isOpenState,
    getState: () => data,
  };
})();
