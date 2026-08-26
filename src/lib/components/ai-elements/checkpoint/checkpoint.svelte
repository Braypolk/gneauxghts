<script lang="ts">
  import { GitBranch } from '@lucide/svelte';
  import { cn } from '$lib/utils';

  let {
    label = 'Checkpoint',
    disabled = false,
    onBranch,
    class: className
  }: {
    label?: string;
    disabled?: boolean;
    onBranch: () => void | Promise<void>;
    class?: string;
  } = $props();
</script>

<div data-slot="checkpoint" class={cn('flex items-center gap-2 py-1', className)}>
  <div class="h-px flex-1 bg-border/60"></div>
  <button
    type="button"
    class="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
    {disabled}
    aria-label={label}
    title="Create a new conversation from this point"
    onclick={() => void onBranch()}
  >
    <GitBranch class="h-3 w-3" /> {label}
  </button>
  <div class="h-px flex-1 bg-border/60"></div>
</div>
