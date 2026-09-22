import {IllustrationRenderer} from './illustration.mjs';
import {validateCharacterConfig} from './character-config.mjs';
const $=id=>document.getElementById(id);
const requested=new URLSearchParams(location.search).get('character');
const character=['character-illustration-v2','character-illustration-v3'].includes(requested)?requested:'character-illustration-v2';
const config=validateCharacterConfig(await fetch('/assets/avatar/'+character+'.json',{cache:'no-store'}).then(r=>r.json()));
$('return').href='/?character='+character;
$('version').textContent=config.description;
const avatar=new IllustrationRenderer($('character'),config.renderer);
await avatar.load(config.asset);
let live=true,previous=performance.now();
function report(){
  const s=avatar.stats;
  $('report').textContent=JSON.stringify({mode:live?'实际待机动画':'姿态中段定格（测试）',layers:s.layerCount,fps:Math.round(s.fps),
    headTilt:+s.headTilt.toFixed(3),leftHand:+s.leftHand.toFixed(3),rightHand:+s.rightHand.toFixed(3),
    gaze:[+s.gazeX.toFixed(3),+s.gazeY.toFixed(3)],headPitch:+s.headPitch.toFixed(3),smile:+s.smile.toFixed(3),mouth:s.mouthOpen},null,2);
}
function step(seconds){for(let t=0;t<seconds;t+=1/60)avatar.update({deltaSeconds:1/60,playing:false});report();}
function prepare(){avatar.setReducedMotion($('reduced').checked);avatar.reset();avatar.motion.reset({clearSession:true,immediate:true});avatar.setAttention({active:false});avatar.setActivity('idle');live=false;}
$('greet').onclick=()=>{prepare();avatar.interact('greet');step(.9);};
$('acknowledge').onclick=()=>{prepare();avatar.interact('acknowledge');step(.5);};
for(const [id,x] of [['left',-1],['right',1]])$(id).onclick=()=>{prepare();avatar.setAttention({active:true,x,y:-.15});step(.9);};
$('neutral').onclick=()=>{prepare();avatar.setReducedMotion(true);step(.1);};
$('idle').onclick=()=>{avatar.setReducedMotion($('reduced').checked);avatar.setAttention({active:false});live=true;};
$('reduced').onchange=()=>{avatar.setReducedMotion($('reduced').checked);live=true;};
$('frame').onchange=()=>{avatar.setView({framing:$('frame').value});avatar.update({deltaSeconds:0,playing:false});report();};
$('background').onchange=()=>{
  const mode=$('background').value;
  $('stage').style.background=mode==='dark'?'#252b32':mode==='checker'
    ?'repeating-conic-gradient(#d8dde0 0% 25%, #fff 0% 50%) 0 / 24px 24px':'#fff';
};
$('stage').addEventListener('pointermove',event=>{
  if(!live)return;const rect=$('stage').getBoundingClientRect();
  avatar.setPointer({x:(event.clientX-rect.left)/rect.width,y:(event.clientY-rect.top)/rect.height,active:true});
});
$('stage').addEventListener('pointerleave',()=>avatar.setAttention({active:false}));
function frame(now){const dt=Math.min(.1,(now-previous)/1000);previous=now;if(live){avatar.update({deltaSeconds:dt,playing:false});report();}requestAnimationFrame(frame);}
requestAnimationFrame(frame);report();
window.addEventListener('beforeunload',()=>avatar.dispose());
