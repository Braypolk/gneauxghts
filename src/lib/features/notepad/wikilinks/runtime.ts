import { openResolvedNoteLink, type NavigationContext } from '$lib/features/notepad/navigation/openFlow';
import {
  autocompleteNoteLinks,
  beginWikilinkSuggestionRequest,
  completeWikilinkSuggestionRequest,
  dismissWikilinkAutocomplete,
  getSelectedWikilinkSuggestion,
  hasWikilinkAlias,
  moveWikilinkSelection,
  resetWikilinkAutocomplete,
  resolveNoteLink,
  setActiveWikilink,
  type WikilinkAutocompleteState
} from '$lib/features/notepad/wikilinks/state';
import { insertWikilinkSuggestion, type EditorController } from '$lib/features/notepad/editor/editor';
import type { ActiveWikilink } from '$lib/features/notepad/wikilinks/wikilinks';

interface WikilinkRuntimeDeps {
  getState: () => WikilinkAutocompleteState;
  setState: (value: WikilinkAutocompleteState) => void;
  getCurrentNoteId: () => string | null;
  getCurrentPath: () => string | null;
  getCurrentTitle: () => string;
  getCurrentMarkdown: () => string;
  getEditorController: () => EditorController | null;
  cancelPendingAutosave: () => void;
  openNotePath: (
    noteId: string | null,
    notePath: string | null,
    options?: { currentNoteAlreadySaved?: boolean; focusEditorAfterOpen?: boolean }
  ) => Promise<void>;
  getNavigationContext: () => NavigationContext;
  saveCursorPositionForNote: () => void;
}

export function createWikilinkRuntime({
  getState,
  setState,
  getCurrentNoteId,
  getCurrentPath,
  getCurrentTitle,
  getCurrentMarkdown,
  getEditorController,
  cancelPendingAutosave,
  openNotePath,
  getNavigationContext,
  saveCursorPositionForNote
}: WikilinkRuntimeDeps) {
  function closeWikilinkAutocomplete() {
    setState(dismissWikilinkAutocomplete(getState()));
  }

  async function loadWikilinkSuggestions(nextActiveWikilink: ActiveWikilink) {
    const pendingRequest = beginWikilinkSuggestionRequest(getState(), nextActiveWikilink);
    setState(pendingRequest.state);

    try {
      const suggestions = await autocompleteNoteLinks(
        nextActiveWikilink.rawTarget,
        getCurrentPath(),
        getCurrentTitle(),
        getCurrentMarkdown()
      );
      setState(completeWikilinkSuggestionRequest(getState(), pendingRequest.requestId, suggestions));
    } catch (error) {
      console.error('Failed to load wikilink suggestions:', error);
      setState(completeWikilinkSuggestionRequest(getState(), pendingRequest.requestId, []));
    }
  }

  function handleActiveWikilinkChange(nextActiveWikilink: ActiveWikilink | null) {
    if (hasWikilinkAlias(nextActiveWikilink)) {
      setState(resetWikilinkAutocomplete(getState()));
      return;
    }

    setState(setActiveWikilink(getState(), nextActiveWikilink));

    if (!nextActiveWikilink) {
      closeWikilinkAutocomplete();
      return;
    }

    void loadWikilinkSuggestions(nextActiveWikilink);
  }

  function selectWikilinkSuggestion(suggestionValue: string) {
    if (!insertWikilinkSuggestion(getEditorController(), getState().activeWikilink, suggestionValue)) {
      return;
    }

    closeWikilinkAutocomplete();
  }

  function moveSelection(direction: -1 | 1) {
    setState(moveWikilinkSelection(getState(), direction));
  }

  function handleAutocompleteKeydown(event: KeyboardEvent) {
    const state = getState();
    if (!state.active) {
      return false;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      closeWikilinkAutocomplete();
      return true;
    }

    if (state.suggestions.length > 0 && event.key === 'ArrowDown') {
      event.preventDefault();
      moveSelection(1);
      return true;
    }

    if (state.suggestions.length > 0 && event.key === 'ArrowUp') {
      event.preventDefault();
      moveSelection(-1);
      return true;
    }

    if (state.suggestions.length > 0 && (event.key === 'Enter' || event.key === 'Tab')) {
      const suggestion = getSelectedWikilinkSuggestion(state);
      if (!suggestion) {
        return false;
      }

      event.preventDefault();
      selectWikilinkSuggestion(suggestion.value);
      return true;
    }

    return false;
  }

  async function openWikilink(rawTarget: string) {
    try {
      const resolved = await resolveNoteLink(
        rawTarget,
        getCurrentPath(),
        getCurrentTitle(),
        getCurrentMarkdown()
      );
      if (!resolved) {
        return;
      }

      await openResolvedNoteLink(
        {
          currentNoteId: getCurrentNoteId(),
          currentNotePath: getCurrentPath(),
          stopPendingAutosave: cancelPendingAutosave,
          openNotePath
        },
        getNavigationContext(),
        resolved
      );
      saveCursorPositionForNote();
    } catch (error) {
      console.error('Failed to resolve wikilink:', error);
    }
  }

  return {
    closeWikilinkAutocomplete,
    handleActiveWikilinkChange,
    handleAutocompleteKeydown,
    selectWikilinkSuggestion,
    openWikilink
  };
}
