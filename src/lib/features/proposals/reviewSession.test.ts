import { describe, expect, it } from 'vitest';
import { createProposalReviewSession } from './reviewSession.svelte';

const identity = {
  reviewId: 'review-1',
  proposalId: 'proposal-1',
  notePath: '/vault/A.md'
};

describe('createProposalReviewSession', () => {
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
