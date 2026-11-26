import { createVeniceCatalog, isCatalogModel, veniceEndpoint } from './venice-catalog.mjs';
import { parameterLimits, intersectParameterLimits } from './conversation-controls.mjs';
import http from 'node:http';
import { createPromptCommands, revisePromptCommand } from './prompt-commands.mjs';
import { WorktreeProjects } from './worktree-projects.mjs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Runtime } from './runtime.mjs';
import { evaluateTask } from './evaluator.mjs';
import { environmentProviders, HttpProvider } from './providers.mjs';
import { createProviderSettings, linuxSecretToolKeychain, nativeKeychain } from './provider-settings.mjs';
import { isSandboxSupportedPlatform } from './runner.mjs';
import { createCliConnections } from './provider-connections.mjs';
import { createSetup } from './setup.mjs';
import { loadProviderReferences } from './provider-references.mjs';
import { inspectPrompt, PERSONAS } from './prompts.mjs';
import { createGitPatch } from './patch-export.mjs';
import { TOOLS, scopedPath } from './broker.mjs';
import { createSession } from './session.mjs';
import { redactDiagnostics, environmentSecrets, classifyProviderZdr } from './privacy.mjs';
import { classifyModel, MODEL_SORT_MODES } from './model-groups.mjs';
import { createModelCatalog } from './model-catalog.mjs';
import { createServiceStatus } from './services.mjs';
import { displayReplyOutcome, taskOutcome, displayOutcomes } from './outcomes.mjs';
import { rankInitialProviders } from './routing.mjs';
import { createScriptedProviders, scriptedScenarios } from '../bench/scripted.mjs';
import { fixtures } from '../fixtures/index.mjs';
import { createConversationTask, createFixtureTask, createImportedTask, previewWorkspace, fileDiff } from './workspaces.mjs';
import { resolveWorkflow, listWorkflows, WORKFLOW_NAMES } from './workflows.mjs';
import { discoverSkills, saveUserSkill, deleteUserSkill } from './skills.mjs';
import { PERMISSION_PRESETS } from './permissions.mjs';
import { discoverHooks } from './hooks.mjs';
import { createPreviewRegistry } from './preview.mjs';
import { extractPdfText } from './web-fetch.mjs';
import { promptNeedsLiveTools } from './ultra-router.mjs';

const projectDir = fileURLToPath(new URL('../',import.meta.url));
const publicDir = path.join(projectDir,'public');
export const capabilities = ['Durable tasks and checkpointed adaptive model recovery','Brokered file, search, patch, history and command tools','Owner-configured project checks and snapshot-bound fixture evidence','Plinian and focused personas with native system instructions','Local outcome learning with inspect/reset controls','Scoped macOS Seatbelt and Linux bubblewrap (bwrap) command execution with explicit network grants'];
export const limitations = ['Local developer build: Node 22.13+ required; ad-hoc signed, not notarized.','Command execution requires macOS Seatbelt or Linux bubblewrap (bwrap) and an owner grant. Foreground command lifecycle on macOS is best effort; Linux uses PID namespaces (--die-with-parent).','Scripted tests validate controller behavior, not universal model performance.','Owner-configured checks establish only their recorded coverage; test success does not prove every requirement.','Provider capabilities vary. Context and project-copy bounds still apply.','Local raw task history may contain source or secrets; diagnostic export redaction is best-effort.'];

function outcomeFor(task,runtime) {
  if (runtime && task.status === 'completed' && task.completionKind === 'answered' && !task.replyOutcome) {
    return taskOutcome({...task, replyOutcome:displayReplyOutcome(runtime.store.latestModelResponse(task.id))});
  }
  return taskOutcome(task);
}
function publicTask(task,runtime) {
  const {initialSnapshot,approvedOnceCall,recentToolCalls,...rest} = task;
  return {...rest,pendingApproval:rest.pendingApproval||null,permissionRules:rest.permissionRules??null,todos:Array.isArray(rest.todos)?rest.todos:[],outcome:outcomeFor(task,runtime),crewBusy:Boolean(runtime?.crew.busy(task.id)),sourceBusy:Boolean(runtime?.sourceChanges.busy(task.id)),draining:!['running','recovering','verifying'].includes(task.status)&&Boolean(runtime?.runs.has(task.id)||runtime?.broker.locks.has(task.id))};
}
function taskSummary(task,runtime) {
  const {id,title,objective,status,providerId,providers,calls,recoveries,createdAt,updatedAt,completionKind,fixtureId,sourcePath,workspaceKind,planMode,parentTaskId}=task;
  return {id,title,objective,status,providerId,providers,calls,recoveries,createdAt,updatedAt,completionKind,fixtureId,sourcePath,workspaceKind,planMode:Boolean(planMode),parentTaskId:parentTaskId||null,pendingApproval:Boolean(task.pendingApproval),todoCount:Array.isArray(task.todos)?task.todos.length:0,outcome:outcomeFor(task,runtime)};
}
const DISPLAY_TEXT_KEYS = new Set(['text', 'message', 'thinking']);
function displayValue(value, depth = 0, key = '') {
  if (typeof value === 'string') {
    const limit = DISPLAY_TEXT_KEYS.has(key) ? 200000 : 32000;
    return value.length > limit ? value.slice(0, limit) + '\n[Display truncated; export the task for full evidence.]' : value;
  }
  if (depth > 12) return '[Display depth limit]';
  if (Array.isArray(value)) return value.slice(0, 100).map(item => displayValue(item, depth + 1, key));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, item]) => [k, displayValue(item, depth + 1, k)]));
  return value;
}
function send(res,status,value) {
  res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});
  res.end(JSON.stringify(value));
}
async function readBody(req, maxBytes = 65536) {
  if(!req.headers['content-type']?.startsWith('application/json')) throw Object.assign(new Error('Use application/json'),{status:415});
  const declaredLen = Number(req.headers['content-length']);
  if (Number.isFinite(declaredLen) && declaredLen > maxBytes) throw Object.assign(new Error('Request body too large'), { status: 413 });
  const chunks=[]; let size=0;
  for await(const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size+=buf.byteLength;
    if(size>maxBytes)throw Object.assign(new Error('Request body too large'),{status:413});
    chunks.push(buf);
  }
  const text = Buffer.concat(chunks, size).toString('utf8');
  try {const value=JSON.parse(text||'{}');if(!value||typeof value!=='object'||Array.isArray(value))throw new Error();return value;}
  catch {throw Object.assign(new Error('Expected a JSON object'),{status:400});}
}

export async function createApp({dataDir=process.env.G0D_DATA_DIR || path.join(projectDir,'.g0dc0d3'),providers,evaluator=evaluateTask,auth=true,keychain,fetchCatalog,fetchOpenRouterCatalog,fetchProviderCatalog,cliDiscovery={}}={}) {
  dataDir=path.resolve(dataDir);
  const configuredProviders = !providers;
  providers ||= new Map([...createScriptedProviders(),...environmentProviders()]);
  if (configuredProviders) await loadProviderReferences({dataDir,providers});
  const providerSettings = await createProviderSettings(providers, keychain, { dataDir, ...(fetchProviderCatalog ? { fetchImpl: fetchProviderCatalog } : {}) });
  const redact = value => redactDiagnostics(value, [...environmentSecrets(), ...providerSettings.secrets]);
  const cliConnections = await createCliConnections({...cliDiscovery,dataDir,providers});
  const modelCatalog = await createModelCatalog({dataDir, ...(fetchOpenRouterCatalog ? { fetchImpl: fetchOpenRouterCatalog } : {})});
  const catalog = createVeniceCatalog(providers, fetchCatalog, () => runtime.getPrivacy().settings);
  const runtime = new Runtime({dataDir,providers,evaluator,catalog,
    outboundSecrets: () => [...environmentSecrets(), ...providerSettings.secrets]});
  const serviceStatus = createServiceStatus({providers,cliConnections,getPrivacy:()=>runtime.getPrivacy().settings});
  const promptCommands = createPromptCommands(runtime.store);
  const setup = createSetup(runtime.store);
  const worktrees = new WorktreeProjects(runtime.store, { get: id => providers.get(id) ?? catalog.get(id) },
    { outboundOptions: () => runtime.outboundOptions() });
  runtime.worktrees = worktrees;
  const previews = createPreviewRegistry(runtime);
  async function loadSelected(ids) {
    if (Array.isArray(ids) && ids.some(id => isCatalogModel(id) || providers.get(id)?.baseUrl === veniceEndpoint)) await catalog.list();
  }
  const session = createSession(auth);
  const sessionFailTimestamps = [];
  let baseUrl;
  let benchmark = {status:'idle',report:null}, benchmarkPromise = null;
  const benchmarkFile=path.join(dataDir,'latest-benchmark.json');
  try {benchmark={status:'completed',report:JSON.parse(await fs.readFile(benchmarkFile,'utf8'))};}catch{}
  let closing=false, closePromise;
  const sseClients = new Set();
  const run = id => { runtime.run(id).catch(error=>process.stderr.write(`Task ${id}: ${error.message}\n`)); };
  const server=http.createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Cross-Origin-Opener-Policy','same-origin');
    res.setHeader('Cross-Origin-Resource-Policy','same-origin');
    res.setHeader('X-Permitted-Cross-Domain-Policies','none');
    res.setHeader('Permissions-Policy','camera=(), geolocation=(), payment=(), usb=(), bluetooth=(), display-capture=(), microphone=(self)');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; media-src blob:; frame-src 'self' blob:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    try {
      if(closing)return send(res,503,{error:'Application is stopping'});
      const address=server.address();
      if(!address)return send(res,503,{error:'Application is stopping'});
      const expectedHost=`127.0.0.1:${address.port}`;
      const hosts=new Set([expectedHost,`localhost:${address.port}`]);
      if(!hosts.has(req.headers.host))return send(res,403,{error:'Unexpected Host header'});
      const url=new URL(req.url,`http://${expectedHost}`);
      const isPreviewGet = req.method === 'GET' && url.pathname.startsWith('/preview/');
      const origin=req.headers.origin;
      if(origin && !(isPreviewGet && origin === 'null') && ![...hosts].some(host=>origin===`http://${host}`))return send(res,403,{error:'Cross-origin access denied'});
      const mutation=['POST','PATCH','PUT','DELETE'].includes(req.method);
      if(mutation && req.headers['x-g0d-request']!=='1')return send(res,403,{error:'Missing local application request header'});
      if (isPreviewGet) {
        const pm = url.pathname.match(/^\/preview\/([a-f0-9]{32})(?:\/(.*))?$/);
        if (!pm) return send(res, 404, { error: 'Unknown preview route.' });
        return await previews.serve(pm[1], pm[2] || '', res);
      }
      if(req.method==='GET' && url.pathname==='/api/health')return send(res,200,{app:'g0dc0d3',version:'0.2.0',authRequired:auth,desktopWorktrees:true,chatWorktrees:true,patchRequestPreview:true,veniceCatalog:true});
      if(req.method==='POST' && url.pathname==='/api/session') {
        const now = Date.now();
        while (sessionFailTimestamps.length && now - sessionFailTimestamps[0] > 60000) sessionFailTimestamps.shift();
        if (sessionFailTimestamps.length >= 10) {
          res.setHeader('Retry-After', '60');
          return send(res, 429, { error: 'Too many invalid session attempts; wait 60 seconds and retry.' });
        }
        const body=await readBody(req);
        if (session.exchange(body.token,res)) {
          sessionFailTimestamps.length = 0;
          return send(res,200,{authenticated:true});
        }
        sessionFailTimestamps.push(now);
        return send(res,401,{error:'Invalid local session'});
      }
      if(url.pathname.startsWith('/api/') && !session.accepts(req))return send(res,401,{error:'Open the private launch link printed by this runtime, or use the native app.',code:'SESSION_REQUIRED'});
      const handoff = url.pathname.match(/^\/api\/conversations\/([^/]+)\/(repository|build-intent)$/);
      if (handoff && req.method === 'POST') {
        const [, id, action] = handoff, body = await readBody(req);
        if (action === 'repository') return send(res, 200, await worktrees.attach(id, body.repository));
        const task = worktrees.buildIntent(id, body.message, body.messageId);
        return send(res, 200, { task: publicTask(task, runtime) });
      }
      if(url.pathname === '/api/worktrees') {
        if(req.method==='GET') {
          const discovered = await catalog.list();
          const connected = [...providers.values()].filter(p=>p.protocol==='openai-chat' && p.available!==false && p.proposePatch).map(p=>({id:p.id,label:p.label}));
          return send(res,200,{projects:worktrees.list(), models:[...connected,...discovered.models], catalogWarning:discovered.warning});
        }
        if(req.method==='POST') return send(res,201,await worktrees.create((await readBody(req)).repository));
      }
      const treeRoute=url.pathname.match(/^\/api\/worktrees\/([a-f0-9-]+)(?:\/(file|build-preview|build|progress|stop-waiting|apply|check|remove))?$/);
      if(treeRoute) {
        const [,id,action]=treeRoute;
        if(req.method==='GET' && !action) return send(res,200,await worktrees.inspect(id));
        if(req.method==='GET' && action==='file') return send(res,200,await worktrees.file(id,url.searchParams.get('path')));
        if(req.method==='GET' && action==='progress') return send(res,200,worktrees.progress(id,url.searchParams.get('after')));
        if(req.method==='POST' && (action==='build-preview' || action==='build')) {
          const body = await readBody(req);
          await loadSelected(body.providerIds);
          return send(res,200,await (action==='build' ? worktrees.build(id,body) : worktrees.preview(id,body)));
        }
        if(req.method==='POST' && action==='stop-waiting') return send(res,200,worktrees.stopWaiting(id,(await readBody(req)).buildId));
        if(req.method==='POST' && action==='apply') return send(res,200,await worktrees.apply(id,(await readBody(req)).candidateId));
        if(req.method==='POST' && action==='remove') return send(res,200,await worktrees.remove(id));
        if(req.method==='POST' && action==='check') return send(res,200,await worktrees.check(id,await readBody(req)));
      }
      if (url.pathname === '/api/prompt-commands') {
        if (req.method === 'GET') return send(res,200,{commands:promptCommands.list(),revision:promptCommands.revision});
        if (req.method === 'PUT' || req.method === 'DELETE') {
          const commands = promptCommands.change(await readBody(req),req.method === 'DELETE');
          return send(res,200,{commands,revision:promptCommands.revision});
        }
      }
      if (req.method === 'POST' && url.pathname === '/api/prompt-commands/revise')
        return send(res,200,await revisePromptCommand(providers,await readBody(req),runtime.outboundOptions()));
      if(req.method==='GET' && url.pathname==='/api/state') {
        const sortBy = url.searchParams.get('sort') || null;
        const learning = runtime.getLearning();
        return send(res,200,{
        setup:setup.state(),
        promptCommandRevision:promptCommands.revision,
        veniceConnectionId:[...providers.values()].find(provider=>provider.baseUrl===veniceEndpoint && provider.available && !provider.closed)?.id || null,
        openrouterConnectionId:[...providers.values()].find(provider=>provider.baseUrl==='https://openrouter.ai/api/v1' && provider.available && !provider.closed)?.id || null,
        connectedApiProviders:providerSettings.connectedProfiles(),
        tasks:runtime.listTasks().map(task=>taskSummary(task,runtime)),providers:[...providers.values()].map(provider=>({id:provider.id,label:provider.label,model:provider.model||null,kind:provider.kind,available:provider.available??true,accounting:provider.accounting,tier:provider.tier||'standard',zdr:classifyProviderZdr(provider),meta:classifyModel(provider,{catalog:modelCatalog,learning})})),
        fixtures:fixtures.map(({id,title,description,objective})=>({id,title,description,objective})),scenarios:scriptedScenarios,benchmark,version:'0.2.0',capabilities,limitations,personas:PERSONAS,tools:TOOLS.map(({name,description,parameters,result})=>({name,description,parameters,resultSchema:result})),executionAvailable:isSandboxSupportedPlatform(),sessionProtected:auth,workflows:listWorkflows(),permissions:runtime.getGlobalPermissions(),privacy:runtime.getPrivacy(),overseer:runtime.getOverseer(),router:runtime.getRouterSettings(),modelGroups:runtime.getModelGroups({sortBy,catalog:modelCatalog}),sortModes:MODEL_SORT_MODES,catalogMeta:modelCatalog.meta()
      });
      }
      if(req.method==='GET' && url.pathname==='/api/browser/settings')return send(res,200,await runtime.getBrowserInfo());
      if(req.method==='PATCH' && url.pathname==='/api/browser/settings') {
        const body = await readBody(req);
        runtime.updateBrowserSettings(body);
        return send(res,200,await runtime.getBrowserInfo());
      }
      if(req.method==='GET' && url.pathname==='/api/overseer')return send(res,200,runtime.getOverseer());
      if(req.method==='PATCH' && url.pathname==='/api/overseer')return send(res,200,runtime.updateOverseer(await readBody(req)));
      if(req.method==='GET' && url.pathname==='/api/router')return send(res,200,await runtime.getRouterState());
      if(req.method==='PATCH' && url.pathname==='/api/router') {
        runtime.updateRouterSettings(await readBody(req));
        return send(res,200,await runtime.getRouterState());
      }
      if(req.method==='POST' && url.pathname==='/api/router/preview')return send(res,200,await runtime.previewUltraRoute(await readBody(req)));
      if(req.method==='POST' && url.pathname==='/api/metacognition/forge')return send(res,200,await runtime.forgeMetapromptPreview(await readBody(req)));
      if(req.method==='GET' && url.pathname==='/api/conclave/roster')return send(res,200,await runtime.getConclaveRoster());
      if(req.method==='POST' && url.pathname==='/api/conclave/roster')return send(res,201,await runtime.saveConclaveAgent(await readBody(req)));
      if(req.method==='POST' && url.pathname==='/api/conclave/stats/preview')return send(res,200,await runtime.previewConclaveStats(await readBody(req)));
      const rosterDelMatch = req.method === 'DELETE' && url.pathname.match(/^\/api\/conclave\/roster\/([^/]+)$/);
      if (rosterDelMatch) return send(res, 200, await runtime.deleteConclaveAgent(decodeURIComponent(rosterDelMatch[1])));
      if(req.method==='GET' && url.pathname==='/api/conclave/formations')return send(res,200,{formations:runtime.getConclaveFormations()});
      if(req.method==='POST' && url.pathname==='/api/conclave/formations')return send(res,201,runtime.saveConclaveFormation(await readBody(req)));
      const formDelMatch = req.method === 'DELETE' && url.pathname.match(/^\/api\/conclave\/formations\/([^/]+)$/);
      if (formDelMatch) return send(res, 200, runtime.deleteConclaveFormation(decodeURIComponent(formDelMatch[1])));
      if(req.method==='DELETE' && url.pathname==='/api/router/reset') {
        await readBody(req).catch(()=>({}));
        runtime.resetRouter();
        return send(res,200,await runtime.getRouterState());
      }
      if(req.method==='POST' && url.pathname==='/api/models/feedback') {
        const body = await readBody(req);
        const pref = runtime.setModelPreference(body.providerId, body.signal, body.domain || null);
        return send(res,200,{...pref,groups:runtime.getModelGroups({catalog:modelCatalog}),overseer:runtime.getOverseer(),router:runtime.getRouterSettings()});
      }
      if(req.method==='DELETE' && url.pathname==='/api/learning/patterns') {
        const body = await readBody(req);
        return send(res,200,{...runtime.deleteRefusalPattern(body.signature || null),overseer:runtime.getOverseer()});
      }
      if(req.method==='GET' && url.pathname==='/api/models/groups') {
        const sortBy = url.searchParams.get('sort') || null;
        return send(res,200,{groups:runtime.getModelGroups({sortBy,catalog:modelCatalog}),sortModes:MODEL_SORT_MODES,catalog:modelCatalog.meta()});
      }
      if(req.method==='POST' && url.pathname==='/api/models/catalog/refresh') {
        await readBody(req);
        const result = await modelCatalog.refresh({
          privacy: runtime.getPrivacy().settings,
          onOutbound: entry => runtime.outboundAudit.record(entry)
        });
        return send(res,200,{...result,catalog:modelCatalog.meta(),groups:runtime.getModelGroups({catalog:modelCatalog})});
      }
      if(req.method==='GET' && url.pathname==='/api/services') {
        return send(res,200,await serviceStatus.status({refresh:url.searchParams.get('refresh')==='1'}));
      }
      if(req.method==='GET' && url.pathname==='/api/privacy')return send(res,200,runtime.getPrivacy());
      if(req.method==='PATCH' && url.pathname==='/api/privacy')return send(res,200,runtime.updatePrivacy(await readBody(req)));
      if(req.method==='DELETE' && url.pathname==='/api/privacy/audit'){await readBody(req);return send(res,200,runtime.clearOutboundAudit());}
      if(req.method==='POST' && url.pathname==='/api/privacy/burn')return send(res,200,await runtime.burnSession(await readBody(req)));
      if(req.method==='GET' && url.pathname==='/api/transparency')return send(res,200,runtime.getTransparency(url.searchParams.get('taskId')||null));
      if(req.method==='PATCH' && url.pathname==='/api/transparency'){const body=await readBody(req);return send(res,200,runtime.updateTransparency(body,url.searchParams.get('taskId')||body?.taskId||null));}
      if(req.method==='POST' && url.pathname==='/api/transparency/reset'){const body=await readBody(req);return send(res,200,runtime.resetTransparency({...body,taskId:url.searchParams.get('taskId')||body?.taskId||null}));}
      if(req.method==='GET' && url.pathname==='/api/workflows')return send(res,200,{workflows:listWorkflows()});
      if(req.method==='POST' && url.pathname==='/api/preview/session') {
        const body=await readBody(req, 1200 * 1024);
        return send(res,201,await previews.createSession(body));
      }
      if(req.method==='POST' && url.pathname==='/api/attachments/extract') {
        const body=await readBody(req, 8 * 1024 * 1024);
        if(typeof body.dataBase64!=='string'||!body.dataBase64.trim())throw Object.assign(new Error('Provide base64 file data.'),{status:400,code:'INVALID_ATTACHMENT'});
        const raw=Buffer.from(body.dataBase64,'base64');
        const extracted=extractPdfText(raw);
        return send(res,200,{...extracted,name:String(body.name||'document.pdf').slice(0,120)});
      }
      if(req.method==='GET' && url.pathname==='/api/hooks') {
        const taskId=url.searchParams.get('taskId');
        const task=taskId?runtime.getTask(taskId):null;
        return send(res,200,{hooks:await discoverHooks(task)});
      }
      if(req.method==='GET' && url.pathname==='/api/permissions')return send(res,200,runtime.getGlobalPermissions());
      if(req.method==='PATCH' && url.pathname==='/api/permissions') {
        const body=await readBody(req);
        let rules=body.rules;
        if(body.preset!==undefined) {
          if(typeof body.preset!=='string'||!Object.hasOwn(PERMISSION_PRESETS,body.preset))throw Object.assign(new Error('Unknown permission preset.'),{status:400,code:'INVALID_PERMISSION_RULE'});
          rules=[...PERMISSION_PRESETS[body.preset]];
        }
        return send(res,200,runtime.updateGlobalPermissions(rules));
      }
      if(req.method==='GET' && url.pathname==='/api/memory') {
        const q=url.searchParams.get('q')||'';
        const rawScope=url.searchParams.get('scope');
        const taskId=url.searchParams.get('taskId');
        const rawLimit=url.searchParams.get('limit');
        const limit=rawLimit!==null?Number(rawLimit):undefined;
        let projectScope=null;
        if(taskId) {
          const task=runtime.getTask(taskId);
          projectScope=`project:${task.sourcePath||task.workspace}`;
        }
        let scope=null, includeGlobal=true;
        if(rawScope==='global') { scope='global'; includeGlobal=false; }
        else if(rawScope==='project') { scope=projectScope||'global'; includeGlobal=false; }
        else if(rawScope&&rawScope.startsWith('project:')) { scope=rawScope; includeGlobal=false; }
        else if(projectScope) { scope=projectScope; includeGlobal=true; }
        const result=(q.trim()||projectScope)
          ? runtime.memory.searchMemories({query:q,scope,includeGlobal,limit:limit||20})
          : runtime.memory.listMemories({scope,limit:limit||50});
        return send(res,200,{...result,memoryFile:runtime.memory.memoryFile});
      }
      if(req.method==='POST' && url.pathname==='/api/memory') {
        const body=await readBody(req);
        let scope=body.scope||'global';
        if(scope==='project') {
          if(typeof body.taskId!=='string'||!body.taskId)throw Object.assign(new Error('Provide taskId or an explicit "project:<path>" scope.'),{status:400,code:'INVALID_MEMORY'});
          const task=runtime.getTask(body.taskId);
          scope=`project:${task.sourcePath||task.workspace}`;
        }
        const result=runtime.memory.saveMemory({title:body.title,content:body.content,scope,tags:body.tags});
        return send(res,201,result);
      }
      const memoryDeleteMatch=url.pathname.match(/^\/api\/memory\/([^/]+)$/);
      if(memoryDeleteMatch && req.method==='DELETE') {
        const result=runtime.memory.deleteMemory(decodeURIComponent(memoryDeleteMatch[1]));
        if(!result.deleted)return send(res,404,{error:'Memory not found',code:'MEMORY_NOT_FOUND'});
        return send(res,200,result);
      }
      if(req.method==='GET' && url.pathname==='/api/skills') {
        const taskId=url.searchParams.get('taskId');
        let workspace, sourcePath;
        if(taskId) {
          const task=runtime.getTask(taskId);
          workspace=task.workspace;
          sourcePath=task.sourcePath;
        }
        const skills=await discoverSkills({dataDir,workspace,sourcePath});
        return send(res,200,{ok:true,skills});
      }
      if(req.method==='POST' && url.pathname==='/api/skills') {
        const body=await readBody(req);
        const skill=await saveUserSkill(dataDir,{name:body.name,description:body.description,body:body.body,mode:body.mode});
        return send(res,201,{ok:true,skill});
      }
      const skillDeleteMatch=url.pathname.match(/^\/api\/skills\/([^/]+)$/);
      if(skillDeleteMatch && req.method==='DELETE') {
        const result=await deleteUserSkill(dataDir,decodeURIComponent(skillDeleteMatch[1]));
        if(!result.deleted)return send(res,404,{error:'Skill not found',code:'SKILL_NOT_FOUND'});
        return send(res,200,result);
      }
      if(req.method==='GET' && url.pathname==='/api/learning')return send(res,200,runtime.getLearning());
      if(req.method==='GET' && url.pathname==='/api/providers/venice-models') {
        if (providerSettings.isProviderDisabled('venice')) {
          return send(res, 200, { connected: false, disabled: true, models: [], fetchedAt: null, stale: false, warning: '' });
        }
        return send(res,200,await catalog.list(url.searchParams.get('refresh')==='1'));
      }
      if(req.method==='GET' && url.pathname==='/api/providers/openrouter-models') {
        if (providerSettings.isProviderDisabled('openrouter')) {
          return send(res, 200, { connected: false, disabled: true, models: [], registered: [], count: 0, fetchedAt: null, stale: false, warning: '' });
        }
        const openrouterEndpoint = 'https://openrouter.ai/api/v1';
        const connectedProviders = [...providers.values()].filter(p => p.baseUrl === openrouterEndpoint && p.available !== false && !p.closed);
        const connected = connectedProviders.length > 0 || Boolean(process.env.OPENROUTER_API_KEY);
        if (!connected) {
          return send(res, 200, { connected: false, models: [], registered: [], count: 0, fetchedAt: null, stale: false, warning: '' });
        }
        const refreshed = await modelCatalog.ensureFresh({
          privacy: runtime.getPrivacy().settings,
          onOutbound: entry => runtime.outboundAudit.record(entry),
          force: url.searchParams.get('refresh') === '1'
        });
        const registeredSet = new Set(connectedProviders.map(p => p.model).filter(Boolean));
        const seen = new Set();
        const models = [];
        const addEntry = (entry) => {
          if (!entry?.id || seen.has(entry.id)) return;
          seen.add(entry.id);
          const id = 'openrouter:' + entry.id.replaceAll('/', '-');
          const displayName = entry.name || entry.id;
          const label = `${displayName} · OpenRouter`;
          const pseudoProvider = { id, model: entry.id, label, baseUrl: openrouterEndpoint, kind: 'http' };
          models.push({
            id,
            model: entry.id,
            name: displayName,
            label,
            contextWindow: entry.contextWindow ?? null,
            maxOutput: entry.maxOutput ?? null,
            pricing: entry.pricing ?? null,
            supportsTools: Boolean(entry.supportsTools),
            supportsReasoning: Boolean(entry.supportsReasoning),
            registered: registeredSet.has(entry.id),
            meta: classifyModel(pseudoProvider, { catalog: modelCatalog })
          });
        };
        for (const entry of refreshed.entries) addEntry(entry);
        // Ensure already-registered OpenRouter models always appear even if offline/unlisted.
        for (const p of connectedProviders) {
          if (p.model && !seen.has(p.model)) addEntry({ id: p.model, name: p.model });
        }
        return send(res, 200, {
          connected: true,
          models,
          registered: [...registeredSet],
          count: models.length,
          fetchedAt: refreshed.updatedAt,
          stale: refreshed.stale,
          warning: refreshed.warning
        });
      }
      if(req.method==='GET' && url.pathname==='/api/providers/catalog') {
        const provider = (url.searchParams.get('provider') || '').trim().toLowerCase();
        const result = await providerSettings.listLiveModels(provider, {
          privacy: runtime.getPrivacy().settings,
          onOutbound: entry => runtime.outboundAudit.record(entry),
          force: url.searchParams.get('refresh') === '1',
        });
        const models = (result.models || []).map(entry => {
          const id = `${result.provider}:${entry.id.replaceAll('/', '-')}`;
          const label = `${entry.name || entry.id} · ${result.label}`;
          const pseudoProvider = { id, model: entry.id, label, baseUrl: result.endpoint, protocol: result.protocol, kind: 'http' };
          return {
            id,
            model: entry.id,
            name: entry.name || entry.id,
            label,
            registered: Boolean(entry.registered),
            curated: Boolean(entry.curated),
            source: entry.source || 'live',
            meta: classifyModel(pseudoProvider, { catalog: modelCatalog }),
          };
        });
        return send(res, 200, {
          connected: result.connected,
          disabled: Boolean(result.disabled),
          provider: result.provider,
          label: result.label,
          models,
          registered: result.registered || [],
          count: models.length,
          fetchedAt: result.fetchedAt,
          stale: result.stale,
          warning: result.warning,
        });
      }
      if(req.method==='GET' && url.pathname==='/api/providers/parameters') {
        const ids=[...new Set((url.searchParams.get('ids') || '').split(',').filter(Boolean))];
        if(!ids.length || ids.length>10) return send(res,400,{error:'Choose one to ten models.'});
        const discovered=await catalog.list(url.searchParams.get('refresh')==='1');
        const selected=ids.map(id=>providers.get(id) || catalog.get(id));
        if(selected.some(provider=>!provider))return send(res,400,{error:'A selected model is unavailable. Refresh the model list.'});
        const models=selected.map(parameterLimits);
        return send(res,200,{models,fields:intersectParameterLimits(models),fetchedAt:discovered.fetchedAt,stale:discovered.stale,warning:discovered.warning});
      }
      if(req.method==='GET' && url.pathname==='/api/setup')return send(res,200,{setup:setup.state(),...await cliConnections.status({refresh:url.searchParams.get('refresh')==='1'})});
      if(req.method==='POST' && url.pathname==='/api/setup')return send(res,200,{setup:setup.acknowledge(await readBody(req))});
      if(req.method==='GET' && url.pathname==='/api/providers/connections')return send(res,200,await cliConnections.status({refresh:url.searchParams.get('refresh')==='1'}));
      if(req.method==='POST' && url.pathname==='/api/providers/connections')return send(res,200,await cliConnections.connect(await readBody(req)));
      if(req.method==='PATCH' && url.pathname==='/api/providers/connections')return send(res,200,await cliConnections.updateSettings(await readBody(req)));
      if(req.method==='DELETE' && url.pathname==='/api/providers/connections')return send(res,200,await cliConnections.disconnect(await readBody(req)));
      if(req.method==='POST' && url.pathname==='/api/providers/key') {
        const result = await providerSettings.connect(await readBody(req));
        return send(res,200,{...result,connectedApiProviders:providerSettings.connectedProfiles(),providers:[...providers.values()].map(({id,label,kind,available=true,tier='standard'})=>({id,label,kind,available,tier}))});
      }
      if(req.method==='PATCH' && url.pathname==='/api/providers/profile') {
        const result = await providerSettings.setProviderEnabled(await readBody(req));
        return send(res,200,{
          ...result,
          connectedApiProviders:providerSettings.connectedProfiles(),
          veniceConnectionId:[...providers.values()].find(provider=>provider.baseUrl===veniceEndpoint && provider.available && !provider.closed)?.id || null,
          openrouterConnectionId:[...providers.values()].find(provider=>provider.baseUrl==='https://openrouter.ai/api/v1' && provider.available && !provider.closed)?.id || null,
          providers:[...providers.values()].map(({id,label,kind,available=true,tier='standard'})=>({id,label,kind,available,tier}))
        });
      }
      if(req.method==='POST' && url.pathname==='/api/providers/models') {
        const result = await providerSettings.addModels(await readBody(req));
        return send(res,200,{...result,connectedApiProviders:providerSettings.connectedProfiles(),providers:[...providers.values()].map(({id,label,kind,available=true,tier='standard'})=>({id,label,kind,available,tier}))});
      }
      if(req.method==='DELETE' && url.pathname==='/api/providers/models') {
        const result = await providerSettings.removeModels(await readBody(req));
        return send(res,200,{...result,connectedApiProviders:providerSettings.connectedProfiles(),providers:[...providers.values()].map(({id,label,kind,available=true,tier='standard'})=>({id,label,kind,available,tier}))});
      }
      if(req.method==='POST' && url.pathname==='/api/providers/local') {
        const body=await readBody(req);
        const rawBaseUrl=body.baseUrl===undefined||body.baseUrl===''?'http://127.0.0.1:11434/v1':body.baseUrl;
        if(typeof rawBaseUrl!=='string'||rawBaseUrl.length>512||/[\x00-\x1f\x7f]/.test(rawBaseUrl))
          throw Object.assign(new Error('Provide a valid http:// or https:// baseUrl.'),{status:400});
        const baseUrlStr=rawBaseUrl.trim()||'http://127.0.0.1:11434/v1';
        let parsedUrl;
        try { parsedUrl=new URL(baseUrlStr); } catch { throw Object.assign(new Error('Provide a valid http:// or https:// baseUrl.'),{status:400}); }
        if(!['http:','https:'].includes(parsedUrl.protocol))
          throw Object.assign(new Error('baseUrl must use http:// or https://.'),{status:400});
        const model=typeof body.model==='string'?body.model.trim():'';
        if(!model||model.length>200||/[\x00-\x1f\x7f]/.test(model))
          throw Object.assign(new Error('Provide a valid non-empty model name.'),{status:400});
        let label=body.label;
        if(label!==undefined&&label!==null&&label!=='') {
          if(typeof label!=='string'||label.trim().length>120||/[\x00-\x1f\x7f]/.test(label))
            throw Object.assign(new Error('Label must be a short string without control characters.'),{status:400});
          label=label.trim();
        } else {
          label=`${model} · Local`;
        }
        const tier=body.tier===undefined||body.tier===''?'local':body.tier;
        if(typeof tier!=='string'||!['local','standard','frontier'].includes(tier))
          throw Object.assign(new Error('Tier must be local, standard, or frontier.'),{status:400});
        const slug=model.toLowerCase().replace(/[^a-z0-9._-]+/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'')||'model';
        const id=`local:${slug}`;
        const localCount=[...providers.keys()].filter(k=>k.startsWith('local:')).length;
        if(!providers.has(id)&&localCount>=32)throw Object.assign(new Error('At most 32 dynamic local models can be registered per session.'),{status:400});
        const p=new HttpProvider({id,label,protocol:'openai-chat',baseUrl:baseUrlStr,model,apiKeyEnv:undefined,tier,allowPrivateHttp:true,timeoutMs:180000,maxOutputTokens:8192,maxOutputTokensCeiling:32768});
        providers.set(id,p);
        return send(res,200,{id,registered:[id],provider:{id:p.id,label:p.label,kind:p.kind,available:p.available,tier:p.tier},providers:[...providers.values()].map(({id:pid,label:plabel,kind,available=true,accounting,tier:ptier='standard'})=>({id:pid,label:plabel,kind,available,accounting,tier:ptier}))});
      }
      if(req.method==='DELETE' && url.pathname==='/api/learning'){await readBody(req);return send(res,200,runtime.resetLearning());}
      if(req.method==='POST' && url.pathname==='/api/conversations') {
        const body=await readBody(req, 12 * 1024 * 1024);
        const workflowName = body.workflow || null;
        if(body.workflow) {
          const preset=resolveWorkflow(body.workflow);
          if(!preset)throw Object.assign(new Error(`Unknown workflow: ${body.workflow}. Available: ${WORKFLOW_NAMES.join(', ')}`),{status:400});
          if(!body.policy)body.policy=preset.policy; else body.policy={...preset.policy,...body.policy};
          if(!body.persona)body.persona=preset.persona;
          delete body.workflow;
        }
        const routerSettings = runtime.getRouterSettings();
        const useAutoRouter = !body.answerRace && (routerSettings.mode === 'auto_route' || routerSettings.mode === 'auto_arena');
        let routingReceipt = null;
        if (useAutoRouter && typeof body.objective === 'string' && body.objective.trim()) {
          await catalog.list().catch(() => {});
          const decision = await runtime.previewUltraRoute({ objective: body.objective, attachments: body.attachments, workspaceKind: 'conversation' });
          if (decision.selectedId) {
            routingReceipt = decision;
            body.ultraplinian = true;
            const raceContenders = decision.arenaModels || decision.arenaPair;
            if (routerSettings.mode === 'auto_arena' && Array.isArray(raceContenders) && raceContenders.length >= 2 && decision.judgeId && !promptNeedsLiveTools(body.objective)) {
              body.answerRace = { models: raceContenders, judge: decision.judgeId };
              const leadIsCat = isCatalogModel(raceContenders[0]);
              const compat = decision.waterfallIds.filter(id => isCatalogModel(id) === leadIsCat);
              body.providerIds = leadIsCat ? compat.slice(0, 2) : compat.slice(0, 8);
              if (!body.providerIds.length) body.providerIds = [raceContenders[0]];
            } else {
              // Ensure homogeneous route compatibility (catalog models stay with catalog models; connected providers stay with connected providers)
              const primaryIsCat = isCatalogModel(decision.selectedId);
              const compatible = decision.waterfallIds.filter(id => isCatalogModel(id) === primaryIsCat);
              if (compatible.length) body.providerIds = primaryIsCat ? compatible.slice(0, 2) : compatible.slice(0, 8);
            }
          }
        }
        if(!routingReceipt && body.providerIds && body.providerIds.length > 1) {
          const learning = runtime.getLearning();
          body.providerIds = rankInitialProviders(body.providerIds, providers, learning);
        }
        if (body.answerRace) await catalog.list();
        await loadSelected(body.providerIds);
        const task=await createConversationTask(runtime,dataDir,body);
        if (workflowName) runtime.store.updateTask(task.id, current => { current.workflow = workflowName; return current; }, 'workflow.applied', { workflow: workflowName });
        if (routingReceipt) {
          const metacognition = await runtime.resolveTaskMetacognition({
            objective: body.objective,
            decision: routingReceipt,
            providerId: routingReceipt.selectedId,
            effort: body.effort || 'medium',
            workspaceKind: 'conversation',
            attachments: body.attachments || []
          }).catch(() => null);
          runtime.store.updateTask(task.id, current => {
            current.routing ||= {};
            current.routing.domain = routingReceipt.domain;
            if (metacognition) current.routing.metacognition = metacognition;
            current.routing.ultraDecision = {
              mode: routingReceipt.mode,
              domain: routingReceipt.domain,
              domainLabel: routingReceipt.domainLabel,
              refusalRisk: routingReceipt.refusalRisk,
              selected: routingReceipt.selected,
              runnerUps: routingReceipt.ranked.slice(1, 4),
              summary: routingReceipt.summary,
              ...(metacognition ? { metacognition } : {})
            };
            return current;
          }, 'router.selected', {
            mode: routingReceipt.mode,
            domain: routingReceipt.domain,
            domainLabel: routingReceipt.domainLabel,
            refusalRisk: routingReceipt.refusalRisk,
            selectedId: routingReceipt.selectedId,
            selected: routingReceipt.selected,
            runnerUps: routingReceipt.ranked.slice(1, 4),
            summary: routingReceipt.summary,
            ...(metacognition ? { metacognition } : {})
          });
        }
        return send(res,201,{task:publicTask(runtime.getTask(task.id),runtime)});
      }
      if(req.method==='POST' && url.pathname==='/api/tasks') {
        const body=await readBody(req);
        const workflowName=body.workflow||null;
        if(body.workflow) {
          const preset=resolveWorkflow(body.workflow);
          if(!preset)throw Object.assign(new Error(`Unknown workflow: ${body.workflow}. Available: ${WORKFLOW_NAMES.join(', ')}`),{status:400});
          if(!body.policy)body.policy=preset.policy; else body.policy={...preset.policy,...body.policy};
          if(!body.execution)body.execution=preset.execution; else body.execution={...preset.execution,...body.execution};
          if(!body.persona)body.persona=preset.persona;
          delete body.workflow;
        }
        // fixture objective restriction removed — owner override for ultra-plinian testing
        if(body.scenario && !scriptedScenarios.includes(body.scenario))throw Object.assign(new Error('Unknown scripted scenario'),{status:400});
        if(body.providerIds && body.providerIds.length > 1) {
          const learning = runtime.getLearning();
          body.providerIds = rankInitialProviders(body.providerIds, providers, learning);
        }
        if(body.ultraplinian) body.ultraplinian = true;
        const task=body.sourcePath?await createImportedTask(runtime,dataDir,body):await createFixtureTask(runtime,dataDir,body);
        if(workflowName)runtime.store.updateTask(task.id,current=>{current.workflow=workflowName;return current;},'workflow.applied',{workflow:workflowName});
        if(body.autoRun !== false) run(task.id);
        return send(res,201,{task:publicTask(task,runtime)});
      }
      if(req.method==='POST' && url.pathname==='/api/tasks/race') {
        const body=await readBody(req);
        const parsedRacers = Number.isInteger(body.racers) ? body.racers : Number.parseInt(body.racers, 10);
        const racers = Math.max(2, Math.min(8, Number.isFinite(parsedRacers) && parsedRacers > 0 ? parsedRacers : 3));
        const allIds = body.providerIds !== undefined ? body.providerIds : [...providers.keys()].filter(id=>id.startsWith('openrouter:'));
        if(!Array.isArray(allIds) || allIds.length < 2) throw Object.assign(new Error('Race needs at least 2 providers'),{status:400});
        const learning = runtime.getLearning();
        const ranked = rankInitialProviders(allIds, providers, learning);
        const lanes = Math.min(racers, ranked.length);
        const raceGroup = `${body.fixtureId || 'task-board'}:${Date.now()}`;
        const tasks = [];
        try {
          for(let i = 0; i < lanes; i++) {
            const laneProviders = [ranked[i], ...ranked.filter((_,j)=>j!==i)];
            const task = await createFixtureTask(runtime, dataDir, { ...body, providerIds: laneProviders });
            const updated = runtime.store.updateTask(task.id, current => { current.raceGroup = raceGroup; return current; }, 'race.joined', { lane: i, primary: ranked[i] });
            tasks.push(updated);
          }
        } catch (err) {
          for (const created of tasks) { try { runtime.cancel(created.id); } catch {} }
          throw err;
        }
        for (const t of tasks) run(t.id);
        const terminalStatuses = new Set(['completed', 'failed', 'cancelled']);
        const watchRace = async () => {
          while(!closing && !runtime.closed) {
            await new Promise(r => { const t = setTimeout(r, 5000); t.unref?.(); });
            if(closing || runtime.closed) return;
            const states = tasks.map(t => { try { return runtime.getTask(t.id); } catch { return { id: t.id, status: 'cancelled' }; } });
            const winner = states.find(t => t.status === 'completed');
            if(winner) {
              for(const t of states) { if(t.id !== winner.id && !['completed','cancelled'].includes(t.status)) try { runtime.cancel(t.id); } catch {} }
              return;
            }
            if(states.every(t => terminalStatuses.has(t.status))) return;
          }
        };
        watchRace().catch(() => {});
        return send(res, 201, { tasks: tasks.map(t => publicTask(t, runtime)), raceGroup, lanes });
      }
      if(req.method==='POST' && url.pathname==='/api/gauntlet') {
        const body=await readBody(req);
        const allIds = body.providerIds !== undefined ? body.providerIds : [...providers.keys()].filter(id=>id.startsWith('openrouter:'));
        const rawFixtureIds = body.fixtureIds !== undefined ? body.fixtureIds : fixtures.map(f=>f.id);
        if(!Array.isArray(allIds) || !allIds.length) throw Object.assign(new Error('Gauntlet needs at least 1 provider'), { status: 400 });
        if(!Array.isArray(rawFixtureIds) || !rawFixtureIds.length || rawFixtureIds.some(id => typeof id !== 'string' || !fixtures.some(f => f.id === id)))
          throw Object.assign(new Error('Gauntlet requires a non-empty array of valid fixture IDs.'), { status: 400 });
        const fixtureIds = [...new Set(rawFixtureIds)];
        const learning = runtime.getLearning();
        const ranked = rankInitialProviders(allIds, providers, learning);
        const tasks = [];
        for(const fixtureId of fixtureIds) {
          const task = await createFixtureTask(runtime, dataDir, { fixtureId, providerIds: ranked, policy: body.policy, persona: body.persona });
          tasks.push(task);
          run(task.id);
        }
        return send(res, 201, { tasks: tasks.map(t => publicTask(t, runtime)), fixtureCount: fixtureIds.length, providerCount: ranked.length });
      }
      if(req.method==='POST'&&(url.pathname==='/api/import/preview'||url.pathname==='/api/workspaces/preview')) {
        const body=await readBody(req);return send(res,200,await previewWorkspace(body.sourcePath));
      }
      const streamMatch=url.pathname.match(/^\/api\/tasks\/([^/]+)\/stream$/);
      if(streamMatch&&req.method==='GET') {
        const taskId=streamMatch[1];
        runtime.getTask(taskId);
        req.setTimeout(0);res.setTimeout(0);
        res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache','connection':'keep-alive','x-accel-buffering':'no'});
        res.write(':ok\n\n');
        let cleaned = false;
        const safeWrite = chunk => {
          if (cleaned || res.writableEnded || res.destroyed) return;
          try { res.write(chunk); } catch { cleanup(); }
        };
        const heartbeat = setInterval(() => safeWrite(':heartbeat\n\n'), 15000);
        heartbeat.unref?.();
        const unsub = runtime.subscribeStream(taskId, event => safeWrite(`data: ${JSON.stringify(event)}\n\n`));
        const client = {
          taskId,
          close() {
            cleanup();
            if (!res.writableEnded && !res.destroyed) { try { res.end(); } catch {} }
          }
        };
        const cleanup = () => {
          if (cleaned) return;
          cleaned = true;
          clearInterval(heartbeat);
          unsub();
          sseClients.delete(client);
          let hasOther = false;
          for (const c of sseClients) {
            if (c.taskId === taskId) { hasOther = true; break; }
          }
          if (!hasOther) {
            runtime.broker.browser.setScreencastWatching(taskId, false).catch(() => {});
          }
        };
        sseClients.add(client);
        req.on('close', cleanup);
        res.on('close', cleanup);
        res.on('error', cleanup);
        return;
      }
      const conclaveMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/conclave(?:\/(steer))?$/);
      if (conclaveMatch) {
        const id = decodeURIComponent(conclaveMatch[1]);
        const subAction = conclaveMatch[2] || '';
        if (req.method === 'GET' && !subAction) {
          return send(res, 200, runtime.getConclaveState(id));
        }
        if (req.method === 'POST' && subAction === 'steer') {
          if (runtime.getTask(id).crewMember) throw Object.assign(new Error('Control crew workers through their parent conversation.'), { code: 'CREW_MEMBER', status: 400 });
          const body = await readBody(req);
          const result = await runtime.queueWorkerSteer(id, body.workerId || 'orchestrator', body.message || '');
          return send(res, 200, { ...result, conclave: runtime.getConclaveState(id) });
        }
      }
      const crewMatch=url.pathname.match(/^\/api\/tasks\/([^/]+)\/crew(?:\/(pause|cancel|resume|inspect|candidate|apply))?$/);
      if(crewMatch) {
        const [,id,action]=crewMatch,task=runtime.getTask(id);
        if(task.crewMember)throw Object.assign(new Error('Control crew workers through their parent conversation.'),{code:'CREW_MEMBER'});
        if(req.method==='GET'&&!action)return send(res,200,runtime.crew.summary(id));
        if(req.method==='GET'&&action==='candidate')return send(res,200,await runtime.crew.candidate(id));
        if(req.method==='POST') {
          const body=await readBody(req);
          if(!action)return send(res,202,{crew:await runtime.crew.start(id,body),task:publicTask(runtime.getTask(id),runtime)});
          if(action==='apply')return send(res,200,{task:publicTask(await runtime.crew.apply(id,body),runtime),crew:runtime.crew.summary(id)});
          if(Object.keys(body).length)throw Object.assign(new Error('Unexpected crew action fields'),{code:'INVALID_CREW'});
          if(action==='inspect')return send(res,200,{crew:await runtime.crew.inspect(id),task:publicTask(runtime.getTask(id),runtime)});
          if(action==='pause')return send(res,200,{crew:runtime.crew.pause(id),task:publicTask(runtime.getTask(id),runtime)});
          if(action==='cancel')return send(res,200,{crew:runtime.crew.cancel(id),task:publicTask(runtime.getTask(id),runtime)});
          if(action==='resume')return send(res,202,{crew:await runtime.crew.resume(id),task:publicTask(runtime.getTask(id),runtime)});
        }
      }
      const browserShotMatch = req.method === 'GET' && url.pathname.match(/^\/api\/tasks\/([^/]+)\/browser\/screenshot$/);
      if (browserShotMatch) {
        const taskId = decodeURIComponent(browserShotMatch[1]);
        runtime.getTask(taskId);
        const shot = runtime.broker.browser.getLatestScreenshot(taskId);
        if (!shot) return send(res, 404, { error: 'No browser screenshot available for this task.' });
        res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' });
        res.end(shot.buffer);
        return;
      }
      const browserFrameMatch = req.method === 'GET' && url.pathname.match(/^\/api\/tasks\/([^/]+)\/browser\/frame$/);
      if (browserFrameMatch) {
        const taskId = decodeURIComponent(browserFrameMatch[1]);
        runtime.getTask(taskId);
        const frame = runtime.broker.browser.getLatestFrame(taskId);
        if (!frame) return send(res, 404, { error: 'No live browser frame available for this task.' });
        res.writeHead(200, { 'content-type': frame.mime || 'image/jpeg', 'cache-control': 'no-store' });
        res.end(frame.buffer);
        return;
      }
      const browserCtrlMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/browser\/(status|mode|screencast|close)$/);
      if (browserCtrlMatch) {
        const taskId = decodeURIComponent(browserCtrlMatch[1]);
        const sub = browserCtrlMatch[2];
        runtime.getTask(taskId);
        if (req.method === 'GET' && sub === 'status') {
          return send(res, 200, runtime.broker.browser.getStatus(taskId));
        }
        if (req.method === 'POST' && sub === 'mode') {
          const body = await readBody(req);
          if (typeof body.visibleWindow !== 'boolean') {
            throw Object.assign(new Error('visibleWindow must be a boolean.'), { status: 400, code: 'INVALID_BROWSER_MODE' });
          }
          if (body.persist === true) runtime.updateBrowserSettings({ visibleWindow: body.visibleWindow });
          const status = await runtime.broker.browser.setSessionMode(taskId, { visibleWindow: body.visibleWindow }, runtime.outboundOptions());
          return send(res, 200, status);
        }
        if (req.method === 'POST' && sub === 'screencast') {
          const body = await readBody(req);
          const status = await runtime.broker.browser.setScreencastWatching(taskId, Boolean(body.active));
          return send(res, 200, status);
        }
        if (req.method === 'POST' && sub === 'close') {
          await readBody(req).catch(() => ({}));
          await runtime.broker.browser.closeSession(taskId);
          return send(res, 200, runtime.broker.browser.getStatus(taskId));
        }
      }
      const match=url.pathname.match(/^\/api\/tasks\/([^/]+)(?:\/(run|pause|resume|cancel|accept|report-refusal|policy|providers|answer-race|message|export|patch|execution|checks|persona|effort|prompt|apply-preview|apply-source|inspect-apply|undo-apply|source-backup|hunk|generation|rewind|plan-mode|compact|checkpoints|permissions|approval|fork|transcript|commit|title))?$/);
      if(match) {
        const [,id,action]=match;
        if(mutation&&runtime.getTask(id).crewMember)throw Object.assign(new Error('Control crew workers through their parent conversation.'),{code:'CREW_MEMBER'});
        if(req.method==='POST'&&['apply-preview','apply-source','inspect-apply','undo-apply'].includes(action)) {
          const body=await readBody(req),key=action==='apply-source'?'previewId':action==='apply-preview'?null:'applicationId';
          if(Object.keys(body).some(name=>name!==key&&!(action==='apply-source'&&name==='paths'))||key&&typeof body[key]!=='string')throw Object.assign(new Error('Unexpected source-application request fields'),{status:400});
          if(action==='apply-preview')return send(res,200,{preview:await runtime.sourceChanges.preview(id)});
          const application=action==='apply-source'?await runtime.sourceChanges.apply(id,body.previewId,body.paths):action==='inspect-apply'?await runtime.sourceChanges.inspect(id,body.applicationId):await runtime.sourceChanges.undo(id,body.applicationId);
          return send(res,200,{application,task:publicTask(runtime.getTask(id),runtime)});
        }
        if(req.method==='GET'&&action==='source-backup') {
          const application=runtime.sourceChanges.receipt(id,url.searchParams.get('id'));
          res.setHeader('Content-Disposition',`attachment; filename="g0dc0d3-backup-${application.id}.json"`);
          return send(res,200,{format:'g0dc0d3-source-backup/1',applicationId:application.id,sourcePath:application.sourcePath,sourceIdentity:application.sourceIdentity,createdAt:application.startedAt,files:application.files.map(({path,before,after,beforeHash,afterHash,originalMode,state})=>({path,before,after,beforeHash,afterHash,originalMode,state})),note:'Exact local source backup. Contains source text; inspect before sharing. A null before value means this application created the file.'});
        }
        if(req.method==='GET'&&action==='patch') {
          const task=runtime.getTask(id);
          const unsettled = () => runtime.runs.has(id) || runtime.broker.locks.has(id)
            || runtime.getOperations(id).some(operation => !['succeeded','failed'].includes(operation.status));
          if(['running','recovering','verifying'].includes(task.status)||unsettled())return send(res,409,{error:'Pause and settle or reconcile outstanding work before exporting a patch.'});
          const snapshot=await runtime.snapshotTask(id);
          const current=runtime.getTask(id);
          if(current.epoch!==task.epoch||unsettled())return send(res,409,{error:'Task changed during export. Try again after it settles.'});
          const patch=createGitPatch(fileDiff(task.initialSnapshot.files,snapshot.files));
          if(!patch)return send(res,409,{error:'There are no changes to export.'});
          res.writeHead(200,{'content-type':'text/x-diff; charset=utf-8','cache-control':'no-store',
            'content-disposition':`attachment; filename="g0dc0d3-${task.id}.patch"`,'x-g0d-snapshot':snapshot.snapshotHash});
          res.end(patch);return;
        }
        if(req.method==='GET'&&action==='export') {
          const task=runtime.getTask(id);
          const crews=runtime.store.listCrews().filter(crew=>crew.parentId===id).map(crew=>({crew,workers:Object.values(crew.members).map(workerId=>({task:runtime.getTask(workerId),events:runtime.getEvents(workerId),operations:runtime.getOperations(workerId)}))}));
          res.setHeader('Content-Disposition',`attachment; filename="g0dc0d3-${task.id}.json"`);
          return send(res,200,redact({task,events:runtime.getEvents(id),operations:runtime.getOperations(id),crews,exportNote:'Recognized credentials redacted. Review source and logs before sharing; arbitrary secrets may remain.'}));
        }
        if(req.method==='GET'&&action==='prompt')return send(res,200,redact(inspectPrompt(await runtime.contextForTask(id))));
        if(req.method==='PATCH'&&action==='execution')return send(res,200,{task:publicTask(runtime.updateExecution(id,await readBody(req)),runtime)});
        if(req.method==='PATCH'&&action==='checks'){const body=await readBody(req);return send(res,200,{task:publicTask(runtime.updateChecks(id,body.checks),runtime)});}
        if(req.method==='PATCH'&&action==='persona'){const body=await readBody(req);return send(res,200,{task:publicTask(runtime.updatePersona(id,body.persona),runtime)});}
        if(req.method==='PATCH'&&action==='effort'){
          const body=await readBody(req);
          return send(res,200,{task:publicTask(runtime.setEffort(id,body.effort),runtime)});
        }
        if(req.method==='POST'&&action==='plan-mode'){
          const body=await readBody(req);
          if(typeof body.enabled!=='boolean')throw Object.assign(new Error('Provide enabled (boolean).'),{status:400});
          return send(res,200,{task:publicTask(runtime.setPlanMode(id,body.enabled),runtime)});
        }
        if(req.method==='POST'&&action==='compact'){
          await readBody(req);
          const task=await runtime.compactTask(id);
          return send(res,200,{task:publicTask(task,runtime),workingSummary:task.workingSummary});
        }
        if(req.method==='GET'&&action==='checkpoints'){
          const rawLimit=url.searchParams.get('limit');
          const parsed=rawLimit!==null?Number(rawLimit):25;
          const limit=Number.isInteger(parsed)&&parsed>=1&&parsed<=100?parsed:25;
          return send(res,200,{checkpoints:await runtime.listCheckpoints(id,{limit})});
        }
        if(req.method==='PATCH'&&action==='permissions'){
          const body=await readBody(req);
          let rules=body.rules!==undefined?body.rules:body.permissionRules;
          if(body.preset!==undefined) {
            if(typeof body.preset!=='string'||!Object.hasOwn(PERMISSION_PRESETS,body.preset))throw Object.assign(new Error('Unknown permission preset.'),{status:400,code:'INVALID_PERMISSION_RULE'});
            rules=[...PERMISSION_PRESETS[body.preset]];
          }
          return send(res,200,{task:publicTask(runtime.updatePermissions(id,rules),runtime)});
        }
        if(req.method==='POST'&&action==='approval'){
          const body=await readBody(req);
          const result=runtime.resolveApproval(id,{decision:body.decision,resume:body.resume!==false});
          return send(res,200,{task:publicTask(result.task,runtime),resumed:result.resumed});
        }
        if(req.method==='PATCH'&&action==='title'){
          const body=await readBody(req);
          if(Object.keys(body).some(k=>k!=='title'))throw Object.assign(new Error('Only title is accepted.'),{status:400});
          return send(res,200,{task:publicTask(runtime.renameTask(id,body.title),runtime)});
        }
        if(req.method==='POST'&&action==='fork'){
          const body=await readBody(req);
          const forked=await runtime.forkTask(id,{title:body.title,fromHash:body.fromHash});
          return send(res,201,{task:publicTask(forked,runtime)});
        }
        if(req.method==='GET'&&action==='transcript'){
          const transcript=await runtime.exportTranscript(id);
          if(url.searchParams.get('format')==='json')return send(res,200,{ok:true,taskId:id,format:'markdown',transcript});
          res.writeHead(200,{'content-type':'text/markdown; charset=utf-8','cache-control':'no-store','content-disposition':`inline; filename="g0dc0d3-${id}.md"`});
          res.end(transcript);return;
        }
        if(req.method==='POST'&&action==='commit'){
          const body=await readBody(req);
          const result=await runtime.commitWorkspace(id,{message:body.message});
          return send(res,200,result);
        }
        if(req.method==='POST'&&action==='hunk') {
          const body=await readBody(req, 384 * 1024);
          const filePath=body.path, content=body.content;
          if(typeof filePath!=='string'||typeof content!=='string')
            throw Object.assign(new Error('Provide path (string) and content (string).'),{status:400});
          if(content.includes('\0')) throw Object.assign(new Error('Hunk content cannot contain NUL bytes.'),{status:400});
          if(Buffer.byteLength(content)>256*1024)throw Object.assign(new Error('Content exceeds 256 KiB.'),{status:400});
          const task=runtime.getTask(id);
          runtime.crew.assertIdle(id);
          if(runtime.sourceChanges.busy(id))throw Object.assign(new Error('Source changes are still settling.'),{status:409});
          if(['running','recovering','verifying'].includes(task.status)||runtime.runs.has(id)||runtime.broker.locks.has(id))
            throw Object.assign(new Error('Pause and settle the task before editing hunks.'),{status:409});
          if(task.status==='cancelled')throw Object.assign(new Error('Cancelled task files cannot be edited.'),{status:409});
          let releaseLock;
          const lock = new Promise(resolve => { releaseLock = resolve; });
          runtime.broker.locks.set(id, lock);
          try {
            const snapshot=await runtime.snapshotTask(id);
            const liveTask=runtime.getTask(id);
            if(liveTask.epoch!==task.epoch||['running','recovering','verifying','cancelled'].includes(liveTask.status)||runtime.runs.has(id))
              throw Object.assign(new Error('Task changed while preparing hunk edit.'),{status:409});
            const diff=fileDiff(liveTask.initialSnapshot.files,snapshot.files);
            if(!diff.find(d=>d.path===filePath))throw Object.assign(new Error('File not in diff.'),{status:404});
            const wsFile=await scopedPath(liveTask.workspace,filePath,{writing:true});
            await fs.mkdir(path.dirname(wsFile),{recursive:true});
            await fs.writeFile(wsFile,content,'utf8');
            runtime.store.updateTask(id,current=>{current.epoch+=1;current.verification=null;if(current.status==='completed'){current.status='paused';current.completionKind=null;delete current.completedAt;delete current.acceptedSnapshotHash;}return current;},'workspace.hunk_edited',{path:filePath,source:'owner'});
            const newSnapshot=await runtime.snapshotTask(id);
            const newDiff=fileDiff(liveTask.initialSnapshot.files,newSnapshot.files);
            return send(res,200,{diff:newDiff});
          } finally {
            if (runtime.broker.locks.get(id) === lock) runtime.broker.locks.delete(id);
            releaseLock();
          }
        }
        if(req.method==='GET'&&!action) {
          const task=runtime.getTask(id);
          let snapshot,workspaceExpired=false;
          try { snapshot=await runtime.snapshotTask(id); } catch(e) { if(e.code==='ENOENT') { snapshot={files:[],snapshotHash:''}; workspaceExpired=true; } else throw e; }
          return send(res,200,{task:publicTask(task,runtime),crew:runtime.crew.summary(id),crewBusy:runtime.crew.busy(id),sourceApplications:runtime.sourceChanges.summaries(id),events:displayOutcomes(runtime.getRecentEvents(id,200)).map(value=>displayValue(value)),eventCount:task.eventSeq,displayLimits:{events:200,stringCharacters:32000,messageCharacters:200000,exportUrl:`/api/tasks/${id}/export`},operations:runtime.getOperations(id).slice(-100).map(value=>displayValue(value)),files:snapshot.files,diff:workspaceExpired?[]:fileDiff(task.initialSnapshot.files,snapshot.files),workspaceExpired});
        }
        if(req.method==='DELETE'&&!action) {
          await readBody(req);
          if (worktrees.attachments.has(id) || worktrees.list().some(project => project.chatId === id))
            throw Object.assign(new Error('Remove this chat’s GodCode worktree before deleting the chat.'), { status: 409 });
          for (const client of [...sseClients]) if (client.taskId === id) client.close();
          return send(res,200,await runtime.purgeTask(id));
        }
        if(req.method==='PATCH'&&action==='policy')return send(res,200,{task:publicTask(runtime.updatePolicy(id,await readBody(req)),runtime)});
        if(req.method==='POST'&&action==='message') {
          const body=await readBody(req, 12 * 1024 * 1024);
          if(Object.keys(body).some(key=>!['message','messageId','mode','attachments'].includes(key)))throw Object.assign(new Error('Only message, messageId, mode and attachments are accepted in a follow-up request'),{status:400});
          const result=await runtime.submitMessage(id,body.message,body.messageId,body.mode,body.attachments);
          if(result.start)run(id);
          return send(res,result.queued?202:200,{task:publicTask(runtime.getTask(id),runtime),queued:result.queued,duplicate:Boolean(result.duplicate)});
        }
        if(req.method==='PATCH'&&action==='message') {
          const body=await readBody(req);
          if(Object.keys(body).some(key=>!['messageId','message','expectedMessage','direction'].includes(key)))throw new Error('Unknown queued message field.');
          return send(res,200,{task:publicTask(runtime.updateQueuedMessage(id,body),runtime)});
        }
        if(req.method==='PATCH'&&action==='generation') {
          const task=runtime.getTask(id);
          await loadSelected([...task.providers,...(task.answerRace?.models || [])]);
          return send(res,200,{task:publicTask(runtime.updateGeneration(id,await readBody(req)),runtime)});
        }
        if(req.method==='POST'&&action==='rewind') {
          const body=await readBody(req, 512 * 1024);
          if (!Object.hasOwn(body,'messageId') && !Object.hasOwn(body,'revision') && !Object.hasOwn(body,'regenerate') && !Object.hasOwn(body,'message')) {
            if (Object.keys(body).some(key=>!['hash','steps'].includes(key))) throw Object.assign(new Error('Unknown checkpoint rewind field.'),{status:400});
            const opts=body.hash!==undefined?{hash:body.hash}:{steps:body.steps===undefined?1:body.steps};
            const result=await runtime.rewindTask(id,opts);
            return send(res,200,{task:publicTask(result.task,runtime),rewind:result.rewind});
          }
          if(Object.keys(body).some(key=>!['messageId','message','revision','regenerate'].includes(key)))throw new Error('Unknown rewind field.');
          const chat=runtime.getTask(id);
          if(worktrees.attachments.has(id) || (chat.codeWorkspace && worktrees.jobs.has(chat.codeWorkspace.id)))throw new Error('Wait for the workspace build before rewinding.');
          runtime.rewindConversation(id,body);
          if(body.regenerate === true){runtime.resume(id);run(id);}
          return send(res,200,{task:publicTask(runtime.getTask(id),runtime)});
        }
        if(req.method==='DELETE'&&action==='message') {
          const body=await readBody(req);
          if(Object.keys(body).some(key=>key!=='messageId'))throw Object.assign(new Error('Only messageId is accepted'),{status:400});
          return send(res,200,{task:publicTask(runtime.removeQueuedMessage(id,body.messageId),runtime)});
        }
        if(req.method==='PATCH'&&action==='answer-race') {
          const body=await readBody(req);
          if (!Object.hasOwn(body,'answerRace')) throw new Error('Specify the comparison or null to turn it off.');
          if (body.answerRace) await catalog.list();
          return send(res,200,{task:publicTask(runtime.setAnswerRace(id,body.answerRace),runtime)});
        }
        if(req.method==='PATCH'&&action==='providers') {
          const body=await readBody(req),task=runtime.getTask(id);
          await loadSelected(body.providerIds);
          if(!task.fixtureId&&task.acceptance?.mode==='owner'&&body.providerIds?.some(provider=>providers.get(provider)?.kind==='scripted'))throw new Error('Custom project tasks require live providers');
          return send(res,200,{task:publicTask(runtime.setProviders(id,body.providerIds),runtime)});
        }
        if(req.method==='POST'&&action==='report-refusal') {
          const body=await readBody(req);
          runtime.crew.assertIdle(id);
          const task=await runtime.reportRefusal(id,body);
          if(task.status==='queued')run(id);
          return send(res,200,{task:publicTask(runtime.getTask(id),runtime)});
        }
        if(req.method==='POST'&&['run','pause','resume','cancel','accept'].includes(action)) {
          await readBody(req);
          if(['run','resume','accept'].includes(action))runtime.crew.assertIdle(id);
          if(['run','resume','accept'].includes(action)&&runtime.sourceChanges.busy(id))return send(res,409,{error:'Source changes are still settling.',code:'SOURCE_BUSY'});
          if(action==='run')run(id);
          else if(action==='resume'){await runtime.resume(id);run(id);}
          else await runtime[action](id);
          return send(res,200,{task:publicTask(runtime.getTask(id),runtime)});
        }
      }
      if(req.method==='GET'&&url.pathname==='/api/bench')return send(res,200,benchmark);
      if(req.method==='POST'&&url.pathname==='/api/bench') {
        await readBody(req);
        if(benchmark.status==='running')return send(res,409,{error:'Benchmark already running'});
        benchmark={status:'running',report:null,progress:null,startedAt:new Date().toISOString()};
        benchmarkPromise=(async()=>{
          const {runBenchmark}=await import('../bench/run.mjs');
          const report=await runBenchmark({dataDir:path.join(dataDir,'benchmarks',new Date().toISOString().replaceAll(':','-')),onProgress:progress=>{benchmark.progress=progress;}});
          benchmark={status:'completed',report};
          await fs.writeFile(benchmarkFile,JSON.stringify(report,null,2)+'\n',{mode:0o600});
        })().catch(error=>{benchmark={status:'failed',error:error.message,report:null};});
        return send(res,202,{started:true});
      }
      const staticFiles={'/conversation-controls.js':['conversation-controls.js','text/javascript'],'/lysios-mark-canonical-ink.svg':['lysios-mark-canonical-ink.svg','image/svg+xml'],'/lysios-mark-reverse-white.svg':['lysios-mark-reverse-white.svg','image/svg+xml'],'/dictation.js':['dictation.js','text/javascript'],'/file-preview.js':['file-preview.js','text/javascript'],'/desktop.js':['desktop.js','text/javascript'],'/desktop.css':['desktop.css','text/css'],'/':['index.html','text/html'],'/index.html':['index.html','text/html'],'/message-format.js':['message-format.js','text/javascript'],'/recovery.js':['recovery.js','text/javascript'],'/app.js':['app.js','text/javascript'],'/settings.js':['settings.js','text/javascript'],'/styles.css':['styles.css','text/css'],'/workspace.css':['workspace.css','text/css']};
      staticFiles['/prompt-commands.js'] = ['prompt-commands.js','text/javascript'];
      staticFiles['/setup.js'] = ['setup.js','text/javascript'];
      staticFiles['/themes.js'] = ['themes.js','text/javascript'];
      staticFiles['/themes.css'] = ['themes.css','text/css'];
      staticFiles['/mermaid-lite.js'] = ['mermaid-lite.js','text/javascript'];
      staticFiles['/conclave.js'] = ['conclave.js','text/javascript'];
      staticFiles['/browser-live.js'] = ['browser-live.js','text/javascript'];
      staticFiles['/brand-wordmark.ttf'] = ['brand-wordmark.ttf', 'font/ttf'];
      if(req.method==='GET'&&staticFiles[url.pathname]) {
        const [filename,mime]=staticFiles[url.pathname],body=await fs.readFile(path.join(publicDir,filename));
        res.writeHead(200,{'content-type':`${mime}; charset=utf-8`,'cache-control':'no-store'});res.end(body);return;
      }
      if(req.method==='GET'&&/^\/vendor\/[\w.-]+\.(js|css)$/.test(url.pathname)) {
        const vendorFile=path.join(publicDir,url.pathname.slice(1));
        try{const body=await fs.readFile(vendorFile);const mime=url.pathname.endsWith('.css')?'text/css':'text/javascript';res.writeHead(200,{'content-type':`${mime}; charset=utf-8`,'cache-control':'public, max-age=86400'});res.end(body);return;}catch{}
      }
      return send(res,404,{error:'Not found'});
    } catch(error) {
      if(!res.headersSent)send(res,error.status||(error.code==='TASK_NOT_FOUND'?404:400),{error:error.message,code:error.code||'REQUEST_ERROR'});
      else res.end();
    }
  });
  server.requestTimeout=15000;server.headersTimeout=10000;
  return {server,runtime,get benchmark(){return benchmark;},get accessUrl(){return session.accessUrl(baseUrl);},
    async listen(port=Number(process.env.G0D_PORT||4317)) {
      await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>{server.off('error',reject);resolve();});});
      baseUrl=`http://127.0.0.1:${server.address().port}`;
      try {await session.publishToken(server.address().port);} catch(error){await new Promise(resolve=>server.close(resolve));throw error;}
      return baseUrl;
    },
    close(){
      if(closePromise)return closePromise;
      closing=true;
      for (const client of [...sseClients]) client.close();
      server.closeIdleConnections();
      closePromise=(async()=>{
        await worktrees.close();
        const outcomes=await Promise.allSettled([new Promise(resolve=>server.close(()=>resolve())),runtime.close(),benchmarkPromise]);
        await session.close();
        const failure=outcomes.find(value=>value.status==='rejected');if(failure)throw failure.reason;
      })();
      return closePromise;
    }
  };
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const envFile=path.join(path.dirname(fileURLToPath(import.meta.url)),'..', '.env');
  try{const lines=await fs.readFile(envFile,'utf8');for(const raw of lines.split(/\r?\n/)){const m=raw.match(/^\s*([A-Z_][A-Z0-9_]*)=(.*)$/);if(m&&!(m[1] in process.env)){let v=m[2].trim();if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);process.env[m[1]]=v;}}}catch{}
  const dataDir = path.resolve(process.env.G0D_DATA_DIR || path.join(projectDir, '.g0dc0d3'));
  const nativeIdx = process.argv.indexOf('--native-keychain');
  const keychain = nativeIdx >= 2 && process.argv[nativeIdx + 1]
    ? nativeKeychain(process.argv[nativeIdx + 1], dataDir)
    : process.platform === 'linux'
      ? linuxSecretToolKeychain(dataDir)
      : undefined;
  const app=await createApp({auth:true, dataDir, keychain});
  try {await app.listen();process.stdout.write(`G0DM0D3 0.2.0\n${app.accessUrl}\nState: ${app.runtime.store.dataDir}\nPrivate local launch link; keep it on this machine. Ctrl-C to stop.\n`);}
  catch(error){await app.close();throw error;}
  const shutdown = () => {
    app.close().then(
      () => process.exit(0),
      err => { process.stderr.write(`${err?.message || err}\n`); process.exit(1); }
    );
  };
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal, shutdown);
  if (process.argv.includes('--exit-on-stdin-eof')) {
    process.stdin.resume();
    process.stdin.once('end', shutdown);
    process.stdin.once('close', shutdown);
  }
}
