const record=(value,label)=>{
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error(label+' 必须为对象');
  return value;
};
const known=(value,keys,label)=>{
  for(const key of Object.keys(value))if(!keys.includes(key))throw Error(label+' 包含未知选项：'+key);
};
const text=(value,label,max=500)=>{
  if(typeof value!=='string'||!value.trim()||value.length>max)throw Error(label+' 必须为非空文本');
  return value.trim();
};
const number=(value,label,min,max)=>{
  if(!Number.isFinite(value)||value<min||value>max)throw Error(label+' 超出有效范围');
  return value;
};

/** Explicit preview selection; URL input never becomes an arbitrary file path. */
export function resolveCharacterConfigUrl(search='') {
  if(typeof search!=='string'||(search!==''&&!search.startsWith('?')))throw Error('角色预览参数无效');
  const names=new URLSearchParams(search).getAll('character');
  if(names.length===0)return '/assets/avatar/character.json';
  if(names.length!==1||names[0]!=='character')throw Error('角色预览仅支持当前本地角色名称');
  return '/assets/avatar/'+names[0]+'.json';
}

const IDLE_PREVIEWS = Object.freeze({
  original: '/assets/avatar/animations/rocketbox-idle.vrma',
  '2': '/assets/avatar/animations/rocketbox-idle-2.vrma',
  '3': '/assets/avatar/animations/rocketbox-idle-3.vrma',
  '4': '/assets/avatar/animations/rocketbox-idle-4.vrma'
});

/** Local presentation-only override; it never becomes an arbitrary asset path. */
export function applyIdleAnimationPreview(character,search='') {
  const values=new URLSearchParams(search).getAll('idlePreview');
  if(values.length===0)return character;
  if(values.length!==1||!Object.hasOwn(IDLE_PREVIEWS,values[0]))throw Error('待机动作预览参数无效');
  if(character?.renderer?.type!=='vrm'||!character.renderer.animation?.clips)throw Error('待机动作预览仅支持 VRM 角色');
  const copy=structuredClone(character);
  copy.renderer.animation.clips.idle=IDLE_PREVIEWS[values[0]];
  copy.version+=` · idle-${values[0]}`;
  return copy;
}

export const idleAnimationPreviews=()=>({...IDLE_PREVIEWS});

/** Local application asset configuration; no model or character policy in the renderer. */
export function validateCharacterConfig(value) {
  const source=record(value,'角色配置');
  known(source,['schemaVersion','name','description','asset','renderer','expression','credit','version'],'角色配置');
  if(source.schemaVersion!==1)throw Error('不支持的角色配置版本');
  const renderer={...record(source.renderer,'renderer')};
  renderer.type=renderer.type===undefined?'vrm':renderer.type;
  if(!['vrm','illustration'].includes(renderer.type))throw Error('renderer.type 必须为 vrm 或 illustration');
  known(renderer,renderer.type==='vrm'
    ?['type','framing','pixelRatio','framePadding','mouthExpression','mouthScale','motion','animation','face','cues']
    :['type','framing','pixelRatio','framePadding','mouthScale','motion'],'renderer');
  const asset=text(source.asset,'角色资源地址');
  if(renderer.type==='illustration') {
    if(asset!==source.asset||!/^\/assets\/avatar\/[A-Za-z0-9][A-Za-z0-9._-]*\.json$/i.test(asset)||asset.includes('..')) {
      throw Error('插画资源必须为 /assets/avatar/ 下不含编码或跳转的本地 JSON 地址');
    }
  } else if(!/^\/assets\/avatar\/[A-Za-z0-9][A-Za-z0-9._/-]*\.vrm$/i.test(asset)||
     asset.split('/').slice(1).some(part=>part===''||part==='.'||part==='..')) {
    throw Error('角色资源必须为 /assets/avatar/ 下不含路径跳转的本地 VRM 地址');
  }
  if(!['portrait','full'].includes(renderer.framing))throw Error('framing 必须为 portrait 或 full');
  if(renderer.pixelRatio!==undefined)number(renderer.pixelRatio,'pixelRatio',0.5,3);
  if(renderer.framePadding!==undefined)number(renderer.framePadding,'framePadding',1.02,1.5);
  if(renderer.mouthScale!==undefined)number(renderer.mouthScale,'mouthScale',0,2);
  if(renderer.mouthExpression!==undefined&&(typeof renderer.mouthExpression!=='string'||!/^[A-Za-z][A-Za-z0-9_-]*$/.test(renderer.mouthExpression)))throw Error('mouthExpression 无效');
  if(renderer.animation!==undefined) {
    renderer.animation={...record(renderer.animation,'animation')};
    known(renderer.animation,['clips','states','variants','gestures','variantIntervalSeconds','gestureCooldownSeconds','transitionSeconds','restPoseProfile','poseOffsets'],'animation');
    const clips={...record(renderer.animation.clips,'animation.clips')};renderer.animation.clips=clips;
    for(const [name,url] of Object.entries(clips)) {
      if(!/^[a-z][A-Za-z0-9_-]{0,63}$/.test(name)||typeof url!=='string'||!/^\/assets\/avatar\/[A-Za-z0-9][A-Za-z0-9._/-]*\.vrma$/i.test(url)||url.includes('..'))throw Error('animation 动作资源无效');
    }
    const states={...record(renderer.animation.states,'animation.states')};renderer.animation.states=states;
    for(const [state,name] of Object.entries(states)) {
      if(!['idle','listening','thinking','speaking'].includes(state)||typeof name!=='string'||!Object.hasOwn(clips,name))throw Error('animation 状态映射无效');
    }
    if(renderer.animation.transitionSeconds!==undefined)number(renderer.animation.transitionSeconds,'animation.transitionSeconds',.05,3);
    for(const [field,min,max] of [['variantIntervalSeconds',4,30],['gestureCooldownSeconds',1,15]])
      if(renderer.animation[field]!==undefined)number(renderer.animation[field],field,min,max);
    for(const field of ['variants','gestures'])if(renderer.animation[field]!==undefined){
      renderer.animation[field]=Object.fromEntries(Object.entries(record(renderer.animation[field],field)).map(([key,value])=>{
        const names=Array.isArray(value)?[...value]:[value];
        if(!/^[a-z][A-Za-z0-9_-]{0,63}$/.test(key)||!names.length||names.length>8||names.some(name=>typeof name!=='string'||!Object.hasOwn(clips,name)))throw Error(field+' 动作映射无效');
        if(field==='variants'&&!['idle','listening','thinking','speaking'].includes(key))throw Error('variants 状态无效');
        return [key,names];
      }));
    }
    if(renderer.animation.restPoseProfile!==undefined&&!['relaxedHands'].includes(renderer.animation.restPoseProfile))throw Error('animation.restPoseProfile 无效');
    if(renderer.animation.poseOffsets!==undefined) {
      renderer.animation.poseOffsets=Object.fromEntries(Object.entries(record(renderer.animation.poseOffsets,'animation.poseOffsets')).map(([bone,angles])=>{
        if(!/^[a-z][A-Za-z0-9]*$/.test(bone)||!Array.isArray(angles)||angles.length!==3)throw Error('animation.poseOffsets 骨骼或旋转无效');
        return [bone,angles.map(angle=>number(angle,'animation.poseOffsets 旋转',-.35,.35))];
      }));
    }
  }
  if(renderer.face!==undefined) {
    renderer.face={...record(renderer.face,'face')};known(renderer.face,['emotions'],'face');
    const emotions=Object.fromEntries(Object.entries(record(renderer.face.emotions,'face.emotions')).map(([state,profile])=>[state,{...record(profile,'face 情绪')}]));renderer.face.emotions=emotions;
    for(const [state,profile] of Object.entries(emotions)) {
      if(!/^[a-z][A-Za-z0-9_-]{0,63}$/.test(state))throw Error('face 情绪状态无效');
      const value=record(profile,'face 情绪');known(value,['name','weight'],'face 情绪');
      if(typeof value.name!=='string'||!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value.name))throw Error('face 情绪名称无效');number(value.weight,'face 情绪权重',0,1);
    }
  }
  if(renderer.cues!==undefined){
    if(!Array.isArray(renderer.cues)||renderer.cues.length>16)throw Error('cues 必须为最多16项的列表');
    renderer.cues=renderer.cues.map(cue=>{
      record(cue,'cue');known(cue,['name','phrases','exclude'],'cue');
      if(!Object.hasOwn(renderer.animation?.gestures||{},cue.name)||!Object.hasOwn(renderer.face?.emotions||{},cue.name))throw Error('cue 需要对应动作和表情');
      const strings=(values,label)=>{if(!Array.isArray(values)||values.length>24)throw Error(label+' 无效');return values.map(value=>text(value,label,60));};
      const phrases=strings(cue.phrases,'cue.phrases');if(!phrases.length)throw Error('cue.phrases 不能为空');
      return {name:cue.name,phrases,exclude:strings(cue.exclude||[],'cue.exclude')};
    });
  }
  if(renderer.motion!==undefined) {
    renderer.motion={...record(renderer.motion,'motion')};
    const motion=renderer.motion;
    known(motion,['enabled','breathingAmount','idleAmount','speechAmount','gestureAmount','fingerAmount','gazeAmount','expressionAmount','headYawAmount','headTiltAmount','hipSwayAmount','attentionAmount','activityAmount','interactionAmount','reducedMotion','attackSeconds','releaseSeconds','gestureDelaySeconds','gesturePauseSeconds','gestureAttackSeconds','gestureHoldSeconds','gestureReleaseSeconds','restPose'],'motion');
    if(motion.enabled!==undefined&&typeof motion.enabled!=='boolean')throw Error('motion.enabled 必须为布尔值');
    if(motion.reducedMotion!==undefined&&typeof motion.reducedMotion!=='boolean')throw Error('motion.reducedMotion 必须为布尔值');
    for(const key of ['breathingAmount','idleAmount','speechAmount','gestureAmount','fingerAmount','gazeAmount','expressionAmount','headYawAmount','headTiltAmount','hipSwayAmount','attentionAmount','activityAmount','interactionAmount'])if(motion[key]!==undefined)number(motion[key],key,0,2);
    for(const [key,min,max] of [['gestureDelaySeconds',.15,5],['gesturePauseSeconds',1.5,12],['gestureAttackSeconds',.3,2],['gestureHoldSeconds',.1,2],['gestureReleaseSeconds',.4,2]])if(motion[key]!==undefined)number(motion[key],key,min,max);
    if(motion.attackSeconds!==undefined)number(motion.attackSeconds,'attackSeconds',0.03,2);
    if(motion.releaseSeconds!==undefined)number(motion.releaseSeconds,'releaseSeconds',0.08,3);
    if(motion.restPose!==undefined) {
      motion.restPose=Object.fromEntries(Object.entries(record(motion.restPose,'restPose')).map(([bone,angles])=>{
        if(!/^[a-z][A-Za-z0-9]*$/.test(bone)||!Array.isArray(angles)||angles.length!==3)throw Error('restPose 骨骼或旋转无效');
        return [bone,angles.map(angle=>number(angle,'restPose 旋转',-Math.PI,Math.PI))];
      }));
    }
  }
  const expression={...record(source.expression,'expression')};
  known(expression,['name','weight'],'expression');
  if(typeof expression.name!=='string'||!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(expression.name))throw Error('expression.name 无效');
  number(expression.weight,'expression.weight',0,1);
  return {schemaVersion:1,name:text(source.name,'角色名称',120),description:text(source.description,'角色描述'),
    asset,renderer,expression,credit:text(source.credit,'角色署名',1000),version:text(source.version,'角色版本',40)};
}
