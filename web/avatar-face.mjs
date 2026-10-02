import * as THREE from 'three';
const clamp=v=>Math.max(0,Math.min(1,Number.isFinite(v)?v:0));
const smooth=(current,target,seconds,dt)=>THREE.MathUtils.damp(current,target,1/seconds,dt);
const VISEMES=['aa','ih','ou','ee','oh'];
/** Sole face writer. Semantic expression, blink, and speech mouth have separate ownership. */
export class AvatarFaceController {
  constructor({mouthScale=.8,emotions={}}={}){this.mouthScale=mouthScale;this.emotions=emotions;this.current=new Map();this.nextBlink=1.8;this.elapsed=0;this.mouthOpen=0;}
  bind(vrm){
    this.vrm=vrm;this.names=new Set(vrm?.expressionManager?.expressions?.map(x=>x.expressionName)||[]);
    const configured=Object.values(this.emotions||{}).map(profile=>profile?.name).filter(name=>typeof name==='string');
    return [...new Set(configured.filter(name=>!this.names.has(name)))];
  }
  unbind(){this.reset();this.vrm=null;this.names=new Set();}
  reset(){
    const manager=this.vrm?.expressionManager;
    for(const name of [...VISEMES,'blink',...this.current.keys()])if(!name.startsWith('mouth:'))manager?.setValue?.(name,0);
    this.current.clear();this.mouthOpen=0;
  }
  update({deltaSeconds=1/60,activity='idle',emotion=null,manualExpression=null,visemes=null,playing=false}={}){
    const dt=Math.min(.1,Math.max(0,Number.isFinite(deltaSeconds)?deltaSeconds:0));this.elapsed+=dt;
    const manager=this.vrm?.expressionManager;if(!manager)return;
    const profile=this.emotions?.[emotion]||((manualExpression?.weight>0)?manualExpression:null)||this.emotions?.[activity]||this.emotions?.idle||null;
    const name=profile?.name,target=name&&this.names.has(name)?clamp(profile.weight):0;
    for(const key of new Set([...this.current.keys()].filter(key=>!key.startsWith('mouth:')).concat(name?[name]:[]))){
      if(VISEMES.includes(key)||key==='blink')continue;
      // VRM expressions with overrideMouth=block can silence lips at any weight.
      // Yield that whole expression while speaking; never modify model metadata.
      const expression=manager.getExpression?.(key);
      const desired=key===name&&!(playing&&expression?.overrideMouth==='block')?target:0;
      const value=smooth(this.current.get(key)||0,desired,.25,dt);
      this.current.set(key,value);manager.setValue(key,value<.001?0:value);
    }
    const frame=playing&&visemes?visemes:null;let sum=0;
    for(const key of VISEMES){
      const target=frame?clamp(clamp(frame[key])*this.mouthScale):0,mouthKey=`mouth:${key}`,previous=this.current.get(mouthKey)||0;
      const value=smooth(previous,target,target>previous?.045:.075,dt);this.current.set(mouthKey,value);manager.setValue(key,value);sum+=value;
    }
    this.mouthOpen=clamp(sum/1.4);
    const blinkElapsed=this.elapsed-this.nextBlink,blink=blinkElapsed>=0&&blinkElapsed<.18?Math.sin(blinkElapsed/.18*Math.PI):0;
    if(blinkElapsed>=.18)this.nextBlink=this.elapsed+2.4+Math.random()*3.5;
    manager.setValue('blink',blink);
  }
}
