import type { NoteDraftState } from '$lib/features/notepad/state/noteStore';
import type { PendingProposalChange } from './types';
import type { ProposalReviewSession } from './reviewSession.svelte';

export interface ReviewDocumentHold {
  title: string;
  bodyMarkdown: string;
  changeId: string;
}

/**
 * Tracks temporary editor holds while a synthetic unified-diff document is shown.
 * Autosave must be suppressed while a hold is active for a note key.
 * `version` is $state so Svelte can react when holds change.
 */
export function createReviewHoldStore() {
  const holds = new Map<string, ReviewDocumentHold>();
  let version = $state(0);

  function bump() {
    version += 1;
  }

  function isHolding(noteKey: string): boolean {
    void version;
    return holds.has(noteKey);
  }

  function get(noteKey: string): ReviewDocumentHold | undefined {
    void version;
    return holds.get(noteKey);
  }

  function begin(document: NoteDraftState, change: PendingProposalChange) {
    if (!holds.has(document.key)) {
      holds.set(document.key, {
        title: document.title,
        bodyMarkdown: document.bodyMarkdown,
        changeId: change.id
      });
    } else {
      const existing = holds.get(document.key);
      if (existing) {
        holds.set(document.key, { ...existing, changeId: change.id });
      }
    }
    bump();
  }

  function end(noteKey: string): ReviewDocumentHold | undefined {
    const hold = holds.get(noteKey);
    holds.delete(noteKey);
    bump();
    return hold;
  }

  function endAll(): ReviewDocumentHold[] {
    const all = [...holds.values()];
    holds.clear();
    bump();
    return all;
  }

  function clear() {
    holds.clear();
    bump();
  }

  return { isHolding, get, begin, end, endAll, clear };
}

export type ReviewHoldStore = ReturnType<typeof createReviewHoldStore>;

export const reviewHoldStore = createReviewHoldStore();

export function assertCanKeepChange(
  change: PendingProposalChange,
  document: NoteDraftState | null,
  holds: ReviewHoldStore
): string | null {
  if (change.change.kind === 'createNote') {
    return null;
  }

  if (!document) {
    return null;
  }

  const hold = holds.get(document.key);
  const baseline = hold?.bodyMarkdown ?? document.bodyMarkdown;
  if (baseline !== change.baseMarkdown) {
    return 'Note changed since the proposal was created. Reload or recreate the proposal.';
  }

  if (!hold && document.bodyMarkdown !== document.lastSavedMarkdown) {
    return 'Save or discard local edits before keeping this change.';
  }

  return null;
}

export function shouldSuppressAutosaveForDocument(
  document: NoteDraftState,
  holds: ReviewHoldStore = reviewHoldStore
): boolean {
  return holds.isHolding(document.key);
}

export function findPendingReviewForDocument(
  session: ProposalReviewSession,
  document: NoteDraftState
): PendingProposalChange | null {
  return session.findPendingForPath(document.currentNotePath);
}
