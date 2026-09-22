import test from 'node:test';
import assert from 'node:assert/strict';
import {createExperienceMetrics} from '../web/experience-metrics.mjs';
function fixture(options={}){let at=0;return {metrics:createExperienceMetrics({now:()=>at,...options}),set:value=>{at=value;}};}
const transcript=sequence=>({type:'text',channel:'transcript_in',sequence,text:'private input'});
const text=sequence=>({type:'text',channel:'response_in',sequence,text:'private response'});
const audio=sequence=>({type:'audio',sequence,pcm:'private audio'});
const position=(sequence,options={})=>({sequence,playing:true,sampleOffset:128,queuedSamples:2400,sampleRateHz:24000,...options});
test('text latency begins at submit and playback requires consumed PCM, not packet arrival',()=>{
  const {metrics:m,set}=fixture();set(10);m.submitted('private input');set(20);m.message(transcript(1));
  set(90);m.message(text(1));set(140);m.message(audio(1));set(150);m.playback(position(1,{playing:false,sampleOffset:0}));
  assert.equal(m.snapshot().records[0].firstPlaybackMs,null);
  set(180);m.playback(position(1));set(230);m.playback(position(1));
  assert.deepEqual(m.snapshot().records[0],{sequence:1,origin:'text-submitted',firstTextMs:80,
    firstAudioPacketMs:130,firstPlaybackMs:170,maxQueueMs:100,completed:false,cancelled:false});
});
test('voice origin explicitly starts at received final transcript, not guessed end of speech',()=>{
  const {metrics:m,set}=fixture();set(900);m.message(transcript(2));set(1200);m.message(audio(2));
  assert.equal(m.snapshot().records[0].origin,'transcript-received');
  assert.equal(m.snapshot().records[0].firstAudioPacketMs,300);
});
test('no transcript origin is marked unknown response observation without guessing association',()=>{
  const {metrics:m,set}=fixture();m.submitted('private input');set(200);m.message(text(3));
  assert.equal(m.snapshot().records[0].origin,'response-observed');
});
test('cancel requires receipt then stopped empty worklet, and late packets cannot revive measurement',()=>{
  const {metrics:m,set}=fixture();m.message(transcript(4));m.message(audio(4));
  set(100);m.cancelRequested();set(110);m.playback(position(4,{playing:false,queuedSamples:0}));
  assert.equal(m.snapshot().cancellation.playbackStoppedMs,null);
  set(125);m.message({type:'cancel',before_sequence:5,reason:'explicit'});set(145);m.playback(position(0,{playing:false,queuedSamples:0,appliedCancelBefore:5}));
  set(160);m.message(audio(4));m.playback(position(4));
  assert.deepEqual(m.snapshot().cancellation,{ackMs:25,playbackStoppedMs:45,ambiguous:false});
  assert.equal(m.snapshot().records[0].firstPlaybackMs,null);
  assert.equal(m.snapshot().records[0].cancelled,true);
});
test('fresh sessions reset sequence watermarks and transient pending inputs',()=>{
  const {metrics:m}=fixture();m.message({type:'cancel',before_sequence:10});m.submitted('private input');m.cancelRequested();m.reset();
  m.message(transcript(1));assert.equal(m.snapshot().records[0].origin,'transcript-received');
  assert.equal(m.snapshot().cancellation,null);
});
test('metrics retain no prompt, transcript, PCM, provider key or arbitrary event payload',()=>{
  const {metrics:m}=fixture();m.message(transcript(1));m.message(text(1));m.message(audio(1));
  m.message({type:'event',topic:'muxiva.agent.response.completed',sequence:1,payload:{token:'private key'}});
  assert.equal(m.snapshot().records[0].completed,true);
  assert.ok(!JSON.stringify(m.snapshot()).includes('private'));
});
test('memory is bounded and snapshots cannot mutate internal records',()=>{
  const {metrics:m}=fixture({limit:2});for(let seq=1;seq<=10;seq++)m.message(transcript(seq));
  const result=m.snapshot();assert.deepEqual(result.records.map(x=>x.sequence),[9,10]);result.records[0].origin='corrupt';
  assert.notEqual(m.snapshot().records[0].origin,'corrupt');
});
test('malformed input and out-of-order timestamps never yield invalid durations',()=>{
  const {metrics:m,set}=fixture();for(const value of [null,{},true,{sequence:NaN},{type:'audio',sequence:-1,pcm:'a'}])m.message(value);
  assert.equal(m.snapshot().records.length,0);set(100);m.message(transcript(1));set(90);m.message(text(1));
  m.playback(position(1,{queuedSamples:NaN,sampleRateHz:0}));
  assert.equal(m.snapshot().records[0].firstTextMs,0);
  assert.equal(m.snapshot().records[0].maxQueueMs,0);
  for(const limit of [0,201,1.5,NaN])assert.throws(()=>createExperienceMetrics({limit}));
});
test('input correlation requires a matching recent echo and is cleared when voice capture starts',()=>{
  const {metrics:m,set}=fixture();m.submitted('different input');m.message(transcript(1));
  assert.equal(m.snapshot().records[0].origin,'transcript-received');
  m.submitted('private input');set(31000);m.message(transcript(2));
  assert.equal(m.snapshot().records[1].origin,'transcript-received');
  m.submitted('private input');m.clearSubmissions();m.message(transcript(3));
  assert.equal(m.snapshot().records[2].origin,'transcript-received');
});
test('automatic partial cancellation cannot be mistaken for a manual button acknowledgement',()=>{
  const {metrics:m,set}=fixture();set(200);m.cancelRequested();
  set(205);m.message({type:'cancel',reason:'validated_partial',before_sequence:2});
  assert.equal(m.snapshot().cancellation.ackMs,null);
  set(300);m.message({type:'cancel',reason:'authoritative_interrupt',before_sequence:3});
  assert.equal(m.snapshot().cancellation.ackMs,100);
});
test('rapid stop clicks without correlation IDs are explicitly ambiguous',()=>{
  const {metrics:m,set}=fixture();m.cancelRequested();set(50);m.cancelRequested();
  set(60);m.message({type:'cancel',reason:'explicit',before_sequence:4});
  assert.equal(m.snapshot().cancellation.ambiguous,true);assert.equal(m.snapshot().cancellation.ackMs,null);
});
test('repeated pending text and cancelled echoes cannot produce precise false input latency',()=>{
  const {metrics:m,set}=fixture();m.submitted('private input');set(50);m.submitted('private input');
  m.message({type:'cancel',reason:'validated_partial',before_sequence:2});
  set(60);m.message(transcript(1));set(90);m.message(transcript(2));set(100);m.message(text(2));
  assert.equal(m.snapshot().records[0].origin,'transcript-received');
  assert.equal(m.snapshot().records[0].firstTextMs,10);
});
test('queued stale idle reports cannot acknowledge cancellation before the worklet applied its watermark',()=>{
  const {metrics:m,set}=fixture();m.cancelRequested();set(10);m.message({type:'cancel',reason:'explicit',before_sequence:5});
  set(11);m.playback(position(0,{playing:false,queuedSamples:0,appliedCancelBefore:0}));
  assert.equal(m.snapshot().cancellation.playbackStoppedMs,null);
  set(30);m.playback(position(0,{playing:false,queuedSamples:0,appliedCancelBefore:5}));
  assert.equal(m.snapshot().cancellation.playbackStoppedMs,30);
});
