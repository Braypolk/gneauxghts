<script lang="ts">
  import { getShortcutBindingParts } from '#lib/keyboardShortcuts.svelte.js';
  let { binding }: { binding: string } = $props();
  const parts = $derived(getShortcutBindingParts(binding));
  const symbols: Record<string, string> = { Cmd: '⌘', Ctrl: '⌃', Option: '⌥', Shift: '⇧', Up: '↑', Down: '↓', Left: '←', Right: '→' };
</script>

<span class="inline-flex flex-wrap items-center gap-1" aria-label={parts.join(' + ')}>
  {#each parts as part}<kbd class="inline-flex min-h-6 min-w-6 items-center justify-center rounded border border-border/80 bg-muted/70 px-1.5 font-sans text-xs leading-none shadow-[0_1px_0_var(--border)]" title={part}>{symbols[part] ?? part}</kbd>{/each}
</span>
