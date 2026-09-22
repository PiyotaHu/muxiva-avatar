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
  constructor({clips={},states={},transitionSeconds=.55,restPoseProfile}={}){
    this.clips=clips;this.states=states;this.transitionSeconds=transitionSeconds;
    this.restPose=restPoseProfile==='relaxedHands'?relaxedHands:{};
    this.cache=new Map();this.actions=new Map();this.loadErrors=new Map();this.state=null;
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
        if(this.vrm===vrm)this.cache.set(name,createVRMAnimationClip(animation,vrm));
      }catch(error){
        if(this.vrm===vrm)this.loadErrors.set(name,error instanceof Error?error:Error(String(error)));
      }
    }));
  }
  setActivity(activity='idle'){
    if(!this.mixer)return false;
    const requested=this.states[activity]||this.states.idle||'idle';
    const fallback=this.states.idle||'idle';
    const name=this.cache.has(requested)?requested:this.cache.has(fallback)?fallback:this.cache.keys().next().value;
    if(!name||this.state===name)return false;
    const clip=this.cache.get(name),previous=this.actions.get(this.state),action=this.mixer.clipAction(clip);
    action.reset().setEffectiveWeight(1).setLoop(THREE.LoopRepeat,Infinity).fadeIn(this.transitionSeconds).play();
    if(previous&&previous!==action)previous.fadeOut(this.transitionSeconds);
    this.actions.set(name,action);this.state=name;return true;
  }
  update(deltaSeconds){
    this.mixer?.update(Math.min(.1,Math.max(0,deltaSeconds||0)));
    for(const pose of this.pose||[])pose.bone.quaternion.copy(pose.base).multiply(pose.delta);
  }
  reset(){return this.setActivity('idle');}
  dispose(){
    this.mixer?.stopAllAction();
    if(this.mixer&&this.vrm?.scene)this.mixer.uncacheRoot(this.vrm.scene);
    this.actions.clear();this.cache.clear();this.loadErrors.clear();
    this.mixer=null;this.vrm=null;this.pose=null;this.state=null;
  }
}
