import { openResolvedNoteLink, type NotepadNavigationContext } from './notepadOpenFlow';
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
} from './notepadWikilinkState';
import { insertWikilinkSuggestion, type NotepadEditorController } from './notepadEditor';
import type { ActiveWikilink } from './notepadWikilinks';

interface NotepadWikilinkControllerDeps {
  getState: () => WikilinkAutocompleteState;
  setState: (value: WikilinkAutocompleteState) => void;
  getCurrentPath: () => string | null;
  getCurrentMarkdown: () => string;
  getEditorController: () => NotepadEditorController | null;
  cancelPendingAutosave: () => void;
  enqueueAutosave: () => Promise<void>;
  openNotePath: (
    notePath: string,
    options?: { currentNoteAlreadySaved?: boolean }
  ) => Promise<void>;
  getNavigationContext: () => NotepadNavigationContext;
  saveCursorPositionForNote: () => void;
}

export function createNotepadWikilinkController({
  getState,
  setState,
  getCurrentPath,
  getCurrentMarkdown,
  getEditorController,
  cancelPendingAutosave,
  enqueueAutosave,
  openNotePath,
  getNavigationContext,
  saveCursorPositionForNote
}: NotepadWikilinkControllerDeps) {
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
    if (
      !insertWikilinkSuggestion(
        getEditorController(),
        getState().activeWikilink,
        suggestionValue
      )
    ) {
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
      const resolved = await resolveNoteLink(rawTarget, getCurrentPath(), getCurrentMarkdown());
      if (!resolved) {
        return;
      }

      await openResolvedNoteLink(
        {
          currentNotePath: getCurrentPath(),
          stopPendingAutosave: cancelPendingAutosave,
          enqueueAutosave: () => enqueueAutosave(),
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
