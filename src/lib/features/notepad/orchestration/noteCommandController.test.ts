import { describe, expect, it, vi } from 'vitest';
import {
  createNoteDraftState
} from '$lib/features/notepad/state/noteStore';
import {
  createEmptySessionSnapshot,
  openNoteSession,
  readNoteSession,
  type SessionSnapshot
} from '$lib/features/notepad/session/session';
import { createNoteCommandController } from './noteCommandController';
import { createPaneNavigationTransitionPipeline } from './paneNavigationTransitionPipeline';

vi.mock(
  '$lib/features/notepad/session/session',
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import('$lib/features/notepad/session/session')
      >();
    return {
      ...actual,
      openNoteSession: vi.fn(actual.openNoteSession),
      readNoteSession: vi.fn()
    };
  }
);

type PaneId = 'left' | 'right';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function persistedSnapshot(
  noteId: string,
  path: string,
  markdown: string
): SessionSnapshot {
  return {
    ...createEmptySessionSnapshot(),
    title: noteId,
    bodyMarkdown: markdown,
    currentNoteId: noteId,
    currentNotePath: path,
    lastSavedTitle: noteId,
    lastSavedMarkdown: markdown,
    lastSavedNoteId: noteId,
    lastSavedPath: path
  };
}

describe('note command refresh concurrency', () => {
  it('allows different loaded documents to refresh simultaneously', async () => {
    const leftSnapshot = persistedSnapshot(
      'left-note',
      '/vault/left.md',
      'left'
    );
    const rightSnapshot = persistedSnapshot(
      'right-note',
      '/vault/right.md',
      'right'
    );
    const left = createNoteDraftState(leftSnapshot);
    const right = createNoteDraftState(rightSnapshot);
    const leftRead = deferred<SessionSnapshot>();
    const rightRead = deferred<SessionSnapshot>();
    vi.mocked(readNoteSession).mockImplementation(
      async (_noteId, path) => {
        if (path === '/vault/left.md') {
          return leftRead.promise;
        }
        return rightRead.promise;
      }
    );
    const applySnapshot = vi.fn(async () => undefined);
    const controller =
      createNoteCommandController<PaneId>({
        base: {
          persistence: {
            hasCleanBuffer: () => true,
            cancelPendingAutosave: vi.fn(),
            invalidatePendingSaveResults: vi.fn()
          },
          derivedViews: {
            setRecentlyForgotten: vi.fn(),
            clearSelectedRelatedText: vi.fn()
          },
          documents: {
            replaceNoteAcrossPanes: vi.fn(
              async () => undefined
            )
          },
          documentEditing: { applySnapshot }
        },
        transitions: {}
      } as never);

    const leftRefresh =
      controller.refreshDocumentFromDisk(left, {
        source: 'watcher'
      });
    const rightRefresh =
      controller.refreshDocumentFromDisk(right, {
        source: 'watcher'
      });

    expect(readNoteSession).toHaveBeenCalledTimes(2);
    leftRead.resolve({
      ...leftSnapshot,
      bodyMarkdown: 'left changed',
      lastSavedMarkdown: 'left changed'
    });
    rightRead.resolve({
      ...rightSnapshot,
      bodyMarkdown: 'right changed',
      lastSavedMarkdown: 'right changed'
    });

    await expect(leftRefresh).resolves.toBe('refreshed');
    await expect(rightRefresh).resolves.toBe('refreshed');
    expect(applySnapshot).toHaveBeenCalledTimes(2);
  });

  it('coalesces duplicate refreshes into one guaranteed trailing reread', async () => {
    const boundary = persistedSnapshot(
      'note',
      '/vault/note.md',
      'saved'
    );
    const note = createNoteDraftState(boundary);
    vi.mocked(readNoteSession).mockClear();
    const firstRead = deferred<SessionSnapshot>();
    const trailingRead = deferred<SessionSnapshot>();
    vi.mocked(readNoteSession)
      .mockReturnValueOnce(firstRead.promise)
      .mockReturnValueOnce(trailingRead.promise);
    const applySnapshot = vi.fn(async () => undefined);
    const controller =
      createNoteCommandController<PaneId>({
        base: {
          persistence: {
            hasCleanBuffer: () => true,
            cancelPendingAutosave: vi.fn(),
            invalidatePendingSaveResults: vi.fn()
          },
          derivedViews: {
            setRecentlyForgotten: vi.fn(),
            clearSelectedRelatedText: vi.fn()
          },
          documents: {
            replaceNoteAcrossPanes: vi.fn(
              async () => undefined
            )
          },
          documentEditing: {
            applySnapshot
          }
        },
        transitions: {}
      } as never);

    const first = controller.refreshDocumentFromDisk(note);
    const duplicate =
      controller.refreshDocumentFromDisk(note, {
        source: 'watcher'
      });
    expect(duplicate).toBe(first);
    expect(readNoteSession).toHaveBeenCalledOnce();

    firstRead.resolve(boundary);
    await vi.waitFor(() => {
      expect(readNoteSession).toHaveBeenCalledTimes(2);
    });
    trailingRead.resolve({
      ...boundary,
      bodyMarkdown: 'changed after first read',
      lastSavedMarkdown: 'changed after first read'
    });

    await expect(first).resolves.toBe('refreshed');
    await expect(duplicate).resolves.toBe('refreshed');
    expect(applySnapshot).toHaveBeenCalledOnce();
  });
});

describe('open-note persistence barrier', () => {
  it('does not load or mutate the target when saving the previous document fails', async () => {
    const previous = createNoteDraftState(
      persistedSnapshot(
        'previous',
        '/vault/previous.md',
        'unsaved'
      )
    );
    const saveFailure = new Error('save failed');
    const enqueueSave = vi.fn(async () => {
      throw saveFailure;
    });
    const resetPaneCommand = vi.fn();
    vi.mocked(openNoteSession).mockClear();
    const transitions =
      createPaneNavigationTransitionPipeline<PaneId>({
        assertWorkspaceInvariants: vi.fn(),
        ensurePaneEditors: vi.fn(async () => undefined)
      });
    const controller =
      createNoteCommandController<PaneId>({
        base: {
          state: {},
          workspace: {
            getActivePaneId: () => 'left',
            resetPaneCommand
          },
          panes: {
            getPaneDocument: () => previous,
            getPaneKind: () => 'editor'
          },
          persistence: {
            cancelPendingAutosave: vi.fn(),
            enqueueSave
          },
          derivedViews: {},
          documents: {
            flushAllPendingCursorSaves: vi.fn(),
            saveCursorPositionForDocument: vi.fn()
          },
          paneLifecycle: {}
        },
        blurFocusedPaneTitle: vi.fn(),
        capturePaneLocation: () => ({
          kind: 'editor',
          noteId: 'previous',
          notePath: '/vault/previous.md'
        }),
        touchLocation: vi.fn(),
        isLocationTouchSuppressed: () => false,
        transitions
      } as never);

    await expect(
      controller.openNotePath('/vault/next.md', {
        noteId: 'next'
      })
    ).rejects.toBe(saveFailure);

    expect(enqueueSave).toHaveBeenCalledWith(previous);
    expect(openNoteSession).not.toHaveBeenCalled();
    expect(resetPaneCommand).toHaveBeenCalledOnce();
  });
});
