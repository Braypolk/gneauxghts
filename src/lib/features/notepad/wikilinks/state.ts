import { invoke } from '@tauri-apps/api/core';
import type { ActiveWikilink } from '$lib/features/notepad/wikilinks/wikilinks';
import type { NoteLinkSuggestion, ResolvedNoteLink } from '$lib/features/notepad/model/types';

export interface WikilinkAutocompleteState {
  active: boolean;
  activeWikilink: ActiveWikilink | null;
  suggestions: NoteLinkSuggestion[];
  selectedIndex: number;
  activeRequest: number;
}

interface PendingWikilinkSuggestionRequest {
  requestId: number;
  state: WikilinkAutocompleteState;
}

export function createWikilinkAutocompleteState(): WikilinkAutocompleteState {
  return {
    active: false,
    activeWikilink: null,
    suggestions: [],
    selectedIndex: 0,
    activeRequest: 0
  };
}

export function dismissWikilinkAutocomplete(state: WikilinkAutocompleteState): WikilinkAutocompleteState {
  return {
    ...state,
    active: false,
    suggestions: [],
    selectedIndex: 0,
    activeRequest: state.activeRequest + 1
  };
}

export function resetWikilinkAutocomplete(state: WikilinkAutocompleteState): WikilinkAutocompleteState {
  return {
    ...dismissWikilinkAutocomplete(state),
    activeWikilink: null
  };
}

export function setActiveWikilink(
  state: WikilinkAutocompleteState,
  activeWikilink: ActiveWikilink | null
): WikilinkAutocompleteState {
  return {
    ...state,
    activeWikilink
  };
}

export function beginWikilinkSuggestionRequest(
  state: WikilinkAutocompleteState,
  activeWikilink: ActiveWikilink
): PendingWikilinkSuggestionRequest {
  const requestId = state.activeRequest + 1;

  return {
    requestId,
    state: {
      ...state,
      activeWikilink,
      activeRequest: requestId
    }
  };
}

export function completeWikilinkSuggestionRequest(
  state: WikilinkAutocompleteState,
  requestId: number,
  suggestions: NoteLinkSuggestion[]
): WikilinkAutocompleteState {
  if (requestId !== state.activeRequest) {
    return state;
  }

  return {
    ...state,
    active: true,
    suggestions,
    selectedIndex: 0
  };
}

export function moveWikilinkSelection(
  state: WikilinkAutocompleteState,
  direction: -1 | 1
): WikilinkAutocompleteState {
  if (!state.active || state.suggestions.length === 0) {
    return state;
  }

  return {
    ...state,
    selectedIndex: (state.selectedIndex + direction + state.suggestions.length) % state.suggestions.length
  };
}

export function getSelectedWikilinkSuggestion(state: WikilinkAutocompleteState) {
  return state.suggestions[state.selectedIndex] ?? state.suggestions[0] ?? null;
}

export function hasWikilinkAlias(activeWikilink: ActiveWikilink | null) {
  return activeWikilink?.rawTarget.includes('|') ?? false;
}

export async function autocompleteNoteLinks(
  rawTarget: string,
  currentPath: string | null,
  currentTitle: string,
  currentMarkdown: string
) {
  return invoke<NoteLinkSuggestion[]>('autocomplete_note_links', {
    rawTarget,
    currentPath,
    currentTitle,
    currentMarkdown,
    limit: 8
  });
}

export async function resolveNoteLink(
  rawTarget: string,
  currentPath: string | null,
  currentTitle: string,
  currentMarkdown: string
) {
  return invoke<ResolvedNoteLink | null>('resolve_note_link', {
    rawTarget,
    currentPath,
    currentTitle,
    currentMarkdown
  });
}
