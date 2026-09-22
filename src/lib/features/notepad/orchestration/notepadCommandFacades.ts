import type { ForgottenNoteRetentionPreference } from '$lib/appSettings.svelte';
import type { DocumentPaneCoordinator } from '$lib/features/notepad/document/documentPaneCoordinator';
import type { DocumentEditingService } from '$lib/features/notepad/document/documentEditingService';
import type { PaneEditorLifecycle } from '$lib/features/notepad/pane/paneEditorLifecycle';
import type { PaneRuntime } from '$lib/features/notepad/pane/paneRuntime.svelte';
import type { ForgottenNote } from '$lib/features/notepad/session/session';
import type {
  NoteDraftState,
  DocumentHandle,
  NotepadState
} from '$lib/features/notepad/state/noteStore';
import type { WorkspaceStore, NotepadPaneId } from '$lib/features/notepad/workspace/workspaceStore.svelte';
import type { SearchItem } from '$lib/types/semantic';
import type { PaneCommandMode } from '$lib/features/notepad/paneCommandPicker';
import type { PaneKind } from '$lib/features/notepad/workspace/paneTypes';
import type { WorkspacePaneState } from '$lib/features/notepad/workspace/paneTypes';
import type {
  PaneMembershipEvent,
  PaneMembershipState
} from '$lib/features/notepad/pane/paneLifecycleMachine';

export type { PaneKind } from '$lib/features/notepad/workspace/paneTypes';

export interface NotepadWorkspaceCommands<TPaneId extends string> {
  getActivePaneId: () => TPaneId;
  getPaneOrder: () => TPaneId[];
  setActivePaneId: (paneId: TPaneId) => void;
  getPaneState: (
    paneId: TPaneId
  ) => WorkspacePaneState<TPaneId>;
  getPaneMembership: (paneId: TPaneId) => PaneMembershipState;
  dispatchPaneMembership: (
    paneId: TPaneId,
    event: PaneMembershipEvent
  ) => boolean;
  completePaneCreation: (
    paneId: TPaneId,
    operationId: number,
    documentHandle: DocumentHandle,
    kind?: PaneKind
  ) => WorkspacePaneState<TPaneId>;
  canRemovePane: (paneId: TPaneId) => boolean;
  beginPaneCollapse: (paneId: TPaneId) => void;
  endPaneCollapse: (paneId: TPaneId) => void;
  retirePane: (
    paneId: TPaneId,
    operationId: number
  ) => WorkspacePaneState<TPaneId> | null;
  completePaneDisposal: (
    paneId: TPaneId,
    operationId: number
  ) => boolean;
  setPaneKind: (
    paneId: TPaneId,
    kind: PaneKind
  ) => boolean;
  setPaneDocumentHandle: (
    paneId: TPaneId,
    documentHandle: DocumentHandle
  ) => void;
  setPaneConversationId: (
    paneId: TPaneId,
    conversationId: string | null
  ) => void;
  replaceDocumentHandleReferences: (
    previousHandle: DocumentHandle,
    nextHandle: DocumentHandle
  ) => void;
  isDocumentReferenced: (documentHandle: DocumentHandle) => boolean;
  listReferencedDocumentHandles: () => DocumentHandle[];
  assertInvariants: () => void;
  beginPaneCommand: (
    paneId: TPaneId,
    sourceDocumentHandle: DocumentHandle,
    mode: PaneCommandMode,
    sourcePaneId?: TPaneId
  ) => void;
  resetPaneCommand: () => void;
  setPaneCommandHighlight: (index: number) => void;
  getPaneCommandPaneId: () => TPaneId | null;
  getPaneCommandSourcePaneId: () => TPaneId | null;
  getPaneCommandSourceDocumentHandle: () => DocumentHandle | null;
  getPaneCommandHighlightedIndex: () => number;
  getPaneCommandMode: () => PaneCommandMode;
  getPaneCommandFocusEl: () => HTMLElement | null;
}

export interface NotepadPaneCommands<TPaneId extends string> {
  getPaneKind: (paneId: TPaneId) => PaneKind;
  getPaneDocument: (paneId: TPaneId) => NoteDraftState;
  getNavigationDocument: () => NoteDraftState;
  getNavigationPaneId: () => TPaneId;
  getNextPaneId: (paneId?: TPaneId, direction?: 1 | -1) => TPaneId | null;
  getPaneRuntime: (paneId: TPaneId) => PaneRuntime;
  getDocumentByHandle: (documentHandle: DocumentHandle) => NoteDraftState | null;
  activatePaneSession: (paneId: TPaneId) => unknown;
  setPaneDocumentSession: (paneId: TPaneId, document: NoteDraftState) => unknown;
  getPaneTitleInput: (paneId: TPaneId) => HTMLInputElement | null;
  getPaneEditorRoot: (paneId: TPaneId) => HTMLElement | null;
  focusPaneEditor: (paneId: TPaneId) => boolean;
  focusPaneEditorAtEnd: (paneId: TPaneId) => boolean;
  focusPaneChat: (paneId: TPaneId) => boolean;
  createPane: () => TPaneId;
  disposePaneRuntime: (
    paneId: TPaneId,
    document: NoteDraftState | null
  ) => Promise<void>;
  updateSelectedRelatedText: (paneId?: TPaneId) => void;
  closeWikilinkAutocomplete: (paneId?: TPaneId) => void;
}

export interface NotepadPersistenceCommands {
  cancelPendingAutosave: (note?: NoteDraftState) => void;
  enqueueSave: (note?: NoteDraftState) => Promise<void>;
  flushPendingAutosave: (note?: NoteDraftState) => void;
  invalidatePendingSaveResults: (note?: NoteDraftState) => void;
  scheduleAutosave: (note: NoteDraftState) => void;
  hasCleanBuffer: (note: NoteDraftState) => boolean;
  getNoteSaveQueue: (documentHandle: DocumentHandle) => Promise<void>;
}

export interface NotepadDerivedViewCommands<TPaneId extends string> {
  clearSearch: () => void;
  scheduleSearchIfNeeded: () => void;
  scheduleRelatedIfNeeded: (options?: { immediate?: boolean }) => void;
  clearSelectedRelatedText: () => void;
  loadRecentNotes: () => Promise<SearchItem[]> | SearchItem[];
  setRecentlyForgotten: (value: ForgottenNote | null) => void;
  closeWikilinkAutocomplete: (paneId?: TPaneId) => void;
}

export interface NotepadCommandsDeps<TPaneId extends string> {
  state: NotepadState<TPaneId>;
  maxVisiblePanes: number;
  /** View-owned completion; never changes workspace membership. */
  waitForPaneMotion: () => Promise<void>;
  workspace: NotepadWorkspaceCommands<TPaneId>;
  panes: NotepadPaneCommands<TPaneId>;
  persistence: NotepadPersistenceCommands;
  derivedViews: NotepadDerivedViewCommands<TPaneId>;
  documents: DocumentPaneCoordinator<TPaneId>;
  documentEditing: DocumentEditingService<TPaneId>;
  paneLifecycle: PaneEditorLifecycle<TPaneId>;
  forgottenNoteRetentionPreference: () => ForgottenNoteRetentionPreference;
  canLeaveDocument?: (document: NoteDraftState) => boolean;
  onNavigationBlocked?: () => void;
  onDocumentLeaving?: (
    paneId: TPaneId,
    document: NoteDraftState
  ) => void;
  onDocumentOpened?: (document: NoteDraftState) => void;
  onDocumentPresented?: (document: NoteDraftState) => void;
}

export interface NotepadPaneCommandAccess {
  getFocusEl: () => HTMLElement | null;
}

export function createNotepadWorkspaceCommands<TPaneId extends string>(
  workspace: WorkspaceStore,
  paneCommand: NotepadPaneCommandAccess
): NotepadWorkspaceCommands<TPaneId> {
  return {
    getActivePaneId: () => workspace.activePaneId as TPaneId,
    getPaneOrder: () => workspace.paneOrder as TPaneId[],
    setActivePaneId: (paneId) => workspace.setActivePaneId(paneId as NotepadPaneId),
    getPaneState: (paneId) =>
      workspace.getPaneState(
        paneId as NotepadPaneId
      ) as WorkspacePaneState<TPaneId>,
    getPaneMembership: (paneId) =>
      workspace.getPaneMembership(paneId as NotepadPaneId),
    dispatchPaneMembership: (paneId, event) =>
      workspace.dispatchPaneMembership(
        paneId as NotepadPaneId,
        event
      ),
    completePaneCreation: (paneId, operationId, documentHandle, kind) =>
      workspace.completePaneCreation(
        paneId as NotepadPaneId,
        operationId,
        documentHandle,
        kind
      ) as WorkspacePaneState<TPaneId>,
    canRemovePane: (paneId) =>
      workspace.canRemovePane(paneId as NotepadPaneId),
    beginPaneCollapse: (paneId) =>
      workspace.beginPaneCollapse(paneId as NotepadPaneId),
    endPaneCollapse: (paneId) =>
      workspace.endPaneCollapse(paneId as NotepadPaneId),
    retirePane: (paneId, operationId) =>
      workspace.retirePane(
        paneId as NotepadPaneId,
        operationId
      ) as WorkspacePaneState<TPaneId> | null,
    completePaneDisposal: (paneId, operationId) =>
      workspace.completePaneDisposal(
        paneId as NotepadPaneId,
        operationId
      ),
    setPaneKind: (paneId, kind) =>
      workspace.setPaneKind(
        paneId as NotepadPaneId,
        kind
      ),
    setPaneDocumentHandle: (paneId, documentHandle) =>
      workspace.setPaneDocumentHandle(
        paneId as NotepadPaneId,
        documentHandle
      ),
    setPaneConversationId: (paneId, conversationId) =>
      workspace.setPaneConversationId(
        paneId as NotepadPaneId,
        conversationId
      ),
    replaceDocumentHandleReferences: (previousHandle, nextHandle) =>
      workspace.replaceDocumentHandleReferences(
        previousHandle,
        nextHandle
      ),
    isDocumentReferenced: (documentHandle) =>
      workspace.isDocumentReferenced(documentHandle),
    listReferencedDocumentHandles: () =>
      workspace.listReferencedDocumentHandles(),
    assertInvariants: () => workspace.assertInvariants(),
    beginPaneCommand: (paneId, sourceDocumentHandle, mode, sourcePaneId) =>
      workspace.beginPaneCommand(
        paneId as NotepadPaneId,
        sourceDocumentHandle,
        mode,
        sourcePaneId as NotepadPaneId | undefined
      ),
    resetPaneCommand: () => workspace.resetPaneCommand(),
    setPaneCommandHighlight: (index) => workspace.setPaneCommandHighlight(index),
    getPaneCommandPaneId: () => workspace.paneCommand.paneId as TPaneId | null,
    getPaneCommandSourcePaneId: () => workspace.paneCommand.sourcePaneId as TPaneId | null,
    getPaneCommandSourceDocumentHandle: () => workspace.paneCommand.sourceDocumentHandle,
    getPaneCommandHighlightedIndex: () => workspace.paneCommand.highlightedIndex,
    getPaneCommandMode: () => workspace.paneCommand.mode,
    getPaneCommandFocusEl: paneCommand.getFocusEl
  };
}
