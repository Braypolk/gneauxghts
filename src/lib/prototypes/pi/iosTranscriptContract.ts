import type { ChatProposalDraft } from '$lib/features/chat/types';

export function assertAcknowledgedReview(before: ChatProposalDraft, after: ChatProposalDraft, mappedPath: string) {
  if (after.path !== mappedPath || after.markdown !== before.markdown || after.title !== before.title || after.version !== before.version || JSON.stringify(after.decisions) !== JSON.stringify(before.decisions)) {
    throw new Error('Acknowledged pending review changed across relocation');
  }
}
