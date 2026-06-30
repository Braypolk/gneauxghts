import { tick } from 'svelte';
import {
  openSearchResult,
} from '$lib/features/notepad/navigation/openFlow';
import { focusEditorAtEnd } from '$lib/features/notepad/navigation/navigation';
import {
  createForgottenNote,
  forgetNoteSession,
  hasContent,
  openNoteSession,
  readNoteSession,
  rememberNoteSession,
  restoreForgottenNotes,
} from '$lib/features/notepad/session/session';
import {
  getPaneCommandChoiceByIndex,
  getPaneCommandForShortcut,
  getNextPaneCommandIndex,
  type PaneCommandChoice
} from '$lib/features/notepad/paneCommandPicker';
import {
  adoptSnapshotForPane,
  applySnapshotToNote,
  createFreshDraftNote,
  removeNoteIfUnreferenced,
  replaceReferencedNoteWithFreshDraft,
  setNoteStatus,
  setPaneKind as setStoredPaneKind,
  type NoteDraftState,
  type NoteKey,
} from '$lib/features/notepad/state/noteStore';
import {
  cleanupNoteRuntime,
  getEditorPaneCountForNote
} from '$lib/features/notepad/session/noteRuntime';
import { createPaneCommandGroup } from './paneCommandGroup';
import type { NotepadCommandsDeps, PaneKind } from './notepadCommandFacades';

export type { NotepadCommandsDeps } from './notepadCommandFacades';

export function createNotepadCommands<TPaneId extends string>(deps: NotepadCommandsDeps<TPaneId>) {
  const { state, primaryPaneId, paneIdsAll, workspace, panes, persistence, derivedViews, documentSync, documents, paneLifecycle, refresh, forgottenNoteRetentionPreference } = deps;

  const getActivePaneId = workspace.getActivePaneId;
  const getPaneOrder = workspace.getPaneOrder;
  const setPaneOrder = workspace.setPaneOrder;
  const removePane = workspace.removePane;
  const beginPaneCommand = workspace.beginPaneCommand;
  const resetPaneCommand = workspace.resetPaneCommand;
  const setPaneCommandHighlight = workspace.setPaneCommandHighlight;
  const getPaneCommandPaneId = workspace.getPaneCommandPaneId;
  const getPaneCommandSourceNoteKey = workspace.getPaneCommandSourceNoteKey;
  const getPaneCommandHighlightedIndex = workspace.getPaneCommandHighlightedIndex;
  const getPaneCommandMode = workspace.getPaneCommandMode;
  const getPaneCommandPreviousItem = workspace.getPaneCommandPreviousItem;

  const getPaneKind = panes.getPaneKind;
  const getPaneDocument = panes.getPaneDocument;
  const getNavigationDocument = panes.getNavigationDocument;
  const getNavigationPaneId = panes.getNavigationPaneId;
  const getNextPaneId = panes.getNextPaneId;
  const getPaneRuntime = panes.getPaneRuntime;
  const getNoteByKey = panes.getNoteByKey;
  const getOpenContext = panes.getOpenContext;
  const getNavigationContext = panes.getNavigationContext;
  const activatePaneSession = panes.activatePaneSession;
  const setPaneDocumentSession = panes.setPaneDocumentSession;
  const getPaneTitleInput = panes.getPaneTitleInput;
  const getPaneEditorRoot = panes.getPaneEditorRoot;
  const updateSelectedRelatedText = panes.updateSelectedRelatedText;
  const closeWikilinkAutocomplete = panes.closeWikilinkAutocomplete;

  const cancelPendingAutosave = persistence.cancelPendingAutosave;
  const enqueueSave = persistence.enqueueSave;
  const invalidatePendingSaveResults = persistence.invalidatePendingSaveResults;
  const scheduleAutosave = persistence.scheduleAutosave;
  const hasCleanBuffer = persistence.hasCleanBuffer;
  const getNoteSaveQueue = persistence.getNoteSaveQueue;

  const clearSearch = derivedViews.clearSearch;
  const scheduleSearchIfNeeded = derivedViews.scheduleSearchIfNeeded;
  const scheduleRelatedIfNeeded = derivedViews.scheduleRelatedIfNeeded;
  const clearSelectedRelatedText = derivedViews.clearSelectedRelatedText;
  const loadRecentNotes = derivedViews.loadRecentNotes;
  const setRecentlyForgotten = derivedViews.setRecentlyForgotten;

  const flushDocumentEditorSync = documentSync.flushDocumentEditorSync;
  const flushAllPendingDocumentSyncs = documentSync.flushAllPendingDocumentSyncs;
  const hasPendingDocumentSync = documentSync.hasPendingSync;

  const isRefreshingFromDisk = refresh.isRefreshingFromDisk;
  const setRefreshingFromDisk = refresh.setRefreshingFromDisk;

  const paneCommands = createPaneCommandGroup<TPaneId, NoteDraftState>({
    getPaneTitleInput,
    getPaneEditorRoot,
    getPaneDocument,
    flushDocumentEditorSync,
    activatePaneSession,
    updateSelectedRelatedText,
    scheduleSearchIfNeeded,
    scheduleRelatedIfNeeded
  });
  const { activatePane, focusPaneAfterShortcut } = paneCommands;

  async function refreshCurrentNoteFromDisk(options: { force?: boolean } = {}) {
    const note = getNavigationDocument();
    const currentPath = note.currentNotePath;
    const force = options.force ?? false;
    const editorReady = getEditorPaneCountForNote(note.key) > 0
      || getPaneOrder().some(
        (paneId) => getPaneDocument(paneId).key === note.key && getPaneRuntime(paneId).ui.isEditorReady
      );
    if (
      !currentPath ||
      !editorReady ||
      isRefreshingFromDisk() ||
      (!force && !hasCleanBuffer(note))
    ) {
      return;
    }

    setRefreshingFromDisk(true);
    try {
      const session = await readNoteSession(note.currentNoteId, currentPath);
      if (getNavigationDocument().key !== note.key || (!force && !hasCleanBuffer(note))) {
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

      applySnapshotToNote(note, session);
      setRecentlyForgotten(null);
      await documents.replaceEditorContentInPlace(session.bodyMarkdown);
      clearSelectedRelatedText();
      scheduleSearchIfNeeded();
      scheduleRelatedIfNeeded({ immediate: true });
    } catch (error) {
      console.error('Failed to refresh note from disk:', error);
    } finally {
      setRefreshingFromDisk(false);
    }
  }

  async function refreshCurrentNoteIfChanged() {
    await refreshCurrentNoteFromDisk();
  }

  async function refreshCurrentNoteFromTaskMutation() {
    await refreshCurrentNoteFromDisk({ force: true });
  }

  async function openStartPaneCommand(paneId: TPaneId, noteKey: NoteKey) {
    await loadRecentNotes();
    beginPaneCommand(paneId, noteKey, 'start');
    activatePaneSession(paneId);
    await tick();
    await paneLifecycle.ensurePaneEditors();
    updateSelectedRelatedText(paneId);
    await focusEditorAtEnd(getPaneEditorRoot(paneId));
  }

  async function clearNotepad(options: { canRestore?: boolean } = {}) {
    const canRestore = options.canRestore ?? true;
    const paneId = getNavigationPaneId();
    const note = getNavigationDocument();
    const notePathToClear = note.currentNotePath;

    if (notePathToClear) {
      documents.saveCursorPositionForDocument(note);
      documents.saveSharedEditorStateForDocument(note);
      cancelPendingAutosave(note);
      await enqueueSave(note);
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
        const forgottenNoteSummary = await forgetNoteSession(
          notePathToClear,
          forgottenNoteRetentionPreference()
        );
        forgottenPath = forgottenNoteSummary?.forgottenPath ?? null;
      } catch (error) {
        console.error('Failed to forget note:', error);
        setNoteStatus(note, 'error');
        return;
      }
    }

    invalidatePendingSaveResults(note);
    cancelPendingAutosave(note);
    documents.discardSharedEditorStateForDocument(note);
    const freshDraft = replaceReferencedNoteWithFreshDraft(state, note.key);
    cleanupNoteRuntime(note.key);
    setRecentlyForgotten(
      canRestore && hasDraftContent ? createForgottenNote(draft, forgottenPath) : null
    );
    await documents.replaceNoteAcrossPanes(note, freshDraft);
    clearSelectedRelatedText();
    scheduleSearchIfNeeded();
    scheduleRelatedIfNeeded({ immediate: true });
    await openStartPaneCommand(paneId, freshDraft.key);
  }

  async function unforgetNotepad() {
    const forgottenNote = state.recentlyForgotten;
    if (!forgottenNote) {
      return;
    }

    resetPaneCommand();

    if (forgottenNote.forgottenPath) {
      try {
        const restoredNotes = await restoreForgottenNotes([forgottenNote.forgottenPath]);
        const restoredPath = restoredNotes[0]?.restoredPath;
        if (!restoredPath) {
          return;
        }

        const paneId = getActivePaneId();
        const requestGeneration = getPaneRuntime(paneId).bumpOpenRequestGeneration();
        const previousNote = getNavigationDocument();
        const session = await openNoteSession(null, restoredPath);
        if (getPaneRuntime(paneId).getOpenRequestGeneration() !== requestGeneration) {
          return;
        }
        const restoredNote = adoptSnapshotForPane(state, paneId, session);
        setRecentlyForgotten(null);
        await documents.replaceNoteAcrossPanes(previousNote, restoredNote, { restoreCursor: true });
        clearSelectedRelatedText();
        scheduleSearchIfNeeded();
        scheduleRelatedIfNeeded({ immediate: true });
        void loadRecentNotes();
        return;
      } catch (error) {
        console.error('Failed to restore forgotten note:', error);
        return;
      }
    }

    const note = getNavigationDocument();
    applySnapshotToNote(note, {
      ...forgottenNote,
      lastSavedTitle: '',
      lastSavedMarkdown: '',
      lastSavedNoteId: null,
      lastSavedPath: null
    });
    setRecentlyForgotten(null);
    await documents.replaceEditorContent(note.bodyMarkdown);
    scheduleAutosave(note);
    clearSelectedRelatedText();
    scheduleSearchIfNeeded();
    scheduleRelatedIfNeeded({ immediate: true });
    void loadRecentNotes();
  }

  async function rememberCurrentNote() {
    flushAllPendingDocumentSyncs();
    documents.flushAllPendingCursorSaves();
    const note = getNavigationDocument();
    documents.saveCursorPositionForDocument(note);
    documents.saveSharedEditorStateForDocument(note);
    cancelPendingAutosave(note);
    await getNoteSaveQueue(note.key);
    const operationRevision = note.operationRevision;
    setNoteStatus(note, 'remembering');

    await rememberNoteSession(note.title, note.bodyMarkdown, note.currentNotePath);

    if (note.operationRevision !== operationRevision) {
      return;
    }

    setRecentlyForgotten(null);
    invalidatePendingSaveResults(note);
    cancelPendingAutosave(note);
    documents.discardSharedEditorStateForDocument(note);
    const freshDraft = replaceReferencedNoteWithFreshDraft(state, note.key);
    await documents.replaceNoteAcrossPanes(note, freshDraft);
    clearSearch();
    clearSelectedRelatedText();
    scheduleSearchIfNeeded();
    scheduleRelatedIfNeeded({ immediate: true });
    void loadRecentNotes();
  }

  async function startNewNoteFlow() {
    let paneId = getNavigationPaneId();
    let note = getNavigationDocument();

    if (hasContent(note)) {
      await rememberCurrentNote();
      paneId = getNavigationPaneId();
      note = getNavigationDocument();
    }

    await openStartPaneCommand(paneId, note.key);
  }

  async function openNotePath(
    notePath: string | null,
    options: {
      noteId?: string | null;
      currentNoteAlreadySaved?: boolean;
      focusEditorAfterOpen?: boolean;
    } = {}
  ) {
    const paneId = getActivePaneId();
    const previousDocument = getPaneDocument(paneId);
    if (!options.noteId && !notePath) {
      return;
    }

    resetPaneCommand();

    if (hasPendingDocumentSync(previousDocument)) {
      flushDocumentEditorSync(previousDocument);
    }
    documents.flushAllPendingCursorSaves();
    documents.saveCursorPositionForDocument(previousDocument);
    documents.saveSharedEditorStateForDocument(previousDocument);
    if (
      !(options.currentNoteAlreadySaved ?? false) &&
      (previousDocument.currentNoteId !== (options.noteId ?? null) ||
        previousDocument.currentNotePath !== notePath)
    ) {
      cancelPendingAutosave(previousDocument);
      void enqueueSave(previousDocument);
    }

    const requestGeneration = getPaneRuntime(paneId).bumpOpenRequestGeneration();
    const isStale = () =>
      getPaneRuntime(paneId).getOpenRequestGeneration() !== requestGeneration;
    setNoteStatus(previousDocument, 'opening');

    let session;
    try {
      session = await openNoteSession(options.noteId ?? null, notePath);
    } catch (error) {
      if (isStale()) {
        return;
      }
      throw error;
    }
    if (isStale()) {
      return;
    }

    const nextDocument = adoptSnapshotForPane(state, paneId, session);
    setRecentlyForgotten(null);
    closeWikilinkAutocomplete(paneId);
    clearSelectedRelatedText();

    if (
      getPaneRuntime(paneId).ui.isEditorReady &&
      getPaneKind(paneId) === 'editor' &&
      getPaneRuntime(paneId).controller
    ) {
      await documents.replaceNoteAcrossPanes(previousDocument, nextDocument, { restoreCursor: true });
      if (isStale()) {
        // A newer open superseded us while replacing the editor buffer; do
        // not reset focus or status — that would yank the user out of the
        // newer note.
        return;
      }
    }

    if ((options.focusEditorAfterOpen ?? true) && getPaneKind(paneId) === 'editor') {
      await tick();
      if (isStale()) {
        return;
      }
      focusPaneAfterShortcut(paneId, { preferTitle: false });
    }

    setNoteStatus(nextDocument, 'idle');
    if (!getNoteByKey(previousDocument.key)) {
      cleanupNoteRuntime(previousDocument.key);
    }
    scheduleRelatedIfNeeded({ immediate: true });
  }

  async function splitWorkspace() {
    const order = getPaneOrder();
    if (order.length === 2) {
      const [, secondary] = order;
      activatePaneSession(secondary);
      await tick();
      focusPaneAfterShortcut(secondary, {
        preferTitle: document.activeElement === getPaneTitleInput(getActivePaneId())
      });
      return;
    }

    const sourcePaneId = order[0] ?? getActivePaneId();
    const [primary, secondary] = paneIdsAll;
    const targetPaneId = sourcePaneId === primary ? secondary : primary;
    const sharedDocument = getPaneDocument(sourcePaneId);

    await loadRecentNotes();

    const placeholderDraft = createFreshDraftNote(state);
    setStoredPaneKind(state, targetPaneId, 'editor');
    setPaneDocumentSession(targetPaneId, placeholderDraft);
    beginPaneCommand(targetPaneId, sharedDocument.key, 'split');

    setPaneOrder([primary, secondary]);
    activatePaneSession(targetPaneId);
    await tick();
    await paneLifecycle.ensurePaneEditors();
    updateSelectedRelatedText(targetPaneId);
    await focusEditorAtEnd(getPaneEditorRoot(targetPaneId));
  }

  async function closePane(paneId: TPaneId) {
    const order = getPaneOrder();
    if (order.length === 1) {
      return;
    }

    const wasPaneCommand = getPaneCommandPaneId() === paneId;
    const orphanPlaceholderKey = wasPaneCommand ? getPaneDocument(paneId).key : null;

    removePane(paneId);

    if (wasPaneCommand) {
      resetPaneCommand();
      const remainingOrder = getPaneOrder();
      const anchorPane = (remainingOrder[0] ?? primaryPaneId) as TPaneId;
      setPaneDocumentSession(paneId, getPaneDocument(anchorPane));
      setStoredPaneKind(state, paneId, 'editor');
      if (orphanPlaceholderKey) {
        removeNoteIfUnreferenced(state, orphanPlaceholderKey);
        cleanupNoteRuntime(orphanPlaceholderKey);
      }
    }

    if (getPaneRuntime(paneId).controller) {
      await paneLifecycle.ensurePaneEditors();
    }

    activatePaneSession(((getPaneOrder()[0] ?? primaryPaneId) as TPaneId));
    updateSelectedRelatedText();
  }

  async function setPaneKind(paneId: TPaneId, kind: PaneKind) {
    if (kind === getPaneKind(paneId)) {
      return;
    }

    const document = getPaneDocument(paneId);
    setStoredPaneKind(state, paneId, kind);
    activatePaneSession(paneId);
    await tick();
    await paneLifecycle.ensurePaneEditors();
    flushDocumentEditorSync(document);
    updateSelectedRelatedText();
  }

  async function handleBottomBarCommand(command: string): Promise<boolean> {
    const normalized = command.trim().toLowerCase();
    switch (normalized) {
      case '/chat':
        clearSearch();
        await setPaneKind(getActivePaneId(), 'chat');
        return true;
      case '/edit':
        clearSearch();
        await setPaneKind(getActivePaneId(), 'editor');
        return true;
      default:
        return false;
    }
  }

  async function switchActivePane(direction: 1 | -1 = 1) {
    const currentPaneId = getActivePaneId();
    const nextPaneId = getNextPaneId(currentPaneId, direction);
    if (!nextPaneId) {
      return;
    }

    const preferTitle = document.activeElement === getPaneTitleInput(currentPaneId);
    activatePane(nextPaneId);
    await tick();
    focusPaneAfterShortcut(nextPaneId, { preferTitle });
  }

  function movePaneCommandHighlight(direction: 1 | -1) {
    setPaneCommandHighlight(
      getNextPaneCommandIndex(
        getPaneCommandHighlightedIndex(),
        direction,
        getPaneCommandPreviousItem() !== null,
        getPaneCommandMode()
      )
    );
  }

  async function finalizePaneCommandSelection(paneId: TPaneId) {
    await tick();
    await paneLifecycle.ensurePaneEditors();
    updateSelectedRelatedText(paneId);
    scheduleSearchIfNeeded();
    scheduleRelatedIfNeeded({ immediate: true });
  }

  async function resolvePaneCommandChoice(paneId: TPaneId, choice: PaneCommandChoice) {
    if (getPaneCommandPaneId() !== paneId) {
      return;
    }

    const sourceKey = getPaneCommandSourceNoteKey();
    const previousItem = getPaneCommandPreviousItem();
    const placeholderDocument = getPaneDocument(paneId);
    const placeholderKey = placeholderDocument.key;

    resetPaneCommand();
    activatePaneSession(paneId);

    if (choice === 'typing') {
      await finalizePaneCommandSelection(paneId);
      await focusEditorAtEnd(getPaneEditorRoot(paneId));
      return;
    }

    if (choice === 'current') {
      if (!sourceKey) return;

      const shared = getNoteByKey(sourceKey);
      if (!shared) return;

      setStoredPaneKind(state, paneId, 'editor');
      setPaneDocumentSession(paneId, shared);

      if (
        getPaneKind(paneId) === 'editor' &&
        getPaneRuntime(paneId).controller
      ) {
        await documents.replaceNoteAcrossPanes(placeholderDocument, shared, {
          restoreCursor: true
        });
      }

      if (placeholderKey !== shared.key) {
        removeNoteIfUnreferenced(state, placeholderKey);
        cleanupNoteRuntime(placeholderKey);
      }
      await finalizePaneCommandSelection(paneId);
      flushDocumentEditorSync(shared);
      return;
    }

    if (choice === 'previous') {
      if (!previousItem) return;

      setStoredPaneKind(state, paneId, 'editor');
      if (previousItem.notePath) {
        await openNotePath(previousItem.notePath, { noteId: previousItem.noteId ?? null });
      } else {
        await openSearchResult(getOpenContext(), getNavigationContext(paneId), previousItem);
      }

      await finalizePaneCommandSelection(paneId);
      return;
    }

    if (choice === 'thoughtPartner') {
      setStoredPaneKind(state, paneId, 'chat');
      const chatDraft = createFreshDraftNote(state);
      setPaneDocumentSession(paneId, chatDraft);
      removeNoteIfUnreferenced(state, placeholderKey);
      cleanupNoteRuntime(placeholderKey);
      await finalizePaneCommandSelection(paneId);
      return;
    }
  }

  async function confirmPaneCommandChoiceByHighlight() {
    const paneId = getPaneCommandPaneId();
    if (!paneId) return;

    const choice = getPaneCommandChoiceByIndex(
      getPaneCommandHighlightedIndex(),
      getPaneCommandPreviousItem() !== null,
      getPaneCommandMode()
    );
    if (choice) {
      await resolvePaneCommandChoice(paneId, choice);
    }
  }

  function handlePaneCommandGlobalKeydown(event: KeyboardEvent): boolean {
    const pickerPaneId = getPaneCommandPaneId();
    if (pickerPaneId === null || getActivePaneId() !== pickerPaneId || event.repeat) {
      return false;
    }

    const target = event.target;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement
    ) {
      return false;
    }

    if (target instanceof HTMLElement && target.closest('[data-notepad-bottom-bar]')) {
      return false;
    }

    if (event.metaKey || event.ctrlKey || event.altKey) {
      return false;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      movePaneCommandHighlight(1);
      return true;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      movePaneCommandHighlight(-1);
      return true;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      void confirmPaneCommandChoiceByHighlight();
      return true;
    }

    const shortcutChoice = getPaneCommandForShortcut(
      event.key,
      getPaneCommandPreviousItem() !== null,
      getPaneCommandMode()
    );
    if (shortcutChoice === null) {
      if (event.key.length === 1 || event.key === 'Backspace' || event.key === 'Delete') {
        resetPaneCommand();
      }
      return false;
    }

    event.preventDefault();
    void resolvePaneCommandChoice(pickerPaneId, shortcutChoice);
    return true;
  }

  return {
    activatePane,
    focusPaneAfterShortcut,
    refreshCurrentNoteIfChanged,
    refreshCurrentNoteFromTaskMutation,
    clearNotepad,
    unforgetNotepad,
    rememberCurrentNote,
    startNewNoteFlow,
    openNotePath,
    splitWorkspace,
    closePane,
    setPaneKind,
    handleBottomBarCommand,
    switchActivePane,
    resolvePaneCommandChoice,
    handlePaneCommandGlobalKeydown,
    movePaneCommandHighlight,
    confirmPaneCommandChoiceByHighlight
  };
}

export type NotepadCommands<TPaneId extends string> = ReturnType<
  typeof createNotepadCommands<TPaneId>
>;
