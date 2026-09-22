import assert from 'node:assert/strict';
import test from 'node:test';
import {describeExperience} from '../web/experience-view.mjs';

test('unconnected and pending states never imply a live microphone',()=>{
  assert.equal(describeExperience().activity,'idle');
  assert.match(describeExperience({connecting:true}).microphoneLabel,/未开启/);
  const pending=describeExperience({ready:true,microphonePending:true});
  assert.equal(pending.activity,'ready');assert.match(pending.microphoneLabel,/请求麦克风权限/);
});
test('actual playback takes priority over model thinking or an open microphone',()=>{
  assert.equal(describeExperience({ready:true,playing:true,agentBusy:true,micOn:true}).activity,'speaking');
  assert.equal(describeExperience({ready:true,agentBusy:true,micOn:true}).activity,'thinking');
  assert.match(describeExperience({ready:true,hasReply:true}).label,/回复已显示/);
  assert.equal(describeExperience({ready:true,micOn:true}).activity,'listening');
  assert.equal(describeExperience({ready:true,micOn:true,muted:true}).activity,'ready');
});
test('error remains visible without falsely claiming that an existing microphone was closed',()=>{
  const state=describeExperience({ready:true,micOn:true,failed:true,playing:true});
  assert.equal(state.activity,'error');assert.match(state.microphoneLabel,/已开启/);
  assert.match(describeExperience({ready:true,micOn:true,muted:true,failed:true}).microphoneLabel,/已静音/);
});
