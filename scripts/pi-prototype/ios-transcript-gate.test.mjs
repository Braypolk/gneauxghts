import test from 'node:test';
import assert from 'node:assert/strict';
import { assertContainerChange, assertIosTranscriptReport } from './ios-transcript-gate.mjs';

test('a rename back into the same sandbox cannot establish relocation',()=>{
  assert.throws(()=>assertContainerChange('/sim/old-container','/sim/old-container'));
  assert.doesNotThrow(()=>assertContainerChange('/sim/old-container','/sim/new-container'));
});
test('failed, stale-launch and wrong-phase WKWebView reports cannot pass',()=>{
  const report={gate:'ios-native-transcript-fixture',phase:'complete',status:'passed',launchId:'second'};
  assert.equal(assertIosTranscriptReport(report,'complete','first'),report);
  assert.throws(()=>assertIosTranscriptReport(report,'complete','second'));
  assert.throws(()=>assertIosTranscriptReport({...report,status:'failed',error:'actual native fault'},'complete','first'),/actual native fault/);
  assert.throws(()=>assertIosTranscriptReport(report,'ready-to-relocate','first'));
});
