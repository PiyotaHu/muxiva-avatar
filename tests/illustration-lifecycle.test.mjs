import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {IllustrationRenderer} from '../web/illustration.mjs';
import {IllustrationMotion} from '../web/illustration-motion.mjs';
import {AvatarTimeline} from '../web/avatar-timeline.mjs';

const config=(name='test')=>({schemaVersion:1,kind:'illustration',name,size:[64,128],
  images:{neutral:'/assets/avatar/neutral.png',blink:'/assets/avatar/blink.png',speaking:'/assets/avatar/speaking.png'},
  rig:{head:{center:[.5,.18],radius:[.16,.12],pivot:[.5,.28]},
    leftHand:{center:[.25,.52],radius:[.06,.10],pivot:[.27,.46]},
    rightHand:{center:[.75,.52],radius:[.06,.10],pivot:[.73,.46]},bodyPivot:[.5,.52],
    hair:{center:[.5,.30],radius:[.32,.26]},skirt:{center:[.5,.64],radius:[.23,.12]},
    eyes:[{center:[.45,.17],radius:[.036,.024]},{center:[.55,.17],radius:[.036,.024]}],
    mouth:{center:[.5,.227],radius:[.035,.025]}}});

function harness() {
  // Real renderer methods, Three.js geometry/materials, timeline and motion;
  // bypass only WebGL construction because lifecycle tests do not need a GPU.
  const renderer=Object.create(IllustrationRenderer.prototype);
  const counts={render:0,dispose:0,disconnect:0};
  Object.assign(renderer,{disposed:false,loadGeneration:0,pendingLoad:null,asset:null,meta:null,
    scene:new THREE.Scene(),camera:new THREE.OrthographicCamera(-.5,.5,.5,-.5,.01,10),
    options:{pixelRatio:1.25,framing:'full',framePadding:1.06,mouthScale:.8,motion:{}},
    timeline:new AvatarTimeline(),motion:new IllustrationMotion(),elapsed:0,nextBlink:2.8,mouth:0,
    expression:{name:'neutral',weight:0},viewportAspect:.5,
    stats:{frames:0,seconds:0,fps:0,droppedAnimationFrames:0,
      mouthOpen:0,peakMouthOpen:0,acceptedAnimationEvents:0,headTilt:0,leftHand:0,rightHand:0},
    canvas:{getBoundingClientRect:()=>({width:100,height:200})},
    resizeObserver:{disconnect(){counts.disconnect++;}},
    renderer:{capabilities:{maxTextureSize:4096},render(){counts.render++;},dispose(){counts.dispose++;},setSize(){}},
  });
  return {renderer,counts};
}

const settle=()=>new Promise(resolve=>setImmediate(resolve));
function texture(width=64,height=128) {
  const value=new THREE.Texture({width,height});
  let disposed=0;
  value.addEventListener('dispose',()=>disposed++);
  return {value,get disposed(){return disposed;}};
}
function track(t) {
  const manifests=[],images=[];
  const originalFetch=globalThis.fetch, originalTexture=THREE.TextureLoader.prototype.loadAsync;
  globalThis.fetch=(url,options)=>new Promise((resolve,reject)=>manifests.push({url,options,resolve,reject}));
  THREE.TextureLoader.prototype.loadAsync=function(url) {return new Promise((resolve,reject)=>images.push({url,resolve,reject}));};
  t.after(()=>{globalThis.fetch=originalFetch;THREE.TextureLoader.prototype.loadAsync=originalTexture;});
  const manifest=async(index,value=config())=>{
    manifests[index].resolve({ok:true,status:200,json:async()=>value});await settle();
  };
  const resolveImages=async(start=0)=>{
    const textures=[texture(),texture(),texture()];
    textures.forEach((entry,index)=>images[start+index].resolve(entry.value));await settle();
    return textures;
  };
  return {manifests,images,manifest,resolveImages};
}
function installDirect(renderer) {
  const values={neutral:texture().value,blink:texture().value,speaking:texture().value};
  renderer.asset=renderer._createIllustration(config(),values);renderer.scene.add(renderer.asset.mesh);
  renderer._frameIllustration();
}
const animation=(sequence=10,stream='assistant')=>({topic:'muxiva.avatar.animation',payload:{schema_version:1,
  stream_id:stream,sequence,sample_rate_hz:24000,keyframes:[{sample_offset:0,sample_count:2400,mouth_open:.8}]}});
const resetEvent=before=>({topic:'muxiva.avatar.reset',payload:{schema_version:1,stream_id:'assistant',before_sequence:before}});
const playing=(sequence=10,sampleOffset=0)=>({deltaSeconds:.1,streamId:'assistant',sequence,sampleOffset,sampleRateHz:24000,playing:true});

test('dispose aborts manifest loading and cannot be resurrected by a late response',async t=>{
  const tracked=track(t),{renderer,counts}=harness();
  const loading=renderer.load('/assets/avatar/late.json');
  renderer.dispose();renderer.dispose();
  assert.equal(await loading,null);
  assert.equal(tracked.manifests[0].options.signal.aborted,true);
  await tracked.manifest(0);
  assert.equal(tracked.images.length,0);
  assert.equal(renderer.asset,null);assert.equal(renderer.scene.children.length,0);
  assert.equal(counts.dispose,1);assert.equal(counts.disconnect,1);
  await assert.rejects(()=>renderer.load('/assets/avatar/revive.json'),/disposed/);
});

test('textures resolving after disposal are each released exactly once',async t=>{
  const tracked=track(t),{renderer}=harness();
  const loading=renderer.load('/assets/avatar/late-images.json');
  await tracked.manifest(0);
  assert.equal(tracked.images.length,3);
  const early=texture();tracked.images[0].resolve(early.value);await settle();
  renderer.dispose();assert.equal(await loading,null);assert.equal(early.disposed,1);
  const late=[texture(),texture()];
  late.forEach((entry,index)=>tracked.images[index+1].resolve(entry.value));await settle();
  assert.ok(late.every(entry=>entry.disposed===1));assert.equal(early.disposed,1);
  assert.equal(renderer.asset,null);
});

test('newer selection wins and superseded image requests cannot replace it',async t=>{
  const tracked=track(t),{renderer}=harness();
  const old=renderer.load('/assets/avatar/old.json');await tracked.manifest(0,config('old'));
  const early=texture();tracked.images[0].resolve(early.value);await settle();
  const latest=renderer.load('/assets/avatar/new.json');await tracked.manifest(1,config('new'));
  assert.equal(await old,null);assert.equal(early.disposed,1);
  const fresh=await tracked.resolveImages(3);
  const result=await latest;
  assert.equal(result.meta.name,'new');assert.equal(result.kind,'illustration');
  assert.deepEqual(result.size,[64,128]);assert.equal(renderer.scene.children.length,1);
  const obsolete=[texture(),texture()];
  obsolete.forEach((entry,index)=>tracked.images[index+1].resolve(entry.value));await settle();
  assert.ok(obsolete.every(entry=>entry.disposed===1));assert.equal(renderer.meta.name,'new');
  assert.ok(fresh.every(entry=>entry.disposed===0));
  renderer.dispose();assert.ok(fresh.every(entry=>entry.disposed===1));
});

test('image dimension mismatch preserves the existing asset and disposes every late sibling',async t=>{
  const tracked=track(t),{renderer}=harness();
  const first=renderer.load('/assets/avatar/ok.json');await tracked.manifest(0,config('keep'));
  const kept=await tracked.resolveImages();await first;
  const previous=renderer.asset;
  const next=renderer.load('/assets/avatar/mismatch.json');const rejected=assert.rejects(next,/dimensions/);
  await tracked.manifest(1);
  const wrong=texture(128,128);tracked.images[3].resolve(wrong.value);
  await rejected;assert.equal(wrong.disposed,1);
  const late=[texture(),texture()];late.forEach((entry,index)=>tracked.images[index+4].resolve(entry.value));await settle();
  assert.ok(late.every(entry=>entry.disposed===1));assert.equal(renderer.asset,previous);
  assert.ok(kept.every(entry=>entry.disposed===0));renderer.dispose();
});

test('replacing an installed illustration disposes geometry, material and all three textures',async t=>{
  const tracked=track(t),{renderer}=harness();
  const first=renderer.load('/assets/avatar/first.json');await tracked.manifest(0);
  const oldTextures=await tracked.resolveImages();await first;
  let geometries=0,materials=0;
  renderer.asset.geometry.addEventListener('dispose',()=>geometries++);
  renderer.asset.material.addEventListener('dispose',()=>materials++);
  const second=renderer.load('/assets/avatar/second.json');await tracked.manifest(1);
  const newTextures=await tracked.resolveImages(3);await second;
  assert.equal(geometries,1);assert.equal(materials,1);assert.ok(oldTextures.every(t=>t.disposed===1));
  assert.ok(newTextures.every(t=>t.disposed===0));renderer.dispose();
});

test('failed manifest validation never starts image requests',async t=>{
  const tracked=track(t),{renderer}=harness();
  const loading=renderer.load('/assets/avatar/bad.json');const rejected=assert.rejects(loading,/PNG/);
  const bad=config();bad.images.neutral='https://example.org/outside.png';await tracked.manifest(0,bad);
  await rejected;assert.equal(tracked.images.length,0);assert.equal(renderer.asset,null);renderer.dispose();
});

test('a bounded load timeout aborts and releases textures that finish afterwards',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const tracked=track(t),{renderer}=harness();
  const loading=renderer.load('/assets/avatar/timeout.json');
  const rejected=assert.rejects(loading,/exceeded 20 seconds/);
  await tracked.manifest(0);
  const early=texture();tracked.images[0].resolve(early.value);await settle();
  t.mock.timers.tick(20_000);await rejected;
  assert.equal(tracked.manifests[0].options.signal.aborted,true);assert.equal(early.disposed,1);
  const late=[texture(),texture()];late.forEach((entry,index)=>tracked.images[index+1].resolve(entry.value));await settle();
  assert.ok(late.every(entry=>entry.disposed===1));assert.equal(renderer.asset,null);renderer.dispose();
});

test('mouth follows consumed audio, closes on silence and respects strict cancellation',()=>{
  const {renderer}=harness();installDirect(renderer);
  assert.equal(renderer.queue(animation()),true);
  renderer.update({...playing(),playing:false});assert.equal(renderer.asset.uniforms.uMouthOpen.value,0);
  renderer.update(playing());assert.ok(renderer.asset.uniforms.uMouthOpen.value>0);
  renderer.update(playing(10,2400));assert.equal(renderer.asset.uniforms.uMouthOpen.value,0);
  renderer.reset();renderer.queue(animation());renderer.update(playing());
  assert.ok(renderer.asset.uniforms.uMouthOpen.value>0);
  renderer.queue(resetEvent(11));assert.equal(renderer.asset.uniforms.uMouthOpen.value,0);
  assert.equal(renderer.queue(animation(10)),false);renderer.update(playing(10));
  assert.equal(renderer.asset.uniforms.uMouthOpen.value,0);
  renderer.queue(animation(11));renderer.update(playing(11));assert.ok(renderer.asset.uniforms.uMouthOpen.value>0);
  const current=renderer.asset.uniforms.uMouthOpen.value;
  renderer.queue(resetEvent(11));assert.equal(renderer.asset.uniforms.uMouthOpen.value,current,'late strict boundary cannot stop equal/newer sequence');
  renderer.dispose();
});

test('unwatermarked reset clears session identity and permits reconnect sequence zero',()=>{
  const {renderer}=harness();installDirect(renderer);renderer.queue(animation(50));renderer.update(playing(50));
  renderer.reset({beforeSequence:51});renderer.reset();
  assert.equal(renderer.queue(animation(0)),true);renderer.update(playing(0));
  assert.ok(renderer.asset.uniforms.uMouthOpen.value>0);
  renderer.dispose();assert.equal(renderer.queue(animation()),false);
});

test('diagnostics count only accepted animation events across resets and asset changes',()=>{
  const {renderer}=harness();installDirect(renderer);
  assert.equal(renderer.stats.acceptedAnimationEvents,0);
  assert.equal(renderer.queue(animation(10)),true);
  assert.equal(renderer.queue({topic:'not-animation',payload:{schema_version:1}}),false);
  assert.equal(renderer.queue({topic:'muxiva.avatar.animation',payload:'invalid JSON'}),false);
  assert.equal(renderer.queue({...animation(10),payload:{...animation(10).payload,sample_rate_hz:7}}),false);
  assert.equal(renderer.stats.acceptedAnimationEvents,1);
  assert.equal(renderer.queue(resetEvent(11)),true);
  assert.equal(renderer.queue(animation(10)),false);
  assert.equal(renderer.stats.acceptedAnimationEvents,1);
  assert.equal(renderer.queue(animation(11)),true);
  renderer.update(playing(11));renderer.update(playing(11,1));
  assert.equal(renderer.stats.acceptedAnimationEvents,2,'rendering never counts events');
  renderer.reset();renderer._releaseIllustration();installDirect(renderer);
  assert.equal(renderer.stats.acceptedAnimationEvents,2,'count belongs to the renderer lifetime');
  renderer.dispose();assert.equal(renderer.queue(animation(12)),false);
  assert.equal(renderer.stats.acceptedAnimationEvents,2);
});

test('pose diagnostics mirror GPU uniforms and retain lifetime mouth peak on silence and disposal',()=>{
  const {renderer}=harness();installDirect(renderer);renderer.queue(animation());
  renderer.motion.update=()=>({headTilt:-.28,leftHand:.35,rightHand:.6,mouthOpen:.7});
  renderer.update(playing());
  const u=renderer.asset.uniforms;
  assert.equal(renderer.stats.mouthOpen,u.uMouthOpen.value);
  assert.equal(renderer.stats.mouthOpen,.7);
  assert.notEqual(renderer.stats.mouthOpen,renderer.mouth,'report actual shader value, not the smoothed input');
  assert.equal(renderer.stats.peakMouthOpen,.7);
  assert.equal(renderer.stats.headTilt,u.uHeadTilt.value);assert.equal(renderer.stats.headTilt,-.28);
  assert.equal(renderer.stats.leftHand,u.uLeftHandLift.value);assert.equal(renderer.stats.leftHand,.35);
  assert.equal(renderer.stats.rightHand,u.uRightHandLift.value);assert.equal(renderer.stats.rightHand,.6);
  renderer.update({...playing(),playing:false});
  assert.equal(renderer.stats.mouthOpen,0);assert.equal(renderer.stats.peakMouthOpen,.7);
  renderer.motion.update=()=>({headTilt:.12,leftHand:.15,rightHand:.2,mouthOpen:.9});
  renderer.update(playing());assert.equal(renderer.stats.peakMouthOpen,.9);
  renderer.reset();assert.equal(renderer.stats.mouthOpen,0,'reset is visible without an extra render');
  assert.equal(renderer.stats.peakMouthOpen,.9);
  renderer._releaseIllustration();installDirect(renderer);
  assert.equal(renderer.stats.mouthOpen,0);assert.equal(renderer.stats.peakMouthOpen,.9);
  assert.equal(renderer.stats.headTilt,0);assert.equal(renderer.stats.leftHand,0);assert.equal(renderer.stats.rightHand,0);
  renderer.dispose();assert.equal(renderer.stats.mouthOpen,0);assert.equal(renderer.stats.peakMouthOpen,.9);
});

test('the front-only camera fits full-body width and rejects pretend side views',()=>{
  const {renderer}=harness();installDirect(renderer);
  assert.equal(renderer.setView({yaw:Math.PI/2}),false);
  assert.equal(renderer.setView({yaw:0,framing:'full'}),true);
  assert.ok(renderer.camera.right-renderer.camera.left>=renderer.asset.aspect);
  const fullHeight=renderer.camera.top-renderer.camera.bottom;
  assert.equal(renderer.setView({yaw:0,framing:'portrait'}),true);
  assert.ok(renderer.camera.top-renderer.camera.bottom<fullHeight);
  assert.equal(renderer.setExpression('portraitSmile',.25),true);
  assert.equal(renderer.setExpression('unknown'),false);
  renderer.dispose();
});

test('portrait focuses head and upper torso without being widened by the hair rig',()=>{
  const {renderer}=harness();installDirect(renderer);
  for(const viewport of [.25,.5,1]) {
    renderer.viewportAspect=viewport;renderer.setView({framing:'full'});
    const full={height:renderer.camera.top-renderer.camera.bottom,
      width:renderer.camera.right-renderer.camera.left,y:renderer.camera.position.y};
    const expectedFullHeight=Math.max(1,renderer.asset.aspect/viewport)*renderer.options.framePadding;
    assert.ok(Math.abs(full.height-expectedFullHeight)<1e-12);
    assert.equal(full.y,0,'full framing must remain vertically centered');
    renderer.setView({framing:'portrait'});
    const closeHeight=renderer.camera.top-renderer.camera.bottom;
    assert.ok(closeHeight/full.height>=.47&&closeHeight/full.height<=.52,'near framing must visibly magnify head/torso');
    const y=renderer.camera.position.y;
    renderer.asset.config.rig.hair.radius[0]=.45;renderer._frameIllustration();
    assert.equal(renderer.camera.top-renderer.camera.bottom,closeHeight);
    assert.equal(renderer.camera.position.y,y,'hair extent must not change portrait placement');
    renderer.setView({framing:'full'});
    assert.equal(renderer.camera.top-renderer.camera.bottom,full.height);
    assert.equal(renderer.camera.right-renderer.camera.left,full.width);
    assert.equal(renderer.camera.position.y,full.y);
  }
  renderer.dispose();
});

test('portrait top stays anchored in narrow viewports with only explicit padding above it',()=>{
  const {renderer}=harness();installDirect(renderer);
  const {head}=renderer.asset.config.rig;
  for(const headY of [.18,.12]) for(const padding of [1,1.06]) for(const viewport of [.15,.25,.5,1.5]) {
    head.center[1]=headY;renderer.options.framePadding=padding;renderer.viewportAspect=viewport;
    renderer.setView({framing:'portrait'});
    const top=Math.max(0,head.center[1]-head.radius[1]*1.15);
    const visibleHeight=renderer.camera.top-renderer.camera.bottom;
    const centre=.5-renderer.camera.position.y;
    const actualTop=centre-visibleHeight/2;
    const onlyPadding=(visibleHeight/padding)*(padding-1)/2;
    assert.ok(Math.abs(actualTop-(top-onlyPadding))<1e-12,'width fitting must expand downward, not add top whitespace');
  }
  renderer.dispose();
});

test('all aligned expressions sample one GPU-deformed mesh using only local masks',()=>{
  const {renderer,counts}=harness();installDirect(renderer);
  const {geometry,material,uniforms}=renderer.asset;
  assert.equal(geometry.parameters.widthSegments,80);assert.equal(geometry.parameters.heightSegments,128);
  assert.match(material.vertexShader,/vSourceUv=uv/);
  assert.match(material.fragmentShader,/eyes\*uBlinkAmount/);
  assert.match(material.fragmentShader,/mouth\*uMouthOpen/);
  assert.match(material.fragmentShader,/<colorspace_fragment>/);
  assert.deepEqual(uniforms.uMouthRegion.value.toArray(),[.5,.227,.035,.025]);
  assert.equal(material.transparent,true);assert.equal(material.toneMapped,false);
  for(let i=0;i<60;i++) renderer.update({deltaSeconds:1/60,playing:false});
  assert.equal(counts.render,60);assert.ok(renderer.fps>59&&renderer.fps<61);
  renderer.dispose();renderer.update({});assert.equal(counts.render,60);
});
