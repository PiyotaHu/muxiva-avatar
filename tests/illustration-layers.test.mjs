import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {IllustrationRenderer,illustrationChromaMatte} from '../web/illustration.mjs';
import {IllustrationMotion} from '../web/illustration-motion.mjs';
import {AvatarTimeline} from '../web/avatar-timeline.mjs';

const atlas='/assets/avatar/test-atlas.png';
const fixture=()=>({
  schemaVersion:1,kind:'illustration',name:'layer fixture',size:[64,128],
  images:{neutral:'/assets/avatar/neutral.png',blink:'/assets/avatar/blink.png',speaking:'/assets/avatar/speaking.png'},
  rig:{head:{center:[.5,.18],radius:[.16,.12],pivot:[.5,.28]},
    leftHand:{center:[.25,.52],radius:[.06,.10],pivot:[.27,.46]},
    rightHand:{center:[.75,.52],radius:[.06,.10],pivot:[.73,.46]},
    bodyPivot:[.5,.52],hair:{center:[.5,.30],radius:[.32,.26]},skirt:{center:[.5,.64],radius:[.23,.12]},
    eyes:[{center:[.45,.17],radius:[.036,.024]},{center:[.55,.17],radius:[.036,.024]}],
    mouth:{center:[.5,.227],radius:[.035,.025]}},
  layers:[
    {name:'body',motion:'body',bounds:[.30,.28,.40,.32],pivot:[.5,.52],z:0},
    {name:'head',motion:'head',bounds:[.34,.06,.32,.25],pivot:[.5,.28],parent:'body',face:'original',z:4},
    {name:'leftArm',motion:'leftArm',bounds:[.12,.28,.20,.36],pivot:[.27,.31],parent:'body',elbow:[.21,.44],wrist:[.19,.57],z:3},
    {name:'rightArm',motion:'rightArm',bounds:[.68,.28,.20,.36],pivot:[.73,.31],parent:'body',elbow:[.79,.44],wrist:[.81,.57],z:3},
    {name:'leftHair',motion:'leftHair',bounds:[.18,.10,.18,.50],pivot:[.30,.14],parent:'head',z:-3},
    {name:'rightHair',motion:'rightHair',bounds:[.64,.10,.18,.50],pivot:[.70,.14],parent:'head',z:-3},
    {name:'skirt',motion:'skirt',bounds:[.27,.52,.46,.23],pivot:[.5,.52],parent:'body',z:2},
    {name:'legs',motion:'legs',bounds:[.30,.70,.40,.29],pivot:[.5,.72],z:-2},
  ].map(layer=>({...layer,image:atlas,sourceRect:[0,0,1,1],chromaKey:[0,1,0],chromaTolerance:.18})),
});
const zero=()=>Object.fromEntries(['headYaw','headTilt','nod','bodyLean','breath','leftHand','rightHand','hair','skirt',
  'mouthOpen','gazeX','gazeY','shoulder','hipShift','headPitch','smile'].map(key=>[key,0]));
function texture(width=64,height=128,mode='key') {
  const data=new Uint8Array(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
    const centre=x>=width/4&&x<width*3/4&&y>=height/4&&y<height*3/4;
    data.set(centre||mode==='opaque'?[255,255,255,255]:mode==='alpha'?[0,0,0,0]:[0,255,0,255],(y*width+x)*4);
  }
  const value=new THREE.DataTexture(data,width,height);let disposed=0;
  value.addEventListener('dispose',()=>disposed++);
  return {value,get disposed(){return disposed;}};
}
function harness() {
  const renderer=Object.create(IllustrationRenderer.prototype);
  Object.assign(renderer,{disposed:false,loadGeneration:0,pendingLoad:null,asset:null,meta:null,
    scene:new THREE.Scene(),camera:new THREE.OrthographicCamera(-.5,.5,.5,-.5,.01,10),viewportAspect:.5,
    options:{framing:'full',framePadding:1.06,mouthScale:.8,motion:{}},
    timeline:new AvatarTimeline(),motion:new IllustrationMotion(),elapsed:0,nextBlink:2.8,mouth:0,
    attention:{x:0,y:0,active:false},activity:'idle',interactionId:0,pendingInteraction:null,
    stats:{frames:0,seconds:0,fps:0,peakMouthOpen:0,acceptedAnimationEvents:0},
    resizeObserver:{disconnect(){}},renderer:{capabilities:{maxTextureSize:4096},render(){},dispose(){},setSize(){}},
  });
  return renderer;
}
function install(renderer,config=fixture()) {
  const textures=Object.fromEntries(Object.keys(config.images).map(key=>[key,texture().value]));
  const byUrl=new Map(Object.entries(config.images).map(([key,url])=>[url,textures[key]]));
  for(const layer of config.layers)if(!byUrl.has(layer.image))byUrl.set(layer.image,texture(32,32).value);
  renderer.asset=renderer._createIllustration(config,textures,byUrl);renderer.scene.add(renderer.asset.mesh);
  renderer._frameIllustration();return renderer.asset;
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function mockLoad(t,config=fixture(),getTexture=url=>texture(url.endsWith('test-atlas.png')?32:64,url.endsWith('test-atlas.png')?32:128)) {
  const requests=[],created=[];
  t.mock.method(globalThis,'fetch',async()=>({ok:true,json:async()=>config}));
  t.mock.method(THREE.TextureLoader.prototype,'loadAsync',async url=>{
    requests.push(url);const entry=await getTexture(url);created.push(entry);return entry.value;
  });
  return {requests,created};
}

test('eight independent meshes preserve destination bounds and global pivots in any manifest order',()=>{
  const renderer=harness(),config=fixture();config.layers.reverse();const asset=install(renderer,config);
  assert.equal(asset.mesh.isGroup,true);assert.equal(asset.layers.size,8);
  let count=0;asset.mesh.traverse(node=>{if(node.isMesh)count++;});assert.equal(count,8,'no hidden full-image backplate');
  asset.mesh.updateMatrixWorld(true);
  for(const {definition,anchor,mesh} of asset.layers.values()) {
    assert.equal(anchor.parent,definition.parent?asset.layers.get(definition.parent).anchor:asset.mesh);
    const pivot=anchor.getWorldPosition(new THREE.Vector3());
    assert.ok(pivot.distanceTo(new THREE.Vector3((definition.pivot[0]-.5)*asset.aspect,.5-definition.pivot[1],0))<1e-7);
    const centre=mesh.getWorldPosition(new THREE.Vector3()),[x,y,w,h]=definition.bounds;
    assert.ok(centre.distanceTo(new THREE.Vector3((x+w/2-.5)*asset.aspect,.5-y-h/2,0))<1e-7);
    assert.equal(mesh.renderOrder,definition.z,'draw order does not accumulate through parents');
  }
  renderer.dispose();
});

test('atlas crop and independent original-face mapping are explicit uniforms',()=>{
  const renderer=harness(),config=fixture(),head=config.layers.find(layer=>layer.name==='head');
  head.sourceRect=[.1,.2,.4,.6];head.faceSourceRect=[.35,.05,.30,.28];
  config.images.eyeWhite='/assets/avatar/eye-white.png';
  config.rig.iris=[{center:[.45,.17],radius:[.009,.008]},{center:[.55,.17],radius:[.009,.008]}];
  config.rig.face={center:[.5,.19],radius:[.10,.09]};
  const asset=install(renderer,config),layer=asset.layers.get('head'),u=layer.uniforms;
  assert.deepEqual(u.uSourceRect.value.toArray(),head.sourceRect);
  assert.deepEqual(u.uFaceSourceRect.value.toArray(),head.faceSourceRect);
  assert.equal(u.uHasIris.value,1);assert.equal(u.uEyeWhite.value,asset.textures.eyeWhite);
  assert.equal(u.uHasFace.value,1);assert.deepEqual(u.uFaceRegion.value.toArray(),[.5,.19,.10,.09]);
  assert.equal(u.uFaceEnabled.value,1);
  assert.equal(asset.layers.get('body').uniforms.uFaceEnabled.value,0);
  assert.equal(u.uMouthOpen,asset.uniforms.uMouthOpen,'all layers observe exactly one playback mouth value');
  assert.match(layer.mesh.material.vertexShader,/uSourceRect\.xy\+topLeft\*uSourceRect\.zw/);
  assert.doesNotMatch(layer.mesh.material.vertexShader,/uHeadYaw|uHairSway|warped/,'not an enlarged whole-image warp');
  assert.match(layer.mesh.material.fragmentShader,/openEye=texture2D\(uEyeWhite,vFaceUv\)/);
  assert.match(layer.mesh.material.fragmentShader,/region\(p-leftDelta,uLeftIris\)/);
  assert.match(layer.mesh.material.fragmentShader,/mix\(openEye,texture2D\(uBlink,vFaceUv\)/,'eyelids are never translated');
  assert.match(layer.mesh.material.fragmentShader,/region\(p,uFaceRegion\)\*uHasFace\*uFaceEnabled/,'one neutral face is composited before individual features');
  renderer.dispose();
});

test('dominant-key matte removes partially mixed green borders without removing white, silver or skin',()=>{
  const key=[0,1,0],edge=illustrationChromaMatte([.3,.7,.3],key);
  assert.ok(Math.abs(edge.alpha-.6)<1e-12,'mixed green is never fully opaque');
  assert.ok(edge.rgb.every(value=>Math.abs(value-.3)<1e-12),'no remaining green channel excess');
  assert.equal(illustrationChromaMatte(key,key).alpha,0);
  assert.equal(illustrationChromaMatte([.02,.93,.02],key).alpha,0);
  for(const rgb of [[1,1,1],[.6,.6,.6],[.82,.65,.55],[.15,.13,.17]]) {
    const result=illustrationChromaMatte(rgb,key);
    assert.equal(result.alpha,1);assert.deepEqual(result.rgb,rgb,'non-key foreground preserved');
  }
  const renderer=harness(),material=install(renderer).layers.get('head').mesh.material;
  assert.match(material.fragmentShader,/1\.0-excess\/keyExcess/);
  assert.match(material.fragmentShader,/srgb-dominant\*excess/);
  renderer.dispose();
});

test('optional neck blend fades only the head centre into the torso and preserves lateral hair',()=>{
  const renderer=harness(),config=fixture();
  config.rig.neck={center:[.48,.275],radius:[.052,.021]};
  const asset=install(renderer,config),head=asset.layers.get('head'),u=head.uniforms;
  assert.deepEqual(u.uNeckRegion.value.toArray(),[.48,.275,.052,.021]);
  assert.equal(u.uHasNeck.value,1);assert.equal(u.uFaceEnabled.value,1);
  // Reference the shader's top-left UV formula at its exact fade boundaries.
  const smooth=(a,b,v)=>{const t=Math.max(0,Math.min(1,(v-a)/(b-a)));return t*t*(3-2*t);};
  const opacity=(layer,x,y)=>{
    const values=layer.uniforms,[cx,cy,rx,ry]=values.uNeckRegion.value.toArray();
    const down=smooth(cy-ry,cy+ry,y),centre=1-smooth(.6,1,Math.abs(x-cx)/Math.max(rx,.0001));
    return 1-values.uHasNeck.value*values.uFaceEnabled.value*down*centre;
  };
  const [cx,cy]=config.rig.neck.center,[rx,ry]=config.rig.neck.radius;
  assert.equal(opacity(head,cx,cy-ry),1,'face above the neck stays intact');
  assert.ok(Math.abs(opacity(head,cx,cy)-.5)<1e-12,'middle is a soft transition');
  assert.equal(opacity(head,cx,cy+ry),0,'neck tail reveals the complete torso');
  for(const x of [cx-rx,cx+rx,0,1])assert.equal(opacity(head,x,cy+ry),1,'side strands are unaffected');
  for(const layer of asset.layers.values()) {
    if(layer!==head)assert.equal(opacity(layer,cx,cy+ry),1,'other independent layers keep their alpha');
  }
  for(let x=0;x<=1;x+=.05)for(let y=0;y<=1;y+=.05) {
    const value=opacity(head,x,y);assert.ok(Number.isFinite(value)&&value>=0&&value<=1);
  }
  const shader=head.mesh.material.fragmentShader;
  assert.match(shader,/smoothstep\(uNeckRegion\.y-uNeckRegion\.w,uNeckRegion\.y\+uNeckRegion\.w,p\.y\)/);
  assert.match(shader,/abs\(p\.x-uNeckRegion\.x\)\/max\(uNeckRegion\.z,\.0001\)/);
  assert.match(shader,/base\.a\*=1\.0-uHasNeck\*uFaceEnabled\*neckDown\*neckCentre/);
  assert.ok(shader.indexOf('base.a*=1.0-uHasNeck')<shader.indexOf('if(base.a<=.002) discard'));
  renderer.dispose();
  const legacy=harness(),without=install(legacy);
  assert.equal(without.layers.get('head').uniforms.uHasNeck.value,0,'omitted optional region preserves existing portraits');
  assert.equal(opacity(without.layers.get('head'),cx,cy+ry),1);legacy.dispose();
});

test('matte inspection requires genuine alpha or an explicit present colour key in each crop',()=>{
  const renderer=harness(),keyLayer=fixture().layers[0];
  assert.doesNotThrow(()=>renderer._validateLayerMatte(texture(32,32).value,[keyLayer]));
  const noKey={...keyLayer};delete noKey.chromaKey;delete noKey.chromaTolerance;
  assert.doesNotThrow(()=>renderer._validateLayerMatte(texture(32,32,'alpha').value,[noKey]));
  assert.throws(()=>renderer._validateLayerMatte(texture(32,32,'opaque').value,[noKey]),/real alpha/);
  assert.throws(()=>renderer._validateLayerMatte(texture(32,32).value,[{...keyLayer,chromaKey:[0,0,1]}]),/explicit chroma/);
  assert.throws(()=>renderer._validateLayerMatte(texture(32,32).value,[{...keyLayer,sourceRect:[.3,.3,.2,.2]}]),/explicit chroma/);
  const rgba=texture(32,32),before=rgba.value.image.data.slice();
  renderer._validateLayerMatte(rgba.value,[keyLayer]);assert.deepEqual(rgba.value.image.data,before,'inspection does not modify pixels');
  const material=install(renderer).layers.get('body').mesh.material;
  assert.deepEqual(material.uniforms.uChromaKey.value.toArray(),[0,1,0]);
  assert.match(material.fragmentShader,/keySrgb\(base\.rgb\)/);
  assert.match(material.fragmentShader,/base\.a\*=matte/);
  assert.match(material.fragmentShader,/dominant\*/,'despill only the explicitly keyed edge colour');
  renderer.dispose();
});

test('atlas loads once at its own size, and replacing layered content disposes every shared resource once',async t=>{
  const mocked=mockLoad(t),renderer=harness();
  await renderer.load('/assets/avatar/layers.json');
  assert.equal(mocked.requests.length,4,'three original states plus one atlas');
  assert.equal(mocked.requests.filter(url=>url.endsWith('test-atlas.png')).length,1);
  assert.equal(renderer.asset.layers.size,8);
  const resources=[...renderer.asset.geometries,...renderer.asset.materials],counts=resources.map(()=>0);
  resources.forEach((resource,index)=>resource.addEventListener('dispose',()=>counts[index]++));
  await renderer.load('/assets/avatar/replacement.json');
  assert.ok(counts.every(count=>count===1));assert.ok(mocked.created.slice(0,4).every(entry=>entry.disposed===1));
  assert.ok(mocked.created.slice(4).every(entry=>entry.disposed===0));
  renderer.dispose();renderer.dispose();assert.ok(mocked.created.every(entry=>entry.disposed===1));
});

test('an opaque or incorrectly keyed atlas fails without replacing the existing asset',async t=>{
  const mocked=mockLoad(t,fixture(),url=>texture(url.endsWith('test-atlas.png')?32:64,url.endsWith('test-atlas.png')?32:128,'opaque'));
  const renderer=harness(),old=install(renderer);
  await assert.rejects(renderer.load('/assets/avatar/bad-layers.json'),/explicit chroma/);
  assert.equal(renderer.asset,old);assert.ok(mocked.created.every(entry=>entry.disposed===1));
  renderer.dispose();
});

test('a shared atlas resolving after disposal is released once and never installs a partial character',async t=>{
  let finishAtlas;
  const pending=new Promise(resolve=>{finishAtlas=resolve;});
  const mocked=mockLoad(t,fixture(),url=>url.endsWith('test-atlas.png')?pending:texture());
  const renderer=harness(),loading=renderer.load('/assets/avatar/late-atlas.json');
  await settle();renderer.dispose();assert.equal(await loading,null);
  const late=texture(32,32);finishAtlas(late);await settle();
  assert.equal(late.disposed,1);assert.ok(mocked.created.every(entry=>entry.disposed===1));
  assert.equal(renderer.asset,null);assert.equal(renderer.scene.children.length,0);
});

test('independent arm elbow and wrist deformation leaves shoulder vertices anchored and the other arm at rest',()=>{
  const renderer=harness(),asset=install(renderer),left=asset.layers.get('leftArm'),right=asset.layers.get('rightArm');
  const pose={...zero(),leftHand:.8};renderer._applyLayerPose(pose);
  assert.ok(Math.abs(left.anchor.rotation.z)>.2);assert.equal(right.anchor.rotation.z,0);
  assert.notDeepEqual(left.uniforms.uElbowMatrix.value.elements,new THREE.Matrix4().elements);
  assert.notDeepEqual(left.uniforms.uWristMatrix.value.elements,new THREE.Matrix4().elements);
  assert.deepEqual(right.uniforms.uElbowMatrix.value.elements,new THREE.Matrix4().elements);
  const position=left.mesh.geometry.attributes.position,weights=left.mesh.geometry.attributes.armWeights;
  let fixed=0,bent=0,wrist=0;
  for(let i=0;i<position.count;i++) {
    const point=new THREE.Vector3().fromBufferAttribute(position,i);
    const lower=point.clone().lerp(point.clone().applyMatrix4(left.uniforms.uElbowMatrix.value),weights.getX(i));
    const transformed=lower.clone().lerp(lower.clone().applyMatrix4(left.uniforms.uWristMatrix.value),weights.getY(i));
    assert.ok(transformed.toArray().every(Number.isFinite));
    assert.ok(weights.getX(i)>=0&&weights.getX(i)<=1&&weights.getY(i)>=0&&weights.getY(i)<=1);
    if(weights.getX(i)===0&&weights.getY(i)===0){assert.ok(transformed.distanceTo(point)<1e-9);fixed++;}
    if(weights.getX(i)>.8&&transformed.distanceTo(point)>.01)bent++;
    if(weights.getY(i)>.8)wrist++;
  }
  assert.ok(fixed>20&&bent>20&&wrist>5);
  for(let i=0;i<1000;i++)renderer._applyLayerPose(pose);
  assert.ok(Math.abs(left.anchor.rotation.z+.256)<1e-12,'no accumulated rotation');
  renderer._applyLayerPose(zero());
  assert.ok(Math.abs(left.anchor.rotation.z)<1e-12);assert.deepEqual(left.uniforms.uElbowMatrix.value.elements,new THREE.Matrix4().elements);
  renderer.dispose();
});

test('parent transforms move descendants while independent body regions retain their own motion',()=>{
  const renderer=harness(),asset=install(renderer),head=asset.layers.get('head'),hair=asset.layers.get('leftHair');
  asset.mesh.updateMatrixWorld(true);const initial=hair.anchor.getWorldPosition(new THREE.Vector3());
  renderer._applyLayerPose({...zero(),headTilt:.8,headPitch:.4,headYaw:.6});asset.mesh.updateMatrixWorld(true);
  assert.ok(hair.anchor.getWorldPosition(new THREE.Vector3()).distanceTo(initial)>.001);
  assert.equal(hair.anchor.rotation.z,0,'hair follows parent without duplicating head rotation locally');
  assert.ok(Math.abs(head.anchor.rotation.z)>.05);
  assert.equal(asset.layers.get('skirt').anchor.rotation.z,0);
  renderer._applyLayerPose({...zero(),hair:.5,skirt:-.5});
  assert.notEqual(hair.anchor.rotation.z,0);assert.notEqual(asset.layers.get('skirt').anchor.rotation.z,0);
  assert.ok(Math.abs(head.anchor.rotation.z)<1e-12);renderer.dispose();
});

test('both wrist terminals travel outward and upward from the first small greeting pose',()=>{
  const production=JSON.parse(readFileSync(new URL('../assets/avatar/illustration-v2.json',import.meta.url),'utf8'));
  for(const config of [fixture(),production]) {
    const renderer=harness(),asset=install(renderer,config);
    for(const [name,channel,side] of [['leftArm','leftHand',-1],['rightArm','rightHand',1]]) {
    const layer=asset.layers.get(name);
    renderer._applyLayerPose(zero());asset.mesh.updateMatrixWorld(true);
    const baseline=layer.arm.wrist.clone().applyMatrix4(layer.mesh.matrixWorld);
    let previous=baseline.clone();
    for(const strength of [.15,.45,.8]) {
      renderer._applyLayerPose({...zero(),[channel]:strength});asset.mesh.updateMatrixWorld(true);
      // At the wrist the forearm and wrist weights are both 1, exactly as in
      // the material's two-stage deformation, followed by the shoulder parent.
      const terminal=layer.arm.wrist.clone().applyMatrix4(layer.uniforms.uElbowMatrix.value)
        .applyMatrix4(layer.uniforms.uWristMatrix.value).applyMatrix4(layer.mesh.matrixWorld);
      assert.ok((terminal.x-baseline.x)*side>.005,name+' moves away from the skirt at '+strength);
      assert.ok(terminal.y>baseline.y+.002,name+' lifts instead of folding inward at '+strength);
      assert.ok((terminal.x-previous.x)*side>0&&terminal.y>previous.y,'outward/upward through the attack');
      previous=terminal;
    }
    }
    renderer.dispose();
  }
});

test('viewport pointer coordinates map through camera and the current head transform in full and portrait views',()=>{
  const renderer=harness(),asset=install(renderer),head=asset.layers.get('head'),rig=asset.config.rig.head;
  renderer._applyLayerPose({...zero(),headTilt:.6,hipShift:.4});
  for(const framing of ['full','portrait'])for(const viewport of [.3,.6,1.5]) {
    renderer.viewportAspect=viewport;renderer.setView({framing});renderer.camera.updateMatrixWorld(true);asset.mesh.updateMatrixWorld(true);
    const centre=new THREE.Vector3((rig.center[0]-head.definition.pivot[0])*asset.aspect,head.definition.pivot[1]-rig.center[1],0);
    head.anchor.localToWorld(centre);centre.project(renderer.camera);
    assert.equal(renderer.setPointer({x:(centre.x+1)/2,y:(1-centre.y)/2,active:true}),true);
    assert.ok(Math.abs(renderer.attention.x)<1e-6&&Math.abs(renderer.attention.y)<1e-6);
  }
  assert.equal(renderer.setPointer({active:false}),true);assert.equal(renderer.attention.active,false);
  assert.equal(renderer.setPointer({x:NaN,y:.5,active:true}),false);
  assert.equal(renderer.setPointer({x:1.1,y:.5,active:true}),false);renderer.dispose();
});

test('attention, interaction and activity are presentation inputs, never replacement playback signals',()=>{
  const renderer=harness(),asset=install(renderer),inputs=[];
  renderer.motion.update=input=>{inputs.push(input);return {...zero(),leftHand:.7,smile:.8,mouthOpen:.9};};
  const attention={x:.4,y:-.2,active:true};assert.equal(renderer.setAttention(attention),true);attention.x=1;
  assert.equal(renderer.setActivity('listening'),true);assert.equal(renderer.setActivity('speaking'),false);
  assert.equal(renderer.interact('greet'),true);renderer.update({playing:false});
  assert.equal(inputs[0].attention.x,.4);assert.equal(inputs[0].activity,'listening');
  assert.equal(inputs[0].interaction.type,'greet');assert.equal(asset.uniforms.uMouthOpen.value,0);
  assert.notEqual(asset.layers.get('leftArm').anchor.rotation.z,0,'greeting can move a hand while silent');
  renderer.update({playing:false});assert.equal(inputs[1].interaction,null,'interaction emitted once, not every render');
  assert.equal(renderer.interact('acknowledge'),true);renderer.update({});
  assert.ok(inputs[2].interaction.id>inputs[0].interaction.id);
  assert.equal(renderer.interact('wave'),false);
  renderer.interact('greet');renderer.reset();assert.equal(renderer.pendingInteraction,null);
  assert.equal(renderer.setReducedMotion(true),true);assert.equal(renderer.options.motion.reducedMotion,true);
  assert.equal(renderer.motion.options.reducedMotion,true);assert.equal(renderer.setReducedMotion('yes'),false);
  renderer.dispose();assert.equal(renderer.interact('greet'),false);assert.equal(renderer.setActivity('idle'),false);
});
