import { tick } from 'svelte';
import type {
  CleanUpApplyPolicyPreference,
  ForgottenNoteRetentionPreference
} from '$lib/appSettings';
import {
  EXACT_REMEMBER_ACTION,
  rememberActionRequiresIntegrateSupport,
  type RememberActionOption
} from '$lib/types/ai';
import {
  openSearchResult,
  type NavigationContext,
  type OpenContext
} from '$lib/features/notepad/navigation/openFlow';
import {
  createForgottenNote,
  forgetNoteSession,
  hasContent,
  openNoteSession,
  readNoteSession,
  rememberWithAction,
  restoreForgottenNotes,
  type ForgottenNote
} from '$lib/features/notepad/session/session';
import { findCmContentElement } from '$lib/features/notepad/editor/editorDom';
import { focusInputAtEnd } from '$lib/features/notepad/navigation/navigation';
import {
  getSplitChoiceByIndex,
  getSplitChoiceForShortcut,
  getNextSplitChoiceIndex,
  type SplitChoice
} from '$lib/features/notepad/splitPanePicker';
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
  type NotepadState
} from '$lib/features/notepad/state/noteStore';
import {
  cleanupNoteRuntime,
  getEditorPaneCountForNote
} from '$lib/features/notepad/session/noteRuntime';
import type { DocumentPaneCoordinator } from '$lib/features/notepad/document/documentPaneCoordinator';
import type { PaneEditorLifecycle } from '$lib/features/notepad/pane/paneEditorLifecycle';
import type { PaneRuntime } from '$lib/features/notepad/pane/paneRuntime.svelte';
import type { SearchItem } from '$lib/types/semantic';

type PaneKind = 'editor' | 'chat';

export interface NotepadCommandsDeps<TPaneId extends string> {
  // ---- state references ----
  state: NotepadState<TPaneId>;
  primaryPaneId: TPaneId;
  /** Tuple of all known pane ids (primary, secondary). */
  paneIdsAll: readonly [TPaneId, TPaneId];
  // ---- pane / workspace queries ----
  getActivePaneId: () => TPaneId;
  getPaneOrder: () => TPaneId[];
  getPaneKind: (paneId: TPaneId) => PaneKind;
  getPaneDocument: (paneId: TPaneId) => NoteDraftState;
  getNavigationDocument: () => NoteDraftState;
  getNavigationPaneId: () => TPaneId;
  getNextPaneId: (paneId?: TPaneId, direction?: 1 | -1) => TPaneId | null;
  getPaneRuntime: (paneId: TPaneId) => PaneRuntime;
  getNoteByKey: (noteKey: NoteKey) => NoteDraftState | null;
  getOpenContext: () => OpenContext;
  getNavigationContext: (paneId?: TPaneId) => NavigationContext;
  getNoteSaveQueue: (noteKey: NoteKey) => Promise<void>;
  // ---- workspace store ----
  setActivePaneId: (paneId: TPaneId) => void;
  setPaneOrder: (order: TPaneId[]) => void;
  removePane: (paneId: TPaneId) => void;
  beginSplitPicker: (paneId: TPaneId, sourceNoteKey: NoteKey) => void;
  resetSplitPicker: () => void;
  setSplitPickerHighlight: (index: number) => void;
  getSplitPickerPaneId: () => TPaneId | null;
  getSplitPickerSourceNoteKey: () => NoteKey | null;
  getSplitPickerHighlightedIndex: () => number;
  getSplitPickerPreviousItem: () => SearchItem | null;
  getSplitPickerFocusEl: () => HTMLElement | null;
  // ---- session activation / fanout ----
  activatePaneSession: (paneId: TPaneId) => unknown;
  setPaneDocumentSession: (paneId: TPaneId, document: NoteDraftState) => unknown;
  documents: DocumentPaneCoordinator<TPaneId>;
  paneLifecycle: PaneEditorLifecycle<TPaneId>;
  // ---- persistence ----
  cancelPendingAutosave: (note?: NoteDraftState) => void;
  enqueueSave: (note?: NoteDraftState) => Promise<void>;
  invalidatePendingSaveResults: (note?: NoteDraftState) => void;
  scheduleAutosave: (note: NoteDraftState) => void;
  hasCleanBuffer: (note: NoteDraftState) => boolean;
  // ---- search/related/derived views ----
  clearSearch: () => void;
  scheduleSearchIfNeeded: () => void;
  scheduleRelatedIfNeeded: (options?: { immediate?: boolean }) => void;
  clearSelectedRelatedText: () => void;
  loadRecentNotes: () => Promise<unknown> | unknown;
  setRecentlyForgotten: (value: ForgottenNote | null) => void;
  closeWikilinkAutocomplete: (paneId?: TPaneId) => void;
  // ---- doc sync ----
  flushDocumentEditorSync: (document: NoteDraftState) => void;
  scheduleDocumentEditorSync: (document: NoteDraftState) => void;
  flushAllPendingDocumentSyncs: () => void;
  hasPendingDocumentSync: (document: NoteDraftState) => boolean;
  // ---- preferences / capabilities ----
  forgottenNoteRetentionPreference: () => ForgottenNoteRetentionPreference;
  cleanUpApplyPolicyPreference: () => CleanUpApplyPolicyPreference;
  rememberActionOptions: () => RememberActionOption[];
  canIntegrate: () => boolean;
  // ---- DOM helpers ----
  getPaneTitleInput: (paneId: TPaneId) => HTMLInputElement | null;
  getPaneEditorRoot: (paneId: TPaneId) => HTMLElement | null;
  isRefreshingFromDisk: () => boolean;
  setRefreshingFromDisk: (value: boolean) => void;
  updateSelectedRelatedText: (paneId?: TPaneId) => void;
}

export function createNotepadCommands<TPaneId extends string>(deps: NotepadCommandsDeps<TPaneId>) {
  const {
    state,
    documents,
    paneLifecycle,
    getActivePaneId,
    getPaneOrder,
    getPaneKind,
    getPaneDocument,
    getNavigationDocument,
    getNavigationPaneId,
    getPaneRuntime,
    getNoteByKey,
    getOpenContext,
    getNavigationContext,
    getNoteSaveQueue,
    setActivePaneId,
    setPaneOrder,
    removePane,
    beginSplitPicker,
    resetSplitPicker,
    setSplitPickerHighlight,
    getSplitPickerPaneId,
    getSplitPickerSourceNoteKey,
    getSplitPickerHighlightedIndex,
    getSplitPickerPreviousItem,
    getSplitPickerFocusEl,
    activatePaneSession,
    setPaneDocumentSession,
    cancelPendingAutosave,
    enqueueSave,
    invalidatePendingSaveResults,
    scheduleAutosave,
    hasCleanBuffer,
    clearSearch,
    scheduleSearchIfNeeded,
    scheduleRelatedIfNeeded,
    clearSelectedRelatedText,
    loadRecentNotes,
    setRecentlyForgotten,
    closeWikilinkAutocomplete,
    flushDocumentEditorSync,
    flushAllPendingDocumentSyncs,
    hasPendingDocumentSync,
    forgottenNoteRetentionPreference,
    cleanUpApplyPolicyPreference,
    rememberActionOptions,
    canIntegrate,
    getPaneTitleInput,
    getPaneEditorRoot,
    isRefreshingFromDisk,
    setRefreshingFromDisk,
    updateSelectedRelatedText
  } = deps;

  function focusPaneAfterShortcut(paneId: TPaneId, options: { preferTitle?: boolean } = {}) {
    if (getSplitPickerPaneId() === paneId && getSplitPickerFocusEl()) {
      getSplitPickerFocusEl()?.focus({ preventScroll: true });
      return;
    }

    const titleInput = getPaneTitleInput(paneId);
    if (options.preferTitle && titleInput) {
      focusInputAtEnd(titleInput);
      return;
    }

    const cmContent = findCmContentElement(getPaneEditorRoot(paneId));
    if (cmContent instanceof HTMLElement) {
      cmContent.focus({ preventScroll: true });
      return;
    }

    titleInput?.focus();
  }

  function activatePane(paneId: TPaneId) {
    flushDocumentEditorSync(getPaneDocument(paneId));
    activatePaneSession(paneId);
    updateSelectedRelatedText(paneId);
    scheduleSearchIfNeeded();
    scheduleRelatedIfNeeded({ immediate: true });
  }

  async function refreshCurrentNoteIfChanged() {
    const note = getNavigationDocument();
    const currentPath = note.currentNotePath;
    const editorReady = getEditorPaneCountForNote(note.key) > 0
      || getPaneOrder().some(
        (paneId) => getPaneDocument(paneId).key === note.key && getPaneRuntime(paneId).ui.isEditorReady
      );
    if (
      !currentPath ||
      !editorReady ||
      isRefreshingFromDisk() ||
      !hasCleanBuffer(note)
    ) {
      return;
    }

    setRefreshingFromDisk(true);
    try {
      const session = await readNoteSession(note.currentNoteId, currentPath);
      if (getNavigationDocument().key !== note.key || !hasCleanBuffer(note)) {
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

  async function clearNotepad(options: { canRestore?: boolean } = {}) {
    const canRestore = options.canRestore ?? true;
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
    void loadRecentNotes();
  }

  async function unforgetNotepad() {
    const forgottenNote = state.recentlyForgotten;
    if (!forgottenNote) {
      return;
    }

    if (forgottenNote.forgottenPath) {
      try {
        const restoredNotes = await restoreForgottenNotes([forgottenNote.forgottenPath]);
        const restoredPath = restoredNotes[0]?.restoredPath;
        if (!restoredPath) {
          return;
        }

        const previousNote = getNavigationDocument();
        const restoredNote = adoptSnapshotForPane(
          state,
          getActivePaneId(),
          await openNoteSession(null, restoredPath)
        );
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

  function resolveRememberAction(actionId: string): RememberActionOption {
    const options = rememberActionOptions();
    return (
      options.find((option) => option.id === actionId) ??
      options.find((option) => option.id === 'exact') ??
      EXACT_REMEMBER_ACTION
    );
  }

  async function rememberCurrentNote(action: RememberActionOption) {
    flushAllPendingDocumentSyncs();
    documents.flushAllPendingCursorSaves();
    const resolvedAction =
      rememberActionRequiresIntegrateSupport(action) && !canIntegrate()
        ? resolveRememberAction('exact')
        : action;
    const note = getNavigationDocument();
    documents.saveCursorPositionForDocument(note);
    documents.saveSharedEditorStateForDocument(note);
    cancelPendingAutosave(note);
    await getNoteSaveQueue(note.key);
    const operationRevision = note.operationRevision;
    setNoteStatus(note, 'remembering');

    await rememberWithAction(
      resolvedAction,
      cleanUpApplyPolicyPreference(),
      note.title,
      note.bodyMarkdown,
      note.currentNotePath
    );

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
    setNoteStatus(previousDocument, 'opening');

    const session = await openNoteSession(options.noteId ?? null, notePath);
    if (getPaneRuntime(paneId).getOpenRequestGeneration() !== requestGeneration) {
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
    }

    if ((options.focusEditorAfterOpen ?? true) && getPaneKind(paneId) === 'editor') {
      await tick();
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
    const [primary, secondary] = deps.paneIdsAll;
    const targetPaneId = sourcePaneId === primary ? secondary : primary;
    const sharedDocument = getPaneDocument(sourcePaneId);

    await loadRecentNotes();

    const placeholderDraft = createFreshDraftNote(state);
    setStoredPaneKind(state, targetPaneId, 'editor');
    setPaneDocumentSession(targetPaneId, placeholderDraft);
    beginSplitPicker(targetPaneId, sharedDocument.key);

    setPaneOrder([primary, secondary]);
    activatePaneSession(targetPaneId);
    await tick();
    await paneLifecycle.ensurePaneEditors();
    updateSelectedRelatedText(targetPaneId);
    getSplitPickerFocusEl()?.focus({ preventScroll: true });
  }

  async function closePane(paneId: TPaneId) {
    const order = getPaneOrder();
    if (order.length === 1) {
      return;
    }

    const wasSplitPicker = getSplitPickerPaneId() === paneId;
    const orphanPlaceholderKey = wasSplitPicker ? getPaneDocument(paneId).key : null;

    removePane(paneId);

    if (wasSplitPicker) {
      resetSplitPicker();
      const remainingOrder = getPaneOrder();
      const anchorPane = (remainingOrder[0] ?? deps.primaryPaneId) as TPaneId;
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

    activatePaneSession(((getPaneOrder()[0] ?? deps.primaryPaneId) as TPaneId));
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
    const nextPaneId = deps.getNextPaneId(currentPaneId, direction);
    if (!nextPaneId) {
      return;
    }

    const preferTitle = document.activeElement === getPaneTitleInput(currentPaneId);
    activatePane(nextPaneId);
    await tick();
    focusPaneAfterShortcut(nextPaneId, { preferTitle });
  }

  function moveSplitPickerHighlight(direction: 1 | -1) {
    setSplitPickerHighlight(
      getNextSplitChoiceIndex(
        getSplitPickerHighlightedIndex(),
        direction,
        getSplitPickerPreviousItem() !== null
      )
    );
  }

  async function finalizeSplitPickerSelection(paneId: TPaneId) {
    await tick();
    await paneLifecycle.ensurePaneEditors();
    updateSelectedRelatedText(paneId);
    scheduleSearchIfNeeded();
    scheduleRelatedIfNeeded({ immediate: true });
  }

  async function resolveSplitPickerChoice(paneId: TPaneId, choice: SplitChoice) {
    if (getSplitPickerPaneId() !== paneId) {
      return;
    }

    const sourceKey = getSplitPickerSourceNoteKey();
    const previousItem = getSplitPickerPreviousItem();
    const placeholderKey = getPaneDocument(paneId).key;

    resetSplitPicker();
    activatePaneSession(paneId);

    if (choice === 'current') {
      if (!sourceKey) return;

      const shared = getNoteByKey(sourceKey);
      if (!shared) return;

      setStoredPaneKind(state, paneId, 'editor');
      setPaneDocumentSession(paneId, shared);
      removeNoteIfUnreferenced(state, placeholderKey);
      cleanupNoteRuntime(placeholderKey);
      await finalizeSplitPickerSelection(paneId);
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

      await finalizeSplitPickerSelection(paneId);
      return;
    }

    if (choice === 'new') {
      setStoredPaneKind(state, paneId, 'editor');
      const newDraft = createFreshDraftNote(state);
      setPaneDocumentSession(paneId, newDraft);
      removeNoteIfUnreferenced(state, placeholderKey);
      cleanupNoteRuntime(placeholderKey);
      await finalizeSplitPickerSelection(paneId);
      flushDocumentEditorSync(newDraft);
      return;
    }

    setStoredPaneKind(state, paneId, 'chat');
    const chatDraft = createFreshDraftNote(state);
    setPaneDocumentSession(paneId, chatDraft);
    removeNoteIfUnreferenced(state, placeholderKey);
    cleanupNoteRuntime(placeholderKey);
    await finalizeSplitPickerSelection(paneId);
  }

  async function confirmSplitPickerChoiceByHighlight() {
    const paneId = getSplitPickerPaneId();
    if (!paneId) return;

    const choice = getSplitChoiceByIndex(
      getSplitPickerHighlightedIndex(),
      getSplitPickerPreviousItem() !== null
    );
    if (choice) {
      await resolveSplitPickerChoice(paneId, choice);
    }
  }

  function handleSplitPickerGlobalKeydown(event: KeyboardEvent): boolean {
    const splitPaneId = getSplitPickerPaneId();
    if (splitPaneId === null || getActivePaneId() !== splitPaneId || event.repeat) {
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
      moveSplitPickerHighlight(1);
      return true;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveSplitPickerHighlight(-1);
      return true;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      void confirmSplitPickerChoiceByHighlight();
      return true;
    }

    const shortcutChoice = getSplitChoiceForShortcut(
      event.key,
      getSplitPickerPreviousItem() !== null
    );
    if (shortcutChoice === null) {
      return false;
    }

    event.preventDefault();
    void resolveSplitPickerChoice(splitPaneId, shortcutChoice);
    return true;
  }

  return {
    activatePane,
    focusPaneAfterShortcut,
    refreshCurrentNoteIfChanged,
    clearNotepad,
    unforgetNotepad,
    rememberCurrentNote,
    resolveRememberAction,
    openNotePath,
    splitWorkspace,
    closePane,
    setPaneKind,
    handleBottomBarCommand,
    switchActivePane,
    resolveSplitPickerChoice,
    handleSplitPickerGlobalKeydown,
    moveSplitPickerHighlight,
    confirmSplitPickerChoiceByHighlight
  };
}

export type NotepadCommands<TPaneId extends string> = ReturnType<
  typeof createNotepadCommands<TPaneId>
>;
