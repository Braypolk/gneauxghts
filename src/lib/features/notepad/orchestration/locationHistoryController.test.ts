import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDocumentState
} from '$lib/features/notepad/document/documentState';
import {
  notepadLocationMru,
  type NavLocation
} from '$lib/features/notepad/navigation/locationMru';
import {
  createEmptySessionSnapshot
} from '$lib/features/notepad/session/session';
import {
  noteKeyFromPath
} from '$lib/features/notepad/state/noteStore';
import type {
  PaneKind
} from '$lib/features/notepad/workspace/paneTypes';
import {
  createPaneNavigationTransitionPipeline
} from './paneNavigationTransitionPipeline';
import { createLocationHistoryController } from './locationHistoryController';

const paneId = 'pane-1';
const otherPaneId = 'pane-2';

function editorLocation(
  noteId: string,
  notePath: string
): NavLocation {
  return {
    kind: 'editor',
    noteId,
    notePath
  };
}

function chatLocation(): NavLocation {
  return {
    kind: 'chat',
    conversationId: 'chat-1',
    contextNoteId: 'note-a',
    contextNotePath: '/vault/A.md'
  };
}

function setup(paneOrder: string[] = [paneId]) {
  const kinds = new Map<string, PaneKind>(
    paneOrder.map((id) => [id, 'editor'])
  );
  const currentSnapshot = {
    ...createEmptySessionSnapshot(),
    title: 'A',
    currentNoteId: 'note-a',
    currentNotePath: '/vault/A.md',
    lastSavedTitle: 'A',
    lastSavedNoteId: 'note-a',
    lastSavedPath: '/vault/A.md'
  };
  const document = createDocumentState(
    currentSnapshot,
    noteKeyFromPath('/vault/A.md')!
  );
  const openNotePath = vi.fn(async () => undefined);
  const setPaneConversationId = vi.fn();
  const setPaneKind = vi.fn(
    (targetPaneId: string, kind: PaneKind) => {
      kinds.set(targetPaneId, kind);
      return true;
    }
  );
  const ensurePaneEditors = vi.fn(async () => undefined);
  const focusPaneAfterShortcut = vi.fn(
    async () => undefined
  );
  const controller = createLocationHistoryController({
    getActivePaneId: () => paneId,
    getPaneOrder: () => paneOrder,
    getPaneState: (targetPaneId) => ({
      paneId: targetPaneId,
      kind: kinds.get(targetPaneId) ?? 'editor',
      noteKey: document.key,
      chatConversationId: null
    }),
    getPaneKind: (targetPaneId) =>
      kinds.get(targetPaneId) ?? 'editor',
    setPaneConversationId,
    getPaneDocument: () => document,
    getPaneCommandMode: () => 'start',
    getPaneCommandSourcePaneId: () => null,
    getPaneTitleInput: () => null,
    activatePaneSession: vi.fn(),
    setPaneKind,
    saveCursorPosition: vi.fn(),
    cancelPendingAutosave: vi.fn(),
    enqueueSave: vi.fn(async () => undefined),
    loadRecentNotes: vi.fn(async () => []),
    openNotePath,
    paneLifecycle: {} as never,
    updateSelectedRelatedText: vi.fn(),
    focusPaneAfterShortcut,
    transitions: createPaneNavigationTransitionPipeline({
      assertWorkspaceInvariants: vi.fn(),
      ensurePaneEditors
    })
  });
  notepadLocationMru.seedMissing(paneId, []);
  return {
    controller,
    openNotePath,
    setPaneConversationId,
    setPaneKind,
    ensurePaneEditors,
    focusPaneAfterShortcut
  };
}

describe('location history workspace invariants', () => {
  beforeEach(() => {
    notepadLocationMru.clearAll();
  });

  it('restores chat as the previous location in a single-pane workspace', async () => {
    const harness = setup();
    notepadLocationMru.touch(paneId, chatLocation());

    await harness.controller.goToPreviousLocation();

    expect(harness.setPaneKind).toHaveBeenCalledWith(
      paneId,
      'chat'
    );
    expect(
      harness.setPaneConversationId
    ).toHaveBeenCalledWith(paneId, 'chat-1');
    expect(harness.openNotePath).not.toHaveBeenCalled();
  });

  it('can explicitly restore chat in a single-pane workspace', async () => {
    const harness = setup();

    await expect(
      harness.controller.restoreLocation(
        paneId,
        chatLocation()
      )
    ).resolves.toBeUndefined();

    expect(harness.setPaneKind).toHaveBeenCalledWith(
      paneId,
      'chat'
    );
    expect(
      harness.setPaneConversationId
    ).toHaveBeenCalledWith(paneId, 'chat-1');
  });

  it('keeps chat as the previous location when another editor remains', async () => {
    const harness = setup([paneId, otherPaneId]);
    notepadLocationMru.touch(paneId, chatLocation());

    await harness.controller.goToPreviousLocation();

    expect(harness.setPaneKind).toHaveBeenCalledWith(
      paneId,
      'chat'
    );
    expect(
      harness.setPaneConversationId
    ).toHaveBeenCalledWith(paneId, 'chat-1');
    expect(
      harness.ensurePaneEditors
    ).toHaveBeenCalledOnce();
    expect(
      harness.focusPaneAfterShortcut
    ).toHaveBeenCalledWith(paneId);
  });
});
