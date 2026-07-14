<script lang="ts">
  import { RefreshCcw } from '@lucide/svelte';

  let {
    disabled = false,
    onclick
  }: {
    disabled?: boolean;
    onclick: () => void;
  } = $props();
</script>

<button
  class="inline-flex shrink-0 items-center gap-2 rounded-full border border-border bg-background px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
  type="button"
  {disabled}
  {onclick}
>
  <RefreshCcw class="h-4 w-4" />
  Refresh
</button>
