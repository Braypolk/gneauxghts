import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createNotepadCommandBarState,
  deriveNotepadCommandBarVisibleItems
} from './notepadCommandBarState.svelte';
import type { LocationHistoryEntry } from '#lib/features/notepad/navigation/locationMru.js';
import type { ImageSearchItem, SearchItem } from '#lib/types/semantic.js';
import { resetAllKeyboardShortcuts, setKeyboardShortcutBindings } from '#lib/keyboardShortcuts.svelte.js';

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

function locationEntry(
  overrides: Partial<LocationHistoryEntry> & { location?: LocationHistoryEntry['location'] } = {}
): LocationHistoryEntry {
  return {
    location: overrides.location ?? {
      kind: 'editor',
      noteId: 'note-id',
      notePath: '/vault/Note.md'
    },
    label: overrides.label ?? 'Note'
  };
}

describe('deriveNotepadCommandBarVisibleItems', () => {
  it('orders pinned notes before recent locations for empty search', () => {
    const items = deriveNotepadCommandBarVisibleItems(
      '',
      [],
      [searchItem({ noteId: 'pinned' })],
      [locationEntry()]
    );

    expect(items.map((item) => item.kind)).toEqual(['pinned', 'location']);
  });
});

describe('createNotepadCommandBarState', () => {
  afterEach(resetAllKeyboardShortcuts);
  function createState(
    overrides: Partial<Parameters<typeof createNotepadCommandBarState>[0]> = {}
  ) {
    return createNotepadCommandBarState({
      getSearchQuery: () => '',
      getSearchMode: () => 'all',
      getSearchResults: () => [],
      getPinnedNotes: () => [],
      getRecentLocations: () => [],
      getVisibleItems: () => [],
      getForgetHoldDurationMs: () => 0,
      isForgetHoldEnabled: () => false,
      isForgetActionAvailable: () => true,
      onSearchInput: () => {},
      onSearchSelect: () => {},
      onSearchNavigate: () => {},
      onPinnedNoteSelect: () => {},
      onRecentLocationSelect: () => {},
      onRecentLocationShortcut: () => {},
      closeSearch: () => {},
      onForget: () => {},
      ...overrides
    });
  }

  it('does not execute a second action after a captured shortcut was handled', () => {
    const onSearchSelect = vi.fn();
    const onSearchInput = vi.fn();
    const state = createState({ getVisibleItems: () => [{ kind: 'search', item: searchItem() }], onSearchSelect, onSearchInput });
    for (const key of ['Enter', 'Escape', 'ArrowDown']) {
      state.handleSearchKeydown({ key, defaultPrevented: true, preventDefault: vi.fn() } as unknown as KeyboardEvent);
    }
    expect(onSearchSelect).not.toHaveBeenCalled();
    expect(onSearchInput).not.toHaveBeenCalled();
    expect(state.activeIndex).toBe(0);
  });

  it('uses an assigned Escape combination for splitting before dismissal', () => {
    const item = searchItem({ notePath: '/vault/Note.md' });
    const openInSplit = vi.fn();
    const onSearchInput = vi.fn();
    const state = createState({ getSearchQuery: () => 'query', getVisibleItems: () => [{ kind: 'search', item }], getOpenInSplit: () => openInSplit, onSearchInput });
    setKeyboardShortcutBindings('searchOpenInSplit', ['Shift+Escape']);
    state.handleSearchKeydown({ key: 'Escape', code: 'Escape', shiftKey: true, preventDefault: vi.fn() } as unknown as KeyboardEvent);
    expect(openInSplit).toHaveBeenCalledWith(item);
    expect(onSearchInput).not.toHaveBeenCalled();
  });

  it('selects an image with arrows and Enter through the shared result navigation', () => {
    const image: ImageSearchItem = { kind: 'image', noteId: 'image-note', notePath: '/vault/Pictures.md', noteTitle: 'Pictures', noteHash: 'note', assetName: 'chart.png', assetHash: 'asset', sourceStart: 2, sourceEnd: 20, score: .85 };
    const onImageSelect = vi.fn();
    const onSearchSelect = vi.fn();
    const closeSearch = vi.fn();
    const state = createState({
      getSearchQuery: () => 'growth chart',
      getVisibleItems: () => [{ kind: 'search', item: searchItem() }, { kind: 'image', item: image }],
      onImageSelect, onSearchSelect, closeSearch
    });
    const key = (key: string) => ({ key, preventDefault: vi.fn() } as unknown as KeyboardEvent);
    state.handleSearchKeydown(key('ArrowDown'));
    state.handleSearchKeydown(key('Enter'));
    expect(onImageSelect).toHaveBeenCalledWith(image);
    expect(onSearchSelect).not.toHaveBeenCalled();
    expect(closeSearch).toHaveBeenCalledOnce();
  });

  it('navigates last edited rows when no pinned or recent locations exist', () => {
    const first = searchItem({ noteId: 'first' });
    const second = searchItem({ noteId: 'second' });
    const onSearchSelect = vi.fn();
    const state = createState({
      getVisibleItems: () => [{ kind: 'search', item: first }, { kind: 'search', item: second }],
      onSearchSelect
    });
    const key = (key: string) => ({ key, preventDefault: vi.fn() } as unknown as KeyboardEvent);
    state.handleSearchKeydown(key('ArrowDown'));
    state.handleSearchKeydown(key('Enter'));
    expect(onSearchSelect).toHaveBeenCalledWith(second);
  });

  it('moves Up from the first browse row to the mode switch, including an empty list', () => {
    for (const items of [[], [{ kind: 'location' as const, item: locationEntry() }]]) {
      const onBrowseModeFocus = vi.fn();
      const state = createState({ getVisibleItems: () => items, onBrowseModeFocus });
      const preventDefault = vi.fn();
      state.handleSearchKeydown({ key: 'ArrowUp', preventDefault } as unknown as KeyboardEvent);
      expect(onBrowseModeFocus).toHaveBeenCalledOnce();
      expect(state.activeIndex).toBe(0);
      expect(state.searchNavigationMode).toBe('keyboard');
      expect(preventDefault).toHaveBeenCalledOnce();
    }
  });

  it('reaches the mode switch only above the first row in empty-query browsing', () => {
    const onBrowseModeFocus = vi.fn();
    const items = [locationEntry(), locationEntry()].map(item => ({ kind: 'location' as const, item }));
    const state = createState({ getVisibleItems: () => items, onBrowseModeFocus });
    const key = (key: string) => state.handleSearchKeydown({ key, preventDefault: vi.fn() } as unknown as KeyboardEvent);
    key('ArrowDown');
    key('ArrowUp');
    expect(state.activeIndex).toBe(0);
    expect(onBrowseModeFocus).not.toHaveBeenCalled();
    key('ArrowUp');
    expect(onBrowseModeFocus).toHaveBeenCalledOnce();

    const search = createState({ getSearchQuery: () => 'query', getVisibleItems: () => items, onBrowseModeFocus });
    search.handleSearchKeydown({ key: 'ArrowUp', preventDefault: vi.fn() } as unknown as KeyboardEvent);
    expect(search.activeIndex).toBe(1);
    expect(onBrowseModeFocus).toHaveBeenCalledOnce();
  });

  it('focuses the split action with Right only when the selected note can split', () => {
    for (const available of [true, false]) {
      const onSplitActionFocus = vi.fn();
      const state = createState({
        getVisibleItems: () => [{ kind: 'location', item: locationEntry() }],
        getOpenInSplit: () => available ? vi.fn() : undefined,
        onSplitActionFocus
      });
      state.handleSearchKeydown({ key: 'ArrowRight', preventDefault: vi.fn() } as unknown as KeyboardEvent);
      expect(onSplitActionFocus).toHaveBeenCalledTimes(available ? 1 : 0);
    }
    const onSplitActionFocus = vi.fn();
    const state = createState({
      getVisibleItems: () => [{ kind: 'search', item: searchItem() }],
      getOpenInSplit: () => vi.fn(), onSplitActionFocus
    });
    state.handleSearchKeydown({ key: 'ArrowRight', preventDefault: vi.fn() } as unknown as KeyboardEvent);
    expect(onSplitActionFocus).not.toHaveBeenCalled();
  });

  it('preserves horizontal cursor movement until search results are navigated with the keyboard', () => {
    const onSplitActionFocus = vi.fn();
    const state = createState({
      getSearchQuery: () => 'query',
      getVisibleItems: () => [{ kind: 'search', item: searchItem({ notePath: '/vault/Note.md' }) }],
      getOpenInSplit: () => vi.fn(), onSplitActionFocus
    });
    const right = { key: 'ArrowRight', preventDefault: vi.fn() } as unknown as KeyboardEvent;
    state.handleSearchKeydown(right);
    expect(right.preventDefault).not.toHaveBeenCalled();
    expect(onSplitActionFocus).not.toHaveBeenCalled();
    state.handleSearchKeydown({ key: 'ArrowDown', preventDefault: vi.fn() } as unknown as KeyboardEvent);
    state.handleSearchKeydown({ ...right, altKey: true });
    expect(onSplitActionFocus).not.toHaveBeenCalled();
    state.handleSearchKeydown(right);
    expect(onSplitActionFocus).toHaveBeenCalledWith(0);
  });

  it('returns the user to where they were when Escape dismisses search', () => {
    const calls: string[] = [];
    const state = createState({
      onSearchDismiss: () => calls.push('dismiss'),
      closeSearch: () => calls.push('close')
    });

    state.handleSearchKeydown({
      key: 'Escape',
      preventDefault: () => {}
    } as unknown as KeyboardEvent);

    // Closing blurs the input, so the restore has to happen first.
    expect(calls).toEqual(['dismiss', 'close']);
  });

  it('clears a pending query on the first Escape instead of returning focus', () => {
    const onSearchDismiss = vi.fn();
    const onSearchInput = vi.fn();
    const state = createState({
      getSearchQuery: () => 'meeting',
      onSearchDismiss,
      onSearchInput
    });

    state.handleSearchKeydown({
      key: 'Escape',
      preventDefault: () => {}
    } as unknown as KeyboardEvent);

    expect(onSearchInput).toHaveBeenCalledWith('');
    expect(onSearchDismiss).not.toHaveBeenCalled();
  });

  it('hands focus to the destination when a result is chosen', () => {
    const onSearchCommit = vi.fn();
    const item = locationEntry();
    const state = createState({ onSearchCommit });

    state.selectItem({ kind: 'location', item });

    expect(onSearchCommit).toHaveBeenCalledOnce();
  });

  it('opens saved notes and recent Thought partner through the split action with Option-Enter', () => {
    const note = searchItem({ notePath: '/vault/Note.md' });
    for (const item of [
      { kind: 'search' as const, item: note },
      { kind: 'pinned' as const, item: note },
      { kind: 'location' as const, item: locationEntry() },
      { kind: 'location' as const, item: locationEntry({ label: 'Thought partner', location: {
        kind: 'chat', conversationId: 'retained-chat', contextNoteId: null, contextNotePath: null
      } }) }
    ]) {
      const calls: unknown[] = [];
      const onSearchSelect = vi.fn();
      const onPinnedNoteSelect = vi.fn();
      const onRecentLocationSelect = vi.fn();
      const state = createState({
        getVisibleItems: () => [item],
        getOpenInSplit: () => destination => calls.push(destination),
        onSearchCommit: () => calls.push('commit'),
        closeSearch: () => calls.push('close'),
        onSearchSelect, onPinnedNoteSelect, onRecentLocationSelect
      });
      state.handleSearchKeydown({ key: 'Enter', altKey: true, preventDefault: vi.fn() } as unknown as KeyboardEvent);
      expect(calls).toEqual(['commit', 'close', item.item]);
      expect(onSearchSelect).not.toHaveBeenCalled();
      expect(onPinnedNoteSelect).not.toHaveBeenCalled();
      expect(onRecentLocationSelect).not.toHaveBeenCalled();
    }
  });

  it('uses the same split action for Option-click and Option-Enter in current-note search', () => {
    const item = searchItem({ notePath: '/vault/Note.md' });
    const openInSplit = vi.fn();
    const onSearchNavigate = vi.fn();
    const state = createState({
      getSearchMode: () => 'current',
      getSearchQuery: () => 'found',
      getVisibleItems: () => [{ kind: 'search', item }],
      getOpenInSplit: () => openInSplit,
      onSearchNavigate
    });
    state.selectItem({ kind: 'search', item }, { altKey: true });
    state.handleSearchKeydown({ key: 'Enter', altKey: true, preventDefault: vi.fn() } as unknown as KeyboardEvent);
    expect(openInSplit.mock.calls).toEqual([[item], [item]]);
    expect(onSearchNavigate).not.toHaveBeenCalled();
  });

  it('keeps ordinary selection when splitting is unavailable or the note is unsaved', () => {
    for (const available of [false, true]) {
      const item = searchItem({ notePath: available ? null : '/vault/Note.md' });
      const openInSplit = vi.fn();
      const onSearchSelect = vi.fn();
      const state = createState({
        getVisibleItems: () => [{ kind: 'search', item }],
        getOpenInSplit: () => available ? openInSplit : undefined,
        onSearchSelect
      });
      state.handleSearchKeydown({ key: 'Enter', altKey: true, preventDefault: vi.fn() } as unknown as KeyboardEvent);
      expect(openInSplit).not.toHaveBeenCalled();
      expect(onSearchSelect).toHaveBeenCalledWith(item);
    }
  });

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

  it('previews each current-note occurrence with Enter and wraps in both directions', () => {
    const first = searchItem({ currentMatchRange: { from: 0, to: 5 } });
    const second = searchItem({ currentMatchRange: { from: 6, to: 11 } });
    const third = searchItem({ currentMatchRange: { from: 20, to: 25 } });
    const onSearchNavigate = vi.fn();
    const onSearchSelect = vi.fn();
    const onSearchCommit = vi.fn();
    const closeSearch = vi.fn();
    const state = createState({
      getSearchMode: () => 'current',
      getSearchQuery: () => 'found',
      getSearchResults: () => [first, third],
      getSearchNavigationResults: () => [first, second, third],
      getSearchResultRowIndex: (result) => result === third ? 1 : 0,
      getVisibleItems: () => [first, third].map(item => ({ kind: 'search', item })),
      onSearchNavigate, onSearchSelect, onSearchCommit, closeSearch
    });
    const enter = (shiftKey = false) => state.handleSearchKeydown({
      key: 'Enter', shiftKey, preventDefault: vi.fn()
    } as unknown as KeyboardEvent);

    enter();
    enter();
    expect(state.activeIndex).toBe(0); // Both occurrences share a result row.
    enter();
    expect(state.activeIndex).toBe(1);
    enter();
    enter(true);
    enter(true);
    expect(onSearchNavigate.mock.calls.map(([result]) => result)).toEqual([
      first, second, third, first, third, second
    ]);
    expect(onSearchSelect).not.toHaveBeenCalled();
    expect(onSearchCommit).not.toHaveBeenCalled();
    expect(closeSearch).not.toHaveBeenCalled();

    state.resetActiveIndex();
    enter();
    expect(onSearchNavigate).toHaveBeenLastCalledWith(first);
    state.handleSearchItemPointerEnter(1);
    expect(onSearchNavigate).toHaveBeenLastCalledWith(third);
    enter();
    expect(onSearchNavigate).toHaveBeenLastCalledWith(first);
  });

  it('previews hovered rows and arrow-key destinations without committing current-note search', () => {
    const first = searchItem({ currentMatchRange: { from: 0, to: 5 } });
    const second = searchItem({ currentMatchRange: { from: 6, to: 11 } });
    const third = searchItem({ currentMatchRange: { from: 20, to: 25 } });
    const onSearchNavigate = vi.fn();
    const onSearchSelect = vi.fn();
    const closeSearch = vi.fn();
    const state = createState({
      getSearchMode: () => 'current',
      getSearchQuery: () => 'found',
      getSearchResults: () => [first, third],
      getSearchNavigationResults: () => [first, second, third],
      getSearchResultRowIndex: (result) => result === third ? 1 : 0,
      getVisibleItems: () => [first, third].map(item => ({ kind: 'search', item })),
      onSearchNavigate, onSearchSelect, closeSearch
    });
    const key = (key: string) => state.handleSearchKeydown({ key, preventDefault: vi.fn() } as unknown as KeyboardEvent);
    state.handleSearchItemPointerEnter(0);
    expect(state.searchNavigationMode).toBe('pointer');
    key('Enter'); // Continue from the occurrence previewed by hovering.
    key('ArrowDown'); // Arrows move through visible rows, including grouped rows.
    expect(state.activeIndex).toBe(1);
    expect(state.searchNavigationMode).toBe('keyboard');
    key('ArrowDown'); // Wrap to the first row.
    key('ArrowUp');
    state.handleSearchItemPointerEnter(-1);
    expect(onSearchNavigate.mock.calls.map(([result]) => result)).toEqual([
      first, second, third, first, third
    ]);
    expect(onSearchSelect).not.toHaveBeenCalled();
    expect(closeSearch).not.toHaveBeenCalled();
  });

  it('keeps hovering and arrows as list navigation for all-note results and empty-query recent items', () => {
    for (const mode of ['all', 'current'] as const) {
      const results = [searchItem(), searchItem()];
      const onSearchNavigate = vi.fn();
      const state = createState({
        getSearchMode: () => mode,
        getSearchQuery: () => mode === 'all' ? 'found' : '',
        getSearchResults: () => results,
        getPinnedNotes: () => results,
        getVisibleItems: () => results.map(item => ({ kind: mode === 'all' ? 'search' : 'pinned', item })),
        onSearchNavigate
      });
      state.handleSearchItemPointerEnter(1);
      state.handleSearchKeydown({ key: 'ArrowDown', preventDefault: vi.fn() } as unknown as KeyboardEvent);
      expect(state.activeIndex).toBe(0);
      expect(onSearchNavigate).not.toHaveBeenCalled();
    }
  });

  it('still commits all-note results and empty-query recent items with Enter', () => {
    for (const mode of ['all', 'current'] as const) {
      const item = searchItem();
      const onSearchSelect = vi.fn();
      const onPinnedNoteSelect = vi.fn();
      const onSearchNavigate = vi.fn();
      const closeSearch = vi.fn();
      const state = createState({
        getSearchMode: () => mode,
        getSearchQuery: () => mode === 'all' ? 'found' : '',
        getPinnedNotes: () => [item],
        getVisibleItems: () => [{ kind: mode === 'all' ? 'search' : 'pinned', item }],
        onSearchSelect, onPinnedNoteSelect, onSearchNavigate, closeSearch
      });
      state.handleSearchKeydown({ key: 'Enter', preventDefault: vi.fn() } as unknown as KeyboardEvent);
      expect(mode === 'all' ? onSearchSelect : onPinnedNoteSelect).toHaveBeenCalledWith(item);
      expect(onSearchNavigate).not.toHaveBeenCalled();
      expect(closeSearch).toHaveBeenCalledOnce();
    }
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

  it('describes the focused chat in the forget action', () => {
    const state = createState({
      getForgetItemLabel: () => 'chat'
    });

    expect(state.getForgetButtonAriaLabel()).toContain('Forget this chat.');
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

      const snapshot = state.getSnapshot();

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

      expect(state.getSnapshot().isForgetConfirmOpen).toBe(false);

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
