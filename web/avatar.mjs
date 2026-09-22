import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {VRMLoaderPlugin, VRMUtils} from '@pixiv/three-vrm';
import {AvatarTimeline} from './avatar-timeline.mjs';
import {AvatarStateMachine} from './avatar-state.mjs';
import {LipSyncTimeline} from './avatar-lipsync.mjs';
import {AvatarFaceController} from './avatar-face.mjs';
import {VrmAnimationController} from './avatar-animation.mjs';

/** Local VRM presentation runtime. The Graph owns media and turns; this owns pixels only. */
export class AvatarRenderer {
  constructor(canvas,{pixelRatio=1.25,framing='portrait',framePadding=1.13,mouthScale=.8,animation={},face={}}={}){
    this.canvas=canvas;this.options={pixelRatio,framing,framePadding,mouthScale,animation,face};this.viewYaw=0;
    this.timeline=new AvatarTimeline();this.lipSync=new LipSyncTimeline();this.stateMachine=new AvatarStateMachine();
    this.scene=new THREE.Scene();this.camera=new THREE.PerspectiveCamera(32,1,.01,100);this.renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true,powerPreference:'low-power'});
    this.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio||1,pixelRatio));this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.setClearColor(0,0);
    this.scene.add(new THREE.HemisphereLight(0xffffff,0xa9a0c9,1.35));const key=new THREE.DirectionalLight(0xfff5ed,1.5);key.position.set(-1,2,3);this.scene.add(key);
    this.vrm=null;this.meta=null;this.loadGeneration=0;this.disposed=false;this.activity='idle';this.elapsed=0;this.mouth=0;this.manualExpression={name:'neutral',weight:0};
    this.face=new AvatarFaceController({mouthScale,emotions:face.emotions||{}});this.body=new VrmAnimationController(animation);
    this.stats={frames:0,seconds:0,fps:0,droppedAnimationFrames:0,mouthOpen:0,peakMouthOpen:0,acceptedAnimationEvents:0,bodyState:'idle',animationLoadErrors:0};
    this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(canvas.parentElement||canvas);this.resize();
  }
  async load(url){
    if(this.disposed)throw Error('AvatarRenderer is disposed');const generation=++this.loadGeneration,loader=new GLTFLoader();loader.register(parser=>new VRMLoaderPlugin(parser));const gltf=await loader.loadAsync(url),candidate=gltf.userData.vrm;
    if(!candidate){VRMUtils.deepDispose(gltf.scene);throw Error('Selected asset is not a VRM avatar');}
    if(generation!==this.loadGeneration||this.disposed){VRMUtils.deepDispose(candidate.scene);return null;}
    VRMUtils.rotateVRM0(candidate);VRMUtils.removeUnnecessaryVertices(candidate.scene);VRMUtils.combineSkeletons(candidate.scene);candidate.scene.traverse(object=>{object.frustumCulled=false;});
    this.face??=new AvatarFaceController({mouthScale:this.options.mouthScale,emotions:this.options.face?.emotions||{}});this.body??=new VrmAnimationController(this.options.animation||{});this._releaseAvatar();this.vrm=candidate;this.lookAtOriginal=candidate.lookAt?{yaw:candidate.lookAt.yaw,pitch:candidate.lookAt.pitch,autoUpdate:candidate.lookAt.autoUpdate,target:candidate.lookAt.target}:null;this.meta=candidate.meta;this.scene.add(candidate.scene);this.face.bind(candidate);
    try{await this.body.bind(candidate);}catch(error){this._releaseAvatar();throw Error('角色动作加载失败：'+error.message);}
    if(this.stats)this.stats.animationLoadErrors=this.body.loadErrors.size;
    if(generation!==this.loadGeneration||this.disposed){this._releaseAvatar();return null;}
    this.body.setActivity('idle');candidate.update(0);candidate.scene.updateMatrixWorld(true);this._frameAvatar();return {meta:this.meta,expressionNames:candidate.expressionManager?.expressions.map(x=>x.expressionName)||[]};
  }
  async loadFile(file){const url=URL.createObjectURL(file);try{return await this.load(url);}finally{URL.revokeObjectURL(url);}}
  _frameAvatar(){if(!this.vrm)return;const bounds=new THREE.Box3().setFromObject(this.vrm.scene),height=Math.max(.1,bounds.max.y-bounds.min.y),portrait=this.options.framing==='portrait',target=new THREE.Vector3((bounds.min.x+bounds.max.x)/2,bounds.min.y+height*(portrait?.74:.5),0),visibleHeight=height*(portrait?.64:(this.options.framePadding??1.13)),distance=visibleHeight/(2*Math.tan(THREE.MathUtils.degToRad(this.camera.fov/2))),yaw=this.viewYaw||0;this.camera.position.set(target.x+Math.sin(yaw)*distance,target.y,Math.cos(yaw)*distance);this.camera.lookAt(target);this.camera.updateProjectionMatrix();}
  setView({yaw=this.viewYaw||0,framing=this.options.framing}={}){if(!Number.isFinite(yaw)||!['portrait','full'].includes(framing))return false;this.viewYaw=yaw;this.options.framing=framing;this._frameAvatar();return true;}
  resize(){if(this.disposed)return;const rect=(this.canvas.parentElement||this.canvas).getBoundingClientRect(),width=Math.max(1,rect.width),height=Math.max(1,rect.height);this.renderer.setSize(width,height,false);this.camera.aspect=width/height;this.camera.updateProjectionMatrix();}
  setActivity(activity='idle'){this.activity=['idle','listening','thinking','speaking'].includes(activity)?activity:'idle';}
  queue(event){try{const accepted=this.timeline.queue(event);if(accepted&&event.topic==='muxiva.avatar.reset'){const payload=typeof event.payload==='string'?JSON.parse(event.payload):event.payload;this.lipSync.reset({streamId:payload.stream_id,beforeSequence:payload.before_sequence});}if(accepted)this.stats.acceptedAnimationEvents++;return accepted;}catch{return false;}}
  queueAudio(frame){return this.lipSync.queue(frame);}
  reset({streamId='assistant',beforeSequence}={}){if(beforeSequence===undefined){this.timeline.clear();this.lipSync.reset();this.stateMachine.reset();}else{this.timeline.reset({streamId,beforeSequence});this.lipSync.reset({streamId,beforeSequence});}this.face.reset();this.body.reset();}
  setExpression(name='neutral',weight=.25){if(typeof name!=='string'||!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(name)||!Number.isFinite(weight))return false;if(name!=='neutral'&&this.vrm&&!this.vrm.expressionManager?.getExpression(name))return false;this.manualExpression={name,weight:Math.max(0,Math.min(1,weight))};this.expression=this.manualExpression;return true;}
  update({deltaSeconds=1/60,streamId='assistant',sequence,sampleOffset=0,sampleRateHz=24000,playing=false}={}){
    if(this.disposed)return;const wallDelta=Math.max(0,Number.isFinite(deltaSeconds)?deltaSeconds:0),dt=Math.min(.1,wallDelta);this.elapsed+=dt;const activity=this.stateMachine.update({playing,thinking:this.activity==='thinking',userSpeaking:this.activity==='listening'});this.body.setActivity(activity);this.body.update(dt);
    const visemes=this.lipSync.sample({streamId,sequence,sampleOffset,playing})||this._legacyVisemes({streamId,sequence,sampleOffset,sampleRateHz,playing});this.face.update({deltaSeconds:dt,activity,visemes,playing});this.mouth=this.face.mouthOpen;this._updateGaze(dt,activity);this.vrm?.update(dt);this.renderer.render(this.scene,this.camera);
    this.stats.frames++;this.stats.seconds+=wallDelta;this.fpsFrames=(this.fpsFrames||0)+1;this.fpsSeconds=(this.fpsSeconds||0)+wallDelta;if(this.fpsSeconds>=1){this.stats.fps=this.fpsFrames/this.fpsSeconds;this.fpsFrames=0;this.fpsSeconds=0;}this.stats.droppedAnimationFrames=this.timeline.dropped+this.lipSync.dropped;this.stats.mouthOpen=this.mouth;this.stats.peakMouthOpen=Math.max(this.stats.peakMouthOpen,this.mouth);this.stats.bodyState=activity;
  }
  _legacyVisemes({streamId,sequence,sampleOffset,sampleRateHz,playing}){const open=this.timeline.sample({streamId,sequence,sampleOffset,sampleRateHz,playing})*this.options.mouthScale;return {aa:open,ih:0,ou:0,ee:0,oh:0};}
  _updateGaze(dt,activity){if(!this.vrm?.lookAt||!this.lookAtOriginal)return;const look=this.vrm.lookAt;look.autoUpdate=false;const amount=activity==='listening'?1:.55,period=activity==='thinking'?3.4:6.3,phase=this.elapsed%period,glance=phase>period-.9?Math.sin((phase-(period-.9))/.9*Math.PI)**2:0,cycle=Math.floor(this.elapsed/period),blend=1-Math.exp(-dt/.12);look.yaw=THREE.MathUtils.lerp(look.yaw,(cycle%2?-1:1)*18*glance*amount,blend);look.pitch=THREE.MathUtils.lerp(look.pitch,(activity==='thinking'?-10:-5)*glance*amount,blend);}
  _releaseAvatar(){this.face?.unbind();this.body?.dispose();if(!this.vrm)return;if(this.vrm.lookAt&&this.lookAtOriginal)Object.assign(this.vrm.lookAt,this.lookAtOriginal);this.lookAtOriginal=null;this.scene.remove(this.vrm.scene);VRMUtils.deepDispose(this.vrm.scene);this.vrm=null;}
  dispose(){if(this.disposed)return;this.disposed=true;++this.loadGeneration;this._releaseAvatar();this.resizeObserver?.disconnect();this.renderer?.dispose();}
}
