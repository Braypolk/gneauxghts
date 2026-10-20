<script lang="ts">
  import RelatedResults from '../related/RelatedResults.svelte';
  import WorkspaceInputDock from './WorkspaceInputDock.svelte';
  import SearchResultsPanel from './SearchResultsPanel.svelte';
  import SearchResultsHeading from '$lib/ui/search/SearchResultsHeading.svelte';
  import SearchNoteResult from '$lib/ui/search/SearchNoteResult.svelte';
  import type { DockActionPresentation } from './workspaceDockPresentation';
  import { ramp as dockRamp } from '$lib/ui/morphing-containers/motion';
  import { onDestroy, tick, untrack } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { rankMediaResults } from '../search/mediaRanking';
  import ImageSearchResult from '../search/ImageSearchResult.svelte';
  import { createImageAssetLoader } from '../images/imageAssetLoader';
  import {
    Eraser,
    Undo2,
    SquarePen,
    MessagesSquare,
    Pin,
    PinOff,
  } from '@lucide/svelte';
  import {
    appSettings,
    resolveForgetButtonDurationMs
  } from '$lib/appSettings.svelte';
  import {
    buildHighlightedSegments,
    createNotepadCommandBarState,
    deriveNotepadCommandBarVisibleItems,
    type NotepadCommandBarVisibleItem
  } from '$lib/features/notepad/ui/notepadCommandBarState.svelte';
  import type {
    NotepadCommandBarForgetProps,
    NotepadCommandBarRememberProps,
    NotepadCommandBarSearchProps,
    NotepadCommandBarRelatedProps
  } from '$lib/features/notepad/ui/notepadCommandBarProps';
  import SearchBar, {
    type SearchBarHandle,
    type SearchChoice
  } from '$lib/ui/search/SearchBar.svelte';
  import '$lib/ui/search/searchDock.css';
  import type { ImageSearchItem, SearchItem } from '$lib/types/semantic';
  import type { LocationHistoryEntry } from '$lib/features/notepad/navigation/locationMru';

  interface Props {
    forget: NotepadCommandBarForgetProps;
    remember: NotepadCommandBarRememberProps;
    search: NotepadCommandBarSearchProps;
    related?: NotepadCommandBarRelatedProps;
    chatAvailable?: boolean;
    dockMode?: 'search' | 'chat';
    chatSlot?: HTMLDivElement | null;
    onDockModeChange?: (mode: 'search' | 'chat') => void;
    onExpandChat?: () => void;
  }

  let {
    forget,
    remember,
    search,
    related,
    chatAvailable = false,
    dockMode = 'search',
    chatSlot = $bindable(null),
    onDockModeChange,
    onExpandChat
  }: Props = $props();

  const relatedPopupId = $props.id();
  let relatedMode = $state(false);
  let panelOpen = $state(false);
  let relatedIndex = $state(0);
  let relatedHeader = $state<HTMLButtonElement | null>(null);
  let openedRelatedKey: string | null = null;

  function closeRelated(restore = false) {
    if (restore) onSearchDismiss?.();
    searchBar?.closeSearch();
  }
  function showSearch() {
    if (relatedMode) { relatedMode = false; related?.onClose(); }
  }
  export function toggleRelated() {
    if (!related?.contextKey) return;
    if (relatedMode) { closeRelated(true); return; }
    openedRelatedKey = related.contextKey;
    relatedMode = true;
    relatedIndex = 0;
    related.onOpen();
    searchBar?.openPanel();
    void tick().then(() => relatedHeader?.focus({ preventScroll: true }));
  }
  $effect(() => {
    const key = related?.contextKey;
    if (relatedMode && key !== openedRelatedKey) closeRelated();
  });
  function handleRelatedKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation(); closeRelated(true);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const count = related?.result?.items.length ?? 0;
      if (count) {
        relatedIndex = (relatedIndex + (event.key === 'ArrowDown' ? 1 : -1) + count) % count;
        const moveFocus = event.target !== relatedHeader;
        void tick().then(() => {
          const row = relatedHeader?.closest('.workspace-input-dock')
            ?.querySelector<HTMLElement>('[data-search-result-active="true"]');
          if (moveFocus) row?.focus({ preventScroll: true });
          row?.scrollIntoView({ block: 'nearest' });
        });
      }
    } else if (event.key === 'Enter' && event.target === relatedHeader) {
      event.preventDefault();
      const item = related?.result?.items[relatedIndex];
      if (item) selectRelated(item);
    }
  }
  function selectRelated(item: import('$lib/types/semantic').RelatedNoteItem) {
    onSearchCommit?.();
    searchBar?.closeSearch();
    related?.onSelect(item);
  }

  const canUnforget = $derived(forget.canUnforget);
  const canForget = $derived(forget.canForget ?? true);
  const forgetItemLabel = $derived(forget.itemLabel ?? 'note');
  const onForget = $derived(forget.onForget);
  const onUnforget = $derived(forget.onUnforget);

  const onRemember = $derived(remember.onRemember);
  const rememberLabel = $derived(remember.label ?? 'New Idea');
  const rememberAriaLabel = $derived(
    remember.ariaLabel ?? `${rememberLabel}. Start a blank note.`
  );

  const searchMode = $derived(search.searchMode);
  const imageResults = $derived(search.imageResults ?? []);
  const imageQueryUrl = $derived(search.imageQueryUrl ?? null);
  const thumbnails = createImageAssetLoader(key => {
    const [fileName, assetHash] = JSON.parse(key) as [string, string];
    return invoke<string>('read_image_search_thumbnail', { fileName, assetHash });
  }, () => 'running-vault', undefined, { entries: 24, bytes: 6 * 1024 * 1024 });
  onDestroy(() => thumbnails.destroy());
  function loadThumbnail(item: ImageSearchItem) {
    return thumbnails.load(JSON.stringify([item.assetName, item.assetHash]));
  }
  function chooseImage(file: File) { searchBar?.focusSearch(); void search.onQueryImage?.(file); }
  const searchQuery = $derived(search.searchQuery);
  const matchCase = $derived(search.matchCase);
  const matchWholeWord = $derived(search.matchWholeWord);
  const searchResults = $derived(search.searchResults);
  const pinnedNotes = $derived(search.pinnedNotes);
  const recentLocations = $derived(search.recentLocations);
  const isSearching = $derived(search.isSearching);
  const onSearchInput = $derived(search.onSearchInput);
  const onSearchClear = $derived(search.onSearchClear);
  const onSearchModeChange = $derived(search.onSearchModeChange);
  const onMatchCaseChange = $derived(search.onMatchCaseChange);
  const onMatchWholeWordChange = $derived(search.onMatchWholeWordChange);
  const onSearchSelect = $derived(search.onSearchSelect);
  const onSearchNavigate = $derived(search.onSearchNavigate);
  const onPinnedNoteSelect = $derived(search.onPinnedNoteSelect);
  const onSetNotePinned = $derived(search.onSetNotePinned);
  const onRecentLocationSelect = $derived(search.onRecentLocationSelect);
  const onRecentLocationShortcut = $derived(search.onRecentLocationShortcut);
  const onSearchOpen = $derived(search.onSearchOpen);
  const onSearchDismiss = $derived(search.onSearchDismiss);
  const onSearchCommit = $derived(search.onSearchCommit);
  const onCommand = $derived(search.onCommand);
  const searchScopeTitle = $derived(
    searchMode === 'current'
      ? 'Searching only the current note'
      : 'Searching across all notes'
  );
  const searchScopeOptions = [
    {
      id: 'current',
      label: 'This note',
      ariaLabel: 'Search this note only',
      title: 'Search this note only'
    },
    {
      id: 'all',
      label: 'All notes',
      shortLabel: 'All notes',
      ariaLabel: 'Search all notes',
      title: 'Search all notes',
      tone: 'all'
    }
  ] satisfies SearchChoice[];

  let searchBar = $state<SearchBarHandle | null>(null);
  let actionPresentation = $state<DockActionPresentation>({ running: false, progress: 1 });
  let previousRememberLabel = $state(untrack(() => rememberLabel));
  const outgoingRememberLabel = $derived(previousRememberLabel !== rememberLabel ? previousRememberLabel : null);
  const rememberLabelPrefix = $derived(rememberLabel.startsWith('New ')
    && (!outgoingRememberLabel || outgoingRememberLabel.startsWith('New ')) ? 'New ' : '');
  $effect(() => {
    const running = actionPresentation.running;
    untrack(() => {
      if (!running) previousRememberLabel = rememberLabel;
    });
  });
  $effect(() => {
    const label = rememberLabel;
    // A pane-owner change can update the label without requesting a morph.
    // Wait for this render's dock request before accepting it as settled.
    void tick().then(() => {
      if (!actionPresentation.running) previousRememberLabel = label;
    });
  });
  let searchResultsViewport = $state<HTMLDivElement | null>(null);
  let forgetButton = $state<HTMLButtonElement | null>(null);
  let forgetCancelButton = $state<HTMLButtonElement | null>(null);
  let forgetHoldDurationMs = $derived(resolveForgetButtonDurationMs(appSettings.forgetButtonDurationPreference));
  let isForgetHoldEnabled = $derived(forgetHoldDurationMs > 0);
  const visibleSearchResults = $derived.by<SearchItem[]>(() =>
    searchMode === 'current' ? dedupeCurrentSearchResults(searchResults) : searchResults
  );
  const visibleItems = $derived.by<NotepadCommandBarVisibleItem[]>(() =>
    searchMode === 'all' && (searchQuery.trim() !== '' || imageQueryUrl)
      ? rankMediaResults(visibleSearchResults, imageResults).map(item => item.kind === 'image'
          ? { kind: 'image' as const, item }
          : { kind: 'search' as const, item })
      : deriveNotepadCommandBarVisibleItems(searchQuery, visibleSearchResults, pinnedNotes, recentLocations)
  );
  const hasRecentContent = $derived(pinnedNotes.length > 0 || recentLocations.length > 0);
  const hasVisibleSearchContent = $derived(
    searchQuery.trim() === '' && !imageQueryUrl ? hasRecentContent : visibleItems.length > 0
  );
  const canNavigateCurrentSearchResults = $derived(
    searchMode === 'current' && searchQuery.trim() !== '' && searchResults.length > 0
  );

  const commandBarState = createNotepadCommandBarState({
    getSearchQuery: () => imageQueryUrl ? "image query" : searchQuery,
    getSearchMode: () => searchMode,
    getSearchResults: () => visibleSearchResults,
    getSearchNavigationResults: () => (searchMode === 'current' ? searchResults : visibleSearchResults),
    getSearchResultRowIndex: (result) => visibleSearchResults.findIndex(item =>
      searchMode === 'current'
        ? getCurrentSearchResultKey(item) === getCurrentSearchResultKey(result)
        : item === result),
    getPinnedNotes: () => pinnedNotes,
    getRecentLocations: () => recentLocations,
    getVisibleItems: () => visibleItems,
    getForgetHoldDurationMs: () => forgetHoldDurationMs,
    isForgetHoldEnabled: () => isForgetHoldEnabled,
    isForgetActionAvailable: () => canForget && !canUnforget,
    getForgetItemLabel: () => forgetItemLabel,
    onSearchInput: (value) => onSearchInput(value),
    onSearchClear: () => {
      if (search.onSearchClear) search.onSearchClear();
      else onSearchInput('');
    },
    onSearchSelect: (result) => onSearchSelect(result),
    onImageSelect: (result) => { void search.onImageSelect?.(result); },
    onSearchNavigate: (result) => onSearchNavigate?.(result),
    onPinnedNoteSelect: (result) => onPinnedNoteSelect(result),
    onRecentLocationSelect: (entry) => onRecentLocationSelect(entry),
    onRecentLocationShortcut: (index) => onRecentLocationShortcut(index),
    closeSearch: () => searchBar?.closeSearch(),
    onSearchDismiss: () => onSearchDismiss?.(),
    onSearchCommit: () => onSearchCommit?.(),
    onCommand: (command) => onCommand?.(command) ?? false,
    onForget: () => onForget()
  });

  // Track only the materially distinguishing fingerprint of the visible
  // items so transient writable-store flips (e.g. isSearching toggling on a
  // keystroke that hasn't changed results yet) do not reset activeIndex.
  const visibleItemsFingerprint = $derived(
    JSON.stringify(visibleItems.map(entry => entry.kind === 'location'
      ? [entry.kind, entry.item.location, entry.item.label]
      : entry.kind === 'image'
        ? [entry.kind, entry.item.notePath, entry.item.sourceStart, entry.item.assetHash]
        : [entry.kind, entry.item.notePath, entry.item.sectionLabel, entry.item.matchText]))
  );

  const currentSearchRangesFingerprint = $derived(searchMode === 'current'
    ? JSON.stringify(searchResults.map(item => item.currentMatchRange)) : '');

  $effect(() => {
    visibleItemsFingerprint;
    searchMode;
    searchQuery;
    // Occurrences may change while the grouped row text stays the same.
    currentSearchRangesFingerprint;
    commandBarState.resetActiveIndex();
  });

  $effect(() => {
    canUnforget;
    if (canUnforget) {
      commandBarState.resetForgetHold();
    }
  });

  $effect(() => {
    canForget;
    forgetItemLabel;
    // Reset when the action changes, without subscribing to the dialog state
    // read by closeForgetConfirm and closing it again as soon as it opens.
    untrack(() => {
      commandBarState.closeForgetConfirm();
      commandBarState.resetForgetHold();
    });
  });

  $effect(() => {
    appSettings.forgetButtonDurationPreference;
    commandBarState.resetForgetHold();
  });

  $effect(() => {
    if (!commandBarState.isForgetConfirmOpen) {
      return;
    }

    void tick().then(() => {
      forgetCancelButton?.focus();
    });
  });

  $effect(() => {
    commandBarState.activeIndex;
    visibleItems;
    void commandBarState.syncActiveItemIntoView();
  });

  $effect(() => {
    commandBarState.bindSearchResultsViewport(searchResultsViewport);
  });

  $effect(() => {
    if (chatAvailable && dockMode === 'chat') searchBar?.closeSearch();
  });

  function handleSharedSearchOpen() {
    onDockModeChange?.('search');
    commandBarState.resetActiveIndex();
    onSearchOpen();
  }

  function handleSharedSearchModeChange(mode: string) {
    if (mode !== 'current' && mode !== 'all') return;
    return onSearchModeChange(mode);
  }

  onDestroy(() => {
    commandBarState.dispose();
  });

  function getRecentNotesViewportClass() {
    return 'h-[13.75rem] overflow-y-auto';
  }

  function locationHistoryKey(item: LocationHistoryEntry, index: number) {
    if (item.location.kind === 'chat') {
      return `chat-${item.location.conversationId ?? 'slot'}`;
    }
    return `note-${item.location.notePath ?? item.location.noteId ?? 'current'}-${index}`;
  }

  function getSearchResultItemClass(mode: 'current' | 'all') {
    return mode === 'current'
      ? 'search-result-item grid min-h-10 w-full grid-cols-[minmax(0,1fr)_max-content] items-center gap-3 rounded-[0.9rem] px-3 py-2 text-left transition-colors'
      : 'search-result-item flex w-full flex-col gap-2 rounded-[1.1rem] px-4 py-3 text-left transition-colors';
  }

  function getSearchResultTitleClass() {
    return 'block truncate text-sm font-semibold text-popover-foreground';
  }

  function getSearchResultHeaderClass() {
    return 'flex w-full min-w-0 items-start justify-between gap-3';
  }

  function getExcerptClass() {
    return 'line-clamp-3 text-sm leading-relaxed text-muted-foreground';
  }

  function getCurrentSearchLocationLabel(item: SearchItem) {
    if (item.sectionLabel === 'Title') {
      return 'Title';
    }

    if (item.startLine !== null) {
      return `Line ${item.startLine}`;
    }

    return item.sectionLabel;
  }

  function getCurrentSearchPreviewText(item: SearchItem) {
    const normalizedQuery = normalizeSearchText(searchQuery.trim());
    const excerpt = item.excerpt.trim();

    if (normalizedQuery === '' || normalizeSearchText(excerpt).includes(normalizedQuery)) {
      return excerpt;
    }

    return item.matchText.trim() || excerpt;
  }

  function getCurrentSearchPreviewSegments(item: SearchItem) {
    const previewText = getCurrentSearchPreviewText(item);
    const trimmedQuery = searchQuery.trim();

    if (previewText === item.excerpt.trim() && item.highlightRanges.length > 0) {
      return buildHighlightedSegments(...cropTextAroundRanges(item.excerpt, item.highlightRanges, 130, 24));
    }

    if (trimmedQuery === '') {
      return [{ text: previewText, highlighted: false }];
    }

    const previewLower = normalizeSearchText(previewText);
    const queryLower = normalizeSearchText(trimmedQuery);
    const ranges: Array<{ start: number; end: number }> = [];
    let cursor = previewLower.indexOf(queryLower);

    while (cursor !== -1) {
      const end = cursor + trimmedQuery.length;
      if (!matchWholeWord || isWholeWordSearchMatch(previewText, cursor, end)) {
        ranges.push({ start: cursor, end });
      }
      cursor = previewLower.indexOf(queryLower, cursor + trimmedQuery.length);
    }

    return buildHighlightedSegments(previewText, ranges);
  }

  function normalizeSearchText(text: string) {
    return matchCase ? text : text.toLowerCase();
  }

  function isWholeWordSearchMatch(text: string, from: number, to: number) {
    const before = from > 0 ? text[from - 1] : '';
    const after = to < text.length ? text[to] : '';
    return !/\p{L}|\p{N}|_/u.test(before) && !/\p{L}|\p{N}|_/u.test(after);
  }

  function dedupeCurrentSearchResults(results: SearchItem[]) {
    const seen = new Set<string>();
    return results.filter((item) => {
      const key = getCurrentSearchResultKey(item);
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  function getCurrentSearchResultKey(item: SearchItem) {
    const [previewText] = getCurrentSearchPreviewCrop(item);
    return `${item.sectionLabel}|${previewText}`;
  }

  function getCurrentSearchPreviewCrop(item: SearchItem) {
    const previewText = getCurrentSearchPreviewText(item);
    if (previewText === item.excerpt.trim() && item.highlightRanges.length > 0) {
      return cropTextAroundRanges(item.excerpt, item.highlightRanges, 130, 24);
    }
    return [previewText, []] as [string, Array<{ start: number; end: number }>];
  }

  function cropTextAroundRanges(
    text: string,
    ranges: Array<{ start: number; end: number }>,
    maxChars: number,
    leadingContextChars: number
  ): [string, Array<{ start: number; end: number }>] {
    const characters = Array.from(text);
    const firstRange = ranges[0];

    if (!firstRange || characters.length <= maxChars) {
      return [text, ranges];
    }

    const rangeStart = Math.max(0, Math.min(firstRange.start, characters.length));
    const rangeEnd = Math.max(rangeStart, Math.min(firstRange.end, characters.length));
    let start = Math.max(0, rangeStart - leadingContextChars);
    let end = Math.min(characters.length, start + maxChars);

    if (rangeEnd > end) {
      end = Math.min(characters.length, rangeEnd + leadingContextChars);
      start = Math.max(0, end - maxChars);
    }

    const prefix = start > 0 ? '…' : '';
    const suffix = end < characters.length ? '…' : '';
    const cropped = `${prefix}${characters.slice(start, end).join('')}${suffix}`;
    const prefixLength = prefix.length;
    const adjustedRanges = ranges
      .filter((range) => range.end > start && range.start < end)
      .map((range) => ({
        start: Math.max(0, range.start - start) + prefixLength,
        end: Math.min(end, range.end) - start + prefixLength
      }));

    return [cropped, adjustedRanges];
  }

  function handleRemember() {
    onRemember();
  }

  function closeForgetConfirm(restoreFocusToForgetButton = false) {
    commandBarState.closeForgetConfirm();
    void tick().then(() => {
      if (restoreFocusToForgetButton) {
        forgetButton?.focus();
        return;
      }

      forgetButton?.blur();
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
    });
  }

  function handleForgetConfirmKeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape') {
      return;
    }

    event.preventDefault();
    closeForgetConfirm();
  }
</script>

<svelte:window
  onkeydowncapture={commandBarState.handleForgetShortcutKeyDown}
  onkeyupcapture={commandBarState.handleForgetShortcutKeyUp}
  onblur={commandBarState.handleForgetShortcutBlur}
/>

<div
  data-notepad-command-bar
  class="pointer-events-auto relative min-w-0 overflow-visible rounded-none shadow-none sm:rounded-2xl sm:shadow-lg"
>
  <div
    class="absolute inset-0 rounded-none bg-card/58 backdrop-blur-sm sm:rounded-2xl"
    style="mask-image: linear-gradient(to bottom, transparent 0%, black 40%, black 100%); -webkit-mask-image: linear-gradient(to bottom, transparent 0%, black 40%, black 100%); mask-size: 100% 100%; -webkit-mask-size: 100% 100%;"
  ></div>
  <div class="search-dock-row notepad-command-bar-content relative z-10 flex min-w-0 items-center justify-between gap-1.5 px-2.5 sm:gap-4 sm:px-6"
    class:notepad-command-bar-content--chat={chatAvailable}>
    <div
      class={`relative inline-flex shrink-0 items-center rounded-full border p-1 shadow-sm ${
        canUnforget ? 'bg-secondary text-secondary-foreground' : 'bg-background text-muted-foreground'
      } ${commandBarState.isHoldingForget ? 'border-destructive/70' : 'border-border'}`}
    >
      {#if canUnforget}
        <button
          type="button"
          class="notepad-command-action mobile-touch-target inline-flex h-8 w-8 items-center justify-center rounded-full p-0 font-medium transition-colors hover:bg-accent sm:h-11 sm:w-auto sm:min-w-[126px] sm:px-5"
          onclick={() => onUnforget()}
          aria-label={`Restore the last forgotten ${forgetItemLabel}`}
          title={`Restore forgotten ${forgetItemLabel}`}
        >
          <span class="notepad-command-action-label hidden sm:inline">unForget</span>
          <Undo2 class="h-5 w-5 sm:hidden" />
        </button>
      {:else}
        {#if commandBarState.isForgetConfirmOpen}
          <div
            id="forget-confirm-popover"
            class="absolute bottom-[calc(100%+0.75rem)] left-0 z-40 w-[min(18rem,calc(100vw-1.5rem))] rounded-[1.2rem] border border-border bg-popover/95 p-3 text-popover-foreground shadow-xl backdrop-blur-md"
            role="dialog"
            aria-modal="false"
            aria-labelledby="forget-confirm-title"
            aria-describedby="forget-confirm-description"
            tabindex="-1"
            onkeydown={handleForgetConfirmKeydown}
          >
            <div class="flex items-start gap-3">
              <div class="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-destructive/12 text-destructive">
                <Eraser class="h-4 w-4" />
              </div>
              <div class="min-w-0 flex-1">
                <p id="forget-confirm-title" class="text-sm font-semibold">Forget this {forgetItemLabel}?</p>
                <p id="forget-confirm-description" class="mt-1 text-xs leading-5 text-muted-foreground">
                  You can also hold Forget (or its shortcut) to skip this confirmation.
                </p>
              </div>
            </div>
            <div class="mt-3 flex justify-end gap-2">
              <button
                bind:this={forgetCancelButton}
                type="button"
                class="inline-flex h-8 items-center rounded-full px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                onclick={() => closeForgetConfirm(true)}
                title="Keep this note"
              >
                Cancel
              </button>
              <button
                type="button"
                class="inline-flex h-8 items-center rounded-full bg-destructive px-3 text-xs font-semibold text-destructive-foreground transition-colors hover:bg-destructive/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-destructive"
                onclick={commandBarState.confirmForget}
                title={`Forget this ${forgetItemLabel}`}
              >
                Forget
              </button>
            </div>
          </div>
        {/if}
        <button
          bind:this={forgetButton}
          type="button"
          disabled={!canForget}
          aria-expanded={commandBarState.isForgetConfirmOpen}
          aria-controls={commandBarState.isForgetConfirmOpen ? 'forget-confirm-popover' : undefined}
          class={`notepad-command-action mobile-touch-target relative isolate inline-flex h-8 w-8 items-center justify-center overflow-hidden rounded-full p-0 font-medium transition-colors hover:bg-destructive/20 hover:text-destructive active:bg-destructive/15 active:text-destructive focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-destructive disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-inherit sm:h-11 sm:w-auto sm:min-w-[126px] sm:px-5 ${
            commandBarState.isHoldingForget
              ? 'forget-hold-animation text-destructive'
              : ''
          }`}
          style={`--forget-progress: ${commandBarState.forgetHoldProgress};`}
          aria-label={commandBarState.getForgetButtonAriaLabel()}
          title={commandBarState.getForgetButtonAriaLabel()}
          onclick={commandBarState.handleForgetClick}
          onpointerdown={commandBarState.handleForgetPointerDown}
          onpointerup={commandBarState.cancelForgetHold}
          onpointerleave={commandBarState.cancelForgetHold}
          onpointercancel={commandBarState.cancelForgetHold}
          onkeydown={commandBarState.handleForgetKeyDown}
          onkeyup={commandBarState.handleForgetKeyUp}
        >
          <span
            class="absolute inset-0 z-0 origin-left rounded-[inherit] bg-destructive/55"
            style="transform: scaleX(var(--forget-progress, 0)); opacity: calc(0.14 + (var(--forget-progress, 0) * 0.58));"
            aria-hidden="true"
          ></span>
          <span class="notepad-command-action-label relative z-10 hidden sm:inline">
            Forget
          </span>
          <Eraser
            class={`relative z-10 h-5 w-5 transition-transform duration-200 sm:hidden ${
              commandBarState.isHoldingForget ? '-translate-y-px' : ''
            }`}
          />
        </button>
      {/if}
    </div>

    {#snippet relatedInput()}
      <div class="related-search-heading flex w-full min-w-0 items-center" role="group" aria-label="Related note controls">
        <button bind:this={relatedHeader} onkeydown={handleRelatedKeydown} type="button" class="min-w-0 flex-1 truncate rounded py-1.5 text-left text-base text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring min-[700px]:text-sm sm:py-2" aria-label={`Related to ${related?.title || 'this note'}`}>
          Related to {related?.title || 'this note'}
        </button>
      </div>
    {/snippet}

    {#snippet searchPanel()}
      {#key relatedMode ? false : isSearching}
        <SearchResultsPanel navigationMode={commandBarState.searchNavigationMode}>
          {#if relatedMode}
            <div id={relatedPopupId} class="max-h-80 overflow-y-auto" onkeydown={handleRelatedKeydown} role="dialog" tabindex="-1" aria-label="Related notes">
              <RelatedResults result={related?.result ?? null} activeIndex={relatedIndex} onSelect={selectRelated} onPoint={(index) => relatedIndex = index} onRefresh={() => related?.onRefresh()} />
            </div>
          {:else}
          {#if search.mediaError}<p class="px-3 py-2 text-xs text-muted-foreground" role="status">{search.mediaError}</p>{/if}
          {#if isSearching && (searchQuery.trim() !== '' || imageQueryUrl)}
            <div class="px-4 py-3 text-sm text-muted-foreground">Searching notes…</div>
          {:else if imageQueryUrl && visibleItems.length === 0}
            {#if !isSearching}<p class="px-3 py-2 text-sm text-muted-foreground">No matching images or text passages yet.</p>{/if}
          {:else if !hasVisibleSearchContent}
            <div class="px-4 py-3 text-sm text-muted-foreground">
              {#if searchQuery.trim() === ''}
                Start typing to search {searchMode === 'current' ? 'this note' : 'all notes'}.
              {:else}
                No matches in {searchMode === 'current' ? 'this note' : 'all notes'}. Try {searchMode === 'current' ? 'All notes' : 'This note'}.
              {/if}
            </div>
          {:else if searchQuery.trim() === '' && !imageQueryUrl}
            <div
              bind:this={searchResultsViewport}
              class="flex flex-col gap-3 lg:flex-row lg:items-stretch lg:gap-0"
            >
              {#if pinnedNotes.length > 0}
                <section
                  class={`min-w-0 flex-1 lg:order-2 ${
                    recentLocations.length > 0
                      ? 'border-b border-border/70 pb-2 lg:border-b-0 lg:border-l lg:border-border/70 lg:pb-0 lg:pl-3'
                      : ''
                  }`}
                >
                  <SearchResultsHeading title="Pinned" />
                  <div class={getRecentNotesViewportClass()}>
                    {#each pinnedNotes as item, index (`pinned-${item.noteId ?? item.notePath}-${index}`)}
                      <div class="group flex items-center gap-1">
                        <SearchNoteResult title={item.fileName} label={`Open pinned note: ${item.fileName}`}
                          active={index === commandBarState.activeIndex}
                          onPoint={() => commandBarState.handleSearchItemPointerEnter(index)}
                          onSelect={() => commandBarState.selectItem({ kind: 'pinned', item })}>
                          {#snippet icon()}<Pin class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />{/snippet}
                        </SearchNoteResult>
                        <button
                          type="button"
                          class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground opacity-70 transition hover:bg-accent hover:text-foreground sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
                          aria-label={`Unpin ${item.fileName}`}
                          title={`Unpin ${item.fileName}`}
                          data-search-focus-independent
                          onmousedown={(event) => event.preventDefault()}
                          onclick={() => item.noteId && void onSetNotePinned(item.noteId, false)}
                        >
                          <PinOff class="h-3.5 w-3.5" />
                        </button>
                      </div>
                      {/each}
                  </div>
                </section>
              {/if}

              {#if recentLocations.length > 0}
                <section class="min-w-0 flex-1 lg:order-1 lg:pr-3">
                  <SearchResultsHeading title="Recent" />
                  <div class={getRecentNotesViewportClass()}>
                    {#each recentLocations as item, index (locationHistoryKey(item, index))}
                      {@const globalIndex = pinnedNotes.length + index}
                      <SearchNoteResult title={item.label}
                        label={`Open recent ${item.location.kind === 'chat' ? 'thought partner' : 'note'}: ${item.label}`}
                        active={globalIndex === commandBarState.activeIndex}
                        onPoint={() => commandBarState.handleSearchItemPointerEnter(globalIndex)}
                        onSelect={() => commandBarState.selectItem({ kind: 'location', item })}>
                        {#snippet icon()}{#if item.location.kind === 'chat'}<MessagesSquare class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />{/if}{/snippet}
                      </SearchNoteResult>
                    {/each}
                  </div>
                </section>
              {/if}
            </div>
          {:else}
            <div bind:this={searchResultsViewport} class="max-h-80 overflow-y-auto">
              {#each visibleItems as entry, index (index)}
                {#if entry.kind === 'image'}
                  <ImageSearchResult item={entry.item} load={loadThumbnail}
                    active={index === commandBarState.activeIndex}
                    onPointerEnter={() => commandBarState.handleSearchItemPointerEnter(index)}
                    onSelect={() => commandBarState.selectItem(entry)} />
                {:else if entry.kind === 'search'}
                {@const item = entry.item}
                <button
                  type="button"
                  data-search-result-active={index === commandBarState.activeIndex ? 'true' : 'false'}
                  class={getSearchResultItemClass(searchMode)}
                  class:bg-accent={index === commandBarState.activeIndex}
                  aria-label={`Open search result: ${searchMode !== 'current' ? item.fileName : item.sectionLabel}`}
                  title={searchMode !== 'current' ? item.fileName : item.sectionLabel}
                  onmousedown={(event) => event.preventDefault()}
                  onpointerenter={() => commandBarState.handleSearchItemPointerEnter(index)}
                  onclick={() => commandBarState.selectItem({ kind: 'search', item })}
                >
                  {#if searchMode === 'current'}
                    <p class="min-w-0 truncate text-sm leading-5 text-muted-foreground">
                      {#each getCurrentSearchPreviewSegments(item) as segment, segmentIndex (`${segment.text}-${segment.highlighted}-${segmentIndex}`)}
                        {#if segment.highlighted}
                          <mark class="rounded-[0.3rem] bg-accent px-[0.1rem] text-foreground">{segment.text}</mark>
                        {:else}
                          <span>{segment.text}</span>
                        {/if}
                      {/each}
                    </p>
                    <span class="min-w-0 max-w-36 truncate text-right text-xs font-semibold text-popover-foreground">
                      {getCurrentSearchLocationLabel(item)}
                    </span>
                  {:else}
                    <div class={getSearchResultHeaderClass()}>
                      <div class="min-w-0 flex-1">
                        <span class={getSearchResultTitleClass()}>
                          {item.fileName}
                        </span>
                        {#if item.reasonLabels && item.reasonLabels.length > 0}
                          <div class="mt-1 flex flex-wrap gap-1.5">
                            {#each item.reasonLabels as label, labelIndex (`${label}-${labelIndex}`)}
                              <span class="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                                {label}
                              </span>
                            {/each}
                          </div>
                        {/if}
                      </div>
                      {#if item.sectionLabel !== 'Title'}
                        <span class="min-w-0 max-w-[45%] truncate text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground" title={item.sectionLabel}>
                          {item.sectionLabel}
                        </span>
                      {/if}
                    </div>
                    <p class={getExcerptClass()}>
                      {#each buildHighlightedSegments(item.excerpt, item.highlightRanges) as segment, segmentIndex (`${segment.text}-${segment.highlighted}-${segmentIndex}`)}
                        {#if segment.highlighted}
                          <mark class="rounded-[0.35rem] bg-accent px-[0.1rem] text-foreground">{segment.text}</mark>
                        {:else}
                          <span>{segment.text}</span>
                        {/if}
                      {/each}
                    </p>
                  {/if}
                </button>
                {/if}
              {/each}
            </div>
          {/if}
          {/if}
        </SearchResultsPanel>
      {/key}
    {/snippet}

    {#snippet imageQueryPreview()}
      <img src={imageQueryUrl} alt="Search query"
        class="h-8 w-10 shrink-0 rounded-md border border-border/60 bg-card object-cover" />
    {/snippet}

    {#snippet dockPopup()}{#if panelOpen}{@render searchPanel()}{/if}{/snippet}

    <div class="notepad-discovery-dock flex min-w-0 flex-1 items-end gap-2 sm:gap-3">
    <WorkspaceInputDock
      hasChat={chatAvailable}
      related={related?.contextKey || related?.pendingNoteReturn ? {
        active: relatedMode, available: !!related.contextKey, popupId: relatedPopupId,
        onOpen: toggleRelated, onDismiss: () => closeRelated(true), onBlur: () => closeRelated()
      } : undefined}
      relatedContent={relatedInput}
      overlay={dockPopup}
      mode={dockMode}
      bind:chatSlot
      bind:actionPresentation
      onSearch={() => searchBar?.focusSearch()}
      onChat={() => onExpandChat?.()}
    >
      {#snippet search(presentation, focusBoundary)}
        <SearchBar
          class="notepad-search-bar"
          {focusBoundary}
          bind:this={searchBar}
          value={searchQuery}
          expanded={chatAvailable && dockMode === 'search' ? true : undefined}
          presentationActive={presentation.active}
          presentationExpanded={presentation.expanded}
          presentationInputOpacity={presentation.inputOpacity}
          hasQuery={imageQueryUrl !== null}
          placeholder={imageQueryUrl ? 'Add text to refine this image' : searchMode === 'current' ? 'Search this note' : 'Search all notes'}
          ariaLabel={`${searchScopeTitle}. ${searchMode === 'current' ? 'Search this note' : 'Search the selected scope'}`}
          testId="note-search-input"
          matchCase={matchCase}
          matchWholeWord={matchWholeWord}
          showMatchOptions={true}
          scopeId={searchMode}
          scopeOptions={searchScopeOptions}
          canNavigatePrevious={searchMode === 'current' && canNavigateCurrentSearchResults}
          canNavigateNext={searchMode === 'current' && canNavigateCurrentSearchResults}
          blurOnEscape={false}
          shortcut={{ enabled: true, defaultScopeId: 'current', allScopeId: 'all' }}
          onValueChange={onSearchInput}
          onClear={onSearchClear}
          onOpen={handleSharedSearchOpen}
          onOpenChange={(open) => panelOpen = open}
          onScopeChange={handleSharedSearchModeChange}
          onMatchCaseChange={onMatchCaseChange}
          onMatchWholeWordChange={onMatchWholeWordChange}
          onNavigate={searchMode === 'current' ? (delta) => commandBarState.navigateSearchResult(delta) : undefined}
          onInputKeydown={commandBarState.handleSearchKeydown}
          onImageFile={searchMode === 'all' ? chooseImage : undefined}
          queryPreview={imageQueryUrl ? imageQueryPreview : undefined}
          onSearchIntent={showSearch}
          onClose={() => { if (relatedMode) { relatedMode = false; related?.onClose(); } }}
        />
      {/snippet}
    </WorkspaceInputDock>
    </div>


    <div
      class="inline-flex shrink-0 items-center rounded-full border border-border bg-background p-1 text-muted-foreground shadow-sm"
    >
      <button
        class="notepad-command-action mobile-touch-target inline-flex h-8 w-8 items-center justify-center rounded-full p-0 font-medium transition-colors hover:bg-accent hover:text-accent-foreground active:bg-accent/80 sm:h-11 sm:w-auto sm:min-w-[126px] sm:px-5"
        type="button"
        onclick={handleRemember}
        disabled={actionPresentation.running && outgoingRememberLabel !== null && actionPresentation.progress < 0.45}
        aria-label={rememberAriaLabel}
        title={rememberLabel}
      >
        <span class="notepad-command-action-label remember-action-label hidden sm:inline">
          <span>{rememberLabelPrefix}</span><span class="remember-action-name">
            {#if rememberLabelPrefix}<span class="remember-action-size" aria-hidden="true">Chat</span>{/if}
            <span class="remember-action-current" style:opacity={actionPresentation.running && outgoingRememberLabel ? dockRamp(0.45, 0.8, actionPresentation.progress) : 1}>{rememberLabel.slice(rememberLabelPrefix.length)}</span>
            {#if actionPresentation.running && outgoingRememberLabel}
              <span class="remember-action-outgoing" aria-hidden="true" style:opacity={1 - dockRamp(0.1, 0.35, actionPresentation.progress)}>{outgoingRememberLabel.slice(rememberLabelPrefix.length)}</span>
            {/if}
          </span>
        </span>
        <SquarePen class="h-5 w-5 sm:hidden" />
      </button>
    </div>
  </div>
</div>

<style>
  .notepad-discovery-dock { --discovery-gap: 0.5rem; }
  .related-search-heading { padding-right: var(--search-bar-height); }
  @media (min-width: 640px) {
    .notepad-discovery-dock { --discovery-gap: 0.75rem; }
  }
  [data-notepad-command-bar] {
    container: note-toolbar / inline-size;
  }

  .notepad-command-bar-content {
    --workspace-dock-action-height: 3.375rem;
    --workspace-dock-circle-inset: calc((var(--workspace-dock-action-height) - var(--search-bar-height)) / 2);
    align-items: flex-end;
  }
  .notepad-command-bar-content > :global(:first-child) { transform: translateX(var(--dock-action-0-shift, 0px)); }
  .notepad-command-bar-content > :global(:last-child) { transform: translateX(var(--dock-action-1-shift, 0px)); }
  :global([data-pane-motion]) .notepad-command-bar-content {
    /* Pane motion positions the input absolutely. Keep its row and backdrop
       fitted to the live dock height rather than a captured layout endpoint. */
    height: calc(var(--dock-layout-body-height, var(--search-bar-height)) + var(--workspace-dock-circle-inset) + 2 * var(--search-dock-padding) + var(--search-dock-safe-area));
  }
  .remember-action-label { position: relative; }
  .remember-action-name { position: relative; display: inline-grid; }
  .remember-action-current, .remember-action-size { grid-area: 1 / 1; }
  .remember-action-size { visibility: hidden; }
  .remember-action-outgoing { position: absolute; inset: 0; white-space: nowrap; }

  @container note-toolbar (max-width: 56rem) {
    .notepad-command-action {
      /* Release the label's space continuously below the icon breakpoint.
       * An abrupt label collapse would make expanded search reverse during
       * pane transitions. */
      --command-action-extra: clamp(0px, calc((100cqw - 45.75rem) / 2), 5.125rem);
      width: calc(2.75rem + var(--command-action-extra));
      min-width: 2.75rem;
      padding-inline: 0;
    }

    .notepad-command-action-label {
      display: none;
    }

    .notepad-command-action :global(svg) {
      display: block;
    }
  }

  @keyframes forget-hold-pulse {
    from {
      box-shadow:
        0 0 0 1px rgb(248 113 113 / 0.12),
        0 8px 18px rgb(127 29 29 / 0.06);
    }

    to {
      box-shadow:
        0 0 0 1px rgb(248 113 113 / 0.28),
        0 10px 24px rgb(127 29 29 / 0.14);
    }
  }

  .forget-hold-animation {
    animation: forget-hold-pulse 0.95s ease-in-out infinite alternate;
  }

  @media (max-height: 559px) {
    .notepad-command-bar-content {
      gap: 0.375rem;
      padding-inline: 0.625rem;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .forget-hold-animation {
      animation: none;
    }
  }
  @media (any-pointer: coarse) and (orientation: landscape) {
    :global(.app-shell[data-keyboard-open='true']) .notepad-command-bar-content {
      --workspace-dock-action-height: 2.875rem;
      --workspace-dock-circle-inset: 0px;
      --search-dock-padding: 0px;
      min-height: 2.875rem;
      padding-block: 0;
    }
    :global(.app-shell[data-keyboard-open='true']) .notepad-command-bar-content > :global(:first-child),
    :global(.app-shell[data-keyboard-open='true']) .notepad-command-bar-content > :global(:last-child) { padding: 0; }
    :global(.app-shell[data-keyboard-open='true']) .notepad-command-bar-content :global(.workspace-input-dock) { --dock-circle-inset: 0px; }
  }
</style>
