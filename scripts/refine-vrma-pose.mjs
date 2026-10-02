import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {Object3D,Quaternion,Euler} from 'three';
import {VRMHumanBoneParentMap} from '@pixiv/three-vrm';

/** Offline VRMA authoring: normalized VRM1 rotations -> source local tracks.
 * Unselected tracks remain byte-identical. Never used by the render loop.
 */
export function refineVrmaPose(source,profile){
  if(profile.coordinateSpace!=='vrm1-normalized')throw Error('Expected vrm1-normalized profile');
  if(source.readUInt32LE(0)!==0x46546c67||source.readUInt32LE(4)!==2)throw Error('Expected GLB 2');
  const jsonLength=source.readUInt32LE(12),json=JSON.parse(source.subarray(20,20+jsonLength));
  const binHeader=20+jsonLength;
  if(source.readUInt32LE(binHeader+4)!==0x004e4942)throw Error('Expected embedded BIN chunk');
  const bin=Buffer.from(source.subarray(binHeader+8,binHeader+8+source.readUInt32LE(binHeader)));
  const bones=json.extensions?.VRMC_vrm_animation?.humanoid?.humanBones;
  if(!bones||json.animations?.length!==1)throw Error('Expected one humanoid VRMA animation');
  const nodes=json.nodes.map(def=>{const node=new Object3D();if(def.translation)node.position.fromArray(def.translation);if(def.rotation)node.quaternion.fromArray(def.rotation);if(def.scale)node.scale.fromArray(def.scale);if(def.matrix){node.matrix.fromArray(def.matrix);node.matrix.decompose(node.position,node.quaternion,node.scale);}return node;});
  json.nodes.forEach((def,index)=>def.children?.forEach(child=>nodes[index].add(nodes[child])));
  for(const node of nodes)if(!node.parent)node.updateMatrixWorld(true);
  const animation=json.animations[0],changed=[];
  for(const [name,edit] of Object.entries(profile.bones)){
    const index=bones[name]?.node;
    if(index===undefined)throw Error('Missing bone: '+name);
    const channel=animation.channels.find(c=>c.target.node===index&&c.target.path==='rotation');
    if(!channel)throw Error('Missing rotation: '+name);
    const sampler=animation.samplers[channel.sampler],accessor=json.accessors[sampler.output],view=json.bufferViews[accessor.bufferView];
    if(accessor.type!=='VEC4'||accessor.componentType!==5126||accessor.sparse||!['LINEAR','STEP'].includes(sampler.interpolation||'LINEAR'))throw Error('Unsupported rotation encoding');
    if(!['replace','offset'].includes(edit.mode)||!Array.isArray(edit.euler)||edit.euler.length!==3||!edit.euler.every(Number.isFinite))throw Error('Invalid bone edit');
    // Match VRMA normalization: use the closest mapped humanoid ancestor,
    // which may differ from the immediate glTF parent on rigs with helper nodes.
    let parentName=VRMHumanBoneParentMap[name];
    while(parentName&&bones[parentName]===undefined)parentName=VRMHumanBoneParentMap[parentName];
    const bone=nodes[index],parent=parentName?nodes[bones[parentName].node]:nodes[bones.hips.node].parent;
    const parentWorld=parent?.getWorldQuaternion(new Quaternion())||new Quaternion(),world=bone.getWorldQuaternion(new Quaternion());
    const inverseParent=parentWorld.clone().invert(),inverseWorld=world.clone().invert(),delta=new Quaternion().setFromEuler(new Euler(...edit.euler));
    const base=(view.byteOffset||0)+(accessor.byteOffset||0),stride=view.byteStride||16;
    accessor.min=[Infinity,Infinity,Infinity,Infinity];accessor.max=[-Infinity,-Infinity,-Infinity,-Infinity];
    for(let k=0;k<accessor.count;k++){
      const offset=base+k*stride,local=new Quaternion(...Array.from({length:4},(_,c)=>bin.readFloatLE(offset+c*4)));
      const normalized=edit.mode==='replace'?delta.clone():local.premultiply(parentWorld).multiply(inverseWorld).multiply(delta);
      const values=normalized.premultiply(inverseParent).multiply(world).normalize().toArray();
      values.forEach((value,c)=>{const rounded=Math.fround(value);bin.writeFloatLE(rounded,offset+c*4);accessor.min[c]=Math.min(accessor.min[c],rounded);accessor.max[c]=Math.max(accessor.max[c],rounded);});
    }
    changed.push(name);
  }
  json.asset.generator+='; muxiva-avatar offline pose refinement';
  const encoded=Buffer.from(JSON.stringify(json)),padded=Buffer.alloc(Math.ceil(encoded.length/4)*4,0x20);encoded.copy(padded);
  const header=Buffer.alloc(20);header.writeUInt32LE(0x46546c67,0);header.writeUInt32LE(2,4);header.writeUInt32LE(28+padded.length+bin.length,8);header.writeUInt32LE(padded.length,12);header.writeUInt32LE(0x4e4f534a,16);
  const binChunk=Buffer.alloc(8);binChunk.writeUInt32LE(bin.length,0);binChunk.writeUInt32LE(0x004e4942,4);
  return {bytes:Buffer.concat([header,padded,binChunk,bin]),changed};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const [input,profilePath,output]=process.argv.slice(2);
  if(!input||!profilePath||!output||input===output)throw Error('Usage: node scripts/refine-vrma-pose.mjs input.vrma profile.json NEW-output.vrma');
  const result=refineVrmaPose(readFileSync(input),JSON.parse(readFileSync(profilePath,'utf8')));
  writeFileSync(output,result.bytes);console.log(JSON.stringify({output,bytes:result.bytes.length,changed:result.changed}));
}
