import test from 'node:test';
import assert from 'node:assert/strict';
import { planSupplementalReviewReply, verifySupplementalReviewReceipts } from './supplemental-review-fixture.mjs';

const draft = { version: 6, markdown: 'Human latest body.', title: 'Human latest title', path: '/synthetic/Chats/Pi/Human latest title.md',
  decisions: [{ id: 'creation', from: 0, to: 18, status: 'modified', oldText: '', newText: 'Initial text' }] };
const proposalId = 'pi-review-17';
const suffix = '\n\nSynthetic refinement preserves the latest human body/title/location.';
const prompt = `PI_SUPPLEMENTAL_REVIEW:REFINE:${proposalId}\nExpected latest acknowledged draft: ${JSON.stringify(draft)}`;
const read = { name: 'read_note_proposal', arguments: JSON.stringify({ proposalId }) };
const refine = { name: 'refine_note_proposal', arguments: JSON.stringify({ proposalId, expectedVersion: draft.version, title: draft.title, markdown: draft.markdown + suffix }) };
const state = { proposalId, beforeRefinement: draft, refinedDraft: { ...draft, version: 7, markdown: draft.markdown + suffix, decisions: [] },
  retainedDraft: { ...draft, version: 9, markdown: draft.markdown + suffix + '\n\nLater human edit.' } };
const acknowledged = `Refined ${proposalId} at version 7; awaiting human review. No canonical note was changed.`;

test('supplemental planner leaves ordinary workspace requests to their original owner', () => {
  assert.equal(planSupplementalReviewReply({ messages: [{ role: 'user', content: 'PI_UI:REFINE:pi-review-17' }] }, true), undefined);
  assert.equal(planSupplementalReviewReply({}, false), undefined);
  assert.throws(() => verifySupplementalReviewReceipts([], state), /Missing completed native/);
});
for (const compatible of [true, false]) {
  const protocol = compatible ? 'compatible' : 'Responses';
  const path = compatible ? '/local/v1/chat/completions' : '/openai/v1/responses';
  const body = (pairs = [], user = prompt, prior = []) => {
    const tail = pairs.flatMap(([call, result], index) => compatible ? [
      { role: 'assistant', tool_calls: [{ id: `call-${index}`, type: 'function', function: call }] },
      { role: 'tool', tool_call_id: `call-${index}`, content: typeof result === 'string' ? result : JSON.stringify(result) }
    ] : [ { type: 'function_call', call_id: `call-${index}`, ...call },
      { type: 'function_call_output', call_id: `call-${index}`, output: typeof result === 'string' ? result : JSON.stringify(result) } ]);
    return { model: 'pi-native-fixture', [compatible ? 'messages' : 'input']: [...prior, { role: 'user', content: user }, ...tail] };
  };
  test(`${protocol} reads the same pending proposal before refining its exact acknowledged version`, () => {
    assert.deepEqual(planSupplementalReviewReply(body(), compatible).tool, read);
    const request = body([[read, { proposalId, ...draft }]]);
    assert.deepEqual(planSupplementalReviewReply(request, compatible).tool, refine);
    const answer = planSupplementalReviewReply(body([[read, { proposalId, ...draft }], [refine, acknowledged]]), compatible);
    assert.equal(answer.tool, undefined); assert.match(answer.text, /still awaiting human Keep/);
  });
  test(`${protocol} rejects stale text/version/location/hunks and unrelated draft output`, () => {
    for (const changed of [ { ...draft, version: 5 }, { ...draft, markdown: 'initial text' }, { ...draft, title: 'initial title' },
      { ...draft, path: '/synthetic/Initial.md' }, { ...draft, decisions: [] } ])
      assert.throws(() => planSupplementalReviewReply(body([[read, { proposalId, ...changed }]]), compatible), /exact latest acknowledged/);
    assert.throws(() => planSupplementalReviewReply(body([[read, { proposalId: 'pi-review-18', ...draft }]]), compatible), /exact latest acknowledged/);
    assert.throws(() => planSupplementalReviewReply(body([[{ ...read, arguments: JSON.stringify({ proposalId: 'pi-review-18' }) }, { proposalId, ...draft }]]), compatible), /read another proposal/);
    // A complete old draft in earlier conversation history cannot replace a
    // missing current-turn native read.
    assert.throws(() => planSupplementalReviewReply(body([[refine, acknowledged]], prompt,
      [{ role: 'assistant', content: JSON.stringify({ proposalId, ...draft }) }]), compatible), /read another proposal/);
  });
  test(`${protocol} fails native refinement errors, wrong arguments and attempts to create a substitute proposal`, () => {
    const delivered = [read, { proposalId, ...draft }];
    assert.throws(() => planSupplementalReviewReply(body([delivered, [refine, 'Review changed; reopen its latest checkpoint']]), compatible), /no exact native version acknowledgement/);
    assert.throws(() => planSupplementalReviewReply(body([delivered, [{ ...refine, arguments: JSON.stringify({ proposalId, expectedVersion: 5, title: draft.title, markdown: draft.markdown + suffix }) }, acknowledged]]), compatible), /different latest draft/);
    assert.throws(() => planSupplementalReviewReply(body([[{ name: 'propose_note', arguments: '{}' }, {}]]), compatible), /another tool or proposal/);
    assert.throws(() => planSupplementalReviewReply(body([], `PI_SUPPLEMENTAL_REVIEW:REFINE:${proposalId}`), compatible), /omitted expected/);
  });
  test(`${protocol} receipt verifier binds real wire read/refine acknowledgement to the UI checkpoint chain`, () => {
    const record = { path, journey: 'SUPPLEMENTAL_REVIEW_REFINE', completed: true, tool: null,
      body: body([[read, { proposalId, ...draft }], [refine, acknowledged]]) };
    assert.deepEqual(verifySupplementalReviewReceipts([record], state), { proposalId, protocol: compatible ? 'local-compatible' : 'Responses',
      readVersion: 6, refinedVersion: 7, restartVersion: 9, requestCount: 1 });
    assert.throws(() => verifySupplementalReviewReceipts([{ ...record, completed: false }], state), /Missing completed native/);
    assert.throws(() => verifySupplementalReviewReceipts([record], { ...state, beforeRefinement: { ...draft, version: 5 } }), /wire expected draft/);
    assert.throws(() => verifySupplementalReviewReceipts([record], { ...state, refinedDraft: { ...state.refinedDraft, path: '/synthetic/Wrong.md' } }), /checkpoint chain/);
    assert.throws(() => verifySupplementalReviewReceipts([record], { ...state, retainedDraft: { ...state.retainedDraft, decisions: [] } }), /checkpoint chain/);
  });
}
