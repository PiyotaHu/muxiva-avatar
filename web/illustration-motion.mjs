const clamp = (x, low = -1, high = 1) => {
  const result = Math.max(low, Math.min(high, x));
  return result === 0 ? 0 : result;
};
const number = (x, fallback, low, high) => Number.isFinite(x) ? clamp(x, low, high) : fallback;
const smoothstep = x => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };
const approach = (value, target, dt, seconds) => {
  const next = value + (target - value) * (1 - Math.exp(-dt / seconds));
  return Math.abs(next) < 0.0001 && target === 0 ? 0 : next;
};
const TAU = Math.PI * 2;
const POSTURES = [
  [-0.80, 0.65, 0.60, 1.8, 0.5, 2.0, 2.8],
  [0.70, -0.70, -0.55, 2.1, 0.8, 2.2, 3.6],
  [-0.50, -0.45, 0.40, 1.9, 0.4, 2.4, 2.4],
  [0.90, 0.75, -0.65, 2.3, 0.6, 2.0, 3.2],
];

export const ILLUSTRATION_MOTION_LIMITS = Object.freeze({
  headYaw: [-1, 1], headTilt: [-1, 1], nod: [0, 1], bodyLean: [-1, 1],
  breath: [-1, 1], leftHand: [0, 1], rightHand: [0, 1], hair: [-1, 1],
  skirt: [-1, 1], mouthOpen: [0, 1],
  gazeX: [-1, 1], gazeY: [-1, 1], shoulder: [-1, 1], hipShift: [-1, 1],
  headPitch: [-1, 1], smile: [0, 1],
});
const neutral = () => Object.fromEntries(Object.keys(ILLUSTRATION_MOTION_LIMITS).map(key => [key, 0]));

/** Dimensionless, bounded pose offsets for a 2.5D renderer. A model manifest
 * owns warp anchors, direction and physical/pixel amplitudes. No image sizes,
 * asset identities, WebGL, timers, audio clocks or Agent/Turn decisions live here.
 * The caller supplies REAL consumed-audio activity once per render frame.
 * Amounts are 0..2. Returned values are snapshots, not an accumulated transform.
 * Opaque stream ids mark sessions; the eight most recently retired ids are
 * rejected. A new renderer/motion instance is the lifetime boundary for assets.
 */
export class IllustrationMotion {
  constructor(options = {}) {
    options = options && typeof options === 'object' ? options : {};
    this.options = {
      enabled: options.enabled === undefined ? true : options.enabled === true,
      breathingAmount: number(options.breathingAmount, 1, 0, 2),
      idleAmount: number(options.idleAmount, 1, 0, 2),
      speechAmount: number(options.speechAmount, 1, 0, 2),
      gestureAmount: number(options.gestureAmount, 1, 0, 2),
      headYawAmount: number(options.headYawAmount, 0.85, 0, 2),
      headTiltAmount: number(options.headTiltAmount, 1, 0, 2),
      hairAmount: number(options.hairAmount, 1, 0, 2),
      skirtAmount: number(options.skirtAmount, 1, 0, 2),
      attentionAmount: number(options.attentionAmount, 1, 0, 2),
      activityAmount: number(options.activityAmount, 1, 0, 2),
      interactionAmount: number(options.interactionAmount, 1, 0, 2),
      reducedMotion: options.reducedMotion === true,
      attackSeconds: number(options.attackSeconds, 0.16, 0.03, 2),
      releaseSeconds: number(options.releaseSeconds, 0.42, 0.08, 3),
      gestureDelaySeconds: number(options.gestureDelaySeconds, 0.55, 0.15, 5),
      gesturePauseSeconds: number(options.gesturePauseSeconds, 2.8, 1.5, 12),
      gestureAttackSeconds: number(options.gestureAttackSeconds, 0.65, 0.3, 2),
      gestureHoldSeconds: number(options.gestureHoldSeconds, 0.60, 0.1, 2),
      gestureReleaseSeconds: number(options.gestureReleaseSeconds, 0.80, 0.4, 2),
    };
    this.playback = null;
    this.cancelBefore = -1;
    this.blockedUnknown = false;
    this.retiredStreams = new Set();
    this.phase = 0;
    this.postureAge = -1;
    this.postureWait = 1.6;
    this.postureIndex = -1;
    this.speechWeight = 0;
    this.mouth = 0;
    this.leftHand = 0;
    this.rightHand = 0;
    this.hair = 0;
    this.skirt = 0;
    this.gazeX = 0; this.gazeY = 0;
    this.headFocusX = 0; this.headFocusY = 0;
    this.attentionWeight = 0;
    this.listeningWeight = 0; this.thinkingWeight = 0;
    this.smile = 0;
    this.lastInteractionId = -1;
    this.interactionAge = -1;
    this.interactionType = null;
    this.interactionSide = 'left';
    this.gestureIndex = 0;
    this.gestureSide = 'left';
    this.nextGestureSide = 'left';
    this._releaseGesture();
    this.params = neutral();
  }

  _releaseGesture() {
    this.gestureAge = -1;
    this.gestureWait = this.options.gestureDelaySeconds;
  }

  _acceptPlayback(streamId, sequence) {
    if (typeof streamId !== 'string' || !streamId || streamId.length > 512) return false;
    const untagged = sequence === undefined || sequence === null;
    if (!untagged && (!Number.isSafeInteger(sequence) || sequence < 0)) return false;
    if (this.retiredStreams.has(streamId)) return false;
    const next = untagged ? null : sequence;
    if (!this.playback || this.playback.streamId !== streamId) {
      if (this.playback) {
        this.retiredStreams.add(this.playback.streamId);
        if (this.retiredStreams.size > 8) this.retiredStreams.delete(this.retiredStreams.values().next().value);
      }
      this.playback = {streamId, sequence: next};
      this.cancelBefore = -1;
      this.blockedUnknown = false;
      this._releaseGesture();
    } else {
      const previous = this.playback.sequence;
      // Untagged/older samples cannot bypass a known generation or watermark.
      if (previous !== null && (next === null || next < previous)) return false;
      if (next !== null && next < this.cancelBefore) return false;
      if (next === null && this.blockedUnknown) return false;
      if (next !== previous) {
        this.playback.sequence = next;
        this._releaseGesture();
      }
    }
    return next === null ? !this.blockedUnknown : next >= this.cancelBefore;
  }

  /** Strict watermark: cancel sequences LESS THAN beforeSequence. A delayed
   * cancellation cannot release newer speech or another stream. Speech and
   * hands decay on update; immediate is for disposal/model replacement only.
   * Keeping the accepted identity while idle prevents late PCM from restarting
   * a cancelled generation after one or more playing=false updates. The caller
   * may explicitly clearSession when it has discarded the old session's audio
   * queue and callbacks; this releases ownership for a restarted seq counter.
   */
  reset(input = {}) {
    input = input && typeof input === 'object' ? input : {};
    const {streamId = this.playback?.streamId ?? 'assistant', beforeSequence,
      immediate = false, clearSession = false} = input;
    if (clearSession === true) {
      // This is a caller-owned session boundary, never inferred from an old
      // sequence or from a silent render frame. Do not reset the idle phase.
      this.playback = null;
      this.cancelBefore = -1;
      this.blockedUnknown = false;
      this.retiredStreams.clear();
    } else if (!(immediate === true && !this.playback && input.streamId === undefined && beforeSequence === undefined)) {
      if (!this.playback || streamId !== this.playback.streamId) return false;
      if (beforeSequence !== undefined && (!Number.isFinite(beforeSequence) ||
          this.playback.sequence === null || !(this.playback.sequence < beforeSequence))) return false;
      if (this.playback.sequence === null) this.blockedUnknown = true;
      else this.cancelBefore = Math.max(this.cancelBefore,
        beforeSequence === undefined ? this.playback.sequence + 1 : beforeSequence);
    }
    this._releaseGesture();
    // Click ids belong to this presentation instance, not an audio session.
    // Keep their high-water mark so a delayed UI event cannot replay on reset.
    this.interactionAge = -1;
    this.interactionType = null;
    this.mouth = 0;
    this.params = {...this.params, mouthOpen: 0};
    if (immediate === true) {
      this.speechWeight = 0;
      this.leftHand = 0; this.rightHand = 0;
      this.hair = 0; this.skirt = 0;
      this.gazeX = 0; this.gazeY = 0;
      this.headFocusX = 0; this.headFocusY = 0;
      this.attentionWeight = 0;
      this.listeningWeight = 0; this.thinkingWeight = 0;
      this.smile = 0;
      this.params = neutral();
    }
    return true;
  }

  _posture(dt) {
    if (this.postureAge < 0) {
      this.postureWait -= dt;
      if (this.postureWait > 0) return [0, 0, 0];
      this.postureAge = -this.postureWait;
      this.postureIndex = (this.postureIndex + 1) % POSTURES.length;
    } else this.postureAge += dt;
    const [yaw, tilt, lean, attack, hold, release, pause] = POSTURES[this.postureIndex];
    const duration = attack + hold + release;
    if (this.postureAge >= duration) {
      this.postureWait = pause - (this.postureAge - duration);
      this.postureAge = -1;
      return [0, 0, 0];
    }
    const age = this.postureAge;
    const envelope = age < attack ? smoothstep(age / attack)
      : age < attack + hold ? 1 : 1 - smoothstep((age - attack - hold) / release);
    return [yaw * envelope, tilt * envelope, lean * envelope];
  }

  _attention(dt, attention, activity) {
    const valid = attention && attention.active === true &&
      Number.isFinite(attention.x) && Number.isFinite(attention.y);
    const x = valid ? clamp(attention.x) : 0, y = valid ? clamp(attention.y) : 0;
    // Eyes lead the head. Missing/inactive attention smoothly returns to centre;
    // there is no retained DOM object, wall clock, pointer history or timer.
    this.gazeX = approach(this.gazeX, x, dt, valid ? .07 : .20);
    this.gazeY = approach(this.gazeY, y, dt, valid ? .07 : .20);
    this.headFocusX = approach(this.headFocusX, x, dt, .24);
    this.headFocusY = approach(this.headFocusY, y, dt, .24);
    this.attentionWeight = approach(this.attentionWeight, valid ? 1 : 0, dt, .20);
    this.listeningWeight = approach(this.listeningWeight, activity === 'listening' ? 1 : 0, dt, .30);
    this.thinkingWeight = approach(this.thinkingWeight, activity === 'thinking' ? 1 : 0, dt, .40);
  }

  _interaction(dt, input) {
    if (input && ['greet', 'acknowledge'].includes(input.type) &&
        Number.isSafeInteger(input.id) && input.id >= 0 && input.id > this.lastInteractionId) {
      this.lastInteractionId = input.id;
      this.interactionType = input.type;
      this.interactionAge = 0;
      // Reuse the currently raised side; never cross-fade into two raised arms.
      this.interactionSide = this.leftHand > 0 ? 'left' : this.rightHand > 0 ? 'right' : this.nextGestureSide;
      if (input.type === 'greet') this.nextGestureSide = this.interactionSide === 'left' ? 'right' : 'left';
    }
    if (this.options.interactionAmount === 0) {
      this.interactionAge = -1; this.interactionType = null;
    }
    if (this.interactionAge < 0) return {greet: false, wave: 0, nod: 0, smile: 0};
    this.interactionAge += dt;
    const greet = this.interactionType === 'greet';
    const attack = greet ? .30 : .18, hold = greet ? .95 : .18, release = greet ? .75 : .70;
    const age = this.interactionAge, duration = attack + hold + release;
    if (age >= duration) {
      this.interactionAge = -1; this.interactionType = null;
      return {greet: false, wave: 0, nod: 0, smile: 0};
    }
    const envelope = age < attack ? smoothstep(age / attack)
      : age < attack + hold ? 1 : 1 - smoothstep((age - attack - hold) / release);
    // One raised-hand greeting with two small pulses, not a perpetual wave.
    const wave = greet ? envelope * (.78 + .16 * Math.sin(TAU * Math.max(0, age - attack) / .55)) : 0;
    const nod = Math.sin(Math.PI * clamp(age / (greet ? .85 : .62), 0, 1)) ** 2 * envelope;
    const amount = this.options.interactionAmount;
    return {greet, wave: clamp(wave * amount, 0, 1),
      nod: clamp(nod * amount, 0, 1), smile: clamp(envelope * amount * .85, 0, 1)};
  }

  _gesture(dt, active, energy, cue) {
    const o = this.options;
    const duration = o.gestureAttackSeconds + o.gestureHoldSeconds + o.gestureReleaseSeconds;
    if (cue.greet || !active) this._releaseGesture();
    else if (this.gestureAge >= 0) {
      this.gestureAge += dt;
      if (this.gestureAge >= duration) {
        this.gestureAge = -1;
        this.gestureWait = o.gesturePauseSeconds * (1 + (this.gestureIndex % 3) * 0.13);
      }
    } else if (energy > 0.08 && o.gestureAmount > 0) {
      this.gestureWait = Math.max(0, this.gestureWait - dt);
      // Exact rest before switching sides: no double-hand cross-fade.
      if (this.gestureWait === 0 && this.leftHand === 0 && this.rightHand === 0) {
        this.gestureAge = 0;
        this.gestureSide = this.nextGestureSide;
        this.nextGestureSide = this.gestureSide === 'left' ? 'right' : 'left';
        this.gestureIndex = (this.gestureIndex + 1) % 6;
      }
    }
    const age = this.gestureAge;
    const envelope = age < 0 ? 0 : age < o.gestureAttackSeconds ? smoothstep(age / o.gestureAttackSeconds)
      : age < o.gestureAttackSeconds + o.gestureHoldSeconds ? 1
      : 1 - smoothstep((age - o.gestureAttackSeconds - o.gestureHoldSeconds) / o.gestureReleaseSeconds);
    const strength = active && energy > 0.01 ? clamp(envelope * this.speechWeight * o.gestureAmount, 0, 1) : 0;
    let left = this.gestureSide === 'left' ? strength : 0;
    let right = this.gestureSide === 'right' ? strength : 0;
    if (cue.greet) {
      left = this.interactionSide === 'left' ? cue.wave * o.gestureAmount : 0;
      right = this.interactionSide === 'right' ? cue.wave * o.gestureAmount : 0;
    }
    left = clamp(left, 0, 1); right = clamp(right, 0, 1);
    this.leftHand = approach(this.leftHand, left, dt, left > this.leftHand ? 0.18 : o.releaseSeconds);
    this.rightHand = approach(this.rightHand, right, dt, right > this.rightHand ? 0.18 : o.releaseSeconds);
  }

  update(input = {}) {
    input = input && typeof input === 'object' ? input : {};
    const {deltaSeconds = 1 / 60, streamId = 'assistant', sequence, playing = false, energy = 0,
      attention, interaction, activity = 'idle'} = input;
    const dt = number(deltaSeconds, 0, 0, 0.1);
    if (!this.options.enabled) { this.params = neutral(); return {...this.params}; }
    this.phase = (this.phase + dt * 0.20) % TAU;
    const active = playing === true && this._acceptPlayback(streamId, sequence);
    const audible = active ? number(energy, 0, 0, 1) : 0;
    const target = audible > 0.01 ? 0.25 + 0.75 * Math.sqrt(audible) : 0;
    this.speechWeight = approach(this.speechWeight, target, dt,
      target > this.speechWeight ? this.options.attackSeconds : this.options.releaseSeconds);
    this.mouth = active && audible > 0.01
      ? approach(this.mouth, Math.sqrt(audible), dt, 0.045) : 0;
    this._attention(dt, attention, activity);
    const cue = this._interaction(dt, interaction);
    this._gesture(dt, active, audible, cue);
    const [yaw, tilt, lean] = this._posture(dt), o = this.options;
    const handDifference = this.rightHand - this.leftHand;
    const movement = o.reducedMotion ? .12 : 1;
    const listening = this.listeningWeight * o.activityAmount, thinking = this.thinkingWeight * o.activityAmount;
    const focused = clamp(this.attentionWeight * o.attentionAmount, 0, 1);
    const gazeX = clamp((this.gazeX * o.attentionAmount + thinking * .18 * (1 - focused)) * (o.reducedMotion ? .35 : 1));
    const gazeY = clamp((this.gazeY * o.attentionAmount - thinking * .14 * (1 - focused)) * (o.reducedMotion ? .35 : 1));
    const headYaw = clamp((yaw * .54 * o.headYawAmount * o.idleAmount
      + Math.sin(this.phase * 3) * .055 * o.idleAmount + handDifference * .08 * o.speechAmount
      + this.headFocusX * .45 * o.attentionAmount * o.headYawAmount + thinking * .12 * o.headYawAmount) * movement);
    const headTilt = clamp((tilt * .44 * o.headTiltAmount * o.idleAmount
      + Math.sin(this.phase * 4) * .045 * o.idleAmount
      + this.headFocusX * .075 * o.attentionAmount * o.headTiltAmount + listening * .10 * o.headTiltAmount
      + cue.smile * .08 * o.headTiltAmount) * movement);
    const bodyLean = clamp((lean * .30 * o.idleAmount + Math.sin(this.phase * 2) * .035 * o.idleAmount
      + handDifference * .06 * o.speechAmount) * movement);
    const breath = clamp((Math.sin(this.phase * 8 + .22 * Math.sin(this.phase)) * .48
      + Math.sin(this.phase * 16) * .055) * o.breathingAmount * movement);
    const hipShift = clamp((lean * .43 * o.idleAmount + Math.sin(this.phase * 2) * .10 * o.idleAmount
      - handDifference * .065 * o.speechAmount) * movement);
    const shoulder = clamp((breath * .22 + lean * .075 * o.idleAmount + listening * .10
      + thinking * .065 + this.speechWeight * .055 * o.speechAmount) * movement);
    const nod = clamp(((this.leftHand + this.rightHand) * .35 * o.speechAmount + cue.nod * .65) * movement, 0, 1);
    const headPitch = clamp((this.headFocusY * .34 * o.attentionAmount + listening * .085
      - thinking * .10 + cue.nod * .24 + breath * .04 * o.idleAmount) * movement);
    const smileTarget = clamp(cue.smile + listening * .12 + this.attentionWeight * .055 * o.attentionAmount
      + this.speechWeight * .12 * o.speechAmount, 0, 1);
    this.smile = approach(this.smile, smileTarget, dt, smileTarget > this.smile ? .12 : .26);
    this.hair = approach(this.hair, clamp((headYaw * .55 + bodyLean * .30 + hipShift * .14
      + Math.sin(this.phase * 2) * .025 * o.idleAmount * movement) * o.hairAmount), dt, .45);
    this.skirt = approach(this.skirt, clamp((bodyLean * .40 + hipShift * .55
      + Math.sin(this.phase * 2) * .025 * o.idleAmount * movement) * o.skirtAmount), dt, .65);
    this.params = {headYaw, headTilt, nod, bodyLean, breath,
      leftHand: o.reducedMotion ? 0 : this.leftHand, rightHand: o.reducedMotion ? 0 : this.rightHand,
      hair: this.hair, skirt: this.skirt, mouthOpen: this.mouth,
      gazeX, gazeY, shoulder, hipShift, headPitch, smile: this.smile};
    return {...this.params};
  }
}
