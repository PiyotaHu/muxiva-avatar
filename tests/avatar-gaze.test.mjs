import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {VRMLoaderPlugin,VRMUtils} from '@pixiv/three-vrm';
import {AvatarRenderer} from '../web/avatar.mjs';

test('gaze targets the world-space camera without writing head or eye bones',()=>{
 const look={autoUpdate:false,yaw:14,pitch:-12},avatar=Object.create(AvatarRenderer.prototype);
 Object.assign(avatar,{vrm:{lookAt:look},lookAtOriginal:{},camera:new THREE.PerspectiveCamera()});
 avatar._updateGaze();assert.equal(look.target,avatar.camera);assert.equal(look.autoUpdate,true);
 assert.equal(look.yaw,14);assert.equal(look.pitch,-12,'VRM resolves angles after the body update');
 avatar.vrm.lookAt=null;assert.doesNotThrow(()=>avatar._updateGaze());
});

test('installed VRM compensates animated head tilt and camera height in every frame',async()=>{
 const loader=new GLTFLoader();loader.register(p=>new VRMLoaderPlugin(p));loader.register(()=>({name:'gaze-test-textures',loadTexture:async()=>new THREE.Texture()}));
 const b=readFileSync(new URL('../assets/avatar/AvatarSample_A.vrm',import.meta.url));
 const vrm=(await loader.parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'')).userData.vrm;
 VRMUtils.rotateVRM0(vrm);
 const avatar=Object.create(AvatarRenderer.prototype);Object.assign(avatar,{vrm,camera:new THREE.PerspectiveCamera(),lookAtOriginal:{}});
 avatar._updateGaze();
 for(const pitch of [-.15,0,.15])for(const height of [1,1.3,1.6]){
  vrm.humanoid.getNormalizedBoneNode('head').quaternion.setFromEuler(new THREE.Euler(pitch,.05,0));
  avatar.camera.position.set(.12,height,2);avatar._updateGaze();vrm.update(0);
  const actual=[vrm.lookAt.yaw,vrm.lookAt.pitch];
  vrm.lookAt.lookAt(avatar.camera.getWorldPosition(new THREE.Vector3()));
  assert.ok(Math.abs(actual[0]-vrm.lookAt.yaw)<1e-6);assert.ok(Math.abs(actual[1]-vrm.lookAt.pitch)<1e-6);
  assert.ok(actual.every(Number.isFinite));
 }
 VRMUtils.deepDispose(vrm.scene);
});
