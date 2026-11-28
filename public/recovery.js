/* Shared presentation of controller-owned recovery state. No model decisions here. */
'use strict';
const RecoveryUI = (() => {
  const defaults = Object.freeze({ mode: 'adaptive', maxAttempts: 15, maxCalls: 250, strategies: ['continue', 'decompose', 'reproduce-first', 'alternate-approach'], requestTimeoutMs: 300000, maxNoProgressTurns: 6, returnToPrimary: true, stickyOnRefusal: true, learning: true, autoContinue: true, maxContinuations: 6 });

  const LIBERATION_MESSAGES = [
    'God mode enabled',
    'Adaptive recovery',
    'Recovering',
    'Trying fresh angle',
    'Recalibrating route',
    'Reframing context',
    'Resuming G0DM0D3 recovery',
    'Exploring alternate path',
    'Shifting perspective',
    'Testing fallback route',
    'Deepening analysis',
    'Switching model lane',
    'Engaging creative angle',
    'Consulting fallback model',
    'Switching dimensions',
    'Rolling for initiative',
    'Summoning reinforcements',
    'Plinian mode activated',
  ];
  let _lastLibIdx = -1;
  function liberationMessage() {
    let idx;
    do { idx = Math.floor(Math.random() * LIBERATION_MESSAGES.length); } while (idx === _lastLibIdx && LIBERATION_MESSAGES.length > 1);
    _lastLibIdx = idx;
    return LIBERATION_MESSAGES[idx];
  }
  function findVeniceUncensored(connected = [], veniceConnectionId = null, models = []) {
    const isUncensored = entry => /venice[-_.\s]?uncensored/i.test(`${entry?.id || ''} ${entry?.model || ''} ${entry?.label || ''}`);
    const liveMatch = (connected || []).find(entry => entry?.available !== false && isUncensored(entry));
    if (liveMatch) return liveMatch.id;
    if (!veniceConnectionId) return null;
    const available = (models || []).filter(entry => entry?.id?.startsWith('venice-catalog:') && entry.available !== false);
    for (const exact of ['venice-uncensored-1-2', 'venice-uncensored']) {
      const hit = available.find(entry => entry.id === 'venice-catalog:' + exact || entry.model === exact);
      if (hit) return hit.id;
    }
    const fuzzy = available.find(entry => isUncensored(entry) || /uncensored/i.test(`${entry.id} ${entry.model || ''} ${entry.label || ''}`));
    return fuzzy?.id || null;
  }
  function findOpenRouterGodmode(connected = []) {
    const liveOr = (connected || []).filter(entry => entry?.available !== false && String(entry?.id || '').startsWith('openrouter:'));
    if (!liveOr.length) return null;
    const exact = liveOr.find(entry => entry.id === 'openrouter:nousresearch-hermes-4-405b' || entry.model === 'nousresearch/hermes-4-405b');
    if (exact) return exact.id;
    const fuzzy = liveOr.find(entry => /hermes[-_.\s]?4[-_.\s]?405b|venice[-_.\s]?edition|uncensored/i.test(`${entry.id} ${entry.model || ''} ${entry.label || ''}`));
    return fuzzy?.id || null;
  }
  function findGemini4Neon(connected = [], veniceConnectionId = null, models = []) {
    const isNeon = entry => /(?:gemini[-_.\s]?4(?:[._-]0)?[-_.\s]?neon|\bneon[-_.\s]?4\b)/i.test(`${entry?.id || ''} ${entry?.model || ''} ${entry?.label || ''}`);
    const liveMatch = (connected || []).find(entry => entry?.available !== false && isNeon(entry));
    if (liveMatch) return liveMatch.id;
    if (!veniceConnectionId) return null;
    const available = (models || []).filter(entry => entry?.id?.startsWith('venice-catalog:') && entry.available !== false);
    for (const exact of ['gemini-4-neon', 'google-gemini-4-neon', 'neon-4']) {
      const hit = available.find(entry => entry.id === 'venice-catalog:' + exact || entry.model === exact);
      if (hit) return hit.id;
    }
    const fuzzy = available.find(entry => isNeon(entry));
    return fuzzy?.id || null;
  }
  function recommendedBackup(models, primary) {
    const available = (models || []).filter(model => model.id?.startsWith('venice-catalog:') && model.id !== primary && model.available !== false);
    // Prefer Venice Uncensored and fast models already exercised in desktop workflows.
    // Only choose from the live catalog, and never enroll another provider account.
    for (const model of ['glm-5-3-flash-uncensored', 'deepseek-v4-1-flash-1017-uncensored', 'abliteration-abliterated-model-large-v2', 'venice-uncensored-1-2', 'venice-uncensored', 'z-ai-glm-5-3-flash', 'qwen-3-7-plus', 'deepseek-v4-1-flash-1017', 'deepseek-v4-1-flash']) {
      const match = available.find(entry => entry.id === 'venice-catalog:' + model);
      if (match) return match.id;
    }
    return available.find(model => /(?:uncensored|flash|mini|turbo)/i.test(model.model || model.id))?.id || available[0]?.id || null;
  }
  function initialChatRoute(connected, preferred, veniceConnectionId, backup, models = []) {
    if (preferred?.startsWith('venice-catalog:')) {
      if (!veniceConnectionId) return [];
      if (backup?.primary === preferred && backup.id === null) return [preferred];
      if (backup?.primary === preferred && backup.id?.startsWith('venice-catalog:') && backup.id !== preferred
        && (!models.length || models.some(model => model.id === backup.id))) return [preferred, backup.id];
      const automatic = recommendedBackup(models, preferred);
      return automatic ? [preferred, automatic] : [preferred];
    }
    const id = preferred || veniceConnectionId || connected[0]?.id;
    return connected.some(model => model.id === id) ? [id] : [];
  }
  function preferences() {
    try { const value = JSON.parse(localStorage.getItem('g0dc0d3.defaults') || '{}'); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; } catch { return {}; }
  }
  function validate(value) {
    if(!['adaptive','hybrid','switch_model','prompt_strategies','ask'].includes(value.mode))throw new Error('Choose a recovery behavior.');
    for(const [key,min,max] of [['maxAttempts',0,100],['maxCalls',1,5000],['requestTimeoutMs',10,900000],['maxNoProgressTurns',2,30]])if(!Number.isInteger(value[key]) || value[key]<min || value[key]>max)throw new Error(`${key} must be an integer from ${min} to ${max}.`);
    if(value.maxContinuations!==undefined && (!Number.isInteger(value.maxContinuations) || value.maxContinuations<0 || value.maxContinuations>12))throw new Error('maxContinuations must be an integer from 0 to 12.');
    if(!Array.isArray(value.strategies) || value.strategies.length>20 || value.strategies.some(item=>typeof item!=='string' || !item || item.length>1000))throw new Error('Use up to 20 approaches, each 1–1000 characters.');
    if(typeof value.returnToPrimary!=='boolean' || typeof value.learning!=='boolean' || (value.stickyOnRefusal!==undefined && typeof value.stickyOnRefusal!=='boolean') || (value.autoContinue!==undefined && typeof value.autoContinue!=='boolean'))throw new Error('Recovery switches must be on or off.');
    return value;
  }
  const milliseconds = seconds => Math.round(Number(seconds)*1000);
  function updatedPolicy(patch) {
    let saved = preferences().policy;
    try { if(!saved || typeof saved !== 'object' || Array.isArray(saved))saved={}; validate({...defaults,...saved}); } catch { saved={}; }
    const updated={...saved,...patch};
    validate({...defaults,...updated});
    return updated;
  }
  function policy(task, conversation = true) {
    const base={...defaults,...(!task && conversation ? {requestTimeoutMs:300000} : {})};
    try {return validate({...base,...(task ? task.policy : preferences().policy)});}catch{return base;}
  }
  function presentation(task, now = Date.now(), defaultRoute = []) {
    const value = policy(task), route = task?.providers || defaultRoute;
    const single = route.length === 1;
    const direct = (task?.providerId || route[0])?.startsWith('venice-catalog:');
    const locked = direct && route.length < 2;
    const switchMode = ['adaptive','hybrid','switch_model'].includes(value.mode);
    const enabled = value.mode !== 'ask' && value.maxAttempts > 0 && (!direct || (switchMode && !locked));
    const label = value.mode === 'adaptive' || value.mode === 'ask' ? 'G0DM0D3' : 'Custom recovery';
    let state = enabled ? 'ENABLED' : 'OFF', detail = enabled ? 'Recovery enabled' : 'Ask before retrying';
    if (direct) detail = locked ? 'Direct Venice chat · no outage backup selected' : enabled ? 'Venice outage backup ready' : 'Venice outage backup off';
    else if (enabled && single) detail = 'One model selected · no fallback';
    else if (enabled && switchMode && route.length > 1) detail = (route.length - 1) + (route.length === 2 ? ' fallback selected' : ' fallbacks selected');
    if (task) {
      const cancelled = task.status === 'cancelled';
      if (task.status === 'cancelled') detail = 'Cancelled';
      else if (task.status === 'completed') detail = task.recoveries ? `${task.recoveries} ${task.recoveries === 1 ? 'recovery attempt' : 'recovery attempts'}` : 'Ready for your next message';
      else if (['paused', 'waiting_input', 'blocked', 'failed', 'paused_budget'].includes(task.status)) {
        detail = task.status === 'paused' ? 'Paused' : task.blocker?.code === 'NO_ELIGIBLE_FALLBACK' ? 'No available fallback' : task.status === 'waiting_input' ? 'Waiting for you' : task.status === 'paused_budget' ? 'Call limit reached' : 'Stopped · needs attention';
      } else if (task.routing?.pendingRetry) {
        detail = `Retry scheduled · ${Math.max(0, Math.ceil((task.routing.pendingRetry.retryAt - now) / 1000))}s`;
      } else if (task.status === 'recovering') detail = `Recovery · attempt ${task.recoveries} of ${value.maxAttempts}`;
      else if (task.recoveries && task.status === 'running') detail = `Awaiting response · ${task.providerId}`;
      if (task.outcome && task.outcome.kind !== 'answered') detail = task.outcome.detail;
      else if (task.status === 'waiting_input' && task.blocker?.message) detail = task.blocker.message;
      if (['blocked','failed'].includes(task.status)) state = 'Stopped';
      if (!cancelled && (!task.outcome || task.outcome.kind === 'answered') && (task.calls >= value.maxCalls || (enabled && task.recoveries >= value.maxAttempts))) {
        if(enabled && state !== 'Stopped')state = 'Limit reached';
        // A final reserved request can still finish; exhausted budgets cannot promise another retry.
        if (!['running', 'recovering', 'verifying'].includes(task.status)) detail = task.status === 'completed' ? 'Increase limits for your next message' : 'Increase limits to continue';
      }
    }
    if (locked && (!task || ['queued','completed'].includes(task.status))) detail = 'Turn on to set up a Venice outage backup';
    return { label, state, detail, enabled, locked, policy: value };
  }
  return { defaults, findVeniceUncensored, findOpenRouterGodmode, findGemini4Neon, recommendedBackup, initialChatRoute, preferences, policy, presentation, validate, milliseconds, updatedPolicy, liberationMessage };
})();
