import type { ProposalReviewSessionSnapshot } from '$lib/features/proposals/types';
import type { ChatAgentProposal } from './types';

/**
 * The editor review session is app-wide, but a Chat pane may only project the
 * review controls for a proposal owned by its currently open conversation.
 */
export function reviewBelongsToConversation(
  review: ProposalReviewSessionSnapshot | null,
  proposals: readonly ChatAgentProposal[],
  conversationId: string | null | undefined
): boolean {
  if (!review || !conversationId) return false;
  const proposalId = review.proposalId;
  if (!proposalId) return false;
  return proposals.some(
    (proposal) =>
      proposal.id === proposalId && proposal.conversationId === conversationId
  );
}
