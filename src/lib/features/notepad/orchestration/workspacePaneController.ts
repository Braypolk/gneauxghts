import { tick } from 'svelte';
import type { NavLocation } from '$lib/features/notepad/navigation/locationMru';
import {
  createFreshDraftNote,
  type NoteDraftState,
  type NoteKey,
  type NotepadState
} from '$lib/features/notepad/state/noteStore';
import { cleanupNoteRuntime } from '$lib/features/notepad/session/noteRuntime';
import type { PaneEditorLifecycle } from '$lib/features/notepad/pane/paneEditorLifecycle';
import type { PaneKind } from './notepadCommandFacades';
import type { WorkspacePaneState } from '$lib/features/notepad/workspace/paneTypes';
import {
  canSetPaneKind,
  paneHasCapability
} from '$lib/features/notepad/workspace/paneCapabilities';
import {
  getDocumentNoteId,
  getDocumentPath
} from '$lib/features/notepad/document/documentState';
import type {
  PaneNavigationTransitionPipeline
} from './paneNavigationTransitionPipeline';

export interface WorkspacePaneControllerDeps<
  TPaneId extends string
> {
  state: NotepadState<TPaneId>;
  maxVisiblePanes: number;
  getPaneOrder: () => TPaneId[];
  addWorkspacePane: (
    paneId: TPaneId,
    noteKey: NoteKey,
    kind?: PaneKind
  ) => WorkspacePaneState<TPaneId>;
  canRemoveWorkspacePane: (paneId: TPaneId) => boolean;
  removeWorkspacePane: (
    paneId: TPaneId
  ) => WorkspacePaneState<TPaneId> | null;
  finalizeWorkspacePaneRemoval: (paneId: TPaneId) => void;
  getActivePaneId: () => TPaneId;
  getNextPaneId: (
    paneId: TPaneId,
    direction?: 1 | -1
  ) => TPaneId | null;
  getPaneKind: (paneId: TPaneId) => PaneKind;
  getPaneConversationId: (paneId: TPaneId) => string | null;
  setStoredPaneKind: (
    paneId: TPaneId,
    kind: PaneKind
  ) => boolean;
  getPaneDocument: (paneId: TPaneId) => NoteDraftState;
  getPaneTitleInput: (
    paneId: TPaneId
  ) => HTMLInputElement | null;
  focusPaneEditorAtEnd: (paneId: TPaneId) => boolean;
  createPane: () => TPaneId;
  preparePaneClose: (
    paneId: TPaneId,
    document: NoteDraftState
  ) => Promise<void>;
  disposePaneRuntime: (
    paneId: TPaneId,
    document: NoteDraftState
  ) => Promise<void>;
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
  removeUnreferencedNote: (noteKey: NoteKey) => void;
  paneLifecycle: PaneEditorLifecycle<TPaneId>;
  canLeaveDocument?: (document: NoteDraftState) => boolean;
  onNavigationBlocked?: () => void;
  onDocumentLeaving?: (
    paneId: TPaneId,
    document: NoteDraftState
  ) => void;
  clearSearch: () => void;
  transitions: PaneNavigationTransitionPipeline<TPaneId>;
}

/** Owns split/close/kind/switch transitions for workspace panes. */
export function createWorkspacePaneController<
  TPaneId extends string
>(deps: WorkspacePaneControllerDeps<TPaneId>) {
  async function executeTransition(
    request: Parameters<
      PaneNavigationTransitionPipeline<TPaneId>['execute']
    >[0]
  ) {
    const result = await deps.transitions.execute(request);
    if (result.status === 'failed') {
      throw result.error;
    }
    return result;
  }

  async function splitWorkspace() {
    const order = deps.getPaneOrder();
    if (order.length >= deps.maxVisiblePanes) {
      const activePaneId = deps.getActivePaneId();
      const targetPaneId =
        deps.getNextPaneId(activePaneId) ??
        order.find((paneId) => paneId !== activePaneId);
      let preferTitle = false;
      let claimedTarget = false;
      await executeTransition({
        kind: 'switch-pane',
        resolvePane: () => targetPaneId ?? null,
        captureHistory: () => {
          preferTitle =
            document.activeElement ===
            deps.getPaneTitleInput(activePaneId);
        },
        mutateWorkspace: (paneId) => {
          deps.activatePaneSession(paneId);
          claimedTarget = true;
        },
        isCurrent: (paneId) =>
          !claimedTarget ||
          deps.getActivePaneId() === paneId,
        focus: async (paneId) => {
          await tick();
          deps.focusPane(paneId, { preferTitle });
        }
      });
      return;
    }

    const sourcePaneId = order[0] ?? deps.getActivePaneId();
    const targetPaneId = deps.createPane();
    const sharedDocument = deps.getPaneDocument(sourcePaneId);
    let claimedTarget = false;
    await executeTransition({
      kind: 'split-pane',
      resolvePane: () => targetPaneId,
      prepare: async () => {
        await deps.loadRecentNotes();
        await deps.ensureLocationMruSeeded(sourcePaneId);
      },
      mutateWorkspace: (paneId) => {
        const placeholderDraft =
          createFreshDraftNote(deps.state);
        deps.addWorkspacePane(
          paneId,
          placeholderDraft.key,
          'editor'
        );
        deps.beginPaneCommand(
          paneId,
          sharedDocument.key,
          'split',
          sourcePaneId
        );
        deps.activatePaneSession(paneId);
        claimedTarget = true;
      },
      isCurrent: (paneId) =>
        !claimedTarget ||
        deps.getActivePaneId() === paneId,
      ensureEditors: true,
      complete: (paneId) => {
        deps.updateSelectedRelatedText(paneId);
      },
      focus: (paneId) => {
        deps.focusPaneEditorAtEnd(paneId);
      }
    });
  }

  async function closePane(paneId: TPaneId) {
    let closingDocument: NoteDraftState;
    let closingLocation: NavLocation | null = null;
    let orphanPlaceholderKey: NoteKey | null = null;
    let remainingPaneId: TPaneId | null = null;
    let workspaceRemoved = false;
    let teardownPromise: Promise<void> | null = null;
    function teardownRemovedPane() {
      if (!workspaceRemoved) return Promise.resolve();
      teardownPromise ??= (async () => {
        try {
          // Keep the removed pane's workspace record and runtime readable
          // through Svelte component/action teardown. Teardown callbacks save
          // cursor state and destroy the editor before we release that lease.
          await tick();
          await deps.disposePaneRuntime(
            paneId,
            closingDocument
          );
        } finally {
          deps.finalizeWorkspacePaneRemoval(paneId);
        }
      })();
      return teardownPromise;
    }
    await executeTransition({
      kind: 'close-pane',
      resolvePane: () =>
        deps.getPaneOrder().includes(paneId) ? paneId : null,
      guard: () => {
        if (!deps.canRemoveWorkspacePane(paneId)) {
          return {
            status: 'blocked',
            reason: 'Closing this pane would violate workspace invariants.'
          };
        }
        closingDocument = deps.getPaneDocument(paneId);
        const remainingEditorsForDocument =
          deps.getPaneOrder().filter(
            (candidate) =>
              candidate !== paneId &&
              paneHasCapability(
                deps.getPaneKind(candidate),
                'edit-document'
              ) &&
              deps.getPaneDocument(candidate).key ===
                closingDocument.key
          ).length;
        if (
          deps.canLeaveDocument?.(closingDocument) === false &&
          paneHasCapability(
            deps.getPaneKind(paneId),
            'edit-document'
          ) &&
          remainingEditorsForDocument === 0
        ) {
          deps.onNavigationBlocked?.();
          return {
            status: 'blocked',
            reason: 'The document has an unresolved navigation guard.'
          };
        }
        return { status: 'allow' };
      },
      captureHistory: () => {
        closingLocation = deps.capturePaneLocation(paneId);
      },
      prepare: async () => {
        await deps.preparePaneClose(
          paneId,
          closingDocument
        );
      },
      mutateWorkspace: () => {
        const wasPaneCommand =
          deps.getPaneCommandPaneId() === paneId;
        orphanPlaceholderKey = wasPaneCommand
          ? closingDocument.key
          : null;
        if (wasPaneCommand) deps.resetPaneCommand();
        if (!deps.removeWorkspacePane(paneId)) {
          throw new Error('Pane became unavailable before close.');
        }
        workspaceRemoved = true;
        remainingPaneId = deps.getActivePaneId();
      },
      isCurrent: () =>
        !remainingPaneId ||
        deps.getActivePaneId() === remainingPaneId,
      complete: async () => {
        await teardownRemovedPane();
        if (orphanPlaceholderKey) {
          deps.removeUnreferencedNote(orphanPlaceholderKey);
          cleanupNoteRuntime(orphanPlaceholderKey);
        }
        if (!remainingPaneId) return;
        deps.adoptClosedLocation(
          paneId,
          remainingPaneId,
          closingLocation
        );
        deps.activatePaneSession(remainingPaneId);
        deps.updateSelectedRelatedText();
      },
      focus: async () => {
        if (!remainingPaneId) return;
        await tick();
        deps.focusPane(remainingPaneId);
      },
      onStale: async () => {
        await teardownRemovedPane();
      },
      onFailed: async () => {
        try {
          await teardownRemovedPane();
        } catch {
          // Preserve the original transition failure. Teardown already releases
          // the retired workspace record in its finally block.
        }
      }
    });
  }

  async function setPaneKind(
    paneId: TPaneId,
    kind: PaneKind,
    {
      recordCurrentLocation = true
    }: { recordCurrentLocation?: boolean } = {}
  ) {
    let paneDocument: NoteDraftState;
    let claimedTarget = false;
    await executeTransition({
      kind: 'change-pane-kind',
      resolvePane: () =>
        deps.getPaneOrder().includes(paneId) ? paneId : null,
      guard: () => {
        if (kind === deps.getPaneKind(paneId)) {
          return {
            status: 'noop',
            reason: 'Pane already has the requested kind.'
          };
        }
        if (
          !canSetPaneKind(
            {
              paneOrder: deps.getPaneOrder(),
              getPaneKind: deps.getPaneKind
            },
            paneId,
            kind
          )
        ) {
          return {
            status: 'blocked',
            reason: 'The pane cannot change to the requested kind.'
          };
        }
        paneDocument = deps.getPaneDocument(paneId);
        if (
          kind === 'chat' &&
          deps.canLeaveDocument?.(paneDocument) === false
        ) {
          const remainingEditorsForDocument =
            deps.getPaneOrder().filter(
              (candidate) =>
                candidate !== paneId &&
                paneHasCapability(
                  deps.getPaneKind(candidate),
                  'edit-document'
                ) &&
                deps.getPaneDocument(candidate).key ===
                  paneDocument.key
            ).length;
          if (remainingEditorsForDocument === 0) {
            deps.onNavigationBlocked?.();
            return {
              status: 'blocked',
              reason:
                'The retained document has an unresolved navigation guard.'
            };
          }
        }
        return { status: 'allow' };
      },
      captureHistory: () => {
        if (kind === 'chat') {
          deps.onDocumentLeaving?.(paneId, paneDocument);
        }
        if (recordCurrentLocation) {
          deps.touchCurrentLocation(paneId);
        }
      },
      mutateWorkspace: () => {
        if (!deps.setStoredPaneKind(paneId, kind)) {
          throw new Error(
            'Workspace rejected an allowed pane-kind transition.'
          );
        }
        deps.activatePaneSession(paneId);
        claimedTarget = true;
      },
      isCurrent: () =>
        !claimedTarget ||
        deps.getActivePaneId() === paneId,
      ensureEditors: true,
      complete: () => {
        if (kind === 'chat') {
          deps.touchLocation(paneId, {
            kind: 'chat',
            conversationId:
              deps.getPaneConversationId(paneId),
            contextNoteId:
              getDocumentNoteId(paneDocument),
            contextNotePath:
              getDocumentPath(paneDocument)
          });
        }
        deps.updateSelectedRelatedText();
        deps.bumpLocationHistoryEpoch();
      },
      focus: async () => {
        await tick();
        deps.focusPane(paneId);
      }
    });
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
    let preferTitle = false;
    let claimedTarget = false;
    await executeTransition({
      kind: 'switch-pane',
      resolvePane: () => nextPaneId,
      captureHistory: () => {
        preferTitle =
          document.activeElement ===
          deps.getPaneTitleInput(currentPaneId);
      },
      mutateWorkspace: (paneId) => {
        deps.activatePane(paneId);
        claimedTarget = true;
      },
      isCurrent: (paneId) =>
        !claimedTarget ||
        deps.getActivePaneId() === paneId,
      focus: async (paneId) => {
        await tick();
        deps.focusPane(paneId, { preferTitle });
      }
    });
  }

  return {
    splitWorkspace,
    closePane,
    setPaneKind,
    handleNotepadCommandBarCommand,
    switchActivePane
  };
}
