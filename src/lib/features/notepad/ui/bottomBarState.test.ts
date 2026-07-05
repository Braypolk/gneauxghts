import { describe, expect, it } from 'vitest';
import { createBottomBarState, deriveBottomBarVisibleItems } from './bottomBarState';
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

describe('deriveBottomBarVisibleItems', () => {
  it('orders recent tasks before recent notes for empty search', () => {
    const items = deriveBottomBarVisibleItems('', [], [searchItem()], [taskItem()]);

    expect(items.map((item) => item.kind)).toEqual(['task', 'note']);
  });
});

describe('createBottomBarState', () => {
  it('uses raw navigation results for next and previous search buttons', () => {
    const visibleResults = [searchItem({ matchText: 'line grouped result' })];
    const rawResults = [
      searchItem({ matchText: 'first instance' }),
      searchItem({ matchText: 'second instance' })
    ];
    const navigated: SearchItem[] = [];
    const state = createBottomBarState({
      getSearchMode: () => 'current',
      getSearchQuery: () => 'found',
      getSearchResults: () => visibleResults,
      getSearchNavigationResults: () => rawResults,
      getRecentNotes: () => [],
      getRecentTasks: () => [],
      getVisibleItems: () => [],
      getForgetHoldDurationMs: () => 0,
      isForgetHoldEnabled: () => false,
      onSearchInput: () => {},
      onSearchModeChange: () => {},
      onSearchSelect: () => {},
      onSearchNavigate: (result) => {
        navigated.push(result);
      },
      onRecentNoteSelect: () => {},
      onRecentTaskSelect: () => {},
      onRecentNoteShortcut: () => {},
      onRecentTaskShortcut: () => {},
      onSearchFocus: () => {},
      onForget: () => {}
    });

    state.navigateSearchResult(1);
    state.navigateSearchResult(1);

    expect(navigated.map((item) => item.matchText)).toEqual(['second instance', 'first instance']);
  });
});
