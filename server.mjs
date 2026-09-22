import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, appendFileSync, readFileSync } from 'node:fs';
import { stat, realpath } from 'node:fs/promises';
import { dirname, extname, resolve, sep, join, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { WebSocketServer, WebSocket } from 'ws';
import { createLogRedactor, redactSecrets, redactValue } from './security.mjs';
import {validateCharacterConfig} from './web/character-config.mjs';
import {validateIllustrationConfig} from './web/illustration-config.mjs';

export const root = dirname(fileURLToPath(import.meta.url));
const mime={'.html':'text/html; charset=utf-8','.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.json':'application/json','.vrm':'model/gltf-binary','.wav':'audio/wav','.png':'image/png'};
export function characterAvailable() {
  try {
    const config = validateCharacterConfig(JSON.parse(readFileSync(join(root, 'assets/avatar/character.json'), 'utf8')));
    const asset = join(root, config.asset);
    if (!existsSync(asset)) return false;
    if (config.renderer.type === 'illustration') {
      const illustration = validateIllustrationConfig(JSON.parse(readFileSync(asset, 'utf8')));
      return Object.values(illustration.images).every(image => existsSync(join(root, image)));
    }
    return true;
  } catch { return false; }
}
const token=()=>randomBytes(32).toString('base64url');
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const validSeq=x=>Number.isSafeInteger(x)&&x>=0;
async function terminateRuntimeTree(child) {
  if (!child?.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    await new Promise((resolveKill, rejectKill) => {
      const killer=spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
      killer.once('error',rejectKill);
      killer.once('exit',code=>code===0||child.exitCode!==null?resolveKill():rejectKill(new Error('Could not terminate Muxiva process tree')));
    });
  } else child.kill('SIGTERM');
}
function waitBounded(promise, milliseconds) {
  return new Promise((resolveWait,rejectWait)=>{
    const timer=setTimeout(()=>resolveWait(false),milliseconds);
    promise.then(()=>{clearTimeout(timer);resolveWait(true);},error=>{clearTimeout(timer);rejectWait(error);});
  });
}
function containsPath(base,path) {
  // realpath resolves pnpm junctions; relative() applies Windows' case-insensitive
  // drive/path semantics instead of a brittle case-sensitive string prefix.
  const part=relative(base,path);
  return part!==''&&part!=='..'&&!part.startsWith('..'+sep)&&!isAbsolute(part);
}
export function createApp({port=Number(process.env.MUXIVA_AVATAR_PORT||4174),spawnRuntime=spawn,maxSessions=1,
  startupTimeoutMs=30000,shutdownGraceMs=3000,maxLogBytes=8*1024*1024,terminateRuntime=terminateRuntimeTree,spawnDesktopPet=spawn}={}) {
  const sessions=new Map();
  const secrets=[process.env.MUXIVA_MODEL_API_KEY,process.env.DASHSCOPE_WORKSPACE_ID].filter(Boolean);
  const wss=new WebSocketServer({noServer:true,maxPayload:262144});
  let actualPort=port;
  let desktopPet;
  const origin=()=> 'http://127.0.0.1:'+actualPort;
  const launchDesktopPet=()=>{
    if(desktopPet?.exitCode===null)return true;
    const electron=process.env.MUXIVA_ELECTRON||join(root,'node_modules/electron/dist/electron.exe');
    if(!existsSync(electron))return false;
    desktopPet=spawnDesktopPet(electron,[join(root,'desktop/pet-main.mjs'),'--url='+origin()],{cwd:root,windowsHide:true,stdio:'ignore'});
    desktopPet.once?.('exit',()=>{desktopPet=undefined;});
    desktopPet.once?.('error',()=>{desktopPet=undefined;});
    return true;
  };
  const send=(ws,value)=>{
    if(!ws||ws.readyState!==WebSocket.OPEN)return;
    if(ws.bufferedAmount>2*1024*1024){ws.close(1013,'Playback client too slow');return;}
    ws.send(typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value));
  };
  const publicState=()=>({modelConfigured:!!(process.env.MUXIVA_MODEL_BASE_URL&&process.env.MUXIVA_MODEL_ID&&(process.env.MUXIVA_MODEL_API_KEY||process.env.MUXIVA_MODEL_AUTH_MODE==='none')),
    avatarAvailable:characterAvailable(),activeSessions:sessions.size,
    speechReady:existsSync(join(root,'.venv/Scripts/python.exe')),testFixture:process.env.MUXIVA_TEST_FIXTURE==='1',pipeline:'muxiva-graph',version:'0.1.0'});
  const maybeReady=session=>{
    if(!session.stopping&&!session.ready&&session.runtimeReady&&session.source&&session.sink&&session.client){
      session.ready=true;clearTimeout(session.startupTimer);
      send(session.client,{type:'session',status:'media-ready'});
    }
  };
  const appendLog=(session,chunk)=>{
    const bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);
    const remaining=Math.max(0,maxLogBytes-(session.logBytes||0));
    if(!remaining)return;
    let output=bytes;
    if(bytes.length>remaining){
      const marker=Buffer.from('\n[MUXIVA] Session log size limit reached; further log output omitted.\n');
      output=remaining>marker.length?Buffer.concat([bytes.subarray(0,remaining-marker.length),marker]):marker.subarray(0,remaining);
    }
    appendFileSync(join(root,'.runtime',session.id+'.log'),output);
    session.logBytes=(session.logBytes||0)+output.length;
  };
  const stopSession=(session,reason='disconnected')=>{
    if(session.stopPromise)return session.stopPromise;
    session.stopping=true;
    clearTimeout(session.startupTimer);
    send(session.source,{type:'close'});
    send(session.client,{type:'session',status:'closed',reason});
    for(const ws of [session.client,session.sink])ws?.close(1000,'Session ended');
    session.stopPromise=(async()=>{
      try{
        if(session.childExit&&!await waitBounded(session.childExit,shutdownGraceMs)){
          await terminateRuntime(session.child);
          if(!await waitBounded(session.childExit,3000))throw new Error('Muxiva process did not exit after termination');
        }
      } finally {
        session.source?.close(1000,'Session ended');
      }
      // Preserve a failed stop in the session table so a later app.close()
      // cannot silently forget an unreclaimed child process.
      sessions.delete(session.id);
    })();
    // Callbacks may initiate a stop without awaiting it; close() still observes
    // this promise and refuses to exit before child-tree reclamation succeeds.
    session.stopPromise.catch(error=>console.error('Session shutdown failed:',redactSecrets(error.message,secrets)));
    return session.stopPromise;
  };
  const server=createServer(async(req,res)=>{
    const json=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
    try {
      const url=new URL(req.url,origin());
      if(req.headers.host!==new URL(origin()).host) return json(403,{error:'Host not allowed'});
      if(url.pathname.startsWith('/api/')){
        if(req.method!=='GET'&&req.headers.origin!==origin())return json(403,{error:'Origin not allowed'});
        if(url.pathname==='/api/status'&&req.method==='GET')return json(200,publicState());
        if(url.pathname==='/api/desktop-pet'&&req.method==='POST'){
          if(req.headers.origin!==origin())return json(403,{error:'Origin not allowed'});
          if(!launchDesktopPet())return json(503,{error:'桌宠运行时未安装。请运行 pnpm install 后重试。'});
          return json(202,{status:'started'});
        }
        if(url.pathname==='/api/session'&&req.method==='POST'){
          if(sessions.size>=maxSessions)return json(409,{error:'本机已有一个会话，请先结束它。每条会话使用独立 Muxiva 进程。'});
          const id=randomBytes(12).toString('hex');
          const session={id,clientToken:token(),internalToken:token(),created:Date.now(),stopping:false};
          sessions.set(id,session);
          return json(201,{session:id,token:session.clientToken,url:origin().replace('http:','ws:')+'/media'});
        }
        return json(404,{error:'Not found'});
      }
      if(req.method!=='GET'&&req.method!=='HEAD')return json(405,{error:'Method not allowed'});
      let path;
      const decoded=decodeURIComponent(url.pathname);
      if(decoded.includes('..')||decoded.includes('\\')||decoded.includes('\0'))return json(400,{error:'Invalid path'});
      if(decoded.startsWith('/vendor/three/'))path=join(root,'node_modules/three',decoded.slice('/vendor/three/'.length));
      else if(decoded==='/vendor/three-vrm.module.js')path=join(root,'node_modules/@pixiv/three-vrm/lib/three-vrm.module.js');
      else if(decoded==='/vendor/three-vrm-animation.module.js')path=join(root,'node_modules/@pixiv/three-vrm-animation/lib/three-vrm-animation.module.js');
      else if(decoded.startsWith('/assets/avatar/'))path=join(root,decoded);
      else if(decoded==='/api/status')return json(200,publicState());
      else path=join(root,'web',decoded==='/'?'index.html':decoded);
      const canonical=await realpath(path);
      const allowed=await Promise.all([join(root,'web'),join(root,'assets/avatar'),join(root,'node_modules/three'),join(root,'node_modules/@pixiv/three-vrm'),join(root,'node_modules/@pixiv/three-vrm-animation')]
        .map(base=>realpath(base).catch(()=>null)));
      if(!allowed.some(base=>base&&containsPath(base,canonical)))return json(403,{error:'Forbidden'});
      if(!(await stat(canonical)).isFile())return json(404,{error:'Not found'});
      res.writeHead(200,{'Content-Type':mime[extname(path)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Permissions-Policy':'microphone=(self), camera=()'});
      if(req.method==='HEAD')res.end();else createReadStream(canonical).pipe(res);
    } catch(error){if(!res.headersSent)json(404,{error:'Not found'});else res.destroy();}
  });
  server.on('upgrade',(req,socket,head)=>{
    if(req.url!=='/media'||req.headers.host!==new URL(origin()).host||(req.headers.origin&&req.headers.origin!==origin())){
      socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');return;
    }
    wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws,req));
  });
  wss.on('connection',(ws,req)=>{
    let session,role;
    const authTimer=setTimeout(()=>ws.close(1008,'Authentication required'),5000);
    ws.on('message',(data,isBinary)=>{
      try {
        if(!session){
          if(isBinary)throw Error('Authenticate first');
          const hello=JSON.parse(data.toString());
          session=sessions.get(hello.session);role=hello.role;
          if(!session||session.stopping||!['client','source','sink'].includes(role)||!equal(hello.token,role==='client'?session.clientToken:session.internalToken)||session[role]){
            session=null;throw Error('Invalid session');
          }
          session[role]=ws;clearTimeout(authTimer);
          if(role==='client'){
            const binary=process.env.MUXIVA_BINARY||resolve(root,'../.build/muxiva-windows/debug/muxiva.exe');
            if(!existsSync(binary)){send(ws,{type:'error',message:'Muxiva executable missing'});stopSession(session);return;}
            const env={...process.env,MUXIVA_PYTHON:join(root,'.venv/Scripts/python.exe'),MUXIVA_NODE:process.execPath,
              MUXIVA_MEDIA_URL:origin().replace('http:','ws:')+'/media',MUXIVA_MEDIA_SESSION:session.id,MUXIVA_MEDIA_TOKEN:session.internalToken};
            mkdirSync(join(root,'.runtime'),{recursive:true});
            session.child=spawnRuntime(binary,['serve',join(root,'graph.json'),'--host','127.0.0.1','--port','0'],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
            session.childExit=new Promise(resolveExit=>{session.child.once('exit',resolveExit);session.child.once('error',resolveExit);});
            session.startupTimer=setTimeout(()=>{
              if(!session.ready&&!session.stopping){send(ws,{type:'error',message:'语音链路启动超时，请检查本地模型和诊断日志后重试。'});stopSession(session,'startup-timeout');}
            },startupTimeoutMs);
            for(const stream of [session.child.stdout,session.child.stderr]){
              const safeLog=createLogRedactor(secrets,chunk=>{
                try{appendLog(session,chunk);}catch{send(ws,{type:'error',message:'无法写入会话日志，请检查磁盘空间。'});stopSession(session,'log-error');}
              });
              stream?.once('end',()=>safeLog.end());
              stream?.once('close',()=>safeLog.end());
              stream?.on('data',chunk=>{
              // Runtime diagnostics remain local; never expose environment or credentials to browser.
              safeLog.write(chunk);
              const observed=(session.logTail||'')+chunk.toString();
              session.logTail=observed.slice(-1024);
              if(!session.runtimeReady&&observed.includes('runtime.started')){
                session.runtimeReady=true;send(ws,{type:'session',status:'runtime-ready'});maybeReady(session);
              }
              });
            }
            session.child.on('error',()=>{send(ws,{type:'error',message:'Muxiva 启动失败，请检查本地诊断日志。'});stopSession(session,'runtime-error');});
            session.child.on('exit',(code)=>{if(!session.stopping)send(ws,{type:'error',message:'Muxiva 会话已退出，代码 '+code+'。请结束后重新连接。'});stopSession(session,'runtime-exited');});
            send(ws,{type:'session',status:'starting'});
          }
          maybeReady(session);
          return;
        }
        if(role==='client'){
          if(isBinary){
            if(!session.source||data.length>6400||data.length%2)return;
            send(session.source,data);return;
          }
          const item=JSON.parse(data.toString());
          if(item.type==='close'){stopSession(session,'user');return;}
          if(item.type==='text'&&typeof item.text==='string'&&item.text.trim().length<=8000)send(session.source,{type:'text',text:item.text});
          else if(item.type==='interrupt')send(session.source,{type:'interrupt'});
          else if(item.type==='playback'&&validSeq(item.sequence))send(session.source,{type:'playback',sequence:item.sequence,state:item.state});
        } else if(role==='sink'){
          if(isBinary)return;
          const item=JSON.parse(data.toString());
          if(['audio','text','event','cancel'].includes(item.type))send(session.client,item.type==='audio'?data.toString():redactValue(item,secrets));
        }
      } catch(error){ws.close(1008,'Invalid media message');}
    });
    ws.on('close',()=>{clearTimeout(authTimer);if(session&&!session.stopping)stopSession(session,role+'-disconnected');});
    ws.on('error',()=>{});
  });
  const timer=setInterval(()=>{for(const session of sessions.values())if(!session.client&&Date.now()-session.created>15000)stopSession(session,'unused');},5000);
  timer.unref();
  let closePromise;
  return {server,sessions,start:()=>new Promise((resolveStart,rejectStart)=>{
      server.once('error',rejectStart);
      server.listen(port,'127.0.0.1',()=>{server.removeListener('error',rejectStart);actualPort=server.address().port;resolveStart(origin());});
    }),
    close:()=>closePromise??=(async()=>{
      clearInterval(timer);
      const stopped=await Promise.allSettled([...sessions.values()].map(session=>stopSession(session,'shutdown')));
      if(desktopPet?.exitCode===null&&typeof desktopPet.kill==='function')desktopPet.kill();
      for(const ws of wss.clients)ws.terminate();
      wss.close();
      await new Promise(r=>server.close(r));
      const failure=stopped.find(result=>result.status==='rejected');
      if(failure)throw failure.reason;
    })()};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if (existsSync(join(root,'.env'))) process.loadEnvFile(join(root,'.env'));
  const app=createApp();console.log('Muxiva Avatar: '+await app.start());
  for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>app.close().then(()=>process.exit(0),error=>{
    console.error('Avatar shutdown did not complete:',redactSecrets(error.message,[process.env.MUXIVA_MODEL_API_KEY,process.env.DASHSCOPE_WORKSPACE_ID]));process.exitCode=1;
  }));
}
