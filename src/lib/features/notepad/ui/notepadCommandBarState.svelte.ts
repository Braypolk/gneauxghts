import { tick } from 'svelte';
import {
  formatShortcutBinding,
  getKeyboardShortcutBinding,
  keyboardShortcutMatchesEvent,
  type KeyboardShortcutId
} from '$lib/keyboardShortcuts.svelte';
import {
  moveListSelection,
  pointListSelection,
  type ListNavigationMode
} from '$lib/ui/listSelection';
import type { SearchItem } from '$lib/types/semantic';
import type { RecentTaskItem } from '$lib/features/notepad/model/types';
import type { LocationHistoryEntry } from '$lib/features/notepad/navigation/locationMru';

export type NotepadCommandBarVisibleItem =
  | { kind: 'search'; item: SearchItem }
  | { kind: 'location'; item: LocationHistoryEntry }
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
  getRecentLocations: () => LocationHistoryEntry[];
  getRecentTasks: () => RecentTaskItem[];
  getVisibleItems: () => NotepadCommandBarVisibleItem[];
  getForgetHoldDurationMs: () => number;
  isForgetHoldEnabled: () => boolean;
  isForgetActionAvailable: () => boolean;
  onSearchInput: (value: string) => void;
  onSearchSelect: (result: SearchItem) => void;
  onSearchNavigate?: (result: SearchItem) => void | Promise<void>;
  onRecentLocationSelect: (entry: LocationHistoryEntry) => void;
  onRecentTaskSelect: (task: RecentTaskItem) => void;
  onRecentLocationShortcut: (index: number) => void | Promise<void>;
  onRecentTaskShortcut: (index: number) => void | Promise<void>;
  closeSearch: () => void;
  onCommand?: (command: string) => boolean | Promise<boolean>;
  onForget: () => void;
}

const FORGET_HOLD_COMPLETION_DELAY_MS = 100;

export function deriveNotepadCommandBarVisibleItems(
  searchQuery: string,
  searchResults: SearchItem[],
  recentLocations: LocationHistoryEntry[],
  recentTasks: RecentTaskItem[]
): NotepadCommandBarVisibleItem[] {
  if (searchQuery.trim() === '') {
    return [
      ...recentTasks.map((item) => ({ kind: 'task' as const, item })),
      ...recentLocations.map((item) => ({ kind: 'location' as const, item }))
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

class NotepadCommandBarController {
  activeIndex = $state(0);
  searchNavigationMode = $state<ListNavigationMode>('pointer');
  isHoldingForget = $state(false);
  forgetHoldProgress = $state(0);
  isForgetConfirmOpen = $state(false);

  #deps: NotepadCommandBarStateDeps;
  #searchResultsViewport: HTMLDivElement | null = null;
  #forgetHoldStartedAt = 0;
  #forgetHoldFrame: number | null = null;
  #forgetHoldTimeout: number | null = null;
  #suppressNextForgetClick = false;
  #forgetShortcutCode: string | null = null;

  constructor(deps: NotepadCommandBarStateDeps) {
    this.#deps = deps;
  }

  bindSearchResultsViewport = (node: HTMLDivElement | null) => {
    this.#searchResultsViewport = node;
  };

  resetActiveIndex = () => {
    this.activeIndex = 0;
    this.searchNavigationMode = 'pointer';
  };

  #closeSearchPanel = () => {
    this.resetActiveIndex();
    this.#deps.closeSearch();
  };

  selectItem = (item: NotepadCommandBarVisibleItem) => {
    this.#closeSearchPanel();

    if (item.kind === 'task') {
      this.#deps.onRecentTaskSelect(item.item);
      return;
    }

    if (item.kind === 'location') {
      this.#deps.onRecentLocationSelect(item.item);
      return;
    }

    this.#deps.onSearchSelect(item.item);
  };

  #handleRecentItemShortcut = (event: KeyboardEvent) => {
    for (let shortcutIndex = 0; shortcutIndex < 9; shortcutIndex += 1) {
      const slot = shortcutIndex + 1;
      const taskShortcutId = `recentTask${slot}` as KeyboardShortcutId;
      if (keyboardShortcutMatchesEvent(event, taskShortcutId)) {
        event.preventDefault();

        const task = this.#deps.getRecentTasks()[shortcutIndex];
        if (task) {
          this.selectItem({ kind: 'task', item: task });
          return true;
        }

        void this.#deps.onRecentTaskShortcut(shortcutIndex);
        return true;
      }

      const noteShortcutId = `recentNote${slot}` as KeyboardShortcutId;
      if (keyboardShortcutMatchesEvent(event, noteShortcutId)) {
        event.preventDefault();

        const location = this.#deps.getRecentLocations()[shortcutIndex];
        if (location) {
          this.selectItem({ kind: 'location', item: location });
          return true;
        }

        void this.#deps.onRecentLocationShortcut(shortcutIndex);
        return true;
      }
    }

    return false;
  };

  navigateSearchResult = (delta: 1 | -1) => {
    const results = this.#deps.getSearchNavigationResults?.() ?? this.#deps.getSearchResults();
    if (this.#deps.getSearchQuery().trim() === '' || results.length === 0) {
      return;
    }

    const nextSelection = moveListSelection(
      { activeIndex: this.activeIndex, navigationMode: this.searchNavigationMode },
      delta,
      { optionCount: results.length }
    );
    this.activeIndex = nextSelection.activeIndex;
    this.searchNavigationMode = nextSelection.navigationMode;
    void this.#deps.onSearchNavigate?.(results[nextSelection.activeIndex]);
  };

  handleSearchKeydown = (event: KeyboardEvent) => {
    if (this.#handleRecentItemShortcut(event)) {
      return;
    }

    const items = this.#deps.getVisibleItems();
    const isPanelVisible =
      this.#deps.getSearchQuery().trim() !== '' ||
      this.#deps.getRecentLocations().length > 0 ||
      this.#deps.getRecentTasks().length > 0;

    if (event.key === 'Escape') {
      event.preventDefault();
      if (this.#deps.getSearchQuery().trim() !== '') {
        this.#deps.onSearchInput('');
        return;
      }

      this.#closeSearchPanel();
      return;
    }

    if (event.key === 'Enter') {
      const trimmedQuery = this.#deps.getSearchQuery().trim();
      if (trimmedQuery.startsWith('/')) {
        event.preventDefault();
        void this.#deps.onCommand?.(trimmedQuery);
        return;
      }
    }

    if (!isPanelVisible || items.length === 0) {
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      const nextSelection = moveListSelection(
        { activeIndex: this.activeIndex, navigationMode: this.searchNavigationMode },
        1,
        { optionCount: items.length }
      );
      this.activeIndex = nextSelection.activeIndex;
      this.searchNavigationMode = nextSelection.navigationMode;
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      const nextSelection = moveListSelection(
        { activeIndex: this.activeIndex, navigationMode: this.searchNavigationMode },
        -1,
        { optionCount: items.length }
      );
      this.activeIndex = nextSelection.activeIndex;
      this.searchNavigationMode = nextSelection.navigationMode;
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      this.selectItem(items[this.activeIndex] ?? items[0]);
    }
  };

  syncActiveItemIntoView = async () => {
    await tick();
    const viewport = this.#searchResultsViewport;
    if (!viewport) {
      return;
    }

    const activeItem = viewport.querySelector<HTMLElement>('[data-search-result-active="true"]');
    activeItem?.scrollIntoView({ block: 'nearest' });
  };

  handleSearchItemPointerEnter = (index: number) => {
    const nextSelection = pointListSelection(index, {
      optionCount: this.#deps.getVisibleItems().length
    });
    if (!nextSelection) {
      return;
    }

    this.activeIndex = nextSelection.activeIndex;
    this.searchNavigationMode = nextSelection.navigationMode;
  };

  #clearForgetHoldFrame = () => {
    if (this.#forgetHoldFrame === null) return;
    window.cancelAnimationFrame(this.#forgetHoldFrame);
    this.#forgetHoldFrame = null;
  };

  #clearForgetHoldTimeout = () => {
    if (this.#forgetHoldTimeout === null) return;
    window.clearTimeout(this.#forgetHoldTimeout);
    this.#forgetHoldTimeout = null;
  };

  resetForgetHold = () => {
    this.#clearForgetHoldFrame();
    this.#clearForgetHoldTimeout();
    this.#forgetHoldStartedAt = 0;
    this.#forgetShortcutCode = null;
    this.isHoldingForget = false;
    this.forgetHoldProgress = 0;
  };

  closeForgetConfirm = () => {
    if (!this.isForgetConfirmOpen) return;
    this.isForgetConfirmOpen = false;
  };

  #openForgetConfirm = () => {
    this.resetForgetHold();
    this.isForgetConfirmOpen = true;
  };

  confirmForget = () => {
    this.closeForgetConfirm();
    this.#deps.onForget();
  };

  #tickForgetHoldProgress = () => {
    if (!this.isHoldingForget || !this.#deps.isForgetHoldEnabled()) return;

    const elapsed = performance.now() - this.#forgetHoldStartedAt;
    const nextProgress = Math.min(elapsed / this.#deps.getForgetHoldDurationMs(), 1);
    this.forgetHoldProgress = nextProgress;

    if (nextProgress >= 1) {
      this.#forgetHoldFrame = null;
      return;
    }

    this.#forgetHoldFrame = window.requestAnimationFrame(this.#tickForgetHoldProgress);
  };

  #beginForgetHold = () => {
    if (!this.#deps.isForgetHoldEnabled() || this.isHoldingForget) return;

    this.closeForgetConfirm();
    this.#clearForgetHoldFrame();
    this.#clearForgetHoldTimeout();
    this.#forgetHoldStartedAt = performance.now();
    this.isHoldingForget = true;
    this.forgetHoldProgress = 0;
    this.#tickForgetHoldProgress();
    this.#forgetHoldTimeout = window.setTimeout(() => {
      this.#clearForgetHoldFrame();
      this.forgetHoldProgress = 1;
      this.#forgetHoldTimeout = window.setTimeout(() => {
        this.#suppressNextForgetClick = true;
        this.resetForgetHold();
        this.#deps.onForget();
      }, FORGET_HOLD_COMPLETION_DELAY_MS);
    }, this.#deps.getForgetHoldDurationMs());
  };

  cancelForgetHold = () => {
    if (!this.isHoldingForget) return;
    this.resetForgetHold();
  };

  handleForgetPointerDown = (event: PointerEvent) => {
    if (!this.#deps.isForgetHoldEnabled() || event.button !== 0) return;
    this.#beginForgetHold();
  };

  handleForgetKeyDown = (event: KeyboardEvent) => {
    if (
      !this.#deps.isForgetHoldEnabled() ||
      event.repeat ||
      (event.key !== ' ' && event.key !== 'Enter')
    ) {
      return;
    }
    event.preventDefault();
    this.#beginForgetHold();
  };

  handleForgetKeyUp = (event: KeyboardEvent) => {
    if (!this.#deps.isForgetHoldEnabled() || (event.key !== ' ' && event.key !== 'Enter')) return;
    event.preventDefault();
    this.cancelForgetHold();
  };

  handleForgetClick = () => {
    if (this.#suppressNextForgetClick) {
      this.#suppressNextForgetClick = false;
      return;
    }

    if (this.#deps.isForgetHoldEnabled()) {
      this.#openForgetConfirm();
      return;
    }

    this.#deps.onForget();
  };

  handleForgetShortcutKeyDown = (event: KeyboardEvent) => {
    if (!this.#deps.isForgetActionAvailable() || event.defaultPrevented) {
      return false;
    }

    if (!keyboardShortcutMatchesEvent(event, 'forgetCurrentNote')) {
      return false;
    }

    event.preventDefault();

    if (event.repeat) {
      return true;
    }

    if (!this.#deps.isForgetHoldEnabled()) {
      this.closeForgetConfirm();
      this.#deps.onForget();
      return true;
    }

    this.#forgetShortcutCode = event.code;
    this.#beginForgetHold();
    return true;
  };

  handleForgetShortcutKeyUp = (event: KeyboardEvent) => {
    if (this.#forgetShortcutCode === null || event.code !== this.#forgetShortcutCode) {
      return false;
    }

    event.preventDefault();
    const wasHolding = this.isHoldingForget;
    this.#forgetShortcutCode = null;

    if (!wasHolding) {
      return true;
    }

    this.#openForgetConfirm();
    return true;
  };

  handleForgetShortcutBlur = () => {
    if (this.#forgetShortcutCode === null) {
      return;
    }

    this.#forgetShortcutCode = null;
    this.cancelForgetHold();
  };

  getForgetButtonAriaLabel = () => {
    const binding = getKeyboardShortcutBinding('forgetCurrentNote');
    const shortcutSuffix = binding ? ` (${formatShortcutBinding(binding)})` : '';

    return this.#deps.isForgetHoldEnabled()
      ? `Forget this note. Hold the button or press to confirm.${shortcutSuffix}`
      : `Forget this note.${shortcutSuffix}`;
  };

  dispose = () => {
    this.closeForgetConfirm();
    this.resetForgetHold();
  };

  /** Snapshot for tests / non-reactive reads. */
  getSnapshot = (): NotepadCommandBarState => ({
    activeIndex: this.activeIndex,
    searchNavigationMode: this.searchNavigationMode,
    isHoldingForget: this.isHoldingForget,
    forgetHoldProgress: this.forgetHoldProgress,
    isForgetConfirmOpen: this.isForgetConfirmOpen
  });
}

export function createNotepadCommandBarState(deps: NotepadCommandBarStateDeps) {
  return new NotepadCommandBarController(deps);
}
