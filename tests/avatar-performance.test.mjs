import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {AvatarStateMachine} from '../web/avatar-state.mjs';
import {VrmAnimationController} from '../web/avatar-animation.mjs';
import {AvatarFaceController} from '../web/avatar-face.mjs';
import {validateCharacterConfig} from '../web/character-config.mjs';
const config=JSON.parse(readFileSync(new URL('../assets/avatar/character.json',import.meta.url),'utf8'));
const step=(body,seconds)=>{for(let t=0;t<seconds;t+=.05)body.update(.05);};
function bodyHarness(){
 const body=new VrmAnimationController({states:{idle:'idle',speaking:'talk',listening:'listen'},variants:{speaking:['talk','talk2','talk3']},gestures:{happy:['happy'],angry:['angry']},variantIntervalSeconds:4,gestureCooldownSeconds:2});
 const root=new THREE.Object3D();body.vrm={scene:root};body.mixer=new THREE.AnimationMixer(root);
 for(const name of ['idle','talk','talk2','talk3','listen','happy','angry'])body.cache.set(name,new THREE.AnimationClip(name,3,[]));
 return body;
}
test('speaking rotates distinct clips without resetting every frame and cleans faded actions',()=>{
 const body=bodyHarness();body.setActivity('speaking');assert.equal(body.state,'talk');
 step(body,2);const action=body.actions.get('talk');assert.ok(action.time>1.9);
 assert.equal(body.setActivity('speaking'),false);assert.ok(action.time>1.9);
 step(body,2.2);assert.equal(body.state,'talk2');step(body,1);assert.equal(action.isRunning(),false);
 step(body,3);assert.equal(body.state,'talk3');body.dispose();
});
test('one shot returns to current activity, rejects spam, and cancellation cannot revive it',()=>{
 const body=bodyHarness();body.setActivity('speaking');assert.ok(body.triggerGesture('happy'));
 assert.equal(body.triggerGesture('angry'),false);assert.equal(body.state,'happy');
 step(body,2.6);assert.equal(body.activeGesture,null);assert.equal(body.state,'talk');
 step(body,1);assert.ok(body.triggerGesture('angry'));body.reset();step(body,5);
 assert.equal(body.state,'idle');assert.equal(body.activeGesture,null);body.dispose();
});
test('missing gestures are harmless; reduced motion disables gestures and rotation',()=>{
 const body=bodyHarness();body.setActivity('idle');assert.equal(body.triggerGesture('unknown'),false);
 body.setReducedMotion(true);body.setActivity('speaking');step(body,20);assert.equal(body.state,'idle');assert.equal(body.triggerGesture('happy'),false);body.dispose();
});
test('text cues wait for matching actual playback and never read the user transcript',()=>{
 const state=new AvatarStateMachine({cues:config.renderer.cues});
 state.queueText({sequence:3,text:'太开心'});state.queueText({sequence:3,text:'了，恭喜你！'});
 assert.equal(state.presentation({sequence:3,playing:false}),null);
 assert.equal(state.presentation({sequence:2,playing:true}),null);
 assert.equal(state.presentation({sequence:3,playing:true}).emotion,'happy');
 state.queueText({sequence:4,text:'我没有生气，别生气呀。'});assert.equal(state.presentation({sequence:4,playing:true}),null);
 state.queueText({sequence:5,text:'我有点生气，哼！'});assert.equal(state.presentation({sequence:5,playing:true}).emotion,'angry');
 state.reset({beforeSequence:5});assert.equal(state.queueText({sequence:3,text:'太开心了'}),false);
 assert.equal(state.presentation({sequence:3,playing:true}),null);assert.equal(state.presentation({sequence:5,playing:true}).emotion,'angry');
 state.reset();assert.equal(state.presentation({sequence:5,playing:true}),null);
});
test('cues are bounded and manual reactions expire instead of sticking forever',()=>{
 const state=new AvatarStateMachine();for(let sequence=0;sequence<30;sequence++)state.queueText({sequence,text:'x'.repeat(10000)});
 assert.equal(state.responses.size,8);assert.ok([...state.responses.values()].every(row=>row.text.length<=4096));
 state.react('happy',.2);assert.equal(state.presentation().emotion,'happy');state.update({deltaSeconds:.1});state.update({deltaSeconds:.1});assert.equal(state.presentation(),null);
});
test('facial emotion fades, mouth remains audio-driven, and silence closes it',()=>{
 const values=new Map(),manager={expressions:['happy','angry','aa','ih','ou','ee','oh','blink'].map(expressionName=>({expressionName})),setValue:(key,value)=>values.set(key,value),getExpression:()=>({overrideMouth:'none'})};
 const face=new AvatarFaceController({emotions:{happy:{name:'happy',weight:.6},angry:{name:'angry',weight:.5}}});face.bind({expressionManager:manager});
 for(let i=0;i<30;i++)face.update({emotion:'happy',playing:true,visemes:{aa:.8},deltaSeconds:.05});
 assert.ok(values.get('happy')>.5);assert.ok(values.get('aa')>.5);
 for(let i=0;i<30;i++)face.update({emotion:'angry',playing:false,deltaSeconds:.05});
 assert.ok(values.get('happy')<.01);assert.ok(values.get('angry')>.45);assert.ok(values.get('aa')<.01);face.reset();assert.equal(values.get('angry'),0);
});
test('new configuration is bounded, copied and references only registered clips',()=>{
 const good=validateCharacterConfig(config);good.renderer.animation.variants.speaking.push('x');assert.equal(config.renderer.animation.variants.speaking.length,3);
 for(const modify of [c=>c.renderer.animation.variants.speaking=['missing'],c=>c.renderer.animation.variantIntervalSeconds=0,c=>c.renderer.cues[0].name='missing',c=>c.renderer.cues[0].phrases=[''],c=>c.renderer.cues[0].regex='.*']){
   const broken=structuredClone(config);modify(broken);assert.throws(()=>validateCharacterConfig(broken));
 }
});
test('web and desktop share presentation methods without changing graph or agent prompts',()=>{
 const app=readFileSync(new URL('../web/app.mjs',import.meta.url),'utf8');
 assert.match(app,/if\(responseText\)avatar\?\.queueText/);
 assert.match(app,/react-happy/);assert.match(app,/Boolean\(avatar\?\.asset\|\|avatar\?\.vrm\)/);
 const pet=readFileSync(new URL('../desktop/pet-main.mjs',import.meta.url),'utf8');assert.match(pet,/react-happy/);assert.match(pet,/react-angry/);
});
