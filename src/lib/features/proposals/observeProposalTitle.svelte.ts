import { untrack } from 'svelte';
import type { NoteDraftState } from '$lib/features/notepad/state/noteStore';

/** Titles live in the document model; body and hunk changes arrive from its root. */
export function observeProposalTitle(document: NoteDraftState, changed: () => void) {
  return $effect.root(() => {
    $effect(() => { document.working.title; untrack(changed); });
  });
}
