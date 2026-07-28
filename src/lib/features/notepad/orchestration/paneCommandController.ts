import { tick } from 'svelte';
import {
  getNextPaneCommandIndex,
  getPaneCommandChoiceByIndex,
  getPaneCommandForShortcut,
  type PaneCommandChoice,
  type PaneCommandMode
} from '$lib/features/notepad/paneCommandPicker';
import type { PaneEditorLifecycle } from '$lib/features/notepad/pane/paneEditorLifecycle';
import type { PaneRuntime } from '$lib/features/notepad/pane/paneRuntime.svelte';
import type { DocumentPaneCoordinator } from '$lib/features/notepad/document/documentPaneCoordinator';
import {
  removeNoteIfUnreferenced,
  setPaneKind,
  type NoteDraftState,
  type NoteKey,
  type NotepadState
} from '$lib/features/notepad/state/noteStore';
import { cleanupNoteRuntime } from '$lib/features/notepad/session/noteRuntime';
import type { NavLocation } from '$lib/features/notepad/navigation/locationMru';

export interface PaneCommandControllerDeps<TPaneId extends string> {
  state: NotepadState<TPaneId>;
  getActivePaneId: () => TPaneId;
  getPaneCommandPaneId: () => TPaneId | null;
  getPaneCommandSourceNoteKey: () => NoteKey | null;
  getPaneCommandHighlightedIndex: () => number;
  getPaneCommandMode: () => PaneCommandMode;
  setPaneCommandHighlight: (index: number) => void;
  resetPaneCommand: () => void;
  getPaneDocument: (paneId: TPaneId) => NoteDraftState;
  getPaneKind: (paneId: TPaneId) => 'editor' | 'chat';
  getPaneRuntime: (paneId: TPaneId) => PaneRuntime;
  focusPaneEditorAtEnd: (paneId: TPaneId) => boolean;
  getNoteByKey: (key: NoteKey) => NoteDraftState | null;
  setPaneDocument: (paneId: TPaneId, document: NoteDraftState) => unknown;
  activatePane: (paneId: TPaneId) => unknown;
  paneLifecycle: PaneEditorLifecycle<TPaneId>;
  documents: DocumentPaneCoordinator<TPaneId>;
  updateSelectedRelatedText: (paneId?: TPaneId) => void;
  scheduleSearch: () => void;
  scheduleRelated: (options?: { immediate?: boolean }) => void;
  focusPaneAfterShortcut: (paneId: TPaneId) => void;
  findReferencePane: (paneId: TPaneId) => TPaneId;
  captureLocation: (paneId: TPaneId) => NavLocation | null;
  restoreLocation: (paneId: TPaneId, location: NavLocation) => Promise<void>;
  touchLocation: (paneId: TPaneId, location: NavLocation | null) => void;
  touchCurrentLocation: (paneId: TPaneId) => void;
  goToPreviousLocation: (paneId: TPaneId) => Promise<void>;
  resolvePreviousLocation: (paneId: TPaneId) => Promise<NavLocation | null>;
  peekPreviousLocation: (paneId: TPaneId) => NavLocation | null;
  onDocumentPresented?: (document: NoteDraftState) => void;
}

export function createPaneCommandController<TPaneId extends string>(
  deps: PaneCommandControllerDeps<TPaneId>
) {
  function movePaneCommandHighlight(direction: 1 | -1) {
    const paneId = deps.getPaneCommandPaneId();
    deps.setPaneCommandHighlight(
      getNextPaneCommandIndex(
        deps.getPaneCommandHighlightedIndex(),
        direction,
        paneId !== null && deps.peekPreviousLocation(paneId) !== null,
        deps.getPaneCommandMode()
      )
    );
  }

  async function finalizePaneCommandSelection(paneId: TPaneId) {
    await tick();
    await deps.paneLifecycle.ensurePaneEditors();
    deps.updateSelectedRelatedText(paneId);
    deps.scheduleSearch();
    deps.scheduleRelated({ immediate: true });
  }

  async function resolvePaneCommandChoice(
    paneId: TPaneId,
    choice: PaneCommandChoice
  ) {
    if (deps.getPaneCommandPaneId() !== paneId) return;

    const sourceKey = deps.getPaneCommandSourceNoteKey();
    const referencePaneId = deps.findReferencePane(paneId);
    const currentLocation =
      deps.getPaneCommandMode() === 'split'
        ? deps.captureLocation(referencePaneId)
        : null;
    const previousLocation =
      choice === 'previous'
        ? await deps.resolvePreviousLocation(paneId)
        : null;
    const placeholderDocument = deps.getPaneDocument(paneId);
    const placeholderKey = placeholderDocument.key;

    deps.resetPaneCommand();
    deps.activatePane(paneId);

    if (choice === 'typing') {
      await finalizePaneCommandSelection(paneId);
      deps.focusPaneEditorAtEnd(paneId);
      return;
    }

    if (choice === 'current') {
      if (currentLocation?.kind === 'chat') {
        await deps.restoreLocation(paneId, currentLocation);
        deps.touchLocation(paneId, currentLocation);
        await finalizePaneCommandSelection(paneId);
        return;
      }
      if (!sourceKey) return;
      const shared = deps.getNoteByKey(sourceKey);
      if (!shared) return;

      deps.touchCurrentLocation(paneId);
      setPaneKind(deps.state, paneId, 'editor');
      deps.setPaneDocument(paneId, shared);
      if (
        deps.getPaneKind(paneId) === 'editor' &&
        deps.getPaneRuntime(paneId).ui.isEditorReady
      ) {
        await deps.documents.replaceNoteAcrossPanes(
          placeholderDocument,
          shared,
          { restoreCursor: true }
        );
      }
      if (placeholderKey !== shared.key) {
        removeNoteIfUnreferenced(deps.state, placeholderKey);
        cleanupNoteRuntime(placeholderKey);
      }
      await finalizePaneCommandSelection(paneId);
      deps.onDocumentPresented?.(shared);
      deps.focusPaneAfterShortcut(paneId);
      return;
    }

    if (choice === 'previous') {
      if (!previousLocation) return;
      if (referencePaneId === paneId) {
        await deps.goToPreviousLocation(paneId);
      } else {
        await deps.restoreLocation(paneId, previousLocation);
      }
      await finalizePaneCommandSelection(paneId);
      return;
    }

    const sourceNote = sourceKey ? deps.getNoteByKey(sourceKey) : null;
    if (sourceNote) {
      deps.touchLocation(paneId, {
        kind: 'editor',
        noteId: sourceNote.currentNoteId,
        notePath: sourceNote.currentNotePath
      });
    } else {
      deps.touchCurrentLocation(paneId);
    }
    setPaneKind(deps.state, paneId, 'chat');
    if (sourceNote) deps.setPaneDocument(paneId, sourceNote);
    if (placeholderKey !== sourceKey) {
      removeNoteIfUnreferenced(deps.state, placeholderKey);
      cleanupNoteRuntime(placeholderKey);
    }
    await finalizePaneCommandSelection(paneId);
    await tick();
    deps.focusPaneAfterShortcut(paneId);
  }

  async function confirmPaneCommandChoiceByHighlight() {
    const paneId = deps.getPaneCommandPaneId();
    if (!paneId) return;
    const choice = getPaneCommandChoiceByIndex(
      deps.getPaneCommandHighlightedIndex(),
      deps.peekPreviousLocation(paneId) !== null,
      deps.getPaneCommandMode()
    );
    if (choice) await resolvePaneCommandChoice(paneId, choice);
  }

  function handlePaneCommandGlobalKeydown(event: KeyboardEvent): boolean {
    const paneId = deps.getPaneCommandPaneId();
    if (paneId === null || deps.getActivePaneId() !== paneId || event.repeat) {
      return false;
    }
    const target = event.target;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      (target instanceof HTMLElement &&
        target.closest('[data-notepad-command-bar]'))
    ) {
      return false;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return false;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      movePaneCommandHighlight(event.key === 'ArrowDown' ? 1 : -1);
      return true;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      void confirmPaneCommandChoiceByHighlight();
      return true;
    }

    const choice = getPaneCommandForShortcut(
      event.key,
      deps.peekPreviousLocation(paneId) !== null,
      deps.getPaneCommandMode()
    );
    if (choice === null) {
      if (
        event.key.length === 1 ||
        event.key === 'Backspace' ||
        event.key === 'Delete'
      ) {
        deps.resetPaneCommand();
      }
      return false;
    }
    event.preventDefault();
    void resolvePaneCommandChoice(paneId, choice);
    return true;
  }

  return {
    movePaneCommandHighlight,
    resolvePaneCommandChoice,
    confirmPaneCommandChoiceByHighlight,
    handlePaneCommandGlobalKeydown
  };
}
