import { tick } from 'svelte';
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
  addPane,
  adoptSnapshotForPane,
  applySnapshotToNote,
  createFreshDraftNote,
  getPaneState,
  removePane as removeStoredPane,
  removeNoteIfUnreferenced,
  replaceReferencedNoteWithFreshDraft,
  setNoteStatus,
  setPaneChatConversationId,
  setPaneKind as setStoredPaneKind,
  type NoteDraftState,
  type NoteKey,
} from '$lib/features/notepad/state/noteStore';
import {
  cleanupNoteRuntime,
  getEditorPaneCountForNote
} from '$lib/features/notepad/session/noteRuntime';
import {
  editorLocationFromRecent,
  loadPersistedChatLocation,
  locationDisplayLabel,
  locationsEqual,
  notepadLocationMru,
  type LocationHistoryEntry,
  type NavLocation
} from '$lib/features/notepad/navigation/locationMru';
import { createPaneCommandGroup } from './paneCommandGroup';
import type { NotepadCommandsDeps, PaneKind } from './notepadCommandFacades';

export type { NotepadCommandsDeps } from './notepadCommandFacades';
export type { LocationHistoryEntry, NavLocation } from '$lib/features/notepad/navigation/locationMru';

export function createNotepadCommands<TPaneId extends string>(deps: NotepadCommandsDeps<TPaneId>) {
  const { state, maxVisiblePanes, workspace, panes, persistence, derivedViews, documentSync, documents, paneLifecycle, refresh, forgottenNoteRetentionPreference } = deps;

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

  const getPaneKind = panes.getPaneKind;
  const getPaneDocument = panes.getPaneDocument;
  const getNavigationDocument = panes.getNavigationDocument;
  const getNavigationPaneId = panes.getNavigationPaneId;
  const getNextPaneId = panes.getNextPaneId;
  const getPaneRuntime = panes.getPaneRuntime;
  const getNoteByKey = panes.getNoteByKey;
  const activatePaneSession = panes.activatePaneSession;
  const setPaneDocumentSession = panes.setPaneDocumentSession;
  const getPaneTitleInput = panes.getPaneTitleInput;
  const getPaneEditorRoot = panes.getPaneEditorRoot;
  const createPane = panes.createPane;
  const closePaneRuntime = panes.closePaneRuntime;
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
  const getRecentNotesForSeed = derivedViews.getRecentNotesForSeed;
  const setRecentlyForgotten = derivedViews.setRecentlyForgotten;

  const flushDocumentEditorSync = documentSync.flushDocumentEditorSync;
  const flushAllPendingDocumentSyncs = documentSync.flushAllPendingDocumentSyncs;
  const hasPendingDocumentSync = documentSync.hasPendingSync;

  const isRefreshingFromDisk = refresh.isRefreshingFromDisk;
  const setRefreshingFromDisk = refresh.setRefreshingFromDisk;

  const locationMru = notepadLocationMru;
  let suppressLocationTouch = false;
  let locationHistoryEpoch = 0;
  let onLocationHistoryEpochChange: ((epoch: number) => void) | null = null;

  function bumpLocationHistoryEpoch() {
    locationHistoryEpoch += 1;
    onLocationHistoryEpochChange?.(locationHistoryEpoch);
  }

  function setLocationHistoryEpochListener(listener: ((epoch: number) => void) | null) {
    onLocationHistoryEpochChange = listener;
    listener?.(locationHistoryEpoch);
  }

  function capturePaneLocation(paneId: TPaneId): NavLocation | null {
    const pane = getPaneState(state, paneId);
    const document = getPaneDocument(paneId);
    if (pane.kind === 'chat') {
      return {
        kind: 'chat',
        conversationId: pane.chatConversationId,
        contextNoteId: document.currentNoteId,
        contextNotePath: document.currentNotePath
      };
    }
    if (!document.currentNoteId && !document.currentNotePath) {
      return null;
    }
    return {
      kind: 'editor',
      noteId: document.currentNoteId,
      notePath: document.currentNotePath
    };
  }

  function touchCurrentLocation(paneId: TPaneId = getActivePaneId()) {
    if (suppressLocationTouch) {
      return;
    }
    const current = capturePaneLocation(paneId);
    if (current) {
      locationMru.touch(paneId, current);
      bumpLocationHistoryEpoch();
    }
  }

  function touchLocation(paneId: TPaneId, location: NavLocation | null) {
    if (suppressLocationTouch || !location) {
      return;
    }
    locationMru.touch(paneId, location);
    bumpLocationHistoryEpoch();
  }

  async function ensureLocationMruSeeded(paneId: TPaneId) {
    if (locationMru.list(paneId).length > 0) {
      return;
    }
    await loadRecentNotes();
    // Re-check after await: navigation may have touched the MRU meanwhile.
    if (locationMru.list(paneId).length > 0) {
      return;
    }
    const seeded = getRecentNotesForSeed()
      .map((item) =>
        editorLocationFromRecent({
          noteId: item.noteId,
          notePath: item.notePath
        })
      )
      .filter((location): location is NavLocation => location !== null);
    const persistedChat = await loadPersistedChatLocation();
    if (persistedChat) {
      seeded.unshift(persistedChat);
    }
    locationMru.seedIfEmpty(paneId, seeded);
    if (locationMru.list(paneId).length > 0) {
      bumpLocationHistoryEpoch();
    }
  }

  async function restoreLocation(paneId: TPaneId, location: NavLocation) {
    suppressLocationTouch = true;
    try {
      activatePaneSession(paneId);

      if (location.kind === 'editor') {
        // Load the target note before revealing the editor so leaving chat
        // does not briefly paint the chat context note (often the 2nd recent).
        await openNotePath(location.notePath, {
          noteId: location.noteId,
          focusEditorAfterOpen: true,
          revealEditorAfterOpen: true
        });
        return;
      }

      // Remember chat before restore so Recent keeps the slot even if a
      // mid-navigation history refresh runs while chat is current.
      locationMru.rememberChat(paneId, location);

      const document = getPaneDocument(paneId);
      const needsContextNote =
        (location.contextNoteId || location.contextNotePath) &&
        (document.currentNoteId !== location.contextNoteId ||
          document.currentNotePath !== location.contextNotePath);
      if (needsContextNote) {
        await openNotePath(location.contextNotePath, {
          noteId: location.contextNoteId,
          focusEditorAfterOpen: false
        });
      }

      // Set conversation id before flipping to chat so ChatPanel mounts with it.
      setPaneChatConversationId(state, paneId, location.conversationId);
      if (getPaneKind(paneId) !== 'chat') {
        setStoredPaneKind(state, paneId, 'chat');
        await tick();
        await paneLifecycle.ensurePaneEditors();
        updateSelectedRelatedText();
      }
    } finally {
      suppressLocationTouch = false;
      // Refresh history after navigation settles so an in-flight refresh that
      // still saw chat as "current" cannot stick a chat-less list in the UI.
      bumpLocationHistoryEpoch();
    }
  }

  async function goToPreviousLocation(paneId: TPaneId = getActivePaneId()) {
    activatePaneSession(paneId);
    const current = capturePaneLocation(paneId);
    await ensureLocationMruSeeded(paneId);
    const previous = locationMru.previousExcluding(paneId, current);
    if (!previous) {
      // No MRU target (e.g. fresh chat): still leave chat for the bound note.
      if (getPaneKind(paneId) === 'chat') {
        setStoredPaneKind(state, paneId, 'editor');
        await tick();
        await paneLifecycle.ensurePaneEditors();
        flushDocumentEditorSync(getPaneDocument(paneId));
        updateSelectedRelatedText();
        bumpLocationHistoryEpoch();
      }
      return;
    }
    touchLocation(paneId, current);
    await restoreLocation(paneId, previous);
  }

  function findPaneCommandReferencePaneId(targetPaneId: TPaneId): TPaneId {
    if (getPaneCommandMode() !== 'split') {
      return targetPaneId;
    }
    const sourceKey = getPaneCommandSourceNoteKey();
    if (!sourceKey) {
      return targetPaneId;
    }
    return (
      getPaneOrder().find(
        (paneId) => paneId !== targetPaneId && getPaneDocument(paneId).key === sourceKey
      ) ?? targetPaneId
    );
  }

  async function resolvePreviousLocationForPaneCommand(
    targetPaneId: TPaneId
  ): Promise<NavLocation | null> {
    const referencePaneId = findPaneCommandReferencePaneId(targetPaneId);
    await ensureLocationMruSeeded(referencePaneId);
    return locationMru.previousExcluding(referencePaneId, capturePaneLocation(referencePaneId));
  }

  function peekPreviousLocationForPaneCommand(targetPaneId: TPaneId): NavLocation | null {
    const referencePaneId = findPaneCommandReferencePaneId(targetPaneId);
    return locationMru.previousExcluding(referencePaneId, capturePaneLocation(referencePaneId));
  }

  function paneCommandPreviousLocationLabel(targetPaneId: TPaneId): string | null {
    const previous = peekPreviousLocationForPaneCommand(targetPaneId);
    return previous ? locationDisplayLabel(previous) : null;
  }

  function peekLocationHistory(paneId: TPaneId = getActivePaneId()): LocationHistoryEntry[] {
    return locationMru.historyExcluding(paneId, capturePaneLocation(paneId));
  }

  async function listLocationHistory(
    paneId: TPaneId = getActivePaneId()
  ): Promise<LocationHistoryEntry[]> {
    // Snapshot current before any await so a seed load cannot race with a
    // mid-flight pane-kind change and drop chat from the visible list.
    const current = capturePaneLocation(paneId);
    await ensureLocationMruSeeded(paneId);
    const settled = capturePaneLocation(paneId) ?? current;
    return locationMru.historyExcluding(paneId, settled);
  }

  async function openLocationFromHistory(location: NavLocation) {
    const paneId = getActivePaneId();
    const current = capturePaneLocation(paneId);
    if (current && locationsEqual(current, location)) {
      return;
    }
    touchLocation(paneId, current);
    await restoreLocation(paneId, location);
  }

  const paneCommands = createPaneCommandGroup<TPaneId, NoteDraftState>({
    getPaneTitleInput,
    getPaneEditorRoot,
    getPaneChatComposer: panes.getPaneChatComposer,
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
    await ensureLocationMruSeeded(paneId);
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

  async function rememberCurrentNoteForPane(paneId: TPaneId) {
    flushAllPendingDocumentSyncs();
    documents.flushAllPendingCursorSaves();
    const note = getPaneDocument(paneId);
    documents.saveCursorPositionForDocument(note);
    documents.saveSharedEditorStateForDocument(note);
    cancelPendingAutosave(note);
    await getNoteSaveQueue(note.key);
    const operationRevision = note.operationRevision;
    setNoteStatus(note, 'remembering');

    await rememberNoteSession(note.title, note.bodyMarkdown, note.currentNotePath);

    if (note.operationRevision !== operationRevision) {
      return note;
    }

    setNoteStatus(note, 'idle');
    setRecentlyForgotten(null);
    invalidatePendingSaveResults(note);
    cancelPendingAutosave(note);

    const freshDraft = createFreshDraftNote(state);
    setPaneDocumentSession(paneId, freshDraft);
    await documents.replacePaneDocument(paneId, note, freshDraft);
    clearSearch();
    clearSelectedRelatedText();
    scheduleSearchIfNeeded();
    scheduleRelatedIfNeeded({ immediate: true });
    void loadRecentNotes();
    return freshDraft;
  }

  async function startNewNoteFlow() {
    let paneId = getNavigationPaneId();
    let note = getNavigationDocument();

    if (hasContent(note)) {
      await rememberCurrentNoteForPane(paneId);
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
      /** Leave chat only after the target note is loaded (avoids flashing chat context). */
      revealEditorAfterOpen?: boolean;
    } = {}
  ) {
    const paneId = getActivePaneId();
    const previousDocument = getPaneDocument(paneId);
    if (!options.noteId && !notePath) {
      return;
    }

    const targetLocation: NavLocation = {
      kind: 'editor',
      noteId: options.noteId ?? null,
      notePath
    };
    const currentLocation = capturePaneLocation(paneId);
    const isSameEditorLocation =
      currentLocation?.kind === 'editor' && locationsEqual(currentLocation, targetLocation);

    if (!suppressLocationTouch && currentLocation && !isSameEditorLocation) {
      locationMru.touch(paneId, currentLocation);
      bumpLocationHistoryEpoch();
    }

    // Leave chat after the note loads so we never paint the chat context note first.
    // restoreLocation passes revealEditorAfterOpen; user opens use !suppressLocationTouch.
    // Chat-context rebinds keep suppress on and omit reveal so the pane stays in chat.
    const leavingChat =
      getPaneKind(paneId) === 'chat' &&
      (!suppressLocationTouch || Boolean(options.revealEditorAfterOpen));

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

    if (leavingChat) {
      setStoredPaneKind(state, paneId, 'editor');
      await tick();
      if (isStale()) {
        return;
      }
      await paneLifecycle.ensurePaneEditors();
      flushDocumentEditorSync(getPaneDocument(paneId));
      updateSelectedRelatedText();
    }

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
    if (!suppressLocationTouch) {
      bumpLocationHistoryEpoch();
    }
  }

  async function splitWorkspace() {
    const order = getPaneOrder();
    if (order.length >= maxVisiblePanes) {
      const activePaneId = getActivePaneId();
      const targetPaneId = getNextPaneId(activePaneId) ?? order.find((paneId) => paneId !== activePaneId);
      if (!targetPaneId) {
        return;
      }
      activatePaneSession(targetPaneId);
      await tick();
      focusPaneAfterShortcut(targetPaneId, {
        preferTitle: document.activeElement === getPaneTitleInput(getActivePaneId())
      });
      return;
    }

    const sourcePaneId = order[0] ?? getActivePaneId();
    const targetPaneId = createPane();
    const sharedDocument = getPaneDocument(sourcePaneId);

    await loadRecentNotes();
    await ensureLocationMruSeeded(sourcePaneId);

    const placeholderDraft = createFreshDraftNote(state);
    addPane(state, targetPaneId, placeholderDraft.key, 'editor');
    setStoredPaneKind(state, targetPaneId, 'editor');
    setPaneDocumentSession(targetPaneId, placeholderDraft);
    beginPaneCommand(targetPaneId, sharedDocument.key, 'split');

    setPaneOrder([...order, targetPaneId]);
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
    }

    await closePaneRuntime(paneId);
    removeStoredPane(state, paneId);
    if (orphanPlaceholderKey) {
      removeNoteIfUnreferenced(state, orphanPlaceholderKey);
      cleanupNoteRuntime(orphanPlaceholderKey);
    }

    const remainingPaneId = getPaneOrder()[0];
    if (!remainingPaneId) {
      return;
    }
    activatePaneSession(remainingPaneId);
    updateSelectedRelatedText();
  }

  async function setPaneKind(paneId: TPaneId, kind: PaneKind) {
    if (kind === getPaneKind(paneId)) {
      return;
    }

    touchCurrentLocation(paneId);

    const document = getPaneDocument(paneId);
    setStoredPaneKind(state, paneId, kind);
    if (kind === 'chat') {
      // Persist the chat slot as soon as we enter thought partner, not only
      // when leaving — so Recent keeps it across later note↔note jumps.
      touchLocation(paneId, {
        kind: 'chat',
        conversationId: getPaneState(state, paneId).chatConversationId,
        contextNoteId: document.currentNoteId,
        contextNotePath: document.currentNotePath
      });
    }
    activatePaneSession(paneId);
    await tick();
    await paneLifecycle.ensurePaneEditors();
    flushDocumentEditorSync(document);
    updateSelectedRelatedText();
    bumpLocationHistoryEpoch();
  }

  async function handleNotepadCommandBarCommand(command: string): Promise<boolean> {
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
    const pickerPaneId = getPaneCommandPaneId();
    const hasPrevious =
      pickerPaneId !== null && peekPreviousLocationForPaneCommand(pickerPaneId) !== null;
    setPaneCommandHighlight(
      getNextPaneCommandIndex(
        getPaneCommandHighlightedIndex(),
        direction,
        hasPrevious,
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
    const previousLocation =
      choice === 'previous' ? await resolvePreviousLocationForPaneCommand(paneId) : null;
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

      touchCurrentLocation(paneId);
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
      if (!previousLocation) return;

      // Same-pane previous (start picker / Cmd+L) shares goToPreviousLocation.
      // Split fills this pane with the reference pane's previous without touching
      // that pane's MRU order beyond what restore needs.
      if (findPaneCommandReferencePaneId(paneId) === paneId) {
        await goToPreviousLocation(paneId);
      } else {
        await restoreLocation(paneId, previousLocation);
      }
      await finalizePaneCommandSelection(paneId);
      return;
    }

    if (choice === 'thoughtPartner') {
      const sourceNote = sourceKey ? getNoteByKey(sourceKey) : null;
      if (sourceNote) {
        touchLocation(paneId, {
          kind: 'editor',
          noteId: sourceNote.currentNoteId,
          notePath: sourceNote.currentNotePath
        });
      } else {
        touchCurrentLocation(paneId);
      }
      setStoredPaneKind(state, paneId, 'chat');
      // Keep the source note associated with the pane as an explicit insertion
      // target. Conversation identity lives on PaneState, never in NoteDraftState.
      if (sourceNote) {
        setPaneDocumentSession(paneId, sourceNote);
      }
      if (placeholderKey !== sourceKey) {
        removeNoteIfUnreferenced(state, placeholderKey);
        cleanupNoteRuntime(placeholderKey);
      }
      await finalizePaneCommandSelection(paneId);
      return;
    }
  }

  async function confirmPaneCommandChoiceByHighlight() {
    const paneId = getPaneCommandPaneId();
    if (!paneId) return;

    const choice = getPaneCommandChoiceByIndex(
      getPaneCommandHighlightedIndex(),
      peekPreviousLocationForPaneCommand(paneId) !== null,
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

    if (target instanceof HTMLElement && target.closest('[data-notepad-command-bar]')) {
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
      peekPreviousLocationForPaneCommand(pickerPaneId) !== null,
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
    touchCurrentLocation,
    goToPreviousLocation,
    listLocationHistory,
    peekLocationHistory,
    openLocationFromHistory,
    paneCommandPreviousLocationLabel,
    peekPreviousLocationForPaneCommand,
    resolvePreviousLocationForPaneCommand,
    ensureLocationMruSeeded,
    setLocationHistoryEpochListener,
    handleNotepadCommandBarCommand,
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
