<script lang="ts">
  import { X } from '@lucide/svelte';
  import type { RelatedNoteItem } from '$lib/types/semantic';

  interface RelatedPanelProps {
    items: RelatedNoteItem[];
    scope: 'note' | 'selection';
    status: 'ready' | 'insufficientContent' | 'unavailable';
    reason: string | null;
    loading: boolean;
    hasSelection: boolean;
    onScopeChange: (scope: 'note' | 'selection') => void;
    onSelect: (item: RelatedNoteItem) => void;
    onClose: () => void;
  }

  let {
    items,
    scope,
    status,
    reason,
    loading,
    hasSelection,
    onScopeChange,
    onSelect,
    onClose
  }: RelatedPanelProps = $props();
</script>

<aside class="related-panel flex h-full min-h-0 flex-col rounded-[1.8rem] border border-border/80 bg-card/50">
  <div class="flex items-center justify-between gap-3 border-b border-border/70 px-4 py-3">
    <h2 class="text-sm font-semibold tracking-[0.08em] text-foreground/88 uppercase">Related</h2>
    <div class="flex items-center gap-2">
      <div class="flex items-center gap-1 rounded-full border border-border/70 bg-background/60 p-1">
        <button
          type="button"
          class={`rounded-full px-3 py-1 text-xs font-medium transition ${
            scope === 'note'
              ? 'bg-foreground text-background shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
          onclick={() => onScopeChange('note')}
        >
          Note
        </button>
        {#if hasSelection}
          <button
            type="button"
            class={`rounded-full px-3 py-1 text-xs font-medium transition ${
              scope === 'selection'
                ? 'bg-foreground text-background shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
            onclick={() => onScopeChange('selection')}
          >
            Selection
          </button>
        {/if}
      </div>
      <button
        type="button"
        class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted/72 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        onclick={onClose}
        aria-label="Close related panel"
        title="Close related panel"
      >
        <X class="h-4 w-4" />
      </button>
    </div>
  </div>

  <div class="min-h-0 flex-1 overflow-y-auto px-3 py-3">
    {#if loading}
      <div class="rounded-[1.15rem] border border-dashed border-border/70 bg-background/45 px-4 py-5 text-sm text-muted-foreground">
        Finding nearby notes…
      </div>
    {:else if status !== 'ready'}
      <div class="rounded-[1.15rem] border border-dashed border-border/70 bg-background/45 px-4 py-5 text-sm text-muted-foreground">
        {reason ?? 'Related notes are unavailable right now.'}
      </div>
    {:else if items.length === 0}
      <div class="rounded-[1.15rem] border border-dashed border-border/70 bg-background/45 px-4 py-5 text-sm text-muted-foreground">
        No clear matches yet.
      </div>
    {:else}
      <div class="flex flex-col gap-2">
        {#each items as item (`${item.notePath}-${item.sectionLabel}-${item.startLine}`)}
          <button
            type="button"
            class="group w-full rounded-[1.2rem] border border-border/70 bg-background/72 px-4 py-3 text-left transition hover:border-foreground/18 hover:bg-background"
            onclick={() => onSelect(item)}
          >
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <div class="truncate text-sm font-semibold text-foreground">{item.noteTitle}</div>
                <div class="mt-1 text-[11px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
                  {item.sectionLabel}
                </div>
              </div>
              <div class="shrink-0 rounded-full bg-accent/60 px-2 py-1 text-[11px] font-medium text-accent-foreground/90">
                {Math.round(item.score * 100)}%
              </div>
            </div>
            <p class="related-panel-excerpt mt-3 text-sm leading-6 text-muted-foreground">
              {item.excerpt}
            </p>
          </button>
        {/each}
      </div>
    {/if}
  </div>
</aside>

<style>
  .related-panel-excerpt {
    display: -webkit-box;
    overflow: hidden;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;
  }
</style>
