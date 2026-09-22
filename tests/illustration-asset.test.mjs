import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {validateCharacterConfig} from '../web/character-config.mjs';
import {validateIllustrationConfig} from '../web/illustration-config.mjs';

const root=new URL('../',import.meta.url);
const local=path=>new URL(path.replace(/^\//,''),root);
const json=async path=>JSON.parse(await readFile(local(path),'utf8'));
const retiredIllustrationInstalled=existsSync(local('assets/avatar/illustration-neutral-v1.png'));
const retiredVrmsInstalled=existsSync(local('assets/avatar/sample.vrm'));

test('production illustration resolves its own local manifest and three distinct matching PNG canvases',{skip:!retiredIllustrationInstalled},async()=>{
  const character=validateCharacterConfig(await json('assets/avatar/character-illustration-v1.json'));
  assert.equal(character.renderer.type,'illustration');
  assert.equal(character.renderer.framing,'full');
  assert.equal(character.expression.name,'neutral');
  const art=validateIllustrationConfig(await json(character.asset));
  assert.deepEqual(art.size,[1024,1536]);
  const hashes=new Set();
  for(const path of Object.values(art.images)){
    const bytes=await readFile(local(path));
    assert.deepEqual([...bytes.subarray(0,8)],[137,80,78,71,13,10,26,10]);
    assert.equal(bytes.subarray(12,16).toString(),'IHDR');
    assert.deepEqual([bytes.readUInt32BE(16),bytes.readUInt32BE(20)],art.size);
    assert.equal(bytes[24],8,'8-bit artwork');
    assert.ok([2,6].includes(bytes[25]),'RGB white-backed or actual RGBA, never assume alpha');
    hashes.add(createHash('sha256').update(bytes).digest('hex'));
  }
  assert.equal(hashes.size,3,'blink and speech are actual separately authored frames');
});

test('production facial masks stay small, separate and registered to the source feature centres',async()=>{
  const {rig,size}=validateIllustrationConfig(await json('assets/avatar/illustration-v1.json'));
  const pixel=region=>region.center.map((n,index)=>n*size[index]);
  const mouth=pixel(rig.mouth);
  assert.ok(Math.abs(mouth[0]-514)<3&&Math.abs(mouth[1]-184)<3);
  assert.ok(rig.mouth.radius[0]<.04&&rig.mouth.radius[1]<.02);
  for(const eye of rig.eyes){
    assert.ok(eye.radius[0]<.05&&eye.radius[1]<.02);
  }
  const inside=(region,x,y)=>((x/size[0]-region.center[0])/region.radius[0])**2+
    ((y/size[1]-region.center[1])/region.radius[1])**2<1;
  // The face is slightly tilted: rectangular boxes can touch at a corner,
  // while the shader's elliptical supports must not mix eyes with the mouth.
  for(let y=100.5;y<210;y++)for(let x=415.5;x<580;x++){
    assert.ok(!(inside(rig.mouth,x,y)&&rig.eyes.some(eye=>inside(eye,x,y))));
  }
  assert.ok(rig.eyes[0].center[0]+rig.eyes[0].radius[0]<rig.eyes[1].center[0]+rig.eyes[1].radius[0]);
});

test('prior user-selectable VRMs remain unchanged while illustration becomes an independent option',{skip:!retiredVrmsInstalled},async()=>{
  const expected={
    'sample.vrm':'12c2b97e95e700783a6a550dc0eee2d7880aeedccef9ae67bc4c5a2f0f2631a2',
    'adult-twintail-v1.vrm':'fb66e510fa4cf2701fa41631e5361705b617e2d6d47792d393f904cff0f15f30',
    'adult-twintail-v2.vrm':'fbf91069722dc77baaf7fe558d16a62b65f042d0624f6063559fe501382d2c35',
    'adult-twintail-v3.vrm':'7132c108ff196c7ebafdb50a5998ca03ad161719b2020a7b2cff1505344719e8',
  };
  for(const [name,hash] of Object.entries(expected)){
    assert.equal(createHash('sha256').update(await readFile(local('assets/avatar/'+name))).digest('hex'),hash,name);
  }
});
