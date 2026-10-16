// Synthetic provider behavior only; native review reads, CAS checkpoints and
// publication remain application-owned. Compose before the base UI planner.
const marker = /PI_SUPPLEMENTAL_REVIEW:REFINE:(pi-review-[1-9]\d*)/;
const textOf = value => typeof value === 'string' ? value : Array.isArray(value) ? value.map(part => part.text ?? '').join('') : '';
const refinementSuffix = '\n\nSynthetic refinement preserves the latest human body/title/location.';
function equalDraft(left, right) {
  return left?.version === right?.version && left?.title === right?.title && left?.markdown === right?.markdown &&
    left?.path === right?.path && JSON.stringify(left?.decisions) === JSON.stringify(right?.decisions);
}
function requestOf(body, compatible) {
  const history = compatible ? body.messages : body.input;
  if (!Array.isArray(history)) return undefined;
  const last = history.findLastIndex(value => value.role === 'user');
  const prompt = textOf(history[last]?.content);
  const match = prompt.match(marker);
  if (!match) return undefined;
  const expectedText = prompt.split('\nExpected latest acknowledged draft: ')[1];
  if (!expectedText) throw new Error('Supplemental refinement omitted expected acknowledged draft');
  const expected = JSON.parse(expectedText);
  if (!Number.isSafeInteger(expected.version) || expected.version < 1 || typeof expected.markdown !== 'string' ||
    typeof expected.title !== 'string' || typeof expected.path !== 'string' || !Array.isArray(expected.decisions))
    throw new Error('Supplemental refinement expected draft is incomplete');
  return { proposalId: match[1], expected, tail: history.slice(last + 1) };
}
function callsOf(tail) {
  return tail.flatMap(value => value.tool_calls?.map(call => ({ id: call.id, name: call.function.name, arguments: call.function.arguments })) ??
    (value.type === 'function_call' ? [{ id: value.call_id, name: value.name, arguments: value.arguments }] : []));
}
function outputOf(tail, call) {
  const output = tail.findLast(value => (value.role === 'tool' || value.type === 'function_call_output') &&
    (value.tool_call_id ?? value.call_id) === call.id);
  if (!output) throw new Error(`Supplemental refinement lacks actual ${call.name} output`);
  return textOf(output.output ?? output.content);
}
function latestDraft(request, calls) {
  const read = calls.findLast(value => value.name === 'read_note_proposal');
  if (!read || JSON.parse(read.arguments).proposalId !== request.proposalId) throw new Error('Supplemental refinement read another proposal');
  const delivered = JSON.parse(outputOf(request.tail, read));
  if (delivered.proposalId !== request.proposalId || !equalDraft(request.expected, delivered))
    throw new Error('Supplemental refinement did not read exact latest acknowledged body/title/location/hunks/version');
  return delivered;
}
export function planSupplementalReviewReply(body, compatible) {
  const request = requestOf(body, compatible);
  if (!request) return undefined;
  const journey = 'SUPPLEMENTAL_REVIEW_REFINE';
  const tool = (name, args) => ({ journey, tool: { name, arguments: JSON.stringify(args) } });
  const calls = callsOf(request.tail);
  if (!calls.length) return tool('read_note_proposal', { proposalId: request.proposalId });
  if (calls.some(value => !['read_note_proposal', 'refine_note_proposal'].includes(value.name)))
    throw new Error('Supplemental refinement attempted another tool or proposal');
  const draft = latestDraft(request, calls);
  const refinement = calls.findLast(value => value.name === 'refine_note_proposal');
  const expectedArguments = { proposalId: request.proposalId, expectedVersion: draft.version,
    title: draft.title, markdown: `${draft.markdown}${refinementSuffix}` };
  if (!refinement) return tool('refine_note_proposal', expectedArguments);
  if (JSON.stringify(JSON.parse(refinement.arguments)) !== JSON.stringify(expectedArguments))
    throw new Error('Supplemental refinement submitted different latest draft/version');
  if (!outputOf(request.tail, refinement).includes(`Refined ${request.proposalId} at version ${draft.version + 1};`))
    throw new Error('Supplemental refinement has no exact native version acknowledgement');
  return { journey, text: 'Synthetic exact latest review draft refined; still awaiting human Keep.' };
}

/** Wire receipts prove the native read and refinement request. The app report
 * separately proves mounted edits, restart and canonical Keep publication. */
export function verifySupplementalReviewReceipts(requests, state) {
  if (!state?.proposalId || !state.beforeRefinement || !state.refinedDraft || !state.retainedDraft)
    throw new Error('Supplemental review state lacks acknowledged draft evidence');
  const matched = requests.filter(record => record.journey === 'SUPPLEMENTAL_REVIEW_REFINE' && record.body &&
    requestOf(record.body, record.path === '/local/v1/chat/completions')?.proposalId === state.proposalId);
  const completed = matched.findLast(record => record.completed && !record.tool);
  if (!completed) throw new Error('Missing completed native supplemental latest-draft refinement');
  const compatible = completed.path === '/local/v1/chat/completions';
  const request = requestOf(completed.body, compatible);
  if (!equalDraft(state.beforeRefinement, request.expected)) throw new Error('Supplemental wire expected draft differs from UI checkpoint');
  planSupplementalReviewReply(completed.body, compatible);
  if (state.refinedDraft.version !== state.beforeRefinement.version + 1 ||
    state.refinedDraft.markdown !== state.beforeRefinement.markdown + refinementSuffix ||
    state.refinedDraft.title !== state.beforeRefinement.title || state.refinedDraft.path !== state.beforeRefinement.path ||
    state.refinedDraft.decisions.length !== 0 || state.retainedDraft.version <= state.refinedDraft.version ||
    state.retainedDraft.title !== state.refinedDraft.title || state.retainedDraft.path !== state.refinedDraft.path ||
    !state.retainedDraft.markdown.startsWith(state.refinedDraft.markdown) ||
    !state.retainedDraft.decisions.some(value => value.status === 'modified'))
    throw new Error('Supplemental refined/retained checkpoint chain differs');
  return { proposalId: state.proposalId, protocol: compatible ? 'local-compatible' : 'Responses',
    readVersion: state.beforeRefinement.version, refinedVersion: state.refinedDraft.version,
    restartVersion: state.retainedDraft.version, requestCount: matched.length };
}
