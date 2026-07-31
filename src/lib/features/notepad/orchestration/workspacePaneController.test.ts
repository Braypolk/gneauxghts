import { describe, expect, it, vi } from 'vitest';
import {
  createNoteDraftState
} from '$lib/features/notepad/state/noteStore';
import { createEmptySessionSnapshot } from '$lib/features/notepad/session/session';
import { createPaneNavigationTransitionPipeline } from './paneNavigationTransitionPipeline';
import { createWorkspacePaneController } from './workspacePaneController';

type PaneId = 'left' | 'right';

function document() {
  return createNoteDraftState({
    ...createEmptySessionSnapshot(),
    title: 'Note',
    currentNoteId: 'note',
    currentNotePath: '/vault/note.md',
    lastSavedTitle: 'Note',
    lastSavedNoteId: 'note',
    lastSavedPath: '/vault/note.md'
  });
}

function harness(
  overrides: {
    preparePaneClose?: () => Promise<void>;
    disposePaneRuntime?: () => Promise<void>;
    removeWorkspacePane?: () => unknown;
    finalizeWorkspacePaneRemoval?: () => void;
    onDocumentLeaving?: (
      paneId: PaneId,
      note: ReturnType<typeof document>
    ) => void;
  } = {}
) {
  const note = document();
  const removeWorkspacePane =
    overrides.removeWorkspacePane ??
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
  const controller =
    createWorkspacePaneController<PaneId>({
      getPaneOrder: () => ['left', 'right'],
      canRemoveWorkspacePane: () => true,
      getPaneDocument: () => note,
      getPaneKind: () => 'editor',
      getPaneConversationId: () => null,
      setStoredPaneKind: vi.fn(() => true),
      capturePaneLocation: () => null,
      getPaneCommandPaneId: () => null,
      preparePaneClose:
        overrides.preparePaneClose ??
        vi.fn(async () => undefined),
      disposePaneRuntime,
      removeWorkspacePane,
      finalizeWorkspacePaneRemoval:
        overrides.finalizeWorkspacePaneRemoval ??
        vi.fn(),
      getActivePaneId: () => 'right',
      adoptClosedLocation: vi.fn(),
      activatePaneSession: vi.fn(),
      updateSelectedRelatedText: vi.fn(),
      touchCurrentLocation: vi.fn(),
      touchLocation: vi.fn(),
      bumpLocationHistoryEpoch: vi.fn(),
      onDocumentLeaving: overrides.onDocumentLeaving,
      focusPane: vi.fn(),
      transitions: pipeline
    } as never);

  return {
    controller,
    removeWorkspacePane,
    disposePaneRuntime
  };
}

describe('workspace pane close lifecycle', () => {
  it('does not remove the pane when close preparation fails', async () => {
    const failure = new Error('save failed');
    const preparePaneClose = vi.fn(async () => {
      throw failure;
    });
    const { controller, removeWorkspacePane, disposePaneRuntime } =
      harness({ preparePaneClose });

    await expect(controller.closePane('left')).rejects.toBe(
      failure
    );
    expect(removeWorkspacePane).not.toHaveBeenCalled();
    expect(disposePaneRuntime).not.toHaveBeenCalled();
  });

  it('prepares, removes, tears down, then releases retired pane state', async () => {
    const events: string[] = [];
    const { controller } = harness({
      preparePaneClose: vi.fn(async () => {
        events.push('prepare');
      }),
      removeWorkspacePane: vi.fn(() => {
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
      finalizeWorkspacePaneRemoval: vi.fn(() => {
        events.push('finalize');
      })
    });

    await controller.closePane('left');

    expect(events).toEqual([
      'prepare',
      'remove',
      'dispose',
      'finalize'
    ]);
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
