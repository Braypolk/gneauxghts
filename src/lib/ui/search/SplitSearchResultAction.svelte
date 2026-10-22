<script lang="ts">
  import { Columns2 } from '@lucide/svelte';
  let { title, onSelect }: { title: string; onSelect: () => void } = $props();
</script>

<button
  type="button"
  class="mobile-touch-target inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
  aria-label={`Open ${title} in split pane`}
  title="Open in split pane"
  data-search-focus-independent
  onmousedown={(event) => event.preventDefault()}
  onclick={onSelect}
>
  <Columns2 class="h-4 w-4" aria-hidden="true" />
</button>
