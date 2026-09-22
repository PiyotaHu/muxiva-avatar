import assert from 'node:assert/strict';
import test from 'node:test';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const root = process.env.AVATAR_APP_ROOT || fileURLToPath(new URL('../', import.meta.url));
const loadModule = path => import(pathToFileURL(resolve(root, path)).href);
const {VrmBuilder} = await loadModule('scripts/avatar/vrm-builder.mjs');
const {sculptFaceV3, faceShapeV3, PORTRAIT_SMILE} = await loadModule('scripts/avatar/face-v3.mjs');
const {GLTFLoader} = await loadModule('node_modules/three/examples/jsm/loaders/GLTFLoader.js');
const {VRMLoaderPlugin, VRMUtils} = await loadModule('node_modules/@pixiv/three-vrm/lib/three-vrm.module.js');
const {Texture, Vector3} = await loadModule('node_modules/three/build/three.module.js');

if (!existsSync(resolve(root, 'assets/avatar/sample.vrm')))
  test.skip('retired v3 face fixture is not installed');
else {
const original = new VrmBuilder(resolve(root, 'assets/avatar/sample.vrm'));
const shaped = new VrmBuilder(resolve(root, 'assets/avatar/sample.vrm'));
const sourceNames = [...original.j.meshes[1].extras.targetNames];
const report = sculptFaceV3(shaped, {
  faceTexture: resolve(root, 'assets/avatar/textures/face-v2.png'),
  irisTexture: resolve(root, 'assets/avatar/textures/iris-v2.png'),
});
shaped.finish();
shaped.sourceBin = Buffer.concat(shaped.chunks);

function partFor(material) {
  if (/EyeIris/.test(material)) return 'iris';
  if (/EyeHighlight/.test(material)) return 'highlight';
  if (/FaceBrow/.test(material)) return 'brow';
  return 'skin';
}
const primitiveFor = (builder, name) => builder.j.meshes[1].primitives.find(p => builder.j.materials[p.material].name === name);
const positionsFor = (builder, name) => builder.readAccessor(primitiveFor(builder, name).attributes.POSITION);
function rightSideBounds(array) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < array.length; i += 3) if (array[i] > 0) {
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], array[i + axis]); max[axis] = Math.max(max[axis], array[i + axis]);
    }
  }
  return {min, max, width: max[0] - min[0], height: max[1] - min[1]};
}
function encode(builder) {
  builder.j.buffers[0].byteLength = builder.byteLength;
  const json = Buffer.from(JSON.stringify(builder.j));
  const paddedJSON = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 0x20)]);
  const bin = Buffer.concat([...builder.chunks, Buffer.alloc((4 - builder.byteLength % 4) % 4)]);
  const header = Buffer.alloc(20), binHeader = Buffer.alloc(8);
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4);
  header.writeUInt32LE(28 + paddedJSON.length + bin.length, 8);
  header.writeUInt32LE(paddedJSON.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
  binHeader.writeUInt32LE(bin.length, 0); binHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, paddedJSON, binHeader, bin]);
}

test('v3 preserves original topology and all 57 named facial morph targets', () => {
  assert.deepEqual(shaped.j.meshes[1].extras.targetNames, sourceNames);
  assert.equal(report.sourceTargetCount, 57);
  assert.equal(report.vertices, 4106);
  assert.equal(report.primitives, 7);
  assert.equal(report.transformedTargets, 399);
  assert.ok(report.maxDisplacement > 0.005 && report.maxDisplacement < 0.018);
  for (let index = 0; index < original.j.meshes[1].primitives.length; index++) {
    const source = original.j.meshes[1].primitives[index], next = shaped.j.meshes[1].primitives[index];
    assert.equal(next.targets.length, 57);
    assert.deepEqual(shaped.readAccessor(next.indices), original.readAccessor(source.indices));
    for (const attribute of ['TEXCOORD_0', 'JOINTS_0', 'WEIGHTS_0']) {
      assert.deepEqual(shaped.readAccessor(next.attributes[attribute]), original.readAccessor(source.attributes[attribute]));
    }
  }
});

test('eye geometry becomes an almond aperture with a raised outer corner, without flattening the iris', () => {
  const whiteBefore = rightSideBounds(positionsFor(original, 'EyeWhite_00_EYE'));
  const whiteAfter = rightSideBounds(positionsFor(shaped, 'EyeWhite_00_EYE'));
  assert.ok(whiteAfter.width / whiteAfter.height > whiteBefore.width / whiteBefore.height * 1.15);
  const irisBefore = rightSideBounds(positionsFor(original, 'EyeIris_00_EYE'));
  const irisAfter = rightSideBounds(positionsFor(shaped, 'EyeIris_00_EYE'));
  assert.ok(irisAfter.height / irisBefore.height > 0.90);
  assert.ok(irisAfter.width / irisAfter.height > 0.92 && irisAfter.width / irisAfter.height < 1.10);
  const oldLine = positionsFor(original, 'FaceEyeline_00_FACE');
  const newLine = positionsFor(shaped, 'FaceEyeline_00_FACE');
  let inner = -1, outer = -1;
  for (let i = 0; i < oldLine.length; i += 3) if (oldLine[i] > 0) {
    if (inner < 0 || oldLine[i] < oldLine[inner]) inner = i;
    if (outer < 0 || oldLine[i] > oldLine[outer]) outer = i;
  }
  assert.ok(oldLine[outer + 1] < oldLine[inner + 1], 'source outer eye corner droops');
  assert.ok(newLine[outer + 1] > newLine[inner + 1] + 0.001, 'v3 has a gently raised outer corner');
});

test('the neutral mouth gets rising corners and the brow ribbon becomes visibly finer', () => {
  const oldMouth = positionsFor(original, 'FaceMouth_00_FACE'), newMouth = positionsFor(shaped, 'FaceMouth_00_FACE');
  let corners = 0, lifted = 0;
  for (let i = 0; i < oldMouth.length; i += 3) {
    if (Math.abs(oldMouth[i]) > 0.012 && Math.abs(oldMouth[i + 1] - 1.389) < 0.007 && oldMouth[i + 2] > 0.065) {
      corners++; lifted += newMouth[i + 1] - oldMouth[i + 1];
    }
  }
  assert.ok(corners > 5 && lifted / corners > 0.001, 'neutral visible mouth corners rise by over 1mm');
  const oldBrow = positionsFor(original, 'FaceBrow_00_FACE'), newBrow = positionsFor(shaped, 'FaceBrow_00_FACE');
  let count = 0, ratio = 0;
  for (let i = 0; i < oldBrow.length; i += 3) for (let j = i + 3; j < oldBrow.length; j += 3) {
    if (Math.abs(oldBrow[i] - oldBrow[j]) < 0.0003 && Math.abs(oldBrow[i + 1] - oldBrow[j + 1]) > 0.001) {
      ratio += Math.abs((newBrow[i + 1] - newBrow[j + 1]) / (oldBrow[i + 1] - oldBrow[j + 1])); count++;
    }
  }
  assert.ok(count > 5 && ratio / count < 0.72, 'brow thickness is genuinely reduced, not only recolored');
});

test('every rebuilt morph reaches the transformed original endpoint and all normals stay finite', () => {
  let verticesChecked = 0;
  for (let index = 0; index < original.j.meshes[1].primitives.length; index++) {
    const source = original.j.meshes[1].primitives[index], next = shaped.j.meshes[1].primitives[index];
    const part = partFor(original.j.materials[source.material].name);
    const positions = original.readAccessor(source.attributes.POSITION), base = shaped.readAccessor(next.attributes.POSITION);
    const normals = shaped.readAccessor(next.attributes.NORMAL);
    assert.ok([...normals].every(Number.isFinite));
    for (let morph = 0; morph < source.targets.length; morph++) {
      const delta = original.readAccessor(source.targets[morph].POSITION);
      const mapped = shaped.readAccessor(next.targets[morph].POSITION);
      assert.ok([...mapped].every(Number.isFinite));
      if (next.targets[morph].NORMAL !== undefined) assert.ok([...shaped.readAccessor(next.targets[morph].NORMAL)].every(Number.isFinite));
      for (let i = 0; i < positions.length; i += 3) {
        const expected = faceShapeV3(positions[i] + delta[i], positions[i + 1] + delta[i + 1], positions[i + 2] + delta[i + 2], part);
        for (let axis = 0; axis < 3; axis++) {
          assert.ok(Math.abs(base[i + axis] + mapped[i + axis] - expected[axis]) < 0.0000002,
            `${part} ${sourceNames[morph]} vertex ${i / 3} endpoint`);
        }
        verticesChecked++;
      }
    }
  }
  assert.ok(verticesChecked > 200000);
});

test('portraitSmile references discovered local targets without disabling speech, blink or gaze', () => {
  const expression = shaped.j.extensions.VRMC_vrm.expressions.custom.portraitSmile;
  assert.equal(expression.overrideMouth, 'none');
  assert.equal(expression.overrideBlink, 'none');
  assert.equal(expression.overrideLookAt, 'none');
  assert.equal(expression.isBinary, false);
  assert.deepEqual(expression.morphTargetBinds.map(bind => sourceNames[bind.index].split('.').at(-1)).sort(),
    ['Fcl_BRW_Joy', 'Fcl_EYE_Fun', 'Fcl_MTH_Joy'].sort());
  assert.ok(!expression.morphTargetBinds.some(bind => /Fcl_ALL/.test(sourceNames[bind.index])));
});

test('actual GLTF morph evaluation visibly smiles and preserves independent aa and full blink weights', async t => {
  const loader = new GLTFLoader();
  loader.register(parser => new VRMLoaderPlugin(parser));
  loader.register(() => ({name: 'face-v3-test-images', loadTexture: async () => new Texture()}));
  const file = encode(shaped);
  const gltf = await loader.parseAsync(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength), '');
  const vrm = gltf.userData.vrm;
  t.after(() => VRMUtils.deepDispose(vrm.scene));
  let skin;
  const skinPrimitive = original.j.meshes[1].primitives.indexOf(primitiveFor(original, 'Face_00_SKIN'));
  vrm.scene.traverse(mesh => {
    const association = gltf.parser.associations.get(mesh);
    if (mesh.isSkinnedMesh && association?.meshes === 1 && association?.primitives === skinPrimitive) skin = mesh;
  });
  assert.ok(skin);
  vrm.update(0); vrm.scene.updateMatrixWorld(true);
  const indices = [...new Set(skin.geometry.index.array)];
  const resting = indices.map(index => skin.getVertexPosition(index, new Vector3()).clone());
  const manager = vrm.expressionManager;
  manager.setValue('portraitSmile', PORTRAIT_SMILE.recommendedWeight);
  vrm.update(0); vrm.scene.updateMatrixWorld(true);
  let changed = 0, maximum = 0;
  indices.forEach((index, slot) => {
    const distance = skin.getVertexPosition(index, new Vector3()).distanceTo(resting[slot]);
    if (distance > 0.0001) changed++;
    maximum = Math.max(maximum, distance);
  });
  assert.ok(changed > 100 && maximum > 0.002, 'the smile alters actual face vertices by a visible amount');
  manager.setValue('aa', 0.8); manager.setValue('blink', 1);
  vrm.update(0); vrm.scene.updateMatrixWorld(true);
  const aa = sourceNames.findIndex(name => name.endsWith('Fcl_MTH_A'));
  const blink = sourceNames.findIndex(name => name.endsWith('Fcl_EYE_Close'));
  assert.ok(Math.abs(skin.morphTargetInfluences[aa] - 0.8) < 1e-6);
  assert.ok(Math.abs(skin.morphTargetInfluences[blink] - 1) < 1e-6);
  for (const value of skin.morphTargetInfluences) assert.ok(Number.isFinite(value));
  for (const index of indices) assert.ok(skin.getVertexPosition(index, new Vector3()).toArray().every(Number.isFinite));
});
}
