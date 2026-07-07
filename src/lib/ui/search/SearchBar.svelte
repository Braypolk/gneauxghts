<script module lang="ts">
  import type { Component } from 'svelte';

  export interface SearchChoice {
    id: string;
    label: string;
    shortLabel?: string;
    ariaLabel?: string;
    title?: string;
    icon?: Component<{ class?: string }>;
    disabled?: boolean;
    tone?: string;
  }
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';
  import {
    BookOpen,
    CaseSensitive,
    ChevronDown,
    ChevronUp,
    Search,
    StickyNote,
    WholeWord,
    X
  } from '@lucide/svelte';
  import { keyboardShortcutMatchesEvent } from '$lib/keyboardShortcuts';

  interface SearchShortcutOptions {
    enabled: boolean;
    defaultScopeId?: string;
    allScopeId?: string;
  }

  interface Props {
    value: string;
    placeholder: string;
    ariaLabel: string;
    focusRequest?: number;
    blurRequest?: number;
    matchCase?: boolean;
    matchWholeWord?: boolean;
    showMatchOptions?: boolean;
    scopeId?: string;
    scopeOptions?: SearchChoice[];
    searchTypeId?: string;
    searchTypeOptions?: SearchChoice[];
    canNavigatePrevious?: boolean;
    canNavigateNext?: boolean;
    blurOnEscape?: boolean;
    shortcut?: SearchShortcutOptions;
    class?: string;
    onValueChange: (value: string) => void;
    onOpen?: () => void | Promise<void>;
    onClear?: () => void;
    onScopeChange?: (scopeId: string) => void | Promise<void>;
    onSearchTypeChange?: (searchTypeId: string) => void | Promise<void>;
    onMatchCaseChange?: (enabled: boolean) => void | Promise<void>;
    onMatchWholeWordChange?: (enabled: boolean) => void | Promise<void>;
    onNavigate?: (delta: 1 | -1) => void | Promise<void>;
    onInputKeydown?: (event: KeyboardEvent) => void;
    panel?: Snippet;
    children?: Snippet;
  }

  let {
    value,
    placeholder,
    ariaLabel,
    focusRequest = 0,
    blurRequest = 0,
    matchCase = false,
    matchWholeWord = false,
    showMatchOptions = false,
    scopeId,
    scopeOptions = [],
    searchTypeId,
    searchTypeOptions = [],
    canNavigatePrevious = false,
    canNavigateNext = false,
    blurOnEscape = true,
    shortcut = { enabled: false },
    class: className = '',
    onValueChange,
    onOpen,
    onClear,
    onScopeChange,
    onSearchTypeChange,
    onMatchCaseChange,
    onMatchWholeWordChange,
    onNavigate,
    onInputKeydown,
    panel,
    children
  }: Props = $props();

  let inputEl = $state<HTMLInputElement | null>(null);
  let shellEl = $state<HTMLDivElement | null>(null);
  let focused = $state(false);
  let lastHandledFocusRequest = $state(0);
  let lastHandledBlurRequest = $state(0);

  const isExpanded = $derived(focused || value.trim() !== '');
  const activeScope = $derived(scopeOptions.find((option) => option.id === scopeId) ?? null);
  const activeSearchType = $derived(searchTypeOptions.find((option) => option.id === searchTypeId) ?? null);
  const activeTone = $derived(activeSearchType?.tone ?? activeScope?.tone ?? scopeId ?? 'default');

  $effect(() => {
    if (focusRequest === 0 || focusRequest === lastHandledFocusRequest) return;
    lastHandledFocusRequest = focusRequest;
    focusInput({ select: true });
  });

  $effect(() => {
    if (blurRequest === 0 || blurRequest === lastHandledBlurRequest) return;
    lastHandledBlurRequest = blurRequest;
    blurSearch();
  });

  function focusInput({ select = false }: { select?: boolean } = {}) {
    requestAnimationFrame(() => {
      inputEl?.focus();
      if (select) {
        inputEl?.select();
      }
    });
  }

  function setFocused(nextFocused: boolean) {
    if (focused === nextFocused) return;
    focused = nextFocused;
    if (nextFocused) {
      void onOpen?.();
    }
  }

  function handleFocusIn() {
    setFocused(true);
  }

  function handleFocusOut(event: FocusEvent) {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && shellEl?.contains(nextTarget)) {
      return;
    }
    setFocused(false);
  }

  function handleInput(event: Event) {
    onValueChange((event.currentTarget as HTMLInputElement).value);
  }

  function blurSearch() {
    setFocused(false);
    inputEl?.blur();
  }

  function handleInputKeydown(event: KeyboardEvent) {
    onInputKeydown?.(event);
    if (event.defaultPrevented || event.key !== 'Escape' || !blurOnEscape) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    blurSearch();
  }

  function handleClear() {
    onValueChange('');
    onClear?.();
    focusInput();
  }

  async function selectScope(nextScopeId: string) {
    const selectionStart = inputEl?.selectionStart ?? null;
    const selectionEnd = inputEl?.selectionEnd ?? null;
    await onScopeChange?.(nextScopeId);
    focusInput();
    requestAnimationFrame(() => {
      if (!inputEl || selectionStart === null || selectionEnd === null) return;
      inputEl.setSelectionRange(selectionStart, selectionEnd);
    });
  }

  async function selectSearchType(nextSearchTypeId: string) {
    await onSearchTypeChange?.(nextSearchTypeId);
    focusInput();
  }

  function handleWindowKeydown(event: KeyboardEvent) {
    if (!shortcut.enabled || event.defaultPrevented) return;

    if (keyboardShortcutMatchesEvent(event, 'searchAll')) {
      const allScopeId = shortcut.allScopeId;
      const allScope = allScopeId
        ? scopeOptions.find((option) => option.id === allScopeId && !option.disabled)
        : null;
      if (!allScope) return;
      event.preventDefault();
      void selectScope(allScope.id);
      focusInput({ select: true });
      return;
    }

    if (keyboardShortcutMatchesEvent(event, 'searchCurrent')) {
      event.preventDefault();
      const defaultScopeId = shortcut.defaultScopeId;
      const defaultScope = defaultScopeId
        ? scopeOptions.find((option) => option.id === defaultScopeId && !option.disabled)
        : null;
      if (defaultScope) {
        void selectScope(defaultScope.id);
      }
      focusInput({ select: true });
    }
  }

  function getScopeIcon(choice: SearchChoice) {
    if (choice.icon) return choice.icon;
    if (choice.id === 'all') return BookOpen;
    return StickyNote;
  }
</script>

<svelte:window onkeydowncapture={handleWindowKeydown} />

<div
  bind:this={shellEl}
  class={`shared-search-bar-shell pointer-events-auto relative flex max-w-2xl flex-1 min-w-0 items-center gap-2 overflow-visible rounded-full border pl-3 pr-1 shadow-sm backdrop-blur-md sm:gap-3 sm:pl-5 ${className}`}
  data-search-tone={activeTone}
  data-search-expanded={isExpanded ? 'true' : 'false'}
  data-search-active={focused ? 'true' : 'false'}
  onfocusin={handleFocusIn}
  onfocusout={handleFocusOut}
>
  <Search class="h-4 w-4 shrink-0 text-muted-foreground" />
  <div class="min-w-0 flex-1">
    <input
      bind:this={inputEl}
      type="text"
      autocomplete="off"
      inputmode="search"
      enterkeyhint="search"
      class="shared-search-bar-input w-full bg-transparent py-1.5 text-base text-foreground outline-none placeholder:text-muted-foreground min-[700px]:text-sm sm:py-2"
      aria-label={ariaLabel}
      placeholder={focused ? placeholder : ''}
      value={value}
      oninput={handleInput}
      onkeydown={handleInputKeydown}
    />
  </div>

  <div class="shared-search-controls flex shrink-0 items-center gap-0.5">
    {#if value.length > 0}
      <button
        type="button"
        class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        aria-label="Clear search"
        title="Clear search"
        onmousedown={(event) => event.preventDefault()}
        onclick={handleClear}
      >
        <X class="h-4 w-4" />
      </button>
    {/if}

    {#if value.trim() !== '' && onNavigate}
      <button
        type="button"
        class="shared-search-option-button inline-flex h-8 min-w-8 items-center justify-center rounded-full bg-transparent px-2 text-muted-foreground transition-[background-color,color,box-shadow] hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-40"
        aria-label="Previous match"
        title="Previous match"
        disabled={!canNavigatePrevious}
        onmousedown={(event) => event.preventDefault()}
        onclick={() => void onNavigate?.(-1)}
      >
        <ChevronUp class="h-4 w-4" />
      </button>
      <button
        type="button"
        class="shared-search-option-button inline-flex h-8 min-w-8 items-center justify-center rounded-full bg-transparent px-2 text-muted-foreground transition-[background-color,color,box-shadow] hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-40"
        aria-label="Next match"
        title="Next match"
        disabled={!canNavigateNext}
        onmousedown={(event) => event.preventDefault()}
        onclick={() => void onNavigate?.(1)}
      >
        <ChevronDown class="h-4 w-4" />
      </button>
    {/if}

    {#if focused && showMatchOptions}
      <button
        type="button"
        class="shared-search-option-button inline-flex h-8 min-w-8 items-center justify-center rounded-full bg-transparent px-2 text-muted-foreground transition-[background-color,color,box-shadow] hover:bg-accent hover:text-accent-foreground"
        class:shared-search-option-button-active={matchCase}
        aria-label={matchCase ? 'Disable match case' : 'Enable match case'}
        aria-pressed={matchCase}
        title="Match case"
        onmousedown={(event) => event.preventDefault()}
        onclick={() => void onMatchCaseChange?.(!matchCase)}
      >
        <CaseSensitive class="h-4 w-4" />
      </button>
      <button
        type="button"
        class="shared-search-option-button inline-flex h-8 min-w-8 items-center justify-center rounded-full bg-transparent px-2 text-muted-foreground transition-[background-color,color,box-shadow] hover:bg-accent hover:text-accent-foreground"
        class:shared-search-option-button-active={matchWholeWord}
        aria-label={matchWholeWord ? 'Disable match whole word' : 'Enable match whole word'}
        aria-pressed={matchWholeWord}
        title="Match whole word"
        onmousedown={(event) => event.preventDefault()}
        onclick={() => void onMatchWholeWordChange?.(!matchWholeWord)}
      >
        <WholeWord class="h-4 w-4" />
      </button>
    {/if}

    {#each searchTypeOptions as choice (choice.id)}
      {@const ChoiceIcon = choice.icon}
      <button
        type="button"
        class="shared-search-mode-button inline-flex h-8 min-w-8 items-center justify-center gap-1 rounded-full bg-transparent px-2 text-xs font-medium text-muted-foreground transition-[background-color,color,box-shadow] hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-40"
        class:shared-search-mode-button-active={focused && searchTypeId === choice.id}
        aria-label={choice.ariaLabel ?? choice.label}
        aria-pressed={searchTypeId === choice.id}
        title={choice.title ?? choice.label}
        disabled={choice.disabled}
        onmousedown={(event) => event.preventDefault()}
        onclick={() => void selectSearchType(choice.id)}
      >
        {#if ChoiceIcon}
          <ChoiceIcon class="h-4 w-4" />
        {/if}
        <span class="shared-search-mode-label hidden min-[900px]:inline-block">{choice.shortLabel ?? choice.label}</span>
      </button>
    {/each}

    {#each scopeOptions as choice (choice.id)}
      {@const ChoiceIcon = getScopeIcon(choice)}
      <button
        type="button"
        class="shared-search-mode-button inline-flex h-8 min-w-8 items-center justify-center gap-1 rounded-full bg-transparent px-2 text-xs font-medium text-muted-foreground transition-[background-color,color,box-shadow] hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-40"
        class:shared-search-mode-button-active={focused && scopeId === choice.id}
        aria-label={choice.ariaLabel ?? choice.label}
        aria-pressed={scopeId === choice.id}
        title={choice.title ?? choice.label}
        disabled={choice.disabled}
        onmousedown={(event) => event.preventDefault()}
        onclick={() => void selectScope(choice.id)}
      >
        <ChoiceIcon class="h-4 w-4" />
        <span class="shared-search-mode-label hidden min-[900px]:inline-block">{choice.shortLabel ?? choice.label}</span>
      </button>
    {/each}

    {@render children?.()}
  </div>

  {#if focused}
    {@render panel?.()}
  {/if}
</div>

<style>
  .shared-search-option-button,
  .shared-search-mode-button {
    box-shadow: inset 0 0 0 1px transparent;
  }

  .shared-search-option-button-active,
  .shared-search-mode-button-active {
    background: var(--search-scope-control-active-bg);
    color: var(--search-scope-active-fg);
    box-shadow: inset 0 0 0 1px var(--search-scope-control-active-ring);
  }

  .shared-search-mode-button-active:hover {
    background: var(--search-scope-control-active-hover-bg);
    color: var(--search-scope-active-fg);
  }

  .shared-search-mode-label {
    max-width: 0;
    opacity: 0;
    overflow: hidden;
    transform: translateX(-0.25rem);
    transition:
      max-width 180ms ease,
      opacity 120ms ease,
      transform 160ms ease;
    white-space: nowrap;
  }

  .shared-search-bar-shell {
    --search-scope-bg: color-mix(in oklab, var(--background) 58%, transparent);
    --search-scope-border: color-mix(in oklab, var(--border) 34%, transparent);
    --search-scope-control-active-bg: color-mix(in oklab, var(--foreground) 18%, var(--background));
    --search-scope-control-active-hover-bg: color-mix(in oklab, var(--foreground) 22%, var(--background));
    --search-scope-control-active-ring: color-mix(in oklab, var(--foreground) 16%, transparent);
    --search-scope-active-fg: var(--foreground);
    --search-scope-results-bg: color-mix(in oklab, oklch(0.5969 0.0935 231.27) 3%, var(--popover));
    --search-scope-results-border: var(--border);
    background: var(--search-scope-bg);
    border-color: var(--search-scope-border);
    transition:
      flex-basis 220ms ease,
      max-width 220ms ease,
      background-color 160ms ease,
      border-color 160ms ease;
  }

  @media (min-width: 700px) {
    .shared-search-bar-shell {
      flex: 0 1 24rem;
      max-width: 28rem;
    }

    .shared-search-bar-shell[data-search-expanded='true'] {
      flex: 1 1 42rem;
      max-width: 42rem;
    }
  }

  .shared-search-bar-shell[data-search-expanded='true'] .shared-search-mode-label {
    max-width: 5rem;
    opacity: 1;
    transform: translateX(0);
    transition-delay: 90ms, 110ms, 90ms;
  }

  .shared-search-bar-shell[data-search-expanded='true'] {
    --search-scope-bg: var(--background);
    --search-scope-border: color-mix(in oklab, var(--border) 70%, transparent);
  }

  .shared-search-bar-shell[data-search-tone='all'][data-search-expanded='true'],
  .shared-search-bar-shell[data-search-tone='semantic'][data-search-expanded='true'] {
    --search-scope-bg: color-mix(in oklab, oklch(0.5969 0.0935 231.27) 8%, var(--background));
    --search-scope-border: color-mix(in oklab, oklch(0.5969 0.0935 231.27) 30%, var(--border));
    --search-scope-control-active-bg: color-mix(in oklab, oklch(0.5969 0.0935 231.27) 21%, var(--background));
    --search-scope-control-active-hover-bg: color-mix(in oklab, oklch(0.5969 0.0935 231.27) 28%, var(--background));
    --search-scope-control-active-ring: color-mix(in oklab, oklch(0.5969 0.0935 231.27) 38%, transparent);
    --search-scope-active-fg: color-mix(in oklab, oklch(0.45 0.0935 231.27) 82%, var(--foreground));
    --search-scope-results-bg: color-mix(in oklab, oklch(0.5969 0.0935 231.27) 5%, var(--popover));
    --search-scope-results-border: color-mix(in oklab, oklch(0.5969 0.0935 231.27) 26%, var(--border));
  }

  :global(.dark) .shared-search-bar-shell[data-search-expanded='true'] {
    --search-scope-bg: color-mix(in oklab, var(--background) 92%, var(--card));
    --search-scope-border: color-mix(in oklab, var(--border) 70%, transparent);
  }

  :global(.dark) .shared-search-bar-shell[data-search-tone='all'][data-search-expanded='true'],
  :global(.dark) .shared-search-bar-shell[data-search-tone='semantic'][data-search-expanded='true'] {
    --search-scope-bg: color-mix(in oklab, oklch(0.5969 0.0935 231.27) 14%, var(--background));
    --search-scope-border: color-mix(in oklab, oklch(0.5969 0.0935 231.27) 36%, var(--border));
    --search-scope-control-active-bg: color-mix(in oklab, oklch(0.5969 0.0935 231.27) 28%, var(--background));
    --search-scope-control-active-hover-bg: color-mix(in oklab, oklch(0.5969 0.0935 231.27) 36%, var(--background));
    --search-scope-control-active-ring: color-mix(in oklab, oklch(0.5969 0.0935 231.27) 46%, transparent);
    --search-scope-active-fg: color-mix(in oklab, oklch(0.82 0.075 231.27) 88%, var(--foreground));
    --search-scope-results-bg: color-mix(in oklab, oklch(0.5969 0.0935 231.27) 8%, var(--popover));
    --search-scope-results-border: color-mix(in oklab, oklch(0.5969 0.0935 231.27) 32%, var(--border));
  }

  .shared-search-bar-input {
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
