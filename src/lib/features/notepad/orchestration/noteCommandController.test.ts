import { describe, expect, it, vi } from 'vitest';
import {
  createNoteDraftState,
  createNotepadState,
  type NoteKey
} from '$lib/features/notepad/state/noteStore';
import {
  applySessionSnapshotToDocument,
  updateDocumentMarkdown
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
    const enqueueSave = vi.fn(async (_document?: typeof previous) => {
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
        documentDeparture: {
          prepare: async () => {
            await enqueueSave(previous);
            return previous;
          }
        },
        transitions
      } as never);

    await expect(
      controller.openNotePath('/vault/next.md', {
        noteId: 'next'
      })
    ).rejects.toBe(saveFailure);

    expect(enqueueSave).toHaveBeenCalledWith(previous);
    expect(openNoteSession).not.toHaveBeenCalled();
    expect(resetPaneCommand).not.toHaveBeenCalled();
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
    const runtime = {
      ui: { isEditorReady: false }
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
        documentDeparture: {
          prepare: vi.fn(async () => previous)
        },
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

  it('allows two panes sharing a document to open independently', async () => {
    const shared = createNoteDraftState(
      persistedSnapshot(
        'shared',
        '/vault/shared.md',
        'shared content'
      )
    );
    const state = createNotepadState<PaneId>(shared);
    const paneNoteKeys: Record<PaneId, NoteKey> = {
      left: shared.key,
      right: shared.key
    };
    let activePane: PaneId = 'left';
    const leftOpen = deferred<SessionSnapshot>();
    const rightOpen = deferred<SessionSnapshot>();
    vi.mocked(openNoteSession).mockImplementation(
      async (_noteId, path) =>
        path === '/vault/left-target.md'
          ? leftOpen.promise
          : rightOpen.promise
    );
    const transitions =
      createPaneNavigationTransitionPipeline<PaneId>({
        assertWorkspaceInvariants: vi.fn(),
        ensurePaneEditors: vi.fn(async () => undefined)
      });
    const controller = createNoteCommandController<PaneId>({
      base: {
        state,
        workspace: {
          getActivePaneId: () => activePane,
          resetPaneCommand: vi.fn(),
          getPaneState: (paneId: PaneId) => ({
            noteKey: paneNoteKeys[paneId]
          }),
          setPaneNoteKey: (paneId: PaneId, noteKey: NoteKey) => {
            paneNoteKeys[paneId] = noteKey;
          },
          isNoteReferenced: (noteKey: NoteKey) =>
            Object.values(paneNoteKeys).includes(noteKey),
          setPaneKind: vi.fn(() => true)
        },
        panes: {
          getPaneDocument: (paneId: PaneId) =>
            state.notesByKey[paneNoteKeys[paneId]],
          getPaneKind: () => 'editor',
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
          replacePaneDocument: vi.fn(async () => undefined)
        },
        paneLifecycle: {}
      },
      blurFocusedPaneTitle: vi.fn(),
      capturePaneLocation: () => null,
      touchLocation: vi.fn(),
      isLocationTouchSuppressed: () => false,
      bumpLocationHistoryEpoch: vi.fn(),
      documentDeparture: {
        prepare: vi.fn(async () => shared)
      },
      transitions
    } as never);

    const openingLeft = controller.openNotePath(
      '/vault/left-target.md',
      { currentNoteAlreadySaved: true, focusEditorAfterOpen: false }
    );
    activePane = 'right';
    const openingRight = controller.openNotePath(
      '/vault/right-target.md',
      { currentNoteAlreadySaved: true, focusEditorAfterOpen: false }
    );
    leftOpen.resolve(
      persistedSnapshot(
        'left-target',
        '/vault/left-target.md',
        'left target'
      )
    );
    rightOpen.resolve(
      persistedSnapshot(
        'right-target',
        '/vault/right-target.md',
        'right target'
      )
    );
    await Promise.all([openingLeft, openingRight]);

    expect(state.notesByKey[paneNoteKeys.left].identity).toMatchObject({
      kind: 'persisted',
      path: '/vault/left-target.md'
    });
    expect(state.notesByKey[paneNoteKeys.right].identity).toMatchObject({
      kind: 'persisted',
      path: '/vault/right-target.md'
    });
    expect(shared.operation.kind).toBe('idle');
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
    updateDocumentMarkdown(document, 'After');
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
      kind: 'noConflict',
      sequence: 0
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

describe('new-note location history', () => {
  it('records the newly remembered note before replacing it with a fresh draft', async () => {
    const draft = createNoteDraftState({
      ...createEmptySessionSnapshot(),
      title: 'Draft title',
      bodyMarkdown: 'Draft body'
    });
    const state = createNotepadState<PaneId>(draft);
    let paneNoteKey = draft.key;
    const remembered = persistedSnapshot(
      'remembered-note',
      '/vault/Remembered.md',
      'Draft body'
    );
    const saved = createNoteDraftState(remembered);
    const touchLocation = vi.fn();
    const beginPaneCommand = vi.fn();
    const prepareDeparture = vi.fn(async () => {
      state.notesByKey[saved.key] = saved;
      paneNoteKey = saved.key;
      return saved;
    });
    const transitions =
      createPaneNavigationTransitionPipeline<PaneId>({
        assertWorkspaceInvariants: vi.fn(),
        ensurePaneEditors: vi.fn(async () => undefined)
      });
    const controller = createNoteCommandController<PaneId>({
      base: {
        state,
        workspace: {
          getActivePaneId: () => 'left',
          getPaneOrder: () => ['left'],
          setPaneNoteKey: (_paneId: PaneId, noteKey: NoteKey) => {
            paneNoteKey = noteKey;
          },
          isNoteReferenced: (noteKey: NoteKey) =>
            paneNoteKey === noteKey,
          beginPaneCommand
        },
        panes: {
          getPaneDocument: () => state.notesByKey[paneNoteKey],
          getNavigationDocument: () =>
            state.notesByKey[paneNoteKey],
          getPaneKind: () => 'editor',
          activatePaneSession: vi.fn(),
          updateSelectedRelatedText: vi.fn(),
          focusPaneEditorAtEnd: vi.fn()
        },
        persistence: {
          cancelPendingAutosave: vi.fn(),
          getNoteSaveQueue: vi.fn(async () => undefined),
          invalidatePendingSaveResults: vi.fn()
        },
        derivedViews: {
          setRecentlyForgotten: vi.fn(),
          clearSearch: vi.fn(),
          clearSelectedRelatedText: vi.fn(),
          scheduleSearchIfNeeded: vi.fn(),
          scheduleRelatedIfNeeded: vi.fn(),
          loadRecentNotes: vi.fn(async () => [])
        },
        documents: {
          flushAllPendingCursorSaves: vi.fn(),
          saveCursorPositionForDocument: vi.fn(),
          replacePaneDocument: vi.fn(async () => undefined)
        },
        paneLifecycle: {}
      },
      blurFocusedPaneTitle: vi.fn(),
      ensureLocationMruSeeded: vi.fn(async () => undefined),
      capturePaneLocation: () => {
        const identity =
          state.notesByKey[paneNoteKey].identity;
        return identity.kind === 'persisted'
          ? {
              kind: 'editor' as const,
              noteId: identity.noteId,
              notePath: identity.path
            }
          : null;
      },
      touchLocation,
      touchCurrentLocation: vi.fn(),
      setPaneKind: vi.fn(async () => undefined),
      documentDeparture: {
        prepare: prepareDeparture
      },
      transitions
    } as never);

    await controller.startNewNoteFlow();

    expect(touchLocation).toHaveBeenCalledWith('left', {
      kind: 'editor',
      noteId: 'remembered-note',
      notePath: '/vault/Remembered.md'
    });
    expect(prepareDeparture).toHaveBeenCalledWith(
      'left',
      draft,
      { clearLastOpened: true }
    );
    expect(state.notesByKey[paneNoteKey].savedBaseline).toBeNull();
    expect(beginPaneCommand).toHaveBeenCalledWith(
      'left',
      paneNoteKey,
      'start'
    );
  });
});
