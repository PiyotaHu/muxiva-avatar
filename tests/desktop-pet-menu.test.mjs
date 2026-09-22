import assert from 'node:assert/strict';
import test from 'node:test';
import {describePetState,petMenuModel,sanitizePetState} from '../desktop/pet-menu.mjs';

test('desktop pet menu sanitizes renderer state before exposing native actions',()=>{
  assert.deepEqual(sanitizePetState({connection:'forged',microphone:'always',activity:'hidden'}),{
    connection:'disconnected',microphone:'off',activity:'idle'});
  assert.equal(describePetState({connection:'connected',microphone:'on',activity:'speaking'}),'已连接 · 正在回答');
});

test('disconnected and connecting menus never offer an unusable microphone action',()=>{
  const idle=petMenuModel();
  assert.deepEqual(idle.connect,{label:'连接语音会话',enabled:true,checked:false,command:'connect'});
  assert.deepEqual(idle.microphone,{label:'开启麦克风',enabled:false,command:'enable-microphone'});
  assert.equal(idle.disconnect.enabled,false);
  const pending=petMenuModel({connection:'connecting'});
  assert.equal(pending.status,'状态：正在连接语音会话');
  assert.equal(pending.connect.enabled,false);assert.equal(pending.disconnect.enabled,true);
});

test('connected microphone action is explicit and never reuses an ambiguous toggle label',()=>{
  const off=petMenuModel({connection:'connected',microphone:'off',activity:'ready'});
  assert.equal(off.connect.checked,true);assert.equal(off.microphone.label,'开启麦克风');
  const starting=petMenuModel({connection:'connected',microphone:'starting'});
  assert.equal(starting.microphone.label,'正在开启麦克风…');assert.equal(starting.microphone.enabled,false);
  const on=petMenuModel({connection:'connected',microphone:'on',activity:'listening'});
  assert.deepEqual(on.microphone,{label:'静音麦克风',enabled:true,command:'mute-microphone'});
  const muted=petMenuModel({connection:'connected',microphone:'muted'});
  assert.deepEqual(muted.microphone,{label:'恢复麦克风',enabled:true,command:'enable-microphone'});
});