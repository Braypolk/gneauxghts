import test from 'node:test';
import assert from 'node:assert/strict';
import { relocatedPath, assertRecoveredEffect, sha256 } from './native-transcript-gate.mjs';

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
