import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {VRMAnimationLoaderPlugin,createVRMAnimationClip} from '@pixiv/three-vrm-animation';

const relaxedHands=Object.fromEntries(['left','right'].flatMap((side,index)=>{
  const sign=index?-1:1;
  return ['Index','Middle','Ring','Little'].flatMap((finger,fingerIndex)=>
    [['Proximal',.22+fingerIndex*.05],['Intermediate',.35+fingerIndex*.06],['Distal',.16+fingerIndex*.04]]
      .map(([segment,amount])=>[side+finger+segment,[0,0,sign*amount]]));
}));

/** Generic VRMA player. It is the sole body-rig writer. */
export class VrmAnimationController {
  constructor({clips={},states={},variants={},gestures={},variantIntervalSeconds=7,gestureCooldownSeconds=3,transitionSeconds=.55,restPoseProfile,poseOffsets={}}={}){
    this.clips=clips;this.states=states;this.transitionSeconds=transitionSeconds;
    this.variants=variants;this.gestures=gestures;this.variantIntervalSeconds=variantIntervalSeconds;this.gestureCooldownSeconds=gestureCooldownSeconds;
    this.reducedMotion=false;this.elapsed=0;this.nextGesture=0;this.variantIndex=new Map();this.fading=new Map();
    this.restPose=restPoseProfile==='relaxedHands'?relaxedHands:{};
    this.poseOffsets=poseOffsets;
    this.cache=new Map();this.actions=new Map();this.loadErrors=new Map();this.state=null;
  }
  _applyPoseOffsets(clip,vrm){
    const quaternion=new THREE.Quaternion(),delta=new THREE.Quaternion(),euler=new THREE.Euler();
    for(const [name,angles] of Object.entries(this.poseOffsets)){
      const bone=vrm.humanoid?.getNormalizedBoneNode(name);
      if(!bone?.name)continue;
      const track=clip.tracks.find(candidate=>candidate.name===bone.name+'.quaternion');
      if(!track||track.getValueSize()!==4)continue;
      delta.setFromEuler(euler.set(...angles));
      for(let offset=0;offset<track.values.length;offset+=4){
        quaternion.fromArray(track.values,offset).multiply(delta).normalize().toArray(track.values,offset);
      }
    }
    return clip;
  }
  async bind(vrm){
    this.dispose();this.vrm=vrm;
    if(!Object.keys(this.clips).length)return;
    const loader=new GLTFLoader();loader.register(parser=>new VRMAnimationLoaderPlugin(parser));
    this.mixer=new THREE.AnimationMixer(vrm.scene);
    this.pose=Object.entries(this.restPose).flatMap(([name,angles])=>{
      const bone=vrm.humanoid?.getNormalizedBoneNode(name);
      return bone?[{bone,base:bone.quaternion.clone(),delta:new THREE.Quaternion().setFromEuler(new THREE.Euler(...angles))}]:[];
    });
    await Promise.all(Object.entries(this.clips).map(async([name,url])=>{
      try{
        const gltf=await loader.loadAsync(url),animation=gltf.userData.vrmAnimations?.[0];
        if(!animation)throw Error('missing VRMC_vrm_animation data');
        if(this.vrm===vrm){
          // Body assets never own eyes, expressions, or camera tracks.
          animation.expressionTracks?.preset?.clear();animation.expressionTracks?.custom?.clear();
          animation.lookAtTrack=null;
          animation.humanoidTracks.rotation.delete('leftEye');animation.humanoidTracks.rotation.delete('rightEye');animation.humanoidTracks.rotation.delete('jaw');
          const clip=this._applyPoseOffsets(createVRMAnimationClip(animation,vrm),vrm);
          clip.tracks=clip.tracks.filter(track=>!track.name.includes('VRMExpression')&&!track.name.includes('VRMLookAt'));
          this.cache.set(name,clip);
        }
      }catch(error){
        if(this.vrm===vrm)this.loadErrors.set(name,error instanceof Error?error:Error(String(error)));
      }
    }));
  }
  _baseName(activity=this.activity||'idle'){
    const requested=this.states[this.reducedMotion?'idle':activity]||this.states.idle||'idle';
    const fallback=this.states.idle||'idle';
    return this.cache.has(requested)?requested:this.cache.has(fallback)?fallback:this.cache.keys().next().value;
  }
  _play(name,once=false){
    if(!this.mixer)return false;
    if(!name||this.state===name)return false;
    const clip=this.cache.get(name);if(!clip)return false;
    const previous=this.actions.get(this.state),action=this.mixer.clipAction(clip);
    action.reset().setEffectiveWeight(1).setLoop(once?THREE.LoopOnce:THREE.LoopRepeat,once?1:Infinity);
    action.clampWhenFinished=once;action.fadeIn(this.transitionSeconds).play();this.fading.delete(action);
    if(previous&&previous!==action){previous.fadeOut(this.transitionSeconds);this.fading.set(previous,this.elapsed+this.transitionSeconds);}
    this.actions.set(name,action);this.state=name;return true;
  }
  setActivity(activity='idle'){
    if(!this.mixer)return false;
    if(activity===this.activity&&this.state)return false;
    this.activity=activity;this.activeGesture=null;this.nextVariant=this.elapsed+this.variantIntervalSeconds;
    const pool=this.reducedMotion?[]:(this.variants[activity]||[]).filter(name=>this.cache.has(name));
    const index=this.variantIndex.get(activity)||0;
    if(pool.length)this.variantIndex.set(activity,index+1);
    return this._play(pool.length?pool[index%pool.length]:this._baseName(activity));
  }
  triggerGesture(kind){
    const configured=this.gestures[kind],pool=(Array.isArray(configured)?configured:[configured]).filter(name=>this.cache.has(name));
    if(!this.mixer||this.reducedMotion||!pool.length||this.elapsed<this.nextGesture||this.activeGesture)return false;
    const key='gesture:'+kind,index=this.variantIndex.get(key)||0,name=pool[index%pool.length];
    if(!this._play(name,true))return false;
    this.variantIndex.set(key,index+1);this.activeGesture={name,until:this.elapsed+Math.max(this.transitionSeconds,this.cache.get(name).duration-this.transitionSeconds)};
    this.nextGesture=this.elapsed+this.gestureCooldownSeconds;return true;
  }
  setReducedMotion(value){
    this.reducedMotion=Boolean(value);this.activeGesture=null;this.activity=null;this.setActivity('idle');
  }
  update(deltaSeconds){
    const dt=Math.min(.1,Math.max(0,deltaSeconds||0));this.elapsed+=dt;
    if(this.activeGesture&&this.elapsed>=this.activeGesture.until){this.activeGesture=null;this._play(this._baseName());this.nextVariant=this.elapsed+this.variantIntervalSeconds;}
    if(!this.activeGesture&&!this.reducedMotion&&this.elapsed>=this.nextVariant){
      const pool=(this.variants[this.activity]||[]).filter(name=>this.cache.has(name));
      if(pool.length>1){const index=(pool.indexOf(this.state)+1)%pool.length;this._play(pool[index]);}
      this.nextVariant=this.elapsed+this.variantIntervalSeconds;
    }
    this.mixer?.update(dt);
    // Stop faded actions; otherwise long conversations keep evaluating every clip.
    for(const [action,until] of this.fading)if(this.elapsed>=until){action.stop();this.fading.delete(action);}
    for(const pose of this.pose||[])pose.bone.quaternion.copy(pose.base).multiply(pose.delta);
  }
  reset(){this.activeGesture=null;this.activity=null;this.nextGesture=0;return this.setActivity('idle');}
  dispose(){
    this.mixer?.stopAllAction();
    if(this.mixer&&this.vrm?.scene)this.mixer.uncacheRoot(this.vrm.scene);
    this.actions.clear();this.cache.clear();this.loadErrors.clear();
    this.fading.clear();this.variantIndex.clear();this.elapsed=0;this.nextGesture=0;this.nextVariant=0;this.activeGesture=null;this.activity=null;
    this.mixer=null;this.vrm=null;this.pose=null;this.state=null;
  }
}
