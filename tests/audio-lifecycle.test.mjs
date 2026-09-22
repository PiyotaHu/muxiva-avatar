import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
const source=readFileSync(new URL('../web/audio.mjs',import.meta.url),'utf8');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
function media(){
  const tracks=[0,1].map(()=>({enabled:true,stops:0,stop(){this.stops++;this.enabled=false;},getSettings(){return {echoCancellation:true};}}));
  return {tracks,getTracks(){return tracks;},getAudioTracks(){return tracks;}};
}
function harness(options={}){
  const contexts=[],nodes=[],streams=[],positions=[],errors=[];let requests=0;
  class FakeNode{
    constructor(kind){this.kind=kind;this.port={onmessage:null,messages:[],postMessage(value){this.messages.push(value);}};this.disconnects=0;this.gain={value:1};nodes.push(this);}
    connect(target){this.target=target;return target;}
    disconnect(){this.disconnects++;this.target=null;}
  }
  class FakeContext{
    constructor(config){this.sampleRate=config.sampleRate;this.state='suspended';this.destination={};this.closes=0;contexts.push(this);this.audioWorklet={addModule:url=>options.addModule?.(url,this)??Promise.resolve()};}
    resume(){return Promise.resolve(options.resume?.(this)).then(()=>{if(this.state!=='closed')this.state='running';});}
    close(){this.closes++;this.state='closed';return options.close?.(this)??Promise.resolve();}
    createMediaStreamSource(){return new FakeNode('source');}
    createGain(){return new FakeNode('gain');}
  }
  class FakeWorklet extends FakeNode{constructor(context,name){super(name);this.context=context;}}
  const sandbox={AudioContext:FakeContext,AudioWorkletNode:FakeWorklet,
    navigator:{mediaDevices:{getUserMedia(){requests++;if(options.getUserMedia)return options.getUserMedia();const stream=media();streams.push(stream);return Promise.resolve(stream);}}}};
  const LocalAudio=vm.runInNewContext(source.replace('export class LocalAudio','class LocalAudio')+'\nLocalAudio;',sandbox,{filename:'audio.mjs'});
  const audio=new LocalAudio(value=>positions.push(value),value=>errors.push(value));
  return {audio,contexts,nodes,streams,positions,errors,get requests(){return requests;}};
}
test('close during playback module load prevents late player creation',async()=>{
  const gate=deferred(),h=harness({addModule:()=>gate.promise});
  const opening=h.audio.start();await h.audio.close();
  assert.equal(h.contexts[0].state,'closed');assert.equal(h.nodes.length,0);
  const rejected=assert.rejects(opening,/已关闭/);gate.resolve();await rejected;
  assert.equal(h.nodes.length,0);assert.equal(h.contexts[0].closes,1);
});
test('pending permission cannot revive a closed session or hold close open',async()=>{
  const gate=deferred(),stream=media(),h=harness({getUserMedia:()=>gate.promise});
  const pending=h.audio.microphone(()=>{});assert.equal(h.requests,1);
  await h.audio.close();assert.equal(h.contexts.length,0);
  const rejected=assert.rejects(pending,/已关闭/);gate.resolve(stream);await rejected;
  assert.ok(stream.tracks.every(track=>track.stops===1));assert.equal(h.contexts.length,0);assert.equal(h.nodes.length,0);
  await assert.rejects(h.audio.microphone(()=>{}),/已关闭/);await assert.rejects(h.audio.start(),/已关闭/);
  assert.equal(h.requests,1);
});
test('close during capture module load stops tracks and forbids late nodes',async()=>{
  const gate=deferred(),h=harness({addModule:()=>gate.promise});
  const pending=h.audio.microphone(()=>{});await flush();await h.audio.close();
  assert.ok(h.streams[0].tracks.every(track=>track.stops===1));assert.equal(h.contexts[0].closes,1);
  const rejected=assert.rejects(pending,/已关闭/);gate.resolve();await rejected;
  assert.equal(h.nodes.length,0);assert.equal(h.contexts[0].closes,1);
});
test('close during capture resume ignores a saved late callback and releases nodes',async()=>{
  const gate=deferred(),h=harness({resume:()=>gate.promise}),sent=[];
  const pending=h.audio.microphone(value=>sent.push(value));await flush();
  const capture=h.nodes.find(node=>node.kind==='pcm-capture'),late=capture.port.onmessage;
  await h.audio.close();late({data:new ArrayBuffer(8)});
  assert.equal(sent.length,0);assert.equal(capture.port.onmessage,null);
  assert.ok(h.nodes.every(node=>node.disconnects===1));assert.ok(h.streams[0].tracks.every(track=>track.stops===1));
  const rejected=assert.rejects(pending,/已关闭/);gate.resolve();await rejected;
  assert.equal(h.contexts[0].closes,1);
});
test('duplicate microphone calls share one request and capture graph, including after ready',async()=>{
  const gate=deferred(),stream=media(),h=harness({getUserMedia:()=>gate.promise});
  const first=h.audio.microphone(()=>{}),second=h.audio.microphone(()=>{});assert.equal(h.requests,1);
  gate.resolve(stream);const results=await Promise.all([first,second]);assert.ok(results.every(result=>result.echoCancellation));
  await h.audio.microphone(()=>{});assert.equal(h.requests,1);assert.equal(h.contexts.length,1);
  assert.equal(h.nodes.filter(node=>node.kind==='pcm-capture').length,1);
  await h.audio.close();await h.audio.close();assert.equal(h.contexts[0].closes,1);assert.ok(stream.tracks.every(track=>track.stops===1));
});
test('playback module failure closes partial output and makes the instance terminal',async()=>{
  const h=harness({addModule:()=>Promise.reject(Error('module failed'))});await assert.rejects(h.audio.start(),/module failed/);
  assert.equal(h.contexts[0].closes,1);assert.equal(h.nodes.length,0);
  await assert.rejects(h.audio.start(),/已关闭/);await h.audio.close();assert.equal(h.contexts.length,1);
});
test('playback resume failure disconnects player and releases context',async()=>{
  const h=harness({resume:()=>Promise.reject(Error('resume failed'))});await assert.rejects(h.audio.start(),/resume failed/);
  assert.equal(h.contexts[0].closes,1);assert.equal(h.nodes[0].disconnects,1);
  assert.equal(h.nodes[0].port.onmessage,null);assert.equal(h.audio.position.playing,false);
});
test('capture setup failure releases only input and allows retry with working output',async()=>{
  let captureLoads=0;const h=harness({addModule:url=>url.includes('capture')&&++captureLoads===1?Promise.reject(Error('capture failed')):Promise.resolve()});
  await h.audio.start();const output=h.contexts[0];await assert.rejects(h.audio.microphone(()=>{}),/capture failed/);
  assert.equal(output.state,'running');assert.equal(output.closes,0);assert.equal(h.contexts[1].closes,1);
  assert.ok(h.streams[0].tracks.every(track=>track.stops===1));await h.audio.microphone(()=>{});
  assert.equal(h.requests,2);assert.equal(h.contexts.length,3);await h.audio.close();
  assert.ok(h.contexts.every(context=>context.closes===1));assert.ok(h.streams[1].tracks.every(track=>track.stops===1));
});
test('permission denial leaves playback usable and retry has one live stream',async()=>{
  const stream=media();let calls=0;const h=harness({getUserMedia:()=>++calls===1?Promise.reject(Error('denied')):Promise.resolve(stream)});
  await h.audio.start();await assert.rejects(h.audio.microphone(()=>{}),/denied/);
  assert.equal(h.contexts.length,1);assert.equal(h.contexts[0].state,'running');await h.audio.microphone(()=>{});
  assert.equal(h.contexts.length,2);await h.audio.close();assert.ok(stream.tracks.every(track=>track.stops===1));
});
test('close during output resume ignores saved callbacks and cannot complete start',async()=>{
  const gate=deferred(),h=harness({resume:()=>gate.promise});const opening=h.audio.start();await flush();
  const player=h.nodes[0],late=player.port.onmessage;await h.audio.close();late({data:{type:'position',playing:true,sequence:99}});
  assert.equal(h.positions.length,0);assert.equal(h.audio.position.playing,false);
  const rejected=assert.rejects(opening,/已关闭/);gate.resolve();await rejected;
  assert.equal(h.contexts[0].closes,1);assert.equal(player.disconnects,1);
});
test('close attempts both contexts when one rejects and repeated close is idempotent',async()=>{
  const h=harness({close:context=>context.sampleRate===16000?Promise.reject(Error('input close failed')):Promise.resolve()});
  await h.audio.start();await h.audio.microphone(()=>{});const closing=h.audio.close();assert.equal(h.audio.close(),closing);
  await assert.rejects(closing,/input close failed/);assert.ok(h.contexts.every(context=>context.closes===1));
  assert.ok(h.streams[0].tracks.every(track=>track.stops===1));assert.ok(h.nodes.every(node=>node.disconnects===1));
  await assert.rejects(h.audio.microphone(()=>{}),/已关闭/);assert.equal(h.requests,1);
});

test('queued pre-cancel position reports cannot resurrect audio and newer applied reports still work',async()=>{
  const h=harness();await h.audio.start();
  const report=data=>h.audio.player.port.onmessage({data:{type:'position',...data}});
  report({sequence:5,playing:true,appliedCancelBefore:0,sampleOffset:128});
  h.audio.cancel(6);assert.equal(h.audio.position.playing,false);
  for(const position of [
    {sequence:5,playing:true,appliedCancelBefore:0},
    {sequence:7,playing:true,appliedCancelBefore:0},
    {sequence:5,playing:true,appliedCancelBefore:6},
    {sequence:5,playing:false},
  ])report(position);
  assert.equal(h.positions.length,1);assert.equal(h.audio.position.playing,false);
  report({sequence:0,playing:false,queuedSamples:0,appliedCancelBefore:6});
  assert.equal(h.positions.length,2);
  report({sequence:6,playing:true,sampleOffset:128,appliedCancelBefore:6});
  assert.equal(h.audio.position.playing,true);assert.equal(h.positions.length,3);
  await h.audio.close();
});
