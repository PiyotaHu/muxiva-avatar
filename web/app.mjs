import {AvatarRenderer} from './avatar.mjs';
import {IllustrationRenderer} from './illustration.mjs';
import {LocalAudio} from './audio.mjs';
import {validateCharacterConfig,resolveCharacterConfigUrl,applyIdleAnimationPreview} from './character-config.mjs';
import {createExperienceMetrics} from './experience-metrics.mjs';
import {describeExperience} from './experience-view.mjs';
const $=id=>document.getElementById(id);
let avatar,audio,ws,ready=false,micOn=false,muted=false,agentBusy=false,userSpeaking=false,assistantMessage=null,lastSequence=-1;
const diagnostic={};
const experience=createExperienceMetrics();
let connectionGeneration=0;
let connecting=false,microphonePending=false,experienceError=false;
let presentationBefore=0,presentationSequence=-1;
let desktopMicrophoneRequested=false;
let lastDesktopPetState=null,petFeedbackTimer;
function refreshExperienceView(){
  const view=describeExperience({ready,connecting,micOn,muted,microphonePending,
    playing:audio?.position?.playing===true,agentBusy,hasReply:Boolean(assistantMessage?.textContent),failed:experienceError});
  for(const [id,value] of [['experienceLabel',view.label],['microphoneStatus',view.microphoneLabel]])
    if($(id)&&$(id).textContent!==value)$(id).textContent=value;
  if(document.body?.dataset&&document.body.dataset.activity!==view.activity)document.body.dataset.activity=view.activity;
  syncDesktopPetState(view);
}
const desktopPetApi=window.muxivaDesktopPet;
const desktopPetSearch=typeof window.location?.search==='string'?window.location.search:'';
const desktopPetMode=/(?:^|[?&])mode=pet(?:&|$)/.test(desktopPetSearch);
const applyDesktopPetLayout=compact=>{
  const layout=compact?'compact':'full';
  document.documentElement.dataset.host='desktop-pet';
  document.documentElement.dataset.petLayout=layout;
  document.body.dataset.petLayout=layout;
};
function showDesktopPetFeedback(message,tone='status',duration=1900){
  if(!desktopPetMode||!message)return;
  let feedback=$('desktopPetFeedback');
  if(!feedback){
    feedback=document.createElement('div');feedback.id='desktopPetFeedback';feedback.className='desktop-pet-feedback';
    feedback.setAttribute('role','status');feedback.setAttribute('aria-live','polite');document.body.append(feedback);
  }
  clearTimeout(petFeedbackTimer);feedback.textContent=message;feedback.dataset.tone=tone;
  feedback.classList.remove('is-visible');requestAnimationFrame(()=>feedback.classList.add('is-visible'));
  petFeedbackTimer=setTimeout(()=>feedback.classList.remove('is-visible'),duration);
}
function syncDesktopPetState(view){
  if(!desktopPetMode||!desktopPetApi?.setState)return;
  const next={
    connection:connecting?'connecting':ready?'connected':experienceError?'error':'disconnected',
    microphone:microphonePending?'starting':micOn?(muted?'muted':'on'):'off',
    activity:view.activity
  };
  const key=JSON.stringify(next),previous=lastDesktopPetState;
  if(previous?.key===key)return;
  desktopPetApi.setState(next);lastDesktopPetState={...next,key};
  if(!previous)return;
  if(previous.connection!=='connected'&&next.connection==='connected'){
    showDesktopPetFeedback('语音会话已连接');avatar?.interact?.('acknowledge');
  }else if(previous.microphone!=='on'&&next.microphone==='on'){
    showDesktopPetFeedback('麦克风已开启，可以说话了','success',2400);avatar?.interact?.('acknowledge');
  }else if(previous.microphone!=='muted'&&next.microphone==='muted')showDesktopPetFeedback('麦克风已静音');
  else if(next.connection==='disconnected'&&(previous.connection==='connected'||previous.connection==='connecting'))
    showDesktopPetFeedback('通话已关闭');
}
if(desktopPetMode){
  document.body.dataset.host='desktop-pet';
  applyDesktopPetLayout(true);
}
else if($('desktopPet'))$('desktopPet').onclick=async()=>{
  if(ws?.readyState===WebSocket.OPEN){error('当前浏览器会话仍在运行。请先结束会话，再打开桌宠；这样不会中途丢失音频或让两个窗口争用同一条 Muxiva 会话。');return;}
  const button=$('desktopPet');button.disabled=true;
  try{
    const response=await fetch('/api/desktop-pet',{method:'POST'});
    const result=await response.json();if(!response.ok)throw Error(result.error||'桌宠窗口启动失败');
    button.textContent='桌宠已打开';
  }catch(e){error(e.message);}
  finally{setTimeout(()=>{button.disabled=false;if(button.textContent==='桌宠已打开')button.textContent='桌宠模式';},1600);}
};// View-only switches: no media permissions, transport or character replacement.
if($('immersionToggle'))$('immersionToggle').onclick=()=>{
  const immersive=document.body.dataset.view!=='immersive';
  document.body.dataset.view=immersive?'immersive':'conversation';
  $('immersionToggle').setAttribute('aria-pressed',String(immersive));
  $('immersionToggle').textContent=immersive?'退出沉浸':'沉浸模式';
};
if($('conversationToggle'))$('conversationToggle').onclick=()=>{
  const panel=$('conversationPanel');panel.hidden=!panel.hidden;
  $('conversationToggle').setAttribute('aria-expanded',String(!panel.hidden));
  $('conversationToggle').textContent=panel.hidden?'展开对话':'收起对话';
};
refreshExperienceView();
function refreshExperienceDiagnostics(){
  const snapshot=experience.snapshot(),latest=snapshot.records.at(-1);
  const ms=value=>value===null?'未观测':value+'ms';
  if(latest){
    diagnostic['延迟起点']=({'text-submitted':'文字发送（匹配回显）','transcript-received':'识别定稿到达浏览器','response-observed':'回复到达（缺输入对应）'})[latest.origin];
    diagnostic['首文字 / PCM包 / 实际PCM消费']=[latest.firstTextMs,latest.firstAudioPacketMs,latest.firstPlaybackMs].map(ms).join(' / ');
    diagnostic['当前回答最大播放缓冲']=latest.maxQueueMs+'ms';
  }
  if(snapshot.cancellation)diagnostic['停止：取消回执 / PCM停止']=snapshot.cancellation.ambiguous
    ?'连续停止请求，无法可靠归因':[snapshot.cancellation.ackMs,snapshot.cancellation.playbackStoppedMs].map(ms).join(' / ');
}
const motionPreference=window.matchMedia?.('(prefers-reduced-motion: reduce)');
let character=null,viewYaw=0,viewFraming='portrait',characterLoadGeneration=0,pendingAvatar=null;
const viewButtons=Array.from(document.querySelectorAll('[data-avatar-yaw]'));
function characterControls(enabled){
  for(const button of viewButtons)button.disabled=!enabled;
  $('framing').disabled=!enabled;
}
function applyView(yaw=viewYaw,framing=viewFraming){
  avatar.setView({yaw,framing});viewYaw=yaw;viewFraming=framing;
  $('framing').value=framing;
  for(const button of viewButtons)button.setAttribute('aria-pressed',String(Number(button.dataset.avatarYaw)*Math.PI/2===yaw));
}
function characterError(message){
  $('avatarStatus').hidden=false;$('avatarStatus').textContent=message;
  diagnostic['角色错误']=message;showDiagnostics();
}
const showDiagnostics=()=>{$('diagnostics').textContent=Object.entries(diagnostic).map(([k,v])=>k+': '+v).join('\n');};
function addMessage(role,text){
  if($('messages').querySelector('.welcome'))$('messages').replaceChildren();
  const box=document.createElement('div');box.className='message '+role;
  const label=document.createElement('label');label.textContent=role==='user'?'你':role==='error'?'提示':character?.name||'AI';
  const content=document.createElement('span');content.textContent=text;box.append(label,content);$('messages').append(box);$('messages').scrollTop=$('messages').scrollHeight;
  return content;
}
function error(message){
  addMessage('error',message);$('state').textContent='需要检查';experienceError=true;
  showDesktopPetFeedback(message,'error',3600);
  // Never hide errors behind the user's collapsed conversation.
  if($('conversationPanel'))$('conversationPanel').hidden=false;
  if($('conversationToggle')){$('conversationToggle').setAttribute('aria-expanded','true');$('conversationToggle').textContent='收起对话';}
  refreshExperienceView();
}
try{
  const response=await fetch(resolveCharacterConfigUrl(window.location.search),{cache:'no-store'});
  if(!response.ok)throw Error('角色配置读取失败（HTTP '+response.status+'）');
  character=applyIdleAnimationPreview(
    validateCharacterConfig(await response.json()),window.location.search);
  if(character.renderer.type==='illustration'&&motionPreference?.matches)
    character.renderer.motion={...character.renderer.motion,reducedMotion:true};
  avatar=character.renderer.type==='illustration'
    ?new IllustrationRenderer($('avatar'),character.renderer)
    :new AvatarRenderer($('avatar'),character.renderer);
  const model=await avatar.load(character.asset);
  if(character.renderer.type==='vrm')avatar.setReducedMotion?.(Boolean(motionPreference?.matches));
  if(!model)throw Error('角色资源加载已取消');
  if(!avatar.setExpression(character.expression.name,character.expression.weight))throw Error('角色模型缺少配置中的表情：'+character.expression.name);
  applyView(0,character.renderer.framing);characterControls(true);
  $('avatarName').textContent=character.name;
  $('avatarDescription').textContent=character.description;
  $('avatarCredit').textContent=character.credit;
  diagnostic['角色版本']=character.version;
  diagnostic['展示形式']=character.renderer.type==='illustration'
    ?(avatar.stats.layerCount>0?'分层互动 2.5D':'正面可动 2.5D · 有限变形'):'3D VRM';
  const gl=avatar.renderer.getContext();const info=gl.getExtension('WEBGL_debug_renderer_info');
  diagnostic['GPU']=info?gl.getParameter(info.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);
}catch(e){
  $('avatarName').textContent='角色未加载（语音仍可使用）';
  $('avatarDescription').textContent='请检查角色配置与资源，或导入本地 VRM';
  $('avatarCredit').textContent='未切换到其他模型';
  characterControls(false);characterError(e.message);
}
const status=await fetch('/api/status').then(x=>x.json());
$('badge').textContent=status.testFixture?'测试模式 · 固定回复非大模型':status.modelConfigured?'模型服务已配置':'尚未配置回答模型';
diagnostic['本地Python']=status.speechReady?'已安装':'未安装';
diagnostic['回答模型']=status.modelConfigured?'已配置（尚需连通验证）':'未配置；连接可测试节点启动，回答会明确报错';
showDiagnostics();
if(!status.modelConfigured){$('connect').disabled=true;$('connect').textContent='请先配置模型服务';}
// Presentation input only: no microphone access, model calls or turn decisions.
// Bind the stable viewport so replacing a canvas cannot leave stale listeners.
const avatarViewport=document.querySelector('.avatar-viewport');
let petPointer, suppressPetClick=false;
const isCompactPet=()=>desktopPetMode&&document.body.dataset.petLayout==='compact';
const petPoint=event=>({screenX:event.screenX,screenY:event.screenY});
avatarViewport?.addEventListener('pointerdown',event=>{
  if(!isCompactPet()||event.target?.tagName!=='CANVAS'||!desktopPetApi?.startDrag)return;
  petPointer={pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,moved:false};
  avatarViewport.setPointerCapture?.(event.pointerId);
  desktopPetApi.startDrag(petPoint(event));
});

const finishPetPointer=event=>{
  if(!petPointer||event.pointerId!==petPointer.pointerId)return;
  const moved=petPointer.moved;petPointer=undefined;desktopPetApi?.endDrag?.();
  if(moved){suppressPetClick=true;setTimeout(()=>{suppressPetClick=false;},0);}
};
avatarViewport?.addEventListener('pointerup',finishPetPointer);
avatarViewport?.addEventListener('pointercancel',finishPetPointer);
function ensureDesktopPetConnection({announce=true}={}){
  if(!desktopPetMode)return false;
  if(ready&&!connecting){if(announce)showDesktopPetFeedback('语音会话已连接');return true;}
  if(connecting||ws){if(announce)showDesktopPetFeedback('正在连接语音会话…');return true;}
  if($('connect').disabled){showDesktopPetFeedback('语音服务尚未就绪','error',2800);return false;}
  if(announce)showDesktopPetFeedback('正在连接语音会话…');$('connect').click();return true;
}
function enableDesktopPetMicrophone(){
  if(!desktopPetMode)return;
  desktopMicrophoneRequested=true;
  if(microphonePending){showDesktopPetFeedback('正在开启麦克风…');return;}
  if(micOn&&!muted){showDesktopPetFeedback('麦克风已经开启，可以直接说话','success',2300);return;}
  if(!ready||connecting){
    showDesktopPetFeedback('正在连接，连接后会自动开启麦克风…',undefined,2600);
    if(!ensureDesktopPetConnection({announce:false}))desktopMicrophoneRequested=false;
    return;
  }
  showDesktopPetFeedback(muted?'正在恢复麦克风…':'正在开启麦克风…');$('mic').click();
}
function muteDesktopPetMicrophone(){
  if(!desktopPetMode)return;
  if(!micOn){showDesktopPetFeedback('麦克风尚未开启');return;}
  if(muted){showDesktopPetFeedback('麦克风已经静音');return;}
  desktopMicrophoneRequested=false;showDesktopPetFeedback('正在静音麦克风…');$('mic').click();
}
function startDesktopPetVoice(){enableDesktopPetMicrophone();}
function stopDesktopPetVoice(){
  desktopMicrophoneRequested=false;
  if(!ready&&!connecting&&!ws){showDesktopPetFeedback('当前没有正在进行的通话');return;}
  showDesktopPetFeedback('正在关闭通话…');disconnectVoiceSession();
}
avatarViewport?.addEventListener('dblclick',event=>{
  if(isCompactPet()&&event.target?.tagName==='CANVAS')startDesktopPetVoice();
});
avatarViewport?.addEventListener('contextmenu',event=>{
  if(!isCompactPet()||event.target?.tagName!=='CANVAS')return;
  event.preventDefault();desktopPetApi?.openMenu?.();
});
desktopPetApi?.onCommand?.(command=>{
  if(command==='connect')ensureDesktopPetConnection();
  else if(command==='enable-microphone')enableDesktopPetMicrophone();
  else if(command==='mute-microphone')muteDesktopPetMicrophone();
  else if(command==='disconnect')stopDesktopPetVoice();
  else if(command==='react-happy'||command==='react-angry'||command==='react-greet'){
    const accepted=avatar?.interact?.(command.slice(6));
    if(!accepted)showDesktopPetFeedback('动作尚未就绪，或上一个动作正在播放');
  }
});
const releaseAttention=()=>avatar?.setPointer?.({x:.5,y:.5,active:false});
function avatarPointer(event){
  if(petPointer&&event.pointerId===petPointer.pointerId){
    if(Math.hypot(event.clientX-petPointer.startX,event.clientY-petPointer.startY)>5)petPointer.moved=true;
    desktopPetApi?.moveDrag?.(petPoint(event));
  }
  const rect=avatarViewport.getBoundingClientRect();
  if(rect.width>0&&rect.height>0)avatar?.setPointer?.({
    x:Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width)),
    y:Math.max(0,Math.min(1,(event.clientY-rect.top)/rect.height)),active:true});
}
function refreshInteractionControls(){
  const supported=typeof avatar?.interact==='function'&&Boolean(avatar?.asset||avatar?.vrm);
  for(const id of ['avatarGreet','avatarAcknowledge'])if($(id))$(id).disabled=!supported;
  if($('interactionHint'))$('interactionHint').hidden=!supported;
  if($('avatarReaction'))$('avatarReaction').disabled=!supported;
}
avatarViewport?.addEventListener('pointermove',avatarPointer,{passive:true});
avatarViewport?.addEventListener('pointerleave',releaseAttention);
avatarViewport?.addEventListener('pointercancel',releaseAttention);
avatarViewport?.addEventListener('click',event=>{
  if(event.target?.tagName!=='CANVAS'||suppressPetClick)return;
  avatarPointer(event);avatar?.interact?.('greet');
});
window.addEventListener('blur',releaseAttention);
document.addEventListener('visibilitychange',()=>{if(document.hidden)releaseAttention();});
motionPreference?.addEventListener?.('change',event=>avatar?.setReducedMotion?.(event.matches));
if($('avatarGreet'))$('avatarGreet').onclick=()=>avatar?.interact?.('greet');
if($('avatarAcknowledge'))$('avatarAcknowledge').onclick=()=>avatar?.interact?.('acknowledge');
if($('avatarReaction'))$('avatarReaction').onchange=event=>{
  const kind=event.target.value;if(!kind)return;
  if(!avatar?.interact?.(kind)){$('avatarStatus').hidden=false;$('avatarStatus').textContent='请等当前动作结束后再试；减少动态效果模式下不播放手势。';}
  else $('avatarStatus').hidden=true;
  event.target.value='';
};
refreshInteractionControls();
if(avatar?.stats.layerCount>0)avatar.interact?.('greet');
let previous=performance.now(),diagnosticAt=0;
function render(now){
  const deltaSeconds=Math.max(0,(now-previous)/1000);previous=now;
  try{
    avatar?.setActivity?.(userSpeaking?'listening':agentBusy?'thinking':'idle');
    avatar?.update({deltaSeconds,...(audio?.position||{sequence:0,sampleOffset:0,sampleRateHz:24000,streamId:'assistant',playing:false})});
    refreshExperienceView();
    $('fps').textContent=(avatar?.stats.fps||0).toFixed(0)+' FPS';
  }catch(e){diagnostic['渲染错误']=e.message;}
  if(now-diagnosticAt>250&&Number.isFinite(avatar?.stats.mouthOpen)){
    diagnosticAt=now;
    diagnostic['口型开合']=avatar.stats.mouthOpen.toFixed(2)+' · 本次峰值 '+avatar.stats.peakMouthOpen.toFixed(2);
    diagnostic['动画事件']=avatar.stats.acceptedAnimationEvents;
    if(Number.isFinite(avatar.stats.leftHand)&&Number.isFinite(avatar.stats.rightHand))diagnostic['左右手动作']=avatar.stats.leftHand.toFixed(2)+' / '+avatar.stats.rightHand.toFixed(2);
    else delete diagnostic['左右手动作'];
    if(Number.isFinite(avatar.stats.layerCount))diagnostic['独立图层']=avatar.stats.layerCount;
    if(Number.isFinite(avatar.stats.gazeX))diagnostic['视线跟随']=avatar.stats.gazeX.toFixed(2)+' / '+avatar.stats.gazeY.toFixed(2);
    if(Number.isFinite(avatar.stats.headTilt))diagnostic['头部侧倾']=avatar.stats.headTilt.toFixed(2);
    if(typeof avatar.stats.bodyState==='string')diagnostic['数字人状态']=avatar.stats.bodyState;
    if(avatar.stats.bodyClip)diagnostic['当前动作']=avatar.stats.bodyClip;
    if(avatar.stats.emotion)diagnostic['当前表情']=avatar.stats.emotion;
    showDiagnostics();
  }
  requestAnimationFrame(render);
}
requestAnimationFrame(render);
$('modelFile').onchange=async event=>{
  const file=event.target.files[0];if(!file)return;
  const generation=++characterLoadGeneration;
  pendingAvatar?.dispose();pendingAvatar=null;
  let candidate=null;
  $('avatarStatus').hidden=false;$('avatarStatus').textContent='正在加载本地模型…';
  try{
    // Load on a detached canvas so a failed VRM import cannot blank or replace
    // the current illustration/VRM. Only an accepted complete load is swapped.
    const canvas=document.createElement('canvas');canvas.id='avatar';
    candidate=new AvatarRenderer(canvas,{framing:viewFraming});pendingAvatar=candidate;
    const model=await candidate.loadFile(file);
    if(!model||generation!==characterLoadGeneration){candidate.dispose();return;}
    candidate.setExpression('neutral',0);candidate.setView({yaw:0,framing:viewFraming});
    const previousAvatar=avatar,previousCanvas=$('avatar');
    $('avatar').replaceWith(canvas);
    try{candidate.resize();}catch(e){canvas.replaceWith(previousCanvas);throw e;}
    avatar=candidate;candidate=null;pendingAvatar=null;
    refreshInteractionControls();
    try{previousAvatar?.dispose();}catch(e){diagnostic['旧角色释放错误']=e.message;}
    character=null;viewYaw=0;characterControls(true);
    $('avatarName').textContent=model.meta?.name||file.name;
    $('avatarDescription').textContent='本地导入 · '+file.name;
    const authors=Array.isArray(model.meta?.authors)?model.meta.authors.filter(value=>typeof value==='string').join('、'):model.meta?.author;
    $('avatarCredit').textContent=typeof authors==='string'&&authors.trim()?'模型作者：'+authors:'本地模型 · 作者信息未提供';
    $('avatarStatus').hidden=true;delete diagnostic['角色错误'];delete diagnostic['角色版本'];diagnostic['展示形式']='3D VRM · 本地导入';showDiagnostics();
  }catch(e){
    candidate?.dispose();
    if(generation===characterLoadGeneration){characterError('本地模型加载失败：'+e.message+'；未替换当前角色。');error('本地模型加载失败：'+e.message);}
  }finally{if(generation===characterLoadGeneration){pendingAvatar=null;event.target.value='';}}
};
for(const button of viewButtons)button.onclick=()=>{try{applyView(Number(button.dataset.avatarYaw)*Math.PI/2);}catch(e){characterError('视角切换失败：'+e.message);}};
$('framing').onchange=event=>{try{applyView(viewYaw,event.target.value);}catch(e){characterError('取景切换失败：'+e.message);}};
function controls(value){
  ready=value;for(const id of ['send','mic','interrupt'])$(id).disabled=!value;$('disconnect').disabled=!ws;refreshExperienceView();
  if(value&&!connecting&&desktopPetMode&&desktopMicrophoneRequested&&!micOn&&!microphonePending)queueMicrotask(enableDesktopPetMicrophone);
}
function send(value){if(ws?.readyState===WebSocket.OPEN)ws.send(typeof value==='string'||value instanceof ArrayBuffer?value:JSON.stringify(value));}
function endLocalSession(generation){
  if(generation!==connectionGeneration)return;
  ++connectionGeneration;ws=null;controls(false);$('connect').disabled=false;
  $('state').textContent='连接已结束';const closingAudio=audio;audio=null;
  closingAudio?.close().catch(e=>{diagnostic['音频关闭错误']=e.message;showDiagnostics();});
  avatar?.reset();agentBusy=false;userSpeaking=false;micOn=false;muted=false;assistantMessage=null;lastSequence=-1;
  connecting=false;microphonePending=false;desktopMicrophoneRequested=false;experienceError=false;presentationBefore=0;presentationSequence=-1;
  experience.clearSubmissions();$('preview').textContent='';$('mic').textContent='开启麦克风';
  diagnostic['播放缓冲(ms)']=0;diagnostic['已播放样本']=0;showDiagnostics();
  refreshExperienceView();
}
$('connect').onclick=async()=>{
  $('connect').disabled=true;
  const generation=++connectionGeneration;
  experience.reset();agentBusy=false;userSpeaking=false;muted=false;micOn=false;assistantMessage=null;lastSequence=-1;
  connecting=true;microphonePending=false;presentationBefore=0;presentationSequence=-1;experienceError=false;refreshExperienceView();
  for(const key of ['延迟起点','首文字 / PCM包 / 实际PCM消费','当前回答最大播放缓冲','停止：取消回执 / PCM停止'])delete diagnostic[key];
  try{
    audio=new LocalAudio(position=>{
      if(generation!==connectionGeneration)return;
      experience.playback(position);refreshExperienceDiagnostics();
      refreshExperienceView();
      if(ready)$('state').textContent=position.playing?'正在说话':agentBusy?'正在思考…':'已连接 · 可以提问';
      if(position.queuedSamples!==undefined){diagnostic['播放缓冲(ms)']=Math.round(position.queuedSamples/24);diagnostic['已播放样本']=position.sampleOffset;showDiagnostics();}
    },message=>{if(generation===connectionGeneration)error(message);},frame=>avatar?.queueAudio?.(frame));
    await audio.start();
    const response=await fetch('/api/session',{method:'POST'});
    const session=await response.json();if(!response.ok)throw Error(session.error);
    ws=new WebSocket(session.url);ws.binaryType='arraybuffer';
    ws.onopen=()=>send({role:'client',session:session.session,token:session.token});
    ws.onmessage=({data})=>{
      if(generation!==connectionGeneration)return;
      try{
        const message=JSON.parse(data);
        experience.message(message);refreshExperienceDiagnostics();
        const sequenced=Number.isSafeInteger(message.sequence)&&message.sequence>=0;
        if(message.type!=='cancel'&&sequenced&&message.sequence<presentationBefore)return;
        const responseText=message.type==='text'&&message.channel==='response_in';
        const responseLifecycle=message.type==='event'&&/^muxiva\.agent\.response\./.test(message.topic);
        if((responseText||responseLifecycle)&&sequenced&&message.sequence<presentationSequence)return;
        if(sequenced&&(responseText||(responseLifecycle&&message.topic==='muxiva.agent.response.started')))
          presentationSequence=Math.max(presentationSequence,message.sequence);
        if(message.type==='session'){
          $('state').textContent=({starting:'启动本地模型中…','media-ready':'媒体节点已连接','runtime-ready':'已连接 · 可以提问',closed:'会话已结束'})[message.status]||message.status;
          if(message.status==='media-ready')controls(true);
          if(message.status==='runtime-ready'){
            connecting=false;
            if(desktopPetMode&&desktopMicrophoneRequested&&!micOn&&!microphonePending)queueMicrotask(enableDesktopPetMicrophone);
          }
        }else if(message.type==='audio')audio.add(message);
        else if(message.type==='cancel'){
          if(Number.isSafeInteger(message.before_sequence)&&message.before_sequence>=0){
            presentationBefore=Math.max(presentationBefore,message.before_sequence);
            audio.cancel(presentationBefore);avatar?.reset({beforeSequence:presentationBefore});
            if(presentationSequence<presentationBefore){assistantMessage=null;agentBusy=false;userSpeaking=false;}
          }
        }
        else if(message.type==='text'){
          if(message.channel==='preview_in')$('preview').textContent='听到：'+message.text;
          else if(message.channel==='transcript_in'){addMessage('user',message.text);$('preview').textContent='';}
          else {
            if(responseText)avatar?.queueText?.({streamId:'assistant',sequence:message.sequence,text:message.text});
            if(!assistantMessage||lastSequence!==message.sequence){assistantMessage=addMessage('assistant','');lastSequence=message.sequence;}
            assistantMessage.textContent+=message.text;$('messages').scrollTop=$('messages').scrollHeight;
          }
        }else if(message.type==='event'){
          if(message.topic.startsWith('muxiva.avatar.'))avatar?.queue(message);
          if(message.topic==='muxiva.voice.speech.started')userSpeaking=true;
          if(['muxiva.voice.speech.stopped','muxiva.voice.transcript.completed','muxiva.voice.transcript.rejected'].includes(message.topic))userSpeaking=false;
          if(/error|failed/.test(message.topic))error(message.payload?.message||message.payload?.error||message.topic);
          if(message.topic==='muxiva.agent.response.started'){agentBusy=true;experienceError=false;$('state').textContent='正在思考…';}
          if(message.topic==='muxiva.agent.response.completed'||message.topic==='muxiva.agent.response.failed')agentBusy=false;
        }else if(message.type==='error')error(message.message);
        refreshExperienceView();
      }catch(e){error(e.message);}
    };
    ws.onclose=()=>endLocalSession(generation);
    ws.onerror=()=>{if(generation===connectionGeneration)error('媒体连接错误，请查看本地服务状态。');};
    $('disconnect').disabled=false;
  }catch(e){connecting=false;error(e.message);$('connect').disabled=false;await audio?.close();refreshExperienceView();}
};
$('compose').onsubmit=event=>{event.preventDefault();const text=$('prompt').value.trim();if(!text||!ready)return;experienceError=false;if(!micOn||muted)experience.submitted(text);send({type:'text',text});$('prompt').value='';assistantMessage=null;refreshExperienceView();};
$('prompt').onkeydown=event=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();$('compose').requestSubmit();}};
$('mic').onclick=async()=>{
  if(microphonePending)return;
  const generation=connectionGeneration,microphoneAudio=audio;
  try{
    if(!ready||!microphoneAudio)throw Error('语音会话尚未连接');
    if(!micOn){microphonePending=true;experience.clearSubmissions();refreshExperienceView();const settings=await microphoneAudio.microphone(data=>{
      if(generation!==connectionGeneration)return;
      if(ws?.bufferedAmount<256000)send(data);else if(ws){
        const socket=ws;error('音频连接积压，会话已停止；请重新连接。');endLocalSession(generation);socket.close();
      }
    });if(generation!==connectionGeneration)return;
      micOn=true;muted=false;experienceError=false;diagnostic['麦克风回声消除']=settings.echoCancellation?'启用':'浏览器未报告';showDiagnostics();}
    else{muted=!muted;audio.mute(muted);if(muted)userSpeaking=false;}
    if(desktopPetMode)desktopMicrophoneRequested=micOn&&!muted;
    $('mic').textContent=muted?'恢复麦克风':'静音麦克风';
  }catch(e){if(generation===connectionGeneration){desktopMicrophoneRequested=false;error('麦克风不可用：'+e.message);}}
  finally{if(generation===connectionGeneration){microphonePending=false;refreshExperienceView();}}
};
$('interrupt').onclick=()=>{experience.cancelRequested();send({type:'interrupt'});};
function disconnectVoiceSession(){const socket=ws;send({type:'close'});endLocalSession(connectionGeneration);socket?.close();}
$('disconnect').onclick=disconnectVoiceSession;
window.addEventListener('beforeunload',()=>{send({type:'close'});audio?.close();pendingAvatar?.dispose();avatar?.dispose();});
// Explicit read-only diagnostics surface for local acceptance tests.
window.avatarDiagnostics=()=>({ready,position:audio?.position,renderer:diagnostic['GPU'],fps:avatar?.stats.fps,model:avatar?.meta?.name||avatar?.meta?.title,experience:experience.snapshot(),
  character:character?{name:character.name,version:character.version,asset:character.asset}:null,view:{yaw:viewYaw,framing:viewFraming},
  animation:avatar?.stats.mouthOpen===undefined?null:{mouthOpen:avatar.stats.mouthOpen,peakMouthOpen:avatar.stats.peakMouthOpen,
    acceptedAnimationEvents:avatar.stats.acceptedAnimationEvents,leftHand:avatar.stats.leftHand,rightHand:avatar.stats.rightHand,
    bodyClip:avatar.stats.bodyClip,emotion:avatar.stats.emotion,activeGesture:avatar.stats.activeGesture,animationLoadErrors:avatar.stats.animationLoadErrors}});
