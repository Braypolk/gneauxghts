<script lang="ts">
  import type { Crepe } from '@milkdown/crepe';
  import { onMount, tick } from 'svelte';
  import { consumePendingTaskTarget } from '$lib/taskNavigation';
  import type { SearchItem } from '$lib/types/semantic';
  import type { ActiveWikilink } from './notepadWikilinks';
  import { composeMarkdown } from './notepadDocument';
  import {
    createNotepadEditor,
    destroyNotepadEditor,
    insertWikilinkSuggestion,
    prepareNotepadEditor,
    resetNotepadSlashMenuPortal
  } from './notepadEditor';
  import { focusEditorAtEnd, focusInputAtEnd } from './notepadNavigation';
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
    loadSavedNoteSession,
    openNoteSession,
    rememberNoteSession,
    saveNoteSession,
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

  let crepe: Crepe | null = null;
  let notepadShell: HTMLDivElement | null = null;
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
      editorRoot,
      initialValue,
      onOpenLink: (rawTarget) => {
        void openWikilink(rawTarget);
      },
      onActiveWikilinkChange: handleActiveWikilinkChange,
      onMarkdownChange: (nextMarkdown) => {
        bodyMarkdown = nextMarkdown;
        if (nextMarkdown.trim() !== '') canUnforget = false;
        scheduleAutosave();
        scheduleSearch();
      }
    });
    setupSlashMenuPortal();
    isEditorReady = true;
  }

  async function replaceEditorContent(nextMarkdown: string) {
    isEditorReady = false;
    await destroyEditor();
    bodyMarkdown = nextMarkdown;
    await createEditor(nextMarkdown);
  }

  async function clearNotepad({ canRestore = true }: { canRestore?: boolean } = {}) {
    const draft = { title, bodyMarkdown, currentNotePath };
    const hasContent = hasNotepadContent(draft);
    const noteToForget = canRestore && hasContent ? createForgottenNote(draft) : null;

    if (currentNotePath) {
      try {
        await forgetNoteSession(currentNotePath);
      } catch (error) {
        console.error('Failed to forget note:', error);
        return;
      }
    }

    forgottenNote = noteToForget;
    applySessionSnapshot(createEmptySessionSnapshot());
    canUnforget = canRestore && hasContent;
    await replaceEditorContent('');
    scheduleSearch();
    void loadRecentNotes();
  }

  async function unforgetNotepad() {
    if (!forgottenNote) return;
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
  }

  async function loadSavedNote() {
    try {
      applySessionSnapshot(await loadSavedNoteSession());
    } catch (error) {
      console.error('Failed to load saved note:', error);
      applySessionSnapshot(createEmptySessionSnapshot());
    }
  }

  function scheduleAutosave() {
    if (saveTimer) window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      saveTimer = null;
      void enqueueSave('autosave');
    }, 500);
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
      return;
    }

    applySessionSnapshot(await saveNoteSession(markdown, currentNotePath));
  }

  async function rememberCurrentNote() {
    cancelPendingAutosave();

    await enqueueSave('remember');
    currentNotePath = null;
    lastSavedMarkdown = '';
    lastSavedPath = null;
    forgottenNote = null;
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

    if (!event.metaKey || event.key.toLowerCase() !== 'f') return;

    event.preventDefault();
    requestSearchFocus(event.shiftKey ? 'all' : 'current');
  }

  async function openNotePath(notePath: string) {
    const session = await openNoteSession(notePath);
    applySessionSnapshot(session);
    canUnforget = false;
    forgottenNote = null;
    await replaceEditorContent(session.bodyMarkdown);
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
    } catch (error) {
      console.error('Failed to resolve wikilink:', error);
    }
  }

  onMount(() => {
    let mounted = true;

    (async () => {
      await tick();
      if (!mounted || !editorRoot) return;
      await loadSavedNote();
      if (!mounted || !editorRoot) return;
      try {
        await createEditor(bodyMarkdown);
        const pendingTaskTarget = consumePendingTaskTarget();
        if (pendingTaskTarget) {
          await navigateToPendingTaskTarget(getNavigationContext(), pendingTaskTarget);
        }
      } catch (err) {
        console.error('Notepad init failed:', err);
      }
    })();

    return () => {
      mounted = false;
      isEditorReady = false;
      flushPendingAutosave();
      if (searchTimer) window.clearTimeout(searchTimer);
      void destroyEditor();
    };
  });
</script>

<svelte:window onkeydowncapture={handleGlobalKeydown} />

<div bind:this={notepadShell} class="notepad-shell relative w-full h-full min-h-0 overflow-visible">
  <div class="w-full h-full min-h-0 text-card-foreground rounded-[2rem] shadow-sm border border-border flex flex-col overflow-hidden transition-all duration-300 relative">
    <!-- Title bar -->
    <div class="absolute top-0 left-0 right-0 z-20">
      <div class="relative">
        <div
          class="pointer-events-none absolute inset-0 bg-card/70 backdrop-blur-md"
          style="mask-image: linear-gradient(to top, transparent 0%, black 40%, black 100%); -webkit-mask-image: linear-gradient(to top, transparent 0%, black 40%, black 100%); mask-size: 100% 100%; -webkit-mask-size: 100% 100%;"
        ></div>
        <div class="relative z-10 px-8 pt-3 pb-4">
          <div bind:this={titleShell} class="mx-auto flex w-full max-w-3xl flex-col items-center gap-2 rounded-[1.4rem] px-4 py-2 transition-all duration-300">
            <div class="flex w-full items-center justify-center gap-3 text-3xl font-semibold tracking-tight text-foreground">
              <input
                bind:this={titleInput}
                type="text"
                class="w-full max-w-2xl bg-transparent text-center outline-none placeholder:text-muted-foreground/55"
                placeholder="Title"
                value={title}
                oninput={handleTitleInput}
                onkeydown={handleTitleKeydown}
              />
            </div>
            <div class="h-px w-40 rounded-full bg-border"></div>
          </div>
        </div>
      </div>
    </div>
    <!-- Editor Area -->
    <div class="flex-1 min-h-0">
      <div class="notepad-editor-shell relative h-full">
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
          void openSearchResult(getOpenContext(), getNavigationContext(), result).catch((error) => {
            console.error('Failed to open searched note:', error);
          })}
        onRecentTaskSelect={(task) =>
          void openRecentTask(getOpenContext(), getNavigationContext(), task).catch((error) => {
            console.error('Failed to open recent task:', error);
          })}
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
