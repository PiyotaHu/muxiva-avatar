const clamp=v=>Math.max(0,Math.min(1,Number.isFinite(v)?v:0));
// Stores numeric audio features only; raw PCM is never retained.
export class LipSyncTimeline {
  constructor({frameMs=20,maxFrames=900}={}){this.frameMs=frameMs;this.maxFrames=maxFrames;this.streams=new Map();this.dropped=0;}
  queue({samples,sampleOffset=0,sampleRateHz=24000,sequence=0,streamId='assistant'}={}){
    if(!(samples instanceof Float32Array)||!Number.isSafeInteger(sampleOffset)||sampleOffset<0||!Number.isFinite(sampleRateHz)||sampleRateHz<8000||!Number.isSafeInteger(sequence)||sequence<0)return false;
    const size=Math.max(32,Math.round(sampleRateHz*this.frameMs/1000)),stream=this.streams.get(streamId)||{sequence,frames:[]};
    if(sequence<stream.sequence)return false;if(sequence>stream.sequence){stream.sequence=sequence;stream.frames.length=0;}
    for(let start=0;start<samples.length;start+=size){const frame=samples.subarray(start,Math.min(samples.length,start+size));if(frame.length)stream.frames.push({sampleOffset:sampleOffset+start,sampleCount:frame.length,...this._features(frame,sampleRateHz)});}
    if(stream.frames.length>this.maxFrames){const remove=stream.frames.length-this.maxFrames;stream.frames.splice(0,remove);this.dropped+=remove;}this.streams.set(streamId,stream);return true;
  }
  sample({streamId='assistant',sequence=0,sampleOffset=0,playing=false}={}){if(!playing)return this._closed();const stream=this.streams.get(streamId);if(!stream||stream.sequence!==sequence||!Number.isFinite(sampleOffset))return null;while(stream.frames.length&&stream.frames[0].sampleOffset+stream.frames[0].sampleCount<=sampleOffset)stream.frames.shift();const frame=stream.frames[0];return frame&&sampleOffset>=frame.sampleOffset?frame:null;}
  reset({streamId,beforeSequence}={}){if(streamId===undefined||beforeSequence===undefined){this.streams.clear();return;}const stream=this.streams.get(streamId);if(stream&&stream.sequence<beforeSequence)this.streams.delete(streamId);}
  _closed(){return {aa:0,ih:0,ou:0,ee:0,oh:0};}
  _features(samples,rate){let sum=0;for(const sample of samples)sum+=sample*sample;const open=clamp((Math.sqrt(sum/samples.length)-.008)/.16);if(open<.015)return this._closed();const bands=[350,600,900,1500,2400].map(f=>this._band(samples,rate,f)),total=Math.max(1e-8,bands.reduce((a,b)=>a+b,0)),n=bands.map(v=>v/total);return {aa:open*clamp(.35+n[0]+n[1]*.45),oh:open*clamp(.12+n[1]+n[2]*.35),ou:open*clamp(.08+n[0]*.55+n[2]*.30),ee:open*clamp(.08+n[3]*.9+n[4]*.35),ih:open*clamp(.08+n[2]*.65+n[3]*.55)};}
  _band(samples,rate,f){const omega=2*Math.PI*f/rate;let real=0,imaginary=0;for(let i=0;i<samples.length;i++){const window=.5-.5*Math.cos(2*Math.PI*i/Math.max(1,samples.length-1));real+=samples[i]*window*Math.cos(omega*i);imaginary-=samples[i]*window*Math.sin(omega*i);}return real*real+imaginary*imaginary;}
}
