import type { PaneEditorLifecycle } from './paneEditorLifecycle';
import type { PaneViewModel } from '../notepadPane.types';
import type { ChatPaneBindings } from './chatPaneBindings';
import type {
  NoteDraftState
} from '$lib/features/notepad/state/noteStore';
import type { NotepadPaneId } from '$lib/features/notepad/session/runtimeStore.svelte';
import type { PaneCommandMode } from '$lib/features/notepad/paneCommandPicker';
import type { PaneKind } from '$lib/features/notepad/workspace/paneTypes';
import {
  canRemovePane,
  getPaneCapabilityPolicy
} from '$lib/features/notepad/workspace/paneCapabilities';
import {
  getDocumentNoteId,
  getDocumentStatusViewModel
} from '$lib/features/notepad/document/documentState';
import type {
  PaneTransientUiState
} from '$lib/features/notepad/pane/paneTransientUiState';

export interface PaneViewModelFactoryDeps {
  getPaneOrder: () => NotepadPaneId[];
  getActivePaneId: () => NotepadPaneId;
  getCollapsingPaneId: () => NotepadPaneId | null;
  getPaneKind: (paneId: NotepadPaneId) => PaneKind;
  getPaneDocument: (paneId: NotepadPaneId) => NoteDraftState;
  getChatBindings: (paneId: NotepadPaneId) => ChatPaneBindings;
  isReviewingDocument: (document: NoteDraftState) => boolean;
  isNotePinned: (noteId: string) => boolean;
  paneTitleInputClass: string;
  getTransientUiState: () => PaneTransientUiState<NotepadPaneId>;
  getPaneCommandPaneId: () => NotepadPaneId | null;
  getPaneCommandHighlightedIndex: () => number;
  getPaneCommandMode: () => PaneCommandMode;
  getPaneCommandCurrentNoteLabel: () => string;
  getPaneCommandPreviousNoteLabel: () => string | null;
  getPaneCommandPreviousNoteShortcutLabel: () => string;
  paneShouldMountEditor: (paneId: NotepadPaneId) => boolean;
  paneLifecycle: PaneEditorLifecycle<NotepadPaneId>;
}

export function createPaneViewModelFactory(
  deps: PaneViewModelFactoryDeps
) {
  return function getPaneViewModel(
    paneId: NotepadPaneId
  ): PaneViewModel {
    const paneKind = deps.getPaneKind(paneId);
    const panePolicy = getPaneCapabilityPolicy(paneKind);
    const transientUiState = deps.getTransientUiState();
    const document = deps.getPaneDocument(paneId);
    const paneOrder = deps.getPaneOrder();
    const paneIndex = paneOrder.indexOf(paneId);
    const stackClass =
      deps.getActivePaneId() === paneId ? 'z-10' : 'z-0';
    const collapsingClass =
      deps.getCollapsingPaneId() === paneId
        ? 'notepad-pane--collapsing'
        : '';
    const common = {
      paneId,
      ariaLabel: `Pane ${paneIndex + 1}`,
      showActiveBorder: paneOrder.length > 1 && deps.getActivePaneId() === paneId && deps.getCollapsingPaneId() === null,
      bodyClass: `notepad-pane relative flex min-h-0 min-w-0 flex-1 flex-col ${stackClass} ${collapsingClass}`.trim(),
      frameClass: `relative flex min-h-0 min-w-0 flex-1 overflow-hidden ${stackClass}`,
      showCloseButton: canRemovePane(
        {
          paneOrder,
          getPaneKind: deps.getPaneKind
        },
        paneId
      ),
      titleClass: deps.paneTitleInputClass,
      titlePlaceholder:
        panePolicy.titleMode === 'document'
          ? 'Title'
          : 'Chat title',
      titleDocument: document,
      titleValue:
        panePolicy.titleMode === 'document'
          ? document.working.title
          : 'Thought partner',
      titleReadonly:
        !panePolicy.capabilities['edit-title'] ||
        deps.isReviewingDocument(document)
    };

    if (paneKind === 'editor') {
      const noteId = getDocumentNoteId(document);
      return {
        ...common,
        paneKind,
        canPin: noteId !== null,
        isPinned: noteId !== null && deps.isNotePinned(noteId),
        documentStatus: getDocumentStatusViewModel(document),
        isSlashMenuOpen:
          transientUiState.kind === 'slash-menu' &&
          transientUiState.paneId === paneId,
        isPaneCommandOpen: deps.getPaneCommandPaneId() === paneId,
        paneCommandHighlightedIndex:
          deps.getPaneCommandHighlightedIndex(),
        paneCommandMode: deps.getPaneCommandMode(),
        paneCommandCurrentNoteLabel:
          deps.getPaneCommandCurrentNoteLabel(),
        paneCommandPreviousNoteLabel:
          deps.getPaneCommandPreviousNoteLabel(),
        paneCommandPreviousNoteShortcutLabel:
          deps.getPaneCommandPreviousNoteShortcutLabel(),
        editorLifecycle: {
          shouldMount: deps.paneShouldMountEditor(paneId),
          mount: async () => {
            await deps.paneLifecycle.mountPaneEditor(paneId);
          },
          destroy: async () => {
            await deps.paneLifecycle.destroyPaneEditor(paneId);
          }
        }
      };
    }

    return {
      ...common,
      paneKind,
      chat: deps.getChatBindings(paneId)
    };
  };
}
