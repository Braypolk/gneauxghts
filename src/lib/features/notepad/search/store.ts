import { get, writable } from 'svelte/store';
import type { SearchItem } from '$lib/types/semantic';
import {
  getIndexedRecentItem,
  loadLatestCollection,
  openRecentNoteItem as openRecentNoteListItem,
  runRecentSelection
} from '$lib/features/notepad/search/recent';
import {
  listRecentNotes,
  listRecentTasks,
  searchNotes,
  type SearchMode
} from '$lib/features/notepad/search/search';
import type { RecentTaskItem } from '$lib/features/notepad/model/types';

export interface NotepadSearchState {
  searchMode: SearchMode;
  searchQuery: string;
  searchResults: SearchItem[];
  recentNotes: SearchItem[];
  recentTasks: RecentTaskItem[];
  isSearching: boolean;
  focusRequest: number;
}

interface SearchStoreDeps {
  getCurrentTitle: () => string;
  getCurrentMarkdown: () => string;
  getCurrentPath: () => string | null;
  openSearchResult: (result: SearchItem) => Promise<void>;
  openRecentTask: (task: RecentTaskItem) => Promise<void>;
  openNote: (noteId: string | null, notePath: string | null) => Promise<void>;
  onSearchStateChange?: (state: Pick<NotepadSearchState, 'searchMode' | 'searchQuery'>) => void;
}

function createInitialState(): NotepadSearchState {
  return {
    searchMode: 'all',
    searchQuery: '',
    searchResults: [],
    recentNotes: [],
    recentTasks: [],
    isSearching: false,
    focusRequest: 0
  };
}

export function createNotepadSearchStore({
  getCurrentTitle,
  getCurrentMarkdown,
  getCurrentPath,
  openSearchResult,
  openRecentTask,
  openNote,
  onSearchStateChange
}: SearchStoreDeps) {
  const store = writable<NotepadSearchState>(createInitialState());
  const { subscribe, update } = store;

  let searchTimer: ReturnType<typeof window.setTimeout> | null = null;
  let activeSearchRequest = 0;
  let activeRecentNotesRequest = 0;
  let activeRecentTasksRequest = 0;

  function patch(partial: Partial<NotepadSearchState>) {
    update((state) => ({ ...state, ...partial }));
  }

  function emitSearchStateChange() {
    const state = get(store);
    onSearchStateChange?.({
      searchMode: state.searchMode,
      searchQuery: state.searchQuery
    });
  }

  function clearPendingSearchTimer() {
    if (!searchTimer) {
      return;
    }

    window.clearTimeout(searchTimer);
    searchTimer = null;
  }

  function clearSearch() {
    patch({
      searchQuery: '',
      searchResults: [],
      isSearching: false
    });
    emitSearchStateChange();
    activeSearchRequest += 1;
    clearPendingSearchTimer();
  }

  async function runSearch(query: string) {
    const trimmedQuery = query.trim();
    if (trimmedQuery === '') {
      patch({
        searchResults: [],
        isSearching: false
      });
      return;
    }

    const requestId = ++activeSearchRequest;
    patch({ isSearching: true });

    try {
      const state = get(store);
      const results = await searchNotes(trimmedQuery, state.searchMode, {
        currentPath: getCurrentPath(),
        currentTitle: getCurrentTitle(),
        currentMarkdown: getCurrentMarkdown()
      });

      if (requestId !== activeSearchRequest) {
        return;
      }

      patch({ searchResults: results });
    } catch (error) {
      if (requestId !== activeSearchRequest) {
        return;
      }

      console.error('Failed to search notes:', error);
      patch({ searchResults: [] });
    } finally {
      if (requestId === activeSearchRequest) {
        patch({ isSearching: false });
      }
    }
  }

  function scheduleSearch() {
    clearPendingSearchTimer();

    if (get(store).searchQuery.trim() === '') {
      patch({
        searchResults: [],
        isSearching: false
      });
      return;
    }

    searchTimer = window.setTimeout(() => {
      searchTimer = null;
      void runSearch(get(store).searchQuery);
    }, 120);
  }

  async function loadRecentNotes() {
    const requestId = ++activeRecentNotesRequest;
    const result = await loadLatestCollection(
      () => requestId === activeRecentNotesRequest,
      () =>
        listRecentNotes({
          currentPath: getCurrentPath()
        }),
      (notes) => {
        patch({ recentNotes: notes });
      },
      () => {
        patch({ recentNotes: [] });
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
          currentPath: getCurrentPath()
        }),
      (notes) => {
        patch({ recentNotes: notes });
      },
      () => {
        patch({ recentNotes: [] });
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
      (tasks) => {
        patch({ recentTasks: tasks });
      },
      () => {
        patch({ recentTasks: [] });
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
      (tasks) => {
        patch({ recentTasks: tasks });
      },
      () => {
        patch({ recentTasks: [] });
      },
      'Failed to load recent tasks:'
    );

    result.applyIfLatest();
    return result.items;
  }

  async function openRecentNoteByIndex(index: number, { forceReload = false }: { forceReload?: boolean } = {}) {
    const note = await getIndexedRecentItem(index, get(store).recentNotes, forceReload, refreshRecentNotesNow);
    await runRecentSelection(note, openRecentNoteItem, 'Failed to open recent note:');
  }

  async function openRecentTaskByIndex(index: number, { forceReload = false }: { forceReload?: boolean } = {}) {
    const task = await getIndexedRecentItem(index, get(store).recentTasks, forceReload, refreshRecentTasksNow);
    await runRecentSelection(task, openRecentTask, 'Failed to open recent task:');
  }

  async function openRecentNoteItem(note: SearchItem) {
    await openRecentNoteListItem(note, {
      clearSearch,
      handleSearchResultSelect: openSearchResult,
      openNote: async (noteId, notePath) => openNote(noteId, notePath)
    });
  }

  function handleSearchInput(value: string) {
    patch({ searchQuery: value });
    emitSearchStateChange();

    if (value.trim() === '') {
      activeSearchRequest += 1;
      clearPendingSearchTimer();
      patch({
        searchResults: [],
        isSearching: false
      });
      return;
    }

    scheduleSearch();
  }

  async function handleSearchModeChange(mode: SearchMode) {
    patch({ searchMode: mode });
    emitSearchStateChange();
    clearPendingSearchTimer();
    if (get(store).searchQuery.trim() !== '') {
      await runSearch(get(store).searchQuery);
    }
  }

  function handleSearchFocus() {
    void loadRecentNotes();
    void loadRecentTasks();
  }

  function requestSearchFocus(mode: SearchMode) {
    patch({
      searchMode: mode,
      focusRequest: get(store).focusRequest + 1
    });
    emitSearchStateChange();

    if (get(store).searchQuery.trim() !== '') {
      void runSearch(get(store).searchQuery);
    }
  }

  function dispose() {
    clearPendingSearchTimer();
    activeSearchRequest += 1;
    activeRecentNotesRequest += 1;
    activeRecentTasksRequest += 1;
  }

  return {
    subscribe,
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
