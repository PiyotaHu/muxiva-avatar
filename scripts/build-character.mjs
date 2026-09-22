import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve, dirname} from 'node:path';
import {BoxGeometry, Vector3} from 'three';
import {VrmBuilder} from './avatar/vrm-builder.mjs';
import {buildHair} from './avatar/hair.mjs';
import {buildOutfit} from './avatar/outfit.mjs';
import {sculptFace} from './avatar/face.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(root, 'assets/avatar/sample.vrm');
// V1 is a retained review baseline, never overwrite it while iterating on V2.
if (!process.argv.includes('--v2')) throw Error('Pass --v2 to build the current design; v1 is retained as a review baseline.');
const output = resolve(root, 'assets/avatar/adult-twintail-v2.vrm');
const hash = path => createHash('sha256').update(fs.readFileSync(path)).digest('hex');
const expectedHash = '12c2b97e95e700783a6a550dc0eee2d7880aeedccef9ae67bc4c5a2f0f2631a2';
if (hash(source) !== expectedHash) throw Error('Source VRM differs from the reviewed licensed base; will not overwrite the custom asset.');
const b = new VrmBuilder(source);
const meta = b.j.extensions.VRMC_vrm.meta;
if (meta.modification !== 'allowModificationRedistribution' || !meta.allowRedistribution) throw Error('Base model must permit modification and redistribution');

// Leave source indices and authored facial expression bindings intact. The old
// clothing/hair meshes are no longer referenced by their scene nodes.
delete b.j.nodes[0].mesh; delete b.j.nodes[0].skin;
delete b.j.nodes[2].mesh; delete b.j.nodes[2].skin;
b.j.extensions.VRMC_springBone.springs = [];
const spring = b.j.extensions.VRMC_springBone;
spring.colliders ??= []; spring.colliderGroups ??= [];
function collider(bone, a, end, radius) {
  const node = b.bones.get(bone), inverse = b.world(node).invert();
  const offset = new Vector3(...a).applyMatrix4(inverse).toArray();
  const shape = end ? {capsule: {offset, tail: new Vector3(...end).applyMatrix4(inverse).toArray(), radius}} : {sphere: {offset, radius}};
  return spring.colliders.push({node, shape}) - 1;
}
const colliderIds = [collider('head', [0, 1.488, -.036], null, .094),
  collider('upperChest', [0, 1.07, -.025], [0, 1.245, -.025], .09),
  collider('leftUpperArm', [.115, 1.272, -.025], [.265, 1.272, -.025], .040),
  collider('rightUpperArm', [-.115, 1.272, -.025], [-.265, 1.272, -.025], .040)];
b.characterColliderGroups = [spring.colliderGroups.push({name: 'Character body', colliders: colliderIds}) - 1];

// Preserve original skinning for hands, neck, legs and every facial morph.
// The opaque garment interior is omitted, so animation cannot reveal an old
// T-shirt, shorts, or body surfaces poking through the new sleeves.
const body = b.readPrimitive(0, 0), positions = body.attributes.position;
const visible = [], stockings = [];
const index = body.index?.array || Array.from({length: positions.count}, (_, i) => i);
for (let i = 0; i < index.length; i += 3) {
  const tri = [index[i], index[i + 1], index[i + 2]];
  const y = tri.reduce((s, k) => s + positions.getY(k), 0) / 3;
  const x = tri.reduce((s, k) => s + Math.abs(positions.getX(k)), 0) / 3;
  if (y < .79) stockings.push(...tri);
  else if ((y > 1.315 && x < .115) || (y > 1.286 && x < .047) || x > .529) visible.push(...tri);
}
const skinGeometry = body.clone(); skinGeometry.setIndex(visible); b.mesh('Skin / hands and neckline', skinGeometry, 0);
const stockingMaterial = b.material('Black nylon stockings', {color: [.035, .028, .032], outline: .0002});
// Cloth sheen uses standard glTF PBR, with no renderer-specific shader.
b.j.materials[stockingMaterial].extensions = {};
b.j.materials[stockingMaterial].pbrMetallicRoughness.roughnessFactor = .43;
const stockingGeometry = body.clone(); stockingGeometry.setIndex(stockings); b.mesh('Black stockings', stockingGeometry, stockingMaterial);
const shoes = b.readPrimitive(0, 2);
const shoeMaterial = b.material('Black leather shoes', {color: [.037, .029, .042], shade: [.018, .013, .022], outline: .0004});
b.mesh('Shoes', shoes, shoeMaterial);
const gold = b.material('Antique gold shoe hardware', {color: [.51, .32, .125], shade: [.23, .12, .043], outline: .0002});
for (const side of [-1, 1]) {
  const bar = new BoxGeometry(.047, .008, .008).translate(side * .077, .072, .068);
  b.mesh('Loafer hardware ' + side, bar, gold, () => ({[side > 0 ? 'leftFoot' : 'rightFoot']: 1}));
}

sculptFace(b, {
  faceTexture: resolve(root, 'assets/avatar/textures/face-v2.png'),
  irisTexture: resolve(root, 'assets/avatar/textures/iris-v2.png'),
});
buildOutfit(b);
buildHair(b);
b.mergeMeshes();
b.finish();
// A small common head-scale adjustment gives a less childlike silhouette.
// Inverse bind matrices retain the original bind pose, affecting face, bangs
// and both hair chains together; all mouth/blink morphs remain available.
const head = b.j.nodes[b.bones.get('head')];
head.scale = (head.scale || [1, 1, 1]).map(v => v * .94);
meta.name = '银紫 · 双马尾'; meta.version = '2.0.0';
meta.authors = [...new Set([...meta.authors, 'Muxiva Avatar character adaptation'])];
meta.copyrightInformation += '\nCustom clothing, hair and material adaptation for Muxiva Avatar; based on an approved adult-character concept.';
delete meta.thumbnailImage;
b.j.asset.generator = 'Muxiva Avatar reproducible character builder v2';
b.j.extras = {...b.j.extras, character: {concept: 'adult-twintail-v1.png', baseSha256: expectedHash, implementation: 'Procedural VRM adaptation; preserved licensed base rig and facial morphs'}};
b.write(output);
fs.writeFileSync(resolve(root, 'assets/avatar/adult-twintail-v2.source.json'), JSON.stringify({
  schemaVersion: 1, asset: 'adult-twintail-v2.vrm', sha256: hash(output),
  source: {asset: 'sample.vrm', sha256: expectedHash, url: 'https://raw.githubusercontent.com/pixiv/three-vrm/v3.5.3/packages/three-vrm/examples/models/VRM1_Constraint_Twist_Sample.vrm', authors: ['pixiv Inc.'], copyright: '(c) 2022 pixiv Inc.', license: 'https://vrm.dev/licenses/1.0/'},
  permissions: {allowRedistribution: meta.allowRedistribution, modification: meta.modification, avatarPermission: meta.avatarPermission, commercialUsage: meta.commercialUsage, creditNotation: meta.creditNotation},
  adaptation: {concept: 'concepts/adult-twintail-v1.png', build: 'node scripts/build-character.mjs --v2', body: 'Licensed base rig retained; reshaped face and morph targets, generated UV textures, fitted outfit and new hair geometry', meshes: b.addedMeshes, springs: b.springNames},
}, null, 2) + '\n');
console.log(JSON.stringify({asset: output, bytes: fs.statSync(output).size, sha256: hash(output), meshes: b.addedMeshes.length, triangles: b.addedMeshes.reduce((s, m) => s + m.triangles, 0), springs: b.springNames}, null, 2));
