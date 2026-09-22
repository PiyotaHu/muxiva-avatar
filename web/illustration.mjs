import * as THREE from 'three';
import {AvatarTimeline} from './avatar-timeline.mjs';
import {IllustrationMotion} from './illustration-motion.mjs';
import {validateIllustrationConfig} from './illustration-config.mjs';
import {applyHeadSurface} from './illustration-surface.mjs';

const clamp = (value, min=0, max=1) => Math.max(min, Math.min(max, Number.isFinite(value) ? value : 0));
const LOAD_TIMEOUT_MS = 20_000;
const vertexShader = `
uniform float uAspect;
uniform vec4 uHead, uLeftHand, uRightHand, uHair, uSkirt;
uniform vec2 uHeadPivot, uLeftHandPivot, uRightHandPivot, uBodyPivot;
uniform float uHeadYaw, uHeadTilt, uNod, uBodyLean, uBreath;
uniform float uLeftHandLift, uRightHandLift, uHairSway, uSkirtSway;
varying vec2 vSourceUv;
float region(vec2 p, vec4 area) {
  vec2 d=(p-area.xy)/max(area.zw,vec2(.0001));
  return 1.0-smoothstep(.28,1.0,dot(d,d));
}
vec2 rotateAbout(vec2 p, vec2 pivot, float angle) {
  vec2 d=(p-pivot)*vec2(uAspect,1.0);
  float c=cos(angle), s=sin(angle);
  return pivot+vec2(c*d.x-s*d.y,s*d.x+c*d.y)/vec2(uAspect,1.0);
}
void main() {
  // Rig coordinates use top-left image UV. Texture sampling retains Three's
  // bottom-left UV; all three states therefore share exactly one deformation.
  vSourceUv=uv;
  vec2 source=vec2(uv.x,1.0-uv.y), p=source;
  float head=region(source,uHead);
  p+=head*(rotateAbout(source,uHeadPivot,.035*uHeadTilt)-source);
  p.x+=head*(.003*uHeadYaw-.010*abs(uHeadYaw)*(source.x-uHead.x));
  p.y+=head*.0022*uNod;
  float left=region(source,uLeftHand), right=region(source,uRightHand);
  p+=left*(rotateAbout(source,uLeftHandPivot,-.045*uLeftHandLift)-source);
  p+=right*(rotateAbout(source,uRightHandPivot,.045*uRightHandLift)-source);
  p.y-=.0025*(left*uLeftHandLift+right*uRightHandLift);
  float hair=region(source,uHair)*(1.0-.92*head);
  float hairTether=smoothstep(uHair.y-uHair.w,uHair.y+uHair.w,source.y);
  p.x+=.004*uHairSway*hair*hairTether;
  float skirt=region(source,uSkirt);
  float hem=smoothstep(uSkirt.y-uSkirt.w,uSkirt.y+uSkirt.w,source.y);
  p.x+=.003*uSkirtSway*skirt*hem;
  p.y+=.0009*uSkirtSway*skirt*hem*(source.x-uSkirt.x)/max(uSkirt.z,.0001);
  float torso=1.0-smoothstep(.10,.36,abs(source.y-uBodyPivot.y));
  p.x+=(source.x-uBodyPivot.x)*.004*uBreath*torso;
  p.y-=.0014*uBreath*torso;
  p=rotateAbout(p,uBodyPivot,.009*uBodyLean);
  vec3 warped=vec3((p.x-.5)*uAspect,.5-p.y,position.z);
  gl_Position=projectionMatrix*modelViewMatrix*vec4(warped,1.0);
}`;

const fragmentShader = `
uniform sampler2D uNeutral, uBlink, uSpeaking;
uniform vec4 uLeftEye, uRightEye, uMouthRegion;
uniform float uBlinkAmount, uMouthOpen;
varying vec2 vSourceUv;
float region(vec2 p, vec4 area) {
  vec2 d=(p-area.xy)/max(area.zw,vec2(.0001));
  return 1.0-smoothstep(.42,1.0,dot(d,d));
}
void main() {
  vec2 p=vec2(vSourceUv.x,1.0-vSourceUv.y);
  vec4 base=texture2D(uNeutral,vSourceUv);
  float eyes=max(region(p,uLeftEye),region(p,uRightEye));
  float mouth=region(p,uMouthRegion);
  // Never swap the whole portrait: only aligned eye/mouth pixels can change.
  vec4 result=mix(base,texture2D(uBlink,vSourceUv),eyes*uBlinkAmount);
  result=mix(result,texture2D(uSpeaking,vSourceUv),mouth*uMouthOpen);
  gl_FragColor=result;
  #include <colorspace_fragment>
}`;

// Each optional layer has its own parent transform, never a whole-image warp.
const layerVertexShader = `
uniform vec4 uSourceRect, uFaceSourceRect;
uniform mat4 uElbowMatrix, uWristMatrix;
attribute vec2 armWeights;
varying vec2 vLayerUv, vFaceUv;
void main() {
  vec2 topLeft=vec2(uv.x,1.0-uv.y);
  vec2 source=uSourceRect.xy+topLeft*uSourceRect.zw;
  vec2 face=uFaceSourceRect.xy+topLeft*uFaceSourceRect.zw;
  vLayerUv=vec2(source.x,1.0-source.y);
  vFaceUv=vec2(face.x,1.0-face.y);
  vec4 forearm=mix(vec4(position,1.0),uElbowMatrix*vec4(position,1.0),armWeights.x);
  vec4 hand=mix(forearm,uWristMatrix*forearm,armWeights.y);
  gl_Position=projectionMatrix*modelViewMatrix*hand;
}`;
const layerFragmentShader = `
uniform sampler2D uLayer, uNeutral, uBlink, uSpeaking, uEyeWhite, uSmileTexture;
uniform float uHasSmile;
uniform vec4 uLeftEye, uRightEye, uMouthRegion;
uniform vec4 uLeftIris, uRightIris;
uniform float uHasIris;
uniform vec4 uFaceRegion;
uniform float uHasFace;
uniform vec4 uNeckRegion;
uniform float uHasNeck;
uniform float uFaceEnabled, uBlinkAmount, uMouthOpen, uGazeX, uGazeY, uSmile;
uniform float uHasChromaKey, uChromaTolerance;
uniform vec3 uChromaKey;
varying vec2 vLayerUv, vFaceUv;
float region(vec2 p, vec4 area) {
  vec2 d=(p-area.xy)/max(area.zw,vec2(.0001));
  return 1.0-smoothstep(.42,1.0,dot(d,d));
}
vec3 keySrgb(vec3 c) {
  return mix(c*12.92,1.055*pow(max(c,vec3(0.0)),vec3(1.0/2.4))-.055,step(vec3(.0031308),c));
}
vec3 keyLinear(vec3 c) {
  return mix(c/12.92,pow((max(c,vec3(0.0))+.055)/1.055,vec3(2.4)),step(vec3(.04045),c));
}
void main() {
  vec4 base=texture2D(uLayer,vLayerUv);
  if(uHasChromaKey>.5) {
    vec3 srgb=keySrgb(base.rgb);
    float difference=distance(srgb,uChromaKey);
    vec3 dominant=step(vec3(max(uChromaKey.g,uChromaKey.b),max(uChromaKey.r,uChromaKey.b),
      max(uChromaKey.r,uChromaKey.g))+.05,uChromaKey);
    vec3 other=vec3(max(srgb.g,srgb.b),max(srgb.r,srgb.b),max(srgb.r,srgb.g));
    vec3 keyOther=vec3(max(uChromaKey.g,uChromaKey.b),max(uChromaKey.r,uChromaKey.b),max(uChromaKey.r,uChromaKey.g));
    float excess=max(0.0,dot(dominant,srgb-other));
    float keyExcess=max(.1,dot(dominant,uChromaKey-keyOther));
    float matte=smoothstep(uChromaTolerance,uChromaTolerance+.08,difference)*clamp(1.0-excess/keyExcess,0.0,1.0);
    base.a*=matte;
    // Mixed green edges may be far from the exact key. Remove keyed excess
    // there too, while neutral white/grey and non-key skin colours remain.
    base.rgb=keyLinear(max(vec3(0.0),srgb-dominant*excess));
  }
  vec2 p=vec2(vFaceUv.x,1.0-vFaceUv.y);
  // Only the configured head's central neck fades into the complete torso.
  // Lateral hair remains opaque; coordinates follow the original-face UV.
  float neckDown=smoothstep(uNeckRegion.y-uNeckRegion.w,uNeckRegion.y+uNeckRegion.w,p.y);
  float neckCentre=1.0-smoothstep(.6,1.0,abs(p.x-uNeckRegion.x)/max(uNeckRegion.z,.0001));
  base.a*=1.0-uHasNeck*uFaceEnabled*neckDown*neckCentre;
  if(base.a<=.002) discard;
  float smile=clamp(uSmile,0.0,1.0)*uHasSmile;
  vec3 neutralFace=texture2D(uNeutral,vFaceUv).rgb;
  vec3 smilingFace=texture2D(uSmileTexture,vFaceUv).rgb;
  // The optional expression only contributes inside the configured face.
  // Body, hair, silhouette and alpha always come from the approved layers.
  base.rgb=mix(base.rgb,mix(neutralFace,smilingFace,smile),region(p,uFaceRegion)*uHasFace*uFaceEnabled);
  float eyes=max(region(p,uLeftEye),region(p,uRightEye))*uFaceEnabled;
  float mouth=region(p,uMouthRegion)*uFaceEnabled;
  vec3 openEye=texture2D(uNeutral,vFaceUv).rgb;
  if(uHasIris>.5) {
    vec2 leftDelta=uLeftIris.zw*vec2(.55*uGazeX,.40*uGazeY);
    vec2 rightDelta=uRightIris.zw*vec2(.55*uGazeX,.40*uGazeY);
    openEye=texture2D(uEyeWhite,vFaceUv).rgb;
    openEye=mix(openEye,texture2D(uNeutral,vFaceUv+leftDelta*vec2(-1.0,1.0)).rgb,region(p-leftDelta,uLeftIris));
    openEye=mix(openEye,texture2D(uNeutral,vFaceUv+rightDelta*vec2(-1.0,1.0)).rgb,region(p-rightDelta,uRightIris));
  }
  // During a smile retain the painted eyelids. Blink has final precedence;
  // iris following fades to this aligned expression instead of doubling eyes.
  openEye=mix(openEye,smilingFace,smile);
  vec3 eye=mix(openEye,texture2D(uBlink,vFaceUv).rgb,uBlinkAmount);
  vec2 mouthUv=vFaceUv;
  mouthUv.y-=.0015*uSmile*(1.0-uHasSmile)*clamp(abs(p.x-uMouthRegion.x)/max(uMouthRegion.z,.0001),0.0,1.0);
  vec3 closedLips=mix(texture2D(uNeutral,mouthUv).rgb,texture2D(uSmileTexture,mouthUv).rgb,smile);
  // Speech opening is still driven exclusively by actual PCM playback.
  vec3 lips=mix(closedLips,texture2D(uSpeaking,mouthUv).rgb,uMouthOpen);
  base.rgb=mix(base.rgb,eye,eyes);
  base.rgb=mix(base.rgb,lips,mouth);
  gl_FragColor=base;
  #include <colorspace_fragment>
}`;

function area(region) { return new THREE.Vector4(...region.center,...region.radius); }
function rotationAt(matrix,pivot,angle) {
  if(angle===0)return matrix.identity();
  const c=Math.cos(angle),s=Math.sin(angle),x=pivot.x,y=pivot.y;
  return matrix.set(c,-s,0,x-c*x+s*y,s,c,0,y-s*x-c*y,0,0,1,0,0,0,0,1);
}

/** sRGB reference for the explicit colour-key shader and its content check. */
export function illustrationChromaMatte(rgb,key,tolerance=.18) {
  const other=value=>[Math.max(value[1],value[2]),Math.max(value[0],value[2]),Math.max(value[0],value[1])];
  const neighbours=other(rgb),keyNeighbours=other(key);
  const dominant=key.map((value,index)=>value>=keyNeighbours[index]+.05?1:0);
  const excess=Math.max(0,rgb.reduce((sum,value,index)=>sum+dominant[index]*(value-neighbours[index]),0));
  const keyExcess=Math.max(.1,key.reduce((sum,value,index)=>sum+dominant[index]*(value-keyNeighbours[index]),0));
  const distance=Math.hypot(...rgb.map((value,index)=>value-key[index]));
  const edge=clamp((distance-tolerance)/.08),matte=edge*edge*(3-2*edge)*clamp(1-excess/keyExcess);
  return {alpha:matte,rgb:rgb.map((value,index)=>Math.max(0,value-dominant[index]*excess))};
}
function localUrl(value) {
  const base=globalThis.document?.baseURI || globalThis.location?.href || 'http://localhost/';
  const url=new URL(value,base);
  if (!['http:','https:'].includes(url.protocol)||url.origin!==new URL(base).origin)
    throw new Error('Illustration assets must be served by the local application origin');
  return url.href;
}
function disposeTextures(textures) {
  for(const texture of textures) texture.dispose();
  textures.clear();
}

/** GPU-warped illustration, not a Live2D model or a reconstructable 3D head.
 * The app supplies every update and the ACTUAL audio playback sample position.
 */
export class IllustrationRenderer {
  constructor(canvas,{pixelRatio=1.25,framing='full',framePadding=1.06,mouthScale=.8,motion={}}={}) {
    this.canvas=canvas;
    this.options={pixelRatio:clamp(pixelRatio,.5,2),framing:framing==='portrait'?'portrait':'full',
      framePadding:clamp(framePadding,1,1.5),mouthScale:clamp(mouthScale,0,2),motion};
    this.timeline=new AvatarTimeline();
    this.motion=new IllustrationMotion(motion);
    this.scene=new THREE.Scene();
    this.camera=new THREE.OrthographicCamera(-.5,.5,.5,-.5,.01,10);
    this.camera.position.set(0,0,2);
    this.renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true,powerPreference:'low-power'});
    this.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio||1,this.options.pixelRatio));
    this.renderer.outputColorSpace=THREE.SRGBColorSpace;
    this.renderer.setClearColor(0x000000,0);
    this.asset=null; this.meta=null; this.viewYaw=0; this.disposed=false;
    this.loadGeneration=0; this.pendingLoad=null;
    this.elapsed=0; this.nextBlink=2.8; this.mouth=0;
    this.attention={x:0,y:0,active:false};this.activity='idle';
    this.interactionId=0;this.pendingInteraction=null;
    this.expression={name:'neutral',weight:0};
    this.stats={frames:0,seconds:0,fps:0,droppedAnimationFrames:0,
      mouthOpen:0,peakMouthOpen:0,acceptedAnimationEvents:0,headTilt:0,leftHand:0,rightHand:0,
      layerCount:0,gazeX:0,gazeY:0,shoulder:0,hipShift:0,headPitch:0,smile:0};
    this.resizeObserver=new ResizeObserver(()=>this.resize());
    this.resizeObserver.observe(canvas.parentElement||canvas);
    this.resize();
  }

  get fps() { return this.stats.fps; }

  async load(manifestUrl) {
    if(this.disposed) throw new Error('IllustrationRenderer is disposed');
    const generation=++this.loadGeneration;
    this.pendingLoad?.abort();
    const controller=new AbortController();
    this.pendingLoad=controller;
    const state={cancelled:false,textures:new Set()};
    const stale=()=>this.disposed||generation!==this.loadGeneration||state.cancelled;
    let rejectAbort;
    const aborted=new Promise((_,reject)=>{rejectAbort=reject;});
    const onAbort=()=>{
      state.cancelled=true; disposeTextures(state.textures);
      rejectAbort(new Error('Illustration loading was cancelled'));
    };
    controller.signal.addEventListener('abort',onAbort,{once:true});
    let timeout;
    const deadline=new Promise((_,reject)=>{
      timeout=setTimeout(()=>reject(new Error('Illustration loading exceeded 20 seconds')),LOAD_TIMEOUT_MS);
      timeout.unref?.();
    });
    const work=(async()=>{
      const response=await fetch(localUrl(manifestUrl),{signal:controller.signal,credentials:'same-origin',cache:'no-cache'});
      if(!response.ok) throw new Error(`Illustration manifest request failed (${response.status})`);
      const config=validateIllustrationConfig(await response.json());
      if(stale()) return null;
      const maximum=this.renderer.capabilities?.maxTextureSize || 4096;
      if(config.size.some(size=>size>maximum)) throw new Error('Illustration exceeds the GPU texture limit');
      const loader=new THREE.TextureLoader(),required=new Map();
      for(const [name,url] of Object.entries(config.images))required.set(url,{name,fullSize:true});
      for(const layer of config.layers||[])if(!required.has(layer.image))required.set(layer.image,{name:layer.name,fullSize:false});
      const entries=await Promise.all([...required].map(async([url,{name,fullSize}])=>{
        const texture=await loader.loadAsync(localUrl(url));
        if(stale()) { texture.dispose(); return null; }
        state.textures.add(texture);
        const image=texture.image, width=image?.naturalWidth||image?.width, height=image?.naturalHeight||image?.height;
        if(!Number.isInteger(width)||!Number.isInteger(height)||width<=0||height<=0||width>maximum||height>maximum)
          throw new Error(`Illustration ${name} exceeds the GPU texture limit`);
        if(fullSize&&(width!==config.size[0]||height!==config.size[1]))
          throw new Error(`Illustration ${name} dimensions do not match the manifest`);
        texture.colorSpace=THREE.SRGBColorSpace;
        texture.minFilter=THREE.LinearFilter; texture.magFilter=THREE.LinearFilter;
        texture.wrapS=texture.wrapT=THREE.ClampToEdgeWrapping;
        texture.generateMipmaps=false; texture.needsUpdate=true;
        return [url,texture];
      }));
      if(stale()) return null;
      const byUrl=new Map(entries);
      for(const url of new Set((config.layers||[]).map(layer=>layer.image))) {
        this._validateLayerMatte(byUrl.get(url),config.layers.filter(layer=>layer.image===url));
      }
      return {config,textures:Object.fromEntries(Object.entries(config.images).map(([name,url])=>[name,byUrl.get(url)])),byUrl};
    })();
    try {
      const loaded=await Promise.race([work,aborted,deadline]);
      if(!loaded||stale()) return null;
      const candidate=this._createIllustration(loaded.config,loaded.textures,loaded.byUrl);
      this._releaseIllustration();
      this.asset=candidate;
      this.meta={metaVersion:'illustration-1',name:loaded.config.name,kind:'illustration'};
      this.scene.add(candidate.mesh);
      state.textures.clear(); // Ownership transfers to the installed asset.
      this.motion?.reset({immediate:true});
      this.motion=new IllustrationMotion(this.options.motion);
      this.pendingInteraction=null;
      this.mouth=0; this.elapsed=0; this.nextBlink=2.8;
      this._updatePoseStats();
      this._frameIllustration();
      return {meta:this.meta,kind:'illustration',size:[...loaded.config.size],expressionNames:['neutral','portraitSmile']};
    } catch(error) {
      state.cancelled=true; disposeTextures(state.textures);
      controller.abort();
      if(this.disposed||generation!==this.loadGeneration) return null;
      throw error;
    } finally {
      clearTimeout(timeout);
      controller.signal.removeEventListener('abort',onAbort);
      if(this.pendingLoad===controller) this.pendingLoad=null;
      if(!this.asset||generation!==this.loadGeneration||state.cancelled) disposeTextures(state.textures);
    }
  }

  _createIllustration(config,textures,byUrl) {
    if(config.layers?.length)return this._createLayeredIllustration(config,textures,byUrl);
    const aspect=config.size[0]/config.size[1], rig=config.rig;
    const uniforms={uAspect:{value:aspect},uNeutral:{value:textures.neutral},uBlink:{value:textures.blink},
      uSpeaking:{value:textures.speaking},uHead:{value:area(rig.head)},uHeadPivot:{value:new THREE.Vector2(...rig.head.pivot)},
      uLeftHand:{value:area(rig.leftHand)},uLeftHandPivot:{value:new THREE.Vector2(...rig.leftHand.pivot)},
      uRightHand:{value:area(rig.rightHand)},uRightHandPivot:{value:new THREE.Vector2(...rig.rightHand.pivot)},
      uHair:{value:area(rig.hair)},uSkirt:{value:area(rig.skirt)},uBodyPivot:{value:new THREE.Vector2(...rig.bodyPivot)},
      uLeftEye:{value:area(rig.eyes[0])},uRightEye:{value:area(rig.eyes[1])},uMouthRegion:{value:area(rig.mouth)},
      uHasIris:{value:rig.iris?1:0},uLeftIris:{value:area(rig.iris?.[0]||rig.eyes[0])},
      uRightIris:{value:area(rig.iris?.[1]||rig.eyes[1])}};
    for(const name of ['HeadYaw','HeadTilt','Nod','BodyLean','Breath','LeftHandLift','RightHandLift','HairSway','SkirtSway','BlinkAmount','MouthOpen',
      'GazeX','GazeY','Shoulder','HipShift','HeadPitch','Smile'])
      uniforms['u'+name]={value:0};
    const geometry=new THREE.PlaneGeometry(aspect,1,80,128);
    let material;
    try {
      material=new THREE.ShaderMaterial({uniforms,vertexShader,fragmentShader,transparent:true,
        depthWrite:false,depthTest:false,toneMapped:false,side:THREE.FrontSide});
      const mesh=new THREE.Mesh(geometry,material);
      mesh.frustumCulled=false;
      return {config,textures,uniforms,geometry,material,mesh,aspect};
    } catch(error) {geometry.dispose();material?.dispose();throw error;}
  }

  _validateLayerMatte(texture,layers) {
    const image=texture.image,width=image.naturalWidth||image.width,height=image.naturalHeight||image.height;
    let canvas,data=image.data;
    try {
      if(!(data instanceof Uint8Array||data instanceof Uint8ClampedArray)||data.length!==width*height*4) {
        if(!globalThis.document?.createElement)throw new Error('Layer matte inspection requires a readable local image');
        canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
        const context=canvas.getContext('2d',{willReadFrequently:true});
        if(!context)throw new Error('Cannot inspect illustration layer alpha');
        context.drawImage(image,0,0);data=context.getImageData(0,0,width,height).data;
      }
      for(const layer of layers) {
        const [x,y,w,h]=layer.sourceRect||layer.bounds;
        const left=Math.max(0,Math.floor(x*width)),top=Math.max(0,Math.floor(y*height));
        const right=Math.min(width,Math.ceil((x+w)*width)),bottom=Math.min(height,Math.ceil((y+h)*height));
        const key=layer.chromaKey,tolerance=layer.chromaTolerance??.18;
        let background=false,visible=false;
        for(let row=top;row<bottom&&!(background&&visible);row++)for(let col=left;col<right;col++) {
          const offset=(row*width+col)*4,alpha=data[offset+3];
          if(key) {
            const distance=Math.hypot(data[offset]/255-key[0],data[offset+1]/255-key[1],data[offset+2]/255-key[2]);
            if(alpha>0&&distance<=tolerance)background=true;
            if(alpha>0&&illustrationChromaMatte([data[offset]/255,data[offset+1]/255,data[offset+2]/255],key,tolerance).alpha>.1)visible=true;
          } else {
            if(alpha<255)background=true;
            if(alpha>0)visible=true;
          }
          if(background&&visible)break;
        }
        if(!background||!visible)throw new Error('Layer '+layer.name+(key
          ?' must contain the explicit chroma background and visible non-key content'
          :' must contain real alpha and visible content; opaque rectangles are not layers'));
      }
    } finally {if(canvas){canvas.width=0;canvas.height=0;}}
  }

  _createLayeredIllustration(config,textures,byUrl) {
    const aspect=config.size[0]/config.size[1],rig=config.rig;
    const root=new THREE.Group(),layers=new Map(),geometries=[],materials=[];
    const uniforms={uNeutral:{value:textures.neutral},uBlink:{value:textures.blink},uSpeaking:{value:textures.speaking},
      uHasSmile:{value:textures.smile?1:0},uSmileTexture:{value:textures.smile||textures.neutral},
      uLeftEye:{value:area(rig.eyes[0])},uRightEye:{value:area(rig.eyes[1])},uMouthRegion:{value:area(rig.mouth)},
      uHasIris:{value:rig.iris&&textures.eyeWhite?1:0},uEyeWhite:{value:textures.eyeWhite||textures.neutral},
      uLeftIris:{value:area(rig.iris?.[0]||rig.eyes[0])},uRightIris:{value:area(rig.iris?.[1]||rig.eyes[1])},
      uHasFace:{value:rig.face?1:0},uFaceRegion:{value:area(rig.face||rig.head)},
      uNeckRegion:{value:area(rig.neck||rig.head)}};
    for(const name of ['HeadYaw','HeadTilt','Nod','BodyLean','Breath','LeftHandLift','RightHandLift','HairSway',
      'SkirtSway','BlinkAmount','MouthOpen','GazeX','GazeY','Shoulder','HipShift','HeadPitch','Smile'])
      uniforms['u'+name]={value:0};
    const sources=byUrl||new Map(Object.entries(config.images).map(([name,url])=>[url,textures[name]]));
    root.name='Illustration layers';
    try {
      for(const definition of config.layers) {
        const texture=sources.get(definition.image);
        if(!texture)throw new Error('Missing loaded layer texture: '+definition.name);
        const [x,y,w,h]=definition.bounds,[px,py]=definition.pivot;
        const anchor=new THREE.Group();anchor.name=definition.name;
        const relief=definition.motion==='head'&&definition.face==='original'?(rig.headRelief||0):0;
        const geometry=new THREE.PlaneGeometry(w*aspect,h,relief?48:8,relief?48:32);geometries.push(geometry);
        if(relief)applyHeadSurface(geometry,{rig,aspect,rect:definition.faceSourceRect||definition.bounds,strength:relief});
        const armWeights=new Float32Array(geometry.attributes.position.count*2);
        let arm=null;
        if(definition.elbow&&definition.wrist&&['leftArm','rightArm'].includes(definition.motion)) {
          const local=point=>new THREE.Vector3((point[0]-x-w/2)*aspect,y+h/2-point[1],0);
          const elbow=local(definition.elbow),wrist=local(definition.wrist),direction=wrist.clone().sub(elbow);
          const length=direction.length();
          if(length<1e-5)throw new Error('Arm elbow and wrist must be distinct: '+definition.name);
          direction.divideScalar(length);
          const smooth=(a,b,v)=>{const t=clamp((v-a)/(b-a));return t*t*(3-2*t);};
          const point=new THREE.Vector3();
          for(let i=0;i<geometry.attributes.position.count;i++) {
            point.fromBufferAttribute(geometry.attributes.position,i);
            armWeights[i*2]=smooth(-length*.12,length*.18,point.clone().sub(elbow).dot(direction));
            armWeights[i*2+1]=smooth(-length*.18,0,point.clone().sub(wrist).dot(direction));
          }
          arm={elbow,wrist,posedWrist:wrist.clone()};
        }
        geometry.setAttribute('armWeights',new THREE.BufferAttribute(armWeights,2));
        const ownUniforms={...uniforms,uLayer:{value:texture},uSourceRect:{value:new THREE.Vector4(...(definition.sourceRect||definition.bounds))},
          uFaceSourceRect:{value:new THREE.Vector4(...(definition.faceSourceRect||definition.bounds))},
          uFaceEnabled:{value:definition.face==='original'?1:0},
          uHasNeck:{value:rig.neck&&definition.motion==='head'?1:0},
          uHasChromaKey:{value:definition.chromaKey?1:0},uChromaKey:{value:new THREE.Vector3(...(definition.chromaKey||[0,0,0]))},
          uChromaTolerance:{value:definition.chromaTolerance??.18},
          uElbowMatrix:{value:new THREE.Matrix4()},uWristMatrix:{value:new THREE.Matrix4()}};
        const material=new THREE.ShaderMaterial({uniforms:ownUniforms,vertexShader:layerVertexShader,fragmentShader:layerFragmentShader,
          transparent:true,depthWrite:false,depthTest:false,toneMapped:false,side:THREE.DoubleSide});
        materials.push(material);
        const mesh=new THREE.Mesh(geometry,material);mesh.name=definition.name+' pixels';
        mesh.position.set((x+w/2-px)*aspect,py-y-h/2,0);
        mesh.renderOrder=definition.z;mesh.frustumCulled=false;anchor.add(mesh);
        layers.set(definition.name,{definition,anchor,mesh,uniforms:ownUniforms,arm,
          restPosition:new THREE.Vector3((px-.5)*aspect,.5-py,0)});
      }
      // Global rest pivots become local offsets; order in the manifest is irrelevant.
      for(const layer of layers.values()) {
        const parent=layer.definition.parent?layers.get(layer.definition.parent):null;
        if(layer.definition.parent&&!parent)throw new Error('Missing layer parent: '+layer.definition.parent);
        const [px,py]=parent?.definition.pivot||[.5,.5];
        layer.restPosition.set((layer.definition.pivot[0]-px)*aspect,py-layer.definition.pivot[1],0);
        layer.anchor.position.copy(layer.restPosition);
        (parent?.anchor||root).add(layer.anchor);
      }
      return {config,textures,textureSet:new Set(sources.values()),uniforms,geometries,materials,mesh:root,layers,aspect};
    } catch(error) {geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());throw error;}
  }

  _applyLayerPose(pose) {
    if(!this.asset?.layers)return;
    const aspect=this.asset.aspect,n=value=>clamp(value,-1,1),relief=Boolean(this.asset.config.rig.headRelief);
    for(const layer of this.asset.layers.values()) {
      const {anchor,definition}=layer;
      anchor.position.copy(layer.restPosition);anchor.rotation.set(0,0,0);anchor.scale.set(1,1,1);
      const side=definition.motion.startsWith('left')?-1:1;
      switch(definition.motion) {
        case 'body':
          anchor.position.x+=.010*aspect*n(pose.hipShift);
          anchor.rotation.z=.022*n(pose.bodyLean);
          anchor.scale.set(1+.007*n(pose.breath),1+.003*n(pose.breath),1);break;
        case 'head':
          anchor.rotation.set((relief?Math.PI/22.5:.095)*n(pose.headPitch),
            (relief?Math.PI/15:.16)*n(pose.headYaw),-.095*n(pose.headTilt));
          anchor.position.x+=.006*aspect*n(pose.gazeX);
          anchor.position.y-=.005*n(pose.nod)+.003*n(pose.headPitch);break;
        case 'leftArm':case 'rightArm': {
          const hand=clamp(side<0?pose.leftHand:pose.rightHand);
          anchor.rotation.z=side*(.32*hand+.035*n(pose.shoulder));
          anchor.position.y+=.004*n(pose.shoulder);
          if(layer.arm) {
            const elbow=layer.uniforms.uElbowMatrix.value,wrist=layer.uniforms.uWristMatrix.value;
            rotationAt(elbow,layer.arm.elbow,side*hand);
            layer.arm.posedWrist.copy(layer.arm.wrist).applyMatrix4(elbow);
            rotationAt(wrist,layer.arm.posedWrist,-side*.17*hand);
          }
          break;
        }
        case 'leftHair':case 'rightHair':
          anchor.rotation.z=.08*n(pose.hair);anchor.position.x+=.003*aspect*n(pose.hair);break;
        case 'skirt':
          anchor.rotation.z=.035*n(pose.skirt);anchor.position.x+=.003*aspect*n(pose.skirt);break;
        case 'legs':break;
      }
    }
  }

  setAttention(value) {
    if(this.disposed||!value||typeof value.active!=='boolean')return false;
    if(value.active&&(!Number.isFinite(value.x)||!Number.isFinite(value.y)||Math.abs(value.x)>1||Math.abs(value.y)>1))return false;
    this.attention=value.active?{x:value.x,y:value.y,active:true}:{x:0,y:0,active:false};return true;
  }

  setPointer(value) {
    if(this.disposed||!value||typeof value.active!=='boolean')return false;
    if(!value.active)return this.setAttention({active:false});
    if(!this.asset||!Number.isFinite(value.x)||!Number.isFinite(value.y)||value.x<0||value.x>1||value.y<0||value.y>1)return false;
    this.camera.updateMatrixWorld(true);this.asset.mesh.updateMatrixWorld(true);
    const point=new THREE.Vector3(value.x*2-1,1-value.y*2,0).unproject(this.camera);
    const {head}=this.asset.config.rig,aspect=this.asset.aspect;
    const layer=this.asset.layers&&[...this.asset.layers.values()].find(layer=>layer.definition.motion==='head');
    const centre=new THREE.Vector3((head.center[0]-.5)*aspect,.5-head.center[1],0);
    const scale=new THREE.Vector3(1,1,1);
    if(layer) {
      centre.set((head.center[0]-layer.definition.pivot[0])*aspect,layer.definition.pivot[1]-head.center[1],0);
      layer.anchor.localToWorld(centre);layer.anchor.getWorldScale(scale);
    }
    return this.setAttention({active:true,x:clamp((point.x-centre.x)/(head.radius[0]*aspect*scale.x*2),-1,1),
      y:clamp((centre.y-point.y)/(head.radius[1]*scale.y*2),-1,1)});
  }

  setReducedMotion(value) {
    if(this.disposed||typeof value!=='boolean')return false;
    this.options.motion={...this.options.motion,reducedMotion:value};
    if(this.motion?.options)this.motion.options.reducedMotion=value;
    return true;
  }

  setActivity(value) {
    if(this.disposed||!['idle','listening','thinking'].includes(value))return false;
    this.activity=value;return true;
  }

  interact(type) {
    if(this.disposed||!['greet','acknowledge'].includes(type)||this.interactionId>=Number.MAX_SAFE_INTEGER)return false;
    this.interactionId=(this.interactionId||0)+1;
    this.pendingInteraction={type,id:this.interactionId};return true;
  }

  _frameIllustration() {
    if(!this.asset) return;
    const {aspect,config}=this.asset, padding=this.options.framePadding;
    const viewport=this.viewportAspect||1;
    let height=1, width=aspect, centre=.5;
    if(this.options.framing==='portrait') {
      const {head,bodyPivot}=config.rig;
      const top=clamp(head.center[1]-head.radius[1]*1.15);
      const bottom=clamp(Math.max(bodyPivot[1]+.035,top+.30));
      height=bottom-top;
      // A close-up may crop hair tips: its width follows the head/upper torso,
      // not the complete hair envelope used by the deformation rig.
      width=Math.min(1,head.radius[0]*3.0)*aspect;
      // When a narrow viewport makes width the limiting dimension, extend
      // the view downward from the head-top anchor instead of adding sky.
      // Padding remains symmetric around this unpadded visible region.
      centre=top+Math.max(height,width/viewport)/2;
    }
    const visibleHeight=Math.max(height,width/viewport)*padding;
    this.camera.left=-visibleHeight*viewport/2; this.camera.right=visibleHeight*viewport/2;
    this.camera.top=visibleHeight/2; this.camera.bottom=-visibleHeight/2;
    this.camera.position.set(0,.5-centre,2);
    this.camera.lookAt(0,.5-centre,0);
    this.camera.updateProjectionMatrix();
  }

  setView({yaw=0,framing=this.options.framing}={}) {
    if(this.disposed||!Number.isFinite(yaw)||Math.abs(yaw)>1e-8||!['portrait','full'].includes(framing)) return false;
    this.viewYaw=0; this.options.framing=framing; this._frameIllustration(); return true;
  }

  resize() {
    if(this.disposed) return;
    const rect=(this.canvas.parentElement||this.canvas).getBoundingClientRect();
    const width=Math.max(1,rect.width), height=Math.max(1,rect.height);
    this.viewportAspect=width/height;
    this.renderer.setSize(width,height,false);
    this._frameIllustration();
  }

  queue(event) {
    if(this.disposed) return false;
    try {
      const accepted=this.timeline.queue(event);
      if(accepted&&event.topic==='muxiva.avatar.animation') this.stats.acceptedAnimationEvents++;
      if(accepted&&event.topic==='muxiva.avatar.reset') {
        const payload=typeof event.payload==='string'?JSON.parse(event.payload):event.payload;
        const reset=this.motion?.reset({streamId:payload.stream_id,beforeSequence:payload.before_sequence});
        if(reset!==false) {this.pendingInteraction=null;this._closeMouth();}
      }
      return accepted;
    } catch { return false; }
  }

  _updatePoseStats() {
    // Diagnostics mirror the actual GPU inputs; they never drive animation.
    const u=this.asset?.uniforms;
    this.stats.mouthOpen=u?.uMouthOpen.value ?? 0;
    this.stats.peakMouthOpen=Math.max(this.stats.peakMouthOpen,this.stats.mouthOpen);
    this.stats.headTilt=u?.uHeadTilt.value ?? 0;
    this.stats.leftHand=u?.uLeftHandLift.value ?? 0;
    this.stats.rightHand=u?.uRightHandLift.value ?? 0;
    this.stats.layerCount=this.asset?.layers?.size??0;
    for(const name of ['gazeX','gazeY','shoulder','hipShift','headPitch','smile'])
      this.stats[name]=u?.['u'+name[0].toUpperCase()+name.slice(1)]?.value??0;
  }

  _closeMouth() {
    this.mouth=0;if(this.asset)this.asset.uniforms.uMouthOpen.value=0;
    this._updatePoseStats();
  }

  reset({streamId='assistant',beforeSequence}={}) {
    if(this.disposed) return false;
    if(beforeSequence===undefined) this.timeline.clear();
    else this.timeline.reset({streamId,beforeSequence});
    const accepted=this.motion?.reset(beforeSequence===undefined?{clearSession:true}:{streamId,beforeSequence});
    if(beforeSequence===undefined||accepted!==false) {this.pendingInteraction=null;this._closeMouth();}
    return true;
  }

  setExpression(name='neutral',weight=.25) {
    if(this.disposed||!['neutral','portraitSmile'].includes(name)||!Number.isFinite(weight)) return false;
    // An explicit smile is rendered only when the asset supplies that texture;
    // older artwork keeps its authored resting expression.
    this.expression={name,weight:clamp(weight)}; return true;
  }

  update({deltaSeconds=1/60,streamId='assistant',sequence,sampleOffset=0,sampleRateHz=24000,playing=false}={}) {
    if(this.disposed) return;
    const wallDelta=Math.max(0,Number.isFinite(deltaSeconds)?deltaSeconds:0), dt=Math.min(.1,wallDelta);
    this.elapsed+=dt;
    const target=clamp(this.timeline.sample({streamId,sequence,sampleOffset,sampleRateHz,playing})*this.options.mouthScale);
    this.mouth=playing&&target>0?THREE.MathUtils.lerp(this.mouth,target,1-Math.exp(-dt/.035)):0;
    const interaction=this.pendingInteraction;this.pendingInteraction=null;
    const pose=this.motion.update({deltaSeconds:dt,streamId,sequence,playing,energy:this.mouth,
      attention:this.attention,interaction,activity:this.activity||'idle'});
    if(this.asset) {
      const u=this.asset.uniforms;
      const smile=Math.max(pose.smile,u.uHasSmile?.value&&this.expression?.name==='portraitSmile'?this.expression.weight:0);
      for(const [key,value] of Object.entries({HeadYaw:pose.headYaw,HeadTilt:pose.headTilt,Nod:pose.nod,
        BodyLean:pose.bodyLean,Breath:pose.breath,LeftHandLift:pose.leftHand,RightHandLift:pose.rightHand,
        HairSway:pose.hair,SkirtSway:pose.skirt,GazeX:pose.gazeX,GazeY:pose.gazeY,Shoulder:pose.shoulder,
        HipShift:pose.hipShift,HeadPitch:pose.headPitch,Smile:smile})) u['u'+key].value=clamp(value,-1,1);
      u.uMouthOpen.value=playing?clamp(pose.mouthOpen):0;
      this._applyLayerPose(pose);
      const since=this.elapsed-this.nextBlink;
      u.uBlinkAmount.value=since>=0&&since<.18?Math.sin(since/.18*Math.PI):0;
      if(since>=.18) this.nextBlink=this.elapsed+3.3+.65*Math.sin(this.elapsed);
    }
    this._updatePoseStats();
    this.renderer.render(this.scene,this.camera);
    this.stats.frames++;this.stats.seconds+=wallDelta;
    this.fpsFrames=(this.fpsFrames||0)+1;this.fpsSeconds=(this.fpsSeconds||0)+wallDelta;
    if(this.fpsSeconds>=1) {this.stats.fps=this.fpsFrames/this.fpsSeconds;this.fpsFrames=0;this.fpsSeconds=0;}
    this.stats.droppedAnimationFrames=this.timeline.dropped;
  }

  _releaseIllustration() {
    if(!this.asset) return;
    this.scene.remove(this.asset.mesh);
    for(const geometry of this.asset.geometries||[this.asset.geometry])geometry.dispose();
    for(const material of this.asset.materials||[this.asset.material])material.dispose();
    disposeTextures(this.asset.textureSet||new Set(Object.values(this.asset.textures)));
    this.asset=null;this.meta=null;
    this._updatePoseStats();
  }

  dispose() {
    if(this.disposed) return;
    this.disposed=true;this.loadGeneration++;
    this.pendingLoad?.abort();this.pendingLoad=null;
    this.pendingInteraction=null;this.attention={x:0,y:0,active:false};
    this.resizeObserver.disconnect();
    this.motion?.reset({immediate:true});
    this._releaseIllustration();this.timeline.clear();this.renderer.dispose();
  }
}
