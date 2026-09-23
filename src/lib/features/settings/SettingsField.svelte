<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    label,
    anchor,
    children
  }: {
    label: string;
    anchor?: string;
    children: Snippet;
  } = $props();
</script>

<label data-settings-anchor={anchor} class="grid gap-1.5 text-xs font-medium">
  {label}
  {@render children()}
</label>
