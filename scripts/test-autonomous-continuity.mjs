#!/usr/bin/env node
// AT-186: exercise the installed CLI, not a local imitation of its step loop.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, realpathSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const live = process.argv.includes('--live');
const cli = process.env.OPENCODE_BIN || 'opencode';
const version = spawnSync(cli, ['--version'], {encoding:'utf8'});
assert.equal(version.status, 0, 'OpenCode must be installed');
console.log(`autonomous continuity: ${version.stdout.trim()} (${live ? 'authenticated live' : 'scripted loopback provider'})`);
const roots = [];
const children = new Set();
function stop(child, signal='SIGKILL') {
  try { if(process.platform==='win32') child.kill(signal); else process.kill(-child.pid,signal); }
  catch(error) { if(error.code!=='ESRCH') throw error; }
}
let failures = 0;

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'opencode-continuity-')));
  roots.push(root);
  mkdirSync(join(root, 'config'));
  for (let i=1; i<=6; i++) writeFileSync(join(root, `part-${i}.txt`), i===6 ? 'AT186_COMPLETE' : `Read part-${i+1}.txt next.`);
  const env = {...process.env, PWD:root, OPENCODE_TEST_HOME:root,
    OPENCODE_CONFIG_DIR:join(root,'config'), XDG_CONFIG_HOME:join(root,'xdg'),
    XDG_DATA_HOME:join(root,'data'), XDG_CACHE_HOME:join(root,'cache'), XDG_STATE_HOME:join(root,'state')};
  // Do not inherit config injection, a service endpoint, or credentials into loopback tests.
  for (const key of ['OPENCODE_CONFIG', 'OPENCODE_CONFIG_CONTENT', 'OPENCODE_CONFIG_PROJECT_DISABLE',
    'OPENCODE_DISABLE_PROJECT_CONFIG', 'OPENCODE_SERVER', 'OPENCODE_SERVER_URL']) delete env[key];
  return {root, env};
}
const permissions = [{action:'*',resource:'*',effect:'deny'}, {action:'read',resource:'*',effect:'allow'}];
function configure(f, {steps, baseURL, deny=false, model='probe/probe'}={}) {
  const config = {model, small_model:model,
    agents:{build:{mode:'primary', system:'Read only the requested files, sequentially. Stop when complete.\n' +
      readFileSync(join(repoRoot,'agent/build.md'),'utf8').replace(/^---\n[\s\S]*?\n---\n/, ''),
      permissions:deny ? permissions.slice(0,1) : permissions, ...(steps === undefined ? {} : {steps})},
      plan:{mode:'primary'}},
    ...(baseURL ? {providers:{probe:{package:'aisdk:@ai-sdk/openai-compatible',
      settings:{baseURL,apiKey:'loopback-test'},models:{probe:{name:'Continuity probe',limit:{context:128000,output:2048}}}}}} : {})};
  writeFileSync(join(f.root,'config/opencode.json'), JSON.stringify(config));
}
function start(f, args, timeout=30000) {
  const child=spawn(cli,args,{cwd:f.root,env:f.env,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});
  children.add(child);
  let stdout='', stderr='', timedOut=false;
  child.stdout.on('data', c=>stdout+=c);
  child.stderr.on('data', c=>stderr+=c);
  const timer=setTimeout(()=>{timedOut=true;stop(child);},timeout);
  const done=new Promise((resolve,reject)=>{
    child.on('error',reject);
    child.on('close',(code,signal)=>{clearTimeout(timer);children.delete(child);resolve({code,signal,stdout,stderr,timedOut});});
  });
  return {child,done};
}
async function agents(f) {
  const result=await start(f,['debug','agents','--standalone']).done;
  assert.equal(result.code,0,result.stderr.slice(-500));
  return JSON.parse(result.stdout);
}
function events(result) {
  return result.stdout.split('\n').filter(x=>x.startsWith('{')).map(x=>JSON.parse(x));
}
async function check(name, fn) {
  try {console.log(`PASS ${name}: ${await fn()}`);}
  catch(error) {failures++; console.error(`FAIL ${name}: ${error.message}`);}
}
function stream(res, {text, tool, args, id}) {
  res.writeHead(200, {'Content-Type':'text/event-stream'});
  const delta=tool ? {role:'assistant', tool_calls:[{index:0,id:`call_${id}`,type:'function',function:{name:tool,arguments:JSON.stringify(args)}}]} : {role:'assistant',content:text};
  const chunk={id:`chatcmpl_${id}`,object:'chat.completion.chunk',created:1,model:'probe',choices:[{index:0,delta,finish_reason:tool?'tool_calls':'stop'}]};
  res.end(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`);
}
async function scenario({steps, count=6, deny=false, fail=false, cancel=false}={}) {
  const f=fixture();
  const requests=[];
  let calls=0;
  let notifyRequest;
  const requested=new Promise(resolve=>notifyRequest=resolve);
  const server=createServer(async(req,res)=>{
    try {
      let raw='';for await(const part of req)raw+=part;
      const body=JSON.parse(raw);requests.push(body);notifyRequest();
      if (cancel) return; // Intentionally pending until the test cancels the CLI.
      if (fail) {res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{message:'AT186_PROVIDER_FAILURE',type:'invalid_request_error'}}));return;}
      const tool=body.tools?.find(t=>t.function.name==='read');
      const restricted=body.tool_choice==='none';
      if (restricted || calls>=count || deny) {
        stream(res,{text:restricted?'AT186_LIMIT':deny?'AT186_DENIED':'AT186_COMPLETE',id:requests.length});return;
      }
      assert(tool, `read tool not advertised: ${body.tools?.map(t=>t.function.name)}`);
      const keys=Object.keys(tool.function.parameters.properties);
      const key=keys.find(x=>/^(filePath|path|file_path)$/.test(x));
      assert(key,`unknown read schema: ${keys}`);
      stream(res,{tool:'read',args:{[key]:join(f.root,`part-${++calls}.txt`)},id:requests.length});
    } catch(error) {res.writeHead(500);res.end(error.message);}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  configure(f,{steps,deny,baseURL:`http://127.0.0.1:${server.address().port}/v1`});
  try {
    const run=start(f,['run','--standalone','--archived','--title','AT186 runtime probe',
      '--format','json','--agent','build','-m','probe/probe','AT186_PROBE: read part-1.txt and follow the chain.']);
    if(cancel) {
      await Promise.race([requested,run.done.then(()=>{throw new Error('CLI exited before request');})]);
      stop(run.child,'SIGTERM');
    }
    const result=await run.done;
    assert(!result.timedOut,`CLI timed out: ${result.stderr.slice(-300)}`);
    return {result,requests,calls,events:events(result)};
  } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}

try {
  if (!live) {
    await check('omission and configuration precedence',async()=>{
      const f=fixture();configure(f);
      let resolved=await agents(f);
      for(const id of ['build','plan']) assert(!Object.hasOwn(resolved.find(a=>a.id===id),'steps'));
      configure(f,{steps:3});
      writeFileSync(join(f.root,'opencode.json'),JSON.stringify({agents:{build:{description:'project omission'}}}));
      resolved=await agents(f);assert.equal(resolved.find(a=>a.id==='build').steps,3,'project omission must not erase global limit');
      mkdirSync(join(f.root,'.opencode/agents'),{recursive:true});
      writeFileSync(join(f.root,'.opencode/agents/build.md'),'---\ndescription: Override probe\nmode: primary\nsteps: 5\n---\nRead-only probe.\n');
      resolved=await agents(f);assert.equal(resolved.find(a=>a.id==='build').steps,5);
      return 'omitted primary values stay absent; finite global and frontmatter overrides remain effective';
    });
    await check('installed primary prompts deliver the continuity policy',async()=>{
      const f=fixture();
      const rendered=spawnSync(process.execPath,[join(repoRoot,'scripts/render-config.mjs'),'--profile','personal'],{cwd:repoRoot,encoding:'utf8'});
      assert.equal(rendered.status,0);
      const config=JSON.parse(rendered.stdout);
      // This probe resolves actual agents; MCP/plugin activation is outside its scope.
      delete config.mcp;delete config.plugin;
      writeFileSync(join(f.root,'config/opencode.json'),JSON.stringify(config));
      mkdirSync(join(f.root,'config/agents'));
      for(const id of ['build','plan']) writeFileSync(join(f.root,`config/agents/${id}.md`),readFileSync(join(repoRoot,`agent/${id}.md`)));
      const resolved=await agents(f);
      for(const id of ['build','plan']) {
        const agent=resolved.find(a=>a.id===id);
        assert(!Object.hasOwn(agent,'steps'));
        for(const text of ['Autonomous continuity','three consecutive unsuccessful attempts',
          'checkpoint','elapsed-time/cost budgets','prompt-level','denied permission','review re-dispatch gates']) {
          assert(agent.system.includes(text),`${id}: effective installed prompt is missing ${text}`);
        }
      }
      return 'actual renderer and primary Markdown files deliver controls in an unrelated temporary project';
    });
    await check('long task continues natively',async()=>{
      const s=await scenario();assert.equal(s.result.code,0);
      assert.equal(s.calls,6);assert.equal(s.requests.length,7);
      assert(s.requests.every(r=>r.tool_choice!=='none'));
      const reads=s.events.filter(e=>e.type==='tool_use'&&e.part?.tool==='read');
      assert.equal(reads.filter(e=>e.part.state?.status==='completed').length,6,JSON.stringify(s.events.filter(e=>e.part?.tool)).slice(0,1900));
      assert(s.events.some(e=>e.part?.text==='AT186_COMPLETE'));
      return '6 sequential reads + final response in one user turn, beyond comparison budget 3';
    });
    await check('short task stops early',async()=>{
      const s=await scenario({count:1});assert.equal(s.requests.length,2);assert.equal(s.calls,1);
      assert.equal(s.result.code,0);return 'one read and completion; no extra requests';
    });
    await check('finite specialist-style budget removes tool access',async()=>{
      const s=await scenario({steps:3});assert.equal(s.calls,2);assert.equal(s.requests.length,3);
      assert.equal(s.requests.at(-1).tool_choice,'none');
      assert(s.events.some(e=>e.part?.text==='AT186_LIMIT'));
      return 'third step is text-only; incomplete work is distinguishable';
    });
    await check('permission denial remains effective',async()=>{
      const s=await scenario({deny:true});assert.equal(s.requests.length,1);assert.equal(s.calls,0);
      assert(!s.requests[0].tools?.some(t=>t.function.name==='read'));
      return 'explicit deny removes read; no restart or permission widening';
    });
    await check('provider failure does not restart the task',async()=>{
      const s=await scenario({fail:true});assert.equal(s.requests.length,1);
      assert(s.events.some(e=>e.type==='error')||s.result.code!==0,'failure must be reported');
      return 'non-retryable provider failure surfaced after one request';
    });
    await check('cancellation stops the active process',async()=>{
      const s=await scenario({cancel:true});assert.equal(s.requests.length,1);
      assert(s.result.signal||s.result.code!==0);return 'SIGTERM ends the pending run; no replacement request';
    });
  } else {
    let authenticated;
    let liveModel;
    await check('authenticated sequential read observation',async()=>{
      const f=fixture();const model=process.env.CONTINUITY_LIVE_MODEL || 'openai/gpt-6.1-sol';
      const provider=model.split('/')[0];
      const authPath=join(process.env.XDG_DATA_HOME || join(homedir(),'.local/share'),'opencode/auth.json');
      assert(existsSync(authPath),'existing OpenCode auth store is unavailable');
      const auth=JSON.parse(readFileSync(authPath,'utf8'));
      assert(auth[provider],`no stored authentication for ${provider}`);
      mkdirSync(join(f.root,'data/opencode'),{recursive:true});
      writeFileSync(join(f.root,'data/opencode/auth.json'),JSON.stringify({[provider]:auth[provider]}),{mode:0o600});
      configure(f,{model});
      authenticated=f;liveModel=model;
      const result=await start(f,['run','--standalone','--archived','--title','AT186 live read-only probe','--format','json',
        '--agent','build','-m',model,'Routing is already established as small for this isolated read-only fixture; there are no project instruction files to inspect and no skill is needed. Read part-1.txt using the read tool. Follow each file to the next, making one separate sequential read call per file. Read all six files; do not use shell, glob, scripts, or batch calls. After reading the last file output its marker and stop.'],120000).done;
      assert(!result.timedOut,'authenticated observation timed out');
      const ev=events(result);
      assert.equal(result.code,0,`provider execution failed (exit ${result.code}); errors=${JSON.stringify(ev.filter(e=>e.type==='error').map(e=>({type:e.error?.type,status:e.error?.status})))}`);
      const reads=ev.filter(e=>e.type==='tool_use'&&e.part?.tool==='read'&&e.part.state?.status==='completed');
      assert.equal(reads.length,6,`expected 6 completed reads; observed ${reads.length}; errors=${ev.filter(e=>e.type==='error').length}`);
      assert.equal(new Set(reads.map(e=>e.part.messageID)).size,6,'each read must belong to a distinct model step');
      for(let i=0;i<reads.length;i++) {
        const input=reads[i].part.state.input;
        const path=input.path ?? input.filePath ?? input.file_path;
        assert.equal(path?.split(/[\\/]/).at(-1),`part-${i+1}.txt`,'files must be read in chain order');
      }
      assert(ev.filter(e=>e.type==='step_start').length>=7,'six reads must be followed by a separate final response step');
      assert(ev.some(e=>e.part?.text?.includes('AT186_COMPLETE')),'completion marker absent');
      return `${model}: 6 completed sequential reads and final marker; test budget comparison 3`;
    });
    await check('authenticated no-progress stop observation',async()=>{
      assert(authenticated,'authenticated setup did not complete');
      const result=await start(authenticated,['run','--standalone','--archived','--title','AT186 no-progress probe',
        '--format','json','--agent','build','-m',liveModel,
        'Routing is already established as small for this isolated read-only fixture; do not inspect project instructions or load skills. Read absent.txt using the read tool to obtain the required input. The file does not exist and you must not create it or use other tools. Follow the shared no-progress policy. If blocked, report attempts, pending work, and blocker.'],120000).done;
      assert(!result.timedOut,'no-progress observation timed out');
      assert.equal(result.code,0,'no-progress observation did not return normally');
      const ev=events(result);
      const reads=ev.filter(e=>e.type==='tool_use'&&e.part?.tool==='read');
      assert(reads.length>=1&&reads.length<=3,`expected 1-3 bounded unsuccessful attempts, observed ${reads.length}`);
      assert(reads.every(e=>e.part.state?.status==='error'),'missing input must not be reported as read');
      const text=ev.filter(e=>e.part?.type==='text').map(e=>e.part.text).join(' ');
      assert(/block|missing|not exist|not found|absent/i.test(text),'blocker not reported');
      return `${liveModel}: stopped after ${reads.length} missing-input read attempt(s); blocker reported`;
    });
  }
} finally {
  for(const child of children) stop(child);
  for(const root of roots) rmSync(root,{recursive:true,force:true});
}
console.log(`${failures ? 'FAILED' : 'PASSED'}; prompt-level no-progress/cost policy is not a runtime watchdog`);
process.exitCode=failures ? 1 : 0;
