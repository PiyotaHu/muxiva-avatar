/** Presentation-only state selection. It receives browser facts and never decides turns. */
export class AvatarStateMachine {
  constructor(){this.state='idle';}
  update({userSpeaking=false,thinking=false,playing=false}={}){return this.state=playing?'speaking':userSpeaking?'listening':thinking?'thinking':'idle';}
  reset(){return this.state='idle';}
}
