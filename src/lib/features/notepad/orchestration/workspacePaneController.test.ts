import { describe, expect, it, vi } from 'vitest';
import {
  createNoteDraftState,
  createNotepadState
} from '$lib/features/notepad/state/noteStore';
import { createEmptySessionSnapshot } from '$lib/features/notepad/session/session';
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
    prepareDeparture?: () => Promise<ReturnType<typeof document>>;
    disposePaneRuntime?: () => Promise<void>;
    retireWorkspacePane?: () => unknown;
    completeWorkspacePaneDisposal?: () => boolean;
    canRemoveWorkspacePane?: () => boolean;
    getPaneOrder?: () => PaneId[];
    getActivePaneId?: () => PaneId;
    createPane?: () => PaneId;
    getPaneDocument?: (paneId: PaneId) => ReturnType<typeof document>;
    loadRecentNotes?: () => Promise<unknown>;
    onDocumentLeaving?: (
      paneId: PaneId,
      note: ReturnType<typeof document>
    ) => void;
  } = {}
) {
  const note = document();
  const beginPaneCommand = vi.fn();
  const retireWorkspacePane =
    overrides.retireWorkspacePane ??
    vi.fn(() => ({
      paneId: 'left',
      kind: 'editor',
      noteKey: note.key,
      chatConversationId: null
    }));
  const disposePaneRuntime =
    overrides.disposePaneRuntime ??
    vi.fn(async () => undefined);
  const pipeline =
    createPaneNavigationTransitionPipeline<PaneId>({
      assertWorkspaceInvariants: vi.fn(),
      ensurePaneEditors: vi.fn(async () => undefined)
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
      state: createNotepadState(note),
      maxVisiblePanes: 3,
      getPaneOrder:
        overrides.getPaneOrder ?? (() => ['left', 'right']),
      getPaneMembership: (paneId: PaneId) =>
        memberships[paneId],
      dispatchPaneMembership,
      createPane: overrides.createPane ?? (() => 'right'),
      completeWorkspacePaneCreation: (
        paneId: PaneId,
        operationId: number
      ) => {
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
      touchLocation: vi.fn(),
      bumpLocationHistoryEpoch: vi.fn(),
      onDocumentLeaving: overrides.onDocumentLeaving,
      focusPane: vi.fn(),
      loadRecentNotes:
        overrides.loadRecentNotes ??
        vi.fn(async () => undefined),
      ensureLocationMruSeeded: vi.fn(async () => undefined),
      transitions: pipeline
    } as never);

  return {
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
          noteKey: 'path:/vault/note.md',
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
});

describe('workspace pane creation lifecycle', () => {
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
      notes.right.key,
      'split',
      'right'
    );
  });
});

describe('workspace pane document ownership', () => {
  it('identifies the exact pane whose editor is leaving for chat', async () => {
    const onDocumentLeaving = vi.fn();
    const { controller } = harness({ onDocumentLeaving });

    await controller.setPaneKind('right', 'chat');

    expect(onDocumentLeaving).toHaveBeenCalledOnce();
    expect(onDocumentLeaving).toHaveBeenCalledWith(
      'right',
      expect.objectContaining({
        key: 'path:/vault/note.md'
      })
    );
  });
});
