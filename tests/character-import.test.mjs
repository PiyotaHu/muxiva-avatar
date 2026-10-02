import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import test from 'node:test';
import {createExperienceMetrics} from '../web/experience-metrics.mjs';
import {describeExperience} from '../web/experience-view.mjs';

const root=process.env.AVATAR_APP_ROOT||fileURLToPath(new URL('../',import.meta.url));
// Execute the actual application, not a copy of its import handler. Only ES
// imports are removed so the browser/runtime dependencies can be injected.
const appSource=(await readFile(resolve(root,'web/app.mjs'),'utf8'))
  .replace(/^import\s+[^\n]+\s+from\s+['"][^'"]+['"];?\r?\n/gm,'');

function deferred(){
  let resolve,reject;
  const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
  return {promise,resolve,reject};
}

async function harness({initialType='illustration',withMatchMedia=true,reducedMotion=false,
  allowSession=false}={}){
  const nodes=new Map(),renderers=[],frames=[],trace=[],requests=[],audios=[],sockets=[];
  let nextConstructionError=null;
  class EventSurface{
    constructor(){this.listeners=new Map();}
    addEventListener(type,listener,options){
      const entries=this.listeners.get(type)||[];
      if(!entries.some(entry=>entry.listener===listener))entries.push({listener,options});
      this.listeners.set(type,entries);
    }
    removeEventListener(type,listener){
      this.listeners.set(type,(this.listeners.get(type)||[]).filter(entry=>entry.listener!==listener));
    }
    dispatchEvent(event){
      event.target??=this;event.currentTarget=this;
      for(const {listener} of this.listeners.get(event.type)||[])listener.call(this,event);
      const handler=this['on'+event.type];if(handler)handler.call(this,event);
      if(event.bubbles!==false&&this.parentElement)this.parentElement.dispatchEvent(event);
      return true;
    }
    emit(type,properties={}){return this.dispatchEvent({type,...properties});}
  }
  class Element extends EventSurface{
    constructor(tag='div',id=''){
      super();
      this.tagName=tag.toUpperCase();this.id=id;this.connected=false;
      this.children=[];this.dataset={};this.attributes={};this.value='';
      this.textContent='';this.hidden=false;this.disabled=false;this.files=[];
      this.parentElement=null;this.rect={left:100,top:40,width:400,height:800};
    }
    setAttribute(name,value){this.attributes[name]=value;}
    querySelector(){return null;}
    getBoundingClientRect(){return {...this.rect};}
    click(properties={}){if(!this.disabled)this.emit('click',properties);}
    append(...children){for(const child of children){this.children.push(child);child.parentElement=this;}}
    replaceChildren(...children){this.children=children;}
    replaceWith(replacement){
      assert.equal(this.connected,true,'only an attached canvas can be replaced');
      const parent=this.parentElement;
      if(parent){parent.children[parent.children.indexOf(this)]=replacement;replacement.parentElement=parent;}
      this.parentElement=null;
      this.connected=false;replacement.connected=true;
      nodes.set(this.id,replacement);
      trace.push(['replace',this,replacement]);
    }
  }
  const element=id=>{
    if(!nodes.has(id)){
      const tag=id==='avatar'?'canvas':['avatarGreet','avatarAcknowledge'].includes(id)?'button':'div';
      const node=new Element(tag,id);
      node.connected=true;nodes.set(id,node);
    }
    return nodes.get(id);
  };
  const buttons=[0,1].map(yaw=>{
    const button=new Element('button');button.dataset.avatarYaw=String(yaw);return button;
  });
  const viewport=new Element('div');viewport.connected=true;
  viewport.append(element('avatar'));
  const document=Object.assign(new EventSurface(),{hidden:false,
    body:new Element('body'),
    getElementById:element,createElement:tag=>new Element(tag),
    querySelector:selector=>{
      if(selector==='.avatar-viewport')return viewport;
      throw Error('Unimplemented DOM selector: '+selector);
    },querySelectorAll:()=>buttons});
  class FakeAvatarRenderer{
    constructor(canvas,options){
      if(nextConstructionError){const error=nextConstructionError;nextConstructionError=null;throw error;}
      this.canvas=canvas;this.options=options;this.disposed=false;this.disposeCalls=0;
      this.resizeCalls=0;this.updateCalls=0;this.meta=null;this.stats={fps:60};
      this.renderer={getContext:()=>({getExtension:()=>null,getParameter:()=> 'fake GPU',RENDERER:1})};
      renderers.push(this);trace.push(['construct',this]);
    }
    async load(){this.meta={name:'Existing character'};return {meta:this.meta};}
    async loadFile(file){
      this.file=file;this.loading=deferred();trace.push(['load',this]);
      const model=await this.loading.promise;
      // Normal mode reproduces AvatarRenderer's existing disposal/late-load
      // contract. One test deliberately returns a stale model anyway, to prove
      // that the application's generation guard independently rejects it.
      if(this.disposed&&!file.returnAfterDispose){trace.push(['release-late-model',this]);return null;}
      if(model)this.meta=model.meta||{};
      return model;
    }
    setExpression(name,weight){
      trace.push(['expression',this,this.canvas.connected]);
      if(this.file?.expressionError)throw Error('expression preparation failed');
      this.expression={name,weight};return true;
    }
    setView(options){
      trace.push(['view',this,this.canvas.connected]);
      if(this.file?.viewError)throw Error('view preparation failed');
      this.view=options;
    }
    resize(){
      this.resizeCalls++;trace.push(['resize',this,this.canvas.connected]);
      assert.equal(this.canvas.connected,true,'resize sees the candidate in the actual DOM');
      if(this.file?.resizeError)throw Error('resize failed');
    }
    dispose(){
      this.disposeCalls++;this.disposed=true;trace.push(['dispose',this]);
      if(this.disposeError)throw Error('old renderer release failed');
    }
    update(position){
      assert.equal(this.disposed,false,'the render loop must not retain a disposed avatar');
      this.updateCalls++;this.lastUpdate={...position};
    }
    reset(){}
    queue(){}
  }
  class FakeIllustrationRenderer extends FakeAvatarRenderer{
    constructor(...args){super(...args);this.pointers=[];this.interactions=[];this.activities=[];this.motionPreferences=[];}
    async load(...args){const result=await super.load(...args);this.asset={loaded:true};return result;}
    setPointer(pointer){assert.equal(this.disposed,false);this.pointers.push({...pointer});}
    interact(type){assert.equal(this.disposed,false);this.interactions.push(type);return Boolean(this.asset);}
    setActivity(value){assert.equal(this.disposed,false);this.activities.push(value);}
    setReducedMotion(value){assert.equal(this.disposed,false);this.motionPreferences.push(value);}
  }
  const config={name:'Configured character',description:'Existing description',credit:'Existing credit',
    version:'illustration-test',asset:'/assets/avatar/fixture.json',
    renderer:{type:initialType,framing:'full'},expression:{name:'neutral',weight:0}};
  const preference=Object.assign(new EventSurface(),{matches:reducedMotion});
  const window=Object.assign(new EventSurface(),{location:{search:''}});
  if(withMatchMedia)window.matchMedia=query=>{
    assert.equal(query,'(prefers-reduced-motion: reduce)');return preference;
  };
  class FakeAudio{
    constructor(onPosition,onError){
      assert.equal(allowSession,true,'UI-only tests must not start audio');
      this.onPosition=onPosition;this.onError=onError;
      this.position={playing:false,sequence:1,sampleOffset:0,sampleRateHz:24000,streamId:'assistant'};
      this.starts=0;this.microphones=0;this.closes=0;audios.push(this);
    }
    async start(){this.starts++;}
    async microphone(){this.microphones++;return {echoCancellation:true};}
    mute(value){this.muted=value;}
    add(message){this.position={...this.position,...message.position};}
    cancel(){this.position.playing=false;}
    async close(){this.closes++;}
  }
  class FakeSocket{
    static OPEN=1;
    constructor(){
      assert.equal(allowSession,true,'UI-only tests must not connect a session');
      this.readyState=1;this.sent=[];sockets.push(this);
    }
    send(value){this.sent.push(value);}
    close(){this.readyState=3;this.onclose?.();}
    receive(value){this.onmessage?.({data:JSON.stringify(value)});}
  }
  const context=vm.createContext({document,window,AvatarRenderer:FakeAvatarRenderer,
    IllustrationRenderer:FakeIllustrationRenderer,
    LocalAudio:FakeAudio,createExperienceMetrics,describeExperience,
    validateCharacterConfig:value=>value,resolveCharacterConfigUrl:()=>'/character-test.json',
    applyIdleAnimationPreview:value=>value,
    fetch:async (url,options)=>{
      requests.push({url,options});
      if(url==='/character-test.json')return {ok:true,json:async()=>config};
      if(url==='/api/status')return {json:async()=>({modelConfigured:true,speechReady:true})};
      if(url==='/api/session'&&allowSession)return {ok:true,json:async()=>({
        session:'test-session',token:'test-token',url:'ws://test.invalid/fixture'})};
      throw Error('Unexpected network request: '+url);
    },requestAnimationFrame:callback=>frames.push(callback),performance:{now:()=>0},
    WebSocket:FakeSocket,
  });
  await new vm.Script('(async()=>{\n'+appSource+'\n})()',{
    filename:resolve(root,'web/app.mjs'),
  }).runInContext(context);
  const original=renderers[0],originalCanvas=element('avatar');
  const input=element('modelFile');
  const select=(name,options={})=>{
    const count=renderers.length;
    input.files=[{name,...options}];input.value='C:\\fakepath\\'+name;
    const done=input.onchange({target:input});
    return {done,renderer:renderers.length>count?renderers.at(-1):null};
  };
  const metadata=()=>['avatarName','avatarDescription','avatarCredit'].map(id=>element(id).textContent);
  const snapshot=()=>({canvas:element('avatar'),metadata:metadata(),model:window.avatarDiagnostics().model});
  const initial=snapshot();
  const assertOriginal=()=>{
    assert.equal(element('avatar'),originalCanvas);
    assert.equal(originalCanvas.connected,true);
    assert.equal(original.disposed,false);
    assert.deepEqual(metadata(),initial.metadata);
    assert.equal(window.avatarDiagnostics().model,initial.model);
    assert.equal(window.avatarDiagnostics().character.name,config.name);
    const calls=original.updateCalls;frames.shift()(100);
    assert.equal(original.updateCalls,calls+1,'the existing avatar still receives the actual app render callback');
  };
  return {element,renderers,trace,frames,window,document,viewport,preference,requests,audios,sockets,
    original,originalCanvas,initial,input,select,
    snapshot,assertOriginal,buttons,unload:()=>window.emit('beforeunload'),
    failConstruction:()=>{nextConstructionError=Error('WebGL construction failed');}};
}

const model=(name,authors=['Model author'])=>({meta:{name,authors}});

test('view switches preserve media, canvas and conversation and perform no external actions',async()=>{
  const h=await harness(),requests=h.requests.length;
  h.element('prompt').value='Draft stays local';
  h.element('immersionToggle').click();
  assert.equal(h.document.body.dataset.view,'immersive');
  assert.equal(h.element('immersionToggle').attributes['aria-pressed'],'true');
  h.element('conversationToggle').click();
  assert.equal(h.element('conversationPanel').hidden,true);
  assert.equal(h.element('conversationToggle').attributes['aria-expanded'],'false');
  h.element('conversationToggle').click();h.element('immersionToggle').click();
  assert.equal(h.document.body.dataset.view,'conversation');
  assert.equal(h.element('conversationPanel').hidden,false);
  assert.equal(h.element('prompt').value,'Draft stays local');
  assert.equal(h.element('avatar'),h.originalCanvas);
  assert.equal(h.requests.length,requests);assert.equal(h.audios.length,0);assert.equal(h.sockets.length,0);
});

test('presentation uses consumed audio, not text or an incoming PCM packet, as speaking evidence',async()=>{
  const h=await harness({allowSession:true});
  assert.equal(h.document.body.dataset.activity,'idle');
  await h.element('connect').onclick();
  const socket=h.sockets[0],audio=h.audios[0];
  socket.receive({type:'session',status:'media-ready'});
  assert.equal(h.document.body.dataset.activity,'ready');
  assert.match(h.element('microphoneStatus').textContent,/未开启/);
  socket.receive({type:'event',topic:'muxiva.agent.response.started',sequence:1});
  assert.equal(h.document.body.dataset.activity,'thinking');
  socket.receive({type:'text',channel:'response_in',sequence:1,text:'一句话。'});
  socket.receive({type:'event',topic:'muxiva.agent.response.completed',sequence:1});
  assert.equal(h.document.body.dataset.activity,'ready');
  assert.match(h.element('experienceLabel').textContent,/回复已显示/);
  socket.receive({type:'audio',sequence:1,pcm:'AAAA'});
  assert.equal(h.document.body.dataset.activity,'ready');
  audio.position={...audio.position,playing:true,sampleOffset:128};audio.onPosition(audio.position);
  assert.equal(h.document.body.dataset.activity,'speaking');
  audio.position={...audio.position,playing:false};audio.onPosition(audio.position);
  assert.equal(h.document.body.dataset.activity,'ready');
  h.element('disconnect').click();
  assert.equal(h.document.body.dataset.activity,'idle');
  assert.match(h.element('microphoneStatus').textContent,/未开启/);
});

test('permission pending, live and muted microphone have distinct truthful display states',async()=>{
  const h=await harness({allowSession:true});await h.element('connect').onclick();
  h.sockets[0].receive({type:'session',status:'media-ready'});
  const permission=deferred();h.audios[0].microphone=()=>permission.promise;
  const pending=h.element('mic').onclick();
  assert.match(h.element('microphoneStatus').textContent,/请求麦克风权限/);
  assert.notEqual(h.document.body.dataset.activity,'listening');
  permission.resolve({echoCancellation:true});await pending;
  assert.equal(h.document.body.dataset.activity,'listening');
  await h.element('mic').onclick();
  assert.match(h.element('microphoneStatus').textContent,/已静音/);
  assert.equal(h.document.body.dataset.activity,'ready');
  h.element('disconnect').click();
  assert.match(h.element('microphoneStatus').textContent,/未开启/);
});

test('errors expand collapsed dialogue without starting microphone or replacing the avatar',async()=>{
  const h=await harness({allowSession:true});await h.element('connect').onclick();
  h.sockets[0].receive({type:'session',status:'media-ready'});
  h.element('conversationToggle').click();
  h.sockets[0].receive({type:'error',message:'Test connection error'});
  assert.equal(h.element('conversationPanel').hidden,false);
  assert.equal(h.element('conversationToggle').attributes['aria-expanded'],'true');
  assert.equal(h.document.body.dataset.activity,'error');
  assert.equal(h.audios[0].microphones,0);assert.equal(h.element('avatar'),h.originalCanvas);
  h.element('disconnect').click();
});

test('late response events and text cannot resurrect a cancelled answer or clear newer thinking',async()=>{
  const h=await harness({allowSession:true});await h.element('connect').onclick();const socket=h.sockets[0];
  socket.receive({type:'session',status:'media-ready'});
  const event=(topic,sequence)=>socket.receive({type:'event',topic:'muxiva.agent.response.'+topic,sequence});
  event('started',10);assert.equal(h.document.body.dataset.activity,'thinking');
  socket.receive({type:'cancel',before_sequence:11});
  event('started',10);assert.equal(h.document.body.dataset.activity,'ready');
  event('started',11);
  event('completed',10);assert.equal(h.document.body.dataset.activity,'thinking');
  socket.receive({type:'text',channel:'response_in',sequence:10,text:'Stale text'});
  assert.equal(h.element('messages').children.length,0);
  socket.receive({type:'cancel',before_sequence:11});
  assert.equal(h.document.body.dataset.activity,'thinking','equal boundary does not cancel current response');
  event('completed',11);assert.equal(h.document.body.dataset.activity,'ready');
  event('started',12);event('completed',11);
  assert.equal(h.document.body.dataset.activity,'thinking','prior completed is stale even without another cancel');
  h.element('disconnect').click();
});

test('text without spoken output and gaps between segments never claim ongoing synthesis or acoustic completion',async()=>{
  const h=await harness({allowSession:true});await h.element('connect').onclick();const socket=h.sockets[0],audio=h.audios[0];
  socket.receive({type:'session',status:'media-ready'});
  socket.receive({type:'text',channel:'response_in',sequence:1,text:'https://example.test'});
  socket.receive({type:'event',topic:'muxiva.agent.response.completed',sequence:1});
  assert.match(h.element('experienceLabel').textContent,/回复已显示/);
  assert.doesNotMatch(h.element('experienceLabel').textContent,/准备声音|播放完毕|回答完成/);
  audio.position={...audio.position,playing:true,sampleOffset:128};audio.onPosition(audio.position);
  assert.equal(h.document.body.dataset.activity,'speaking');
  audio.position={...audio.position,playing:false};audio.onPosition(audio.position);
  assert.match(h.element('experienceLabel').textContent,/回复已显示/);
  audio.position={...audio.position,playing:true,sampleOffset:256};audio.onPosition(audio.position);
  assert.equal(h.document.body.dataset.activity,'speaking');
  h.element('disconnect').click();
});

test('failed local load preserves the current illustration, canvas, metadata and rendering',async()=>{
  const h=await harness();const load=h.select('broken.vrm');
  h.assertOriginal();
  assert.equal(load.renderer.canvas.connected,false);
  load.renderer.loading.reject(Error('invalid VRM'));await load.done;
  h.assertOriginal();assert.equal(load.renderer.disposed,true);
  assert.equal(h.trace.filter(entry=>entry[0]==='replace').length,0);
  assert.match(h.element('avatarStatus').textContent,/invalid VRM.*未替换/);
  assert.equal(h.input.value,'');
});

test('constructor failure and a cancelled/null load do not disturb the current avatar',async()=>{
  const h=await harness({initialType:'vrm'});
  h.failConstruction();const failed=h.select('no-context.vrm');await failed.done;
  assert.equal(failed.renderer,null);h.assertOriginal();
  assert.match(h.element('avatarStatus').textContent,/WebGL construction failed/);
  const cancelled=h.select('cancelled.vrm');cancelled.renderer.loading.resolve(null);await cancelled.done;
  h.assertOriginal();assert.equal(cancelled.renderer.disposed,true);
  assert.equal(h.input.value,'');
});

for(const field of ['expressionError','viewError']){
  test(field+' is prepared before canvas replacement and preserves the existing avatar on failure',async()=>{
    const h=await harness();const load=h.select('bad-preparation.vrm',{[field]:true});
    load.renderer.loading.resolve(model('Rejected'));await load.done;
    h.assertOriginal();assert.equal(load.renderer.disposed,true);
    assert.equal(h.trace.filter(entry=>entry[0]==='replace').length,0);
    assert.match(h.element('avatarStatus').textContent,/preparation failed.*未替换/);
  });
}

test('a successful local import atomically swaps canvases after preparation and attached resize',async()=>{
  const h=await harness();const load=h.select('accepted.vrm');
  h.assertOriginal();load.renderer.loading.resolve(model('Accepted',['Alice',42,'Bob']));await load.done;
  assert.equal(h.element('avatar'),load.renderer.canvas);
  assert.equal(h.originalCanvas.connected,false);assert.equal(h.original.disposed,true);
  assert.equal(h.original.disposeCalls,1);assert.equal(load.renderer.disposed,false);
  assert.equal(load.renderer.expression.name,'neutral');assert.equal(load.renderer.expression.weight,0);
  assert.equal(load.renderer.view.yaw,0);assert.equal(load.renderer.view.framing,'full');
  assert.equal(h.window.avatarDiagnostics().model,'Accepted');
  assert.equal(h.window.avatarDiagnostics().character,null);
  assert.equal(h.element('avatarName').textContent,'Accepted');
  assert.equal(h.element('avatarDescription').textContent,'本地导入 · accepted.vrm');
  assert.equal(h.element('avatarCredit').textContent,'模型作者：Alice、Bob');
  assert.equal(h.element('avatarStatus').hidden,true);assert.equal(h.input.value,'');
  assert.equal(h.element('framing').disabled,false);assert.ok(h.buttons.every(button=>!button.disabled));
  const operations=h.trace.filter(entry=>entry[1]===load.renderer||entry[0]==='replace'||entry[0]==='dispose');
  assert.deepEqual(operations.map(entry=>entry[0]),['construct','load','expression','view','replace','resize','dispose']);
  assert.equal(operations.find(entry=>entry[0]==='expression')[2],false);
  assert.equal(operations.find(entry=>entry[0]==='view')[2],false);
  assert.equal(operations.find(entry=>entry[0]==='resize')[2],true);
  h.frames.shift()(100);assert.equal(load.renderer.updateCalls,1);
});

test('failed attached resize restores the exact old canvas and renderer, then a later import can succeed',async()=>{
  const h=await harness();const bad=h.select('oversized.vrm',{resizeError:true});
  bad.renderer.loading.resolve(model('Too large'));await bad.done;
  h.assertOriginal();assert.equal(bad.renderer.disposed,true);assert.equal(bad.renderer.canvas.connected,false);
  const swaps=h.trace.filter(entry=>entry[0]==='replace');
  assert.equal(swaps.length,2);
  assert.equal(swaps[0][1],h.originalCanvas);assert.equal(swaps[0][2],bad.renderer.canvas);
  assert.equal(swaps[1][1],bad.renderer.canvas);assert.equal(swaps[1][2],h.originalCanvas);
  assert.match(h.element('avatarStatus').textContent,/resize failed.*未替换/);
  const good=h.select('valid.vrm');good.renderer.loading.resolve(model('Recovered'));await good.done;
  assert.equal(h.window.avatarDiagnostics().model,'Recovered');assert.equal(h.original.disposeCalls,1);
});

test('starting B immediately disposes pending A; A resolving last cannot replace B',async()=>{
  const h=await harness();const a=h.select('A.vrm',{returnAfterDispose:true});
  const b=h.select('B.vrm');
  assert.equal(a.renderer.disposed,true,'superseded WebGL renderer is released before A finishes');
  assert.equal(b.renderer.disposed,false);h.assertOriginal();
  b.renderer.loading.resolve(model('B'));await b.done;
  const accepted=h.snapshot();const acceptedStatus=h.element('avatarStatus').textContent;
  a.renderer.loading.resolve(model('A'));await a.done;
  assert.deepEqual(h.snapshot(),accepted);assert.equal(h.window.avatarDiagnostics().model,'B');
  assert.equal(h.element('avatarStatus').hidden,true);
  assert.equal(h.element('avatarStatus').textContent,acceptedStatus);
  assert.equal(b.renderer.disposed,false);assert.equal(h.original.disposeCalls,1);
});

for(const lateOutcome of ['model','null','reject']){
  test('stale A '+lateOutcome+' while B is pending cannot clear B ownership or its file selection',async()=>{
    const h=await harness();const a=h.select('A.vrm',{returnAfterDispose:true});const b=h.select('B.vrm');
    const loadingText=h.element('avatarStatus').textContent;
    if(lateOutcome==='reject')a.renderer.loading.reject(Error('old A failure'));
    else a.renderer.loading.resolve(lateOutcome==='null'?null:model('A'));
    await a.done;
    h.assertOriginal();assert.equal(h.input.value,'C:\\fakepath\\B.vrm');
    assert.equal(h.element('avatarStatus').textContent,loadingText);
    assert.equal(b.renderer.disposed,false);
    const c=h.select('C.vrm');
    assert.equal(b.renderer.disposed,true,'A finally must not clear the pending B pointer');
    b.renderer.loading.resolve(model('B'));await b.done;
    assert.equal(h.input.value,'C:\\fakepath\\C.vrm');
    c.renderer.loading.resolve(model('C'));await c.done;
    assert.equal(h.window.avatarDiagnostics().model,'C');assert.equal(c.renderer.disposed,false);
  });
}

test('latest B failing does not resurrect superseded A when A finishes afterwards',async()=>{
  const h=await harness();const a=h.select('A.vrm',{returnAfterDispose:true});const b=h.select('B.vrm');
  b.renderer.loading.reject(Error('B failed'));await b.done;
  h.assertOriginal();const status=h.element('avatarStatus').textContent;
  a.renderer.loading.resolve(model('A'));await a.done;
  h.assertOriginal();assert.equal(h.element('avatarStatus').textContent,status);
  assert.equal(a.renderer.disposed,true);assert.equal(b.renderer.disposed,true);
});

test('closing the page disposes the current and pending renderers; the late model stays detached',async()=>{
  const h=await harness();const load=h.select('pending.vrm');
  h.unload();assert.equal(h.original.disposed,true);assert.equal(load.renderer.disposed,true);
  assert.equal(h.original.disposeCalls,1);assert.equal(load.renderer.disposeCalls,1);
  load.renderer.loading.resolve(model('Late after unload'));await load.done;
  assert.equal(h.element('avatar'),h.originalCanvas);
  assert.equal(load.renderer.canvas.connected,false);
  assert.equal(h.trace.filter(entry=>entry[0]==='replace').length,0);
  assert.equal(h.trace.filter(entry=>entry[0]==='release-late-model').length,1);
});

test('after success page close disposes only the new current renderer, not a stale pending pointer',async()=>{
  const h=await harness();const load=h.select('final.vrm');
  load.renderer.loading.resolve(model('Final'));await load.done;
  h.unload();assert.equal(load.renderer.disposeCalls,1);assert.equal(h.original.disposeCalls,1);
});

test('old renderer disposal error after successful commit does not roll back or misreport load failure',async()=>{
  const h=await harness();h.original.disposeError=true;const load=h.select('valid.vrm');
  load.renderer.loading.resolve(model('Valid'));await load.done;
  assert.equal(h.window.avatarDiagnostics().model,'Valid');assert.equal(h.element('avatar'),load.renderer.canvas);
  assert.equal(load.renderer.disposed,false);assert.equal(h.element('avatarStatus').hidden,true);
  assert.match(h.element('diagnostics').textContent,/旧角色释放错误: old renderer release failed/);
  assert.equal(h.element('messages').children.length,0);
});

test('an empty file picker event does not cancel a pending valid selection',async()=>{
  const h=await harness();const load=h.select('still-loading.vrm');
  h.input.files=[];await h.input.onchange({target:h.input});
  assert.equal(load.renderer.disposed,false);
  load.renderer.loading.resolve(model('Still selected'));await load.done;
  assert.equal(h.window.avatarDiagnostics().model,'Still selected');
});

test('local greeting/acknowledgement controls work without opening audio, a session or a model request',async()=>{
  const h=await harness();const initialRequests=h.requests.length;
  assert.equal(h.element('avatarGreet').disabled,false);
  assert.equal(h.element('avatarAcknowledge').disabled,false);
  assert.equal(h.element('interactionHint').hidden,false);
  assert.equal(h.window.avatarDiagnostics().ready,false);
  h.element('avatarGreet').click();h.element('avatarAcknowledge').click();
  h.originalCanvas.click({clientX:200,clientY:240});
  h.viewport.emit('click',{target:h.element('fps'),clientX:200,clientY:240});
  assert.deepEqual(h.original.interactions,['greet','acknowledge','greet'],
    'a click on stage decoration is not a character interaction');
  assert.deepEqual(h.original.pointers.at(-1),{x:.25,y:.25,active:true});
  assert.equal(h.requests.length,initialRequests);
  assert.equal(h.audios.length,0);assert.equal(h.sockets.length,0);
});

test('pointer movement is passively bound to the stable viewport and uses its current bounding rectangle',async()=>{
  const h=await harness();const handlers=h.viewport.listeners.get('pointermove');
  assert.equal(handlers.length,1);assert.equal(handlers[0].options.passive,true);
  assert.equal(h.originalCanvas.listeners.size,0,'no input handlers are captured by the replaceable canvas');
  h.originalCanvas.emit('pointermove',{clientX:200,clientY:240});
  assert.deepEqual(h.original.pointers.at(-1),{x:.25,y:.25,active:true});
  h.viewport.rect={left:20,top:50,width:200,height:100};
  h.viewport.emit('pointermove',{clientX:170,clientY:75});
  assert.deepEqual(h.original.pointers.at(-1),{x:.75,y:.25,active:true});
  h.viewport.emit('pointermove',{clientX:-200,clientY:900});
  assert.deepEqual(h.original.pointers.at(-1),{x:0,y:1,active:true});
  const previous=h.original.pointers.length;
  h.viewport.rect.width=0;h.viewport.emit('pointermove',{clientX:200,clientY:240});
  assert.equal(h.original.pointers.length,previous,'a hidden zero-size viewport cannot divide by zero');
});

test('pointer leave/cancel, window blur and a hidden document explicitly release attention',async()=>{
  const h=await harness();
  const releases=[()=>h.viewport.emit('pointerleave'),()=>h.viewport.emit('pointercancel'),
    ()=>h.window.emit('blur'),()=>{h.document.hidden=true;h.document.emit('visibilitychange');}];
  for(const release of releases){
    h.viewport.emit('pointermove',{clientX:300,clientY:400});
    assert.equal(h.original.pointers.at(-1).active,true);
    release();assert.deepEqual(h.original.pointers.at(-1),{x:.5,y:.5,active:false});
  }
  const count=h.original.pointers.length;
  h.document.hidden=false;h.document.emit('visibilitychange');
  assert.equal(h.original.pointers.length,count,'showing the page does not fabricate an active pointer');
  assert.equal(h.audios.length,0);assert.equal(h.sockets.length,0);
});

test('canvas replacement keeps viewport listeners but targets the newly committed renderer',async()=>{
  const h=await harness();const stable=h.viewport;
  const listeners=new Map([...stable.listeners].map(([type,entries])=>[type,entries.map(entry=>entry.listener)]));
  h.originalCanvas.emit('pointermove',{clientX:200,clientY:240});
  const originalPointerCount=h.original.pointers.length,originalInteractionCount=h.original.interactions.length;
  const load=h.select('replacement.vrm');load.renderer.loading.resolve(model('VRM'));await load.done;
  assert.equal(h.element('avatar').parentElement,stable);assert.equal(h.originalCanvas.parentElement,null);
  assert.equal(h.element('avatarGreet').disabled,true);assert.equal(h.element('avatarAcknowledge').disabled,true);
  assert.equal(h.element('interactionHint').hidden,true);
  assert.deepEqual(new Map([...stable.listeners].map(([type,entries])=>[type,entries.map(entry=>entry.listener)])),listeners,
    'the same viewport listener functions survive replacement without duplicate binding');
  // Current VRM lacks the optional presentation APIs: real user input must be
  // harmless and must not invoke the disposed illustration via an old closure.
  h.element('avatar').emit('pointermove',{clientX:220,clientY:250});
  h.element('avatar').click({clientX:220,clientY:250});
  h.element('avatarGreet').click();h.element('avatarAcknowledge').click();h.window.emit('blur');
  assert.equal(h.original.pointers.length,originalPointerCount);
  assert.equal(h.original.interactions.length,originalInteractionCount);
  // A presentation-capable successor proves the listener resolves the current
  // renderer at dispatch time, rather than merely no-oping after replacement.
  const successorPointers=[];load.renderer.setPointer=value=>successorPointers.push({...value});
  h.element('avatar').emit('pointermove',{clientX:300,clientY:440});h.window.emit('blur');
  assert.deepEqual(successorPointers,[{x:.5,y:.5,active:true},{x:.5,y:.5,active:false}]);
  const count=successorPointers.length;
  h.originalCanvas.emit('pointermove',{clientX:200,clientY:240});
  assert.equal(successorPointers.length,count,'events on detached old canvas do not reach the viewport');
});

test('pending/failed imports leave the existing illustration controls and event receiver usable',async()=>{
  const h=await harness();const load=h.select('bad-resize.vrm',{resizeError:true});
  h.element('avatarGreet').click();assert.equal(h.element('avatarGreet').disabled,false);
  load.renderer.loading.resolve(model('Rejected'));await load.done;
  h.assertOriginal();assert.equal(h.originalCanvas.parentElement,h.viewport);
  h.element('avatarAcknowledge').click();
  h.originalCanvas.emit('pointermove',{clientX:300,clientY:440});
  assert.deepEqual(h.original.interactions,['greet','acknowledge']);
  assert.deepEqual(h.original.pointers.at(-1),{x:.5,y:.5,active:true});
  assert.equal(h.element('interactionHint').hidden,false);
});

test('initial VRM has disabled local interaction controls and optional APIs are safely absent',async()=>{
  const h=await harness({initialType:'vrm'});
  assert.equal(h.element('avatarGreet').disabled,true);assert.equal(h.element('avatarAcknowledge').disabled,true);
  assert.equal(h.element('interactionHint').hidden,true);
  assert.doesNotThrow(()=>{
    h.originalCanvas.emit('pointermove',{clientX:300,clientY:440});
    h.originalCanvas.click({clientX:300,clientY:440});
    h.viewport.emit('pointerleave');h.window.emit('blur');
    h.preference.emit('change',{matches:true});h.frames.shift()(100);
  });
  assert.equal(h.original.updateCalls,1);assert.equal(h.audios.length,0);assert.equal(h.sockets.length,0);
});

test('reduced-motion preference initializes illustration config and later changes reach only current renderer',async()=>{
  const h=await harness({reducedMotion:true});
  assert.equal(h.original.options.motion.reducedMotion,true);
  h.preference.emit('change',{matches:false});h.preference.emit('change',{matches:true});
  assert.deepEqual(h.original.motionPreferences,[false,true]);
  const load=h.select('plain-vrm.vrm');load.renderer.loading.resolve(model('VRM'));await load.done;
  h.preference.emit('change',{matches:false});
  assert.deepEqual(h.original.motionPreferences,[false,true],'disposed renderer does not receive new system preferences');
  const absent=await harness({withMatchMedia:false});
  absent.originalCanvas.emit('pointermove',{clientX:200,clientY:240});
  assert.equal(absent.original.pointers.length,1,'matchMedia is optional, not a startup requirement');
});

test('render activity follows local UI/session state while playback fields still come from the audio position',async()=>{
  // All media and HTTP/socket dependencies are in-process fakes. This exercises
  // the actual application closures without a microphone or an actual model.
  const h=await harness({allowSession:true});let now=0;
  const frame=()=>{now+=100;h.frames.shift()(now);return h.original.activities.at(-1);};
  assert.equal(frame(),'idle');assert.equal(h.original.lastUpdate.playing,false);
  await h.element('connect').onclick();const socket=h.sockets[0],audio=h.audios[0];
  socket.receive({type:'session',status:'media-ready'});
  await h.element('mic').onclick();assert.equal(audio.microphones,1);
  assert.equal(frame(),'idle');assert.equal(h.original.lastUpdate.playing,false,'opening a microphone alone is not VAD speech');
  socket.receive({type:'event',topic:'muxiva.voice.speech.started'});assert.equal(frame(),'listening');
  socket.receive({type:'event',topic:'muxiva.agent.response.started'});
  assert.equal(frame(),'listening','live VAD presentation takes priority over an overlapping thinking event');
  socket.receive({type:'event',topic:'muxiva.voice.speech.stopped'});
  assert.equal(frame(),'thinking');assert.equal(h.original.lastUpdate.playing,false,
    'thinking is a visual activity, not fabricated audio playback');
  socket.receive({type:'audio',position:{playing:true,sequence:7,sampleOffset:2400,sampleRateHz:24000}});
  frame();assert.equal(h.original.lastUpdate.playing,true);
  assert.equal(h.original.lastUpdate.sequence,7);assert.equal(h.original.lastUpdate.sampleOffset,2400);
  const requestCount=h.requests.length,sentCount=socket.sent.length;
  h.element('avatarGreet').click();h.element('avatarAcknowledge').click();
  assert.equal(h.requests.length,requestCount);assert.equal(socket.sent.length,sentCount,
    'connected local interaction does not send assistant/model messages either');
  socket.receive({type:'event',topic:'muxiva.agent.response.completed'});assert.equal(frame(),'idle');
  socket.receive({type:'event',topic:'muxiva.voice.speech.started'});assert.equal(frame(),'listening');
  await h.element('mic').onclick();assert.equal(audio.muted,true);assert.equal(frame(),'idle','muting clears a live listening pose');
  socket.receive({type:'event',topic:'muxiva.agent.response.started'});assert.equal(frame(),'thinking');
  socket.receive({type:'cancel',before_sequence:8});assert.equal(frame(),'idle');
  assert.equal(h.original.lastUpdate.playing,false);
  socket.close();assert.equal(frame(),'idle');assert.equal(h.window.avatarDiagnostics().ready,false);
  assert.deepEqual(h.requests.map(request=>request.url),['/character-test.json','/api/status','/api/session']);
});

test('disconnect while thinking and muted resets the next session without stale callbacks',async()=>{
  const h=await harness({allowSession:true});let now=0;
  const frame=()=>{h.frames.shift()(now+=100);return h.original.activities.at(-1);};
  await h.element('connect').onclick();const old=h.sockets[0];old.receive({type:'session',status:'media-ready'});
  await h.element('mic').onclick();await h.element('mic').onclick();
  old.receive({type:'event',topic:'muxiva.agent.response.started'});assert.equal(frame(),'thinking');
  old.close();assert.equal(frame(),'idle');assert.equal(h.window.avatarDiagnostics().position,undefined);
  await h.element('connect').onclick();const fresh=h.sockets[1];fresh.receive({type:'session',status:'media-ready'});
  old.receive({type:'event',topic:'muxiva.agent.response.started'});old.onclose();
  assert.equal(h.window.avatarDiagnostics().ready,true);assert.equal(frame(),'idle');
  await h.element('mic').onclick();assert.equal(frame(),'idle');
  assert.equal(h.element('mic').textContent,'静音麦克风');assert.notEqual(h.audios[1].muted,true);
});

test('a late microphone permission completion cannot enable capture UI for a closed session',async()=>{
  const h=await harness({allowSession:true});await h.element('connect').onclick();
  const socket=h.sockets[0];socket.receive({type:'session',status:'media-ready'});
  const permission=deferred();h.audios[0].microphone=()=>permission.promise;
  const starting=h.element('mic').onclick();socket.close();
  permission.resolve({echoCancellation:true});await starting;
  h.frames.shift()(100);assert.equal(h.original.activities.at(-1),'idle');
  assert.equal(h.element('mic').textContent,'开启麦克风');assert.equal(h.element('mic').disabled,true);
});
test('explicit end stops local media immediately without waiting for a WebSocket close handshake',async()=>{
  const h=await harness({allowSession:true});await h.element('connect').onclick();
  const socket=h.sockets[0],audio=h.audios[0];socket.receive({type:'session',status:'media-ready'});
  socket.close=()=>{socket.readyState=2;};
  const permission=deferred();audio.microphone=()=>permission.promise;
  const microphone=h.element('mic').onclick();h.element('disconnect').onclick();
  assert.equal(audio.closes,1);assert.equal(h.window.avatarDiagnostics().ready,false);
  assert.equal(h.window.avatarDiagnostics().position,undefined);
  permission.resolve({echoCancellation:true});await microphone;
  assert.equal(h.element('mic').textContent,'开启麦克风');
  socket.receive({type:'event',topic:'muxiva.agent.response.started'});h.frames.shift()(100);
  assert.equal(h.original.activities.at(-1),'idle');socket.onclose();assert.equal(audio.closes,1);
});
test('capture backpressure releases local audio once, even if WebSocket remains closing',async()=>{
  const h=await harness({allowSession:true});await h.element('connect').onclick();
  const socket=h.sockets[0],audio=h.audios[0];socket.receive({type:'session',status:'media-ready'});
  let capture;audio.microphone=async send=>{capture=send;return {echoCancellation:true};};
  await h.element('mic').onclick();socket.bufferedAmount=256000;socket.close=()=>{socket.readyState=2;};
  capture(new ArrayBuffer(32));assert.equal(audio.closes,1);assert.equal(h.window.avatarDiagnostics().ready,false);
  const messages=h.element('messages').children.length;capture(new ArrayBuffer(32));
  assert.equal(h.element('messages').children.length,messages);assert.equal(audio.closes,1);
});
