// Integration harness: deterministic local model fixture, REAL Muxiva/ASR/TTS/Avatar Nodes.
// It is NOT an LLM and is never installed as the production backend.
import {createServer} from 'node:http';
import {once} from 'node:events';
import {WebSocket} from 'ws';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createApp,root} from '../server.mjs';
import {join} from 'node:path';
const requests=[];
assert.ok(!(process.argv.includes('--formatter')&&process.argv.includes('--long')),'Choose one fixture mode');
const formatterParts=['当前温度为26.','25°C，湿度为68.','75%。访问 https://example.com/averylongreferencepaththatspansmultiplechunks 可以查看详情。'];
const fixtureParts=process.argv.includes('--formatter')?formatterParts:[process.argv.includes('--long')?'这是一段用于检查长时间播放稳定性的本地语音。我们正在验证音频、嘴形、取消和队列是否保持同步。'.repeat(6):'你好，这是本地语音链路测试。'];
const fixture=createServer(async(req,res)=>{
  assert.equal(req.headers.authorization,undefined,'Local fixture must never receive model credentials');
  let text='';for await(const chunk of req)text+=chunk;
  const body=JSON.parse(text);requests.push(body);
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  const chunk={id:'local-test-fixture',object:'chat.completion.chunk',created:1,model:'TEST-FIXTURE',choices:[]};
  for(const content of fixtureParts){
    chunk.choices=[{index:0,delta:{role:'assistant',content},finish_reason:null}];
    res.write('data: '+JSON.stringify(chunk)+'\n\n');
    await new Promise(resolve=>setImmediate(resolve));
  }
  chunk.choices=[{index:0,delta:{},finish_reason:'stop'}];
  res.end('data: '+JSON.stringify(chunk)+'\n\ndata: [DONE]\n\n');
});
fixture.listen(0,'127.0.0.1');await once(fixture,'listening');
process.env.MUXIVA_MODEL_BASE_URL='http://127.0.0.1:'+fixture.address().port+'/v1';
process.env.MUXIVA_MODEL_ID='TEST-FIXTURE';
process.env.MUXIVA_MODEL_AUTH_MODE='none';
process.env.MUXIVA_TEST_FIXTURE='1';
delete process.env.MUXIVA_MODEL_API_KEY;
delete process.env.DASHSCOPE_WORKSPACE_ID;
const app=createApp({port:process.argv.includes('--serve')?4180:0});
const url=await app.start();
const shutdown=async()=>{await app.close();fixture.closeAllConnections();await new Promise(r=>fixture.close(r));};
for(const sig of ['SIGINT','SIGTERM'])process.on(sig,async()=>{await shutdown();process.exit(0);});
if(process.argv.includes('--serve'))console.log('TEST FIXTURE ONLY: '+url);
else {
  let ws;
  try{
    const response=await fetch(url+'/api/session',{method:'POST',headers:{Origin:url}});
    const session=await response.json();assert.equal(response.status,201);
    ws=new WebSocket(session.url);const messages=[];
    ws.on('message',raw=>messages.push(JSON.parse(raw.toString())));
    await once(ws,'open');ws.send(JSON.stringify({role:'client',session:session.session,token:session.token}));
    const wait=async(fn,description,timeout=45000)=>{
      const deadline=Date.now()+timeout;
      while(!fn()){
        const error=messages.find(m=>m.type==='error');
        if(error)throw Error(error.message);
        assert.ok(Date.now()<deadline,'Timed out: '+description);
        await new Promise(r=>setTimeout(r,25));
      }
    };
    await wait(()=>messages.some(m=>m.status==='media-ready'),'real graph and transport ready');
    const begin=performance.now();
    ws.send(JSON.stringify({type:'text',text:'你好，做一次语音链路测试。'}));
    await wait(()=>messages.some(m=>m.type==='audio'),'first real configured TTS audio');
    const firstAudioMs=Math.round(performance.now()-begin);
    await wait(()=>messages.some(m=>m.topic==='muxiva.avatar.animation'),'real Avatar Node animation');
    const first=messages.find(m=>m.type==='audio');
    const animation=messages.find(m=>m.topic==='muxiva.avatar.animation');
    assert.equal(first.sequence,animation.payload.sequence);
    assert.equal(first.sample_rate_hz,animation.payload.sample_rate_hz);
    assert.equal(first.sample_offset,animation.payload.sample_start);
    assert.ok(Buffer.from(first.pcm,'base64').length>0);
    assert.equal(requests[0].model,'TEST-FIXTURE');
    // The rich chat branch must retain original content. Actual formatter
    // text_out is asserted separately by Rust Node tests, not inferred here.
    await wait(()=>messages.filter(m=>m.type==='text'&&m.channel==='response_in'&&m.sequence===first.sequence).map(m=>m.text).join('')===fixtureParts.join(''),'original Agent text preserved');
    const index=messages.length;
    ws.send(JSON.stringify({type:'interrupt'}));
    await wait(()=>messages.slice(index).some(m=>m.type==='cancel'),'canonical controller cancel');
    const cancel=messages.slice(index).find(m=>m.type==='cancel');
    assert.ok(cancel.before_sequence>first.sequence);
    await new Promise(r=>setTimeout(r,400));
    const ci=messages.indexOf(cancel);
    assert.ok(!messages.slice(ci+1).some(m=>m.type==='audio'&&m.sequence<cancel.before_sequence),'late old PCM must not revive');
    // Feed an actual local TTS recording through the microphone transport at real-time speed.
    const wav=readFileSync(join(root,'.artifacts/speech-kokoro-fp32/speaker-3-case-1.wav'));
    let dataOffset=12,pcm,rate;
    while(dataOffset+8<=wav.length){const kind=wav.toString('ascii',dataOffset,dataOffset+4),size=wav.readUInt32LE(dataOffset+4);if(kind==='fmt ')rate=wav.readUInt32LE(dataOffset+12);if(kind==='data'){pcm=wav.subarray(dataOffset+8,dataOffset+8+size);break;}dataOffset+=8+size+(size%2);}
    assert.equal(rate,24000);
    const mic=Buffer.alloc(Math.floor(pcm.length/2*16000/rate)*2+32000);
    for(let i=0;i<(mic.length-32000)/2;i++){const position=i*rate/16000,lo=Math.floor(position),f=position-lo;const a=pcm.readInt16LE(lo*2),b=pcm.readInt16LE(Math.min(lo+1,pcm.length/2-1)*2);mic.writeInt16LE(Math.round(a+(b-a)*f),i*2);}
    const voiceIndex=messages.length;
    for(let i=0;i<mic.length;i+=1280){ws.send(mic.subarray(i,i+1280));await new Promise(r=>setTimeout(r,40));}
    await wait(()=>messages.slice(voiceIndex).some(m=>m.type==='text'&&m.channel==='transcript_in'),'real ASR final');
    const voiceMessages=messages.slice(voiceIndex),final=voiceMessages.find(m=>m.type==='text'&&m.channel==='transcript_in');
    assert.ok(final.text.includes('数字人'),'ASR should recognize the real recording');
    const preview=voiceMessages.find(m=>m.type==='text'&&m.channel==='preview_in');
    assert.ok(preview,'streaming ASR preview is required');
    assert.equal(preview.sequence,final.sequence);
    const early=voiceMessages.find(m=>m.type==='cancel'&&m.reason==='validated_partial');
    assert.ok(early,'meaningful ASR preview must cancel before final');
    assert.ok(voiceMessages.indexOf(early)<voiceMessages.indexOf(final));
    await wait(()=>messages.slice(voiceIndex).some(m=>m.type==='audio'&&m.sequence===final.sequence),'audio answer to ASR prompt');
    assert.equal(requests.length,2,'one persistent Agent request per admitted input');
    if(process.argv.includes('--long')){
      const soakStart=performance.now();
      await new Promise(r=>setTimeout(r,25000));
      const packets=messages.slice(voiceIndex).filter(m=>m.type==='audio'&&m.sequence===final.sequence);
      let samples=0;for(const packet of packets){assert.equal(packet.sample_offset,samples,'long PCM stream cannot have gaps or duplicates');samples+=packet.sample_count;}
      assert.ok(samples/24000>20,'long playback must keep delivering audio');
      assert.ok(samples/24000<(performance.now()-soakStart)/1000+2,'media boundary must pace long speech rather than enqueue entire response');
      const interruptIndex=messages.length,interruptStart=performance.now();ws.send(JSON.stringify({type:'interrupt'}));
      await wait(()=>messages.slice(interruptIndex).some(m=>m.type==='cancel'),'long speech interrupt');
      console.log(JSON.stringify({test:'long-speech',audioSeconds:samples/24000,packets:packets.length,transportCancelMs:Math.round(performance.now()-interruptStart)},null,2));
    }
    console.log(JSON.stringify({test:'real-graph-with-local-model-fixture',fixtureMode:process.argv.includes('--formatter')?'formatter':process.argv.includes('--long')?'long':'normal',firstAudioMs,pcmPackets:messages.filter(m=>m.type==='audio').length,animationEvents:messages.filter(m=>m.topic==='muxiva.avatar.animation').length,cancelValidated:true,asrTranscript:final.text,previewInterruptedBeforeFinal:true,modelCalls:requests.length},null,2));
    ws.send(JSON.stringify({type:'close'}));ws.close();
  } finally {ws?.close();await shutdown();}
}
