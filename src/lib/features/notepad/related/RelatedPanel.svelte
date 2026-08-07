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

{#snippet emptyState(message: string)}
  <p class="related-panel-empty px-1 py-6 text-sm leading-6 text-muted-foreground">
    {message}
  </p>
{/snippet}

<aside class="related-panel flex h-full min-h-0 flex-col border border-border/80 bg-card">
  <div class="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
    <h2 class="text-sm font-semibold text-foreground">Related</h2>
    <div class="flex items-center gap-2">
      <div class="flex items-center gap-0.5 rounded-full bg-muted/70 p-0.5">
        <button
          type="button"
          class={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
            scope === 'note'
              ? 'bg-foreground text-background'
              : 'text-muted-foreground hover:text-foreground'
          }`}
          onclick={() => onScopeChange('note')}
          aria-label="Show related notes for this note"
          title="Related to this note"
        >
          Note
        </button>
        {#if hasSelection}
          <button
            type="button"
            class={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              scope === 'selection'
                ? 'bg-foreground text-background'
                : 'text-muted-foreground hover:text-foreground'
            }`}
            onclick={() => onScopeChange('selection')}
            aria-label="Show related notes for the selected text"
            title="Related to selection"
          >
            Selection
          </button>
        {/if}
      </div>
      <button
        type="button"
        class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        onclick={onClose}
        aria-label="Close related panel"
        title="Close related panel"
      >
        <X class="h-4 w-4" />
      </button>
    </div>
  </div>

  <div class="min-h-0 flex-1 overflow-y-auto px-3 py-2">
    {#if loading}
      {@render emptyState('Finding nearby notes…')}
    {:else if status !== 'ready'}
      {@render emptyState(reason ?? 'Related notes are unavailable right now.')}
    {:else if items.length === 0}
      {@render emptyState('No clear matches yet.')}
    {:else}
      <ul class="related-panel-list m-0 list-none p-0">
        {#each items as item, index (`${item.notePath}-${item.sectionLabel}-${item.startLine}`)}
          <li class={index === 0 ? '' : 'border-t border-border/55'}>
            <button
              type="button"
              class="related-panel-item group w-full px-1 py-3 text-left transition-colors hover:bg-muted/40"
              onclick={() => onSelect(item)}
              aria-label={`Open related note: ${item.noteTitle}, ${item.sectionLabel}`}
              title={item.noteTitle}
            >
              <div class="truncate text-sm font-semibold text-foreground">
                {item.noteTitle}
              </div>
              {#if item.sectionLabel}
                <div class="mt-0.5 truncate text-xs text-muted-foreground">
                  {item.sectionLabel}
                </div>
              {/if}
              <p class="related-panel-excerpt mt-1.5 text-sm leading-6 text-muted-foreground">
                {item.excerpt}
              </p>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</aside>

<style>
  .related-panel {
    border-radius: 1.1rem;
  }

  .related-panel-excerpt {
    display: -webkit-box;
    overflow: hidden;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;
  }

  .related-panel-item {
    border-radius: 0.4rem;
  }
</style>
