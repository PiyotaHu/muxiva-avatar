import assert from 'node:assert/strict';
import test from 'node:test';
import {IllustrationMotion,ILLUSTRATION_MOTION_LIMITS} from '../web/illustration-motion.mjs';

// Exercise the public motion contract independently from the shader/atlas.
// Pixels, masks, camera projection and visual resemblance need renderer QA;
// nonzero motion parameters alone do not prove any of those properties.
const quiet={breathingAmount:0,idleAmount:0,headYawAmount:0,headTiltAmount:0,
  speechAmount:0,gestureAmount:0,activityAmount:0};
const input={playing:false,energy:0,streamId:'assistant',sequence:1};
const tick=(motion,overrides={},dt=1/60)=>motion.update({...input,...overrides,deltaSeconds:dt});
function advance(motion,seconds,overrides={},fps=60){
  let result;
  for(let frame=0;frame<Math.round(seconds*fps);frame++) result=tick(motion,overrides,1/fps);
  return result;
}
function check(params){
  for(const [key,[min,max]] of Object.entries(ILLUSTRATION_MOTION_LIMITS)){
    assert.ok(Number.isFinite(params[key]),key+' is finite');
    assert.ok(params[key]>=min&&params[key]<=max,key+' is bounded');
  }
  for(const key of ['gazeX','gazeY','headPitch','shoulder','hipShift','smile'])
    assert.ok(Number.isFinite(params[key]),'interaction contract exposes '+key);
  assert.equal(params.leftHand*params.rightHand,0,'there is never a two-hand crossfade');
}
const gestureSignal=params=>Math.max(params.leftHand,params.rightHand,params.smile,params.nod,Math.abs(params.headPitch));
const allZero=params=>Object.values(params).forEach(value=>assert.equal(value,0));
function peakInteraction(motion,interaction,seconds=4,overrides={}){
  let peak=0,last;
  for(let frame=0;frame<Math.round(seconds*60);frame++){
    last=tick(motion,{...overrides,interaction});check(last);
    assert.equal(last.mouthOpen,0,'UI interactions never synthesize a mouth opening');
    peak=Math.max(peak,gestureSignal(last));
  }
  return {peak,last};
}

test('attention eyes lead the head, with sign-consistent bounded response',()=>{
  const options={...quiet,headYawAmount:1,attentionAmount:1};
  const watched=new IllustrationMotion(options),control=new IllustrationMotion(options);
  const attention={x:1,y:1,active:true};
  const first=tick(watched,{attention},.02),rest=tick(control,{},.02);check(first);
  assert.ok(first.gazeX>0&&first.gazeY>0);
  assert.ok(first.headYaw-rest.headYaw>0&&first.headPitch-rest.headPitch>0);
  const earlyEye=first.gazeX,earlyHead=first.headYaw-rest.headYaw;
  const settled=advance(watched,1,{attention}),idle=advance(control,1);
  assert.ok(earlyEye/settled.gazeX>earlyHead/(settled.headYaw-idle.headYaw),
    'relative eye response advances faster than relative head response');
  const opposite=advance(watched,1,{attention:{x:-1,y:-1,active:true}});
  assert.ok(opposite.gazeX<0&&opposite.gazeY<0&&opposite.headPitch<0);
  assert.equal(opposite.mouthOpen,0);assert.equal(opposite.leftHand+opposite.rightHand,0);
});

for(const ending of ['inactive','absent']){
  test(ending+' attention eases back to centre without a discontinuous jump',()=>{
    const motion=new IllustrationMotion({...quiet,attentionAmount:1});
    const before=advance(motion,1,{attention:{x:.9,y:-.8,active:true}});
    const after=tick(motion,ending==='inactive'?{attention:{x:1,y:1,active:false}}:{});
    assert.ok(after.gazeX>0&&after.gazeX<before.gazeX);
    assert.ok(after.gazeY<0&&Math.abs(after.gazeY)<Math.abs(before.gazeY));
    assert.ok(Math.abs(after.gazeX-before.gazeX)<.3);
    const neutral=advance(motion,4);
    assert.ok(Math.abs(neutral.gazeX)<.001&&Math.abs(neutral.gazeY)<.001);
    assert.ok(Math.abs(neutral.headPitch)<.001);assert.equal(neutral.mouthOpen,0);
  });
}

test('attention clamps coordinates and treats malformed numbers and flags safely',()=>{
  const reference=new IllustrationMotion({...quiet,attentionAmount:1});
  const oversized=new IllustrationMotion({...quiet,attentionAmount:1});
  assert.deepEqual(advance(oversized,1,{attention:{x:100,y:-100,active:true}}),
    advance(reference,1,{attention:{x:1,y:-1,active:true}}));
  for(const attention of [null,{},[],{x:NaN,y:Infinity,active:true},
    {x:'1',y:'-1',active:true},{x:1,y:1,active:'true'},{x:1,y:1}]){
    const motion=new IllustrationMotion(quiet);
    for(let frame=0;frame<20;frame++){
      const params=tick(motion,{attention});check(params);assert.equal(params.mouthOpen,0);
    }
  }
});

for(const type of ['greet','acknowledge']){
  test(type+' is a one-shot action even when the same id is supplied every frame',()=>{
    const motion=new IllustrationMotion({...quiet,gestureAmount:1,interactionAmount:1});
    let peak=0,tail=0;
    for(let frame=0;frame<12*60;frame++){
      const params=tick(motion,{interaction:{type,id:12}});check(params);
      peak=Math.max(peak,gestureSignal(params));
      if(frame>=9*60)tail=Math.max(tail,gestureSignal(params));
      assert.equal(params.mouthOpen,0);
    }
    assert.ok(peak>.02,'a valid explicit interaction has a visible bounded response');
    assert.ok(tail<.002,'holding an event object cannot restart an ended action');
  });
}

test('interaction ids are monotonic across types, and stale actions cannot steal a newer one',()=>{
  const options={...quiet,gestureAmount:1,interactionAmount:1};
  const motion=new IllustrationMotion(options),control=new IllustrationMotion(options);
  advance(motion,.4,{interaction:{type:'greet',id:12}});
  advance(control,.4,{interaction:{type:'greet',id:12}});
  for(let frame=0;frame<180;frame++){
    const stale=frame%2?{type:'acknowledge',id:11}:{type:'acknowledge',id:12};
    assert.deepEqual(tick(motion,{interaction:stale}),tick(control),
      'older/equal ids are a no-op, not a retrigger or a cancel');
  }
  advance(motion,5);
  assert.ok(peakInteraction(motion,{type:'greet',id:13}).peak>.02,'a newer action remains usable');
});

test('bad ids and unsupported actions cannot activate or consume the valid id watermark',()=>{
  const motion=new IllustrationMotion({...quiet,gestureAmount:1,interactionAmount:1});
  const invalid=[null,{},[],{type:'wave',id:100},{type:'headpat',id:100},
    {type:'greet',id:-1},{type:'greet',id:1.5},{type:'greet',id:NaN},
    {type:'greet',id:Infinity},{type:'greet',id:Number.MAX_SAFE_INTEGER+1},
    {type:'greet',id:'100'},{type:'greet',id:null},{type:'greet'}];
  for(const interaction of invalid){
    const params=advance(motion,.2,{interaction});check(params);
    assert.equal(gestureSignal(params),0);assert.equal(params.mouthOpen,0);
  }
  assert.ok(peakInteraction(motion,{type:'greet',id:0}).peak>.02,
    'zero is a valid first id; rejected input must not consume the watermark');
});

test('clearSession releases the gesture but preserves the interaction id watermark across reconnect',()=>{
  const motion=new IllustrationMotion({...quiet,gestureAmount:1,interactionAmount:1});
  const before=advance(motion,.8,{interaction:{type:'greet',id:12}});
  assert.ok(gestureSignal(before)>.02);
  assert.equal(motion.reset({clearSession:true}),true);
  assert.equal(motion.params.mouthOpen,0);
  const first=tick(motion,{interaction:{type:'greet',id:12}});
  assert.ok(first.leftHand+first.rightHand<=before.leftHand+before.rightHand+.000001);
  advance(motion,6,{interaction:{type:'greet',id:12}});
  const replay=peakInteraction(motion,{type:'acknowledge',id:12},3);
  assert.ok(replay.peak<.002,'same-id delayed UI callback cannot resurrect a cancelled action');
  assert.ok(peakInteraction(motion,{type:'greet',id:13}).peak>.02);
});

test('immediate session reset neutralizes pose without resetting UI event identity',()=>{
  const motion=new IllustrationMotion({...quiet,gestureAmount:1,interactionAmount:1});
  advance(motion,.8,{interaction:{type:'greet',id:12}});
  motion.reset({clearSession:true,immediate:true});allZero(motion.params);
  assert.ok(peakInteraction(motion,{type:'greet',id:12},4).peak<.002);
  const replacement=new IllustrationMotion({...quiet,gestureAmount:1,interactionAmount:1});
  assert.ok(peakInteraction(replacement,{type:'greet',id:0}).peak>.02,
    'a new model/UI instance starts with independent interaction history');
});

test('accepted audio cancellation closes mouth immediately, releases UI action and blocks late old PCM',()=>{
  const motion=new IllustrationMotion({...quiet,gestureAmount:1,interactionAmount:1});
  const audible={playing:true,energy:.8,sequence:5,interaction:{type:'greet',id:12}};
  const before=advance(motion,.8,audible);
  assert.ok(before.mouthOpen>.1);assert.ok(gestureSignal(before)>.02);
  assert.equal(motion.reset({beforeSequence:6}),true);
  assert.equal(motion.params.mouthOpen,0);
  for(let frame=0;frame<6*60;frame++){
    const params=tick(motion,audible);check(params);assert.equal(params.mouthOpen,0);
  }
  assert.ok(gestureSignal(motion.params)<.002);
  const fresh=advance(motion,.3,{playing:true,energy:.8,sequence:6});
  assert.ok(fresh.mouthOpen>.1,'new valid speech is not blocked by the old cancel');
});

test('rejected stale-stream or non-covering cancellation is a complete no-op during interaction',()=>{
  const options={...quiet,gestureAmount:1,interactionAmount:1};
  const motion=new IllustrationMotion(options),control=new IllustrationMotion(options);
  const audible={playing:true,energy:.8,sequence:5,interaction:{type:'greet',id:12}};
  advance(motion,.7,audible);advance(control,.7,audible);
  for(const reset of [{streamId:'other',beforeSequence:10},{beforeSequence:5},{beforeSequence:4}]){
    const before={...motion.params};assert.equal(motion.reset(reset),false);
    assert.deepEqual(motion.params,before);
  }
  for(let frame=0;frame<90;frame++)assert.deepEqual(tick(motion,audible),tick(control,audible));
});

test('listening/thinking and UI activity cannot substitute for actual audio playback',()=>{
  for(const activity of ['idle','listening','thinking',undefined,'unsupported',null]){
    const motion=new IllustrationMotion({...quiet,activityAmount:1,interactionAmount:1});
    for(let frame=0;frame<8*60;frame++){
      const params=tick(motion,{activity,energy:1,playing:false});check(params);
      assert.equal(params.mouthOpen,0);assert.equal(params.leftHand+params.rightHand,0);
    }
  }
});

test('explicit interaction while speaking never starts a second simultaneous hand gesture',()=>{
  const motion=new IllustrationMotion({interactionAmount:1,gestureAmount:1});
  for(let frame=0;frame<10*60;frame++){
    const params=tick(motion,{playing:true,energy:.8,sequence:1,
      interaction:frame>=150?{type:'greet',id:1}:undefined,
      attention:{x:.5,y:-.2,active:true},activity:'thinking'});
    check(params);assert.ok(params.mouthOpen>0);
  }
});

test('reduced motion suppresses gestures and limits attention without suppressing true mouth movement',()=>{
  const options={...quiet,gestureAmount:1,headYawAmount:1,interactionAmount:1,attentionAmount:1};
  const full=new IllustrationMotion(options),reduced=new IllustrationMotion({...options,reducedMotion:true});
  let peakHand=0;
  for(let frame=0;frame<3*60;frame++){
    const activity={playing:true,energy:.8,attention:{x:1,y:.5,active:true},interaction:{type:'greet',id:1}};
    const normal=tick(full,activity),limited=tick(reduced,activity);check(limited);
    assert.equal(limited.leftHand+limited.rightHand,0);
    assert.equal(limited.mouthOpen,normal.mouthOpen,'accessibility motion setting does not fabricate/desync lip energy');
    peakHand=Math.max(peakHand,normal.leftHand,normal.rightHand);
  }
  assert.ok(peakHand>.02);
  assert.ok(reduced.params.gazeX>0&&reduced.params.gazeX<full.params.gazeX*.5);
});

test('disabled motion and zero interaction/attention amounts remain neutral under UI input',()=>{
  const incoming={attention:{x:1,y:1,active:true},interaction:{type:'greet',id:1},activity:'thinking'};
  const disabled=new IllustrationMotion({enabled:false});
  allZero(advance(disabled,5,{...incoming,playing:true,energy:1}));
  const muted=new IllustrationMotion({...quiet,attentionAmount:0,interactionAmount:0,activityAmount:0});
  allZero(advance(muted,5,incoming));
  assert.ok(advance(muted,.3,{...incoming,playing:true,energy:.7}).mouthOpen>0,
    'zero visual interaction amounts do not disable real speech lips');
});

test('attention convergence is frame-rate independent and long malformed updates stay bounded',()=>{
  const options={...quiet,headYawAmount:1,attentionAmount:1};
  const a=advance(new IllustrationMotion(options),1,{attention:{x:.8,y:-.6,active:true}},30);
  const b=advance(new IllustrationMotion(options),1,{attention:{x:.8,y:-.6,active:true}},120);
  for(const key of ['gazeX','gazeY','headYaw','headPitch'])assert.ok(Math.abs(a[key]-b[key])<.04,key);
  const motion=new IllustrationMotion({...options,interactionAmount:2,gestureAmount:2,activityAmount:2});
  for(let frame=0;frame<6000;frame++){
    const dt=[NaN,Infinity,-1,0,.016,99][frame%6];
    const params=tick(motion,{attention:{x:frame%2?99:-99,y:Math.sin(frame),active:true},
      interaction:{type:frame%2?'greet':'acknowledge',id:Math.floor(frame/600)},
      activity:frame%2?'thinking':'listening'},dt);
    check(params);assert.equal(params.mouthOpen,0);
  }
});
