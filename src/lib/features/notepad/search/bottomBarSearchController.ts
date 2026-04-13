import { tick } from 'svelte';
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

interface BottomBarSearchControllerDeps {
  getSearchInput: () => HTMLInputElement | null;
  getSearchResultsViewport: () => HTMLDivElement | null;
  getSearchMode: () => 'current' | 'all';
  getSearchQuery: () => string;
  getSearchResults: () => SearchItem[];
  getRecentNotes: () => SearchItem[];
  getRecentTasks: () => RecentTaskItem[];
  getVisibleItems: () => BottomBarVisibleItem[];
  getIsSearchFocused: () => boolean;
  setIsSearchFocused: (value: boolean) => void;
  getActiveIndex: () => number;
  setActiveIndex: (value: number) => void;
  getLastHandledFocusRequest: () => number;
  setLastHandledFocusRequest: (value: number) => void;
  onSearchInput: (value: string) => void;
  onSearchModeChange: (mode: 'current' | 'all') => void | Promise<void>;
  onSearchSelect: (result: SearchItem) => void;
  onRecentNoteSelect: (result: SearchItem) => void;
  onRecentTaskSelect: (task: RecentTaskItem) => void;
  onRecentNoteShortcut: (index: number) => void | Promise<void>;
  onRecentTaskShortcut: (index: number) => void | Promise<void>;
  onSearchFocus: () => void;
  onCommand?: (command: string) => boolean | Promise<boolean>;
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

export function createBottomBarSearchController({
  getSearchInput,
  getSearchResultsViewport,
  getSearchMode,
  getSearchQuery,
  getSearchResults,
  getRecentNotes,
  getRecentTasks,
  getVisibleItems,
  getIsSearchFocused,
  setIsSearchFocused,
  getActiveIndex,
  setActiveIndex,
  getLastHandledFocusRequest,
  setLastHandledFocusRequest,
  onSearchInput,
  onSearchModeChange,
  onSearchSelect,
  onRecentNoteSelect,
  onRecentTaskSelect,
  onRecentNoteShortcut,
  onRecentTaskShortcut,
  onSearchFocus,
  onCommand
}: BottomBarSearchControllerDeps) {
  function resetActiveIndex() {
    setActiveIndex(0);
  }

  function handleSearchInput(event: Event) {
    onSearchInput((event.currentTarget as HTMLInputElement).value);
  }

  function handleSearchFocus() {
    setIsSearchFocused(true);
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

    setIsSearchFocused(false);
    resetActiveIndex();
  }

  function closeSearchPanel() {
    setIsSearchFocused(false);
    resetActiveIndex();
    getSearchInput()?.blur();
  }

  async function handleSearchModeClick(mode: 'current' | 'all') {
    const searchInput = getSearchInput();
    const selectionStart = searchInput?.selectionStart ?? null;
    const selectionEnd = searchInput?.selectionEnd ?? null;
    await onSearchModeChange(mode);
    await tick();
    requestAnimationFrame(() => {
      const currentInput = getSearchInput();
      if (!currentInput) return;
      currentInput.focus();
      if (selectionStart === null || selectionEnd === null) return;
      currentInput.setSelectionRange(selectionStart, selectionEnd);
    });
  }

  function getSearchPlaceholder() {
    if (!getIsSearchFocused()) return '';
    return getSearchMode() === 'current' ? 'Current Gneauxght' : 'All Gneauxghts';
  }

  function getDigitShortcutIndex(event: KeyboardEvent) {
    const shortcutMatch = event.code.match(/^Digit(\d)$/);
    if (!shortcutMatch) {
      return null;
    }

    return Number(shortcutMatch[1]) - 1;
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
    const shortcutIndex = getDigitShortcutIndex(event);
    if (event.ctrlKey && !event.metaKey && !event.altKey && shortcutIndex !== null) {
      event.preventDefault();

      if (event.shiftKey) {
        const task = getRecentTasks()[shortcutIndex];
        if (task) {
          selectItem({ kind: 'task', item: task });
          return;
        }

        void onRecentTaskShortcut(shortcutIndex);
        return;
      }

      const note = getRecentNotes()[shortcutIndex];
      if (note) {
        selectItem({ kind: 'note', item: note });
        return;
      }

      void onRecentNoteShortcut(shortcutIndex);
      return;
    }

    const items = getVisibleItems();
    const isPanelVisible =
      getIsSearchFocused() &&
      (getSearchQuery().trim() !== '' ||
        getRecentNotes().length > 0 ||
        getRecentTasks().length > 0);

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
      setActiveIndex((getActiveIndex() + 1) % items.length);
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((getActiveIndex() - 1 + items.length) % items.length);
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      selectItem(items[getActiveIndex()] ?? items[0]);
    }
  }

  function handleFocusRequest(focusRequest: number) {
    if (focusRequest <= getLastHandledFocusRequest()) return;
    setLastHandledFocusRequest(focusRequest);

    const searchInput = getSearchInput();
    if (!searchInput) return;

    searchInput.focus();
    const end = searchInput.value.length;
    searchInput.setSelectionRange(end, end);
    setIsSearchFocused(true);
    onSearchFocus();
  }

  async function syncActiveItemIntoView() {
    if (!getIsSearchFocused() || !getSearchResultsViewport()) {
      return;
    }

    await tick();
    requestAnimationFrame(() => {
      const activeItem = getSearchResultsViewport()?.querySelector<HTMLElement>(
        '[data-search-result-active="true"]'
      );
      activeItem?.scrollIntoView({ block: 'nearest' });
    });
  }

  return {
    resetActiveIndex,
    handleSearchInput,
    handleSearchFocus,
    handleSearchBlur,
    closeSearchPanel,
    handleSearchModeClick,
    getSearchPlaceholder,
    handleSearchKeydown,
    selectItem,
    handleFocusRequest,
    syncActiveItemIntoView
  };
}
