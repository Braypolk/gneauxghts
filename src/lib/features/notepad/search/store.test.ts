import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNotepadSearchStore } from './store.svelte';
import type { SearchItem } from '$lib/types/semantic';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function result(fileName: string): SearchItem {
  return {
    noteId: fileName, notePath: `/vault/${fileName}.md`, fileName,
    sectionLabel: '', excerpt: '', highlightRanges: [], matchText: '',
    reasonLabels: ['keyword'], lexicalScore: null, semanticScore: null,
    startLine: null, endLine: null
  };
}

const { searchNotesMock, listRecentFocusMock, listRecentNotesMock, listRecentTasksMock, setNotePinnedMock } =
  vi.hoisted(() => ({
    searchNotesMock: vi.fn(),
    listRecentFocusMock: vi.fn(),
    listRecentNotesMock: vi.fn(),
    listRecentTasksMock: vi.fn(),
    setNotePinnedMock: vi.fn()
  }));

vi.mock('$lib/features/notepad/search/search', () => ({
  searchNotes: searchNotesMock,
  listRecentFocus: listRecentFocusMock,
  listRecentNotes: listRecentNotesMock,
  listRecentTasks: listRecentTasksMock,
  setNotePinned: setNotePinnedMock
}));

describe('NotepadSearchStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('window', {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout
    });
    searchNotesMock.mockReset();
    listRecentFocusMock.mockReset();
    listRecentNotesMock.mockReset();
    listRecentTasksMock.mockReset();
    setNotePinnedMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function createStore() {
    return createNotepadSearchStore({
      getCurrentTitle: () => 'Current',
      getCurrentMarkdown: () => 'body',
      getCurrentPath: () => '/vault/current.md',
      openSearchResult: vi.fn(async () => {}),
      openRecentTask: vi.fn(async () => {}),
      openNote: vi.fn(async () => {})
    });
  }

  it.each(['success', 'error'] as const)(
    'ignores an old %s during replacement debounce without emitting early highlights',
    async (outcome) => {
      const pending = deferred<SearchItem[]>();
      const onSearchHighlightsChange = vi.fn();
      const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const store = createNotepadSearchStore({
        getCurrentTitle: () => 'Current', getCurrentMarkdown: () => 'body',
        getCurrentPath: () => '/vault/current.md', openSearchResult: vi.fn(async () => {}),
        openRecentTask: vi.fn(async () => {}), openNote: vi.fn(async () => {}),
        onSearchHighlightsChange
      });
      const retained = [result('Retained')];
      const latest = [result('Latest')];
      store.searchResults = retained;
      store.searchQuery = 'old';
      searchNotesMock.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(latest);
      const oldSearch = store.runSearch('old');
      onSearchHighlightsChange.mockClear();

      store.handleSearchInput('new');
      if (outcome === 'success') pending.resolve([result('Obsolete')]);
      else pending.reject(new Error('obsolete search failed'));
      await oldSearch;
      await vi.advanceTimersByTimeAsync(119);

      expect(store.searchQuery).toBe('new');
      expect(store.searchResults).toEqual(retained);
      expect(searchNotesMock).toHaveBeenCalledTimes(1);
      expect(onSearchHighlightsChange).not.toHaveBeenCalled();
      expect(log).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      expect(searchNotesMock).toHaveBeenLastCalledWith('new', expect.anything());
      expect(store.searchResults).toEqual(latest);
      expect(store.isSearching).toBe(false);
      expect(onSearchHighlightsChange).toHaveBeenCalledExactlyOnceWith({
        searchQuery: 'new', searchMode: 'all', matchCase: false, matchWholeWord: false
      });
    }
  );

  it.each(['empty query', 'dispose'] as const)(
    'retires an in-flight request on %s', async (action) => {
      const pending = deferred<SearchItem[]>();
      searchNotesMock.mockReturnValueOnce(pending.promise);
      const store = createStore();
      const oldSearch = store.runSearch('old');
      if (action === 'empty query') await store.runSearch('');
      else store.dispose();
      pending.resolve([result('Obsolete')]);
      await oldSearch;
      expect(store.searchResults).toEqual([]);
    }
  );


  it('distinguishes a failed recent-note load from a successful empty list', async () => {
    const store = createStore();
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      listRecentNotesMock.mockRejectedValueOnce(new Error('startup unavailable'));
      listRecentNotesMock.mockResolvedValueOnce([]);

      expect(await store.loadRecentNotes()).toBeNull();
      expect(await store.loadRecentNotes()).toEqual([]);
    } finally {
      log.mockRestore();
    }
  });

  it('does not seed history from a recent-note response superseded by a newer load', async () => {
    const store = createStore();
    let finishFirst!: (items: []) => void;
    listRecentNotesMock.mockImplementationOnce(() => new Promise<[]>((resolve) => {
      finishFirst = resolve;
    }));
    listRecentNotesMock.mockResolvedValueOnce([]);

    const first = store.loadRecentNotes();
    expect(await store.loadRecentNotes()).toEqual([]);
    finishFirst([]);

    expect(await first).toBeNull();
    expect(store.recentNotes).toEqual([]);
  });

  it('debounces search input and only fires highlight callbacks post-debounce', async () => {
    const onSearchHighlightsChange = vi.fn();
    const store = createNotepadSearchStore({
      getCurrentTitle: () => 'Current',
      getCurrentMarkdown: () => 'body',
      getCurrentPath: () => '/vault/current.md',
      openSearchResult: vi.fn(async () => {}),
      openRecentTask: vi.fn(async () => {}),
      openNote: vi.fn(async () => {}),
      onSearchHighlightsChange
    });
    searchNotesMock.mockResolvedValue([
      { ...result('Match'), notePath: '/vault/match.md' }
    ]);

    store.handleSearchInput('f');
    await vi.advanceTimersByTimeAsync(60);
    store.handleSearchInput('fo');
    await vi.advanceTimersByTimeAsync(60);
    store.handleSearchInput('foo');
    await vi.advanceTimersByTimeAsync(119);
    expect(searchNotesMock).not.toHaveBeenCalled();
    expect(onSearchHighlightsChange).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);

    expect(searchNotesMock).toHaveBeenCalledTimes(1);
    expect(searchNotesMock).toHaveBeenCalledWith('foo', {
      currentPath: '/vault/current.md',
      currentTitle: 'Current',
      currentMarkdown: 'body'
    });
    expect(onSearchHighlightsChange).toHaveBeenCalledTimes(1);
    expect(onSearchHighlightsChange).toHaveBeenCalledWith({
      searchMode: 'all',
      searchQuery: 'foo',
      matchCase: false,
      matchWholeWord: false
    });
  });

  it('emits highlight option changes and reruns active searches', async () => {
    const onSearchHighlightsChange = vi.fn();
    const store = createNotepadSearchStore({
      getCurrentTitle: () => 'Current',
      getCurrentMarkdown: () => 'body',
      getCurrentPath: () => '/vault/current.md',
      openSearchResult: vi.fn(async () => {}),
      openRecentTask: vi.fn(async () => {}),
      openNote: vi.fn(async () => {}),
      onSearchHighlightsChange
    });
    store.searchQuery = 'foo';
    searchNotesMock.mockResolvedValue([]);

    await store.handleMatchCaseChange(true);

    expect(store.matchCase).toBe(true);
    expect(searchNotesMock).toHaveBeenCalledTimes(1);
    expect(onSearchHighlightsChange).toHaveBeenCalledWith({
      searchMode: 'all',
      searchQuery: 'foo',
      matchCase: true,
      matchWholeWord: false
    });
  });

  it('builds current-note results locally without backend search', async () => {
    const store = createNotepadSearchStore({
      getCurrentTitle: () => 'Current',
      getCurrentMarkdown: () => 'alpha\nbeta alpha',
      getCurrentPath: () => '/vault/current.md',
      openSearchResult: vi.fn(async () => {}),
      openRecentTask: vi.fn(async () => {}),
      openNote: vi.fn(async () => {})
    });
    store.searchMode = 'current';

    await store.runSearch('alpha');

    expect(searchNotesMock).not.toHaveBeenCalled();
    expect(store.searchResults).toHaveLength(2);
    expect(store.searchResults[0]?.currentMatchRange).toEqual({ from: 0, to: 5 });
  });

  it('still uses backend search for all-notes mode', async () => {
    const store = createStore();
    searchNotesMock.mockResolvedValue([]);

    await store.runSearch('alpha');

    expect(searchNotesMock).toHaveBeenCalledTimes(1);
  });

  it('updates pinned and recent notes via the shared search-focus loader', async () => {
    const store = createStore();
    listRecentFocusMock.mockResolvedValue({
      pinnedNotes: [
        {
          noteId: 'pinned-1',
          notePath: '/vault/pinned.md',
          fileName: 'Pinned',
          sectionLabel: 'Recent',
          excerpt: '',
          highlightRanges: [],
          matchText: '',
          reasonLabels: ['recent'],
          lexicalScore: null,
          semanticScore: null,
          startLine: null,
          endLine: null
        }
      ],
      recentNotes: [
        { ...result('Recent'), notePath: '/vault/recent.md' }
      ],
      lastChat: null
    });

    await store.handleSearchOpen();

    expect(store.pinnedNotes).toHaveLength(1);
    expect(store.pinnedNotes[0].noteId).toBe('pinned-1');
    expect(store.recentNotes).toHaveLength(1);
    expect(store.recentNotes[0].notePath).toBe('/vault/recent.md');
  });

  it('clearSearch wipes existing results and cancels pending search and highlight work', async () => {
    const onSearchHighlightsChange = vi.fn();
    const store = createNotepadSearchStore({
      getCurrentTitle: () => 'Current',
      getCurrentMarkdown: () => 'body',
      getCurrentPath: () => '/vault/current.md',
      openSearchResult: vi.fn(async () => {}),
      openRecentTask: vi.fn(async () => {}),
      openNote: vi.fn(async () => {}),
      onSearchHighlightsChange
    });
    searchNotesMock.mockResolvedValue([
      { ...result('Match'), notePath: '/vault/match.md' }
    ]);
    store.handleSearchInput('previous');
    await vi.advanceTimersByTimeAsync(120);
    expect(store.searchResults).toHaveLength(1);
    searchNotesMock.mockClear();
    onSearchHighlightsChange.mockClear();

    store.handleSearchInput('foo');
    await vi.advanceTimersByTimeAsync(60);

    store.clearSearch();

    expect(store.searchQuery).toBe('');
    expect(store.searchResults).toEqual([]);
    expect(store.isSearching).toBe(false);
    expect(onSearchHighlightsChange).toHaveBeenCalledExactlyOnceWith({
      searchMode: 'all',
      searchQuery: '',
      matchCase: false,
      matchWholeWord: false
    });
    expect(vi.getTimerCount()).toBe(0);

    await vi.advanceTimersByTimeAsync(120);

    expect(searchNotesMock).not.toHaveBeenCalled();
    expect(onSearchHighlightsChange).toHaveBeenCalledTimes(1);
    expect(store.searchResults).toEqual([]);
    expect(store.isSearching).toBe(false);
  });

  it('persists a pin and refreshes the search-focus collection', async () => {
    const store = createStore();
    setNotePinnedMock.mockResolvedValue(undefined);
    listRecentFocusMock.mockResolvedValue({ pinnedNotes: [], recentNotes: [], lastChat: null });

    await store.setPinned('note-1', true);

    expect(setNotePinnedMock).toHaveBeenCalledWith('note-1', true);
    expect(listRecentFocusMock).toHaveBeenCalledOnce();
  });
});
