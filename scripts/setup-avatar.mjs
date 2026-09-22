/** Download the official, replaceable three-vrm test asset for this local app. */
import {createHash} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

const destination = new URL('../assets/avatar/', import.meta.url);
const source = 'https://raw.githubusercontent.com/pixiv/three-vrm/v3.5.3/packages/three-vrm/examples/models/VRM1_Constraint_Twist_Sample.vrm';
const modelPath = new URL('sample.vrm', destination);
const recordPath = new URL('sample.source.json', destination);

function readMetadata(buffer) {
  if (buffer.toString('ascii', 0, 4) !== 'glTF' || buffer.readUInt32LE(4) !== 2 || buffer.readUInt32LE(8) !== buffer.length) {
    throw new Error('Downloaded asset is not a complete GLB2 file');
  }
  for (let offset = 12; offset + 8 <= buffer.length;) {
    const length = buffer.readUInt32LE(offset);
    const type = buffer.readUInt32LE(offset + 4);
    offset += 8;
    if (offset + length > buffer.length) throw new Error('Invalid GLB chunk length');
    if (type === 0x4e4f534a) {
      const gltf = JSON.parse(buffer.toString('utf8', offset, offset + length).trim());
      const meta = gltf.extensions?.VRMC_vrm?.meta;
      if (!meta) throw new Error('Official sample has no VRM1 license metadata');
      return meta;
    }
    offset += length;
  }
  throw new Error('GLB JSON metadata missing');
}

let previous = null;
try { previous = JSON.parse(await readFile(recordPath, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const response = await fetch(source, {signal: AbortSignal.timeout(120000)});
if (!response.ok) throw new Error(`Official sample download failed: HTTP ${response.status}`);
const buffer = Buffer.from(await response.arrayBuffer());
if (buffer.length > 32 * 1024 * 1024) throw new Error('Official sample exceeds the 32 MiB asset limit');
const meta = readMetadata(buffer);
// The asset's embedded terms are separate from the renderer's MIT license.
// Restrict automatic setup to a sample that explicitly permits use and copies.
if (meta.avatarPermission !== 'everyone' || meta.allowRedistribution !== true || !meta.licenseUrl) {
  throw new Error(`Sample permission is not suitable for automatic setup: ${JSON.stringify(meta)}`);
}
const sha256 = createHash('sha256').update(buffer).digest('hex');
if (previous && previous.sha256 !== sha256) throw new Error('Official sample hash changed; inspect the source before replacing the existing asset');
const record = {
  file: 'sample.vrm', source, source_release: 'three-vrm v3.5.3', sha256,
  downloaded_at: new Date().toISOString(), bytes: buffer.length,
  temporary_sample: true,
  note: 'Technical sample only. It is not the requested final twin-tail academy-style character.',
  embedded_vrm_meta: meta,
};
await mkdir(destination, {recursive: true});
await writeFile(modelPath, buffer, {flag: previous ? 'w' : 'wx'});
await writeFile(recordPath, JSON.stringify(record, null, 2) + '\n');
console.log(JSON.stringify({path: fileURLToPath(modelPath), sha256, meta}, null, 2));
