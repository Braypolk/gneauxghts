import { tick } from 'svelte';
import {
  locationsEqual,
  type NavLocation
} from '$lib/features/notepad/navigation/locationMru';
import {
  createForgottenNote,
  forgetNoteSession,
  hasContent,
  openNoteSession,
  readNoteSession,
  rememberNoteSession,
  restoreForgottenNotes,
  type SessionSnapshot
} from '$lib/features/notepad/session/session';
import {
  adoptSnapshotForPane,
  removeNoteIfUnreferenced,
  replacePaneReferenceWithFreshDraft,
  replaceReferencedNoteWithFreshDraft,
  type NoteDraftState,
  type NoteKey
} from '$lib/features/notepad/state/noteStore';
import { cleanupNoteRuntime } from '$lib/features/notepad/session/noteRuntime';
import type { NotepadCommandsDeps } from './notepadCommandFacades';
import {
  beginDocumentOperation,
  captureExternalSnapshotConflict,
  completeDocumentOperation,
  externalSnapshotMatchesSavedBaseline,
  failDocumentOperation,
  getDocumentMarkdown,
  getDocumentNoteId,
  getDocumentPath,
  getDocumentTitle,
  isDocumentOperationCurrent,
  type ExternalRefreshSource
} from '$lib/features/notepad/document/documentState';
import type {
  PaneNavigationTransitionPipeline
} from './paneNavigationTransitionPipeline';
import { paneHasCapability } from '$lib/features/notepad/workspace/paneCapabilities';

export interface OpenNoteOptions {
  noteId?: string | null;
  currentNoteAlreadySaved?: boolean;
  focusEditorAfterOpen?: boolean;
  /** Leave chat only after the target note is loaded. */
  revealEditorAfterOpen?: boolean;
}

export interface NoteCommandControllerDeps<
  TPaneId extends string
> {
  base: NotepadCommandsDeps<TPaneId>;
  blurFocusedPaneTitle: (paneId: TPaneId) => void;
  ensureLocationMruSeeded: (paneId: TPaneId) => Promise<unknown>;
  capturePaneLocation: (
    paneId: TPaneId
  ) => NavLocation | null;
  touchLocation: (
    paneId: TPaneId,
    location: NavLocation
  ) => void;
  touchCurrentLocation: (paneId: TPaneId) => void;
  removeLocation: (location: NavLocation) => void;
  isLocationTouchSuppressed: () => boolean;
  bumpLocationHistoryEpoch: () => void;
  setPaneKind: (
    paneId: TPaneId,
    kind: 'editor' | 'chat',
    options?: { recordCurrentLocation?: boolean }
  ) => Promise<void>;
  focusPane: (
    paneId: TPaneId,
    options?: { preferTitle?: boolean }
  ) => void;
  transitions: PaneNavigationTransitionPipeline<TPaneId>;
}

/** Owns note refresh, open, forget, restore, remember and new-note flows. */
export function createNoteCommandController<
  TPaneId extends string
>(deps: NoteCommandControllerDeps<TPaneId>) {
  const {
    state,
    workspace,
    panes,
    persistence,
    derivedViews,
    documents,
    paneLifecycle
  } = deps.base;
  type RefreshOutcome =
    | 'skipped'
    | 'stale'
    | 'unchanged'
    | 'conflict'
    | 'refreshed'
    | 'failed';
  interface RefreshRun {
    promise: Promise<RefreshOutcome>;
    trailingSource: ExternalRefreshSource | null;
  }
  const refreshRuns = new Map<NoteKey, RefreshRun>();

  async function runSingleDocumentRefresh(
    note: NoteDraftState,
    source: ExternalRefreshSource
  ): Promise<RefreshOutcome> {
    const currentPath = getDocumentPath(note);
    if (!currentPath) return 'skipped';

    try {
      const session = await readNoteSession(
        getDocumentNoteId(note),
        currentPath
      );
      if (
        getDocumentPath(note) !== currentPath
      ) {
        return 'stale' as const;
      }
      if (externalSnapshotMatchesSavedBaseline(note, session)) {
        return 'unchanged' as const;
      }
      if (!persistence.hasCleanBuffer(note)) {
        persistence.cancelPendingAutosave(note);
        persistence.invalidatePendingSaveResults(note);
        captureExternalSnapshotConflict(
          note,
          session,
          source
        );
        return 'conflict' as const;
      }

      await deps.base.documentEditing.applySnapshot(
        note,
        session,
        () => documents.replaceNoteAcrossPanes(note, note)
      );
      derivedViews.setRecentlyForgotten(null);
      derivedViews.clearSelectedRelatedText();
      return 'refreshed' as const;
    } catch (error) {
      console.error('Failed to refresh note from disk:', error);
      return 'failed';
    }
  }

  function refreshDocumentFromDisk(
    note: NoteDraftState,
    {
      source = 'windowFocus'
    }: { source?: ExternalRefreshSource } = {}
  ): Promise<RefreshOutcome> {
    const existingRun = refreshRuns.get(note.key);
    if (existingRun) {
      // A watcher/focus event that arrives while a read is in flight may
      // represent a newer filesystem state. Coalesce the burst, but always
      // retain one trailing read instead of discarding the event.
      existingRun.trailingSource = source;
      return existingRun.promise;
    }

    const run: RefreshRun = {
      promise: Promise.resolve('skipped'),
      trailingSource: null
    };
    run.promise = (async () => {
      let nextSource: ExternalRefreshSource | null = source;
      let outcome: RefreshOutcome = 'skipped';
      while (nextSource) {
        const currentSource = nextSource;
        run.trailingSource = null;
        outcome = await runSingleDocumentRefresh(
          note,
          currentSource
        );
        nextSource = run.trailingSource;
      }
      return outcome;
    })().finally(() => {
      if (refreshRuns.get(note.key) === run) {
        refreshRuns.delete(note.key);
      }
    });
    refreshRuns.set(note.key, run);
    return run.promise;
  }

  async function refreshCurrentNoteFromDisk(
    source: ExternalRefreshSource = 'windowFocus'
  ) {
    return refreshDocumentFromDisk(
      panes.getNavigationDocument(),
      { source }
    );
  }

  /**
   * Reconciles a successful app-owned proposal write with its open document.
   * The commit's exact editor markdown is the ownership proof: if disk matches
   * it, advance the saved baseline without manufacturing an external conflict.
   * Any local edit made after the commit remains as a dirty working copy.
   */
  async function acknowledgeDocumentCommit(commit: {
    document: NoteDraftState;
    path: string;
    markdown: string;
  }) {
    const { document, path, markdown } = commit;
    const snapshot = await readNoteSession(
      getDocumentNoteId(document),
      path
    );

    if (snapshot.bodyMarkdown !== markdown) {
      // The file no longer contains the bytes this app committed. Route the
      // mismatch through normal external-change protection instead of claiming
      // ownership of a racing write.
      await refreshDocumentFromDisk(document, {
        source: 'watcher'
      });
      return;
    }

    persistence.cancelPendingAutosave(document);
    persistence.invalidatePendingSaveResults(document);
    const preserveDraft =
      getDocumentMarkdown(document) !== markdown;
    await deps.base.documentEditing.applySnapshot(
      document,
      snapshot,
      () =>
        documents.replaceNoteAcrossPanes(
          document,
          document
        ),
      {
        preserveDraft,
        autosave: preserveDraft
      }
    );
    derivedViews.setRecentlyForgotten(null);
    derivedViews.clearSelectedRelatedText();
    derivedViews.scheduleRelatedIfNeeded({
      immediate: true
    });
  }

  async function openStartPaneCommand(
    paneId: TPaneId,
    noteKey: NoteKey
  ) {
    const result = await deps.transitions.execute({
      kind: 'pane-command',
      resolvePane: () =>
        workspace.getPaneOrder().includes(paneId)
          ? paneId
          : null,
      prepare: async () => {
        await derivedViews.loadRecentNotes();
        await deps.ensureLocationMruSeeded(paneId);
      },
      mutateWorkspace: () => {
        workspace.beginPaneCommand(
          paneId,
          noteKey,
          'start'
        );
        panes.activatePaneSession(paneId);
      },
      ensureEditors: true,
      complete: () => {
        panes.updateSelectedRelatedText(paneId);
      },
      focus: () => {
        panes.focusPaneEditorAtEnd(paneId);
      }
    });
    if (result.status === 'failed') {
      throw result.error;
    }
  }

  async function clearNotepad(
    options: { canRestore?: boolean } = {}
  ) {
    const canRestore = options.canRestore ?? true;
    const paneId = panes.getNavigationPaneId();
    deps.blurFocusedPaneTitle(paneId);
    const note = panes.getNavigationDocument();
    if (deps.base.canLeaveDocument?.(note) === false) {
      deps.base.onNavigationBlocked?.();
      return;
    }
    const notePathToClear = getDocumentPath(note);

    if (notePathToClear) {
      documents.saveCursorPositionForDocument(note);
      persistence.cancelPendingAutosave(note);
      await persistence.enqueueSave(note);
    }

    const draft = {
      title: getDocumentTitle(note),
      bodyMarkdown: getDocumentMarkdown(note),
      currentNoteId: getDocumentNoteId(note),
      currentNotePath: getDocumentPath(note)
    };
    const hasDraftContent = hasContent(draft);
    let forgottenPath: string | null = null;

    if (notePathToClear) {
      const operationToken = beginDocumentOperation(
        note,
        'forgetting'
      );
      try {
        const summary = await forgetNoteSession(
          notePathToClear,
          deps.base.forgottenNoteRetentionPreference()
        );
        if (
          !isDocumentOperationCurrent(note, operationToken)
        ) {
          return;
        }
        forgottenPath = summary?.forgottenPath ?? null;
      } catch (error) {
        console.error('Failed to forget note:', error);
        failDocumentOperation(
          note,
          'forgetting',
          error,
          operationToken
        );
        return;
      }
      completeDocumentOperation(note, operationToken);
      deps.removeLocation({
        kind: 'editor',
        noteId: draft.currentNoteId,
        notePath: notePathToClear
      });
    }

    persistence.invalidatePendingSaveResults(note);
    persistence.cancelPendingAutosave(note);
    const freshDraft = replaceReferencedNoteWithFreshDraft(
      state,
      workspace,
      note.key
    );
    cleanupNoteRuntime(note.key);
    derivedViews.setRecentlyForgotten(
      canRestore && hasDraftContent
        ? createForgottenNote(draft, forgottenPath)
        : null
    );
    await documents.replaceNoteAcrossPanes(note, freshDraft);
    refreshDerivedViews();
    await openStartPaneCommand(paneId, freshDraft.key);
  }

  async function unforgetNotepad() {
    const forgottenNote = state.recentlyForgotten;
    if (!forgottenNote) return;
    workspace.resetPaneCommand();

    if (forgottenNote.forgottenPath) {
      try {
        const restoredNotes = await restoreForgottenNotes([
          forgottenNote.forgottenPath
        ]);
        const restoredPath = restoredNotes[0]?.restoredPath;
        if (!restoredPath) return;

        const paneId = workspace.getActivePaneId();
        const requestGeneration = panes
          .getPaneRuntime(paneId)
          .bumpOpenRequestGeneration();
        const previousNote = panes.getNavigationDocument();
        const session = await openNoteSession(null, restoredPath);
        if (
          panes
            .getPaneRuntime(paneId)
            .getOpenRequestGeneration() !== requestGeneration
        ) {
          return;
        }
        const restoredNote = adoptSnapshotForPane(
          state,
          workspace,
          paneId,
          session
        );
        derivedViews.setRecentlyForgotten(null);
        await documents.replacePaneDocument(
          paneId,
          previousNote,
          restoredNote,
          { restoreCursor: true }
        );
        refreshDerivedViews();
        void derivedViews.loadRecentNotes();
        return;
      } catch (error) {
        console.error('Failed to restore forgotten note:', error);
        return;
      }
    }

    const note = panes.getNavigationDocument();
    await deps.base.documentEditing.applySnapshot(
      note,
      {
        ...forgottenNote,
        lastSavedTitle: '',
        lastSavedMarkdown: '',
        lastSavedNoteId: null,
        lastSavedPath: null
      },
      () =>
        documents.replaceEditorContent(
          getDocumentMarkdown(note)
        ),
      { autosave: true }
    );
    derivedViews.setRecentlyForgotten(null);
    derivedViews.clearSelectedRelatedText();
    void derivedViews.loadRecentNotes();
  }

  async function rememberCurrentNote() {
    return rememberCurrentNoteForPane(
      panes.getNavigationPaneId()
    );
  }

  async function rememberCurrentNoteForPane(paneId: TPaneId) {
    documents.flushAllPendingCursorSaves();
    const note = panes.getPaneDocument(paneId);
    if (deps.base.canLeaveDocument?.(note) === false) {
      deps.base.onNavigationBlocked?.();
      return note;
    }
    documents.saveCursorPositionForDocument(note);
    persistence.cancelPendingAutosave(note);
    await persistence.getNoteSaveQueue(note.key);
    const operationRevision = note.operation.revision;
    const operationToken = beginDocumentOperation(
      note,
      'remembering'
    );

    try {
      await rememberNoteSession(
        getDocumentTitle(note),
        getDocumentMarkdown(note),
        getDocumentPath(note),
        {
          clearLastOpened:
            panes.getNavigationDocument() === note
        }
      );
    } catch (error) {
      console.error('Failed to remember note:', error);
      failDocumentOperation(
        note,
        'remembering',
        error,
        operationToken
      );
      return note;
    }
    if (
      !isDocumentOperationCurrent(note, operationToken) ||
      note.operation.revision !== operationRevision
    ) {
      completeDocumentOperation(note, operationToken);
      return note;
    }

    completeDocumentOperation(note, operationToken);
    derivedViews.setRecentlyForgotten(null);
    persistence.invalidatePendingSaveResults(note);
    persistence.cancelPendingAutosave(note);

    const freshDraft = replacePaneReferenceWithFreshDraft(
      state,
      workspace,
      paneId
    );
    await documents.replacePaneDocument(
      paneId,
      note,
      freshDraft
    );
    removeNoteIfUnreferenced(
      state,
      workspace,
      note.key
    );
    if (!state.notesByKey[note.key]) {
      cleanupNoteRuntime(note.key);
    }
    derivedViews.clearSearch();
    refreshDerivedViews();
    void derivedViews.loadRecentNotes();
    return freshDraft;
  }

  async function startNewNoteFlow() {
    let paneId = workspace.getActivePaneId();
    const startedInChat =
      paneHasCapability(
        panes.getPaneKind(paneId),
        'host-chat'
      );
    if (startedInChat) deps.touchCurrentLocation(paneId);
    deps.blurFocusedPaneTitle(paneId);
    let note = panes.getPaneDocument(paneId);

    if (
      hasContent({
        title: getDocumentTitle(note),
        bodyMarkdown: getDocumentMarkdown(note),
        currentNoteId: getDocumentNoteId(note),
        currentNotePath: getDocumentPath(note)
      })
    ) {
      await rememberCurrentNoteForPane(paneId);
      paneId = workspace.getActivePaneId();
      note = panes.getPaneDocument(paneId);
    }
    if (startedInChat) {
      await deps.setPaneKind(paneId, 'editor', {
        recordCurrentLocation: false
      });
    }
    await openStartPaneCommand(paneId, note.key);
  }

  async function openNotePath(
    notePath: string | null,
    options: OpenNoteOptions = {}
  ) {
    const paneId = workspace.getActivePaneId();
    deps.blurFocusedPaneTitle(paneId);
    let previousDocument!: NoteDraftState;
    let nextDocument: NoteDraftState | null = null;
    let session: SessionSnapshot | null = null;
    let leavingChat = false;
    let requestGeneration = 0;
    let operationToken = 0;
    const isOpenCurrent = () =>
      requestGeneration > 0 &&
      panes
        .getPaneRuntime(paneId)
        .getOpenRequestGeneration() === requestGeneration &&
      isDocumentOperationCurrent(
        previousDocument,
        operationToken
      );

    const result = await deps.transitions.execute({
      kind: 'open-note',
      resolvePane: () =>
        options.noteId || notePath ? paneId : null,
      guard: () => {
        previousDocument = panes.getPaneDocument(paneId);
        if (
          getDocumentPath(previousDocument) !== notePath &&
          deps.base.canLeaveDocument?.(previousDocument) ===
            false
        ) {
          deps.base.onNavigationBlocked?.();
          return {
            status: 'blocked',
            reason:
              'The current document has an unresolved navigation guard.'
          };
        }
        return { status: 'allow' };
      },
      captureHistory: () => {
        if (
          getDocumentPath(previousDocument) !== notePath
        ) {
          deps.base.onDocumentLeaving?.(
            paneId,
            previousDocument
          );
        }
        const targetLocation: NavLocation = {
          kind: 'editor',
          noteId: options.noteId ?? null,
          notePath
        };
        const currentLocation =
          deps.capturePaneLocation(paneId);
        const isSameEditorLocation =
          currentLocation?.kind === 'editor' &&
          locationsEqual(currentLocation, targetLocation);
        if (
          !deps.isLocationTouchSuppressed() &&
          currentLocation &&
          !isSameEditorLocation
        ) {
          deps.touchLocation(paneId, currentLocation);
        }
        leavingChat =
          paneHasCapability(
            panes.getPaneKind(paneId),
            'host-chat'
          ) &&
          (!deps.isLocationTouchSuppressed() ||
            Boolean(options.revealEditorAfterOpen));
        workspace.resetPaneCommand();
      },
      prepare: async () => {
        documents.flushAllPendingCursorSaves();
        documents.saveCursorPositionForDocument(
          previousDocument
        );
        if (
          !(options.currentNoteAlreadySaved ?? false) &&
          (getDocumentNoteId(previousDocument) !==
            (options.noteId ?? null) ||
            getDocumentPath(previousDocument) !== notePath)
        ) {
          persistence.cancelPendingAutosave(
            previousDocument
          );
          await persistence.enqueueSave(previousDocument);
        }
        requestGeneration = panes
          .getPaneRuntime(paneId)
          .bumpOpenRequestGeneration();
        operationToken = beginDocumentOperation(
          previousDocument,
          'opening'
        );
        session = await openNoteSession(
          options.noteId ?? null,
          notePath
        );
      },
      isCurrent: isOpenCurrent,
      mutateWorkspace: () => {
        if (!session) {
          throw new Error(
            'Open-note transition completed without a session.'
          );
        }
        nextDocument = adoptSnapshotForPane(
          state,
          workspace,
          paneId,
          session
        );
        completeDocumentOperation(
          previousDocument,
          operationToken
        );
        deps.base.onDocumentOpened?.(nextDocument);
        derivedViews.setRecentlyForgotten(null);
        panes.closeWikilinkAutocomplete(paneId);
        derivedViews.clearSelectedRelatedText();
        if (leavingChat) {
          workspace.setPaneKind(paneId, 'editor');
        }
      },
      ensureEditors: true,
      complete: async () => {
        if (!nextDocument) return;
        if (
          paneHasCapability(
            panes.getPaneKind(paneId),
            'edit-document'
          )
        ) {
          await documents.replacePaneDocument(
            paneId,
            previousDocument,
            nextDocument,
            { restoreCursor: true }
          );
        }
        if (!isOpenCurrent()) return;
        panes.updateSelectedRelatedText();
        deps.base.onDocumentPresented?.(nextDocument);
        if (!panes.getNoteByKey(previousDocument.key)) {
          cleanupNoteRuntime(previousDocument.key);
        }
        derivedViews.scheduleRelatedIfNeeded({
          immediate: true
        });
        if (!deps.isLocationTouchSuppressed()) {
          deps.bumpLocationHistoryEpoch();
        }
      },
      focus:
        options.focusEditorAfterOpen ?? true
          ? async () => {
              if (
                !paneHasCapability(
                  panes.getPaneKind(paneId),
                  'edit-document'
                )
              ) {
                return;
              }
              await tick();
              if (
                isOpenCurrent() &&
                workspace.getActivePaneId() === paneId
              ) {
                deps.focusPane(paneId, {
                  preferTitle: false
                });
              }
            }
          : undefined,
      onStale: () => {
        completeDocumentOperation(
          previousDocument,
          operationToken
        );
      },
      onFailed: (_failedPaneId, error) => {
        if (operationToken > 0) {
          failDocumentOperation(
            previousDocument,
            'opening',
            error,
            operationToken
          );
        }
      }
    });
    if (result.status === 'failed') {
      throw result.error;
    }
  }

  function refreshDerivedViews() {
    derivedViews.clearSelectedRelatedText();
    derivedViews.scheduleSearchIfNeeded();
    derivedViews.scheduleRelatedIfNeeded({ immediate: true });
  }

  return {
    refreshCurrentNoteIfChanged: () =>
      refreshCurrentNoteFromDisk('windowFocus'),
    refreshCurrentNoteFromTaskMutation: () =>
      refreshCurrentNoteFromDisk('taskMutation'),
    acknowledgeDocumentCommit,
    refreshDocumentFromDisk,
    clearNotepad,
    unforgetNotepad,
    rememberCurrentNote,
    startNewNoteFlow,
    openNotePath
  };
}
