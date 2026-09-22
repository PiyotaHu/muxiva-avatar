import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

// Reference-matched clothing in the reviewed sample's metre-based T-pose.
// This asset module never changes the source rig, face, hair, or leg geometry.
export const SKIRT_V4_HEM = .745;
export const OUTFIT_V4_COVERAGE = Object.freeze({
  blouse: {bottomY: 1.034, necklineCentreY: 1.278, necklineSideY: 1.313,
    chestHalfWidth: .135, chestMaximumFrontZ: .115},
  skinShell: {bottomY: 1.269, topY: 1.355, sourceNeckKeepAboveY: 1.350},
  waist: {y: 1.036, halfWidth: .103},
  hips: {y: .920, halfWidth: .141},
  skirt: {topY: 1.048, hemY: SKIRT_V4_HEM, hemMinY: SKIRT_V4_HEM,
    hemMaxY: SKIRT_V4_HEM + .003, halfWidth: .202, depthRadius: .108},
  stockings: {recommendedTopY: SKIRT_V4_HEM + .035, preserveSourceLegWidth: true},
  sleeve: {startFromShoulder: -.024, endBeforeHand: .012},
  removeOriginalPrimitives: [1, 3],
});

const clamp=THREE.MathUtils.clamp, lerp=THREE.MathUtils.lerp, TAU=Math.PI*2;
const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
const blend=(a,b,t)=>{
  const result={};
  for(const [key,value] of Object.entries(a))if(value*(1-t)>1e-7)result[key]=value*(1-t);
  for(const [key,value] of Object.entries(b))if(value*t>1e-7)result[key]=(result[key]||0)+value*t;
  return result;
};
function grid(rows,columns,at,flip=false) {
  const positions=[],uv=[],indices=[];
  for(let r=0;r<=rows;r++)for(let c=0;c<=columns;c++) {
    positions.push(...at(r/rows,c/columns));uv.push(c/columns,r/rows);
  }
  for(let r=0;r<rows;r++)for(let c=0;c<columns;c++) {
    const a=r*(columns+1)+c,d=a+columns+1;
    if(flip)indices.push(a,d,a+1,a+1,d,d+1);
    else indices.push(a,a+1,d,a+1,d+1,d);
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
  g.setIndex(indices);g.computeVertexNormals();return g;
}
function colorize(g,at) {
  const p=g.attributes.position,colors=new Float32Array(p.count*3);
  for(let i=0;i<p.count;i++)colors.set(at(p.getX(i),p.getY(i),p.getZ(i),i),i*3);
  g.setAttribute('color',new THREE.BufferAttribute(colors,3));return g;
}
function foldedPanel(points,thickness=.0015) {
  const area=points.reduce((s,p,i)=>{const q=points[(i+1)%points.length];return s+p[0]*q[1]-q[0]*p[1];},0);
  if(area<0)points=[...points].reverse();
  const p=points.flat(),indices=[],n=points.length;
  for(const point of points)p.push(point[0],point[1],point[2]-thickness);
  for(let i=1;i<n-1;i++)indices.push(0,i,i+1,n,n+i+1,n+i);
  for(let i=0;i<n;i++){const k=(i+1)%n;indices.push(i,n+i,k,k,n+i,n+k);}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));
  g.setIndex(indices);g.computeVertexNormals();return g;
}
function profile(table,y) {
  if(y<=table[0][0])return [...table[0]];
  for(let i=1;i<table.length;i++)if(y<=table[i][0]) {
    const a=table[i-1],b=table[i],previous=table[Math.max(0,i-2)],next=table[Math.min(table.length-1,i+1)];
    const dy=b[0]-a[0],t=(y-a[0])/dy;
    return a.map((value,k)=>{
      if(k===0)return y;
      const slope=(b[k]-value)/dy;if(Math.abs(slope)<1e-9)return value;
      const m0=clamp(((b[k]-previous[k])/(b[0]-previous[0]))/slope,0,3)*slope;
      const m1=clamp(((next[k]-value)/(next[0]-a[0]))/slope,0,3)*slope;
      return (2*t**3-3*t*t+1)*value+(t**3-2*t*t+t)*dy*m0+(-2*t**3+3*t*t)*b[k]+(t**3-t*t)*dy*m1;
    });
  }
  return [...table.at(-1)];
}
// The waist is not pinched. The shirt wraps a single modest chest envelope;
// there is no exposed bust shell, cleavage hollow, or sweetheart cut.
const TORSO=[
  [1.014,.102,-.050,.065],[1.036,.100,-.048,.062],
  [1.080,.105,-.049,.066],[1.125,.116,-.056,.069],
  [1.165,.128,-.063,.071],[1.190,.130,-.066,.070],
  [1.220,.128,-.065,.060],[1.250,.129,-.063,.045],
  [1.278,.122,-.063,.030],[1.300,.088,-.061,.020],
  [1.320,.047,-.059,.006],[1.337,.0328,-.061,.014],[1.355,.033,-.063,.020],
];
// A near-linear A-line, not the large high-hip dome of v3.
const SKIRT=[
  [SKIRT_V4_HEM,.200,.108,.008],[.790,.186,.103,.009],
  [.850,.165,.094,.010],[.920,.141,.082,.010],
  [.980,.119,.068,.009],[1.025,.103,.058,.008],[1.048,.103,.058,.008],
];
function bodyPoint(y,theta,ease=0) {
  const [,rx,back,front]=profile(TORSO,y),s=Math.sin(theta),c=Math.cos(theta),x=rx*s;
  const height=Math.exp(-(((y-1.184)/.062)**2));
  const lobes=Math.exp(-(((x-.047)/.059)**2))+Math.exp(-(((x+.047)/.059)**2));
  const volume=(.018*lobes+.005*Math.exp(-((x/.092)**4)))*height*smooth(.08,.65,c);
  const clothFold=ease>0?.0007*Math.sin(x*120+y*15)*smooth(1.02,1.055,y)*(1-smooth(1.12,1.16,y))*Math.max(0,c)**4:0;
  return [(rx+ease)*s,y,(front+back)/2+((front-back)/2+ease)*c+volume+clothFold];
}
// Keep the shirt inside the waistband, then ease back to the existing torso
// above it. This is local fabric tuck, not a change to chest or skirt shape.
function blousePoint(y,theta) {
  const p=bodyPoint(y,theta,.0035),tuck=1-smooth(1.048,1.068,y);
  if(tuck>0) {
    const [,rx,rz,cz]=profile(SKIRT,y);
    p[0]=lerp(p[0],(rx-.003)*Math.sin(theta),tuck);
    p[2]=lerp(p[2],cz+(rz-.003)*Math.cos(theta),tuck);
  }
  return p;
}
function frontPoint(x,y,lift=.005) {
  const [,rx]=profile(TORSO,y),p=bodyPoint(y,Math.asin(clamp(x/rx,-.998,.998)));
  p[2]+=lift;return p;
}
const neckline=theta=>lerp(1.320,1.278+.035*Math.abs(Math.sin(theta)),smooth(0,.65,Math.cos(theta)));
const opening=y=>lerp(.76,.81,smooth(1.055,1.245,y))-.055*smooth(1.275,1.320,y);
function trimArmholes(g) {
  const p=g.attributes.position,kept=[];
  for(let i=0;i<g.index.count;i+=3) {
    const ids=[g.index.getX(i),g.index.getX(i+1),g.index.getX(i+2)];
    const x=ids.reduce((s,k)=>s+p.getX(k),0)/3,y=ids.reduce((s,k)=>s+p.getY(k),0)/3;
    const z=ids.reduce((s,k)=>s+p.getZ(k),0)/3,[,rx,back,front]=profile(TORSO,y);
    const covered=y>1.218&&y<1.310&&Math.abs(x)>.082
      &&(z<(back+front)/2||Math.abs(x)/rx>Math.sin(opening(y)+.035));
    if(!covered)kept.push(...ids);
  }
  g.setIndex(kept);return g;
}

/** Builds only v4 garments; the caller owns source masking and final packaging. */
export function buildOutfitV4(b) {
  const material=(name,color,shade,outline=.0004)=>b.material('outfitV4.'+name,{color,shade,outline,doubleSided:true});
  const mats={
    skin:material('neck',[.88,.66,.59],[.63,.40,.37],0),
    ivory:material('blouse.ivory',[.91,.894,.861],[.68,.65,.59],.00035),
    edge:material('blouse.collar',[.945,.929,.895],[.70,.675,.625],.0003),
    charcoal:material('cardigan.charcoal',[.079,.075,.087],[.035,.031,.043],.0005),
    knit:material('cardigan.trim',[.062,.058,.071],[.025,.022,.033],.0003),
    plum:material('ribbon.burgundy',[.265,.088,.145],[.135,.034,.070],.00035),
    skirt:material('skirt.charcoal',[.092,.086,.103],[.040,.034,.050],.00035),
    lining:material('skirt.lining',[.035,.031,.041],[.018,.015,.023],.00015),
    gold:material('hardware.antiqueGold',[.50,.335,.15],[.25,.135,.05],.00018),
  };
  for(const key of ['skin','skirt']) {
    const m=b.j.materials[mats[key]];
    delete m.extensions;m.alphaMode='OPAQUE';
    m.pbrMetallicRoughness.metallicFactor=0;m.pbrMetallicRoughness.roughnessFactor=.9;
  }
  b.j.materials[mats.skin].emissiveFactor=[.020,.014,.012];
  const arms={};
  for(const side of ['left','right'])arms[side]={
    shoulder:b.bonePosition(side+'UpperArm').clone(),elbow:b.bonePosition(side+'LowerArm').clone(),
    wrist:b.bonePosition(side+'Hand').clone(),
  };
  // The overlapping shirt and waistband share a skin envelope. Different
  // hip/spine blends here open a white seam as soon as the torso sways.
  const waistWeights=y=>blend({hips:1},{hips:.82,spine:.18},smooth(.987,1.048,y));
  const torsoWeights=(_x,y)=>y<1.095
    ?blend(waistWeights(y),{spine:1},smooth(1.058,1.095,y))
    :y<1.19?blend({spine:1},{chest:1},smooth(1.095,1.19,y))
    :blend({chest:1},{upperChest:1},smooth(1.19,1.255,y));
  const upperWeights=(x,y)=>{
    const side=x>=0?'left':'right',ax=Math.abs(x),arm=arms[side],sx=Math.abs(arm.shoulder.x),ex=Math.abs(arm.elbow.x);
    const join=smooth(sx-.045,sx+.05,ax)*lerp(smooth(1.18,1.247,y),1,smooth(sx+.03,sx+.11,ax));
    const limb=blend({[side+'UpperArm']:1},{[side+'LowerArm']:1},smooth(ex-.035,ex+.035,ax));
    return blend(torsoWeights(x,y),limb,join);
  };
  const skinWeights=(x,y)=>blend(upperWeights(x,y),{neck:1},smooth(1.300,1.346,y));
  const add=(name,g,m,w=upperWeights)=>b.mesh('outfitV4.'+name,g,m,w);

  const neck=trimArmholes(grid(30,72,(v,u)=>bodyPoint(lerp(1.269,1.355,v),u*TAU)));
  colorize(neck,(_x,y,z)=>{
    const shade=.018*smooth(.01,.06,z)*Math.exp(-(((y-1.310)/.020)**2));
    return [1-shade*.7,1-shade,1-shade];
  });
  add('neck',neck,mats.skin,skinWeights);
  add('buttonedBlouse',trimArmholes(grid(56,88,(v,u)=>{
    const theta=u*TAU;return blousePoint(lerp(OUTFIT_V4_COVERAGE.blouse.bottomY,neckline(theta),v),theta);
  })),mats.ivory);
  add('blouse.neckFacing',grid(3,88,(v,u)=>{
    const theta=u*TAU;return bodyPoint(neckline(theta)-v*.0045,theta,.0045);
  }),mats.edge);
  for(const sign of [-1,1])add('blouse.foldedCollar.'+sign,foldedPanel([
    frontPoint(sign*.007,1.287,.006),frontPoint(sign*.029,1.315,.006),
    frontPoint(sign*.060,1.280,.006),frontPoint(sign*.027,1.254,.008),
  ],.0016),mats.edge);
  add('blouse.placket',grid(38,2,(v,u)=>{
    const x=(u-.5)*.007,y=lerp(OUTFIT_V4_COVERAGE.blouse.bottomY,1.270,v),[,rx]=profile(TORSO,y);
    const p=blousePoint(y,Math.asin(clamp(x/rx,-.998,.998)));p[2]+=.0013;return p;
  }),mats.edge);
  for(const y of [1.069,1.110,1.151,1.192,1.232])add('blouse.button.'+y,
    new THREE.SphereGeometry(1,10,8).scale(.0014,.0014,.00065).translate(...frontPoint(0,y,.006)),mats.ivory);

  add('cardigan.body',grid(44,64,(v,u)=>{
    const y=lerp(1.061,1.318,v),gap=opening(y);return bodyPoint(y,lerp(gap,TAU-gap,u),.006);
  }),mats.charcoal);
  add('cardigan.croppedHem',grid(4,64,(v,u)=>{
    const y=lerp(1.052,1.068,v),gap=opening(y);return bodyPoint(y,lerp(gap,TAU-gap,u),.0068);
  }),mats.knit);
  for(const sign of [-1,1])add('cardigan.placket.'+sign,grid(40,3,(v,u)=>{
    const y=lerp(1.064,1.316,v);return bodyPoint(y,sign*(opening(y)+(u-.1)*.043),.007);
  }),mats.knit);
  for(const y of [1.080,1.133,1.186,1.239])add('cardigan.button.'+y,
    new THREE.SphereGeometry(1,10,8).scale(.0015,.0018,.0008)
      .translate(...bodyPoint(y,-opening(y)-.018,.008)),mats.gold);
  const sleeveBounds={};
  for(const side of ['left','right']) {
    const arm=arms[side],sign=side==='left'?1:-1;
    const start=Math.abs(arm.shoulder.x)-.024,elbow=Math.abs(arm.elbow.x),end=Math.abs(arm.wrist.x)-.012;
    const shape=[[start,.031,.041],[start+.040,.039,.044],[elbow-.065,.034,.035],
      [elbow,.031,.032],[elbow+.065,.036,.033],[end-.045,.028,.029],[end-.021,.024,.025],[end,.022,.024]];
    const at=(x,u,extra=0)=>{
      const centre=x<elbow?arm.shoulder.clone().lerp(arm.elbow,clamp((x-Math.abs(arm.shoulder.x))/(elbow-Math.abs(arm.shoulder.x)),0,1))
        :arm.elbow.clone().lerp(arm.wrist,clamp((x-elbow)/(Math.abs(arm.wrist.x)-elbow),0,1));
      const [,ry,rz]=profile(shape,x),a=u*TAU;
      const cap=.013*smooth(start,start+.028,x)*(1-smooth(start+.055,start+.145,x))*Math.max(0,Math.sin(a))**2;
      const fold=.0008*Math.sin(x*91)*Math.sin(a*3)*(1-smooth(end-.05,end,x));
      return [sign*x,centre.y+(ry+extra+fold)*Math.cos(a),centre.z+(rz+extra+fold)*Math.sin(a)+cap];
    };
    add('cardigan.sleeve.'+side,grid(36,32,(v,u)=>at(lerp(start,end,v),u),sign<0),mats.charcoal);
    add('cardigan.cuff.'+side,grid(5,36,(v,u)=>at(lerp(end-.023,end+.001,v),u,.0013+.0004*Math.cos(u*TAU*18)),sign<0),mats.knit);
    add('cardigan.cuffLip.'+side,grid(3,32,(v,u)=>at(end+.001+Math.sin(v*Math.PI)*.001,u,.0015-.003*v),sign<0),mats.knit);
    sleeveBounds[side]={xMin:sign>0?start:-end-.002,xMax:sign>0?end+.002:-start};
  }
  const bowY=1.265;
  for(const sign of [-1,1]) {
    add('ribbon.wing.'+sign,grid(16,12,(v,u)=>{
      const a=2*u-1,x=sign*(.004+.034*v-.003*a*a*v**3);
      const y=bowY+.005*Math.sin(v*Math.PI/2)+a*(.0025+.011*Math.sin(v*Math.PI/2));
      return frontPoint(x,y,.009+.003*Math.sin(v*Math.PI)*(1-a*a));
    }),mats.plum);
    add('ribbon.tail.'+sign,grid(14,6,(v,u)=>{
      const a=2*u-1,x=sign*(.005+.010*v+a*lerp(.0035,.0055,v));
      return frontPoint(x,bowY-.045*v+.004*(1-Math.abs(a))*smooth(.88,1,v),.007);
    }),mats.plum);
  }
  add('ribbon.knot',new THREE.SphereGeometry(1,14,10).scale(.006,.007,.004)
    .translate(...frontPoint(0,bowY,.010)),mats.plum);

  const springs=b.spring('outfitV4Skirt',[[0,1.006,.009],[0,.886,.009],[0,SKIRT_V4_HEM,.008]],
    {parent:'hips',stiffness:1.4,drag:.86,gravity:.020,radius:.004});
  b.j.extensions.VRMC_springBone.springs.at(-1).colliderGroups=[];
  const skirtWeights=(_x,y)=>{
    const upper=waistWeights(y);
    const flex=(1-smooth(.79,.970,y))*.30;
    return blend(upper,blend({[springs[0]]:1},{[springs[1]]:1},1-smooth(.78,.91,y)),flex);
  };
  const skirtPoint=(v,theta,depth=0,inset=0)=>{
    const y=lerp(SKIRT_V4_HEM,1.037,v),[,rx,rz,cz]=profile(SKIRT,y);
    const fold=depth*(1-smooth(.962,1.033,y));
    const angle=theta+.004*(1-v)**2*Math.sin(theta*2);
    const hemLift=.0012*(1-Math.cos(theta*2))*(1-v)**4;
    return [(rx+fold-inset)*Math.sin(angle),y+hemLift,cz+(rz+fold-inset)*Math.cos(angle)];
  };
  const count=20,panels=[0,.42,.56,.72,1],depths=[0,.0007,-.009,-.0065,0];
  const pleatColor=(panel,y,index)=>{
    const depth=lerp(depths[panel],depths[panel+1],(index%3)/2);
    const shade=clamp(-depth/.009,0,1)*.20*(1-smooth(.962,1.033,y));
    return [1-shade,1-shade,1-shade*.96];
  };
  const pleats=[],hems=[];
  for(let i=0;i<count;i++)for(let panel=0;panel<4;panel++) {
    const theta=u=>(i+lerp(panels[panel],panels[panel+1],u))/count*TAU;
    const depth=u=>lerp(depths[panel],depths[panel+1],u);
    pleats.push(colorize(grid(16,2,(v,u)=>skirtPoint(v,theta(u),depth(u))),
      (_x,y,_z,index)=>pleatColor(panel,y,index)));
    hems.push(colorize(grid(2,2,(v,u)=>{
      const point=skirtPoint(v*.011,theta(u),depth(u),.0006);
      point[1]+=.0006*Math.sin(v*Math.PI);return point;
    }),(_x,y,_z,index)=>pleatColor(panel,y,index)));
  }
  add('skirt.aLinePleats',mergeGeometries(pleats),mats.skirt,skirtWeights);
  add('skirt.fineHem',mergeGeometries(hems),mats.skirt,skirtWeights);
  pleats.forEach(g=>g.dispose());hems.forEach(g=>g.dispose());
  add('skirt.fullLining',grid(20,72,(v,u)=>skirtPoint(lerp(.023,.995,v),u*TAU,0,.013)),mats.lining,skirtWeights);
  add('skirt.closedYoke',grid(8,64,(v,u)=>{
    const a=u*TAU,y=.958-.006*v*v,[,rx,rz,cz]=profile(SKIRT,y);
    return [(rx-.013)*v*Math.sin(a),y,cz+(rz-.013)*v*Math.cos(a)];
  },true),mats.lining,skirtWeights);
  add('skirt.highWaistband',grid(5,80,(v,u)=>{
    const y=lerp(1.024,1.048,v),[,rx,rz,cz]=profile(SKIRT,y),a=u*TAU;
    return [(rx+.0012)*Math.sin(a),y,cz+(rz+.0012)*Math.cos(a)];
  }),mats.knit,skirtWeights);
  const skirtFront=(x,y,lift=0)=>{
    const [,rx,rz,cz]=profile(SKIRT,y);
    return [x,y,cz+rz*Math.sqrt(1-(x/rx)**2)+lift];
  };
  for(const [index,y] of [1.034,.998].entries()) {
    const x=.068,[,rx,rz]=profile(SKIRT,y);
    add('skirt.strap.'+index,grid(3,14,(v,u)=>skirtFront(x-.025+u*.043,y+(v-.5)*.012,.002)),mats.knit,skirtWeights);
    const centre=new THREE.Vector3(...skirtFront(x,y,.004));
    const yaw=Math.atan(x*rz/(rx*rx*Math.sqrt(1-(x/rx)**2)));
    const width=.014,height=.016;
    const bar=(name,sx,sy,dx,dy,depth=.0017)=>{
      const offset=new THREE.Vector3(dx,dy,0).applyAxisAngle(new THREE.Vector3(0,1,0),yaw).add(centre);
      add(name,new THREE.BoxGeometry(sx,sy,depth).rotateY(yaw).translate(...offset.toArray()),mats.gold,skirtWeights);
    };
    for(const sign of [-1,1]) {
      bar('skirt.buckle.'+index+'.horizontal.'+sign,width,.0012,0,sign*height/2);
      bar('skirt.buckle.'+index+'.vertical.'+sign,.0012,height,sign*width/2,0);
    }
    bar('skirt.buckle.'+index+'.tongue',.009,.0010,-.001,0,.0020);
  }
  return {...OUTFIT_V4_COVERAGE,sleeves:sleeveBounds,skinMaterial:mats.skin,
    skirtSpringNames:springs,skirtHem:SKIRT_V4_HEM,materials:mats};
}
