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
  it('admits persisted conflict recovery only with the prepared opening identity',()=>{
    let opening=transitionProposalReviewWorkflow(createProposalReviewWorkflowState<{id:string}>(),{type:'openRequested',identity:first});
    opening=transitionProposalReviewWorkflow(opening,{type:'openPrepared',identity:first,review:{id:'retained'}});
    const recovery={kind:'conflicted' as const,error:'Retry Keep to reconcile the saved result.'};
    expect(transitionProposalReviewWorkflow(opening,{type:'openSucceeded',identity:second,recovery})).toBe(opening);
    const reopened=transitionProposalReviewWorkflow(opening,{type:'openSucceeded',identity:first,recovery});
    expect(reopened).toMatchObject({kind:'conflicted',identity:first,error:recovery.error,review:{id:'retained'}});
    expect(transitionProposalReviewWorkflow(reopened,{type:'resolutionRequested',reviewId:second.reviewId,resolution:'commit'})).toBe(reopened);
    expect(transitionProposalReviewWorkflow(reopened,{type:'resolutionRequested',reviewId:first.reviewId,resolution:'commit'})).toMatchObject({kind:'committing',recoverTo:'conflicted'});
  });

  it('adopts a refreshed identity only from the admitted commit for the same proposal', () => {
    const busy=transitionProposalReviewWorkflow(reviewing(),{type:'resolutionRequested',reviewId:first.reviewId,resolution:'commit'});
    const refreshed={...first,reviewId:'new-base',notePath:'/vault/Renamed.md'};
    expect(transitionProposalReviewWorkflow(busy,{type:'completionConflicted',reviewId:'stale-operation',error:'Changed',refreshedIdentity:refreshed})).toBe(busy);
    expect(transitionProposalReviewWorkflow(busy,{type:'completionConflicted',reviewId:first.reviewId,error:'Changed',refreshedIdentity:second})).toBe(busy);
    const conflict=transitionProposalReviewWorkflow(busy,{type:'completionConflicted',reviewId:first.reviewId,error:'Changed',refreshedIdentity:refreshed});
    expect(conflict).toMatchObject({kind:'conflicted',identity:refreshed,error:'Changed'});
    expect(transitionProposalReviewWorkflow(conflict,{type:'resolutionRequested',reviewId:first.reviewId,resolution:'commit'})).toBe(conflict);
    expect(transitionProposalReviewWorkflow(conflict,{type:'resolutionRequested',reviewId:refreshed.reviewId,resolution:'commit'})).toMatchObject({kind:'committing',identity:refreshed});
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
