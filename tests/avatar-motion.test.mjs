import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync, existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const root = process.env.AVATAR_APP_ROOT || fileURLToPath(new URL('../', import.meta.url));
const loadModule = path => import(pathToFileURL(resolve(root, path)).href);
const {AvatarMotion, DEFAULT_REST_POSE} = await loadModule('web/avatar-motion.mjs');
const {AvatarRenderer} = await loadModule('web/avatar.mjs');
const {Object3D, Quaternion, Euler, Vector3, Texture, Raycaster} = await loadModule('node_modules/three/build/three.module.js');
const {GLTFLoader} = await loadModule('node_modules/three/examples/jsm/loaders/GLTFLoader.js');
const {VRMLoaderPlugin, VRMUtils} = await loadModule('node_modules/@pixiv/three-vrm/lib/three-vrm.module.js');

function model(names = ['head', 'neck', 'spine', 'chest', ...Object.keys(DEFAULT_REST_POSE)]) {
  const bones = new Map(names.map(name => [name, new Object3D()]));
  return {bones, humanoid: {getNormalizedBoneNode: name => bones.get(name) || null}};
}

function advance(motion, seconds, {playing = true, energy = 0.8, streamId = 'assistant', sequence = 1} = {}) {
  for (let frame = 0; frame < Math.ceil(seconds * 60); frame++) {
    motion.update({deltaSeconds: 1 / 60, playing, energy, streamId, sequence});
  }
}

const rotation = (avatar, name) => avatar.bones.get(name).quaternion.clone();
const nearRotation = (actual, expected, message) => assert.ok(actual.angleTo(expected) < 1e-7, message);
const stillOptions = {idleAmount: 0, breathingAmount: 0};

test('standard normalized bones get a relaxed pose and unbind restores the original rotations', () => {
  const avatar = model();
  avatar.bones.get('head').rotation.y = 0.12;
  const originals = new Map([...avatar.bones].map(([name, bone]) => [name, bone.quaternion.clone()]));
  const motion = new AvatarMotion(stillOptions);
  motion.bind(avatar);
  assert.ok(avatar.bones.get('leftUpperArm').rotation.z < -1);
  assert.ok(avatar.bones.get('rightUpperArm').rotation.z > 1);
  nearRotation(rotation(avatar, 'head'), originals.get('head'));
  advance(motion, 2);
  motion.unbind();
  for (const [name, bone] of avatar.bones) nearRotation(bone.quaternion, originals.get(name), name);
  assert.equal(motion.bones.size, 0);
  assert.equal(motion.speechWeight, 0);
});

test('idle and silent playback do not animate hands or fingers', () => {
  const avatar = model();
  const motion = new AvatarMotion();
  motion.bind(avatar);
  const tracked = ['leftUpperArm', 'rightLowerArm', 'leftHand', 'rightIndexProximal'];
  const initial = tracked.map(name => rotation(avatar, name));
  advance(motion, 4, {playing: false});
  advance(motion, 4, {playing: true, energy: 0});
  tracked.forEach((name, index) => nearRotation(rotation(avatar, name), initial[index], name));
  assert.equal(motion.speechWeight, 0);
  assert.ok(rotation(avatar, 'head').angleTo(new Quaternion()) > 0);
});

test('audible playback produces bounded head, arm, wrist and finger movement', () => {
  const avatar = model();
  const motion = new AvatarMotion(stillOptions);
  motion.bind(avatar);
  const tracked = ['head', 'leftUpperArm', 'rightUpperArm', 'leftLowerArm',
    'rightLowerArm', 'leftHand', 'rightHand', 'leftIndexProximal', 'rightIndexDistal'];
  const resting = tracked.map(name => rotation(avatar, name));
  const maximum = tracked.map(() => 0);
  for (let frame = 0; frame < 600; frame++) {
    motion.update({deltaSeconds: 1 / 60, playing: true, energy: 0.8, sequence: 1});
    tracked.forEach((name, index) => {
      maximum[index] = Math.max(maximum[index], rotation(avatar, name).angleTo(resting[index]));
    });
  }
  maximum.forEach((angle, index) => {
    assert.ok(angle > 0.005, `${tracked[index]} moved`);
    const limit = tracked[index].endsWith('LowerArm') ? 1.75 : 0.45;
    assert.ok(angle < limit, `${tracked[index]} stays anatomically bounded`);
  });
  assert.ok(motion.speechWeight > 0.8 && motion.speechWeight <= 1);
});

test('stopping speech eases back to the resting pose instead of snapping', () => {
  const avatar = model();
  const motion = new AvatarMotion(stillOptions);
  motion.bind(avatar);
  const rest = rotation(avatar, 'leftHand');
  advance(motion, 1);
  const active = rotation(avatar, 'leftHand');
  const weight = motion.speechWeight;
  motion.update({deltaSeconds: 1 / 60, playing: false});
  assert.ok(motion.speechWeight > weight * 0.9 && motion.speechWeight < weight);
  assert.ok(rotation(avatar, 'leftHand').angleTo(active) < 0.02);
  assert.ok(rotation(avatar, 'leftHand').angleTo(rest) > 0.001);
  advance(motion, 5, {playing: false});
  assert.equal(motion.speechWeight, 0);
  nearRotation(rotation(avatar, 'leftHand'), rest);
});

test('cancel suppresses stale playing state but a new playback sequence can animate', () => {
  const avatar = model();
  const motion = new AvatarMotion(stillOptions);
  motion.bind(avatar);
  advance(motion, 1, {sequence: 7});
  const pose = rotation(avatar, 'rightHand');
  const weight = motion.speechWeight;
  motion.reset();
  nearRotation(rotation(avatar, 'rightHand'), pose, 'cancel does not snap immediately');
  assert.equal(motion.speechWeight, weight);
  advance(motion, 5, {sequence: 7});
  assert.equal(motion.speechWeight, 0, 'cancelled PCM cannot restart a gesture');
  advance(motion, 1, {sequence: 8});
  assert.ok(motion.speechWeight > 0.8);
});

test('an observed stop releases reset suppression for restarted session sequence numbers', () => {
  const motion = new AvatarMotion();
  motion.bind(model());
  advance(motion, 1, {sequence: 0});
  motion.reset();
  motion.update({playing: false});
  advance(motion, 1, {sequence: 0});
  assert.ok(motion.speechWeight > 0.8);
  motion.reset({immediate: true});
  assert.equal(motion.speechWeight, 0);
  advance(motion, 1, {streamId: 'other', sequence: 0});
  assert.ok(motion.speechWeight > 0.8, 'another stream has an independent identity');
});

test('strict cancellation watermarks do not suppress a newer or unrelated playback', () => {
  const motion = new AvatarMotion();
  motion.bind(model());
  advance(motion, 1, {sequence: 9});
  assert.equal(motion.reset({beforeSequence: 9}), false);
  assert.equal(motion.reset({streamId: 'other', beforeSequence: 10}), false);
  advance(motion, 1, {sequence: 9});
  assert.ok(motion.speechWeight > 0.8);
  assert.equal(motion.reset({beforeSequence: 10}), true);
  advance(motion, 5, {sequence: 9});
  assert.equal(motion.speechWeight, 0);
});

test('model switching restores old bones, clears playback state and starts the new model at rest', () => {
  const oldModel = model();
  oldModel.bones.get('head').rotation.x = 0.17;
  const originalHead = rotation(oldModel, 'head');
  const motion = new AvatarMotion(stillOptions);
  motion.bind(oldModel);
  advance(motion, 1);
  motion.reset();
  const newModel = model();
  motion.bind(newModel);
  nearRotation(rotation(oldModel, 'head'), originalHead);
  nearRotation(rotation(oldModel, 'leftUpperArm'), new Quaternion());
  assert.equal(motion.elapsed, 0);
  assert.equal(motion.speechWeight, 0);
  assert.equal(motion.blockedPlayback, null);
  advance(motion, 1);
  assert.ok(motion.speechWeight > 0.8);
  nearRotation(rotation(oldModel, 'head'), originalHead, 'old model is no longer touched');
  motion.unbind();
  motion.unbind();
  nearRotation(rotation(newModel, 'leftUpperArm'), new Quaternion());
});

test('optional or absent normalized bones never prevent rendering', () => {
  const motion = new AvatarMotion();
  for (const avatar of [model(['head']), model([]), {}, null]) {
    assert.doesNotThrow(() => {
      motion.bind(avatar);
      advance(motion, 1);
      motion.reset();
      advance(motion, 1, {playing: false});
      motion.unbind();
    });
  }
});

test('each update starts from neutral and cannot accumulate rotations over a long session', () => {
  const avatar = model();
  const motion = new AvatarMotion(stillOptions);
  motion.bind(avatar);
  advance(motion, 120);
  const sample = rotation(avatar, 'leftLowerArm');
  for (let repeat = 0; repeat < 1000; repeat++) {
    motion.update({deltaSeconds: 0, playing: true, energy: 0.8, sequence: 1});
  }
  nearRotation(rotation(avatar, 'leftLowerArm'), sample);
  for (const [name, bone] of avatar.bones) {
    assert.ok(Math.abs(bone.quaternion.length() - 1) < 1e-12, name);
  }
  advance(motion, 5, {playing: false});
  const expected = new Quaternion().setFromEuler(new Euler(...DEFAULT_REST_POSE.leftLowerArm));
  nearRotation(rotation(avatar, 'leftLowerArm'), expected);
});

test('pose and motion amounts are configurable without asset-specific bone logic', () => {
  const avatar = model();
  const custom = [0.1, -0.2, -0.9];
  const motion = new AvatarMotion({...stillOptions, speechAmount: 0, gestureAmount: 0,
    restPose: {leftUpperArm: custom, rightUpperArm: [NaN, 0, 0]}});
  motion.bind(avatar);
  const pose = rotation(avatar, 'leftUpperArm');
  nearRotation(pose, new Quaternion().setFromEuler(new Euler(...custom)));
  advance(motion, 2);
  nearRotation(rotation(avatar, 'leftUpperArm'), pose);
  nearRotation(rotation(avatar, 'head'), new Quaternion());
  assert.ok(avatar.bones.get('rightUpperArm').rotation.z > 1, 'invalid pose falls back to default');
  const disabled = new AvatarMotion({enabled: false});
  disabled.bind(model());
  advance(disabled, 1);
  assert.equal(disabled.speechWeight, 0);
});

test('non-finite inputs and a suspended-tab delta cannot produce invalid rotations', () => {
  const avatar = model();
  const motion = new AvatarMotion({attackSeconds: 0, releaseSeconds: NaN, speechAmount: Infinity});
  motion.bind(avatar);
  for (const deltaSeconds of [NaN, -1, Infinity, 1000]) {
    motion.update({deltaSeconds, playing: true, energy: NaN});
  }
  assert.equal(motion.elapsed, 0.1);
  assert.equal(motion.speechWeight, 0);
  for (const bone of avatar.bones.values()) assert.ok(bone.quaternion.toArray().every(Number.isFinite));
});

test.skip('retired procedural-motion renderer lifecycle is superseded by VRMA body ownership', () => {
  const avatar = Object.create(AvatarRenderer.prototype);
  const calls = [];
  Object.assign(avatar, {disposed: false, elapsed: 0, nextBlink: 2, mouth: 0,
    options: {mouthScale: 0.8, mouthExpression: 'aa'}, expression: {name: 'neutral', weight: 0},
    stats: {frames: 0, seconds: 0}, timeline: {sample: () => 0.5, clear() { calls.push('clear'); }},
    motion: {update(state) { calls.push(state); }, reset() { calls.push('reset'); }, unbind() { calls.push('unbind'); }},
    vrm: {update() {}, expressionManager: {setValue() {}}}, renderer: {render() {}},
  });
  avatar.update({deltaSeconds: 1 / 60, playing: true, sequence: 9, streamId: 'speech'});
  assert.equal(calls[0].sequence, 9);
  assert.equal(calls[0].streamId, 'speech');
  assert.equal(calls[0].playing, true);
  assert.ok(calls[0].energy > 0 && calls[0].energy < 0.4);
  avatar.reset();
  assert.equal(avatar.mouth, 0);
  assert.deepEqual(calls.slice(1), ['clear', 'reset']);
  avatar.vrm = null;
  avatar._releaseAvatar();
  assert.equal(calls.at(-1), 'unbind');
});

test.skip('retired procedural-motion reset routing is superseded by lip-sync timeline reset', () => {
  const avatar = Object.create(AvatarRenderer.prototype);
  const calls = [];
  Object.assign(avatar, {timeline: {queue: () => true}, motion: {reset: args => calls.push(args)}});
  assert.equal(avatar.queue({topic: 'muxiva.avatar.reset', payload: JSON.stringify({
    schema_version: 1, stream_id: 'voice', before_sequence: 4,
  })}), true);
  assert.deepEqual(calls, [{streamId: 'voice', beforeSequence: 4}]);
  avatar.timeline.queue = () => false;
  assert.equal(avatar.queue({topic: 'muxiva.avatar.reset', payload: {}}), false);
  assert.equal(calls.length, 1);
});

async function actualRig(assetName) {
  const bytes = readFileSync(resolve(root, 'assets/avatar', assetName));
  const loader = new GLTFLoader();
  loader.register(parser => new VRMLoaderPlugin(parser));
  // Exercise the real VRM hierarchy, skipping only browser image decoding.
  loader.register(() => ({name: 'motion-test-images', loadTexture: async () => new Texture()}));
  const gltf = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  const vrm = gltf.userData.vrm;
  VRMUtils.rotateVRM0(vrm);
  vrm.update(0);
  vrm.scene.updateMatrixWorld(true);
  return vrm;
}
test('new posture controls default off and preserve the original idle head formula', () => {
  const avatar = model(['head', 'neck', 'hips']);
  avatar.bones.get('hips').rotation.z = 0.12;
  const originalHips = rotation(avatar, 'hips');
  const motion = new AvatarMotion({idleAmount: 0.6, breathingAmount: 0, speechAmount: 0, gestureAmount: 0});
  motion.bind(avatar); advance(motion, 3, {playing: false});
  const glance = Math.sin(motion.elapsed * 0.53) * 0.020 * 0.6;
  const tilt = Math.sin(motion.elapsed * 0.71) * 0.010 * 0.6;
  nearRotation(rotation(avatar, 'neck'), new Quaternion().setFromEuler(new Euler(0, glance * 0.25, 0)));
  nearRotation(rotation(avatar, 'head'), new Quaternion().setFromEuler(new Euler(0, glance * 0.75, tilt)));
  nearRotation(rotation(avatar, 'hips'), originalHips);
  assert.equal(motion.bones.has('hips'), false, 'default motion must not take ownership of the pelvis');
  assert.equal(motion.postureCount, 0);
  const invalid = new AvatarMotion({headYawAmount: NaN, headTiltAmount: Infinity, hipSwayAmount: -1});
  assert.equal(invalid.options.headYawAmount, 0);
  assert.equal(invalid.options.headTiltAmount, 0);
  assert.equal(invalid.options.hipSwayAmount, 0);
});

test('configured head accents turn both ways slowly, pause, and do not drift', () => {
  const avatar = model();
  const motion = new AvatarMotion({...stillOptions, speechAmount: 0, gestureAmount: 0,
    headYawAmount: 1.2, headTiltAmount: 1.15});
  motion.bind(avatar);
  const euler = new Euler(), combined = new Quaternion(), previous = new Quaternion();
  let minimumYaw = 0, maximumYaw = 0, minimumTilt = 0, maximumTilt = 0, maximumStep = 0, rests = 0;
  for (let frame = 0; frame < 5400; frame++) {
    motion.update({deltaSeconds: 1 / 60, playing: false});
    combined.multiplyQuaternions(avatar.bones.get('neck').quaternion, avatar.bones.get('head').quaternion);
    euler.setFromQuaternion(combined, 'XYZ');
    minimumYaw = Math.min(minimumYaw, euler.y); maximumYaw = Math.max(maximumYaw, euler.y);
    minimumTilt = Math.min(minimumTilt, euler.z); maximumTilt = Math.max(maximumTilt, euler.z);
    maximumStep = Math.max(maximumStep, previous.angleTo(combined)); previous.copy(combined);
    if (Math.abs(motion.headYaw) + Math.abs(motion.headTilt) < 1e-8) rests++;
  }
  assert.ok(minimumYaw < -0.065 && maximumYaw > 0.080, 'visible three-to-six-degree left/right turns');
  assert.ok(minimumYaw >= -0.085 && maximumYaw <= 0.085);
  assert.ok(minimumTilt < -0.040 && maximumTilt > 0.045, 'light two-to-three-degree tilt');
  assert.ok(Math.max(Math.abs(minimumTilt), maximumTilt) <= 0.047);
  assert.ok(maximumStep < 0.003, 'slow continuous motion, including joins and returns');
  assert.ok(rests > 5400 * 0.30, 'substantial intervals at neutral rather than constant oscillation');
  assert.ok(motion.postureCount >= 9 && motion.postureCount <= 13, 'no rapid repetitive shaking');
  const before = rotation(avatar, 'head');
  for (let repeat = 0; repeat < 1000; repeat++) motion.update({deltaSeconds: 0, playing: false});
  nearRotation(rotation(avatar, 'head'), before);
});

test('optional hip sway is sub-degree rotation only and never changes positions or scale', () => {
  const avatar = model(['hips', 'head', 'neck', 'leftEye', 'rightEye']);
  for (const bone of avatar.bones.values()) bone.position.set(0.1, 0.2, -0.3);
  avatar.bones.get('hips').rotation.set(0.08, -0.06, 0.02);
  avatar.bones.get('leftEye').rotation.y = 0.15;
  const originalHips = rotation(avatar, 'hips'), originalEye = rotation(avatar, 'leftEye');
  const motion = new AvatarMotion({...stillOptions, speechAmount: 0, gestureAmount: 0, hipSwayAmount: 2});
  motion.bind(avatar);
  let peak = 0, maximumStep = 0, last = originalHips;
  for (let frame = 0; frame < 3600; frame++) {
    motion.update({deltaSeconds: 1 / 60, playing: false});
    const current = rotation(avatar, 'hips');
    peak = Math.max(peak, current.angleTo(originalHips));
    maximumStep = Math.max(maximumStep, current.angleTo(last)); last = current;
  }
  assert.ok(peak > 0.012 && peak < Math.PI / 180, 'even the largest setting is below one degree');
  assert.ok(maximumStep < 0.0003);
  for (const bone of avatar.bones.values()) {
    assert.deepEqual(bone.position.toArray(), [0.1, 0.2, -0.3]);
    assert.deepEqual(bone.scale.toArray(), [1, 1, 1]);
  }
  nearRotation(rotation(avatar, 'leftEye'), originalEye, 'motion never owns VRM look-at eye bones');
  motion.unbind();
  nearRotation(rotation(avatar, 'hips'), originalHips);
});

test('configured idle posture survives cancel while stale speech nods and hands still settle', () => {
  const options = {...stillOptions, headYawAmount: 1.2, headTiltAmount: 1.15, hipSwayAmount: 0.7};
  const avatar = model(['hips', 'head', 'neck', ...Object.keys(DEFAULT_REST_POSE)]);
  const idleAvatar = model(['hips', 'head', 'neck', ...Object.keys(DEFAULT_REST_POSE)]);
  const motion = new AvatarMotion(options), idle = new AvatarMotion(options);
  motion.bind(avatar); idle.bind(idleAvatar);
  advance(motion, 2, {sequence: 1}); advance(idle, 2, {playing: false});
  const headBefore = rotation(avatar, 'head');
  motion.reset({beforeSequence: 2});
  nearRotation(rotation(avatar, 'head'), headBefore, 'cancellation itself cannot snap the head');
  advance(motion, 6, {sequence: 1}); advance(idle, 6, {playing: false});
  assert.equal(motion.speechWeight, 0, 'stale PCM cannot restart speech movement');
  for (const name of ['head', 'neck', 'hips', 'leftHand', 'rightHand']) {
    nearRotation(rotation(avatar, name), rotation(idleAvatar, name), name + ' settles to the same idle pose');
  }
  advance(motion, 1.5, {sequence: 2});
  assert.ok(motion.speechWeight > 0.8, 'new speech can nod and gesture again');
});

test('switching a model clears configured posture offsets and restores old head and pelvis', () => {
  const oldAvatar = model(['head', 'neck', 'hips']);
  oldAvatar.bones.get('head').rotation.set(0.07, 0.1, -0.08);
  oldAvatar.bones.get('hips').rotation.z = 0.09;
  const oldHead = rotation(oldAvatar, 'head'), oldHips = rotation(oldAvatar, 'hips');
  const motion = new AvatarMotion({...stillOptions, headYawAmount: 1.2, headTiltAmount: 1.15, hipSwayAmount: 0.7});
  motion.bind(oldAvatar); advance(motion, 4, {playing: false});
  assert.ok(Math.abs(motion.headYaw) > 0.01);
  const nextAvatar = model(['head', 'neck', 'hips']);
  motion.bind(nextAvatar);
  nearRotation(rotation(oldAvatar, 'head'), oldHead); nearRotation(rotation(oldAvatar, 'hips'), oldHips);
  nearRotation(rotation(nextAvatar, 'head'), new Quaternion());
  nearRotation(rotation(nextAvatar, 'hips'), new Quaternion());
  assert.equal(motion.postureCount, 0); assert.equal(motion.headYaw, 0); assert.equal(motion.hipRoll, 0);
  for (const deltaSeconds of [NaN, Infinity, -1, 1000]) motion.update({deltaSeconds, playing: false});
  for (const bone of nextAvatar.bones.values()) assert.ok(bone.quaternion.toArray().every(Number.isFinite));
});

const normalized = (vrm, name) => vrm.humanoid.getNormalizedBoneNode(name);
const worldPoint = (vrm, name) => normalized(vrm, name).getWorldPosition(new Vector3());
function localFinger(vrm, side, finger) {
  const hand = normalized(vrm, `${side}Hand`);
  const proximal = normalized(vrm, `${side}${finger}Proximal`);
  const distal = normalized(vrm, `${side}${finger}Distal`);
  const direction = side === 'left' ? 1 : -1;
  return {
    base: hand.worldToLocal(proximal.getWorldPosition(new Vector3())),
    tip: hand.worldToLocal(distal.localToWorld(new Vector3(direction * 0.015, 0, 0))),
  };
}

const v2MotionProfile = JSON.parse(readFileSync(resolve(root, 'assets/avatar/character-v2.json'), 'utf8')).renderer.motion;
const v3MotionProfile = JSON.parse(readFileSync(resolve(root, 'assets/avatar/character-v3.json'), 'utf8')).renderer.motion;
const fixtureRestPose = assetName => assetName === 'adult-twintail-v2.vrm' ? v2MotionProfile.restPose
  : assetName === 'adult-twintail-v3.vrm' ? v3MotionProfile.restPose : undefined;

test('configured head movement reaches the real VRM head without taking over look-at',
  {skip: !existsSync(resolve(root, 'assets/avatar/adult-twintail-v2.vrm'))}, async t => {
  const vrm = await actualRig('adult-twintail-v2.vrm');
  t.after(() => VRMUtils.deepDispose(vrm.scene));
  const motion = new AvatarMotion({...stillOptions, speechAmount: 0, gestureAmount: 0,
    headYawAmount: 1.2, headTiltAmount: 1.15});
  motion.bind(vrm);
  vrm.lookAt.autoUpdate = false; vrm.lookAt.yaw = 9; vrm.lookAt.pitch = -3;
  const gazeTarget = vrm.lookAt.target;
  vrm.update(0); vrm.scene.updateMatrixWorld(true);
  const rawHead = vrm.humanoid.getRawBoneNode('head');
  const rest = rawHead.getWorldQuaternion(new Quaternion()).normalize();
  advance(motion, 3.8, {playing: false});
  vrm.update(1 / 60); vrm.scene.updateMatrixWorld(true);
  const angle = rawHead.getWorldQuaternion(new Quaternion()).normalize().angleTo(rest);
  assert.ok(angle > 0.07 && angle < 0.12, 'normalized head/neck offsets visibly reach the rendered raw head');
  assert.equal(vrm.lookAt.yaw, 9); assert.equal(vrm.lookAt.pitch, -3);
  assert.equal(vrm.lookAt.autoUpdate, false); assert.equal(vrm.lookAt.target, gazeTarget);
  assert.equal(motion.bones.has('leftEye'), false); assert.equal(motion.bones.has('rightEye'), false);
  motion.unbind(); vrm.update(0); vrm.scene.updateMatrixWorld(true);
  // Exported parent scales have small float error; normalize decomposed world
  // quaternions before comparing angles, even when components match exactly.
  const restored = rawHead.getWorldQuaternion(new Quaternion()).normalize();
  assert.ok(restored.angleTo(rest) < 1e-6, 'unbind restores the original raw head orientation');
});

for (const assetName of ['sample.vrm', 'adult-twintail-v1.vrm', 'adult-twintail-v2.vrm', 'adult-twintail-v3.vrm']) {
  test(`${assetName}: actual wrists hang close to body, palms inward, fingers curl toward palms`,
    {skip: !existsSync(resolve(root, 'assets/avatar', assetName))}, async t => {
    const vrm = await actualRig(assetName);
    t.after(() => VRMUtils.deepDispose(vrm.scene));
    const flat = {};
    for (const side of ['left', 'right']) {
      flat[side] = {Index: localFinger(vrm, side, 'Index'), Little: localFinger(vrm, side, 'Little')};
    }
    const motion = new AvatarMotion({...stillOptions, restPose: fixtureRestPose(assetName)});
    motion.bind(vrm);
    vrm.update(0);
    vrm.scene.updateMatrixWorld(true);
    for (const side of ['left', 'right']) {
      const sign = side === 'left' ? 1 : -1;
      const upper = worldPoint(vrm, `${side}UpperArm`);
      const elbow = worldPoint(vrm, `${side}LowerArm`);
      const wrist = worldPoint(vrm, `${side}Hand`);
      assert.ok(sign * (wrist.x - upper.x) < 0.095, `${side} wrist is not held outward like a penguin`);
      if (assetName === 'adult-twintail-v2.vrm') {
        assert.ok(sign * wrist.x > 0.19 && sign * wrist.x < 0.20, `${side} wrist clears the character's wide skirt`);
      }
      assert.ok(sign * (elbow.x - upper.x) < 0.055, `${side} elbow stays close to torso`);
      assert.ok(upper.y - elbow.y > 0.19);
      assert.ok(elbow.y - wrist.y > 0.17);
      assert.ok(wrist.z - upper.z > 0.025 && wrist.z - upper.z < 0.10, `${side} elbow is softly flexed`);
      const palm = new Vector3(0, -1, 0).applyQuaternion(normalized(vrm, `${side}Hand`).getWorldQuaternion(new Quaternion()));
      assert.ok(palm.dot(new Vector3(-sign, 0, 0)) > 0.90, `${side} palm faces inward`);
      const ratios = [];
      for (const finger of ['Index', 'Little']) {
        const current = localFinger(vrm, side, finger);
        assert.ok(current.tip.y - current.base.y < -0.012, `${side} ${finger} bends toward palm -Y rather than splaying in Z`);
        assert.ok(Math.abs(current.tip.z - flat[side][finger].tip.z) < 0.012, `${side} ${finger} does not fan sideways`);
        ratios.push(Math.abs((current.tip.x - current.base.x) / (flat[side][finger].tip.x - flat[side][finger].base.x)));
      }
      assert.ok(ratios[1] < ratios[0] - 0.05, `${side} little finger is more curled than index`);
    }
  });

  test(`${assetName}: conversational pose raises only one actual wrist with its palm diagonally up`,
    {skip: !existsSync(resolve(root, 'assets/avatar', assetName))}, async t => {
    const vrm = await actualRig(assetName);
    t.after(() => VRMUtils.deepDispose(vrm.scene));
    const motion = new AvatarMotion({...stillOptions, restPose: fixtureRestPose(assetName)});
    motion.bind(vrm); vrm.update(0); vrm.scene.updateMatrixWorld(true);
    const leftRest = worldPoint(vrm, 'leftHand');
    const rightRest = worldPoint(vrm, 'rightHand');
    let peak = null;
    for (let frame = 0; frame < 210; frame++) {
      motion.update({deltaSeconds: 1 / 60, playing: true, energy: 0.8, sequence: 1});
      vrm.update(1 / 60); vrm.scene.updateMatrixWorld(true);
      assert.ok(Math.min(motion.leftGesture, motion.rightGesture) < 0.02, 'never continuously wave both arms');
      if (!peak || motion.leftGesture > peak.amount) {
        peak = {amount: motion.leftGesture, left: worldPoint(vrm, 'leftHand'), right: worldPoint(vrm, 'rightHand'),
          palm: new Vector3(0, -1, 0).applyQuaternion(normalized(vrm, 'leftHand').getWorldQuaternion(new Quaternion())),
          finger: localFinger(vrm, 'left', 'Index')};
      }
    }
    assert.ok(peak.amount > 0.75);
    assert.ok(peak.left.y - leftRest.y > 0.07, 'the speaking wrist rises with elbow flexion');
    assert.ok(peak.left.z - leftRest.z > 0.10, 'forearm comes forward, not sideways');
    assert.ok(peak.right.distanceTo(rightRest) < 0.003, 'other hand remains composed at rest');
    assert.ok(peak.palm.y > 0.55, 'palm is diagonally upward, not a knife edge');
    assert.ok(peak.finger.tip.y - peak.finger.base.y < -0.005, 'gesture retains a gentle finger curve');
    advance(motion, 5, {playing: false}); vrm.update(0); vrm.scene.updateMatrixWorld(true);
    assert.ok(worldPoint(vrm, 'leftHand').distanceTo(leftRest) < 0.0001);
    assert.ok(worldPoint(vrm, 'rightHand').distanceTo(rightRest) < 0.0001);
  });
}

test('speech has substantial composed rests rather than perpetual sine-wave hands', () => {
  const motion = new AvatarMotion(stillOptions);
  motion.bind(model());
  let restingFrames = 0;
  for (let frame = 0; frame < 720; frame++) {
    motion.update({deltaSeconds: 1 / 60, playing: true, energy: 0.8, sequence: 1});
    if (Math.max(motion.leftGesture, motion.rightGesture) < 0.02) restingFrames++;
    assert.ok(Math.min(motion.leftGesture, motion.rightGesture) < 0.02);
  }
  assert.ok(restingFrames > 720 * 0.35);
  assert.ok(motion.gestureCount >= 2 && motion.gestureCount <= 3);
});

test('quiet playback cannot trigger gestures and custom straight fingers do not hyperextend', () => {
  const quiet = new AvatarMotion(stillOptions);
  quiet.bind(model());
  advance(quiet, 12, {energy: 0.03});
  assert.equal(quiet.gestureCount, 0);
  assert.equal(quiet.leftGesture, 0);
  const avatar = model();
  const custom = new AvatarMotion({...stillOptions, restPose: {leftIndexProximal: [0, 0, 0]}});
  custom.bind(avatar); advance(custom, 1.8);
  nearRotation(rotation(avatar, 'leftIndexProximal'), new Quaternion());
});

for (const [version, profile] of [['v2', v2MotionProfile], ['v3', v3MotionProfile]]) {
test(version + ' profile keeps the actual hand surface outside the skirt during rest, gesture and cancel',
  {skip: !existsSync(resolve(root, 'assets/avatar/adult-twintail-' + version + '.vrm'))}, async t => {
  const vrm = await actualRig('adult-twintail-' + version + '.vrm');
  t.after(() => VRMUtils.deepDispose(vrm.scene));
  const skirts = [];
  const hands = new Set();
  for (const side of ['left', 'right']) {
    for (const name of ['Hand', 'ThumbMetacarpal', 'ThumbProximal', 'ThumbDistal',
      'IndexProximal', 'IndexIntermediate', 'IndexDistal', 'MiddleProximal', 'MiddleIntermediate', 'MiddleDistal',
      'RingProximal', 'RingIntermediate', 'RingDistal', 'LittleProximal', 'LittleIntermediate', 'LittleDistal']) {
      const bone = vrm.humanoid.getRawBoneNode(`${side}${name}`);
      if (bone) hands.add(bone);
    }
  }
  const handVertices = [];
  vrm.scene.traverse(mesh => {
    if (!mesh.isSkinnedMesh) return;
    if (/skirt/i.test(mesh.name) && !/lining/i.test(mesh.name)) skirts.push(mesh);
    const indices = mesh.geometry.getAttribute('skinIndex');
    const weights = mesh.geometry.getAttribute('skinWeight');
    if (!indices || !weights) return;
    // Masked source buffers can still contain unused hand positions: check
    // only vertices that are actually referenced by rendered triangles.
    for (const index of new Set(mesh.geometry.index?.array || [])) {
      let handWeight = 0;
      for (let influence = 0; influence < 4; influence++) {
        if (hands.has(mesh.skeleton.bones[indices.getComponent(index, influence)])) {
          handWeight += weights.getComponent(index, influence);
        }
      }
      if (handWeight > 0.8) handVertices.push({mesh, index});
    }
  });
  skirts.sort((a, b) => b.geometry.index.count - a.geometry.index.count);
  const skirt = skirts[0];
  assert.ok(skirt, 'the current character has an actual skirt shell to test');
  assert.ok(handVertices.length > 500, 'test the hand skin surface, not just wrist joint origins');
  const motion = new AvatarMotion(profile);
  motion.bind(vrm);
  const ray = new Raycaster(), point = new Vector3(), direction = new Vector3(), origin = new Vector3();
  const intersections = [];
  function checkClearance(label) {
    vrm.update(0);
    vrm.scene.updateMatrixWorld(true);
    let minimum = Infinity, tested = 0;
    for (const {mesh, index} of handVertices) {
      mesh.getVertexPosition(index, point).applyMatrix4(mesh.matrixWorld);
      if (point.y < 0.66 || point.y > 1.018) continue;
      origin.set(0, point.y, 0);
      direction.set(point.x, 0, point.z).normalize();
      ray.set(origin, direction);
      intersections.length = 0;
      ray.intersectObject(skirt, false, intersections);
      if (!intersections.length) continue;
      const shellDistance = Math.max(...intersections.map(hit => hit.distance));
      minimum = Math.min(minimum, Math.hypot(point.x, point.z) - shellDistance);
      tested++;
    }
    assert.ok(tested > 300, `${label}: meaningful hand surface coverage`);
    assert.ok(minimum > 0.003, `${label}: hand-to-skirt clearance ${minimum.toFixed(5)}m must exceed 3mm`);
  }
  checkClearance('rest');
  advance(motion, 1.0);
  checkClearance('raising one hand');
  advance(motion, 0.8);
  checkClearance('conversational hold');
  motion.reset({beforeSequence: 2});
  advance(motion, 0.25, {sequence: 1});
  checkClearance('cancel return');
  advance(motion, 5, {playing: false});
  checkClearance('settled after stop');
});
}
