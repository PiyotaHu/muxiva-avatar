import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {applyHeadSurface, headSurfaceDepth} from '../web/illustration-surface.mjs';

const rig = {
  head: {center: [.5, .105], radius: [.18, .104], pivot: [.501, .163]},
  face: {center: [.499, .112], radius: [.088, .055]},
  neck: {center: [.5, .168], radius: [.06, .017]},
  eyes: [{center: [.456, .095]}, {center: [.527, .085]}],
  mouth: {center: [.503, .120]},
};
const aspect = 1024 / 1536;
const rect = [.344, .001, .314, .207];
const options = {rig, aspect, rect};
const createGeometry = () => new THREE.PlaneGeometry(rect[2] * aspect, rect[3], 48, 48);
const nose = [.4984, .108];
const signedArea = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

test('the face and nose form finite shallow relief, with fixed face edge and neck', () => {
  const limit = .5 * Math.min(rig.face.radius[0] * aspect, rig.face.radius[1]);
  let largest = 0;
  for (let y = 0; y <= 80; y++) for (let x = 0; x <= 80; x++) {
    const uv = [rect[0] + rect[2] * x / 80, rect[1] + rect[3] * y / 80];
    const depth = headSurfaceDepth(uv, options);
    assert.ok(Number.isFinite(depth) && depth >= 0 && depth <= limit);
    if (uv[1] >= rig.head.pivot[1]) assert.equal(depth, 0, 'the neck remains pinned');
    largest = Math.max(largest, depth);
  }
  assert.ok(largest > limit * .8, 'the surface must have a meaningful, bounded interior');
  assert.ok(headSurfaceDepth([rig.face.center[0] + rig.face.radius[0], rig.face.center[1]], options) < 1e-12);
  assert.equal(headSurfaceDepth([.413, .061], options), 0, 'the left hair root is outside the face relief');
  assert.equal(headSurfaceDepth([.584, .061], options), 0, 'the right hair root is outside the face relief');
  assert.equal(headSurfaceDepth(rig.head.pivot, options), 0);
});

test('surface construction preserves every x/y, UV and triangle index at neutral pose', () => {
  const geometry = createGeometry();
  try {
    const original = geometry.attributes.position.array.slice();
    const originalUv = geometry.attributes.uv.array.slice();
    const originalIndex = geometry.index.array.slice();
    const config = JSON.stringify(options);
    const version = geometry.attributes.position.version;
    assert.equal(applyHeadSurface(geometry, options), geometry);
    const position = geometry.attributes.position;
    for (let index = 0; index < position.count; index++) {
      assert.equal(position.getX(index), original[index * 3]);
      assert.equal(position.getY(index), original[index * 3 + 1]);
      const uv = geometry.attributes.uv;
      const source = [rect[0] + uv.getX(index) * rect[2], rect[1] + (1 - uv.getY(index)) * rect[3]];
      assert.ok(Math.abs(position.getZ(index) - headSurfaceDepth(source, options)) < 1e-8);
    }
    assert.deepEqual(geometry.attributes.uv.array, originalUv);
    assert.deepEqual(geometry.index.array, originalIndex);
    assert.equal(JSON.stringify(options), config, 'rig/config must not be mutated');
    assert.ok(position.version > version, 'the renderer receives an attribute update');
    assert.ok(Number.isFinite(geometry.boundingSphere.radius));
    assert.ok(geometry.boundingBox.max.z > 0);
  } finally { geometry.dispose(); }
});

test('depth strength is linear, idempotent and can return the surface to flat', () => {
  const full = headSurfaceDepth(nose, options);
  assert.ok(full > 0);
  assert.equal(headSurfaceDepth(nose, {...options, strength: 0}), 0);
  assert.ok(Math.abs(headSurfaceDepth(nose, {...options, strength: .35}) - full * .35) < 1e-12);
  const geometry = createGeometry();
  try {
    applyHeadSurface(geometry, options);
    const once = geometry.attributes.position.array.slice();
    applyHeadSurface(geometry, options);
    assert.deepEqual(geometry.attributes.position.array, once);
    applyHeadSurface(geometry, {...options, strength: 0});
    for (let index = 0; index < geometry.attributes.position.count; index++) {
      assert.equal(geometry.attributes.position.getZ(index), 0);
      assert.equal(geometry.attributes.position.getX(index), once[index * 3]);
      assert.equal(geometry.attributes.position.getY(index), once[index * 3 + 1]);
    }
  } finally { geometry.dispose(); }
});

test('all triangles retain their projected winding throughout the supported pose range', () => {
  const geometry = createGeometry();
  try {
    applyHeadSurface(geometry, options);
    const position = geometry.attributes.position;
    const original = Array.from({length: position.count}, (_, index) => new THREE.Vector3().fromBufferAttribute(position, index));
    const indices = geometry.index.array;
    for (const yaw of [-12, -6, 0, 6, 12]) for (const pitch of [-8, -4, 0, 4, 8]) {
      const rotation = new THREE.Euler(pitch * Math.PI / 180, yaw * Math.PI / 180, 0, 'XYZ');
      const posed = original.map(point => point.clone().applyEuler(rotation));
      for (let index = 0; index < indices.length; index += 3) {
        const [a, b, c] = indices.subarray(index, index + 3);
        const restArea = signedArea(original[a], original[b], original[c]);
        const poseArea = signedArea(posed[a], posed[b], posed[c]);
        assert.ok(restArea > 0);
        assert.ok(poseArea > restArea * .25,
          `triangle ${index / 3} collapses or reverses at yaw ${yaw}, pitch ${pitch}`);
      }
    }
  } finally { geometry.dispose(); }
});

test('turning produces relative nose/cheek parallax instead of a uniformly rotated card', () => {
  const cheek = [rig.face.center[0] + rig.face.radius[0] * .85, rig.face.center[1]];
  const displacement = (uv, yaw) => {
    const flat = new THREE.Vector3(uv[0] * aspect, -uv[1], 0);
    const relief = flat.clone();
    relief.z = headSurfaceDepth(uv, options);
    const rotation = new THREE.Euler(0, yaw * Math.PI / 180, 0);
    return relief.applyEuler(rotation).x - flat.applyEuler(rotation).x;
  };
  assert.ok(displacement(nose, 12) > displacement(cheek, 12) * 4);
  assert.ok(displacement(nose, 12) > .003);
  assert.ok(Math.abs(displacement(nose, 12) + displacement(nose, -12)) < 1e-12);
  assert.equal(displacement(nose, 0), 0, 'neutral orthographic projection retains the authored face');
});

test('invalid inputs are rejected and geometry remains unchanged when a source UV is invalid', () => {
  for (const strength of [NaN, Infinity, -1, 1.01])
    assert.throws(() => headSurfaceDepth(nose, {...options, strength}), /strength/);
  for (const value of [NaN, Infinity, 0, -1])
    assert.throws(() => headSurfaceDepth(nose, {...options, aspect: value}), /aspect/);
  for (const uv of [[NaN, .1], [.5, Infinity], [], new Array(2)])
    assert.throws(() => headSurfaceDepth(uv, options), /uvTopLeft/);
  const geometry = createGeometry();
  try {
    const before = geometry.attributes.position.array.slice();
    geometry.attributes.uv.setX(geometry.attributes.uv.count - 1, NaN);
    assert.throws(() => applyHeadSurface(geometry, options), /uv.x/);
    assert.deepEqual(geometry.attributes.position.array, before);
    assert.throws(() => applyHeadSurface(geometry, {...options, rect: [0, 0, 0, 1]}), /rect/);
    assert.throws(() => applyHeadSurface({attributes: {}}, options), /geometry/);
  } finally { geometry.dispose(); }
});
