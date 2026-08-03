import { describe, expect, it } from 'vitest';
import type { ProposalReviewSessionSnapshot } from '$lib/features/proposals/types';
import type { ChatAgentProposal } from './types';
import {
  reviewBelongsToConversation
} from './proposalVisibility';

const review: ProposalReviewSessionSnapshot = {
  proposalId: 'proposal-1',
  notePath: '/vault/Plan.md',
  title: 'Plan',
  totalHunks: 1,
  unresolvedHunks: 1,
  isApplying: false,
  isConflicted: false,
  error: null
};

const proposal: ChatAgentProposal = {
  id: 'proposal-1',
  runId: 'run-1',
  conversationId: 'conversation-1',
  assistantMessageId: 'message-1',
  kind: 'update',
  noteId: 'note-1',
  suggestedPath: null,
  title: 'Plan',
  baseHash: 'hash-1',
  payload: {},
  preview: {},
  status: 'pending',
  createdAtMillis: 1,
  updatedAtMillis: 1
};

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
