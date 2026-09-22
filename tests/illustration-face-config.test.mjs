import assert from 'node:assert/strict';
import {readFile, stat} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import test from 'node:test';
import {validateIllustrationConfig} from '../web/illustration-config.mjs';

const fixture=()=>({
  schemaVersion:1,kind:'illustration',name:'Optional face regions',size:[1024,1536],
  images:{neutral:'/assets/avatar/neutral.png',blink:'/assets/avatar/blink.png',
    speaking:'/assets/avatar/speaking.png'},
  rig:{
    head:{center:[.5,.25],radius:[.25,.25],pivot:[.5,.375]},
    leftHand:{center:[.25,.625],radius:[.125,.125],pivot:[.25,.5]},
    rightHand:{center:[.75,.625],radius:[.125,.125],pivot:[.75,.5]},
    bodyPivot:[.5,.75],hair:{center:[.5,.375],radius:[.375,.375]},
    skirt:{center:[.5,.75],radius:[.25,.125]},
    eyes:[{center:[.375,.1875],radius:[.0625,.03125]},
      {center:[.625,.1875],radius:[.0625,.03125]}],
    mouth:{center:[.5,.3125],radius:[.03125,.015625]},
  },
});
const withIris=()=>{
  const value=fixture();
  value.images.eyeWhite='/assets/avatar/eye-white.png';
  value.rig.iris=value.rig.eyes.map(eye=>({center:[...eye.center],radius:[.015625,.015625]}));
  return value;
};

test('iris and eyeWhite are optional together, independently cloned when present',()=>{
  const legacy=validateIllustrationConfig(fixture());
  assert.equal(Object.hasOwn(legacy.rig,'iris'),false);
  assert.equal(Object.hasOwn(legacy.images,'eyeWhite'),false);
  const source=withIris(),result=validateIllustrationConfig(source);
  assert.deepEqual(result,source);
  assert.notEqual(result.rig.iris,source.rig.iris);
  for(let index=0;index<2;index++) {
    assert.notEqual(result.rig.iris[index],source.rig.iris[index]);
    assert.notEqual(result.rig.iris[index].center,source.rig.iris[index].center);
    assert.notEqual(result.rig.iris[index].radius,source.rig.iris[index].radius);
  }
  result.rig.iris[0].center[0]=.4;
  assert.equal(source.rig.iris[0].center[0],.375);
});

test('iris and eyeWhite reject either missing half and unsafe optional texture paths',()=>{
  const noTexture=withIris();delete noTexture.images.eyeWhite;
  assert.throws(()=>validateIllustrationConfig(noTexture),/iris.*eyeWhite/);
  const noIris=withIris();delete noIris.rig.iris;
  assert.throws(()=>validateIllustrationConfig(noIris),/eyeWhite.*iris/);
  for(const path of [null,'https://example.test/eye.png','/assets/avatar/../eye.png',
    '/assets/avatar/%65ye.png','/assets/avatar/eye.png?x=1','/assets/avatar/eye.jpg']) {
    const source=withIris();source.images.eyeWhite=path;
    assert.throws(()=>validateIllustrationConfig(source),/eyeWhite/,String(path));
  }
});

test('exactly two finite iris regions must be inside their corresponding eye, including extent',()=>{
  for(const iris of [[],[withIris().rig.iris[0]],new Array(2),null,
    [...withIris().rig.iris,withIris().rig.iris[0]]]) {
    const source=withIris();source.rig.iris=iris;
    assert.throws(()=>validateIllustrationConfig(source),/iris/);
  }
  const swapped=withIris();swapped.rig.iris.reverse();
  assert.throws(()=>validateIllustrationConfig(swapped),/iris/);
  for(const index of [0,1]) {
    for(const axis of [0,1]) {
      const source=withIris(),eye=source.rig.eyes[index];
      // Center remains inside this eye, but part of the iris escapes it.
      source.rig.iris[index].center[axis]=eye.center[axis]+eye.radius[axis]-.0078125;
      assert.throws(()=>validateIllustrationConfig(source),/iris/);
    }
    for(const radius of [[0,.015625],[NaN,.015625],[.015625,Infinity]]) {
      const source=withIris();source.rig.iris[index].radius=radius;
      assert.throws(()=>validateIllustrationConfig(source),/iris/);
    }
  }
  const exact=withIris();exact.rig.iris=structuredClone(exact.rig.eyes);
  assert.deepEqual(validateIllustrationConfig(exact).rig.iris,exact.rig.eyes);
});

test('optional face and neck can touch every head boundary and are independent cloned regions',()=>{
  for(const field of ['face','neck']) {
    assert.equal(Object.hasOwn(validateIllustrationConfig(fixture()).rig,field),false);
    const source=fixture();
    source.rig[field]={center:[...source.rig.head.center],radius:[...source.rig.head.radius]};
    const result=validateIllustrationConfig(source);
    assert.deepEqual(result.rig[field],source.rig[field]);
    assert.notEqual(result.rig[field],source.rig[field]);
    assert.notEqual(result.rig[field].center,source.rig[field].center);
    assert.notEqual(result.rig[field].radius,source.rig[field].radius);
    result.rig[field].center[0]=.6;
    assert.equal(source.rig[field].center[0],.5);
  }
});

test('face and neck reject extents beyond any head boundary even while still inside canvas',()=>{
  for(const field of ['face','neck'])for(const axis of [0,1])for(const direction of [-1,1]) {
    const source=fixture();
    source.rig.head={center:[.5,.5],radius:[.25,.25],pivot:[.5,.625]};
    source.rig.eyes.forEach(eye=>{eye.center[1]=.375;});
    source.rig[field]={center:[.5,.5],radius:[.03125,.03125]};
    source.rig[field].center[axis]=.5+direction*(.25-.015625);
    assert.throws(()=>validateIllustrationConfig(source),new RegExp('rig\\.'+field+'.*head'),
      `${field} axis ${axis} direction ${direction}`);
  }
});

test('face and neck reject zero, sparse, nonfinite, unknown and nonregion values',()=>{
  for(const field of ['face','neck'])for(const region of [null,[],
    {center:[.5,.25],radius:[0,.01]},
    {center:[.5,.25],radius:new Array(2)},
    {center:[NaN,.25],radius:[.01,.01]},
    {center:[.5,.25],radius:[.01,Infinity]},
    {center:[.5,.25],radius:[.01,.01],pivot:[.5,.25]}]) {
    const source=fixture();source.rig[field]=region;
    assert.throws(()=>validateIllustrationConfig(source),new RegExp('rig\\.'+field));
  }
});

test('production illustration-v2 validates with eight layers and complete local PNG resources',{skip:!existsSync(new URL('../assets/avatar/illustration-neutral-v1.png',import.meta.url))},async()=>{
  const root=new URL('../',import.meta.url);
  const manifestUrl=new URL('assets/avatar/illustration-v2.json',root);
  const source=JSON.parse(await readFile(manifestUrl,'utf8'));
  const config=validateIllustrationConfig(source);
  assert.deepEqual(config,source);
  assert.equal(config.layers.length,8);
  assert.equal(config.rig.iris.length,2);
  assert.ok(config.images.eyeWhite&&config.rig.face&&config.rig.neck);
  const character=JSON.parse(await readFile(new URL('assets/avatar/character-illustration-v2.json',root),'utf8'));
  assert.equal(character.asset,'/assets/avatar/illustration-v2.json');
  const faceImages=new Set(Object.values(config.images));
  const paths=new Set([...faceImages,...config.layers.map(layer=>layer.image)]);
  for(const path of paths) {
    const resource=new URL(path.slice(1),root);
    assert.ok((await stat(resource)).isFile(),path+' must be a local file');
    const bytes=await readFile(resource);
    assert.ok(bytes.length>=33,path+' must contain a PNG header');
    assert.deepEqual(bytes.subarray(0,8),Buffer.from([137,80,78,71,13,10,26,10]),path);
    assert.equal(bytes.toString('ascii',12,16),'IHDR',path);
    const size=[bytes.readUInt32BE(16),bytes.readUInt32BE(20)];
    assert.ok(size.every(value=>value>0),path+' must have positive dimensions');
    if(faceImages.has(path))assert.deepEqual(size,config.size,path+' must match face canvas');
    // An atlas has its own sourceRect UVs and need not share face-image dimensions.
  }
});
