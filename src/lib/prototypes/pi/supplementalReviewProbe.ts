// Fixture-only supplements to the shared normal-workspace review journey.
// Mutations enter the mounted editor, title field, location control and composer.
import type { EditorView } from '@codemirror/view';
import type { ChatApi } from '$lib/features/chat/api';
import type { ChatProposalDraft } from '$lib/features/chat/types';
import type { ReviewHunkState } from '$lib/types/proposals';
import { reviewProjection } from '$lib/features/proposals/reviewExtension';
import { acknowledgedProbeDraft } from './probeReview';
import { probePaneTitle } from './probePaneTitle';
import { visibleProbeControl } from './probeChatFocus';

export type SupplementalReviewState = {
  proposalId: string; conversationId: string; reviewId: string;
  beforeRefinement: ChatProposalDraft; refinedDraft: ChatProposalDraft;
  retainedDraft: ChatProposalDraft; checks: string[];
};
type Until = <T>(read: () => T | Promise<T>, label: string) => Promise<NonNullable<T>>;
type ReviewApi = Pick<ChatApi, 'getProposalDraft' | 'listPendingProposals'>;
type Controls = {
  api: ReviewApi; openReview(id: string, reviewId?: string): Promise<EditorView>;
  openChat(): Promise<void>; until: Until;
};
type MountedReview = {
  connected: boolean; markdown: string; title: string | undefined;
  projection: { reviewId: string; hunks: ReviewHunkState[] } | null | undefined;
};
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }

export function assertSupplementalReviewDraft(expected: ChatProposalDraft, actual: ChatProposalDraft) {
  assert(actual.version === expected.version && actual.markdown === expected.markdown && actual.title === expected.title &&
    actual.path === expected.path && JSON.stringify(actual.decisions) === JSON.stringify(expected.decisions),
  'Supplemental review differs from exact acknowledged version/body/title/location/hunks');
}
export function assertSupplementalReviewMounted(state: Pick<SupplementalReviewState, 'reviewId' | 'retainedDraft'>, mounted: MountedReview) {
  assert(mounted.connected && mounted.projection?.reviewId === state.reviewId, 'Supplemental mounted review identity or connection differs');
  assert(mounted.markdown === state.retainedDraft.markdown && mounted.title === state.retainedDraft.title &&
    JSON.stringify(mounted.projection.hunks) === JSON.stringify(state.retainedDraft.decisions),
  'Supplemental mounted review body/title/hunks differ from exact checkpoint');
}
export function supplementalRefinementPrompt(proposalId: string, draft: ChatProposalDraft) {
  assert(/^pi-review-[1-9]\d*$/.test(proposalId), 'Supplemental refinement requires a durable Pi review identity');
  return `PI_SUPPLEMENTAL_REVIEW:REFINE:${proposalId}\nExpected latest acknowledged draft: ${JSON.stringify(draft)}`;
}
const refinedMarkdown = (draft: ChatProposalDraft) => `${draft.markdown}\n\nSynthetic refinement preserves the latest human body/title/location.`;
function mounted(view: EditorView): MountedReview {
  return { connected: view.dom.isConnected, markdown: view.state.doc.toString(),
    title: probePaneTitle(view.dom.closest<HTMLElement>('[data-testid="workspace-pane"]'), 'editor')?.value,
    projection: view.state.field(reviewProjection, false) };
}
function input(field: HTMLInputElement, value: string) {
  field.focus(); field.value = value;
  field.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
}
async function acknowledged(controls: Controls, proposalId: string, view: EditorView, path?: string) {
  return acknowledgedProbeDraft({ until: controls.until, draft: () => controls.api.getProposalDraft!(proposalId), working: () => {
    const current = mounted(view);
    assert(current.connected && current.title !== undefined && current.projection, 'Supplemental working review is unavailable');
    return { markdown: current.markdown, title: current.title, decisions: current.projection.hunks, ...(path ? { path } : {}) };
  } });
}

/** Compact chat navigation can destroy its former editor mount. Wait for the
 * location control's durable acknowledgement before the normal review opener
 * captures its draft, then verify the newly acquired mount against that draft. */
export async function reacquireSupplementalReviewCheckpoint(controls: Controls & {
  proposalId: string; reviewId: string; previousDraft: ChatProposalDraft; path: string;
}) {
  const { api, proposalId, reviewId, previousDraft, path } = controls;
  const relocated = await controls.until(async () => {
    const draft = await api.getProposalDraft!(proposalId);
    if (draft.path !== path || draft.version <= previousDraft.version) return undefined;
    assertSupplementalReviewDraft({ ...previousDraft, path, version: draft.version }, draft);
    return draft;
  }, 'supplemental location control durable acknowledgement before editor reacquisition');
  const view = await controls.openReview(proposalId, reviewId);
  const draft = await acknowledged(controls, proposalId, view, path);
  assertSupplementalReviewDraft(relocated, draft);
  assertSupplementalReviewMounted({ reviewId, retainedDraft: relocated }, mounted(view));
  return { view, draft };
}

/** Call before shared FIRST starts INTERRUPT. The shared queue/switch and actual
 * process termination then exercise this same pending creation. */
export async function prepareSupplementalReviewProbe(controls: Controls & {
  conversationId: string; proposalId: string;
  send(conversationId: string, prompt: string): Promise<unknown>;
}): Promise<SupplementalReviewState> {
  const { api, proposalId, conversationId, until } = controls;
  assert(api.getProposalDraft, 'Supplemental review requires public acknowledged-draft reads');
  const pending = (await api.listPendingProposals(conversationId)).find(value => value.id === proposalId);
  assert(pending?.kind === 'create' && typeof pending.preview.reviewId === 'string', 'Supplemental location journey requires the same pending creation');
  const reviewId = pending.preview.reviewId;
  const original = await api.getProposalDraft(proposalId);
  let view = await controls.openReview(proposalId, reviewId);
  // A replacement is an ordinary editable transaction. It changes the real
  // creation hunk to modified without resolving the sole hunk and publishing.
  const editedBody = `${original.markdown}\n\nHuman latest draft before model refinement.`;
  const editedTitle = 'Pi supplemental latest reviewed title';
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: editedBody }, userEvent: 'input.type' });
  const titleField = await until(() => {
    const field = probePaneTitle(view.dom.closest<HTMLElement>('[data-testid="workspace-pane"]'), 'editor');
    return field && !field.readOnly && visibleProbeControl(field) ? field : undefined;
  }, 'supplemental normal review title field');
  input(titleField, editedTitle); titleField.blur();
  const titled = await acknowledged(controls, proposalId, view);
  assert(titled.version > original.version && titled.markdown === editedBody && titled.title === editedTitle &&
    titled.decisions.some(value => value.status === 'modified'), 'Supplemental body/title/hunk edit was not acknowledged');

  await controls.openChat();
  const locationField = await until(() => {
    const field = document.querySelector<HTMLInputElement>(`[data-proposal-strip="active"][data-proposal-id="${proposalId}"] input[aria-label="New note location"]`);
    return field && !field.disabled && visibleProbeControl(field) ? field : undefined;
  }, 'supplemental normal New note location control');
  // Chats/Pi exists through the shared conversation's native transcript. A new
  // directory gives location its own edit, independently of the title change.
  const parent = original.path.slice(0, original.path.lastIndexOf('/'));
  const path = `${parent}/Chats/Pi/${editedTitle}.md`;
  assert(path !== titled.path, 'Supplemental location must change the acknowledged destination');
  input(locationField, path); locationField.dispatchEvent(new Event('change', { bubbles: true })); locationField.blur();
  const reacquired = await reacquireSupplementalReviewCheckpoint({ ...controls, proposalId, reviewId, previousDraft: titled, path });
  view = reacquired.view;
  const beforeRefinement = reacquired.draft;
  assert(beforeRefinement.version > titled.version, 'Supplemental location control did not acknowledge a new draft version');

  await controls.send(conversationId, supplementalRefinementPrompt(proposalId, beforeRefinement));
  const refinedDraft = await until(async () => {
    const draft = await api.getProposalDraft!(proposalId);
    return draft.version === beforeRefinement.version + 1 && draft.markdown === refinedMarkdown(beforeRefinement) ? draft : undefined;
  }, 'same proposal refined from exact latest human checkpoint');
  assert(refinedDraft.title === beforeRefinement.title && refinedDraft.path === beforeRefinement.path && refinedDraft.decisions.length === 0,
    'Supplemental refinement lost latest title/location or retained obsolete hunk decisions');
  const same = (await api.listPendingProposals(conversationId)).find(value => value.id === proposalId);
  assert(same?.kind === 'create' && typeof same.preview.reviewId === 'string', 'Supplemental refinement replaced or settled the pending proposal');

  view = await controls.openReview(proposalId, same.preview.reviewId);
  const retainedBody = `${refinedDraft.markdown}\n\nHuman post-refinement edit retained through native restart.`;
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: retainedBody }, userEvent: 'input.type' });
  const retainedDraft = await acknowledged(controls, proposalId, view, path);
  assert(retainedDraft.version > refinedDraft.version && retainedDraft.markdown === retainedBody &&
    retainedDraft.decisions.some(value => value.status === 'modified'), 'Supplemental post-refinement live hunk checkpoint is missing');
  const state: SupplementalReviewState = { proposalId, conversationId, reviewId: same.preview.reviewId,
    beforeRefinement: structuredClone(beforeRefinement), refinedDraft: structuredClone(refinedDraft), retainedDraft: structuredClone(retainedDraft),
    checks: ['normal review body/title/location/modified-hunk checkpoints', 'normal composer refines exact latest acknowledged draft in same proposal', 'post-refinement live hunk checkpoint retained for process restart'] };
  assertSupplementalReviewMounted(state, mounted(view));
  return state;
}

/** Call on actual relaunch before shared Keep. Settlement remains the existing
 * normal Keep/publication proof, which predicts the hunk-decision checkpoint. */
export async function verifySupplementalReviewRestored(controls: Controls & { state: SupplementalReviewState }) {
  const { state, api } = controls;
  const pending = (await api.listPendingProposals(state.conversationId)).find(value => value.id === state.proposalId);
  assert(pending?.preview.reviewId === state.reviewId, 'Supplemental pending review identity changed or settled before relaunch');
  assertSupplementalReviewDraft(state.retainedDraft, await api.getProposalDraft!(state.proposalId));
  const view = await controls.openReview(state.proposalId, state.reviewId);
  assertSupplementalReviewMounted(state, mounted(view));
  assertSupplementalReviewDraft(state.retainedDraft, await api.getProposalDraft!(state.proposalId));
  return { proposalId: state.proposalId, reviewId: state.reviewId, draft: structuredClone(state.retainedDraft),
    checks: ['actual relaunch restores exact refined version/body/title/location/hunks before normal Keep'] };
}
