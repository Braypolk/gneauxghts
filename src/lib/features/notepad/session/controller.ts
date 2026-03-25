import {
  createEmptySessionSnapshot,
  createForgottenNote,
  forgetNoteSession,
  hasContent,
  loadCurrentVaultInfo,
  loadSavedNoteSession,
  openNoteSession,
  readNoteSession,
  rememberNoteSession,
  resolveAssetRootPath,
  restoreForgottenNotes,
  saveNoteSession,
  shouldSkipAutosave,
  type ForgottenNote,
  type SaveMode,
  type SessionSnapshot
} from '$lib/features/notepad/session/session';

interface ReplaceEditorContentOptions {
  preserveScroll?: boolean;
  restoreCursor?: boolean;
}

interface SessionControllerDeps {
  getTitle: () => string;
  getBodyMarkdown: () => string;
  getCurrentMarkdown: () => string;
  getCurrentPath: () => string | null;
  setCurrentPath: (value: string | null) => void;
  getLastSavedTitle: () => string;
  setLastSavedTitle: (value: string) => void;
  getLastSavedMarkdown: () => string;
  setLastSavedMarkdown: (value: string) => void;
  getLastSavedPath: () => string | null;
  setLastSavedPath: (value: string | null) => void;
  applySessionSnapshot: (snapshot: SessionSnapshot) => void;
  isEditorReady: () => boolean;
  getIsRefreshingFromDisk: () => boolean;
  setIsRefreshingFromDisk: (value: boolean) => void;
  getForgottenNote: () => ForgottenNote | null;
  setForgottenNote: (value: ForgottenNote | null) => void;
  setCanUnforget: (value: boolean) => void;
  getForgottenRetentionDays: () => 1 | 7 | 30;
  saveCursorPositionForNote: () => void;
  saveEditorStateForNote: () => void;
  discardEditorStateForNote: (notePath: string | null) => void;
  replaceEditorContent: (
    nextMarkdown: string,
    options?: ReplaceEditorContentOptions
  ) => Promise<void>;
  replaceEditorContentInPlace: (nextMarkdown: string) => Promise<void>;
  replaceEditorContentInPlaceForNote: (
    nextMarkdown: string,
    notePath: string | null
  ) => Promise<void>;
  restoreEditorStateForNote: (notePath: string | null) => Promise<boolean>;
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
  getTitle,
  getBodyMarkdown,
  getCurrentMarkdown,
  getCurrentPath,
  setCurrentPath,
  getLastSavedTitle,
  setLastSavedTitle,
  getLastSavedMarkdown,
  setLastSavedMarkdown,
  getLastSavedPath,
  setLastSavedPath,
  applySessionSnapshot,
  isEditorReady,
  getIsRefreshingFromDisk,
  setIsRefreshingFromDisk,
  getForgottenNote,
  setForgottenNote,
  setCanUnforget,
  getForgottenRetentionDays,
  saveCursorPositionForNote,
  saveEditorStateForNote,
  discardEditorStateForNote,
  replaceEditorContent,
  replaceEditorContentInPlace,
  replaceEditorContentInPlaceForNote,
  restoreEditorStateForNote,
  clearSelectedRelatedText,
  clearSearch,
  scheduleSearch,
  scheduleRelated,
  loadRecentNotes,
  scheduleAutoSync,
  closeWikilinkAutocomplete,
  setAssetRootPath
}: SessionControllerDeps) {
  let saveTimer: ReturnType<typeof window.setTimeout> | null = null;
  let saveQueue: Promise<void> = Promise.resolve();

  function hasCleanBuffer() {
    return shouldSkipAutosave(getTitle(), getCurrentMarkdown(), getCurrentPath(), {
      lastSavedTitle: getLastSavedTitle(),
      lastSavedMarkdown: getLastSavedMarkdown(),
      lastSavedPath: getLastSavedPath()
    });
  }

  async function loadSavedNote() {
    try {
      applySessionSnapshot(await loadSavedNoteSession());
    } catch (error) {
      console.error('Failed to load saved note:', error);
      applySessionSnapshot(createEmptySessionSnapshot());
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
    const currentPath = getCurrentPath();
    if (!currentPath || !isEditorReady() || getIsRefreshingFromDisk() || !hasCleanBuffer()) {
      return;
    }

    setIsRefreshingFromDisk(true);

    try {
      const session = await readNoteSession(currentPath);

      if (!hasCleanBuffer() || session.currentNotePath !== getCurrentPath()) {
        return;
      }

      if (
        session.lastSavedTitle === getLastSavedTitle() &&
        session.lastSavedMarkdown === getLastSavedMarkdown() &&
        session.lastSavedPath === getLastSavedPath()
      ) {
        return;
      }

      applySessionSnapshot(session);
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

  function cancelPendingAutosave() {
    if (!saveTimer) {
      return;
    }

    window.clearTimeout(saveTimer);
    saveTimer = null;
  }

  async function persistNote(mode: SaveMode) {
    const title = getTitle();
    const markdown = getCurrentMarkdown();

    if (
      mode === 'autosave' &&
      shouldSkipAutosave(title, markdown, getCurrentPath(), {
        lastSavedTitle: getLastSavedTitle(),
        lastSavedMarkdown: getLastSavedMarkdown(),
        lastSavedPath: getLastSavedPath()
      })
    ) {
      return;
    }

    if (mode === 'remember') {
      await rememberNoteSession(title, markdown, getCurrentPath());
      scheduleAutoSync('note-remembered', 400);
      return;
    }

    applySessionSnapshot(await saveNoteSession(title, markdown, getCurrentPath()));
    scheduleAutoSync('note-saved', 600);
  }

  async function enqueueSave(mode: SaveMode) {
    saveQueue = saveQueue
      .then(() => persistNote(mode))
      .catch((error) => {
        console.error(`Failed to ${mode} note:`, error);
      });

    return saveQueue;
  }

  function scheduleAutosave() {
    cancelPendingAutosave();
    saveTimer = window.setTimeout(() => {
      saveTimer = null;
      void enqueueSave('autosave');
    }, 1000);
  }

  function flushPendingAutosave() {
    if (!saveTimer) {
      return;
    }

    window.clearTimeout(saveTimer);
    saveTimer = null;
    void enqueueSave('autosave');
  }

  async function clearNotepad({ canRestore = true }: { canRestore?: boolean } = {}) {
    const notePathToClear = getCurrentPath();

    if (notePathToClear) {
      saveCursorPositionForNote();
      saveEditorStateForNote();
      cancelPendingAutosave();
      await enqueueSave('autosave');
    }

    const draft = {
      title: getTitle(),
      bodyMarkdown: getBodyMarkdown(),
      currentNotePath: getCurrentPath()
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
    applySessionSnapshot(createEmptySessionSnapshot());
    setCanUnforget(canRestore && hasDraftContent);
    await replaceEditorContent('');
    clearSelectedRelatedText();
    discardEditorStateForNote(notePathToClear);
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

        applySessionSnapshot(await openNoteSession(restoredPath));
        setCanUnforget(false);
        setForgottenNote(null);
        await replaceEditorContent(getBodyMarkdown());
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

    applySessionSnapshot({
      ...forgottenNote,
      lastSavedTitle: '',
      lastSavedMarkdown: '',
      lastSavedPath: null
    });
    setCanUnforget(false);
    await replaceEditorContent(forgottenNote.bodyMarkdown);
    setForgottenNote(null);
    clearSelectedRelatedText();
    scheduleAutosave();
    scheduleSearch();
    scheduleRelated({ immediate: true });
    void loadRecentNotes();
    scheduleAutoSync('forgotten-restored-draft', 400);
  }

  async function rememberCurrentNote() {
    const rememberedPath = getCurrentPath();
    saveCursorPositionForNote();
    saveEditorStateForNote();
    cancelPendingAutosave();

    await enqueueSave('remember');
    setCurrentPath(null);
    setLastSavedTitle('');
    setLastSavedMarkdown('');
    setLastSavedPath(null);
    setForgottenNote(null);
    discardEditorStateForNote(rememberedPath);
    clearSearch();
    await clearNotepad({ canRestore: false });
  }

  async function openNotePath(
    notePath: string,
    { currentNoteAlreadySaved = false }: { currentNoteAlreadySaved?: boolean } = {}
  ) {
    const previousPath = getCurrentPath();
    saveCursorPositionForNote();
    saveEditorStateForNote();
    if (!currentNoteAlreadySaved && previousPath && previousPath !== notePath) {
      cancelPendingAutosave();
      await enqueueSave('autosave');
    }

    const session = await openNoteSession(notePath);
    applySessionSnapshot(session);
    setCanUnforget(false);
    setForgottenNote(null);
    closeWikilinkAutocomplete();
    clearSelectedRelatedText();

    if (await restoreEditorStateForNote(session.currentNotePath)) {
      scheduleRelated({ immediate: true });
      return;
    }

    await replaceEditorContentInPlaceForNote(session.bodyMarkdown, session.currentNotePath);
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
