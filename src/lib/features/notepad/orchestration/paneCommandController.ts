import { tick } from 'svelte';
import {
  getNextPaneCommandIndex,
  getPaneCommandChoiceByIndex,
  getPaneCommandForShortcut,
  type PaneCommandChoice,
  type PaneCommandMode
} from '$lib/features/notepad/paneCommandPicker';
import type { PaneEditorLifecycle } from '$lib/features/notepad/pane/paneEditorLifecycle';
import type { DocumentPaneCoordinator } from '$lib/features/notepad/document/documentPaneCoordinator';
import {
  type NoteDraftState,
  type DocumentHandle
} from '$lib/features/notepad/state/noteStore';
import { cleanupNoteRuntime } from '$lib/features/notepad/session/noteRuntime';
import type { NavLocation } from '$lib/features/notepad/navigation/locationMru';
import type { PaneKind } from '$lib/features/notepad/workspace/paneTypes';
import {
  getDocumentNoteId,
  getDocumentPath
} from '$lib/features/notepad/document/documentState';
import type {
  PaneNavigationTransitionPipeline
} from './paneNavigationTransitionPipeline';

export interface PaneCommandControllerDeps<TPaneId extends string> {
  setStoredPaneKind: (
    paneId: TPaneId,
    kind: PaneKind
  ) => boolean;
  removeUnreferencedNote: (documentHandle: DocumentHandle) => void;
  getActivePaneId: () => TPaneId;
  getPaneCommandPaneId: () => TPaneId | null;
  getPaneCommandSourceDocumentHandle: () => DocumentHandle | null;
  getPaneCommandHighlightedIndex: () => number;
  getPaneCommandMode: () => PaneCommandMode;
  setPaneCommandHighlight: (index: number) => void;
  resetPaneCommand: () => void;
  getPaneDocument: (paneId: TPaneId) => NoteDraftState;
  getPaneKind: (paneId: TPaneId) => PaneKind;
  focusPaneEditorAtEnd: (paneId: TPaneId) => boolean;
  getDocumentByHandle: (key: DocumentHandle) => NoteDraftState | null;
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
  transitions: PaneNavigationTransitionPipeline<TPaneId>;
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

  function finalizePaneCommandSelection(paneId: TPaneId) {
    deps.updateSelectedRelatedText(paneId);
    deps.scheduleSearch();
    deps.scheduleRelated({ immediate: true });
  }

  async function resolvePaneCommandChoice(
    paneId: TPaneId,
    choice: PaneCommandChoice
  ) {
    let sourceKey: DocumentHandle | null = null;
    let referencePaneId = paneId;
    let currentLocation: NavLocation | null = null;
    let previousLocation: NavLocation | null = null;
    let placeholderDocument!: NoteDraftState;
    let sharedDocument: NoteDraftState | null = null;
    let commandClaimed = false;
    const result = await deps.transitions.execute({
      kind: 'pane-command',
      resolvePane: () =>
        deps.getPaneCommandPaneId() === paneId
          ? paneId
          : null,
      guard: () => {
        sourceKey = deps.getPaneCommandSourceDocumentHandle();
        referencePaneId = deps.findReferencePane(paneId);
        currentLocation =
          deps.getPaneCommandMode() === 'split'
            ? deps.captureLocation(referencePaneId)
            : null;
        placeholderDocument =
          deps.getPaneDocument(paneId);
        if (
          choice === 'current' &&
          currentLocation?.kind !== 'chat'
        ) {
          sharedDocument = sourceKey
            ? deps.getDocumentByHandle(sourceKey)
            : null;
          if (!sharedDocument) {
            return {
              status: 'blocked',
              reason:
                'The current pane-command document is no longer available.'
            };
          }
        }
        return { status: 'allow' };
      },
      prepare:
        choice === 'previous'
          ? async () => {
              previousLocation =
                await deps.resolvePreviousLocation(paneId);
            }
          : undefined,
      isCurrent: () =>
        commandClaimed
          ? deps.getActivePaneId() === paneId
          : deps.getPaneCommandPaneId() === paneId,
      mutateWorkspace: async () => {
        const placeholderKey = placeholderDocument.handle;
        commandClaimed = true;
        deps.resetPaneCommand();
        deps.activatePane(paneId);

        if (choice === 'typing') return;

        if (choice === 'current') {
          if (currentLocation?.kind === 'chat') {
            await deps.restoreLocation(
              paneId,
              currentLocation
            );
            deps.touchLocation(paneId, currentLocation);
            return;
          }
          if (!sharedDocument) {
            throw new Error(
              'Pane-command source disappeared before mutation.'
            );
          }

          deps.touchCurrentLocation(paneId);
          if (!deps.setStoredPaneKind(paneId, 'editor')) {
            throw new Error(
              'Workspace rejected the pane-command editor transition.'
            );
          }
          deps.setPaneDocument(paneId, sharedDocument);
          await deps.documents.replacePaneDocument(
            paneId,
            placeholderDocument,
            sharedDocument,
            { restoreCursor: true }
          );
          if (placeholderKey !== sharedDocument.handle) {
            deps.removeUnreferencedNote(placeholderKey);
            cleanupNoteRuntime(placeholderKey);
          }
          return;
        }

        if (choice === 'previous') {
          if (!previousLocation) return;
          if (referencePaneId === paneId) {
            await deps.goToPreviousLocation(paneId);
          } else {
            await deps.restoreLocation(
              paneId,
              previousLocation
            );
          }
          return;
        }

        const sourceNote = sourceKey
          ? deps.getDocumentByHandle(sourceKey)
          : null;
        if (sourceNote) {
          deps.touchLocation(paneId, {
            kind: 'editor',
            noteId: getDocumentNoteId(sourceNote),
            notePath: getDocumentPath(sourceNote)
          });
        } else {
          deps.touchCurrentLocation(paneId);
        }
        if (!deps.setStoredPaneKind(paneId, 'chat')) {
          throw new Error(
            'Workspace rejected the pane-command chat transition.'
          );
        }
        if (sourceNote) {
          deps.setPaneDocument(paneId, sourceNote);
        }
        if (placeholderKey !== sourceKey) {
          deps.removeUnreferencedNote(placeholderKey);
          cleanupNoteRuntime(placeholderKey);
        }
      },
      ensureEditors: true,
      complete: () => {
        finalizePaneCommandSelection(paneId);
        if (choice === 'current' && sharedDocument) {
          deps.onDocumentPresented?.(sharedDocument);
        }
      },
      focus:
        choice === 'previous'
          ? undefined
          : async () => {
              await tick();
              if (choice === 'typing') {
                deps.focusPaneEditorAtEnd(paneId);
              } else {
                deps.focusPaneAfterShortcut(paneId);
              }
            }
    });
    if (result.status === 'failed') {
      throw result.error;
    }
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
