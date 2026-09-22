class PcmCapture extends AudioWorkletProcessor {
  constructor(){super();this.buffer=new Int16Array(640);this.offset=0;this.enabled=true;this.port.onmessage=({data})=>{this.enabled=!!data.enabled;this.offset=0;};}
  process(inputs){
    if(!this.enabled)return true;
    const input=inputs[0]?.[0];if(!input)return true;
    for(const sample of input){
      this.buffer[this.offset++]=Math.max(-32768,Math.min(32767,Math.round(sample*32767)));
      if(this.offset===this.buffer.length){this.port.postMessage(this.buffer.buffer,[this.buffer.buffer]);this.buffer=new Int16Array(640);this.offset=0;}
    }
    return true;
  }
}
registerProcessor('pcm-capture',PcmCapture);
