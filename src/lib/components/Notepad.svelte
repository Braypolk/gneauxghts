<script lang="ts">
  import { listen, type UnlistenFn } from '@tauri-apps/api/event';
  import { onMount, tick } from 'svelte';
  import { cancelScheduledAutoSync, runAutoSyncNow, scheduleAutoSync } from '$lib/sync/autoSync';
  import { consumePendingTaskTarget } from '$lib/taskNavigation';
  import { forgottenNoteRetentionPreference } from '$lib/appSettings';
  import type { SearchItem } from '$lib/types/semantic';
  import type { ActiveWikilink } from './notepadWikilinks';
  import { composeMarkdown } from './notepadDocument';
  import {
    createNotepadEditor,
    destroyNotepadEditor,
    insertWikilinkSuggestion,
    type NotepadEditorController,
    prepareNotepadEditor,
    readNotepadCursorPosition,
    readNotepadEditorState,
    replaceNotepadEditorContent,
    replaceNotepadEditorState,
    restoreNotepadCursorPosition,
    resetNotepadSlashMenuPortal
  } from './notepadEditor';
  import {
    loadNotepadCursorPosition,
    saveNotepadCursorPosition,
    type NotepadCursorPosition
  } from './notepadCursorState';
  import { focusEditorAtEnd, focusInputAtEnd, waitForEditorPaint } from './notepadNavigation';
  import {
    navigateToPendingTaskTarget,
    openRecentTask,
    openResolvedNoteLink,
    openSearchResult,
    type NotepadNavigationContext,
    type NotepadOpenContext
  } from './notepadOpenFlow';
  import {
    listRecentNotes,
    listRecentTasks,
    searchNotes,
    type NotepadSearchMode
  } from './notepadSearch';
  import {
    createEmptySessionSnapshot,
    createForgottenNote,
    forgetNoteSession,
    hasNotepadContent,
    loadCurrentVaultInfo,
    loadSavedNoteSession,
    openNoteSession,
    readNoteSession,
    rememberNoteSession,
    restoreForgottenNotes,
    saveNoteSession,
    storePastedImageAsset,
    shouldSkipAutosave,
    type ForgottenNote,
    type NotepadSessionSnapshot,
    type NotepadSaveMode
  } from './notepadSession';
  import {
    autocompleteNoteLinks,
    beginWikilinkSuggestionRequest,
    completeWikilinkSuggestionRequest,
    createWikilinkAutocompleteState,
    dismissWikilinkAutocomplete,
    getSelectedWikilinkSuggestion,
    hasWikilinkAlias,
    moveWikilinkSelection as moveWikilinkSelectionState,
    resetWikilinkAutocomplete,
    resolveNoteLink,
    setActiveWikilink,
    type WikilinkAutocompleteState
  } from './notepadWikilinkState';
  import type { RecentTaskItem } from './notepadTypes';
  import BottomBar from './BottomBar.svelte';
  import NotepadWikilinkAutocomplete from './NotepadWikilinkAutocomplete.svelte';
  import type { EditorState } from '@milkdown/kit/prose/state';

  let crepe: NotepadEditorController | null = null;
  let notepadShell: HTMLDivElement | null = null;
  let editorShell: HTMLDivElement | null = null;
  let editorRoot: HTMLDivElement | null = null;
  let slashMenuPortal: HTMLDivElement | null = null;
  let titleInput: HTMLInputElement | null = null;
  let titleShell: HTMLDivElement | null = null;
  let isEditorReady = $state(false);
  let title = $state('');
  let bodyMarkdown = $state('');
  let currentNotePath = $state<string | null>(null);
  let lastSavedMarkdown = '';
  let lastSavedPath: string | null = null;
  let canUnforget = $state(false);
  let forgottenNote: ForgottenNote | null = null;
  let saveTimer: ReturnType<typeof window.setTimeout> | null = null;
  let saveQueue: Promise<void> = Promise.resolve();
  let searchMode = $state<NotepadSearchMode>('all');
  let searchQuery = $state('');
  let searchResults = $state<SearchItem[]>([]);
  let recentNotes = $state<SearchItem[]>([]);
  let recentTasks = $state<RecentTaskItem[]>([]);
  let isSearching = $state(false);
  let searchTimer: ReturnType<typeof window.setTimeout> | null = null;
  let activeSearchRequest = 0;
  let activeRecentNotesRequest = 0;
  let activeRecentTasksRequest = 0;
  let searchFocusRequest = $state(0);
  let slashMenuPortalCleanup: (() => void) | null = null;
  let wikilinkAutocomplete = $state<WikilinkAutocompleteState>(createWikilinkAutocompleteState());
  let isRefreshingFromDisk = false;
  let isApplyingExternalContent = false;
  let vaultNoteChangeUnlisten: UnlistenFn | null = null;
  let assetRootPath = $state<string | null>(null);
  const editorStateByNotePath = new Map<string, EditorState>();

  interface VaultNoteChangeEvent {
    notePath: string;
    deleted: boolean;
  }

  function applySessionSnapshot(snapshot: NotepadSessionSnapshot) {
    title = snapshot.title;
    bodyMarkdown = snapshot.bodyMarkdown;
    currentNotePath = snapshot.currentNotePath;
    lastSavedMarkdown = snapshot.lastSavedMarkdown;
    lastSavedPath = snapshot.lastSavedPath;
  }

  function getCurrentMarkdown() {
    return composeMarkdown(title, bodyMarkdown);
  }

  function hasCleanBuffer() {
    return shouldSkipAutosave(getCurrentMarkdown(), currentNotePath, {
      lastSavedMarkdown,
      lastSavedPath
    });
  }

  async function destroyEditor() {
    slashMenuPortalCleanup = resetNotepadSlashMenuPortal({
      boundsElement: null,
      editorRoot: null,
      portalRoot: null,
      currentCleanup: slashMenuPortalCleanup
    });
    crepe = await destroyNotepadEditor(crepe);
  }

  function setupSlashMenuPortal() {
    slashMenuPortalCleanup = resetNotepadSlashMenuPortal({
      boundsElement: notepadShell,
      editorRoot,
      portalRoot: slashMenuPortal,
      currentCleanup: slashMenuPortalCleanup
    });
  }

  async function createEditor(initialValue: string) {
    if (!(await prepareNotepadEditor(editorRoot)) || !editorRoot) return;
    crepe = await createNotepadEditor({
      assetRootPath,
      editorRoot,
      initialValue,
      onOpenLink: (rawTarget) => {
        void openWikilink(rawTarget);
      },
      onActiveWikilinkChange: handleActiveWikilinkChange,
      onMarkdownChange: (nextMarkdown) => {
        bodyMarkdown = nextMarkdown;
        saveEditorStateForNote();
        if (isApplyingExternalContent) return;
        if (nextMarkdown.trim() !== '') canUnforget = false;
        scheduleAutosave();
        scheduleSearch();
      },
      onStorePastedImage: storePastedImageAsset
    });
    setupSlashMenuPortal();
    isEditorReady = true;
  }

  function resolveAssetRootPath(vaultPath: string) {
    return `${vaultPath.replace(/[\\/]+$/u, '')}${vaultPath.includes('\\') ? '\\' : '/'}assets`;
  }

  function saveCursorPositionForNote(
    notePath: string | null = currentNotePath,
    position: NotepadCursorPosition | null = readNotepadCursorPosition(crepe)
  ) {
    if (!notePath || !position) {
      return;
    }

    saveNotepadCursorPosition(notePath, position);
  }

  function saveEditorStateForNote(
    notePath: string | null = currentNotePath,
    editorState: EditorState | null = readNotepadEditorState(crepe)
  ) {
    if (!notePath || !editorState) {
      return;
    }

    editorStateByNotePath.set(notePath, editorState);
  }

  function getEditorStateForNote(notePath: string | null) {
    if (!notePath) {
      return null;
    }

    return editorStateByNotePath.get(notePath) ?? null;
  }

  function discardEditorStateForNote(notePath: string | null) {
    if (!notePath) {
      return;
    }

    editorStateByNotePath.delete(notePath);
  }

  function restoreCursorPositionForNote(
    notePath: string | null = currentNotePath,
    position: NotepadCursorPosition | null = loadNotepadCursorPosition(notePath)
  ) {
    if (!notePath || !position) {
      return false;
    }

    return restoreNotepadCursorPosition(crepe, position);
  }

  async function replaceEditorContent(
    nextMarkdown: string,
    {
      preserveScroll = false,
      restoreCursor = false,
      cursorPosition = undefined
    }: {
      preserveScroll?: boolean;
      restoreCursor?: boolean;
      cursorPosition?: NotepadCursorPosition | null | undefined;
    } = {}
  ) {
    const scrollTop = preserveScroll ? (editorShell?.scrollTop ?? 0) : 0;
    isEditorReady = false;
    await destroyEditor();
    bodyMarkdown = nextMarkdown;
    await createEditor(nextMarkdown);

    if (restoreCursor) {
      await waitForEditorPaint();
      if (cursorPosition === undefined) {
        restoreCursorPositionForNote(currentNotePath);
      } else {
        restoreCursorPositionForNote(currentNotePath, cursorPosition);
      }
    }

    if (preserveScroll && editorShell) {
      await tick();
      editorShell.scrollTop = Math.min(scrollTop, editorShell.scrollHeight);
    }
  }

  async function replaceEditorContentInPlace(nextMarkdown: string) {
    const cursorPosition = readNotepadCursorPosition(crepe);
    const scrollTop = editorShell?.scrollTop ?? 0;
    isApplyingExternalContent = true;
    try {
      if (!replaceNotepadEditorContent(crepe, nextMarkdown)) {
        isApplyingExternalContent = false;
        await replaceEditorContent(nextMarkdown, {
          preserveScroll: true,
          restoreCursor: !!cursorPosition,
          cursorPosition
        });
        return;
      }

      bodyMarkdown = nextMarkdown;
      closeWikilinkAutocomplete();
      restoreNotepadCursorPosition(crepe, cursorPosition);
      await tick();
      if (editorShell) {
        editorShell.scrollTop = Math.min(scrollTop, editorShell.scrollHeight);
      }
    } finally {
      isApplyingExternalContent = false;
    }
  }

  async function replaceEditorContentInPlaceForNote(
    nextMarkdown: string,
    notePath: string | null
  ) {
    const cursorPosition = loadNotepadCursorPosition(notePath) ?? { anchor: 1, head: 1 };

    isApplyingExternalContent = true;
    try {
      if (!replaceNotepadEditorContent(crepe, nextMarkdown, { flushHistory: true })) {
        isApplyingExternalContent = false;
        await replaceEditorContent(nextMarkdown, {
          restoreCursor: true,
          cursorPosition
        });
        return;
      }

      bodyMarkdown = nextMarkdown;
      closeWikilinkAutocomplete();
      restoreNotepadCursorPosition(crepe, cursorPosition);
      await tick();
      saveEditorStateForNote(notePath);
    } finally {
      isApplyingExternalContent = false;
    }
  }

  async function clearNotepad({ canRestore = true }: { canRestore?: boolean } = {}) {
    const notePathToClear = currentNotePath;

    if (currentNotePath) {
      saveCursorPositionForNote();
      saveEditorStateForNote();
      cancelPendingAutosave();
      await enqueueSave('autosave');
    }

    const draft = { title, bodyMarkdown, currentNotePath };
    const hasContent = hasNotepadContent(draft);
    let forgottenPath: string | null = null;

    if (currentNotePath) {
      try {
        const forgottenNoteSummary = await forgetNoteSession(
          currentNotePath,
          $forgottenNoteRetentionPreference
        );
        forgottenPath = forgottenNoteSummary?.forgottenPath ?? null;
      } catch (error) {
        console.error('Failed to forget note:', error);
        return;
      }
    }

    const noteToForget =
      canRestore && hasContent ? createForgottenNote(draft, forgottenPath) : null;
    forgottenNote = noteToForget;
    applySessionSnapshot(createEmptySessionSnapshot());
    canUnforget = canRestore && hasContent;
    await replaceEditorContent('');
    discardEditorStateForNote(notePathToClear);
    scheduleSearch();
    void loadRecentNotes();
    scheduleAutoSync('note-forgotten', 400);
  }

  async function unforgetNotepad() {
    if (!forgottenNote) return;

    if (forgottenNote.forgottenPath) {
      try {
        const restoredNotes = await restoreForgottenNotes([forgottenNote.forgottenPath]);
        const restoredPath = restoredNotes[0]?.restoredPath;
        if (!restoredPath) {
          return;
        }

        applySessionSnapshot(await openNoteSession(restoredPath));
        canUnforget = false;
        forgottenNote = null;
        await replaceEditorContent(bodyMarkdown);
        scheduleSearch();
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
      lastSavedMarkdown: '',
      lastSavedPath: null
    });
    canUnforget = false;
    await replaceEditorContent(forgottenNote.bodyMarkdown);
    forgottenNote = null;
    scheduleAutosave();
    scheduleSearch();
    void loadRecentNotes();
    scheduleAutoSync('forgotten-restored-draft', 400);
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
      assetRootPath = resolveAssetRootPath(vaultInfo.currentPath);
    } catch (error) {
      console.error('Failed to load vault info for image assets:', error);
      assetRootPath = null;
    }
  }

  async function refreshCurrentNoteIfChanged() {
    if (!currentNotePath || !isEditorReady || isRefreshingFromDisk || !hasCleanBuffer()) {
      return;
    }

    isRefreshingFromDisk = true;

    try {
      const session = await readNoteSession(currentNotePath);

      if (!hasCleanBuffer() || session.currentNotePath !== currentNotePath) {
        return;
      }

      if (
        session.lastSavedMarkdown === lastSavedMarkdown &&
        session.lastSavedPath === lastSavedPath
      ) {
        return;
      }

      applySessionSnapshot(session);
      canUnforget = false;
      forgottenNote = null;
      await replaceEditorContentInPlace(session.bodyMarkdown);
      scheduleSearch();
    } catch (error) {
      console.error('Failed to refresh note from disk:', error);
    } finally {
      isRefreshingFromDisk = false;
    }
  }

  function scheduleAutosave() {
    if (saveTimer) window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      saveTimer = null;
      void enqueueSave('autosave');
    }, 1000);
  }

  function scheduleSearch() {
    if (searchTimer) window.clearTimeout(searchTimer);

    if (searchQuery.trim() === '') {
      searchResults = [];
      isSearching = false;
      return;
    }

    searchTimer = window.setTimeout(() => {
      searchTimer = null;
      void runSearch(searchQuery);
    }, 120);
  }

  async function enqueueSave(mode: NotepadSaveMode) {
    saveQueue = saveQueue
      .then(() => persistNote(mode))
      .catch((error) => {
        console.error(`Failed to ${mode} note:`, error);
      });

    return saveQueue;
  }

  function flushPendingAutosave() {
    if (!saveTimer) return;

    window.clearTimeout(saveTimer);
    saveTimer = null;
    void enqueueSave('autosave');
  }

  async function persistNote(mode: NotepadSaveMode) {
    const markdown = getCurrentMarkdown();

    if (
      mode === 'autosave' &&
      shouldSkipAutosave(markdown, currentNotePath, { lastSavedMarkdown, lastSavedPath })
    ) {
      return;
    }

    if (mode === 'remember') {
      await rememberNoteSession(markdown, currentNotePath);
      scheduleAutoSync('note-remembered', 400);
      return;
    }

    applySessionSnapshot(await saveNoteSession(markdown, currentNotePath));
    scheduleAutoSync('note-saved', 600);
  }

  async function rememberCurrentNote() {
    const rememberedPath = currentNotePath;
    saveCursorPositionForNote();
    saveEditorStateForNote();
    cancelPendingAutosave();

    await enqueueSave('remember');
    currentNotePath = null;
    lastSavedMarkdown = '';
    lastSavedPath = null;
    forgottenNote = null;
    discardEditorStateForNote(rememberedPath);
    clearSearch();
    await clearNotepad({ canRestore: false });
  }

  function handleTitleInput(event: Event) {
    title = (event.currentTarget as HTMLInputElement).value;
    if (title.trim() !== '' || bodyMarkdown.trim() !== '') canUnforget = false;
    scheduleAutosave();
    scheduleSearch();
  }

  function focusTitleAtEnd() {
    focusInputAtEnd(titleInput);
  }

  function cancelPendingAutosave() {
    if (!saveTimer) {
      return;
    }

    window.clearTimeout(saveTimer);
    saveTimer = null;
  }

  function getNavigationContext(): NotepadNavigationContext {
    return {
      editorRoot,
      titleShell,
      currentNotePath,
      focusTitleAtEnd
    };
  }

  function getOpenContext(): NotepadOpenContext {
    return {
      currentNotePath,
      stopPendingAutosave: cancelPendingAutosave,
      enqueueAutosave: () => enqueueSave('autosave'),
      clearSearch,
      openNotePath
    };
  }

  function handleTitleKeydown(event: KeyboardEvent) {
    if (event.key !== 'Enter' || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }

    event.preventDefault();
    void focusEditorAtEnd(editorRoot);
  }

  function clearSearch() {
    searchQuery = '';
    searchResults = [];
    isSearching = false;
    activeSearchRequest += 1;
    if (searchTimer) {
      window.clearTimeout(searchTimer);
      searchTimer = null;
    }
  }

  async function runSearch(query: string) {
    const trimmedQuery = query.trim();
    if (trimmedQuery === '') {
      searchResults = [];
      isSearching = false;
      return;
    }

    const requestId = ++activeSearchRequest;
    isSearching = true;

    try {
      const results = await searchNotes(trimmedQuery, searchMode, {
        currentPath: currentNotePath,
        currentMarkdown: getCurrentMarkdown()
      });

      if (requestId !== activeSearchRequest) return;
      searchResults = results;
    } catch (error) {
      if (requestId !== activeSearchRequest) return;
      console.error('Failed to search notes:', error);
      searchResults = [];
    } finally {
      if (requestId === activeSearchRequest) {
        isSearching = false;
      }
    }
  }

  async function loadRecentNotes() {
    const requestId = ++activeRecentNotesRequest;

    try {
      const notes = await listRecentNotes({
        currentPath: currentNotePath,
        currentMarkdown: getCurrentMarkdown()
      });

      if (requestId !== activeRecentNotesRequest) return;
      recentNotes = notes;
    } catch (error) {
      if (requestId !== activeRecentNotesRequest) return;
      console.error('Failed to load recent notes:', error);
      recentNotes = [];
    }
  }

  async function refreshRecentNotesNow() {
    const requestId = ++activeRecentNotesRequest;

    try {
      const notes = await listRecentNotes({
        currentPath: currentNotePath,
        currentMarkdown: getCurrentMarkdown()
      });

      if (requestId === activeRecentNotesRequest) {
        recentNotes = notes;
      }

      return notes;
    } catch (error) {
      if (requestId === activeRecentNotesRequest) {
        recentNotes = [];
      }

      console.error('Failed to load recent notes:', error);
      return [];
    }
  }

  async function loadRecentTasks() {
    const requestId = ++activeRecentTasksRequest;

    try {
      const tasks = await listRecentTasks();

      if (requestId !== activeRecentTasksRequest) return;
      recentTasks = tasks;
    } catch (error) {
      if (requestId !== activeRecentTasksRequest) return;
      console.error('Failed to load recent tasks:', error);
      recentTasks = [];
    }
  }

  async function refreshRecentTasksNow() {
    const requestId = ++activeRecentTasksRequest;

    try {
      const tasks = await listRecentTasks();

      if (requestId === activeRecentTasksRequest) {
        recentTasks = tasks;
      }

      return tasks;
    } catch (error) {
      if (requestId === activeRecentTasksRequest) {
        recentTasks = [];
      }

      console.error('Failed to load recent tasks:', error);
      return [];
    }
  }

  async function openRecentNoteByIndex(
    index: number,
    { forceReload = false }: { forceReload?: boolean } = {}
  ) {
    const notes = forceReload || !recentNotes[index] ? await refreshRecentNotesNow() : recentNotes;
    const note = notes[index];
    if (!note) {
      return;
    }

    try {
      await openRecentNoteItem(note);
    } catch (error) {
      console.error('Failed to open recent note:', error);
    }
  }

  async function openRecentTaskByIndex(
    index: number,
    { forceReload = false }: { forceReload?: boolean } = {}
  ) {
    const tasks = forceReload || !recentTasks[index] ? await refreshRecentTasksNow() : recentTasks;
    const task = tasks[index];
    if (!task) {
      return;
    }

    try {
      await handleRecentTaskSelect(task);
    } catch (error) {
      console.error('Failed to open recent task:', error);
    }
  }

  async function openRecentNoteItem(note: SearchItem) {
    clearSearch();

    if (!note.notePath) {
      await handleSearchResultSelect(note);
      return;
    }

    await openNotePath(note.notePath);
  }

  async function handleSearchResultSelect(result: SearchItem) {
    await openSearchResult(getOpenContext(), getNavigationContext(), result);
    saveCursorPositionForNote();
  }

  async function handleRecentTaskSelect(task: RecentTaskItem) {
    await openRecentTask(getOpenContext(), getNavigationContext(), task);
    saveCursorPositionForNote();
  }

  function handleSearchInput(value: string) {
    searchQuery = value;
    if (value.trim() === '') {
      searchResults = [];
      isSearching = false;
      return;
    }
    scheduleSearch();
  }

  async function handleSearchModeChange(mode: NotepadSearchMode) {
    searchMode = mode;
    if (searchQuery.trim() !== '') {
      await runSearch(searchQuery);
    }
  }

  function handleSearchFocus() {
    void loadRecentNotes();
    void loadRecentTasks();
  }

  function requestSearchFocus(mode: NotepadSearchMode) {
    searchMode = mode;
    if (searchQuery.trim() !== '') {
      void runSearch(searchQuery);
    }
    searchFocusRequest += 1;
  }

  function closeWikilinkAutocomplete() {
    wikilinkAutocomplete = dismissWikilinkAutocomplete(wikilinkAutocomplete);
  }

  function handleActiveWikilinkChange(nextActiveWikilink: ActiveWikilink | null) {
    if (hasWikilinkAlias(nextActiveWikilink)) {
      wikilinkAutocomplete = resetWikilinkAutocomplete(wikilinkAutocomplete);
      return;
    }

    wikilinkAutocomplete = setActiveWikilink(wikilinkAutocomplete, nextActiveWikilink);

    if (!nextActiveWikilink) {
      closeWikilinkAutocomplete();
      return;
    }

    void loadWikilinkSuggestions(nextActiveWikilink);
  }

  async function loadWikilinkSuggestions(nextActiveWikilink: ActiveWikilink) {
    const pendingRequest = beginWikilinkSuggestionRequest(wikilinkAutocomplete, nextActiveWikilink);
    wikilinkAutocomplete = pendingRequest.state;

    try {
      const suggestions = await autocompleteNoteLinks(
        nextActiveWikilink.rawTarget,
        currentNotePath,
        getCurrentMarkdown()
      );
      wikilinkAutocomplete = completeWikilinkSuggestionRequest(
        wikilinkAutocomplete,
        pendingRequest.requestId,
        suggestions
      );
    } catch (error) {
      console.error('Failed to load wikilink suggestions:', error);
      wikilinkAutocomplete = completeWikilinkSuggestionRequest(
        wikilinkAutocomplete,
        pendingRequest.requestId,
        []
      );
    }
  }

  function selectWikilinkSuggestion(suggestionValue: string) {
    if (
      !insertWikilinkSuggestion(crepe, wikilinkAutocomplete.activeWikilink, suggestionValue)
    ) {
      return;
    }

    closeWikilinkAutocomplete();
  }

  function moveWikilinkSelection(direction: -1 | 1) {
    wikilinkAutocomplete = moveWikilinkSelectionState(wikilinkAutocomplete, direction);
  }

  function handleGlobalKeydown(event: KeyboardEvent) {
    if (wikilinkAutocomplete.active) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeWikilinkAutocomplete();
        return;
      }

      if (wikilinkAutocomplete.suggestions.length > 0 && event.key === 'ArrowDown') {
        event.preventDefault();
        moveWikilinkSelection(1);
        return;
      }

      if (wikilinkAutocomplete.suggestions.length > 0 && event.key === 'ArrowUp') {
        event.preventDefault();
        moveWikilinkSelection(-1);
        return;
      }

      if (
        wikilinkAutocomplete.suggestions.length > 0 &&
        (event.key === 'Enter' || event.key === 'Tab')
      ) {
        const suggestion = getSelectedWikilinkSuggestion(wikilinkAutocomplete);
        if (!suggestion) {
          return;
        }

        event.preventDefault();
        selectWikilinkSuggestion(suggestion.value);
        return;
      }
    }

    if (
      event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.shiftKey &&
      event.key.toLowerCase() === 'l'
    ) {
      event.preventDefault();
      void openRecentNoteByIndex(0, { forceReload: true });
      return;
    }

    if (!event.metaKey || event.key.toLowerCase() !== 'f') return;

    event.preventDefault();
    requestSearchFocus(event.shiftKey ? 'all' : 'current');
  }

  async function openNotePath(
    notePath: string,
    { currentNoteAlreadySaved = false }: { currentNoteAlreadySaved?: boolean } = {}
  ) {
    const previousPath = currentNotePath;
    saveCursorPositionForNote();
    saveEditorStateForNote();
    if (!currentNoteAlreadySaved && previousPath && previousPath !== notePath) {
      cancelPendingAutosave();
      await enqueueSave('autosave');
    }

    const session = await openNoteSession(notePath);
    applySessionSnapshot(session);
    canUnforget = false;
    forgottenNote = null;
    closeWikilinkAutocomplete();

    if (replaceNotepadEditorState(crepe, getEditorStateForNote(session.currentNotePath))) {
      await tick();
      return;
    }

    await replaceEditorContentInPlaceForNote(session.bodyMarkdown, session.currentNotePath);
  }

  async function openWikilink(rawTarget: string) {
    try {
      const resolved = await resolveNoteLink(rawTarget, currentNotePath, getCurrentMarkdown());

      if (!resolved) {
        return;
      }

      await openResolvedNoteLink(
        {
          currentNotePath,
          stopPendingAutosave: cancelPendingAutosave,
          enqueueAutosave: () => enqueueSave('autosave'),
          openNotePath
        },
        getNavigationContext(),
        resolved
      );
      saveCursorPositionForNote();
    } catch (error) {
      console.error('Failed to resolve wikilink:', error);
    }
  }

  function handleWindowFocus() {
    void syncAndRefresh('window-focus');
  }

  function handleVisibilityChange() {
    if (document.visibilityState === 'visible') {
      void syncAndRefresh('window-visible');
    }
  }

  async function syncAndRefresh(reason: string) {
    await runAutoSyncNow(reason);
    await refreshCurrentNoteIfChanged();
    void loadRecentNotes();
    void loadRecentTasks();
    if (searchQuery.trim() !== '') {
      scheduleSearch();
    }
  }

  async function handleVaultNoteChanged(payload: VaultNoteChangeEvent) {
    if (currentNotePath === payload.notePath) {
      await refreshCurrentNoteIfChanged();
    } else if (payload.deleted) {
      discardEditorStateForNote(payload.notePath);
    }
    void loadRecentNotes();
    void loadRecentTasks();
    if (searchQuery.trim() !== '') {
      scheduleSearch();
    }
    scheduleAutoSync('vault-note-change', 1200);
  }

  onMount(() => {
    let mounted = true;

    (async () => {
      await tick();
      if (!mounted || !editorRoot) return;
      await Promise.all([loadSavedNote(), loadAssetRoot()]);
      if (!mounted || !editorRoot) return;
      try {
        await createEditor(bodyMarkdown);
        restoreCursorPositionForNote();
        const pendingTaskTarget = consumePendingTaskTarget();
        if (pendingTaskTarget) {
          await navigateToPendingTaskTarget(getNavigationContext(), pendingTaskTarget);
        }
        vaultNoteChangeUnlisten = await listen<VaultNoteChangeEvent>(
          'vault-note-changed',
          ({ payload }) => {
            void handleVaultNoteChanged(payload);
          }
        );
        scheduleAutoSync('notepad-mounted', 900);
      } catch (err) {
        console.error('Notepad init failed:', err);
      }
    })();

    return () => {
      mounted = false;
      isEditorReady = false;
      saveCursorPositionForNote();
      saveEditorStateForNote();
      flushPendingAutosave();
      cancelScheduledAutoSync();
      if (searchTimer) window.clearTimeout(searchTimer);
      vaultNoteChangeUnlisten?.();
      vaultNoteChangeUnlisten = null;
      void destroyEditor();
    };
  });

  $effect(() => {
    if (!isEditorReady || !editorRoot) {
      return;
    }

    const proseMirror = editorRoot.querySelector('.ProseMirror');
    if (!(proseMirror instanceof HTMLElement)) {
      return;
    }

    const persistCursorPosition = () => {
      saveCursorPositionForNote();
    };

    proseMirror.addEventListener('keyup', persistCursorPosition);
    proseMirror.addEventListener('mouseup', persistCursorPosition);
    proseMirror.addEventListener('touchend', persistCursorPosition);
    proseMirror.addEventListener('focusout', persistCursorPosition);

    return () => {
      proseMirror.removeEventListener('keyup', persistCursorPosition);
      proseMirror.removeEventListener('mouseup', persistCursorPosition);
      proseMirror.removeEventListener('touchend', persistCursorPosition);
      proseMirror.removeEventListener('focusout', persistCursorPosition);
    };
  });
</script>

<svelte:window onkeydowncapture={handleGlobalKeydown} onfocus={handleWindowFocus} />
<svelte:document onvisibilitychange={handleVisibilityChange} />

<div bind:this={notepadShell} class="notepad-shell relative h-full w-full min-h-0 overflow-x-hidden overflow-y-visible">
  <div class="relative flex h-full min-h-0 w-full flex-col overflow-hidden border-y border-border text-card-foreground shadow-sm transition-all duration-300 sm:rounded-[2rem] sm:border">
    <!-- Title bar -->
    <div class="absolute top-0 left-0 right-0 z-20">
      <div class="relative">
        <div
          class="pointer-events-none absolute inset-0 bg-card/70 backdrop-blur-md"
          style="mask-image: linear-gradient(to top, transparent 0%, black 40%, black 100%); -webkit-mask-image: linear-gradient(to top, transparent 0%, black 40%, black 100%); mask-size: 100% 100%; -webkit-mask-size: 100% 100%;"
        ></div>
        <div class="relative z-10 px-4 pt-2 pb-2 sm:px-8 sm:pt-3 sm:pb-4">
          <div bind:this={titleShell} class="mx-auto flex w-full max-w-3xl flex-col items-start gap-1 rounded-[1.4rem] px-0 py-1 transition-all duration-300 sm:items-center sm:gap-2 sm:px-4 sm:py-2">
            <div class="flex w-full items-center justify-start gap-3 text-[1.35rem] font-semibold tracking-tight text-foreground sm:justify-center sm:text-3xl">
              <input
                bind:this={titleInput}
                type="text"
                class="w-full max-w-2xl bg-transparent text-left outline-none placeholder:text-muted-foreground/55 sm:text-center"
                placeholder="Title"
                value={title}
                oninput={handleTitleInput}
                onkeydown={handleTitleKeydown}
              />
            </div>
            <div class="h-px w-16 rounded-full bg-border sm:w-40"></div>
          </div>
        </div>
      </div>
    </div>
    <!-- Editor Area -->
    <div class="flex-1 min-h-0">
      <div bind:this={editorShell} class="notepad-editor-shell relative h-full">
        {#if !isEditorReady}
          <div class="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
            <span class="rounded-full bg-card px-4 py-2 text-sm font-medium text-muted-foreground shadow-sm">
              Loading editor
            </span>
          </div>
        {/if}

        <div bind:this={editorRoot} class="min-h-full"></div>
      </div>
    </div>
    <!-- Bottom Bar -->
    <div class="absolute bottom-0 left-0 right-0 z-10">
      <BottomBar
        {canUnforget}
        {searchMode}
        {searchQuery}
        {searchResults}
        {recentNotes}
        {recentTasks}
        {isSearching}
        focusRequest={searchFocusRequest}
        onForget={() => void clearNotepad()}
        onUnforget={() => void unforgetNotepad()}
        onRemember={() => void rememberCurrentNote()}
        onSearchInput={handleSearchInput}
        onSearchModeChange={handleSearchModeChange}
        onSearchSelect={(result) =>
          void handleSearchResultSelect(result).catch((error) => {
            console.error('Failed to open searched note:', error);
          })}
        onRecentNoteSelect={(result) =>
          void openRecentNoteItem(result).catch((error) => {
            console.error('Failed to open recent note:', error);
          })}
        onRecentTaskSelect={(task) =>
          void handleRecentTaskSelect(task).catch((error) => {
            console.error('Failed to open recent task:', error);
          })}
        onRecentNoteShortcut={(index) => void openRecentNoteByIndex(index)}
        onRecentTaskShortcut={(index) => void openRecentTaskByIndex(index)}
        onSearchFocus={handleSearchFocus}
      />
    </div>
  </div>
  <div bind:this={slashMenuPortal} class="notepad-slash-portal milkdown fixed inset-0 z-40 pointer-events-none"></div>
  <NotepadWikilinkAutocomplete
    active={wikilinkAutocomplete.active}
    activeWikilink={wikilinkAutocomplete.activeWikilink}
    suggestions={wikilinkAutocomplete.suggestions}
    selectedIndex={wikilinkAutocomplete.selectedIndex}
    onSelect={(suggestion) => selectWikilinkSuggestion(suggestion.value)}
  />
</div>

<style>
  .notepad-shell {
    --editor-left-padding: 1rem;
    --editor-right-padding: 1rem;
    --editor-readable-width: 100%;
    --editor-top-padding: 4.25rem;
    --editor-bottom-padding: calc(7rem + env(safe-area-inset-bottom, 0px));
    overflow-x: clip;
  }

  @media (min-width: 640px) {
    .notepad-shell {
      --editor-left-padding: 3.75rem;
      --editor-right-padding: 1.5rem;
      --editor-readable-width: 44rem;
      --editor-top-padding: 6rem;
      --editor-bottom-padding: 100%;
    }
  }

  @media (min-width: 1024px) {
    .notepad-shell {
      --editor-left-padding: 5.5rem;
      --editor-right-padding: 2.5rem;
      --editor-readable-width: 48rem;
    }
  }

  @media (min-width: 1440px) {
    .notepad-shell {
      --editor-left-padding: 7.25rem;
      --editor-right-padding: 3.5rem;
      --editor-readable-width: 52rem;
    }
  }

  .notepad-editor-shell {
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
  }

  .notepad-shell,
  .notepad-editor-shell :global(.milkdown),
  .notepad-slash-portal {
    --crepe-color-background: var(--card);
    --crepe-color-on-background: var(--foreground);
    --crepe-color-surface: color-mix(in oklab, var(--card) 92%, var(--background));
    --crepe-color-surface-low: color-mix(in oklab, var(--muted) 74%, var(--card));
    --crepe-color-on-surface: var(--card-foreground);
    --crepe-color-on-surface-variant: var(--muted-foreground);
    --crepe-color-outline: color-mix(in oklab, var(--border) 82%, var(--foreground));
    --crepe-color-primary: var(--foreground);
    --crepe-color-secondary: var(--accent);
    --crepe-color-on-secondary: var(--accent-foreground);
    --crepe-color-inverse: var(--foreground);
    --crepe-color-on-inverse: var(--background);
    --crepe-color-inline-code: var(--destructive);
    --crepe-color-error: var(--destructive);
    --crepe-color-hover: color-mix(in oklab, var(--accent) 82%, transparent);
    --crepe-color-selected: color-mix(in oklab, var(--accent) 92%, var(--background));
    --crepe-color-inline-area: color-mix(in oklab, var(--muted) 80%, var(--background));
  }

  .notepad-editor-shell :global(.milkdown) {
    min-height: 100%;
    width: 100%;
    max-width: 100%;
    overflow-x: clip;
  }

  /* Hide the + button that adds a new line in the block handle */
  .notepad-editor-shell :global(.milkdown .milkdown-block-handle .operation-item:first-child) {
    display: none;
  }

  .notepad-editor-shell :global(.milkdown .ProseMirror) {
    box-sizing: border-box;
    min-height: 100%;
    max-width: 100%;
    width: min(
      100%,
      calc(var(--editor-readable-width) + var(--editor-left-padding) + var(--editor-right-padding))
    );
    margin-inline: auto;
    padding-top: var(--editor-top-padding);
    padding-left: var(--editor-left-padding);
    padding-right: var(--editor-right-padding);
    padding-bottom: var(--editor-bottom-padding);
    overflow-anchor: auto;
    position: relative;
  }

  .notepad-editor-shell :global(.milkdown .ProseMirror > *) {
    max-width: 100%;
  }

  .notepad-editor-shell :global(.milkdown .ProseMirror .gn-wikilink) {
    border-radius: 0.35rem;
    background: color-mix(in oklab, var(--accent) 54%, transparent);
    color: color-mix(in oklab, var(--foreground) 88%, var(--accent-foreground) 12%);
    cursor: pointer;
    text-decoration: underline;
    text-decoration-thickness: 0.08em;
    text-underline-offset: 0.14em;
  }

  .notepad-editor-shell :global(.milkdown .ProseMirror .gn-wikilink:hover) {
    background: color-mix(in oklab, var(--accent) 72%, transparent);
  }

  .notepad-editor-shell :global(.milkdown .ProseMirror .gn-image-embed-source) {
    display: none;
  }

  .notepad-editor-shell :global(.milkdown .ProseMirror .gn-image-embed) {
    display: block;
    position: relative;
    max-width: min(100%, 42rem);
    margin: 0.9rem 0;
    cursor: text;
  }

  .notepad-editor-shell :global(.milkdown .ProseMirror .gn-image-embed img) {
    display: block;
    width: auto;
    max-width: 100%;
    height: auto;
    border-radius: 0.9rem;
    border: 1px solid color-mix(in oklab, var(--border) 84%, transparent);
    background: color-mix(in oklab, var(--card) 92%, var(--background));
    box-shadow:
      0 14px 28px -24px color-mix(in oklab, var(--foreground) 34%, transparent),
      0 4px 12px -8px color-mix(in oklab, var(--foreground) 18%, transparent);
  }

  .notepad-editor-shell :global(.milkdown .ProseMirror .gn-image-embed-resize-handle) {
    position: absolute;
    right: 0.5rem;
    bottom: 0.5rem;
    width: 1rem;
    height: 1rem;
    border-radius: 999px;
    border: 1px solid color-mix(in oklab, var(--background) 72%, transparent);
    background: color-mix(in oklab, var(--foreground) 76%, var(--accent) 24%);
    box-shadow: 0 3px 10px -6px color-mix(in oklab, var(--foreground) 60%, transparent);
    cursor: nwse-resize;
    opacity: 0;
    transition: opacity 120ms ease;
  }

  .notepad-editor-shell :global(.milkdown .ProseMirror .gn-image-embed:hover .gn-image-embed-resize-handle) {
    opacity: 1;
  }

  .notepad-editor-shell :global(.milkdown .ProseMirror .gn-image-embed[data-broken='true'] img) {
    opacity: 0.45;
    filter: grayscale(1);
  }

  .notepad-editor-shell :global(.milkdown .ProseMirror .gn-image-upload-placeholder) {
    display: inline-flex;
    align-items: center;
    padding: 0.45rem 0.7rem;
    border-radius: 999px;
    border: 1px solid color-mix(in oklab, var(--border) 84%, transparent);
    background: color-mix(in oklab, var(--card) 92%, var(--background));
    color: color-mix(in oklab, var(--foreground) 72%, transparent);
    font-size: 0.92rem;
  }

  .notepad-editor-shell :global(.ProseMirror.virtual-cursor-enabled) {
    caret-color: transparent;
  }

  :global(.dark) .notepad-editor-shell :global(.milkdown .ProseMirror-focused) {
    --prosemirror-virtual-cursor-color: color-mix(
      in oklab,
      var(--foreground) 88%,
      var(--accent) 12%
    );
  }

  .notepad-slash-portal :global(.milkdown-slash-menu) {
    pointer-events: auto;
    z-index: 60;
  }

  .notepad-slash-portal :global(.milkdown-slash-menu .menu-groups) {
    max-height: min(420px, var(--notepad-slash-menu-max-height, calc(100vh - 2rem)));
  }

  :global(.notepad-block-type-menu) {
    --crepe-color-surface: color-mix(in oklab, var(--card) 92%, var(--background));
    --crepe-color-on-surface: var(--card-foreground);
    --crepe-color-outline: color-mix(in oklab, var(--border) 82%, var(--foreground));
    --crepe-color-hover: color-mix(in oklab, var(--accent) 82%, transparent);
    --crepe-color-selected: color-mix(in oklab, var(--accent) 92%, var(--background));

    position: fixed;
    z-index: 50;
    display: block;
    font-family: var(--font-sans);
    color: var(--crepe-color-on-surface);
    background: var(--crepe-color-surface);
    border-radius: 12px;
    box-shadow:
      0px 1px 3px 1px rgba(0, 0, 0, 0.15),
      0px 1px 2px 0px rgba(0, 0, 0, 0.3);
  }

  :global(.notepad-block-type-menu[data-open='false']) {
    display: none;
  }

  :global(.notepad-block-type-menu-tabs) {
    border-bottom: 1px solid color-mix(in srgb, var(--crepe-color-outline), transparent 80%);
    padding: 12px 12px 0;
  }

  :global(.notepad-block-type-menu-tabs ul) {
    list-style-type: none;
    margin: 0;
    padding: 8px 10px;
    display: flex;
    gap: 10px;
    flex-wrap: nowrap;
  }

  :global(.notepad-block-type-menu-tabs ul li) {
    padding: 6px 10px;
    font-size: 14px;
    font-style: normal;
    font-weight: 600;
    line-height: 20px;
    border-radius: 8px;
    cursor: pointer;
    white-space: nowrap;
    user-select: none;
  }

  :global(.notepad-block-type-menu-tabs ul li:hover) {
    background: var(--crepe-color-hover);
  }

  :global(.notepad-block-type-menu-tabs ul li.selected) {
    background: var(--crepe-color-selected);
  }

  :global(.notepad-block-type-menu-groups) {
    padding: 0 12px 12px;
    max-height: min(420px, calc(100vh - 24px));
    overflow: auto;
    overscroll-behavior: contain;
    scroll-behavior: smooth;
  }

  :global(.notepad-block-type-menu-group h6) {
    font-size: 14px;
    font-style: normal;
    font-weight: 600;
    line-height: 20px;
    padding: 14px 10px;
    text-transform: uppercase;
    margin: 0;
    color: color-mix(in srgb, var(--crepe-color-on-surface), transparent 40%);
  }

  :global(.notepad-block-type-menu-group + .notepad-block-type-menu-group)::before {
    content: '';
    display: block;
    height: 1px;
    background: color-mix(in srgb, var(--crepe-color-outline), transparent 80%);
    margin: 0 10px;
  }

  :global(.notepad-block-type-menu-item) {
    min-width: 220px;
    display: flex;
    justify-content: flex-start;
    align-items: center;
    gap: 16px;
    padding: 14px 10px;
    border: none;
    background: transparent;
    border-radius: 8px;
    cursor: pointer;
    white-space: nowrap;
    width: 100%;
  }

  :global(.notepad-block-type-menu-item > span) {
    font-size: 14px;
    font-style: normal;
    font-weight: 600;
    line-height: 20px;
  }

  :global(.notepad-block-type-menu-item > svg) {
    width: 24px;
    height: 24px;
    color: var(--crepe-color-outline);
    fill: var(--crepe-color-outline);
    flex-shrink: 0;
  }

  :global(.notepad-block-type-menu-item:hover) {
    background: var(--crepe-color-hover);
  }

  :global(.notepad-block-type-menu-item[data-active='true']) {
    background: var(--crepe-color-selected);
  }
</style>
