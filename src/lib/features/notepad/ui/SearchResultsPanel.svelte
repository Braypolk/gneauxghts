<script lang="ts">
  import type { Snippet } from 'svelte';
  import { searchResultsReveal } from './searchResultsReveal';

  let { children, navigationMode }: { children: Snippet; navigationMode: string } = $props();
</script>

<div
  class="search-results-panel absolute bottom-[calc(var(--search-results-anchor-height,100%)+0.5rem)] left-0 right-0 z-30 rounded-[1.2rem] border p-2 shadow-xl backdrop-blur-md sm:bottom-[calc(var(--search-results-anchor-height,100%)+0.85rem)] sm:rounded-[1.5rem]"
  data-search-navigation-mode={navigationMode}
  transition:searchResultsReveal|global
>
  {@render children()}
</div>

<style>
  .search-results-panel {
    /* The dock publishes its destination width before its visible bar expands.
       Reveal a fixed layout from the existing base rather than resizing text. */
    width: var(--dock-search-results-width, 100%);
    left: var(--dock-search-results-center, 50%);
    right: auto;
    transform: translateX(-50%);
    max-height: max(5rem, calc(100dvh - var(--search-results-anchor-height, 3.25rem) - 8rem - var(--keyboard-inset-height, 0px)));
    overflow-y: auto;
    overscroll-behavior: contain;
    background: var(--search-scope-results-bg, var(--popover));
    border-color: var(--search-scope-results-border, var(--border));
    transition:
      background-color 160ms ease,
      border-color 160ms ease;
  }
  .search-results-panel[data-search-navigation-mode='pointer'] :global(.search-result-item:hover) {
    background: var(--accent);
  }
</style>
