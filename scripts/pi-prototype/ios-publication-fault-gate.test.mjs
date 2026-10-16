import test from 'node:test';
import assert from 'node:assert/strict';
import { createIosPublicationFaultControl, assertIosPublicationReports } from './ios-publication-fault-gate.mjs';

test('publication control rejects unknown boundaries/scopes and old or repeated crash commands', () => {
  assert.throws(() => createIosPublicationFaultControl('unknown-boundary', 'synthetic-1234'));
  assert.throws(() => createIosPublicationFaultControl('after-intent', '../private'));
  const control = createIosPublicationFaultControl('after-intent', 'synthetic-1234', { now: () => 10, nonce: () => 'fresh-owned-nonce-1234' });
  assert.equal(control.config().execute, undefined);
  assert.throws(() => control.acknowledge({ boundary: 'after-intent', scope: 'synthetic-1234', nonce: 'old' }), /Fresh exact/);
  const command = control.release(), ack = { ...command, boundary: 'after-intent', scope: 'synthetic-1234', launchId: 'first-launch-1234' };
  assert.throws(() => control.acknowledge({ ...ack, scope: 'another-scope' }), /Fresh exact/);
  assert.throws(() => control.acknowledge({ ...ack, nonce: 'old' }), /Fresh exact/);
  assert.equal(control.acknowledge(ack).acknowledgedAt, 10);
  assert.equal(control.receipt().launchId, ack.launchId);
  assert.throws(() => control.acknowledge(ack), /already acknowledged/);
  assert.throws(() => control.release(), /already issued/);
});

test('iOS recovery classifier requires a new launch, exact retained accepted fields and duplicate canonical receipt', () => {
  const state = { firstLaunchId: 'first-launch', boundary: 'after-intent', scope: 'synthetic-1234', conversationId: 'pi-1', proposalId: 'pi-review-2', reviewId: 'review-2',
    reviewedDraft: { version: 1 }, acceptedDraft: { version: 2 }, expectedEditorMarkdown: 'exact bytes', sourceMessageId: 'assistant-1', sourceContent: 'source' };
  const first = { gate: 'ios-native-publication-fault', launchId: state.firstLaunchId, phase: 'ready-to-crash', state };
  const recovered = { gate: first.gate, launchId: 'second-launch', phase: 'recovered', status: 'passed', state: structuredClone(state), restoredDraft: state.acceptedDraft,
    receipt: { status: 'committed', noteId: 'note-1' }, duplicate: { status: 'committed', noteId: 'note-1' }, canonical: { noteId: 'note-1', markdown: 'exact bytes' } };
  assert.doesNotThrow(() => assertIosPublicationReports(first, recovered));
  for (const mutate of [value => { value.launchId = first.launchId; }, value => { value.state.acceptedDraft.version = 3; },
    value => { value.state.sourceContent = 'old'; }, value => { value.duplicate.noteId = 'another'; }, value => { value.canonical.markdown = 'old'; },
    value => { value.status = 'failed'; }]) {
    const actual = structuredClone(recovered); mutate(actual); assert.throws(() => assertIosPublicationReports(first, actual));
  }
});
