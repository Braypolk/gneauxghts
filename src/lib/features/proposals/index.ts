export type {
  NoteChange,
  AppliedNoteChange,
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
  previewNoteChangeProposal,
  commitNoteReview,
  proposalErrorMessage
} from './api';
export {
  createProposalReviewSession,
  proposalReviewSession,
  type ProposalReviewSession
} from './reviewSession.svelte';
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
  shouldSuppressAutosaveForDocument,
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
  type ChatProposalContext
} from './chatProposalParse';

export type {
  PendingProposalChange,
  ProposalChangeStatus,
  ProposalReviewSessionSnapshot,
  ProposalReviewActions
} from './types';
