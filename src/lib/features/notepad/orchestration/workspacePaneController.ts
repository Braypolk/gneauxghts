import { tick } from 'svelte';
import type { NavLocation } from '$lib/features/notepad/navigation/locationMru';
import {
  addPane,
  createFreshDraftNote,
  getPaneState,
  removePane as removeStoredPane,
  removeNoteIfUnreferenced,
  setPaneKind as setStoredPaneKind,
  type NoteDraftState,
  type NoteKey,
  type NotepadState
} from '$lib/features/notepad/state/noteStore';
import { cleanupNoteRuntime } from '$lib/features/notepad/session/noteRuntime';
import type { PaneRuntime } from '$lib/features/notepad/pane/paneRuntime.svelte';
import type { PaneEditorLifecycle } from '$lib/features/notepad/pane/paneEditorLifecycle';
import type { PaneKind } from './notepadCommandFacades';

export interface WorkspacePaneControllerDeps<
  TPaneId extends string
> {
  state: NotepadState<TPaneId>;
  maxVisiblePanes: number;
  getPaneOrder: () => TPaneId[];
  setPaneOrder: (paneIds: TPaneId[]) => void;
  removeWorkspacePane: (paneId: TPaneId) => void;
  getActivePaneId: () => TPaneId;
  getNextPaneId: (
    paneId: TPaneId,
    direction?: 1 | -1
  ) => TPaneId | null;
  getPaneKind: (paneId: TPaneId) => PaneKind;
  getPaneDocument: (paneId: TPaneId) => NoteDraftState;
  getPaneRuntime: (paneId: TPaneId) => PaneRuntime;
  getPaneTitleInput: (
    paneId: TPaneId
  ) => HTMLInputElement | null;
  focusPaneEditorAtEnd: (paneId: TPaneId) => boolean;
  createPane: () => TPaneId;
  closePaneRuntime: (paneId: TPaneId) => Promise<void>;
  setPaneDocument: (
    paneId: TPaneId,
    document: NoteDraftState
  ) => unknown;
  activatePaneSession: (paneId: TPaneId) => unknown;
  activatePane: (paneId: TPaneId) => void;
  focusPane: (
    paneId: TPaneId,
    options?: { preferTitle?: boolean }
  ) => void;
  updateSelectedRelatedText: (paneId?: TPaneId) => void;
  loadRecentNotes: () => unknown;
  ensureLocationMruSeeded: (paneId: TPaneId) => unknown;
  capturePaneLocation: (
    paneId: TPaneId
  ) => NavLocation | null;
  adoptClosedLocation: (
    closedPaneId: TPaneId,
    remainingPaneId: TPaneId,
    location: NavLocation | null
  ) => void;
  touchCurrentLocation: (paneId: TPaneId) => void;
  touchLocation: (
    paneId: TPaneId,
    location: NavLocation
  ) => void;
  bumpLocationHistoryEpoch: () => void;
  beginPaneCommand: (
    paneId: TPaneId,
    noteKey: NoteKey,
    mode: 'split',
    sourcePaneId: TPaneId
  ) => void;
  resetPaneCommand: () => void;
  getPaneCommandPaneId: () => TPaneId | null;
  paneLifecycle: PaneEditorLifecycle<TPaneId>;
  canLeaveDocument?: (document: NoteDraftState) => boolean;
  onNavigationBlocked?: () => void;
  onDocumentLeaving?: (document: NoteDraftState) => void;
  clearSearch: () => void;
}

/** Owns split/close/kind/switch transitions for workspace panes. */
export function createWorkspacePaneController<
  TPaneId extends string
>(deps: WorkspacePaneControllerDeps<TPaneId>) {
  async function splitWorkspace() {
    const order = deps.getPaneOrder();
    if (order.length >= deps.maxVisiblePanes) {
      const activePaneId = deps.getActivePaneId();
      const targetPaneId =
        deps.getNextPaneId(activePaneId) ??
        order.find((paneId) => paneId !== activePaneId);
      if (!targetPaneId) return;

      deps.activatePaneSession(targetPaneId);
      await tick();
      deps.focusPane(targetPaneId, {
        preferTitle:
          document.activeElement ===
          deps.getPaneTitleInput(deps.getActivePaneId())
      });
      return;
    }

    const sourcePaneId = order[0] ?? deps.getActivePaneId();
    const targetPaneId = deps.createPane();
    const sharedDocument = deps.getPaneDocument(sourcePaneId);

    await deps.loadRecentNotes();
    await deps.ensureLocationMruSeeded(sourcePaneId);

    const placeholderDraft = createFreshDraftNote(deps.state);
    addPane(
      deps.state,
      targetPaneId,
      placeholderDraft.key,
      'editor'
    );
    setStoredPaneKind(deps.state, targetPaneId, 'editor');
    deps.setPaneDocument(targetPaneId, placeholderDraft);
    deps.beginPaneCommand(
      targetPaneId,
      sharedDocument.key,
      'split',
      sourcePaneId
    );

    deps.setPaneOrder([...order, targetPaneId]);
    deps.activatePaneSession(targetPaneId);
    await tick();
    await deps.paneLifecycle.ensurePaneEditors();
    deps.updateSelectedRelatedText(targetPaneId);
    deps.focusPaneEditorAtEnd(targetPaneId);
  }

  async function closePane(paneId: TPaneId) {
    const order = deps.getPaneOrder();
    if (order.length === 1) return;

    const closingDocument = deps.getPaneDocument(paneId);
    const closingLocation = deps.capturePaneLocation(paneId);
    const remainingEditorsForDocument = order.filter(
      (candidate) =>
        candidate !== paneId &&
        deps.getPaneKind(candidate) === 'editor' &&
        deps.getPaneDocument(candidate).key === closingDocument.key
    ).length;
    if (
      deps.canLeaveDocument?.(closingDocument) === false &&
      deps.getPaneKind(paneId) === 'editor' &&
      remainingEditorsForDocument === 0
    ) {
      deps.onNavigationBlocked?.();
      return;
    }

    const wasPaneCommand =
      deps.getPaneCommandPaneId() === paneId;
    const orphanPlaceholderKey = wasPaneCommand
      ? deps.getPaneDocument(paneId).key
      : null;

    deps.removeWorkspacePane(paneId);
    if (wasPaneCommand) deps.resetPaneCommand();

    await deps.closePaneRuntime(paneId);
    removeStoredPane(deps.state, paneId);
    if (orphanPlaceholderKey) {
      removeNoteIfUnreferenced(
        deps.state,
        orphanPlaceholderKey
      );
      cleanupNoteRuntime(orphanPlaceholderKey);
    }

    const remainingPaneId = deps.getPaneOrder()[0];
    if (!remainingPaneId) return;
    deps.adoptClosedLocation(
      paneId,
      remainingPaneId,
      closingLocation
    );
    deps.activatePaneSession(remainingPaneId);
    deps.updateSelectedRelatedText();
    await tick();
    deps.focusPane(remainingPaneId);
  }

  async function setPaneKind(
    paneId: TPaneId,
    kind: PaneKind,
    {
      recordCurrentLocation = true
    }: { recordCurrentLocation?: boolean } = {}
  ) {
    if (kind === deps.getPaneKind(paneId)) return;

    const document = deps.getPaneDocument(paneId);
    if (
      kind === 'chat' &&
      deps.canLeaveDocument?.(document) === false
    ) {
      const remainingEditorsForDocument =
        deps.getPaneOrder().filter(
          (candidate) =>
            candidate !== paneId &&
            deps.getPaneKind(candidate) === 'editor' &&
            deps.getPaneDocument(candidate).key === document.key
        ).length;
      if (remainingEditorsForDocument === 0) {
        deps.onNavigationBlocked?.();
        return;
      }
    }
    if (kind === 'chat') deps.onDocumentLeaving?.(document);
    if (recordCurrentLocation) {
      deps.touchCurrentLocation(paneId);
    }

    setStoredPaneKind(deps.state, paneId, kind);
    if (kind === 'chat') {
      // Persist the chat slot on entry so Recent retains it across later
      // note-to-note navigation.
      deps.touchLocation(paneId, {
        kind: 'chat',
        conversationId: getPaneState(deps.state, paneId)
          .chatConversationId,
        contextNoteId: document.currentNoteId,
        contextNotePath: document.currentNotePath
      });
    }
    deps.activatePaneSession(paneId);
    await tick();
    await deps.paneLifecycle.ensurePaneEditors();
    deps.updateSelectedRelatedText();
    deps.bumpLocationHistoryEpoch();
    await tick();
    deps.focusPane(paneId);
  }

  async function handleNotepadCommandBarCommand(
    command: string
  ): Promise<boolean> {
    switch (command.trim().toLowerCase()) {
      case '/chat':
        deps.clearSearch();
        await setPaneKind(deps.getActivePaneId(), 'chat');
        return true;
      case '/edit':
        deps.clearSearch();
        await setPaneKind(deps.getActivePaneId(), 'editor');
        return true;
      default:
        return false;
    }
  }

  async function switchActivePane(direction: 1 | -1 = 1) {
    const currentPaneId = deps.getActivePaneId();
    const nextPaneId = deps.getNextPaneId(
      currentPaneId,
      direction
    );
    if (!nextPaneId) return;

    const preferTitle =
      document.activeElement ===
      deps.getPaneTitleInput(currentPaneId);
    deps.activatePane(nextPaneId);
    await tick();
    deps.focusPane(nextPaneId, { preferTitle });
  }

  return {
    splitWorkspace,
    closePane,
    setPaneKind,
    handleNotepadCommandBarCommand,
    switchActivePane
  };
}
