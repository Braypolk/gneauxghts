import { describe, expect, it, vi } from 'vitest';
import {
  createNotepadCommandBarState,
  deriveNotepadCommandBarVisibleItems
} from './notepadCommandBarState';
import type { RecentTaskItem } from '$lib/features/notepad/model/types';
import type { SearchItem } from '$lib/types/semantic';

function searchItem(overrides: Partial<SearchItem> = {}): SearchItem {
  return {
    noteId: null,
    notePath: null,
    fileName: 'Note',
    sectionLabel: '',
    excerpt: '',
    highlightRanges: [],
    matchText: '',
    reasonLabels: [],
    lexicalScore: null,
    semanticScore: null,
    startLine: null,
    endLine: null,
    ...overrides
  };
}

function taskItem(overrides: Partial<RecentTaskItem> = {}): RecentTaskItem {
  return {
    noteId: 'note-id',
    taskKey: 'task-key',
    notePath: '/vault/Note.md',
    noteTitle: 'Note',
    text: 'Task',
    lineNumber: 1,
    updatedAtMillis: 0,
    ...overrides
  };
}

describe('deriveNotepadCommandBarVisibleItems', () => {
  it('orders recent tasks before recent notes for empty search', () => {
    const items = deriveNotepadCommandBarVisibleItems('', [], [searchItem()], [taskItem()]);

    expect(items.map((item) => item.kind)).toEqual(['task', 'note']);
  });
});

describe('createNotepadCommandBarState', () => {
  function createState(
    overrides: Partial<Parameters<typeof createNotepadCommandBarState>[0]> = {}
  ) {
    return createNotepadCommandBarState({
      getSearchQuery: () => '',
      getSearchResults: () => [],
      getRecentNotes: () => [],
      getRecentTasks: () => [],
      getVisibleItems: () => [],
      getForgetHoldDurationMs: () => 0,
      isForgetHoldEnabled: () => false,
      onSearchInput: () => {},
      onSearchSelect: () => {},
      onSearchNavigate: () => {},
      onRecentNoteSelect: () => {},
      onRecentTaskSelect: () => {},
      onRecentNoteShortcut: () => {},
      onRecentTaskShortcut: () => {},
      closeSearch: () => {},
      onForget: () => {},
      ...overrides
    });
  }

  it('uses raw navigation results for next and previous search buttons', () => {
    const visibleResults = [searchItem({ matchText: 'line grouped result' })];
    const rawResults = [
      searchItem({ matchText: 'first instance' }),
      searchItem({ matchText: 'second instance' })
    ];
    const navigated: SearchItem[] = [];
    const state = createState({
      getSearchQuery: () => 'found',
      getSearchResults: () => visibleResults,
      getSearchNavigationResults: () => rawResults,
      onSearchNavigate: (result) => {
        navigated.push(result);
      }
    });

    state.navigateSearchResult(1);
    state.navigateSearchResult(1);

    expect(navigated.map((item) => item.matchText)).toEqual(['second instance', 'first instance']);
  });

  it('closes search on Escape when the query is empty', () => {
    const closeSearch = vi.fn();
    const preventDefault = vi.fn();
    const state = createState({ closeSearch });

    state.handleSearchKeydown({
      key: 'Escape',
      preventDefault
    } as unknown as KeyboardEvent);

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(closeSearch).toHaveBeenCalledOnce();
  });

  it('closes search when selecting a result', () => {
    const closeSearch = vi.fn();
    const selected = searchItem({ matchText: 'selected' });
    const onSearchSelect = vi.fn();
    const state = createState({ closeSearch, onSearchSelect });

    state.selectItem({ kind: 'search', item: selected });

    expect(closeSearch).toHaveBeenCalledOnce();
    expect(onSearchSelect).toHaveBeenCalledWith(selected);
  });
});
