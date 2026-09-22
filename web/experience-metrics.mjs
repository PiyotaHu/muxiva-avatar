// Client-only observations. No text/audio in reports or persistence, no
// transport, scheduling or turn decisions. A bounded text-echo match is held
// transiently until acknowledgement (30s at most while input is observed).
// Wall-clock timings never claim acoustic end-to-end latency.
export function createExperienceMetrics({now=()=>performance.now(),limit=40}={}) {
  if(!Number.isInteger(limit)||limit<1||limit>200)throw Error('Invalid metrics limit');
  let records=[],pending=[],cancellation=null,watermark=0;
  const time=()=>{const value=now();return Number.isFinite(value)?value:0;};
  const sequence=value=>Number.isSafeInteger(value)&&value>=0;
  const elapsed=(a,b)=>a==null||b==null?null:Math.max(0,Math.round(b-a));
  const recordFor=value=>records.findLast(item=>item.sequence===value);
  const trim=()=>{if(records.length>limit)records.splice(0,records.length-limit);};
  const startRecord=(value,origin,at)=>{
    const item={sequence:value,origin,started:at,firstText:null,firstAudio:null,
      firstPlayback:null,completed:false,cancelled:false,maxQueueMs:0};
    records.push(item);trim();return item;
  };
  return {
    reset(){records=[];pending=[];cancellation=null;watermark=0;},
    submitted(text){
      if(typeof text!=='string'||!text.trim()||text.length>8000)return;
      const normalized=text.trim(),duplicates=pending.filter(item=>item.text===normalized);
      for(const item of duplicates)item.ambiguous=true;
      pending.push({at:time(),text:normalized,ambiguous:duplicates.length>0});if(pending.length>limit)pending.shift();
    },
    clearSubmissions(){pending=[];},
    cancelRequested(){cancellation={requested:time(),received:null,stopped:null,watermark,
      ambiguous:Boolean(cancellation&&cancellation.stopped===null)};},
    message(message){
      if(!message||typeof message!=='object')return;
      const at=time();
      if(message.type==='cancel'&&sequence(message.before_sequence)){
        const previousWatermark=watermark;
        watermark=Math.max(watermark,message.before_sequence);
        for(const item of records)if(item.sequence<watermark)item.cancelled=true;
        if(cancellation&&!cancellation.ambiguous&&cancellation.received===null&&
          ['authoritative_interrupt','explicit','manual'].includes(message.reason)&&message.before_sequence>previousWatermark&&
          message.before_sequence>cancellation.watermark){cancellation.received=at;cancellation.boundary=message.before_sequence;}
        return;
      }
      const seq=message.sequence;if(!sequence(seq))return;
      if(message.type==='text'&&message.channel==='transcript_in'){
        if(recordFor(seq))return;
        pending=pending.filter(item=>at-item.at<=30000);
        const index=pending.findIndex(item=>item.text===message.text?.trim());
        const submitted=index<0?undefined:pending.splice(index,1)[0];
        // Consume a cancelled echo too, so it cannot steal a later input's
        // timestamp. Repeated outstanding text has no request ID: degrade.
        if(seq<watermark)return;
        const correlated=submitted&&!submitted.ambiguous;
        startRecord(seq,correlated?'text-submitted':'transcript-received',correlated?submitted.at:at);
        return;
      }
      if(seq<watermark)return;
      let item=recordFor(seq);
      const response=(message.type==='text'&&message.channel==='response_in');
      if(!item&&(response||message.type==='audio')){
        // Missing/mismatched transcript is explicit, never attributed to a
        // pending input or made into an apparently faster end-to-end result.
        item=startRecord(seq,'response-observed',at);
      }
      if(!item)return;
      if(response&&typeof message.text==='string'&&message.text.length&&item.firstText===null)item.firstText=at;
      if(message.type==='audio'&&typeof message.pcm==='string'&&message.pcm.length&&item.firstAudio===null)item.firstAudio=at;
      if(message.type==='event'&&message.topic==='muxiva.agent.response.completed')item.completed=true;
    },
    playback(position){
      if(!position||typeof position!=='object')return;
      const at=time();
      if(cancellation&&cancellation.received!==null&&cancellation.stopped===null&&
          sequence(position.appliedCancelBefore)&&position.appliedCancelBefore>=cancellation.boundary&&
          position.playing===false&&position.queuedSamples===0)cancellation.stopped=at;
      if(!sequence(position.sequence)||position.sequence<watermark)return;
      const item=recordFor(position.sequence);if(!item)return;
      if(position.playing===true&&Number.isFinite(position.sampleOffset)&&position.sampleOffset>0&&item.firstPlayback===null)item.firstPlayback=at;
      if(Number.isFinite(position.queuedSamples)&&position.queuedSamples>=0&&Number.isFinite(position.sampleRateHz)&&position.sampleRateHz>0)
        item.maxQueueMs=Math.max(item.maxQueueMs,Math.round(position.queuedSamples/position.sampleRateHz*1000));
    },
    snapshot(){return {
      scope:'browser-observed; firstPlayback is PCM consumption, not acoustic onset',
      records:records.map(item=>({sequence:item.sequence,origin:item.origin,
        firstTextMs:elapsed(item.started,item.firstText),firstAudioPacketMs:elapsed(item.started,item.firstAudio),
        firstPlaybackMs:elapsed(item.started,item.firstPlayback),maxQueueMs:item.maxQueueMs,
        completed:item.completed,cancelled:item.cancelled})),
      cancellation:cancellation?{ackMs:elapsed(cancellation.requested,cancellation.received),
        playbackStoppedMs:elapsed(cancellation.requested,cancellation.stopped),ambiguous:cancellation.ambiguous}:null,
    };},
  };
}
