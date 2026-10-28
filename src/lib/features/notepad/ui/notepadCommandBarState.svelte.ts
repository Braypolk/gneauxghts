import { tick } from 'svelte';
import {
  formatKeyboardShortcutBindings,
  keyboardShortcutMatchesEvent,
  type KeyboardShortcutId
} from '#lib/keyboardShortcuts.svelte.js';
import {
  moveListSelection,
  pointListSelection,
  type ListNavigationMode
} from '#lib/ui/listSelection.js';
import type { ImageSearchItem, SearchItem } from '#lib/types/semantic.js';
import type { LocationHistoryEntry } from '#lib/features/notepad/navigation/locationMru.js';
import type { SearchMode } from '#lib/features/notepad/search/search.js';
import { hasSplitModifiers, hasSplitDiscoveryDestination } from '../navigation/splitNoteDestination';

export type NotepadCommandBarVisibleItem =
  | { kind: 'search'; item: SearchItem }
  | { kind: 'image'; item: ImageSearchItem }
  | { kind: 'pinned'; item: SearchItem }
  | { kind: 'location'; item: LocationHistoryEntry };

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
  getSearchMode: () => SearchMode;
  getSearchResults: () => SearchItem[];
  getSearchNavigationResults?: () => SearchItem[];
  /** Maps an occurrence to its row when current-note results are grouped. */
  getSearchResultRowIndex?: (result: SearchItem) => number;
  getPinnedNotes: () => SearchItem[];
  getRecentLocations: () => LocationHistoryEntry[];
  getVisibleItems: () => NotepadCommandBarVisibleItem[];
  getForgetHoldDurationMs: () => number;
  isForgetHoldEnabled: () => boolean;
  isForgetActionAvailable: () => boolean;
  getForgetItemLabel?: () => string;
  onSearchInput: (value: string) => void;
  onSearchClear?: () => void;
  onSearchSelect: (result: SearchItem) => void;
  getOpenInSplit?: () => ((item: SearchItem | LocationHistoryEntry) => void) | undefined;
  onBrowseModeFocus?: () => void;
  onSplitActionFocus?: (index: number) => void;
  onImageSelect?: (result: ImageSearchItem) => void;
  onSearchNavigate?: (result: SearchItem) => void | Promise<void>;
  onPinnedNoteSelect: (result: SearchItem) => void;
  onRecentLocationSelect: (entry: LocationHistoryEntry) => void;
  onRecentLocationShortcut: (index: number) => void | Promise<void>;
  closeSearch: () => void;
  /**
   * Dismissing search with no destination chosen should put the user back where
   * they were working, since browsing matches moved the editor selection.
   */
  onSearchDismiss?: () => void;
  /** A destination was chosen, so it owns focus from here on. */
  onSearchCommit?: () => void;
  onCommand?: (command: string) => boolean | Promise<boolean>;
  onForget: () => void;
}

const FORGET_HOLD_COMPLETION_DELAY_MS = 100;

export function deriveNotepadCommandBarVisibleItems(
  searchQuery: string,
  searchResults: SearchItem[],
  pinnedNotes: SearchItem[],
  recentLocations: LocationHistoryEntry[]
): NotepadCommandBarVisibleItem[] {
  if (searchQuery.trim() === '') {
    return [
      ...pinnedNotes.map((item) => ({ kind: 'pinned' as const, item })),
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
  #searchNavigationIndex: number | null = null;
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
    this.#searchNavigationIndex = null;
  };

  #closeSearchPanel = () => {
    this.resetActiveIndex();
    this.#deps.closeSearch();
  };

  openItemInSplit = (item: NotepadCommandBarVisibleItem): boolean => {
    const openInSplit = this.#deps.getOpenInSplit?.();
    if (!openInSplit || item.kind === 'image' || !hasSplitDiscoveryDestination(item.item)) return false;
    this.#deps.onSearchCommit?.();
    this.#closeSearchPanel();
    openInSplit(item.item);
    return true;
  };

  selectItem = (item: NotepadCommandBarVisibleItem, event?: Partial<Pick<MouseEvent, 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'>>) => {
    if (event && hasSplitModifiers(event) && this.openItemInSplit(item)) return;
    this.#deps.onSearchCommit?.();
    this.#closeSearchPanel();

    if (item.kind === 'image') {
      this.#deps.onImageSelect?.(item.item);
      return;
    }

    if (item.kind === 'pinned') {
      this.#deps.onPinnedNoteSelect(item.item);
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

  #previewSearchResult = (delta: 1 | -1, previewActive = false) => {
    const results = this.#deps.getSearchNavigationResults?.() ?? this.#deps.getSearchResults();
    if (this.#deps.getSearchQuery().trim() === '' || results.length === 0) {
      return;
    }

    const activeRow = this.#deps.getSearchResults()[this.activeIndex];
    const initialIndex = Math.max(0, results.indexOf(activeRow));
    // Enter previews the active row first. Later presses and the next/previous
    // buttons move through occurrences independently of grouped result rows.
    const index = previewActive && this.#searchNavigationIndex === null
      ? initialIndex
      : moveListSelection(
          { activeIndex: this.#searchNavigationIndex ?? initialIndex, navigationMode: this.searchNavigationMode },
          delta,
          { optionCount: results.length }
        ).activeIndex;
    this.#searchNavigationIndex = index;
    const result = results[index];
    this.activeIndex = Math.max(0, this.#deps.getSearchResultRowIndex?.(result)
      ?? this.#deps.getSearchResults().indexOf(result));
    this.searchNavigationMode = 'keyboard';
    void this.#deps.onSearchNavigate?.(result);
  };

  navigateSearchResult = (delta: 1 | -1) => this.#previewSearchResult(delta);

  #previewActiveSearchRow = () => {
    if (this.#deps.getSearchMode() !== 'current' || this.#deps.getSearchQuery().trim() === '') return;
    const item = this.#deps.getVisibleItems()[this.activeIndex];
    if (item?.kind !== 'search') return;
    const results = this.#deps.getSearchNavigationResults?.() ?? this.#deps.getSearchResults();
    const index = results.indexOf(item.item);
    if (index < 0) return;
    this.#searchNavigationIndex = index;
    void this.#deps.onSearchNavigate?.(item.item);
  };

  handleSearchKeydown = (event: KeyboardEvent) => {
    if (event.defaultPrevented) return;
    if (this.#handleRecentItemShortcut(event)) {
      return;
    }

    const items = this.#deps.getVisibleItems();

    if (keyboardShortcutMatchesEvent(event, 'searchOpenInSplit')) {
      const item = items[this.activeIndex] ?? items[0];
      if (item && this.openItemInSplit(item)) { event.preventDefault(); return; }
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      if (this.#deps.getSearchQuery().trim() !== '') {
        if (this.#deps.onSearchClear) this.#deps.onSearchClear();
        else this.#deps.onSearchInput('');
        return;
      }

      // Restore before closing: closing the panel blurs the input and reports
      // the dismissal, which drops the remembered location.
      this.#deps.onSearchDismiss?.();
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

    const plainArrow = !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
    if (plainArrow && event.key === 'ArrowUp' && this.activeIndex === 0
      && this.#deps.getSearchQuery().trim() === '' && this.#deps.onBrowseModeFocus) {
      event.preventDefault();
      this.searchNavigationMode = 'keyboard';
      this.#deps.onBrowseModeFocus();
      return;
    }

    if (plainArrow && event.key === 'ArrowRight' && this.#deps.onSplitActionFocus
      && (this.#deps.getSearchQuery().trim() === '' || this.searchNavigationMode === 'keyboard')) {
      const item = items[this.activeIndex];
      if (item && item.kind !== 'image' && this.#deps.getOpenInSplit?.() && hasSplitDiscoveryDestination(item.item)) {
        event.preventDefault();
        this.searchNavigationMode = 'keyboard';
        this.#deps.onSplitActionFocus(this.activeIndex);
        return;
      }
    }

    if (items.length === 0) {
      return;
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const nextSelection = moveListSelection(
        { activeIndex: this.activeIndex, navigationMode: this.searchNavigationMode },
        event.key === 'ArrowDown' ? 1 : -1,
        { optionCount: items.length }
      );
      this.activeIndex = nextSelection.activeIndex;
      this.searchNavigationMode = nextSelection.navigationMode;
      this.#searchNavigationIndex = null;
      this.#previewActiveSearchRow();
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      const item = items[this.activeIndex] ?? items[0];
      if (this.#deps.getSearchMode() === 'current' && this.#deps.getSearchQuery().trim() !== '') {
        this.#previewSearchResult(event.shiftKey ? -1 : 1, !event.shiftKey);
        return;
      }
      this.selectItem(item);
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
    this.#searchNavigationIndex = null;
    this.#previewActiveSearchRow();
  };

  handleSearchItemFocus = (index: number) => {
    this.handleSearchItemPointerEnter(index);
    this.searchNavigationMode = 'keyboard';
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
    const binding = formatKeyboardShortcutBindings('forgetCurrentNote');
    const shortcutSuffix = binding ? ` (${binding})` : '';
    const itemLabel = this.#deps.getForgetItemLabel?.() ?? 'note';

    return this.#deps.isForgetHoldEnabled()
      ? `Forget this ${itemLabel}. Hold the button or press to confirm.${shortcutSuffix}`
      : `Forget this ${itemLabel}.${shortcutSuffix}`;
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
