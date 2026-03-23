import type { SearchItem } from '$lib/types/semantic';
import {
  getIndexedRecentItem,
  loadLatestCollection,
  openRecentNoteItem as openRecentNoteListItem,
  runRecentSelection
} from './notepadRecent';
import { listRecentNotes, listRecentTasks, searchNotes, type NotepadSearchMode } from './notepadSearch';
import type { RecentTaskItem } from './notepadTypes';

interface NotepadSearchControllerDeps {
  getCurrentMarkdown: () => string;
  getCurrentPath: () => string | null;
  getSearchMode: () => NotepadSearchMode;
  setSearchMode: (mode: NotepadSearchMode) => void;
  getSearchQuery: () => string;
  setSearchQuery: (query: string) => void;
  setSearchResults: (results: SearchItem[]) => void;
  getRecentNotes: () => SearchItem[];
  setRecentNotes: (notes: SearchItem[]) => void;
  getRecentTasks: () => RecentTaskItem[];
  setRecentTasks: (tasks: RecentTaskItem[]) => void;
  setIsSearching: (value: boolean) => void;
  bumpSearchFocusRequest: () => void;
  openSearchResult: (result: SearchItem) => Promise<void>;
  openRecentTask: (task: RecentTaskItem) => Promise<void>;
  openNotePath: (notePath: string) => Promise<void>;
}

export function createNotepadSearchController({
  getCurrentMarkdown,
  getCurrentPath,
  getSearchMode,
  setSearchMode,
  getSearchQuery,
  setSearchQuery,
  setSearchResults,
  getRecentNotes,
  setRecentNotes,
  getRecentTasks,
  setRecentTasks,
  setIsSearching,
  bumpSearchFocusRequest,
  openSearchResult,
  openRecentTask,
  openNotePath
}: NotepadSearchControllerDeps) {
  let searchTimer: ReturnType<typeof window.setTimeout> | null = null;
  let activeSearchRequest = 0;
  let activeRecentNotesRequest = 0;
  let activeRecentTasksRequest = 0;

  function clearPendingSearchTimer() {
    if (!searchTimer) {
      return;
    }

    window.clearTimeout(searchTimer);
    searchTimer = null;
  }

  function clearSearch() {
    setSearchQuery('');
    setSearchResults([]);
    setIsSearching(false);
    activeSearchRequest += 1;
    clearPendingSearchTimer();
  }

  async function runSearch(query: string) {
    const trimmedQuery = query.trim();
    if (trimmedQuery === '') {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    const requestId = ++activeSearchRequest;
    setIsSearching(true);

    try {
      const results = await searchNotes(trimmedQuery, getSearchMode(), {
        currentPath: getCurrentPath(),
        currentMarkdown: getCurrentMarkdown()
      });

      if (requestId !== activeSearchRequest) {
        return;
      }

      setSearchResults(results);
    } catch (error) {
      if (requestId !== activeSearchRequest) {
        return;
      }

      console.error('Failed to search notes:', error);
      setSearchResults([]);
    } finally {
      if (requestId === activeSearchRequest) {
        setIsSearching(false);
      }
    }
  }

  function scheduleSearch() {
    clearPendingSearchTimer();

    if (getSearchQuery().trim() === '') {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    searchTimer = window.setTimeout(() => {
      searchTimer = null;
      void runSearch(getSearchQuery());
    }, 120);
  }

  async function loadRecentNotes() {
    const requestId = ++activeRecentNotesRequest;
    const result = await loadLatestCollection(
      () => requestId === activeRecentNotesRequest,
      () =>
        listRecentNotes({
          currentPath: getCurrentPath(),
          currentMarkdown: getCurrentMarkdown()
        }),
      setRecentNotes,
      () => {
        setRecentNotes([]);
      },
      'Failed to load recent notes:'
    );

    result.applyIfLatest();
  }

  async function refreshRecentNotesNow() {
    const requestId = ++activeRecentNotesRequest;
    const result = await loadLatestCollection(
      () => requestId === activeRecentNotesRequest,
      () =>
        listRecentNotes({
          currentPath: getCurrentPath(),
          currentMarkdown: getCurrentMarkdown()
        }),
      setRecentNotes,
      () => {
        setRecentNotes([]);
      },
      'Failed to load recent notes:'
    );

    result.applyIfLatest();
    return result.items;
  }

  async function loadRecentTasks() {
    const requestId = ++activeRecentTasksRequest;
    const result = await loadLatestCollection(
      () => requestId === activeRecentTasksRequest,
      () => listRecentTasks(),
      setRecentTasks,
      () => {
        setRecentTasks([]);
      },
      'Failed to load recent tasks:'
    );

    result.applyIfLatest();
  }

  async function refreshRecentTasksNow() {
    const requestId = ++activeRecentTasksRequest;
    const result = await loadLatestCollection(
      () => requestId === activeRecentTasksRequest,
      () => listRecentTasks(),
      setRecentTasks,
      () => {
        setRecentTasks([]);
      },
      'Failed to load recent tasks:'
    );

    result.applyIfLatest();
    return result.items;
  }

  async function openRecentNoteByIndex(
    index: number,
    { forceReload = false }: { forceReload?: boolean } = {}
  ) {
    const note = await getIndexedRecentItem(
      index,
      getRecentNotes(),
      forceReload,
      refreshRecentNotesNow
    );
    await runRecentSelection(note, openRecentNoteItem, 'Failed to open recent note:');
  }

  async function openRecentTaskByIndex(
    index: number,
    { forceReload = false }: { forceReload?: boolean } = {}
  ) {
    const task = await getIndexedRecentItem(
      index,
      getRecentTasks(),
      forceReload,
      refreshRecentTasksNow
    );
    await runRecentSelection(task, openRecentTask, 'Failed to open recent task:');
  }

  async function openRecentNoteItem(note: SearchItem) {
    await openRecentNoteListItem(note, {
      clearSearch,
      handleSearchResultSelect: openSearchResult,
      openNotePath: async (notePath) => openNotePath(notePath)
    });
  }

  function handleSearchInput(value: string) {
    setSearchQuery(value);
    if (value.trim() === '') {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    scheduleSearch();
  }

  async function handleSearchModeChange(mode: NotepadSearchMode) {
    setSearchMode(mode);
    if (getSearchQuery().trim() !== '') {
      await runSearch(getSearchQuery());
    }
  }

  function handleSearchFocus() {
    void loadRecentNotes();
    void loadRecentTasks();
  }

  function requestSearchFocus(mode: NotepadSearchMode) {
    setSearchMode(mode);
    if (getSearchQuery().trim() !== '') {
      void runSearch(getSearchQuery());
    }

    bumpSearchFocusRequest();
  }

  function dispose() {
    clearPendingSearchTimer();
    activeSearchRequest += 1;
    activeRecentNotesRequest += 1;
    activeRecentTasksRequest += 1;
  }

  return {
    clearSearch,
    runSearch,
    scheduleSearch,
    loadRecentNotes,
    loadRecentTasks,
    openRecentNoteItem,
    openRecentNoteByIndex,
    openRecentTaskByIndex,
    handleSearchInput,
    handleSearchModeChange,
    handleSearchFocus,
    requestSearchFocus,
    dispose
  };
}
