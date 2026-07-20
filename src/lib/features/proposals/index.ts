export type {
  NoteChange,
  AppliedNoteChange,
  ApplyNoteChangesResult,
  ProposedTextEdit,
  ProposalPreview,
  ProposalPreviewHunk,
  CommitNoteReviewResult
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

export {
  applyNoteChangeProposal,
  previewNoteChangeProposal,
  commitNoteReview,
  hashMarkdownContent,
  hashNoteAtPath
} from './api';
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
  proposalTransaction,
  resolveReviewHunk,
  type ProposalReviewState,
  type ReviewHunkState
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
  parseChatProposalEdits,
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
