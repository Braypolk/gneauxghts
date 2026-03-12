<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import { Search, Eraser, Undo2, Brain, StickyNote, BookOpen } from 'lucide-svelte';

  interface TextRange {
    start: number;
    end: number;
  }

  interface SearchItem {
    notePath: string | null;
    fileName: string;
    sectionLabel: string;
    excerpt: string;
    highlightRanges: TextRange[];
    matchText: string;
  }

  interface Props {
    canUnforget: boolean;
    onForget: () => void;
    onUnforget: () => void;
    onRemember: () => void;
    searchMode: 'current' | 'all';
    searchQuery: string;
    searchResults: SearchItem[];
    recentNotes: SearchItem[];
    isSearching: boolean;
    onSearchInput: (value: string) => void;
    onSearchModeChange: (mode: 'current' | 'all') => void | Promise<void>;
    onSearchSelect: (result: SearchItem) => void;
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
    isSearching,
    onSearchInput,
    onSearchModeChange,
    onSearchSelect,
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

  function getVisibleItems() {
    return searchQuery.trim() === '' ? recentNotes : searchResults;
  }

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
    searchQuery;
    searchResults;
    recentNotes;
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
    searchQuery;
    searchResults;
    recentNotes;

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

  function selectItem(item: SearchItem) {
    closeSearchPanel();
    onSearchSelect(item);
  }

  function handleSearchKeydown(event: KeyboardEvent) {
    const items = getVisibleItems();
    const isPanelVisible = isSearchFocused && (searchQuery.trim() !== '' || recentNotes.length > 0);

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
</script>

<div class="relative rounded-2xl shadow-lg min-w-0 overflow-visible">
  <div
    class="absolute inset-0 rounded-2xl bg-white/70 backdrop-blur-md"
    style="mask-image: linear-gradient(to bottom, transparent 0%, black 40%, black 100%); -webkit-mask-image: linear-gradient(to bottom, transparent 0%, black 40%, black 100%); mask-size: 100% 100%; -webkit-mask-size: 100% 100%;"
  ></div>
  <div class="relative z-10 flex items-center justify-between gap-4 py-4 px-6 min-w-0">
    {#if canUnforget}
      <button
        type="button"
        class="bottom-bar-action-button min-[700px]:w-[134px] px-6 py-2.5 bg-gray-200 hover:bg-gray-300 text-gray-800 font-medium rounded-full transition-colors shadow-sm cursor-pointer border border-gray-200 shrink-0"
        onclick={() => onUnforget()}
        aria-label="Unforget"
      >
        <span class="bottom-bar-action-label">unForget</span>
        <Undo2 class="bottom-bar-action-icon hidden h-5 w-5" />
      </button>
    {:else}
      <button
        type="button"
        class="bottom-bar-action-button forget-hold-button min-[700px]:w-[134px] px-6 py-2.5 bg-[#f8f9fa] hover:bg-gray-100 text-gray-700 font-medium rounded-full transition-colors shadow-sm cursor-pointer border border-gray-100 shrink-0"
        class:forget-hold-button-active={isHoldingForget}
        style={`--forget-progress: ${forgetHoldProgress};`}
        aria-label="Hold to forget"
        onpointerdown={handleForgetPointerDown}
        onpointerup={cancelForgetHold}
        onpointerleave={cancelForgetHold}
        onpointercancel={cancelForgetHold}
        onkeydown={handleForgetKeyDown}
        onkeyup={handleForgetKeyUp}
      >
        <span class="forget-hold-progress" aria-hidden="true"></span>
        <span class="forget-hold-spark" aria-hidden="true"></span>
        <span class="bottom-bar-action-label relative z-10">Forget</span>
        <Eraser class="bottom-bar-action-icon relative z-10 hidden h-5 w-5" />
      </button>
    {/if}

    <div
      class="search-bar search-bar-shell relative flex-1 min-w-0 max-w-2xl flex items-center gap-3 rounded-full pl-5 border border-gray-200/60 overflow-visible bg-[#f8f9fa]"
      onfocusin={handleSearchFocus}
      onfocusout={handleSearchBlur}
    >
      <Search class="w-4 h-4 shrink-0 text-gray-400" />
      <div class="search-bar-input-wrap flex-1 min-w-0">
        <input
          bind:this={searchInput}
          type="text"
          autocomplete="off"
          class="search-bar-input w-full py-1.5 outline-none text-gray-700 placeholder:text-gray-400 text-sm"
          placeholder={getSearchPlaceholder()}
          value={searchQuery}
          oninput={handleSearchInput}
          onkeydown={handleSearchKeydown}
        />
      </div>

      <div class="search-mode-toggle flex items-center gap-1 rounded-full bg-white/80 p-1 shrink-0">
        <button
          type="button"
          class:search-mode-button-active={isSearchFocused && searchMode === 'current'}
          class="search-mode-button inline-flex h-9 w-9 items-center justify-center rounded-full text-xs font-medium text-gray-500 transition-colors"
          onmousedown={(event) => event.preventDefault()}
          onclick={() => handleSearchModeClick('current')}
          aria-label="Current notes"
        >
          <StickyNote class="h-4 w-4" />
        </button>
        <button
          type="button"
          class:search-mode-button-active={isSearchFocused && searchMode === 'all'}
          class="search-mode-button inline-flex h-9 w-9 items-center justify-center rounded-full text-xs font-medium text-gray-500 transition-colors"
          onmousedown={(event) => event.preventDefault()}
          onclick={() => handleSearchModeClick('all')}
          aria-label="All notes"
        >
          <BookOpen class="h-4 w-4" />
        </button>
      </div>

      {#if isSearchFocused}
        <div class="search-results-panel absolute bottom-[calc(100%+0.85rem)] left-0 right-0 z-30 rounded-[1.5rem] border border-gray-200 bg-white/95 p-2 shadow-xl backdrop-blur-md">
          {#if searchQuery.trim() === ''}
            <div class="px-4 pb-2 pt-3 text-xs font-semibold uppercase tracking-[0.2em] text-gray-400">
              Recent Notes
            </div>
          {/if}

          {#if isSearching && searchQuery.trim() !== ''}
            <div class="px-4 py-3 text-sm text-gray-500">Searching notes…</div>
          {:else if getVisibleItems().length === 0}
            <div class="px-4 py-3 text-sm text-gray-500">
              {#if searchQuery.trim() === ''}
                No recent notes yet.
              {:else}
                No notes found.
              {/if}
            </div>
          {:else}
            <div bind:this={searchResultsViewport} class="max-h-80 overflow-y-auto">
              {#each getVisibleItems() as item, index (`${item.notePath ?? 'current'}-${item.sectionLabel}-${item.matchText}-${index}`)}
                <button
                  type="button"
                  data-search-result-active={index === activeIndex ? 'true' : 'false'}
                  class:search-result-item-active={index === activeIndex}
                  class="search-result-item flex w-full flex-col gap-2 rounded-[1.1rem] px-4 py-3 text-left transition-colors hover:bg-gray-100"
                  onmousedown={(event) => event.preventDefault()}
                  onclick={() => selectItem(item)}
                >
                  <div class="flex items-start justify-between gap-3">
                    <span class="text-sm font-semibold text-gray-900">
                      {#if searchQuery.trim() === '' || searchMode === 'all'}
                        {item.fileName}
                      {:else}
                        {item.sectionLabel}
                      {/if}
                    </span>
                    {#if searchQuery.trim() !== '' || item.sectionLabel !== 'Title'}
                      <span class="shrink-0 text-[11px] font-medium uppercase tracking-[0.16em] text-gray-400">
                        {item.sectionLabel}
                      </span>
                    {/if}
                  </div>
                  <p class="line-clamp-3 text-sm leading-relaxed text-gray-600">
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
      class="bottom-bar-action-button min-[700px]:w-[134px] px-6 py-2.5 bg-[#f8f9fa] hover:bg-gray-100 text-gray-700 font-medium rounded-full transition-colors shadow-sm cursor-pointer border border-gray-100 shrink-0"
      type="button"
      onclick={() => onRemember()}
      aria-label="Remember"
    >
      <span class="bottom-bar-action-label">Remember</span>
      <Brain class="bottom-bar-action-icon hidden h-5 w-5" />
    </button>
  </div>
</div>
