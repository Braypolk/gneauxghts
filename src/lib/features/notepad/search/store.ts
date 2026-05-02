import { get, writable } from 'svelte/store';
import type { SearchItem } from '$lib/types/semantic';
import {
  getIndexedRecentItem,
  loadLatestCollection,
  openRecentNoteItem as openRecentNoteListItem,
  runRecentSelection
} from '$lib/features/notepad/search/recent';
import {
  listRecentFocus,
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
  /**
   * Called only when the resolved (post-debounce) search query or mode
   * changes so that side effects like editor highlight sync do not run
   * on every keystroke. Also fires immediately on mode changes and when
   * the query is cleared.
   */
  onSearchHighlightsChange?: (state: Pick<NotepadSearchState, 'searchMode' | 'searchQuery'>) => void;
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
  onSearchHighlightsChange
}: SearchStoreDeps) {
  const store = writable<NotepadSearchState>(createInitialState());
  const { subscribe, update } = store;

  let searchTimer: ReturnType<typeof window.setTimeout> | null = null;
  let activeSearchRequest = 0;
  let activeRecentNotesRequest = 0;
  let activeRecentTasksRequest = 0;
  let lastEmittedHighlightQuery = '';
  let lastEmittedHighlightMode: SearchMode = 'all';

  function patch(partial: Partial<NotepadSearchState>) {
    update((state) => ({ ...state, ...partial }));
  }

  function emitHighlightsChange() {
    const state = get(store);
    if (
      state.searchMode === lastEmittedHighlightMode &&
      state.searchQuery === lastEmittedHighlightQuery
    ) {
      return;
    }
    lastEmittedHighlightMode = state.searchMode;
    lastEmittedHighlightQuery = state.searchQuery;
    onSearchHighlightsChange?.({
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
    emitHighlightsChange();
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
    // The resolved query is now stable; sync editor highlights once per
    // post-debounce search rather than on every keystroke.
    emitHighlightsChange();

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

      // Batch the results + isSearching flip into a single store update so
      // subscribers (and Svelte 5 effect graphs) only see one notification
      // instead of two back-to-back per completed search.
      patch({ searchResults: results, isSearching: false });
    } catch (error) {
      if (requestId !== activeSearchRequest) {
        return;
      }

      console.error('Failed to search notes:', error);
      patch({ searchResults: [], isSearching: false });
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
    const state = get(store);
    const cachedItem = state.recentNotes[index];
    // If the cached item is the current note, the recent list is stale —
    // we need a fresh list from the backend (which excludes the current note).
    const isStale = cachedItem && cachedItem.notePath === getCurrentPath();
    const effectiveForceReload = forceReload || isStale;
    const note = await getIndexedRecentItem(index, state.recentNotes, effectiveForceReload, refreshRecentNotesNow);
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

    if (value.trim() === '') {
      activeSearchRequest += 1;
      clearPendingSearchTimer();
      patch({
        searchResults: [],
        isSearching: false
      });
      // Empty query: clear highlights immediately.
      emitHighlightsChange();
      return;
    }

    // Highlights are emitted post-debounce inside runSearch so that we don't
    // hit the editor on every keystroke.
    scheduleSearch();
  }

  async function handleSearchModeChange(mode: SearchMode) {
    patch({ searchMode: mode });
    // Mode changes are explicit and infrequent; refresh highlights immediately.
    emitHighlightsChange();
    clearPendingSearchTimer();
    if (get(store).searchQuery.trim() !== '') {
      await runSearch(get(store).searchQuery);
    }
  }

  async function loadRecentFocus() {
    const notesRequestId = ++activeRecentNotesRequest;
    const tasksRequestId = ++activeRecentTasksRequest;
    try {
      const bundle = await listRecentFocus({ currentPath: getCurrentPath() });
      const notesIsLatest = notesRequestId === activeRecentNotesRequest;
      const tasksIsLatest = tasksRequestId === activeRecentTasksRequest;
      if (!notesIsLatest && !tasksIsLatest) {
        return;
      }
      // Apply both halves in a single update so subscribers see notes and
      // tasks land together rather than firing two writable-store updates.
      update((state) => ({
        ...state,
        ...(notesIsLatest ? { recentNotes: bundle.recentNotes } : {}),
        ...(tasksIsLatest ? { recentTasks: bundle.recentTasks } : {})
      }));
    } catch (error) {
      console.error('Failed to load recent focus:', error);
      const notesIsLatest = notesRequestId === activeRecentNotesRequest;
      const tasksIsLatest = tasksRequestId === activeRecentTasksRequest;
      if (notesIsLatest || tasksIsLatest) {
        update((state) => ({
          ...state,
          ...(notesIsLatest ? { recentNotes: [] } : {}),
          ...(tasksIsLatest ? { recentTasks: [] } : {})
        }));
      }
    }
  }

  function handleSearchFocus() {
    void loadRecentFocus();
  }

  function requestSearchFocus(mode: SearchMode) {
    patch({
      searchMode: mode,
      focusRequest: get(store).focusRequest + 1
    });
    emitHighlightsChange();

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
