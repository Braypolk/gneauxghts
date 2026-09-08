import { describe, expect, it, vi } from 'vitest';
import {
  createNoteDraftState,
  createNotepadState,
  type DocumentHandle
} from '$lib/features/notepad/state/noteStore';
import {
  applyCommittedNoteToDocument,
  updateDocumentMarkdown
} from '$lib/features/notepad/document/documentState';
import type { NoteSession } from '$lib/features/notepad/model/types';
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

function committedNote(snapshot: SessionSnapshot): NoteSession {
  return {
    noteId: snapshot.currentNoteId,
    title: snapshot.title,
    markdown: snapshot.bodyMarkdown,
    path: snapshot.currentNotePath,
    ...(snapshot.commitWarning
      ? { commitWarning: snapshot.commitWarning }
      : {})
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
    const leftRead = deferred<NoteSession>();
    const rightRead = deferred<NoteSession>();
    vi.mocked(readNoteSession).mockImplementation(
      async (_noteId, path) => {
        if (path === '/vault/left.md') {
          return leftRead.promise;
        }
        return rightRead.promise;
      }
    );
    const adoptCleanExternalRefresh = vi.fn(async () => undefined);
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
          documentEditing: { adoptCleanExternalRefresh }
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
    leftRead.resolve(committedNote({
      ...leftSnapshot,
      bodyMarkdown: 'left changed',
      lastSavedMarkdown: 'left changed'
    }));
    rightRead.resolve(committedNote({
      ...rightSnapshot,
      bodyMarkdown: 'right changed',
      lastSavedMarkdown: 'right changed'
    }));

    await expect(leftRefresh).resolves.toBe('refreshed');
    await expect(rightRefresh).resolves.toBe('refreshed');
    expect(adoptCleanExternalRefresh).toHaveBeenCalledTimes(2);
  });

  it('coalesces duplicate refreshes into one guaranteed trailing reread', async () => {
    const boundary = persistedSnapshot(
      'note',
      '/vault/note.md',
      'saved'
    );
    const note = createNoteDraftState(boundary);
    vi.mocked(readNoteSession).mockClear();
    const firstRead = deferred<NoteSession>();
    const trailingRead = deferred<NoteSession>();
    vi.mocked(readNoteSession)
      .mockReturnValueOnce(firstRead.promise)
      .mockReturnValueOnce(trailingRead.promise);
    const adoptCleanExternalRefresh = vi.fn(async () => undefined);
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
            adoptCleanExternalRefresh
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

    firstRead.resolve(committedNote(boundary));
    await vi.waitFor(() => {
      expect(readNoteSession).toHaveBeenCalledTimes(2);
    });
    trailingRead.resolve(committedNote({
      ...boundary,
      bodyMarkdown: 'changed after first read',
      lastSavedMarkdown: 'changed after first read'
    }));

    await expect(first).resolves.toBe('refreshed');
    await expect(duplicate).resolves.toBe('refreshed');
    expect(adoptCleanExternalRefresh).toHaveBeenCalledOnce();
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
    let paneDocumentHandle: DocumentHandle = previous.handle;
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
              documentHandle: paneDocumentHandle
            }),
            setPaneDocumentHandle: (
              _paneId: PaneId,
              documentHandle: DocumentHandle
            ) => {
              paneDocumentHandle = documentHandle;
            },
            isDocumentReferenced: (documentHandle: DocumentHandle) =>
              paneDocumentHandle === documentHandle,
            setPaneKind: vi.fn(() => true)
          },
          panes: {
            getPaneDocument: () =>
              state.documentsByHandle[paneDocumentHandle],
            getPaneKind: () => 'editor',
            getPaneRuntime: () => runtime,
            closeWikilinkAutocomplete: vi.fn(),
            updateSelectedRelatedText: vi.fn(),
            getDocumentByHandle: (documentHandle: DocumentHandle) =>
              state.documentsByHandle[documentHandle] ?? null
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
        bindChatContextToNote: vi.fn(),
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

    const nextDocument = state.documentsByHandle[paneDocumentHandle];
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
    const paneDocumentHandles: Record<PaneId, DocumentHandle> = {
      left: shared.handle,
      right: shared.handle
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
            documentHandle: paneDocumentHandles[paneId]
          }),
          setPaneDocumentHandle: (paneId: PaneId, documentHandle: DocumentHandle) => {
            paneDocumentHandles[paneId] = documentHandle;
          },
          isDocumentReferenced: (documentHandle: DocumentHandle) =>
            Object.values(paneDocumentHandles).includes(documentHandle),
          setPaneKind: vi.fn(() => true)
        },
        panes: {
          getPaneDocument: (paneId: PaneId) =>
            state.documentsByHandle[paneDocumentHandles[paneId]],
          getPaneKind: () => 'editor',
          closeWikilinkAutocomplete: vi.fn(),
          updateSelectedRelatedText: vi.fn(),
          getDocumentByHandle: (documentHandle: DocumentHandle) =>
            state.documentsByHandle[documentHandle] ?? null
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
      bindChatContextToNote: vi.fn(),
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

    expect(state.documentsByHandle[paneDocumentHandles.left].identity).toMatchObject({
      kind: 'persisted',
      path: '/vault/left-target.md'
    });
    expect(state.documentsByHandle[paneDocumentHandles.right].identity).toMatchObject({
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
    const committedSession = committedNote(committed);
    vi.mocked(readNoteSession).mockResolvedValueOnce(
      committedSession
    );
    const adoptAcceptedProposal = vi.fn(
      async (target: typeof document, session: NoteSession) => {
        applyCommittedNoteToDocument(target, session);
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
          documentEditing: {
            adoptAcceptedProposal
          }
        }
      } as never);

    await controller.acknowledgeDocumentCommit({
      document,
      path: '/vault/Plan.md',
      markdown: 'After',
      commitWarning: null
    });

    expect(document.savedBaseline?.content.markdown).toBe(
      'After'
    );
    expect(document.working.markdown).toBe('After');
    expect(document.externalSync).toEqual({
      kind: 'noConflict',
      sequence: 0
    });
    expect(adoptAcceptedProposal).toHaveBeenCalledWith(
      document,
      committedSession,
      'After',
      null
    );
  });

  it('routes a changed canonical read-back through external conflict protection', async () => {
    vi.mocked(readNoteSession).mockClear();
    const before = persistedSnapshot(
      'plan',
      '/vault/Plan.md',
      'Before'
    );
    const document = createNoteDraftState(before);
    updateDocumentMarkdown(document, 'After');
    const racingSession = committedNote({
      ...before,
      bodyMarkdown: 'Racing external edit',
      lastSavedMarkdown: 'Racing external edit'
    });
    vi.mocked(readNoteSession)
      .mockResolvedValueOnce(racingSession)
      .mockResolvedValueOnce(racingSession);
    const adoptAcceptedProposal = vi.fn();
    const invalidatePendingSaveResults = vi.fn();
    const controller =
      createNoteCommandController<PaneId>({
        base: {
          persistence: {
            hasCleanBuffer: () => false,
            cancelPendingAutosave: vi.fn(),
            invalidatePendingSaveResults
          },
          derivedViews: {
            setRecentlyForgotten: vi.fn(),
            clearSelectedRelatedText: vi.fn()
          },
          documentEditing: {
            adoptAcceptedProposal
          }
        }
      } as never);

    await controller.acknowledgeDocumentCommit({
      document,
      path: '/vault/Plan.md',
      markdown: 'After',
      commitWarning: null
    });

    expect(readNoteSession).toHaveBeenCalledTimes(2);
    expect(adoptAcceptedProposal).not.toHaveBeenCalled();
    expect(invalidatePendingSaveResults).toHaveBeenCalledWith(
      document
    );
    expect(document.externalSync).toMatchObject({
      kind: 'conflict',
      external: {
        kind: 'snapshot',
        document: {
          content: { markdown: 'Racing external edit' }
        }
      }
    });
    expect(document.working.markdown).toBe('After');
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
    let paneDocumentHandle = draft.handle;
    const remembered = persistedSnapshot(
      'remembered-note',
      '/vault/Remembered.md',
      'Draft body'
    );
    const saved = createNoteDraftState(remembered);
    const touchLocation = vi.fn();
    const beginPaneCommand = vi.fn();
    const prepareDeparture = vi.fn(async () => {
      state.documentsByHandle[saved.handle] = saved;
      paneDocumentHandle = saved.handle;
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
          setPaneDocumentHandle: (_paneId: PaneId, documentHandle: DocumentHandle) => {
            paneDocumentHandle = documentHandle;
          },
          isDocumentReferenced: (documentHandle: DocumentHandle) =>
            paneDocumentHandle === documentHandle,
          beginPaneCommand
        },
        panes: {
          getPaneDocument: () => state.documentsByHandle[paneDocumentHandle],
          getNavigationDocument: () =>
            state.documentsByHandle[paneDocumentHandle],
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
          state.documentsByHandle[paneDocumentHandle].identity;
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
    expect(state.documentsByHandle[paneDocumentHandle].savedBaseline).toBeNull();
    expect(beginPaneCommand).toHaveBeenCalledWith(
      'left',
      paneDocumentHandle,
      'start'
    );
  });
});
