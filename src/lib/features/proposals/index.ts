export type {
  AppliedNoteChange,
  ProposalPreview,
  ProposalPreviewHunk,
  CommitNoteReviewResult
} from '$lib/types/proposals';

export {
  createProposalReviewSession,
  proposalReviewSession,
  shouldSuppressAutosaveForDocument,
  type ProposalReviewSession
} from './reviewSession.svelte';
export {
  createProposalReviewWorkflowState,
  transitionProposalReviewWorkflow,
  type ProposalReviewWorkflowState,
  type ProposalReviewWorkflowEvent
} from './proposalReviewMachine';
export {
  createProposalReviewExtension,
  proposalTransaction,
  resolveReviewHunk,
  type ProposalReviewState,
  type ReviewHunkState
} from './reviewExtension';
export {
  enterProposalReviewView,
  exitProposalReviewView
} from './reviewDisplay';
export {
  createProposalOrchestration,
  type ProposalOrchestration,
  type ProposalOrchestrationDeps
} from './proposalOrchestration';
export type {
  DurableProposalReviewRequest,
  ProposalReviewRuntime,
  ProposalReviewSessionSnapshot
} from './types';
