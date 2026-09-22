import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { PassThrough } from 'node:stream';
import { stat, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import test from 'node:test';
import { createApp, root } from '../server.mjs';

async function waitUntil(predicate) {
  const deadline=Date.now()+3000;
  while(!predicate()) { assert.ok(Date.now()<deadline,'server test timed out');await new Promise(r=>setTimeout(r,5)); }
}
async function setup(options={}) {
  const children=[],killed=[],sessionIds=[];
  const app=createApp({port:0,startupTimeoutMs:1000,shutdownGraceMs:20,
    spawnRuntime:()=>{
      const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();
      child.pid=1000000+children.length;child.exitCode=null;children.push(child);return child;
    },
    terminateRuntime:async child=>{
      await new Promise(r=>setTimeout(r,15));killed.push(child.pid);child.exitCode=0;child.emit('exit',0);
    },...options});
  const origin=await app.start();
  async function session() {
    const response=await fetch(origin+'/api/session',{method:'POST',headers:{Origin:origin}});
    assert.equal(response.status,201);const value=await response.json();sessionIds.push(value.session);return value;
  }
  async function socket(value,role='client') {
    const ws=new WebSocket(value.url,{headers:{Origin:origin}}),messages=[];
    ws.on('message',bytes=>messages.push(JSON.parse(bytes.toString())));
    await once(ws,'open');
    ws.send(JSON.stringify({session:value.session,role,token:role==='client'?value.token:app.sessions.get(value.session).internalToken}));
    return {ws,messages};
  }
  return {app,origin,children,killed,session,socket,
    cleanup:async()=>{await app.close();for(const id of sessionIds)await rm(join(root,'.runtime',id+'.log'),{force:true});}};
}

test('session creation rejects a cross-origin caller and static pnpm junction assets load',async()=>{
  const f=await setup();
  try {
    assert.equal((await fetch(f.origin+'/api/session',{method:'POST',headers:{Origin:'https://other.example'}})).status,403);
    const asset=await fetch(f.origin+'/vendor/three/build/three.module.js');
    assert.equal(asset.status,200,'canonical pnpm junction must remain within allowed asset root');
    assert.match(asset.headers.get('content-type'),/javascript/);
    await asset.arrayBuffer();
    assert.notEqual((await fetch(f.origin+'/.env')).status,200);
  } finally {await f.cleanup();}
});

test('close waits for graceful deadline and completes forced child reclamation before resolving',async()=>{
  const f=await setup();
  try {
    const value=await f.session();await f.socket(value);
    await waitUntil(()=>f.children.length===1);
    const child=f.children[0];let closed=false;
    const stopping=f.app.close().then(()=>{closed=true;});
    await new Promise(r=>setTimeout(r,5));
    assert.equal(closed,false,'HTTP shutdown alone must not finish application shutdown');
    assert.equal(child.exitCode,null);
    await stopping;
    assert.equal(child.exitCode,0);assert.deepEqual(f.killed,[child.pid]);assert.equal(f.app.sessions.size,0);
  } finally {await f.cleanup();}
});

test('an unready runtime times out and releases the single session slot',async()=>{
  const f=await setup({startupTimeoutMs:25});
  try {
    const value=await f.session();const {messages}=await f.socket(value);
    await waitUntil(()=>messages.some(message=>message.reason==='startup-timeout'));
    await waitUntil(()=>f.app.sessions.size===0);
    assert.equal(f.killed.length,1);
    assert.equal((await fetch(f.origin+'/api/status').then(r=>r.json())).activeSessions,0);
  } finally {await f.cleanup();}
});

test('readiness handles split log markers and session log obeys a hard byte cap',async()=>{
  const f=await setup({maxLogBytes:256,startupTimeoutMs:200});
  try {
    const value=await f.session();const {messages}=await f.socket(value);
    await waitUntil(()=>f.children.length===1);
    await f.socket(value,'source');await f.socket(value,'sink');
    await waitUntil(()=>f.app.sessions.get(value.session)?.source&&f.app.sessions.get(value.session)?.sink);
    f.children[0].stdout.write('runtime.st');f.children[0].stdout.write('arted\n');
    await waitUntil(()=>messages.some(message=>message.status==='media-ready'));
    f.children[0].stderr.write(Buffer.concat([Buffer.alloc(2048,65),Buffer.from('\n')]));
    const path=join(root,'.runtime',value.session+'.log');
    assert.equal((await stat(path)).size,256);
    assert.match(await readFile(path,'utf8'),/log size limit reached/);
    await new Promise(r=>setTimeout(r,220));
    assert.equal(f.app.sessions.get(value.session)?.stopping,false,'ready sessions must have their startup deadline cleared');
  } finally {await f.cleanup();}
});
