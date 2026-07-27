import type {
  ChatNoteCandidate,
  ChatNotePolicy
} from '$lib/features/chat/types';

export function sortedExcludedPolicies(policies: ChatNotePolicy[]) {
  return policies
    .filter((policy) => policy.disposition === 'excluded')
    .sort((left, right) => left.title.localeCompare(right.title));
}

export function availableExclusionCandidates(
  candidates: ChatNoteCandidate[],
  policies: ChatNotePolicy[]
) {
  const excludedIds = new Set(
    policies
      .filter((policy) => policy.disposition === 'excluded')
      .map((policy) => policy.noteId)
  );
  return candidates.filter((candidate) => !excludedIds.has(candidate.noteId));
}
