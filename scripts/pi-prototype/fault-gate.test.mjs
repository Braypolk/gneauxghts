import test from 'node:test';
import assert from 'node:assert/strict';
import { faultEnvironment, publicationFaults, assertPublicationBoundary } from './fault-gate.mjs';

test('normal workspace fault launch pins native driver and removes competing fixture modes', () => {
  const parent = { GNEAUXGHTS_E2E_FOREGROUND: '1', PI_PROTOTYPE_DIAGNOSTICS: 'true', PI_PROTOTYPE_UI_GATE: 'true',
    PI_PROTOTYPE_EXPANDED_GATE: 'true', PI_PROTOTYPE_FOLLOWONS_GATE: 'true', PI_PROTOTYPE_TRANSCRIPT_GATE: 'true',
    PI_PROTOTYPE_FAULT: 'after-intent', PI_PROTOTYPE_E2E_CRASH_SCOPE: 'other', PI_PROTOTYPE_E2E_CRASH_BOUNDARY: 'other', KEEP: 'preserved' };
  const env = faultEnvironment(parent);
  assert.equal(env.WDIO_EMBEDDED_SERVER, 'true'); assert.equal(env.TAURI_WEBDRIVER_PORT, '4445');
  assert.equal(env.VITE_E2E_NATIVE, 'true'); assert.equal(env.PI_PROTOTYPE_INTERACTIVE_GATE, 'true');
  assert.equal(env.PI_PROTOTYPE_HTTP_FIXTURE, 'http://127.0.0.1:1443'); assert.equal(env.KEEP, 'preserved');
  for (const key of Object.keys(parent).filter(key=>key!=='KEEP')) assert(!(key in env), key);
  assert.equal(parent.PI_PROTOTYPE_FAULT, 'after-intent');
  assert.throws(()=>faultEnvironment({ PI_PROTOTYPE_DATA: '/private/evaluation' }));
});
const after = { id:'pi-review-2:2',payload_hash:'accepted',note_id:'same',target_path:'/generated/Note.md',intended_hash:'intended',
  receipt:JSON.stringify({noteId:'same'}),proof:null,publications:1,canonicalSha256:'unchanged' };
function before(fault) {return { ...after, receipt:fault==='after-receipt'?after.receipt:null,
  proof:fault==='after-publication'?'token':null, publications:fault==='after-intent'?0:1,
  canonicalSha256:fault==='after-intent'?null:'unchanged' };}
for (const fault of publicationFaults) test(`${fault} requires exact accepted identity and one eventual canonical effect`, () => {
  assertPublicationBoundary(fault,before(fault),after);
  for (const changed of [{payload_hash:'rebased'},{note_id:'new'},{intended_hash:'other'},{target_path:'/new/path'},
    {publications:2},{receipt:null},{proof:'still pending'}]) assert.throws(()=>assertPublicationBoundary(fault,before(fault),{...after,...changed}));
  if(fault!=='after-intent')assert.throws(()=>assertPublicationBoundary(fault,before(fault),{...after,canonicalSha256:'rewritten'}));
});
test('publication boundary proof rejects the wrong initial crash point', () => {
  assert.throws(()=>assertPublicationBoundary('after-intent',before('after-publication'),after));
  assert.throws(()=>assertPublicationBoundary('after-publication',before('after-receipt'),after));
  assert.throws(()=>assertPublicationBoundary('after-receipt',before('after-intent'),after));
});

test('edited checkpoint requires retained mapped hunks rather than pre-mount API text replacement', async () => {
  const { assertEditedCheckpoint, editReviewScript } = await import('./fault-gate.mjs');
  const body='Edited checkpoint retained through restart.', title='Edited Pi title';
  const draft={markdown:body,title,decisions:[{from:0,to:body.length,status:'modified'}]};
  assertEditedCheckpoint(draft,body,title);
  assert.throws(()=>assertEditedCheckpoint({...draft,decisions:[]},body,title));
  assert.throws(()=>assertEditedCheckpoint({...draft,decisions:[{from:0,to:body.length+8,status:'modified'}]},body,title));
  assert.throws(()=>assertEditedCheckpoint({...draft,decisions:[{from:body.length,to:0,status:'modified'}]},body,title));
  assert.throws(()=>assertEditedCheckpoint({...draft,decisions:[{from:0,to:body.length,status:'pending'}]},body,title));
  assert(editReviewScript.includes('view.dispatch('));
  assert(editReviewScript.includes("import('/src/lib/prototypes/pi/probeEditorView.ts')"));
  assert(editReviewScript.includes('EditorView.findFromDOM(node)'));
  assert(!editReviewScript.includes('/node_modules/@codemirror/'));
  assert(editReviewScript.includes('field.dispatchEvent(new InputEvent'));
  assert(editReviewScript.includes('pi_validate_review_checkpoint'));
  assert(!editReviewScript.includes('checkpointProposalDraft('));
  // Browser program syntax is parsed without running imports or mounting UI.
  const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
  assert.doesNotThrow(()=>new AsyncFunction(editReviewScript));
});
