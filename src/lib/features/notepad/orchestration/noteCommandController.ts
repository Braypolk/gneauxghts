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
  restoreForgottenNotes
} from '$lib/features/notepad/session/session';
import {
  adoptSnapshotForPane,
  createFreshDraftNote,
  replaceReferencedNoteWithFreshDraft,
  setNoteStatus,
  setPaneKind as setStoredPaneKind,
  type NoteDraftState,
  type NoteKey
} from '$lib/features/notepad/state/noteStore';
import { cleanupNoteRuntime } from '$lib/features/notepad/session/noteRuntime';
import type { NotepadCommandsDeps } from './notepadCommandFacades';

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
    paneLifecycle,
    refresh
  } = deps.base;

  async function refreshCurrentNoteFromDisk(
    options: { force?: boolean } = {}
  ) {
    const note = panes.getNavigationDocument();
    const currentPath = note.currentNotePath;
    const force = options.force ?? false;
    const editorReady = workspace
      .getPaneOrder()
      .some(
        (paneId) =>
          panes.getPaneDocument(paneId).key === note.key &&
          panes.getPaneRuntime(paneId).ui.isEditorReady
      );
    if (
      !currentPath ||
      !editorReady ||
      refresh.isRefreshingFromDisk() ||
      (!force && !persistence.hasCleanBuffer(note))
    ) {
      return;
    }

    refresh.setRefreshingFromDisk(true);
    try {
      const session = await readNoteSession(
        note.currentNoteId,
        currentPath
      );
      if (
        panes.getNavigationDocument().key !== note.key ||
        (!force && !persistence.hasCleanBuffer(note))
      ) {
        return;
      }
      if (
        session.lastSavedTitle === note.lastSavedTitle &&
        session.lastSavedMarkdown === note.lastSavedMarkdown &&
        session.lastSavedNoteId === note.lastSavedNoteId &&
        session.lastSavedPath === note.lastSavedPath
      ) {
        return;
      }

      await deps.base.documentEditing.applySnapshot(
        note,
        session,
        () =>
          documents.replaceEditorContentInPlace(
            session.bodyMarkdown
          )
      );
      derivedViews.setRecentlyForgotten(null);
      derivedViews.clearSelectedRelatedText();
    } catch (error) {
      console.error('Failed to refresh note from disk:', error);
    } finally {
      refresh.setRefreshingFromDisk(false);
    }
  }

  async function openStartPaneCommand(
    paneId: TPaneId,
    noteKey: NoteKey
  ) {
    await derivedViews.loadRecentNotes();
    await deps.ensureLocationMruSeeded(paneId);
    workspace.beginPaneCommand(
      paneId,
      noteKey,
      'start'
    );
    panes.activatePaneSession(paneId);
    await tick();
    await paneLifecycle.ensurePaneEditors();
    panes.updateSelectedRelatedText(paneId);
    panes.focusPaneEditorAtEnd(paneId);
  }

  async function clearNotepad(
    options: { canRestore?: boolean } = {}
  ) {
    const canRestore = options.canRestore ?? true;
    const paneId = panes.getNavigationPaneId();
    deps.blurFocusedPaneTitle(paneId);
    const note = panes.getNavigationDocument();
    const notePathToClear = note.currentNotePath;

    if (notePathToClear) {
      documents.saveCursorPositionForDocument(note);
      persistence.cancelPendingAutosave(note);
      await persistence.enqueueSave(note);
    }

    const draft = {
      title: note.title,
      bodyMarkdown: note.bodyMarkdown,
      currentNoteId: note.currentNoteId,
      currentNotePath: note.currentNotePath
    };
    const hasDraftContent = hasContent(draft);
    let forgottenPath: string | null = null;

    if (notePathToClear) {
      try {
        setNoteStatus(note, 'forgetting');
        const summary = await forgetNoteSession(
          notePathToClear,
          deps.base.forgottenNoteRetentionPreference()
        );
        forgottenPath = summary?.forgottenPath ?? null;
      } catch (error) {
        console.error('Failed to forget note:', error);
        setNoteStatus(note, 'error');
        return;
      }
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
          paneId,
          session
        );
        derivedViews.setRecentlyForgotten(null);
        await documents.replaceNoteAcrossPanes(
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
        documents.replaceEditorContent(note.bodyMarkdown),
      { autosave: true }
    );
    derivedViews.setRecentlyForgotten(null);
    derivedViews.clearSelectedRelatedText();
    void derivedViews.loadRecentNotes();
  }

  async function rememberCurrentNote() {
    documents.flushAllPendingCursorSaves();
    const note = panes.getNavigationDocument();
    if (deps.base.canLeaveDocument?.(note) === false) {
      deps.base.onNavigationBlocked?.();
      return;
    }
    documents.saveCursorPositionForDocument(note);
    persistence.cancelPendingAutosave(note);
    await persistence.getNoteSaveQueue(note.key);
    const operationRevision = note.operationRevision;
    setNoteStatus(note, 'remembering');

    await rememberNoteSession(
      note.title,
      note.bodyMarkdown,
      note.currentNotePath,
      { clearLastOpened: true }
    );
    if (note.operationRevision !== operationRevision) return;

    derivedViews.setRecentlyForgotten(null);
    persistence.invalidatePendingSaveResults(note);
    persistence.cancelPendingAutosave(note);
    const freshDraft = replaceReferencedNoteWithFreshDraft(
      state,
      note.key
    );
    await documents.replaceNoteAcrossPanes(note, freshDraft);
    derivedViews.clearSearch();
    refreshDerivedViews();
    void derivedViews.loadRecentNotes();
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
    const operationRevision = note.operationRevision;
    setNoteStatus(note, 'remembering');

    await rememberNoteSession(
      note.title,
      note.bodyMarkdown,
      note.currentNotePath,
      { clearLastOpened: panes.getNavigationDocument() === note }
    );
    if (note.operationRevision !== operationRevision) return note;

    setNoteStatus(note, 'idle');
    derivedViews.setRecentlyForgotten(null);
    persistence.invalidatePendingSaveResults(note);
    persistence.cancelPendingAutosave(note);

    const freshDraft = createFreshDraftNote(state);
    panes.setPaneDocumentSession(paneId, freshDraft);
    await documents.replacePaneDocument(
      paneId,
      note,
      freshDraft
    );
    derivedViews.clearSearch();
    refreshDerivedViews();
    void derivedViews.loadRecentNotes();
    return freshDraft;
  }

  async function startNewNoteFlow() {
    let paneId = workspace.getActivePaneId();
    const startedInChat =
      panes.getPaneKind(paneId) === 'chat';
    if (startedInChat) deps.touchCurrentLocation(paneId);
    deps.blurFocusedPaneTitle(paneId);
    let note = panes.getPaneDocument(paneId);

    if (hasContent(note)) {
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
    const previousDocument = panes.getPaneDocument(paneId);
    if (!options.noteId && !notePath) return;
    if (
      previousDocument.currentNotePath !== notePath &&
      deps.base.canLeaveDocument?.(previousDocument) === false
    ) {
      deps.base.onNavigationBlocked?.();
      return;
    }
    if (previousDocument.currentNotePath !== notePath) {
      deps.base.onDocumentLeaving?.(previousDocument);
    }

    const targetLocation: NavLocation = {
      kind: 'editor',
      noteId: options.noteId ?? null,
      notePath
    };
    const currentLocation = deps.capturePaneLocation(paneId);
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

    const leavingChat =
      panes.getPaneKind(paneId) === 'chat' &&
      (!deps.isLocationTouchSuppressed() ||
        Boolean(options.revealEditorAfterOpen));

    workspace.resetPaneCommand();
    documents.flushAllPendingCursorSaves();
    documents.saveCursorPositionForDocument(previousDocument);
    if (
      !(options.currentNoteAlreadySaved ?? false) &&
      (previousDocument.currentNoteId !==
        (options.noteId ?? null) ||
        previousDocument.currentNotePath !== notePath)
    ) {
      persistence.cancelPendingAutosave(previousDocument);
      void persistence.enqueueSave(previousDocument);
    }

    const requestGeneration = panes
      .getPaneRuntime(paneId)
      .bumpOpenRequestGeneration();
    const isStale = () =>
      panes
        .getPaneRuntime(paneId)
        .getOpenRequestGeneration() !== requestGeneration;
    setNoteStatus(previousDocument, 'opening');

    let session;
    try {
      session = await openNoteSession(
        options.noteId ?? null,
        notePath
      );
    } catch (error) {
      if (isStale()) return;
      throw error;
    }
    if (isStale()) return;

    const nextDocument = adoptSnapshotForPane(
      state,
      paneId,
      session
    );
    deps.base.onDocumentOpened?.(nextDocument);
    derivedViews.setRecentlyForgotten(null);
    panes.closeWikilinkAutocomplete(paneId);
    derivedViews.clearSelectedRelatedText();

    if (leavingChat) {
      setStoredPaneKind(state, paneId, 'editor');
      await tick();
      if (isStale()) return;
      await paneLifecycle.ensurePaneEditors();
      panes.updateSelectedRelatedText();
    }

    if (
      panes.getPaneRuntime(paneId).ui.isEditorReady &&
      panes.getPaneKind(paneId) === 'editor'
    ) {
      await documents.replaceNoteAcrossPanes(
        previousDocument,
        nextDocument,
        { restoreCursor: true }
      );
      if (isStale()) return;
    }
    deps.base.onDocumentPresented?.(nextDocument);

    if (
      (options.focusEditorAfterOpen ?? true) &&
      panes.getPaneKind(paneId) === 'editor'
    ) {
      await tick();
      if (isStale()) return;
      deps.focusPane(paneId, { preferTitle: false });
    }

    setNoteStatus(nextDocument, 'idle');
    if (!panes.getNoteByKey(previousDocument.key)) {
      cleanupNoteRuntime(previousDocument.key);
    }
    derivedViews.scheduleRelatedIfNeeded({ immediate: true });
    if (!deps.isLocationTouchSuppressed()) {
      deps.bumpLocationHistoryEpoch();
    }
  }

  function refreshDerivedViews() {
    derivedViews.clearSelectedRelatedText();
    derivedViews.scheduleSearchIfNeeded();
    derivedViews.scheduleRelatedIfNeeded({ immediate: true });
  }

  return {
    refreshCurrentNoteIfChanged: () =>
      refreshCurrentNoteFromDisk(),
    refreshCurrentNoteFromTaskMutation: () =>
      refreshCurrentNoteFromDisk({ force: true }),
    clearNotepad,
    unforgetNotepad,
    rememberCurrentNote,
    startNewNoteFlow,
    openNotePath
  };
}
