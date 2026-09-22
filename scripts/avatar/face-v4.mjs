import {Matrix3, Vector3} from 'three';

const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const bell = x => Math.exp(-x * x);
export const PORTRAIT_SMILE_V4 = Object.freeze({
  expression: 'portraitSmile', recommendedWeight: 0.60, speakingWeight: 0.20,
  targetName: 'Face_Blendshape.Fcl_MTH_PortraitSmile',
  targets: Object.freeze({Fcl_BRW_Joy: 0.20, Fcl_EYE_Fun: 0.18, Fcl_MTH_PortraitSmile: 1}),
});

/** Offline sculpt of the licensed source topology, not a runtime identity rule.
 * The supplied portrait is a visual reference, not a calibrated 3D scan; these
 * anatomical constraints do not promise pixel-identical reconstruction.
 */
export function faceShapeV4(x, y, z, part = 'skin') {
  const ax = Math.abs(x), side = Math.sign(x) || 1;
  const front = smooth(0.005, 0.036, z);
  // Slim cheek/mandible while retaining a rounded mental pad. Shorten only
  // the very bottom of the chin, not the whole adult lower-face proportion.
  const cheek = bell((y - 1.425) / 0.034), mandible = bell((y - 1.382) / 0.023);
  const mental = bell((y - 1.357) / 0.014);
  const width = 0.934 - 0.037 * cheek - 0.030 * mandible + 0.034 * mental;
  let px = x * width;
  let py = y + 0.0034 * mental * (1 - smooth(0.041, 0.061, ax));
  let pz = z + 0.0008 * mental * front;

  // The aperture is contracted around its own anatomical centreline, with
  // a tapered medial/lateral end and raised lateral canthus. A flat inner
  // mask covers the complete eye; unlike a Gaussian it does not leave the
  // tall upper/lower boundary mostly undeformed.
  const across = clamp((ax - 0.044) / 0.025, -1.3, 1.3);
  const eyeMask = smooth(0.013, 0.022, ax) * (1 - smooth(0.072, 0.090, ax))
    * (1 - smooth(0.024, 0.046, Math.abs(y - 1.445))) * front;
  if (part === 'iris' || part === 'highlight') {
    // Iris and its separate glint use one mapping. Keep a near-circular disc
    // behind the narrower lids, rather than stretching the pupil with them.
    px = side * (0.0415 * 0.900 + (ax - 0.0415) * 0.930);
    py = 1.4430 + (y - 1.4432) * 0.865;
    pz = z - 0.0003;
  } else {
    const aperture = 0.665 - 0.10 * Math.min(1, Math.abs(across) ** 1.4);
    const centreline = 1.4446 + 0.0040 * across;
    const upperHood = 0.0006 * bell(across / 0.85) * smooth(1.445, 1.452, y);
    py += (centreline + (y - 1.445) * aperture - y - upperHood) * eyeMask;
    px += side * 0.00065 * across * eyeMask;
    pz -= 0.00035 * eyeMask;
  }

  // Smaller alae and a shallow, softly lit bridge. The source tip projects
  // furthest at y=1.407; reducing it there avoids a long pointed anime nose.
  const nose = bell(x / 0.016) * bell((y - 1.411) / 0.020) * front;
  px -= x * 0.24 * nose;
  pz -= 0.0015 * bell(x / 0.009) * bell((y - 1.407) / 0.009) * front;
  pz += 0.00055 * bell(x / 0.006) * bell((y - 1.422) / 0.012) * front;

  // The actual source lip seam is y≈1.3844, not the top of the upper lip.
  // Both lips/cavity share this continuous map, keeping the neutral slit
  // closed while drawing a gentle U-shaped smile and modest cupid's bow.
  const mouth = (1 - smooth(0.018, 0.033, ax))
    * (1 - smooth(0.010, 0.023, Math.abs(y - 1.3844))) * smooth(0.047, 0.068, z);
  const corner = smooth(0.003, 0.014, ax);
  px += x * 0.045 * mouth;
  py += 0.00135 * corner * mouth;
  pz += 0.00035 * bell(x / 0.014) * bell((y - 1.3844) / 0.005) * mouth;
  if (part === 'brow') {
    const sourceArch = 1.4803 + 0.0015 * bell((ax - 0.040) / 0.020);
    const referenceArch = 1.4759 + 0.0028 * bell((ax - 0.047) / 0.024);
    py = referenceArch + (y - sourceArch) * 0.55;
  }
  return [px, py, pz];
}

/** Additional closed-lip smile in the already sculpted bind space. Its
 * compact support excludes nose, eyes, chin and inner tongue/teeth. No jaw
 * opening: the centre of both lip edges receives exactly zero vertical shift.
 */
export function portraitSmileShapeV4(x, y, z, part = 'skin') {
  if (part !== 'skin' && part !== 'mouth') return [x, y, z];
  const ax = Math.abs(x);
  const mask = (1 - smooth(0.017, 0.031, ax))
    * (1 - smooth(0.009, 0.018, Math.abs(y - 1.3850))) * smooth(0.054, 0.069, z);
  const corner = smooth(0.002, 0.0125, ax);
  return [x + x * 0.055 * mask, y + 0.0025 * corner * mask, z + 0.00025 * corner * mask];
}

function normalAfter(map, point, normal, part) {
  const epsilon = 0.00001, at = map(...point, part), columns = [];
  for (let axis = 0; axis < 3; axis++) {
    const shifted = [...point]; shifted[axis] += epsilon;
    columns.push(map(...shifted, part).map((value, component) => (value - at[component]) / epsilon));
  }
  const jacobian = new Matrix3().set(
    columns[0][0], columns[1][0], columns[2][0],
    columns[0][1], columns[1][1], columns[2][1],
    columns[0][2], columns[1][2], columns[2][2]);
  if (!Number.isFinite(jacobian.determinant()) || jacobian.determinant() < 0.12) {
    throw new Error('Face v4 deformation would fold or collapse the source surface');
  }
  return new Vector3(...normal).applyMatrix3(jacobian.invert().transpose()).normalize().toArray();
}

function partFor(name) {
  if (/EyeIris/i.test(name)) return 'iris';
  if (/EyeHighlight/i.test(name)) return 'highlight';
  if (/FaceBrow/i.test(name)) return 'brow';
  if (/FaceMouth/i.test(name)) return 'mouth';
  return 'skin';
}

export function sculptFaceV4(b, {faceTexture, irisTexture} = {}) {
  const meshIndex = b.j.meshes.findIndex(mesh => mesh.name === 'Face' && Array.isArray(mesh.extras?.targetNames));
  if (meshIndex < 0) throw new Error('Face v4 requires the reviewed source Face mesh with named morph targets');
  const face = b.j.meshes[meshIndex], names = face.extras.targetNames;
  if (names.length !== 57) throw new Error('Face v4 must be built once from the original 57-target source, not another sculpt');
  const sourceTargetCount = names.length, smileIndex = sourceTargetCount;
  const targetIndices = Object.fromEntries(Object.keys(PORTRAIT_SMILE_V4.targets).map(name => {
    const index = name === 'Fcl_MTH_PortraitSmile' ? smileIndex
      : names.findIndex(target => target.endsWith(`.${name}`) || target === name);
    if (index < 0) throw new Error(`Missing authored facial target: ${name}`);
    return [name, index];
  }));
  const nodes = b.j.nodes.flatMap((node, index) => node.mesh === meshIndex ? [index] : []);
  if (!nodes.length) throw new Error('Source Face mesh has no scene node');
  let vertices = 0, maxDisplacement = 0, transformedTargets = 0, smileVertices = 0;
  for (const primitive of face.primitives) {
    if (primitive.targets?.length !== sourceTargetCount) throw new Error('Inconsistent source morph count');
    const part = partFor(b.j.materials[primitive.material]?.name || '');
    const positions = b.readAccessor(primitive.attributes.POSITION), normals = b.readAccessor(primitive.attributes.NORMAL);
    const deformed = new Float32Array(positions.length), normalBase = new Float32Array(normals.length);
    for (let i = 0; i < positions.length; i += 3) {
      const p = [positions[i], positions[i + 1], positions[i + 2]], next = faceShapeV4(...p, part);
      deformed.set(next, i);
      normalBase.set(normalAfter(faceShapeV4, p, [normals[i], normals[i + 1], normals[i + 2]], part), i);
      maxDisplacement = Math.max(maxDisplacement, Math.hypot(...next.map((value, k) => value - p[k])));
    }
    for (const target of primitive.targets) {
      const delta = target.POSITION === undefined ? new Float32Array(positions.length) : b.readAccessor(target.POSITION);
      const deltaNormal = target.NORMAL === undefined ? null : b.readAccessor(target.NORMAL);
      const out = new Float32Array(delta.length), outNormal = deltaNormal ? new Float32Array(deltaNormal.length) : null;
      for (let i = 0; i < positions.length; i += 3) {
        const moved = delta[i] !== 0 || delta[i + 1] !== 0 || delta[i + 2] !== 0;
        const renormalize = deltaNormal && (deltaNormal[i] !== 0 || deltaNormal[i + 1] !== 0 || deltaNormal[i + 2] !== 0);
        if (!moved && !renormalize) continue;
        const endpoint = [positions[i] + delta[i], positions[i + 1] + delta[i + 1], positions[i + 2] + delta[i + 2]];
        const result = faceShapeV4(...endpoint, part);
        for (let k = 0; k < 3; k++) out[i + k] = result[k] - deformed[i + k];
        if (outNormal) {
          const n = normalAfter(faceShapeV4, endpoint,
            [normals[i] + deltaNormal[i], normals[i + 1] + deltaNormal[i + 1], normals[i + 2] + deltaNormal[i + 2]], part);
          for (let k = 0; k < 3; k++) outNormal[i + k] = n[k] - normalBase[i + k];
        }
      }
      if (target.POSITION !== undefined) target.POSITION = b.accessor(out, 3, {bounds: true, target: 34962});
      if (outNormal) target.NORMAL = b.accessor(outNormal, 3, {target: 34962});
      transformedTargets++;
    }
    const smile = new Float32Array(positions.length), smileNormal = new Float32Array(normals.length);
    for (let i = 0; i < positions.length; i += 3) {
      const point = Array.from(deformed.subarray(i, i + 3)), next = portraitSmileShapeV4(...point, part);
      if (next.every((value, k) => value === point[k])) continue;
      const normal = normalAfter(portraitSmileShapeV4, point, Array.from(normalBase.subarray(i, i + 3)), part);
      for (let k = 0; k < 3; k++) { smile[i + k] = next[k] - point[k]; smileNormal[i + k] = normal[k] - normalBase[i + k]; }
      smileVertices++;
    }
    primitive.targets.push({POSITION: b.accessor(smile, 3, {bounds: true, target: 34962}),
      NORMAL: b.accessor(smileNormal, 3, {target: 34962})});
    primitive.attributes.POSITION = b.accessor(deformed, 3, {bounds: true, target: 34962});
    primitive.attributes.NORMAL = b.accessor(normalBase, 3, {target: 34962});
    vertices += positions.length / 3;
  }
  names.push(PORTRAIT_SMILE_V4.targetName);
  if (face.weights) face.weights.push(0);
  for (const node of nodes) if (b.j.nodes[node].weights) b.j.nodes[node].weights.push(0);

  const material = name => b.j.materials.find(value => value.name === name);
  const skin = material('Face_00_SKIN'), iris = material('EyeIris_00_EYE');
  if (faceTexture && skin) {
    const texture = b.texture(faceTexture);
    skin.pbrMetallicRoughness.baseColorTexture = {index: texture};
    const toon = skin.extensions?.VRMC_materials_mtoon;
    if (toon) Object.assign(toon, {shadeMultiplyTexture: {index: texture},
      shadeColorFactor: [0.94, 0.86, 0.88], outlineWidthFactor: 0.00024});
  }
  if (irisTexture && iris) {
    iris.pbrMetallicRoughness.baseColorFactor = [1, 1, 1, 1];
    iris.pbrMetallicRoughness.baseColorTexture = {index: b.texture(irisTexture)};
    if (iris.extensions) delete iris.extensions.VRMC_materials_mtoon;
  }
  const brow = material('FaceBrow_00_FACE');
  if (brow) brow.pbrMetallicRoughness.baseColorFactor = [0.38, 0.32, 0.39, 1];
  const line = material('FaceEyeline_00_FACE');
  if (line) {
    line.pbrMetallicRoughness.baseColorFactor = [0.22, 0.16, 0.23, 1];
    if (line.extensions?.VRMC_materials_mtoon) line.extensions.VRMC_materials_mtoon.outlineWidthFactor = 0.00010;
  }
  const expressions = b.j.extensions.VRMC_vrm.expressions;
  expressions.custom ??= {};
  expressions.custom[PORTRAIT_SMILE_V4.expression] = {
    isBinary: false, overrideBlink: 'none', overrideMouth: 'none', overrideLookAt: 'none',
    morphTargetBinds: nodes.flatMap(node => Object.entries(PORTRAIT_SMILE_V4.targets)
      .map(([name, weight]) => ({node, index: targetIndices[name], weight}))),
  };
  return {version: 4, vertices, primitives: face.primitives.length, transformedTargets,
    sourceTargetCount, targetCount: names.length, maxDisplacement, smileVertices,
    expression: PORTRAIT_SMILE_V4.expression, recommendedWeight: PORTRAIT_SMILE_V4.recommendedWeight,
    speakingWeight: PORTRAIT_SMILE_V4.speakingWeight, targetIndices};
}
