import assert from 'node:assert/strict';
import test from 'node:test';
import {validateIllustrationConfig} from '../web/illustration-config.mjs';

const legacy=()=>({schemaVersion:1,kind:'illustration',name:'Local layered portrait',
  images:{neutral:'/assets/avatar/neutral.png',blink:'/assets/avatar/blink.png',speaking:'/assets/avatar/speaking.png'},
  size:[1024,1536],rig:{
    head:{center:[.5,.2],radius:[.2,.18],pivot:[.5,.34]},
    leftHand:{center:[.23,.55],radius:[.08,.11],pivot:[.29,.46]},
    rightHand:{center:[.77,.55],radius:[.08,.11],pivot:[.71,.46]},
    bodyPivot:[.5,.73],hair:{center:[.5,.37],radius:[.35,.33]},
    skirt:{center:[.5,.67],radius:[.24,.16]},
    eyes:[{center:[.435,.185],radius:[.035,.016]},{center:[.565,.185],radius:[.035,.016]}],
    mouth:{center:[.5,.255],radius:[.025,.012]}}});
const layer=(name='body',extra={})=>({name,image:'/assets/avatar/layer-body.png',
  bounds:[.1,.1,.8,.8],pivot:[.5,.5],z:0,motion:'body',...extra});
const fixture=()=>({...legacy(),layers:[layer()]});
const invalid=(change,pattern)=>{
  const source=fixture();change(source);
  assert.throws(()=>validateIllustrationConfig(source),pattern);
};
const freeze=value=>{
  if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}
  return value;
};
function independent(a,b,path='root') {
  if(a&&typeof a==='object') {
    assert.notEqual(a,b,'result must own '+path);
    for(const key of Object.keys(a)) independent(a[key],b[key],path+'.'+key);
  }
}

test('legacy v1 without layers keeps exactly its original schema and clone semantics',()=>{
  const source=freeze(legacy()),result=validateIllustrationConfig(source);
  assert.deepEqual(result,source);
  assert.equal(Object.hasOwn(result,'layers'),false);
  independent(source,result);
  const explicitUndefined={...legacy(),layers:undefined};
  assert.deepEqual(validateIllustrationConfig(explicitUndefined),legacy());
});

test('layers permits 1 through 16 entries, but rejects empty, excessive, sparse or non-array input',()=>{
  for(const count of [1,2,16]) {
    const source={...legacy(),layers:Array.from({length:count},(_,i)=>layer('layer'+i))};
    assert.equal(validateIllustrationConfig(source).layers.length,count);
  }
  const holey=[layer('first'),layer('second')];delete holey[1];
  for(const value of [[],new Array(1),new Array(16),holey,null,{},'layers',
    Array.from({length:17},(_,i)=>layer('layer'+i))]) {
    invalid(source=>{source.layers=value;},/layers/);
  }
});

test('each layer needs safe unique names and rejects unknown fields and inherited records',()=>{
  for(const name of ['',null,1,'body/name','../body','body.name','body name','body\n',
    '1body','_body','constructor','prototype','__proto__','x'.repeat(41),'中文']) {
    invalid(source=>{source.layers[0].name=name;},/name/);
  }
  for(const name of ['body','Head_1','arm-left','x'.repeat(40)]) {
    const source=fixture();source.layers[0].name=name;
    assert.equal(validateIllustrationConfig(source).layers[0].name,name);
  }
  invalid(source=>{source.layers=[layer('same'),layer('same')];},/重复/);
  invalid(source=>{source.layers[0].unexpected=true;},/未知/);
  invalid(source=>{source.layers[0]=Object.assign(Object.create({injected:true}),layer());},/普通对象/);
  invalid(source=>{source.layers[0]=JSON.parse(JSON.stringify(layer()).replace('"name"','"__proto__":{},"name"'));},/未知/);
  const nullPrototype=fixture();nullPrototype.layers[0]=Object.assign(Object.create(null),layer());
  assert.equal(validateIllustrationConfig(nullPrototype).layers[0].name,'body');
});

test('layer PNG paths use the same local allowlist as the base images',()=>{
  const dangerous=['https://example.test/layer.png','//example.test/layer.png','data:image/png;base64,AA==',
    'blob:http://localhost/id','file:///D:/layer.png','D:\\layer.png','/other/layer.png',
    '/assets/avatar/../layer.png','/assets/avatar/./layer.png','/assets/avatar/folder/layer.png',
    '/assets/avatar/a\\layer.png','/assets/avatar//layer.png','/assets/avatar/layer..png',
    '/assets/avatar/%2e%2e/layer.png','/assets/avatar/%6cayer.png','/assets/avatar/%252e%252e.png',
    '/assets/avatar/layer.png?x=1','/assets/avatar/layer.png#fragment','/assets/avatar/layer.svg',
    '/assets/avatar/layer.png.svg','/assets/avatar/layer\0.png','/assets/avatar/layer.png\n',
    ' /assets/avatar/layer.png','/assets/avatar/layer.png ',null,undefined,5,'',
    '/assets/avatar/'+('x'.repeat(300))+'.png'];
  for(const image of dangerous) invalid(source=>{source.layers[0].image=image;},/PNG/);
  const source=fixture();source.layers[0].image='/assets/avatar/Body-v2.1_layer.PNG';
  assert.equal(validateIllustrationConfig(source).layers[0].image,source.layers[0].image);
});

test('bounds and optional sourceRect must be complete finite nonzero normalized rectangles',()=>{
  const bad=[null,{},[],[0,0,1],new Array(4),new Float32Array([0,0,1,1]),
    [0,0,1,1,0],['0',0,1,1],[0,NaN,1,1],[0,0,Infinity,1],[-.01,0,.5,.5],
    [0,-.01,.5,.5],[0,0,-.01,.5],[0,0,0,.5],[0,0,.5,0],[0,0,.5,-.01],
    [.9,0,.2,1],[0,.9,1,.2],[0,0,1.1,1],[0,0,1,1.1]];
  for(const field of ['bounds','sourceRect']) {
    for(const value of bad) invalid(source=>{source.layers[0][field]=value;},/bounds|sourceRect/);
    for(const rectangle of [[0,0,1,1],[0,0,.25,.5],[.75,.5,.25,.5],[.2,.3,.0001,.0001]]) {
      const source=fixture();source.layers[0][field]=rectangle;
      assert.deepEqual(validateIllustrationConfig(source).layers[0][field],rectangle);
    }
  }
  invalid(source=>{delete source.layers[0].bounds;},/bounds/);
  assert.equal(Object.hasOwn(validateIllustrationConfig(fixture()).layers[0],'sourceRect'),false);
});

test('layer pivots, depths and motion channels are explicit and bounded',()=>{
  for(const pivot of [[],new Array(2),[-.01,.5],[.5,1.01],[NaN,0],[0,Infinity],['.5',.5],null]) {
    invalid(source=>{source.layers[0].pivot=pivot;},/pivot/);
  }
  for(const z of [-101,101,NaN,Infinity,'0',null,undefined]) invalid(source=>{source.layers[0].z=z;},/\.z/);
  for(const motion of ['idle','arm','speaking','constructor','',null,0]) invalid(source=>{source.layers[0].motion=motion;},/motion/);
  for(const motion of ['body','head','leftArm','rightArm','leftHair','rightHair','skirt','legs']) {
    const source=fixture();source.layers[0].motion=motion;
    assert.equal(validateIllustrationConfig(source).layers[0].motion,motion);
  }
  for(const [pivot,z] of [[[0,0],-100],[[1,1],100]]) {
    const source=fixture();Object.assign(source.layers[0],{pivot,z});
    assert.deepEqual(validateIllustrationConfig(source).layers[0].pivot,pivot);
  }
});

test('parents may precede or follow children, but must exist and cannot form any cycle',()=>{
  const source={...legacy(),layers:[layer('child',{parent:'middle'}),layer('root'),layer('middle',{parent:'root'})]};
  assert.deepEqual(validateIllustrationConfig(source).layers.map(x=>x.name),['child','root','middle']);
  for(const parent of ['missing','../root','constructor',null,5,'']) invalid(value=>{value.layers[0].parent=parent;},/parent/);
  for(const entries of [[layer('a',{parent:'a'})],
    [layer('a',{parent:'b'}),layer('b',{parent:'a'})],
    [layer('a',{parent:'b'}),layer('b',{parent:'c'}),layer('c',{parent:'a'})],
    [layer('root'),layer('leaf',{parent:'a'}),layer('a',{parent:'b'}),layer('b',{parent:'a'})]]) {
    invalid(value=>{value.layers=entries;},/环/);
  }
});

test('face compositing is only available on head layers with the original expression textures',()=>{
  const source=fixture();Object.assign(source.layers[0],{motion:'head',face:'original'});
  assert.equal(validateIllustrationConfig(source).layers[0].face,'original');
  for(const motion of ['body','leftArm','rightArm','leftHair','rightHair','skirt','legs']) {
    invalid(value=>{Object.assign(value.layers[0],{motion,face:'original'});},/face/);
  }
  for(const face of [true,false,'originals','speaking','',1,null]) {
    invalid(value=>{Object.assign(value.layers[0],{motion:'head',face});},/face/);
  }
});

test('faceSourceRect requires face and must itself be a complete image rectangle',()=>{
  invalid(source=>{source.layers[0].faceSourceRect=[0,0,1,1];},/需要 face/);
  invalid(source=>{Object.assign(source.layers[0],{motion:'head',faceSourceRect:[0,0,1,1]});},/需要 face/);
  for(const faceSourceRect of [new Array(4),[0,0,0,1],[0,0,1,0],[.75,0,.3,1],[0,.75,1,.3],
    [0,0,NaN,1],[0,0,1,Infinity],['0',0,1,1],null]) {
    invalid(source=>{Object.assign(source.layers[0],{motion:'head',face:'original',faceSourceRect});},/faceSourceRect/);
  }
  const source=fixture();Object.assign(source.layers[0],{motion:'head',face:'original',faceSourceRect:[.1,.2,.3,.4]});
  assert.deepEqual(validateIllustrationConfig(source).layers[0].faceSourceRect,[.1,.2,.3,.4]);
});

test('chroma keys are finite RGB triples and a tolerance requires its key',()=>{
  for(const chromaKey of [[],[0,1],new Array(3),new Float32Array([0,1,0]),[0,1,0,1],
    [-.1,0,0],[0,1.1,0],[0,0,NaN],[Infinity,0,0],['0',1,0],null]) {
    invalid(source=>{source.layers[0].chromaKey=chromaKey;},/chromaKey/);
  }
  invalid(source=>{source.layers[0].chromaTolerance=.2;},/需要 chromaKey/);
  for(const chromaTolerance of [-.001,.501,NaN,Infinity,'0.2',null]) {
    invalid(source=>{Object.assign(source.layers[0],{chromaKey:[0,1,0],chromaTolerance});},/chromaTolerance/);
  }
  for(const chromaKey of [[0,0,0],[1,1,1],[.1,.8,.2]]) {
    const source=fixture();source.layers[0].chromaKey=chromaKey;
    const result=validateIllustrationConfig(source).layers[0];
    assert.deepEqual(result.chromaKey,chromaKey);assert.equal(result.chromaTolerance,.18);
    assert.equal(Object.hasOwn(source.layers[0],'chromaTolerance'),false,'default does not mutate the manifest');
  }
  for(const chromaTolerance of [0,.5]) {
    const source=fixture();Object.assign(source.layers[0],{chromaKey:[0,1,0],chromaTolerance});
    assert.equal(validateIllustrationConfig(source).layers[0].chromaTolerance,chromaTolerance);
  }
});

test('elbow and wrist occur together only on arms, and must stay inside that layer bounds',()=>{
  for(const motion of ['leftArm','rightArm']) {
    const arm=layer('arm',{motion,bounds:[.1,.2,.3,.5],elbow:[.25,.5],wrist:[.3,.65]});
    const source={...legacy(),layers:[arm]};
    assert.deepEqual(validateIllustrationConfig(source).layers[0],arm);
    for(const missing of ['elbow','wrist']) {
      const bad=structuredClone(source);delete bad.layers[0][missing];
      assert.throws(()=>validateIllustrationConfig(bad),/elbow|wrist/);
    }
    for(const joint of ['elbow','wrist']) {
      for(const point of [[.099,.5],[.401,.5],[.2,.199],[.2,.701],[NaN,.5],[.2,Infinity],
        ['.2',.5],[],new Array(2),null]) {
        const bad=structuredClone(source);bad.layers[0][joint]=point;
        assert.throws(()=>validateIllustrationConfig(bad),/elbow|wrist/);
      }
      for(const point of [[.1,.2],[.4,.7]]) {
        const edge=structuredClone(source);edge.layers[0][joint]=point;
        assert.deepEqual(validateIllustrationConfig(edge).layers[0][joint],point);
      }
    }
  }
  for(const motion of ['body','head','leftHair','rightHair','skirt','legs']) {
    invalid(source=>{Object.assign(source.layers[0],{motion,elbow:[.3,.4],wrist:[.4,.5]});},/只有手臂/);
  }
});

test('every nested layer array is deeply cloned without mutating a frozen manifest',()=>{
  const source=freeze({...legacy(),layers:[
    layer('body'),
    layer('head',{motion:'head',parent:'body',face:'original',sourceRect:[0,0,.5,.5],
      faceSourceRect:[.1,.1,.8,.8],chromaKey:[0,1,0],chromaTolerance:.18}),
    layer('arm',{motion:'leftArm',parent:'body',elbow:[.3,.4],wrist:[.4,.6]})]});
  const result=validateIllustrationConfig(source);
  assert.deepEqual(result,source);independent(source,result);
  result.layers[1].bounds[0]=.2;result.layers[1].sourceRect[0]=.2;
  result.layers[1].faceSourceRect[0]=.2;result.layers[1].pivot[0]=.2;
  result.layers[1].chromaKey[0]=.9;result.layers[2].elbow[0]=.9;result.layers[2].wrist[0]=.9;
  result.layers[2].parent='head';result.layers.push(layer('extra'));
  assert.equal(source.layers.length,3);assert.equal(source.layers[1].bounds[0],.1);
  assert.equal(source.layers[1].sourceRect[0],0);assert.equal(source.layers[1].faceSourceRect[0],.1);
  assert.equal(source.layers[1].pivot[0],.5);assert.equal(source.layers[1].chromaKey[0],0);
  assert.equal(source.layers[2].elbow[0],.3);assert.equal(source.layers[2].wrist[0],.4);
  assert.equal(source.layers[2].parent,'body');
});
