<script lang="ts">
  import { ChevronDown, ChevronRight, FileDiff } from '@lucide/svelte';
  import type { PendingProposalChange, ProposalReviewSessionSnapshot } from './types';

  interface Props {
    snapshot: ProposalReviewSessionSnapshot;
    pendingCount: number;
    onOpenChange: (change: PendingProposalChange) => void | Promise<void>;
    onKeep: (changeId: string) => void | Promise<void>;
    onUndo: (changeId: string) => void | Promise<void>;
    onKeepAll: () => void | Promise<void>;
    onUndoAll: () => void | Promise<void>;
    onReview: () => void | Promise<void>;
    onRetry?: () => void | Promise<void>;
    onCopyCurrent?: () => void | Promise<void>;
    onReloadDisk?: () => void | Promise<void>;
  }

  let {
    snapshot,
    pendingCount,
    onOpenChange,
    onKeep,
    onUndo,
    onKeepAll,
    onUndoAll,
    onReview,
    onRetry,
    onCopyCurrent,
    onReloadDisk
  }: Props = $props();

  let expanded = $state(true);

  const hasChanges = $derived(snapshot.changes.length > 0);
  const pendingChanges = $derived(
    snapshot.changes.filter((change) => change.status === 'pending')
  );
  const batchDisabled = $derived(pendingCount === 0 || snapshot.isApplying);
  const filesLabel = $derived(
    snapshot.reviewHunks
      ? `${snapshot.reviewHunks.unresolved} of ${snapshot.reviewHunks.total} ${snapshot.reviewHunks.total === 1 ? 'change' : 'changes'} left`
      : `${pendingCount} ${pendingCount === 1 ? 'note' : 'notes'}`
  );

  function kindLabel(change: PendingProposalChange): string {
    if (change.change.kind === 'createNote') return 'Create';
    if (change.change.kind === 'deleteNote') return 'Delete';
    return 'Update';
  }

  function rowActionDisabled(change: PendingProposalChange): boolean {
    return snapshot.isApplying || change.status !== 'pending';
  }
</script>

{#if !hasChanges}
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
      <button
        type="button"
        class="flex min-w-0 flex-1 items-start gap-1.5 text-left"
        onclick={() => (expanded = !expanded)}
        aria-expanded={expanded}
      >
        {#if expanded}
          <ChevronDown class="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        {:else}
          <ChevronRight class="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        {/if}
        <FileDiff class="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span class="min-w-0">
          <span class="block truncate text-sm font-medium text-foreground">Review changes</span>
          <span class="mt-0.5 block truncate text-xs font-normal text-muted-foreground">{filesLabel}</span>
        </span>
      </button>

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
          {snapshot.reviewHunks?.unresolved === snapshot.reviewHunks?.total || pendingCount === snapshot.changes.length ? 'Undo All' : 'Undo Remaining'}
        </button>
        <button
          type="button"
          class="rounded-xl px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-default disabled:opacity-40"
          disabled={batchDisabled}
          onclick={() => void onKeepAll()}
        >
          {snapshot.reviewHunks?.unresolved === snapshot.reviewHunks?.total || pendingCount === snapshot.changes.length ? 'Keep All' : 'Keep Remaining'}
        </button>
      </div>
    </div>

    {#if expanded}
      <ul class="mt-2 space-y-1">
        {#each pendingChanges as change (change.id)}
          <li
            class="flex items-center gap-1 rounded-xl border px-1 py-0.5 transition-colors hover:bg-accent/60 {snapshot.activeChangeId ===
            change.id
              ? 'border-border bg-accent/50'
              : 'border-transparent'}"
          >
            <button
              type="button"
              class="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1.5 py-1 text-left text-xs"
              onclick={() => void onOpenChange(change)}
            >
              <span class="min-w-0 flex-1 truncate font-medium text-foreground">{change.title}</span>
              <span class="shrink-0 text-muted-foreground">{kindLabel(change)}</span>
              <span class="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
                <span class="text-foreground">+{change.diff.additions}</span>
                <span class="text-destructive"> -{change.diff.deletions}</span>
              </span>
            </button>
            <div class="flex shrink-0 items-center gap-1 pr-1">
              <button
                type="button"
                class="rounded-lg border border-border px-1.5 py-0.5 text-[11px] font-medium text-foreground hover:bg-accent disabled:cursor-default disabled:opacity-40"
                disabled={rowActionDisabled(change)}
                onclick={(e) => {
                  e.stopPropagation();
                  void onKeep(change.id);
                }}
              >
                Keep
              </button>
              <button
                type="button"
                class="rounded-lg px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-default disabled:opacity-40"
                disabled={rowActionDisabled(change)}
                onclick={(e) => {
                  e.stopPropagation();
                  void onUndo(change.id);
                }}
              >
                Undo
              </button>
            </div>
          </li>
        {/each}
      </ul>
    {/if}

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
