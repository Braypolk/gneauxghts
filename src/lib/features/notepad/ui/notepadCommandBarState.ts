import { tick } from 'svelte';
import { get, writable } from 'svelte/store';
import { keyboardShortcutMatchesEvent, type KeyboardShortcutId } from '$lib/keyboardShortcuts';
import {
  moveListSelection,
  pointListSelection,
  type ListNavigationMode
} from '$lib/ui/listSelection';
import type { SearchItem } from '$lib/types/semantic';
import type { RecentTaskItem } from '$lib/features/notepad/model/types';

export type NotepadCommandBarVisibleItem =
  | { kind: 'search'; item: SearchItem }
  | { kind: 'note'; item: SearchItem }
  | { kind: 'task'; item: RecentTaskItem };

interface TextRange {
  start: number;
  end: number;
}

export interface NotepadCommandBarState {
  activeIndex: number;
  searchNavigationMode: ListNavigationMode;
  isHoldingForget: boolean;
  forgetHoldProgress: number;
  isForgetConfirmOpen: boolean;
}

interface NotepadCommandBarStateDeps {
  getSearchQuery: () => string;
  getSearchResults: () => SearchItem[];
  getSearchNavigationResults?: () => SearchItem[];
  getRecentNotes: () => SearchItem[];
  getRecentTasks: () => RecentTaskItem[];
  getVisibleItems: () => NotepadCommandBarVisibleItem[];
  getForgetHoldDurationMs: () => number;
  isForgetHoldEnabled: () => boolean;
  onSearchInput: (value: string) => void;
  onSearchSelect: (result: SearchItem) => void;
  onSearchNavigate?: (result: SearchItem) => void | Promise<void>;
  onRecentNoteSelect: (result: SearchItem) => void;
  onRecentTaskSelect: (task: RecentTaskItem) => void;
  onRecentNoteShortcut: (index: number) => void | Promise<void>;
  onRecentTaskShortcut: (index: number) => void | Promise<void>;
  closeSearch: () => void;
  onCommand?: (command: string) => boolean | Promise<boolean>;
  onForget: () => void;
}

const FORGET_HOLD_COMPLETION_DELAY_MS = 100;

function createInitialState(): NotepadCommandBarState {
  return {
    activeIndex: 0,
    searchNavigationMode: 'pointer',
    isHoldingForget: false,
    forgetHoldProgress: 0,
    isForgetConfirmOpen: false
  };
}

export function deriveNotepadCommandBarVisibleItems(
  searchQuery: string,
  searchResults: SearchItem[],
  recentNotes: SearchItem[],
  recentTasks: RecentTaskItem[]
): NotepadCommandBarVisibleItem[] {
  if (searchQuery.trim() === '') {
    return [
      ...recentTasks.map((item) => ({ kind: 'task' as const, item })),
      ...recentNotes.map((item) => ({ kind: 'note' as const, item }))
    ];
  }

  return searchResults.map((item) => ({ kind: 'search' as const, item }));
}

export function buildHighlightedSegments(text: string, ranges: TextRange[]) {
  const characters = Array.from(text);
  const segments: Array<{ text: string; highlighted: boolean }> = [];
  let cursor = 0;

  for (const range of ranges) {
    const start = Math.max(0, Math.min(range.start, characters.length));
    const end = Math.max(start, Math.min(range.end, characters.length));

    if (start > cursor) {
      segments.push({ text: characters.slice(cursor, start).join(''), highlighted: false });
    }

    if (end > start) {
      segments.push({ text: characters.slice(start, end).join(''), highlighted: true });
    }

    cursor = end;
  }

  if (cursor < characters.length) {
    segments.push({ text: characters.slice(cursor).join(''), highlighted: false });
  }

  return segments.length > 0 ? segments : [{ text, highlighted: false }];
}

export function createNotepadCommandBarState({
  getSearchQuery,
  getSearchResults,
  getSearchNavigationResults,
  getRecentNotes,
  getRecentTasks,
  getVisibleItems,
  getForgetHoldDurationMs,
  isForgetHoldEnabled,
  onSearchInput,
  onSearchSelect,
  onSearchNavigate,
  onRecentNoteSelect,
  onRecentTaskSelect,
  onRecentNoteShortcut,
  onRecentTaskShortcut,
  closeSearch,
  onCommand,
  onForget
}: NotepadCommandBarStateDeps) {
  const store = writable<NotepadCommandBarState>(createInitialState());
  const { subscribe, update } = store;

  let searchResultsViewport: HTMLDivElement | null = null;
  let forgetHoldStartedAt = 0;
  let forgetHoldFrame: number | null = null;
  let forgetHoldTimeout: number | null = null;
  let suppressNextForgetClick = false;

  function patch(partial: Partial<NotepadCommandBarState>) {
    update((state) => ({ ...state, ...partial }));
  }

  function bindSearchResultsViewport(node: HTMLDivElement | null) {
    searchResultsViewport = node;
  }

  function getState() {
    return get(store);
  }

  function resetActiveIndex() {
    patch({ activeIndex: 0, searchNavigationMode: 'pointer' });
  }

  function closeSearchPanel() {
    resetActiveIndex();
    closeSearch();
  }

  function handleRecentItemShortcut(event: KeyboardEvent) {
    for (let shortcutIndex = 0; shortcutIndex < 9; shortcutIndex += 1) {
      const slot = shortcutIndex + 1;
      const taskShortcutId = `recentTask${slot}` as KeyboardShortcutId;
      if (keyboardShortcutMatchesEvent(event, taskShortcutId)) {
        event.preventDefault();

        const task = getRecentTasks()[shortcutIndex];
        if (task) {
          selectItem({ kind: 'task', item: task });
          return true;
        }

        void onRecentTaskShortcut(shortcutIndex);
        return true;
      }

      const noteShortcutId = `recentNote${slot}` as KeyboardShortcutId;
      if (keyboardShortcutMatchesEvent(event, noteShortcutId)) {
        event.preventDefault();

        const note = getRecentNotes()[shortcutIndex];
        if (note) {
          selectItem({ kind: 'note', item: note });
          return true;
        }

        void onRecentNoteShortcut(shortcutIndex);
        return true;
      }
    }

    return false;
  }

  function selectItem(item: NotepadCommandBarVisibleItem) {
    closeSearchPanel();

    if (item.kind === 'task') {
      onRecentTaskSelect(item.item);
      return;
    }

    if (item.kind === 'note') {
      onRecentNoteSelect(item.item);
      return;
    }

    onSearchSelect(item.item);
  }

  function navigateSearchResult(delta: 1 | -1) {
    const results = getSearchNavigationResults?.() ?? getSearchResults();
    if (getSearchQuery().trim() === '' || results.length === 0) {
      return;
    }

    const state = getState();
    const nextSelection = moveListSelection(
      { activeIndex: state.activeIndex, navigationMode: state.searchNavigationMode },
      delta,
      { optionCount: results.length }
    );
    patch({
      activeIndex: nextSelection.activeIndex,
      searchNavigationMode: nextSelection.navigationMode
    });
    void onSearchNavigate?.(results[nextSelection.activeIndex]);
  }

  function handleSearchKeydown(event: KeyboardEvent) {
    if (handleRecentItemShortcut(event)) {
      return;
    }

    const items = getVisibleItems();
    const state = getState();
    const isPanelVisible =
      (getSearchQuery().trim() !== '' || getRecentNotes().length > 0 || getRecentTasks().length > 0);

    if (event.key === 'Escape') {
      event.preventDefault();
      if (getSearchQuery().trim() !== '') {
        onSearchInput('');
        return;
      }

      closeSearchPanel();
      return;
    }

    if (event.key === 'Enter') {
      const trimmedQuery = getSearchQuery().trim();
      if (trimmedQuery.startsWith('/')) {
        event.preventDefault();
        void onCommand?.(trimmedQuery);
        return;
      }
    }

    if (!isPanelVisible || items.length === 0) {
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      const nextSelection = moveListSelection(
        { activeIndex: state.activeIndex, navigationMode: state.searchNavigationMode },
        1,
        { optionCount: items.length }
      );
      patch({
        activeIndex: nextSelection.activeIndex,
        searchNavigationMode: nextSelection.navigationMode
      });
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      const nextSelection = moveListSelection(
        { activeIndex: state.activeIndex, navigationMode: state.searchNavigationMode },
        -1,
        { optionCount: items.length }
      );
      patch({
        activeIndex: nextSelection.activeIndex,
        searchNavigationMode: nextSelection.navigationMode
      });
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      selectItem(items[state.activeIndex] ?? items[0]);
    }
  }

  async function syncActiveItemIntoView() {
    await tick();
    const viewport = searchResultsViewport;
    if (!viewport) {
      return;
    }

    const activeItem = viewport.querySelector<HTMLElement>('[data-search-result-active="true"]');
    activeItem?.scrollIntoView({ block: 'nearest' });
  }

  function handleSearchItemPointerEnter(index: number) {
    const nextSelection = pointListSelection(index, { optionCount: getVisibleItems().length });
    if (!nextSelection) {
      return;
    }

    patch({
      activeIndex: nextSelection.activeIndex,
      searchNavigationMode: nextSelection.navigationMode
    });
  }

  function clearForgetHoldFrame() {
    if (forgetHoldFrame === null) return;
    window.cancelAnimationFrame(forgetHoldFrame);
    forgetHoldFrame = null;
  }

  function clearForgetHoldTimeout() {
    if (forgetHoldTimeout === null) return;
    window.clearTimeout(forgetHoldTimeout);
    forgetHoldTimeout = null;
  }

  function resetForgetHold() {
    clearForgetHoldFrame();
    clearForgetHoldTimeout();
    forgetHoldStartedAt = 0;
    patch({
      isHoldingForget: false,
      forgetHoldProgress: 0
    });
  }

  function closeForgetConfirm() {
    if (!getState().isForgetConfirmOpen) return;
    patch({ isForgetConfirmOpen: false });
  }

  function openForgetConfirm() {
    resetForgetHold();
    patch({ isForgetConfirmOpen: true });
  }

  function confirmForget() {
    closeForgetConfirm();
    onForget();
  }

  function tickForgetHoldProgress() {
    if (!getState().isHoldingForget || !isForgetHoldEnabled()) return;

    const elapsed = performance.now() - forgetHoldStartedAt;
    const nextProgress = Math.min(elapsed / getForgetHoldDurationMs(), 1);
    patch({ forgetHoldProgress: nextProgress });

    if (nextProgress >= 1) {
      forgetHoldFrame = null;
      return;
    }

    forgetHoldFrame = window.requestAnimationFrame(tickForgetHoldProgress);
  }

  function beginForgetHold() {
    if (!isForgetHoldEnabled() || getState().isHoldingForget) return;

    closeForgetConfirm();
    clearForgetHoldFrame();
    clearForgetHoldTimeout();
    forgetHoldStartedAt = performance.now();
    patch({
      isHoldingForget: true,
      forgetHoldProgress: 0
    });
    tickForgetHoldProgress();
    forgetHoldTimeout = window.setTimeout(() => {
      clearForgetHoldFrame();
      patch({ forgetHoldProgress: 1 });
      forgetHoldTimeout = window.setTimeout(() => {
        suppressNextForgetClick = true;
        resetForgetHold();
        onForget();
      }, FORGET_HOLD_COMPLETION_DELAY_MS);
    }, getForgetHoldDurationMs());
  }

  function cancelForgetHold() {
    if (!getState().isHoldingForget) return;
    resetForgetHold();
  }

  function handleForgetPointerDown(event: PointerEvent) {
    if (!isForgetHoldEnabled() || event.button !== 0) return;
    beginForgetHold();
  }

  function handleForgetKeyDown(event: KeyboardEvent) {
    if (!isForgetHoldEnabled() || event.repeat || (event.key !== ' ' && event.key !== 'Enter')) {
      return;
    }
    event.preventDefault();
    beginForgetHold();
  }

  function handleForgetKeyUp(event: KeyboardEvent) {
    if (!isForgetHoldEnabled() || (event.key !== ' ' && event.key !== 'Enter')) return;
    event.preventDefault();
    cancelForgetHold();
  }

  function handleForgetClick() {
    if (suppressNextForgetClick) {
      suppressNextForgetClick = false;
      return;
    }

    if (isForgetHoldEnabled()) {
      openForgetConfirm();
      return;
    }

    onForget();
  }

  function getForgetButtonAriaLabel() {
    return isForgetHoldEnabled()
      ? 'Forget this note. Hold the button or press to confirm.'
      : 'Forget this note';
  }

  function dispose() {
    closeForgetConfirm();
    resetForgetHold();
  }

  return {
    subscribe,
    bindSearchResultsViewport,
    resetActiveIndex,
    handleSearchKeydown,
    handleSearchItemPointerEnter,
    selectItem,
    navigateSearchResult,
    syncActiveItemIntoView,
    resetForgetHold,
    handleForgetPointerDown,
    handleForgetKeyDown,
    handleForgetKeyUp,
    handleForgetClick,
    cancelForgetHold,
    closeForgetConfirm,
    confirmForget,
    getForgetButtonAriaLabel,
    dispose
  };
}
