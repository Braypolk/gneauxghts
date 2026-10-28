<script lang="ts">
  import { keyboardShortcutMatchesEvent } from '#lib/keyboardShortcuts.svelte.js';

  import type { Snippet } from 'svelte';
  import { hasSplitModifiers } from '#lib/features/notepad/navigation/splitNoteDestination.js';
  import SplitSearchResultAction from './SplitSearchResultAction.svelte';
  let { title, label, active = false, resultIndex, icon, detail, onSelect, onPoint, onFocus, onOpenInSplit }: {
    title: string;
    label: string;
    active?: boolean;
    resultIndex?: number;
    icon?: Snippet;
    detail?: Snippet;
    onSelect: () => void;
    onPoint?: () => void;
    onFocus?: () => void;
    onOpenInSplit?: () => void;
  } = $props();
</script>

<div class="flex min-w-0 w-full items-center gap-1" data-search-result-index={resultIndex} data-search-result-row>
  <button
    type="button"
    class={`search-result-item flex min-w-0 w-full flex-1 rounded-[1.1rem] px-4 text-left transition-colors ${detail ? 'flex-col gap-1 py-3' : 'h-[2.75rem] items-center gap-2 py-1.5'}`}
    class:bg-accent={active}
    data-search-result-active={active ? 'true' : 'false'}
    aria-label={label}
    title={title}
    onmousedown={(event) => event.preventDefault()}
    onpointerenter={onPoint}
    onfocus={onFocus}
    onkeydown={(event) => {
      if (onOpenInSplit && keyboardShortcutMatchesEvent(event, 'searchOpenInSplit')) {
        event.preventDefault(); event.stopPropagation(); onOpenInSplit(); return;
      }
      if (event.key !== 'ArrowRight' || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || !onOpenInSplit) return;
      event.preventDefault();
      event.stopPropagation();
      (event.currentTarget.nextElementSibling as HTMLButtonElement | null)?.focus();
    }}
    onclick={(event) => hasSplitModifiers(event) && onOpenInSplit ? onOpenInSplit() : onSelect()}
  >
    {#if icon}{@render icon()}{/if}
    <span class="menu-label block min-w-0 max-w-full truncate text-popover-foreground">{title}</span>
    {#if detail}{@render detail()}{/if}
  </button>
  {#if onOpenInSplit}<SplitSearchResultAction {title} onSelect={onOpenInSplit} {onFocus} />{/if}
</div>
