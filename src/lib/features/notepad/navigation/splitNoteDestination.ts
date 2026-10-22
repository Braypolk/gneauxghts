import type { LocationHistoryEntry } from './locationMru';

/** Unsaved draft matches remain selectable, but cannot create a saved-note split. */
export function hasSplitNoteDestination(item: { notePath: string | null } | LocationHistoryEntry): boolean {
  if ('location' in item) {
    return item.location.kind === 'editor' && !!item.location.notePath?.trim();
  }
  return !!item.notePath?.trim();
}
