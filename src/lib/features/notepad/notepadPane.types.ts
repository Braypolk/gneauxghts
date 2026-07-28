import type { NotepadPaneId } from '$lib/features/notepad/session/runtimeStore.svelte';
import type { PaneCommandChoice, PaneCommandMode } from '$lib/features/notepad/paneCommandPicker';
import type { NoteDraftState } from '$lib/features/notepad/state/noteStore';
import type { ChatPaneBindings } from '$lib/features/notepad/pane/chatPaneBindings';
import type { DocumentStatusViewModel } from '$lib/features/notepad/document/documentState';

/**
 * Stable fields shared by both pane kinds. Kind-specific capabilities live on
 * the discriminated branches below, so an editor pane never receives nullable
 * chat/proposal props.
 */
interface PaneViewModelBase {
  paneId: NotepadPaneId;
  ariaLabel: string;
  bodyClass: string;
  frameClass: string;
  showCloseButton: boolean;
  titleClass: string;
  titlePlaceholder: string;
  titleDocument: NoteDraftState;
  titleValue: string;
  titleReadonly: boolean;
}

export interface EditorPaneViewModel extends PaneViewModelBase {
  paneKind: 'editor';
  documentStatus: DocumentStatusViewModel;
  isEditorReady: boolean;
  isSlashMenuOpen: boolean;
  isPaneCommandOpen: boolean;
  paneCommandHighlightedIndex: number;
  paneCommandMode: PaneCommandMode;
  paneCommandCurrentNoteLabel: string;
  paneCommandPreviousNoteLabel: string | null;
  paneCommandPreviousNoteShortcutLabel: string;
  editorLifecycle: {
    shouldMount: boolean;
    mount: (node: HTMLDivElement) => Promise<void> | void;
    destroy: () => Promise<void> | void;
  };
}

export interface ChatPaneViewModel extends PaneViewModelBase {
  paneKind: 'chat';
  chat: ChatPaneBindings;
}

export type PaneViewModel = EditorPaneViewModel | ChatPaneViewModel;

/**
 * Small workspace action surface the pane can call into.
 */
export interface PaneWorkspaceActions {
  onActivate: (paneId: NotepadPaneId) => void;
  onClose: (paneId: NotepadPaneId) => void | Promise<void>;
  onSplit: (choice?: PaneCommandChoice) => void | Promise<void>;
  onOpenPaneChoice: (choice: PaneCommandChoice) => void | Promise<void>;
  onSwitchToEditor: (paneId: NotepadPaneId) => void | Promise<void>;
  onTitleFocus: (paneId: NotepadPaneId) => void;
  onTitleInput: (paneId: NotepadPaneId) => void;
  onTitleBlur: (paneId: NotepadPaneId, rawTitle: string) => void;
  onTitleKeydown: (paneId: NotepadPaneId, event: KeyboardEvent) => void;
  onKeepMyEdits: (paneId: NotepadPaneId) => void | Promise<void>;
  onLoadDiskVersion: (paneId: NotepadPaneId) => void | Promise<void>;
  onCopyMyEdits: (paneId: NotepadPaneId) => void | Promise<void>;
  onPaneCommandHighlightChange: (index: number) => void;
  onPaneCommandChoose: (paneId: NotepadPaneId, choice: PaneCommandChoice) => void | Promise<void>;
}
