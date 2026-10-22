import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNotepadSearchStore } from './store.svelte';
import type { SearchItem } from '#lib/types/semantic.js';

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

const { invokeMock, searchNotesMock, listRecentFocusMock, listRecentNotesMock, listRecentTasksMock, listLastEditedNotesMock, setNotePinnedMock } =
  vi.hoisted(() => ({
    invokeMock: vi.fn(),
    searchNotesMock: vi.fn(),
    listRecentFocusMock: vi.fn(),
    listRecentNotesMock: vi.fn(),
    listRecentTasksMock: vi.fn(),
    listLastEditedNotesMock: vi.fn(),
    setNotePinnedMock: vi.fn()
  }));

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

vi.mock('#lib/features/notepad/search/search.js', () => ({
  searchNotes: searchNotesMock,
  listRecentFocus: listRecentFocusMock,
  listRecentNotes: listRecentNotesMock,
  listRecentTasks: listRecentTasksMock,
  listLastEditedNotes: listLastEditedNotesMock,
  setNotePinned: setNotePinnedMock
}));

describe('NotepadSearchStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('window', {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout
    });
    invokeMock.mockReset().mockResolvedValue([]);
    searchNotesMock.mockReset();
    listRecentFocusMock.mockReset();
    listRecentNotesMock.mockReset();
    listRecentTasksMock.mockReset();
    listLastEditedNotesMock.mockReset();
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

  it('keeps last edited separate from recent opening activity and retires superseded responses', async () => {
    const first = deferred<SearchItem[]>();
    const second = deferred<SearchItem[]>();
    listLastEditedNotesMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const store = createStore();
    store.recentNotes = [result('opened')];
    const oldLoad = store.loadLastEditedNotes();
    const newLoad = store.loadLastEditedNotes();
    second.resolve([result('edited')]);
    await newLoad;
    first.resolve([result('obsolete')]);
    await oldLoad;
    expect(store.lastEditedNotes).toEqual([result('edited')]);
    expect(store.recentNotes).toEqual([result('opened')]);
    expect(store.isLoadingLastEdited).toBe(false);
  });

  it('shows a retryable last edited failure while preserving the previous list', async () => {
    const store = createStore();
    store.lastEditedNotes = [result('retained')];
    listLastEditedNotesMock.mockRejectedValueOnce(new Error('unavailable'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    await store.loadLastEditedNotes();
    expect(store.lastEditedError).toContain('Try again');
    expect(store.lastEditedNotes).toEqual([result('retained')]);
    listLastEditedNotesMock.mockResolvedValueOnce([result('fresh')]);
    await store.loadLastEditedNotes();
    expect(store.lastEditedError).toBeNull();
    expect(store.lastEditedNotes).toEqual([result('fresh')]);
    store.dispose();
    log.mockRestore();
  });

  it('discards last edited results delivered after disposal', async () => {
    const pending = deferred<SearchItem[]>();
    listLastEditedNotesMock.mockReturnValueOnce(pending.promise);
    const store = createStore();
    const load = store.loadLastEditedNotes();
    store.dispose();
    pending.resolve([result('late')]);
    await load;
    expect(store.lastEditedNotes).toEqual([]);
  });


  it('retires image work and releases its preview when switching to current-note find', async () => {
    const pending = deferred<unknown[]>();
    invokeMock.mockReturnValueOnce(pending.promise);
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:query');
    vi.stubGlobal('FileReader', class {
      result = 'data:image/png;base64,aW1hZ2U=';
      onload: (() => void) | null = null;
      readAsDataURL() { this.onload?.(); }
    });
    const store = createStore();
    const search = store.chooseQueryImage({ size: 5 } as File);
    await Promise.resolve();
    expect(invokeMock).toHaveBeenCalledWith('search_media', { query: null, imageBase64: 'aW1hZ2U=' });
    await store.handleSearchModeChange('current');
    pending.resolve([{ kind:'image', assetName:'obsolete.png' }]);
    await search;
    expect(store.imageQueryUrl).toBeNull();
    expect(store.imageResults).toEqual([]);
    expect(store.searchResults).toEqual([]);
    expect(store.isSearching).toBe(false);
    expect(revoke).toHaveBeenCalledWith('blob:query');
  });

  it.each(['results', 'error'])('keeps an image query cleared after late %s arrive', async (outcome) => {
    const pending = deferred<unknown[]>();
    invokeMock.mockReturnValueOnce(pending.promise);
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:query');
    vi.stubGlobal('FileReader', class {
      result = 'data:image/png;base64,aW1hZ2U=';
      onload: (() => void) | null = null;
      readAsDataURL() { this.onload?.(); }
    });
    const store = createStore();
    store.handleSearchInput('refinement');
    const search = store.chooseQueryImage({ size: 5 } as File);
    await Promise.resolve();
    store.clearSearch();
    expect(store.imageQueryUrl).toBeNull();
    expect(store.isSearching).toBe(false);
    if (outcome === 'results') {
      pending.resolve([{ kind: 'image', assetName: 'obsolete.png' }, { ...result('obsolete'), kind: 'passage' }]);
    } else {
      pending.reject(new Error('obsolete failure'));
    }
    await search;
    expect(store.imageResults).toEqual([]);
    expect(store.searchResults).toEqual([]);
    expect(store.mediaError).toBeNull();
    expect(store.imageQueryUrl).toBeNull();
    expect(store.isSearching).toBe(false);
    expect(revoke).toHaveBeenCalledWith('blob:query');
  });

  it('keeps the image while refining text, and returns to image-only when text is deleted', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:query');
    const read = vi.fn();
    vi.stubGlobal('FileReader', class {
      result = 'data:image/png;base64,aW1hZ2U=';
      onload: (() => void) | null = null;
      readAsDataURL() { read(); this.onload?.(); }
    });
    const store = createStore();
    store.handleSearchInput('initial context');
    await store.chooseQueryImage({ size: 5 } as File);
    expect(invokeMock).toHaveBeenLastCalledWith('search_media', { query: 'initial context', imageBase64: 'aW1hZ2U=' });
    store.handleSearchInput('network settings');
    await vi.advanceTimersByTimeAsync(120);
    expect(store.imageQueryUrl).toBe('blob:query');
    expect(invokeMock).toHaveBeenLastCalledWith('search_media', { query: 'network settings', imageBase64: 'aW1hZ2U=' });
    store.handleSearchInput('');
    await vi.advanceTimersByTimeAsync(120);
    expect(invokeMock).toHaveBeenLastCalledWith('search_media', { query: null, imageBase64: 'aW1hZ2U=' });
    expect(store.imageQueryUrl).toBe('blob:query');
    expect(read).toHaveBeenCalledOnce();
    expect(searchNotesMock).not.toHaveBeenCalled();
    expect(revoke).not.toHaveBeenCalled();
    store.clearSearch();
    expect(revoke).toHaveBeenCalledWith('blob:query');
  });

  it.each(['case', 'whole word'])('reruns an image query when %s changes during empty-text debounce', async (option) => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:query');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.stubGlobal('FileReader', class {
      result = 'data:image/png;base64,aW1hZ2U=';
      onload: (() => void) | null = null;
      readAsDataURL() { this.onload?.(); }
    });
    const store = createStore();
    store.handleSearchInput('refinement');
    await store.chooseQueryImage({ size: 5 } as File);
    store.handleSearchInput('');
    if (option === 'case') await store.handleMatchCaseChange(true);
    else await store.handleMatchWholeWordChange(true);
    await vi.advanceTimersByTimeAsync(120);
    expect(invokeMock).toHaveBeenCalledTimes(2);
    expect(invokeMock).toHaveBeenLastCalledWith('search_media', { query: null, imageBase64: 'aW1hZ2U=' });
    expect(store.isSearching).toBe(false);
    expect(store.imageQueryUrl).toBe('blob:query');
    store.clearSearch();
  });

  it('coalesces text refinements during image inference and never admits the old response', async () => {
    const pending = deferred<unknown[]>();
    invokeMock.mockReturnValueOnce(pending.promise).mockResolvedValueOnce([{ ...result('refined'), kind: 'passage' }]);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:query');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.stubGlobal('FileReader', class {
      result = 'data:image/png;base64,aW1hZ2U=';
      onload: (() => void) | null = null;
      readAsDataURL() { this.onload?.(); }
    });
    const store = createStore();
    const search = store.chooseQueryImage({ size: 5 } as File);
    await Promise.resolve();
    store.handleSearchInput('superseded');
    await vi.advanceTimersByTimeAsync(120);
    store.handleSearchInput('latest refinement');
    await vi.advanceTimersByTimeAsync(120);
    expect(invokeMock).toHaveBeenCalledOnce();
    pending.resolve([{ ...result('obsolete'), kind: 'passage' }]);
    await search;
    expect(invokeMock).toHaveBeenCalledTimes(2);
    expect(invokeMock).toHaveBeenLastCalledWith('search_media', { query: 'latest refinement', imageBase64: 'aW1hZ2U=' });
    expect(store.searchResults.map(item => item.fileName)).toEqual(['refined']);
    store.clearSearch();
  });

  it('coalesces replacement images to the latest pending input', async () => {
    const pending = deferred<unknown[]>();
    invokeMock.mockReturnValueOnce(pending.promise).mockResolvedValueOnce([]);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:query');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.stubGlobal('FileReader', class {
      result = '';
      onload: (() => void) | null = null;
      readAsDataURL(file: File) { this.result = `data:image/png;base64,${file.name}`; this.onload?.(); }
    });
    const store = createStore();
    const search = store.chooseQueryImage({ size:5, name:'first' } as File);
    await Promise.resolve();
    await store.chooseQueryImage({ size:5, name:'superseded' } as File);
    await store.chooseQueryImage({ size:5, name:'latest' } as File);
    pending.resolve([{kind:'image',assetName:'old.png'}]);
    await search;
    expect(invokeMock).toHaveBeenCalledTimes(2);
    expect(invokeMock.mock.calls[1][1].imageBase64).toBe('latest');
    expect(store.imageResults).toEqual([]);
    store.dispose();
  });

  it('keeps keyword passages when the image semantic channel fails', async () => {
    invokeMock.mockRejectedValue(new Error('Model unavailable'));
    searchNotesMock.mockResolvedValue([result('Keyword')]);
    const store = createStore();
    await store.runSearch('word');
    expect(store.searchResults).toEqual([result('Keyword')]);
    expect(store.mediaError).toContain('Model unavailable');
    expect(store.isSearching).toBe(false);
  });

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
