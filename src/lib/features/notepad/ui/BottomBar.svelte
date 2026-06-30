<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import { Search, Eraser, Undo2, Brain, StickyNote, BookOpen, Circle, X } from '@lucide/svelte';
  import {
    forgetButtonDurationPreference,
    resolveForgetButtonDurationMs
  } from '$lib/appSettings';
  import {
    buildHighlightedSegments,
    createBottomBarState,
    deriveBottomBarVisibleItems,
    type BottomBarVisibleItem
  } from '$lib/features/notepad/ui/bottomBarState';
  import type {
    BottomBarForgetProps,
    BottomBarRememberProps,
    BottomBarSearchProps
  } from '$lib/features/notepad/ui/bottomBarProps';

  interface Props {
    forget: BottomBarForgetProps;
    remember: BottomBarRememberProps;
    search: BottomBarSearchProps;
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
  const searchResults = $derived(search.searchResults);
  const recentNotes = $derived(search.recentNotes);
  const recentTasks = $derived(search.recentTasks);
  const isSearching = $derived(search.isSearching);
  const focusRequest = $derived(search.focusRequest);
  const onSearchInput = $derived(search.onSearchInput);
  const onSearchModeChange = $derived(search.onSearchModeChange);
  const onSearchSelect = $derived(search.onSearchSelect);
  const onRecentNoteSelect = $derived(search.onRecentNoteSelect);
  const onRecentTaskSelect = $derived(search.onRecentTaskSelect);
  const onRecentNoteShortcut = $derived(search.onRecentNoteShortcut);
  const onRecentTaskShortcut = $derived(search.onRecentTaskShortcut);
  const onSearchFocus = $derived(search.onSearchFocus);
  const onCommand = $derived(search.onCommand);

  let searchInput = $state<HTMLInputElement | null>(null);
  let searchResultsViewport = $state<HTMLDivElement | null>(null);
  let forgetButton = $state<HTMLButtonElement | null>(null);
  let forgetCancelButton = $state<HTMLButtonElement | null>(null);
  let forgetHoldDurationMs = $derived(resolveForgetButtonDurationMs($forgetButtonDurationPreference));
  let isForgetHoldEnabled = $derived(forgetHoldDurationMs > 0);

  const visibleItems = $derived.by<BottomBarVisibleItem[]>(() =>
    deriveBottomBarVisibleItems(searchQuery, searchResults, recentNotes, recentTasks)
  );

  const bottomBarState = createBottomBarState({
    getSearchMode: () => searchMode,
    getSearchQuery: () => searchQuery,
    getSearchResults: () => searchResults,
    getRecentNotes: () => recentNotes,
    getRecentTasks: () => recentTasks,
    getVisibleItems: () => visibleItems,
    getForgetHoldDurationMs: () => forgetHoldDurationMs,
    isForgetHoldEnabled: () => isForgetHoldEnabled,
    onSearchInput: (value) => onSearchInput(value),
    onSearchModeChange: (mode) => onSearchModeChange(mode),
    onSearchSelect: (result) => onSearchSelect(result),
    onRecentNoteSelect: (result) => onRecentNoteSelect(result),
    onRecentTaskSelect: (task) => onRecentTaskSelect(task),
    onRecentNoteShortcut: (index) => onRecentNoteShortcut(index),
    onRecentTaskShortcut: (index) => onRecentTaskShortcut(index),
    onSearchFocus: () => onSearchFocus(),
    onCommand: (command) => onCommand?.(command) ?? false,
    onForget: () => onForget()
  });

  // Track only the materially distinguishing fingerprint of the visible
  // items so transient writable-store flips (e.g. isSearching toggling on a
  // keystroke that hasn't changed results yet) do not reset activeIndex.
  const visibleItemsFingerprint = $derived(
    `${searchQuery.trim() === '' ? 'recents' : 'search'}|${visibleItems.length}|${
      visibleItems[0]
        ? visibleItems[0].kind === 'task'
          ? `t:${visibleItems[0].item.taskKey}`
          : `n:${visibleItems[0].item.notePath ?? ''}|${visibleItems[0].item.fileName}|${visibleItems[0].item.sectionLabel ?? ''}|${visibleItems[0].item.matchText ?? ''}`
        : ''
    }`
  );

  $effect(() => {
    visibleItemsFingerprint;
    bottomBarState.resetActiveIndex();
  });

  $effect(() => {
    canUnforget;
    if (canUnforget) {
      bottomBarState.resetForgetHold();
    }
  });

  $effect(() => {
    $forgetButtonDurationPreference;
    bottomBarState.resetForgetHold();
  });

  $effect(() => {
    if (!$bottomBarState.isForgetConfirmOpen) {
      return;
    }

    void tick().then(() => {
      forgetCancelButton?.focus();
    });
  });

  $effect(() => {
    focusRequest;
    bottomBarState.handleFocusRequest(focusRequest);
  });

  $effect(() => {
    $bottomBarState.isSearchFocused;
    $bottomBarState.activeIndex;
    visibleItems;
    void bottomBarState.syncActiveItemIntoView();
  });

  $effect(() => {
    bottomBarState.bindSearchInput(searchInput);
    bottomBarState.bindSearchResultsViewport(searchResultsViewport);
  });

  onDestroy(() => {
    bottomBarState.dispose();
  });

  function getRecentNotesViewportClass() {
    return 'h-[13.75rem] overflow-y-auto';
  }

  function getRecentTasksViewportClass() {
    return 'h-[15rem] overflow-y-auto';
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

  function handleRemember() {
    onRemember();
  }

  function closeForgetConfirm(restoreFocusToForgetButton = false) {
    bottomBarState.closeForgetConfirm();
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

<div
  data-notepad-bottom-bar
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
        aria-label="Unforget"
      >
        <span class="hidden min-[700px]:inline">unForget</span>
        <Undo2 class="h-5 w-5 min-[700px]:hidden" />
      </button>
    {:else}
      <div
        class={`relative inline-flex shrink-0 items-center rounded-full border bg-background p-1 text-muted-foreground shadow-sm ${
          $bottomBarState.isHoldingForget ? 'border-destructive/70' : 'border-border'
        }`}
      >
        {#if $bottomBarState.isForgetConfirmOpen}
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
                  The note moves to Forgotten Notes and can be restored from Settings.
                </p>
              </div>
            </div>
            <div class="mt-3 flex justify-end gap-2">
              <button
                bind:this={forgetCancelButton}
                type="button"
                class="inline-flex h-8 items-center rounded-full px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                onclick={() => closeForgetConfirm(true)}
              >
                Cancel
              </button>
              <button
                type="button"
                class="inline-flex h-8 items-center rounded-full bg-destructive px-3 text-xs font-semibold text-destructive-foreground transition-colors hover:bg-destructive/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-destructive"
                onclick={bottomBarState.confirmForget}
              >
                Forget
              </button>
            </div>
          </div>
        {/if}
        <button
          bind:this={forgetButton}
          type="button"
          aria-expanded={$bottomBarState.isForgetConfirmOpen}
          aria-controls={$bottomBarState.isForgetConfirmOpen ? 'forget-confirm-popover' : undefined}
          class={`relative isolate inline-flex h-8 w-8 items-center justify-center overflow-hidden rounded-full p-0 font-medium transition-colors hover:bg-destructive/20 hover:text-destructive active:bg-destructive/15 active:text-destructive focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-destructive min-[700px]:h-auto min-[700px]:w-auto min-[700px]:min-w-[126px] min-[700px]:px-5 min-[700px]:py-2 ${
            $bottomBarState.isHoldingForget
              ? 'text-destructive animate-[forget-hold-pulse_0.95s_ease-in-out_infinite_alternate]'
              : ''
          }`}
          style={`--forget-progress: ${$bottomBarState.forgetHoldProgress};`}
          aria-label={bottomBarState.getForgetButtonAriaLabel()}
          onclick={bottomBarState.handleForgetClick}
          onpointerdown={bottomBarState.handleForgetPointerDown}
          onpointerup={bottomBarState.cancelForgetHold}
          onpointerleave={bottomBarState.cancelForgetHold}
          onpointercancel={bottomBarState.cancelForgetHold}
          onkeydown={bottomBarState.handleForgetKeyDown}
          onkeyup={bottomBarState.handleForgetKeyUp}
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
              $bottomBarState.isHoldingForget ? '-translate-y-px' : ''
            }`}
          />
        </button>
      </div>
    {/if}

    <div
      class="search-bar search-bar-shell relative flex max-w-2xl flex-1 min-w-0 items-center gap-2 overflow-visible rounded-full border border-border/70 bg-background pl-3 pr-1 sm:gap-3 sm:pl-5"
      onfocusin={bottomBarState.handleSearchFocus}
      onfocusout={bottomBarState.handleSearchBlur}
    >
      <Search class="w-4 h-4 shrink-0 text-muted-foreground" />
      <div class="flex-1 min-w-0">
        <input
          bind:this={searchInput}
          type="text"
          autocomplete="off"
          inputmode="search"
          enterkeyhint="search"
          class="search-bar-input w-full py-1.5 text-base text-foreground outline-none placeholder:text-muted-foreground min-[700px]:text-sm sm:py-2"
          placeholder={bottomBarState.getSearchPlaceholder()}
          value={searchQuery}
          oninput={bottomBarState.handleSearchInput}
          onkeydown={bottomBarState.handleSearchKeydown}
        />
      </div>

      <div class="search-mode-toggle flex shrink-0 items-center gap-1 rounded-full bg-card/80 p-1">
        {#if searchQuery.length > 0}
          <button
            type="button"
            class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground sm:h-9 sm:w-9"
            aria-label="Clear search"
            onmousedown={(event) => event.preventDefault()}
            onclick={bottomBarState.handleSearchClear}
          >
            <X class="h-4 w-4" />
          </button>
        {/if}
        <button
          type="button"
          class="search-mode-button inline-flex h-8 w-8 items-center justify-center rounded-full bg-transparent text-xs font-medium text-muted-foreground transition-[background-color,color,box-shadow] hover:bg-accent hover:text-accent-foreground sm:h-9 sm:w-9"
          class:search-mode-button-active={$bottomBarState.isSearchFocused && searchMode === 'current'}
          onmousedown={(event) => event.preventDefault()}
          onclick={() => bottomBarState.handleSearchModeClick('current')}
          aria-label="Current notes"
        >
          <StickyNote class="h-4 w-4" />
        </button>
        <button
          type="button"
          class="search-mode-button inline-flex h-8 w-8 items-center justify-center rounded-full bg-transparent text-xs font-medium text-muted-foreground transition-[background-color,color,box-shadow] hover:bg-accent hover:text-accent-foreground sm:h-9 sm:w-9"
          class:search-mode-button-active={$bottomBarState.isSearchFocused && searchMode === 'all'}
          onmousedown={(event) => event.preventDefault()}
          onclick={() => bottomBarState.handleSearchModeClick('all')}
          aria-label="All notes"
        >
          <BookOpen class="h-4 w-4" />
        </button>
      </div>

      {#if $bottomBarState.isSearchFocused}
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
            <div
              bind:this={searchResultsViewport}
              class="flex flex-col gap-3 lg:flex-row lg:items-stretch lg:gap-0"
            >
              {#if recentNotes.length > 0}
                <section class="min-w-0 flex-1 lg:pr-3">
                  <div class="px-4 pb-2 pt-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                    Recent Notes
                  </div>
                  <div class={getRecentNotesViewportClass()}>
                    {#each recentNotes as item, index (`note-${item.notePath ?? 'current'}-${item.fileName}-${index}`)}
                      <button
                        type="button"
                        data-search-result-active={index === $bottomBarState.activeIndex ? 'true' : 'false'}
                        class={getRecentNoteItemClass()}
                        class:bg-accent={index === $bottomBarState.activeIndex}
                        onmousedown={(event) => event.preventDefault()}
                        onclick={() => bottomBarState.selectItem({ kind: 'note', item })}
                      >
                        <span class="truncate text-sm font-semibold text-popover-foreground">{item.fileName}</span>
                      </button>
                    {/each}
                  </div>
                </section>
              {/if}

              {#if recentTasks.length > 0}
                <section
                  class={`min-w-0 flex-1 ${
                    recentNotes.length > 0
                      ? 'border-t border-border/70 pt-2 lg:border-t-0 lg:border-l lg:border-border/70 lg:pl-3 lg:pt-0'
                      : ''
                  }`}
                >
                  <div class="px-4 pb-2 pt-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                    Recent Tasks
                  </div>
                  <div class={getRecentTasksViewportClass()}>
                    {#each recentTasks as item, index (`task-${item.taskKey}-${index}`)}
                      {@const globalIndex = recentNotes.length + index}
                      <button
                        type="button"
                        data-search-result-active={globalIndex === $bottomBarState.activeIndex ? 'true' : 'false'}
                        class={getRecentTaskItemClass()}
                        class:bg-accent={globalIndex === $bottomBarState.activeIndex}
                        onmousedown={(event) => event.preventDefault()}
                        onclick={() => bottomBarState.selectItem({ kind: 'task', item })}
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
                  data-search-result-active={index === $bottomBarState.activeIndex ? 'true' : 'false'}
                  class={getSearchResultItemClass()}
                  class:bg-accent={index === $bottomBarState.activeIndex}
                  onmousedown={(event) => event.preventDefault()}
                  onclick={() => bottomBarState.selectItem({ kind: 'search', item })}
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

    <div
      class="inline-flex shrink-0 items-center rounded-full border border-border bg-background p-1 text-muted-foreground shadow-sm"
    >
      <button
        class="inline-flex h-8 w-8 items-center justify-center rounded-full p-0 font-medium transition-colors hover:bg-accent hover:text-accent-foreground active:bg-accent/80 min-[700px]:h-auto min-[700px]:w-auto min-[700px]:min-w-[126px] min-[700px]:px-5 min-[700px]:py-2"
        type="button"
        onclick={handleRemember}
        aria-label="New Idea"
        title="New Idea"
      >
        <span class="hidden min-[700px]:inline">New Idea</span>
        <Brain class="h-5 w-5 min-[700px]:hidden" />
      </button>
    </div>
  </div>
</div>

<style>
  .search-mode-button {
    box-shadow: inset 0 0 0 1px transparent;
  }

  .search-mode-button-active {
    background: color-mix(in oklab, var(--foreground) 18%, var(--background));
    color: var(--foreground);
    box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--foreground) 16%, transparent);
  }

  .search-mode-button-active:hover {
    background: color-mix(in oklab, var(--foreground) 22%, var(--background));
    color: var(--foreground);
  }

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
