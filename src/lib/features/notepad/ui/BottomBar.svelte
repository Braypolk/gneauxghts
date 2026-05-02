<script lang="ts">
  import { onDestroy } from 'svelte';
  import { Search, Eraser, Undo2, Brain, StickyNote, BookOpen, Circle, ChevronDown } from 'lucide-svelte';
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
  import {
    rememberActionRequiresIntegrateSupport,
    type RememberActionOption
  } from '$lib/types/ai';

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

  const rememberActions = $derived(remember.rememberActions);
  const defaultRememberActionId = $derived(remember.defaultRememberActionId);
  const integrateEnabled = $derived(remember.integrateEnabled);
  const integrateDisabledReason = $derived(remember.integrateDisabledReason);
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
  let rememberMenuShell = $state<HTMLDivElement | null>(null);
  let forgetHoldDurationMs = $derived(resolveForgetButtonDurationMs($forgetButtonDurationPreference));
  let isForgetHoldEnabled = $derived(forgetHoldDurationMs > 0);
  const rememberModeSections = $derived(
    [
      {
        heading: 'Remember',
        options: rememberActions.filter((option) => option.family === 'exact')
      },
      {
        heading: 'Transform Note',
        options: rememberActions.filter((option) => option.family === 'edit')
      },
      {
        heading: 'Split Or Organize',
        options: rememberActions.filter((option) => option.family === 'organize')
      },
      {
        heading: 'Integrate Into Vault',
        options: rememberActions.filter((option) => option.family === 'integrate')
      }
    ].filter((section) => section.options.length > 0)
  );

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

  $effect(() => {
    if (!$bottomBarState.isRememberMenuOpen || typeof window === 'undefined') {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || !rememberMenuShell?.contains(event.target)) {
        bottomBarState.setRememberMenuOpen(false);
      }
    };

    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        bottomBarState.setRememberMenuOpen(false);
      }
    };

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeydown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeydown);
    };
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

  function resolveRememberAction(actionId: string): RememberActionOption {
    return (
      rememberActions.find((option) => option.id === actionId) ??
      rememberActions.find((option) => option.family === 'exact') ??
      rememberActions[0]
    );
  }

  function resolvePrimaryRememberAction(): RememberActionOption {
    const preferred = resolveRememberAction(defaultRememberActionId);
    if (rememberActionRequiresIntegrateSupport(preferred) && !integrateEnabled) {
      return resolveRememberAction('exact');
    }
    return preferred;
  }

  const primaryRememberAction = $derived(resolvePrimaryRememberAction());

  function isRememberActionDisabled(action: RememberActionOption) {
    return rememberActionRequiresIntegrateSupport(action) && !integrateEnabled;
  }

  function handleRemember(action: RememberActionOption) {
    if (isRememberActionDisabled(action)) {
      return;
    }
    bottomBarState.setRememberMenuOpen(false);
    onRemember(action);
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
      <button
        type="button"
        class={`relative isolate inline-flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-background p-0 font-medium text-muted-foreground shadow-sm transition-[color,background-color,border-color,box-shadow] duration-200 hover:border-destructive/40 hover:text-muted-foreground active:text-destructive min-[700px]:h-auto min-[700px]:w-[134px] min-[700px]:px-6 min-[700px]:py-2.5 ${
          $bottomBarState.isHoldingForget
            ? 'border-destructive/70 text-destructive animate-[forget-hold-pulse_0.95s_ease-in-out_infinite_alternate]'
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
          class="absolute inset-0 z-0 origin-left rounded-[inherit] bg-destructive/35 transition-[transform,opacity] duration-150 ease-linear"
          style="transform: scaleX(var(--forget-progress, 0)); opacity: calc(0.14 + (var(--forget-progress, 0) * 0.58));"
          aria-hidden="true"
        ></span>
        <span class="relative z-10 hidden transition duration-200 min-[700px]:inline">
          Forget
        </span>
        <Eraser
          class={`relative z-10 h-5 w-5 transition-transform duration-200 min-[700px]:hidden ${
            $bottomBarState.isHoldingForget ? '-translate-y-px' : ''
          }`}
        />
      </button>
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

    <div bind:this={rememberMenuShell} class="relative shrink-0">
      <div class="inline-flex items-center gap-1 rounded-full border border-border bg-background p-1 text-muted-foreground shadow-sm">
        <button
          class="inline-flex h-8 w-8 items-center justify-center rounded-full p-0 font-medium transition-colors hover:bg-accent hover:text-accent-foreground min-[700px]:h-auto min-[700px]:w-auto min-[700px]:min-w-[126px] min-[700px]:px-5 min-[700px]:py-2"
          type="button"
          onclick={() => handleRemember(primaryRememberAction)}
          aria-label={primaryRememberAction.label}
          title={primaryRememberAction.label}
        >
          <span class="hidden min-[700px]:inline">{primaryRememberAction.label}</span>
          <Brain class="h-5 w-5 min-[700px]:hidden" />
        </button>
        <button
          class="inline-flex h-8 w-8 items-center justify-center rounded-full bg-muted/55 p-0 transition-colors hover:bg-accent hover:text-accent-foreground"
          type="button"
          aria-expanded={$bottomBarState.isRememberMenuOpen}
          aria-haspopup="menu"
          aria-label="Remember modes"
          onclick={bottomBarState.toggleRememberMenu}
        >
          <ChevronDown class={`h-4 w-4 transition-transform ${$bottomBarState.isRememberMenuOpen ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {#if $bottomBarState.isRememberMenuOpen}
        <div
          class="absolute bottom-[calc(100%+0.5rem)] right-0 z-40 max-h-[28rem] w-[22rem] overflow-y-auto rounded-[1.2rem] border border-border bg-popover/95 p-2 shadow-xl backdrop-blur-md"
          role="menu"
          aria-label="Remember modes"
        >
          {#each rememberModeSections as section, sectionIndex (section.heading)}
            <section class={sectionIndex > 0 ? 'mt-3 border-t border-border/70 pt-3' : ''}>
              <div class="px-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                {section.heading}
              </div>
              {#each section.options as option, optionIndex (option.id)}
                <button
                  type="button"
                  class={`flex w-full flex-col items-start rounded-[1rem] px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-55 hover:bg-accent ${
                    optionIndex > 0 ? 'mt-1' : ''
                  }`}
                  role="menuitem"
                  disabled={isRememberActionDisabled(option)}
                  title={isRememberActionDisabled(option) ? integrateDisabledReason ?? undefined : option.description}
                  onclick={() => handleRemember(option)}
                >
                  <span class="text-sm font-medium text-popover-foreground">{option.label}</span>
                  <span class="mt-0.5 text-xs text-muted-foreground">
                    {#if isRememberActionDisabled(option)}
                      {integrateDisabledReason ?? 'Integrate is unavailable right now.'}
                    {:else}
                      {option.description}
                    {/if}
                  </span>
                </button>
              {/each}
            </section>
          {/each}
        </div>
      {/if}
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
