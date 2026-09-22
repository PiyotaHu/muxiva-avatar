import assert from 'node:assert/strict';
import test from 'node:test';
import {IllustrationMotion, ILLUSTRATION_MOTION_LIMITS} from '../web/illustration-motion.mjs';

const quietOptions = {breathingAmount: 0, idleAmount: 0, headYawAmount: 0, headTiltAmount: 0};
const voiced = {playing: true, energy: 0.8, streamId: 'assistant', sequence: 1};
function advance(motion, seconds, input = voiced, fps = 60) {
  let params;
  for (let frame = 0; frame < Math.ceil(seconds * fps); frame++) params = motion.update({...input, deltaSeconds: 1 / fps});
  return params;
}
function bounded(params) {
  assert.deepEqual(Object.keys(params).sort(), Object.keys(ILLUSTRATION_MOTION_LIMITS).sort());
  for (const [name, [low, high]] of Object.entries(ILLUSTRATION_MOTION_LIMITS)) {
    assert.ok(Number.isFinite(params[name]), name + ' is finite');
    assert.ok(params[name] >= low && params[name] <= high, name + ' stays normalized');
  }
  assert.equal(params.leftHand * params.rightHand, 0, 'never simultaneously animate both hands');
}
const assertZero = params => Object.values(params).forEach(value => assert.equal(value, 0));

test('default and empty inputs have no mouth or hand motion; all output fields are dimensionless', () => {
  const motion = new IllustrationMotion();
  for (let frame = 0; frame < 600; frame++) {
    const params = motion.update(); bounded(params);
    assert.equal(params.mouthOpen, 0); assert.equal(params.leftHand, 0); assert.equal(params.rightHand, 0);
  }
  assert.ok(Math.abs(motion.params.breath) > 0);
});

test('energy alone, silent playback and non-boolean playing cannot initiate gestures', () => {
  for (const input of [{playing: false, energy: 1}, {playing: true, energy: 0},
    {playing: true, energy: 0.01}, {playing: 'true', energy: 1}]) {
    const motion = new IllustrationMotion(quietOptions);
    assertZero(advance(motion, 12, {...voiced, ...input}));
    assert.equal(motion.gestureIndex, 0);
  }
  const quiet = new IllustrationMotion(quietOptions);
  const params = advance(quiet, 12, {...voiced, energy: 0.03});
  assert.ok(params.mouthOpen > 0, 'quiet speech can move the lips');
  assert.equal(params.leftHand + params.rightHand, 0, 'quiet speech does not launch a hand gesture');
});

test('speech produces occasional single-side gestures with substantial neutral rests', () => {
  const motion = new IllustrationMotion(quietOptions);
  let peakLeft = 0, peakRight = 0, resting = 0, peakNod = 0;
  for (let frame = 0; frame < 1800; frame++) {
    const params = motion.update({...voiced, deltaSeconds: 1 / 60}); bounded(params);
    peakLeft = Math.max(peakLeft, params.leftHand); peakRight = Math.max(peakRight, params.rightHand);
    peakNod = Math.max(peakNod, params.nod);
    if (Math.max(params.leftHand, params.rightHand) < 0.02) resting++;
  }
  assert.ok(peakLeft > 0.70 && peakRight > 0.70);
  assert.ok(peakNod > 0.20 && peakNod < 0.36);
  assert.ok(resting > 1800 * 0.35, 'not perpetual sine-wave waving');
});

test('hands need sustained audible time before the first gesture, not merely elapsed idle time', () => {
  const motion = new IllustrationMotion(quietOptions);
  advance(motion, 10, {playing: false, energy: 1});
  advance(motion, 0.3);
  assert.equal(motion.params.leftHand + motion.params.rightHand, 0);
  advance(motion, 0.8);
  assert.ok(motion.params.leftHand > 0.05);
});

test('stopping closes the mouth immediately and eases the active hand back without snapping', () => {
  const motion = new IllustrationMotion(quietOptions);
  const peak = advance(motion, 1.6);
  assert.ok(peak.leftHand > 0.7 && peak.mouthOpen > 0.8);
  const firstStop = motion.update({...voiced, playing: false, deltaSeconds: 1 / 60});
  assert.equal(firstStop.mouthOpen, 0);
  assert.ok(firstStop.leftHand > peak.leftHand * 0.9 && firstStop.leftHand < peak.leftHand);
  const settled = advance(motion, 6, {...voiced, playing: false});
  assertZero(settled);
});

test('strict cancellation cannot affect equal/newer sequence or another stream', () => {
  const motion = new IllustrationMotion(quietOptions);
  advance(motion, 1.6, {...voiced, sequence: 5});
  const before = {...motion.params};
  assert.equal(motion.reset({beforeSequence: 5}), false);
  assert.equal(motion.reset({beforeSequence: 4}), false);
  assert.equal(motion.reset({streamId: 'unrelated', beforeSequence: 6}), false);
  assert.deepEqual(motion.params, before);
  assert.equal(motion.reset({beforeSequence: 6}), true);
  assert.equal(motion.params.leftHand, before.leftHand, 'reset itself does not snap the hand');
  assert.equal(motion.params.mouthOpen, 0);
});

test('cancelled old PCM stays blocked across idle updates and newer audio can start', () => {
  const motion = new IllustrationMotion(quietOptions);
  advance(motion, 1.6);
  assert.equal(motion.reset({beforeSequence: 2}), true);
  advance(motion, 1, {...voiced, playing: false});
  assertZero(advance(motion, 8, voiced));
  const fresh = advance(motion, 1.6, {...voiced, sequence: 2});
  assert.ok(fresh.mouthOpen > 0.8 && Math.max(fresh.leftHand, fresh.rightHand) > 0.7);
  assert.equal(motion.reset({beforeSequence: 2}), false, 'late cancellation still cannot touch the replacement');
});

test('cancel watermark blocks intermediate generations, not just the last exact identity', () => {
  const motion = new IllustrationMotion(quietOptions);
  advance(motion, 1.6, {...voiced, sequence: 3});
  motion.reset({beforeSequence: 7, immediate: true});
  assertZero(advance(motion, 2, {...voiced, sequence: 6}));
  assert.ok(advance(motion, 1.6, {...voiced, sequence: 7}).mouthOpen > 0.8);
});

test('late lower sequences and invalid identity values cannot replace current playback', () => {
  const motion = new IllustrationMotion(quietOptions);
  advance(motion, 1.6, {...voiced, sequence: 8});
  for (const sequence of [7, undefined, null, NaN, Infinity, '9', -1, 1.5]) {
    const params = motion.update({...voiced, sequence});
    assert.equal(params.mouthOpen, 0);
    assert.equal(motion.playback.sequence, 8);
  }
  assert.ok(advance(motion, 1, {...voiced, sequence: 8}).mouthOpen > 0.8);
});

test('new stream accepts its own sequence counter, releases previous hand and rejects recent retired streams', () => {
  const motion = new IllustrationMotion(quietOptions);
  const old = advance(motion, 1.6, {...voiced, streamId: 'session-a', sequence: 50});
  const replacement = motion.update({...voiced, streamId: 'session-b', sequence: 1});
  assert.ok(replacement.leftHand > old.leftHand * 0.9, 'stream replacement cannot snap the image');
  assert.equal(motion.playback.streamId, 'session-b');
  assert.equal(motion.reset({streamId: 'session-a', beforeSequence: 99}), false);
  motion.update({...voiced, streamId: 'session-a', sequence: 51});
  assert.equal(motion.playback.streamId, 'session-b', 'recent retired session cannot seize the renderer');
  for (let frame = 0; frame < 480; frame++) bounded(motion.update({...voiced, streamId: 'session-b', sequence: 1}));
  assert.ok(motion.params.mouthOpen > 0.8);
});

test('untagged playback is supported but an untagged cancel cannot be bypassed by going idle', () => {
  const motion = new IllustrationMotion(quietOptions);
  const input = {playing: true, energy: 0.8};
  assert.ok(advance(motion, 1.6, input).mouthOpen > 0.8);
  assert.equal(motion.reset(), true);
  advance(motion, 1, {playing: false});
  assertZero(advance(motion, 6, input));
  assert.ok(advance(motion, 1.6, {...input, sequence: 1}).mouthOpen > 0.8);
});

test('immediate reset clears visible offsets and does not permit cancelled speech to restart', () => {
  const motion = new IllustrationMotion(quietOptions);
  advance(motion, 1.6);
  assert.equal(motion.reset({immediate: true}), true);
  assertZero(motion.params);
  assertZero(advance(motion, 6));
  const replacement = new IllustrationMotion(quietOptions);
  assertZero(replacement.update({deltaSeconds: 0}));
  assert.ok(advance(replacement, 1.6).mouthOpen > 0.8, 'new model owns clean state');
});

test('explicit session rebind allows a restarted counter without snapping the old hand or idle pose', () => {
  const motion = new IllustrationMotion({headYawAmount: 1, headTiltAmount: 1});
  const before = advance(motion, 1.6, {...voiced, sequence: 50});
  motion.reset({beforeSequence: 51});
  const phase = motion.phase;
  assert.equal(motion.reset({clearSession: true}), true);
  assert.equal(motion.playback, null);
  assert.equal(motion.cancelBefore, -1);
  assert.equal(motion.params.leftHand, before.leftHand);
  assert.equal(motion.phase, phase);
  const next = motion.update({...voiced, sequence: 0});
  assert.equal(motion.playback.sequence, 0);
  assert.ok(next.mouthOpen > 0);
  assert.ok(next.leftHand > before.leftHand * 0.9);
  for (let frame = 0; frame < 480; frame++) bounded(motion.update({...voiced, sequence: 0}));
  assert.ok(motion.params.mouthOpen > 0.8);
  assert.equal(new IllustrationMotion().reset({clearSession: true}), true, 'also valid before the first playback');
});

test('options can disable every warp channel; disabled motion remains neutral during speech', () => {
  const disabled = new IllustrationMotion({enabled: false});
  assertZero(advance(disabled, 20));
  const still = new IllustrationMotion({...quietOptions, speechAmount: 0, gestureAmount: 0,
    hairAmount: 0, skirtAmount: 0});
  const params = advance(still, 10);
  const {mouthOpen, ...body} = params;
  assertZero(body);
  assert.ok(mouthOpen > 0.8, 'mouth is real playback energy, not a procedural idle warp');
});

test('bad numbers, absent inputs and large frame delays remain finite and bounded', () => {
  const motion = new IllustrationMotion({breathingAmount: NaN, idleAmount: Infinity, gestureAmount: 999,
    headYawAmount: -5, attackSeconds: 0, releaseSeconds: NaN});
  bounded(motion.update(null));
  for (const deltaSeconds of [NaN, Infinity, -1, 0, 10]) {
    for (const energy of [NaN, Infinity, -3, 0, 0.5, 20]) bounded(motion.update({...voiced, deltaSeconds, energy}));
  }
  const short = new IllustrationMotion(), long = new IllustrationMotion();
  assert.deepEqual(short.update({...voiced, deltaSeconds: 0.1}), long.update({...voiced, deltaSeconds: 1000}));
  for (const beforeSequence of [NaN, Infinity, -1]) assert.equal(motion.reset({beforeSequence}), false);
});

test('repeated zero-time updates and caller mutation cannot accumulate or corrupt the pose', () => {
  const motion = new IllustrationMotion({headYawAmount: 1, headTiltAmount: 1});
  const expected = advance(motion, 3.3);
  const external = motion.update({...voiced, deltaSeconds: 0});
  external.headYaw = 999; external.leftHand = 999;
  for (let frame = 0; frame < 1000; frame++) assert.deepEqual(motion.update({...voiced, deltaSeconds: 0}), expected);
});

test('frame-rate changes preserve the same low-frequency pose within integration tolerance', () => {
  const low = new IllustrationMotion({headYawAmount: 1, headTiltAmount: 1});
  const high = new IllustrationMotion({headYawAmount: 1, headTiltAmount: 1});
  const a = advance(low, 1.6, voiced, 30), b = advance(high, 1.6, voiced, 120);
  for (const key of Object.keys(a)) assert.ok(Math.abs(a[key] - b[key]) < 0.06, key);
});

test('long running math has bounded phases/counters and finite, non-drifting output', () => {
  const motion = new IllustrationMotion({headYawAmount: 2, headTiltAmount: 2,
    breathingAmount: 2, gestureAmount: 2, hairAmount: 2, skirtAmount: 2});
  for (let frame = 0; frame < 18000; frame++) {
    const params = motion.update({...voiced, deltaSeconds: 0.1});
    bounded(params);
    assert.ok(motion.phase >= 0 && motion.phase < Math.PI * 2);
    assert.ok(motion.gestureIndex >= 0 && motion.gestureIndex < 6);
    assert.ok(motion.postureAge < 8 && motion.postureWait < 5);
  }
  for (let session = 0; session < 100; session++) motion.update({...voiced, streamId: 'session-' + session});
  assert.equal(motion.retiredStreams.size, 8, 'no unbounded session-history collection');
});

test('default idle has visible breathing and occasional weight/head changes without posing as speech', () => {
  const motion = new IllustrationMotion();
  const peaks = {breath: 0, hipShift: 0, headTilt: 0, shoulder: 0};
  let handFrames = 0;
  for (let frame = 0; frame < 1200; frame++) {
    const pose = motion.update({deltaSeconds: 1 / 60});
    for (const key of Object.keys(peaks)) peaks[key] = Math.max(peaks[key], Math.abs(pose[key]));
    handFrames += pose.leftHand + pose.rightHand > 0 ? 1 : 0;
    assert.equal(pose.mouthOpen, 0);
  }
  assert.ok(peaks.breath > .45, 'breath is an authored visible offset, not almost zero');
  assert.ok(peaks.hipShift > .15, 'weight shifts are not limited to breathing');
  assert.ok(peaks.headTilt > .15, 'default idle includes occasional head inclination');
  assert.ok(peaks.shoulder > .08);
  assert.equal(handFrames, 0, 'idle is not a perpetual waving loop');
});

test('new optional amount controls can suppress every interactive channel', () => {
  const motion = new IllustrationMotion({...quietOptions, attentionAmount: 0, activityAmount: 0,
    interactionAmount: 0, speechAmount: 0, gestureAmount: 0, hairAmount: 0, skirtAmount: 0});
  for (let frame = 0; frame < 240; frame++) {
    assertZero(motion.update({deltaSeconds: 1 / 60, playing: false, energy: 1,
      attention: {active: true, x: 1, y: -1}, activity: 'listening', interaction: {type: 'greet', id: 1}}));
  }
  assert.equal(motion.lastInteractionId, 1, 'disabled feedback still consumes a click rather than replaying it later');
});

test('reduced motion preserves lip synchronization while suppressing hand travel and reducing gaze/body offsets', () => {
  const regular = new IllustrationMotion(), reduced = new IllustrationMotion({reducedMotion: true});
  let regularHandPeak = 0, bodyDifference = 0;
  for (let frame = 0; frame < 300; frame++) {
    const input = {...voiced, deltaSeconds: 1 / 60, attention: {active: true, x: .7, y: -.3},
      interaction: {type: 'greet', id: 4}};
    const a = regular.update(input), b = reduced.update(input);
    bounded(a); bounded(b);
    assert.equal(a.mouthOpen, b.mouthOpen, 'accessibility preference must not create unrelated lip timing');
    assert.equal(b.leftHand + b.rightHand, 0);
    assert.ok(Math.abs(b.gazeX) <= Math.abs(a.gazeX) * .351 + 1e-10);
    assert.ok(Math.abs(b.headYaw) <= Math.abs(a.headYaw) * .121 + 1e-10);
    regularHandPeak = Math.max(regularHandPeak, a.leftHand, a.rightHand);
    bodyDifference = Math.max(bodyDifference, Math.abs(a.bodyLean - b.bodyLean));
  }
  assert.ok(regularHandPeak > .5 && bodyDifference > .05);
});

test('mixed interaction, attention and playback remain bounded over many session/cancel boundaries', () => {
  const motion = new IllustrationMotion({attentionAmount: 2, activityAmount: 2,
    interactionAmount: 2, headYawAmount: 2, headTiltAmount: 2, gestureAmount: 2});
  for (let frame = 0; frame < 6000; frame++) {
    const sequence = Math.floor(frame / 200);
    const pose = motion.update({deltaSeconds: .1, streamId: 'assistant', sequence,
      playing: frame % 13 > 2, energy: .8, activity: frame % 700 < 350 ? 'listening' : 'thinking',
      attention: {x: Math.sin(frame * .05) * 8, y: Math.cos(frame * .03) * 8, active: frame % 500 < 300},
      interaction: {type: frame % 800 < 400 ? 'greet' : 'acknowledge', id: Math.floor(frame / 400)}});
    bounded(pose);
    if (frame % 200 === 120) {
      motion.reset({beforeSequence: sequence + 1});
      assert.equal(motion.params.mouthOpen, 0);
    }
    assert.ok(motion.interactionAge >= -1 && motion.interactionAge <= 2);
  }
});

test('invalid presentation input cannot become a gesture or activity/audio state', () => {
  for (const interaction of [null, 'greet', {type: 'speaking', id: 1}, {type: 'greet', id: -1},
    {type: 'greet', id: NaN}, {type: 'greet', id: 2.5}, {type: 'acknowledge', id: '4'}]) {
    const motion = new IllustrationMotion(quietOptions);
    const pose = advance(motion, 4, {playing: false, energy: 1, interaction, activity: 'speaking',
      attention: {active: true, x: NaN, y: 1}});
    assertZero(pose);
    assert.equal(motion.lastInteractionId, -1);
  }
});
