const validSequence=value=>Number.isSafeInteger(value)&&value>=0;
const keyFor=(streamId,sequence)=>JSON.stringify([streamId,sequence]);

/** Presentation facts only. Does not decide turns, call models, or touch the rig. */
export class AvatarStateMachine {
  constructor({cues=[]}={}){this.cues=cues;this.reset();}
  queueText({streamId='assistant',sequence,text}={}){
    if(typeof streamId!=='string'||streamId.length>80||!validSequence(sequence)||typeof text!=='string'||
      sequence<(this.watermarks.get(streamId)||0))return false;
    const key=keyFor(streamId,sequence);
    let row=this.responses.get(key);
    if(!row){
      if(this.responses.size>=8)this.responses.delete(this.responses.keys().next().value);
      row={text:'',cue:null};this.responses.set(key,row);
    }
    // Bounded, local literal matching: a conservative fallback, not emotion recognition.
    row.text=(row.text+text.slice(0,4096)).slice(0,4096);
    row.cue=this.cues.find(rule=>rule.phrases.some(phrase=>row.text.includes(phrase))&&
      !(rule.exclude||[]).some(phrase=>row.text.includes(phrase)))?.name||null;
    return true;
  }
  react(name,seconds=4){this.reaction={name,remaining:seconds,token:++this.reactionId};}
  update({userSpeaking=false,thinking=false,playing=false,deltaSeconds=0}={}){
    if(this.reaction){this.reaction.remaining-=Math.min(.1,Math.max(0,deltaSeconds||0));if(this.reaction.remaining<=0)this.reaction=null;}
    return this.state=playing?'speaking':userSpeaking?'listening':thinking?'thinking':'idle';
  }
  presentation({playing=false,streamId='assistant',sequence}={}){
    if(this.reaction)return {emotion:this.reaction.name,gesture:this.reaction.name,token:'interaction:'+this.reaction.token};
    if(!playing||!validSequence(sequence)||sequence<(this.watermarks.get(streamId)||0))return null;
    const cue=this.responses.get(keyFor(streamId,sequence))?.cue;
    return cue?{emotion:cue,gesture:cue,token:keyFor(streamId,sequence)+':'+cue}:null;
  }
  reset({streamId='assistant',beforeSequence}={}){
    if(beforeSequence===undefined){this.responses=new Map();this.watermarks=new Map();this.reactionId=0;}
    else if(validSequence(beforeSequence)){
      this.watermarks.set(streamId,Math.max(this.watermarks.get(streamId)||0,beforeSequence));
      for(const key of this.responses.keys()){const [stream,sequence]=JSON.parse(key);if(stream===streamId&&sequence<beforeSequence)this.responses.delete(key);}
    }
    this.state='idle';this.reaction=null;return this.state;
  }
}
