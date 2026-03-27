<script lang="ts">
  import {
    acceptedHunkCount,
    applySelectedHunks,
    getReviewChangePath,
    isReviewChangeSelected,
    reviewChangeTitle,
    type ReviewChange
  } from '$lib/features/inbox/reviewDiff';
  import ProposalInlineDiffPreview from '$lib/features/proposals/ProposalInlineDiffPreview.svelte';

  interface Props {
    reviewChanges: ReviewChange[];
    pathFilter?: string | null;
    emptyMessage?: string;
    compact?: boolean;
    minimal?: boolean;
    showSegmentControls?: boolean;
    framelessPreview?: boolean;
    showRemovedContent?: boolean;
    showOpenButtons?: boolean;
    onToggleChange?: (changeId: string, selected: boolean) => void;
    onToggleHunk?: (changeId: string, hunkId: string, selected: boolean) => void;
    onToggleTitle?: (changeId: string, selected: boolean) => void;
    onOpenPath?: (path: string) => void;
  }

  let {
    reviewChanges,
    pathFilter = null,
    emptyMessage = 'No note edits were proposed.',
    compact = false,
    minimal = false,
    showSegmentControls = true,
    framelessPreview = false,
    showRemovedContent = true,
    showOpenButtons = false,
    onToggleChange = () => {},
    onToggleHunk = () => {},
    onToggleTitle = () => {},
    onOpenPath = () => {}
  }: Props = $props();

  const filteredChanges = $derived.by(() =>
    pathFilter
      ? reviewChanges.filter((reviewChange) => getReviewChangePath(reviewChange) === pathFilter)
      : reviewChanges
  );

  function hunkSummary(reviewChange: Extract<ReviewChange, { kind: 'updateNote' }>, hunkId: string) {
    const hunk = reviewChange.hunks.find((candidate) => candidate.id === hunkId);
    const text = hunk?.lines.find((line) => line.kind !== 'context')?.text.trim() ?? '';
    if (text.length === 0) {
      return 'Changed content';
    }
    return text.length > 48 ? `${text.slice(0, 48).trimEnd()}…` : text;
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
              {#if reviewChange.kind === 'updateNote'}
                <p class="mt-1 text-xs text-muted-foreground">
                  {acceptedHunkCount(reviewChange)} of {reviewChange.hunks.length} segments selected
                </p>
              {/if}
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
              <div class="flex items-start justify-between gap-3">
                <div>
                  <p class="text-xs uppercase tracking-[0.16em] text-muted-foreground">Title change</p>
                  <p class="mt-2 text-sm text-muted-foreground">
                    {reviewChange.currentTitle}
                    <span class="mx-2 text-muted-foreground/60">→</span>
                    <span class="font-medium text-foreground">{reviewChange.proposedTitle}</span>
                  </p>
                </div>
                <div class="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    class={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                      reviewChange.titleSelected
                        ? 'border-foreground/20 bg-foreground text-background'
                        : 'border-border bg-background hover:bg-accent'
                    }`}
                    onclick={() => onToggleTitle(reviewChange.id, true)}
                  >
                    Accept title
                  </button>
                  <button
                    type="button"
                    class={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                      !reviewChange.titleSelected
                        ? 'border-foreground/20 bg-foreground text-background'
                        : 'border-border bg-background hover:bg-accent'
                    }`}
                    onclick={() => onToggleTitle(reviewChange.id, false)}
                  >
                    Reject title
                  </button>
                </div>
              </div>
            </div>
          {/if}

          {#if reviewChange.hunks.length === 0}
            <p class="mt-4 text-sm text-muted-foreground">No line changes were proposed for this note.</p>
          {:else}
            <div class={compact ? 'mt-3 space-y-3' : 'mt-4 space-y-4'}>
              <ProposalInlineDiffPreview
                currentMarkdown={reviewChange.currentMarkdown}
                proposedMarkdown={applySelectedHunks(
                  reviewChange.currentMarkdown,
                  reviewChange.hunks.filter((hunk) => hunk.selected)
                )}
                frameless={framelessPreview}
                showRemovedContent={showRemovedContent}
              />

              {#if showSegmentControls}
                <div class="rounded-2xl border border-border/70 bg-background/80">
                  {#if !minimal}
                    <div class={`border-b border-border/70 ${compact ? 'px-3 py-3' : 'px-4 py-3'}`}>
                      <p class="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                        Change segments
                      </p>
                      <p class="mt-1 text-sm text-muted-foreground">
                        Toggle individual segments and the preview above updates in place.
                      </p>
                    </div>
                  {/if}

                  <div class={`space-y-3 ${compact ? 'px-3 py-3' : 'px-4 py-4'}`}>
                    {#each reviewChange.hunks as hunk, hunkIndex (hunk.id)}
                      <div class="flex flex-col gap-3 rounded-2xl border border-border/60 bg-card/60 px-3 py-3 md:flex-row md:items-center md:justify-between">
                        <div>
                          <p class="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                            Segment {hunkIndex + 1}
                          </p>
                          <p class="mt-1 text-sm text-foreground">
                            {hunkSummary(reviewChange, hunk.id)}
                          </p>
                        </div>

                        <div class="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            class={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                              hunk.selected
                                ? 'border-foreground/20 bg-foreground text-background'
                                : 'border-border bg-background hover:bg-accent'
                            }`}
                            onclick={() => onToggleHunk(reviewChange.id, hunk.id, true)}
                          >
                            Accept segment
                          </button>
                          <button
                            type="button"
                            class={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                              !hunk.selected
                                ? 'border-foreground/20 bg-foreground text-background'
                                : 'border-border bg-background hover:bg-accent'
                            }`}
                            onclick={() => onToggleHunk(reviewChange.id, hunk.id, false)}
                          >
                            Reject segment
                          </button>
                        </div>
                      </div>
                    {/each}
                  </div>
                </div>
              {/if}
            </div>
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
