import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync, existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {Mesh, MeshBasicMaterial, DoubleSide, Raycaster, Vector3, Matrix4, Quaternion, Euler} from 'three';
import {VrmBuilder} from '../scripts/avatar/vrm-builder.mjs';
import {buildOutfitV4,OUTFIT_V4_COVERAGE,SKIRT_V4_HEM} from '../scripts/avatar/outfit-v4.mjs';

const source=fileURLToPath(new URL('../assets/avatar/sample.vrm',import.meta.url));
if (!existsSync(source)) test.skip('retired outfit v4 fixture is not installed');
else {
const sourceHash=createHash('sha256').update(readFileSync(source)).digest('hex');
const b=new VrmBuilder(source),authored=[];
const originalNodes=structuredClone(b.j.nodes),originalMeshes=structuredClone(b.j.meshes);
const sourceSkin=structuredClone(b.j.skins[0]),sourceMeta=structuredClone(b.j.extensions.VRMC_vrm);
const originalMesh=b.mesh.bind(b);
b.mesh=(name,g,material,weightFn,options)=>{
  const p=g.attributes.position;g.computeBoundingBox();
  let maxInfluences=0;
  for(const attr of Object.values(g.attributes))assert.ok(attr.array.every(Number.isFinite),name+' has finite geometry');
  for(const index of g.index.array)assert.ok(Number.isInteger(index)&&index>=0&&index<p.count,name+' valid indices');
  for(let i=0;i<p.count;i++) {
    const weights=Object.entries(weightFn(p.getX(i),p.getY(i),p.getZ(i)));
    maxInfluences=Math.max(maxInfluences,weights.length);
    assert.ok(weights.length<=4,name+' does not lose influences on export');
    assert.ok(Math.abs(weights.reduce((sum,[,weight])=>sum+weight,0)-1)<1e-5,name+' normalized weights');
    for(const [bone,weight] of weights) {
      assert.ok(b.bones.has(bone)&&Number.isFinite(weight)&&weight>=0,name+' valid weight');
      if(name.includes('skirt.'))assert.equal(/Leg/.test(bone),false,'skirt is not split between legs');
    }
  }
  authored.push({name,material,bounds:g.boundingBox.clone(),positions:new Float32Array(p.array),
    geometry:g.clone(),weightFn,triangles:g.index.count/3,maxInfluences,color:g.attributes.color});
  return originalMesh(name,g,material,weightFn,options);
};
const result=buildOutfitV4(b);
b.mesh=originalMesh;
b.mergeMeshes();b.finish();
const find=name=>{
  const row=authored.find(row=>row.name==='outfitV4.'+name);
  assert.ok(row,'expected garment part '+name);return row;
};

test('v4 source handoff preserves the original rig, source geometry, face and leg width',()=>{
  assert.equal(sourceHash,'12c2b97e95e700783a6a550dc0eee2d7880aeedccef9ae67bc4c5a2f0f2631a2');
  assert.equal(createHash('sha256').update(readFileSync(source)).digest('hex'),sourceHash);
  assert.deepEqual(b.j.meshes.slice(0,originalMeshes.length),originalMeshes);
  assert.deepEqual(b.j.skins[0],sourceSkin);
  assert.deepEqual(b.j.extensions.VRMC_vrm,sourceMeta);
  originalNodes.forEach((node,index)=>{
    const current=b.j.nodes[index];
    for(const [key,value] of Object.entries(node))if(key!=='children')assert.deepEqual(current[key],value,key);
    if(node.children)assert.deepEqual(current.children.slice(0,node.children.length),node.children);
  });
  assert.equal(result.stockings.preserveSourceLegWidth,true);
  assert.equal(result.skinShell.sourceNeckKeepAboveY,1.350);
  assert.ok(result.skinShell.topY-result.skinShell.sourceNeckKeepAboveY>=.0049,'5mm source-neck overlap');
  assert.deepEqual(result.removeOriginalPrimitives,[1,3]);
  assert.equal(result.skirtHem,SKIRT_V4_HEM);
});

test('white folded-collar blouse fully covers a natural chest rather than a low sweetheart opening',()=>{
  const blouse=find('buttonedBlouse'),neck=find('neck');
  assert.ok(neck.bounds.min.y>=1.2689,'no exposed bust shell extending down the chest');
  assert.ok(Math.abs(neck.bounds.max.y-1.355)<1e-6);
  const centreYs=[];
  for(let i=0;i<blouse.positions.length;i+=3) {
    if(Math.abs(blouse.positions[i])<1e-7&&blouse.positions[i+2]>0)centreYs.push(blouse.positions[i+1]);
  }
  assert.ok(Math.abs(Math.max(...centreYs)-result.blouse.necklineCentreY)<1e-6);
  assert.ok(result.blouse.necklineCentreY>1.27);
  assert.ok(blouse.bounds.max.z>.090&&blouse.bounds.max.z<OUTFIT_V4_COVERAGE.blouse.chestMaximumFrontZ);
  assert.ok(Math.max(Math.abs(blouse.bounds.min.x),Math.abs(blouse.bounds.max.x))<=result.blouse.chestHalfWidth);
  const material=new MeshBasicMaterial({side:DoubleSide}),mesh=new Mesh(blouse.geometry,material);
  mesh.updateMatrixWorld(true);
  const ray=new Raycaster(),hits=[];
  for(const y of [1.12,1.185,1.23,1.255])for(const x of [-.065,0,.065]) {
    ray.set(new Vector3(x,y,1),new Vector3(0,0,-1));hits.length=0;ray.intersectObject(mesh,false,hits);
    assert.ok(hits.length>0,'white cloth covers the front chest at '+x+','+y);
  }
  material.dispose();
  for(const sign of [-1,1]) {
    const collar=find('blouse.foldedCollar.'+sign);
    assert.ok(collar.bounds.min.y>1.25&&collar.bounds.max.y>1.31);
    assert.ok(collar.bounds.max.z-collar.bounds.min.z>.02,'collar is a folded solid, not a flat decal');
  }
  const bow=find('ribbon.knot');
  assert.ok(Math.abs((bow.bounds.min.x+bow.bounds.max.x)/2)<1e-6,'burgundy ribbon is centred beneath the collar');
  assert.ok((bow.bounds.min.y+bow.bounds.max.y)/2>1.26);
  assert.equal(authored.some(row=>/sweetheart|cleavage/i.test(row.name)),false);
});

test('reference A-line skirt expands gradually from a natural waist, without a high-hip dome',()=>{
  const skirt=find('skirt.aLinePleats'),positions=skirt.positions;
  const radii=[];
  for(let row=0;row<=16;row++) {
    const y=SKIRT_V4_HEM+(1.037-SKIRT_V4_HEM)*row/16;
    let radius=0,depth=0;
    for(let i=0;i<positions.length;i+=3)if(Math.abs(positions[i+1]-y)<.003) {
      radius=Math.max(radius,Math.abs(positions[i]));
      depth=Math.max(depth,Math.abs(positions[i+2]-.009));
    }
    const line=.103+(.200-.103)*Math.max(0,Math.min(1,(1.025-y)/(1.025-SKIRT_V4_HEM)));
    assert.ok(Math.abs(radius-line)<.007,'side silhouette follows the reference A-line at y='+y);
    assert.ok(depth<.111,'front/back volume stays slim');
    radii.push(radius);
  }
  for(let i=1;i<radii.length;i++)assert.ok(radii[i]<=radii[i-1]+.001,'no bulging hip ring');
  const ratio=result.waist.halfWidth/radii[0];
  assert.ok(ratio>.48&&ratio<.56,'waist is not the v3 tiny-waist/balloon-skirt proportion');
  assert.ok(skirt.bounds.min.y>=result.skirt.hemMinY-1e-6);
  assert.ok(Math.abs(skirt.bounds.max.x)<=result.skirt.halfWidth);
  const hemY=[];
  for(let i=0;i<positions.length;i+=3)if(positions[i+1]<SKIRT_V4_HEM+.004)hemY.push(positions[i+1]);
  assert.ok(Math.max(...hemY)-Math.min(...hemY)<.003,'front hem stays nearly level, not a scalloped bell');
  assert.ok((1.048-SKIRT_V4_HEM)/(radii[0]*2)>.72,'skirt has the reference length-to-width ratio');
});

test('tucked blouse and placket stay inside the waistband during hip and spine motion',()=>{
  const blouse=find('buttonedBlouse'),placket=find('blouse.placket'),waist=find('skirt.highWaistband');
  for(const part of [blouse,placket]) {
    assert.ok(part.bounds.min.y>=waist.bounds.min.y+.0099,'no white hem hanging below the waistband');
    assert.ok(part.bounds.min.y<=waist.bounds.max.y-.01,'at least 10mm of vertical overlap');
  }
  for(const y of [1.034,1.038,1.043,1.048])for(const x of [-.1,0,.1]) {
    assert.deepEqual(blouse.weightFn(x,y,0),waist.weightFn(x,y,0),'overlapping fabrics share the same skin weights');
    assert.deepEqual(placket.weightFn(x,y,0),waist.weightFn(x,y,0));
  }

  // Skin real garment vertices with the actual source hierarchy/inverse binds;
  // test both idle-sized offsets and bends well beyond the current idle range.
  const poses=[{},...Array.from({length:12},(_,i)=>{
    const phase=i*Math.PI/6;
    return {hips:[0,0,.017*Math.sin(phase)],spine:[.008*Math.cos(phase),0,.008*Math.sin(phase)],
      chest:[.014*Math.cos(phase),0,0],upperChest:[.006*Math.cos(phase),0,0]};
  }),{hips:[.03,.04,-.025],spine:[.08,-.08,.07],chest:[-.04,.05,0]},
    {hips:[-.03,-.04,.025],spine:[-.08,.08,-.07],chest:[.04,-.05,0]}];
  const restWorld=new Map([...b.bones].map(([name,node])=>[name,b.world(node)]));
  const material=new MeshBasicMaterial({side:DoubleSide}),ray=new Raycaster();
  let checked=0,minimumClearance=Infinity;
  for(const [poseIndex,pose] of poses.entries()) {
    const offsets=new Map(Object.entries(pose).map(([name,angles])=>[b.bones.get(name),angles]));
    const cache=new Map();
    const world=node=>{
      if(cache.has(node))return cache.get(node);
      const data=b.j.nodes[node],local=data.matrix?new Matrix4().fromArray(data.matrix):new Matrix4().compose(
        new Vector3(...(data.translation||[0,0,0])),new Quaternion(...(data.rotation||[0,0,0,1])),
        new Vector3(...(data.scale||[1,1,1])));
      if(offsets.has(node))local.multiply(new Matrix4().makeRotationFromQuaternion(
        new Quaternion().setFromEuler(new Euler(...offsets.get(node),'XYZ'))));
      const result=b.parents.has(node)?world(b.parents.get(node)).clone().multiply(local):local;
      cache.set(node,result);return result;
    };
    const transforms=new Map([...b.bones].map(([name,node])=>[
      name,world(node).clone().multiply(restWorld.get(name).clone().invert())]));
    const skin=(point,weights)=>{
      const result=new Vector3();
      for(const [bone,weight] of Object.entries(weights))result.addScaledVector(point.clone().applyMatrix4(transforms.get(bone)),weight);
      return result;
    };
    const geometry=waist.geometry.clone(),positions=geometry.attributes.position;
    for(let i=0;i<positions.count;i++) {
      const point=new Vector3().fromBufferAttribute(positions,i),posed=skin(point,waist.weightFn(...point.toArray()));
      positions.setXYZ(i,posed.x,posed.y,posed.z);
    }
    positions.needsUpdate=true;geometry.computeBoundingBox();geometry.computeBoundingSphere();
    const mesh=new Mesh(geometry,material);mesh.updateMatrixWorld(true);
    for(const part of [blouse,placket]) {
      const source=part.geometry.attributes.position;
      const bind=Array.from({length:source.count},(_,i)=>new Vector3().fromBufferAttribute(source,i));
      const posed=bind.map(point=>skin(point,part.weightFn(...point.toArray())));
      const samples=bind.map((point,i)=>[point,posed[i]]);
      // Triangle centres also catch an edge crossing which vertex-only tests miss.
      const indices=part.geometry.index;
      for(let i=0;i<indices.count;i+=3) {
        const ids=[indices.getX(i),indices.getX(i+1),indices.getX(i+2)];
        samples.push([ids.reduce((sum,k)=>sum.add(bind[k]),new Vector3()).divideScalar(3),
          ids.reduce((sum,k)=>sum.add(posed[k]),new Vector3()).divideScalar(3)]);
      }
      for(const [point,deformed] of samples) {
        if(point.y>waist.bounds.max.y-.001||point.y<result.blouse.bottomY-1e-6)continue;
        const centre=skin(new Vector3(0,point.y,.008),part.weightFn(...point.toArray()));
        // Avoid the duplicated 0/2pi vertex seam's floating-point edge exactly;
        // this sub-microradian bias cannot bridge a visible garment gap.
        ray.set(deformed,deformed.clone().sub(centre).normalize().add(new Vector3(1e-7,0,0)).normalize());
        const hit=ray.intersectObject(mesh,false)[0];
        assert.ok(hit,'waistband covers '+part.name+' point '+point.toArray()+' in pose '+poseIndex);
        minimumClearance=Math.min(minimumClearance,hit.distance);
        assert.ok(hit.distance>=.0014&&hit.distance<.010,'shirt stays inside with fabric clearance, pose '+poseIndex);
        checked++;
      }
    }
    geometry.dispose();
  }
  material.dispose();
  assert.ok(checked>5000,'all-around garment vertices and triangle centres checked in 15 poses');
  assert.ok(minimumClearance>=.0014,'clearance remains larger than both outline widths');
});

test('fine hem, complete opaque lining and two fitted waist buckles are present',()=>{
  const lining=find('skirt.fullLining'),yoke=find('skirt.closedYoke'),hem=find('skirt.fineHem');
  assert.ok(lining.bounds.min.y<SKIRT_V4_HEM+.012);
  assert.ok(lining.bounds.max.y>1.03);
  assert.ok(yoke.bounds.min.y>.95&&yoke.bounds.max.y<.960);
  assert.ok(yoke.bounds.max.x-yoke.bounds.min.x>.22,'closed yoke spans the full internal waist cavity');
  assert.equal(b.j.materials[lining.material].alphaMode||'OPAQUE','OPAQUE');
  assert.equal(b.j.materials[lining.material].doubleSided,true);
  assert.ok(hem.bounds.max.y-hem.bounds.min.y<.006,'hem is a thin folded edge');
  for(const index of [0,1]) {
    find('skirt.strap.'+index);find('skirt.buckle.'+index+'.tongue');
    for(const sign of [-1,1]) {
      find('skirt.buckle.'+index+'.horizontal.'+sign);
      find('skirt.buckle.'+index+'.vertical.'+sign);
    }
  }
  assert.equal(authored.filter(row=>/skirt\.buckle\.\d\.tongue/.test(row.name)).length,2);
});

test('v4 batches compatible materials and retains one gentle standard hip-parented spring',()=>{
  const spring=b.j.extensions.VRMC_springBone.springs.at(-1);
  assert.equal(spring.name,'outfitV4Skirt');
  assert.equal(spring.joints.length,3);
  assert.equal(b.parents.get(spring.joints[0].node),b.bones.get('hips'));
  for(let i=1;i<spring.joints.length;i++)assert.equal(b.parents.get(spring.joints[i].node),spring.joints[i-1].node);
  assert.deepEqual(spring.colliderGroups,[]);
  assert.equal(spring.joints.at(-1).hitRadius,0);
  assert.ok(spring.joints.every(joint=>joint.dragForce>=.8&&joint.gravityPower<=.025));
  assert.ok(authored.every(row=>row.maxInfluences<=4));
  assert.ok(authored.reduce((sum,row)=>sum+row.triangles,0)<45000,'practical mesh budget');
  assert.equal(b.addedMeshes.length,9,'material batching remains compact');
  const colored=b.addedNodes.map(id=>b.j.meshes[b.j.nodes[id].mesh].primitives[0])
    .filter(p=>p.attributes.COLOR_0!==undefined);
  assert.equal(colored.length,2);
  for(const p of colored)assert.equal(b.j.accessors[p.attributes.COLOR_0].type,'VEC3');
});
}
