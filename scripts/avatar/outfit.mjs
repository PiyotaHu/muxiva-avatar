import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Bind-space metres fitted to sample.vrm. Bounds are not a global deletion
// box: the owning builder must retain the neck, hands, and legs below the hem.
export const OUTFIT_COVERAGE = Object.freeze({
  torso: { yMin: 1.0, yMax: 1.32, xMax: 0.152, zMin: -0.082, zMax: 0.151 },
  skirt: { yMin: 0.66, yMax: 1.027, xMax: 0.223, zMin: -0.153, zMax: 0.153 },
  sleeve: { startFromShoulder: -0.024, endBeforeHand: 0.012, maxRadius: 0.059 },
  neckline: { frontY: 1.288, backY: 1.318, centreZ: -0.031, radiusX: 0.043, radiusZ: 0.034 },
});

const clamp = THREE.MathUtils.clamp;
const lerp = THREE.MathUtils.lerp;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const TAU = Math.PI * 2;

function surface(rows, columns, point, { flip = false } = {}) {
  const positions = [], uvs = [], indices = [];
  for (let r = 0; r <= rows; r++) for (let c = 0; c <= columns; c++) {
    positions.push(...point(r / rows, c / columns));
    uvs.push(c / columns, r / rows);
  }
  for (let r = 0; r < rows; r++) for (let c = 0; c < columns; c++) {
    const a = r * (columns + 1) + c, d = a + columns + 1;
    if (flip) indices.push(a, d, a + 1, a + 1, d, d + 1);
    else indices.push(a, a + 1, d, a + 1, d + 1, d);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function polyhedron(points, thickness = 0.0015) {
  // Convex cloth panels have genuine edge thickness instead of camera cards.
  const area = points.reduce((sum, p, i) => { const q = points[(i + 1) % points.length]; return sum + p[0] * q[1] - q[0] * p[1]; }, 0);
  if (area < 0) points = [...points].reverse();
  const positions = [], indices = [], n = points.length;
  for (const p of points) positions.push(...p);
  for (const p of points) positions.push(p[0], p[1], p[2] - thickness);
  for (let i = 1; i < n - 1; i++) indices.push(0, i, i + 1, n, n + i + 1, n + i);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    indices.push(i, n + i, j, j, n + i, n + j);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function sphere(x, y, z, sx, sy, sz) {
  return new THREE.SphereGeometry(1, 12, 8).scale(sx, sy, sz).translate(x, y, z);
}

function blend(a, b, t) {
  const result = {};
  for (const [key, value] of Object.entries(a)) if (value * (1 - t) > 0.00001) result[key] = value * (1 - t);
  for (const [key, value] of Object.entries(b)) if (value * t > 0.00001) result[key] = (result[key] || 0) + value * t;
  return result;
}

// y, half-width, back, front before the clothed chest volume is added. The
// narrow waist is at 1.02m; the chest volume is at 1.185m, not at the stomach.
const BLOUSE = [
  [1.000, 0.100, -0.051, 0.078], [1.022, 0.095, -0.044, 0.072],
  [1.055, 0.098, -0.044, 0.070], [1.090, 0.105, -0.050, 0.070],
  [1.125, 0.118, -0.059, 0.071], [1.160, 0.135, -0.073, 0.074],
  [1.185, 0.143, -0.077, 0.075], [1.215, 0.145, -0.077, 0.066],
  [1.252, 0.144, -0.074, 0.048], [1.280, 0.127, -0.072, 0.034],
  [1.304, 0.078, -0.068, 0.018], [1.318, 0.043, -0.065, 0.003],
];

function profileAt(y) {
  for (let i = 1; i < BLOUSE.length; i++) if (y <= BLOUSE[i][0]) {
    const a = BLOUSE[i - 1], b = BLOUSE[i], previous = BLOUSE[Math.max(0, i - 2)], next = BLOUSE[Math.min(BLOUSE.length - 1, i + 1)];
    const dy = b[0] - a[0], t = clamp((y - a[0]) / dy, 0, 1);
    // Monotone cubic tangents avoid both ring-shaped slope breaks and profile
    // overshoot at the waist and shoulders.
    return a.map((value, k) => {
      if (k === 0) return lerp(a[0], b[0], t);
      const slope = (b[k] - value) / dy;
      if (Math.abs(slope) < 1e-9) return value;
      const m0 = clamp(((b[k] - previous[k]) / (b[0] - previous[0])) / slope, 0, 3) * slope;
      const m1 = clamp(((next[k] - value) / (next[0] - a[0])) / slope, 0, 3) * slope;
      return (2 * t ** 3 - 3 * t ** 2 + 1) * value + (t ** 3 - 2 * t ** 2 + t) * dy * m0
        + (-2 * t ** 3 + 3 * t ** 2) * b[k] + (t ** 3 - t ** 2) * dy * m1;
    });
  }
  return BLOUSE.at(-1);
}

function torsoPoint(y, theta, ease = 0) {
  const [, rx, back, front] = profileAt(y), c = Math.cos(theta), s = Math.sin(theta);
  const drop = smooth(1.282, 1.318, y) * 0.030 * Math.max(0, c);
  const clothX = rx * s, x = (rx + ease) * s;
  // Two broad, smoothly blended lobes shape the blouse, while a fabric bridge
  // keeps its centre closed. There is no skin opening or anatomical detailing.
  // A broad envelope rounds both the upper and lower chest; the peak stays
  // at chest height instead of gaining projection to fake more volume.
  const height = Math.exp(-(((y - 1.185) / 0.071) ** 2));
  const lobes = Math.exp(-(((clothX - 0.055) / 0.050) ** 2)) + Math.exp(-(((clothX + 0.055) / 0.050) ** 2));
  const bridge = 0.012 * Math.exp(-((clothX / 0.095) ** 4));
  const volume = (0.0635 * lobes + bridge) * height * smooth(0.05, 0.50, c);
  const fold = 0.00045 * Math.sin(theta * 10) * smooth(1.02, 1.055, y) * (1 - smooth(1.10, 1.15, y));
  return [x, y - drop, (front + back) / 2 + ((front - back) / 2 + ease + fold) * c + volume];
}

// Used by every front-mounted garment detail. This is the same 3D surface as
// the blouse, not a second flat front profile that would float or intersect it.
function frontClothPoint(x, y, lift = 0) {
  const [, rx] = profileAt(y), theta = Math.asin(clamp(x / rx, -0.99, 0.99));
  const point = torsoPoint(y, theta);
  point[2] += lift;
  return point;
}

/** Build actual skinned 3D garments. Requires material(), mesh(), bonePosition(). */
export function buildOutfit(b) {
  const mats = {
    ivory: b.material('outfit.blouse.ivory', { color: [0.89, 0.855, 0.785], shade: [0.60, 0.555, 0.495], outline: 0.00065, doubleSided: true }),
    collar: b.material('outfit.collar.ivory', { color: [0.93, 0.895, 0.825], shade: [0.64, 0.59, 0.53], outline: 0.00055, doubleSided: true }),
    charcoal: b.material('outfit.cardigan.charcoal', { color: [0.092, 0.085, 0.101], shade: [0.045, 0.038, 0.054], outline: 0.0014, doubleSided: true }),
    knit: b.material('outfit.knit.trim', { color: [0.072, 0.065, 0.081], shade: [0.035, 0.029, 0.044], outline: 0.0006, doubleSided: true }),
    skirt: b.material('outfit.skirt.charcoal', { color: [0.085, 0.073, 0.098], shade: [0.037, 0.027, 0.047], outline: 0.0013, doubleSided: true }),
    lining: b.material('outfit.skirt.lining', { color: [0.050, 0.041, 0.060], shade: [0.025, 0.020, 0.030], outline: 0.0004, doubleSided: true }),
    plum: b.material('outfit.ribbon.plum', { color: [0.235, 0.102, 0.17], shade: [0.125, 0.043, 0.084], outline: 0.0008, doubleSided: true }),
    gold: b.material('outfit.hardware.antiqueGold', { color: [0.50, 0.32, 0.15], shade: [0.265, 0.15, 0.062], outline: 0.0003 }),
  };
  const arms = {};
  for (const side of ['left', 'right']) arms[side] = {
    shoulder: b.bonePosition(`${side}UpperArm`).clone(),
    elbow: b.bonePosition(`${side}LowerArm`).clone(),
    wrist: b.bonePosition(`${side}Hand`).clone(),
  };
  const torsoWeights = (x, y) => {
    if (y <= 1.05) return blend({ hips: 0.3, spine: 0.7 }, { spine: 1 }, smooth(1.0, 1.05, y));
    if (y < 1.17) return blend({ spine: 1 }, { chest: 1 }, smooth(1.05, 1.17, y));
    return blend({ chest: 1 }, { upperChest: 1 }, smooth(1.17, 1.245, y));
  };
  const upperWeights = (x, y) => {
    const side = x >= 0 ? 'left' : 'right', arm = arms[side], ax = Math.abs(x);
    const shoulderX = Math.abs(arm.shoulder.x), elbowX = Math.abs(arm.elbow.x);
    const join = smooth(shoulderX - 0.045, shoulderX + 0.05, ax)
      * lerp(smooth(1.18, 1.247, y), 1, smooth(shoulderX + 0.03, shoulderX + 0.11, ax));
    const limb = blend({ [`${side}UpperArm`]: 1 }, { [`${side}LowerArm`]: 1 }, smooth(elbowX - 0.035, elbowX + 0.035, ax));
    return blend(torsoWeights(x, y), limb, join);
  };
  const skirtWeights = (_x, y) => ({ hips: 1 - 0.22 * smooth(0.975, 1.027, y), spine: 0.22 * smooth(0.975, 1.027, y) });
  const mesh = (name, geometry, material, weights = upperWeights) => b.mesh(`outfit.${name}`, geometry, material, weights);

  const opening = y => lerp(0.73, 0.82, smooth(1.07, 1.25, y));
  const blouse = surface(64, 96, (v, u) => torsoPoint(lerp(1, 1.318, v), u * TAU));
  // The sleeveless underlayer ends inside the covered armholes. Keeping its
  // complete shoulder dome made an ivory triangle protrude through the fitted
  // cardigan sleeve cap when viewed from the side.
  const positions = blouse.attributes.position, kept = [];
  for (let i = 0; i < blouse.index.count; i += 3) {
    const ids = [blouse.index.getX(i), blouse.index.getX(i + 1), blouse.index.getX(i + 2)];
    const x = ids.reduce((sum, id) => sum + positions.getX(id), 0) / 3;
    const y = ids.reduce((sum, id) => sum + positions.getY(id), 0) / 3;
    const z = ids.reduce((sum, id) => sum + positions.getZ(id), 0) / 3;
    const [, rx, back, front] = profileAt(y);
    const insideCoveredArmhole = y > 1.195 && y < 1.308 && Math.abs(x) > 0.082
      && (z < (front + back) / 2 || Math.abs(x) / rx > Math.sin(opening(y) + 0.04));
    if (!insideCoveredArmhole) kept.push(...ids);
  }
  blouse.setIndex(kept);
  mesh('blouse', blouse, mats.ivory);
  // A genuinely open cardigan front exposes the separate ivory blouse.
  mesh('cardigan.body', surface(56, 64, (v, u) => {
    const y = lerp(1.036, 1.316, v), gap = opening(y);
    return torsoPoint(y, lerp(gap, TAU - gap, u), 0.0045);
  }), mats.charcoal);
  mesh('cardigan.hem', surface(4, 64, (v, u) => {
    const y = lerp(1.034, 1.052, v), gap = opening(y);
    const point = torsoPoint(y, lerp(gap, TAU - gap, u), 0.0053);
    point[2] += 0.00035 * Math.cos(u * TAU * 64);
    return point;
  }), mats.knit);
  for (const side of [-1, 1]) {
    mesh(`cardigan.placket.${side}`, surface(30, 3, (v, u) => {
      const y = lerp(1.043, 1.314, v), theta = side * (opening(y) + (u - 0.12) * 0.055);
      return torsoPoint(y, theta, 0.0058);
    }), mats.knit);
  }

  // Anatomical shoulder/elbow/wrist positions, with the same weights as the
  // torso. This keeps the armpit overlap coherent when arms leave the T-pose.
  const sleeveBounds = {};
  for (const side of ['left', 'right']) {
    const arm = arms[side], sign = side === 'left' ? 1 : -1;
    const start = Math.abs(arm.shoulder.x) - 0.024, elbow = Math.abs(arm.elbow.x), end = Math.abs(arm.wrist.x) - 0.012;
    const centreAt = x => x < elbow
      ? arm.shoulder.clone().lerp(arm.elbow, clamp((x - Math.abs(arm.shoulder.x)) / (elbow - Math.abs(arm.shoulder.x)), 0, 1))
      : arm.elbow.clone().lerp(arm.wrist, clamp((x - elbow) / (Math.abs(arm.wrist.x) - elbow), 0, 1));
    const shape = [
      [start, 0.031, 0.041], [start + 0.040, 0.040, 0.045],
      [elbow - 0.065, 0.036, 0.037], [elbow, 0.033, 0.034],
      [elbow + 0.066, 0.037, 0.034], [end - 0.045, 0.028, 0.029],
      [end - 0.021, 0.023, 0.025], [end, 0.022, 0.025],
    ];
    const radiiAt = x => {
      for (let i = 1; i < shape.length; i++) if (x <= shape[i][0]) {
        const a = shape[i - 1], d = shape[i], t = clamp((x - a[0]) / (d[0] - a[0]), 0, 1);
        return [lerp(a[1], d[1], t), lerp(a[2], d[2], t)];
      }
      return shape.at(-1).slice(1);
    };
    const sleevePoint = (x, u, extra = 0) => {
      const centre = centreAt(x), theta = u * TAU, [ry, rz] = radiiAt(x);
      const fold = 0.0013 * Math.sin((x - start) * 97) * Math.sin(theta * 3) * smooth(start, elbow, x) * (1 - smooth(end - 0.045, end, x));
      const capEase = 0.012 * smooth(start, start + 0.028, x) * (1 - smooth(start + 0.055, start + 0.145, x))
        * Math.max(0, Math.sin(theta)) ** 2;
      return [sign * x, centre.y + (ry + extra + fold) * Math.cos(theta), centre.z + (rz + extra + fold) * Math.sin(theta) + capEase];
    };
    const winding = { flip: side === 'right' };
    mesh(`cardigan.sleeve.${side}`, surface(38, 32, (v, u) => sleevePoint(lerp(start, end, v), u), winding), mats.charcoal);
    mesh(`cardigan.cuff.${side}`, surface(5, 40, (v, u) => sleevePoint(lerp(end - 0.022, end + 0.001, v), u, 0.0013 + 0.00055 * Math.cos(u * TAU * 20)), winding), mats.knit);
    // Rounded open cuff lip, not a disk sealing off the wrist.
    mesh(`cardigan.cuffLip.${side}`, surface(3, 32, (v, u) => sleevePoint(end + 0.001 + Math.sin(v * Math.PI) * 0.001, u, 0.0015 - v * 0.0035), winding), mats.knit);
    sleeveBounds[side] = { xMin: sign > 0 ? start : -end, xMax: sign > 0 ? end : -start, yMin: arm.shoulder.y - 0.043, yMax: arm.shoulder.y + 0.043, zMin: arm.shoulder.z - 0.047, zMax: arm.shoulder.z + 0.059 };
  }

  // Small folded shirt collar with a modest neckline, not a sailor flap.
  for (const sign of [-1, 1]) mesh(`blouse.collar.${sign}`, polyhedron([
    [sign * 0.007, 1.289, 0.026], [sign * 0.029, 1.315, 0.007],
    frontClothPoint(sign * 0.063, 1.277, 0.004), frontClothPoint(sign * 0.027, 1.251, 0.004),
  ], 0.0022), mats.collar);
  mesh('blouse.placket', surface(48, 3, (v, u) => {
    const y = lerp(1.032, 1.252, v);
    return frontClothPoint((u - 0.5) * 0.008, y, 0.0011);
  }), mats.collar);
  for (const y of [1.063, 1.105, 1.147, 1.187, 1.224]) {
    const point = frontClothPoint(0, y, 0.0023);
    mesh(`blouse.button.${y}`, sphere(...point, 0.0015, 0.0015, 0.0007), mats.ivory);
  }

  // Filled, folded cloth wings: the old narrow annular strips read as wire
  // loops. These have a full fabric surface, soft volume, and no central hole.
  for (const sign of [-1, 1]) {
    mesh(`ribbon.loop.${sign}`, surface(18, 14, (v, u) => {
      const across = u * 2 - 1;
      const x = sign * (0.005 + 0.044 * v - 0.005 * across ** 2 * v ** 3);
      const y = 1.262 + 0.008 * Math.sin(v * Math.PI / 2) + across * (0.003 + 0.014 * Math.sin(v * Math.PI / 2));
      return frontClothPoint(x, y, 0.008 + 0.004 * Math.sin(v * Math.PI) * (1 - across ** 2));
    }), mats.plum);
    mesh(`ribbon.tail.${sign}`, surface(18, 8, (v, u) => {
      const across = u * 2 - 1, x = sign * (0.007 + 0.013 * v + across * lerp(0.004, 0.007, v));
      const notch = 0.006 * (1 - Math.abs(across)) * smooth(0.87, 1, v);
      return frontClothPoint(x, 1.261 - 0.053 * v + notch, 0.004 + 0.0015 * Math.sin(v * Math.PI) * across ** 2);
    }), mats.plum);
  }
  mesh('ribbon.knot', sphere(...frontClothPoint(0, 1.262, 0.009), 0.007, 0.008, 0.0045), mats.plum);

  const skirtProfile = [
    [0.660, 0.222, 0.151, 0.000], [0.675, 0.219, 0.149, 0.000],
    [0.740, 0.207, 0.139, 0.002], [0.815, 0.190, 0.125, 0.004],
    [0.895, 0.165, 0.111, 0.007], [0.945, 0.142, 0.097, 0.011],
    [0.985, 0.108, 0.072, 0.012], [1.018, 0.099, 0.066, 0.010],
  ];
  const skirtAt = y => {
    for (let i = 1; i < skirtProfile.length; i++) if (y <= skirtProfile[i][0]) {
      const a = skirtProfile[i - 1], d = skirtProfile[i], t = clamp((y - a[0]) / (d[0] - a[0]), 0, 1);
      return a.map((value, k) => lerp(value, d[k], t));
    }
    return skirtProfile.at(-1);
  };
  const pleats = 24, panels = [0, 0.40, 0.57, 0.76, 1], depths = [0, 0.001, -0.010, -0.009, 0];
  const pleatGeometries = [];
  // Split panel normals retain narrow pleat valleys. Every complete ring uses
  // one hip/spine rule, never an independent left/right leg assignment.
  for (let pleat = 0; pleat < pleats; pleat++) for (let panel = 0; panel < panels.length - 1; panel++) {
    pleatGeometries.push(surface(12, 1, (v, u) => {
      const y = lerp(0.66, 1.018, v), [, rx, rz, cz] = skirtAt(y);
      const angle = (pleat + lerp(panels[panel], panels[panel + 1], u)) / pleats * TAU;
      const fold = lerp(depths[panel], depths[panel + 1], u) * (1 - smooth(0.91, 1.008, y));
      return [(rx + fold) * Math.sin(angle), y, cz + (rz + fold) * Math.cos(angle)];
    }));
  }
  mesh('skirt.pleatedShell', mergeGeometries(pleatGeometries), mats.skirt, skirtWeights);
  pleatGeometries.forEach(geometry => geometry.dispose());
  mesh('skirt.innerLining', surface(14, 64, (v, u) => {
    const y = lerp(0.667, 1.01, v), [, rx, rz, cz] = skirtAt(y), angle = u * TAU;
    return [(rx - 0.012) * Math.sin(angle), y, cz + (rz - 0.012) * Math.cos(angle)];
  }), mats.lining, skirtWeights);
  mesh('skirt.waistband', surface(5, 72, (v, u) => {
    const y = lerp(0.991, 1.027, v), [, rx, rz, cz] = skirtAt(y), angle = u * TAU;
    return [(rx + 0.002) * Math.sin(angle), y, cz + (rz + 0.002) * Math.cos(angle)];
  }), mats.knit, skirtWeights);
  // Two restrained antique-gold rectangular waist buckles.
  for (const [index, y] of [1.009, 0.967].entries()) {
    const x = 0.071, [, rx, rz, cz] = skirtAt(y), z = cz + rz * Math.sqrt(1 - (x / rx) ** 2) + 0.004;
    mesh(`skirt.strap.${index}`, new THREE.BoxGeometry(0.037, 0.013, 0.002).translate(x - 0.006, y, z), mats.knit, skirtWeights);
    const width = 0.015, height = 0.017, bar = 0.0015;
    for (const sign of [-1, 1]) {
      mesh(`skirt.buckle.${index}.horizontal.${sign}`, new THREE.BoxGeometry(width, bar, 0.0022).translate(x, y + sign * height / 2, z + 0.002), mats.gold, skirtWeights);
      mesh(`skirt.buckle.${index}.vertical.${sign}`, new THREE.BoxGeometry(bar, height, 0.0022).translate(x + sign * width / 2, y, z + 0.002), mats.gold, skirtWeights);
    }
    mesh(`skirt.buckle.${index}.tongue`, new THREE.BoxGeometry(0.009, 0.0011, 0.0024).translate(x - 0.001, y, z + 0.003), mats.gold, skirtWeights);
  }
  return { ...OUTFIT_COVERAGE, sleeves: sleeveBounds, skirtHem: 0.66, removeOriginalPrimitives: [1, 3] };
}
