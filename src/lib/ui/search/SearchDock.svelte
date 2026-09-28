<script lang="ts">
  import type { Snippet } from 'svelte';
  import './searchDock.css';

  interface Props {
    children?: Snippet;
    pageInset?: boolean;
    class?: string;
    contentClass?: string;
  }

  let {
    children,
    pageInset = false,
    class: className = '',
    contentClass = ''
  }: Props = $props();
</script>

<div
  class={`search-dock pointer-events-none absolute left-0 right-0 z-30 ${className}`}
  class:search-dock--page-inset={pageInset}
>
  <div class={`search-dock-row relative z-10 flex min-w-0 items-center justify-center px-3 sm:px-6 ${contentClass}`}>
    {@render children?.()}
  </div>
</div>

<style>
  .search-dock {
    /* Card-contained docks already inherit the page gutter and 1px border. */
    bottom: var(--keyboard-inset-height, 0px);
  }

  .search-dock--page-inset {
    bottom: calc(var(--keyboard-inset-height, 0px) + 1px);
  }

  @media (min-width: 640px) {
    .search-dock--page-inset {
      bottom: calc(var(--keyboard-inset-height, 0px) + 1rem + 1px);
    }
  }
</style>
