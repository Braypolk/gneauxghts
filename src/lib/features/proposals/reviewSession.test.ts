import { describe, expect, it } from 'vitest';
import { createProposalReviewSession } from './reviewSession.svelte';
import type { ProposalReviewRuntime } from './types';

const identity = {
  reviewId: 'review-1',
  proposalId: 'proposal-1',
  notePath: '/vault/A.md'
};

function reviewRuntime(): ProposalReviewRuntime {
  return {
    request: {
      proposalId: identity.proposalId,
      preview: {
        reviewId: identity.reviewId,
        notePath: identity.notePath,
        title: 'A',
        baseContentHash: 'hash',
        baseEditorMarkdown: 'old',
        proposedEditorMarkdown: 'new',
        hunks: [
          {
            id: 'hunk-1',
            baseFrom: 0,
            baseTo: 3,
            proposedFrom: 0,
            proposedTo: 3,
            oldText: 'old',
            newText: 'new'
          }
        ]
      }
    } as ProposalReviewRuntime['request'],
    document: {} as ProposalReviewRuntime['document'],
    editor: {} as ProposalReviewRuntime['editor'],
    hunkSnapshot: [
      {
        id: 'hunk-1',
        baseFrom: 0,
        baseTo: 3,
        proposedFrom: 0,
        proposedTo: 3,
        oldText: 'old',
        newText: 'new',
        from: 0,
        to: 3,
        status: 'pending'
      }
    ],
    workingMarkdown: 'new'
  };
}

describe('createProposalReviewSession', () => {
  it('projects active proposal and hunk state from the workflow runtime', () => {
    const session = createProposalReviewSession();
    const review = reviewRuntime();

    session.dispatchWorkflow({ type: 'openRequested', identity });
    session.dispatchWorkflow({ type: 'openPrepared', identity, review });
    session.dispatchWorkflow({ type: 'openSucceeded', identity });

    expect(session.snapshot).toMatchObject({
      proposalId: 'proposal-1',
      notePath: '/vault/A.md',
      title: 'A',
      totalHunks: 1,
      unresolvedHunks: 1,
      isApplying: false,
      isConflicted: false,
      error: null
    });

    review.hunkSnapshot[0] = {
      ...review.hunkSnapshot[0],
      status: 'kept'
    };
    session.notifyReviewRuntimeChanged();
    expect(session.snapshot.unresolvedHunks).toBe(0);
  });

  it('derives workflow errors without retaining presentation data', () => {
    const session = createProposalReviewSession();

    session.dispatchWorkflow({ type: 'openRequested', identity });
    session.dispatchWorkflow({
      type: 'openFailed',
      identity,
      error: 'Could not open review.'
    });

    expect(session.snapshot).toMatchObject({
      proposalId: null,
      notePath: null,
      totalHunks: 0,
      unresolvedHunks: 0,
      error: 'Could not open review.'
    });
  });
});
