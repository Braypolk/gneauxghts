import {
  EXACT_REMEMBER_ACTION,
  type CleanUpApplyPolicy,
  type RememberActionOption
} from '$lib/types/ai';
import {
  createEmptySessionSnapshot,
  createForgottenNote,
  forgetNoteSession,
  hasContent,
  loadCurrentVaultInfo,
  loadSavedNoteSession,
  openNoteSession,
  readNoteSession,
  rememberWithAction,
  resolveAssetRootPath,
  restoreForgottenNotes,
  saveNoteSession,
  shouldSkipAutosave,
  type ForgottenNote,
  type SaveMode,
  type SessionSnapshot
} from '$lib/features/notepad/session/session';
import type { DocumentSession } from '$lib/features/notepad/session/documentSession';

interface ReplaceEditorContentOptions {
  preserveScroll?: boolean;
  restoreCursor?: boolean;
}

interface SessionControllerDeps {
  getDocumentSession: () => DocumentSession;
  activateDocumentSession: (snapshot: SessionSnapshot) => DocumentSession;
  syncActiveDocumentSession: (snapshot: SessionSnapshot) => DocumentSession;
  resetActiveDocumentSession: () => DocumentSession;
  discardDocumentSession: (noteId: string | null, notePath: string | null) => void;
  isEditorReady: () => boolean;
  getIsRefreshingFromDisk: () => boolean;
  setIsRefreshingFromDisk: (value: boolean) => void;
  getForgottenNote: () => ForgottenNote | null;
  setForgottenNote: (value: ForgottenNote | null) => void;
  setCanUnforget: (value: boolean) => void;
  getForgottenRetentionDays: () => 1 | 7 | 30;
  saveCursorPositionForDocument: (document?: DocumentSession) => void;
  saveSharedEditorStateForDocument: (document?: DocumentSession) => void;
  discardSharedEditorStateForDocument: (document: DocumentSession) => void;
  replaceEditorContent: (
    nextMarkdown: string,
    options?: ReplaceEditorContentOptions
  ) => Promise<void>;
  replaceEditorContentInPlace: (nextMarkdown: string) => Promise<void>;
  replaceEditorContentInPlaceForDocument: (
    nextMarkdown: string,
    document: DocumentSession
  ) => Promise<void>;
  restoreSharedEditorStateForDocument: (document: DocumentSession) => Promise<boolean>;
  clearSelectedRelatedText: () => void;
  clearSearch: () => void;
  scheduleSearch: () => void;
  scheduleRelated: (options?: { immediate?: boolean }) => void;
  loadRecentNotes: () => Promise<void> | void;
  scheduleAutoSync: (reason: string, delay: number) => void;
  closeWikilinkAutocomplete: () => void;
  setAssetRootPath: (value: string | null) => void;
}

export function createSessionController({
  getDocumentSession,
  activateDocumentSession,
  syncActiveDocumentSession,
  resetActiveDocumentSession,
  discardDocumentSession,
  isEditorReady,
  getIsRefreshingFromDisk,
  setIsRefreshingFromDisk,
  getForgottenNote,
  setForgottenNote,
  setCanUnforget,
  getForgottenRetentionDays,
  saveCursorPositionForDocument,
  saveSharedEditorStateForDocument,
  discardSharedEditorStateForDocument,
  replaceEditorContent,
  replaceEditorContentInPlace,
  replaceEditorContentInPlaceForDocument,
  restoreSharedEditorStateForDocument,
  clearSelectedRelatedText,
  clearSearch,
  scheduleSearch,
  scheduleRelated,
  loadRecentNotes,
  scheduleAutoSync,
  closeWikilinkAutocomplete,
  setAssetRootPath
}: SessionControllerDeps) {
  function hasCleanBuffer() {
    const document = getDocumentSession();
    return shouldSkipAutosave(
      document.title,
      document.bodyMarkdown,
      document.currentNoteId,
      document.currentNotePath,
      document
    );
  }

  async function loadSavedNote() {
    try {
      activateDocumentSession(await loadSavedNoteSession());
    } catch (error) {
      console.error('Failed to load saved note:', error);
      activateDocumentSession(createEmptySessionSnapshot());
    }
  }

  async function loadAssetRoot() {
    try {
      const vaultInfo = await loadCurrentVaultInfo();
      setAssetRootPath(resolveAssetRootPath(vaultInfo.currentPath));
    } catch (error) {
      console.error('Failed to load vault info for image assets:', error);
      setAssetRootPath(null);
    }
  }

  async function refreshCurrentNoteIfChanged() {
    const document = getDocumentSession();
    const currentPath = document.currentNotePath;
    if (!currentPath || !isEditorReady() || getIsRefreshingFromDisk() || !hasCleanBuffer()) {
      return;
    }

    setIsRefreshingFromDisk(true);

    try {
      const session = await readNoteSession(document.currentNoteId, currentPath);

      if (getDocumentSession() !== document || !hasCleanBuffer()) {
        return;
      }

      if (
        session.lastSavedTitle === document.lastSavedTitle &&
        session.lastSavedMarkdown === document.lastSavedMarkdown &&
        session.lastSavedNoteId === document.lastSavedNoteId &&
        session.lastSavedPath === document.lastSavedPath
      ) {
        return;
      }

      syncActiveDocumentSession(session);
      setCanUnforget(false);
      setForgottenNote(null);
      await replaceEditorContentInPlace(session.bodyMarkdown);
      clearSelectedRelatedText();
      scheduleSearch();
      scheduleRelated({ immediate: true });
    } catch (error) {
      console.error('Failed to refresh note from disk:', error);
    } finally {
      setIsRefreshingFromDisk(false);
    }
  }

  function cancelPendingAutosave(document: DocumentSession = getDocumentSession()) {
    if (!document.saveTimer) {
      return;
    }

    window.clearTimeout(document.saveTimer);
    document.saveTimer = null;
  }

  async function persistNote(document: DocumentSession, mode: SaveMode) {
    const title = document.title;
    const markdown = document.bodyMarkdown;

    if (
      mode === 'autosave' &&
      shouldSkipAutosave(title, markdown, document.currentNoteId, document.currentNotePath, document)
    ) {
      return;
    }

    if (mode === 'remember') {
      await rememberWithAction(
        EXACT_REMEMBER_ACTION,
        'autoApply',
        title,
        markdown,
        document.currentNotePath
      );
      scheduleAutoSync('note-remembered', 400);
      return;
    }

    syncActiveDocumentSession(
      await saveNoteSession(title, markdown, document.currentNotePath)
    );
    scheduleAutoSync('note-saved', 600);
  }

  async function enqueueSave(mode: SaveMode, document: DocumentSession = getDocumentSession()) {
    document.saveQueue = document.saveQueue
      .then(() => persistNote(document, mode))
      .catch((error) => {
        console.error(`Failed to ${mode} note:`, error);
      });

    return document.saveQueue;
  }

  function scheduleAutosave() {
    const document = getDocumentSession();
    cancelPendingAutosave(document);
    document.saveTimer = window.setTimeout(() => {
      document.saveTimer = null;
      void enqueueSave('autosave', document);
    }, 1000);
  }

  function flushPendingAutosave() {
    const document = getDocumentSession();
    if (!document.saveTimer) {
      return;
    }

    window.clearTimeout(document.saveTimer);
    document.saveTimer = null;
    void enqueueSave('autosave', document);
  }

  async function clearNotepad({ canRestore = true }: { canRestore?: boolean } = {}) {
    const document = getDocumentSession();
    const notePathToClear = document.currentNotePath;

    if (notePathToClear) {
      saveCursorPositionForDocument(document);
      saveSharedEditorStateForDocument(document);
      cancelPendingAutosave(document);
      await enqueueSave('autosave', document);
    }

    const draft = {
      title: document.title,
      bodyMarkdown: document.bodyMarkdown,
      currentNoteId: document.currentNoteId,
      currentNotePath: document.currentNotePath
    };
    const hasDraftContent = hasContent(draft);
    let forgottenPath: string | null = null;

    if (notePathToClear) {
      try {
        const forgottenNoteSummary = await forgetNoteSession(
          notePathToClear,
          getForgottenRetentionDays()
        );
        forgottenPath = forgottenNoteSummary?.forgottenPath ?? null;
      } catch (error) {
        console.error('Failed to forget note:', error);
        return;
      }
    }

    setForgottenNote(canRestore && hasDraftContent ? createForgottenNote(draft, forgottenPath) : null);
    discardDocumentSession(document.currentNoteId, document.currentNotePath);
    discardSharedEditorStateForDocument(document);
    resetActiveDocumentSession();
    setCanUnforget(canRestore && hasDraftContent);
    await replaceEditorContent('');
    clearSelectedRelatedText();
    scheduleSearch();
    scheduleRelated({ immediate: true });
    void loadRecentNotes();
    scheduleAutoSync('note-forgotten', 400);
  }

  async function unforgetNotepad() {
    const forgottenNote = getForgottenNote();
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

        activateDocumentSession(await openNoteSession(null, restoredPath));
        setCanUnforget(false);
        setForgottenNote(null);
        await replaceEditorContent(getDocumentSession().bodyMarkdown);
        clearSelectedRelatedText();
        scheduleSearch();
        scheduleRelated({ immediate: true });
        void loadRecentNotes();
        scheduleAutoSync('forgotten-restored', 400);
        return;
      } catch (error) {
        console.error('Failed to restore forgotten note:', error);
        return;
      }
    }

    const restoredDocument = syncActiveDocumentSession({
      ...forgottenNote,
      lastSavedTitle: '',
      lastSavedMarkdown: '',
      lastSavedNoteId: null,
      lastSavedPath: null
    });
    setCanUnforget(false);
    await replaceEditorContent(restoredDocument.bodyMarkdown);
    setForgottenNote(null);
    clearSelectedRelatedText();
    scheduleAutosave();
    scheduleSearch();
    scheduleRelated({ immediate: true });
    void loadRecentNotes();
    scheduleAutoSync('forgotten-restored-draft', 400);
  }

  async function rememberCurrentNote(
    action: RememberActionOption,
    cleanUpApplyPolicy: CleanUpApplyPolicy
  ) {
    const document = getDocumentSession();
    const rememberedPath = document.currentNotePath;
    saveCursorPositionForDocument(document);
    saveSharedEditorStateForDocument(document);
    cancelPendingAutosave(document);
    await rememberWithAction(
      action,
      cleanUpApplyPolicy,
      document.title,
      document.bodyMarkdown,
      document.currentNotePath
    );
    scheduleAutoSync('note-remembered', 400);
    setForgottenNote(null);
    setCanUnforget(false);
    discardDocumentSession(document.currentNoteId, rememberedPath);
    discardSharedEditorStateForDocument(document);
    resetActiveDocumentSession();
    clearSearch();
    await replaceEditorContent('');
    clearSelectedRelatedText();
    scheduleSearch();
    scheduleRelated({ immediate: true });
    void loadRecentNotes();
  }

  async function openNotePath(
    noteId: string | null,
    notePath: string | null,
    { currentNoteAlreadySaved = false }: { currentNoteAlreadySaved?: boolean } = {}
  ) {
    if (!noteId && !notePath) {
      return;
    }
    const previousDocument = getDocumentSession();
    const previousPath = previousDocument.currentNotePath;
    const previousNoteId = previousDocument.currentNoteId;
    saveCursorPositionForDocument(previousDocument);
    saveSharedEditorStateForDocument(previousDocument);
    if (
      !currentNoteAlreadySaved &&
      previousPath &&
      (previousNoteId !== noteId || previousPath !== notePath)
    ) {
      cancelPendingAutosave(previousDocument);
      await enqueueSave('autosave', previousDocument);
    }

    const session = await openNoteSession(noteId, notePath);
    const document = activateDocumentSession(session);
    setCanUnforget(false);
    setForgottenNote(null);
    closeWikilinkAutocomplete();
    clearSelectedRelatedText();

    if (await restoreSharedEditorStateForDocument(document)) {
      scheduleRelated({ immediate: true });
      return;
    }

    await replaceEditorContentInPlaceForDocument(session.bodyMarkdown, document);
    scheduleRelated({ immediate: true });
  }

  function dispose() {
    cancelPendingAutosave();
  }

  return {
    loadSavedNote,
    loadAssetRoot,
    refreshCurrentNoteIfChanged,
    scheduleAutosave,
    cancelPendingAutosave,
    enqueueSave,
    flushPendingAutosave,
    clearNotepad,
    unforgetNotepad,
    rememberCurrentNote,
    openNotePath,
    dispose
  };
}
