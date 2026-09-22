import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {Texture, Box3, Vector3} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {VRMLoaderPlugin, VRMUtils} from '@pixiv/three-vrm';
import {AvatarMotion} from '../web/avatar-motion.mjs';
import {VrmBuilder} from '../scripts/avatar/vrm-builder.mjs';

const sourcePath = new URL('../assets/avatar/sample.vrm', import.meta.url);
const path = new URL('../assets/avatar/adult-twintail-v2.vrm', import.meta.url);
const exists = fs.existsSync(path) && fs.existsSync(sourcePath);
const decode = path => {const b = fs.readFileSync(path); return {b, j: JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)))};};

test('selected AvatarSample A is a valid local VRM with a humanoid and speech expressions', async () => {
  const selected = new URL('../assets/avatar/AvatarSample_A.vrm', import.meta.url);
  const {b, j} = decode(selected);
  assert.equal(b.toString('ascii', 0, 4), 'glTF');
  assert.equal(b.readUInt32LE(8), b.length);
  assert.equal(j.extensions?.VRM?.meta?.title, 'AvatarSample_A');
  assert.ok(j.extensions.VRM.humanoid.humanBones.length >= 50);
  const groups = new Set(j.extensions.VRM.blendShapeMaster.blendShapeGroups.map(group => group.name.toLowerCase()));
  for (const expression of ['a', 'blink', 'joy']) assert.ok(groups.has(expression));
  const loader = new GLTFLoader();
  loader.register(parser => new VRMLoaderPlugin(parser));
  loader.register(() => ({name: 'selected-asset-images', loadTexture: async () => new Texture()}));
  const gltf = await loader.parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '');
  const vrm = gltf.userData.vrm;
  assert.ok(vrm?.humanoid?.getNormalizedBoneNode('head'));
  assert.ok(vrm.expressionManager?.expressions.some(expression => expression.expressionName === 'aa'));
  const motion = new AvatarMotion();
  motion.bind(vrm);
  motion.update({deltaSeconds: 1 / 60, streamId: 'assistant', sequence: 1, playing: true, energy: .4});
  vrm.update(1 / 60);
  vrm.scene.updateMatrixWorld(true);
  vrm.scene.traverse(object => assert.ok(object.matrixWorld.elements.every(Number.isFinite), object.name));
  motion.unbind();
  VRMUtils.deepDispose(vrm.scene);
});

test('custom VRM preserves reviewed base, expressions and redistribution terms', {skip: !exists}, () => {
  const {j, b} = decode(path), source = decode(sourcePath).j;
  assert.equal(createHash('sha256').update(fs.readFileSync(sourcePath)).digest('hex'), '12c2b97e95e700783a6a550dc0eee2d7880aeedccef9ae67bc4c5a2f0f2631a2');
  assert.equal(createHash('sha256').update(fs.readFileSync(new URL('../assets/avatar/adult-twintail-v1.vrm', import.meta.url))).digest('hex'), 'fb66e510fa4cf2701fa41631e5361705b617e2d6d47792d393f904cff0f15f30');
  assert.equal(b.readUInt32LE(8), b.length);
  const vrm = j.extensions.VRMC_vrm, original = source.extensions.VRMC_vrm;
  assert.deepEqual(vrm.expressions, original.expressions);
  assert.deepEqual(vrm.humanoid, original.humanoid);
  for (const key of ['licenseUrl', 'allowRedistribution', 'modification', 'commercialUsage', 'avatarPermission']) assert.equal(vrm.meta[key], original.meta[key]);
  assert.ok(vrm.meta.authors.includes('pixiv Inc.'));
  assert.equal(j.nodes[0].mesh, undefined);
  assert.equal(j.nodes[2].mesh, undefined);
  assert.equal(j.extensions.VRMC_springBone.springs.length, 2);
});

test('all generated geometry, weights, indices and spring references are valid', {skip: !exists}, () => {
  const b = new VrmBuilder(path);
  const j = b.j;
  for (const p of j.meshes[1].primitives) {
    for (const attr of ['POSITION', 'NORMAL']) assert.ok(b.readAccessor(p.attributes[attr]).every(Number.isFinite), 'sculpted face ' + attr);
    for (const target of p.targets || []) for (const accessor of Object.values(target)) assert.ok(b.readAccessor(accessor).every(Number.isFinite), 'sculpted morph');
  }
  for (const node of j.nodes.filter(n => n.mesh >= 3 && n.skin !== undefined)) {
    for (const p of j.meshes[node.mesh].primitives) {
      const position = b.readAccessor(p.attributes.POSITION), weights = b.readAccessor(p.attributes.WEIGHTS_0), joints = b.readAccessor(p.attributes.JOINTS_0);
      assert.ok(position.every(Number.isFinite), node.name);
      assert.ok(b.readAccessor(p.attributes.NORMAL).every(Number.isFinite), node.name);
      for (let i = 0; i < weights.length; i += 4) assert.ok(Math.abs(weights.slice(i, i + 4).reduce((a, x) => a + x, 0) - 1) < .0001, node.name);
      assert.ok(joints.every(index => index < j.skins[node.skin].joints.length), node.name);
      if (p.indices !== undefined) assert.ok(b.readAccessor(p.indices).every(i => i < position.length / 3), node.name);
    }
  }
  const used = new Set();
  for (const chain of j.extensions.VRMC_springBone.springs) {
    chain.joints.forEach(({node}, i) => {
      assert.ok(j.nodes[node]); assert.ok(!used.has(node)); used.add(node);
      if (i) assert.ok(j.nodes[chain.joints[i - 1].node].children.includes(node));
    });
    assert.ok(chain.colliderGroups.every(i => j.extensions.VRMC_springBone.colliderGroups[i]));
  }
});

test('actual VRM parser, normalized motion, expressions and springs remain finite through speech/cancel', {skip: !exists}, async () => {
  const loader = new GLTFLoader();
  loader.register(parser => new VRMLoaderPlugin(parser));
  // No GPU is needed for rig validation. Replace only image decoding here;
  // browser acceptance separately checks the actual textures and appearance.
  loader.register(() => ({name: 'asset-test-images', loadTexture: async () => new Texture()}));
  const file = fs.readFileSync(path);
  const gltf = await loader.parseAsync(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength), '');
  const vrm = gltf.userData.vrm;
  assert.ok(vrm); assert.ok(vrm.springBoneManager);
  VRMUtils.removeUnnecessaryVertices(vrm.scene);
  VRMUtils.combineSkeletons(vrm.scene);
  const motion = new AvatarMotion(); motion.bind(vrm);
  for (let i = 0; i < 300; i++) {
    if (i === 180) motion.reset({streamId: 'assistant', beforeSequence: 2});
    const playing = i < 180;
    motion.update({deltaSeconds: 1 / 60, streamId: 'assistant', sequence: 1, playing, energy: playing ? .4 : 0});
    vrm.expressionManager.setValue('aa', playing ? .35 : 0);
    vrm.expressionManager.setValue('blink', i % 60 < 8 ? .7 : 0);
    vrm.update(1 / 60); vrm.scene.updateMatrixWorld(true);
    vrm.scene.traverse(object => assert.ok(object.matrixWorld.elements.every(Number.isFinite), object.name));
  }
  const size = new Box3().setFromObject(vrm.scene).getSize(new Vector3());
  assert.ok(size.y > 1.3 && size.y < 2, JSON.stringify(size));
  assert.ok(size.x < 1.3 && size.z < 1, JSON.stringify(size));
  assert.equal(vrm.expressionManager.getValue('aa'), 0);
  motion.unbind(); VRMUtils.deepDispose(vrm.scene);
});
