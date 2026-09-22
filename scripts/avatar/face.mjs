import {Vector3, Matrix3} from 'three';
const smooth = (a,b,t) => {t=Math.max(0,Math.min(1,(t-a)/(b-a)));return t*t*(3-2*t);};
const gauss = x => Math.exp(-x*x);

/** Sculpt in bind space, applying the same deformation to every expression. */
export function faceShape(x,y,z) {
  const width = .84 + .08*smooth(1.40,1.51,y) - .065*gauss((y-1.375)/.032);
  const front = smooth(-.02,.045,z);
  const eye = gauss((Math.abs(x)-.043)/.032)*gauss((y-1.445)/.024)*front;
  const eyeLift = Math.max(0,(Math.abs(x)-.038))*.12*eye;
  const smile = .0028*smooth(.003,.024,Math.abs(x))*gauss((y-1.389)/.014)*gauss(x/.038)*front;
  return [x*width, y-(y-1.445)*.15*eye+eyeLift+smile,
    z+.0022*gauss(x/.018)*gauss((y-1.415)/.032)*front];
}
function normalAt(p,n) {
  const epsilon=.00001, origin=faceShape(...p), columns=[];
  for(let axis=0;axis<3;axis++) {const q=[...p];q[axis]+=epsilon;const f=faceShape(...q);columns.push(f.map((v,k)=>(v-origin[k])/epsilon));}
  const matrix=new Matrix3().set(columns[0][0],columns[1][0],columns[2][0],columns[0][1],columns[1][1],columns[2][1],columns[0][2],columns[1][2],columns[2][2]).invert().transpose();
  return new Vector3(...n).applyMatrix3(matrix).normalize().toArray();
}
export function sculptFace(b,{faceTexture,irisTexture}) {
  for(const primitive of b.j.meshes[1].primitives) {
    const positions=b.readAccessor(primitive.attributes.POSITION), normals=b.readAccessor(primitive.attributes.NORMAL);
    const deformed=new Float32Array(positions.length), deformedNormals=new Float32Array(normals.length);
    for(let i=0;i<positions.length;i+=3) {
      const p=Array.from(positions.slice(i,i+3)),n=Array.from(normals.slice(i,i+3));
      deformed.set(faceShape(...p),i);deformedNormals.set(normalAt(p,n),i);
    }
    for(const target of primitive.targets || []) {
      const delta=target.POSITION===undefined?new Float32Array(positions.length):b.readAccessor(target.POSITION);
      const dn=target.NORMAL===undefined?null:b.readAccessor(target.NORMAL);
      const result=new Float32Array(delta.length), normalResult=dn?new Float32Array(dn.length):null;
      for(let i=0;i<positions.length;i+=3) {
        const p=[positions[i]+delta[i],positions[i+1]+delta[i+1],positions[i+2]+delta[i+2]],f=faceShape(...p);
        for(let k=0;k<3;k++)result[i+k]=f[k]-deformed[i+k];
        if(dn){const n=normalAt(p,[normals[i]+dn[i],normals[i+1]+dn[i+1],normals[i+2]+dn[i+2]]);for(let k=0;k<3;k++)normalResult[i+k]=n[k]-deformedNormals[i+k];}
      }
      if(target.POSITION!==undefined)target.POSITION=b.accessor(result,3,{bounds:true,target:34962});
      if(dn)target.NORMAL=b.accessor(normalResult,3,{target:34962});
    }
    primitive.attributes.POSITION=b.accessor(deformed,3,{bounds:true,target:34962});
    primitive.attributes.NORMAL=b.accessor(deformedNormals,3,{target:34962});
  }
  const skin=b.j.materials[7];
  const faceMap=b.texture(faceTexture),irisMap=b.texture(irisTexture);
  skin.pbrMetallicRoughness.baseColorTexture={index:faceMap};
  skin.extensions.VRMC_materials_mtoon.shadeMultiplyTexture={index:faceMap};
  skin.extensions.VRMC_materials_mtoon.shadeColorFactor=[.91,.78,.83];
  skin.extensions.VRMC_materials_mtoon.outlineWidthFactor=.00035;
  const iris=b.j.materials[6];
  iris.pbrMetallicRoughness.baseColorFactor=[1,1,1,1];
  iris.pbrMetallicRoughness.baseColorTexture={index:irisMap};
  delete iris.extensions.VRMC_materials_mtoon;
  b.j.materials[10].pbrMetallicRoughness.baseColorFactor=[.56,.40,.68,1];
  const line=b.j.materials[9].extensions.VRMC_materials_mtoon;
  line.outlineWidthFactor=.00015;
}
