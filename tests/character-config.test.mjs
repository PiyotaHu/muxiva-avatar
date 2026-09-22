import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {validateCharacterConfig,resolveCharacterConfigUrl} from '../web/character-config.mjs';

const selectedConfig=JSON.parse(await readFile(new URL('../assets/avatar/character.json',import.meta.url),'utf8'));
const config=JSON.parse(await readFile(new URL('../assets/avatar/character.json',import.meta.url),'utf8'));
test('optional preview query selects only known local config basenames',()=>{
  assert.equal(resolveCharacterConfigUrl(),'/assets/avatar/character.json');
  assert.equal(resolveCharacterConfigUrl('?unrelated=1'),'/assets/avatar/character.json');
  assert.equal(resolveCharacterConfigUrl('?character=character'),'/assets/avatar/character.json');
  for(const search of ['?character=','?character=unknown','?character=character-v2.json',
    '?character=../character-v2','?character=%2e%2e%2fcharacter-v2',
    '?character=character-v2%2f..','?character=character-v2%5c..','?character=%252e%252e%252fcharacter-v2',
    '?character=https://example.test/config','?character=//example.test/config',
    '?character=/assets/avatar/character-v2','?character=character-v2%00',
    '?character=character-illustration-v999','?character=character-illustration-v1.json',
    '?character=character-illustration-v1%2f..','?character=character-illustration-v1&character=character-v3',
    '?character=character-v2&character=character','https://example.test/?character=character-v2']) {
    assert.throws(()=>resolveCharacterConfigUrl(search),/角色预览/);
  }
});
test('only the selected local AvatarSample A profile remains selectable',()=>{
  const selected=validateCharacterConfig(config);
  assert.equal(selected.asset,'/assets/avatar/AvatarSample_A.vrm');
  assert.equal(selected.renderer.type,'vrm');
  assert.equal(selected.renderer.framing,'portrait');
  for(const name of ['character-v1','character-v2','character-v3','character-v4','character-illustration-v1'])
    assert.throws(()=>resolveCharacterConfigUrl('?character='+name),/角色预览/);
});
test('default points to the installed AvatarSample A asset',()=>{
  const selected=validateCharacterConfig(selectedConfig);
  assert.equal(selected.asset,'/assets/avatar/AvatarSample_A.vrm');
  assert.equal(selected.version,'avatar-sample-a-vrma-2');
  assert.equal(selected.renderer.framing,'portrait');
});
test('current VRM character keeps generic renderer options independent of source JSON',()=>{
  const value=validateCharacterConfig(config);
  assert.equal(value.name,'AvatarSample A');
  assert.equal(value.asset,'/assets/avatar/AvatarSample_A.vrm');
  assert.equal(value.renderer.framing,'portrait');
  assert.equal(value.renderer.type,'vrm');
  assert.deepEqual(value.expression,{name:'neutral',weight:0});
  value.renderer.animation.clips.idle='/assets/avatar/animations/changed.vrma';
  assert.equal(config.renderer.animation.clips.idle,'/assets/avatar/animations/rocketbox-idle.vrma','validation must return independent options');
});

test('illustration is an explicit renderer type with a local manifest and independent options',()=>{
  const source={...config,asset:'/assets/avatar/front-illustration-v1.json',
    renderer:{type:'illustration',framing:'full',pixelRatio:1.5,framePadding:1.1,mouthScale:.7,
      motion:{enabled:true,idleAmount:.5,gestureAmount:.4}}};
  const value=validateCharacterConfig(source);
  assert.equal(value.renderer.type,'illustration');
  assert.equal(value.asset,source.asset);assert.deepEqual(value.renderer,source.renderer);
  value.renderer.motion.idleAmount=1;
  assert.equal(source.renderer.motion.idleAmount,.5);
  assert.equal(validateCharacterConfig({...config,renderer:{...config.renderer,type:'vrm'}}).renderer.type,'vrm');
  for(const type of ['',null,'png','video','VRM',true,1]) {
    assert.throws(()=>validateCharacterConfig({...source,renderer:{...source.renderer,type}}),/renderer.type/);
  }
  assert.throws(()=>validateCharacterConfig({...source,renderer:{...source.renderer,mouthExpression:'aa'}}),/未知/);
  assert.throws(()=>validateCharacterConfig({...source,renderer:{...source.renderer,mouthScale:2.1}}),/mouthScale/);
});

test('illustration manifests cannot weaken the existing VRM path boundary',()=>{
  const renderer={type:'illustration',framing:'full',mouthScale:.8};
  for(const asset of ['/assets/avatar/model.vrm','https://example.test/a.json','//example.test/a.json',
    '/assets/avatar/../a.json','/assets/avatar/./a.json','/assets/avatar/sub/a.json','/assets/avatar//a.json',
    '/assets/avatar/a..json','/assets/avatar/%61.json','/assets/avatar/%2e%2e%2fa.json',
    '/assets/avatar/a.json?token=dummy','/assets/avatar/a.json#fragment','/assets/avatar/a\\b.json',
    '/assets/avatar/a.json\n',' /assets/avatar/a.json','/assets/avatar/a.json.png','/other/a.json']) {
    assert.throws(()=>validateCharacterConfig({...config,asset,renderer}),/本地 JSON/);
  }
  assert.throws(()=>validateCharacterConfig({...config,asset:'/assets/avatar/a.json'}),/本地 VRM/);
  assert.throws(()=>validateCharacterConfig({...config,asset:'/assets/avatar/a.vrm',renderer}),/本地 JSON/);
});

test('current VRM keeps front framing and configured VRMA presentation data',async()=>{
  const candidate=validateCharacterConfig(config);
  assert.equal(candidate.asset,'/assets/avatar/AvatarSample_A.vrm');
  assert.equal(candidate.renderer.framePadding,1.08);
  assert.equal(candidate.renderer.animation.clips.idle,'/assets/avatar/animations/rocketbox-idle.vrma');
  assert.equal(candidate.renderer.animation.states.listening,'listening');
  assert.equal(candidate.renderer.animation.states.thinking,'thinking');
  assert.equal(candidate.renderer.animation.states.speaking,'speaking');
  for(const value of [0,1,1.51,Infinity])assert.throws(()=>validateCharacterConfig({...candidate,renderer:{...candidate.renderer,framePadding:value}}));
  const unsafeAnimation=structuredClone(candidate);unsafeAnimation.renderer.animation.clips.idle='https://example.test/a.vrma';
  assert.throws(()=>validateCharacterConfig(unsafeAnimation));
  const html=await readFile(new URL('../web/index.html',import.meta.url),'utf8');
  assert.ok(html.includes('正面展示'));
  assert.ok(!html.includes('>左侧<')&&!html.includes('>右侧<')&&!html.includes('>背面<'));
});test('character resources reject external URLs, traversal and encoded path tricks',()=>{
  for(const asset of ['https://example.test/model.vrm','//example.test/model.vrm','file:///D:/model.vrm',
    '/assets/avatar/../model.vrm','/assets/avatar/a/../../model.vrm','/assets/avatar/%2e%2e/model.vrm',
    '/assets/avatar/a//model.vrm','/assets/avatar/./model.vrm','/assets/avatar/model.vrm?token=value',
    '/assets/avatar/model.vrm#fragment','/assets/avatar/a\\model.vrm','/other/model.vrm']) {
    assert.throws(()=>validateCharacterConfig({...config,asset}),/本地 VRM/);
  }
  assert.equal(validateCharacterConfig({...config,asset:'/assets/avatar/variants/model-2.vrm'}).asset,
    '/assets/avatar/variants/model-2.vrm');
});
test('character options fail clearly for unsupported fields or invalid values',()=>{
  for(const value of [{...config,schemaVersion:2},{...config,renderer:{framing:'unknown'}},
    {...config,renderer:{...config.renderer,modelName:'business'}},
    {...config,renderer:{framing:'portrait',motion:{idleAmount:Infinity}}},
    {...config,renderer:{framing:'portrait',motion:{gestureAmount:3}}},
    {...config,renderer:{framing:'portrait',motion:{unknownPolicy:true}}},
    {...config,renderer:{framing:'portrait',mouthExpression:true}},
    {...config,expression:{name:'happy',weight:2}},
    {...config,expression:{name:'invalid expression!',weight:0.2}},{...config,name:''}]) {
    assert.throws(()=>validateCharacterConfig(value));
  }
});
test('character JSON owns identity while the application has no old model fallback',async()=>{
  const source=await readFile(new URL('../web/app.mjs',import.meta.url),'utf8');
  assert.ok(source.includes('fetch(resolveCharacterConfigUrl(window.location.search)'));
  assert.ok(source.includes('applyView(0,character.renderer.framing)'));
  assert.ok(source.includes("$('framing').value=framing"));
  assert.ok(source.includes('new AvatarRenderer($(\'avatar\'),character.renderer)'));
  assert.ok(source.includes("character.renderer.type==='illustration'"));
  assert.ok(source.includes('new IllustrationRenderer($(\'avatar\'),character.renderer)'));
  assert.ok(source.includes('avatar.load(character.asset)'));
  const importStart=source.indexOf("$('modelFile').onchange=");
  const importing=source.slice(importStart,source.indexOf('for(const button of viewButtons)',importStart));
  assert.ok(importing.includes("document.createElement('canvas')"));
  const load=importing.indexOf('await candidate.loadFile(file)');
  const accepted=importing.indexOf('if(!model||generation!==characterLoadGeneration)');
  const swap=importing.indexOf("$('avatar').replaceWith(canvas)");
  assert.ok(load>=0&&load<accepted&&accepted<swap,'only a complete current load replaces the existing canvas');
  assert.ok(importing.indexOf('previousAvatar?.dispose()')>swap,'old avatar is released only after successful swap');
  assert.ok(importing.slice(importing.indexOf('}catch(e)')).includes('candidate?.dispose()'));
  assert.ok(importing.includes('未替换当前角色'));
  assert.equal(source.includes('sample.vrm'),false);
  assert.equal(source.includes('adult-twintail-v1.vrm'),false);
});
