import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {Texture, Box3, Vector3} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {VRMLoaderPlugin, VRMUtils} from '@pixiv/three-vrm';
import {AvatarMotion} from '../web/avatar-motion.mjs';

const assetUrl=name=>new URL('../assets/avatar/'+name,import.meta.url);
const stableHashes={
  'sample.vrm':'12c2b97e95e700783a6a550dc0eee2d7880aeedccef9ae67bc4c5a2f0f2631a2',
  'adult-twintail-v1.vrm':'fb66e510fa4cf2701fa41631e5361705b617e2d6d47792d393f904cff0f15f30',
  'adult-twintail-v2.vrm':'fbf91069722dc77baaf7fe558d16a62b65f042d0624f6063559fe501382d2c35',
};
function decode(name) {
  const bytes=readFileSync(assetUrl(name));
  assert.equal(bytes.readUInt32LE(0),0x46546c67);
  assert.equal(bytes.readUInt32LE(4),2);
  assert.equal(bytes.readUInt32LE(8),bytes.length,'GLB total length');
  const chunks=[];
  for(let offset=12;offset<bytes.length;) {
    const length=bytes.readUInt32LE(offset),type=bytes.readUInt32LE(offset+4);
    assert.equal(length%4,0,'four-byte chunk alignment');
    assert.ok(offset+8+length<=bytes.length,'chunk stays in file');
    chunks.push({type,data:bytes.subarray(offset+8,offset+8+length)});
    offset+=8+length;
  }
  assert.deepEqual(chunks.map(chunk=>chunk.type),[0x4e4f534a,0x004e4942]);
  const j=JSON.parse(chunks[0].data.toString('utf8')),bin=chunks[1].data;
  assert.equal(j.buffers.length,1);
  assert.ok(bin.length>=j.buffers[0].byteLength&&bin.length-j.buffers[0].byteLength<=3);
  return {bytes,j,bin};
}
// Deliberately independent of the builder: validate its emitted accessor wire format.
function accessor(asset,index) {
  const a=asset.j.accessors[index],v=asset.j.bufferViews[a.bufferView];
  assert.ok(a&&!a.sparse,'a dense accessor must exist');
  assert.equal(v.buffer,0);
  const size={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16}[a.type];
  const format={5121:[1,'getUint8',255],5123:[2,'getUint16',65535],5125:[4,'getUint32',4294967295],5126:[4,'getFloat32',1]}[a.componentType];
  assert.ok(size&&format);
  const [width,method,divisor]=format,packed=width*size,stride=v.byteStride||packed;
  const start=(v.byteOffset||0)+(a.byteOffset||0);
  assert.equal(start%width,0);
  assert.ok((a.byteOffset||0)+(a.count-1)*stride+packed<=v.byteLength);
  assert.ok(start+(a.count-1)*stride+packed<=asset.bin.length);
  const view=new DataView(asset.bin.buffer,asset.bin.byteOffset,asset.bin.byteLength);
  const result=new Float64Array(a.count*size);
  for(let i=0;i<a.count;i++)for(let k=0;k<size;k++) {
    result[i*size+k]=view[method](start+i*stride+k*width,true)/(a.normalized?divisor:1);
  }
  return result;
}
if (!existsSync(assetUrl('adult-twintail-v3.vrm')) || !existsSync(assetUrl('sample.vrm')))
  test.skip('retired v3 model fixture is not installed');
else {
const v3=decode('adult-twintail-v3.vrm'),source=decode('sample.vrm');
const profile=JSON.parse(readFileSync(assetUrl('character-v3.json'),'utf8'));
const activePrimitives=asset=>asset.j.nodes.flatMap(node=>node.mesh===undefined?[]:
  asset.j.meshes[node.mesh].primitives.map(primitive=>({node,primitive})));

test('v3 keeps sample, v1 and v2 byte-identical and retains source licensing metadata',()=>{
  for(const [name,expected] of Object.entries(stableHashes)) {
    assert.equal(createHash('sha256').update(readFileSync(assetUrl(name))).digest('hex'),expected,name);
  }
  const original=source.j.extensions.VRMC_vrm,actual=v3.j.extensions.VRMC_vrm;
  assert.deepEqual(actual.humanoid,original.humanoid);
  for(const key of ['licenseUrl','allowRedistribution','modification','commercialUsage','avatarPermission',
    'creditNotation','allowAntisocialOrHateUsage','allowExcessivelySexualUsage',
    'allowExcessivelyViolentUsage','allowPoliticalOrReligiousUsage']) {
    assert.equal(actual.meta[key],original.meta[key],key);
  }
  assert.ok(actual.meta.authors.includes('pixiv Inc.'));
  assert.ok(actual.meta.copyrightInformation.includes(original.meta.copyrightInformation));
  assert.equal(actual.meta.version,'3.0.0');
});

test('all 57 authored facial morphs and presets survive; portraitSmile cannot override mouth or blink',()=>{
  const face=v3.j.meshes.find(mesh=>mesh.name==='Face'),oldFace=source.j.meshes.find(mesh=>mesh.name==='Face');
  assert.equal(face.extras.targetNames.length,57);
  assert.deepEqual(face.extras.targetNames,oldFace.extras.targetNames);
  assert.equal(face.primitives.length,oldFace.primitives.length);
  assert.deepEqual(v3.j.extensions.VRMC_vrm.expressions.preset,source.j.extensions.VRMC_vrm.expressions.preset);
  for(const [index,primitive] of face.primitives.entries()) {
    const count=v3.j.accessors[primitive.attributes.POSITION].count;
    assert.equal(primitive.targets.length,57);
    assert.equal(count,source.j.accessors[oldFace.primitives[index].attributes.POSITION].count);
    for(const attr of ['POSITION','NORMAL'])assert.ok(accessor(v3,primitive.attributes[attr]).every(Number.isFinite));
    for(const target of primitive.targets)for(const index of Object.values(target)) {
      assert.equal(v3.j.accessors[index].count,count);
      assert.ok(accessor(v3,index).every(Number.isFinite),'every deformed morph delta stays finite');
    }
  }
  const smile=v3.j.extensions.VRMC_vrm.expressions.custom.portraitSmile;
  assert.equal(smile.isBinary,false);
  for(const key of ['overrideBlink','overrideMouth','overrideLookAt'])assert.ok(smile[key]===undefined||smile[key]==='none');
  assert.ok(smile.morphTargetBinds.length>=3);
  for(const bind of smile.morphTargetBinds) {
    assert.equal(v3.j.nodes[bind.node].mesh,v3.j.meshes.indexOf(face));
    assert.ok(Number.isInteger(bind.index)&&bind.index>=0&&bind.index<57);
    assert.ok(bind.weight>0&&bind.weight<=1);
  }
});

test('sheer stockings are two aligned skinned layers with standard PBR BLEND and vertex alpha',()=>{
  const primitives=activePrimitives(v3);
  const layer=name=>primitives.filter(({primitive})=>v3.j.materials[primitive.material].name===name);
  const underlay=layer('stockings.warmSkinUnderlay'),nylon=layer('stockings.sheerBlackNylon');
  assert.equal(underlay.length,1);assert.equal(nylon.length,1);
  const skin=underlay[0],film=nylon[0],material=v3.j.materials[film.primitive.material];
  assert.equal(material.alphaMode,'BLEND');
  assert.ok(material.pbrMetallicRoughness.baseColorFactor[3]>0&&material.pbrMetallicRoughness.baseColorFactor[3]<1);
  assert.equal(material.extensions?.VRMC_materials_mtoon,undefined,'film uses ordinary PBR, not MToon alpha semantics');
  assert.equal(material.extensions?.KHR_materials_unlit,undefined);
  const colorAccessor=v3.j.accessors[film.primitive.attributes.COLOR_0];
  assert.equal(colorAccessor.type,'VEC4');
  assert.equal(colorAccessor.count,v3.j.accessors[film.primitive.attributes.POSITION].count);
  const colors=accessor(v3,film.primitive.attributes.COLOR_0);
  for(let i=0;i<colors.length;i+=4) {
    assert.ok(colors.slice(i,i+4).every(value=>Number.isFinite(value)&&value>=0&&value<=1));
    assert.ok(colors[i+3]>0&&colors[i+3]<1,'vertex alpha remains translucent');
  }
  assert.equal(film.node.skin,skin.node.skin,'both layers follow the same source skin');
  for(const attr of ['JOINTS_0','WEIGHTS_0']) {
    assert.deepEqual(accessor(v3,film.primitive.attributes[attr]),accessor(v3,skin.primitive.attributes[attr]),attr);
  }
  const indices=accessor(v3,film.primitive.indices);
  assert.deepEqual(indices,accessor(v3,skin.primitive.indices));
  const outer=accessor(v3,film.primitive.attributes.POSITION),inner=accessor(v3,skin.primitive.attributes.POSITION);
  for(const index of new Set(indices)) {
    const distance=Math.hypot(...[0,1,2].map(axis=>outer[index*3+axis]-inner[index*3+axis]));
    assert.ok(distance>0.0002&&distance<0.0015,'nylon has a small physical separation from its underlay');
  }
});

test('rendered geometry, skin weights and all three spring chains have valid references',()=>{
  const j=v3.j;
  for(const {node,primitive:p} of activePrimitives(v3)) {
    const position=accessor(v3,p.attributes.POSITION),normal=accessor(v3,p.attributes.NORMAL);
    assert.ok(position.every(Number.isFinite));assert.ok(normal.every(Number.isFinite));
    assert.equal(normal.length,position.length);
    const joints=accessor(v3,p.attributes.JOINTS_0),weights=accessor(v3,p.attributes.WEIGHTS_0);
    assert.equal(joints.length,position.length/3*4);assert.equal(weights.length,joints.length);
    assert.ok(joints.every(index=>Number.isInteger(index)&&index>=0&&index<j.skins[node.skin].joints.length),node.name);
    for(let i=0;i<weights.length;i+=4) {
      assert.ok(weights.slice(i,i+4).every(weight=>Number.isFinite(weight)&&weight>=0&&weight<=1),node.name);
      assert.ok(Math.abs(weights.slice(i,i+4).reduce((sum,weight)=>sum+weight,0)-1)<0.0001,node.name);
    }
    if(p.indices!==undefined)assert.ok(accessor(v3,p.indices).every(index=>Number.isInteger(index)&&index>=0&&index<position.length/3));
  }
  const extension=j.extensions.VRMC_springBone,used=new Set();
  assert.deepEqual(extension.springs.map(spring=>spring.name).sort(),['hair.leftTail','hair.rightTail','outfitV3Skirt']);
  for(const spring of extension.springs) {
    assert.ok(spring.joints.length>=3);
    spring.joints.forEach((joint,index)=>{
      assert.ok(j.nodes[joint.node]);assert.equal(used.has(joint.node),false);used.add(joint.node);
      if(index)assert.ok(j.nodes[spring.joints[index-1].node].children.includes(joint.node));
      for(const key of ['stiffness','dragForce','gravityPower','hitRadius'])assert.ok(Number.isFinite(joint[key])&&joint[key]>=0);
    });
    for(const groupIndex of spring.colliderGroups||[]) {
      assert.ok(extension.colliderGroups[groupIndex]);
      for(const index of extension.colliderGroups[groupIndex].colliders)assert.ok(extension.colliders[index]);
    }
  }
});

test('actual VRM parser retains morphs and stable hair/skirt springs during head sway, speech and cancel',async t=>{
  const loader=new GLTFLoader();
  loader.register(parser=>new VRMLoaderPlugin(parser));
  // Only browser image decoding is stubbed. Geometry, materials, skinning,
  // VRM expressions and spring simulation use the actual exported model.
  loader.register(()=>({name:'v3-asset-test-images',loadTexture:async()=>new Texture()}));
  const {bytes}=v3;
  const gltf=await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  const vrm=gltf.userData.vrm;assert.ok(vrm);
  t.after(()=>VRMUtils.deepDispose(vrm.scene));
  VRMUtils.removeUnnecessaryVertices(vrm.scene);VRMUtils.combineSkeletons(vrm.scene);
  assert.equal(vrm.springBoneManager.joints.size,12,'two six-point tails plus one three-point skirt');
  let faceMeshes=0;
  vrm.scene.traverse(object=>{
    if(object.isMesh&&object.geometry.morphAttributes.position?.length===57)faceMeshes++;
  });
  assert.equal(faceMeshes,7);
  assert.ok(vrm.expressionManager.getExpression('portraitSmile'));
  const motion=new AvatarMotion(profile.renderer.motion);motion.bind(vrm);
  t.after(()=>motion.unbind());
  const position=new Vector3();
  let previousCancelledWeight=Infinity;
  for(let frame=0;frame<720;frame++) {
    if(frame===240)motion.reset({streamId:'assistant',beforeSequence:2});
    const playing=frame<480,sequence=frame<360?1:2;
    motion.update({deltaSeconds:1/60,streamId:'assistant',sequence,playing,energy:playing?0.5:0});
    if(frame>=240&&frame<360) {
      assert.ok(motion.speechWeight<=previousCancelledWeight,'old PCM cannot restart the fading speech envelope');
      previousCancelledWeight=motion.speechWeight;
    }
    vrm.expressionManager.setValue('portraitSmile',0.55);
    vrm.expressionManager.setValue('aa',playing?0.35:0);
    vrm.expressionManager.setValue('blink',frame%90<8?0.7:0);
    vrm.update(1/60);vrm.scene.updateMatrixWorld(true);
    vrm.scene.traverse(object=>assert.ok(object.matrixWorld.elements.every(Number.isFinite),object.name));
    for(const joint of vrm.springBoneManager.joints) {
      joint.bone.getWorldPosition(position);
      assert.ok(position.length()<2.5,'spring joints stay near the human-sized rig');
    }
    if(frame===359)assert.ok(motion.speechWeight<0.01,'cancelled speech eases away rather than snapping');
    if(frame%120===0) {
      const size=new Box3().setFromObject(vrm.scene).getSize(new Vector3());
      assert.ok(size.y>1.3&&size.y<2.1&&size.x<1.4&&size.z<1.2,'finite, human-scale rendered bounds');
    }
  }
  assert.equal(vrm.expressionManager.getValue('aa'),0);
  assert.equal(motion.speechWeight,0);
});
}
