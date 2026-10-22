import type { ImageSearchItem, MediaSearchItem, SearchItem } from '#lib/types/semantic.js';
import { invoke } from '@tauri-apps/api/core';
import {
  getIndexedRecentItem,
  loadLatestCollection,
  openRecentNoteItem as openRecentNoteListItem,
  runRecentSelection
} from '#lib/features/notepad/search/recent.js';
import {
  listRecentFocus,
  listRecentNotes,
  listRecentTasks,
  listLastEditedNotes,
  searchNotes,
  setNotePinned,
  type SearchMode
} from '#lib/features/notepad/search/search.js';
import type { RecentTaskItem } from '#lib/features/notepad/model/types.js';
import { buildCurrentNoteSearchResults } from '#lib/features/notepad/search/currentNoteSearch.js';

export interface NotepadSearchState {
  searchMode: SearchMode;
  searchQuery: string;
  matchCase: boolean;
  matchWholeWord: boolean;
  searchResults: SearchItem[];
  pinnedNotes: SearchItem[];
  recentNotes: SearchItem[];
  recentTasks: RecentTaskItem[];
  isSearching: boolean;
}

interface SearchStoreDeps {
  getCurrentTitle: () => string;
  getCurrentMarkdown: () => string;
  getCurrentTags?: () => string[];
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

interface ImageQuerySource { file: File; encoded?: string }

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
  pinnedNotes = $state<SearchItem[]>([]);
  recentNotes = $state<SearchItem[]>([]);
  lastEditedNotes = $state<SearchItem[]>([]);
  isLoadingLastEdited = $state(false);
  lastEditedError = $state<string | null>(null);
  recentTasks = $state<RecentTaskItem[]>([]);
  isSearching = $state(false);
  imageResults = $state<ImageSearchItem[]>([]);
  imageQueryUrl = $state<string | null>(null);
  mediaError = $state<string | null>(null);
  #queryImage: ImageQuerySource | null = null;
  #pendingImage: { source: ImageQuerySource; query: string | null; requestId: number } | null = null;
  #processingImage = false;

  #deps: SearchStoreDeps;
  #searchTimer: number | null = null;
  #activeSearchRequest = 0;
  #activeRecentNotesRequest = 0;
  #activeRecentTasksRequest = 0;
  #activeLastEditedRequest = 0;
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
    this.#releaseImageQuery();
    this.imageResults = [];
    this.mediaError = null;
    this.searchQuery = '';
    this.searchResults = [];
    this.isSearching = false;
    this.#emitHighlightsChange();
    this.#activeSearchRequest += 1;
    this.#clearPendingSearchTimer();
  };

  #releaseImageQuery() {
    if (this.imageQueryUrl) URL.revokeObjectURL(this.imageQueryUrl);
    this.imageQueryUrl = null;
    this.#pendingImage = null;
    this.#queryImage = null;
  }

  chooseQueryImage = async (file: File) => {
    const query = this.searchQuery;
    this.clearSearch();
    if (file.size > 20 * 1024 * 1024 || file.size === 0) {
      this.mediaError = 'Choose a nonempty image smaller than 20 MiB.';
      return;
    }
    this.searchMode = 'all';
    this.imageQueryUrl = URL.createObjectURL(file);
    this.#queryImage = { file };
    this.searchQuery = query;
    await this.#queueImageQuery(query, this.#activeSearchRequest);
  };

  #queueImageQuery = async (query: string, requestId: number) => {
    if (!this.#queryImage) return;
    this.isSearching = true;
    this.#pendingImage = { source: this.#queryImage, query: query.trim() || null, requestId };
    if (this.#processingImage) return;
    this.#processingImage = true;
    try {
      while (this.#pendingImage) {
        const { source, query, requestId } = this.#pendingImage;
        this.#pendingImage = null;
        try {
          const encoded = source.encoded ?? await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result).split(",", 2)[1]);
            reader.onerror = () => reject(reader.error ?? new Error("Could not read image"));
            reader.readAsDataURL(source.file);
          });
          source.encoded = encoded;
          if (requestId !== this.#activeSearchRequest) continue;
          const results = await invoke<MediaSearchItem[]>('search_media', { query, imageBase64: encoded });
          if (requestId !== this.#activeSearchRequest) continue;
          this.imageResults = results.filter((item): item is ImageSearchItem => item.kind === 'image');
          this.searchResults = results.filter((item): item is SearchItem & { kind: 'passage' } => item.kind === 'passage');
          this.isSearching = false;
        } catch (error) {
          if (requestId !== this.#activeSearchRequest) continue;
          this.mediaError = String(error);
          this.isSearching = false;
        }
      }
    } finally { this.#processingImage = false; }
  };

  runSearch = async (query: string) => {
    const requestId = ++this.#activeSearchRequest;
    this.imageResults = [];
    this.mediaError = null;
    const trimmedQuery = query.trim();
    if (this.#queryImage && this.searchMode === 'all') {
      this.#emitHighlightsChange();
      await this.#queueImageQuery(trimmedQuery, requestId);
      return;
    }
    if (trimmedQuery === '') {
      this.#clearPendingSearchTimer();
      this.searchResults = [];
      this.isSearching = false;
      return;
    }

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

      const media = invoke<MediaSearchItem[]>('search_media', { query: trimmedQuery, imageBase64: null })
        .then(results => ({ results, error: null }), error => ({ results: [] as MediaSearchItem[], error: String(error) }));
      const results = await searchNotes(trimmedQuery, {
        currentPath: this.#deps.getCurrentPath(),
        currentTitle: this.#deps.getCurrentTitle(),
        ...(this.#deps.getCurrentTags ? { currentTags: this.#deps.getCurrentTags() } : {}),
        currentMarkdown: this.#deps.getCurrentMarkdown()
      });

      if (requestId !== this.#activeSearchRequest) {
        return;
      }

      this.searchResults = results;
      this.isSearching = false;
      const images = await media;
      if (requestId !== this.#activeSearchRequest) return;
      this.imageResults = images.results.filter((item): item is ImageSearchItem => item.kind === 'image');
      this.mediaError = images.error;
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
    // Retire the previous target as soon as its replacement is queued. Waiting
    // for the debounce would admit old results under the new visible query.
    this.#activeSearchRequest += 1;
    this.#clearPendingSearchTimer();

    if (this.searchQuery.trim() === '' && !this.#queryImage) {
      this.searchResults = [];
      this.isSearching = false;
      return;
    }

    this.#searchTimer = window.setTimeout(() => {
      this.#searchTimer = null;
      void this.runSearch(this.searchQuery);
    }, 120);
  };

  #acquireRecentNotes = async () => {
    const requestId = ++this.#activeRecentNotesRequest;
    return loadLatestCollection(
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
  };

  loadRecentNotes = async () => {
    const result = await this.#acquireRecentNotes();
    // Failure/supersession must not seed authoritative empty location history.
    return result.applyIfLatest() ? result.items : null;
  };

  #refreshRecentNotesNow = async () => {
    const result = await this.#acquireRecentNotes();
    return result.applyIfLatest() ? result.items : [];
  };

  #acquireRecentTasks = async () => {
    const requestId = ++this.#activeRecentTasksRequest;
    return loadLatestCollection(
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
  };

  loadRecentTasks = async () => {
    const result = await this.#acquireRecentTasks();
    result.applyIfLatest();
  };

  #refreshRecentTasksNow = async () => {
    const result = await this.#acquireRecentTasks();
    return result.applyIfLatest() ? result.items : [];
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
    this.imageResults = [];
    this.mediaError = null;
    this.searchQuery = value;

    if (value.trim() === '' && !this.#queryImage) {
      this.#activeSearchRequest += 1;
      this.#clearPendingSearchTimer();
      this.searchResults = [];
      this.isSearching = false;
      // Empty query: clear highlights immediately.
      this.#emitHighlightsChange();
      return;
    }

    if (this.#queryImage) {
      this.searchResults = [];
      this.isSearching = true;
    }
    // Highlights are emitted post-debounce inside runSearch so that we don't
    // hit the editor on every keystroke.
    this.scheduleSearch();
  };

  handleSearchModeChange = async (mode: SearchMode) => {
    this.#activeSearchRequest += 1;
    this.#releaseImageQuery();
    this.imageResults = [];
    this.mediaError = null;
    this.searchResults = [];
    this.isSearching = false;
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
    if (this.searchQuery.trim() !== '' || this.#queryImage) {
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
    try {
      const bundle = await listRecentFocus({ currentPath: this.#deps.getCurrentPath() });
      const notesIsLatest = notesRequestId === this.#activeRecentNotesRequest;
      if (notesIsLatest) {
        this.pinnedNotes = bundle.pinnedNotes;
        this.recentNotes = bundle.recentNotes;
      }
    } catch (error) {
      console.error('Failed to load recent focus:', error);
      const notesIsLatest = notesRequestId === this.#activeRecentNotesRequest;
      if (notesIsLatest) {
        this.pinnedNotes = [];
        this.recentNotes = [];
      }
    }
  };

  handleSearchOpen = () => {
    return this.#loadRecentFocus();
  };

  loadLastEditedNotes = async () => {
    const requestId = ++this.#activeLastEditedRequest;
    this.isLoadingLastEdited = true;
    this.lastEditedError = null;
    try {
      const notes = await listLastEditedNotes();
      if (requestId === this.#activeLastEditedRequest) this.lastEditedNotes = notes;
    } catch (error) {
      if (requestId === this.#activeLastEditedRequest) {
        this.lastEditedError = 'Could not load last edited notes. Try again.';
      }
      console.error('Failed to load last edited notes:', error);
    } finally {
      if (requestId === this.#activeLastEditedRequest) this.isLoadingLastEdited = false;
    }
  };

  setPinned = async (noteId: string, pinned: boolean) => {
    await setNotePinned(noteId, pinned);
    await this.#loadRecentFocus();
  };

  dispose = () => {
    this.#releaseImageQuery();
    this.#clearPendingSearchTimer();
    this.#activeSearchRequest += 1;
    this.#activeRecentNotesRequest += 1;
    this.#activeRecentTasksRequest += 1;
    this.#activeLastEditedRequest += 1;
  };
}

export function createNotepadSearchStore(deps: SearchStoreDeps): NotepadSearchStore {
  return new NotepadSearchStore(deps);
}
