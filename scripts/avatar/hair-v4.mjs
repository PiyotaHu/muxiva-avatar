import {BufferGeometry, Float32BufferAttribute, Vector3, CatmullRomCurve3, SphereGeometry, TorusGeometry, Box3} from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
const HEAD_WEIGHT = () => ({head:1});
const FRONT = new Vector3(0,0,1);
const curve = points => new CatmullRomCurve3(points.map(p=>new Vector3(...p)),false,'centripetal');
const profile = (t,root=.58) => Math.max(.008,(root+.54*Math.sin(Math.PI*t))*(1-t)**.63);
const extendTail = points => points.map(([x,y,z]) => [x * (1 + .14 * Math.min(1, Math.max(0, (1.4 - y) / .35))), y < 1.4 ? 1.4 - (1.4 - y) * 1.35 : y, z]);

// Flattened tapered locks, with their width following the face plane.
function lock(points,halfWidth,depth,{segments=30,sides=8,root=.58}={}) {
  const path=curve(points),positions=[],uvs=[],indices=[];
  const center=new Vector3(),tangent=new Vector3(),wide=new Vector3(),forward=new Vector3();
  for(let row=0;row<=segments;row++) {
    const t=row/segments;
    path.getPoint(t,center); path.getTangent(t,tangent).normalize();
    wide.crossVectors(tangent,FRONT);
    if(wide.lengthSq()<.000001) wide.set(1,0,0); else wide.normalize();
    forward.crossVectors(wide,tangent).normalize();
    const radius=profile(t,root);
    for(let side=0;side<=sides;side++) {
      const angle=side/sides*Math.PI*2,u=Math.cos(angle)*halfWidth*radius,v=Math.sin(angle)*depth*radius;
      positions.push(center.x+wide.x*u+forward.x*v,center.y+wide.y*u+forward.y*v,center.z+wide.z*u+forward.z*v);
      uvs.push(side/sides,t);
      if(row<segments&&side<sides) {
        const a=row*(sides+1)+side,b=a+sides+1;
        indices.push(a,b,a+1,a+1,b,b+1);
      }
    }
  }
  for(let side=1;side<sides-1;side++) {
    indices.push(0,side,side+1);
    const end=segments*(sides+1);indices.push(end,end+side+1,end+side);
  }
  const geometry=new BufferGeometry();
  geometry.setAttribute('position',new Float32BufferAttribute(positions,3));
  geometry.setAttribute('uv',new Float32BufferAttribute(uvs,2));
  geometry.setIndex(indices);geometry.computeVertexNormals();return geometry;
}

function glint(points,halfWidth,{segments=28,root=.28}={}) {
  const path=curve(points),positions=[],uvs=[],indices=[];
  const center=new Vector3(),tangent=new Vector3(),wide=new Vector3();
  for(let row=0;row<=segments;row++) {
    const t=row/segments;path.getPoint(t,center);path.getTangent(t,tangent).normalize();
    wide.crossVectors(tangent,FRONT);
    if(wide.lengthSq()<.000001)wide.set(1,0,0);else wide.normalize();
    const width=halfWidth*profile(t,root);
    for(const side of [-1,1]) {
      positions.push(center.x+wide.x*width*side,center.y+wide.y*width*side,center.z+wide.z*width*side);
      uvs.push((side+1)/2,t);
    }
    if(row<segments){const a=row*2;indices.push(a,a+1,a+2,a+1,a+3,a+2);}
  }
  const geometry=new BufferGeometry();
  geometry.setAttribute('position',new Float32BufferAttribute(positions,3));
  geometry.setAttribute('uv',new Float32BufferAttribute(uvs,2));
  geometry.setIndex(indices);geometry.computeVertexNormals();return geometry;
}

function clothWing(start,end,halfWidth) {
  const a=new Vector3(...start),b=new Vector3(...end),direction=b.clone().sub(a).normalize();
  const transverse=new Vector3(-direction.y,direction.x,0).normalize(),p=[],uv=[],ids=[];
  const rows=20,cols=10;
  for(let i=0;i<=rows;i++)for(let j=0;j<=cols;j++){
    const t=i/rows,v=j/cols*2-1;
    const point=a.clone().lerp(b,t).addScaledVector(transverse,v*(.002+halfWidth*Math.sin(t*Math.PI/2)));
    point.z+=.0035*Math.sin(t*Math.PI)*(1-v*v)+.0012*Math.sin(v*Math.PI*2)*t;
    point.y+=.002*(1-v*v)*t*t;
    p.push(...point);uv.push(j/cols,t);
    if(i<rows&&j<cols){const k=i*(cols+1)+j;ids.push(k,k+1,k+cols+1,k+1,k+cols+2,k+cols+1);}
  }
  const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(p,3));
  g.setAttribute('uv',new Float32BufferAttribute(uv,2));g.setIndex(ids);g.computeVertexNormals();return g;
}

function scalp() {
  const positions=[],normals=[],uvs=[],indices=[];
  const columns=56,rows=22,radius=[.106,.131,.129],center=[0,1.485,-.025],normal=new Vector3();
  for(let row=0;row<=rows;row++)for(let column=0;column<=columns;column++) {
    const phi=column/columns*Math.PI*2,front=Math.max(0,Math.cos(phi));
    const theta=row/rows*(2.79-front**2*1.36-Math.abs(Math.sin(phi))*.38);
    const nx=Math.sin(theta)*Math.sin(phi),ny=Math.cos(theta),nz=Math.sin(theta)*Math.cos(phi);
    positions.push(center[0]+radius[0]*nx,center[1]+radius[1]*ny,center[2]+radius[2]*nz);
    normal.set(nx/radius[0],ny/radius[1],nz/radius[2]).normalize();normals.push(normal.x,normal.y,normal.z);
    uvs.push(column/columns,row/rows);
    if(row<rows&&column<columns){const a=row*(columns+1)+column,b=a+columns+1;
      if(row>0)indices.push(a,b,a+1);indices.push(a+1,b,b+1);}
  }
  const geometry=new BufferGeometry();
  geometry.setAttribute('position',new Float32BufferAttribute(positions,3));
  geometry.setAttribute('normal',new Float32BufferAttribute(normals,3));
  geometry.setAttribute('uv',new Float32BufferAttribute(uvs,2));geometry.setIndex(indices);return geometry;
}

function chainWeights(names,points) {
  return(_x,y,_z)=>{
    if(y>=points[0][1])return{[names[0]]:1};
    for(let index=0;index<points.length-1;index++) {
      const upper=points[index][1],lower=points[index+1][1];
      if(y>=lower){const t=Math.max(0,Math.min(1,(upper-y)/(upper-lower)));
        return{[names[index]]:1-t,[names[index+1]]:t};}
    }
    return{[names.at(-1)]:1};
  };
}

/** Original replacement hair in global bind-pose meters; standard VRM skinning. */
export function buildHairV4(b) {
  const materials={
    silver:b.material('hair.silverLavender',{color:[.70,.66,.77],shade:[.43,.37,.51],outline:.00045}),
    light:b.material('hair.softSilver',{color:[.77,.73,.82],shade:[.50,.44,.58],outline:.0003}),
    shadow:b.material('hair.plumUnderlayers',{color:[.57,.51,.65],shade:[.34,.28,.42],outline:.00035}),
    highlight:b.material('hair.satinHighlights',{color:[.84,.80,.88],shade:[.63,.56,.71],outline:0,doubleSided:true}),
    ribbon:b.material('hair.darkPlumRibbons',{color:[.15,.11,.18],shade:[.065,.042,.08],outline:.00035,doubleSided:true}),
    ribbonLight:b.material('hair.ribbonFoldEdges',{color:[.28,.21,.31],shade:[.13,.09,.17],outline:0,doubleSided:true}),
  };
  const buckets=new Map(),bounds=new Box3();
  const counts={materials:Object.keys(materials).length,meshes:0,vertices:0,triangles:0,springChains:0,springJoints:0,longLocks:0,fringeLocks:0,highlights:0};
  function add(zone,kind,geometry,weights=HEAD_WEIGHT) {
    const key=`${zone}.${kind}`;
    if(!buckets.has(key))buckets.set(key,{geometries:[],material:materials[kind],weights});
    buckets.get(key).geometries.push(geometry);
  }
  function highlight(zone,points,width,weights=HEAD_WEIGHT) {
    add(zone,'highlight',glint(points,width),weights);counts.highlights++;
  }
  add('head','silver',scalp());
  // Broad layered sweep follows the reference parting; avoid raised crown ridges.
  const fringe=[
    {p:[[.010,1.612,.006],[-.014,1.588,.068],[-.045,1.535,.102],[-.031,1.477,.101]],w:.036,d:.0045},
    {p:[[-.002,1.607,.014],[-.050,1.576,.060],[-.075,1.518,.091],[-.083,1.455,.067]],w:.027,d:.004},
    {p:[[.019,1.612,.006],[.043,1.575,.071],[.038,1.519,.111],[.021,1.475,.106]],w:.032,d:.0045},
    {p:[[.032,1.605,.009],[.074,1.560,.061],[.082,1.506,.086],[.090,1.449,.060]],w:.025,d:.004},
    {p:[[.016,1.598,.032],[.007,1.550,.107],[-.006,1.499,.115],[-.009,1.470,.106]],w:.013,d:.003},
  ];
  for(let index=0;index<fringe.length;index++) {
    const{p,w,d}=fringe[index];add('head',index%3===1?'silver':'light',lock(p,w,d,{segments:24}));
    highlight('head',p.map(([x,y,z])=>[x+.002,y,z+d*.9]),.00065);counts.fringeLocks++;
  }
  for(const sign of [-1,1]) {
    const side=sign<0?'rightTail':'leftTail';
    const chain=extendTail([[sign*.113,1.548,-.073],[sign*.155,1.424,-.091],[sign*.177,1.300,-.135],
      [sign*.161,1.174,-.113],[sign*.197,1.044,-.129],[sign*.204,.925,-.116]]);
    const names=b.spring(`hair.${side}`,chain,{parent:'head',stiffness:1.05,drag:.68,gravity:.025,radius:.012});
    if(!Array.isArray(names)||names.length!==chain.length)throw new Error('buildHair expects one spring bone name per point');
    const weights=chainWeights(names,chain);counts.springChains++;counts.springJoints+=names.length;
    const variants=[
      {shift:-.010,z:-.017,width:.029,depth:.008,end:.931,phase:.1,kind:'shadow'},
      {shift:-.027,z:.004,width:.018,depth:.006,end:.967,phase:.4,kind:'silver'},
      {shift:-.011,z:.015,width:.020,depth:.007,end:.913,phase:.9,kind:'light'},
      {shift:.010,z:.007,width:.022,depth:.0065,end:.944,phase:1.4,kind:'silver'},
      {shift:.028,z:-.010,width:.018,depth:.006,end:.991,phase:1.9,kind:'light'},
      {shift:.039,z:-.028,width:.012,depth:.004,end:.959,phase:2.4,kind:'silver'},
      {shift:-.036,z:-.014,width:.009,depth:.0035,end:1.022,phase:2.9,kind:'light'},
    ];
    for(let index=0;index<variants.length;index++) {
      const v=variants[index],asymmetry=sign<0?.008:0;
      const points=extendTail([[sign*(.114+v.shift*.24),1.550-index*.001,-.072+v.z*.3],
        [sign*(.144+v.shift*.8),1.465,-.088+v.z],
        [sign*(.170+v.shift+Math.sin(v.phase)*.006),1.357,-.125+v.z],
        [sign*(.158+v.shift-Math.cos(v.phase)*.016),1.231,-.109+v.z],
        [sign*(.205+v.shift+Math.sin(v.phase)*.018),1.114,-.143+v.z],
        [sign*(.218+v.shift),v.end+.067+asymmetry,-.120+v.z],
        [sign*(.186+v.shift-Math.cos(v.phase)*.018),v.end+asymmetry,-.088+v.z]]);
      add(side,v.kind,lock(points,v.width,v.depth,{segments:42}),weights);counts.longLocks++;
      if(index>0)highlight(side,points.map(([x,y,z],i)=>[x+sign*.002,y,z+v.depth*profile(i/(points.length-1))+.0011]),index%2?.0014:.0020,weights);
    }
    const temple=[[sign*.077,1.546,.035],[sign*.099,1.477,.044],[sign*.101,1.397,.046],
      [sign*.091,1.335,.063],[sign*.107,1.314,.043]];
    add('head','light',lock(temple,.011,.004,{segments:26}));
    highlight('head',temple.map(([x,y,z])=>[x,y,z+.004]),.0012);counts.fringeLocks++;
    const ring=new TorusGeometry(.020,.0045,8,24);ring.rotateX(Math.PI/2);ring.translate(sign*.114,1.543,-.073);add('head','ribbon',ring);
    const knot=[sign*.120,1.545,.023],knotGeometry=new SphereGeometry(1,12,8);
    knotGeometry.scale(.007,.009,.004);knotGeometry.translate(...knot);add('head','ribbon',knotGeometry);
    // Folded cloth wings, not wire loops. The rear tie stays behind the tress.
    for (const wing of [1,-1]) {
      const end=[sign*.143,1.545+(wing>0?.044:-.020),.007];
      add('head','ribbon',clothWing(knot,end,.014));
      add('head','ribbonLight',clothWing(
        [knot[0],knot[1],knot[2]+.0005],
        [end[0],end[1],end[2]+.0005],.0012));
    }
    for(let ribbon=0;ribbon<2;ribbon++) {
      const points=[knot,[sign*(.128+ribbon*.008),1.500,.010-ribbon*.016],
        [sign*(.134+ribbon*.011),1.462,.024-ribbon*.019],[sign*(.127+ribbon*.024),1.424+ribbon*.014,.008-ribbon*.019]];
      add('head','ribbon',lock(points,.011-ribbon*.001,.0018,{segments:18,root:.75}));
      add('head','ribbonLight',glint(points.map(([x,y,z])=>[x,y,z+.002]),.0008,{segments:18}));
    }
  }
  for(const[name,bucket]of buckets) {
    const geometry=mergeGeometries(bucket.geometries,false);
    if(!geometry)throw new Error(`Cannot merge hair geometry: ${name}`);
    geometry.computeBoundingBox();bounds.union(geometry.boundingBox);
    counts.vertices+=geometry.getAttribute('position').count;counts.triangles+=geometry.index.count/3;counts.meshes++;
    b.mesh(`hair.${name}`,geometry,bucket.material,bucket.weights);
    for(const part of bucket.geometries)part.dispose();
  }
  return{...counts,bounds:{min:bounds.min.toArray(),max:bounds.max.toArray()}};
}
