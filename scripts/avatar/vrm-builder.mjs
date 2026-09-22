import fs from 'node:fs';
import {BufferGeometry, BufferAttribute, Matrix4, Quaternion, Vector3} from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

const widths = {SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16};
const arrays = {5121: Uint8Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array};

/** Asset-build utility, not a runtime Node. Original glTF indices stay stable. */
export class VrmBuilder {
  constructor(path) {
    const file = fs.readFileSync(path);
    if (file.readUInt32LE(0) !== 0x46546c67 || file.readUInt32LE(4) !== 2) throw Error('Expected GLB 2');
    const jsonLength = file.readUInt32LE(12);
    this.j = JSON.parse(file.subarray(20, 20 + jsonLength));
    const binStart = 20 + jsonLength;
    this.sourceBin = file.subarray(binStart + 8, binStart + 8 + file.readUInt32LE(binStart));
    this.chunks = [this.sourceBin];
    this.byteLength = this.sourceBin.length;
    this.parents = new Map();
    this.j.nodes.forEach((n, i) => n.children?.forEach(child => this.parents.set(child, i)));
    this.bones = new Map(Object.entries(this.j.extensions.VRMC_vrm.humanoid.humanBones).map(([name, bone]) => [name, bone.node]));
    this.joints = [...this.j.skins[0].joints];
    this.skin = this.j.skins.length;
    this.j.skins.push({name: 'Custom character skin', joints: this.joints});
    this.addedMeshes = [];
    this.addedNodes = [];
    this.springNames = [];
  }

  world(node) {
    const n = this.j.nodes[node];
    const local = n.matrix ? new Matrix4().fromArray(n.matrix) : new Matrix4().compose(
      new Vector3(...(n.translation || [0, 0, 0])), new Quaternion(...(n.rotation || [0, 0, 0, 1])),
      new Vector3(...(n.scale || [1, 1, 1])));
    return this.parents.has(node) ? this.world(this.parents.get(node)).multiply(local) : local;
  }

  bonePosition(name) {
    if (!this.bones.has(name)) throw Error('Unknown bone: ' + name);
    return new Vector3().setFromMatrixPosition(this.world(this.bones.get(name)));
  }

  readAccessor(index) {
    const a = this.j.accessors[index], v = this.j.bufferViews[a.bufferView], Type = arrays[a.componentType];
    if (!Type) throw Error('Unsupported source accessor');
    const size = widths[a.type], packed = size * Type.BYTES_PER_ELEMENT;
    const output = new Type(a.count * size);
    if (v) {
      const stride = v.byteStride || packed;
      const start = (v.byteOffset || 0) + (a.byteOffset || 0);
      for (let i = 0; i < a.count; i++) {
        const bytes = this.sourceBin.subarray(start + i * stride, start + i * stride + packed);
        new Uint8Array(output.buffer, i * packed, packed).set(bytes);
      }
    }
    // Facial morphs are sparsely stored in the licensed source asset.
    if (a.sparse) {
      const {indices, values, count} = a.sparse;
      const IndexType = arrays[indices.componentType], indexView = this.j.bufferViews[indices.bufferView];
      const valueView = this.j.bufferViews[values.bufferView];
      const indexStart = (indexView.byteOffset || 0) + (indices.byteOffset || 0);
      const valueStart = (valueView.byteOffset || 0) + (values.byteOffset || 0);
      if (!IndexType || indices.componentType === 5126) throw Error('Invalid sparse index component');
      for (let i = 0; i < count; i++) {
        const bytes = this.sourceBin.subarray(indexStart + i * IndexType.BYTES_PER_ELEMENT, indexStart + (i+1) * IndexType.BYTES_PER_ELEMENT);
        const copy = new IndexType(1); new Uint8Array(copy.buffer).set(bytes);
        if (copy[0] >= a.count) throw Error('Sparse index out of range');
        new Uint8Array(output.buffer, copy[0] * packed, packed).set(this.sourceBin.subarray(valueStart + i * packed, valueStart + (i+1) * packed));
      }
    }
    return output;
  }

  readPrimitive(mesh, primitive) {
    const p = this.j.meshes[mesh].primitives[primitive], g = new BufferGeometry();
    for (const [attr, name] of Object.entries({POSITION: 'position', NORMAL: 'normal', TEXCOORD_0: 'uv', COLOR_0: 'color', JOINTS_0: 'skinIndex', WEIGHTS_0: 'skinWeight'})) {
      if (p.attributes[attr] === undefined) continue;
      const a = this.j.accessors[p.attributes[attr]];
      g.setAttribute(name, new BufferAttribute(this.readAccessor(p.attributes[attr]), widths[a.type], a.normalized || false));
    }
    if (p.indices !== undefined) g.setIndex(new BufferAttribute(this.readAccessor(p.indices), 1));
    return g;
  }

  accessor(array, size, {bounds = false, target} = {}) {
    const padding = (4 - this.byteLength % 4) % 4;
    if (padding) { this.chunks.push(Buffer.alloc(padding)); this.byteLength += padding; }
    const buffer = Buffer.from(array.buffer, array.byteOffset, array.byteLength);
    const view = {buffer: 0, byteOffset: this.byteLength, byteLength: buffer.length};
    if (target) view.target = target;
    const bufferView = this.j.bufferViews.push(view) - 1;
    this.chunks.push(buffer); this.byteLength += buffer.length;
    const componentType = array instanceof Float32Array ? 5126 : array instanceof Uint16Array ? 5123 : array instanceof Uint8Array ? 5121 : 5125;
    const a = {bufferView, componentType, count: array.length / size, type: Object.keys(widths).find(key => widths[key] === size)};
    if (bounds) {
      a.min = Array(size).fill(Infinity); a.max = Array(size).fill(-Infinity);
      for (let i = 0; i < array.length; i++) { const c = i % size; a.min[c] = Math.min(a.min[c], array[i]); a.max[c] = Math.max(a.max[c], array[i]); }
    }
    return this.j.accessors.push(a) - 1;
  }

  texture(path, {repeat = false} = {}) {
    const bytes = fs.readFileSync(path);
    if (!bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw Error('Expected PNG texture');
    const padding = (4 - this.byteLength % 4) % 4;
    if (padding) { this.chunks.push(Buffer.alloc(padding)); this.byteLength += padding; }
    const bufferView = this.j.bufferViews.push({buffer: 0, byteOffset: this.byteLength, byteLength: bytes.length}) - 1;
    this.chunks.push(bytes); this.byteLength += bytes.length;
    const source = this.j.images.push({bufferView, mimeType: 'image/png'}) - 1;
    this.j.samplers ??= [];
    const sampler = this.j.samplers.push({magFilter: 9729, minFilter: 9987, wrapS: repeat ? 10497 : 33071, wrapT: repeat ? 10497 : 33071}) - 1;
    return this.j.textures.push({sampler, source}) - 1;
  }

  material(name, {color = [1, 1, 1], shade = color.map(v => v * .7), outline = .00045, doubleSided = false} = {}) {
    return this.j.materials.push({name, doubleSided,
      pbrMetallicRoughness: {baseColorFactor: [...color, 1], metallicFactor: 0, roughnessFactor: .85},
      extensions: {KHR_materials_unlit: {}, VRMC_materials_mtoon: {specVersion: '1.0',
        shadeColorFactor: shade, shadingShiftFactor: -.08, shadingToonyFactor: .75,
        giEqualizationFactor: .9, outlineWidthMode: outline ? 'worldCoordinates' : 'none',
        outlineWidthFactor: outline, outlineColorFactor: [.08, .055, .10], outlineLightingMixFactor: .3,
        parametricRimColorFactor: [.02, .015, .035], parametricRimFresnelPowerFactor: 5, rimLightingMixFactor: 1}}}) - 1;
  }

  mesh(name, geometry, material, weightFn, {skin} = {}) {
    if (!geometry.attributes.normal) geometry.computeVertexNormals();
    const positions = geometry.attributes.position, count = positions.count;
    const attributes = {POSITION: this.accessor(new Float32Array(positions.array), 3, {bounds: true, target: 34962}),
      NORMAL: this.accessor(new Float32Array(geometry.attributes.normal.array), 3, {target: 34962})};
    if (geometry.attributes.uv) attributes.TEXCOORD_0 = this.accessor(new Float32Array(geometry.attributes.uv.array), 2, {target: 34962});
    if (geometry.attributes.color) attributes.COLOR_0 = this.accessor(new Float32Array(geometry.attributes.color.array), geometry.attributes.color.itemSize, {target: 34962});
    let joints, weights;
    if (weightFn) {
      joints = new Uint16Array(count * 4); weights = new Float32Array(count * 4);
      for (let i = 0; i < count; i++) {
        const entries = Object.entries(weightFn(positions.getX(i), positions.getY(i), positions.getZ(i)))
          .filter(([, w]) => Number.isFinite(w) && w > 0).sort((a, b) => b[1] - a[1]).slice(0, 4);
        const sum = entries.reduce((s, [, w]) => s + w, 0);
        if (!sum) throw Error(`No skin weights: ${name} vertex ${i}`);
        entries.forEach(([bone, w], k) => {
          if (!this.bones.has(bone)) throw Error('Unknown bone: ' + bone);
          const node = this.bones.get(bone);
          if (!this.joints.includes(node)) this.joints.push(node);
          joints[i * 4 + k] = this.joints.indexOf(node); weights[i * 4 + k] = w / sum;
        });
      }
    } else {
      if (!geometry.attributes.skinIndex || !geometry.attributes.skinWeight) throw Error('Unweighted mesh: ' + name);
      joints = new Uint16Array(geometry.attributes.skinIndex.array);
      weights = new Float32Array(geometry.attributes.skinWeight.array);
    }
    attributes.JOINTS_0 = this.accessor(joints, 4, {target: 34962});
    attributes.WEIGHTS_0 = this.accessor(weights, 4, {target: 34962});
    const primitive = {attributes, material, mode: 4};
    if (geometry.index) primitive.indices = this.accessor(new (count > 65535 ? Uint32Array : Uint16Array)(geometry.index.array), 1, {target: 34963});
    const mesh = this.j.meshes.push({name, primitives: [primitive]}) - 1;
    // A cloned source primitive keeps its authored inverse-bind matrices.
    // Newly generated world-space geometry uses our current-rest-pose skin.
    const node = this.j.nodes.push({name, mesh, skin: skin ?? (weightFn ? this.skin : 0)}) - 1;
    this.j.scenes[this.j.scene || 0].nodes.push(node);
    this.addedMeshes.push({name, vertices: count, triangles: (geometry.index?.count || count) / 3});
    this.addedNodes.push(node);
    return node;
  }

  mergeMeshes() {
    // Many authored pleat/tress parts share one material. Batch them offline;
    // their per-vertex skin weights still animate independently at runtime.
    this.sourceBin = Buffer.concat(this.chunks);
    const groups = new Map();
    for (const nodeIndex of this.addedNodes) {
      const node = this.j.nodes[nodeIndex], primitive = this.j.meshes[node.mesh].primitives[0];
      const key = `${node.skin}:${primitive.material}`;
      const group = groups.get(key) || {skin: node.skin, material: primitive.material, geometries: []};
      const geometry = this.readPrimitive(node.mesh, 0);
      if (!geometry.attributes.uv) geometry.setAttribute('uv', new BufferAttribute(new Float32Array(geometry.attributes.position.count * 2), 2));
      if (!geometry.index) geometry.setIndex(Array.from({length: geometry.attributes.position.count}, (_, i) => i));
      group.geometries.push(geometry); groups.set(key, group);
      delete node.mesh; delete node.skin;
    }
    this.authoredMeshes = this.addedMeshes;
    this.addedMeshes = []; this.addedNodes = [];
    for (const group of groups.values()) {
      const geometry = mergeGeometries(group.geometries, false);
      if (!geometry) throw Error('Cannot batch material ' + group.material);
      this.mesh('Character / ' + this.j.materials[group.material].name, geometry, group.material, undefined, {skin: group.skin});
      geometry.dispose(); group.geometries.forEach(g => g.dispose());
    }
  }

  spring(name, points, {parent = 'head', stiffness = 1, drag = .6, gravity = .03, radius = .015} = {}) {
    const names = [];
    let parentNode = this.bones.get(parent);
    if (parentNode === undefined || points.length < 2) throw Error('Invalid spring chain');
    points.forEach((point, i) => {
      const local = new Vector3(...point).applyMatrix4(this.world(parentNode).invert());
      const boneName = `${name}_${i}`;
      const node = this.j.nodes.push({name: boneName, translation: local.toArray()}) - 1;
      (this.j.nodes[parentNode].children ??= []).push(node);
      this.parents.set(node, parentNode); this.bones.set(boneName, node); this.joints.push(node);
      names.push(boneName); parentNode = node;
    });
    const springs = this.j.extensions.VRMC_springBone;
    springs.springs.push({name, joints: names.map((bone, i) => ({node: this.bones.get(bone),
      stiffness, dragForce: drag, gravityPower: gravity, gravityDir: [0, -1, 0], hitRadius: i === names.length - 1 ? 0 : radius})),
      colliderGroups: this.characterColliderGroups || []});
    this.springNames.push(name);
    return names;
  }

  finish() {
    const matrices = new Float32Array(this.joints.length * 16);
    this.joints.forEach((node, i) => this.world(node).invert().toArray(matrices, i * 16));
    this.j.skins[this.skin].inverseBindMatrices = this.accessor(matrices, 16);
  }

  write(path) {
    this.j.buffers[0].byteLength = this.byteLength;
    const json = Buffer.from(JSON.stringify(this.j));
    const jsonPadded = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 0x20)]);
    const bin = Buffer.concat([...this.chunks, Buffer.alloc((4 - this.byteLength % 4) % 4)]);
    const header = Buffer.alloc(20); header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4);
    header.writeUInt32LE(28 + jsonPadded.length + bin.length, 8); header.writeUInt32LE(jsonPadded.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
    const binHeader = Buffer.alloc(8); binHeader.writeUInt32LE(bin.length, 0); binHeader.writeUInt32LE(0x004e4942, 4);
    fs.writeFileSync(path, Buffer.concat([header, jsonPadded, binHeader, bin]));
  }
}
