import fs from 'node:fs';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {VrmBuilder} from './vrm-builder.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const b = new VrmBuilder(resolve(root, 'assets/avatar/sample.vrm'));
const folder = resolve(root, '.artifacts/avatar-refs');
fs.mkdirSync(folder, {recursive: true});
for (const [name, material] of [['face', 7], ['iris', 6], ['eyeline', 9]]) {
  const texture = b.j.textures[b.j.materials[material].pbrMetallicRoughness.baseColorTexture.index];
  const image = b.j.images[texture.source], view = b.j.bufferViews[image.bufferView];
  const path = resolve(folder, name + '.png');
  fs.writeFileSync(path, b.sourceBin.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength));
  console.log(path);
}
