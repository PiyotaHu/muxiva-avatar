import assert from 'node:assert/strict';
import test from 'node:test';
import {resolve} from 'node:path';
import fs from 'node:fs';
import {fileURLToPath, pathToFileURL} from 'node:url';

const root = process.env.AVATAR_APP_ROOT || fileURLToPath(new URL('../', import.meta.url));
const loadModule = path => import(pathToFileURL(resolve(root, path)).href);
const {VrmBuilder} = await loadModule('scripts/avatar/vrm-builder.mjs');
const faceModule = process.env.AVATAR_FACE_MODULE;
const sculptModule = faceModule
  ? await import('data:text/javascript;base64,' + Buffer.from(fs.readFileSync(faceModule, 'utf8')
    .replace(/'three'/, JSON.stringify(pathToFileURL(resolve(root, 'node_modules/three/build/three.module.js')).href))).toString('base64'))
  : await loadModule('scripts/avatar/face-v4.mjs');
const {sculptFaceV4, faceShapeV4, portraitSmileShapeV4, PORTRAIT_SMILE_V4: PORTRAIT_SMILE} = sculptModule;
const {GLTFLoader} = await loadModule('node_modules/three/examples/jsm/loaders/GLTFLoader.js');
const {VRMLoaderPlugin, VRMUtils} = await loadModule('node_modules/@pixiv/three-vrm/lib/three-vrm.module.js');
const {Texture, Vector3} = await loadModule('node_modules/three/build/three.module.js');

const retiredFaceFixtureInstalled=fs.existsSync(resolve(root,'assets/avatar/sample.vrm'));
if(!retiredFaceFixtureInstalled)test('retired v4 face fixture is not installed',{skip:true},()=>{});
else {
const original = new VrmBuilder(resolve(root, 'assets/avatar/sample.vrm'));
const shaped = new VrmBuilder(resolve(root, 'assets/avatar/sample.vrm'));
const sourceNames = [...original.j.meshes[1].extras.targetNames];
const report = sculptFaceV4(shaped, {
  faceTexture: resolve(root, 'assets/avatar/textures/face-v2.png'),
  irisTexture: resolve(root, 'assets/avatar/textures/iris-v2.png'),
});
shaped.finish();
shaped.sourceBin = Buffer.concat(shaped.chunks);

function partFor(material) {
  if (/EyeIris/.test(material)) return 'iris';
  if (/EyeHighlight/.test(material)) return 'highlight';
  if (/FaceBrow/.test(material)) return 'brow';
  if (/FaceMouth/.test(material)) return 'mouth';
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

test('v4 preserves original topology and all 57 named facial morph targets', () => {
  assert.deepEqual(shaped.j.meshes[1].extras.targetNames.slice(0, 57), sourceNames);
  assert.equal(shaped.j.meshes[1].extras.targetNames[57], PORTRAIT_SMILE.targetName);
  assert.equal(report.targetCount, 58);
  assert.deepEqual(shaped.j.extensions.VRMC_vrm.expressions.preset, original.j.extensions.VRMC_vrm.expressions.preset);
  assert.equal(report.sourceTargetCount, 57);
  assert.equal(report.vertices, 4106);
  assert.equal(report.primitives, 7);
  assert.equal(report.transformedTargets, 399);
  assert.ok(report.maxDisplacement > 0.005 && report.maxDisplacement < 0.018);
  for (let index = 0; index < original.j.meshes[1].primitives.length; index++) {
    const source = original.j.meshes[1].primitives[index], next = shaped.j.meshes[1].primitives[index];
    assert.equal(next.targets.length, 58);
    assert.deepEqual(shaped.readAccessor(next.indices), original.readAccessor(source.indices));
    for (const attribute of ['TEXCOORD_0', 'JOINTS_0', 'WEIGHTS_0']) {
      assert.deepEqual(shaped.readAccessor(next.attributes[attribute]), original.readAccessor(source.attributes[attribute]));
    }
  }
});

test('eye geometry becomes an almond aperture with a raised outer corner, without flattening the iris', () => {
  const whiteBefore = rightSideBounds(positionsFor(original, 'EyeWhite_00_EYE'));
  const whiteAfter = rightSideBounds(positionsFor(shaped, 'EyeWhite_00_EYE'));
  assert.ok(whiteAfter.width / whiteAfter.height > whiteBefore.width / whiteBefore.height * 1.40);
  const irisBefore = rightSideBounds(positionsFor(original, 'EyeIris_00_EYE'));
  const irisAfter = rightSideBounds(positionsFor(shaped, 'EyeIris_00_EYE'));
  assert.ok(irisAfter.height / irisBefore.height > 0.84);
  assert.ok(irisAfter.width / irisAfter.height > 0.92 && irisAfter.width / irisAfter.height < 1.10);
  const oldLine = positionsFor(original, 'FaceEyeline_00_FACE');
  const newLine = positionsFor(shaped, 'FaceEyeline_00_FACE');
  let inner = -1, outer = -1;
  for (let i = 0; i < oldLine.length; i += 3) if (oldLine[i] > 0) {
    if (inner < 0 || oldLine[i] < oldLine[inner]) inner = i;
    if (outer < 0 || oldLine[i] > oldLine[outer]) outer = i;
  }
  assert.ok(oldLine[outer + 1] < oldLine[inner + 1], 'source outer eye corner droops');
  assert.ok(newLine[outer + 1] > newLine[inner + 1] + 0.001, 'v4 has a gently raised outer corner');
});

test('the neutral mouth gets rising corners and the brow ribbon becomes visibly finer', () => {
  const oldMouth = positionsFor(original, 'FaceMouth_00_FACE'), newMouth = positionsFor(shaped, 'FaceMouth_00_FACE');
  let corners = 0, lifted = 0;
  for (let i = 0; i < oldMouth.length; i += 3) {
    if (Math.abs(oldMouth[i]) > 0.010 && Math.abs(oldMouth[i]) < 0.014 && Math.abs(oldMouth[i + 1] - 1.3844) < 0.002 && oldMouth[i + 2] > 0.069) {
      corners++; lifted += newMouth[i + 1] - oldMouth[i + 1];
    }
  }
  assert.ok(corners > 5 && lifted / corners > 0.0008, 'neutral visible mouth corners rise by over 0.8mm');
  const oldBrow = positionsFor(original, 'FaceBrow_00_FACE'), newBrow = positionsFor(shaped, 'FaceBrow_00_FACE');
  let count = 0, ratio = 0;
  for (let i = 0; i < oldBrow.length; i += 3) for (let j = i + 3; j < oldBrow.length; j += 3) {
    if (Math.abs(oldBrow[i] - oldBrow[j]) < 0.0003 && Math.abs(oldBrow[i + 1] - oldBrow[j + 1]) > 0.001) {
      ratio += Math.abs((newBrow[i + 1] - newBrow[j + 1]) / (oldBrow[i + 1] - oldBrow[j + 1])); count++;
    }
  }
  assert.ok(count > 5 && ratio / count < 0.62, 'brow thickness is genuinely reduced, not only recolored');
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
        const expected = faceShapeV4(positions[i] + delta[i], positions[i + 1] + delta[i + 1], positions[i + 2] + delta[i + 2], part);
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
  assert.deepEqual(expression.morphTargetBinds.map(bind => shaped.j.meshes[1].extras.targetNames[bind.index].split('.').at(-1)).sort(),
    ['Fcl_BRW_Joy', 'Fcl_EYE_Fun', 'Fcl_MTH_PortraitSmile'].sort());
  assert.ok(!expression.morphTargetBinds.some(bind => /Fcl_ALL/.test(sourceNames[bind.index])));
});

test('the 58th morph is lip-local, leaves central lip separation unchanged and never opens the jaw', () => {
  let moving = 0, central = 0, untouched = 0;
  for (const primitive of shaped.j.meshes[1].primitives) {
    const name = shaped.j.materials[primitive.material].name;
    const part = partFor(name), positions = shaped.readAccessor(primitive.attributes.POSITION);
    const delta = shaped.readAccessor(primitive.targets[57].POSITION);
    for (let i = 0; i < positions.length; i += 3) {
      const point = Array.from(positions.subarray(i, i + 3));
      const shift = Array.from(delta.subarray(i, i + 3));
      assert.ok(shift.every(Number.isFinite));
      const expected = portraitSmileShapeV4(...point, part);
      expected.forEach((value, k) => assert.ok(Math.abs(value - point[k] - shift[k]) < 1e-9));
      if (shift.some(value => value !== 0)) {
        moving++;
        assert.ok(part === 'skin' || part === 'mouth');
        assert.ok(Math.abs(point[0]) < 0.031 && Math.abs(point[1] - 1.3850) < 0.018 && point[2] > 0.054);
        assert.ok(shift[1] >= 0 && shift[1] <= 0.002501, 'lift only, not jaw-down opening');
      } else untouched++;
      if (Math.abs(point[0]) < 0.000001 && Math.abs(point[1] - 1.3850) < 0.005 && point[2] > 0.07) {
        central++; assert.equal(shift[1], 0, 'both central lip edges remain stationary');
      }
    }
    if (/Eye|Brow/.test(name)) assert.ok([...delta].every(value => value === 0), 'new target cannot alter the eyes');
  }
  assert.ok(moving > 200 && untouched > 2500 && central > 3);
  assert.equal(moving, report.smileVertices);
});

test('v4 keeps a soft chin rather than converging the jaw into a cone', () => {
  const source = positionsFor(original, 'Face_00_SKIN'), mapped = positionsFor(shaped, 'Face_00_SKIN');
  let chin = 0, lowerRatios = [], jawRatios = [];
  for (let i = 0; i < source.length; i += 3) {
    if (source[i + 2] < 0.01) continue;
    if (source[i + 1] < 1.356) {
      assert.ok(mapped[i + 1] - source[i + 1] > 0.0028); chin++;
    }
    if (Math.abs(source[i]) > 0.010) {
      if (Math.abs(source[i + 1] - 1.360) < 0.003) lowerRatios.push(mapped[i] / source[i]);
      if (Math.abs(source[i + 1] - 1.382) < 0.003 && Math.abs(source[i]) > 0.035) jawRatios.push(mapped[i] / source[i]);
    }
  }
  assert.ok(chin > 5 && lowerRatios.length > 10 && jawRatios.length > 10);
  assert.ok(Math.min(...lowerRatios) > 0.935, 'retain rounded chin width');
  assert.ok(Math.max(...jawRatios) < 0.92, 'narrow mandible independently of chin');
});

test('sculpt cannot accidentally append duplicate smile targets', () => {
  assert.throws(() => sculptFaceV4(shaped), /built once from the original 57-target source/);
});

test('actual GLTF morph evaluation visibly smiles and preserves independent aa and full blink weights', async t => {
  const loader = new GLTFLoader();
  loader.register(parser => new VRMLoaderPlugin(parser));
  loader.register(() => ({name: 'face-v4-test-images', loadTexture: async () => new Texture()}));
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
  const sourcePrimitive = primitiveFor(original, 'Face_00_SKIN');
  const uv = original.readAccessor(sourcePrimitive.attributes.TEXCOORD_0);
  const nearestUV = (u, v) => {
    let best = -1, distance = Infinity;
    for (const index of indices) {
      const candidate = Math.hypot(uv[index * 2] - u, uv[index * 2 + 1] - v);
      if (candidate < distance) { best = index; distance = candidate; }
    }
    assert.ok(distance < 0.0001); return best;
  };
  // Read actual authored UV seam vertices rather than assume runtime indices.
  const upperLip = nearestUV(0.5, 0.75688362), lowerLip = nearestUV(0.5, 0.75835979);
  const gap = () => skin.getVertexPosition(upperLip, new Vector3()).distanceTo(skin.getVertexPosition(lowerLip, new Vector3()));
  const restingGap = gap();
  const manager = vrm.expressionManager;
  manager.setValue('portraitSmile', PORTRAIT_SMILE.recommendedWeight);
  vrm.update(0); vrm.scene.updateMatrixWorld(true);
  let changed = 0, maximum = 0;
  indices.forEach((index, slot) => {
    const distance = skin.getVertexPosition(index, new Vector3()).distanceTo(resting[slot]);
    if (distance > 0.0001) changed++;
    maximum = Math.max(maximum, distance);
  });
  assert.ok(changed > 100 && maximum > 0.001, 'the smile alters actual face vertices by a visible amount');
  assert.ok(Math.abs(gap() - restingGap) < 0.000001, 'portraitSmile leaves the real central lip gap unchanged');
  manager.setValue('aa', 0.8); manager.setValue('blink', 1);
  vrm.update(0); vrm.scene.updateMatrixWorld(true);
  const aa = sourceNames.findIndex(name => name.endsWith('Fcl_MTH_A'));
  const blink = sourceNames.findIndex(name => name.endsWith('Fcl_EYE_Close'));
  assert.ok(Math.abs(skin.morphTargetInfluences[aa] - 0.8) < 1e-6);
  assert.ok(Math.abs(skin.morphTargetInfluences[blink] - 1) < 1e-6);
  assert.ok(gap() > restingGap + 0.005, 'actual aa morph still opens the lips by over 5mm');
  for (const value of skin.morphTargetInfluences) assert.ok(Number.isFinite(value));
  for (const index of indices) assert.ok(skin.getVertexPosition(index, new Vector3()).toArray().every(Number.isFinite));
});
}
