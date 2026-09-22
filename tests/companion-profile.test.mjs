import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const json=async path=>JSON.parse(await readFile(new URL('../'+path,import.meta.url),'utf8'));
test('companion profile is only existing application Node configuration, not a new loop',async()=>{
  const profile=await json('config/companion-profile.json'),graph=await json('graph.json');
  assert.equal(profile.targetNodeType,'avatar.pi_agent');
  assert.deepEqual(Object.keys(profile.node_config).sort(),['max_history_messages','max_tokens','system_prompt','temperature']);
  assert.deepEqual(graph.nodes.find(node=>node.id==='pi-agent').node_config,profile.node_config);
  assert.equal(graph.nodes.filter(node=>node.node_type==='avatar.pi_agent').length,1);
  assert.equal(graph.nodes.filter(node=>node.node_type==='builtin.voice_turn_controller').length,1);
  const source=await readFile(new URL('../.muxiva/nodes/pi_agent/node.ts',import.meta.url),'utf8');
  assert.ok(source.includes('createAgentLoopDriver({ createModelRuntime }, { config, state })'));
});
test('evaluation data has twelve distinct scenarios and does not claim automatic subjective success',async()=>{
  const fixture=await json('tests/fixtures/companion-scenarios.json');
  assert.equal(fixture.scenarios.length,12);assert.equal(new Set(fixture.scenarios.map(s=>s.id)).size,12);
  assert.ok(fixture.rubric.hardFailures.length>=4);
  for(const scene of fixture.scenarios){assert.equal(scene.status,'未测');assert.ok(scene.steps.length&&scene.expect.length);}
});
