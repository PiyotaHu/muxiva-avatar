const finite = (value, label) => {
  if (!Number.isFinite(value)) throw new TypeError(label + ' must be finite');
  return value;
};
const pair = (value, label) => {
  if (!Array.isArray(value) || value.length !== 2) throw new TypeError(label + ' must contain two coordinates');
  return [finite(value[0], label), finite(value[1], label)];
};
const region = (value, label) => {
  const center = pair(value?.center, label + '.center');
  const radius = pair(value?.radius, label + '.radius');
  if (radius.some(value => value <= 0 || value > .5)) throw new RangeError(label + '.radius must be in (0, .5]');
  return {center, radius};
};
const clamp01 = value => Math.max(0, Math.min(1, value));
const smoothstep = value => { const t = clamp01(value); return t * t * (3 - 2 * t); };
const dome = (u, v, area) => {
  const x = (u - area.center[0]) / area.radius[0];
  const y = (v - area.center[1]) / area.radius[1];
  const remaining = Math.max(0, 1 - x * x - y * y);
  return remaining * remaining;
};

function depthSampler({rig, aspect, strength = 1} = {}) {
  finite(aspect, 'aspect');
  finite(strength, 'strength');
  if (aspect <= 0) throw new RangeError('aspect must be positive');
  if (strength < 0 || strength > 1) throw new RangeError('strength must be in [0, 1]');
  const face = region(rig?.face, 'rig.face');
  const pivot = pair(rig?.head?.pivot, 'rig.head.pivot');
  if (!Array.isArray(rig?.eyes) || rig.eyes.length !== 2) throw new TypeError('rig.eyes must contain two eyes');
  const eyes = rig.eyes.map((eye, index) => pair(eye?.center, 'rig.eyes[' + index + '].center'));
  const mouth = pair(rig?.mouth?.center, 'rig.mouth.center');
  const nose = {
    center: mouth.map((value, axis) => .4 * (eyes[0][axis] + eyes[1][axis]) / 2 + .6 * value),
    radius: [face.radius[0] * .24, face.radius[1] * .27],
  };
  const neck = rig.neck === undefined ? null : region(rig.neck, 'rig.neck');
  const neckEnd = pivot[1];
  const neckStart = Math.min(neck ? neck.center[1] - neck.radius[1] : neckEnd - face.radius[1] * .35,
    neckEnd - face.radius[1] * .1);
  // Use the smaller physical half-extent so a wide face cannot acquire an
  // excessive vertical slope. This is an authored shallow relief, not a
  // reconstructed head: no scalp, hidden side, lighting, or texture changes.
  const radius = Math.min(face.radius[0] * aspect, face.radius[1]);
  return (u, v) => {
    if (strength === 0 || v >= neckEnd) return 0;
    const faceDome = dome(u, v, face);
    if (faceDome === 0) return 0;
    const neckWeight = 1 - smoothstep((v - neckStart) / (neckEnd - neckStart));
    // Tether the nose to the same face envelope, including unusually placed
    // authored landmarks, so it cannot introduce a step at the face edge.
    return radius * strength * faceDome * (.40 + .10 * dome(u, v, nose)) * neckWeight;
  };
}

/** Depth in renderer world units; UV uses the authored face's top-left origin.
 * At rest, an orthographic camera retains every original x/y and texture UV.
 * The renderer supplies its existing bounded pose (yaw <= 12°, pitch <= 8°).
 * This pure field owns neither a pose nor an animation/audio clock.
 */
export function headSurfaceDepth(uvTopLeft, options) {
  const [u, v] = pair(uvTopLeft, 'uvTopLeft');
  return depthSampler(options)(u, v);
}

/** Set only z on a head geometry. rect is faceSourceRect (or its bounds),
 * never the colour atlas sourceRect. Calling again replaces depth rather than
 * accumulating a transform; strength=0 restores a flat plane.
 */
export function applyHeadSurface(geometry, {rect, ...options} = {}) {
  if (!Array.isArray(rect) || rect.length !== 4 || !rect.every(Number.isFinite)
    || rect[2] <= 0 || rect[3] <= 0) throw new TypeError('rect must contain a finite nonzero rectangle');
  const sample = depthSampler(options);
  const position = geometry?.getAttribute?.('position') ?? geometry?.attributes?.position;
  const uv = geometry?.getAttribute?.('uv') ?? geometry?.attributes?.uv;
  if (!position || !uv || !Number.isSafeInteger(position.count) || position.count < 1
    || position.count !== uv.count || position.itemSize < 3 || uv.itemSize < 2
    || typeof position.getX !== 'function' || typeof position.getY !== 'function'
    || typeof position.setZ !== 'function' || typeof uv.getX !== 'function' || typeof uv.getY !== 'function')
    throw new TypeError('geometry requires matching position and uv attributes');
  // Validate all source coordinates before mutating the supplied geometry.
  const depths = new Float32Array(position.count);
  for (let index = 0; index < position.count; index++) {
    finite(position.getX(index), 'position.x');
    finite(position.getY(index), 'position.y');
    const u = finite(uv.getX(index), 'uv.x');
    const v = finite(uv.getY(index), 'uv.y');
    depths[index] = sample(rect[0] + u * rect[2], rect[1] + (1 - v) * rect[3]);
    finite(depths[index], 'surface depth');
  }
  for (let index = 0; index < position.count; index++) position.setZ(index, depths[index]);
  position.needsUpdate = true;
  geometry.computeBoundingBox?.();
  geometry.computeBoundingSphere?.();
  return geometry;
}
