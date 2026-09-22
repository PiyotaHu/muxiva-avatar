import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
function make(){
 let Processor;const reports=[];
 class Base{constructor(){this.port={postMessage:value=>reports.push(value)};}}
 vm.runInNewContext(readFileSync(new URL('../web/playback-worklet.js',import.meta.url),'utf8'),{AudioWorkletProcessor:Base,sampleRate:24000,registerProcessor:(name,type)=>{Processor=type;}});
 const node=new Processor();
 const message=value=>node.port.onmessage({data:value});
 const render=(size=128)=>{const out=new Float32Array(size);node.process([],[[out]]);return out;};
 return {node,message,render,reports};
}
test('playback clock only advances for actually consumed PCM, not queued chunks',()=>{
 const {node,message,render}=make();
 message({type:'audio',sequence:1,sampleOffset:0,streamId:'assistant',samples:new Float32Array(960).fill(.5)});
 assert.equal(node.active,null);render();
 assert.equal(node.active.sampleOffset,128);assert.equal(node.queued,832);
 render(832);assert.equal(node.active.sampleOffset,960);
 render();assert.equal(node.active.sampleOffset,960);assert.equal(node.playing,false);
});
test('canonical cancellation drops old queued and late PCM but preserves same-sequence replacement',()=>{
 const {node,message,render}=make();
 message({type:'audio',sequence:1,sampleOffset:0,samples:new Float32Array(960).fill(.7)});
 render();
 message({type:'cancel',beforeSequence:2});
 message({type:'audio',sequence:1,sampleOffset:960,samples:new Float32Array(960).fill(.7)});
 assert.ok(render().every(x=>x===0));
 message({type:'audio',sequence:2,sampleOffset:0,samples:new Float32Array(128).fill(.2)});
 assert.ok(render().every(x=>Math.abs(x-.2)<.00001));assert.equal(node.active.sequence,2);
});
test('playback queue has a fixed safety limit',()=>{
 const {node,message,reports}=make();
 message({type:'audio',sequence:1,sampleOffset:0,samples:new Float32Array(24000*31)});
 assert.equal(node.queued,0);assert.ok(reports.some(x=>x.type==='error'));
});
test('position reports acknowledge only cancellation watermarks already applied by the worklet',()=>{
 const {message,render,reports}=make();
 message({type:'audio',sequence:1,sampleOffset:0,samples:new Float32Array(24000).fill(.5)});
 render(480);assert.equal(reports.at(-1).appliedCancelBefore,0);
 const prior=reports.at(-1);message({type:'cancel',beforeSequence:2});
 const stopped=reports.at(-1);assert.equal(stopped.appliedCancelBefore,2);
 assert.equal(stopped.queuedSamples,0);assert.equal(stopped.playing,false);
 assert.equal(prior.appliedCancelBefore,0,'previously queued reports remain distinguishable');
});
