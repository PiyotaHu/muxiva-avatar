const stopTracks=stream=>{for(const track of stream?.getTracks()||[])try{track.stop();}catch{}};
const disconnect=node=>{try{node?.disconnect();}catch{}};
const closeContexts=async(...values)=>{
  const results=await Promise.allSettled([...new Set(values)].filter(Boolean).map(context=>
    Promise.resolve().then(()=>context.state==='closed'?undefined:context.close())));
  const failure=results.find(result=>result.status==='rejected');if(failure)throw failure.reason;
};
export class LocalAudio {
  constructor(onPosition,onError,onAudio){this.onPosition=onPosition;this.onError=onError;this.onAudio=onAudio;this.position={sequence:0,sampleOffset:0,playing:false,streamId:'assistant',sampleRateHz:24000};this.before=0;this.closed=false;this.starting=null;this.microphonePending=null;}
  assertOpen(){if(this.closed)throw Error('音频会话已关闭，请重新连接。');}
  async start(){
    this.assertOpen();if(this.starting)return this.starting;
    this.starting=(async()=>{
      try{
        this.output=new AudioContext({sampleRate:24000,latencyHint:'interactive'});
        await this.output.audioWorklet.addModule('/playback-worklet.js');this.assertOpen();
        this.player=new AudioWorkletNode(this.output,'pcm-playback',{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[1]});
        this.player.connect(this.output.destination);
        this.player.port.onmessage=({data})=>{
          if(this.closed)return;
          if(data.type==='position'){
            // Reports queued before cancellation must not resurrect old audio
            // in either the renderer, UI or measurement consumer.
            if(this.before>0&&(!Number.isSafeInteger(data.appliedCancelBefore)||data.appliedCancelBefore<this.before))return;
            if(data.playing&&data.sequence<this.before)return;
            this.position=data;this.onPosition?.(data);
          }else this.onError?.(data.message);
        };
        await this.output.resume();this.assertOpen();
      }catch(error){await this.close().catch(()=>undefined);throw error;}
    })();return this.starting;
  }
  add(message){
    if(this.closed||!this.player||message.sequence<this.before)return;
    if(message.sample_rate_hz!==this.output.sampleRate||message.channels!==1)throw Error('不支持的播放音频格式');
    const binary=atob(message.pcm);const view=new DataView(new ArrayBuffer(binary.length));
    for(let i=0;i<binary.length;i++)view.setUint8(i,binary.charCodeAt(i));
    const samples=new Float32Array(binary.length/2);
    for(let i=0;i<samples.length;i++)samples[i]=view.getInt16(i*2,true)/32768;
    this.onAudio?.({samples,sequence:message.sequence,sampleOffset:message.sample_offset,sampleRateHz:message.sample_rate_hz,streamId:message.stream_id});
    this.player.port.postMessage({type:'audio',samples,sequence:message.sequence,sampleOffset:message.sample_offset,streamId:message.stream_id},[samples.buffer]);
  }
  cancel(beforeSequence){
    this.before=Math.max(this.before,beforeSequence);
    this.player?.port.postMessage({type:'cancel',beforeSequence:this.before});
    if(this.position.sequence<this.before)this.position={...this.position,playing:false};
  }
  async microphone(send){
    this.assertOpen();if(this.microphonePending)return this.microphonePending;
    if(this.stream)return this.stream.getAudioTracks()[0].getSettings();
    this.microphonePending=(async()=>{
      let acquired;
      try{
        acquired=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});
        if(this.closed){stopTracks(acquired);this.assertOpen();}
        this.stream=acquired;this.input=new AudioContext({sampleRate:16000,latencyHint:'interactive'});
        await this.input.audioWorklet.addModule('/capture-worklet.js');this.assertOpen();
        this.capture=new AudioWorkletNode(this.input,'pcm-capture');
        this.capture.port.onmessage=({data})=>{if(!this.closed)send(data);};
        this.source=this.input.createMediaStreamSource(acquired);this.source.connect(this.capture);
        this.silence=this.input.createGain();this.silence.gain.value=0;
        this.capture.connect(this.silence).connect(this.input.destination);
        await this.input.resume();this.assertOpen();
        return acquired.getAudioTracks()[0].getSettings();
      }catch(error){
        if(this.closed)await this.closing?.catch(()=>undefined);
        else await this.clearInput().catch(()=>undefined);
        throw error;
      }finally{this.microphonePending=null;}
    })();return this.microphonePending;
  }
  mute(value){this.capture?.port.postMessage({enabled:!value});for(const track of this.stream?.getTracks()||[])track.enabled=!value;}
  clearInput(){
    const input=this.input;stopTracks(this.stream);
    if(this.capture)this.capture.port.onmessage=null;
    for(const node of [this.source,this.capture,this.silence])disconnect(node);
    this.stream=this.input=this.source=this.capture=this.silence=null;
    return closeContexts(input);
  }
  close(){
    if(this.closing)return this.closing;
    this.closed=true;this.position={...this.position,playing:false,queuedSamples:0};
    if(this.player)this.player.port.onmessage=null;disconnect(this.player);
    const inputClose=this.clearInput();
    this.closing=(async()=>{
      const results=await Promise.allSettled([inputClose,closeContexts(this.output)]);
      const failure=results.find(result=>result.status==='rejected');if(failure)throw failure.reason;
    })();return this.closing;
  }
}
