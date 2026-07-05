<script lang="ts">
  import RelatedPanel from '$lib/features/notepad/related/RelatedPanel.svelte';
  import {
    getBottomSheetStyle,
    getRelatedDrawerStyle,
    type RelatedPanelPlacement,
    type RelatedScope
  } from '$lib/features/notepad/related/layout';
  import type { RelatedNoteItem, RelatedNotesResponse } from '$lib/types/semantic';

  interface Props {
    placement: RelatedPanelPlacement;
    reservedWidth: number;
    collapsed: boolean;
    items: RelatedNoteItem[];
    scope: RelatedScope;
    status: RelatedNotesResponse['status'];
    reason: string | null;
    loading: boolean;
    hasSelection: boolean;
    onToggle: () => void;
    onClose: () => void;
    onScopeChange: (scope: RelatedScope) => void;
    onSelect: (item: RelatedNoteItem) => void;
  }

  let {
    placement,
    reservedWidth,
    collapsed,
    items,
    scope,
    status,
    reason,
    loading,
    hasSelection,
    onToggle,
    onClose,
    onScopeChange,
    onSelect
  }: Props = $props();
</script>

{#snippet panel()}
  <RelatedPanel
    {items}
    {scope}
    {status}
    {reason}
    {loading}
    {hasSelection}
    {onScopeChange}
    {onClose}
    {onSelect}
  />
{/snippet}

{#if placement === 'side'}
  <aside
    class="related-drawer absolute top-0 bottom-0 z-20 flex min-h-0 items-stretch"
    aria-label="Related notes panel"
    style={getRelatedDrawerStyle(reservedWidth)}
  >
    <div class="relative h-full min-h-0 w-full">
      <button
        type="button"
        class="related-drawer-handle group absolute -mx-4 top-1/2 right-0 z-10 flex translate-x-1/2 -translate-y-1/2 items-center"
        aria-expanded={!collapsed}
        aria-controls="related-drawer-panel"
        aria-label={collapsed ? 'Expand related notes' : 'Collapse related notes'}
        title={collapsed ? 'Expand related notes' : 'Collapse related notes'}
        onclick={onToggle}
      >
        <span class="related-drawer-handle-pill flex h-28 w-7 items-center justify-center rounded-full border border-border/70 bg-card/92 p-1 text-[10px] font-semibold tracking-[0.14em] text-muted-foreground shadow-lg backdrop-blur-md">
          <span class="flex h-full w-full items-center justify-center rounded-full transition-colors group-hover:bg-accent group-hover:text-accent-foreground">
            <span class="-rotate-90">RELATED</span>
          </span>
        </span>
      </button>

      <div
        id="related-drawer-panel"
        class={`absolute inset-y-0 left-0 flex w-full min-h-0 pr-4 transition-[opacity,transform] duration-300 ease-out ${
          collapsed
            ? 'pointer-events-none -translate-x-3 opacity-0'
            : 'pointer-events-auto translate-x-0 opacity-100'
        }`}
      >
        <div class="my-auto max-h-full w-full">
          {@render panel()}
        </div>
      </div>
    </div>
  </aside>
{:else}
  <div class="related-bottom-sheet pointer-events-none absolute z-20" style={getBottomSheetStyle()}>
    <div class="related-bottom-sheet-anchor pointer-events-none relative">
      <div
        aria-hidden="true"
        class={`related-bottom-sheet-backdrop ${collapsed ? 'hidden' : 'block'}`}
      ></div>
      <div
        id="related-drawer-panel"
        class={`related-bottom-sheet-panel w-full overflow-hidden transition-[opacity,transform] duration-300 ease-out ${
          collapsed
            ? 'pointer-events-none translate-y-0 opacity-0'
            : 'pointer-events-auto translate-y-0 opacity-100'
        }`}
      >
        {@render panel()}
      </div>

      <button
        type="button"
        class="related-bottom-sheet-toggle pointer-events-auto inline-flex h-11 items-center gap-2 rounded-full border border-border/70 bg-card/92 px-4 py-2 text-[11px] font-semibold tracking-[0.16em] text-muted-foreground shadow-lg backdrop-blur-md transition hover:text-foreground"
        aria-expanded={!collapsed}
        aria-controls="related-drawer-panel"
        aria-label={collapsed ? 'Expand related notes' : 'Collapse related notes'}
        title={collapsed ? 'Expand related notes' : 'Collapse related notes'}
        onclick={onToggle}
      >
        RELATED
      </button>
    </div>
  </div>
{/if}
