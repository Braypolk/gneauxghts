<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    label,
    children
  }: {
    label: string;
    children: Snippet;
  } = $props();
</script>

<label class="grid gap-1.5 text-xs font-medium">
  {label}
  {@render children()}
</label>
