<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import { Search, Eraser, Undo2, Brain, StickyNote, BookOpen, Circle } from 'lucide-svelte';
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
  const FORGET_HOLD_DURATION_MS = 1000;
  let isHoldingForget = $state(false);
  let forgetHoldProgress = $state(0);
  let forgetHoldStartedAt = 0;
  let forgetHoldFrame: number | null = null;
  let forgetHoldTimeout: ReturnType<typeof window.setTimeout> | null = null;

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
    if (!isHoldingForget) return;

    const elapsed = performance.now() - forgetHoldStartedAt;
    forgetHoldProgress = Math.min(elapsed / FORGET_HOLD_DURATION_MS, 1);

    if (forgetHoldProgress >= 1) {
      forgetHoldFrame = null;
      return;
    }

    forgetHoldFrame = window.requestAnimationFrame(tickForgetHoldProgress);
  }

  function beginForgetHold() {
    if (isHoldingForget) return;

    clearForgetHoldFrame();
    clearForgetHoldTimeout();
    isHoldingForget = true;
    forgetHoldProgress = 0;
    forgetHoldStartedAt = performance.now();
    tickForgetHoldProgress();
    forgetHoldTimeout = window.setTimeout(() => {
      resetForgetHold();
      onForget();
    }, FORGET_HOLD_DURATION_MS);
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
    if (event.button !== 0) return;
    beginForgetHold();
  }

  function handleForgetKeyDown(event: KeyboardEvent) {
    if (event.repeat || (event.key !== ' ' && event.key !== 'Enter')) return;
    event.preventDefault();
    beginForgetHold();
  }

  function handleForgetKeyUp(event: KeyboardEvent) {
    if (event.key !== ' ' && event.key !== 'Enter') return;
    event.preventDefault();
    cancelForgetHold();
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

<div class="relative rounded-2xl shadow-lg min-w-0 overflow-visible">
  <div
    class="absolute inset-0 rounded-2xl bg-card/70 backdrop-blur-md"
    style="mask-image: linear-gradient(to bottom, transparent 0%, black 40%, black 100%); -webkit-mask-image: linear-gradient(to bottom, transparent 0%, black 40%, black 100%); mask-size: 100% 100%; -webkit-mask-size: 100% 100%;"
  ></div>
  <div class="relative z-10 flex items-center justify-between gap-4 py-4 px-6 min-w-0">
    {#if canUnforget}
      <button
        type="button"
        class="bottom-bar-action-button min-[700px]:w-[134px] px-6 py-2.5 bg-secondary hover:bg-accent text-secondary-foreground rounded-full transition-colors shadow-sm cursor-pointer border border-border shrink-0"
        onclick={() => onUnforget()}
        aria-label="Unforget"
      >
        <span class="bottom-bar-action-label">unForget</span>
        <Undo2 class="bottom-bar-action-icon hidden h-5 w-5" />
      </button>
    {:else}
      <button
        type="button"
        class="bottom-bar-action-button relative isolate overflow-hidden min-[700px]:w-[134px] px-6 py-2.5 bg-background hover:bg-accent text-muted-foreground hover:text-accent-foreground font-medium rounded-full transition-colors shadow-sm cursor-pointer border border-border shrink-0"
        class:forget-hold-button-active={isHoldingForget}
        class:border-slate-300={isHoldingForget}
        class:shadow-lg={isHoldingForget}
        style={`--forget-progress: ${forgetHoldProgress};`}
        aria-label="Hold to forget"
        onpointerdown={handleForgetPointerDown}
        onpointerup={cancelForgetHold}
        onpointerleave={cancelForgetHold}
        onpointercancel={cancelForgetHold}
        onkeydown={handleForgetKeyDown}
        onkeyup={handleForgetKeyUp}
      >
        <span
          class="absolute inset-0 z-0 origin-left rounded-[inherit] bg-[linear-gradient(120deg,rgba(241,245,249,0.92)_0%,rgba(226,232,240,0.96)_55%,rgba(203,213,225,0.98)_100%)] [transform:scaleX(var(--forget-progress,0))] transition-[transform,opacity] [transition-duration:120ms,160ms] [transition-timing-function:linear,ease] [opacity:calc(0.22+(var(--forget-progress,0)*0.56))]"
          aria-hidden="true"
        ></span>
        <span
          class="absolute left-[calc(var(--forget-progress,0)*100%)] top-1/2 z-0 h-4 w-4 rounded-full pointer-events-none bg-[radial-gradient(circle,rgba(255,255,255,0.95)_0%,rgba(226,232,240,0.82)_42%,rgba(226,232,240,0)_72%)] [transform:translate(-50%,-50%)_scale(calc(0.72+(var(--forget-progress,0)*0.38)))] [opacity:calc(var(--forget-progress,0)*1.15)]"
          aria-hidden="true"
        ></span>
        <span class="bottom-bar-action-label relative z-10">Forget</span>
        <Eraser class="bottom-bar-action-icon relative z-10 hidden h-5 w-5" />
      </button>
    {/if}

    <div
      class="search-bar search-bar-shell relative flex-1 min-w-0 max-w-2xl flex items-center gap-3 rounded-full pl-5 border border-border/70 overflow-visible bg-background"
      onfocusin={handleSearchFocus}
      onfocusout={handleSearchBlur}
    >
      <Search class="w-4 h-4 shrink-0 text-muted-foreground" />
      <div class="search-bar-input-wrap flex-1 min-w-0">
        <input
          bind:this={searchInput}
          type="text"
          autocomplete="off"
          class="search-bar-input w-full py-1.5 outline-none text-foreground placeholder:text-muted-foreground text-sm"
          placeholder={getSearchPlaceholder()}
          value={searchQuery}
          oninput={handleSearchInput}
          onkeydown={handleSearchKeydown}
        />
      </div>

      <div class="search-mode-toggle flex items-center gap-1 rounded-full bg-card/80 p-1 shrink-0">
        <button
          type="button"
          class:search-mode-button-active={isSearchFocused && searchMode === 'current'}
          class="search-mode-button inline-flex h-9 w-9 items-center justify-center rounded-full text-xs font-medium text-muted-foreground transition-colors"
          onmousedown={(event) => event.preventDefault()}
          onclick={() => handleSearchModeClick('current')}
          aria-label="Current notes"
        >
          <StickyNote class="h-4 w-4" />
        </button>
        <button
          type="button"
          class:search-mode-button-active={isSearchFocused && searchMode === 'all'}
          class="search-mode-button inline-flex h-9 w-9 items-center justify-center rounded-full text-xs font-medium text-muted-foreground transition-colors"
          onmousedown={(event) => event.preventDefault()}
          onclick={() => handleSearchModeClick('all')}
          aria-label="All notes"
        >
          <BookOpen class="h-4 w-4" />
        </button>
      </div>

      {#if isSearchFocused}
        <div class="search-results-panel absolute bottom-[calc(100%+0.85rem)] left-0 right-0 z-30 rounded-[1.5rem] border border-border bg-popover/95 p-2 shadow-xl backdrop-blur-md">
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
                        class:search-result-item-active={index === activeIndex}
                        class={getRecentNoteItemClass()}
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
                        class:search-result-item-active={globalIndex === activeIndex}
                        class={getRecentTaskItemClass()}
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
                  class:search-result-item-active={index === activeIndex}
                  class={getSearchResultItemClass()}
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
                        <mark class="search-result-highlight">{segment.text}</mark>
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
      class="bottom-bar-action-button min-[700px]:w-[134px] px-6 py-2.5 bg-background hover:bg-accent text-muted-foreground hover:text-accent-foreground font-medium rounded-full transition-colors shadow-sm cursor-pointer border border-border shrink-0"
      type="button"
      onclick={() => onRemember()}
      aria-label="Remember"
    >
      <span class="bottom-bar-action-label">Remember</span>
      <Brain class="bottom-bar-action-icon hidden h-5 w-5" />
    </button>
  </div>
</div>
