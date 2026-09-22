import {Float32BufferAttribute} from 'three';

const smooth = (a,b,x) => {const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};

/** Two real skinned layers: warm skin beneath a translucent nylon film.
 * Standard glTF PBR/vertex alpha, no asset-name check or special shader at runtime.
 */
export function buildStockingsV4(b, body) {
  const skin = body.clone(), p=skin.attributes.position;
  // Gently fuller adult thighs, with continuity through the knee. The original
  // skeleton and source inverse binds are retained for both matching layers.
  for(let i=0;i<p.count;i++) {
    const x=p.getX(i),y=p.getY(i),z=p.getZ(i);
    const fuller=1+.05*smooth(.54,.77,y);
    const centre=x<0?-.077156:.077156;
    if(y<.88) p.setXYZ(i,centre+(x-centre)*fuller,y,-.01+(z+.01)*fuller);
  }
  const indices=[], index=skin.index.array;
  for(let i=0;i<index.length;i+=3) {
    const ids=[index[i],index[i+1],index[i+2]];
    if(ids.every(k=>p.getY(k)<.875))indices.push(...ids);
  }
  skin.setIndex(indices); skin.computeVertexNormals();
  const skinMaterial=b.material('stockings.warmSkinUnderlay',{color:[.88,.66,.59],shade:[.60,.38,.34],outline:0});
  b.mesh('Leg skin beneath sheer nylon',skin,skinMaterial);
  const film=skin.clone(), fp=film.attributes.position, normals=film.attributes.normal;
  const colors=new Float32Array(fp.count*4);
  for(let i=0;i<fp.count;i++) {
    const y=fp.getY(i), nz=normals.getZ(i);
    // Tiny geometric separation, same skin weights: this cannot z-fight or
    // become an opaque black replacement for the underlying skin.
    fp.setXYZ(i,fp.getX(i)+normals.getX(i)*.00065,y+normals.getY(i)*.00065,fp.getZ(i)+nz*.00065);
    const front=Math.max(0,nz), thigh=smooth(.48,.70,y);
    const knee=Math.exp(-(((y-.52)/.045)**2));
    const density=.98-.18*front*thigh-.08*front*knee;
    colors.set([1,1,1,density],i*4);
  }
  film.setAttribute('color',new Float32BufferAttribute(colors,4));
  const nylon=b.material('stockings.sheerBlackNylon',{color:[.013,.010,.012],outline:0});
  const material=b.j.materials[nylon];
  material.extensions={}; material.alphaMode='BLEND'; material.doubleSided=false;
  material.pbrMetallicRoughness.baseColorFactor=[.013,.010,.012,.84];
  material.pbrMetallicRoughness.roughnessFactor=.55;
  b.mesh('Sheer black nylon film',film,nylon);
  return {skinMaterial,nylonMaterial:nylon,upperY:.875,alpha:.84};
}
