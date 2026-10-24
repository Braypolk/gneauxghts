<script lang="ts">
  import type { Snippet } from 'svelte';
  import { searchResultsReveal } from './searchResultsReveal';

  let { children, navigationMode, busy = false, onkeydown }: { children: Snippet; navigationMode: string; busy?: boolean; onkeydown?: (event: KeyboardEvent) => void } = $props();

  function preserveFocus(event: MouseEvent) {
    // Padding, headings and empty states belong to the popup too. Let its
    // controls manage their own focus, but don't blur search on background hits.
    if (event.target instanceof Element
      && !event.target.closest('button, a[href], input, select, textarea, [contenteditable="true"]')) {
      event.preventDefault();
    }
  }
</script>

<!-- Arrow keys are delegated from the focusable result buttons within this group. -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="search-results-panel absolute bottom-[calc(var(--search-results-anchor-height,100%)+0.5rem)] left-0 right-0 z-30 rounded-[1.2rem] border p-2 shadow-xl backdrop-blur-md sm:bottom-[calc(var(--search-results-anchor-height,100%)+0.85rem)] sm:rounded-[1.5rem]"
  data-search-navigation-mode={navigationMode}
  role="group"
  aria-label="Note discovery results"
  aria-busy={busy}
  onmousedown={preserveFocus}
  {onkeydown}
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
    --search-results-max-height: max(5rem, calc(100dvh - var(--search-results-anchor-height, 3.25rem) - 8rem - var(--keyboard-inset-height, 0px)));
    height: min(26rem, var(--search-results-max-height));
    display: flex;
    flex-direction: column;
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
  .search-results-panel :global(.search-result-item:focus-visible),
  .search-results-panel :global(.image-search-result:focus-visible),
  .search-results-panel :global([data-search-split-action]:focus-visible),
  .search-results-panel :global([data-browse-mode]:focus-visible) {
    outline: 2px solid var(--ring);
    outline-offset: -2px;
  }
  .search-results-panel:has(:global([data-browse-mode]:focus)) :global(.search-result-item),
  .search-results-panel :global([data-search-result-row]:has([data-search-split-action]:focus) .search-result-item) {
    background: transparent;
  }
</style>
