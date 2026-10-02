import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {VRMAnimationLoaderPlugin} from '@pixiv/three-vrm-animation';
import {refineVrmaPose} from '../scripts/refine-vrma-pose.mjs';
const read=file=>readFileSync(new URL('../assets/avatar/animations/'+file,import.meta.url));
const input=read('avatar-sample-a-idle.vrma'),output=read('avatar-sample-a-idle-refined.vrma');
const profile=JSON.parse(read('avatar-sample-a-idle-refinement.json'));
const json=b=>JSON.parse(b.subarray(20,20+b.readUInt32LE(12)));
function accessorBytes(b,index){const j=json(b),a=j.accessors[index],v=j.bufferViews[a.bufferView];return b.subarray(28+b.readUInt32LE(12)+(v.byteOffset||0)+(a.byteOffset||0),28+b.readUInt32LE(12)+(v.byteOffset||0)+(a.byteOffset||0)+a.count*4*(a.type==='VEC4'?4:a.type==='VEC3'?3:1));}
test('refined idle is reproducible and preserves user-authored arms, wrists, body and timing exactly',()=>{
 assert.deepEqual(refineVrmaPose(input,profile).bytes,output);
 const source=json(input),edited=json(output),bones=source.extensions.VRMC_vrm_animation.humanoid.humanBones;
 // JSON serialization canonicalizes Blender's -0 to 0; the transforms are equal.
 assert.equal(JSON.stringify(source.nodes),JSON.stringify(edited.nodes));assert.deepEqual(source.animations,edited.animations);
 const editedNodes=new Set(Object.keys(profile.bones).map(n=>bones[n].node));let unchanged=0;
 for(const channel of source.animations[0].channels){
  const sampler=source.animations[0].samplers[channel.sampler];
  assert.deepEqual(accessorBytes(input,sampler.input),accessorBytes(output,sampler.input));
  if(channel.target.path!=='rotation'||!editedNodes.has(channel.target.node)){assert.deepEqual(accessorBytes(input,sampler.output),accessorBytes(output,sampler.output));unchanged++;}
 }
 assert.ok(unchanged>=20);assert.equal(profile.bones.leftHand,undefined);assert.equal(profile.bones.rightHand,undefined);
});
test('every keyframe retargets to the intended finger curves and bounded chin correction',async()=>{
 const loader=new GLTFLoader();loader.register(p=>new VRMAnimationLoaderPlugin(p));
 const parse=async b=>(await loader.parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'')).userData.vrmAnimations[0];
 const before=await parse(input),after=await parse(output);assert.equal(after.duration,before.duration);
 for(const [name,edit] of Object.entries(profile.bones)){
  const track=after.humanoidTracks.rotation.get(name),original=before.humanoidTracks.rotation.get(name),delta=new THREE.Quaternion().setFromEuler(new THREE.Euler(...edit.euler));
  assert.equal(track.values.length,original.values.length);
  for(let i=0;i<track.values.length;i+=4){
   const expected=edit.mode==='replace'?delta:new THREE.Quaternion().fromArray(original.values,i).multiply(delta).normalize();
   const actual=new THREE.Quaternion().fromArray(track.values,i).normalize();
   assert.ok(actual.angleTo(expected)<1e-3,name+' key '+i/4);
  }
 }
});
test('selected refined asset has checked provenance and keeps the original export intact',()=>{
 const manifest=JSON.parse(read('sources.json')),entry=manifest.files.find(f=>f.file==='avatar-sample-a-idle-refined.vrma');
 assert.ok(entry);assert.equal(entry.bytes,output.length);assert.equal(entry.sha256,createHash('sha256').update(output).digest('hex'));
 assert.equal(createHash('sha256').update(input).digest('hex'),'c9873105c08254910b688cb9063c6e846b3d9c275d278dbf65d7065ac567f4f4');
});
