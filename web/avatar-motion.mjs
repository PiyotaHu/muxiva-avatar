import {Euler, Quaternion} from 'three';

const BODY_BONES = ['head', 'neck', 'spine', 'chest', 'upperChest',
  'leftShoulder', 'rightShoulder', 'leftUpperArm', 'rightUpperArm',
  'leftLowerArm', 'rightLowerArm', 'leftHand', 'rightHand'];
const FINGERS = ['Index', 'Middle', 'Ring', 'Little'];
const SEGMENTS = ['Proximal', 'Intermediate', 'Distal'];

// XYZ Euler radians relative to the normalized VRM bind pose. These are not
// raw/exporter-specific bone rotations. A model may override any named bone.
const restPose = {
  leftUpperArm: [0.025, 0, -1.44], rightUpperArm: [0.025, 0, 1.44],
  leftLowerArm: [0, -0.24, -0.015], rightLowerArm: [0, 0.24, 0.015],
  leftHand: [0, 0.025, -0.025], rightHand: [0, -0.025, 0.025],
};
const REST_CURL = [[0.20, 0.38, 0.18], [0.28, 0.46, 0.22],
  [0.34, 0.52, 0.27], [0.40, 0.60, 0.30]];
for (const [side, sign] of [['left', -1], ['right', 1]]) {
  for (const [fingerIndex, finger] of FINGERS.entries()) {
    for (const [index, segment] of SEGMENTS.entries()) {
      restPose[`${side}${finger}${segment}`] = [0, 0, sign * REST_CURL[fingerIndex][index]];
    }
  }
  restPose[`${side}ThumbMetacarpal`] = [0.06, sign * 0.10, sign * 0.10];
  restPose[`${side}ThumbProximal`] = [0.17, 0, sign * 0.20];
  restPose[`${side}ThumbDistal`] = [0.12, 0, sign * 0.12];
}
export const DEFAULT_REST_POSE = Object.freeze(Object.fromEntries(
  Object.entries(restPose).map(([name, angles]) => [name, Object.freeze(angles)])));

const finiteClamp = (value, fallback, min, max) => Number.isFinite(value)
  ? Math.max(min, Math.min(max, value)) : fallback;
const smoothstep = value => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
};
// Uneven, low-frequency pose accents with real rests. These are generic idle
// offsets, not semantic gestures, gaze targets, or a separate animation clock.
const POSTURE_TARGETS = [
  {yaw: -.9, tilt: .85, hip: .8, attack: 1.8, hold: .55, release: 2.0, pause: 2.8},
  {yaw: .75, tilt: -.75, hip: -.65, attack: 2.1, hold: .8, release: 2.2, pause: 3.6},
  {yaw: -.6, tilt: -.55, hip: .55, attack: 1.9, hold: .4, release: 2.4, pause: 2.4},
  {yaw: 1, tilt: 1, hip: -1, attack: 2.3, hold: .65, release: 2.0, pause: 3.2},
  {yaw: .45, tilt: -.9, hip: .65, attack: 2.0, hold: .5, release: 2.3, pause: 3.8},
];

/**
 * Small procedural movements, not semantic gestures or phoneme prediction.
 * No audio clock, animation loop, asset names, or application/turn state live
 * here. The renderer supplies actual playback activity and mouth energy.
 *
 * Amounts are 0..2; restPose is a per-normalized-bone [x,y,z] radians map.
 * Optional headYawAmount/headTiltAmount add paused accents (unit peaks about
 * 4.0/2.3 degrees). hipSwayAmount adds only hip roll, capped below one degree.
 * All three default to zero, preserving existing profiles and gaze ownership.
 * Missing optional bones are ignored. Rotation work reuses scratch objects.
 */
export class AvatarMotion {
  constructor({enabled = true, breathingAmount = 1, idleAmount = 1,
               speechAmount = 1, gestureAmount = 1, fingerAmount = 1,
               headYawAmount = 0, headTiltAmount = 0, hipSwayAmount = 0,
               attackSeconds = 0.16, releaseSeconds = 0.42,
               gestureDelaySeconds = 0.55, gesturePauseSeconds = 2.8,
               gestureAttackSeconds = 0.65, gestureHoldSeconds = 0.60,
               gestureReleaseSeconds = 0.80, restPose = {}} = {}) {
    this.options = {
      enabled: Boolean(enabled),
      breathingAmount: finiteClamp(breathingAmount, 1, 0, 2),
      idleAmount: finiteClamp(idleAmount, 1, 0, 2),
      speechAmount: finiteClamp(speechAmount, 1, 0, 2),
      gestureAmount: finiteClamp(gestureAmount, 1, 0, 2),
      fingerAmount: finiteClamp(fingerAmount, 1, 0, 2),
      headYawAmount: finiteClamp(headYawAmount, 0, 0, 2),
      headTiltAmount: finiteClamp(headTiltAmount, 0, 0, 2),
      hipSwayAmount: finiteClamp(hipSwayAmount, 0, 0, 2),
      attackSeconds: finiteClamp(attackSeconds, 0.16, 0.03, 2),
      releaseSeconds: finiteClamp(releaseSeconds, 0.42, 0.08, 3),
      gestureDelaySeconds: finiteClamp(gestureDelaySeconds, 0.55, 0.15, 5),
      gesturePauseSeconds: finiteClamp(gesturePauseSeconds, 2.8, 1.5, 12),
      gestureAttackSeconds: finiteClamp(gestureAttackSeconds, 0.65, 0.3, 2),
      gestureHoldSeconds: finiteClamp(gestureHoldSeconds, 0.60, 0.1, 2),
      gestureReleaseSeconds: finiteClamp(gestureReleaseSeconds, 0.80, 0.4, 2),
    };
    this.restPose = {...DEFAULT_REST_POSE};
    for (const [name, angles] of Object.entries(restPose || {})) {
      if (Array.isArray(angles) && angles.length === 3 && angles.every(Number.isFinite)) {
        this.restPose[name] = angles.map(value => finiteClamp(value, 0, -Math.PI, Math.PI));
      }
    }
    this.bones = new Map();
    this.elapsed = 0;
    this.speechWeight = 0;
    this.playback = null;
    this.blockedPlayback = null;
    this.euler = new Euler(0, 0, 0, 'XYZ');
    this.offset = new Quaternion();
    this._clearGestures();
    this._clearPosture();
  }

  _clearPosture() {
    this.postureAge = -1; this.postureWait = 1.6; this.postureCount = 0;
    this.headYaw = 0; this.headTilt = 0; this.hipRoll = 0;
  }

  _clearGestures() {
    this.gestureAge = -1;
    this.gestureWait = this.options.gestureDelaySeconds;
    this.gestureSide = 'left'; this.nextGestureSide = 'left';
    this.gestureCount = 0; this.leftGesture = 0; this.rightGesture = 0;
  }

  bind(vrm) {
    this.unbind();
    const humanoid = vrm?.humanoid;
    if (typeof humanoid?.getNormalizedBoneNode !== 'function') return;
    const bodyBones = this.options.hipSwayAmount > 0 ? [...BODY_BONES, 'hips'] : BODY_BONES;
    for (const name of new Set([...bodyBones, ...Object.keys(this.restPose)])) {
      const bone = humanoid.getNormalizedBoneNode(name);
      if (!bone?.quaternion) continue;
      const original = bone.quaternion.clone();
      const resting = original.clone();
      const angles = this.restPose[name];
      if (angles) resting.multiply(this.offset.setFromEuler(this.euler.set(...angles)));
      this.bones.set(name, {bone, original, resting});
    }
    this._apply();
  }

  /** Cancel only the current playback identity, without snapping the body. */
  reset({immediate = false, streamId = 'assistant', beforeSequence} = {}) {
    // Match the audio/timeline cancellation contract: the watermark is strict.
    // A delayed cancellation must not silence a newer playback generation.
    if (beforeSequence !== undefined && (!this.playback ||
        this.playback.streamId !== streamId || !(this.playback.sequence < beforeSequence))) return false;
    this.blockedPlayback = this.playback ? {...this.playback} : null;
    this.gestureAge = -1;
    this.gestureWait = this.options.gestureDelaySeconds;
    if (immediate) {
      this.speechWeight = 0;
      this.leftGesture = 0; this.rightGesture = 0;
      this._apply();
    }
    return true;
  }

  /** Restore captured bones before releasing or replacing a model. */
  unbind() {
    for (const {bone, original} of this.bones.values()) bone.quaternion.copy(original);
    this.bones.clear();
    this.elapsed = 0;
    this.speechWeight = 0;
    this.playback = null;
    this.blockedPlayback = null;
    this._clearGestures();
    this._clearPosture();
  }

  update({deltaSeconds = 1 / 60, playing = false, energy = 0,
          streamId = 'assistant', sequence} = {}) {
    const dt = finiteClamp(deltaSeconds, 0, 0, 0.1);
    this.elapsed += dt;
    const changedPlayback = playing && (!this.playback ||
      this.playback.streamId !== streamId || this.playback.sequence !== sequence);
    if (changedPlayback) {
      this.gestureAge = -1;
      this.gestureWait = this.options.gestureDelaySeconds;
    }
    if (!playing || (this.blockedPlayback &&
        (streamId !== this.blockedPlayback.streamId || sequence !== this.blockedPlayback.sequence))) {
      this.blockedPlayback = null;
    }
    if (playing) {
      if (!this.playback) this.playback = {streamId, sequence};
      else { this.playback.streamId = streamId; this.playback.sequence = sequence; }
    } else this.playback = null;
    const audible = finiteClamp(energy, 0, 0, 1);
    const target = this.options.enabled && playing && !this.blockedPlayback && audible > 0.01
      ? 0.25 + 0.75 * Math.sqrt(audible) : 0;
    const smoothing = target > this.speechWeight ? this.options.attackSeconds : this.options.releaseSeconds;
    this.speechWeight += (target - this.speechWeight) * (1 - Math.exp(-dt / smoothing));
    if (this.speechWeight < 0.0001) this.speechWeight = 0;
    this._updateGesture(dt, Boolean(this.options.enabled && playing && !this.blockedPlayback), audible);
    this._updatePosture(dt);
    this._apply();
    return this.speechWeight;
  }

  _rotate(name, x = 0, y = 0, z = 0) {
    const record = this.bones.get(name);
    if (!record) return;
    this.euler.set(x, y, z);
    record.bone.quaternion.multiply(this.offset.setFromEuler(this.euler));
  }

  _updatePosture(dt) {
    const options = this.options;
    if (!options.enabled || !(options.headYawAmount || options.headTiltAmount || options.hipSwayAmount)) {
      this._clearPosture();
      return;
    }
    this.headYaw = 0; this.headTilt = 0; this.hipRoll = 0;
    if (this.postureAge < 0) {
      this.postureWait -= dt;
      if (this.postureWait > 0) return;
      this.postureAge = -this.postureWait;
      this.postureCount++;
    } else this.postureAge += dt;
    const pose = POSTURE_TARGETS[(this.postureCount - 1) % POSTURE_TARGETS.length];
    const duration = pose.attack + pose.hold + pose.release;
    if (this.postureAge >= duration) {
      this.postureWait = pose.pause - (this.postureAge - duration);
      this.postureAge = -1;
      return;
    }
    const age = this.postureAge;
    const envelope = age < pose.attack ? smoothstep(age / pose.attack)
      : age < pose.attack + pose.hold ? 1
      : 1 - smoothstep((age - pose.attack - pose.hold) / pose.release);
    this.headYaw = pose.yaw * envelope * 0.070 * options.headYawAmount;
    this.headTilt = pose.tilt * envelope * 0.040 * options.headTiltAmount;
    // Rotate the standard pelvis only: no translation or accumulated drift,
    // and no knowledge of any clothing, spring chain, or character name.
    this.hipRoll = pose.hip * envelope * Math.min(0.014 * options.hipSwayAmount, 0.017);
  }

  _updateGesture(dt, playing, audible) {
    const options = this.options;
    const duration = options.gestureAttackSeconds + options.gestureHoldSeconds + options.gestureReleaseSeconds;
    if (!playing) {
      this.gestureAge = -1; this.gestureWait = options.gestureDelaySeconds;
    } else if (this.gestureAge >= 0) {
      this.gestureAge += dt;
      if (this.gestureAge >= duration) {
        this.gestureAge = -1;
        this.gestureWait = options.gesturePauseSeconds * (1 + (this.gestureCount % 3) * 0.13);
      }
    } else if (audible > 0.08 && options.gestureAmount > 0) {
      this.gestureWait -= dt;
      if (this.gestureWait <= 0 && this.leftGesture < 0.025 && this.rightGesture < 0.025) {
        this.gestureAge = 0; this.gestureSide = this.nextGestureSide;
        this.nextGestureSide = this.gestureSide === 'left' ? 'right' : 'left'; this.gestureCount++;
      }
    }
    let envelope = 0;
    if (this.gestureAge >= 0) {
      if (this.gestureAge < options.gestureAttackSeconds) envelope = smoothstep(this.gestureAge / options.gestureAttackSeconds);
      else if (this.gestureAge < options.gestureAttackSeconds + options.gestureHoldSeconds) envelope = 1;
      else envelope = 1 - smoothstep((this.gestureAge - options.gestureAttackSeconds - options.gestureHoldSeconds) / options.gestureReleaseSeconds);
    }
    const strength = Math.min(1, envelope * this.speechWeight * options.gestureAmount);
    const smoothing = 1 - Math.exp(-dt / 0.18);
    const leftTarget = this.gestureSide === 'left' ? strength : 0;
    const rightTarget = this.gestureSide === 'right' ? strength : 0;
    this.leftGesture += (leftTarget - this.leftGesture) * smoothing;
    this.rightGesture += (rightTarget - this.rightGesture) * smoothing;
    if (this.leftGesture < 0.0001) this.leftGesture = 0;
    if (this.rightGesture < 0.0001) this.rightGesture = 0;
  }

  _apply() {
    // Always start at the captured neutral pose: no frame-to-frame drift.
    for (const {bone, resting} of this.bones.values()) bone.quaternion.copy(resting);
    if (!this.options.enabled) return;
    const t = this.elapsed;
    const breath = Math.sin(t * 1.65) * this.options.breathingAmount;
    const idle = this.options.idleAmount;
    const speech = this.options.speechAmount;
    this._rotate('hips', 0, 0, this.hipRoll);
    this._rotate('spine', breath * 0.004, 0, Math.sin(t * 0.48) * 0.004 * idle);
    this._rotate('chest', breath * 0.007);
    this._rotate('upperChest', breath * 0.003);
    this._rotate('leftShoulder', 0, 0, -breath * 0.004);
    this._rotate('rightShoulder', 0, 0, breath * 0.004);
    const nod = (this.leftGesture + this.rightGesture) * 0.032 * speech;
    const glance = Math.sin(t * 0.53) * 0.020 * idle + (this.rightGesture - this.leftGesture) * 0.018 * speech + this.headYaw;
    this._rotate('neck', nod * 0.30, glance * 0.25);
    this._rotate('head', nod * 0.70, glance * 0.75,
      Math.sin(t * 0.71) * 0.010 * idle + (this.leftGesture - this.rightGesture) * 0.006 * speech + this.headTilt);

    this._hand('left', -1, this.leftGesture);
    this._hand('right', 1, this.rightGesture);
  }

  _hand(side, sign, amount) {
    // Bend the elbow then roll around its longitudinal axis; do not flap the
    // shoulder sideways. Keep fingers softly curled throughout the gesture.
    this._rotate(`${side}UpperArm`, 0, sign * amount * 0.08, -sign * amount * 0.035);
    this._rotate(`${side}LowerArm`, 0, sign * amount * 0.98, 0);
    this._rotate(`${side}LowerArm`, -amount * 1.20, 0, 0);
    this._rotate(`${side}Hand`, 0, -sign * amount * 0.045, -sign * amount * 0.055);
    const opening = Math.min(0.75, amount * this.options.fingerAmount * 0.50);
    for (let index = 0; index < FINGERS.length; index++) {
      const prefix = `${side}${FINGERS[index]}`;
      for (let joint = 0; joint < SEGMENTS.length; joint++) {
        const boneName = `${prefix}${SEGMENTS[joint]}`;
        this._rotate(boneName, 0, 0, -(this.restPose[boneName]?.[2] || 0) * opening);
      }
    }
    this._rotate(`${side}ThumbMetacarpal`, -amount * 0.04, -sign * amount * 0.05, -sign * amount * 0.05);
    this._rotate(`${side}ThumbProximal`, -amount * 0.05, 0, -sign * amount * 0.07);
  }
}
