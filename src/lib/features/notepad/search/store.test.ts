import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNotepadSearchStore } from './store.svelte';

const { searchNotesMock, listRecentFocusMock, listRecentNotesMock, listRecentTasksMock } =
  vi.hoisted(() => ({
    searchNotesMock: vi.fn(),
    listRecentFocusMock: vi.fn(),
    listRecentNotesMock: vi.fn(),
    listRecentTasksMock: vi.fn()
  }));

vi.mock('$lib/features/notepad/search/search', () => ({
  searchNotes: searchNotesMock,
  listRecentFocus: listRecentFocusMock,
  listRecentNotes: listRecentNotesMock,
  listRecentTasks: listRecentTasksMock
}));

describe('NotepadSearchStore', () => {
  let scheduledSearchCallback: (() => void) | null = null;
  const setTimeoutMock = vi.fn((callback: () => void) => {
    scheduledSearchCallback = callback;
    return 1;
  });
  const clearTimeoutMock = vi.fn();

  beforeEach(() => {
    scheduledSearchCallback = null;
    setTimeoutMock.mockClear();
    clearTimeoutMock.mockClear();
    vi.stubGlobal('window', {
      setTimeout: setTimeoutMock,
      clearTimeout: clearTimeoutMock
    });
    searchNotesMock.mockReset();
    listRecentFocusMock.mockReset();
    listRecentNotesMock.mockReset();
    listRecentTasksMock.mockReset();
  });

  afterEach(() => {
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

  it('exposes reactive search fields directly without requiring a $-store bridge', () => {
    const store = createStore();
    expect(store.searchMode).toBe('all');
    expect(store.searchQuery).toBe('');
    expect(store.searchResults).toEqual([]);
    expect(store.recentNotes).toEqual([]);
    expect(store.recentTasks).toEqual([]);
    expect(store.isSearching).toBe(false);
    expect(store.focusRequest).toBe(0);
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
      { notePath: '/vault/match.md', noteTitle: 'Match', sectionLabel: '', snippets: [] }
    ]);

    store.handleSearchInput('foo');
    expect(setTimeoutMock).toHaveBeenCalledTimes(1);
    expect(searchNotesMock).not.toHaveBeenCalled();
    expect(onSearchHighlightsChange).not.toHaveBeenCalled();

    scheduledSearchCallback?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(searchNotesMock).toHaveBeenCalledTimes(1);
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

  it('updates recentNotes/recentTasks via shared focus loader', async () => {
    const store = createStore();
    listRecentFocusMock.mockResolvedValue({
      recentNotes: [
        {
          notePath: '/vault/recent.md',
          noteTitle: 'Recent',
          sectionLabel: '',
          snippets: []
        }
      ],
      recentTasks: [
        {
          noteId: 'note-1',
          taskKey: 'note-1::3::::pay bills',
          notePath: '/vault/recent.md',
          noteTitle: 'Recent',
          text: 'Pay bills',
          lineNumber: 3,
          updatedAtMillis: 1
        }
      ]
    });

    store.handleSearchFocus();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(store.recentNotes).toHaveLength(1);
    expect(store.recentNotes[0].notePath).toBe('/vault/recent.md');
    expect(store.recentTasks).toHaveLength(1);
    expect(store.recentTasks[0].text).toBe('Pay bills');
  });

  it('clearSearch wipes the query, results, and clears any pending timer', () => {
    const store = createStore();
    store.handleSearchInput('foo');
    expect(setTimeoutMock).toHaveBeenCalledTimes(1);

    store.clearSearch();

    expect(store.searchQuery).toBe('');
    expect(store.searchResults).toEqual([]);
    expect(store.isSearching).toBe(false);
    expect(clearTimeoutMock).toHaveBeenCalled();
  });
});
