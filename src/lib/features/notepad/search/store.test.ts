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

  it('selects independent result channels before their result limits', async () => {
    const image = { kind: 'image', assetName: 'match.png' };
    invokeMock.mockResolvedValue([image]);
    searchNotesMock.mockResolvedValue([result('Note')]);
    const store = createStore();
    store.searchQuery = 'idea';

    await store.handleResultTypeChange('notes');
    expect(searchNotesMock).toHaveBeenCalledOnce();
    expect(invokeMock).not.toHaveBeenCalled();
    expect(store.imageResults).toEqual([]);

    await store.handleResultTypeChange('images');
    expect(searchNotesMock).toHaveBeenCalledOnce();
    expect(invokeMock).toHaveBeenLastCalledWith('search_media', {
      query: 'idea', imageBase64: null, includePassages: false
    });
    expect(store.searchResults).toEqual([]);
    expect(store.imageResults).toEqual([image]);

    await store.handleResultTypeChange('all');
    expect(searchNotesMock).toHaveBeenCalledTimes(2);
    expect(invokeMock).toHaveBeenCalledTimes(2);
    expect(store.searchResults).toEqual([result('Note')]);
    expect(store.imageResults).toEqual([image]);
  });

  it('retains an edited-time cutoff through retries and removes it when reset', async () => {
    vi.setSystemTime(new Date('2026-10-22T12:00:00Z'));
    searchNotesMock.mockResolvedValue([result('Match')]);
    const store = createStore();
    store.searchQuery = 'idea';
    store.recentNotes = [result('Recent')];
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    await store.handleEditedWindowChange('7d');
    expect(searchNotesMock).toHaveBeenLastCalledWith('idea', expect.anything(), { modifiedSinceMillis: cutoff });
    expect(invokeMock).toHaveBeenLastCalledWith('search_media', {
      query: 'idea', imageBase64: null, includePassages: false, modifiedSinceMillis: cutoff
    });
    vi.setSystemTime(new Date('2026-10-23T12:00:00Z'));
    await store.retrySearch();
    expect(searchNotesMock).toHaveBeenLastCalledWith('idea', expect.anything(), { modifiedSinceMillis: cutoff });
    expect(store.editedWindow).toBe('7d');
    await store.handleEditedWindowChange('any');
    expect(searchNotesMock).toHaveBeenLastCalledWith('idea', expect.anything(), { modifiedSinceMillis: null });
    expect(invokeMock).toHaveBeenLastCalledWith('search_media', {
      query: 'idea', imageBase64: null, includePassages: false
    });
    expect(store.recentNotes).toEqual([result('Recent')]);
  });

  it('refreshes relative time for a new query and a cleared search while keeping its preset', async () => {
    const day = 24 * 60 * 60 * 1000;
    const initialTime = Date.parse('2026-10-22T12:00:00Z');
    vi.setSystemTime(initialTime);
    searchNotesMock.mockResolvedValue([result('Match')]);
    const store = createStore();
    store.searchQuery = 'idea';
    await store.handleEditedWindowChange('7d');
    expect(searchNotesMock).toHaveBeenLastCalledWith('idea', expect.anything(), { modifiedSinceMillis: initialTime - 7 * day });

    vi.setSystemTime(initialTime + 8 * day);
    store.handleSearchInput('garden');
    await vi.advanceTimersByTimeAsync(120);
    const freshCutoff = initialTime + day;
    expect(searchNotesMock).toHaveBeenLastCalledWith('garden', expect.anything(), { modifiedSinceMillis: freshCutoff });
    expect(invokeMock).toHaveBeenLastCalledWith('search_media', {
      query: 'garden', imageBase64: null, includePassages: false, modifiedSinceMillis: freshCutoff
    });

    vi.setSystemTime(initialTime + 9 * day);
    await store.retrySearch();
    expect(searchNotesMock).toHaveBeenLastCalledWith('garden', expect.anything(), { modifiedSinceMillis: freshCutoff });
    store.clearSearch();
    expect(store.editedWindow).toBe('7d');
    store.handleSearchInput('garden');
    await vi.advanceTimersByTimeAsync(120);
    expect(searchNotesMock).toHaveBeenLastCalledWith('garden', expect.anything(), { modifiedSinceMillis: initialTime + 2 * day });
    store.dispose();
  });

  it.each(['result type', 'edited time'] as const)('retires results and in-flight work on a new %s cue', async cue => {
    const old = deferred<SearchItem[]>();
    const latest = deferred<SearchItem[]>();
    const image = { kind: 'image', assetName: 'latest.png' };
    searchNotesMock.mockResolvedValueOnce([result('Retained')])
      .mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);
    invokeMock.mockResolvedValue([image]);
    const store = createStore();
    store.searchQuery = 'idea';
    await store.runSearch('idea');
    const oldSearch = store.retrySearch();
    const next = cue === 'result type'
      ? store.handleResultTypeChange('images') : store.handleEditedWindowChange('30d');
    expect(store.searchResults).toEqual([]);
    expect(store.imageResults).toEqual([]);
    old.resolve([result('Obsolete')]);
    await oldSearch;
    expect(store.searchResults).toEqual([]);
    latest.resolve([result('Current')]);
    await next;
    expect(store.searchResults.map(item => item.fileName)).toEqual(cue === 'result type' ? [] : ['Current']);
    expect(store.imageResults).toEqual([image]);
  });

  it('keeps image-only search pending until image work settles', async () => {
    const media = deferred<unknown[]>();
    invokeMock.mockReturnValue(media.promise);
    const store = createStore();
    store.resultType = 'images';
    const search = store.runSearch('diagram');
    await Promise.resolve();
    expect(store.isSearching).toBe(true);
    expect(searchNotesMock).not.toHaveBeenCalled();
    media.resolve([]);
    await search;
    expect(store.isSearching).toBe(false);
  });

  it('applies type and edited-time cues to image queries before ranking', async () => {
    vi.setSystemTime(new Date('2026-10-22T12:00:00Z'));
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:query');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.stubGlobal('FileReader', class {
      result = 'data:image/png;base64,aW1hZ2U=';
      onload: (() => void) | null = null;
      readAsDataURL() { this.onload?.(); }
    });
    const store = createStore();
    await store.handleResultTypeChange('notes');
    await store.handleEditedWindowChange('30d');
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    await store.chooseQueryImage({ size: 5 } as File);
    expect(invokeMock).toHaveBeenLastCalledWith('search_media', {
      query: null, imageBase64: 'aW1hZ2U=', includePassages: true,
      includeImages: false, modifiedSinceMillis: cutoff
    });
    await store.handleResultTypeChange('images');
    expect(invokeMock).toHaveBeenLastCalledWith('search_media', {
      query: null, imageBase64: 'aW1hZ2U=', includePassages: false,
      includeImages: true, modifiedSinceMillis: cutoff
    });
    expect(searchNotesMock).not.toHaveBeenCalled();
    store.dispose();
  });

  it('refreshes an image query window on refinement or replacement and retains it for retry', async () => {
    const day = 24 * 60 * 60 * 1000;
    const initialTime = Date.parse('2026-10-22T12:00:00Z');
    vi.setSystemTime(initialTime);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:query');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.stubGlobal('FileReader', class {
      result = 'data:image/png;base64,aW1hZ2U=';
      onload: (() => void) | null = null;
      readAsDataURL() { this.onload?.(); }
    });
    const store = createStore();
    await store.handleEditedWindowChange('30d');
    await store.chooseQueryImage({ size: 5 } as File);
    expect(invokeMock).toHaveBeenLastCalledWith('search_media', expect.objectContaining({ modifiedSinceMillis: initialTime - 30 * day }));
    vi.setSystemTime(initialTime + 2 * day);
    store.handleSearchInput('garden');
    await vi.advanceTimersByTimeAsync(120);
    expect(invokeMock).toHaveBeenLastCalledWith('search_media', expect.objectContaining({ query: 'garden', modifiedSinceMillis: initialTime - 28 * day }));
    vi.setSystemTime(initialTime + 3 * day);
    await store.retrySearch();
    expect(invokeMock).toHaveBeenLastCalledWith('search_media', expect.objectContaining({ modifiedSinceMillis: initialTime - 28 * day }));
    await store.chooseQueryImage({ size: 5 } as File);
    expect(store.editedWindow).toBe('30d');
    expect(invokeMock).toHaveBeenLastCalledWith('search_media', expect.objectContaining({ modifiedSinceMillis: initialTime - 27 * day }));
    store.dispose();
  });

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
    expect(invokeMock).toHaveBeenCalledWith('search_media', { query: null, imageBase64: 'aW1hZ2U=', includePassages: true, includeImages: true });
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
    expect(invokeMock).toHaveBeenLastCalledWith('search_media', { query: 'initial context', imageBase64: 'aW1hZ2U=', includePassages: true, includeImages: true });
    store.handleSearchInput('network settings');
    await vi.advanceTimersByTimeAsync(120);
    expect(store.imageQueryUrl).toBe('blob:query');
    expect(invokeMock).toHaveBeenLastCalledWith('search_media', { query: 'network settings', imageBase64: 'aW1hZ2U=', includePassages: true, includeImages: true });
    store.handleSearchInput('');
    await vi.advanceTimersByTimeAsync(120);
    expect(invokeMock).toHaveBeenLastCalledWith('search_media', { query: null, imageBase64: 'aW1hZ2U=', includePassages: true, includeImages: true });
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
    expect(invokeMock).toHaveBeenLastCalledWith('search_media', { query: null, imageBase64: 'aW1hZ2U=', includePassages: true, includeImages: true });
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
    expect(invokeMock).toHaveBeenLastCalledWith('search_media', { query: 'latest refinement', imageBase64: 'aW1hZ2U=', includePassages: true, includeImages: true });
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

  it('retains matches for a failed refresh of the same query and clears the error on retry', async () => {
    const refresh = deferred<SearchItem[]>();
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    searchNotesMock.mockResolvedValueOnce([result('Retained')])
      .mockReturnValueOnce(refresh.promise).mockResolvedValueOnce([result('Fresh')]);
    const store = createStore();
    store.searchQuery = 'idea';
    await store.runSearch('idea');
    const pending = store.retrySearch();
    expect(store.searchResults).toEqual([result('Retained')]);
    expect(store.isSearching).toBe(true);
    refresh.reject(new Error('index unavailable'));
    await pending;
    expect(store.searchResults).toEqual([result('Retained')]);
    expect(store.searchError).toContain('Try again');
    expect(store.isSearching).toBe(false);
    await store.retrySearch();
    expect(store.searchResults).toEqual([result('Fresh')]);
    expect(store.searchError).toBeNull();
    log.mockRestore();
  });

  it('clears old matches during a new query debounce and distinguishes failure from empty results', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const store = createStore();
    searchNotesMock.mockResolvedValueOnce([result('Old')]).mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce([]);
    store.handleSearchInput('old');
    await vi.advanceTimersByTimeAsync(120);
    store.handleSearchInput('new');
    expect(store.searchResults).toEqual([]);
    expect(store.isSearching).toBe(true);
    await vi.advanceTimersByTimeAsync(120);
    expect(store.searchResults).toEqual([]);
    expect(store.searchError).not.toBeNull();
    await store.retrySearch();
    expect(store.searchResults).toEqual([]);
    expect(store.searchError).toBeNull();
    store.clearSearch();
    expect(store.searchError).toBeNull();
    log.mockRestore();
  });

  it.each(['case', 'whole word', 'scope', 'document'] as const)(
    'does not retain incompatible results after changing %s', async (change) => {
      const pending = deferred<SearchItem[]>();
      let path = '/vault/current.md';
      const store = createNotepadSearchStore({
        getCurrentTitle: () => 'Current', getCurrentMarkdown: () => 'body', getCurrentPath: () => path,
        openSearchResult: vi.fn(async () => {}), openRecentTask: vi.fn(async () => {}),
        openNote: vi.fn(async () => {})
      });
      store.searchQuery = 'word';
      searchNotesMock.mockResolvedValueOnce([result('Old')]).mockReturnValueOnce(pending.promise);
      await store.runSearch('word');
      if (change === 'case') store.matchCase = true;
      else if (change === 'whole word') store.matchWholeWord = true;
      else if (change === 'scope') store.searchMode = 'current';
      else path = '/vault/other.md';
      const next = store.retrySearch();
      expect(store.searchResults).toEqual([]);
      pending.resolve([]);
      await next;
    }
  );

  it('admits image matches even when note search fails', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const image = { kind: 'image', assetName: 'match.png' };
    invokeMock.mockResolvedValue([image]);
    searchNotesMock.mockRejectedValue(new Error('note index unavailable'));
    const store = createStore();
    await store.runSearch('diagram');
    expect(store.imageResults).toEqual([image]);
    expect(store.searchError).not.toBeNull();
    expect(store.mediaError).toBeNull();
    log.mockRestore();
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
      expect(store.searchResults).toEqual([]);
      expect(searchNotesMock).toHaveBeenCalledTimes(1);
      expect(onSearchHighlightsChange).not.toHaveBeenCalled();
      expect(log).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      expect(searchNotesMock).toHaveBeenLastCalledWith('new', expect.anything(), { modifiedSinceMillis: null });
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
    }, { modifiedSinceMillis: null });
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
