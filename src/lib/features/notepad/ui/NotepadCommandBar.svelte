<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import {
    Eraser,
    Undo2,
    Brain,
    Circle,
    ChevronDown,
    ChevronRight
  } from '@lucide/svelte';
  import {
    forgetButtonDurationPreference,
    resolveForgetButtonDurationMs
  } from '$lib/appSettings';
  import {
    buildHighlightedSegments,
    createNotepadCommandBarState,
    deriveNotepadCommandBarVisibleItems,
    type NotepadCommandBarVisibleItem
  } from '$lib/features/notepad/ui/notepadCommandBarState';
  import type {
    NotepadCommandBarForgetProps,
    NotepadCommandBarRememberProps,
    NotepadCommandBarSearchProps
  } from '$lib/features/notepad/ui/notepadCommandBarProps';
  import SearchBar, { type SearchBarHandle } from '$lib/ui/search/SearchBar.svelte';
  import type { SearchItem } from '$lib/types/semantic';

  const RECENT_TASKS_COLLAPSED_STORAGE_KEY = 'gneauxghts:bottom-bar:recent-tasks-collapsed';

  interface Props {
    forget: NotepadCommandBarForgetProps;
    remember: NotepadCommandBarRememberProps;
    search: NotepadCommandBarSearchProps;
  }

  let {
    forget,
    remember,
    search
  }: Props = $props();

  const canUnforget = $derived(forget.canUnforget);
  const onForget = $derived(forget.onForget);
  const onUnforget = $derived(forget.onUnforget);

  const onRemember = $derived(remember.onRemember);

  const searchMode = $derived(search.searchMode);
  const searchQuery = $derived(search.searchQuery);
  const matchCase = $derived(search.matchCase);
  const matchWholeWord = $derived(search.matchWholeWord);
  const searchResults = $derived(search.searchResults);
  const recentNotes = $derived(search.recentNotes);
  const recentTasks = $derived(search.recentTasks);
  const isSearching = $derived(search.isSearching);
  const onSearchInput = $derived(search.onSearchInput);
  const onSearchModeChange = $derived(search.onSearchModeChange);
  const onMatchCaseChange = $derived(search.onMatchCaseChange);
  const onMatchWholeWordChange = $derived(search.onMatchWholeWordChange);
  const onSearchSelect = $derived(search.onSearchSelect);
  const onSearchNavigate = $derived(search.onSearchNavigate);
  const onRecentNoteSelect = $derived(search.onRecentNoteSelect);
  const onRecentTaskSelect = $derived(search.onRecentTaskSelect);
  const onRecentNoteShortcut = $derived(search.onRecentNoteShortcut);
  const onRecentTaskShortcut = $derived(search.onRecentTaskShortcut);
  const onSearchOpen = $derived(search.onSearchOpen);
  const onCommand = $derived(search.onCommand);
  const searchScopeTitle = $derived(
    searchMode === 'current'
      ? 'Searching only the current note'
      : searchMode === 'chats'
        ? 'Searching chat transcripts'
        : searchMode === 'everything'
          ? 'Searching notes and chats'
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
    },
    {
      id: 'chats',
      label: 'Chats',
      ariaLabel: 'Search chat transcripts',
      title: 'Search chat transcripts'
    },
    {
      id: 'everything',
      label: 'Everything',
      ariaLabel: 'Search notes and chats',
      title: 'Search notes and chats'
    }
  ];

  let searchBar = $state<SearchBarHandle | null>(null);
  let searchResultsViewport = $state<HTMLDivElement | null>(null);
  let forgetButton = $state<HTMLButtonElement | null>(null);
  let forgetCancelButton = $state<HTMLButtonElement | null>(null);
  let forgetHoldDurationMs = $derived(resolveForgetButtonDurationMs($forgetButtonDurationPreference));
  let isForgetHoldEnabled = $derived(forgetHoldDurationMs > 0);
  let areRecentTasksCollapsed = $state(loadRecentTasksCollapsedPreference());
  let isAtLeastSmWidth = $state(false);
  const areRecentTasksVisuallyCollapsed = $derived(
    !isAtLeastSmWidth && areRecentTasksCollapsed
  );

  const visibleSearchResults = $derived.by<SearchItem[]>(() =>
    searchMode === 'current' ? dedupeCurrentSearchResults(searchResults) : searchResults
  );
  const visibleRecentTasks = $derived(
    searchQuery.trim() === '' && !areRecentTasksVisuallyCollapsed ? recentTasks : []
  );
  const visibleItems = $derived.by<NotepadCommandBarVisibleItem[]>(() =>
    deriveNotepadCommandBarVisibleItems(searchQuery, visibleSearchResults, recentNotes, visibleRecentTasks)
  );
  const hasRecentContent = $derived(recentNotes.length > 0 || recentTasks.length > 0);
  const hasVisibleSearchContent = $derived(
    searchQuery.trim() === '' ? hasRecentContent : visibleItems.length > 0
  );
  const canNavigateCurrentSearchResults = $derived(
    searchMode === 'current' && searchQuery.trim() !== '' && searchResults.length > 0
  );

  const commandBarState = createNotepadCommandBarState({
    getSearchQuery: () => searchQuery,
    getSearchResults: () => visibleSearchResults,
    getSearchNavigationResults: () => (searchMode === 'current' ? searchResults : visibleSearchResults),
    getRecentNotes: () => recentNotes,
    getRecentTasks: () => visibleRecentTasks,
    getVisibleItems: () => visibleItems,
    getForgetHoldDurationMs: () => forgetHoldDurationMs,
    isForgetHoldEnabled: () => isForgetHoldEnabled,
    isForgetActionAvailable: () => !canUnforget,
    onSearchInput: (value) => onSearchInput(value),
    onSearchSelect: (result) => onSearchSelect(result),
    onSearchNavigate: (result) => onSearchNavigate?.(result),
    onRecentNoteSelect: (result) => onRecentNoteSelect(result),
    onRecentTaskSelect: (task) => onRecentTaskSelect(task),
    onRecentNoteShortcut: (index) => onRecentNoteShortcut(index),
    onRecentTaskShortcut: (index) => onRecentTaskShortcut(index),
    closeSearch: () => searchBar?.closeSearch(),
    onCommand: (command) => onCommand?.(command) ?? false,
    onForget: () => onForget()
  });

  // Track only the materially distinguishing fingerprint of the visible
  // items so transient writable-store flips (e.g. isSearching toggling on a
  // keystroke that hasn't changed results yet) do not reset activeIndex.
  const visibleItemsFingerprint = $derived(
    `${searchQuery.trim() === '' ? 'recents' : 'search'}|${visibleItems.length}|${visibleSearchResults.length}|${
      visibleItems[0]
        ? visibleItems[0].kind === 'task'
          ? `t:${visibleItems[0].item.taskKey}`
          : `n:${visibleItems[0].item.notePath ?? ''}|${visibleItems[0].item.fileName}|${visibleItems[0].item.sectionLabel ?? ''}|${visibleItems[0].item.matchText ?? ''}`
        : ''
    }`
  );

  $effect(() => {
    visibleItemsFingerprint;
    commandBarState.resetActiveIndex();
  });

  $effect(() => {
    canUnforget;
    if (canUnforget) {
      commandBarState.resetForgetHold();
    }
  });

  $effect(() => {
    $forgetButtonDurationPreference;
    commandBarState.resetForgetHold();
  });

  $effect(() => {
    if (!$commandBarState.isForgetConfirmOpen) {
      return;
    }

    void tick().then(() => {
      forgetCancelButton?.focus();
    });
  });

  $effect(() => {
    $commandBarState.activeIndex;
    visibleItems;
    void commandBarState.syncActiveItemIntoView();
  });

  $effect(() => {
    commandBarState.bindSearchResultsViewport(searchResultsViewport);
  });

  function handleSharedSearchOpen() {
    commandBarState.resetActiveIndex();
    onSearchOpen();
  }

  function handleSharedSearchModeChange(mode: string) {
    if (mode !== 'current' && mode !== 'all' && mode !== 'chats' && mode !== 'everything') return;
    return onSearchModeChange(mode);
  }

  onDestroy(() => {
    commandBarState.dispose();
  });

  onMount(() => {
    const mediaQuery = window.matchMedia('(min-width: 640px)');
    const updateWidthState = () => {
      isAtLeastSmWidth = mediaQuery.matches;
    };

    updateWidthState();
    mediaQuery.addEventListener('change', updateWidthState);

    return () => {
      mediaQuery.removeEventListener('change', updateWidthState);
    };
  });

  function getRecentNotesViewportClass() {
    return 'h-[13.75rem] overflow-y-auto';
  }

  function getRecentTasksViewportClass() {
    return 'h-[15rem] overflow-y-auto';
  }

  function getRecentNoteItemClass() {
    return 'search-result-item flex h-[2.75rem] w-full items-center rounded-[1.1rem] px-4 py-1.5 text-left transition-colors';
  }

  function getRecentTaskItemClass() {
    return 'search-result-item flex h-[3rem] w-full items-center gap-3 rounded-[1.1rem] px-4 py-1.5 text-left transition-colors';
  }

  function loadRecentTasksCollapsedPreference() {
    if (typeof window === 'undefined') {
      return false;
    }
    return window.localStorage.getItem(RECENT_TASKS_COLLAPSED_STORAGE_KEY) === 'true';
  }

  function toggleRecentTasksCollapsed() {
    areRecentTasksCollapsed = !areRecentTasksCollapsed;
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(
        RECENT_TASKS_COLLAPSED_STORAGE_KEY,
        String(areRecentTasksCollapsed)
      );
    }
  }

  function getSearchResultItemClass(mode: 'current' | 'all' | 'chats' | 'everything') {
    return mode === 'current'
      ? 'search-result-item grid min-h-10 w-full grid-cols-[minmax(0,1fr)_max-content] items-center gap-3 rounded-[0.9rem] px-3 py-2 text-left transition-colors'
      : 'search-result-item flex w-full flex-col gap-2 rounded-[1.1rem] px-4 py-3 text-left transition-colors';
  }

  function getSearchResultTitleClass() {
    return 'text-sm font-semibold text-popover-foreground';
  }

  function getSearchResultHeaderClass() {
    return 'flex items-start justify-between gap-3';
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
      const [previewText] = getCurrentSearchPreviewCrop(item);
      const key = `${item.sectionLabel}|${previewText}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
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
  class="relative min-w-0 overflow-visible rounded-none shadow-none sm:rounded-2xl sm:shadow-lg"
>
  <div
    class="absolute inset-0 rounded-none bg-card/70 backdrop-blur-md sm:rounded-2xl"
    style="mask-image: linear-gradient(to bottom, transparent 0%, black 40%, black 100%); -webkit-mask-image: linear-gradient(to bottom, transparent 0%, black 40%, black 100%); mask-size: 100% 100%; -webkit-mask-size: 100% 100%;"
  ></div>
  <div class="relative z-10 flex min-w-0 items-center justify-between gap-2 px-3 py-2 sm:gap-4 sm:px-6 sm:py-4">
    {#if canUnforget}
      <button
        type="button"
        class="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border bg-secondary p-0 text-secondary-foreground shadow-sm transition-colors hover:bg-accent min-[700px]:h-auto min-[700px]:w-[134px] min-[700px]:px-6 min-[700px]:py-2.5"
        onclick={() => onUnforget()}
        aria-label="Restore the last forgotten note"
        title="Restore forgotten note"
      >
        <span class="hidden min-[700px]:inline">unForget</span>
        <Undo2 class="h-5 w-5 min-[700px]:hidden" />
      </button>
    {:else}
      <div
        class={`relative inline-flex shrink-0 items-center rounded-full border bg-background p-1 text-muted-foreground shadow-sm ${
          $commandBarState.isHoldingForget ? 'border-destructive/70' : 'border-border'
        }`}
      >
        {#if $commandBarState.isForgetConfirmOpen}
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
                <p id="forget-confirm-title" class="text-sm font-semibold">Forget this note?</p>
                <p id="forget-confirm-description" class="mt-1 text-xs leading-5 text-muted-foreground">
                  You can also hold Forget (or its shortcut) to skip this confirmation
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
                title="Move note to Forgotten Notes"
              >
                Forget
              </button>
            </div>
          </div>
        {/if}
        <button
          bind:this={forgetButton}
          type="button"
          aria-expanded={$commandBarState.isForgetConfirmOpen}
          aria-controls={$commandBarState.isForgetConfirmOpen ? 'forget-confirm-popover' : undefined}
          class={`relative isolate inline-flex h-8 w-8 items-center justify-center overflow-hidden rounded-full p-0 font-medium transition-colors hover:bg-destructive/20 hover:text-destructive active:bg-destructive/15 active:text-destructive focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-destructive min-[700px]:h-auto min-[700px]:w-auto min-[700px]:min-w-[126px] min-[700px]:px-5 min-[700px]:py-2 ${
            $commandBarState.isHoldingForget
              ? 'text-destructive animate-[forget-hold-pulse_0.95s_ease-in-out_infinite_alternate]'
              : ''
          }`}
          style={`--forget-progress: ${$commandBarState.forgetHoldProgress};`}
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
            class="absolute inset-0 z-0 origin-left rounded-[inherit] bg-destructive/55 transition-[transform,opacity] duration-150 ease-linear"
            style="transform: scaleX(var(--forget-progress, 0)); opacity: calc(0.14 + (var(--forget-progress, 0) * 0.58));"
            aria-hidden="true"
          ></span>
          <span class="relative z-10 hidden min-[700px]:inline">
            Forget
          </span>
          <Eraser
            class={`relative z-10 h-5 w-5 transition-transform duration-200 min-[700px]:hidden ${
              $commandBarState.isHoldingForget ? '-translate-y-px' : ''
            }`}
          />
        </button>
      </div>
    {/if}

    {#snippet searchPanel()}
      <div
        class="search-results-panel absolute bottom-[calc(100%+0.5rem)] left-0 right-0 z-30 rounded-[1.2rem] border p-2 shadow-xl backdrop-blur-md sm:bottom-[calc(100%+0.85rem)] sm:rounded-[1.5rem]"
        data-search-navigation-mode={$commandBarState.searchNavigationMode}
      >
        {#if isSearching && searchQuery.trim() !== ''}
          <div class="px-4 py-3 text-sm text-muted-foreground">Searching notes…</div>
        {:else if !hasVisibleSearchContent}
          <div class="px-4 py-3 text-sm text-muted-foreground">
            {#if searchQuery.trim() === ''}
              Start typing to search {searchMode === 'current' ? 'this note' : 'all notes'}.
            {:else}
              No matches in {searchMode === 'current' ? 'this note' : 'all notes'}. Try {searchMode === 'current' ? 'All notes' : 'This note'}.
            {/if}
          </div>
        {:else if searchQuery.trim() === ''}
          <div
            bind:this={searchResultsViewport}
            class="flex flex-col gap-3 lg:flex-row lg:items-stretch lg:gap-0"
          >
            {#if recentTasks.length > 0}
              <section
                class={`min-w-0 flex-1 lg:order-2 ${
                  recentNotes.length > 0
                    ? 'border-b border-border/70 pb-2 lg:border-b-0 lg:border-l lg:border-border/70 lg:pb-0 lg:pl-3'
                    : ''
                }`}
              >
                <div
                  class="flex w-full items-center justify-between gap-3 px-4 pb-2 pt-3 text-left text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground"
                >
                  <span>Recent Tasks</span>
                  <button
                    type="button"
                    class="inline-flex items-center rounded-full transition-colors hover:text-foreground sm:hidden"
                    aria-label={areRecentTasksCollapsed ? 'Show recent tasks' : 'Hide recent tasks'}
                    aria-expanded={!areRecentTasksCollapsed}
                    onmousedown={(event) => event.preventDefault()}
                    onclick={toggleRecentTasksCollapsed}
                  >
                    {#if areRecentTasksCollapsed}
                      <ChevronRight class="h-3.5 w-3.5" />
                    {:else}
                      <ChevronDown class="h-3.5 w-3.5" />
                    {/if}
                  </button>
                </div>
                {#if !areRecentTasksVisuallyCollapsed}
                  <div class={getRecentTasksViewportClass()}>
                    {#each recentTasks as item, index (`task-${item.taskKey}-${index}`)}
                      <button
                        type="button"
                        data-search-result-active={index === $commandBarState.activeIndex ? 'true' : 'false'}
                        class={getRecentTaskItemClass()}
                        class:bg-accent={index === $commandBarState.activeIndex}
                        aria-label={`Open recent task: ${item.text}`}
                        title={`${item.text} - ${item.noteTitle}`}
                        onmousedown={(event) => event.preventDefault()}
                        onpointerenter={() => commandBarState.handleSearchItemPointerEnter(index)}
                        onclick={() => commandBarState.selectItem({ kind: 'task', item })}
                      >
                        <Circle class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span class="min-w-0 flex-1 truncate text-sm font-medium text-popover-foreground">
                          {item.text}
                        </span>
                        <span class="max-w-32 shrink-0 truncate text-xs font-medium text-muted-foreground">
                          {item.noteTitle}
                        </span>
                      </button>
                    {/each}
                  </div>
                {/if}
              </section>
            {/if}

            {#if recentNotes.length > 0}
              <section class="min-w-0 flex-1 lg:order-1 lg:pr-3">
                <div class="px-4 pb-2 pt-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  Recent Notes
                </div>
                <div class={getRecentNotesViewportClass()}>
                  {#each recentNotes as item, index (`note-${item.notePath ?? 'current'}-${item.fileName}-${index}`)}
                    {@const globalIndex = visibleRecentTasks.length + index}
                    <button
                      type="button"
                      data-search-result-active={globalIndex === $commandBarState.activeIndex ? 'true' : 'false'}
                      class={getRecentNoteItemClass()}
                      class:bg-accent={globalIndex === $commandBarState.activeIndex}
                      aria-label={`Open recent note: ${item.fileName}`}
                      title={item.fileName}
                      onmousedown={(event) => event.preventDefault()}
                      onpointerenter={() => commandBarState.handleSearchItemPointerEnter(globalIndex)}
                      onclick={() => commandBarState.selectItem({ kind: 'note', item })}
                    >
                      <span class="truncate text-sm font-semibold text-popover-foreground">{item.fileName}</span>
                    </button>
                  {/each}
                </div>
              </section>
            {/if}
          </div>
        {:else}
          <div bind:this={searchResultsViewport} class="max-h-80 overflow-y-auto">
            {#each visibleSearchResults as item, index (`${item.notePath ?? 'current'}-${item.sectionLabel}-${item.matchText}-${index}`)}
              <button
                type="button"
                data-search-result-active={index === $commandBarState.activeIndex ? 'true' : 'false'}
                class={getSearchResultItemClass(searchMode)}
                class:bg-accent={index === $commandBarState.activeIndex}
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
                    <div class="min-w-0">
                      <span class={getSearchResultTitleClass()}>
                        {item.fileName}
                      </span>
                      {#if item.reasonLabels && item.reasonLabels.length > 0}
                        <div class="mt-1 flex flex-wrap gap-1.5">
                          {#each item.reasonLabels as label}
                            <span class="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                              {label}
                            </span>
                          {/each}
                        </div>
                      {/if}
                    </div>
                    {#if item.sectionLabel !== 'Title'}
                      <span class="shrink-0 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
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
            {/each}
          </div>
        {/if}
      </div>
    {/snippet}

    <SearchBar
      bind:this={searchBar}
      value={searchQuery}
      placeholder={searchMode === 'current' ? 'Search this note' : searchMode === 'chats' ? 'Search chats' : searchMode === 'everything' ? 'Search everything' : 'Search all notes'}
      ariaLabel={`${searchScopeTitle}. ${searchMode === 'current' ? 'Search this note' : 'Search the selected scope'}`}
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
      onOpen={handleSharedSearchOpen}
      onScopeChange={handleSharedSearchModeChange}
      onMatchCaseChange={onMatchCaseChange}
      onMatchWholeWordChange={onMatchWholeWordChange}
      onNavigate={(delta) => commandBarState.navigateSearchResult(delta)}
      onInputKeydown={commandBarState.handleSearchKeydown}
      panel={searchPanel}
    />

    <div
      class="inline-flex shrink-0 items-center rounded-full border border-border bg-background p-1 text-muted-foreground shadow-sm"
    >
      <button
        class="inline-flex h-8 w-8 items-center justify-center rounded-full p-0 font-medium transition-colors hover:bg-accent hover:text-accent-foreground active:bg-accent/80 min-[700px]:h-auto min-[700px]:w-auto min-[700px]:min-w-[126px] min-[700px]:px-5 min-[700px]:py-2"
        type="button"
        onclick={handleRemember}
        aria-label="New Idea. Start a blank note."
        title="New Idea"
      >
        <span class="hidden min-[700px]:inline">New Idea</span>
        <Brain class="h-5 w-5 min-[700px]:hidden" />
      </button>
    </div>
  </div>
</div>

<style>
  .search-results-panel {
    background: var(--search-scope-results-bg);
    border-color: var(--search-scope-results-border);
    transition:
      background-color 160ms ease,
      border-color 160ms ease;
  }

  .search-result-item[data-search-result-active='true'] {
    background: var(--accent);
  }

  .search-results-panel[data-search-navigation-mode='pointer'] .search-result-item:hover {
    background: var(--accent);
  }
</style>
