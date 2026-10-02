import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import test from 'node:test';
import {resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const root=process.env.AVATAR_APP_ROOT||fileURLToPath(new URL('../',import.meta.url));
const loadModule=path=>import(pathToFileURL(resolve(root,path)).href);
const THREE=await loadModule('node_modules/three/build/three.module.js');
const {GLTFLoader}=await loadModule('node_modules/three/examples/jsm/loaders/GLTFLoader.js');
const {VRMLoaderPlugin,VRMUtils}=await loadModule('node_modules/@pixiv/three-vrm/lib/three-vrm.module.js');
const {VRMAnimationLoaderPlugin,createVRMAnimationClip}=await loadModule('node_modules/@pixiv/three-vrm-animation/lib/three-vrm-animation.module.js');
const {VrmAnimationController}=await loadModule('web/avatar-animation.mjs');

const config=JSON.parse(readFileSync(resolve(root,'assets/avatar/character.json'),'utf8'));
const animation=config.renderer.animation;
const states=['idle','listening','thinking','speaking'];
const localPath=url=>resolve(root,url.replace(/^\//,''));
const bytes=path=>{
  const value=readFileSync(path);
  return value.buffer.slice(value.byteOffset,value.byteOffset+value.byteLength);
};

test('selected character maps every conversational state to a distinct local VRMA clip',()=>{
  assert.deepEqual(Object.keys(animation.states).sort(),states.toSorted());
  assert.equal(new Set(states.map(state=>animation.states[state])).size,states.length);
  assert.equal(animation.restPoseProfile,undefined,'VRMA is the sole hand/finger pose writer');
  for(const state of states){
    const name=animation.states[state],url=animation.clips[name];
    assert.match(url,/^\/assets\/avatar\/animations\/[a-z0-9-]+\.vrma$/);
    assert.ok(existsSync(localPath(url)),`${state} clip exists`);
    assert.ok(readFileSync(localPath(url)).length>100_000,`${state} clip is not an empty placeholder`);
  }
});

test('a missing optional state clip falls back to the loaded idle without a second rig writer',()=>{
  const rootNode=new THREE.Object3D();
  const controller=new VrmAnimationController({states:{idle:'idle',listening:'missing'},transitionSeconds:0});
  controller.mixer=new THREE.AnimationMixer(rootNode);
  controller.cache.set('idle',new THREE.AnimationClip('idle',1,[]));
  assert.equal(controller.setActivity('listening'),true);
  assert.equal(controller.state,'idle');
  assert.equal(controller.setActivity('listening'),false);
  controller.dispose();
});
test('per-character pose offsets are baked into animation tracks without a second rig writer',()=>{
  const bone=new THREE.Object3D();bone.name='Normalized_LeftUpperArm';
  const clip=new THREE.AnimationClip('idle',1,[new THREE.QuaternionKeyframeTrack(
    bone.name+'.quaternion',[0,1],[0,0,0,1,0,0,0,1])]);
  const controller=new VrmAnimationController({poseOffsets:{leftUpperArm:[0,0,-.025]}});
  controller._applyPoseOffsets(clip,{humanoid:{getNormalizedBoneNode:name=>name==='leftUpperArm'?bone:null}});
  const track=clip.tracks[0],first=new THREE.Quaternion().fromArray(track.values,0);
  const second=new THREE.Quaternion().fromArray(track.values,4),angle=new THREE.Euler().setFromQuaternion(first,'XYZ').z;
  assert.ok(Math.abs(angle+.025)<1e-6);
  assert.ok(first.angleTo(second)<1e-3,'every keyframe receives the same bounded correction');
});
test('all configured VRMA clips parse, retarget and animate the installed AvatarSample A rig',async t=>{
  const modelLoader=new GLTFLoader();
  modelLoader.register(parser=>new VRMLoaderPlugin(parser));
  modelLoader.register(()=>({name:'vrma-test-images',loadTexture:async()=>new THREE.Texture()}));
  const model=await modelLoader.parseAsync(bytes(resolve(root,'assets/avatar/AvatarSample_A.vrm')),'');
  const vrm=model.userData.vrm;
  assert.ok(vrm?.humanoid);
  VRMUtils.rotateVRM0(vrm);
  t.after(()=>VRMUtils.deepDispose(vrm.scene));

  const durations=new Map();
  for(const state of Object.keys(animation.clips)){
    const animationLoader=new GLTFLoader();
    animationLoader.register(parser=>new VRMAnimationLoaderPlugin(parser));
    const source=await animationLoader.parseAsync(bytes(localPath(animation.clips[state])),'');
    const portable=source.userData.vrmAnimations?.[0];
    assert.ok(portable,`${state} contains VRMC_vrm_animation data`);
    assert.ok(portable.humanoidTracks.rotation.has('leftIndexProximal'),`${state} carries authored finger motion`);
    assert.ok(portable.humanoidTracks.rotation.has('rightIndexProximal'),`${state} carries authored finger motion`);
    const clip=createVRMAnimationClip(portable,vrm);
    assert.ok(clip.duration>1.5,`${state} has a meaningful duration`);
    assert.ok(clip.tracks.length>=20,`${state} drives a humanoid body`);
    for(const track of clip.tracks)assert.ok(Array.from(track.values).every(Number.isFinite),`${state}: ${track.name}`);
    durations.set(state,clip.duration);
    const mixer=new THREE.AnimationMixer(vrm.scene);
    mixer.clipAction(clip).play();mixer.update(Math.min(1,clip.duration/2));vrm.update(1/60);vrm.scene.updateMatrixWorld(true);
    vrm.scene.traverse(object=>assert.ok(object.matrixWorld.elements.every(Number.isFinite),`${state}: ${object.name}`));
    mixer.stopAllAction();mixer.uncacheRoot(vrm.scene);
  }
  assert.ok(durations.get('idle')>durations.get('listening'));
  assert.ok(durations.get('thinking')>durations.get('speaking'));
});
