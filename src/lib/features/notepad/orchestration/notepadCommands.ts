import type { NoteDraftState } from '$lib/features/notepad/state/noteStore';
import { removeNoteIfUnreferenced } from '$lib/features/notepad/state/noteStore';
import { createPaneCommandGroup } from './paneCommandGroup';
import { createLocationHistoryController } from './locationHistoryController';
import { createPaneCommandController } from './paneCommandController';
import {
  createNoteCommandController,
  type OpenNoteOptions
} from './noteCommandController';
import { createWorkspacePaneController } from './workspacePaneController';
import {
  createPaneNavigationTransitionPipeline
} from './paneNavigationTransitionPipeline';
import type { NotepadCommandsDeps } from './notepadCommandFacades';

export type { NotepadCommandsDeps } from './notepadCommandFacades';
export type {
  LocationHistoryEntry,
  NavLocation
} from '$lib/features/notepad/navigation/locationMru';

/**
 * Compatibility façade for notepad commands. Domain flows are delegated to
 * location, note, workspace-pane and pane-command controllers.
 */
export function createNotepadCommands<TPaneId extends string>(
  deps: NotepadCommandsDeps<TPaneId>
) {
  const {
    state,
    maxVisiblePanes,
    workspace,
    panes,
    persistence,
    derivedViews,
    documents,
    paneLifecycle
  } = deps;

  const paneCommands = createPaneCommandGroup<
    TPaneId,
    NoteDraftState
  >({
    getPaneTitleInput: panes.getPaneTitleInput,
    focusPaneEditor: panes.focusPaneEditor,
    focusPaneChat: panes.focusPaneChat,
    activatePaneSession: panes.activatePaneSession,
    updateSelectedRelatedText:
      panes.updateSelectedRelatedText,
    scheduleSearchIfNeeded:
      derivedViews.scheduleSearchIfNeeded,
    scheduleRelatedIfNeeded:
      derivedViews.scheduleRelatedIfNeeded
  });
  const { activatePane, focusPaneAfterShortcut } = paneCommands;
  const transitions =
    createPaneNavigationTransitionPipeline<TPaneId>({
      assertWorkspaceInvariants:
        workspace.assertInvariants,
      ensurePaneEditors:
        paneLifecycle.ensurePaneEditors
    });

  let noteCommands!: ReturnType<
    typeof createNoteCommandController<TPaneId>
  >;
  function openNotePath(
    notePath: string | null,
    options: OpenNoteOptions = {}
  ) {
    return noteCommands.openNotePath(notePath, options);
  }

  const locationHistory = createLocationHistoryController({
    getActivePaneId: workspace.getActivePaneId,
    getPaneOrder: workspace.getPaneOrder,
    getPaneState: workspace.getPaneState,
    getPaneKind: panes.getPaneKind,
    setPaneConversationId:
      workspace.setPaneConversationId,
    getPaneDocument: panes.getPaneDocument,
    getPaneCommandMode: workspace.getPaneCommandMode,
    getPaneCommandSourcePaneId:
      workspace.getPaneCommandSourcePaneId,
    getPaneTitleInput: panes.getPaneTitleInput,
    activatePaneSession: panes.activatePaneSession,
    setPaneKind: workspace.setPaneKind,
    saveCursorPosition:
      documents.saveCursorPositionForDocument,
    cancelPendingAutosave:
      persistence.cancelPendingAutosave,
    enqueueSave: persistence.enqueueSave,
    loadRecentNotes: derivedViews.loadRecentNotes,
    openNotePath,
    paneLifecycle,
    updateSelectedRelatedText:
      panes.updateSelectedRelatedText,
    focusPaneAfterShortcut,
    transitions
  });

  const workspacePaneCommands = createWorkspacePaneController({
    state,
    maxVisiblePanes,
    getPaneOrder: workspace.getPaneOrder,
    addWorkspacePane: workspace.addPane,
    canRemoveWorkspacePane: workspace.canRemovePane,
    removeWorkspacePane: workspace.removePane,
    getActivePaneId: workspace.getActivePaneId,
    getNextPaneId: panes.getNextPaneId,
    getPaneKind: panes.getPaneKind,
    getPaneConversationId: (paneId) =>
      workspace.getPaneState(paneId).chatConversationId,
    setStoredPaneKind: workspace.setPaneKind,
    getPaneDocument: panes.getPaneDocument,
    getPaneTitleInput: panes.getPaneTitleInput,
    focusPaneEditorAtEnd: panes.focusPaneEditorAtEnd,
    createPane: panes.createPane,
    preparePaneClose: panes.preparePaneClose,
    disposePaneRuntime: panes.disposePaneRuntime,
    activatePaneSession: panes.activatePaneSession,
    activatePane,
    focusPane: focusPaneAfterShortcut,
    updateSelectedRelatedText:
      panes.updateSelectedRelatedText,
    loadRecentNotes: derivedViews.loadRecentNotes,
    ensureLocationMruSeeded:
      locationHistory.ensureLocationMruSeeded,
    capturePaneLocation:
      locationHistory.capturePaneLocation,
    adoptClosedLocation:
      locationHistory.adoptClosedLocation,
    touchCurrentLocation:
      locationHistory.touchCurrentLocation,
    touchLocation: locationHistory.touchLocation,
    bumpLocationHistoryEpoch:
      locationHistory.bumpLocationHistoryEpoch,
    beginPaneCommand: workspace.beginPaneCommand,
    resetPaneCommand: workspace.resetPaneCommand,
    getPaneCommandPaneId:
      workspace.getPaneCommandPaneId,
    removeUnreferencedNote: (noteKey) =>
      removeNoteIfUnreferenced(
        state,
        workspace,
        noteKey
      ),
    paneLifecycle,
    canLeaveDocument: deps.canLeaveDocument,
    onNavigationBlocked: deps.onNavigationBlocked,
    onDocumentLeaving: deps.onDocumentLeaving,
    clearSearch: derivedViews.clearSearch,
    transitions
  });

  noteCommands = createNoteCommandController({
    base: deps,
    blurFocusedPaneTitle:
      locationHistory.blurFocusedPaneTitle,
    ensureLocationMruSeeded:
      locationHistory.ensureLocationMruSeeded,
    capturePaneLocation:
      locationHistory.capturePaneLocation,
    touchLocation: locationHistory.touchLocation,
    touchCurrentLocation:
      locationHistory.touchCurrentLocation,
    removeLocation: locationHistory.removeLocation,
    isLocationTouchSuppressed:
      locationHistory.isTouchSuppressed,
    bumpLocationHistoryEpoch:
      locationHistory.bumpLocationHistoryEpoch,
    setPaneKind: workspacePaneCommands.setPaneKind,
    focusPane: focusPaneAfterShortcut,
    transitions
  });

  const paneCommandController = createPaneCommandController({
    setStoredPaneKind: workspace.setPaneKind,
    removeUnreferencedNote: (noteKey) =>
      removeNoteIfUnreferenced(
        state,
        workspace,
        noteKey
      ),
    getActivePaneId: workspace.getActivePaneId,
    getPaneCommandPaneId:
      workspace.getPaneCommandPaneId,
    getPaneCommandSourceNoteKey:
      workspace.getPaneCommandSourceNoteKey,
    getPaneCommandHighlightedIndex:
      workspace.getPaneCommandHighlightedIndex,
    getPaneCommandMode: workspace.getPaneCommandMode,
    setPaneCommandHighlight:
      workspace.setPaneCommandHighlight,
    resetPaneCommand: workspace.resetPaneCommand,
    getPaneDocument: panes.getPaneDocument,
    getPaneKind: panes.getPaneKind,
    getPaneRuntime: panes.getPaneRuntime,
    focusPaneEditorAtEnd: panes.focusPaneEditorAtEnd,
    getNoteByKey: panes.getNoteByKey,
    setPaneDocument: panes.setPaneDocumentSession,
    activatePane: panes.activatePaneSession,
    paneLifecycle,
    documents,
    updateSelectedRelatedText:
      panes.updateSelectedRelatedText,
    scheduleSearch:
      derivedViews.scheduleSearchIfNeeded,
    scheduleRelated:
      derivedViews.scheduleRelatedIfNeeded,
    focusPaneAfterShortcut,
    findReferencePane:
      locationHistory.findPaneCommandReferencePaneId,
    captureLocation:
      locationHistory.capturePaneLocation,
    restoreLocation: locationHistory.restoreLocation,
    touchLocation: locationHistory.touchLocation,
    touchCurrentLocation:
      locationHistory.touchCurrentLocation,
    goToPreviousLocation:
      locationHistory.goToPreviousLocation,
    resolvePreviousLocation:
      locationHistory.resolvePreviousLocationForPaneCommand,
    peekPreviousLocation:
      locationHistory.peekPreviousLocationForPaneCommand,
    onDocumentPresented: deps.onDocumentPresented,
    transitions
  });

  return {
    activatePane,
    focusPaneAfterShortcut,
    ...noteCommands,
    ...workspacePaneCommands,
    touchCurrentLocation:
      locationHistory.touchCurrentLocation,
    goToPreviousLocation:
      locationHistory.goToPreviousLocation,
    listLocationHistory:
      locationHistory.listLocationHistory,
    peekLocationHistory:
      locationHistory.peekLocationHistory,
    openLocationFromHistory:
      locationHistory.openLocationFromHistory,
    paneCommandCurrentLocationLabel:
      locationHistory.paneCommandCurrentLocationLabel,
    paneCommandPreviousLocationLabel:
      locationHistory.paneCommandPreviousLocationLabel,
    peekPreviousLocationForPaneCommand:
      locationHistory.peekPreviousLocationForPaneCommand,
    resolvePreviousLocationForPaneCommand:
      locationHistory.resolvePreviousLocationForPaneCommand,
    ensureLocationMruSeeded:
      locationHistory.ensureLocationMruSeeded,
    setLocationHistoryEpochListener:
      locationHistory.setLocationHistoryEpochListener,
    ...paneCommandController
  };
}

export type NotepadCommands<TPaneId extends string> = ReturnType<
  typeof createNotepadCommands<TPaneId>
>;
