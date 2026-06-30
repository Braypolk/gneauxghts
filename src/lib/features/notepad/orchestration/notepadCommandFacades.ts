import type { ForgottenNoteRetentionPreference } from '$lib/appSettings';
import type { DocumentPaneCoordinator } from '$lib/features/notepad/document/documentPaneCoordinator';
import type { PaneEditorLifecycle } from '$lib/features/notepad/pane/paneEditorLifecycle';
import type { PaneRuntime } from '$lib/features/notepad/pane/paneRuntime.svelte';
import type {
  NavigationContext,
  OpenContext
} from '$lib/features/notepad/navigation/openFlow';
import type { ForgottenNote } from '$lib/features/notepad/session/session';
import type {
  NoteDraftState,
  NoteKey,
  NotepadState
} from '$lib/features/notepad/state/noteStore';
import type { WorkspaceStore, NotepadPaneId } from '$lib/features/notepad/workspace/workspaceStore.svelte';
import type { SearchItem } from '$lib/types/semantic';
import type { SplitPickerMode } from '$lib/features/notepad/splitPanePicker';

export type PaneKind = 'editor' | 'chat';

export interface NotepadWorkspaceCommands<TPaneId extends string> {
  getActivePaneId: () => TPaneId;
  getPaneOrder: () => TPaneId[];
  setActivePaneId: (paneId: TPaneId) => void;
  setPaneOrder: (order: TPaneId[]) => void;
  removePane: (paneId: TPaneId) => void;
  beginSplitPicker: (paneId: TPaneId, sourceNoteKey: NoteKey) => void;
  beginStartPicker: (paneId: TPaneId, sourceNoteKey: NoteKey) => void;
  resetSplitPicker: () => void;
  setSplitPickerHighlight: (index: number) => void;
  getSplitPickerPaneId: () => TPaneId | null;
  getSplitPickerSourceNoteKey: () => NoteKey | null;
  getSplitPickerHighlightedIndex: () => number;
  getSplitPickerMode: () => SplitPickerMode;
  getSplitPickerPreviousItem: () => SearchItem | null;
  getSplitPickerFocusEl: () => HTMLElement | null;
}

export interface NotepadPaneCommands<TPaneId extends string> {
  getPaneKind: (paneId: TPaneId) => PaneKind;
  getPaneDocument: (paneId: TPaneId) => NoteDraftState;
  getNavigationDocument: () => NoteDraftState;
  getNavigationPaneId: () => TPaneId;
  getNextPaneId: (paneId?: TPaneId, direction?: 1 | -1) => TPaneId | null;
  getPaneRuntime: (paneId: TPaneId) => PaneRuntime;
  getNoteByKey: (noteKey: NoteKey) => NoteDraftState | null;
  getOpenContext: () => OpenContext;
  getNavigationContext: (paneId?: TPaneId) => NavigationContext;
  activatePaneSession: (paneId: TPaneId) => unknown;
  setPaneDocumentSession: (paneId: TPaneId, document: NoteDraftState) => unknown;
  getPaneTitleInput: (paneId: TPaneId) => HTMLInputElement | null;
  getPaneEditorRoot: (paneId: TPaneId) => HTMLElement | null;
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
  loadRecentNotes: () => Promise<unknown> | unknown;
  setRecentlyForgotten: (value: ForgottenNote | null) => void;
  closeWikilinkAutocomplete: (paneId?: TPaneId) => void;
}

export interface NotepadDocumentSyncCommands {
  flushDocumentEditorSync: (document: NoteDraftState) => void;
  flushAllPendingDocumentSyncs: () => void;
  hasPendingSync: (document: NoteDraftState) => boolean;
}

export interface NotepadRefreshCommands {
  isRefreshingFromDisk: () => boolean;
  setRefreshingFromDisk: (value: boolean) => void;
}

export interface NotepadCommandsDeps<TPaneId extends string> {
  state: NotepadState<TPaneId>;
  primaryPaneId: TPaneId;
  paneIdsAll: readonly [TPaneId, TPaneId];
  workspace: NotepadWorkspaceCommands<TPaneId>;
  panes: NotepadPaneCommands<TPaneId>;
  persistence: NotepadPersistenceCommands;
  derivedViews: NotepadDerivedViewCommands<TPaneId>;
  documentSync: NotepadDocumentSyncCommands;
  documents: DocumentPaneCoordinator<TPaneId>;
  paneLifecycle: PaneEditorLifecycle<TPaneId>;
  refresh: NotepadRefreshCommands;
  forgottenNoteRetentionPreference: () => ForgottenNoteRetentionPreference;
}

export interface NotepadSplitPickerAccess {
  getPreviousItem: () => SearchItem | null;
  getFocusEl: () => HTMLElement | null;
}

export function createNotepadWorkspaceCommands<TPaneId extends string>(
  workspace: WorkspaceStore,
  splitPicker: NotepadSplitPickerAccess
): NotepadWorkspaceCommands<TPaneId> {
  return {
    getActivePaneId: () => workspace.activePaneId as TPaneId,
    getPaneOrder: () => workspace.paneOrder as TPaneId[],
    setActivePaneId: (paneId) => workspace.setActivePaneId(paneId as NotepadPaneId),
    setPaneOrder: (order) => workspace.setPaneOrder(order as NotepadPaneId[]),
    removePane: (paneId) => workspace.removePane(paneId as NotepadPaneId),
    beginSplitPicker: (paneId, sourceNoteKey) =>
      workspace.beginSplitPicker(paneId as NotepadPaneId, sourceNoteKey),
    beginStartPicker: (paneId, sourceNoteKey) =>
      workspace.beginStartPicker(paneId as NotepadPaneId, sourceNoteKey),
    resetSplitPicker: () => workspace.resetSplitPicker(),
    setSplitPickerHighlight: (index) => workspace.setSplitPickerHighlight(index),
    getSplitPickerPaneId: () => workspace.splitPicker.paneId as TPaneId | null,
    getSplitPickerSourceNoteKey: () => workspace.splitPicker.sourceNoteKey,
    getSplitPickerHighlightedIndex: () => workspace.splitPicker.highlightedIndex,
    getSplitPickerMode: () => workspace.splitPicker.mode,
    getSplitPickerPreviousItem: splitPicker.getPreviousItem,
    getSplitPickerFocusEl: splitPicker.getFocusEl
  };
}
