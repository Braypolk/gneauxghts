<script lang="ts">
  import { FileDiff } from '@lucide/svelte';
  import type { ProposalReviewSessionSnapshot } from './types';

  interface Props {
    snapshot: ProposalReviewSessionSnapshot;
    onKeepAll: () => void | Promise<void>;
    onUndoAll: () => void | Promise<void>;
    onReview: () => void | Promise<void>;
    onRetry?: () => void | Promise<void>;
    onCopyCurrent?: () => void | Promise<void>;
    onReloadDisk?: () => void | Promise<void>;
  }

  let {
    snapshot,
    onKeepAll,
    onUndoAll,
    onReview,
    onRetry,
    onCopyCurrent,
    onReloadDisk
  }: Props = $props();

  const hasReview = $derived(snapshot.notePath !== null);
  const batchDisabled = $derived(
    snapshot.unresolvedHunks === 0 || snapshot.isApplying
  );
  const filesLabel = $derived(
    `${snapshot.unresolvedHunks} of ${snapshot.totalHunks} ${snapshot.totalHunks === 1 ? 'change' : 'changes'} left`
  );
</script>

{#if !hasReview}
  {#if snapshot.error}
    <div
      class="mx-4 mb-1 rounded-[1.1rem] bg-destructive/10 px-3 py-2.5 text-xs text-destructive sm:mx-6"
      role="alert"
      data-proposal-strip="error"
    >
      {snapshot.error}
    </div>
  {/if}
{:else}
  <div
    class="mx-4 mb-1 rounded-[1.1rem] border border-border/70 bg-background/70 px-3 py-2.5 sm:mx-6"
    data-proposal-strip="active"
  >
    <div class="flex items-start gap-2">
      <div class="flex min-w-0 flex-1 items-start gap-1.5">
        <FileDiff class="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span class="min-w-0">
          <span class="block truncate text-sm font-medium text-foreground">
            {snapshot.title ?? 'Review changes'}
          </span>
          <span class="mt-0.5 block truncate text-xs font-normal text-muted-foreground">{filesLabel}</span>
        </span>
      </div>

      <div class="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          class="rounded-xl bg-foreground px-2.5 py-1 text-xs font-medium text-background hover:opacity-90 disabled:cursor-default disabled:opacity-40"
          disabled={batchDisabled}
          onclick={() => void onReview()}
        >
          Review next
        </button>
        <button
          type="button"
          class="rounded-xl border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-accent disabled:cursor-default disabled:opacity-40"
          disabled={batchDisabled}
          onclick={() => void onUndoAll()}
        >
          {snapshot.unresolvedHunks === snapshot.totalHunks ? 'Undo All' : 'Undo Remaining'}
        </button>
        <button
          type="button"
          class="rounded-xl px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-default disabled:opacity-40"
          disabled={batchDisabled}
          onclick={() => void onKeepAll()}
        >
          {snapshot.unresolvedHunks === snapshot.totalHunks ? 'Keep All' : 'Keep Remaining'}
        </button>
      </div>
    </div>

    {#if snapshot.error}
      <div
        class="mt-2 rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive"
        role="alert"
      >
        {snapshot.error}
        {#if snapshot.isConflicted && (onRetry || onCopyCurrent || onReloadDisk)}
          <div class="mt-2 flex flex-wrap gap-1.5">
            {#if onRetry}<button type="button" class="rounded border border-destructive/30 px-2 py-1" onclick={() => void onRetry()}>Retry</button>{/if}
            {#if onCopyCurrent}<button type="button" class="rounded border border-destructive/30 px-2 py-1" onclick={() => void onCopyCurrent()}>Copy Current</button>{/if}
            {#if onReloadDisk}<button type="button" class="rounded border border-destructive/30 px-2 py-1" onclick={() => void onReloadDisk()}>Reload Disk</button>{/if}
          </div>
        {/if}
      </div>
    {/if}
  </div>
{/if}
