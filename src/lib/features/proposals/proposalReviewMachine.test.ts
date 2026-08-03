import { describe, expect, it } from 'vitest';
import {
  createProposalReviewWorkflowState,
  transitionProposalReviewWorkflow,
  type ProposalReviewIdentity,
  type ProposalReviewWorkflowState
} from './proposalReviewMachine';

const first: ProposalReviewIdentity = {
  reviewId: 'review-1',
  proposalId: 'proposal-1',
  notePath: '/vault/One.md'
};
const second: ProposalReviewIdentity = {
  reviewId: 'review-2',
  proposalId: 'proposal-2',
  notePath: '/vault/Two.md'
};

function reviewing(
  identity = first
): ProposalReviewWorkflowState<{ id: string }> {
  let state = transitionProposalReviewWorkflow(
    createProposalReviewWorkflowState<{ id: string }>(),
    { type: 'openRequested', identity }
  );
  state = transitionProposalReviewWorkflow(state, {
    type: 'openPrepared',
    identity,
    review: { id: identity.reviewId }
  });
  return transitionProposalReviewWorkflow(state, {
    type: 'openSucceeded',
    identity
  });
}

describe('proposal review workflow machine', () => {
  it('opens a prepared review', () => {
    const opened = reviewing();
    expect(opened).toMatchObject({
      kind: 'reviewing',
      error: null
    });
  });

  it('allows a new proposal to replace reviewing or conflicted state', () => {
    const current = reviewing();
    const replacing = transitionProposalReviewWorkflow(current, {
      type: 'openRequested',
      identity: second
    });
    expect(replacing).toMatchObject({
      kind: 'opening',
      identity: second
    });

    const conflicted = transitionProposalReviewWorkflow(current, {
      type: 'externalConflict',
      reviewId: first.reviewId,
      error: 'changed on disk'
    });
    expect(
      transitionProposalReviewWorkflow(conflicted, {
        type: 'openRequested',
        identity: second
      })
    ).toMatchObject({ kind: 'opening', identity: second });
  });

  it('does not replace a commit or dismissal in progress', () => {
    const current = reviewing();
    for (const resolution of ['commit', 'dismiss'] as const) {
      const busy = transitionProposalReviewWorkflow(current, {
        type: 'resolutionRequested',
        reviewId: first.reviewId,
        resolution
      });
      expect(
        transitionProposalReviewWorkflow(busy, {
          type: 'openRequested',
          identity: second
        })
      ).toBe(busy);
    }
  });

  it('recovers commit conflict and retry without a second operation counter', () => {
    const committing = transitionProposalReviewWorkflow(reviewing(), {
      type: 'resolutionRequested',
      reviewId: first.reviewId,
      resolution: 'commit'
    });
    const conflicted = transitionProposalReviewWorkflow(committing, {
      type: 'completionConflicted',
      reviewId: first.reviewId,
      error: 'changed on disk'
    });
    expect(conflicted).toMatchObject({
      kind: 'conflicted',
      error: 'changed on disk'
    });
    expect(
      transitionProposalReviewWorkflow(conflicted, {
        type: 'resolutionRequested',
        reviewId: first.reviewId,
        resolution: 'commit'
      })
    ).toMatchObject({ kind: 'committing' });
  });

  it('requires two discard requests before entering reload dismissal', () => {
    const current = reviewing();
    const confirming = transitionProposalReviewWorkflow(current, {
      type: 'discardRequested',
      reviewId: first.reviewId,
      confirmationMessage: 'confirm discard'
    });
    expect(confirming).toMatchObject({
      kind: 'confirmingDiscard',
      recoverTo: 'reviewing',
      error: 'confirm discard'
    });
    expect(
      transitionProposalReviewWorkflow(confirming, {
        type: 'discardRequested',
        reviewId: first.reviewId,
        confirmationMessage: 'confirm discard'
      })
    ).toMatchObject({
      kind: 'dismissing',
      reason: 'reload'
    });
  });

  it('disarms discard confirmation after another review interaction', () => {
    const confirming = transitionProposalReviewWorkflow(reviewing(), {
      type: 'discardRequested',
      reviewId: first.reviewId,
      confirmationMessage: 'confirm discard'
    });
    const resumed = transitionProposalReviewWorkflow(confirming, {
      type: 'discardCancelled',
      reviewId: first.reviewId
    });

    expect(resumed).toMatchObject({
      kind: 'reviewing',
      error: null
    });
    expect(
      transitionProposalReviewWorkflow(resumed, {
        type: 'discardRequested',
        reviewId: first.reviewId,
        confirmationMessage: 'confirm again'
      })
    ).toMatchObject({
      kind: 'confirmingDiscard',
      error: 'confirm again'
    });
  });

  it('disarms discard confirmation when another message replaces the prompt', () => {
    const confirming = transitionProposalReviewWorkflow(reviewing(), {
      type: 'discardRequested',
      reviewId: first.reviewId,
      confirmationMessage: 'confirm discard'
    });
    const copied = transitionProposalReviewWorkflow(confirming, {
      type: 'errorSet',
      reviewId: first.reviewId,
      error: 'Current editor text copied.'
    });

    expect(copied).toMatchObject({
      kind: 'reviewing',
      error: 'Current editor text copied.'
    });
    expect(
      transitionProposalReviewWorkflow(copied, {
        type: 'discardRequested',
        reviewId: first.reviewId,
        confirmationMessage: 'confirm again'
      })
    ).toMatchObject({ kind: 'confirmingDiscard' });
  });

  it('ignores a completion for another review', () => {
    const committing = transitionProposalReviewWorkflow(reviewing(), {
      type: 'resolutionRequested',
      reviewId: first.reviewId,
      resolution: 'commit'
    });
    expect(
      transitionProposalReviewWorkflow(committing, {
        type: 'completionSucceeded',
        reviewId: second.reviewId
      })
    ).toBe(committing);
  });
});
