import type { NotepadPaneId } from '$lib/features/notepad/session/runtimeStore.svelte';
import type { SplitChoice, SplitPickerMode } from '$lib/features/notepad/splitPanePicker';

type PaneKind = 'editor' | 'chat';

/**
 * View model describing everything NotepadPane.svelte needs to render.
 * Derived from the pane runtime + workspace-level chrome state.
 */
export interface PaneViewModel {
  paneId: NotepadPaneId;
  paneKind: PaneKind;
  ariaLabel: string;
  bodyClass: string;
  frameClass: string;
  isEditorReady: boolean;
  isSlashMenuOpen: boolean;
  isSplitPickerOpen: boolean;
  showCloseButton: boolean;
  titleClass: string;
  titlePlaceholder: string;
  titleValue: string;
  titleReadonly: boolean;
  chatDescription: string;
  splitPickerHighlightedIndex: number;
  splitPickerMode: SplitPickerMode;
  splitPickerCurrentNoteLabel: string;
  splitPickerPreviousNoteLabel: string | null;
  /**
   * Editor lifecycle hooks for the use:editor action wired on the editor
   * root. When shouldMount is true, the action invokes mount() once the
   * root node is in the DOM; when shouldMount drops to false, it calls
   * destroy(). The action also calls destroy() if the host node is
   * unmounted while the editor is still mounted.
   */
  editorLifecycle: {
    shouldMount: boolean;
    mount: (node: HTMLDivElement) => Promise<void> | void;
    destroy: () => Promise<void> | void;
  };
}

/**
 * Small workspace action surface the pane can call into.
 */
export interface PaneWorkspaceActions {
  onActivate: (paneId: NotepadPaneId) => void;
  onClose: (paneId: NotepadPaneId) => void | Promise<void>;
  onSplit: () => void | Promise<void>;
  onTitleFocus: (paneId: NotepadPaneId) => void;
  onTitleInput: (paneId: NotepadPaneId) => void;
  onTitleBlur: (paneId: NotepadPaneId, rawTitle: string) => void;
  onTitleKeydown: (paneId: NotepadPaneId, event: KeyboardEvent) => void;
  onSplitHighlightChange: (index: number) => void;
  onSplitChoose: (paneId: NotepadPaneId, choice: SplitChoice) => void | Promise<void>;
}
