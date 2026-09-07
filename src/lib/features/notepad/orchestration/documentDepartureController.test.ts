import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createEmptySessionSnapshot
} from '$lib/features/notepad/session/session';
import {
  createNoteDraftState
} from '$lib/features/notepad/state/noteStore';
import {
  loadEditorViewState,
  saveEditorViewState
} from '$lib/features/notepad/editor/editorViewState';
import { createDocumentDepartureController } from './documentDepartureController';

describe('document departure controller', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('persists before saving the cursor against the authoritative document', async () => {
    const storage = new Map<string, string>();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => {
          storage.set(key, value);
        }
      }
    });
    const draft = createNoteDraftState({
      ...createEmptySessionSnapshot(),
      title: 'Draft',
      bodyMarkdown: 'Body'
    });
    const saved = createNoteDraftState({
      ...createEmptySessionSnapshot(),
      title: 'Draft',
      bodyMarkdown: 'Body',
      lastSavedMarkdown: 'Body',
      lastSavedTitle: 'Draft',
      lastSavedNoteId: 'note-1',
      lastSavedPath: '/vault/Draft.md',
      currentNoteId: 'note-1',
      currentNotePath: '/vault/Draft.md'
    });
    const events: string[] = [];
    let paneDocument = draft;
    const controller = createDocumentDepartureController({
      hasOtherEditingPane: () => false,
      finalizeWindow: async () => { events.push('finalize-window'); },
      getPaneDocument: () => paneDocument,
      flushAllPendingCursorSaves: () => {
        events.push('flush-cursor');
      },
      cancelPendingAutosave: () => {
        events.push('cancel-autosave');
      },
      getNoteSaveQueue: async () => {
        events.push('await-save-queue');
      },
      enqueueSave: async () => {
        events.push('persist');
        paneDocument = saved;
      },
      saveCursorPositionForPane: async (paneId, document) => {
        expect(paneId).toBe('pane-1');
        expect(document).toBe(saved);
        if (document.identity.kind !== 'persisted') {
          throw new Error('Expected a persisted identity');
        }
        saveEditorViewState(
          document.identity.path,
          { anchor: 9, head: 9 },
          'pane-1',
          document.identity.noteId
        );
        events.push('save-authoritative-cursor');
      },
      clearLastOpenedNote: async () => {
        events.push('clear-last-opened');
      }
    });

    await expect(
      controller.prepare('pane-1', draft, {
        clearLastOpened: true
      })
    ).resolves.toBe(saved);
    expect(events).toEqual([
      'flush-cursor',
      'cancel-autosave',
      'await-save-queue',
      'persist',
      'finalize-window',
      'save-authoritative-cursor',
      'clear-last-opened'
    ]);
    expect(
      loadEditorViewState(
        '/vault/Draft.md',
        'pane-1',
        'note-1'
      )
    ).toEqual({ anchor: 9, head: 9 });
  });
  it('keeps a shared window while another editor remains, then seals on the last departure', async () => {
    const document = createNoteDraftState({ ...createEmptySessionSnapshot(), currentNoteId: 'shared', currentNotePath: '/vault/shared.md', lastSavedNoteId: 'shared', lastSavedPath: '/vault/shared.md' });
    const panes = new Set(['left', 'right']);
    const finalizeWindow = vi.fn().mockResolvedValue(undefined);
    const controller = createDocumentDepartureController({
      getPaneDocument: () => document,
      hasOtherEditingPane: paneId => [...panes].some(id => id !== paneId),
      finalizeWindow,
      flushAllPendingCursorSaves: vi.fn(), cancelPendingAutosave: vi.fn(),
      enqueueSave: vi.fn().mockResolvedValue(undefined), getNoteSaveQueue: vi.fn().mockResolvedValue(undefined),
      saveCursorPositionForPane: vi.fn(), clearLastOpenedNote: vi.fn().mockResolvedValue(undefined)
    });
    await controller.prepare('left', document);
    expect(finalizeWindow).not.toHaveBeenCalled();
    panes.delete('left');
    await controller.prepare('right', document);
    expect(finalizeWindow).toHaveBeenCalledExactlyOnceWith(document);
  });

  it('refuses departure after a failed seal and leaves cursor and workspace state untouched', async () => {
    const document = createNoteDraftState();
    const saveCursorPositionForPane = vi.fn();
    const clearLastOpenedNote = vi.fn();
    const controller = createDocumentDepartureController({
      getPaneDocument: () => document, hasOtherEditingPane: () => false,
      finalizeWindow: vi.fn().mockRejectedValue(new Error('seal failed')),
      flushAllPendingCursorSaves: vi.fn(), cancelPendingAutosave: vi.fn(),
      enqueueSave: vi.fn().mockResolvedValue(undefined), getNoteSaveQueue: vi.fn().mockResolvedValue(undefined),
      saveCursorPositionForPane, clearLastOpenedNote
    });
    await expect(controller.prepare('left', document, { clearLastOpened: true })).rejects.toThrow('seal failed');
    expect(saveCursorPositionForPane).not.toHaveBeenCalled();
    expect(clearLastOpenedNote).not.toHaveBeenCalled();
  });

  it('lets a clean collision participant depart without attempting a canonical write', async () => {
    const document = createNoteDraftState({
      ...createEmptySessionSnapshot(),
      title: 'Clean',
      bodyMarkdown: 'baseline',
      currentNoteId: 'clean-id',
      currentNotePath: '/vault/Shared.md',
      lastSavedTitle: 'Clean',
      lastSavedMarkdown: 'baseline',
      lastSavedNoteId: 'clean-id',
      lastSavedPath: '/vault/Shared.md'
    });
    document.canonicalCollision = {
      otherHandle: 'document:other',
      noteId: null,
      path: '/vault/Shared.md'
    };
    const cancelPendingAutosave = vi.fn();
    let releaseQueue!: () => void;
    const pendingQueue = new Promise<void>((resolve) => {
      releaseQueue = resolve;
    });
    const getNoteSaveQueue = vi.fn(() => pendingQueue);
    const enqueueSave = vi.fn().mockResolvedValue(undefined);
    const saveCursorPositionForPane = vi.fn();
    const controller = createDocumentDepartureController({
      getPaneDocument: () => document,
      hasOtherEditingPane: () => false,
      finalizeWindow: vi.fn().mockResolvedValue(undefined),
      flushAllPendingCursorSaves: vi.fn(),
      cancelPendingAutosave,
      enqueueSave,
      getNoteSaveQueue,
      saveCursorPositionForPane,
      clearLastOpenedNote: vi.fn().mockResolvedValue(undefined)
    });

    const preparation = controller.prepare('left', document);

    await vi.waitFor(() => {
      expect(getNoteSaveQueue).toHaveBeenCalledExactlyOnceWith(document.handle);
    });
    expect(enqueueSave).not.toHaveBeenCalled();
    expect(saveCursorPositionForPane).not.toHaveBeenCalled();

    releaseQueue();
    await expect(preparation).resolves.toBe(document);

    expect(cancelPendingAutosave).toHaveBeenCalledExactlyOnceWith(document);
    expect(enqueueSave).not.toHaveBeenCalled();
    expect(saveCursorPositionForPane).toHaveBeenCalledWith('left', document);
  });

});

// Both requests must inspect membership after the preceding departure mutates it.
describe('concurrent workspace departures', () => {
  it.each([false, true])('serializes shared departures and preserves a failed first departure (%s)', async failFirst => {
    const { createPaneNavigationTransitionPipeline } = await import('./paneNavigationTransitionPipeline');
    const document = createNoteDraftState();
    const panes = new Set(['left', 'right']);
    let finishCursor!: () => void;
    const cursor = new Promise<void>(resolve => { finishCursor = resolve; });
    let shouldFail = failFirst;
    const saveCursor = vi.fn(async (paneId: string) => {
      if (paneId === 'left') {
        await cursor;
        if (shouldFail) { shouldFail = false; throw new Error('cursor failed'); }
      }
    });
    const finalizeWindow = vi.fn().mockResolvedValue(undefined);
    const controller = createDocumentDepartureController({
      getPaneDocument: () => document,
      hasOtherEditingPane: paneId => [...panes].some(id => id !== paneId),
      finalizeWindow,
      flushAllPendingCursorSaves: vi.fn(), cancelPendingAutosave: vi.fn(),
      enqueueSave: vi.fn().mockResolvedValue(undefined), getNoteSaveQueue: vi.fn().mockResolvedValue(undefined),
      saveCursorPositionForPane: saveCursor, clearLastOpenedNote: vi.fn().mockResolvedValue(undefined)
    });
    const transitions = createPaneNavigationTransitionPipeline<string>({
      assertWorkspaceInvariants: vi.fn(), ensurePaneEditors: vi.fn().mockResolvedValue(undefined)
    });
    const depart = (paneId: string) => transitions.execute({
      kind: 'change-pane-kind', resolvePane: () => paneId,
      departDocument: async () => { await controller.prepare(paneId, document); },
      mutateWorkspace: () => { panes.delete(paneId); }
    });
    const left = depart('left');
    await vi.waitFor(() => expect(saveCursor).toHaveBeenCalledOnce());
    const right = depart('right');
    await Promise.resolve();
    expect(finalizeWindow).not.toHaveBeenCalled();
    finishCursor();
    expect((await left).status).toBe(failFirst ? 'failed' : 'applied');
    expect((await right).status).toBe('applied');
    if (failFirst) {
      expect([...panes]).toEqual(['left']);
      expect(finalizeWindow).not.toHaveBeenCalled();
      expect((await depart('left')).status).toBe('applied');
    }
    expect(panes.size).toBe(0);
    expect(finalizeWindow).toHaveBeenCalledExactlyOnceWith(document);
  });

  it('does save-only preliminary capture, but seals actual departure even when already saved', async () => {
    const document = createNoteDraftState();
    const finalizeWindow = vi.fn().mockResolvedValue(undefined);
    const enqueueSave = vi.fn().mockResolvedValue(undefined);
    const controller = createDocumentDepartureController({
      getPaneDocument: () => document, hasOtherEditingPane: () => false, finalizeWindow,
      flushAllPendingCursorSaves: vi.fn(), cancelPendingAutosave: vi.fn(), enqueueSave,
      getNoteSaveQueue: vi.fn().mockResolvedValue(undefined),
      saveCursorPositionForPane: vi.fn(), clearLastOpenedNote: vi.fn().mockResolvedValue(undefined)
    });
    await controller.prepare('left', document, { finalize: false });
    expect(finalizeWindow).not.toHaveBeenCalled();
    await controller.prepare('left', document, { persist: false });
    expect(enqueueSave).toHaveBeenCalledOnce();
    expect(finalizeWindow).toHaveBeenCalledExactlyOnceWith(document);
    document.working.markdown = 'newer unsaved text';
    await expect(controller.prepare('left', document, { persist: false })).rejects.toThrow('could not be saved');
    expect(finalizeWindow).toHaveBeenCalledOnce();
  });
});
