<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import { Search, Eraser, Undo2, Brain, StickyNote, BookOpen, Circle } from 'lucide-svelte';
  import {
    forgetButtonDurationPreference,
    resolveForgetButtonDurationMs
  } from '$lib/appSettings';
  import type { SearchItem } from '$lib/types/semantic';

  interface TextRange {
    start: number;
    end: number;
  }

  interface RecentTaskItem {
    taskKey: string;
    notePath: string;
    noteTitle: string;
    text: string;
    lineNumber: number;
    updatedAtMillis: number;
  }

  type VisibleItem =
    | { kind: 'search'; item: SearchItem }
    | { kind: 'note'; item: SearchItem }
    | { kind: 'task'; item: RecentTaskItem };

  interface Props {
    canUnforget: boolean;
    onForget: () => void;
    onUnforget: () => void;
    onRemember: () => void;
    searchMode: 'current' | 'all';
    searchQuery: string;
    searchResults: SearchItem[];
    recentNotes: SearchItem[];
    recentTasks: RecentTaskItem[];
    isSearching: boolean;
    onSearchInput: (value: string) => void;
    onSearchModeChange: (mode: 'current' | 'all') => void | Promise<void>;
    onSearchSelect: (result: SearchItem) => void;
    onRecentTaskSelect: (task: RecentTaskItem) => void;
    onSearchFocus: () => void;
    focusRequest: number;
  }

  let {
    canUnforget = false,
    onForget,
    onUnforget,
    onRemember,
    searchMode,
    searchQuery,
    searchResults,
    recentNotes,
    recentTasks,
    isSearching,
    onSearchInput,
    onSearchModeChange,
    onSearchSelect,
    onRecentTaskSelect,
    onSearchFocus,
    focusRequest
  }: Props = $props();

  let searchInput: HTMLInputElement | null = null;
  let searchResultsViewport = $state<HTMLDivElement | null>(null);
  let isSearchFocused = $state(false);
  let activeIndex = $state(0);
  let lastHandledFocusRequest = 0;
  const FORGET_HOLD_COMPLETION_DELAY_MS = 100;
  let isHoldingForget = $state(false);
  let forgetHoldProgress = $state(0);
  let forgetHoldStartedAt = 0;
  let forgetHoldFrame: number | null = null;
  let forgetHoldTimeout: ReturnType<typeof window.setTimeout> | null = null;
  let forgetHoldDurationMs = $derived(resolveForgetButtonDurationMs($forgetButtonDurationPreference));
  let isForgetHoldEnabled = $derived(forgetHoldDurationMs > 0);

  const visibleItems = $derived.by<VisibleItem[]>(() => {
    if (searchQuery.trim() === '') {
      return [
        ...recentNotes.map((item) => ({ kind: 'note' as const, item })),
        ...recentTasks.map((item) => ({ kind: 'task' as const, item }))
      ];
    }

    return searchResults.map((item) => ({ kind: 'search' as const, item }));
  });

  function resetActiveIndex() {
    activeIndex = 0;
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
    isHoldingForget = false;
    forgetHoldProgress = 0;
    forgetHoldStartedAt = 0;
  }

  function tickForgetHoldProgress() {
    if (!isHoldingForget || !isForgetHoldEnabled) return;

    const elapsed = performance.now() - forgetHoldStartedAt;
    forgetHoldProgress = Math.min(elapsed / forgetHoldDurationMs, 1);

    if (forgetHoldProgress >= 1) {
      forgetHoldFrame = null;
      return;
    }

    forgetHoldFrame = window.requestAnimationFrame(tickForgetHoldProgress);
  }

  function beginForgetHold() {
    if (!isForgetHoldEnabled || isHoldingForget) return;

    clearForgetHoldFrame();
    clearForgetHoldTimeout();
    isHoldingForget = true;
    forgetHoldProgress = 0;
    forgetHoldStartedAt = performance.now();
    tickForgetHoldProgress();
    forgetHoldTimeout = window.setTimeout(() => {
      clearForgetHoldFrame();
      forgetHoldProgress = 1;
      forgetHoldTimeout = window.setTimeout(() => {
        resetForgetHold();
        onForget();
      }, FORGET_HOLD_COMPLETION_DELAY_MS);
    }, forgetHoldDurationMs);
  }

  function cancelForgetHold() {
    if (!isHoldingForget) return;
    resetForgetHold();
  }

  $effect(() => {
    visibleItems;
    resetActiveIndex();
  });

  $effect(() => {
    canUnforget;
    if (canUnforget) {
      resetForgetHold();
    }
  });

  $effect(() => {
    $forgetButtonDurationPreference;
    resetForgetHold();
  });

  $effect(() => {
    focusRequest;
    if (focusRequest <= lastHandledFocusRequest) return;
    lastHandledFocusRequest = focusRequest;
    if (!searchInput) return;
    searchInput.focus();
    const end = searchInput.value.length;
    searchInput.setSelectionRange(end, end);
    isSearchFocused = true;
    onSearchFocus();
  });

  $effect(() => {
    isSearchFocused;
    activeIndex;
    visibleItems;

    if (!isSearchFocused || !searchResultsViewport) return;

    void tick().then(() => {
      requestAnimationFrame(() => {
        const activeItem = searchResultsViewport?.querySelector<HTMLElement>('[data-search-result-active="true"]');
        activeItem?.scrollIntoView({ block: 'nearest' });
      });
    });
  });

  function handleSearchInput(event: Event) {
    onSearchInput((event.currentTarget as HTMLInputElement).value);
  }

  function handleSearchFocus() {
    isSearchFocused = true;
    onSearchFocus();
  }

  function handleSearchBlur(event: FocusEvent) {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget instanceof HTMLElement && event.currentTarget.contains(nextTarget)) {
      return;
    }

    isSearchFocused = false;
    resetActiveIndex();
  }

  function closeSearchPanel() {
    isSearchFocused = false;
    resetActiveIndex();
    searchInput?.blur();
  }

  function handleForgetPointerDown(event: PointerEvent) {
    if (!isForgetHoldEnabled || event.button !== 0) return;
    beginForgetHold();
  }

  function handleForgetKeyDown(event: KeyboardEvent) {
    if (!isForgetHoldEnabled || event.repeat || (event.key !== ' ' && event.key !== 'Enter')) return;
    event.preventDefault();
    beginForgetHold();
  }

  function handleForgetKeyUp(event: KeyboardEvent) {
    if (!isForgetHoldEnabled || (event.key !== ' ' && event.key !== 'Enter')) return;
    event.preventDefault();
    cancelForgetHold();
  }

  function handleForgetClick() {
    if (isForgetHoldEnabled) return;
    onForget();
  }

  function getForgetButtonAriaLabel() {
    return isForgetHoldEnabled ? 'Hold to forget' : 'Forget';
  }

  onDestroy(() => {
    resetForgetHold();
  });

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
    if (!isSearchFocused) return '';
    return searchMode === 'current' ? 'Current Gneauxght' : 'All Gneauxghts';
  }

  function handleSearchKeydown(event: KeyboardEvent) {
    const items = visibleItems;
    const isPanelVisible = isSearchFocused && (searchQuery.trim() !== '' || recentNotes.length > 0 || recentTasks.length > 0);

    if (event.key === 'Escape') {
      if (searchQuery.trim() !== '') {
        onSearchInput('');
        return;
      }

      closeSearchPanel();
      return;
    }

    if (!isPanelVisible || items.length === 0) {
      if (event.key === 'Enter' && searchQuery.trim() === '') {
        event.preventDefault();
      }
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      activeIndex = (activeIndex + 1) % items.length;
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      activeIndex = (activeIndex - 1 + items.length) % items.length;
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      selectItem(items[activeIndex] ?? items[0]);
    }
  }

  function buildHighlightedSegments(text: string, ranges: TextRange[]) {
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

  function getRecentNotesViewportClass() {
    return 'h-[8.25rem] overflow-y-auto';
  }

  function getRecentTasksViewportClass() {
    return 'h-[9rem] overflow-y-auto';
  }

  function getRecentNoteItemClass() {
    return 'search-result-item flex h-[2.75rem] w-full items-center rounded-[1.1rem] px-4 py-1.5 text-left transition-colors hover:bg-accent';
  }

  function getRecentTaskItemClass() {
    return 'search-result-item flex h-[3rem] w-full items-center gap-3 rounded-[1.1rem] px-4 py-1.5 text-left transition-colors hover:bg-accent';
  }

  function getSearchResultItemClass() {
    return 'search-result-item flex w-full flex-col gap-2 rounded-[1.1rem] px-4 py-3 text-left transition-colors hover:bg-accent';
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

  function selectItem(item: VisibleItem) {
    closeSearchPanel();

    if (item.kind === 'task') {
      onRecentTaskSelect(item.item);
      return;
    }

    onSearchSelect(item.item);
  }
</script>

<div class="relative min-w-0 overflow-visible rounded-none shadow-none sm:rounded-2xl sm:shadow-lg">
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
        aria-label="Unforget"
      >
        <span class="hidden min-[700px]:inline">unForget</span>
        <Undo2 class="h-5 w-5 min-[700px]:hidden" />
      </button>
    {:else}
      <button
        type="button"
        class={`relative isolate inline-flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-background p-0 font-medium text-muted-foreground shadow-sm transition-[color,background-color,border-color,box-shadow] duration-200 hover:border-destructive/40 hover:text-muted-foreground active:text-destructive min-[700px]:h-auto min-[700px]:w-[134px] min-[700px]:px-6 min-[700px]:py-2.5 ${
          isHoldingForget
            ? 'border-destructive/70 text-destructive animate-[forget-hold-pulse_0.95s_ease-in-out_infinite_alternate]'
            : ''
        }`}
        style={`--forget-progress: ${forgetHoldProgress};`}
        aria-label={getForgetButtonAriaLabel()}
        onclick={handleForgetClick}
        onpointerdown={handleForgetPointerDown}
        onpointerup={cancelForgetHold}
        onpointerleave={cancelForgetHold}
        onpointercancel={cancelForgetHold}
        onkeydown={handleForgetKeyDown}
        onkeyup={handleForgetKeyUp}
      >
        <span
          class="absolute inset-0 z-0 origin-left rounded-[inherit] bg-destructive/35 transition-[transform,opacity] duration-150 ease-linear"
          style="transform: scaleX(var(--forget-progress, 0)); opacity: calc(0.14 + (var(--forget-progress, 0) * 0.58));"
          aria-hidden="true"
        ></span>
        <span class="relative z-10 hidden transition duration-200 min-[700px]:inline">
          Forget
        </span>
        <Eraser
          class={`relative z-10 h-5 w-5 transition-transform duration-200 min-[700px]:hidden ${
            isHoldingForget ? '-translate-y-px' : ''
          }`}
        />
      </button>
    {/if}

    <div
      class="search-bar search-bar-shell relative flex max-w-2xl flex-1 min-w-0 items-center gap-2 overflow-visible rounded-full border border-border/70 bg-background pl-3 pr-1 sm:gap-3 sm:pl-5"
      onfocusin={handleSearchFocus}
      onfocusout={handleSearchBlur}
    >
      <Search class="w-4 h-4 shrink-0 text-muted-foreground" />
      <div class="flex-1 min-w-0">
        <input
          bind:this={searchInput}
          type="text"
          autocomplete="off"
          class="search-bar-input w-full py-1.5 text-sm text-foreground outline-none placeholder:text-muted-foreground sm:py-2"
          placeholder={getSearchPlaceholder()}
          value={searchQuery}
          oninput={handleSearchInput}
          onkeydown={handleSearchKeydown}
        />
      </div>

      <div class="search-mode-toggle flex shrink-0 items-center gap-1 rounded-full bg-card/80 p-1">
        <button
          type="button"
          class="inline-flex h-8 w-8 items-center justify-center rounded-full bg-transparent text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground sm:h-9 sm:w-9"
          class:bg-primary={isSearchFocused && searchMode === 'current'}
          class:text-primary={isSearchFocused && searchMode === 'current'}
          onmousedown={(event) => event.preventDefault()}
          onclick={() => handleSearchModeClick('current')}
          aria-label="Current notes"
        >
          <StickyNote class="h-4 w-4" />
        </button>
        <button
          type="button"
          class="inline-flex h-8 w-8 items-center justify-center rounded-full bg-transparent text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground sm:h-9 sm:w-9"
          class:bg-primary={isSearchFocused && searchMode === 'all'}
          class:text-primary={isSearchFocused && searchMode === 'all'}
          onmousedown={(event) => event.preventDefault()}
          onclick={() => handleSearchModeClick('all')}
          aria-label="All notes"
        >
          <BookOpen class="h-4 w-4" />
        </button>
      </div>

      {#if isSearchFocused}
        <div class="search-results-panel absolute bottom-[calc(100%+0.5rem)] left-0 right-0 z-30 rounded-[1.2rem] border border-border bg-popover/95 p-2 shadow-xl backdrop-blur-md sm:bottom-[calc(100%+0.85rem)] sm:rounded-[1.5rem]">
          {#if isSearching && searchQuery.trim() !== ''}
            <div class="px-4 py-3 text-sm text-muted-foreground">Searching notes…</div>
          {:else if visibleItems.length === 0}
            <div class="px-4 py-3 text-sm text-muted-foreground">
              {#if searchQuery.trim() === ''}
                No recent notes or tasks yet.
              {:else}
                No notes found.
              {/if}
            </div>
          {:else if searchQuery.trim() === ''}
            <div bind:this={searchResultsViewport} class="space-y-3">
              {#if recentNotes.length > 0}
                <section>
                  <div class="px-4 pb-2 pt-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                    Recent Notes
                  </div>
                  <div class={getRecentNotesViewportClass()}>
                    {#each recentNotes as item, index (`note-${item.notePath ?? 'current'}-${item.fileName}-${index}`)}
                      <button
                        type="button"
                        data-search-result-active={index === activeIndex ? 'true' : 'false'}
                        class={getRecentNoteItemClass()}
                        class:bg-accent={index === activeIndex}
                        onmousedown={(event) => event.preventDefault()}
                        onclick={() => selectItem({ kind: 'note', item })}
                      >
                        <span class="truncate text-sm font-semibold text-popover-foreground">{item.fileName}</span>
                      </button>
                    {/each}
                  </div>
                </section>
              {/if}

              {#if recentTasks.length > 0}
                <section class={recentNotes.length > 0 ? 'border-t border-border/70 pt-2' : ''}>
                  <div class="px-4 pb-2 pt-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                    Recent Tasks
                  </div>
                  <div class={getRecentTasksViewportClass()}>
                    {#each recentTasks as item, index (`task-${item.taskKey}-${index}`)}
                      {@const globalIndex = recentNotes.length + index}
                      <button
                        type="button"
                        data-search-result-active={globalIndex === activeIndex ? 'true' : 'false'}
                        class={getRecentTaskItemClass()}
                        class:bg-accent={globalIndex === activeIndex}
                        onmousedown={(event) => event.preventDefault()}
                        onclick={() => selectItem({ kind: 'task', item })}
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
                </section>
              {/if}
            </div>
          {:else}
            <div bind:this={searchResultsViewport} class="max-h-80 overflow-y-auto">
              {#each searchResults as item, index (`${item.notePath ?? 'current'}-${item.sectionLabel}-${item.matchText}-${index}`)}
                <button
                  type="button"
                  data-search-result-active={index === activeIndex ? 'true' : 'false'}
                  class={getSearchResultItemClass()}
                  class:bg-accent={index === activeIndex}
                  onmousedown={(event) => event.preventDefault()}
                  onclick={() => selectItem({ kind: 'search', item })}
                >
                  <div class={getSearchResultHeaderClass()}>
                    <div class="min-w-0">
                      <span class={getSearchResultTitleClass()}>
                        {#if searchMode === 'all'}
                          {item.fileName}
                        {:else}
                          {item.sectionLabel}
                        {/if}
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
                </button>
              {/each}
            </div>
          {/if}
        </div>
      {/if}
    </div>

    <button
      class="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border bg-background p-0 font-medium text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground min-[700px]:h-auto min-[700px]:w-[134px] min-[700px]:px-6 min-[700px]:py-2.5"
      type="button"
      onclick={() => onRemember()}
      aria-label="Remember"
    >
      <span class="hidden min-[700px]:inline">Remember</span>
      <Brain class="h-5 w-5 min-[700px]:hidden" />
    </button>
  </div>
</div>

<style>
  .search-bar-input {
    text-shadow: none;
    -webkit-text-stroke: 0 transparent;
    border: 1px solid transparent;
    display: block;
    transform: translateZ(0);
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    box-sizing: border-box;
  }
</style>
