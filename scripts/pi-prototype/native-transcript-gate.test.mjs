import test from 'node:test';
import assert from 'node:assert/strict';
import { relocatedPath, assertRecoveredEffect, sha256, wholeSaveScript, reviewScript, pendingCheckpointScript } from './native-transcript-gate.mjs';

test('checkpoint script keeps multiline authored data in transport arguments', () => {
  const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
  assert.doesNotThrow(()=>new AsyncFunction(pendingCheckpointScript));
  assert.match(pendingCheckpointScript,/markdown:draft.markdown\+arguments\[1\]/);
  assert.match(pendingCheckpointScript,/title:arguments\[2\]/);
  assert.doesNotMatch(pendingCheckpointScript,/Acknowledged relocation checkpoint|Relocated pending review/);
});

test('whole-answer Save uses its exact normal message control and retains coordinator review acquisition', () => {
  const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
  assert.doesNotThrow(()=>new AsyncFunction(wholeSaveScript));
  assert.doesNotThrow(()=>new AsyncFunction(reviewScript));
  assert.match(wholeSaveScript,/data-chat-message-id/);
  assert.match(wholeSaveScript,/button\('Save to note',answer\)/);
  assert.match(wholeSaveScript,/!before.has\(value.id\)/);
  assert.doesNotMatch(wholeSaveScript,/prepareNoteSave|commitAgentProposal/);
  assert.match(reviewScript,/acquireProbeReview\(\{editor/);
  assert.match(reviewScript,/view\?\.state.doc.toString\(\)===draft.markdown/);
  assert.match(reviewScript,/node.value===draft.title/);
  assert.match(reviewScript,/data-proposal-strip/);
});

test('closed location helper requires a descendant of the old generated root', () => {
  assert.equal(relocatedPath('/old/data/PROTOTYPE-wipe-me/vault/Source.md','/old/data','/new/data'),'/new/data/PROTOTYPE-wipe-me/vault/Source.md');
  assert.throws(()=>relocatedPath('/old/data-copy/Source.md','/old/data','/new/data'));
  assert.throws(()=>relocatedPath('/old/data','/old/data','/new/data'));
});
test('receipt proof rejects duplicate publication and altered accepted authority', () => {
  const before={id:'pi-review-4:1',payload_hash:'original',note_id:'stable',target_path:'/old/vault/Note.md',intended_hash:'exact',proof:'retained',receipt:null,publications:1,canonicalSha256:sha256('canonical')};
  const after={...before,proof:null,receipt:JSON.stringify({noteId:'stable'}),publications:1};
  assertRecoveredEffect(before,after);
  for(const changed of [{payload_hash:'rebased'},{target_path:'/new/vault/Note.md'},{publications:2},{canonicalSha256:sha256('replayed different bytes')},{receipt:null}]) assert.throws(()=>assertRecoveredEffect(before,{...after,...changed}));
});
