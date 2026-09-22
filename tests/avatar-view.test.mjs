import test from 'node:test';
import assert from 'node:assert/strict';
import {Scene, Mesh, BoxGeometry, MeshBasicMaterial, PerspectiveCamera} from 'three';
import {AvatarRenderer} from '../web/avatar.mjs';
import {AvatarStateMachine} from '../web/avatar-state.mjs';
import {LipSyncTimeline} from '../web/avatar-lipsync.mjs';

function renderer() {
  const avatar=Object.create(AvatarRenderer.prototype),scene=new Scene();
  const mesh=new Mesh(new BoxGeometry(.5,1.6,.3),new MeshBasicMaterial());mesh.position.y=.8;scene.add(mesh);
  Object.assign(avatar,{vrm:{scene},camera:new PerspectiveCamera(32,1,.01,100),options:{framing:'portrait'},viewYaw:0});return avatar;
}
test('generic camera supports front, side, back and full-body framing without moving the rig',()=>{
  const avatar=renderer();assert.ok(avatar.setView({yaw:0}));const distance=avatar.camera.position.z;assert.ok(avatar.setView({yaw:Math.PI/2}));assert.ok(Math.abs(avatar.camera.position.x-distance)<1e-5);assert.ok(avatar.setView({yaw:Math.PI,framing:'full'}));assert.ok(avatar.camera.position.z<0);assert.deepEqual(avatar.vrm.scene.position.toArray(),[0,0,0]);
});
test('invalid view parameters do not mutate the camera',()=>{const avatar=renderer();avatar.setView({yaw:0});const original=avatar.camera.position.clone();assert.equal(avatar.setView({yaw:NaN}),false);assert.equal(avatar.setView({framing:'unknown'}),false);assert.deepEqual(avatar.camera.position.toArray(),original.toArray());});
test('presentation state uses consumed assistant playback before user VAD or thinking',()=>{
  const state=new AvatarStateMachine();assert.equal(state.update({}), 'idle');assert.equal(state.update({userSpeaking:true}),'listening');assert.equal(state.update({userSpeaking:true,thinking:true}),'listening');assert.equal(state.update({userSpeaking:true,thinking:true,playing:true}),'speaking');assert.equal(state.update({thinking:true}),'thinking');
});
test('browser lip timeline stores numeric features and samples only at consumed playback position',()=>{
  const lips=new LipSyncTimeline();const samples=Float32Array.from({length:960},(_,i)=>Math.sin(i*.21)*.3);assert.ok(lips.queue({samples,sequence:4,sampleOffset:0,sampleRateHz:24000}));assert.equal(lips.sample({sequence:4,sampleOffset:0,playing:false}).aa,0);const value=lips.sample({sequence:4,sampleOffset:20,playing:true});assert.ok(value&&value.aa>0);lips.reset({streamId:'assistant',beforeSequence:5});assert.equal(lips.sample({sequence:4,sampleOffset:20,playing:true}),null);
});
test('custom facial expression still validates against the imported model',()=>{
  const avatar=Object.create(AvatarRenderer.prototype);avatar.vrm={expressionManager:{getExpression:name=>name==='portraitSmile'?{}:null}};assert.equal(avatar.setExpression('portraitSmile',.55),true);assert.deepEqual(avatar.expression,{name:'portraitSmile',weight:.55});assert.equal(avatar.setExpression('missingExpression',.2),false);assert.equal(avatar.setExpression('invalid name',.2),false);
});
