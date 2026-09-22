import assert from 'node:assert/strict';
import test from 'node:test';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {VrmBuilder} from '../scripts/avatar/vrm-builder.mjs';
import {buildOutfitV3, OUTFIT_V3_COVERAGE, SKIRT_V3_HEM} from '../scripts/avatar/outfit-v3.mjs';

const source=fileURLToPath(new URL('../assets/avatar/sample.vrm',import.meta.url));
if (!existsSync(source)) test.skip('retired outfit v3 fixture is not installed');
else {
const b=new VrmBuilder(source), authored=[];
const originalMesh=b.mesh.bind(b);
b.mesh=(name,g,material,weightFn,options)=>{
  const p=g.attributes.position;
  g.computeBoundingBox();
  let maxInfluences=0;
  for(const attr of Object.values(g.attributes)) for(const value of attr.array)
    assert.ok(Number.isFinite(value),`${name} has non-finite vertex data`);
  for(const index of g.index.array) assert.ok(index>=0&&index<p.count,`${name} index range`);
  for(let i=0;i<p.count;i++) {
    const weights=Object.entries(weightFn(p.getX(i),p.getY(i),p.getZ(i)));
    maxInfluences=Math.max(maxInfluences,weights.length);
    assert.ok(weights.length<=4,`${name} would lose bone influences on export`);
    assert.ok(Math.abs(weights.reduce((sum,[,v])=>sum+v,0)-1)<1e-5,`${name} normalized weights`);
    for(const [bone,value] of weights) {
      assert.ok(b.bones.has(bone)&&Number.isFinite(value)&&value>=0,`${name} valid bone weight`);
      if(name.includes('skirt.')) assert.ok(!/Leg/.test(bone),`${name} must not split by leg`);
    }
  }
  authored.push({name,bounds:g.boundingBox.clone(),vertices:p.count,
    triangles:g.index.count/3,maxInfluences,color:g.attributes.color,
    positions:new Float32Array(p.array)});
  return originalMesh(name,g,material,weightFn,options);
};
const result=buildOutfitV3(b);
b.finish();
b.mesh=originalMesh;
b.mergeMeshes();
const find=name=>authored.find(row=>row.name==='outfitV3.'+name);

test('v3 geometry and source-neck handoff match exported coverage',()=>{
  assert.equal(result.skirtHem,SKIRT_V3_HEM);
  assert.equal(result.skinShell.sourceNeckKeepAboveY,OUTFIT_V3_COVERAGE.skinShell.sourceNeckKeepAboveY);
  const neck=find('neckAndUpperChest');
  assert.ok(Math.abs(neck.bounds.max.y-result.skinShell.topY)<1e-6);
  assert.ok(Math.abs(neck.bounds.min.y-result.skinShell.bottomY)<1e-6);
  assert.ok(result.skinShell.topY-result.skinShell.sourceNeckKeepAboveY>=.0049);
  const blouse=find('sweetheartBlouse');
  const centreYs=[];
  for(let i=0;i<blouse.positions.length;i+=3) {
    if(Math.abs(blouse.positions[i])<1e-7&&blouse.positions[i+2]>0)
      centreYs.push(blouse.positions[i+1]);
  }
  assert.ok(Math.abs(Math.max(...centreYs)-result.blouse.necklineCentreY)<1e-6);
  assert.ok(find('blouse.frontSeam').bounds.max.y<result.blouse.necklineCentreY);
});

test('short pleats stay bounded and have a complete inner lining',()=>{
  const skirt=find('skirt.softPleats'), lining=find('skirt.fullLining');
  assert.ok(skirt.bounds.min.y>=result.skirt.hemMinY-1e-6);
  assert.ok(Math.abs(skirt.bounds.max.x)<=result.skirt.halfWidth);
  assert.ok(Math.abs(skirt.bounds.min.x)<=result.skirt.halfWidth);
  assert.ok(lining.bounds.min.y<result.skirt.hemMaxY);
  assert.ok(lining.bounds.max.y>1.03);
  assert.ok(find('skirt.innerYoke').bounds.min.y>.93);
  assert.ok(result.stockings.recommendedTopY>result.skirt.hemMaxY+.02);
});

test('skin and fabric vertex colors survive actual GLB material batching',()=>{
  const colorBatches=b.addedNodes.map(id=>b.j.meshes[b.j.nodes[id].mesh].primitives[0])
    .filter(p=>p.attributes.COLOR_0!==undefined);
  assert.equal(colorBatches.length,2);
  for(const name of ['neckAndUpperChest','skirt.softPleats','skirt.turnedHem']) {
    const color=find(name).color;
    assert.ok(color,`${name} exports colors`);
    assert.ok(color.array.every(value=>value>=.65&&value<=1),`${name} subtle bounded color`);
  }
  assert.equal(b.j.materials[result.skinMaterial].alphaMode,'OPAQUE');
  assert.equal(b.addedMeshes.length,9);
});

test('upper-chest detail uses standard PBR colors and a real bounded central hollow',()=>{
  const material=b.j.materials[result.skinMaterial];
  assert.equal(material.extensions?.VRMC_materials_mtoon,undefined);
  assert.equal(material.extensions?.KHR_materials_unlit,undefined);
  assert.equal(material.pbrMetallicRoughness.metallicFactor,0);
  const skin=find('neckAndUpperChest'), p=skin.positions;
  const centre=[], sides=[];
  let maximumFront=-Infinity;
  for(let i=0;i<p.length;i+=3) {
    const x=p[i], y=p[i+1], z=p[i+2];
    maximumFront=Math.max(maximumFront,z);
    if(Math.abs(y-1.204)>.0015||z<0) continue;
    const point={z,green:skin.color.getY(i/3)};
    if(Math.abs(x)<.001) centre.push(point);
    if(Math.abs(Math.abs(x)-.0475)<.002) sides.push(point);
  }
  assert.ok(centre.length&&sides.length);
  assert.ok(Math.min(...sides.map(p=>p.z))-Math.max(...centre.map(p=>p.z))>.022);
  assert.ok(centre.every(p=>p.green>.70&&p.green<.80));
  assert.ok(sides.every(p=>p.green>.94));
  assert.ok(Math.abs(maximumFront-.14524)<.0002,'outer chest peak must not grow');
});

test('one coherent standard VRM spring chain is parented to hips',()=>{
  const spring=b.j.extensions.VRMC_springBone.springs.at(-1);
  assert.equal(spring.joints.length,3);
  assert.equal(b.parents.get(spring.joints[0].node),b.bones.get('hips'));
  for(let i=1;i<spring.joints.length;i++)
    assert.equal(b.parents.get(spring.joints[i].node),spring.joints[i-1].node);
  assert.deepEqual(spring.colliderGroups,[]);
  assert.equal(spring.joints.at(-1).hitRadius,0);
  assert.ok(authored.every(row=>row.maxInfluences<=4));
  assert.ok(authored.reduce((sum,row)=>sum+row.triangles,0)<60000);
});
}
