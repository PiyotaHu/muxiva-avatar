// Isolated local Chromium acceptance; no personal browser/profile or microphone.
// Requires `node tests/e2e.mjs --serve --performance` on 4180.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
const voiceOnly=process.argv.includes('--voice-only');
const root=fileURLToPath(new URL('../',import.meta.url)),out=join(root,'.artifacts',voiceOnly?'matcha-light-tuning/browser':'performance-v11');
await mkdir(out,{recursive:true});
const port=9342,profile=join(out,'profile-'+Date.now());
const browser=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',[
 '--headless=new','--no-first-run','--disable-background-networking','--mute-audio',
 '--autoplay-policy=no-user-gesture-required','--remote-debugging-address=127.0.0.1',
 '--remote-debugging-port='+port,'--user-data-dir='+profile,'about:blank'
],{windowsHide:true,stdio:'ignore'});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const wait=async(fn,label,timeout=40000)=>{const until=Date.now()+timeout;while(Date.now()<until){const value=await fn();if(value)return value;await sleep(200);}throw Error('Timeout: '+label);};
let socket,id=0;const pending=new Map(),errors=[];const report={manual:[],speech:[],errors};
const send=(method,params={})=>new Promise((resolve,reject)=>{const next=++id;pending.set(next,{resolve,reject});socket.send(JSON.stringify({id:next,method,params}));});
const evaluate=async expression=>{const response=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(response.exceptionDetails)throw Error(response.exceptionDetails.text);return response.result.value;};
const screenshot=async name=>{const result=await send('Page.captureScreenshot',{format:'png',fromSurface:true});await writeFile(join(out,name+'.png'),Buffer.from(result.data,'base64'));};
const load=async url=>{console.log('loading',url);await send('Page.navigate',{url});await wait(async()=>{const status=await evaluate('({ready:Boolean(window.avatarDiagnostics?.().model),error:document.getElementById("avatarStatus")?.textContent})');if(status?.error)throw Error(status.error);return status?.ready;},url);console.log('loaded',url);await sleep(1200);};
try{
 await wait(async()=>{try{return (await fetch(`http://127.0.0.1:${port}/json/version`)).ok;}catch{return false;}},'isolated browser');
 const target=await fetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'}).then(r=>r.json());
 socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
 socket.onmessage=event=>{const message=JSON.parse(event.data);if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.text);const callbacks=pending.get(message.id);if(callbacks){pending.delete(message.id);message.error?callbacks.reject(Error(message.error.message)):callbacks.resolve(message.result);}};
 await send('Page.enable');await send('Runtime.enable');
 await send('Emulation.setDeviceMetricsOverride',{width:1400,height:1000,deviceScaleFactor:1,mobile:false});
 await load('http://127.0.0.1:4174/?verify=avatar-sample-a-vrma-11');
 assert.equal(await evaluate('window.avatarDiagnostics().character.version'),'avatar-sample-a-vrma-11');
 assert.equal(await evaluate('window.avatarDiagnostics().animation.animationLoadErrors'),0);
 assert.equal(await evaluate('document.getElementById("avatarGreet").disabled'),false);
 await screenshot('idle');
 for(const [kind,delay] of voiceOnly?[]:[['happy',1300],['angry',1600],['laugh',1800]]){
   await evaluate(`(()=>{const s=document.getElementById('avatarReaction');s.value=${JSON.stringify(kind)};s.dispatchEvent(new Event('change'));})()`);
   await sleep(delay);const state=await evaluate('window.avatarDiagnostics().animation');report.manual.push({kind,...state});assert.equal(state.emotion,kind);assert.ok(state.activeGesture);await screenshot(kind);await sleep(6500);
 }
 // Desktop layout executes the same renderer; native menu-to-command mapping is unit tested.
 await load('http://127.0.0.1:4174/?mode=pet&compact=1');
 await evaluate('document.querySelector("canvas#avatar").click()');await sleep(1500);
 report.pet=await evaluate('({layout:document.body.dataset.petLayout,animation:window.avatarDiagnostics().animation})');assert.equal(report.pet.layout,'compact');assert.equal(report.pet.animation.activeGesture,'wave');await screenshot('pet-greet');
 await load('http://127.0.0.1:4180/');
 await evaluate('document.getElementById("connect").click()');await wait(()=>evaluate('window.avatarDiagnostics().ready'),'real graph ready',60000);
 await evaluate('(()=>{document.getElementById("prompt").value="测试表情和动作。";document.getElementById("compose").requestSubmit();})()');
 await wait(()=>evaluate('window.avatarDiagnostics().position?.playing'),'real PCM playback',60000);
 for(let index=0;index<(voiceOnly?16:64);index++){
   const d=await evaluate('window.avatarDiagnostics()');report.speech.push({playing:d.position?.playing,sequence:d.position?.sequence,...d.animation});
   if(index===3||index===24||index===44)await screenshot('speech-'+index);
   await sleep(500);
 }
 assert.ok(report.speech.some(frame=>frame.playing&&frame.emotion==='happy'&&frame.mouthOpen>.05),'emotion and real PCM mouth coexist');
 const clips=new Set(report.speech.filter(frame=>frame.playing).map(frame=>frame.bodyClip));if(!voiceOnly)assert.ok(clips.size>=3,'multiple speech clips actually played');
 await evaluate('document.getElementById("interrupt").click()');
 await wait(()=>evaluate('!window.avatarDiagnostics().position?.playing'),'cancel PCM');await sleep(800);
 report.cancel=await evaluate('window.avatarDiagnostics().animation');assert.equal(report.cancel.mouthOpen<.01,true);assert.equal(report.cancel.activeGesture,null);
 await evaluate('document.getElementById("disconnect").click()');
 assert.deepEqual(errors,[]);report.ok=true;
 console.log(JSON.stringify({ok:true,out,manual:report.manual,pet:report.pet,speechClips:[...clips],cancel:report.cancel}));
}catch(error){report.ok=false;report.failure=error.message;if(socket?.readyState===WebSocket.OPEN){report.page=await evaluate('({diagnostics:window.avatarDiagnostics?.(),status:document.getElementById("avatarStatus")?.textContent})').catch(()=>null);await screenshot('failure').catch(()=>{});}throw error;}
finally{
 await writeFile(join(out,'report.json'),JSON.stringify(report,null,2));
 if(socket?.readyState===WebSocket.OPEN){await evaluate('document.getElementById("disconnect")?.click()').catch(()=>{});await send('Browser.close').catch(()=>{});socket.close();}
 if(browser.exitCode===null)browser.kill();
}
