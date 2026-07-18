export type {
  NoteChange,
  AppliedNoteChange,
  ApplyNoteChangesResult
} from '$lib/types/proposals';
export {
  noteChangePath,
  noteChangeTitle,
  noteChangeProposedMarkdown,
  fileNameTitle
} from '$lib/types/proposals';

export {
  buildLineDiff,
  buildCreateDiff,
  buildDeleteDiff,
  type DiffLine,
  type DiffLineKind,
  type DiffHunk,
  type NoteDiffModel
} from './diffModel';

export { applyNoteChangeProposal, hashMarkdownContent } from './api';
export {
  createProposalReviewSession,
  proposalReviewSession,
  type ProposalReviewSession
} from './reviewSession.svelte';
export {
  createProposalApplyController,
  type ProposalApplyController,
  type ProposalApplyHooks
} from './applyController';
export {
  loadUpdateFixtureForActiveNote,
  loadMultiFileFixture,
  type FixtureActiveNote
} from './fixtures';
export {
  createProposalReviewExtension,
  reviewStateFromChange,
  type ProposalReviewEditorState
} from './reviewExtension';
export {
  reviewHoldStore,
  createReviewHoldStore,
  assertCanKeepChange,
  shouldSuppressAutosaveForDocument,
  findPendingReviewForDocument,
  type ReviewHoldStore,
  type ReviewDocumentHold
} from './reviewHold.svelte';
export {
  enterProposalReviewView,
  exitProposalReviewView
} from './reviewDisplay';
export {
  createProposalOrchestration,
  type ProposalOrchestration,
  type ProposalOrchestrationDeps
} from './proposalOrchestration';
export {
  extractProposalFence,
  parseChatProposalDrafts,
  resolveChatProposalDrafts,
  type ChatProposalDraft,
  type ChatProposalContext
} from './chatProposalParse';
export type {
  PendingProposalChange,
  ProposalChangeStatus,
  ProposalReviewSessionSnapshot,
  ProposalReviewActions
} from './types';
