import type {
  ProposalReviewRuntime,
  ProposalReviewSessionSnapshot
} from './types';
import type { NoteDraftState } from '$lib/features/notepad/state/noteStore';
import {
  createProposalReviewWorkflowState,
  transitionProposalReviewWorkflow,
  type ProposalReviewWorkflowEvent,
  type ProposalReviewWorkflowState
} from './proposalReviewMachine';

/**
 * Shared proposal review session. Chat list and notepad inline review both bind here.
 */
export function createProposalReviewSession() {
  let workflow = $state.raw<
    ProposalReviewWorkflowState<ProposalReviewRuntime>
  >(createProposalReviewWorkflowState());
  // Proposal runtimes intentionally remain raw because they retain editor and
  // document resources. This revision invalidates reactive projections after
  // their mutable hunk snapshot changes.
  let runtimeRevision = $state(0);

  function snapshot(): ProposalReviewSessionSnapshot {
    runtimeRevision;
    const review = workflow.kind === 'idle'
      ? null
      : workflow.review;
    const unresolvedHunks = review
      ? review.hunkSnapshot.filter(
          (hunk) =>
            hunk.status === 'pending' ||
            hunk.status === 'modified'
        ).length
      : 0;
    return {
      proposalId:
        workflow.kind === 'idle'
          ? null
          : workflow.identity.proposalId,
      notePath:
        workflow.kind === 'idle'
          ? null
          : workflow.identity.notePath,
      title: review?.request.preview.title ?? null,
      totalHunks: review?.request.preview.hunks.length ?? 0,
      unresolvedHunks,
      isApplying:
        workflow.kind === 'committing' ||
        workflow.kind === 'dismissing',
      isConflicted:
        workflow.kind === 'conflicted' ||
        (workflow.kind === 'confirmingDiscard' &&
          workflow.recoverTo === 'conflicted'),
      error: workflow.error
    };
  }

  function dispatchWorkflow(
    event: ProposalReviewWorkflowEvent<ProposalReviewRuntime>
  ): boolean {
    const next = transitionProposalReviewWorkflow(workflow, event);
    if (next === workflow) return false;
    workflow = next;
    return true;
  }

  function notifyReviewRuntimeChanged() {
    runtimeRevision += 1;
  }

  return {
    get snapshot() {
      return snapshot();
    },
    get workflow() {
      return workflow;
    },
    dispatchWorkflow,
    notifyReviewRuntimeChanged,
    isReviewingDocument(document: NoteDraftState) {
      if (workflow.kind === 'idle') return false;
      return workflow.review?.document.handle === document.handle;
    }
  };
}

export type ProposalReviewSession = ReturnType<typeof createProposalReviewSession>;

/** App-wide session singleton used by chat + notepad. */
export const proposalReviewSession = createProposalReviewSession();

export function shouldSuppressAutosaveForDocument(
  document: NoteDraftState,
  session: ProposalReviewSession = proposalReviewSession
): boolean {
  return session.isReviewingDocument(document);
}
