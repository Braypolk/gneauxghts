import { tick } from 'svelte';
import { get, writable } from 'svelte/store';
import { keyboardShortcutMatchesEvent, type KeyboardShortcutId } from '$lib/keyboardShortcuts';
import type { SearchItem } from '$lib/types/semantic';
import type { RecentTaskItem } from '$lib/features/notepad/model/types';

export type BottomBarVisibleItem =
  | { kind: 'search'; item: SearchItem }
  | { kind: 'note'; item: SearchItem }
  | { kind: 'task'; item: RecentTaskItem };

interface TextRange {
  start: number;
  end: number;
}

export interface BottomBarState {
  isSearchFocused: boolean;
  activeIndex: number;
  lastHandledFocusRequest: number;
  isHoldingForget: boolean;
  forgetHoldProgress: number;
  isForgetConfirmOpen: boolean;
}

interface BottomBarStateDeps {
  getSearchMode: () => 'current' | 'all';
  getSearchQuery: () => string;
  getSearchResults: () => SearchItem[];
  getRecentNotes: () => SearchItem[];
  getRecentTasks: () => RecentTaskItem[];
  getVisibleItems: () => BottomBarVisibleItem[];
  getForgetHoldDurationMs: () => number;
  isForgetHoldEnabled: () => boolean;
  onSearchInput: (value: string) => void;
  onSearchModeChange: (mode: 'current' | 'all') => void | Promise<void>;
  onSearchSelect: (result: SearchItem) => void;
  onRecentNoteSelect: (result: SearchItem) => void;
  onRecentTaskSelect: (task: RecentTaskItem) => void;
  onRecentNoteShortcut: (index: number) => void | Promise<void>;
  onRecentTaskShortcut: (index: number) => void | Promise<void>;
  onSearchFocus: () => void;
  onCommand?: (command: string) => boolean | Promise<boolean>;
  onForget: () => void;
}

const FORGET_HOLD_COMPLETION_DELAY_MS = 100;

function createInitialState(): BottomBarState {
  return {
    isSearchFocused: false,
    activeIndex: 0,
    lastHandledFocusRequest: 0,
    isHoldingForget: false,
    forgetHoldProgress: 0,
    isForgetConfirmOpen: false
  };
}

export function deriveBottomBarVisibleItems(
  searchQuery: string,
  searchResults: SearchItem[],
  recentNotes: SearchItem[],
  recentTasks: RecentTaskItem[]
): BottomBarVisibleItem[] {
  if (searchQuery.trim() === '') {
    return [
      ...recentNotes.map((item) => ({ kind: 'note' as const, item })),
      ...recentTasks.map((item) => ({ kind: 'task' as const, item }))
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

export function createBottomBarState({
  getSearchMode,
  getSearchQuery,
  getSearchResults,
  getRecentNotes,
  getRecentTasks,
  getVisibleItems,
  getForgetHoldDurationMs,
  isForgetHoldEnabled,
  onSearchInput,
  onSearchModeChange,
  onSearchSelect,
  onRecentNoteSelect,
  onRecentTaskSelect,
  onRecentNoteShortcut,
  onRecentTaskShortcut,
  onSearchFocus,
  onCommand,
  onForget
}: BottomBarStateDeps) {
  const store = writable<BottomBarState>(createInitialState());
  const { subscribe, update } = store;

  let searchInput: HTMLInputElement | null = null;
  let searchResultsViewport: HTMLDivElement | null = null;
  let forgetHoldStartedAt = 0;
  let forgetHoldFrame: number | null = null;
  let forgetHoldTimeout: ReturnType<typeof window.setTimeout> | null = null;
  let suppressNextForgetClick = false;

  function patch(partial: Partial<BottomBarState>) {
    update((state) => ({ ...state, ...partial }));
  }

  function bindSearchInput(node: HTMLInputElement | null) {
    searchInput = node;
  }

  function bindSearchResultsViewport(node: HTMLDivElement | null) {
    searchResultsViewport = node;
  }

  function getState() {
    return get(store);
  }

  function resetActiveIndex() {
    patch({ activeIndex: 0 });
  }

  function setSearchFocused(isSearchFocused: boolean) {
    if (getState().isSearchFocused === isSearchFocused) {
      return;
    }

    patch({ isSearchFocused });
  }

  function handleSearchInput(event: Event) {
    onSearchInput((event.currentTarget as HTMLInputElement).value);
  }

  function handleSearchClear() {
    onSearchInput('');
    searchInput?.focus();
  }

  function handleSearchFocus() {
    setSearchFocused(true);
    onSearchFocus();
  }

  function handleSearchBlur(event: FocusEvent) {
    const nextTarget = event.relatedTarget;
    if (
      nextTarget instanceof Node &&
      event.currentTarget instanceof HTMLElement &&
      event.currentTarget.contains(nextTarget)
    ) {
      return;
    }

    setSearchFocused(false);
    resetActiveIndex();
  }

  function closeSearchPanel() {
    setSearchFocused(false);
    resetActiveIndex();
    searchInput?.blur();
  }

  async function handleSearchModeClick(mode: 'current' | 'all') {
    const selectionStart = searchInput?.selectionStart ?? null;
    const selectionEnd = searchInput?.selectionEnd ?? null;
    await onSearchModeChange(mode);
    await tick();
    requestAnimationFrame(() => {
      if (!searchInput) return;
      searchInput.focus();
      if (selectionStart === null || selectionEnd === null) return;
      searchInput.setSelectionRange(selectionStart, selectionEnd);
    });
  }

  function getSearchPlaceholder() {
    if (!getState().isSearchFocused) return '';
    return getSearchMode() === 'current'
      ? 'Search this note'
      : 'Search all notes';
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

  function selectItem(item: BottomBarVisibleItem) {
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

  function handleSearchKeydown(event: KeyboardEvent) {
    if (handleRecentItemShortcut(event)) {
      return;
    }

    const items = getVisibleItems();
    const state = getState();
    const isPanelVisible =
      state.isSearchFocused &&
      (getSearchQuery().trim() !== '' || getRecentNotes().length > 0 || getRecentTasks().length > 0);

    if (event.key === 'Escape') {
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
      patch({ activeIndex: (state.activeIndex + 1) % items.length });
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      patch({ activeIndex: (state.activeIndex - 1 + items.length) % items.length });
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      selectItem(items[state.activeIndex] ?? items[0]);
    }
  }

  function handleFocusRequest(focusRequest: number) {
    if (focusRequest === 0 || focusRequest === getState().lastHandledFocusRequest) {
      return;
    }

    setSearchFocused(true);
    patch({ lastHandledFocusRequest: focusRequest });

    tick().then(() => {
      searchInput?.focus();
      searchInput?.select();
    });
  }

  async function syncActiveItemIntoView() {
    await tick();
    const viewport = searchResultsViewport;
    if (!viewport || !getState().isSearchFocused) {
      return;
    }

    const activeItem = viewport.querySelector<HTMLElement>('[data-search-result-active="true"]');
    activeItem?.scrollIntoView({ block: 'nearest' });
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
    setSearchFocused(false);
    closeForgetConfirm();
    resetForgetHold();
  }

  return {
    subscribe,
    bindSearchInput,
    bindSearchResultsViewport,
    resetActiveIndex,
    handleSearchInput,
    handleSearchClear,
    handleSearchFocus,
    handleSearchBlur,
    handleSearchModeClick,
    getSearchPlaceholder,
    handleSearchKeydown,
    selectItem,
    handleFocusRequest,
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
