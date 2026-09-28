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
import type {
  PaneKind
} from '$lib/features/notepad/workspace/paneTypes';
import {
  createPaneNavigationTransitionPipeline
} from './paneNavigationTransitionPipeline';
import { createLocationHistoryController, type LocationHistoryControllerDeps } from './locationHistoryController';
import type { SearchItem } from '$lib/types/semantic';

const paneId = 'pane-1';
const otherPaneId = 'pane-2';

function editorLocation(
  noteId: string,
  notePath: string
): Extract<NavLocation, { kind: 'editor' }> {
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

function setup(
  paneOrder: string[] = [paneId],
  options: { loadRecentNotes?: () => Promise<SearchItem[] | null>; seedInitially?: boolean } = {}
) {
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
    'document:location-history'
  );
  const openNotePath = vi.fn<LocationHistoryControllerDeps<string>['openNotePath']>(async () => undefined);
  const setPaneConversationId = vi.fn();
  const setPaneKind = vi.fn(
    async (targetPaneId: string, kind: PaneKind) => {
      kinds.set(targetPaneId, kind);
      return;
    }
  );
  const ensurePaneEditors = vi.fn(async () => undefined);
  const focusPaneAfterShortcut = vi.fn(
    async () => undefined
  );
  const transitions = createPaneNavigationTransitionPipeline<string>({
    assertWorkspaceInvariants: vi.fn(), ensurePaneEditors
  });
  const documentDeparture = { prepare: vi.fn(async () => document) };
  const controller = createLocationHistoryController({
    getActivePaneId: () => paneId,
    getPaneOrder: () => paneOrder,
    getPaneState: (targetPaneId) => ({
      paneId: targetPaneId,
      kind: kinds.get(targetPaneId) ?? 'editor',
      documentHandle: document.handle,
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
    loadRecentNotes: options.loadRecentNotes ?? vi.fn(async () => []),
    openNotePath,
    paneLifecycle: {} as never,
    updateSelectedRelatedText: vi.fn(),
    focusPaneAfterShortcut,
    documentDeparture,
    transitions
  });
  if (options.seedInitially !== false) notepadLocationMru.seedMissing(paneId, []);
  return {
    controller,
    transitions,
    documentDeparture,
    document,
    kinds,
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

  it('retries saved recent notes after a failed startup request', async () => {
    const loadRecentNotes = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce([{
        noteId: 'note-b', notePath: '/vault/B.md'
      } as SearchItem]);
    const { controller } = setup([paneId], {
      loadRecentNotes,
      seedInitially: false
    });

    expect(await controller.listLocationHistory()).toEqual([]);
    expect(await controller.listLocationHistory()).toEqual([{
      location: editorLocation('note-b', '/vault/B.md'),
      label: 'B'
    }]);
    expect(loadRecentNotes).toHaveBeenCalledTimes(2);
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

  it('drops a missing previous note and restores the next location', async () => {
    const harness = setup();
    const fallback = editorLocation('note-b', '/vault/B.md');
    const missing = editorLocation('missing', '/vault/Missing.md');
    notepadLocationMru.touch(paneId, fallback);
    notepadLocationMru.touch(paneId, missing);
    harness.openNotePath
      .mockRejectedValueOnce(new Error('Missing note path'))
      .mockResolvedValueOnce(undefined);

    await harness.controller.goToPreviousLocation();

    expect(harness.openNotePath).toHaveBeenNthCalledWith(
      1,
      missing.notePath,
      expect.objectContaining({ noteId: missing.noteId })
    );
    expect(harness.openNotePath).toHaveBeenNthCalledWith(
      2,
      fallback.notePath,
      expect.objectContaining({ noteId: fallback.noteId })
    );
    expect(notepadLocationMru.list(paneId)).not.toContainEqual(
      missing
    );
  });
});


describe('nested restoration departure ownership', () => {
  beforeEach(() => { notepadLocationMru.clearAll(); });

  it('awaits the pane-kind leaf and preserves the conversation when finalization fails', async () => {
    const harness = setup();
    const finalize = vi.fn().mockRejectedValueOnce(new Error('seal failed')).mockResolvedValue(undefined);
    harness.setPaneKind.mockImplementation(async (id, kind) => {
      const result = await harness.transitions.execute({
        kind: 'change-pane-kind', resolvePane: () => id,
        departDocument: finalize,
        mutateWorkspace: () => { harness.kinds.set(id, kind); }
      });
      if (result.status === 'failed') throw result.error;
    });
    await expect(harness.controller.restoreLocation(paneId, chatLocation())).rejects.toThrow('seal failed');
    expect(harness.kinds.get(paneId)).toBe('editor');
    expect(harness.setPaneConversationId).not.toHaveBeenCalled();
    expect(harness.controller.isTouchSuppressed()).toBe(false);
    await harness.controller.restoreLocation(paneId, chatLocation());
    expect(finalize).toHaveBeenCalledTimes(2);
    expect(harness.setPaneConversationId).toHaveBeenCalledExactlyOnceWith(paneId, 'chat-1');
  });

  it('lets a nested open-note acquire the departure queue and recover after a failed load', async () => {
    const harness = setup();
    const finalization = vi.fn();
    const load = vi.fn().mockRejectedValueOnce(new Error('Missing note path')).mockResolvedValue(undefined);
    harness.openNotePath.mockImplementation(async () => {
      const result = await harness.transitions.execute({
        kind: 'open-note', resolvePane: () => paneId, departDocument: finalization,
        prepare: load
      });
      if (result.status === 'failed') throw result.error;
    });
    notepadLocationMru.touch(paneId, editorLocation('note-b', '/vault/B.md'));
    notepadLocationMru.touch(paneId, editorLocation('missing', '/vault/Missing.md'));
    await harness.controller.goToPreviousLocation();
    expect(finalization).toHaveBeenCalledTimes(2);
    expect(load).toHaveBeenCalledTimes(2);
    expect(harness.controller.isTouchSuppressed()).toBe(false);
  });
});
