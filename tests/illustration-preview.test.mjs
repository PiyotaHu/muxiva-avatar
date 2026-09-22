import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,existsSync} from 'node:fs';
import * as THREE from 'three';
import {validateIllustrationConfig} from '../web/illustration-config.mjs';
import {validateCharacterConfig} from '../web/character-config.mjs';
import {IllustrationRenderer} from '../web/illustration.mjs';
import {IllustrationMotion} from '../web/illustration-motion.mjs';
import {AvatarTimeline} from '../web/avatar-timeline.mjs';

const read=name=>JSON.parse(readFileSync(new URL('../assets/avatar/'+name,import.meta.url),'utf8'));
const candidate=()=>read('illustration-v3.json');
const retiredIllustrationInstalled=existsSync(new URL('../assets/avatar/illustration-neutral-v1.png',import.meta.url));

test('self-made candidate is opt-in and preserves the approved art and rig',{skip:!retiredIllustrationInstalled},()=>{
  const old=validateIllustrationConfig(read('illustration-v2.json'));
  const next=validateIllustrationConfig(candidate());
  assert.equal(read('character.json').asset,'/assets/avatar/illustration-v2.json');
  assert.equal(validateCharacterConfig(read('character-illustration-v3.json')).asset,'/assets/avatar/illustration-v3.json');
  assert.deepEqual(next.layers,old.layers);
  assert.deepEqual({...next.rig,headRelief:undefined},{...old.rig,headRelief:undefined});
  for(const key of Object.keys(old.images))assert.equal(next.images[key],old.images[key]);
  const png=readFileSync(new URL('../'+next.images.smile.slice(1),import.meta.url));
  assert.deepEqual([...png.subarray(0,8)],[137,80,78,71,13,10,26,10]);
  assert.deepEqual([png.readUInt32BE(16),png.readUInt32BE(20)],next.size);
});

test('head relief and smile are optional, bounded and require a face-capable head layer',()=>{
  for(const strength of [0,.7,1]){
    const config=candidate();config.rig.headRelief=strength;
    assert.equal(validateIllustrationConfig(config).rig.headRelief,strength);
  }
  for(const strength of [-1,1.001,NaN,Infinity,null,'0.7']){
    const config=candidate();config.rig.headRelief=strength;
    assert.throws(()=>validateIllustrationConfig(config),/headRelief/);
  }
  for(const field of ['headRelief','smile']){
    const config=candidate();delete config.rig.headRelief;delete config.images.smile;
    if(field==='headRelief')config.rig.headRelief=.7;else config.images.smile='/assets/avatar/smile.png';
    delete config.rig.face;
    assert.throws(()=>validateIllustrationConfig(config),/face/);
  }
  for(const path of [null,'https://example.test/smile.png','/assets/avatar/../smile.png','/assets/avatar/smile.png?x=1']){
    const config=candidate();config.images.smile=path;
    assert.throws(()=>validateIllustrationConfig(config),/smile/);
  }
});

test('candidate renderer installs a curved head without changing other geometry or clocks',()=>{
  const config=validateIllustrationConfig(candidate());
  const textures=Object.fromEntries(Object.keys(config.images).map(key=>[key,new THREE.Texture()]));
  const byUrl=new Map(Object.entries(config.images).map(([key,path])=>[path,textures[key]]));
  for(const layer of config.layers)if(!byUrl.has(layer.image))byUrl.set(layer.image,new THREE.Texture());
  const renderer=Object.create(IllustrationRenderer.prototype);
  const asset=renderer._createLayeredIllustration(config,textures,byUrl);renderer.asset=asset;
  try {
    const head=asset.layers.get('head');
    assert.equal(head.mesh.geometry.attributes.position.count,49*49);
    assert.ok(head.mesh.geometry.attributes.position.array.some((n,i)=>i%3===2&&n>0));
    assert.equal(head.uniforms.uHasSmile.value,1);
    assert.equal(head.uniforms.uSmileTexture.value,textures.smile);
    for(const layer of asset.layers.values())if(layer!==head){
      assert.equal(layer.mesh.geometry.attributes.position.count,9*33);
      assert.ok(layer.mesh.geometry.attributes.position.array.every((n,i)=>i%3!==2||n===0));
    }
    renderer._applyLayerPose({headYaw:1,headPitch:1});
    assert.equal(head.anchor.rotation.y,Math.PI/15);
    assert.equal(head.anchor.rotation.x,Math.PI/22.5);
    assert.equal(head.mesh.material.depthTest,false);
    assert.equal(head.mesh.material.depthWrite,false);
    assert.equal(Object.hasOwn(renderer,'animationFrame'),false);
    Object.assign(renderer,{options:{mouthScale:1},elapsed:0,nextBlink:2.8,mouth:0,
      motion:new IllustrationMotion({enabled:false}),timeline:new AvatarTimeline(),
      renderer:{render(){}},stats:{frames:0,seconds:0}});
    assert.equal(renderer.setExpression('portraitSmile',.8),true);
    renderer.update({deltaSeconds:1/60,playing:false});
    assert.equal(head.uniforms.uSmile.value,.8);
    assert.equal(head.uniforms.uMouthOpen.value,0,'explicit smile cannot invent speech');
    renderer.setExpression('neutral',0);
    renderer.update({deltaSeconds:1/60,playing:false});
    assert.equal(head.uniforms.uSmile.value,0);
    head.uniforms.uHasSmile.value=0;
    renderer.setExpression('portraitSmile',1);
    renderer.update({deltaSeconds:1/60,playing:false});
    assert.equal(head.uniforms.uSmile.value,0,'legacy textures keep previous behavior');
  }finally{
    asset.geometries.forEach(g=>g.dispose());asset.materials.forEach(m=>m.dispose());
    for(const texture of new Set(byUrl.values()))texture.dispose();
  }
});
