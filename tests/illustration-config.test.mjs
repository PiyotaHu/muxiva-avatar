import assert from 'node:assert/strict';
import test from 'node:test';
import {validateIllustrationConfig} from '../web/illustration-config.mjs';

const fixture=()=>({
  schemaVersion:1,kind:'illustration',name:'Local front-facing illustration',
  images:{neutral:'/assets/avatar/front-neutral.png',blink:'/assets/avatar/front-blink.png',
    speaking:'/assets/avatar/front-speaking.png'},
  size:[1024,1536],
  rig:{
    head:{center:[.5,.2],radius:[.2,.18],pivot:[.5,.34]},
    leftHand:{center:[.23,.55],radius:[.08,.11],pivot:[.29,.46]},
    rightHand:{center:[.77,.55],radius:[.08,.11],pivot:[.71,.46]},
    bodyPivot:[.5,.73],hair:{center:[.5,.37],radius:[.35,.33]},
    skirt:{center:[.5,.67],radius:[.24,.16]},
    eyes:[{center:[.435,.185],radius:[.035,.016]},{center:[.565,.185],radius:[.035,.016]}],
    mouth:{center:[.5,.255],radius:[.025,.012]},
  },
});
const at=(value,path)=>path.reduce((current,key)=>current[key],value);
const freeze=value=>{
  if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}
  return value;
};
const regions=[['head'],['leftHand'],['rightHand'],['hair'],['skirt'],['eyes',0],['eyes',1],['mouth']];

test('illustration validation preserves normalized top-left rig data without mutating input',()=>{
  const source=freeze(fixture()),result=validateIllustrationConfig(source);
  assert.deepEqual(result,source);
  for(const path of [[],['images'],['size'],['rig'],['rig','eyes'],['rig','bodyPivot'],
    ...regions.flatMap(path=>[['rig',...path],['rig',...path,'center'],['rig',...path,'radius']]),
    ...['head','leftHand','rightHand'].map(key=>['rig',key,'pivot'])]) {
    assert.notEqual(at(result,path),at(source,path),'independent data at '+path.join('.'));
  }
  result.images.neutral='/assets/avatar/replaced.png';
  result.size[0]=2048;result.rig.head.center[0]=.4;result.rig.eyes[1].radius[0]=.01;
  assert.equal(source.images.neutral,'/assets/avatar/front-neutral.png');
  assert.equal(source.size[0],1024);assert.equal(source.rig.head.center[0],.5);
  assert.equal(source.rig.eyes[1].radius[0],.035);
  const other=fixture();other.name='  Generic figure  ';
  assert.equal(validateIllustrationConfig(other).name,'Generic figure');
});

test('all three images require explicit safe local PNG basenames',()=>{
  const invalid=['https://example.test/image.png','//example.test/image.png','file:///D:/image.png',
    'data:image/png;base64,AA==','blob:http://localhost/id','/other/image.png','/assets/avatar/image.jpg',
    '/assets/avatar/folder/image.png','/assets/avatar/../image.png','/assets/avatar/./image.png',
    '/assets/avatar/a/../../image.png','/assets/avatar/a\\image.png','/assets/avatar//image.png',
    '/assets/avatar/%69mage.png','/assets/avatar/%2e%2e%2fimage.png','/assets/avatar/%252e%252e/image.png',
    '/assets/avatar/image.png?token=dummy','/assets/avatar/image.png#fragment','/assets/avatar/image.png/other',
    '/assets/avatar/image.png.svg','/assets/avatar/image..png','/assets/avatar/image%00.png',
    '/assets/avatar/image\0.png',' /assets/avatar/image.png','/assets/avatar/image.png\n','/assets/avatar/image.png ',
    '',null,23,undefined,'/assets/avatar/'+('x'.repeat(300))+'.png'];
  for(const field of ['neutral','blink','speaking'])for(const url of invalid) {
    const source=fixture();source.images[field]=url;
    assert.throws(()=>validateIllustrationConfig(source),/本地 PNG/,field+': '+String(url));
  }
  for(const url of ['/assets/avatar/art-v2.1_neutral.png','/assets/avatar/Front.PNG']) {
    const source=fixture();source.images.neutral=url;
    assert.equal(validateIllustrationConfig(source).images.neutral,url);
  }
  const missing=fixture();delete missing.images.blink;
  assert.throws(()=>validateIllustrationConfig(missing),/本地 PNG/);
});

test('canvas dimensions are bounded integer pixels, never coerced or inferred',()=>{
  for(const size of [[16,16],[4096,4096],[512,2048]]) {
    assert.deepEqual(validateIllustrationConfig({...fixture(),size}).size,size);
  }
  for(const size of [[0,1024],[15,1024],[1024,4097],[1024,NaN],[Infinity,1024],[-1,1024],
    [512.5,1024],['1024',1024],[1024],[1024,1024,4],new Array(2),null,{width:1024,height:1024}]) {
    assert.throws(()=>validateIllustrationConfig({...fixture(),size}),/size/);
  }
});

test('every rig region has finite nonzero extent entirely inside the canvas',()=>{
  for(const path of regions) {
    for(const radius of [[0,.01],[.01,0],[-.01,.01],[.51,.01],[.01,Infinity],[NaN,.01],
      ['.01',.01],[.01],new Array(2),[.49,.49]]) {
      const source=fixture();at(source.rig,path).radius=radius;
      assert.throws(()=>validateIllustrationConfig(source),/rig|区域/,path.join('.'));
    }
    for(const center of [[-.01,.5],[1.01,.5],[NaN,.5],[.5,Infinity],[0,0],[1,1],['.5',.2],null]) {
      const source=fixture();at(source.rig,path).center=center;
      assert.throws(()=>validateIllustrationConfig(source),/rig|区域/,path.join('.'));
    }
    const missing=fixture();delete at(missing.rig,path).radius;
    assert.throws(()=>validateIllustrationConfig(missing),/radius/);
  }
});

test('pivots use normalized canvas coordinates and eye/mouth regions stay inside the head',()=>{
  for(const path of [['bodyPivot'],['head','pivot'],['leftHand','pivot'],['rightHand','pivot']]) {
    for(const pivot of [[-.001,.5],[.5,1.001],[NaN,0],[0,Infinity],[],new Array(2),['0',.5]]) {
      const source=fixture(),parent=at(source.rig,path.slice(0,-1));parent[path.at(-1)]=pivot;
      assert.throws(()=>validateIllustrationConfig(source),/pivot/i);
    }
    for(const pivot of [[0,0],[1,1]]) {
      const source=fixture(),parent=at(source.rig,path.slice(0,-1));parent[path.at(-1)]=pivot;
      assert.deepEqual(at(validateIllustrationConfig(source).rig,path),pivot);
    }
  }
  for(const path of [['eyes',0],['eyes',1],['mouth']]) {
    const source=fixture();at(source.rig,path).center=[.85,.5];
    assert.throws(()=>validateIllustrationConfig(source),/head/);
  }
  for(const eyes of [[],[fixture().rig.eyes[0]],[...fixture().rig.eyes,fixture().rig.eyes[0]],new Array(2),null]) {
    const source=fixture();source.rig.eyes=eyes;assert.throws(()=>validateIllustrationConfig(source),/eyes/);
  }
});

test('unknown fields and unsupported schema/object shapes fail at every level',()=>{
  for(const path of [[],['images'],['rig'],...regions.map(path=>['rig',...path])]) {
    const source=fixture();at(source,path).unexpected=true;
    assert.throws(()=>validateIllustrationConfig(source),/未知/);
  }
  for(const source of [null,[],new Date(),{...fixture(),schemaVersion:2},{...fixture(),schemaVersion:'1'},
    {...fixture(),kind:'vrm'},{...fixture(),name:''},{...fixture(),name:' '.repeat(2)},
    {...fixture(),name:'x'.repeat(121)},Object.assign(Object.create({inherited:true}),fixture())]) {
    assert.throws(()=>validateIllustrationConfig(source));
  }
  for(const key of ['head','leftHand','rightHand','bodyPivot','hair','skirt','eyes','mouth']) {
    const source=fixture();delete source.rig[key];assert.throws(()=>validateIllustrationConfig(source),/rig/);
  }
  const injected=fixture();injected.rig.head=JSON.parse('{"center":[0.5,0.2],"radius":[0.2,0.18],"pivot":[0.5,0.34],"__proto__":{}}');
  assert.throws(()=>validateIllustrationConfig(injected),/未知/);
});
