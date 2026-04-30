<script lang="ts">
  import {
    getReviewChangePath,
    isReviewChangeSelected,
    reviewChangeTitle,
    type ReviewChange
  } from '$lib/features/inbox/reviewChanges';

  interface Props {
    reviewChanges: ReviewChange[];
    pathFilter?: string | null;
    emptyMessage?: string;
    compact?: boolean;
    minimal?: boolean;
    showOpenButtons?: boolean;
    onToggleChange?: (changeId: string, selected: boolean) => void;
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
    onOpenPath = () => {}
  }: Props = $props();

  const filteredChanges = $derived.by(() =>
    pathFilter
      ? reviewChanges.filter((reviewChange) => getReviewChangePath(reviewChange) === pathFilter)
      : reviewChanges
  );
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
            <div class={`grid gap-3 md:grid-cols-2 ${compact ? 'mt-3' : 'mt-4'}`}>
              <section class="min-w-0 rounded-2xl border border-border/70 bg-background/80">
                <div class={`border-b border-border/70 ${compact ? 'px-3 py-3' : 'px-4 py-3'}`}>
                  <p class="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Old note</p>
                </div>
                <pre class={`max-h-[32rem] overflow-auto whitespace-pre-wrap break-words text-sm leading-relaxed ${compact ? 'px-3 py-3' : 'px-4 py-4'}`}>{reviewChange.currentMarkdown}</pre>
              </section>
              <section class="min-w-0 rounded-2xl border border-border/70 bg-background/80">
                <div class={`border-b border-border/70 ${compact ? 'px-3 py-3' : 'px-4 py-3'}`}>
                  <p class="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">New note</p>
                </div>
                <pre class={`max-h-[32rem] overflow-auto whitespace-pre-wrap break-words text-sm leading-relaxed ${compact ? 'px-3 py-3' : 'px-4 py-4'}`}>{reviewChange.proposedMarkdown}</pre>
              </section>
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
