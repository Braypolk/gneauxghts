<script lang="ts">
  import {
    getReviewChangePath,
    isReviewChangeSelected,
    reviewChangeTitle,
    reviewUpdateOpCounts,
    type ReviewChange,
    type ReviewUpdateChange
  } from '$lib/features/inbox/reviewChanges';
  import { toBlockOpViews, type BlockOpView } from '$lib/features/proposals/diff/proposalAdapter';
  import { buildChangeProposal } from '$lib/features/notepad/blocks/blockOps';
  import MarkdownDiffView from '$lib/features/proposals/diff/MarkdownDiffView.svelte';

  interface Props {
    reviewChanges: ReviewChange[];
    pathFilter?: string | null;
    emptyMessage?: string;
    compact?: boolean;
    minimal?: boolean;
    showOpenButtons?: boolean;
    onToggleChange?: (changeId: string, selected: boolean) => void;
    onToggleOp?: (changeId: string, opId: string, accepted: boolean) => void;
    onOpenPath?: (path: string) => void;
  }

  let {
    reviewChanges,
    pathFilter = null,
    emptyMessage = 'No note edits were proposed.',
    compact = false,
    minimal = false,
    showOpenButtons = false,
    onToggleChange = () => {},
    onToggleOp = () => {},
    onOpenPath = () => {}
  }: Props = $props();

  // Pair each derived op with its before/after text for op-level cards. Built
  // from the change's own ops (derived against currentMarkdown), so the cards and
  // the merge diff describe the same edit.
  function opViewsFor(change: ReviewUpdateChange): BlockOpView[] {
    if (change.ops.length === 0) {
      return [];
    }
    const proposal = buildChangeProposal({
      threadId: -1,
      filePath: change.path,
      baseContentHash: change.baseContentHash,
      baseDoc: change.currentMarkdown,
      operations: change.ops,
      summary: '',
      fullFileFallback: change.proposedMarkdown
    });
    return toBlockOpViews(proposal, change.currentMarkdown);
  }

  function opKindLabel(kind: BlockOpView['op']['kind']): string {
    switch (kind) {
      case 'replaceBlock':
        return 'Replace';
      case 'insertAfter':
      case 'insertBefore':
        return 'Insert';
      case 'deleteBlock':
        return 'Delete';
      case 'renameHeading':
        return 'Rename';
      case 'updateMeta':
        return 'Meta';
    }
  }

  const filteredChanges = $derived.by(() =>
    pathFilter
      ? reviewChanges.filter((reviewChange) => getReviewChangePath(reviewChange) === pathFilter)
      : reviewChanges
  );

  // Per-change "changed regions only" toggle. Defaults to collapsed so long notes
  // open focused on what changed; the user can expand to the full file per change.
  let collapsedById = $state<Record<string, boolean>>({});
  function isCollapsed(id: string) {
    return collapsedById[id] ?? true;
  }
  function toggleCollapsed(id: string) {
    collapsedById = { ...collapsedById, [id]: !isCollapsed(id) };
  }
</script>

{#if filteredChanges.length === 0}
  <p class={`text-sm text-muted-foreground ${compact ? 'mt-2' : 'mt-3'}`}>{emptyMessage}</p>
{:else}
  <div class={compact ? 'space-y-3' : 'space-y-4'}>
    {#each filteredChanges as reviewChange (reviewChange.id)}
      {@const noteSelected = isReviewChangeSelected(reviewChange)}
      {@const changePath = getReviewChangePath(reviewChange)}
      <div class={`${minimal
        ? ''
        : `rounded-2xl border transition-colors ${
            noteSelected
              ? 'border-border/70 bg-card/80'
              : 'border-border/50 bg-card/45 opacity-75'
          } ${compact ? 'px-3 py-3' : 'px-4 py-4'}`}`}>
        <div class="flex items-start justify-between gap-3">
          {#if !minimal}
            <div>
              <p class="text-sm font-medium">{reviewChangeTitle(reviewChange)}</p>
              <p class="mt-1 text-xs uppercase tracking-[0.16em] text-muted-foreground">
                {reviewChange.kind}
              </p>
              <p class="mt-1 text-xs text-muted-foreground">
                {noteSelected ? 'Selected for approval' : 'Rejected from approval'}
              </p>
              {#if changePath}
                <p class="mt-1 text-xs text-muted-foreground break-all">{changePath}</p>
              {/if}
            </div>
          {/if}

          <div class="flex flex-wrap items-center justify-end gap-2">
            {#if showOpenButtons && changePath}
              <button
                type="button"
                class="rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent"
                onclick={() => onOpenPath(changePath)}
              >
                Open note
              </button>
            {/if}
            <button
              type="button"
              class={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                noteSelected
                  ? 'border-foreground/20 bg-foreground text-background'
                  : 'border-border bg-background hover:bg-accent'
              }`}
              onclick={() => onToggleChange(reviewChange.id, true)}
            >
              {minimal ? 'Accept file' : 'Accept note'}
            </button>
            <button
              type="button"
              class={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                !noteSelected
                  ? 'border-foreground/20 bg-foreground text-background'
                  : 'border-border bg-background hover:bg-accent'
              }`}
              onclick={() => onToggleChange(reviewChange.id, false)}
            >
              {minimal ? 'Reject file' : 'Reject note'}
            </button>
          </div>
        </div>

        {#if reviewChange.kind === 'updateNote'}
          {#if reviewChange.titleChanged}
            <div class={`rounded-2xl border border-border/70 bg-background/80 ${compact ? 'mt-3 px-3 py-3' : 'mt-4 px-4 py-3'}`}>
              <p class="text-xs uppercase tracking-[0.16em] text-muted-foreground">Title</p>
              <p class="mt-2 text-sm text-muted-foreground">
                {reviewChange.currentTitle}
                <span class="mx-2 text-muted-foreground/60">→</span>
                <span class="font-medium text-foreground">{reviewChange.proposedTitle}</span>
              </p>
            </div>
          {/if}

          {#if reviewChange.currentMarkdown === reviewChange.proposedMarkdown}
            <p class="mt-4 text-sm text-muted-foreground">No note body change was proposed.</p>
          {:else}
            <section class={`min-w-0 rounded-2xl border border-border/70 bg-background/80 ${compact ? 'mt-3' : 'mt-4'}`}>
              <div class={`flex items-center justify-between gap-2 border-b border-border/70 ${compact ? 'px-3 py-2.5' : 'px-4 py-3'}`}>
                <p class="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Proposed changes</p>
                <button
                  type="button"
                  class="rounded-full border border-border bg-background px-3 py-1 text-xs font-medium transition-colors hover:bg-accent"
                  onclick={() => toggleCollapsed(reviewChange.id)}
                >
                  {isCollapsed(reviewChange.id) ? 'Show full file' : 'Show changes only'}
                </button>
              </div>
              <div class={compact ? 'px-2 py-2' : 'px-3 py-3'}>
                <MarkdownDiffView
                  original={reviewChange.currentMarkdown}
                  proposed={reviewChange.proposedMarkdown}
                  collapseUnchanged={isCollapsed(reviewChange.id)}
                />
              </div>
            </section>

            {#if reviewChange.ops.length > 0}
              {@const counts = reviewUpdateOpCounts(reviewChange)}
              <section class={`min-w-0 rounded-2xl border border-border/70 bg-background/80 ${compact ? 'mt-3' : 'mt-4'}`}>
                <div class={`flex items-center justify-between gap-2 border-b border-border/70 ${compact ? 'px-3 py-2.5' : 'px-4 py-3'}`}>
                  <p class="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    Block edits · {counts.accepted}/{counts.total} accepted
                  </p>
                </div>
                <ul class={`divide-y divide-border/60 ${compact ? 'px-2' : 'px-3'}`}>
                  {#each opViewsFor(reviewChange) as view (view.op.opId)}
                    {@const opAccepted = reviewChange.acceptedOpIds.includes(view.op.opId)}
                    <li class={`flex items-start justify-between gap-3 ${compact ? 'py-2' : 'py-3'}`}>
                      <div class="min-w-0">
                        <p class="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                          {opKindLabel(view.op.kind)}
                          {#if !opAccepted}<span class="ml-2 text-muted-foreground/70">(rejected)</span>{/if}
                        </p>
                        {#if view.before}
                          <p class="mt-1 truncate text-xs text-muted-foreground line-through">{view.before}</p>
                        {/if}
                        {#if view.after}
                          <p class="mt-0.5 truncate text-sm text-foreground">{view.after}</p>
                        {/if}
                      </div>
                      <div class="flex shrink-0 items-center gap-1.5">
                        <button
                          type="button"
                          class={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                            opAccepted
                              ? 'border-foreground/20 bg-foreground text-background'
                              : 'border-border bg-background hover:bg-accent'
                          }`}
                          onclick={() => onToggleOp(reviewChange.id, view.op.opId, true)}
                        >
                          Accept
                        </button>
                        <button
                          type="button"
                          class={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                            !opAccepted
                              ? 'border-foreground/20 bg-foreground text-background'
                              : 'border-border bg-background hover:bg-accent'
                          }`}
                          onclick={() => onToggleOp(reviewChange.id, view.op.opId, false)}
                        >
                          Reject
                        </button>
                      </div>
                    </li>
                  {/each}
                </ul>
              </section>
            {/if}
          {/if}
        {:else if reviewChange.kind === 'createNote'}
          <div class={`rounded-2xl border border-border/70 bg-background/80 ${compact ? 'mt-3' : 'mt-4'}`}>
            <div class={`border-b border-border/70 ${compact ? 'px-3 py-3' : 'px-4 py-3'}`}>
              <p class="text-xs uppercase tracking-[0.16em] text-muted-foreground">New note</p>
            </div>
            <pre class={`overflow-x-auto whitespace-pre-wrap text-sm leading-relaxed ${compact ? 'px-3 py-3' : 'px-4 py-4'}`}>{reviewChange.change.markdown}</pre>
          </div>
        {:else}
          <p class="mt-4 text-sm text-muted-foreground">
            Delete the source note after its contents have been absorbed elsewhere.
          </p>
        {/if}
      </div>
    {/each}
  </div>
{/if}
