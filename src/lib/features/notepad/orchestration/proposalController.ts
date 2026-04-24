import {
  applySelectedHunks,
  type ReviewChange,
  type ReviewUpdateChange
} from '$lib/features/inbox/reviewDiff';
import { getProposalChangesForPath } from '$lib/features/proposals/session';
import type { ProposalSession } from '$lib/features/proposals/session';
import type { NoteDraftState } from '$lib/features/notepad/state/noteStore';

export function getCurrentProposalUpdate(changes: ReviewChange[]) {
  return (
    changes.find(
      (reviewChange): reviewChange is ReviewUpdateChange => reviewChange.kind === 'updateNote'
    ) ?? null
  );
}

export function buildProposalPreview(update: ReviewUpdateChange | null) {
  if (!update) {
    return null;
  }

  return {
    title: update.titleSelected ? update.proposedTitle : update.currentTitle,
    markdown: applySelectedHunks(
      update.currentMarkdown,
      update.hunks.filter((hunk) => hunk.selected)
    )
  };
}

export function getProposalChangesForDocument(
  proposalSession: ProposalSession | null,
  document: NoteDraftState
) {
  return getProposalChangesForPath(proposalSession, document.currentNotePath);
}

export function isDocumentUnderProposal(
  proposalSession: ProposalSession | null,
  document: NoteDraftState
) {
  return getProposalChangesForDocument(proposalSession, document).length > 0;
}

export function getProposalDisplayTitle(
  proposalSession: ProposalSession | null,
  document: NoteDraftState
) {
  const proposalUpdate = getCurrentProposalUpdate(
    getProposalChangesForDocument(proposalSession, document)
  );

  if (!proposalUpdate) {
    return document.title;
  }

  return proposalUpdate.titleSelected
    ? proposalUpdate.proposedTitle
    : proposalUpdate.currentTitle;
}
