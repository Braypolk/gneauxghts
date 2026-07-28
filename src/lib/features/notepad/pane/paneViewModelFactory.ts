import type { PaneEditorLifecycle } from './paneEditorLifecycle';
import type { PaneRuntime } from './paneRuntime.svelte';
import type { PaneViewModel } from '../notepadPane.types';
import type { ChatPaneBindings } from './chatPaneBindings';
import type {
  NoteDraftState
} from '$lib/features/notepad/state/noteStore';
import type { NotepadPaneId } from '$lib/features/notepad/session/runtimeStore.svelte';
import type { PaneCommandMode } from '$lib/features/notepad/paneCommandPicker';

export interface PaneViewModelFactoryDeps {
  getPaneOrder: () => NotepadPaneId[];
  getActivePaneId: () => NotepadPaneId;
  getPaneKind: (paneId: NotepadPaneId) => 'editor' | 'chat';
  getPaneDocument: (paneId: NotepadPaneId) => NoteDraftState;
  getPaneRuntime: (paneId: NotepadPaneId) => PaneRuntime;
  getChatBindings: (paneId: NotepadPaneId) => ChatPaneBindings;
  isReviewingDocument: (document: NoteDraftState) => boolean;
  paneTitleInputClass: string;
  getActiveSlashMenuPaneId: () => NotepadPaneId | null;
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
    const document = deps.getPaneDocument(paneId);
    const paneIndex = deps.getPaneOrder().indexOf(paneId);
    const stackClass =
      deps.getActivePaneId() === paneId ? 'z-10' : 'z-0';
    const common = {
      paneId,
      ariaLabel: `Pane ${paneIndex + 1}`,
      bodyClass: `relative flex min-h-0 min-w-0 flex-1 flex-col ${stackClass}`,
      frameClass: `relative flex min-h-0 min-w-0 flex-1 overflow-hidden ${stackClass}`,
      showCloseButton: deps.getPaneOrder().length > 1,
      titleClass: deps.paneTitleInputClass,
      titlePlaceholder: paneKind === 'editor' ? 'Title' : 'Chat title',
      titleDocument: document,
      titleValue:
        paneKind === 'editor' ? document.title : 'Thought partner',
      titleReadonly:
        paneKind === 'chat' ||
        deps.isReviewingDocument(document)
    };

    if (paneKind === 'editor') {
      return {
        ...common,
        paneKind,
        isEditorReady: deps.getPaneRuntime(paneId).ui.isEditorReady,
        isSlashMenuOpen:
          deps.getActiveSlashMenuPaneId() === paneId,
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
