import type { NotepadPaneId } from '$lib/features/notepad/session/runtimeStore.svelte';
import type { PaneCommandChoice, PaneCommandMode } from '$lib/features/notepad/paneCommandPicker';
import type { ChatContextNote, ChatController, ChatSelectionActions } from '$lib/features/chat';
import type { ChatDraftSeed } from '$lib/features/chat';
import type {
  PendingProposalChange,
  ProposalReviewSessionSnapshot
} from '$lib/features/proposals/types';

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
  isPaneCommandOpen: boolean;
  showCloseButton: boolean;
  titleClass: string;
  titlePlaceholder: string;
  titleValue: string;
  titleReadonly: boolean;
  chatController: ChatController | null;
  chatConversationId: string | null;
  chatDraftSeed: ChatDraftSeed | null;
  chatContextNote: ChatContextNote | null;
  chatTargetAnchor: string | null;
  chatSelectionActions: ChatSelectionActions;
  onChatConversationChange: (conversationId: string | null) => void;
  proposalSnapshot: ProposalReviewSessionSnapshot | null;
  proposalPendingCount: number;
  onProposalOpenChange: (change: PendingProposalChange) => void | Promise<void>;
  onProposalKeep: (changeId: string) => void | Promise<void>;
  onProposalUndo: (changeId: string) => void | Promise<void>;
  onProposalKeepAll: () => void | Promise<void>;
  onProposalUndoAll: () => void | Promise<void>;
  onProposalReview: () => void | Promise<void>;
  onProposalLoadFixture: () => void | Promise<void>;
  paneCommandHighlightedIndex: number;
  paneCommandMode: PaneCommandMode;
  paneCommandCurrentNoteLabel: string;
  paneCommandPreviousNoteLabel: string | null;
  paneCommandPreviousNoteShortcutLabel: string;
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
  onSplit: (choice?: PaneCommandChoice) => void | Promise<void>;
  onOpenPaneChoice: (choice: PaneCommandChoice) => void | Promise<void>;
  onSwitchToEditor: (paneId: NotepadPaneId) => void | Promise<void>;
  onTitleFocus: (paneId: NotepadPaneId) => void;
  onTitleInput: (paneId: NotepadPaneId) => void;
  onTitleBlur: (paneId: NotepadPaneId, rawTitle: string) => void;
  onTitleKeydown: (paneId: NotepadPaneId, event: KeyboardEvent) => void;
  onPaneCommandHighlightChange: (index: number) => void;
  onPaneCommandChoose: (paneId: NotepadPaneId, choice: PaneCommandChoice) => void | Promise<void>;
}
