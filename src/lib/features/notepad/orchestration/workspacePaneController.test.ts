import { describe, expect, it, vi } from 'vitest';
import {
  findOpenDocument,
  removeNoteIfUnreferenced,
  createNoteDraftState,
  createNotepadState,
  upsertNote,
  type PaneDocumentReferences
} from '$lib/features/notepad/state/noteStore';
import { createEmptySessionSnapshot } from '$lib/features/notepad/session/session';
import {
  documentCanLeaveWithoutCanonicalWrite,
  documentHasUnresolvedConflict,
  updateDocumentMarkdown
} from '$lib/features/notepad/document/documentState';
import { createDocumentDepartureController } from './documentDepartureController';
import { createPaneNavigationTransitionPipeline } from './paneNavigationTransitionPipeline';
import { createWorkspacePaneController } from './workspacePaneController';
import {
  createPaneMembershipState,
  transitionPaneMembership,
  type PaneMembershipEvent
} from '$lib/features/notepad/pane/paneLifecycleMachine';

type PaneId = 'left' | 'right' | 'extra';

function document(name = 'note') {
  return createNoteDraftState({
    ...createEmptySessionSnapshot(),
    title: 'Note',
    currentNoteId: name,
    currentNotePath: `/vault/${name}.md`,
    lastSavedTitle: 'Note',
    lastSavedNoteId: name,
    lastSavedPath: `/vault/${name}.md`
  });
}

function harness(
  overrides: {
    prepareDeparture?: (
      paneId: PaneId,
      note: ReturnType<typeof document>
    ) => Promise<ReturnType<typeof document>>;
    disposePaneRuntime?: () => Promise<void>;
    retireWorkspacePane?: () => unknown;
    completeWorkspacePaneDisposal?: () => boolean;
    canRemoveWorkspacePane?: () => boolean;
    getPaneOrder?: () => PaneId[];
    getActivePaneId?: () => PaneId;
    createPane?: () => PaneId;
    getPaneDocument?: (paneId: PaneId) => ReturnType<typeof document>;
    canLeaveDocument?: (note: ReturnType<typeof document>) => boolean;
    removeUnreferencedNote?: (documentHandle: ReturnType<typeof document>['handle']) => boolean;
    loadRecentNotes?: () => Promise<unknown>;
    onDocumentLeaving?: (
      paneId: PaneId,
      note: ReturnType<typeof document>
    ) => void;
  } = {}
) {
  const note = document();
  const state = createNotepadState(note);
  const ensurePaneEditors = vi.fn(async () => undefined);
  const created = vi.fn();
  const focusPane = vi.fn();
  const touchLocation = vi.fn();
  const beginPaneCommand = vi.fn();
  const retireWorkspacePane =
    overrides.retireWorkspacePane ??
    vi.fn(() => ({
      paneId: 'left',
      kind: 'editor',
      documentHandle: note.handle,
      chatConversationId: null
    }));
  const disposePaneRuntime =
    overrides.disposePaneRuntime ??
    vi.fn(async () => undefined);
  const pipeline =
    createPaneNavigationTransitionPipeline<PaneId>({
      assertWorkspaceInvariants: vi.fn(),
      ensurePaneEditors
    });
  const memberships: Record<PaneId, ReturnType<typeof createPaneMembershipState>> = {
    left: createPaneMembershipState(true),
    right: createPaneMembershipState(),
    extra: createPaneMembershipState()
  };
  const dispatchPaneMembership = vi.fn(
    (paneId: PaneId, event: PaneMembershipEvent) => {
      const previous = memberships[paneId];
      memberships[paneId] = transitionPaneMembership(
        previous,
        event
      );
      return memberships[paneId] !== previous;
    }
  );
  const controller =
    createWorkspacePaneController<PaneId>({
      state,
      maxVisiblePanes: 3,
      getPaneOrder:
        overrides.getPaneOrder ?? (() => ['left', 'right']),
      getPaneMembership: (paneId: PaneId) =>
        memberships[paneId],
      dispatchPaneMembership,
      createPane: overrides.createPane ?? (() => 'right'),
      completeWorkspacePaneCreation: (
        paneId: PaneId,
        operationId: number,
        documentHandle: string,
        kind: string
      ) => {
        created(paneId, documentHandle, kind);
        dispatchPaneMembership(paneId, {
          type: 'creationCompleted',
          operationId
        });
        return {} as never;
      },
      canRemoveWorkspacePane:
        overrides.canRemoveWorkspacePane ?? (() => true),
      paneCloseAnimation: {
        collapse: vi.fn(async () => undefined),
        release: vi.fn()
      },
      getPaneDocument: overrides.getPaneDocument ?? (() => note),
      setPaneDocument: vi.fn(),
      getPaneKind: () => 'editor',
      getPaneConversationId: () => null,
      setStoredPaneKind: vi.fn(() => true),
      capturePaneLocation: () => null,
      getPaneCommandPaneId: () => null,
      removeUnreferencedNote:
        overrides.removeUnreferencedNote ?? (() => false),
      canLeaveDocument: overrides.canLeaveDocument,
      documentDeparture: {
        prepare:
          overrides.prepareDeparture ??
          vi.fn(async () => note)
      },
      disposePaneRuntime,
      retireWorkspacePane: (
        paneId: PaneId,
        operationId: number
      ) => {
        const result = retireWorkspacePane();
        if (result) {
          dispatchPaneMembership(paneId, {
            type: 'retirementStarted',
            operationId
          });
        }
        return result as never;
      },
      completeWorkspacePaneDisposal: (
        paneId: PaneId,
        operationId: number
      ) => {
        const complete =
          overrides.completeWorkspacePaneDisposal ??
          vi.fn(() => true);
        const result = complete();
        if (result) {
          dispatchPaneMembership(paneId, {
            type: 'disposalCompleted',
            operationId
          });
        }
        return result;
      },
      getActivePaneId: overrides.getActivePaneId ?? (() => 'right'),
      beginPaneCommand,
      adoptClosedLocation: vi.fn(),
      activatePaneSession: vi.fn(),
      updateSelectedRelatedText: vi.fn(),
      touchCurrentLocation: vi.fn(),
      touchLocation,
      bumpLocationHistoryEpoch: vi.fn(),
      onDocumentLeaving: overrides.onDocumentLeaving,
      focusPane,
      activatePane: vi.fn(),
      resetPaneCommand: vi.fn(),
      loadRecentNotes:
        overrides.loadRecentNotes ??
        vi.fn(async () => undefined),
      ensureLocationMruSeeded: vi.fn(async () => undefined),
      transitions: pipeline
    } as never);

  return {
    note, state, created, ensurePaneEditors, focusPane, touchLocation,
    controller,
    retireWorkspacePane,
    disposePaneRuntime,
    beginPaneCommand,
    getMembership: (paneId: PaneId = 'left') =>
      memberships[paneId]
  };
}

describe('workspace pane close lifecycle', () => {
  it('returns a policy-blocked close to ready', async () => {
    const { controller, getMembership, retireWorkspacePane } =
      harness({ canRemoveWorkspacePane: () => false });

    await controller.closePane('left');

    expect(getMembership().kind).toBe('ready');
    expect(retireWorkspacePane).not.toHaveBeenCalled();
  });

  it('does not remove the pane when close preparation fails', async () => {
    const failure = new Error('save failed');
    const prepareDeparture = vi.fn(async () => {
      throw failure;
    });
    const {
      controller,
      retireWorkspacePane,
      disposePaneRuntime,
      getMembership
    } =
      harness({ prepareDeparture });

    await expect(controller.closePane('left')).rejects.toBe(
      failure
    );
    expect(retireWorkspacePane).not.toHaveBeenCalled();
    expect(disposePaneRuntime).not.toHaveBeenCalled();
    expect(getMembership().kind).toBe('ready');
  });

  it('prepares, removes, tears down, then releases retired pane state', async () => {
    const events: string[] = [];
    const { controller, getMembership } = harness({
      prepareDeparture: vi.fn(async () => {
        events.push('prepare');
        return document();
      }),
      retireWorkspacePane: vi.fn(() => {
        events.push('remove');
        return {
          paneId: 'left',
          kind: 'editor',
          documentHandle: 'document:note',
          chatConversationId: null
        };
      }),
      disposePaneRuntime: vi.fn(async () => {
        events.push('dispose');
      }),
      completeWorkspacePaneDisposal: vi.fn(() => {
        events.push('finalize');
        return true;
      })
    });

    await controller.closePane('left');

    expect(events).toEqual([
      'prepare',
      'remove',
      'dispose',
      'finalize'
    ]);
    expect(getMembership().kind).toBe('disposed');
  });

  it('blocks two dirty collision drafts, then closes a deliberately cleaned side without rewriting it', async () => {
    const left = createNoteDraftState({
      ...createEmptySessionSnapshot(),
      title: 'Left',
      bodyMarkdown: 'left baseline',
      currentNoteId: 'left-id',
      currentNotePath: '/vault/Shared.md',
      lastSavedTitle: 'Left',
      lastSavedMarkdown: 'left baseline',
      lastSavedNoteId: 'left-id',
      lastSavedPath: '/vault/Shared.md'
    });
    const right = createNoteDraftState({
      ...createEmptySessionSnapshot(),
      title: 'Right',
      bodyMarkdown: 'right dirty draft',
      currentNoteId: 'right-id',
      currentNotePath: '/vault/Shared.md',
      lastSavedTitle: 'Right',
      lastSavedMarkdown: 'right baseline',
      lastSavedNoteId: 'right-id',
      lastSavedPath: '/vault/Shared.md'
    });
    const state = createNotepadState(left, '/vault');
    upsertNote(state, right);
    updateDocumentMarkdown(left, 'left dirty draft');
    let paneOrder: PaneId[] = ['left', 'right'];
    const paneDocuments = { left, right, extra: right };
    const paneReferences: PaneDocumentReferences<PaneId> = {
      getPaneState: (paneId) => ({
        documentHandle: paneDocuments[paneId].handle
      }),
      setPaneDocumentHandle: () => undefined,
      replaceDocumentHandleReferences: () => undefined,
      isDocumentReferenced: (handle) =>
        paneOrder.some(
          (paneId) => paneDocuments[paneId].handle === handle
        ),
      listReferencedDocumentHandles: () =>
        paneOrder.map((paneId) => paneDocuments[paneId].handle)
    };
    let releaseQueue!: () => void;
    const pendingQueue = new Promise<void>((resolve) => {
      releaseQueue = resolve;
    });
    const getNoteSaveQueue = vi.fn(() => pendingQueue);
    const enqueueSave = vi.fn().mockResolvedValue(undefined);
    const departure = createDocumentDepartureController<PaneId>({
      getPaneDocument: (paneId) => paneDocuments[paneId],
      hasOtherEditingPane: () => false,
      finalizeWindow: vi.fn().mockResolvedValue(undefined),
      flushAllPendingCursorSaves: vi.fn(),
      cancelPendingAutosave: vi.fn(),
      enqueueSave,
      getNoteSaveQueue,
      saveCursorPositionForPane: vi.fn(),
      clearLastOpenedNote: vi.fn().mockResolvedValue(undefined)
    });
    const retireWorkspacePane = vi.fn(() => {
      paneOrder = ['right'];
      return {
        paneId: 'left' as const,
        kind: 'editor' as const,
        documentHandle: left.handle,
        chatConversationId: null
      };
    });
    const removeUnreferencedNote = vi.fn((handle: typeof left.handle) =>
      removeNoteIfUnreferenced(state, paneReferences, handle)
    );
    const { controller, getMembership } = harness({
      getPaneOrder: () => paneOrder,
      getPaneDocument: (paneId) => paneDocuments[paneId],
      canLeaveDocument: (note) =>
        !documentHasUnresolvedConflict(note) ||
        documentCanLeaveWithoutCanonicalWrite(note),
      prepareDeparture: departure.prepare,
      retireWorkspacePane,
      removeUnreferencedNote
    });

    await controller.closePane('left');

    expect(getMembership().kind).toBe('ready');
    expect(retireWorkspacePane).not.toHaveBeenCalled();
    expect(enqueueSave).not.toHaveBeenCalled();

    updateDocumentMarkdown(left, 'left baseline');
    const close = controller.closePane('left');

    await vi.waitFor(() => {
      expect(getNoteSaveQueue).toHaveBeenCalledExactlyOnceWith(left.handle);
    });
    expect(retireWorkspacePane).not.toHaveBeenCalled();
    expect(removeUnreferencedNote).not.toHaveBeenCalled();

    releaseQueue();
    await close;

    expect(retireWorkspacePane).toHaveBeenCalledOnce();
    expect(enqueueSave).not.toHaveBeenCalled();
    expect(removeUnreferencedNote).toHaveBeenCalledWith(left.handle);
    expect(state.documentsByHandle[left.handle]).toBeUndefined();
    expect(right.canonicalCollision).toBeNull();
    expect(findOpenDocument(state, {
      noteId: 'right-id',
      path: '/vault/Shared.md'
    })).toBe(right);
  });
});

describe('workspace pane creation lifecycle', () => {
  it('creates chat with retained context and no throwaway editor or draft', async () => {
    const h = harness({ getPaneOrder: () => ['left'] });
    await h.controller.splitWorkspace('chat');
    expect(h.created).toHaveBeenCalledWith('right', h.note.handle, 'chat');
    expect(Object.keys(h.state.documentsByHandle)).toEqual([h.note.handle]);
    expect(h.beginPaneCommand).not.toHaveBeenCalled();
    expect(h.ensurePaneEditors).not.toHaveBeenCalled();
    expect(h.touchLocation).toHaveBeenCalledWith('right', {
      kind: 'editor', noteId: 'note', notePath: '/vault/note.md'
    });
    expect(h.focusPane).toHaveBeenCalledWith('right');
    expect(h.getMembership('right').kind).toBe('ready');
  });

  it('disposes a creating runtime when split preparation fails', async () => {
    const failure = new Error('recent notes unavailable');
    const disposePaneRuntime = vi.fn(async () => undefined);
    const { controller, getMembership } = harness({
      getPaneOrder: () => ['left'],
      loadRecentNotes: vi.fn(async () => {
        throw failure;
      }),
      disposePaneRuntime
    });

    await expect(controller.splitWorkspace()).rejects.toBe(
      failure
    );

    expect(getMembership('right').kind).toBe('disposed');
    expect(disposePaneRuntime).toHaveBeenCalledWith(
      'right',
      null
    );
  });
});

describe('workspace pane split source', () => {
  it('inherits the split from the active pane, not the first pane in order', async () => {
    const notes: Record<PaneId, ReturnType<typeof document>> = {
      left: document('left-note'),
      right: document('right-note'),
      extra: document('extra-note')
    };
    const { controller, beginPaneCommand } = harness({
      getPaneOrder: () => ['left', 'right'],
      getActivePaneId: () => 'right',
      createPane: () => 'extra',
      getPaneDocument: (paneId) => notes[paneId]
    });

    await controller.splitWorkspace();

    expect(beginPaneCommand).toHaveBeenCalledWith(
      'extra',
      notes.right.handle,
      'split',
      'right'
    );
  });
});

describe('workspace pane document ownership', () => {
  it('identifies the exact pane whose editor is leaving for chat', async () => {
    const onDocumentLeaving = vi.fn();
    const { controller, note } = harness({ onDocumentLeaving });

    await controller.setPaneKind('right', 'chat');

    expect(onDocumentLeaving).toHaveBeenCalledOnce();
    expect(onDocumentLeaving).toHaveBeenCalledWith(
      'right',
      note
    );
  });
});
