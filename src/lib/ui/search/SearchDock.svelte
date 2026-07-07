<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    children?: Snippet;
    insetVariable?: string;
    class?: string;
    contentClass?: string;
  }

  let {
    children,
    insetVariable = '--search-dock-bottom-inset',
    class: className = '',
    contentClass = ''
  }: Props = $props();
</script>

<div
  class={`search-dock pointer-events-none absolute left-0 right-0 z-30 ${className}`}
  style={`bottom: calc(var(--keyboard-inset-height, 0px) + var(${insetVariable}, 0px));`}
>
  <div class={`relative z-10 flex min-h-12 min-w-0 items-center justify-center px-3 py-2 sm:px-6 sm:py-4 ${contentClass}`}>
    {@render children?.()}
  </div>
</div>

<style>
  @media (min-width: 640px) {
    .search-dock {
      --search-dock-bottom-inset: calc(1rem + 1px);
    }
  }
</style>
