import { describe, expect, it } from 'vitest';
import type { ProposalReviewSessionSnapshot } from '$lib/features/proposals/types';
import type { ChatAgentProposal } from './types';
import {
  proposalIdFromReviewSource,
  reviewBelongsToConversation
} from './proposalVisibility';

const review: ProposalReviewSessionSnapshot = {
  source: 'chat:proposal-1',
  changes: [],
  activeChangeId: null,
  isApplying: false,
  isConflicted: false,
  error: null,
  reviewHunks: null
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
  it('extracts only durable Chat proposal sources', () => {
    expect(proposalIdFromReviewSource('chat:proposal-1')).toBe('proposal-1');
    expect(proposalIdFromReviewSource('chat')).toBeNull();
    expect(proposalIdFromReviewSource('fixture')).toBeNull();
  });

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
