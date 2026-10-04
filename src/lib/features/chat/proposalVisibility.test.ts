import { describe, expect, it } from 'vitest';
import {
  reviewBelongsToConversation
} from './proposalVisibility';

const review = { proposalId: 'proposal-1' };
const proposal = { id: 'proposal-1', conversationId: 'conversation-1' };

describe('chat proposal review visibility', () => {
  it('shows the review only in the conversation that owns the proposal', () => {
    expect(
      reviewBelongsToConversation(review, [proposal], 'conversation-1')
    ).toBe(true);
    expect(
      reviewBelongsToConversation(review, [proposal], 'conversation-2')
    ).toBe(false);
  });

  it('hides a different conversation review after its proposals are replaced', () => {
    const otherProposal = {
      ...proposal,
      id: 'proposal-2',
      conversationId: 'conversation-2'
    };
    expect(
      reviewBelongsToConversation(review, [otherProposal], 'conversation-2')
    ).toBe(false);
    expect(reviewBelongsToConversation(null, [proposal], 'conversation-1')).toBe(false);
  });
});
