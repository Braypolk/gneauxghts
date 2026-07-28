import {
  getDocumentMarkdown,
  type NoteDraftState
} from '$lib/features/notepad/document/documentState';
import { formatNoteTitle } from '$lib/features/notepad/model/document';

export interface TitleInteractionControllerDeps<
  TPaneId extends string
> {
  activatePane: (paneId: TPaneId) => void;
  getPaneCommandPaneId: () => TPaneId | null;
  resetPaneCommand: () => void;
  getPaneDocument: (paneId: TPaneId) => NoteDraftState;
  updateTitle: (
    document: NoteDraftState,
    title: string
  ) => boolean;
  clearRecentlyForgotten: () => void;
  scheduleAutosave: (document: NoteDraftState) => void;
  flushPendingAutosave: () => void;
  scheduleDerivedViews: () => void;
  focusPaneEditorAtEnd: (paneId: TPaneId) => boolean;
}

/** Owns title-field interaction policy without owning title input state. */
export function createTitleInteractionController<
  TPaneId extends string
>(deps: TitleInteractionControllerDeps<TPaneId>) {
  function handleFocus(paneId: TPaneId) {
    deps.activatePane(paneId);
  }

  function handleInput(paneId: TPaneId) {
    deps.activatePane(paneId);
    if (deps.getPaneCommandPaneId() === paneId) {
      deps.resetPaneCommand();
    }
  }

  function commit(paneId: TPaneId, rawTitle: string) {
    const document = deps.getPaneDocument(paneId);
    const title = formatNoteTitle(rawTitle);
    deps.updateTitle(document, title);
    if (
      title !== '' ||
      getDocumentMarkdown(document).trim() !== ''
    ) {
      deps.clearRecentlyForgotten();
    }
    deps.scheduleAutosave(document);
    deps.scheduleDerivedViews();
  }

  function handleBlur(paneId: TPaneId, rawTitle: string) {
    commit(paneId, rawTitle);
    deps.flushPendingAutosave();
  }

  function handleKeydown(
    paneId: TPaneId,
    event: KeyboardEvent
  ) {
    if (
      event.key !== 'Enter' ||
      event.shiftKey ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey
    ) {
      return;
    }
    event.preventDefault();
    (event.currentTarget as HTMLInputElement).blur();
    deps.focusPaneEditorAtEnd(paneId);
  }

  return {
    handleFocus,
    handleInput,
    handleBlur,
    handleKeydown
  };
}
