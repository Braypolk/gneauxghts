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
import { buildCurrentNoteSearchResults } from '$lib/features/notepad/search/currentNoteSearch';

export interface NotepadSearchState {
  searchMode: SearchMode;
  searchQuery: string;
  matchCase: boolean;
  matchWholeWord: boolean;
  searchResults: SearchItem[];
  recentNotes: SearchItem[];
  recentTasks: RecentTaskItem[];
  isSearching: boolean;
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
  onSearchHighlightsChange?: (state: Pick<NotepadSearchState, 'searchMode' | 'searchQuery' | 'matchCase' | 'matchWholeWord'>) => void;
}

/**
 * Svelte 5 rune-backed search store.
 *
 * Each `$state` field is reactive on its own, so consumers in Svelte 5
 * components can read just the slices they care about (e.g. `store.searchQuery`)
 * and avoid the writable-store fan-out that previously caused NotepadCommandBar to
 * re-evaluate every reactive field on each keystroke. Methods mutate the
 * fields directly; there is no Svelte 4 `subscribe` bridge.
 */
export class NotepadSearchStore {
  searchMode: SearchMode = $state('all');
  searchQuery = $state('');
  matchCase = $state(false);
  matchWholeWord = $state(false);
  searchResults = $state<SearchItem[]>([]);
  recentNotes = $state<SearchItem[]>([]);
  recentTasks = $state<RecentTaskItem[]>([]);
  isSearching = $state(false);

  #deps: SearchStoreDeps;
  #searchTimer: number | null = null;
  #activeSearchRequest = 0;
  #activeRecentNotesRequest = 0;
  #activeRecentTasksRequest = 0;
  #lastEmittedHighlightQuery = '';
  #lastEmittedHighlightMode: SearchMode = 'all';
  #lastEmittedMatchCase = false;
  #lastEmittedMatchWholeWord = false;

  constructor(deps: SearchStoreDeps) {
    this.#deps = deps;
  }

  #emitHighlightsChange() {
    if (
      this.searchMode === this.#lastEmittedHighlightMode &&
      this.searchQuery === this.#lastEmittedHighlightQuery &&
      this.matchCase === this.#lastEmittedMatchCase &&
      this.matchWholeWord === this.#lastEmittedMatchWholeWord
    ) {
      return;
    }
    this.#lastEmittedHighlightMode = this.searchMode;
    this.#lastEmittedHighlightQuery = this.searchQuery;
    this.#lastEmittedMatchCase = this.matchCase;
    this.#lastEmittedMatchWholeWord = this.matchWholeWord;
    this.#deps.onSearchHighlightsChange?.({
      searchMode: this.searchMode,
      searchQuery: this.searchQuery,
      matchCase: this.matchCase,
      matchWholeWord: this.matchWholeWord
    });
  }

  #clearPendingSearchTimer() {
    if (!this.#searchTimer) {
      return;
    }
    window.clearTimeout(this.#searchTimer);
    this.#searchTimer = null;
  }

  clearSearch = () => {
    this.searchQuery = '';
    this.searchResults = [];
    this.isSearching = false;
    this.#emitHighlightsChange();
    this.#activeSearchRequest += 1;
    this.#clearPendingSearchTimer();
  };

  runSearch = async (query: string) => {
    const trimmedQuery = query.trim();
    if (trimmedQuery === '') {
      this.searchResults = [];
      this.isSearching = false;
      return;
    }

    const requestId = ++this.#activeSearchRequest;
    this.isSearching = true;
    // The resolved query is now stable; sync editor highlights once per
    // post-debounce search rather than on every keystroke.
    this.#emitHighlightsChange();

    try {
      if (this.searchMode === 'current') {
        const results = buildCurrentNoteSearchResults({
          title: this.#deps.getCurrentTitle(),
          noteId: null,
          notePath: this.#deps.getCurrentPath(),
          markdown: this.#deps.getCurrentMarkdown(),
          query: trimmedQuery,
          matchCase: this.matchCase,
          matchWholeWord: this.matchWholeWord
        });

        if (requestId !== this.#activeSearchRequest) {
          return;
        }

        this.searchResults = results;
        this.isSearching = false;
        return;
      }

      const results = await searchNotes(trimmedQuery, this.searchMode, {
        currentPath: this.#deps.getCurrentPath(),
        currentTitle: this.#deps.getCurrentTitle(),
        currentMarkdown: this.#deps.getCurrentMarkdown()
      });

      if (requestId !== this.#activeSearchRequest) {
        return;
      }

      this.searchResults = results;
      this.isSearching = false;
    } catch (error) {
      if (requestId !== this.#activeSearchRequest) {
        return;
      }
      console.error('Failed to search notes:', error);
      this.searchResults = [];
      this.isSearching = false;
    }
  };

  scheduleSearch = () => {
    this.#clearPendingSearchTimer();

    if (this.searchQuery.trim() === '') {
      this.searchResults = [];
      this.isSearching = false;
      return;
    }

    this.#searchTimer = window.setTimeout(() => {
      this.#searchTimer = null;
      void this.runSearch(this.searchQuery);
    }, 120);
  };

  loadRecentNotes = async () => {
    const requestId = ++this.#activeRecentNotesRequest;
    const result = await loadLatestCollection(
      () => requestId === this.#activeRecentNotesRequest,
      () =>
        listRecentNotes({
          currentPath: this.#deps.getCurrentPath()
        }),
      (notes) => {
        this.recentNotes = notes;
      },
      () => {
        this.recentNotes = [];
      },
      'Failed to load recent notes:'
    );
    result.applyIfLatest();
  };

  #refreshRecentNotesNow = async () => {
    const requestId = ++this.#activeRecentNotesRequest;
    const result = await loadLatestCollection(
      () => requestId === this.#activeRecentNotesRequest,
      () =>
        listRecentNotes({
          currentPath: this.#deps.getCurrentPath()
        }),
      (notes) => {
        this.recentNotes = notes;
      },
      () => {
        this.recentNotes = [];
      },
      'Failed to load recent notes:'
    );
    result.applyIfLatest();
    return result.items;
  };

  loadRecentTasks = async () => {
    const requestId = ++this.#activeRecentTasksRequest;
    const result = await loadLatestCollection(
      () => requestId === this.#activeRecentTasksRequest,
      () => listRecentTasks(),
      (tasks) => {
        this.recentTasks = tasks;
      },
      () => {
        this.recentTasks = [];
      },
      'Failed to load recent tasks:'
    );
    result.applyIfLatest();
  };

  #refreshRecentTasksNow = async () => {
    const requestId = ++this.#activeRecentTasksRequest;
    const result = await loadLatestCollection(
      () => requestId === this.#activeRecentTasksRequest,
      () => listRecentTasks(),
      (tasks) => {
        this.recentTasks = tasks;
      },
      () => {
        this.recentTasks = [];
      },
      'Failed to load recent tasks:'
    );
    result.applyIfLatest();
    return result.items;
  };

  openRecentNoteByIndex = async (
    index: number,
    { forceReload = false }: { forceReload?: boolean } = {}
  ) => {
    const cachedItem = this.recentNotes[index];
    // If the cached item is the current note, the recent list is stale —
    // we need a fresh list from the backend (which excludes the current note).
    const isStale = cachedItem && cachedItem.notePath === this.#deps.getCurrentPath();
    const effectiveForceReload = forceReload || isStale;
    const note = await getIndexedRecentItem(
      index,
      this.recentNotes,
      effectiveForceReload,
      this.#refreshRecentNotesNow
    );
    await runRecentSelection(note, this.openRecentNoteItem, 'Failed to open recent note:');
  };

  openRecentTaskByIndex = async (
    index: number,
    { forceReload = false }: { forceReload?: boolean } = {}
  ) => {
    const task = await getIndexedRecentItem(
      index,
      this.recentTasks,
      forceReload,
      this.#refreshRecentTasksNow
    );
    await runRecentSelection(task, this.#deps.openRecentTask, 'Failed to open recent task:');
  };

  openRecentNoteItem = async (note: SearchItem) => {
    await openRecentNoteListItem(note, {
      clearSearch: this.clearSearch,
      handleSearchResultSelect: this.#deps.openSearchResult,
      openNote: async (noteId, notePath) => this.#deps.openNote(noteId, notePath)
    });
  };

  handleSearchInput = (value: string) => {
    this.searchQuery = value;

    if (value.trim() === '') {
      this.#activeSearchRequest += 1;
      this.#clearPendingSearchTimer();
      this.searchResults = [];
      this.isSearching = false;
      // Empty query: clear highlights immediately.
      this.#emitHighlightsChange();
      return;
    }

    // Highlights are emitted post-debounce inside runSearch so that we don't
    // hit the editor on every keystroke.
    this.scheduleSearch();
  };

  handleSearchModeChange = async (mode: SearchMode) => {
    this.searchMode = mode;
    // Mode changes are explicit and infrequent; refresh highlights immediately.
    this.#emitHighlightsChange();
    this.#clearPendingSearchTimer();
    if (this.searchQuery.trim() !== '') {
      await this.runSearch(this.searchQuery);
    }
  };

  #refreshSearchAfterOptionChange = async () => {
    this.#emitHighlightsChange();
    this.#clearPendingSearchTimer();
    if (this.searchQuery.trim() !== '') {
      await this.runSearch(this.searchQuery);
    }
  };

  handleMatchCaseChange = async (enabled: boolean) => {
    this.matchCase = enabled;
    await this.#refreshSearchAfterOptionChange();
  };

  handleMatchWholeWordChange = async (enabled: boolean) => {
    this.matchWholeWord = enabled;
    await this.#refreshSearchAfterOptionChange();
  };

  #loadRecentFocus = async () => {
    const notesRequestId = ++this.#activeRecentNotesRequest;
    const tasksRequestId = ++this.#activeRecentTasksRequest;
    try {
      const bundle = await listRecentFocus({ currentPath: this.#deps.getCurrentPath() });
      const notesIsLatest = notesRequestId === this.#activeRecentNotesRequest;
      const tasksIsLatest = tasksRequestId === this.#activeRecentTasksRequest;
      if (notesIsLatest) {
        this.recentNotes = bundle.recentNotes;
      }
      if (tasksIsLatest) {
        this.recentTasks = bundle.recentTasks;
      }
    } catch (error) {
      console.error('Failed to load recent focus:', error);
      const notesIsLatest = notesRequestId === this.#activeRecentNotesRequest;
      const tasksIsLatest = tasksRequestId === this.#activeRecentTasksRequest;
      if (notesIsLatest) {
        this.recentNotes = [];
      }
      if (tasksIsLatest) {
        this.recentTasks = [];
      }
    }
  };

  handleSearchOpen = () => {
    void this.#loadRecentFocus();
  };

  dispose = () => {
    this.#clearPendingSearchTimer();
    this.#activeSearchRequest += 1;
    this.#activeRecentNotesRequest += 1;
    this.#activeRecentTasksRequest += 1;
  };
}

export function createNotepadSearchStore(deps: SearchStoreDeps): NotepadSearchStore {
  return new NotepadSearchStore(deps);
}
