import { describe, expect, it } from 'vitest';
import { deriveBottomBarVisibleItems } from './bottomBarState';
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
