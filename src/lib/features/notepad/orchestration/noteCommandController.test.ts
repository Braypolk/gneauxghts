import { describe, expect, it, vi } from 'vitest';
import {
  createNoteDraftState,
  createNotepadState,
  type NoteKey
} from '$lib/features/notepad/state/noteStore';
import {
  applySessionSnapshotToDocument
} from '$lib/features/notepad/document/documentState';
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

  it('queues target content binding even while editor readiness is still false', async () => {
    const previous = createNoteDraftState(
      persistedSnapshot(
        'previous',
        '/vault/previous.md',
        'previous content'
      )
    );
    const nextSnapshot = persistedSnapshot(
      'next',
      '/vault/next.md',
      'next content'
    );
    const state = createNotepadState<PaneId>(previous);
    let paneNoteKey: NoteKey = previous.key;
    let openGeneration = 0;
    const runtime = {
      ui: { isEditorReady: false },
      bumpOpenRequestGeneration: () => {
        openGeneration += 1;
        return openGeneration;
      },
      getOpenRequestGeneration: () => openGeneration
    };
    const replacePaneDocument = vi.fn(
      async () => undefined
    );
    vi.mocked(openNoteSession).mockResolvedValueOnce(
      nextSnapshot
    );
    const transitions =
      createPaneNavigationTransitionPipeline<PaneId>({
        assertWorkspaceInvariants: vi.fn(),
        ensurePaneEditors: vi.fn(async () => undefined)
      });
    const controller =
      createNoteCommandController<PaneId>({
        base: {
          state,
          workspace: {
            getActivePaneId: () => 'left',
            resetPaneCommand: vi.fn(),
            getPaneState: () => ({
              noteKey: paneNoteKey
            }),
            setPaneNoteKey: (
              _paneId: PaneId,
              noteKey: NoteKey
            ) => {
              paneNoteKey = noteKey;
            },
            isNoteReferenced: (noteKey: NoteKey) =>
              paneNoteKey === noteKey,
            setPaneKind: vi.fn(() => true)
          },
          panes: {
            getPaneDocument: () =>
              state.notesByKey[paneNoteKey],
            getPaneKind: () => 'editor',
            getPaneRuntime: () => runtime,
            closeWikilinkAutocomplete: vi.fn(),
            updateSelectedRelatedText: vi.fn(),
            getNoteByKey: (noteKey: NoteKey) =>
              state.notesByKey[noteKey] ?? null
          },
          persistence: {
            cancelPendingAutosave: vi.fn(),
            enqueueSave: vi.fn(async () => undefined)
          },
          derivedViews: {
            setRecentlyForgotten: vi.fn(),
            clearSelectedRelatedText: vi.fn(),
            scheduleRelatedIfNeeded: vi.fn()
          },
          documents: {
            flushAllPendingCursorSaves: vi.fn(),
            saveCursorPositionForDocument: vi.fn(),
            replacePaneDocument
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
        bumpLocationHistoryEpoch: vi.fn(),
        transitions
      } as never);

    await controller.openNotePath('/vault/next.md', {
      noteId: 'next',
      currentNoteAlreadySaved: true,
      focusEditorAfterOpen: false
    });

    const nextDocument = state.notesByKey[paneNoteKey];
    expect(nextDocument.working.markdown).toBe(
      'next content'
    );
    expect(replacePaneDocument).toHaveBeenCalledWith(
      'left',
      previous,
      nextDocument,
      { restoreCursor: true }
    );
  });
});

describe('app-owned proposal commit acknowledgement', () => {
  it('advances the saved baseline without creating an external conflict', async () => {
    const before = persistedSnapshot(
      'plan',
      '/vault/Plan.md',
      'Before'
    );
    const committed = persistedSnapshot(
      'plan',
      '/vault/Plan.md',
      'After'
    );
    const document = createNoteDraftState(before);
    document.working.markdown = 'After';
    document.externalSync = { kind: 'dirty' };
    vi.mocked(readNoteSession).mockResolvedValueOnce(
      committed
    );
    const replaceNoteAcrossPanes = vi.fn(
      async () => undefined
    );
    const applySnapshot = vi.fn(
      async (
        target: typeof document,
        snapshot: SessionSnapshot,
        applyMarkdown: () => Promise<void>,
        options: { preserveDraft?: boolean } = {}
      ) => {
        const result = applySessionSnapshotToDocument(
          target,
          snapshot,
          {
            preserveWorking:
              options.preserveDraft ?? false
          }
        );
        if (result.markdownChanged) {
          await applyMarkdown();
        }
        return result;
      }
    );
    const controller =
      createNoteCommandController<PaneId>({
        base: {
          persistence: {
            cancelPendingAutosave: vi.fn(),
            invalidatePendingSaveResults: vi.fn()
          },
          derivedViews: {
            setRecentlyForgotten: vi.fn(),
            clearSelectedRelatedText: vi.fn(),
            scheduleRelatedIfNeeded: vi.fn()
          },
          documents: {
            replaceNoteAcrossPanes
          },
          documentEditing: {
            applySnapshot
          }
        }
      } as never);

    await controller.acknowledgeDocumentCommit({
      document,
      path: '/vault/Plan.md',
      markdown: 'After'
    });

    expect(document.savedBaseline?.content.markdown).toBe(
      'After'
    );
    expect(document.working.markdown).toBe('After');
    expect(document.externalSync).toEqual({
      kind: 'inSync'
    });
    expect(applySnapshot).toHaveBeenCalledWith(
      document,
      committed,
      expect.any(Function),
      {
        preserveDraft: false,
        autosave: false
      }
    );
  });
});
