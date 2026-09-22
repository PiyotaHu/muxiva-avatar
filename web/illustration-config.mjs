const record=(value,label,keys)=>{
  if(!value||typeof value!=='object'||Array.isArray(value)||
     ![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw Error(label+' 必须为普通对象');
  for(const key of Object.keys(value))if(!keys.includes(key))throw Error(label+' 包含未知选项：'+key);
  return value;
};
const bounded=(value,label,min,max)=>{
  if(!Number.isFinite(value)||value<min||value>max)throw Error(label+' 超出有效范围');
  return value;
};
const pair=(value,label,min,max)=>{
  if(!Array.isArray(value)||value.length!==2)throw Error(label+' 必须为两个数值');
  // Access both elements explicitly so a sparse array cannot bypass validation.
  return [bounded(value[0],label,min,max),bounded(value[1],label,min,max)];
};
const region=(value,label,withPivot=false)=>{
  const source=record(value,label,withPivot?['center','radius','pivot']:['center','radius']);
  const center=pair(source.center,label+'.center',0,1);
  const radius=pair(source.radius,label+'.radius',0,.5);
  for(let axis=0;axis<2;axis++) {
    if(radius[axis]===0||center[axis]-radius[axis]<0||center[axis]+radius[axis]>1) {
      throw Error(label+' 区域必须非零且完整位于画布内');
    }
  }
  return withPivot?{center,radius,pivot:pair(source.pivot,label+'.pivot',0,1)}:{center,radius};
};
const image=(value,label)=>{
  if(typeof value!=='string'||value.length>300||value!==value.trim()||
     !/^\/assets\/avatar\/[A-Za-z0-9][A-Za-z0-9._-]*\.png$/i.test(value)||value.includes('..')) {
    throw Error(label+' 必须为 /assets/avatar/ 下无编码或跳转的本地 PNG 地址');
  }
  return value;
};
const within=(child,parent,label)=>{
  for(let axis=0;axis<2;axis++) {
    if(child.center[axis]-child.radius[axis]<parent.center[axis]-parent.radius[axis]||
       child.center[axis]+child.radius[axis]>parent.center[axis]+parent.radius[axis]) {
      throw Error(label+' 必须位于 head 区域内');
    }
  }
};
const rectangle=(value,label)=>{
  if(!Array.isArray(value)||value.length!==4)throw Error(label+' 必须为四个数值');
  const result=Array.from({length:4},(_,i)=>bounded(value[i],label,0,1));
  if(result[2]<=0||result[3]<=0||result[0]+result[2]>1+1e-9||result[1]+result[3]>1+1e-9)
    throw Error(label+' 必须为画布内非零矩形');
  return result;
};
const layerName=(value,label)=>{
  if(typeof value!=='string'||!/^[A-Za-z][A-Za-z0-9_-]{0,39}$/.test(value)||['constructor','prototype','__proto__'].includes(value))
    throw Error(label+' 必须为安全的唯一图层名称');
  return value;
};
function layers(input) {
  if(!Array.isArray(input)||input.length<1||input.length>16)throw Error('layers 必须包含 1–16 个图层');
  const names=new Set();
  const result=Array.from(input,(value,index)=>{
    const label='layers['+index+']';
    const source=record(value,label,['name','image','bounds','sourceRect','pivot','parent','z','motion','face','faceSourceRect','chromaKey','chromaTolerance','elbow','wrist']);
    const name=layerName(source.name,label+'.name');
    if(names.has(name))throw Error('layers 名称重复');
    names.add(name);
    if(!['body','head','leftArm','rightArm','leftHair','rightHair','skirt','legs'].includes(source.motion))throw Error(label+'.motion 不支持');
    const output={name,image:image(source.image,label+'.image'),bounds:rectangle(source.bounds,label+'.bounds'),
      pivot:pair(source.pivot,label+'.pivot',0,1),z:bounded(source.z,label+'.z',-100,100),motion:source.motion};
    if(source.parent!==undefined)output.parent=layerName(source.parent,label+'.parent');
    if(source.sourceRect!==undefined)output.sourceRect=rectangle(source.sourceRect,label+'.sourceRect');
    if(source.face!==undefined){
      if(source.face!=='original'||source.motion!=='head')throw Error(label+'.face 仅支持头部原始表情纹理');
      output.face='original';
    }
    if(source.faceSourceRect!==undefined){
      if(output.face!=='original')throw Error(label+'.faceSourceRect 需要 face');
      output.faceSourceRect=rectangle(source.faceSourceRect,label+'.faceSourceRect');
    }
    if(source.chromaKey!==undefined){
      if(!Array.isArray(source.chromaKey)||source.chromaKey.length!==3)throw Error(label+'.chromaKey 必须为 RGB 三元组');
      output.chromaKey=Array.from({length:3},(_,i)=>bounded(source.chromaKey[i],label+'.chromaKey',0,1));
      output.chromaTolerance=source.chromaTolerance===undefined?.18:bounded(source.chromaTolerance,label+'.chromaTolerance',0,.5);
    }else if(source.chromaTolerance!==undefined)throw Error(label+'.chromaTolerance 需要 chromaKey');
    if(source.elbow!==undefined||source.wrist!==undefined){
      if(!['leftArm','rightArm'].includes(source.motion))throw Error(label+' 只有手臂可配置 elbow/wrist');
      for(const joint of ['elbow','wrist']){
        const point=pair(source[joint],label+'.'+joint,0,1);
        for(let axis=0;axis<2;axis++)if(point[axis]<output.bounds[axis]||point[axis]>output.bounds[axis]+output.bounds[axis+2])
          throw Error(label+'.'+joint+' 必须位于图层 bounds 内');
        output[joint]=point;
      }
    }
    return output;
  });
  const byName=new Map(result.map(layer=>[layer.name,layer]));
  for(const layer of result){
    const seen=new Set([layer.name]);let parent=layer.parent;
    while(parent!==undefined){
      if(!byName.has(parent))throw Error('layers parent 不存在');
      if(seen.has(parent))throw Error('layers parent 不能有环');
      seen.add(parent);parent=byName.get(parent).parent;
    }
  }
  return result;
}

/**
 * Local 2.5D artwork metadata, independent of character identity and speech.
 * UV origin is the top-left corner. Radius is an axis-aligned half-extent.
 * The renderer must also check that all decoded PNG dimensions equal size.
 * No loading or mutation takes place here; the result is an independent clone.
 */
export function validateIllustrationConfig(value) {
  const source=record(value,'插画配置',['schemaVersion','kind','name','images','size','rig','layers']);
  if(source.schemaVersion!==1||source.kind!=='illustration')throw Error('不支持的插画配置版本或类型');
  if(typeof source.name!=='string'||!source.name.trim()||source.name.length>120)throw Error('插画名称必须为非空文本');
  const images=record(source.images,'images',['neutral','blink','speaking','eyeWhite','smile']);
  const size=pair(source.size,'size',16,4096);
  if(!size.every(Number.isInteger))throw Error('size 必须为整数像素尺寸');
  const input=record(source.rig,'rig',['head','leftHand','rightHand','bodyPivot','hair','skirt','eyes','mouth','iris','face','neck','headRelief']);
  if(!Array.isArray(input.eyes)||input.eyes.length!==2)throw Error('rig.eyes 必须包含两个眼睛区域');
  const rig={head:region(input.head,'rig.head',true),
    leftHand:region(input.leftHand,'rig.leftHand',true),rightHand:region(input.rightHand,'rig.rightHand',true),
    bodyPivot:pair(input.bodyPivot,'rig.bodyPivot',0,1),hair:region(input.hair,'rig.hair'),skirt:region(input.skirt,'rig.skirt'),
    eyes:[region(input.eyes[0],'rig.eyes[0]'),region(input.eyes[1],'rig.eyes[1]')],mouth:region(input.mouth,'rig.mouth')};
  rig.eyes.forEach((eye,index)=>within(eye,rig.head,'rig.eyes['+index+']'));
  within(rig.mouth,rig.head,'rig.mouth');
  if(input.face!==undefined){rig.face=region(input.face,'rig.face');within(rig.face,rig.head,'rig.face');}
  if(input.headRelief!==undefined){
    if(!rig.face||!Array.isArray(source.layers)||!source.layers.some(layer=>layer?.motion==='head'&&layer.face==='original'))
      throw Error('rig.headRelief 需要 face 和使用原始表情纹理的 head 图层');
    rig.headRelief=bounded(input.headRelief,'rig.headRelief',0,1);
  }
  if(images.smile!==undefined&&(!rig.face||!Array.isArray(source.layers)||!source.layers.some(layer=>layer?.motion==='head'&&layer.face==='original')))
    throw Error('images.smile 需要 face 和使用原始表情纹理的 head 图层');
  if(input.neck!==undefined){rig.neck=region(input.neck,'rig.neck');within(rig.neck,rig.head,'rig.neck');}
  if(input.iris!==undefined){
    if(!Array.isArray(input.iris)||input.iris.length!==2)throw Error('rig.iris 必须包含两个虹膜区域');
    rig.iris=Array.from(input.iris,(value,index)=>region(value,'rig.iris['+index+']'));
    rig.iris.forEach((iris,index)=>within(iris,rig.eyes[index],'rig.iris['+index+']'));
    if(images.eyeWhite===undefined)throw Error('rig.iris 需要独立 eyeWhite 眼白底图');
  }else if(images.eyeWhite!==undefined)throw Error('eyeWhite 需要 rig.iris');
  return {schemaVersion:1,kind:'illustration',name:source.name.trim(),
    images:{neutral:image(images.neutral,'images.neutral'),blink:image(images.blink,'images.blink'),
      speaking:image(images.speaking,'images.speaking'),
      ...(images.eyeWhite===undefined?{}:{eyeWhite:image(images.eyeWhite,'images.eyeWhite')}),
      ...(images.smile===undefined?{}:{smile:image(images.smile,'images.smile')})},size,rig,
    ...(source.layers===undefined?{}:{layers:layers(source.layers)})};
}
