import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { LIVE, liveProxyRoute, assertIosLiveReport, assertLiveNoReplay, assertLiveEffect, assertLivePublicationEvidence } from './ios-live-gate.mjs';
const body = change => Buffer.from(JSON.stringify({ model: LIVE.model, stream: true, messages: [{ role: 'user', content: 'Synthetic live gate' }], ...change }));
test('live pass-through routing admits only approved model inference and metadata paths', () => {
  assert.deepEqual(liveProxyRoute('POST', '/v1/chat/completions', body(), 0), { path: '/v1/chat/completions', inference: true, model: LIVE.model });
  assert.deepEqual(liveProxyRoute('GET', '/api/v1/models', Buffer.alloc(0), 0), { path: '/api/v1/models', inference: false });
  for (const [method, path, value, count] of [
    ['POST', '/v1/responses', body(), 0], ['POST', '/v1/chat/completions', body({ model: 'pi-native-fixture' }), 0],
    ['POST', '/v1/chat/completions', body({ stream: false }), 0], ['POST', '/v1/chat/completions', body(), LIVE.maxPosts],
    ['POST', '/v1/chat/completions', Buffer.alloc(LIVE.requestBytes + 1), 0], ['GET', '/api/v1/models?token=unwanted', Buffer.alloc(0), 0],
    ['GET', '/arbitrary', Buffer.alloc(0), 0], ['GET', '/v1/models', body(), 0],
  ]) assert.throws(() => liveProxyRoute(method, path, value, count));
});
test('a live report cannot hide an actual failure, stale launch or wrong upstream routing', () => {
  const report = { gate: 'ios-local-live', launchId: 'next', phase: 'complete', status: 'passed', receipts: { routing: { upstream: LIVE.upstream, endpoint: LIVE.endpoint, model: LIVE.model } } };
  assert.equal(assertIosLiveReport(report, 'complete', 'prior'), report);
  assert.throws(() => assertIosLiveReport({ ...report, status: 'failed', error: 'Observed local provider failure' }, 'complete', 'prior'), /Observed local provider failure/);
  assert.throws(() => assertIosLiveReport(report, 'complete', 'next'));
  assert.throws(() => assertIosLiveReport({ ...report, receipts: { routing: { upstream: 'https://api.openai.com/v1' } } }, 'complete', 'prior'));
});
test('background, Save and restart never acquire implicit inference permission', () => {
  assert.doesNotThrow(() => assertLiveNoReplay(4, 4, 'restart'));
  assert.throws(() => assertLiveNoReplay(4, 5, 'restart'), /restart dispatched inference/);
});
test('closed native proof requires one publication and the precise durable effect identity', () => {
  const committedMarkdown = 'Original answer.\n\nSynthetic iOS live review edit retained 12.', hash = createHash('sha256').update(committedMarkdown).digest('hex');
  const reviewed = { proposalId: 'proposal', reviewId: 'exact-review', draftVersion: 2, reviewedTitle: 'Saved', reviewedPath: '/owned/vault/Saved.md', reviewedSha256: hash };
  const receipt = { proposalId: 'proposal', reviewId: 'exact-review', version: 2, noteId: 'stable-note', path: reviewed.reviewedPath, expectedSha256: hash, canonical: { noteId: 'stable-note', title: 'Saved', path: reviewed.reviewedPath, editorSha256: hash } };
  const nativeReceipt = { status: 'committed', noteId: receipt.noteId, applied: { path: receipt.path }, committedMarkdown };
  // Raw canonical bytes contain managed frontmatter/title and have a distinct
  // hash from the independently acknowledged editor-facing body.
  const rawCanonicalHash = createHash('sha256').update(`---\ngneauxghts:\n  id: stable-note\n---\n# Saved\n\n${committedMarkdown}`).digest('hex');
  const effect = { id: 'proposal:2', note_id: 'stable-note', target_path: receipt.path, publications: 1, receipt: JSON.stringify(nativeReceipt), proof: null, payload_hash: hash, intended_hash: hash, canonicalSha256: rawCanonicalHash, canonicalRelativePath: 'Saved.md' };
  assert.equal(assertLiveEffect({ effects: [effect] }, receipt, reviewed, '/owned/vault'), effect);
  for (const effects of [[], [effect, effect], [{ ...effect, publications: 2 }], [{ ...effect, note_id: 'different' }], [{ ...effect, id: 'proposal:1' }], [{ ...effect, proof: '{}' }], [{ ...effect, receipt: null }], [{ ...effect, canonicalSha256: '' }], [{ ...effect, canonicalRelativePath: 'Other.md' }], [{ ...effect, receipt: JSON.stringify({ ...nativeReceipt, committedMarkdown: 'changed bytes' }) }]]) assert.throws(() => assertLiveEffect({ effects }, receipt, reviewed, '/owned/vault'));
  // Regression: the former self-consistent receipt check could accept wrong
  // body bytes that retained the marker, alongside their own valid hashes.
  const wrongBody = 'Lost original answer.\n\nSynthetic iOS live review edit retained 12.';
  const wrongHash = createHash('sha256').update(wrongBody).digest('hex');
  const wrongEffect = { ...effect, receipt: JSON.stringify({ ...nativeReceipt, committedMarkdown: wrongBody }), canonicalSha256: wrongHash };
  assert.throws(() => assertLiveEffect({ effects: [wrongEffect] }, { ...receipt, expectedSha256: wrongHash, canonical: { ...receipt.canonical, editorSha256: wrongHash } }, reviewed, '/owned/vault'), /reviewed content changed/);
  assert.throws(() => assertLiveEffect({ effects: [wrongEffect] }, receipt, reviewed, '/owned/vault'), /Native receipt differs/);
  assert.throws(() => assertLivePublicationEvidence({ ...receipt, canonical: { ...receipt.canonical, editorSha256: wrongHash } }, reviewed), /Canonical read_note projection differs/);
  assert.throws(() => assertLivePublicationEvidence({ ...receipt, reviewId: 'foreign-review' }, reviewed));
  assert.throws(() => assertLivePublicationEvidence({ ...receipt, version: 3 }, reviewed), /Keep version differs/);
  assert.throws(() => assertLivePublicationEvidence({ ...receipt, canonical: { ...receipt.canonical, title: 'Other' } }, reviewed));
});
