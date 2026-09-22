import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

// Adult fashion asset, authored in sample.vrm's metre-based global T-pose.
// No renderer, conversation, or model-runtime dependencies.
export const SKIRT_V3_HEM = 0.775;
export const OUTFIT_V3_COVERAGE = Object.freeze({
  blouse: {bottomY: 1.014, necklineCentreY: 1.181, necklineSideY: 1.247},
  skinShell: {bottomY: 1.169, topY: 1.355, sourceNeckKeepAboveY: 1.350},
  waist: {y: 1.030, halfWidth: 0.080},
  hips: {y: 0.920, halfWidth: 0.170},
  skirt: {hemY: SKIRT_V3_HEM, hemMinY: SKIRT_V3_HEM - 0.009,
    hemMaxY: SKIRT_V3_HEM + 0.009, topY: 1.046, halfWidth: 0.211},
  stockings: {recommendedTopY: SKIRT_V3_HEM + 0.040},
  sleeve: {startFromShoulder: -0.024, endBeforeHand: 0.012},
  removeOriginalPrimitives: [1, 3],
});

const clamp = THREE.MathUtils.clamp, lerp = THREE.MathUtils.lerp, TAU = Math.PI * 2;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t*t*(3-2*t); };
const blend = (a, b, t) => {
  const w = {};
  for (const [k, v] of Object.entries(a)) if (v*(1-t) > 1e-7) w[k] = v*(1-t);
  for (const [k, v] of Object.entries(b)) if (v*t > 1e-7) w[k] = (w[k] || 0) + v*t;
  return w;
};

function grid(rows, columns, at, flip = false) {
  const p = [], uv = [], ids = [];
  for (let r=0; r<=rows; r++) for (let c=0; c<=columns; c++) {
    p.push(...at(r/rows, c/columns)); uv.push(c/columns, r/rows);
  }
  for (let r=0; r<rows; r++) for (let c=0; c<columns; c++) {
    const a=r*(columns+1)+c, d=a+columns+1;
    if (flip) ids.push(a,d,a+1,a+1,d,d+1);
    else ids.push(a,a+1,d,a+1,d+1,d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p,3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv,2));
  g.setIndex(ids); g.computeVertexNormals();
  return g;
}

function vertexColor(g, at) {
  const p=g.attributes.position, colors=new Float32Array(p.count*3);
  for (let i=0;i<p.count;i++) colors.set(at(p.getX(i),p.getY(i),p.getZ(i),i),i*3);
  g.setAttribute('color',new THREE.BufferAttribute(colors,3)); return g;
}

function profile(table, y) {
  if (y <= table[0][0]) return [...table[0]];
  for (let i=1; i<table.length; i++) if (y<=table[i][0]) {
    const a=table[i-1], b=table[i], prev=table[Math.max(0,i-2)], next=table[Math.min(table.length-1,i+1)];
    const dy=b[0]-a[0], t=clamp((y-a[0])/dy,0,1);
    return a.map((v,k) => {
      if (k===0) return y;
      const slope=(b[k]-v)/dy;
      if (Math.abs(slope)<1e-9) return v;
      const m0=clamp(((b[k]-prev[k])/(b[0]-prev[0]))/slope,0,3)*slope;
      const m1=clamp(((next[k]-v)/(next[0]-a[0]))/slope,0,3)*slope;
      return (2*t**3-3*t*t+1)*v+(t**3-2*t*t+t)*dy*m0+(-2*t**3+3*t*t)*b[k]+(t**3-t*t)*dy*m1;
    });
  }
  return [...table.at(-1)];
}

// Half-width/back/front before adding a broad clothed chest envelope.
const TORSO = [
  [1.014,.083,-.041,.058], [1.030,.080,-.040,.055],
  [1.070,.089,-.044,.061], [1.115,.110,-.055,.069],
  [1.155,.137,-.071,.074], [1.185,.148,-.079,.075],
  [1.215,.146,-.075,.066], [1.245,.139,-.068,.048],
  [1.278,.126,-.065,.030], [1.300,.091,-.061,.020],
  [1.320,.047,-.059,.006], [1.337,.0328,-.061,.014],
  [1.355,.033,-.063,.020],
];
const SKIRT = [
  [SKIRT_V3_HEM,.205,.131,.009], [.815,.197,.126,.010],
  [.865,.184,.120,.011], [.920,.170,.110,.012],
  [.952,.145,.093,.013], [.987,.103,.070,.013],
  [1.030,.082,.053,.009], [1.046,.084,.054,.009],
];

function bodyPoint(y, theta, ease=0) {
  const [,rx,back,front]=profile(TORSO,y), s=Math.sin(theta), c=Math.cos(theta), x=rx*s;
  const h=Math.exp(-(((y-1.185)/.073)**2));
  const lobes=Math.exp(-(((x-.055)/.052)**2))+Math.exp(-(((x+.055)/.052)**2));
  const bridge=.010*Math.exp(-((x/.095)**4));
  const volume=(.065*lobes+bridge)*h*smooth(.04,.50,c);
  // Retain both outer lobes and their peak envelope; recess only the narrow
  // sternum-facing transition so the upper chest is not one blended plane.
  const hollow=-.008*Math.exp(-((x/.021)**2))*Math.exp(-(((y-1.205)/.037)**2))
    *smooth(1.170,1.184,y)*(1-smooth(1.231,1.251,y))*smooth(.04,.50,c);
  // Subtle geometric collarbones; no painted cleavage or anatomical details.
  const clavicleY=1.285-.050*Math.abs(x);
  const clavicle=-.0023*Math.exp(-(((y-clavicleY)/.006)**2))
    * smooth(.010,.035,Math.abs(x))*(1-smooth(.075,.12,Math.abs(x)))*Math.max(0,c);
  return [(rx+ease)*s,y,(front+back)/2+((front-back)/2+ease)*c+volume+hollow+clavicle];
}
function frontPoint(x,y,lift=.004) {
  const [,rx]=profile(TORSO,y);
  const p=bodyPoint(y,Math.asin(clamp(x/rx,-.998,.998)));
  p[2]+=lift; return p;
}
function neckline(theta) {
  const s=Math.abs(Math.sin(theta)), c=Math.cos(theta);
  const front=1.247-.066*Math.exp(-((s/.33)**2))+.030*smooth(.65,1,s);
  return lerp(1.304,front,smooth(0,.60,c));
}
const opening = y => lerp(.94,1.01,smooth(1.05,1.22,y))-.28*smooth(1.255,1.305,y);

function trimCoveredArmholes(g) {
  const p=g.attributes.position, kept=[];
  for (let i=0;i<g.index.count;i+=3) {
    const ids=[g.index.getX(i),g.index.getX(i+1),g.index.getX(i+2)];
    const x=ids.reduce((s,id)=>s+p.getX(id),0)/3, y=ids.reduce((s,id)=>s+p.getY(id),0)/3;
    const z=ids.reduce((s,id)=>s+p.getZ(id),0)/3, [,rx,back,front]=profile(TORSO,y);
    const covered=y>1.218&&y<1.310&&Math.abs(x)>.082
      &&(z<(back+front)/2||Math.abs(x)/rx>Math.sin(opening(y)+.035));
    if (!covered) kept.push(...ids);
  }
  g.setIndex(kept); return g;
}

/** Build v3 without altering v2. Returns exact masking/material/spring metadata. */
export function buildOutfitV3(b) {
  const material=(name,color,shade,outline=.00055) => b.material('outfitV3.'+name,{color,shade,outline,doubleSided:true});
  const mats={
    skin:material('neckAndUpperChest',[.88,.66,.59],[.63,.40,.37],.0002),
    ivory:material('blouse.ivory',[.90,.867,.805],[.62,.57,.51],.0006),
    edge:material('blouse.boundEdge',[.93,.90,.84],[.68,.62,.56],.0004),
    charcoal:material('cardigan.charcoal',[.086,.073,.097],[.036,.027,.045],.0008),
    knit:material('cardigan.trim',[.064,.052,.076],[.027,.020,.035],.00045),
    plum:material('ribbon.plum',[.27,.105,.18],[.14,.043,.087],.00045),
    skirt:material('skirt.charcoal',[.128,.094,.145],[.051,.032,.065],.0006),
    lining:material('skirt.lining',[.040,.030,.048],[.020,.014,.026],.0002),
    gold:material('hardware.gold',[.55,.365,.17],[.28,.16,.062],.0002),
  };
  for (const key of ['skin','ivory','edge','skirt']) {
    const m=b.j.materials[mats[key]];
    m.alphaMode='OPAQUE';
    const toon=m.extensions.VRMC_materials_mtoon;
    toon.shadingToonyFactor=key==='skin'?.42:key==='skirt'?.48:.58;
    toon.giEqualizationFactor=key==='skin'?.63:key==='skirt'?.50:.70;
    if(key==='skirt') {
      toon.parametricRimColorFactor=[.060,.032,.073];
      toon.parametricRimFresnelPowerFactor=3.5;
    }
  }
  // MToon 1.0 intentionally ignores COLOR_0. A standard glTF PBR skin material
  // honors these subtle complexion colors without any renderer-side override.
  const skinMaterial=b.j.materials[mats.skin];
  delete skinMaterial.extensions;
  skinMaterial.pbrMetallicRoughness.metallicFactor=0;
  skinMaterial.pbrMetallicRoughness.roughnessFactor=.85;
  // A small diffuse fill keeps the stylized neck transition from reading as
  // a dark collar while retaining the PBR surface and its soft vertex shadows.
  skinMaterial.emissiveFactor=[.028,.020,.018];
  const arms={};
  for (const side of ['left','right']) arms[side]={
    shoulder:b.bonePosition(side+'UpperArm').clone(),
    elbow:b.bonePosition(side+'LowerArm').clone(), wrist:b.bonePosition(side+'Hand').clone(),
  };
  const torsoWeights=(_x,y) => y<1.095
    ? blend({hips:.62,spine:.38},{spine:1},smooth(1.03,1.095,y))
    : y<1.19 ? blend({spine:1},{chest:1},smooth(1.095,1.19,y))
    : blend({chest:1},{upperChest:1},smooth(1.19,1.255,y));
  const upperWeights=(x,y) => {
    const side=x>=0?'left':'right', ax=Math.abs(x), arm=arms[side], sx=Math.abs(arm.shoulder.x), ex=Math.abs(arm.elbow.x);
    const join=smooth(sx-.045,sx+.05,ax)*lerp(smooth(1.18,1.247,y),1,smooth(sx+.03,sx+.11,ax));
    const limb=blend({[side+'UpperArm']:1},{[side+'LowerArm']:1},smooth(ex-.035,ex+.035,ax));
    return blend(torsoWeights(x,y),limb,join);
  };
  const skinWeights=(x,y) => blend(upperWeights(x,y),{neck:1},smooth(1.300,1.346,y));
  const add=(name,g,m,w=upperWeights) => b.mesh('outfitV3.'+name,g,m,w);

  // One continuous neck/upper-chest shell, not a flat inset at the neckline.
  const skinShell=trimCoveredArmholes(grid(64,96,(v,u)=>bodyPoint(lerp(1.169,1.355,v),u*TAU)));
  vertexColor(skinShell,(x,y,z)=>{
    const front=smooth(.012,.055,z), ax=Math.abs(x);
    const collar=.050*Math.exp(-(((y-(1.285-.050*ax))/.008)**2))
      *smooth(.008,.030,ax)*(1-smooth(.075,.11,ax));
    const valley=.245*Math.exp(-((x/.018)**2))*smooth(1.169,1.183,y)
      *(1-smooth(1.195,1.239,y));
    const neck=.023*Math.exp(-(((y-1.308)/.014)**2))*Math.exp(-((x/.028)**2));
    const shade=(collar+valley+neck)*front;
    const collarHighlight=.024*Math.exp(-(((y-(1.292-.050*ax))/.0055)**2))
      *smooth(.010,.027,ax)*(1-smooth(.075,.105,ax));
    const upperArc=.013*Math.exp(-(((ax-.045)/.026)**2))*Math.exp(-(((y-1.238)/.018)**2));
    const base=1-.025*front, highlight=(collarHighlight+upperArc)*front;
    return [clamp(base-shade*.80+highlight,0,1),clamp(base-shade+highlight,0,1),
      clamp(base-shade*1.035+highlight*.96,0,1)];
  });
  add('neckAndUpperChest',skinShell,mats.skin,skinWeights);
  add('sweetheartBlouse',trimCoveredArmholes(grid(64,96,(v,u)=>{
    const theta=u*TAU; return bodyPoint(lerp(1.014,neckline(theta),v),theta,.0037);
  })),mats.ivory);
  // Fine folded facing follows the actual neckline, with a rounded fabric lip.
  add('necklineFacing',grid(4,128,(v,u)=>{
    const theta=u*TAU, y=neckline(theta)-v*.006;
    return bodyPoint(y,theta,.0048+Math.sin(v*Math.PI)*.0008);
  }),mats.edge);
  add('cardigan.body',grid(52,72,(v,u)=>{
    const y=lerp(1.058,1.307,v), gap=opening(y);
    return bodyPoint(y,lerp(gap,TAU-gap,u),.0058);
  }),mats.charcoal);
  add('cardigan.croppedHem',grid(3,72,(v,u)=>{
    const y=lerp(1.055,1.071,v), gap=opening(y);
    return bodyPoint(y,lerp(gap,TAU-gap,u),.0068);
  }),mats.knit);
  for (const sign of [-1,1]) add('cardigan.edge.'+sign,grid(52,3,(v,u)=>{
    const y=lerp(1.068,1.305,v);
    return bodyPoint(y,sign*(opening(y)+(u-.1)*.044),.0070);
  }),mats.knit);

  const sleeveBounds={};
  for (const side of ['left','right']) {
    const arm=arms[side], sign=side==='left'?1:-1;
    const start=Math.abs(arm.shoulder.x)-.024, elbow=Math.abs(arm.elbow.x), end=Math.abs(arm.wrist.x)-.012;
    const shape=[[start,.032,.043],[start+.040,.040,.046],[elbow-.065,.036,.037],
      [elbow,.033,.034],[elbow+.065,.038,.035],[end-.045,.029,.030],[end-.021,.024,.026],[end,.022,.025]];
    const at=(x,u,extra=0)=>{
      const c=x<elbow ? arm.shoulder.clone().lerp(arm.elbow,clamp((x-Math.abs(arm.shoulder.x))/(elbow-Math.abs(arm.shoulder.x)),0,1))
        : arm.elbow.clone().lerp(arm.wrist,clamp((x-elbow)/(Math.abs(arm.wrist.x)-elbow),0,1));
      const [,ry,rz]=profile(shape,x), a=u*TAU;
      const cap=.014*smooth(start,start+.028,x)*(1-smooth(start+.055,start+.145,x))*Math.max(0,Math.sin(a))**2;
      const fold=.0008*Math.sin(x*91)*Math.sin(a*3)*(1-smooth(end-.05,end,x));
      return [sign*x,c.y+(ry+extra+fold)*Math.cos(a),c.z+(rz+extra+fold)*Math.sin(a)+cap];
    };
    add('cardigan.sleeve.'+side,grid(40,36,(v,u)=>at(lerp(start,end,v),u),sign<0),mats.charcoal);
    add('cardigan.cuff.'+side,grid(5,40,(v,u)=>at(lerp(end-.023,end+.001,v),u,.0013+.0004*Math.cos(u*TAU*20)),sign<0),mats.knit);
    add('cardigan.cuffLip.'+side,grid(3,36,(v,u)=>at(end+.001+Math.sin(v*Math.PI)*.001,u,.0015-.003*v),sign<0),mats.knit);
    sleeveBounds[side]={xMin:sign>0?start:-end-.002,xMax:sign>0?end+.002:-start,
      yMin:arm.shoulder.y-.043,yMax:arm.shoulder.y+.043,zMin:arm.shoulder.z-.049,zMax:arm.shoulder.z+.063};
  }

  // A small off-centre ribbon sits on fabric, leaving the neckline unobstructed.
  const bowX=.077, bowY=1.226;
  for (const sign of [-1,1]) {
    add('ribbon.wing.'+sign,grid(16,12,(v,u)=>{
      const a=2*u-1, x=bowX+sign*(.004+.021*v-.003*a*a*v**3);
      const y=bowY+.002*v+a*(.002+.009*Math.sin(v*Math.PI/2));
      return frontPoint(x,y,.008+.003*Math.sin(v*Math.PI)*(1-a*a));
    }),mats.plum);
    add('ribbon.tail.'+sign,grid(14,6,(v,u)=>{
      const a=2*u-1, x=bowX+sign*(.004+.008*v+a*lerp(.003,.0045,v));
      const y=bowY-.035*v+.004*(1-Math.abs(a))*smooth(.88,1,v);
      return frontPoint(x,y,.006);
    }),mats.plum);
  }
  add('ribbon.knot',new THREE.SphereGeometry(1,16,10).scale(.005,.006,.0035).translate(...frontPoint(bowX,bowY,.009)),mats.plum);
  add('blouse.frontSeam',grid(40,2,(v,u)=>frontPoint((u-.5)*.006,lerp(1.052,1.169,v),.0049)),mats.edge);
  for (const y of [1.080,1.117,1.151]) add('blouse.button.'+y,
    new THREE.SphereGeometry(1,12,8).scale(.0013,.0013,.0006).translate(...frontPoint(0,y,.006)),mats.edge);

  // A single weak central chain moves the skirt coherently; no independent
  // leg weighting and no renderer lookup by a custom bone name is needed.
  const springs=b.spring('outfitV3Skirt',[[0,1.006,.011],[0,.902,.011],[0,SKIRT_V3_HEM,.009]],
    {parent:'hips',stiffness:1.25,drag:.84,gravity:.025,radius:.004});
  b.j.extensions.VRMC_springBone.springs.at(-1).colliderGroups=[];
  const skirtWeights=(_x,y)=>{
    const upper=blend({hips:1},{hips:.82,spine:.18},smooth(.982,1.045,y));
    const flex=(1-smooth(.82,.969,y))*.46;
    return blend(upper,blend({[springs[0]]:1},{[springs[1]]:1},1-smooth(.81,.91,y)),flex);
  };
  const hemAt=theta=>SKIRT_V3_HEM+.0055*Math.sin(theta*3+.4)+.0027*Math.sin(theta*7-.6);
  const skirtPoint=(v,theta,pleatDepth=0,inset=0)=>{
    const nominalY=lerp(SKIRT_V3_HEM,1.038,v), [,rx,rz,cz]=profile(SKIRT,nominalY);
    const drift=.012*(1-v)**2*Math.sin(theta*3+.6);
    const angle=theta+drift, fold=pleatDepth*(1-smooth(.948,1.034,nominalY));
    const hemWave=(hemAt(theta)-SKIRT_V3_HEM)*(1-v)**4;
    const lift=.0006*Math.sin(theta*11+v*2)*(1-v)**3;
    return [(rx+fold-inset)*Math.sin(angle),nominalY+hemWave+lift,cz+(rz+fold-inset)*Math.cos(angle)];
  };
  const panels=[0,.34,.49,.65,1], depths=[0,.0015,-.014,-.0045,0], pleats=[];
  const pleatColor=(p,y,id)=>{
    const u=(id%3)/2, depth=lerp(depths[p],depths[p+1],u);
    const occlusion=clamp(-depth/.014,0,1)*.33*(1-smooth(.948,1.034,y));
    return [1-occlusion*.94,1-occlusion,1-occlusion*.85];
  };
  for (let i=0;i<24;i++) for (let p=0;p<4;p++) {
    const patch=grid(20,2,(v,u)=>{
      const theta=(i+lerp(panels[p],panels[p+1],u))/24*TAU;
      return skirtPoint(v,theta,lerp(depths[p],depths[p+1],u));
    });
    pleats.push(vertexColor(patch,(_x,y,_z,id)=>pleatColor(p,y,id)));
  }
  add('skirt.softPleats',mergeGeometries(pleats),mats.skirt,skirtWeights);
  pleats.forEach(g=>g.dispose());
  // Complete opaque lining follows the shorter hem and sits inside each fold.
  add('skirt.fullLining',grid(24,96,(v,u)=>{
    const p=skirtPoint(lerp(.035,.99,v),u*TAU,0,.018);
    return p;
  }),mats.lining,skirtWeights);
  // An internal closed hip yoke prevents an open view into the body cavity.
  add('skirt.innerYoke',grid(8,64,(v,u)=>{
    const a=u*TAU, r=v, y=.946-.008*r*r;
    const [,rx,rz,cz]=profile(SKIRT,y);
    return [(rx-.018)*r*Math.sin(a),y,cz+(rz-.018)*r*Math.cos(a)];
  },true),mats.lining,skirtWeights);
  // Fine turned hem: about 1 mm thick, rather than a heavy solid cylinder.
  const hemPieces=[];
  for (let i=0;i<24;i++) for (let p=0;p<4;p++) {
    const patch=grid(3,2,(v,u)=>{
      const theta=(i+lerp(panels[p],panels[p+1],u))/24*TAU;
      const point=skirtPoint(v*.012,theta,lerp(depths[p],depths[p+1],u),.0008);
      point[1]+=.0008*Math.sin(v*Math.PI); return point;
    });
    hemPieces.push(vertexColor(patch,(_x,y,_z,id)=>pleatColor(p,y,id)));
  }
  add('skirt.turnedHem',mergeGeometries(hemPieces),mats.skirt,skirtWeights);
  hemPieces.forEach(g=>g.dispose());
  add('skirt.highWaistband',grid(6,96,(v,u)=>{
    const y=lerp(1.017,1.046,v), [,rx,rz,cz]=profile(SKIRT,y), a=u*TAU;
    return [(rx+.0012)*Math.sin(a),y,cz+(rz+.0012)*Math.cos(a)];
  }),mats.knit,skirtWeights);
  // One restrained side buckle, fitted to the waist rather than floating boxes.
  const buckleY=1.031, buckleX=.052, [,wr,wd,wz]=profile(SKIRT,buckleY);
  const buckleZ=wz+wd*Math.sqrt(1-(buckleX/wr)**2)+.003;
  for (const sign of [-1,1]) {
    add('waist.buckle.h.'+sign,new THREE.BoxGeometry(.014,.0012,.0018).translate(buckleX,buckleY+sign*.007,buckleZ),mats.gold,skirtWeights);
    add('waist.buckle.v.'+sign,new THREE.BoxGeometry(.0012,.014,.0018).translate(buckleX+sign*.007,buckleY,buckleZ),mats.gold,skirtWeights);
  }
  return {...OUTFIT_V3_COVERAGE,sleeves:sleeveBounds,skinMaterial:mats.skin,
    skirtSpringNames:springs,skirtHem:SKIRT_V3_HEM,materials:mats};
}
