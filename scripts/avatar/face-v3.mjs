import {Matrix3, Vector3} from 'three';

const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const bell = x => Math.exp(-x * x);

export const PORTRAIT_SMILE = Object.freeze({
  expression: 'portraitSmile', recommendedWeight: 0.55, speakingWeight: 0.30,
  targets: Object.freeze({'Fcl_BRW_Joy': 0.34, 'Fcl_EYE_Fun': 0.30, 'Fcl_MTH_Joy': 0.72}),
});

/**
 * The source's adult face is sculpted in bind space, not by squeezing the
 * whole head. The orbital opening and iris use different mappings: the iris
 * stays approximately round behind the almond eyelids. Coordinates refer to
 * the reviewed sample's original face topology, not a runtime character ID.
 */
export function faceShapeV3(x, y, z, part = 'skin') {
  const ax = Math.abs(x), side = Math.sign(x) || 1;
  const front = smooth(0.018, 0.048, z);
  const jaw = bell((y - 1.380) / 0.038);
  const width = 0.915 - 0.035 * jaw - 0.014 * bell((y - 1.425) / 0.043);
  let px = x * width, py = y, pz = z;

  // Suppress the high central upper arch, tighten the ends, lift the formerly
  // drooping outer canthus. Skin/white/lash seams receive the same mapping.
  const orbital = smooth(0.014, 0.023, ax) * (1 - smooth(0.073, 0.090, ax))
    * bell((y - 1.445) / 0.032) * front;
  const across = clamp((ax - 0.0435) / 0.025, -1.3, 1.3);
  const apertureScale = 0.74 - 0.12 * Math.min(1, Math.abs(across) ** 1.3);
  if (part === 'iris' || part === 'highlight') {
    // Preserve iris-disc roundness and highlight registration; the eyelids
    // should cover it, rather than deforming the pupil into a narrow ellipse.
    px = side * (0.0415 * 0.904 + (ax - 0.0415) * 0.985);
    py = 1.4432 + (y - 1.4432) * 0.92 + 0.0006;
  } else {
    px += side * (ax - 0.0435) * 0.055 * orbital;
    py += -(y - 1.445) * (1 - apertureScale) * orbital;
    py += (0.0038 * across + 0.0007) * orbital;
    py -= 0.0015 * bell(across / 0.75) * smooth(1.445, 1.452, y) * orbital;
  }

  // A finer bridge/tip without lengthening it or making a pointed nose.
  const nose = bell(x / 0.016) * bell((y - 1.416) / 0.022) * front;
  px -= x * 0.12 * nose;
  pz += 0.0009 * bell(x / 0.009) * bell((y - 1.420) / 0.021) * front;

  // Subtle rising corners and cupid's bow at neutral. Evaluate the same warp
  // at each full morph endpoint so mouth skin/cavity/teeth stay connected.
  const mouth = bell((y - 1.389) / 0.013) * bell(x / 0.033) * smooth(0.048, 0.071, z);
  const corner = smooth(0.003, 0.021, ax);
  px += x * 0.08 * mouth;
  py += 0.0042 * corner * mouth;
  py += 0.0008 * bell((ax - 0.0048) / 0.0035) * bell((y - 1.393) / 0.0035) * front;
  pz += 0.00065 * bell(x / 0.020) * bell((y - 1.388) / 0.0048) * smooth(0.067, 0.076, z);

  if (part === 'brow') {
    // Rebuild the brow ribbon around a finer, slightly outer-peaked arch.
    const oldArch = 1.4803 + 0.0015 * bell((ax - 0.040) / 0.020);
    const newArch = 1.4779 + 0.0028 * bell((ax - 0.049) / 0.023);
    py = newArch + (y - oldArch) * 0.62;
  }
  return [px, py, pz];
}

function transformedNormal(point, normal, part) {
  const epsilon = 0.00001, at = faceShapeV3(...point, part), columns = [];
  for (let axis = 0; axis < 3; axis++) {
    const shifted = [...point]; shifted[axis] += epsilon;
    columns.push(faceShapeV3(...shifted, part).map((value, component) => (value - at[component]) / epsilon));
  }
  const jacobian = new Matrix3().set(
    columns[0][0], columns[1][0], columns[2][0],
    columns[0][1], columns[1][1], columns[2][1],
    columns[0][2], columns[1][2], columns[2][2]);
  if (!Number.isFinite(jacobian.determinant()) || jacobian.determinant() < 0.12) {
    throw new Error('Face v3 deformation would fold or collapse the source surface');
  }
  return new Vector3(...normal).applyMatrix3(jacobian.invert().transpose()).normalize().toArray();
}

function partFor(name) {
  if (/EyeIris/i.test(name)) return 'iris';
  if (/EyeHighlight/i.test(name)) return 'highlight';
  if (/FaceBrow/i.test(name)) return 'brow';
  return 'skin';
}

/** Rebuild the original Face mesh, retaining every original named morph. */
export function sculptFaceV3(b, {faceTexture, irisTexture} = {}) {
  const meshIndex = b.j.meshes.findIndex(mesh => mesh.name === 'Face' && Array.isArray(mesh.extras?.targetNames));
  if (meshIndex < 0) throw new Error('Face v3 requires the reviewed source Face mesh with named morph targets');
  const face = b.j.meshes[meshIndex], names = face.extras.targetNames;
  const targetIndices = Object.fromEntries(Object.keys(PORTRAIT_SMILE.targets).map(name => {
    const index = names.findIndex(target => target.endsWith(`.${name}`) || target === name);
    if (index < 0) throw new Error(`Missing authored facial target: ${name}`);
    return [name, index];
  }));
  const nodes = b.j.nodes.flatMap((node, index) => node.mesh === meshIndex ? [index] : []);
  if (!nodes.length) throw new Error('Source Face mesh has no scene node');
  let vertices = 0, maxDisplacement = 0, transformedTargets = 0;
  for (const primitive of face.primitives) {
    const part = partFor(b.j.materials[primitive.material]?.name || '');
    const positions = b.readAccessor(primitive.attributes.POSITION);
    const normals = b.readAccessor(primitive.attributes.NORMAL);
    const deformed = new Float32Array(positions.length), normalBase = new Float32Array(normals.length);
    for (let i = 0; i < positions.length; i += 3) {
      const p = [positions[i], positions[i + 1], positions[i + 2]], next = faceShapeV3(...p, part);
      deformed.set(next, i);
      normalBase.set(transformedNormal(p, [normals[i], normals[i + 1], normals[i + 2]], part), i);
      maxDisplacement = Math.max(maxDisplacement, Math.hypot(...next.map((value, k) => value - p[k])));
    }
    for (const target of primitive.targets || []) {
      const delta = target.POSITION === undefined ? new Float32Array(positions.length) : b.readAccessor(target.POSITION);
      const deltaNormal = target.NORMAL === undefined ? null : b.readAccessor(target.NORMAL);
      const out = new Float32Array(delta.length), outNormal = deltaNormal ? new Float32Array(deltaNormal.length) : null;
      for (let i = 0; i < positions.length; i += 3) {
        const moved = delta[i] !== 0 || delta[i + 1] !== 0 || delta[i + 2] !== 0;
        const renormalize = deltaNormal && (deltaNormal[i] !== 0 || deltaNormal[i + 1] !== 0 || deltaNormal[i + 2] !== 0);
        if (!moved && !renormalize) continue;
        const endpoint = [positions[i] + delta[i], positions[i + 1] + delta[i + 1], positions[i + 2] + delta[i + 2]];
        const result = faceShapeV3(...endpoint, part);
        for (let k = 0; k < 3; k++) out[i + k] = result[k] - deformed[i + k];
        if (outNormal) {
          const n = transformedNormal(endpoint,
            [normals[i] + deltaNormal[i], normals[i + 1] + deltaNormal[i + 1], normals[i + 2] + deltaNormal[i + 2]], part);
          for (let k = 0; k < 3; k++) outNormal[i + k] = n[k] - normalBase[i + k];
        }
      }
      if (target.POSITION !== undefined) target.POSITION = b.accessor(out, 3, {bounds: true, target: 34962});
      if (outNormal) target.NORMAL = b.accessor(outNormal, 3, {target: 34962});
      transformedTargets++;
    }
    primitive.attributes.POSITION = b.accessor(deformed, 3, {bounds: true, target: 34962});
    primitive.attributes.NORMAL = b.accessor(normalBase, 3, {target: 34962});
    vertices += positions.length / 3;
  }

  const material = name => b.j.materials.find(value => value.name === name);
  const skin = material('Face_00_SKIN'), iris = material('EyeIris_00_EYE');
  if (faceTexture && skin) {
    const texture = b.texture(faceTexture);
    skin.pbrMetallicRoughness.baseColorTexture = {index: texture};
    const toon = skin.extensions?.VRMC_materials_mtoon;
    if (toon) Object.assign(toon, {shadeMultiplyTexture: {index: texture}, shadeColorFactor: [0.91, 0.80, 0.84], outlineWidthFactor: 0.00032});
  }
  if (irisTexture && iris) {
    iris.pbrMetallicRoughness.baseColorFactor = [1, 1, 1, 1];
    iris.pbrMetallicRoughness.baseColorTexture = {index: b.texture(irisTexture)};
    if (iris.extensions) delete iris.extensions.VRMC_materials_mtoon;
  }
  const brow = material('FaceBrow_00_FACE');
  if (brow) brow.pbrMetallicRoughness.baseColorFactor = [0.43, 0.32, 0.47, 1];
  const eyeline = material('FaceEyeline_00_FACE');
  if (eyeline) {
    eyeline.pbrMetallicRoughness.baseColorFactor = [0.27, 0.17, 0.30, 1];
    if (eyeline.extensions?.VRMC_materials_mtoon) eyeline.extensions.VRMC_materials_mtoon.outlineWidthFactor = 0.00012;
  }
  const expressions = b.j.extensions.VRMC_vrm.expressions;
  expressions.custom ??= {};
  expressions.custom[PORTRAIT_SMILE.expression] = {
    isBinary: false, overrideBlink: 'none', overrideMouth: 'none', overrideLookAt: 'none',
    morphTargetBinds: nodes.flatMap(node => Object.entries(PORTRAIT_SMILE.targets)
      .map(([name, weight]) => ({node, index: targetIndices[name], weight}))),
  };
  return {version: 3, vertices, primitives: face.primitives.length, transformedTargets,
    sourceTargetCount: names.length, maxDisplacement, expression: PORTRAIT_SMILE.expression,
    recommendedWeight: PORTRAIT_SMILE.recommendedWeight, speakingWeight: PORTRAIT_SMILE.speakingWeight, targetIndices};
}
