import { keyboardShortcutModifiersMatchEvent } from '#lib/keyboardShortcuts.svelte.js';
import type { LocationHistoryEntry } from './locationMru';

export function hasSplitModifiers(event: Partial<Pick<MouseEvent, 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'>>): boolean {
  return keyboardShortcutModifiersMatchEvent(event, 'searchOpenInSplit');
}

/** Unsaved draft matches remain selectable, but cannot create a saved-note split. */
export function hasSplitNoteDestination(item: { notePath: string | null } | LocationHistoryEntry): boolean {
  if ('location' in item) {
    return item.location.kind === 'editor' && !!item.location.notePath?.trim();
  }
  return !!item.notePath?.trim();
}
