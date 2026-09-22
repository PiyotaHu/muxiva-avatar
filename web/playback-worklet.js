class PcmPlayback extends AudioWorkletProcessor {
  constructor(){
    super();this.queue=[];this.head=0;this.queued=0;this.before=0;this.frames=0;this.active=null;this.playing=false;this.started=false;this.underruns=0;
    this.port.onmessage=({data:m})=>{
      if(m.type==='cancel'){
        this.before=Math.max(this.before,m.beforeSequence||0);
        this.queue=this.queue.filter(x=>x.sequence>=this.before);
        this.head=this.queue[0]?.index||0;
        this.queued=this.queue.reduce((n,x)=>n+x.samples.length-(x.index||0),0);
        if(this.active&&this.active.sequence<this.before){this.active=null;this.playing=false;this.report();}
      }else if(m.type==='audio'&&m.sequence>=this.before){
        if(this.queued+m.samples.length>sampleRate*30){this.port.postMessage({type:'error',message:'播放缓冲超过30秒，会话已停止以避免内存增长。'});this.queue=[];this.queued=0;return;}
        this.queue.push({...m,index:0});this.queued+=m.samples.length;
      }
    };
  }
  report(){this.port.postMessage({type:'position',...(this.active||{sequence:0,sampleOffset:0}),playing:this.playing,queuedSamples:this.queued,underruns:this.underruns,sampleRateHz:sampleRate,appliedCancelBefore:this.before});}
  process(inputs,outputs){
    const out=outputs[0][0];if(!out)return true;
    for(let i=0;i<out.length;i++){
      const chunk=this.queue[0];
      if(!chunk){
        out[i]=0;
        if(this.playing){this.playing=false;this.underruns++;this.report();}
        continue;
      }
      if(chunk.sequence<this.before){this.queued-=chunk.samples.length-chunk.index;this.queue.shift();i--;continue;}
      out[i]=chunk.samples[chunk.index++];this.queued--;
      this.active={sequence:chunk.sequence,sampleOffset:chunk.sampleOffset+chunk.index,streamId:chunk.streamId||'assistant'};
      this.playing=true;
      if(chunk.index>=chunk.samples.length)this.queue.shift();
    }
    this.frames+=out.length;if(this.frames>=sampleRate/50){this.frames=0;this.report();}
    return true;
  }
}
registerProcessor('pcm-playback',PcmPlayback);
