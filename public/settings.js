'use strict';

const choice = (name, value, label) => `<label><input type="radio" name="${name}" value="${value}"><span>${label}</span></label>`;
const SETTINGS_ICONS = {
  general: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="3"/><path d="M10 2.5v2M10 15.5v2M3.5 10h2M14.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M15.3 4.7l-1.4 1.4M6.1 13.9l-1.4 1.4"/></svg>',
  shortcuts: '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2.5" y="5" width="15" height="10" rx="2"/><path d="M5.5 8.5h1M8.5 8.5h1M11.5 8.5h1M14.5 8.5h.5M6.5 11.5h7"/></svg>',
  models: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2.5 12 8l5.5 2-5.5 2-2 5.5L8 12l-5.5-2L8 8z"/></svg>',
  recovery: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M15.5 7.5A6 6 0 1 0 16 11"/><path d="M15.5 3.5v4h-4"/></svg>',
  memory: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="6.5"/><circle cx="10" cy="10" r="2.5"/><path d="M10 3.5v2M10 14.5v2"/></svg>',
  prompts: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 5.5h12M4 10h8M4 14.5h10"/><circle cx="15.5" cy="10" r="1.5"/></svg>',
  tools: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m10 2.5 6 2.8v4.8c0 3.8-2.6 6.3-6 7.4-3.4-1.1-6-3.6-6-7.4V5.3z"/></svg>',
  privacy: '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="4.5" y="9" width="11" height="8" rx="2"/><path d="M7 9V6.5a3 3 0 0 1 6 0V9"/></svg>',
  system: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6.5 7 3.5 10l3 3M13.5 7l3 3-3 3M11.2 5l-2.4 10"/></svg>',
  advanced: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3.5 6h13M3.5 10h13M3.5 14h13"/><circle cx="7" cy="6" r="1.6"/><circle cx="13" cy="10" r="1.6"/><circle cx="8.5" cy="14" r="1.6"/></svg>',
};
const SETTINGS_GROUPS = [
  {
    label: 'Workspace',
    tabs: [
      { id: 'general', label: 'General', hint: 'Themes, QoL & chime' },
      { id: 'shortcuts', label: 'Shortcuts', hint: 'Hotkeys & /commands' },
    ],
  },
  {
    label: 'Intelligence',
    tabs: [
      { id: 'models', label: 'Models & APIs', hint: 'Keys, catalog & routing', badgeId: 'settings-badge-models' },
      { id: 'recovery', label: 'Recovery', hint: 'GODMODƎ failover & limits', badgeId: 'settings-badge-recovery' },
    ],
  },
  {
    label: 'Customization',
    tabs: [
      { id: 'memory', label: 'Instructions & Memory', hint: 'Rules, facts & /skills' },
      { id: 'prompts', label: 'Prompt Commands', hint: 'Saved !chat shortcuts' },
    ],
  },
  {
    label: 'Safety & System',
    tabs: [
      { id: 'tools', label: 'Tools & Permissions', hint: 'Gate, shell & hooks', badgeId: 'settings-badge-tools' },
      { id: 'privacy', label: 'Privacy & ZDR', hint: 'Zero telemetry & airgap', badgeId: 'settings-badge-privacy' },
      { id: 'system', label: 'System Lab', hint: 'Prompts, schemas & prefills', badgeId: 'settings-badge-system' },
      { id: 'advanced', label: 'Diagnostics', hint: 'Export, storage & bench' },
    ],
  },
];
const SETTINGS_TABS = SETTINGS_GROUPS.flatMap(g => g.tabs);
document.body.insertAdjacentHTML('beforeend', `<dialog id="settings-dialog" class="modal settings-modal" aria-labelledby="settings-title">
  <header class="modal-header settings-header">
    <div class="settings-header-copy">
      <h2 id="settings-title">Settings</h2>
      <p class="settings-header-sub">Tune workspace, models, rules, permissions, and privacy — changes save automatically.</p>
    </div>
    <div class="settings-header-actions">
      <div class="settings-context" id="settings-context-bar">
        <div id="settings-scope-choices" class="segmented" aria-label="Settings apply to"><button type="button" data-settings-scope="task" aria-pressed="true">This chat</button><button type="button" data-settings-scope="defaults" aria-pressed="false">New chats</button></div>
        <span id="settings-scope" class="settings-scope-pill"></span>
      </div>
      <span class="settings-esc-hint"><kbd>Esc</kbd></span>
      <button type="button" class="icon-button" data-close="settings-dialog" aria-label="Close settings">×</button>
    </div>
  </header>
  <nav class="settings-tabs" role="tablist" aria-label="Settings categories">
    <div class="settings-search-box">
      <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5"/><path d="m13 13 4 4"/></svg>
      <input type="search" id="settings-global-search" placeholder="Search settings…" aria-label="Search all settings" autocomplete="off" spellcheck="false">
      <kbd aria-hidden="true">⌘F</kbd>
    </div>
    ${SETTINGS_GROUPS.map((group, gIdx) => `<div class="settings-nav-group"><span class="settings-nav-group-label">${group.label}</span>${group.tabs.map((tab, tIdx) => {
      const first = gIdx === 0 && tIdx === 0;
      return `<button type="button" role="tab" id="settings-tab-${tab.id}" aria-controls="settings-pane-${tab.id}" aria-selected="${first}" tabindex="${first ? 0 : -1}" data-settings-tab="${tab.id}"><span class="settings-tab-icon" aria-hidden="true">${SETTINGS_ICONS[tab.id] || ''}</span><span class="settings-tab-text"><strong>${tab.label}</strong><small>${tab.hint}</small></span>${tab.badgeId ? `<span class="settings-nav-badge hidden" id="${tab.badgeId}"></span>` : ''}</button>`;
    }).join('')}</div>`).join('')}
  </nav>
  <div class="settings-body">
    <section id="settings-search-results" class="settings-search-results hidden" aria-label="Matching settings"></section>
    <section id="settings-pane-general" role="tabpanel" aria-labelledby="settings-tab-general">
      <header class="settings-pane-head">
        <h3>General</h3>
        <p>Personalize appearance, reading comfort, everyday shortcuts, and audio alerts on this device.</p>
      </header>

      <div class="settings-card">
        <div class="settings-card-head">
          <h4>Appearance &amp; Style</h4>
          <p>Visual theme, reading size, and response tone.</p>
        </div>
        <div class="settings-theme-block">
          <div class="settings-theme-head"><h3>Theme</h3><span id="settings-theme-active">Obsidian</span></div>
          <div id="settings-theme-grid" class="theme-gallery-grid theme-gallery-compact" role="group" aria-label="Theme gallery"></div>
        </div>
        <fieldset class="setting-row plain-fieldset"><legend class="visually-hidden">Text size</legend><div><h3>Text size</h3><p>Adjusts reading size across the app on this device.</p></div><div class="segmented">${choice('settings-text-size','comfortable','Default')}${choice('settings-text-size','large','Larger')}${choice('settings-text-size','extra-large','Largest')}</div></fieldset>
        <fieldset class="setting-row plain-fieldset"><legend class="visually-hidden">Personality</legend><div><h3>Assistant personality</h3><p><strong>Plinian</strong> is expressive and direct; <strong>Focused</strong> keeps replies concise and formal.</p></div><div class="segmented">${choice('settings-persona','plinian','Plinian')}${choice('settings-persona','focused','Focused')}</div></fieldset>
      </div>

      <div class="settings-card">
        <div class="settings-card-head">
          <h4>Quality of Life &amp; Workflow</h4>
          <p>Everyday composer behavior, live preview canvas, diff viewer, and subtle completion alerts.</p>
        </div>
        <fieldset class="setting-row plain-fieldset"><legend class="visually-hidden">Send message shortcut</legend><div><h3>Send message shortcut</h3><p>Choose whether <strong>Enter</strong> sends immediately or inserts a newline (so <strong>⌘/Ctrl+Enter</strong> sends).</p></div><div class="segmented">${choice('qol-send-key','enter','Enter')}${choice('qol-send-key','mod_enter','⌘ / Ctrl + Enter')}</div></fieldset>
        <div class="setting-row"><label for="qol-auto-preview">Auto-open Live Preview Canvas<small>Automatically slide open the split-screen preview dock when a model finishes an HTML5, SVG, or Mermaid artifact.</small></label><input type="checkbox" role="switch" class="toggle" id="qol-auto-preview" data-qol="autoOpenPreview"></div>
        <div class="setting-row"><label for="qol-expand-thinking">Auto-expand reasoning blocks<small>Show completed model <code>Reasoning</code> sections expanded by default instead of collapsed.</small></label><input type="checkbox" role="switch" class="toggle" id="qol-expand-thinking" data-qol="expandThinking"></div>
        <div class="setting-row"><label for="qol-completion-chime">Completion &amp; approval chime<small>Play a soft two-tone chime when a long build finishes or pauses for your approval.</small></label><div class="setting-row-controls"><button type="button" class="button button-quiet settings-test-chime" id="qol-test-chime">Test</button><input type="checkbox" role="switch" class="toggle" id="qol-completion-chime" data-qol="completionChime"></div></div>
        <div class="setting-row"><label for="qol-pause-backdrop">Pause animated theme backdrops<small>Freeze live animated themes on a static art frame to save battery and GPU while keeping full theme colors.</small></label><input type="checkbox" role="switch" class="toggle" id="qol-pause-backdrop" data-qol="pauseBackdrop"></div>
        <fieldset class="setting-row plain-fieldset"><legend class="visually-hidden">Default diff layout</legend><div><h3>Default diff viewer layout</h3><p>Preferred layout inside GODCODƎ’s <strong>Changes</strong> tab.</p></div><div class="segmented">${choice('qol-diff-mode','unified','Unified')}${choice('qol-diff-mode','split','Side-by-side')}</div></fieldset>
      </div>

      <div class="settings-card">
        <div class="settings-card-head">
          <h4>Getting Started &amp; Setup</h4>
          <p>Quickly revisit first-run connections or take the interactive walkthrough.</p>
        </div>
        <div class="setting-row"><div><h3>Inference connections &amp; permissions</h3><p>Review local CLI logins, API keys, and what each connection allows.</p></div><button type="button" class="button button-secondary" data-open-setup>Review setup</button></div>
        <div class="setting-row"><div><h3>Get to know GODMODƎ</h3><p>A 1-minute tour of GODMODƎ recovery, Ultra-Plinian, and model controls.</p></div><button type="button" class="button button-secondary" data-open-tour>Take a quick tour</button></div>
      </div>
    </section>

    <section id="settings-pane-shortcuts" role="tabpanel" aria-labelledby="settings-tab-shortcuts" hidden>
      <header class="settings-pane-head">
        <h3>Keyboard Shortcuts &amp; Slash Commands</h3>
        <p>Fast keyboard navigation and composer commands across GODMODƎ and GODCODƎ.</p>
      </header>
      <div class="settings-card">
        <div class="settings-card-head">
          <h4>Navigation &amp; Workspace</h4>
          <p>Move between panels, tabs, and threads without lifting your hands.</p>
        </div>
        <div class="shortcuts-table">
          <div class="shortcut-row"><span>Open Command Palette</span><kbd>⌘ K</kbd></div>
          <div class="shortcut-row"><span>Focus message composer</span><kbd>/</kbd></div>
          <div class="shortcut-row"><span>Switch GODMODƎ / GODCODƎ mode</span><kbd>⌘ ⇧ G</kbd></div>
          <div class="shortcut-row"><span>Toggle Plan / Build mode</span><kbd>⌘ ⇧ P</kbd></div>
          <div class="shortcut-row"><span>Cycle Permission Gate preset</span><kbd>Shift + Tab</kbd></div>
          <div class="shortcut-row"><span>Switch workspace tabs (Conversation → Activity)</span><kbd>1 – 5</kbd></div>
          <div class="shortcut-row"><span>Previous / next tab or changed file</span><span class="shortcut-keys"><kbd>[ ]</kbd><kbd>j / k</kbd></span></div>
          <div class="shortcut-row"><span>Paste screenshot into composer</span><kbd>⌘ V</kbd></div>
          <div class="shortcut-row"><span>Search inside Settings</span><kbd>⌘ F</kbd></div>
          <div class="shortcut-row"><span>Show quick shortcuts overlay</span><kbd>?</kbd></div>
        </div>
      </div>
      <div class="settings-card">
        <div class="settings-card-head">
          <h4>Composer Slash Commands</h4>
          <p>Type <code>/</code> in the composer for instant autocomplete.</p>
        </div>
        <div class="shortcuts-table">
          <div class="shortcut-row"><span>Switch modes &amp; reasoning effort</span><code>/godmode · /godcode · /effort · /fast</code></div>
          <div class="shortcut-row"><span>Planning, git undo &amp; thread branching</span><code>/plan · /build · /diff · /undo · /fork</code></div>
          <div class="shortcut-row"><span>Context compaction &amp; export</span><code>/compact · /export · /model</code></div>
          <div class="shortcut-row"><span>Memory, skills &amp; engineering workflows</span><code>/remember · /memory · /skill · /review · /test</code></div>
          <div class="shortcut-row"><span>Prompt transparency &amp; privacy shortcuts</span><code>/system · /schemas · /prefill · /privacy · /zdr</code></div>
        </div>
      </div>
    </section>

    <section id="settings-pane-models" role="tabpanel" aria-labelledby="settings-tab-models" hidden>
      <header class="settings-pane-head">
        <h3>Models &amp; APIs</h3>
        <p>Connect cloud API keys, CLI subscriptions, or local Ollama/LM Studio servers, browse catalogs, and configure intelligent routing.</p>
      </header>
      <div class="transparency-subtabs models-subtabs" role="tablist" aria-label="Models sections">
        <button type="button" class="transparency-subtab active" data-models-subtab="connections" role="tab" aria-selected="true">Connections &amp; Keys</button>
        <button type="button" class="transparency-subtab" data-models-subtab="catalog" role="tab" aria-selected="false">Catalog &amp; Backups</button>
        <button type="button" class="transparency-subtab" data-models-subtab="routing" role="tab" aria-selected="false">Routing &amp; Arena</button>
        <button type="button" class="transparency-subtab" data-models-subtab="overseer" role="tab" aria-selected="false">Overseer</button>
      </div>
    </section>

    <section id="settings-pane-recovery" role="tabpanel" aria-labelledby="settings-tab-recovery" hidden>
      <header class="settings-pane-head">
        <h3>GODMODƎ Recovery &amp; Limits</h3>
        <p>Unified control over automatic failover, retry budgets, timeouts, and long-output auto-continuation.</p>
      </header>
      <div class="settings-card">
        <div class="settings-card-head">
          <h4>Automatic Recovery (GODMODƎ)</h4>
          <p>When a model declines, times out, or stalls, GODMODƎ automatically retries or switches to a working fallback model.</p>
        </div>
        <div class="setting-row ultra-setting"><div><h3>GODMODƎ recovery</h3><p>Enable automatic retry &amp; model failover for this route.</p></div><button type="button" id="settings-ultra" class="setting-switch" role="switch" aria-label="GODMODƎ recovery" aria-checked="true"><span>On</span></button></div>
        <p id="settings-recovery-state" class="recovery-readout" role="status"></p>
        <div class="setting-row"><label for="settings-return">Return to preferred model<small>Switch back to your primary model once a fallback gets the task moving.</small></label><input type="checkbox" role="switch" class="toggle" id="settings-return" data-policy="returnToPrimary"></div>
        <div class="setting-row"><label for="settings-sticky-refusal">Stick with working model after decline<small>Keep using the model that helped until it fails, instead of bouncing back to one that just declined.</small></label><input type="checkbox" role="switch" class="toggle" id="settings-sticky-refusal" data-policy="stickyOnRefusal"></div>
        <div class="setting-row"><label for="settings-learning">Learn from outcomes<small>Remember which models succeed best for different tasks — stored locally on this device only.</small></label><input type="checkbox" role="switch" class="toggle" id="settings-learning" data-policy="learning"></div>
        <div class="settings-limits">
          <label>Retry limit<span class="settings-field-hint">Max recovery attempts before asking you</span><input id="settings-attempts" data-policy="maxAttempts" type="number" min="0" max="100" required></label>
          <label>Model call limit<span class="settings-field-hint">Max total turns per task before pausing (default 250)</span><input id="settings-calls" data-policy="maxCalls" type="number" min="1" max="5000" required></label>
        </div>
      </div>

      <div class="settings-card">
        <div class="settings-card-head">
          <h4>Behavior, Timeouts &amp; Continuations</h4>
          <p>Fine-tune how the runtime handles declines, long-running reasoning turns, truncated replies, and stalled loops.</p>
        </div>
        <fieldset class="plain-fieldset"><legend>Recovery behavior</legend><div class="recovery-choices">${[['adaptive','GODMODƎ enabled (Recommended — adapts strategy & model)'],['ask','Ask me before switching or retrying'],['switch_model','Switch models only'],['prompt_strategies','Change prompt approach only'],['hybrid','Change approach first, then switch model']].map(([value,label])=>choice('settings-mode',value,label)).join('')}</div></fieldset>
        <div class="setting-row"><label for="settings-auto-continue">Auto-continue truncated replies<small>Automatically stitch follow-up continuations when a model hits its single-turn output token limit.</small></label><input type="checkbox" role="switch" class="toggle" id="settings-auto-continue" data-policy="autoContinue"></div>
        <div class="settings-limits settings-limits-three">
          <label>Request timeout (seconds)<span class="settings-field-hint">High scales ≥360s, Max ≥600s</span><input id="settings-timeout" data-policy="requestTimeoutMs" type="number" min="0.01" max="900" step="0.01" required></label>
          <label>No-progress limit<span class="settings-field-hint">Turns before intervening (default 6)</span><input id="settings-stalls" data-policy="maxNoProgressTurns" type="number" min="2" max="30" required></label>
          <label>Max continuation hops<span class="settings-field-hint">Auto-stitch passes (0–12, default 6)</span><input id="settings-max-continuations" data-policy="maxContinuations" type="number" min="0" max="12" required></label>
        </div>
        <div class="settings-field-block">
          <label class="field-label" for="settings-strategies">Recovery approaches</label>
          <input id="settings-strategies" data-policy="strategies" type="text">
          <p class="field-help">Comma-separated strategy names. Retries preserve your original request and permissions.</p>
        </div>
      </div>
    </section>

    <section id="settings-pane-tools" role="tabpanel" aria-labelledby="settings-tab-tools" hidden>
      <header class="settings-pane-head">
        <h3>Tools &amp; Permissions</h3>
        <p>Control what actions the AI can run on its own — like editing files, executing shell commands, or browsing the web.</p>
      </header>

      <section class="settings-card permission-gate-section" id="permission-gate-section">
        <div class="permission-gate-header">
          <div>
            <h4>Permission Gate</h4>
            <p class="field-help" id="permission-gate-scope-note">Pick a preset below to decide whether tools run automatically or pause for your approval.</p>
          </div>
          <span class="meta-chip" id="permission-gate-badge">Safe</span>
        </div>
        <div class="permission-presets" role="group" aria-label="Permission presets">
          <button type="button" class="permission-preset-card" data-permission-preset="permissive" aria-pressed="false">
            <strong>Permissive (Auto-Run)</strong>
            <span>Tools run automatically inside workspace guardrails without confirmation prompts.</span>
          </button>
          <button type="button" class="permission-preset-card" data-permission-preset="auto" aria-pressed="false">
            <strong>Auto · AI Judge (Recommended)</strong>
            <span>Overseer checks shell, deletes &amp; fetches; pauses only on risky ops.</span>
          </button>
          <button type="button" class="permission-preset-card" data-permission-preset="acceptEdits" aria-pressed="false">
            <strong>Accept Edits</strong>
            <span>Auto-approve file edits; ask before shell commands, deletes &amp; commits.</span>
          </button>
          <button type="button" class="permission-preset-card" data-permission-preset="safe" aria-pressed="false">
            <strong>Safe Guardrails</strong>
            <span>Ask before any shell command or file deletion; block destructive ops.</span>
          </button>
          <button type="button" class="permission-preset-card" data-permission-preset="default" aria-pressed="false">
            <strong>Ask Everything</strong>
            <span>Confirm every edit, delete, shell command, and git commit.</span>
          </button>
          <button type="button" class="permission-preset-card" data-permission-preset="dontAsk" aria-pressed="false">
            <strong>Don’t Ask (CI)</strong>
            <span>Silently deny shell, deletes &amp; commits without pausing.</span>
          </button>
        </div>
        <p class="field-help settings-tip-bar">Shortcut: press <kbd>Shift+Tab</kbd> in the composer anytime to cycle permission modes. Custom rules below are evaluated top-to-bottom (last match wins).</p>
        <div id="permission-rules-list" class="permission-rules-list"></div>
        <form id="permission-rule-add-form" class="permission-rule-add-form" autocomplete="off">
          <select id="perm-rule-action" aria-label="Rule action"><option value="allow">ALLOW</option><option value="auto">AUTO (AI)</option><option value="ask" selected>ASK</option><option value="deny">DENY</option></select>
          <input id="perm-rule-tool" type="text" maxlength="80" placeholder="Tool (e.g. process.run, repo.*)" aria-label="Tool pattern" required>
          <input id="perm-rule-pattern" type="text" maxlength="240" placeholder="Target glob (e.g. npm test*, src/*)" aria-label="Optional target glob">
          <input id="perm-rule-reason" type="text" maxlength="240" placeholder="Reason (optional)" aria-label="Optional reason">
          <button type="submit" class="button button-secondary" id="perm-rule-add-submit">Add rule</button>
        </form>
      </section>

      <div class="settings-card" id="browser-settings-card">
        <div class="permission-gate-header">
          <div>
            <h4>Agent Browser &amp; Live Viewer</h4>
            <p class="field-help">Watch agents test your apps in real time inside the dock or pop out a real isolated Chromium window (never touches your personal Chrome profile).</p>
          </div>
          <span class="meta-chip" id="browser-chromium-badge">Checking…</span>
        </div>
        <div class="setting-row"><label for="browser-visible-window">Visible browser window (non-headless)<small>Launch agent browser sessions in a real Chromium window for 60fps WebGL, audio, and manual login or CAPTCHA takeover.</small></label><input type="checkbox" role="switch" class="toggle" id="browser-visible-window" data-browser-setting="visibleWindow"></div>
        <div class="setting-row"><label for="browser-live-mirror">In-app live browser mirror<small>Stream live CDP screencast frames and agent click reticles inside the G0DM0D3 right dock.</small></label><input type="checkbox" role="switch" class="toggle" id="browser-live-mirror" data-browser-setting="liveMirror"></div>
        <div class="setting-row"><label for="browser-auto-open">Auto-open mirror when agent browses<small>Automatically open the Live Browser dock the first time an agent opens a URL in a chat.</small></label><input type="checkbox" role="switch" class="toggle" id="browser-auto-open" data-browser-setting="autoOpenMirror"></div>
      </div>

      <div class="settings-card">
        <div class="settings-card-head">
          <h4>Shell Execution &amp; Checks</h4>
          <p>Controls whether the active workspace can run sandboxed terminal commands and automated verification checks.</p>
        </div>
        <p id="settings-tools-empty" class="settings-callout">Open a chat or project workspace first to configure per-task command execution and checks.</p>
        <section id="settings-execution-section"><form id="execution-form">
          <div class="setting-row"><label for="settings-execution">Allow terminal commands<small>Run commands inside this task’s sandboxed working copy.</small></label><input type="checkbox" role="switch" class="toggle" id="settings-execution"></div>
          <div class="setting-row"><label for="settings-network">Allow command network access<small>Let shell commands reach localhost services and the internet (off by default).</small></label><input type="checkbox" role="switch" class="toggle" id="settings-network"></div>
          <div class="setting-row"><label for="settings-command-timeout">Command timeout<small>Maximum seconds a single shell command may run before stopping.</small></label><input id="settings-command-timeout" type="number" min="0.1" max="120" step="0.1" required></div>
        </form><form id="checks-form"><label class="field-label" for="settings-checks">Automated verification checks</label><textarea id="settings-checks" rows="3" placeholder="npm test&#10;npm run build"></textarea><p class="field-help">One command per line. Used to verify code changes before finishing.</p><button class="button button-secondary" type="submit">Save checks</button></form></section>
        <p id="settings-tools-locked" class="field-help"></p>
      </div>

      <section class="settings-card hooks-section" id="hooks-section">
        <div class="permission-gate-header">
          <div>
            <h4>Deterministic Lifecycle Hooks</h4>
            <p class="field-help">Optional local scripts in <code>.g0dc0d3/hooks.json</code> that run automatically before (<code>PreToolUse</code>) or after (<code>PostToolUse</code>) any tool call. Returning exit code <code>2</code> blocks the call.</p>
          </div>
          <span class="meta-chip" id="hooks-count-badge">0 hooks</span>
        </div>
        <div id="hooks-list"></div>
      </section>
    </section>

    <section id="settings-pane-prompts" role="tabpanel" aria-labelledby="settings-tab-prompts" hidden>
      <header class="settings-pane-head">
        <h3>Prompt Commands</h3>
        <p>Save reusable <code>!shortcuts</code> so you never have to re-type favorite instructions. Type <code>!</code> in the composer to pick one, or ask chat to “revise !GRADE to score clarity.”</p>
      </header>
      <div class="settings-card">
        <div class="prompt-library-head"><div><h4>Your saved commands</h4><p class="field-help">Click any command below to edit or refine it.</p></div><button type="button" class="button button-primary" id="prompt-new">+ New command</button></div>
        <div id="prompt-library"><label for="prompt-search" class="visually-hidden">Search prompt commands</label><input id="prompt-search" type="search" placeholder="Search commands by tag or text…" autocomplete="off"><div id="prompt-list"></div></div>
        <form id="prompt-editor" hidden>
          <label for="prompt-tag">Command tag</label><input id="prompt-tag" placeholder="!GRADE" required maxlength="33" spellcheck="false" autocomplete="off">
          <label for="prompt-body">Instructions</label><textarea id="prompt-body" rows="7" maxlength="6000" required></textarea>
          <details id="prompt-revision"><summary>Revise with Venice</summary>
            <label for="prompt-request">What should change?</label><textarea id="prompt-request" rows="2" maxlength="2000" placeholder="Give each criterion a score out of five."></textarea>
            <button type="button" id="prompt-propose" class="button button-secondary">Draft revision</button>
            <div id="prompt-proposal" hidden><label for="prompt-proposed">Suggested instructions</label><textarea id="prompt-proposed" rows="5" maxlength="6000"></textarea><button type="button" id="prompt-accept" class="button button-secondary">Use revision</button></div>
          </details>
          <div class="prompt-actions"><button type="submit" class="button button-primary">Save command</button><button type="button" class="button button-quiet" id="prompt-back">Back to list</button><button type="button" class="button button-quiet" id="prompt-delete">Delete</button></div>
        </form>
      </div>
    </section>

    <section id="settings-pane-system" role="tabpanel" aria-labelledby="settings-tab-system" hidden>
      <header class="settings-pane-head">
        <h3>System Prompts, Tool Schemas &amp; Prefill Lab</h3>
        <p>Full wire-level transparency: inspect or customize every instruction, tool definition, and prefill sent to models. You don’t need to change anything here for everyday use.</p>
      </header>
      <div class="transparency-hero">
        <div class="transparency-hero-top">
          <div>
            <div class="transparency-badges">
              <span class="zdr-badge zdr-local">OPEN WIRE TRANSPARENCY</span>
              <span class="meta-chip" id="transparency-summary-badge">All defaults active</span>
            </div>
            <h4>Nothing hidden behind the curtain</h4>
          </div>
          <button type="button" class="button button-quiet" id="transparency-reset-all">Reset all defaults</button>
        </div>
        <p class="field-help">All edits stay strictly local on this device and apply immediately to live chats. Switch to <strong>Live Wire Preview</strong> to inspect the exact compiled payload.</p>
      </div>
      <div class="transparency-subtabs" role="tablist" aria-label="System transparency sections">
        <button type="button" class="transparency-subtab active" data-trans-subtab="prompts" role="tab" aria-selected="true">System Prompts</button>
        <button type="button" class="transparency-subtab" data-trans-subtab="tools" role="tab" aria-selected="false">Tool Schemas <span class="number-badge" id="trans-tools-count">27</span></button>
        <button type="button" class="transparency-subtab" data-trans-subtab="lab" role="tab" aria-selected="false">Prefills &amp; Shaping</button>
        <button type="button" class="transparency-subtab" data-trans-subtab="wire" role="tab" aria-selected="false">Live Wire Preview</button>
      </div>

      <div class="transparency-panel" id="trans-panel-prompts">
        <div class="transparency-filter-row">
          <input type="search" id="trans-prompt-search" placeholder="Filter system prompts…" aria-label="Filter system prompts" autocomplete="off">
          <button type="button" class="button button-quiet" id="trans-reset-prompts">Reset prompts</button>
        </div>
        <div id="trans-prompts-list" class="transparency-cards"></div>
      </div>

      <div class="transparency-panel hidden" id="trans-panel-tools">
        <div class="transparency-filter-row">
          <input type="search" id="trans-tool-search" placeholder="Filter tool schemas (e.g. browser, repo, web)…" aria-label="Filter tool schemas" autocomplete="off">
          <button type="button" class="button button-quiet" id="trans-reset-tools">Reset schemas</button>
        </div>
        <div id="trans-tool-categories" class="transparency-cat-pills" role="group" aria-label="Filter tools by category"></div>
        <div id="trans-tools-list" class="transparency-cards"></div>
      </div>

      <div class="transparency-panel hidden" id="trans-panel-lab">
        <div class="lab-header-bar">
          <div class="setting-row lab-master-row"><label for="lab-injections-enabled">Enable Prefills &amp; Message Shaping<small>Apply the active conditioning and prefill slots below to every live chat request.</small></label><input type="checkbox" role="switch" class="toggle" id="lab-injections-enabled"></div>
          <div class="setting-row lab-master-row"><label for="lab-stitch-prefill">Auto-stitch assistant prefill into reply<small>Prepends your Assistant Prefill text to the displayed response when the model returns only its continuation.</small></label><input type="checkbox" role="switch" class="toggle" id="lab-stitch-prefill" checked></div>
        </div>
        <p class="field-help">Experimental research controls — custom prefills and message shaping are sent directly to your chosen provider under their Terms of Service.</p>
        <div class="lab-presets-block">
          <span class="field-label">Quick Lab Presets</span>
          <div id="lab-presets-row" class="lab-presets-row"></div>
        </div>
        <form id="lab-injections-form" class="lab-pipeline" autocomplete="off">
          <div class="lab-slot">
            <div class="lab-slot-head"><span class="wire-role-badge role-system">1 · SYSTEM PREFIX</span><small>Prepended before the system prompt</small></div>
            <textarea id="lab-system-prefix" rows="2" class="transparency-code-input" placeholder="Optional text prepended at the very start of the system prompt…" spellcheck="false"></textarea>
          </div>
          <div class="lab-slot">
            <div class="lab-slot-head"><span class="wire-role-badge role-system">2 · SYSTEM SUFFIX</span><small>Appended after the system prompt, tools &amp; persona</small></div>
            <textarea id="lab-system-suffix" rows="2" class="transparency-code-input" placeholder="Optional text appended at the very end of the system prompt…" spellcheck="false"></textarea>
          </div>
          <div class="lab-slot">
            <div class="lab-slot-head"><span class="wire-role-badge role-fewshot">3 · SYNTHETIC TURN (FEW-SHOT BRIDGE)</span><small>Injected right before your latest user message</small></div>
            <div class="two-fields">
              <div><label class="field-label" for="lab-fewshot-user">Synthetic User</label><textarea id="lab-fewshot-user" rows="2" class="transparency-code-input" placeholder="Optional synthetic user turn…" spellcheck="false"></textarea></div>
              <div><label class="field-label" for="lab-fewshot-assistant">Synthetic Assistant</label><textarea id="lab-fewshot-assistant" rows="2" class="transparency-code-input" placeholder="Optional synthetic assistant turn…" spellcheck="false"></textarea></div>
            </div>
          </div>
          <div class="lab-slot">
            <div class="lab-slot-head"><span class="wire-role-badge role-user">4 · USER TURN WRAPPER</span><small>Wraps your latest message text</small></div>
            <div class="two-fields">
              <div><label class="field-label" for="lab-user-prefix">User Prefix</label><textarea id="lab-user-prefix" rows="2" class="transparency-code-input" placeholder="e.g. &lt;request&gt;\n" spellcheck="false"></textarea></div>
              <div><label class="field-label" for="lab-user-suffix">User Suffix</label><textarea id="lab-user-suffix" rows="2" class="transparency-code-input" placeholder="e.g. \n&lt;/request&gt;" spellcheck="false"></textarea></div>
            </div>
          </div>
          <div class="lab-slot">
            <div class="lab-slot-head"><span class="wire-role-badge role-think">5 · REASONING / &lt;think&gt; PREFILL</span><small>Seeds internal reasoning trace on open-weight &amp; chat-completions reasoning models</small></div>
            <textarea id="lab-reasoning-prefill" rows="3" class="transparency-code-input" placeholder="Optional reasoning seed (automatically wrapped in &lt;think&gt;\n… if you omit the tag)…" spellcheck="false"></textarea>
          </div>
          <div class="lab-slot">
            <div class="lab-slot-head"><span class="wire-role-badge role-assistant">6 · ASSISTANT RESPONSE PREFILL</span><small>Forces the opening tokens of the assistant reply (auto-falls back cleanly if an endpoint rejects trailing assistant turns)</small></div>
            <textarea id="lab-assistant-prefill" rows="2" class="transparency-code-input" placeholder="e.g. Sure — here is the complete solution:\n\n" spellcheck="false"></textarea>
          </div>
          <div class="lab-actions-row">
            <button type="submit" class="button button-primary" id="lab-save-btn">Save Lab Config</button>
            <button type="button" class="button button-quiet" id="lab-reset-btn">Clear &amp; Disable Lab</button>
          </div>
        </form>
      </div>

      <div class="transparency-panel hidden" id="trans-panel-wire">
        <div class="wire-toolbar">
          <div class="segmented" id="wire-mode-switch" role="group" aria-label="Compiled prompt preview mode">
            <button type="button" data-wire-mode="directChat" aria-pressed="true">GODMODƎ Direct Chat</button>
            <button type="button" data-wire-mode="agentLoop" aria-pressed="false">GODCODƎ Agent Loop</button>
          </div>
          <div class="wire-toolbar-actions">
            <span class="meta-chip" id="wire-stats-badge">0 chars</span>
            <button type="button" class="button button-secondary" id="wire-copy-prompt">Copy prompt</button>
            <button type="button" class="button button-quiet" id="wire-copy-tools">Copy schemas JSON</button>
          </div>
        </div>
        <p class="field-help" id="wire-scope-note"></p>
        <h4>Exact Compiled System Prompt</h4>
        <pre id="wire-system-preview" class="wire-pre" tabindex="0"></pre>
        <div id="wire-messages-wrap">
          <h4>Wire Message Stack (with active injections &amp; prefills)</h4>
          <div id="wire-messages-list" class="wire-messages-list"></div>
        </div>
        <details class="wire-tools-details">
          <summary>Active Advertised Tool Schemas (<span id="wire-tools-count">0</span> tools)</summary>
          <pre id="wire-tools-preview" class="wire-pre" tabindex="0"></pre>
        </details>
      </div>
    </section>

    <section id="settings-pane-memory" role="tabpanel" aria-labelledby="settings-tab-memory" hidden>
      <header class="settings-pane-head">
        <h3>Instructions, Memory &amp; Skills</h3>
        <p>Set always-on global rules, teach the assistant facts to remember across chats, and save reusable <code>/slash</code> workflows.</p>
      </header>
      <section class="settings-card personal-rules-section">
        <div class="settings-card-head">
          <h4>Personal Instructions (Global Rules)</h4>
          <p>Appended to every live system prompt — like Cursor Rules or Claude Preferences (synced with System Lab’s <code>customAppend</code>).</p>
        </div>
        <form id="personal-instructions-form" autocomplete="off">
          <textarea id="personal-instructions-input" class="transparency-code-input" rows="4" placeholder="e.g. Prefer concise TypeScript with strict types. Always write unit tests for edge cases. Never add unnecessary dependencies." aria-label="Personal global instructions" spellcheck="false"></textarea>
          <div class="settings-card-foot">
            <button type="submit" class="button button-primary" id="personal-instructions-save">Save instructions</button>
            <button type="button" class="button button-secondary" id="personal-instructions-clear">Clear</button>
            <span class="field-help" id="personal-instructions-status" role="status"></span>
          </div>
        </form>
      </section>
      <section class="settings-card memory-section">
        <div class="section-header-inline">
          <div>
            <h4>Cross-session memory</h4>
            <p class="field-help">Saved facts and conventions recalled automatically. Quick tip: type <code>/remember &lt;note&gt;</code> directly in chat.</p>
          </div>
          <code class="memory-file-pill" id="memory-file-path"></code>
        </div>
        <div class="memory-search-row">
          <input id="memory-search" type="search" placeholder="Search saved memories…" aria-label="Search saved memories" autocomplete="off">
        </div>
        <div id="memory-list" class="memory-list"></div>
        <details class="memory-add-disclosure" id="memory-add-disclosure">
          <summary>+ Add memory <span aria-hidden="true">⌄</span></summary>
          <form id="memory-add-form" class="memory-form" autocomplete="off">
            <div class="two-fields">
              <div><label class="field-label" for="memory-title">Title</label><input id="memory-title" type="text" maxlength="120" placeholder="e.g. Test runner convention" required></div>
              <div><label class="field-label" for="memory-scope">Scope</label><select id="memory-scope"><option value="global">Global (all projects)</option><option value="project">Current project</option></select></div>
            </div>
            <label class="field-label" for="memory-content">Details</label>
            <textarea id="memory-content" rows="3" maxlength="4000" placeholder="Always run npm test before committing changes." required></textarea>
            <label class="field-label" for="memory-tags">Tags <span class="optional">comma-separated</span></label>
            <input id="memory-tags" type="text" maxlength="240" placeholder="testing, workflow">
            <div class="memory-form-actions"><button type="submit" class="button button-primary" id="memory-add-submit">Save memory</button></div>
          </form>
        </details>
      </section>
      <section class="settings-card skills-section">
        <div class="section-header-inline">
          <div>
            <h4>Skills &amp; custom /slash commands</h4>
            <p class="field-help">Markdown skills show up in <code>/</code> autocomplete and <code>⌘K</code>. Use <code>$ARGUMENTS</code> inside instructions to pass text after the command.</p>
          </div>
        </div>
        <div id="skills-list" class="skills-list"></div>
        <details class="memory-add-disclosure" id="skill-add-disclosure">
          <summary>+ Save reusable skill <span aria-hidden="true">⌄</span></summary>
          <form id="skill-add-form" class="memory-form" autocomplete="off">
            <div class="two-fields">
              <div><label class="field-label" for="skill-name">Command name</label><input id="skill-name" type="text" maxlength="49" pattern="[a-z0-9][a-z0-9_\\-]{0,48}" placeholder="e.g. audit-auth" required></div>
              <div><label class="field-label" for="skill-mode">Mode</label><select id="skill-mode"><option value="">Any mode</option><option value="plan">Plan Mode</option><option value="build">Build Mode</option></select></div>
            </div>
            <label class="field-label" for="skill-description">Description <span class="optional">optional</span></label>
            <input id="skill-description" type="text" maxlength="240" placeholder="Review authentication paths for token and CSRF gaps">
            <label class="field-label" for="skill-body">Instructions</label>
            <textarea id="skill-body" rows="4" placeholder="Inspect all auth handlers related to $ARGUMENTS and list concrete findings with file paths." required></textarea>
            <div class="memory-form-actions"><button type="submit" class="button button-primary" id="skill-add-submit">Save skill</button></div>
          </form>
        </details>
      </section>
    </section>

    <section id="settings-pane-privacy" role="tabpanel" aria-labelledby="settings-tab-privacy" hidden>
      <header class="settings-pane-head">
        <h3>Privacy &amp; Data Retention</h3>
        <p>Keep your prompts private, enforce Zero Data Retention (ZDR) with cloud providers, or lock inference strictly to local models on this device.</p>
      </header>
      <div class="privacy-hero" role="status">
        <div class="privacy-hero-head">
          <span class="zdr-badge zdr-local">ZERO TELEMETRY</span>
          <strong>No analytics, no crash beacons, no phone-home</strong>
        </div>
        <p class="field-help">G0DC0D3 ships with zero telemetry endpoints, never fingerprints local CLI auth files, and forcibly disables vendor CLI telemetry env vars (<code>DO_NOT_TRACK</code>, <code>OTEL_SDK_DISABLED</code>, <code>DISABLE_TELEMETRY</code>).</p>
      </div>
      <section class="settings-card security-profile-card" id="security-profile-card">
        <div class="permission-gate-header">
          <div>
            <h4>Security Posture &amp; Lockdown Mode</h4>
            <p class="field-help">1-click OPSEC presets bundling ZDR enforcement, secret scrubbing, permission gates, Rules-of-Engagement scope, and ephemeral burn-bag controls for red teams, bug bounty &amp; IR.</p>
          </div>
          <span class="meta-chip" id="security-profile-badge">Standard</span>
        </div>
        <div class="security-profiles-grid" role="group" aria-label="Security posture presets">
          <button type="button" class="security-profile-btn" data-security-profile="standard" aria-pressed="true">
            <strong>Standard</strong>
            <span>ZDR request routing &amp; secret scrubbing on. Everyday coding and chat.</span>
          </button>
          <button type="button" class="security-profile-btn is-hardened" data-security-profile="hardened" aria-pressed="false">
            <strong>⛨ Hardened (Red Team / Bounty)</strong>
            <span>Locks Strict ZDR + secret scrubbing + Safe gate + Ephemeral engagement (no disk memory/learning).</span>
          </button>
          <button type="button" class="security-profile-btn is-lockdown" data-security-profile="lockdown" aria-pressed="false">
            <strong>⛨ Airgap Lockdown</strong>
            <span>Zero cloud egress (local models only) + Ask Everything gate + Ephemeral engagement.</span>
          </button>
        </div>
        <div class="setting-row"><label for="privacy-ephemeral-session">Ephemeral Engagement ("Burn Bag")<small>Pauses cross-session memory saves and local outcome learning so sensitive engagement artifacts stay strictly scoped.</small></label><input type="checkbox" role="switch" class="toggle" id="privacy-ephemeral-session" data-privacy-toggle="ephemeralSession"></div>
        <div class="scope-guard-block">
          <div class="scope-guard-head">
            <h5>Rules-of-Engagement Target Scope (Optional)</h5>
            <span class="meta-chip" id="privacy-scope-badge">Unrestricted</span>
          </div>
          <p class="field-help">Mechanically enforced before every <code>web.fetch</code> and <code>browser.open</code> call. Comma- or newline-separated hostnames or <code>*.domain</code> wildcards.</p>
          <div class="scope-fields-grid">
            <label class="field-label" for="privacy-scope-allow">In-scope allowlist <span class="optional">blank = allow public hosts</span><input id="privacy-scope-allow" type="text" placeholder="e.g. *.target-bounty.com, staging.app.io, localhost" autocomplete="off" spellcheck="false"></label>
            <label class="field-label" for="privacy-scope-deny">Out-of-scope denylist <span class="optional">always blocked</span><input id="privacy-scope-deny" type="text" placeholder="e.g. prod.target-bounty.com, billing.*" autocomplete="off" spellcheck="false"></label>
          </div>
          <div class="burn-bag-row">
            <button type="button" class="button button-secondary" id="privacy-scope-save">Save target scope</button>
            <button type="button" class="button button-quiet burn-bag-btn" id="privacy-burn-btn" title="Clear outbound audit log, local learning, learned refusal signatures, and close ephemeral browser sessions">Burn session data</button>
          </div>
        </div>
      </section>
      <section class="settings-card privacy-controls-section">
        <div class="settings-card-head">
          <h4>Zero Data Retention (ZDR) &amp; Airgap Controls</h4>
          <p>Control where prompts are allowed to travel and whether API keys or secrets are scrubbed first.</p>
        </div>
        <div class="setting-row"><label for="privacy-zdr-routing">ZDR request routing<small>Ask providers not to log or train on prompts (OpenRouter <code>provider.zdr=true</code> + <code>data_collection="deny"</code>, OpenAI <code>store=false</code>).</small></label><input type="checkbox" role="switch" class="toggle" id="privacy-zdr-routing" data-privacy-toggle="zdrRouting"></div>
        <div class="setting-row"><label for="privacy-strict-zdr">Strict ZDR Gate<small>Block sending or falling back to providers without verified ZDR (sets <code>allow_fallbacks=false</code> on OpenRouter).</small></label><input type="checkbox" role="switch" class="toggle" id="privacy-strict-zdr" data-privacy-toggle="strictZdr"></div>
        <div class="setting-row"><label for="privacy-local-only">Local-only airgap mode<small>Only allow loopback local models (Ollama, LM Studio, MLX) and pause cloud catalog refreshes.</small></label><input type="checkbox" role="switch" class="toggle" id="privacy-local-only" data-privacy-toggle="localOnly"></div>
        <div class="setting-row"><label for="privacy-redact-secrets">Outbound secret redaction<small>Automatically scrub recognized API keys and tokens before cloud requests (best effort — always review sensitive files).</small></label><input type="checkbox" role="switch" class="toggle" id="privacy-redact-secrets" data-privacy-toggle="redactOutboundSecrets"></div>
      </section>
      <section class="settings-card">
        <div class="settings-card-head">
          <h4>Provider ZDR posture</h4>
          <p>Honest retention status per configured model — never claims ZDR where retention depends on vendor terms.</p>
        </div>
        <div id="privacy-providers-list" class="privacy-providers-list"></div>
      </section>
      <section class="settings-card">
        <div class="section-header-inline">
          <div>
            <h4>Live outbound network audit</h4>
            <p class="field-help">In-memory log of every inference host &amp; ZDR flag sent this session. Never written to disk.</p>
          </div>
          <button type="button" class="button button-quiet" id="privacy-audit-clear">Clear log</button>
        </div>
        <div id="privacy-audit-list" class="privacy-audit-list"></div>
      </section>
    </section>

    <section id="settings-pane-advanced" role="tabpanel" aria-labelledby="settings-tab-advanced" hidden>
      <header class="settings-pane-head">
        <h3>Diagnostics &amp; Storage</h3>
        <p>Config export/import, local storage resets, offline fault-injection diagnostics, and sandbox fixtures.</p>
      </header>

      <div class="settings-card">
        <div class="settings-card-head">
          <h4>Workspace &amp; Config Backup</h4>
          <p>Export or import zero-secret preferences JSON (never includes API keys or chats), or reset layout widths.</p>
        </div>
        <div class="setting-row"><div><h3>Export / Import preferences JSON</h3><p>Download a backup file, import from JSON, or copy to clipboard (theme, QoL, and default recovery policy).</p></div><div class="setting-row-controls"><button type="button" class="button button-secondary" id="qol-export-prefs">Export JSON</button><button type="button" class="button button-secondary" id="qol-import-prefs">Import JSON</button><button type="button" class="button button-quiet" id="qol-copy-prefs">Copy</button><input type="file" id="qol-import-file" accept=".json,application/json" hidden></div></div>
        <div class="setting-row"><div><h3>Reset panel sizes &amp; splitters</h3><p>Restore sidebar, preview canvas, file tree, inspector, and composer heights to default widths.</p></div><button type="button" class="button button-secondary" id="qol-reset-layout">Reset layout</button></div>
        <div class="setting-row"><div><h3>Clear recent models</h3><p>Remove your recently picked model shortcuts from the quick model switcher.</p></div><button type="button" class="button button-quiet" id="qol-clear-recent">Clear recents</button></div>
      </div>

      <div class="settings-two-col">
        <section class="settings-card">
          <div class="settings-card-head">
            <h4>Local learning</h4>
            <p>On-device outcome history used to rank fallback models.</p>
          </div>
          <div id="learning-content"></div>
          <div class="settings-card-foot"><button class="button button-quiet" id="learning-reset" type="button">Reset learning</button></div>
        </section>
        <section class="settings-card">
          <div class="settings-card-head">
            <h4>Saved drafts</h4>
            <p>Unfinished messages are cached locally on this device for 7 days.</p>
          </div>
          <div class="settings-card-foot"><button type="button" class="button button-quiet" id="drafts-clear">Clear drafts</button></div>
        </section>
      </div>

      <section class="settings-card">
        <div class="setting-row settings-row-bare">
          <div>
            <h3>Harness Diagnostics</h3>
            <p>Run offline scripted fault-injection self-tests against the local controller and fixture suite. Live models are not called.</p>
          </div>
          <button type="button" class="button button-secondary" id="benchmark-open">Open Harness Diagnostics</button>
        </div>
      </section>

      <section class="settings-card">
        <div class="settings-card-head">
          <h4>Sandbox Benchmark Fixtures (Examples)</h4>
          <p>Built-in intentionally buggy Node.js exercises paired with independent verification probes for testing GODCODƎ without touching your own repositories.</p>
        </div>
        <details class="settings-disclosure" id="advanced-fixtures-disclosure">
          <summary>Browse built-in fixtures (<span id="advanced-fixtures-count">0</span>)</summary>
          <div class="fixture-list advanced-fixture-list" id="fixture-list"></div>
        </details>
        <div class="settings-card-foot">
          <button type="button" class="button button-secondary" id="welcome-create">New fixture task…</button>
        </div>
      </section>

      <section class="settings-card" id="effective-prompt-section">
        <div class="settings-card-head">
          <h4>Active task prompt &amp; tools snapshot</h4>
          <p>Read-only preview for the selected conversation (known credentials are redacted).</p>
        </div>
        <pre id="effective-prompt" tabindex="0" role="region" aria-label="Effective task prompt and tool schemas"></pre>
      </section>
    </section>
  </div>
  <footer class="settings-footer"><p class="form-feedback" id="settings-feedback" role="status">Changes save automatically.</p></footer>
</dialog>`);
$('#settings-pane-models').append($('#model-controls'));
$('#model-controls').hidden = false;

let settingsTaskId = null;
let settingsReturnFocus = null;
let settingsBusy = false;
let recoveryToggleBusy = false;
let settingsPane = 'general';
let globalPermissionsState = { rules: [], presets: {}, defaultSafePreset: [] };
let memorySearchTimer = null;
const settingsCheckDrafts = new Map();
const settingsFeedback = (text, error = false) => { setText('#settings-feedback', text); $('#settings-feedback').classList.toggle('error', error); };
window.settingsFeedback = settingsFeedback;
const settingsTask = () => settingsTaskId && selectedData?.task?.id === settingsTaskId ? selectedData.task : null;

function renderTaskSettings(task) {
  const commands = (selectedData?.operations || []).filter(op => op.name === 'process.run');
  const panel = $('#panel-commands');
  if (panel) panel.innerHTML = commands.length ? `<div class="terminal-emulator" role="log" aria-label="Terminal output">${commands.map(op => {
    const result = op.result || {};
    const cmd = op.args?.command || 'command';
    const exitCode = result.exitCode ?? '?';
    const ok = exitCode === 0;
    const stdout = result.stdout || '';
    const stderr = result.stderr || '';
    const errMsg = result.error?.message || '';
    const output = [stdout, stderr, errMsg].filter(Boolean).join('\n') || (op.status === 'dispatching' ? 'Running…' : '');
    const ansi = typeof ansiToHtml === 'function' ? ansiToHtml(output) : escapeHTML(output);
    const copyBtn = output ? `<button type="button" class="terminal-copy-btn" data-copy-text="${escapeHTML(output)}" aria-label="Copy command output">Copy</button>` : '';
    return `<div class="terminal-block ${ok ? '' : 'terminal-error'}"><div class="terminal-prompt"><span class="terminal-ps1">$</span><span class="terminal-cmd">${escapeHTML(cmd)}</span><span class="terminal-exit ${ok ? 'exit-ok' : 'exit-fail'}">${escapeHTML(String(exitCode))}</span>${result.durationMs != null ? `<span class="terminal-duration">${escapeHTML(duration(result.durationMs))}</span>` : ''}${copyBtn}</div>${output ? `<pre class="terminal-output">${ansi}</pre>` : ''}</div>`;
  }).join('')}</div>` : '<div class="panel-empty"><div><h3>No commands yet.</h3><p>Shell commands executed by the agent appear here.</p><button type="button" class="button button-secondary" data-command-settings>Command settings</button></div></div>';
  if ($('#command-count')) setText('#command-count', commands.length);
  if ($('#settings-dialog').open) {
    syncSettingsLocks();
    if (settingsTaskId === task.id) {
      const view = RecoveryUI.presentation(task, Date.now(), newConversationProviders());
      $('#settings-ultra').setAttribute('aria-checked', String(view.enabled));
      setText('#settings-ultra span', view.state);
      setText('#settings-recovery-state', `${view.detail} · ${task.recoveries}/${view.policy.maxAttempts} recovery attempts · ${task.calls}/${view.policy.maxCalls} calls`);
      if (settingsPane === 'tools') renderPermissionsSection();
    }
  }
}

function rulesSignature(rules) {
  if (!Array.isArray(rules)) return '[]';
  return JSON.stringify(rules.map(r => ({ tool: r.tool, pattern: r.pattern || '', action: r.action })));
}

const PERMISSION_PRESET_LABELS = Object.freeze({
  permissive: 'Permissive',
  auto: 'Auto (AI Judge)',
  acceptEdits: 'Accept Edits',
  safe: 'Safe Guardrails',
  default: 'Ask Everything',
  dontAsk: 'Don’t Ask (CI)',
});

function detectPermissionPreset(rules) {
  if (!Array.isArray(rules) || rules.length === 0) return 'permissive';
  const presets = Object.keys(globalPermissionsState.presets || {}).length
    ? globalPermissionsState.presets
    : (state.permissions?.presets || {});
  const defaultSafe = globalPermissionsState.defaultSafePreset || state.permissions?.defaultSafePreset || null;
  const sig = rulesSignature(rules);
  for (const key of ['auto', 'acceptEdits', 'safe', 'default', 'dontAsk']) {
    const candidate = presets[key] || (key === 'safe' ? defaultSafe : null);
    if (Array.isArray(candidate) && candidate.length && sig === rulesSignature(candidate)) return key;
  }
  return 'custom';
}

function activePermissionRulesForScope() {
  const task = settingsTask();
  const baseGlobal = state.permissions || globalPermissionsState;
  const globalRules = Array.isArray(baseGlobal?.rules) ? baseGlobal.rules : [];
  const hasTaskOverride = Boolean(task && Array.isArray(task.permissionRules));
  return { task, hasTaskOverride, rules: hasTaskOverride ? task.permissionRules : globalRules };
}

function renderPermissionsSection() {
  const { task, hasTaskOverride, rules: activeRules } = activePermissionRulesForScope();
  const preset = detectPermissionPreset(activeRules);

  setText('#permission-gate-scope-note', task
    ? (hasTaskOverride ? 'Custom rules override global defaults for this chat.' : 'Inheriting global defaults. Select a preset or add a rule to override for this chat.')
    : 'Default permission rules applied to all new conversations.');
  setText('#permission-gate-badge', PERMISSION_PRESET_LABELS[preset] || `Custom (${activeRules.length})`);

  $$('[data-permission-preset]').forEach(btn => {
    const active = btn.dataset.permissionPreset === preset;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', String(active));
  });

  const list = $('#permission-rules-list');
  if (!list) return;
  if (!activeRules.length) {
    list.innerHTML = '<p class="field-help permission-rules-empty">No blocking rules active — allowed tools execute automatically.</p>';
    return;
  }
  list.innerHTML = `<ul class="permission-rule-items">${activeRules.map((rule, idx) => {
    const action = String(rule.action || 'ask').toLowerCase();
    return `<li class="permission-rule-item"><span class="perm-action-pill perm-action-${escapeHTML(action)}">${escapeHTML(action.toUpperCase())}</span><code class="perm-rule-tool">${escapeHTML(rule.tool)}</code>${rule.pattern ? `<code class="perm-rule-pattern">${escapeHTML(rule.pattern)}</code>` : ''}${rule.reason ? `<span class="perm-rule-reason">${escapeHTML(rule.reason)}</span>` : ''}<button type="button" class="icon-button perm-rule-del" data-delete-perm-rule="${idx}" aria-label="Remove rule" title="Remove rule">×</button></li>`;
  }).join('')}</ul>`;
}

async function saveCustomPermissionRules(nextRules, toastMsg) {
  if (settingsBusy) return;
  const task = settingsTask();
  settingsBusy = true;
  syncSettingsLocks();
  settingsFeedback('Saving permission rules…');
  try {
    if (task) {
      const { task: updated } = await api(`/api/tasks/${encodeURIComponent(task.id)}/permissions`, {
        method: 'PATCH',
        body: JSON.stringify({ rules: nextRules }),
      });
      if (selectedId === task.id && selectedData) renderSelected({ ...selectedData, task: updated }, true);
    } else {
      const updated = await api('/api/permissions', {
        method: 'PATCH',
        body: JSON.stringify({ rules: nextRules }),
      });
      globalPermissionsState = updated;
      state.permissions = updated;
    }
    settingsFeedback(toastMsg || 'Permission rules saved.');
    toast(toastMsg || 'Permission rules saved.');
  } catch (error) {
    settingsFeedback(error.message, true);
    toast(error.message);
  } finally {
    settingsBusy = false;
    renderSettingsValues();
    renderPermissionsSection();
    renderComposer();
  }
}

async function loadPermissionsSettings() {
  try {
    const data = await api('/api/permissions');
    globalPermissionsState = data;
    state.permissions = data;
  } catch (error) {
    settingsFeedback(error.message, true);
  }
  renderPermissionsSection();
}

async function applyPermissionPreset(preset, explicitTask = undefined) {
  if (settingsBusy || !Object.hasOwn(PERMISSION_PRESET_LABELS, preset)) return;
  const task = explicitTask !== undefined ? explicitTask : settingsTask();
  settingsBusy = true;
  syncSettingsLocks();
  settingsFeedback('Saving permission preset…');
  try {
    if (task) {
      const { task: updated } = await api(`/api/tasks/${encodeURIComponent(task.id)}/permissions`, {
        method: 'PATCH',
        body: JSON.stringify({ preset }),
      });
      if (selectedId === task.id && selectedData) renderSelected({ ...selectedData, task: updated }, true);
    } else {
      const updated = await api('/api/permissions', {
        method: 'PATCH',
        body: JSON.stringify({ preset }),
      });
      globalPermissionsState = updated;
      state.permissions = updated;
    }
    const label = PERMISSION_PRESET_LABELS[preset] || preset;
    settingsFeedback(`Permission gate set to ${label}.`);
    toast(`Permission gate: ${label}`);
  } catch (error) {
    settingsFeedback(error.message, true);
    toast(error.message);
  } finally {
    settingsBusy = false;
    renderSettingsValues();
    renderPermissionsSection();
    renderComposer();
  }
}

async function cyclePermissionMode() {
  const order = ['permissive', 'auto', 'acceptEdits', 'safe', 'default'];
  const task = selectedData?.task || null;
  const baseGlobal = state.permissions || globalPermissionsState;
  const activeRules = task && Array.isArray(task.permissionRules)
    ? task.permissionRules
    : (Array.isArray(baseGlobal?.rules) ? baseGlobal.rules : []);
  const current = detectPermissionPreset(activeRules);
  const idx = order.indexOf(current);
  const next = order[(idx + 1) % order.length];
  await applyPermissionPreset(next, task);
}

async function loadMemorySettings(queryOverride) {
  const input = $('#memory-search');
  if (typeof queryOverride === 'string' && input) input.value = queryOverride;
  const q = (input?.value || '').trim();
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (selectedId) params.set('taskId', selectedId);
  const scopeSelect = $('#memory-scope');
  if (scopeSelect) {
    const projectOption = $('option[value="project"]', scopeSelect);
    if (projectOption) {
      projectOption.disabled = !selectedId;
      projectOption.textContent = selectedId ? `Current project (${projectLabel(selectedData?.task) || 'task'})` : 'Current project (select a task)';
    }
    if (!selectedId && scopeSelect.value === 'project') scopeSelect.value = 'global';
  }
  try {
    const res = await api(`/api/memory${params.toString() ? `?${params.toString()}` : ''}`);
    const memories = Array.isArray(res.memories) ? res.memories : [];
    const fileEl = $('#memory-file-path');
    if (fileEl) {
      const shortName = res.memoryFile ? res.memoryFile.split(/[\\/]/).slice(-2).join('/') : 'memory.md';
      fileEl.textContent = shortName;
      fileEl.title = res.memoryFile || '';
    }
    const list = $('#memory-list');
    if (!list) return;
    if (!memories.length) {
      list.innerHTML = `<p class="field-help">${q ? 'No matching memories found.' : 'No saved memories yet. Use /remember &lt;note&gt; or Add memory below.'}</p>`;
      return;
    }
    list.innerHTML = memories.map(mem => {
      const isProject = typeof mem.scope === 'string' && mem.scope.startsWith('project:');
      const scopeText = isProject ? `Project · ${mem.scope.slice('project:'.length).split(/[\\/]/).filter(Boolean).at(-1) || 'workspace'}` : 'Global';
      const tagsHtml = Array.isArray(mem.tags) && mem.tags.length
        ? `<div class="memory-tags">${mem.tags.map(t => `<span class="memory-tag">${escapeHTML(t)}</span>`).join('')}</div>`
        : '';
      return `<article class="memory-card"><div class="memory-card-top"><strong>${escapeHTML(mem.title)}</strong><span class="meta-chip ${isProject ? 'memory-scope-project' : 'memory-scope-global'}">${escapeHTML(scopeText)}</span><button type="button" class="button button-quiet memory-delete-btn" data-delete-memory="${escapeHTML(mem.id)}" aria-label="Delete memory ${escapeHTML(mem.title)}">Delete</button></div><p class="memory-card-body">${escapeHTML(mem.content)}</p><div class="memory-card-meta">${tagsHtml}<time title="${escapeHTML(mem.updatedAt)}">${escapeHTML(shortDate(mem.updatedAt))}</time></div></article>`;
    }).join('');
  } catch (error) {
    setText('#memory-list', error.message);
  }
}

async function loadSkillsSettings() {
  try {
    const skills = typeof loadSkills === 'function' ? await loadSkills(selectedId) : (await api(`/api/skills${selectedId ? `?taskId=${encodeURIComponent(selectedId)}` : ''}`)).skills || [];
    const list = $('#skills-list');
    if (!list) return;
    if (!skills.length) {
      list.innerHTML = '<p class="field-help">No project or global skills discovered yet. Save one below or use <code>/skill save &lt;name&gt; &lt;instructions&gt;</code>.</p>';
      return;
    }
    list.innerHTML = skills.map(skill => {
      const deletable = skill.source === 'global:skills';
      const scopeLabel = skill.scope === 'project' ? 'Project' : 'Global';
      return `<article class="skill-card"><div class="skill-card-top"><code class="skill-command">${escapeHTML(skill.command || `/${skill.name}`)}</code><span class="meta-chip ${skill.scope === 'project' ? 'skill-scope-project' : ''}">${escapeHTML(scopeLabel)}</span>${skill.mode ? `<span class="meta-chip">${escapeHTML(skill.mode)}</span>` : ''}${deletable ? `<button type="button" class="button button-quiet memory-delete-btn" data-delete-skill="${escapeHTML(skill.name)}" aria-label="Delete skill ${escapeHTML(skill.name)}">Delete</button>` : `<span class="skill-source-note">${escapeHTML(skill.source || '')}</span>`}</div>${skill.description ? `<p class="skill-card-desc">${escapeHTML(skill.description)}</p>` : ''}<details class="skill-body-preview"><summary>Instructions</summary><pre>${escapeHTML(skill.body || '')}</pre></details></article>`;
    }).join('');
  } catch (error) {
    setText('#skills-list', error.message);
  }
}

function zdrBadgeClass(zdrClass) {
  if (zdrClass === 'local-only') return 'zdr-local';
  if (zdrClass === 'native-zdr') return 'zdr-native';
  if (zdrClass === 'zdr-enforced') return 'zdr-routed';
  if (zdrClass === 'no-store') return 'zdr-nostore';
  return 'zdr-terms';
}

function renderPrivacySettings(data) {
  const privacy = data || state.privacy;
  if (!privacy) return;
  state.privacy = privacy;
  const s = privacy.settings || {};
  const setChecked = (sel, val) => { const el = $(sel); if (el) el.checked = Boolean(val); };
  setChecked('#privacy-zdr-routing', s.zdrRouting !== false);
  setChecked('#privacy-strict-zdr', s.strictZdr === true);
  setChecked('#privacy-local-only', s.localOnly === true);
  setChecked('#privacy-redact-secrets', s.redactOutboundSecrets !== false);
  setChecked('#privacy-ephemeral-session', s.ephemeralSession === true);
  const routingEl = $('#privacy-zdr-routing');
  if (routingEl) routingEl.disabled = Boolean(s.strictZdr);
  const activeProfile = s.securityProfile || (s.localOnly && s.strictZdr ? 'lockdown' : s.strictZdr && s.ephemeralSession ? 'hardened' : 'standard');
  $$('[data-security-profile]').forEach(btn => {
    const on = btn.dataset.securityProfile === activeProfile;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', String(on));
  });
  setText('#security-profile-badge', activeProfile === 'lockdown' ? 'Airgap Lockdown' : activeProfile === 'hardened' ? 'Hardened' : 'Standard');
  const allow = Array.isArray(s.scopeAllow) ? s.scopeAllow : [];
  const deny = Array.isArray(s.scopeDeny) ? s.scopeDeny : [];
  const allowEl = $('#privacy-scope-allow');
  const denyEl = $('#privacy-scope-deny');
  if (allowEl && document.activeElement !== allowEl) allowEl.value = allow.join(', ');
  if (denyEl && document.activeElement !== denyEl) denyEl.value = deny.join(', ');
  setText('#privacy-scope-badge', (allow.length || deny.length) ? `${allow.length} allow · ${deny.length} deny` : 'Unrestricted');
  if (typeof window.syncSecurityPostureChrome === 'function') window.syncSecurityPostureChrome(privacy);

  const provList = $('#privacy-providers-list');
  if (provList) {
    const provs = (privacy.providers || []).filter(p => p.kind !== 'scripted');
    provList.innerHTML = provs.length
      ? provs.map(p => `<div class="privacy-provider-row"><div class="privacy-provider-main"><strong>${escapeHTML(p.label || p.id)}</strong><span class="field-help">${escapeHTML(p.detail || '')}</span></div><div class="privacy-provider-badges"><span class="zdr-badge ${zdrBadgeClass(p.zdrClass)}">${escapeHTML(p.label ? (p.zdrClass === 'local-only' ? 'LOCAL ONLY' : p.zdrClass === 'native-zdr' ? 'NATIVE ZDR' : p.zdrClass === 'zdr-enforced' ? 'ZDR ROUTED' : p.zdrClass === 'no-store' ? 'NO STORE' : 'PROVIDER TERMS') : 'UNKNOWN')}</span>${p.allowedByPolicy === false ? '<span class="zdr-badge zdr-blocked">BLOCKED</span>' : ''}</div></div>`).join('')
      : '<p class="field-help">No live providers connected yet. Connect a local model, Venice, OpenRouter, or subscription in Settings → Models.</p>';
  }

  const auditList = $('#privacy-audit-list');
  if (auditList) {
    const rows = Array.isArray(privacy.audit) ? privacy.audit : [];
    auditList.innerHTML = rows.length
      ? rows.slice(0, 40).map(entry => `<div class="privacy-audit-row ${entry.blocked ? 'is-blocked' : ''}"><div class="privacy-audit-top"><code>${escapeHTML(entry.host || 'local')}</code><span class="zdr-badge ${entry.blocked ? 'zdr-blocked' : zdrBadgeClass(entry.zdrClass)}">${escapeHTML(entry.blocked ? 'BLOCKED' : entry.zdrClass)}</span>${entry.secretsRedacted > 0 ? `<span class="meta-chip">${escapeHTML(entry.secretsRedacted)} secret${entry.secretsRedacted === 1 ? '' : 's'} scrubbed</span>` : ''}<time>${escapeHTML(shortDate(entry.time))}</time></div>${entry.zdrFlags?.length ? `<div class="privacy-audit-flags">${entry.zdrFlags.map(f => `<code>${escapeHTML(f)}</code>`).join('')}</div>` : ''}${entry.reason ? `<p class="field-help">${escapeHTML(entry.reason)}</p>` : ''}</div>`).join('')
      : '<p class="field-help">No outbound inference requests recorded in this session (0 telemetry calls).</p>';
  }
}

async function loadPrivacySettings() {
  try {
    const data = await api('/api/privacy');
    renderPrivacySettings(data);
  } catch (error) {
    settingsFeedback(error.message, true);
  }
}

async function updatePrivacySetting(key, value) {
  settingsFeedback('Saving privacy setting…');
  try {
    const payload = typeof key === 'object' ? key : { [key]: value };
    const data = await api('/api/privacy', { method: 'PATCH', body: JSON.stringify(payload) });
    if (data.permissions) {
      globalPermissionsState = data.permissions;
      state.permissions = data.permissions;
      renderPermissionsSection();
    }
    renderPrivacySettings(data);
    updateSettingsNavBadges();
    if (selectedData?.task) renderTaskMetaStrip(selectedData.task);
    const label = payload.applyProfile
      ? `Security posture set to ${payload.applyProfile === 'lockdown' ? 'Airgap Lockdown' : payload.applyProfile === 'hardened' ? 'Hardened (Red Team / Bounty)' : 'Standard'}.`
      : typeof key === 'string'
        ? `Privacy updated: ${key} ${value ? 'ON' : 'OFF'}`
        : 'Security scope saved.';
    settingsFeedback(label);
    toast(label);
  } catch (error) {
    settingsFeedback(error.message, true);
    toast(error.message);
    await loadPrivacySettings();
  }
}

function syncSettingsLocks() {
  syncRaceControls();
  const task = settingsTask(), policyLocked = settingsBusy || Boolean(task?.draining) || isCrewBusy(task) || task?.status === 'cancelled';
  const ownerLocked = policyLocked || (task && ACTIVE.has(task.status));
  $$('#settings-dialog [data-policy]').forEach(el => el.disabled = policyLocked);
  $$('[name="settings-mode"], #settings-attempts').forEach(el => el.disabled = policyLocked);
  $('#settings-ultra').disabled = policyLocked || recoveryToggleBusy;
  $$('#execution-form input, #checks-form textarea, #checks-form button, [name="settings-persona"]').forEach(el => el.disabled = ownerLocked);
  $$('[data-permission-preset]').forEach(el => el.disabled = task ? ownerLocked : settingsBusy);
  $('#settings-network').disabled = ownerLocked || !$('#settings-execution').checked;
  $$('[data-settings-scope]').forEach(el => el.disabled = settingsBusy);
  setText('#settings-tools-locked', ownerLocked && !settingsBusy ? 'Pause and settle the task to change permissions or checks.' : '');
}
function renderSettingsValues() {
  const task = settingsTask(), prefs = RecoveryUI.preferences(), view = RecoveryUI.presentation(task, Date.now(), newConversationProviders());
  setText('#settings-scope', task ? task.title : 'Defaults for new conversations');
  $('#settings-scope').title = task?.title || '';
  setVisible('#settings-scope-choices', Boolean(selectedData?.task));
  $$('[data-settings-scope]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.settingsScope === (task ? 'task' : 'defaults'))));
  $('#settings-ultra').setAttribute('aria-checked', String(view.enabled));
  setText('#settings-ultra span', view.state);
  setText('#settings-recovery-state', task ? `${view.detail} · ${task.recoveries}/${view.policy.maxAttempts} recovery attempts · ${task.calls}/${view.policy.maxCalls} calls` : view.detail);
  const values = { 'settings-attempts': view.policy.maxAttempts, 'settings-calls': view.policy.maxCalls, 'settings-timeout': view.policy.requestTimeoutMs / 1000, 'settings-stalls': view.policy.maxNoProgressTurns, 'settings-max-continuations': view.policy.maxContinuations ?? 6, 'settings-strategies': view.policy.strategies.join(', ') };
  for (const [id, value] of Object.entries(values)) { const el = $('#' + id); if (el) el.value = value; }
  const direct = catalogId(task?.providers?.[0] || (!task && newConversationProviders()[0]));
  $('label[for="settings-return"] small').textContent = direct ? 'Start the next message on the preferred model.' : 'After a fallback makes progress.';
  $('#settings-learning').closest('.setting-row').hidden = false;
  $('#settings-stalls').closest('label').hidden = direct;
  $('#settings-strategies').hidden = direct;
  $('label[for="settings-strategies"]').hidden = direct;
  $('#settings-strategies').nextElementSibling.hidden = direct;
  $('#settings-return').checked = view.policy.returnToPrimary;
  if ($('#settings-sticky-refusal')) $('#settings-sticky-refusal').checked = view.policy.stickyOnRefusal !== false;
  if ($('#settings-auto-continue')) $('#settings-auto-continue').checked = view.policy.autoContinue !== false;
  $('#settings-learning').checked = view.policy.learning;
  const qol = window.G0DQol?.get?.() || { sendKey: 'enter', autoOpenPreview: true, expandThinking: false, pauseBackdrop: false, completionChime: true };
  $$('[name="qol-send-key"]').forEach(el => el.checked = el.value === qol.sendKey);
  if ($('#qol-auto-preview')) $('#qol-auto-preview').checked = qol.autoOpenPreview !== false;
  if ($('#qol-expand-thinking')) $('#qol-expand-thinking').checked = qol.expandThinking === true;
  if ($('#qol-completion-chime')) $('#qol-completion-chime').checked = qol.completionChime !== false;
  if ($('#qol-pause-backdrop')) $('#qol-pause-backdrop').checked = qol.pauseBackdrop === true;
  const curDiffMode = (typeof diffViewMode === 'string' && diffViewMode === 'split') ? 'split' : 'unified';
  $$('[name="qol-diff-mode"]').forEach(el => el.checked = el.value === curDiffMode);
  $$('[name="settings-mode"]').forEach(el => el.checked = el.value === view.policy.mode);
  $$('[name="settings-persona"]').forEach(el => el.checked = el.value === (task?.persona || prefs.persona || 'plinian'));
  $$('[name="settings-text-size"]').forEach(el => el.checked = el.value === (document.documentElement.dataset.textSize || 'comfortable'));
  $('#settings-execution').checked = task?.execution?.enabled === true;
  $('#settings-network').checked = task?.execution?.network === true;
  $('#settings-command-timeout').value = (task?.execution?.timeoutMs || 30000) / 1000;
  $('#settings-checks').value = task && settingsCheckDrafts.has(task.id) ? settingsCheckDrafts.get(task.id) : (task?.checks || []).map(check => check.command).join('\n');
  setVisible('#settings-execution-section', Boolean(task));
  setVisible('#settings-tools-empty', !task);
  setVisible('#effective-prompt-section', Boolean(task));
  renderPermissionsSection();
  window.G0DThemes?.syncUI();
  syncSettingsLocks();
}
async function loadLearning() {
  const value = await api('/api/learning'), rows = value.stats || [];
  $('#learning-content').innerHTML = rows.length ? `<div class="learning-table" tabindex="0" role="region" aria-label="Local model outcomes"><table><thead><tr><th>Model / incident</th><th>Samples</th><th>Success / failure</th></tr></thead><tbody>${rows.slice(0, 30).map(row => `<tr><td>${escapeHTML(providerById(row.providerId)?.label || row.providerId)}<small>${escapeHTML(humanize(row.category))}</small></td><td>${escapeHTML(row.samples)}</td><td>${escapeHTML(row.successes)} / ${escapeHTML(row.failures)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="field-help">Outcomes appear after useful work and adaptive recovery.</p>';
}
async function loadHooksSettings() {
  const listEl = $('#hooks-list');
  if (!listEl) return;
  try {
    const task = settingsTask();
    const qs = task ? `?taskId=${encodeURIComponent(task.id)}` : '';
    const { hooks } = await api(`/api/hooks${qs}`);
    const entries = [
      ...(hooks?.PreToolUse || []).map(h => ({ ...h, event: 'PreToolUse' })),
      ...(hooks?.PostToolUse || []).map(h => ({ ...h, event: 'PostToolUse' }))
    ];
    setText('#hooks-count-badge', `${entries.length} hook${entries.length === 1 ? '' : 's'}`);
    if (!entries.length) {
      listEl.innerHTML = '<p class="field-help">No active hooks found. Add <code>~/.g0dc0d3/hooks.json</code> (or set <code>G0D_ALLOW_PROJECT_HOOKS=1</code> for project hooks) to run deterministic pre/post checks inside the OS sandbox.</p>';
      return;
    }
    listEl.innerHTML = `<ul class="hooks-section-list">${entries.map(h =>
      `<li class="hooks-section-item"><span class="perm-action-pill perm-action-${h.event === 'PreToolUse' ? 'ask' : 'allow'}">${escapeHTML(h.event)}</span><code>${escapeHTML(h.tool)}</code>${h.pattern ? `<code class="perm-rule-pattern">${escapeHTML(h.pattern)}</code>` : ''}<code>${escapeHTML(h.command.slice(0, 90))}</code></li>`
    ).join('')}</ul>`;
  } catch (err) {
    listEl.innerHTML = `<p class="field-help">${escapeHTML(err.message)}</p>`;
  }
}

let modelsSubtab = 'connections';
function selectModelsSubtab(subtab) {
  modelsSubtab = ['connections', 'catalog', 'routing', 'overseer'].includes(subtab) ? subtab : 'connections';
  $$('[role="tab"][data-models-subtab]').forEach(btn => {
    const active = btn.dataset.modelsSubtab === modelsSubtab;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', String(active));
  });
  $$('#model-controls > [data-model-subtab]').forEach(el => {
    el.classList.toggle('model-subtab-hidden', el.dataset.modelSubtab !== modelsSubtab);
  });
  let emptyEl = $('#models-catalog-empty');
  if (modelsSubtab === 'catalog') {
    const visibleCatalogCards = $$('#model-controls > [data-model-subtab="catalog"]').filter(el => !el.hidden && !el.classList.contains('hidden') && !el.classList.contains('model-subtab-hidden'));
    if (visibleCatalogCards.length === 0) {
      if (!emptyEl) {
        emptyEl = document.createElement('div');
        emptyEl.id = 'models-catalog-empty';
        emptyEl.className = 'settings-card';
        emptyEl.innerHTML = '<div class="settings-card-head"><h4>No browsable catalogs connected yet</h4><p>Connect an <strong>OpenAI</strong>, <strong>Anthropic</strong>, <strong>xAI</strong>, <strong>Gemini</strong>, <strong>Meta AI</strong>, <strong>OpenRouter</strong>, or <strong>Venice</strong> API key in <strong>Connections &amp; Keys</strong> to browse and pin available models.</p></div><button type="button" class="button button-secondary" data-models-subtab="connections">Go to Connections &amp; Keys</button>';
        $('#settings-pane-models')?.append(emptyEl);
      }
      emptyEl.hidden = false;
    } else if (emptyEl) {
      emptyEl.hidden = true;
    }
  } else if (emptyEl) {
    emptyEl.hidden = true;
  }
}

function updateSettingsNavBadges() {
  const setBadge = (id, text, cls = '') => {
    const el = $(`#${id}`);
    if (!el) return;
    el.textContent = text || '';
    el.className = `settings-nav-badge${text ? '' : ' hidden'}${cls ? ` ${cls}` : ''}`;
  };
  const liveCount = (state.providers || []).filter(p => p.kind !== 'scripted' && p.available !== false).length;
  setBadge('settings-badge-models', liveCount > 0 ? String(liveCount) : '0', liveCount > 0 ? 'is-ok' : 'is-warn');
  const task = settingsTask();
  const view = RecoveryUI.presentation(task, Date.now(), newConversationProviders());
  setBadge('settings-badge-recovery', view.enabled ? 'ON' : 'OFF', view.enabled ? 'is-accent' : '');
  const { rules } = activePermissionRulesForScope();
  const preset = detectPermissionPreset(rules);
  setBadge('settings-badge-tools', preset === 'permissive' ? 'Auto' : preset === 'auto' ? 'AI' : preset === 'safe' ? 'Safe' : preset === 'acceptEdits' ? 'Edits' : preset === 'dontAsk' ? 'CI' : 'Ask');
  const ps = state.privacy?.settings;
  if (ps) {
    const badgeTxt = ps.securityProfile === 'lockdown' ? 'Lockdown'
      : ps.securityProfile === 'hardened' ? 'Hardened'
      : ps.localOnly ? 'Airgap'
      : ps.strictZdr ? 'Strict'
      : ps.zdrRouting !== false ? 'ZDR' : '';
    setBadge('settings-badge-privacy', badgeTxt, ps.securityProfile === 'lockdown' || ps.securityProfile === 'hardened' || ps.localOnly || ps.strictZdr ? 'is-ok' : '');
  }
  const ov = transparencyState?.overrideCount;
  const ovTotal = (ov?.prompts || 0) + (ov?.tools || 0) + (ov?.disabledTools || 0) + (ov?.injectionsActive ? 1 : 0);
  setBadge('settings-badge-system', ovTotal > 0 ? 'Custom' : '', ovTotal > 0 ? 'is-accent' : '');
}

function renderPersonalInstructionsFromTransparency() {
  const input = $('#personal-instructions-input');
  if (!input || !transparencyState) return;
  const entry = (transparencyState.prompts || []).find(p => p.id === 'customAppend');
  if (entry && document.activeElement !== input) input.value = entry.value || '';
  setText('#personal-instructions-status', entry?.overridden ? `Active (${entry.value.length} chars)` : 'Using default (empty)');
}

function truncateWord(text, maxLen) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (s.length <= maxLen) return s;
  const cut = s.slice(0, maxLen);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > maxLen * 0.55 ? cut.slice(0, sp) : cut).trim()}…`;
}
function directTextOnly(el) {
  if (!el) return '';
  let out = '';
  for (const node of el.childNodes) {
    if (node.nodeType === 3) out += node.textContent;
  }
  return out.replace(/\s+/g, ' ').trim();
}
function renderSettingsSearchResults(rawQuery) {
  const q = String(rawQuery || '').trim().toLowerCase();
  const box = $('#settings-search-results');
  if (!box) return;
  if (!q) {
    box.classList.add('hidden');
    box.innerHTML = '';
    $$('#settings-dialog [role="tabpanel"]').forEach(panel => { panel.hidden = panel.id !== `settings-pane-${settingsPane}`; });
    return;
  }
  $$('#settings-dialog [role="tabpanel"]').forEach(panel => { panel.hidden = true; });
  const matches = [];
  const seen = new Set();
  for (const tab of SETTINGS_TABS) {
    const paneEl = $(`#settings-pane-${tab.id}`);
    if (!paneEl) continue;
    const candidates = [...paneEl.querySelectorAll('.settings-card, .setting-row, .shortcut-row, .transparency-card')];
    for (const el of candidates) {
      if (el.hidden || el.classList.contains('hidden') || el.closest('[hidden]:not([role="tabpanel"])')) continue;
      if (el.classList.contains('settings-card') && el.querySelector('.setting-row')) {
        const head = el.querySelector('.settings-card-head');
        const hText = (head?.textContent || '').trim();
        if (!hText || !hText.toLowerCase().includes(q)) continue;
        const title = truncateWord(head.querySelector('h4, h3')?.textContent || tab.label, 68);
        const desc = truncateWord(head.querySelector('p')?.textContent || '', 130);
        const key = `${tab.id}::${title}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const transSub = el.closest('[id^="trans-panel-"]')?.id?.replace('trans-panel-', '') || null;
        matches.push({ tabId: tab.id, tabLabel: tab.label, subtab: el.dataset.modelSubtab || transSub || null, title, desc, targetEl: el });
        continue;
      }
      const rawTxt = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!rawTxt || !rawTxt.toLowerCase().includes(q)) continue;
      let title = '';
      let desc = '';
      const heading = el.querySelector('h3, h4, strong, legend');
      const label = el.querySelector('label');
      if (heading) {
        title = heading.textContent.replace(/\s+/g, ' ').trim();
      } else if (label) {
        title = directTextOnly(label) || label.textContent.replace(/\s+/g, ' ').trim();
      } else {
        title = (el.querySelector('span')?.textContent || rawTxt).replace(/\s+/g, ' ').trim();
      }
      const descEl = el.querySelector('label small, p:not(.field-help), .settings-card-head p, .trans-item-desc, small');
      if (descEl) {
        desc = descEl.textContent.replace(/\s+/g, ' ').trim();
      } else if (el.classList.contains('shortcut-row')) {
        desc = [...el.querySelectorAll('kbd, code')].map(k => k.textContent.trim()).join(' · ');
      }
      title = truncateWord(title, 68);
      desc = desc === title ? '' : truncateWord(desc, 130);
      const key = `${tab.id}::${title}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const modelSub = el.closest('[data-model-subtab]')?.dataset?.modelSubtab || null;
      const transSub = el.closest('[id^="trans-panel-"]')?.id?.replace('trans-panel-', '') || null;
      matches.push({ tabId: tab.id, tabLabel: tab.label, subtab: modelSub || transSub, title, desc, targetEl: el });
    }
  }
  box._targets = matches;
  box.classList.remove('hidden');
  box.innerHTML = `<header class="settings-pane-head"><h3>Search results</h3><p>${matches.length} matching setting${matches.length === 1 ? '' : 's'} for “${escapeHTML(rawQuery.trim())}”</p></header>` + (matches.length
    ? `<div class="settings-search-list">${matches.slice(0, 24).map((m, idx) => `<button type="button" class="settings-search-hit" data-search-hit="${idx}"><div class="settings-search-hit-top"><strong>${escapeHTML(m.title)}</strong><span class="meta-chip">${escapeHTML(m.tabLabel)}${m.subtab ? ` · ${escapeHTML(m.subtab)}` : ''}</span></div>${m.desc ? `<p>${escapeHTML(m.desc)}</p>` : ''}</button>`).join('')}</div>`
    : '<p class="field-help">No settings match that query. Try keywords like “theme”, “timeout”, “ZDR”, “Enter”, “Ollama”, “key”, or “chime”.</p>');
}

async function selectSettingsPane(pane, options = {}) {
  if (!SETTINGS_TABS.some(t => t.id === pane)) pane = 'general';
  const searchInput = $('#settings-global-search');
  if (searchInput && searchInput.value) { searchInput.value = ''; renderSettingsSearchResults(''); }
  settingsPane = pane;
  $$('[data-settings-tab]').forEach(button => { const active = button.dataset.settingsTab === pane; button.setAttribute('aria-selected', String(active)); button.tabIndex = active ? 0 : -1; });
  $$('#settings-dialog [role="tabpanel"]').forEach(panel => panel.hidden = panel.id !== `settings-pane-${pane}`);
  $('.settings-body').scrollTop = 0;
  const scopedPanes = new Set(['general', 'models', 'recovery', 'tools', 'advanced']);
  $('.settings-context')?.classList.toggle('is-muted', !scopedPanes.has(pane));
  const feedback = { shortcuts: 'Press ? anytime outside Settings to view keyboard shortcuts.', recovery: 'GODMODƎ recovery, retry limits, and continuation controls save automatically.', prompts: 'Saved on this device for every chat.', system: 'Local prompt transparency — overrides apply on this device to live non-fixture chats.', memory: 'Personal instructions, memories, and /skills save locally on this device.', privacy: 'Zero telemetry. ZDR & privacy controls apply immediately.', models: 'Switch between Connections, Catalog, Routing, and Overseer above.', tools: settingsTask() ? 'Permissions save automatically. Save checks after editing.' : 'Permissions and checks apply to individual tasks.' };
  settingsFeedback(feedback[pane] || 'Changes save automatically.');
  if (pane === 'prompts') { try { await loadPromptLibrary(); } catch (error) { settingsFeedback(error.message, true); } }
  if (pane === 'system') {
    if (options.subtab) selectTransparencySubtab(options.subtab);
    await loadTransparencySettings();
  }
  if (pane === 'models') {
    if (options.subtab) selectModelsSubtab(options.subtab);
    else selectModelsSubtab(modelsSubtab);
    renderModelSettings();
    await Promise.all([loadModelConnections(), loadVeniceCatalog(), typeof loadOpenRouterCatalog === 'function' ? loadOpenRouterCatalog() : Promise.resolve(), ...(typeof loadDirectProviderCatalog === 'function' ? ['openai', 'anthropic', 'xai', 'gemini', 'meta'].map(p => loadDirectProviderCatalog(p)) : []), typeof loadServices === 'function' ? loadServices() : Promise.resolve(), typeof loadModelGroups === 'function' ? loadModelGroups() : Promise.resolve(), typeof loadOverseer === 'function' ? loadOverseer() : Promise.resolve(), typeof loadUltraRouter === 'function' ? loadUltraRouter() : Promise.resolve()]);
    selectModelsSubtab(modelsSubtab);
  }
  if (pane === 'tools') { await Promise.all([loadPermissionsSettings(), loadHooksSettings(), loadBrowserSettings()]); }
  if (pane === 'memory') { await Promise.all([loadMemorySettings(options.query), loadSkillsSettings(), loadTransparencySettings().then(renderPersonalInstructionsFromTransparency)]); }
  if (pane === 'privacy') { await loadPrivacySettings(); }
  if (pane === 'advanced') {
    try { await loadLearning(); if (settingsTaskId) { const id = settingsTaskId; const prompt = await api(`/api/tasks/${encodeURIComponent(id)}/prompt`); if (settingsTaskId === id) setText('#effective-prompt', pretty({ ...prompt, tools: state.tools })); } } catch (error) { settingsFeedback(error.message, true); }
  }
  updateSettingsNavBadges();
}
async function openSettings(pane = 'general', options = {}) {
  if (typeof pane !== 'string') pane = 'general';
  settingsReturnFocus = document.activeElement;
  if (typeof dismissDrawers === 'function') dismissDrawers();
  const currentTask = selectedData?.task || null;
  settingsTaskId = currentTask && currentTask.status !== 'cancelled' ? currentTask.id : null;
  delete $('#race-options').dataset.scope;
  settingsFeedback('Changes save automatically.');
  renderSettingsValues();
  if (!$('#settings-dialog').open) $('#settings-dialog').showModal();
  await selectSettingsPane(pane, options);
}
async function saveSetting(action, body, task = settingsTask()) {
  if (settingsBusy) return;
  const id = task?.id || null;
  const focused = document.activeElement;
  settingsBusy = true; syncSettingsLocks(); renderComposer(); settingsFeedback('Saving…');
  try {
    if (id) {
      const { task: updated } = await api(`/api/tasks/${encodeURIComponent(id)}/${action}`, { method: 'PATCH', body: JSON.stringify(body) });
      if (selectedId === id && selectedData) renderSelected({ ...selectedData, task: updated }, true);
    } else {
      const prefs = RecoveryUI.preferences();
      localStorage.setItem('g0dc0d3.defaults', JSON.stringify(action === 'policy' ? { ...prefs, policy: RecoveryUI.updatedPolicy(body) } : { ...prefs, ...body }));
    }
    if (action === 'checks') settingsCheckDrafts.delete(id);
    settingsFeedback(task && ACTIVE.has(task.status) && action === 'policy' ? 'Saved for the next recovery attempt.' : 'Saved.');
    return true;
  } catch (error) { settingsFeedback(error.message, true); toast(error.message); return false; }
  finally { settingsBusy = false; renderSettingsValues(); renderComposer(); if (focused?.isConnected && !focused.disabled && document.activeElement === document.body && focused.getClientRects().length) focused.focus({ preventScroll: true }); }
}
async function toggleUltra(task) {
  if (settingsBusy || routeBusy || recoveryToggleBusy) return;
  recoveryToggleBusy = true;
  renderComposer(); syncSettingsLocks();
  try {
    let view = RecoveryUI.presentation(task, Date.now(), newConversationProviders());
    if (view.locked) {
      const scope = task?.id || null;
      const lock = modelSelectionLock(task);
      if (lock) { toast(lock); return; }
      try {
        await loadVeniceCatalog();
        if (scope && selectedId !== scope) return;
        const primary = task?.providerId || newConversationProviders()[0];
        const backup = RecoveryUI.recommendedBackup(veniceCatalog.models, primary);
        if (!backup) { await openSettings('models'); settingsFeedback('No other Venice model is available. Refresh the catalog or connect a model.', true); return; }
        if (!await selectModel(primary, { scope, backup })) return;
        task = scope ? selectedData?.task : null;
        view = RecoveryUI.presentation(task, Date.now(), newConversationProviders());
        if (await saveSetting('policy', { mode: 'adaptive', maxAttempts: view.policy.maxAttempts || 6 }, task))
          toast('Venice outage backup configured: ' + (providerById(backup)?.label || backup));
        return;
      } catch (error) { toast(error.message); return; }
    }
    const enabling = !view.enabled;
    const saved = await saveSetting('policy', enabling ? { mode: 'adaptive', maxAttempts: view.policy.maxAttempts || 6 } : { mode: 'ask' }, task);
    if (saved && !task) {
      if (state.veniceConnectionId && !veniceCatalog.models.length) {
        try { await loadVeniceCatalog(); } catch {}
      }
      const godmodeDefault = RecoveryUI.findVeniceUncensored?.(liveProviders(), state.veniceConnectionId, veniceCatalog.models)
        || RecoveryUI.findOpenRouterGodmode?.(liveProviders());
      const gemini4Neon = RecoveryUI.findGemini4Neon(liveProviders(), state.veniceConnectionId, veniceCatalog.models);
      if (enabling) {
        if ((!preferredProvider || preferredProvider === gemini4Neon) && godmodeDefault) {
          preferredProvider = null;
          try { localStorage.removeItem('g0dc0d3.preferredProvider'); } catch {}
          toast('GODMODƎ enabled · defaulting to ' + (providerById(godmodeDefault)?.label || 'G0DM0D3 default'));
        }
      } else {
        if ((!preferredProvider || preferredProvider === godmodeDefault) && gemini4Neon) {
          preferredProvider = null;
          try { localStorage.removeItem('g0dc0d3.preferredProvider'); } catch {}
          toast('GODMODƎ off · defaulting to ' + (providerById(gemini4Neon)?.label || 'Gemini 4 Neon'));
        }
      }
    }
    return saved;
  } finally { recoveryToggleBusy = false; renderSettingsValues(); renderComposer(); }
}
$('#settings-open').addEventListener('click', () => openSettings());
$('#settings-ultra').addEventListener('click', () => toggleUltra(settingsTask()));
$('#settings-dialog').addEventListener('close', () => {
  const opener = settingsReturnFocus?.isConnected && !settingsReturnFocus.closest('[inert]') && settingsReturnFocus.getClientRects().length ? settingsReturnFocus : $('#composer-input'); opener?.focus({ preventScroll: true });
});
$('#settings-dialog').addEventListener('click', async event => {
  const tab = event.target.closest('[data-settings-tab]'); if (tab) { selectSettingsPane(tab.dataset.settingsTab); return; }
  const modelSub = event.target.closest('[data-models-subtab]'); if (modelSub) { selectModelsSubtab(modelSub.dataset.modelsSubtab); return; }
  const hitBtn = event.target.closest('[data-search-hit]');
  if (hitBtn) {
    const box = $('#settings-search-results');
    const hit = box?._targets?.[Number(hitBtn.dataset.searchHit)];
    if (hit) {
      await selectSettingsPane(hit.tabId, hit.subtab ? { subtab: hit.subtab } : {});
      if (hit.targetEl) {
        hit.targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        hit.targetEl.classList.remove('settings-jump-pulse');
        void hit.targetEl.offsetWidth;
        hit.targetEl.classList.add('settings-jump-pulse');
        setTimeout(() => hit.targetEl.classList.remove('settings-jump-pulse'), 1400);
      }
    }
    return;
  }
  const scope = event.target.closest('[data-settings-scope]');
  if (scope && !settingsBusy) {
    settingsTaskId = scope.dataset.settingsScope === 'task' ? selectedData?.task?.id || null : null;
    renderSettingsValues();
    selectSettingsPane(settingsPane);
    return;
  }
  const secProfileBtn = event.target.closest('[data-security-profile]');
  if (secProfileBtn) { updatePrivacySetting({ applyProfile: secProfileBtn.dataset.securityProfile }); return; }
  const presetBtn = event.target.closest('[data-permission-preset]');
  if (presetBtn) { applyPermissionPreset(presetBtn.dataset.permissionPreset); return; }
  const delPerm = event.target.closest('[data-delete-perm-rule]');
  if (delPerm) {
    const idx = Number(delPerm.dataset.deletePermRule);
    const { rules } = activePermissionRulesForScope();
    if (Number.isInteger(idx) && idx >= 0 && idx < rules.length) {
      saveCustomPermissionRules(rules.filter((_, i) => i !== idx), 'Permission rule removed.');
    }
    return;
  }
  const delMem = event.target.closest('[data-delete-memory]');
  if (delMem) {
    delMem.disabled = true;
    try {
      await api(`/api/memory/${encodeURIComponent(delMem.dataset.deleteMemory)}`, { method: 'DELETE', body: '{}' });
      await loadMemorySettings();
      settingsFeedback('Memory deleted.');
      toast('Memory deleted.');
    } catch (error) {
      delMem.disabled = false;
      settingsFeedback(error.message, true);
      toast(error.message);
    }
    return;
  }
  const delSkill = event.target.closest('[data-delete-skill]');
  if (delSkill) {
    delSkill.disabled = true;
    try {
      await api(`/api/skills/${encodeURIComponent(delSkill.dataset.deleteSkill)}`, { method: 'DELETE', body: '{}' });
      await loadSkillsSettings();
      settingsFeedback('Skill deleted.');
      toast(`Deleted skill /${delSkill.dataset.deleteSkill}.`);
    } catch (error) {
      delSkill.disabled = false;
      settingsFeedback(error.message, true);
      toast(error.message);
    }
  }
});
$('.settings-tabs').addEventListener('keydown', event => {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
  const buttons = $$('[data-settings-tab]'), index = buttons.indexOf(document.activeElement); if (index < 0) return;
  event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1) + buttons.length) % buttons.length;
  buttons[next].focus(); selectSettingsPane(buttons[next].dataset.settingsTab);
});
$('#settings-dialog').addEventListener('change', event => {
  const input = event.target;
  if (input.matches('[data-privacy-toggle]')) {
    updatePrivacySetting(input.dataset.privacyToggle, input.checked);
    return;
  }
  if (input.matches('[data-browser-setting]')) {
    updateBrowserSetting(input.dataset.browserSetting, input.checked);
    return;
  }
  if (input.matches('[data-qol]')) {
    const key = input.dataset.qol;
    window.G0DQol?.update?.({ [key]: input.checked });
    if (key === 'expandThinking' && selectedData) renderSelected(selectedData, true);
    settingsFeedback('Quality-of-life preference saved on this device.');
    return;
  }
  if (input.name === 'qol-send-key') {
    window.G0DQol?.update?.({ sendKey: input.value });
    settingsFeedback(input.value === 'mod_enter' ? 'Send shortcut set to ⌘/Ctrl + Enter.' : 'Send shortcut set to Enter.');
    return;
  }
  if (input.name === 'qol-diff-mode') {
    const mode = input.value === 'split' ? 'split' : 'unified';
    try { localStorage.setItem('g0dc0d3.diffViewMode', mode); } catch {}
    if (typeof diffViewMode !== 'undefined') diffViewMode = mode;
    if (selectedData && typeof renderChanges === 'function') {
      if (typeof changesSignature !== 'undefined') changesSignature = '';
      renderChanges(selectedData.diff || []);
    }
    settingsFeedback(`Default diff layout set to ${mode === 'split' ? 'side-by-side' : 'unified'}.`);
    return;
  }
  if (input.matches('[data-policy]')) {
    if (!input.checkValidity()) { input.reportValidity(); return; }
    const key = input.dataset.policy;
    const value = input.type === 'checkbox' ? input.checked : key === 'strategies' ? input.value.split(',').map(x => x.trim()).filter(Boolean) : key === 'requestTimeoutMs' ? RecoveryUI.milliseconds(input.value) : Number(input.value);
    saveSetting('policy', { [key]: value });
  } else if (input.name === 'settings-mode') saveSetting('policy', { mode: input.value });
  else if (input.name === 'settings-persona') saveSetting('persona', { persona: input.value });
  else if (input.name === 'settings-text-size') {
    applyTextSize(input.value); resizeComposer();
    const dlg = $('#settings-dialog');
    if (dlg) dlg.scrollTop = 0;
    try { localStorage.setItem('g0dc0d3.display', JSON.stringify({ textSize: input.value })); settingsFeedback('Saved on this device.'); } catch { settingsFeedback('Changed for this visit. Could not save.', true); }
  } else if (input.closest('#execution-form')) {
    if (!$('#execution-form').reportValidity()) return;
    if (!$('#settings-execution').checked) $('#settings-network').checked = false;
    saveSetting('execution', { enabled: $('#settings-execution').checked, network: $('#settings-network').checked, timeoutMs: Math.round(Number($('#settings-command-timeout').value) * 1000) });
  }
});
$('#execution-form').addEventListener('submit', event => event.preventDefault());
$('#permission-rule-add-form')?.addEventListener('submit', event => {
  event.preventDefault();
  const action = $('#perm-rule-action')?.value || 'ask';
  const tool = $('#perm-rule-tool')?.value?.trim();
  const pattern = $('#perm-rule-pattern')?.value?.trim();
  const reason = $('#perm-rule-reason')?.value?.trim();
  if (!tool) return;
  const { rules } = activePermissionRulesForScope();
  const nextRule = { tool, action, ...(pattern ? { pattern } : {}), ...(reason ? { reason } : {}) };
  saveCustomPermissionRules([...rules, nextRule], `Added ${action.toUpperCase()} rule for ${tool}.`).then(() => {
    if ($('#perm-rule-tool')) $('#perm-rule-tool').value = '';
    if ($('#perm-rule-pattern')) $('#perm-rule-pattern').value = '';
    if ($('#perm-rule-reason')) $('#perm-rule-reason').value = '';
  });
});
$('#checks-form').addEventListener('submit', event => { event.preventDefault(); saveSetting('checks', { checks: $('#settings-checks').value.split('\n').map(x => x.trim()).filter(Boolean).map((command, i) => ({ name: `Project check ${i + 1}`, command })) }); });
$('#memory-search').addEventListener('input', () => {
  clearTimeout(memorySearchTimer);
  memorySearchTimer = setTimeout(() => loadMemorySettings(), 180);
});
$('#memory-add-form').addEventListener('submit', async event => {
  event.preventDefault();
  const title = ($('#memory-title')?.value || '').trim();
  const content = ($('#memory-content')?.value || '').trim();
  const scope = $('#memory-scope')?.value || 'global';
  const tags = ($('#memory-tags')?.value || '').split(',').map(t => t.trim()).filter(Boolean);
  if (!title || !content) return;
  const submitBtn = $('#memory-add-submit');
  if (submitBtn) submitBtn.disabled = true;
  settingsFeedback('Saving memory…');
  try {
    const payload = { title, content, scope: scope === 'project' && selectedId ? 'project' : 'global', tags };
    if (payload.scope === 'project') payload.taskId = selectedId;
    await api('/api/memory', { method: 'POST', body: JSON.stringify(payload) });
    $('#memory-add-form').reset();
    await loadMemorySettings();
    settingsFeedback('Memory saved.');
    toast(`Saved memory: ${title}`);
  } catch (error) {
    settingsFeedback(error.message, true);
    toast(error.message);
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
});
$('#skill-add-form').addEventListener('submit', async event => {
  event.preventDefault();
  const name = ($('#skill-name')?.value || '').trim().toLowerCase();
  const description = ($('#skill-description')?.value || '').trim();
  const body = ($('#skill-body')?.value || '').trim();
  const mode = $('#skill-mode')?.value || '';
  if (!name || !body) return;
  const submitBtn = $('#skill-add-submit');
  if (submitBtn) submitBtn.disabled = true;
  settingsFeedback('Saving skill…');
  try {
    await api('/api/skills', { method: 'POST', body: JSON.stringify({ name, description, body, ...(mode ? { mode } : {}) }) });
    $('#skill-add-form').reset();
    await loadSkillsSettings();
    settingsFeedback(`Saved skill /${name}.`);
    toast(`Saved reusable skill /${name}.`);
  } catch (error) {
    settingsFeedback(error.message, true);
    toast(error.message);
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
});
$('#learning-reset').addEventListener('click', async () => { try { await api('/api/learning', { method: 'DELETE', body: '{}' }); await loadLearning(); settingsFeedback('Local learning reset.'); } catch (error) { settingsFeedback(error.message, true); } });
$('#privacy-audit-clear').addEventListener('click', async () => { try { const data = await api('/api/privacy/audit', { method: 'DELETE', body: '{}' }); renderPrivacySettings(data); settingsFeedback('Outbound audit log cleared.'); } catch (error) { settingsFeedback(error.message, true); } });
$('#privacy-scope-save')?.addEventListener('click', () => {
  const scopeAllow = ($('#privacy-scope-allow')?.value || '').split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
  const scopeDeny = ($('#privacy-scope-deny')?.value || '').split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
  updatePrivacySetting({ scopeAllow, scopeDeny });
});
$('#privacy-burn-btn')?.addEventListener('click', async () => {
  const btn = $('#privacy-burn-btn');
  if (btn) btn.disabled = true;
  settingsFeedback('Burning session telemetry, learning, and ephemeral browser profiles…');
  try {
    const res = await api('/api/privacy/burn', { method: 'POST', body: JSON.stringify({ includeTasks: false }) });
    if (res.privacy) renderPrivacySettings(res.privacy);
    if (res.overseer && typeof overseerData !== 'undefined') {
      overseerData = res.overseer;
      state.overseer = res.overseer;
      if (typeof renderOverseerSection === 'function') renderOverseerSection();
      if (typeof renderOverseerEdge === 'function') renderOverseerEdge();
    }
    settingsFeedback('Session burned: cleared outbound audit, local learning, refusal patterns & ephemeral browsers.');
    toast('Session burned cleanly.');
  } catch (error) {
    settingsFeedback(error.message, true);
    toast(error.message);
  } finally {
    if (btn) btn.disabled = false;
  }
});
$('#drafts-clear').addEventListener('click', () => { composerDrafts.clear(); composerDraftTimes.clear(); saveComposerDraft('welcome', ''); $('#composer-input').value = ''; resizeComposer(); renderComposer(); settingsFeedback(draftStorageAvailable ? 'Saved drafts cleared.' : 'Could not clear stored drafts.', !draftStorageAvailable); });
$('#benchmark-open')?.addEventListener('click', () => { $('#settings-dialog')?.close(); openBenchmark(); });
$('#welcome-create')?.addEventListener('click', () => { $('#settings-dialog')?.close(); openCreate(); });
$('#qol-reset-layout')?.addEventListener('click', () => {
  window.G0DQol?.resetLayout?.();
  settingsFeedback('All panel sizes and splitters reset to defaults.');
  toast('Panel layout reset to defaults.');
});
$('#qol-clear-recent')?.addEventListener('click', () => {
  window.G0DQol?.clearRecentModels?.();
  settingsFeedback('Recent models list cleared.');
  toast('Recent models cleared.');
});
$('#settings-global-search')?.addEventListener('input', event => {
  renderSettingsSearchResults(event.target.value);
});
window.addEventListener('keydown', event => {
  if (!$('#settings-dialog')?.open) return;
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
    event.preventDefault();
    const s = $('#settings-global-search');
    if (s) { s.focus(); s.select(); }
  }
});
$('#qol-test-chime')?.addEventListener('click', () => {
  window.G0DQol?.playChime?.('done', { force: true });
  settingsFeedback('Played completion chime.');
});
$('#personal-instructions-form')?.addEventListener('submit', async event => {
  event.preventDefault();
  const val = $('#personal-instructions-input')?.value || '';
  await patchTransparency({ prompts: { customAppend: val } }, val.trim() ? 'Saved personal instructions.' : 'Cleared personal instructions.');
  renderPersonalInstructionsFromTransparency();
  updateSettingsNavBadges();
});
$('#personal-instructions-clear')?.addEventListener('click', async () => {
  if ($('#personal-instructions-input')) $('#personal-instructions-input').value = '';
  await resetTransparencyAction({ promptId: 'customAppend' }, 'Cleared personal instructions.');
  renderPersonalInstructionsFromTransparency();
  updateSettingsNavBadges();
});
function buildPreferencesSnapshot() {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    theme: window.G0DThemes?.current?.()?.id || 'obsidian',
    textSize: document.documentElement.dataset.textSize || 'comfortable',
    qol: window.G0DQol?.get?.() || {},
    diffViewMode: localStorage.getItem('g0dc0d3.diffViewMode') || 'unified',
    defaults: RecoveryUI.preferences(),
  };
}
$('#qol-export-prefs')?.addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(buildPreferencesSnapshot(), null, 2) + '\n'], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'g0dm0d3-preferences.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  settingsFeedback('Downloaded g0dm0d3-preferences.json (zero keys or chats).');
  toast('Exported preferences JSON.');
});
$('#qol-import-prefs')?.addEventListener('click', () => $('#qol-import-file')?.click());
$('#qol-import-file')?.addEventListener('change', async event => {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  try {
    const raw = JSON.parse(await file.text());
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid JSON preferences object.');
    if (typeof raw.theme === 'string') window.G0DThemes?.apply?.(raw.theme, { persist: true, notify: false });
    if (['comfortable', 'large', 'extra-large'].includes(raw.textSize)) {
      applyTextSize(raw.textSize);
      localStorage.setItem('g0dc0d3.display', JSON.stringify({ textSize: raw.textSize }));
    }
    if (raw.qol && typeof raw.qol === 'object') window.G0DQol?.update?.(raw.qol);
    if (['unified', 'split'].includes(raw.diffViewMode)) {
      localStorage.setItem('g0dc0d3.diffViewMode', raw.diffViewMode);
      if (typeof diffViewMode !== 'undefined') diffViewMode = raw.diffViewMode;
    }
    if (raw.defaults && typeof raw.defaults === 'object' && !Array.isArray(raw.defaults)) {
      const validPersona = ['plinian', 'focused'].includes(raw.defaults.persona) ? raw.defaults.persona : null;
      const validPolicy = raw.defaults.policy && typeof raw.defaults.policy === 'object' && !Array.isArray(raw.defaults.policy) ? raw.defaults.policy : null;
      const merged = { ...RecoveryUI.preferences(), ...(validPersona ? { persona: validPersona } : {}), ...(validPolicy ? { policy: RecoveryUI.updatedPolicy(validPolicy) } : {}) };
      localStorage.setItem('g0dc0d3.defaults', JSON.stringify(merged));
    }
    renderSettingsValues();
    renderComposer();
    updateSettingsNavBadges();
    settingsFeedback('Imported preferences from JSON.');
    toast('Preferences imported cleanly.');
  } catch (err) {
    settingsFeedback(`Import failed: ${err.message}`, true);
    toast(`Import failed: ${err.message}`);
  }
});
$('#qol-copy-prefs')?.addEventListener('click', async () => {
  const payload = buildPreferencesSnapshot();
  try {
    await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    settingsFeedback('Preferences JSON copied to clipboard (no keys or chats included).');
    toast('Copied preferences JSON.');
  } catch {
    settingsFeedback('Clipboard unavailable in this context.', true);
  }
});
$('#create-execution').addEventListener('change', () => { $('#create-network').disabled = !$('#create-execution').checked; if (!$('#create-execution').checked) $('#create-network').checked = false; });
document.addEventListener('click', event => { if (event.target.closest('[data-command-settings]')) openSettings('tools'); });

$('#settings-checks').addEventListener('input', () => { if (settingsTaskId) settingsCheckDrafts.set(settingsTaskId, $('#settings-checks').value); });

function renderRaceOptions(task) {
  const panel = $('#race-options');
  if (!panel) return;
  const models = typeof availableArenaModels === 'function' ? availableArenaModels() : (veniceCatalog.models || []);
  const config = task ? task.answerRace : RecoveryUI.preferences().answerRace;
  panel.hidden = models.length < 2 || Boolean(task && task.workspaceKind !== 'conversation');
  if (panel.hidden) return;
  const scope = JSON.stringify([task?.id || 'defaults', config || null]);
  const changed = panel.dataset.scope !== scope;
  panel.dataset.scope = scope;
  if (changed) {
    $('#race-enabled').checked = Boolean(config);
    setText('#race-feedback', '');
  }
  const preferred = task?.providerId || newConversationProviders()[0];
  const first = models.some(m => m.id === preferred) ? preferred : (RecoveryUI.recommendedBackup(models, null) || models[0]?.id);
  const second = RecoveryUI.recommendedBackup(models, first) || models.find(m => m.id !== first)?.id || '';
  const third = models.find(m => m.id !== first && m.id !== second)?.id || '';
  const judge = models.find(m => /glm-5-3-flash|gemini-4-neon|claude-sonnet/i.test(m.id))?.id || second || first;
  const saved = config
    ? [config.models?.[0] || '', config.models?.[1] || '', config.models?.[2] || '', config.models?.[3] || '', config.judge || '']
    : [first || '', second || '', third || '', '', judge || ''];
  const selectors = [
    ['#race-first', 'Choose Writer A'],
    ['#race-second', 'Choose Writer B'],
    ['#race-third', 'None (2-model race)'],
    ['#race-fourth', 'None'],
    ['#race-judge', 'Choose Blind Judge']
  ];
  const key = models.map(m => m.id).join('|');
  const modelIds = new Set(models.map(m => m.id));
  selectors.forEach(([selector, placeholder], i) => {
    const el = $(selector);
    if (!el) return;
    const prev = el.value;
    const value = changed ? saved[i] : (prev && modelIds.has(prev) ? prev : saved[i]);
    if (settingsListContents.get(el) !== key) {
      el.replaceChildren(
        new Option(placeholder, ''),
        ...models.map(m => new Option(m.label === m.model ? m.model : `${m.label || m.id}${m.model && !String(m.label || '').includes(m.model) ? ` · ${m.model}` : ''}`, m.id))
      );
      settingsListContents.set(el, key);
    }
    el.value = value && modelIds.has(value) ? value : '';
  });
  syncRaceControls();
}
function syncRaceControls() {
  const task = settingsTask(), locked = settingsBusy || Boolean(task?.draining) || ACTIVE.has(task?.status) || task?.status === 'cancelled';
  const enabled = $('#race-enabled').checked;
  $('#race-enabled').disabled = locked;
  $$('.race-selectors select').forEach(el => el.disabled = locked || !enabled);
  const chosen = ['#race-first', '#race-second', '#race-third', '#race-fourth'].map(s => $(s)?.value || '').filter(Boolean);
  const unique = new Set(chosen);
  const dup = unique.size !== chosen.length;
  const a = $('#race-first')?.value, b = $('#race-second')?.value, j = $('#race-judge')?.value;
  $('#race-save').disabled = locked || (enabled && (!a || !b || !j || dup));
  setText('#race-feedback', enabled && dup ? 'Choose distinct models for each writer slot.' : '');
}
$('#race-options').addEventListener('change', syncRaceControls);
$('#race-save').addEventListener('click', async () => {
  const task = settingsTask(), enabled = $('#race-enabled').checked;
  const writers = ['#race-first', '#race-second', '#race-third', '#race-fourth'].map(s => $(s)?.value || '').filter(Boolean);
  const answerRace = enabled ? { models: writers, judge: $('#race-judge').value } : null;
  const ok = await saveSetting('answer-race', { answerRace }, task);
  if (!ok) return;
  if (enabled) {
    await updateUltraRouter({ mode: 'manual_arena' }).catch(() => {});
  } else if ((ultraRouterData?.settings?.mode || state.router?.mode) === 'manual_arena') {
    await updateUltraRouter({ mode: 'off' }).catch(() => {});
  }
  delete $('#race-options').dataset.scope;
  renderRaceOptions(settingsTask());
});

/* ── System Prompts, Tool Schemas & Prefills/Injections Lab ────────────── */
let transparencyState = null;
let transSubtab = 'prompts';
let transToolCategory = 'All';
let transWireMode = 'directChat';

async function loadBrowserSettings() {
  try {
    const data = await api('/api/browser/settings');
    const st = data?.settings || {};
    if ($('#browser-visible-window')) $('#browser-visible-window').checked = Boolean(st.visibleWindow);
    if ($('#browser-live-mirror')) $('#browser-live-mirror').checked = st.liveMirror !== false;
    if ($('#browser-auto-open')) $('#browser-auto-open').checked = st.autoOpenMirror !== false;
    const badge = $('#browser-chromium-badge');
    if (badge) {
      badge.textContent = data?.chromiumAvailable ? (st.visibleWindow ? 'Window Mode' : 'Headless Mirror') : 'No Chromium';
      badge.className = `meta-chip ${data?.chromiumAvailable ? '' : 'neutral'}`;
    }
  } catch {}
}
window.loadBrowserSettings = loadBrowserSettings;
async function updateBrowserSetting(key, value) {
  try {
    const data = await api('/api/browser/settings', { method: 'PATCH', body: JSON.stringify({ [key]: Boolean(value) }) });
    const st = data?.settings || {};
    if ($('#browser-visible-window')) $('#browser-visible-window').checked = Boolean(st.visibleWindow);
    if ($('#browser-live-mirror')) $('#browser-live-mirror').checked = st.liveMirror !== false;
    if ($('#browser-auto-open')) $('#browser-auto-open').checked = st.autoOpenMirror !== false;
    const badge = $('#browser-chromium-badge');
    if (badge && data?.chromiumAvailable) badge.textContent = st.visibleWindow ? 'Window Mode' : 'Headless Mirror';
    window.G0DBrowserLive?.loadStatus?.();
    settingsFeedback(key === 'visibleWindow'
      ? (st.visibleWindow ? 'Non-headless visible browser window enabled for new sessions.' : 'Headless live mirror restored as default.')
      : 'Browser viewer preference saved.');
  } catch (err) {
    settingsFeedback(err.message || 'Could not save browser setting.', true);
    loadBrowserSettings();
  }
}

function selectTransparencySubtab(subtab) {
  transSubtab = ['prompts', 'tools', 'lab', 'wire'].includes(subtab) ? subtab : 'prompts';
  $$('[data-trans-subtab]').forEach(btn => {
    const active = btn.dataset.transSubtab === transSubtab;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', String(active));
  });
  for (const id of ['prompts', 'tools', 'lab', 'wire']) {
    const panel = $(`#trans-panel-${id}`);
    if (panel) panel.classList.toggle('hidden', id !== transSubtab);
  }
  if (transparencyState && transSubtab === 'wire') renderTransparencyWire();
}

async function loadTransparencySettings() {
  try {
    const task = settingsTask();
    const qs = task ? `?taskId=${encodeURIComponent(task.id)}` : '';
    transparencyState = await api(`/api/transparency${qs}`);
    renderTransparencySettings();
  } catch (error) {
    settingsFeedback(error.message, true);
  }
}

function renderTransparencySummary() {
  const data = transparencyState;
  if (!data) return;
  const c = data.overrideCount || {};
  const parts = [];
  if (c.prompts) parts.push(`${c.prompts} prompt${c.prompts === 1 ? '' : 's'} edited`);
  if (c.tools) parts.push(`${c.tools} tool${c.tools === 1 ? '' : 's'} customized`);
  if (c.disabledTools) parts.push(`${c.disabledTools} disabled`);
  if (c.injectionsActive) parts.push('Prefill Lab ON');
  setText('#transparency-summary-badge', parts.length ? parts.join(' · ') : 'All defaults active');
  setText('#trans-tools-count', String((data.tools || []).length));
}

function renderTransparencyPrompts() {
  const container = $('#trans-prompts-list');
  if (!container || !transparencyState) return;
  const q = ($('#trans-prompt-search')?.value || '').trim().toLowerCase();
  const items = (transparencyState.prompts || []).filter(p =>
    !q || `${p.id} ${p.group} ${p.title} ${p.description} ${p.value}`.toLowerCase().includes(q)
  );
  if (!items.length) {
    container.innerHTML = '<p class="field-help">No system prompt blocks match your search.</p>';
    return;
  }
  const groups = new Map();
  for (const item of items) {
    if (!groups.has(item.group)) groups.set(item.group, []);
    groups.get(item.group).push(item);
  }
  container.innerHTML = [...groups.entries()].map(([groupName, entries]) => `
    <div class="transparency-group">
      <h4 class="transparency-group-title">${escapeHTML(groupName)}</h4>
      ${entries.map(p => `
        <details class="transparency-card${p.overridden ? ' is-customized' : ''}" data-prompt-card="${escapeHTML(p.id)}"${p.overridden || p.id === 'customAppend' ? ' open' : ''}>
          <summary class="transparency-card-summary">
            <div class="transparency-card-meta">
              <strong>${escapeHTML(p.title)}</strong>
              <code>${escapeHTML(p.id)}</code>
              ${p.overridden ? '<span class="trans-pill trans-pill-custom">Customized</span>' : ''}
            </div>
            <span class="trans-char-count">${escapeHTML(String(p.value.length))} chars</span>
          </summary>
          <div class="transparency-card-body">
            <p class="field-help">${escapeHTML(p.description)}</p>
            <textarea class="transparency-code-input" data-prompt-input="${escapeHTML(p.id)}" rows="${p.id === 'customAppend' ? 3 : Math.min(12, Math.max(4, Math.ceil(p.value.length / 110)))}" spellcheck="false" aria-label="${escapeHTML(p.title)}">${escapeHTML(p.value)}</textarea>
            <div class="transparency-card-actions">
              <button type="button" class="button button-primary" data-save-prompt="${escapeHTML(p.id)}">Save prompt</button>
              <button type="button" class="button button-quiet" data-reset-prompt="${escapeHTML(p.id)}"${p.overridden ? '' : ' disabled'}>Reset to default</button>
            </div>
          </div>
        </details>
      `).join('')}
    </div>
  `).join('');
}

function renderTransparencyTools() {
  const container = $('#trans-tools-list');
  const catsEl = $('#trans-tool-categories');
  if (!container || !transparencyState) return;
  const allTools = transparencyState.tools || [];
  const cats = ['All', ...new Set(allTools.map(t => t.category))];
  if (catsEl) {
    catsEl.innerHTML = cats.map(cat =>
      `<button type="button" class="trans-cat-pill${transToolCategory === cat ? ' active' : ''}" data-trans-cat="${escapeHTML(cat)}">${escapeHTML(cat)}</button>`
    ).join('');
  }
  const q = ($('#trans-tool-search')?.value || '').trim().toLowerCase();
  const filtered = allTools.filter(t =>
    (transToolCategory === 'All' || t.category === transToolCategory)
    && (!q || `${t.name} ${t.category} ${t.description}`.toLowerCase().includes(q))
  );
  if (!filtered.length) {
    container.innerHTML = '<p class="field-help">No tools match that filter.</p>';
    return;
  }
  container.innerHTML = filtered.map(t => `
    <details class="transparency-card${t.overridden ? ' is-customized' : ''}${!t.enabled ? ' is-disabled-tool' : ''}" data-tool-card="${escapeHTML(t.name)}"${t.overridden ? ' open' : ''}>
      <summary class="transparency-card-summary">
        <div class="transparency-card-meta">
          <strong><code>${escapeHTML(t.name)}</code></strong>
          <span class="trans-pill">${escapeHTML(t.category)}</span>
          ${!t.enabled ? '<span class="trans-pill trans-pill-off">Disabled</span>' : ''}
          ${t.overridden && t.enabled ? '<span class="trans-pill trans-pill-custom">Customized</span>' : ''}
        </div>
        <span class="trans-char-count">${escapeHTML(String(Object.keys(t.parameters?.properties || {}).length))} params</span>
      </summary>
      <div class="transparency-card-body">
        <div class="setting-row trans-tool-toggle-row">
          <label for="trans-tool-en-${escapeHTML(t.name.replace(/\./g, '-'))}">Advertise tool to models<small>Disable to hide <code>${escapeHTML(t.name)}</code> from model tool lists.</small></label>
          <input type="checkbox" role="switch" class="toggle" id="trans-tool-en-${escapeHTML(t.name.replace(/\./g, '-'))}" data-tool-enabled="${escapeHTML(t.name)}" ${t.enabled ? 'checked' : ''}>
        </div>
        <label class="field-label">Description sent to model</label>
        <textarea class="transparency-code-input" data-tool-desc="${escapeHTML(t.name)}" rows="3" spellcheck="false">${escapeHTML(t.description)}</textarea>
        <label class="field-label">Parameters JSON Schema</label>
        <textarea class="transparency-code-input" data-tool-params="${escapeHTML(t.name)}" rows="7" spellcheck="false">${escapeHTML(JSON.stringify(t.parameters, null, 2))}</textarea>
        <p class="form-feedback error hidden" data-tool-error="${escapeHTML(t.name)}" role="alert"></p>
        <details class="trans-result-schema">
          <summary>Result JSON Schema (read-only contract)</summary>
          <pre class="wire-pre">${escapeHTML(JSON.stringify(t.resultSchema, null, 2))}</pre>
        </details>
        <div class="transparency-card-actions">
          <button type="button" class="button button-primary" data-save-tool="${escapeHTML(t.name)}">Save tool schema</button>
          <button type="button" class="button button-quiet" data-reset-tool="${escapeHTML(t.name)}"${t.overridden ? '' : ' disabled'}>Reset default</button>
        </div>
      </div>
    </details>
  `).join('');
}

function renderTransparencyLab() {
  if (!transparencyState) return;
  const inj = transparencyState.injections || {};
  if ($('#lab-injections-enabled')) $('#lab-injections-enabled').checked = Boolean(inj.enabled);
  if ($('#lab-stitch-prefill')) $('#lab-stitch-prefill').checked = inj.stitchPrefill !== false;
  if ($('#lab-system-prefix')) $('#lab-system-prefix').value = inj.systemPrefix || '';
  if ($('#lab-system-suffix')) $('#lab-system-suffix').value = inj.systemSuffix || '';
  if ($('#lab-fewshot-user')) $('#lab-fewshot-user').value = inj.fewShotUser || '';
  if ($('#lab-fewshot-assistant')) $('#lab-fewshot-assistant').value = inj.fewShotAssistant || '';
  if ($('#lab-user-prefix')) $('#lab-user-prefix').value = inj.userPrefix || '';
  if ($('#lab-user-suffix')) $('#lab-user-suffix').value = inj.userSuffix || '';
  if ($('#lab-reasoning-prefill')) $('#lab-reasoning-prefill').value = inj.reasoningPrefill || '';
  if ($('#lab-assistant-prefill')) $('#lab-assistant-prefill').value = inj.assistantPrefill || '';
  const presetsRow = $('#lab-presets-row');
  if (presetsRow) {
    presetsRow.innerHTML = (transparencyState.presets || []).map(p =>
      `<button type="button" class="button button-secondary lab-preset-btn" data-lab-preset="${escapeHTML(p.id)}" title="${escapeHTML(p.description)}">${escapeHTML(p.label)}</button>`
    ).join('');
  }
}

function renderTransparencyWire() {
  if (!transparencyState?.compiledPreview) return;
  const prev = transparencyState.compiledPreview;
  const active = transWireMode === 'agentLoop' ? prev.agentLoop : prev.directChat;
  $$('#wire-mode-switch [data-wire-mode]').forEach(btn => btn.setAttribute('aria-pressed', String(btn.dataset.wireMode === transWireMode)));
  setText('#wire-stats-badge', `${(active.chars || 0).toLocaleString()} chars · ~${(active.approxTokens || 0).toLocaleString()} tokens`);
  setText('#wire-scope-note', prev.taskTitle ? `Live preview for active chat: ${prev.taskTitle}` : 'Live preview for default new conversation (open a chat to inspect its exact task state).');
  setText('#wire-system-preview', active.system || '');
  setText('#wire-tools-count', String(prev.activeToolCount ?? 0));
  setText('#wire-tools-preview', JSON.stringify(prev.activeTools || [], null, 2));
  const msgWrap = $('#wire-messages-wrap');
  const msgList = $('#wire-messages-list');
  const wireMsgs = prev.directChat?.wireMessages || [];
  if (msgWrap && msgList) {
    msgWrap.classList.toggle('hidden', transWireMode !== 'directChat');
    msgList.innerHTML = wireMsgs.map((m, idx) => `
      <div class="wire-msg-row">
        <div class="wire-msg-head"><span class="wire-role-badge role-${escapeHTML(m.role)}">#${idx + 1} · ${escapeHTML(m.role.toUpperCase())}</span><span class="trans-char-count">${escapeHTML(String(m.preview.length))} chars</span></div>
        <pre class="wire-msg-body">${escapeHTML(m.preview.length > 900 ? `${m.preview.slice(0, 900)}\n… (${m.preview.length - 900} more chars)` : m.preview)}</pre>
      </div>
    `).join('');
  }
}

function renderTransparencySettings() {
  renderTransparencySummary();
  renderTransparencyPrompts();
  renderTransparencyTools();
  renderTransparencyLab();
  renderTransparencyWire();
}

async function patchTransparency(patch, okMsg) {
  const task = settingsTask();
  const qs = task ? `?taskId=${encodeURIComponent(task.id)}` : '';
  settingsFeedback('Saving…');
  try {
    transparencyState = await api(`/api/transparency${qs}`, { method: 'PATCH', body: JSON.stringify(patch) });
    renderTransparencySettings();
    settingsFeedback(okMsg || 'Saved.');
    if (okMsg) toast(okMsg);
  } catch (error) {
    settingsFeedback(error.message, true);
    toast(error.message);
  }
}

async function resetTransparencyAction(payload, okMsg) {
  const task = settingsTask();
  const qs = task ? `?taskId=${encodeURIComponent(task.id)}` : '';
  settingsFeedback('Resetting…');
  try {
    transparencyState = await api(`/api/transparency/reset${qs}`, { method: 'POST', body: JSON.stringify(payload) });
    renderTransparencySettings();
    settingsFeedback(okMsg || 'Reset to defaults.');
    if (okMsg) toast(okMsg);
  } catch (error) {
    settingsFeedback(error.message, true);
    toast(error.message);
  }
}

$('#settings-pane-system')?.addEventListener('click', async event => {
  const sub = event.target.closest('[data-trans-subtab]');
  if (sub) { selectTransparencySubtab(sub.dataset.transSubtab); return; }
  const cat = event.target.closest('[data-trans-cat]');
  if (cat) { transToolCategory = cat.dataset.transCat; renderTransparencyTools(); return; }
  const wireBtn = event.target.closest('[data-wire-mode]');
  if (wireBtn) { transWireMode = wireBtn.dataset.wireMode; renderTransparencyWire(); return; }
  const savePrompt = event.target.closest('[data-save-prompt]');
  if (savePrompt) {
    const id = savePrompt.dataset.savePrompt;
    const input = $(`[data-prompt-input="${CSS.escape(id)}"]`);
    if (input) await patchTransparency({ prompts: { [id]: input.value } }, `Saved prompt "${id}".`);
    return;
  }
  const resetPrompt = event.target.closest('[data-reset-prompt]');
  if (resetPrompt) {
    const id = resetPrompt.dataset.resetPrompt;
    await resetTransparencyAction({ promptId: id }, `Reset "${id}" to default.`);
    return;
  }
  const saveTool = event.target.closest('[data-save-tool]');
  if (saveTool) {
    const name = saveTool.dataset.saveTool;
    const descEl = $(`[data-tool-desc="${CSS.escape(name)}"]`);
    const paramsEl = $(`[data-tool-params="${CSS.escape(name)}"]`);
    const enEl = $(`[data-tool-enabled="${CSS.escape(name)}"]`);
    const errEl = $(`[data-tool-error="${CSS.escape(name)}"]`);
    let parsedParams;
    try {
      parsedParams = JSON.parse(paramsEl?.value || '{}');
      if (errEl) { errEl.textContent = ''; errEl.classList.add('hidden'); }
    } catch (parseErr) {
      if (errEl) { errEl.textContent = `Invalid JSON schema: ${parseErr.message}`; errEl.classList.remove('hidden'); }
      return;
    }
    await patchTransparency({
      tools: { [name]: { enabled: Boolean(enEl?.checked ?? true), description: descEl?.value || '', parameters: parsedParams } }
    }, `Saved tool schema for ${name}.`);
    return;
  }
  const resetTool = event.target.closest('[data-reset-tool]');
  if (resetTool) {
    const name = resetTool.dataset.resetTool;
    await resetTransparencyAction({ toolName: name }, `Reset ${name} schema to default.`);
    return;
  }
  const presetBtn = event.target.closest('[data-lab-preset]');
  if (presetBtn) {
    const preset = (transparencyState?.presets || []).find(p => p.id === presetBtn.dataset.labPreset);
    if (preset?.patch) {
      await patchTransparency({ injections: preset.patch }, `Applied preset: ${preset.label}.`);
    }
    return;
  }
});

$('#settings-pane-system')?.addEventListener('change', async event => {
  const toolToggle = event.target.closest('[data-tool-enabled]');
  if (toolToggle) {
    const name = toolToggle.dataset.toolEnabled;
    await patchTransparency({ tools: { [name]: { enabled: toolToggle.checked } } }, `${name} ${toolToggle.checked ? 'enabled' : 'disabled'}.`);
    return;
  }
  if (event.target?.id === 'lab-injections-enabled' || event.target?.id === 'lab-stitch-prefill') {
    await patchTransparency({
      injections: {
        enabled: Boolean($('#lab-injections-enabled')?.checked),
        stitchPrefill: Boolean($('#lab-stitch-prefill')?.checked),
      }
    }, event.target.id === 'lab-injections-enabled' ? ($('#lab-injections-enabled').checked ? 'Prefills & Message Shaping enabled.' : 'Prefills & Message Shaping disabled.') : 'Updated prefill stitch preference.');
  }
});

$('#lab-injections-form')?.addEventListener('submit', async event => {
  event.preventDefault();
  await patchTransparency({
    injections: {
      enabled: Boolean($('#lab-injections-enabled')?.checked),
      stitchPrefill: Boolean($('#lab-stitch-prefill')?.checked),
      systemPrefix: $('#lab-system-prefix')?.value || '',
      systemSuffix: $('#lab-system-suffix')?.value || '',
      fewShotUser: $('#lab-fewshot-user')?.value || '',
      fewShotAssistant: $('#lab-fewshot-assistant')?.value || '',
      userPrefix: $('#lab-user-prefix')?.value || '',
      userSuffix: $('#lab-user-suffix')?.value || '',
      reasoningPrefill: $('#lab-reasoning-prefill')?.value || '',
      assistantPrefill: $('#lab-assistant-prefill')?.value || '',
    }
  }, 'Saved Prefills & Message Shaping config.');
});

$('#lab-reset-btn')?.addEventListener('click', () => resetTransparencyAction({ scope: 'injections' }, 'Cleared and disabled Prefills & Message Shaping.'));
$('#trans-reset-prompts')?.addEventListener('click', () => resetTransparencyAction({ scope: 'prompts' }, 'All system prompts reset to defaults.'));
$('#trans-reset-tools')?.addEventListener('click', () => resetTransparencyAction({ scope: 'tools' }, 'All tool schemas reset to defaults.'));
$('#transparency-reset-all')?.addEventListener('click', () => resetTransparencyAction({ scope: 'all' }, 'Reset all prompts, tool schemas, and message shaping to defaults.'));
$('#trans-prompt-search')?.addEventListener('input', renderTransparencyPrompts);
$('#trans-tool-search')?.addEventListener('input', renderTransparencyTools);
$('#wire-copy-prompt')?.addEventListener('click', async () => {
  const txt = $('#wire-system-preview')?.textContent || '';
  try { await navigator.clipboard.writeText(txt); toast('Copied compiled system prompt.'); } catch { toast('Clipboard unavailable.'); }
});
$('#wire-copy-tools')?.addEventListener('click', async () => {
  const txt = $('#wire-tools-preview')?.textContent || '';
  try { await navigator.clipboard.writeText(txt); toast('Copied active tool schemas JSON.'); } catch { toast('Clipboard unavailable.'); }
});
