import { tick } from 'svelte';
import type { NavLocation } from '$lib/features/notepad/navigation/locationMru';
import {
  createFreshDraftNote,
  type NoteDraftState,
  type DocumentHandle,
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
import { adoptChatContextFromLeavingEditor } from '$lib/features/notepad/workspace/paneRoles';
import {
  getDocumentNoteId,
  getDocumentPath
} from '$lib/features/notepad/document/documentState';
import type {
  PaneNavigationTransitionPipeline
} from './paneNavigationTransitionPipeline';
import type {
  DocumentDepartureController
} from './documentDepartureController';
import type {
  PaneMembershipEvent,
  PaneMembershipState
} from '$lib/features/notepad/pane/paneLifecycleMachine';
import type {
  PaneCloseAnimation
} from '$lib/features/notepad/workspace/paneCloseAnimation';

export interface WorkspacePaneControllerDeps<
  TPaneId extends string
> {
  state: NotepadState<TPaneId>;
  maxVisiblePanes: number;
  getPaneOrder: () => TPaneId[];
  getPaneMembership: (paneId: TPaneId) => PaneMembershipState;
  dispatchPaneMembership: (
    paneId: TPaneId,
    event: PaneMembershipEvent
  ) => boolean;
  completeWorkspacePaneCreation: (
    paneId: TPaneId,
    operationId: number,
    documentHandle: DocumentHandle,
    kind?: PaneKind
  ) => WorkspacePaneState<TPaneId>;
  canRemoveWorkspacePane: (paneId: TPaneId) => boolean;
  paneCloseAnimation: PaneCloseAnimation<TPaneId>;
  retireWorkspacePane: (
    paneId: TPaneId,
    operationId: number
  ) => WorkspacePaneState<TPaneId> | null;
  completeWorkspacePaneDisposal: (
    paneId: TPaneId,
    operationId: number
  ) => boolean;
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
  setPaneDocument: (paneId: TPaneId, document: NoteDraftState) => void;
  getPaneTitleInput: (
    paneId: TPaneId
  ) => HTMLInputElement | null;
  focusPaneEditorAtEnd: (paneId: TPaneId) => boolean;
  createPane: () => TPaneId;
  disposePaneRuntime: (
    paneId: TPaneId,
    document: NoteDraftState | null
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
    documentHandle: DocumentHandle,
    mode: 'split',
    sourcePaneId: TPaneId
  ) => void;
  resetPaneCommand: () => void;
  getPaneCommandPaneId: () => TPaneId | null;
  removeUnreferencedNote: (documentHandle: DocumentHandle) => boolean;
  paneLifecycle: PaneEditorLifecycle<TPaneId>;
  canLeaveDocument?: (document: NoteDraftState) => boolean;
  onNavigationBlocked?: () => void;
  onDocumentLeaving?: (
    paneId: TPaneId,
    document: NoteDraftState
  ) => void;
  clearSearch: () => void;
  documentDeparture: DocumentDepartureController<TPaneId>;
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

  async function splitWorkspace(initialKind: PaneKind = 'editor') {
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

    // The new pane inherits from the pane the user is working in, not from
    // whichever pane happens to sit first in the layout.
    const activePaneId = deps.getActivePaneId();
    const sourcePaneId = order.includes(activePaneId)
      ? activePaneId
      : order[0] ?? activePaneId;
    const targetPaneId = deps.createPane();
    const sharedDocument = deps.getPaneDocument(sourcePaneId);
    let creationOperationId: number | null = null;
    let claimedTarget = false;
    let creationCompleted = false;
    let abandonPromise: Promise<void> | null = null;
    function abandonCreation() {
      abandonPromise ??= (async () => {
        const membership =
          deps.getPaneMembership(targetPaneId);
        if (membership.kind === 'creating') {
          if (membership.operationId !== creationOperationId) return;
          deps.dispatchPaneMembership(targetPaneId, {
            type: 'creationFailed',
            operationId: membership.operationId
          });
        } else if (membership.kind !== 'absent') {
          return;
        }
        await deps.disposePaneRuntime(targetPaneId, null);
      })();
      return abandonPromise;
    }
    await executeTransition({
      kind: 'split-pane',
      resolvePane: () => targetPaneId,
      onResolved: (paneId, operationId) => {
        creationOperationId = operationId;
        if (
          !deps.dispatchPaneMembership(paneId, {
            type: 'createRequested',
            operationId
          })
        ) {
          throw new Error('Pane creation could not start.');
        }
      },
      prepare: async () => {
        await deps.loadRecentNotes();
        await deps.ensureLocationMruSeeded(sourcePaneId);
      },
      mutateWorkspace: (paneId) => {
        if (creationOperationId === null) {
          throw new Error('Pane creation operation is missing.');
        }
        // A known chat destination retains the source directly. It never needs
        // a placeholder document, editor mount, or intermediate picker.
        const initialDocument = initialKind === 'chat'
          ? sharedDocument
          : createFreshDraftNote(deps.state);
        deps.completeWorkspacePaneCreation(
          paneId,
          creationOperationId,
          initialDocument.handle,
          initialKind
        );
        creationCompleted = true;
        if (initialKind === 'chat') {
          deps.resetPaneCommand();
          deps.touchLocation(paneId, {
            kind: 'editor',
            noteId: getDocumentNoteId(sharedDocument),
            notePath: getDocumentPath(sharedDocument)
          });
        } else {
          deps.beginPaneCommand(
            paneId,
            sharedDocument.handle,
            'split',
            sourcePaneId
          );
        }
        if (initialKind === 'chat') deps.activatePane(paneId);
        else deps.activatePaneSession(paneId);
        claimedTarget = true;
      },
      isCurrent: (paneId) =>
        !claimedTarget ||
        deps.getActivePaneId() === paneId,
      ensureEditors: paneHasCapability(initialKind, 'edit-document'),
      complete: (paneId) => {
        if (initialKind !== 'chat') deps.updateSelectedRelatedText(paneId);
      },
      focus: async (paneId) => {
        if (initialKind === 'chat') {
          await tick();
          deps.focusPane(paneId);
        } else {
          deps.focusPaneEditorAtEnd(paneId);
        }
      },
      onStale: async () => {
        if (!creationCompleted) await abandonCreation();
      },
      onFailed: async () => {
        if (!creationCompleted) await abandonCreation();
      }
    });
  }

  async function closePane(paneId: TPaneId) {
    let closingDocument: NoteDraftState;
    let closingLocation: NavLocation | null = null;
    let orphanPlaceholderKey: DocumentHandle | null = null;
    let remainingPaneId: TPaneId | null = null;
    let closeOperationId: number | null = null;
    let workspaceRemoved = false;
    let closingHadCanonicalCollision = false;
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
          if (closeOperationId !== null) {
            deps.completeWorkspacePaneDisposal(
              paneId,
              closeOperationId
            );
          }
        }
      })();
      return teardownPromise;
    }
    await executeTransition({
      kind: 'close-pane',
      resolvePane: () =>
        deps.getPaneOrder().includes(paneId) ? paneId : null,
      guard: (_paneId, operationId) => {
        const membership = deps.getPaneMembership(paneId);
        if (membership.kind !== 'ready') {
          return {
            status: 'noop',
            reason: 'Pane is already transitioning.'
          };
        }
        deps.dispatchPaneMembership(paneId, {
          type: 'closeRequested',
          operationId
        });
        const closing = deps.getPaneMembership(paneId);
        if (closing.kind !== 'closing') {
          return {
            status: 'noop',
            reason: 'Pane close could not start.'
          };
        }
        closeOperationId = operationId;
        if (!deps.canRemoveWorkspacePane(paneId)) {
          deps.dispatchPaneMembership(paneId, {
            type: 'closeBlocked',
            operationId: closeOperationId
          });
          return {
            status: 'blocked',
            reason: 'Closing this pane would violate workspace invariants.'
          };
        }
        closingDocument = deps.getPaneDocument(paneId);
        closingHadCanonicalCollision =
          closingDocument.canonicalCollision !== null;
        const remainingEditorsForDocument =
          deps.getPaneOrder().filter(
            (candidate) =>
              candidate !== paneId &&
              paneHasCapability(
                deps.getPaneKind(candidate),
                'edit-document'
              ) &&
              deps.getPaneDocument(candidate).handle ===
                closingDocument.handle
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
          deps.dispatchPaneMembership(paneId, {
            type: 'closeBlocked',
            operationId: closeOperationId
          });
          return {
            status: 'blocked',
            reason: 'The document has an unresolved navigation guard.'
          };
        }
        return { status: 'allow' };
      },
      departDocument: async () => {
        closingDocument =
          await deps.documentDeparture.prepare(
            paneId,
            closingDocument
          );
      },
      captureHistory: () => {
        closingLocation = deps.capturePaneLocation(paneId);
      },
      // Collapse after the guards and the save have cleared, so a blocked or
      // failed close never animates a pane that is staying.
      prepare: async () => {
        await deps.paneCloseAnimation.collapse(paneId);
      },
      mutateWorkspace: () => {
        const wasPaneCommand =
          deps.getPaneCommandPaneId() === paneId;
        orphanPlaceholderKey = wasPaneCommand
          ? closingDocument.handle
          : null;
        if (wasPaneCommand) deps.resetPaneCommand();
        // Capture live chat context before this editor leaves paneOrder.
        adoptChatContextFromLeavingEditor(
          deps.getPaneOrder(),
          deps.getPaneKind,
          paneId,
          closingDocument,
          deps.setPaneDocument
        );
        if (
          closeOperationId === null ||
          !deps.retireWorkspacePane(
            paneId,
            closeOperationId
          )
        ) {
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
        deps.paneCloseAnimation.release(paneId);
        if (
          closingHadCanonicalCollision &&
          deps.removeUnreferencedNote(closingDocument.handle)
        ) {
          cleanupNoteRuntime(closingDocument.handle);
        }
        if (
          orphanPlaceholderKey &&
          orphanPlaceholderKey !== closingDocument.handle &&
          deps.removeUnreferencedNote(orphanPlaceholderKey)
        ) {
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
        if (closeOperationId !== null) {
          deps.dispatchPaneMembership(paneId, {
            type: 'closeBlocked',
            operationId: closeOperationId
          });
        }
        deps.paneCloseAnimation.release(paneId);
        await teardownRemovedPane();
      },
      onFailed: async () => {
        if (closeOperationId !== null) {
          deps.dispatchPaneMembership(paneId, {
            type: 'closeBlocked',
            operationId: closeOperationId
          });
        }
        deps.paneCloseAnimation.release(paneId);
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
                deps.getPaneDocument(candidate).handle ===
                  paneDocument.handle
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
      departDocument:
        kind === 'chat'
          ? async () => {
              paneDocument =
                await deps.documentDeparture.prepare(
                  paneId,
                  paneDocument
                );
            }
          : undefined,
      captureHistory: () => {
        if (kind === 'chat') {
          deps.onDocumentLeaving?.(paneId, paneDocument);
        }
        if (recordCurrentLocation) {
          deps.touchCurrentLocation(paneId);
        }
      },
      mutateWorkspace: () => {
        if (kind === 'chat') {
          // Sibling chats that were following this editor need its note before
          // the kind flip makes getChatContextPaneId fall back to stale retains.
          adoptChatContextFromLeavingEditor(
            deps.getPaneOrder(),
            deps.getPaneKind,
            paneId,
            paneDocument,
            deps.setPaneDocument
          );
        }
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
