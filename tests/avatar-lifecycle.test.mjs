import assert from 'node:assert/strict';
import test from 'node:test';
import {resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const root = process.env.AVATAR_APP_ROOT || fileURLToPath(new URL('../', import.meta.url));
const loadModule = path => import(pathToFileURL(resolve(root, path)).href);
const {AvatarRenderer} = await loadModule('web/avatar.mjs');
const {GLTFLoader} = await loadModule('node_modules/three/examples/jsm/loaders/GLTFLoader.js');
const {VRMUtils} = await loadModule('node_modules/@pixiv/three-vrm/lib/three-vrm.module.js');
const THREE = await loadModule('node_modules/three/build/three.module.js');

function harness() {
  // The lifecycle under test does not need a GPU context. Use the real
  // renderer prototype and real Three.js scenes, bypassing only construction.
  const avatar = Object.create(AvatarRenderer.prototype);
  Object.assign(avatar, {disposed: false, loadGeneration: 0, vrm: null,
    scene: new THREE.Scene(), baseBones: new Map(), options: {},
    timeline: {clear() {}}, resizeObserver: {disconnect() {}}, renderer: {dispose() {}},
    _frameAvatar() {},
  });
  return avatar;
}

function candidate(name) {
  return {scene: new THREE.Scene(), meta: {metaVersion: '1', name},
    humanoid: {getNormalizedBoneNode() { return null; }},
    expressionManager: {expressions: []}, update() {},
  };
}

function trackLoads(t) {
  const pending = [];
  const disposed = [];
  const originalLoad = GLTFLoader.prototype.loadAsync;
  const originalDispose = VRMUtils.deepDispose;
  GLTFLoader.prototype.loadAsync = () => new Promise(resolve => pending.push(resolve));
  VRMUtils.deepDispose = scene => { disposed.push(scene); originalDispose(scene); };
  t.after(() => {
    GLTFLoader.prototype.loadAsync = originalLoad;
    VRMUtils.deepDispose = originalDispose;
  });
  return {pending, disposed};
}

test('disposing while a VRM loads releases the late model and cannot resurrect the renderer', async t => {
  const {pending, disposed} = trackLoads(t);
  const avatar = harness();
  const late = candidate('late');
  const loading = avatar.load('test://late');
  avatar.dispose();
  pending[0]({userData: {vrm: late}});
  assert.equal(await loading, null);
  assert.equal(avatar.vrm, null);
  assert.equal(avatar.scene.children.length, 0);
  assert.deepEqual(disposed, [late.scene]);
});

test('a superseded slow load cannot replace the newer selected avatar', async t => {
  const {pending, disposed} = trackLoads(t);
  const avatar = harness();
  const oldModel = candidate('old');
  const newModel = candidate('new');
  const oldLoad = avatar.load('test://old');
  const newLoad = avatar.load('test://new');
  pending[1]({userData: {vrm: newModel}});
  assert.equal((await newLoad).meta.name, 'new');
  pending[0]({userData: {vrm: oldModel}});
  assert.equal(await oldLoad, null);
  assert.equal(avatar.vrm, newModel);
  assert.deepEqual(avatar.scene.children, [newModel.scene]);
  assert.deepEqual(disposed, [oldModel.scene]);
  avatar.dispose();
  assert.deepEqual(disposed, [oldModel.scene, newModel.scene]);
});
