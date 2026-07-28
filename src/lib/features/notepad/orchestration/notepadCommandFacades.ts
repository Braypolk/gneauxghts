import type { ForgottenNoteRetentionPreference } from '$lib/appSettings.svelte';
import type { DocumentPaneCoordinator } from '$lib/features/notepad/document/documentPaneCoordinator';
import type { DocumentEditingService } from '$lib/features/notepad/document/documentEditingService';
import type { PaneEditorLifecycle } from '$lib/features/notepad/pane/paneEditorLifecycle';
import type { PaneRuntime } from '$lib/features/notepad/pane/paneRuntime.svelte';
import type { ForgottenNote } from '$lib/features/notepad/session/session';
import type {
  NoteDraftState,
  NoteKey,
  NotepadState
} from '$lib/features/notepad/state/noteStore';
import type { WorkspaceStore, NotepadPaneId } from '$lib/features/notepad/workspace/workspaceStore.svelte';
import type { SearchItem } from '$lib/types/semantic';
import type { PaneCommandMode } from '$lib/features/notepad/paneCommandPicker';

export type PaneKind = 'editor' | 'chat';

export interface NotepadWorkspaceCommands<TPaneId extends string> {
  getActivePaneId: () => TPaneId;
  getPaneOrder: () => TPaneId[];
  setActivePaneId: (paneId: TPaneId) => void;
  setPaneOrder: (order: TPaneId[]) => void;
  removePane: (paneId: TPaneId) => void;
  beginPaneCommand: (
    paneId: TPaneId,
    sourceNoteKey: NoteKey,
    mode: PaneCommandMode,
    sourcePaneId?: TPaneId
  ) => void;
  resetPaneCommand: () => void;
  setPaneCommandHighlight: (index: number) => void;
  getPaneCommandPaneId: () => TPaneId | null;
  getPaneCommandSourcePaneId: () => TPaneId | null;
  getPaneCommandSourceNoteKey: () => NoteKey | null;
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
  getNoteByKey: (noteKey: NoteKey) => NoteDraftState | null;
  activatePaneSession: (paneId: TPaneId) => unknown;
  setPaneDocumentSession: (paneId: TPaneId, document: NoteDraftState) => unknown;
  getPaneTitleInput: (paneId: TPaneId) => HTMLInputElement | null;
  getPaneEditorRoot: (paneId: TPaneId) => HTMLElement | null;
  focusPaneEditor: (paneId: TPaneId) => boolean;
  focusPaneEditorAtEnd: (paneId: TPaneId) => boolean;
  focusPaneChat: (paneId: TPaneId) => boolean;
  createPane: () => TPaneId;
  closePaneRuntime: (paneId: TPaneId) => Promise<void>;
  updateSelectedRelatedText: (paneId?: TPaneId) => void;
  closeWikilinkAutocomplete: (paneId?: TPaneId) => void;
}

export interface NotepadPersistenceCommands {
  cancelPendingAutosave: (note?: NoteDraftState) => void;
  enqueueSave: (note?: NoteDraftState) => Promise<void>;
  invalidatePendingSaveResults: (note?: NoteDraftState) => void;
  scheduleAutosave: (note: NoteDraftState) => void;
  hasCleanBuffer: (note: NoteDraftState) => boolean;
  getNoteSaveQueue: (noteKey: NoteKey) => Promise<void>;
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

export interface NotepadRefreshCommands {
  isRefreshingFromDisk: () => boolean;
  setRefreshingFromDisk: (value: boolean) => void;
}

export interface NotepadCommandsDeps<TPaneId extends string> {
  state: NotepadState<TPaneId>;
  maxVisiblePanes: number;
  workspace: NotepadWorkspaceCommands<TPaneId>;
  panes: NotepadPaneCommands<TPaneId>;
  persistence: NotepadPersistenceCommands;
  derivedViews: NotepadDerivedViewCommands<TPaneId>;
  documents: DocumentPaneCoordinator<TPaneId>;
  documentEditing: DocumentEditingService<TPaneId>;
  paneLifecycle: PaneEditorLifecycle<TPaneId>;
  refresh: NotepadRefreshCommands;
  forgottenNoteRetentionPreference: () => ForgottenNoteRetentionPreference;
  canLeaveDocument?: (document: NoteDraftState) => boolean;
  onNavigationBlocked?: () => void;
  onDocumentLeaving?: (document: NoteDraftState) => void;
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
    setPaneOrder: (order) => workspace.setPaneOrder(order as NotepadPaneId[]),
    removePane: (paneId) => workspace.removePane(paneId as NotepadPaneId),
    beginPaneCommand: (paneId, sourceNoteKey, mode, sourcePaneId) =>
      workspace.beginPaneCommand(
        paneId as NotepadPaneId,
        sourceNoteKey,
        mode,
        sourcePaneId as NotepadPaneId | undefined
      ),
    resetPaneCommand: () => workspace.resetPaneCommand(),
    setPaneCommandHighlight: (index) => workspace.setPaneCommandHighlight(index),
    getPaneCommandPaneId: () => workspace.paneCommand.paneId as TPaneId | null,
    getPaneCommandSourcePaneId: () => workspace.paneCommand.sourcePaneId as TPaneId | null,
    getPaneCommandSourceNoteKey: () => workspace.paneCommand.sourceNoteKey,
    getPaneCommandHighlightedIndex: () => workspace.paneCommand.highlightedIndex,
    getPaneCommandMode: () => workspace.paneCommand.mode,
    getPaneCommandFocusEl: paneCommand.getFocusEl
  };
}
