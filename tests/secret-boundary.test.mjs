import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root=fileURLToPath(new URL('../',import.meta.url));
const key='dummy-secret-boundary-key-DO-NOT-USE';
const workspace='dummy-secret-boundary-workspace';

// Every probe has only OS plumbing plus dummy configuration. It cannot inherit
// production credentials, read .env, or contact a real model.
function probe(run,extraEnv={}) {
  const env={};
  for(const name of ['PATH','Path','SystemRoot','SYSTEMROOT','WINDIR','TEMP','TMP','COMSPEC','PATHEXT']) {
    if(process.env[name]!==undefined)env[name]=process.env[name];
  }
  Object.assign(env,{
    MUXIVA_BINARY:process.execPath,
    MUXIVA_MODEL_BASE_URL:'http://127.0.0.1:9/v1',
    MUXIVA_MODEL_ID:'secret-boundary-fixture',
    MUXIVA_MODEL_API_KEY:key,
    MUXIVA_MODEL_AUTH_MODE:'api-key',
    DASHSCOPE_WORKSPACE_ID:workspace,
    ...extraEnv,
  });
  const source=[
    "import assert from 'node:assert/strict';",
    'let dotenvReads=0;process.loadEnvFile=()=>{dotenvReads++;};',
    'const key='+JSON.stringify(key)+',workspace='+JSON.stringify(workspace)+';',
    noSecrets.toString(),setupDummyServer.toString(),
    '('+run.toString()+')().catch(error=>{console.error(error);process.exitCode=1;});',
  ].join('\n');
  const result=spawnSync(process.execPath,['--input-type=module','-e',source],{
    cwd:root,env,windowsHide:true,encoding:'utf8',timeout:15000,maxBuffer:256*1024,
  });
  // Any child diagnostics can contain only synthetic values, never real keys.
  assert.equal(result.status,0,result.error?.message||result.stderr||result.stdout);
}

function noSecrets(value) {
  const text=typeof value==='string'?value:JSON.stringify(value);
  assert.equal(text.includes(key),false,'API credential escaped its intended boundary');
  assert.equal(text.includes(workspace),false,'workspace identifier escaped its intended boundary');
}

test('importing the server does not load application dotenv credentials',()=>{
  probe(async()=>{
    await import('./server.mjs');
    assert.equal(dotenvReads,0,'module import must not read .env');
  });
});

async function modelProbe() {
  const {createModelRuntime}=await import('./.muxiva/nodes/pi_agent/model-runtime.ts');
  const requests=[];
  const fetch=async(input,init)=>{
    const url=typeof input==='string'?input:input instanceof URL?input.href:input.url;
    const headers=new Headers(init?.headers??(input instanceof Request?input.headers:undefined));
    const body=String(init?.body??'');
    requests.push({url,headers,body});
    const chunk={id:'fixture',object:'chat.completion.chunk',created:1,model:'secret-boundary-fixture',
      choices:[{index:0,delta:{role:'assistant',content:'hello'},finish_reason:'stop'}]};
    return new Response('data: '+JSON.stringify(chunk)+'\n\ndata: [DONE]\n\n',{
      headers:{'content-type':'text/event-stream'},
    });
  };
  const runtime=createModelRuntime({config:{},fetch});
  const stream=runtime.stream(runtime.model,{messages:[{role:'user',content:'hello',timestamp:1}]},{});
  const result=await stream.result();
  assert.notEqual(result.stopReason,'error','dummy model must complete');
  assert.equal(requests.length,1,'no fallback provider or destination is allowed');
  const request=requests[0];
  assert.equal(request.url,'http://127.0.0.1:9/v1/chat/completions');
  const keyless=process.env.MUXIVA_MODEL_AUTH_MODE==='none';
  assert.equal(request.headers.get('authorization'),keyless?null:'Bearer '+key);
  noSecrets(request.body);noSecrets(request.url);noSecrets(result);
  if(keyless)noSecrets(Object.fromEntries(request.headers));
}

test('explicit keyless model mode strips ambient dummy credentials from request fields',()=>{
  probe(modelProbe,{MUXIVA_MODEL_AUTH_MODE:'none'});
});
test('API-key model authenticates only its configured fetch and never inserts credentials into prompts',()=>{
  probe(modelProbe);
});

async function errorProbe() {
  const {createModelRuntime}=await import('./.muxiva/nodes/pi_agent/model-runtime.ts');
  const fetch=async()=>{
    const message='provider error echoed '+key+' in workspace '+workspace;
    if(process.env.SECRET_BOUNDARY_FAILURE==='throw')throw new Error(message);
    return new Response(JSON.stringify({error:{message,type:'invalid_request_error',code:'invalid_request'}}),{
      status:400,headers:{'content-type':'application/json'},
    });
  };
  const runtime=createModelRuntime({config:{},fetch});
  const stream=runtime.stream(runtime.model,{messages:[{role:'user',content:'hello',timestamp:1}]},{});
  const result=await stream.result();
  assert.equal(result.stopReason,'error','synthetic provider error must remain an error');
  noSecrets(result);
}

test('HTTP error bodies are redacted before the model SDK emits failure details',()=>{
  probe(errorProbe,{SECRET_BOUNDARY_FAILURE:'http'});
});
test('fetch exceptions are redacted before the model SDK emits failure details',()=>{
  probe(errorProbe,{SECRET_BOUNDARY_FAILURE:'throw'});
});

async function setupDummyServer() {
  const {EventEmitter,once}=await import('node:events');
  const {PassThrough}=await import('node:stream');
  const {readFile,rm}=await import('node:fs/promises');
  const {join}=await import('node:path');
  const {WebSocket}=await import('ws');
  const {createApp,root}=await import('./server.mjs');
  const children=[],sessionIds=[];
  const wait=async predicate=>{
    const deadline=Date.now()+3000;
    while(!predicate()){
      assert.ok(Date.now()<deadline,'dummy runtime did not reach expected state');
      await new Promise(resolve=>setTimeout(resolve,5));
    }
  };
  const app=createApp({port:0,shutdownGraceMs:1,startupTimeoutMs:5000,
    spawnRuntime:()=>{
      const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();
      child.pid=1000000+children.length;child.exitCode=null;children.push(child);return child;
    },
    terminateRuntime:async child=>{child.exitCode=0;child.emit('exit',0);},
  });
  const origin=await app.start();
  const connect=async(value,role='client')=>{
    const ws=new WebSocket(value.url,{headers:{Origin:origin}}),messages=[];
    ws.on('message',bytes=>messages.push(JSON.parse(bytes.toString())));
    await once(ws,'open');
    ws.send(JSON.stringify({session:value.session,role,
      token:role==='client'?value.token:app.sessions.get(value.session).internalToken}));
    return {ws,messages};
  };
  const newSession=async()=>{
    const response=await fetch(origin+'/api/session',{method:'POST',headers:{Origin:origin}});
    assert.equal(response.status,201);const session=await response.json();
    sessionIds.push(session.session);return session;
  };
  const readLog=id=>readFile(join(root,'.runtime',id+'.log'),'utf8');
  const cleanup=async()=>{
    await app.close();
    for(const id of sessionIds)await rm(join(root,'.runtime',id+'.log'),{force:true});
  };
  return {app,origin,children,wait,connect,newSession,readLog,cleanup};
}

test('browser status and session bootstrap expose no provider credentials or workspace',()=>{
  probe(async()=>{
    const f=await setupDummyServer();
    try {
      noSecrets(await fetch(f.origin+'/api/status').then(response=>response.text()));
      noSecrets(await f.newSession());
    } finally {await f.cleanup();}
  });
});

test('provider errors and split runtime diagnostics are redacted before browser and log output',()=>{
  probe(async()=>{
    const f=await setupDummyServer();
    try {
      const session=await f.newSession();
      const client=await f.connect(session);await f.wait(()=>f.children.length===1);
      const sink=await f.connect(session,'sink');
      await f.wait(()=>f.app.sessions.get(session.session)?.sink);
      const payload={message:'provider echoed '+key+' for '+workspace,details:{credential:key,workspace}};
      sink.ws.send(JSON.stringify({type:'event',topic:'muxiva.agent.response.failed',payload,sequence:1}));
      await f.wait(()=>client.messages.some(message=>message.topic==='muxiva.agent.response.failed'));
      noSecrets(client.messages);
      f.children[0].stderr.write('provider echoed '+key.slice(0,13));
      f.children[0].stderr.write(key.slice(13)+' for '+workspace+'\n');
      await f.app.close();
      noSecrets(await f.readLog(session.session));
    } finally {await f.cleanup();}
  });
});
