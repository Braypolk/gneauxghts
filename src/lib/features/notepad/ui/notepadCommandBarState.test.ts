import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
      isForgetActionAvailable: () => true,
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

  describe('forget shortcut', () => {
    function forgetShortcutEvent(
      type: 'keydown' | 'keyup',
      overrides: Partial<KeyboardEvent> & { preventDefault?: () => void } = {}
    ) {
      const preventDefault = overrides.preventDefault ?? vi.fn();
      return {
        type,
        key: 'Backspace',
        code: 'Backspace',
        metaKey: true,
        shiftKey: true,
        ctrlKey: false,
        altKey: false,
        repeat: false,
        defaultPrevented: false,
        preventDefault,
        ...overrides
      } as unknown as KeyboardEvent;
    }

    beforeEach(() => {
      let nextFrameId = 1;
      const frames = new Map<number, FrameRequestCallback>();

      vi.stubGlobal('window', {
        requestAnimationFrame: (callback: FrameRequestCallback) => {
          const id = nextFrameId++;
          frames.set(id, callback);
          return id;
        },
        cancelAnimationFrame: (id: number) => {
          frames.delete(id);
        },
        setTimeout: ((handler: TimerHandler, timeout?: number, ...args: unknown[]) =>
          globalThis.setTimeout(handler, timeout, ...args)) as typeof setTimeout,
        clearTimeout: ((id?: number) => globalThis.clearTimeout(id)) as typeof clearTimeout
      });
      vi.stubGlobal('performance', {
        now: () => Date.now()
      });
    });

    afterEach(() => {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    });

    it('forgets immediately when hold is disabled', () => {
      const onForget = vi.fn();
      const state = createState({
        isForgetHoldEnabled: () => false,
        onForget
      });

      expect(state.handleForgetShortcutKeyDown(forgetShortcutEvent('keydown'))).toBe(true);
      expect(onForget).toHaveBeenCalledOnce();
    });

    it('opens confirm on a short shortcut press when hold is enabled', () => {
      const onForget = vi.fn();
      const state = createState({
        getForgetHoldDurationMs: () => 1000,
        isForgetHoldEnabled: () => true,
        onForget
      });

      expect(state.handleForgetShortcutKeyDown(forgetShortcutEvent('keydown'))).toBe(true);
      expect(state.handleForgetShortcutKeyUp(forgetShortcutEvent('keyup'))).toBe(true);

      let snapshot = { isForgetConfirmOpen: false, isHoldingForget: true };
      state.subscribe((value) => {
        snapshot = value;
      })();

      expect(snapshot.isHoldingForget).toBe(false);
      expect(snapshot.isForgetConfirmOpen).toBe(true);
      expect(onForget).not.toHaveBeenCalled();
      state.dispose();
    });

    it('forgets after holding the shortcut for the full duration', () => {
      vi.useFakeTimers();
      const onForget = vi.fn();
      const state = createState({
        getForgetHoldDurationMs: () => 400,
        isForgetHoldEnabled: () => true,
        onForget
      });

      expect(state.handleForgetShortcutKeyDown(forgetShortcutEvent('keydown'))).toBe(true);

      vi.advanceTimersByTime(400 + 100);

      expect(onForget).toHaveBeenCalledOnce();
      expect(state.handleForgetShortcutKeyUp(forgetShortcutEvent('keyup'))).toBe(false);

      let snapshot = { isForgetConfirmOpen: true };
      state.subscribe((value) => {
        snapshot = value;
      })();
      expect(snapshot.isForgetConfirmOpen).toBe(false);

      state.dispose();
    });

    it('ignores the shortcut when forget is unavailable', () => {
      const onForget = vi.fn();
      const state = createState({
        isForgetActionAvailable: () => false,
        isForgetHoldEnabled: () => true,
        getForgetHoldDurationMs: () => 400,
        onForget
      });

      expect(state.handleForgetShortcutKeyDown(forgetShortcutEvent('keydown'))).toBe(false);
      expect(onForget).not.toHaveBeenCalled();
    });
  });
});
