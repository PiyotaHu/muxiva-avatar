// Opt-in acceptance test against the already running application; performs two real model requests.
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {WebSocket} from 'ws';
if(!process.argv.includes('--run'))throw Error('This test uses the configured model and may incur API charges. Pass --run explicitly.');
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const url='http://127.0.0.1:4174';
const status=await fetch(url+'/api/status').then(r=>r.json());
assert.ok(status.modelConfigured&&!status.testFixture,'Real model configuration is required');
assert.equal(status.activeSessions,0,'Do not interrupt an existing user conversation');
const response=await fetch(url+'/api/session',{method:'POST',headers:{Origin:url}});
assert.equal(response.status,201);
const session=await response.json();
const ws=new WebSocket(session.url,{headers:{Origin:url}}),messages=[];
const start=performance.now();
ws.on('message',raw=>messages.push({...JSON.parse(raw.toString()),receivedMs:performance.now()-start}));
const wait=async(predicate,label,timeout=60000)=>{
  const deadline=Date.now()+timeout;
  while(!predicate()){
    // Never dump upstream errors or credential-bearing headers to the test console.
    assert.ok(!messages.some(m=>m.type==='error'||/failed/.test(m.topic||'')),'Application reported a failure; inspect its redacted local diagnostics.');
    assert.ok(Date.now()<deadline,'Timed out: '+label);
    await new Promise(r=>setTimeout(r,25));
  }
};
try{
  await once(ws,'open');ws.send(JSON.stringify({role:'client',session:session.session,token:session.token}));
  await wait(()=>messages.some(m=>m.status==='media-ready'),'media ready');
  const promptMs=performance.now()-start;
  ws.send(JSON.stringify({type:'text',text:'中国的陆地面积大约有多大？请用一句简短的话回答。'}));
  await wait(()=>messages.some(m=>m.type==='audio'),'real model to local TTS audio');
  const firstAudio=messages.find(m=>m.type==='audio'),seq=firstAudio.sequence;
  await wait(()=>messages.some(m=>m.topic==='muxiva.agent.response.completed'&&m.sequence===seq),'real model completed');
  await wait(()=>messages.some(m=>m.topic==='muxiva.avatar.animation'&&m.sequence===seq),'avatar animation');
  const firstText=messages.find(m=>m.type==='text'&&m.channel==='response_in'&&m.sequence===seq);
  const answer=messages.filter(m=>m.type==='text'&&m.channel==='response_in'&&m.sequence===seq).map(m=>m.text).join('');
  assert.ok(answer.length>0,'Model must return text');
  const animation=messages.find(m=>m.topic==='muxiva.avatar.animation'&&m.sequence===seq);
  assert.equal(firstAudio.sample_rate_hz,animation.payload.sample_rate_hz);
  assert.equal(firstAudio.sample_offset,animation.payload.sample_start);
  const cancelIndex=messages.length,cancelMs=performance.now()-start;
  ws.send(JSON.stringify({type:'interrupt'}));
  await wait(()=>messages.slice(cancelIndex).some(m=>m.type==='cancel'),'explicit cancellation');
  const cancelled=messages.slice(cancelIndex).find(m=>m.type==='cancel');
  await new Promise(r=>setTimeout(r,400));
  assert.ok(!messages.slice(messages.indexOf(cancelled)+1).some(m=>m.type==='audio'&&m.sequence<cancelled.before_sequence),'Cancelled PCM must not revive');

  const wav=readFileSync(join(root,'.artifacts/speech-kokoro-fp32/speaker-3-case-1.wav'));
  let offset=12,pcm,rate;
  while(offset+8<=wav.length){const kind=wav.toString('ascii',offset,offset+4),size=wav.readUInt32LE(offset+4);if(kind==='fmt ')rate=wav.readUInt32LE(offset+12);if(kind==='data'){pcm=wav.subarray(offset+8,offset+8+size);break;}offset+=8+size+(size%2);}
  assert.equal(rate,24000);
  const count=Math.floor(pcm.length/2*16000/rate),mic=Buffer.alloc(count*2+32000);
  for(let i=0;i<count;i++){const p=i*rate/16000,lo=Math.floor(p),f=p-lo,a=pcm.readInt16LE(lo*2),b=pcm.readInt16LE(Math.min(lo+1,pcm.length/2-1)*2);mic.writeInt16LE(Math.round(a+(b-a)*f),i*2);}
  const voiceIndex=messages.length;
  for(let i=0;i<mic.length;i+=1280){ws.send(mic.subarray(i,i+1280));await new Promise(r=>setTimeout(r,40));}
  await wait(()=>messages.slice(voiceIndex).some(m=>m.type==='text'&&m.channel==='transcript_in'),'local ASR final');
  const voice=messages.slice(voiceIndex),final=voice.find(m=>m.type==='text'&&m.channel==='transcript_in');
  const preview=voice.find(m=>m.type==='text'&&m.channel==='preview_in');
  const early=voice.find(m=>m.type==='cancel'&&m.reason==='validated_partial');
  assert.ok(final.text.includes('数字人'));assert.equal(preview?.sequence,final.sequence);
  assert.ok(early&&early.receivedMs<final.receivedMs,'Meaningful ASR preview must cancel before final');
  await wait(()=>messages.slice(voiceIndex).some(m=>m.type==='audio'&&m.sequence===final.sequence),'real response to local ASR');
  const voiceAudio=messages.slice(voiceIndex).find(m=>m.type==='audio'&&m.sequence===final.sequence);
  const report={test:'real-configured-model-and-local-speech',date:new Date().toISOString(),answer,
    firstTextMs:Math.round(firstText.receivedMs-promptMs),firstAudioMs:Math.round(firstAudio.receivedMs-promptMs),
    audioAvatarClockAligned:true,transportCancelMs:Math.round(cancelled.receivedMs-cancelMs),oldPcmSuppressed:true,
    asrTranscript:final.text,previewInterruptedBeforeFinal:true,asrFinalToAudioMs:Math.round(voiceAudio.receivedMs-final.receivedMs),
    input:'typed question + locally generated speech recording; not a physical microphone',realModelRequests:2};
  mkdirSync(join(root,'.artifacts'),{recursive:true});
  writeFileSync(join(root,'.artifacts/live-model.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
} finally {
  if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify({type:'close'}));
  ws.close();
  const deadline=Date.now()+10000;
  while(Date.now()<deadline){const state=await fetch(url+'/api/status').then(r=>r.json());if(state.activeSessions===0)break;await new Promise(r=>setTimeout(r,100));}
  assert.equal((await fetch(url+'/api/status').then(r=>r.json())).activeSessions,0,'Test session must release its child processes');
}
