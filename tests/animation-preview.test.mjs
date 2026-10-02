import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {applyIdleAnimationPreview,idleAnimationPreviews} from '../web/character-config.mjs';

const config=JSON.parse(await readFile(new URL('../assets/avatar/character.json',import.meta.url),'utf8'));

test('idle preview selects only bundled Rocketbox candidates without mutating character config',()=>{
  const source=structuredClone(config);
  assert.equal(applyIdleAnimationPreview(source),source);
  const candidates=idleAnimationPreviews();
  assert.deepEqual(Object.keys(candidates),['2','3','4','original']);
  for(const value of ['original','2','3','4']){
    const selected=applyIdleAnimationPreview(source,'?idlePreview='+value);
    assert.equal(selected.renderer.animation.clips.idle,candidates[value]);
    assert.match(selected.version,new RegExp('idle-'+value+'$'));
    assert.notEqual(selected,source);
  }
  assert.equal(source.renderer.animation.clips.idle,
    '/assets/avatar/animations/avatar-sample-a-idle-refined.vrma');
});


test('every bundled idle candidate matches its pinned source manifest',async()=>{
  const manifest=JSON.parse(await readFile(
    new URL('../assets/avatar/animations/sources.json',import.meta.url),'utf8'));
  const byFile=new Map(manifest.files.map(entry=>[entry.file,entry]));
  for(const url of Object.values(idleAnimationPreviews())){
    const fileName=url.split('/').at(-1),entry=byFile.get(fileName);
    assert.ok(entry,fileName+' has provenance');
    const bytes=await readFile(new URL('..'+url,import.meta.url));
    assert.equal(bytes.length,entry.bytes,fileName+' byte length');
    assert.equal(createHash('sha256').update(bytes).digest('hex'),entry.sha256,fileName+' hash');
    assert.match(entry.source_file,/^vrma\/rb-idle(?:-[234])?\.vrma$/);
  }
});
test('idle preview rejects ambiguous, external and unsupported selection',()=>{
  for(const search of ['?idlePreview=','?idlePreview=5','?idlePreview=../2',
    '?idlePreview=https://example.test/a.vrma','?idlePreview=2&idlePreview=3']) {
    assert.throws(()=>applyIdleAnimationPreview(config,search),/待机动作预览参数无效/);
  }
  const illustration={...config,renderer:{type:'illustration',framing:'full'}};
  assert.throws(()=>applyIdleAnimationPreview(illustration,'?idlePreview=2'),/仅支持 VRM/);
});
