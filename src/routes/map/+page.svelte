<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
import type { MapGraph, MapNode, SemanticSettings } from '$lib/types/semantic';

  const WIDTH = 1200;
  const HEIGHT = 760;

  let graph = $state<MapGraph | null>(null);
  let semanticSettings = $state<SemanticSettings | null>(null);
  let filterQuery = $state('');
  let strongestOnly = $state(false);
  let minScore = $state(0.32);
  let isLoading = $state(true);
  let zoom = $state(1);
  let panX = $state(0);
  let panY = $state(0);
  let dragStart: { x: number; y: number; panX: number; panY: number } | null = null;

  async function loadGraph() {
    isLoading = true;

    try {
      semanticSettings = await invoke<SemanticSettings>('get_semantic_settings');
      strongestOnly = semanticSettings.strongestLinksOnly;
      minScore = semanticSettings.graphMinScore;
      graph = await invoke<MapGraph>('get_map_graph', {
        view: 'notes',
        limit: strongestOnly ? 96 : 180,
        minScore
      });
    } catch (error) {
      console.error('Failed to load semantic graph:', error);
      graph = null;
    } finally {
      isLoading = false;
    }
  }

  function normalizedNodeX(node: MapNode) {
    return WIDTH / 2 + node.x * 360;
  }

  function normalizedNodeY(node: MapNode) {
    return HEIGHT / 2 + node.y * 260;
  }

  function filteredNodes() {
    if (!graph) return [];
    const normalizedFilter = filterQuery.trim().toLowerCase();
    return graph.nodes.filter((node) => {
      if (normalizedFilter === '') return true;
      return node.title.toLowerCase().includes(normalizedFilter);
    });
  }

  function filteredEdges(nodes: MapNode[]) {
    if (!graph) return [];
    const allowed = new Set(nodes.map((node) => node.notePath));
    const edges = graph.edges.filter(
      (edge) =>
        edge.score >= minScore &&
        allowed.has(edge.sourceNotePath) &&
        allowed.has(edge.targetNotePath)
    );
    return strongestOnly ? edges.slice(0, 96) : edges;
  }

  async function openNode(notePath: string) {
    try {
      await invoke('open_note', { path: notePath });
      await goto('/');
    } catch (error) {
      console.error('Failed to open note from map:', error);
    }
  }

  function handleWheel(event: WheelEvent) {
    event.preventDefault();
    const nextZoom = zoom + (event.deltaY < 0 ? 0.08 : -0.08);
    zoom = Math.min(2.8, Math.max(0.55, nextZoom));
  }

  function handlePointerDown(event: PointerEvent) {
    dragStart = {
      x: event.clientX,
      y: event.clientY,
      panX,
      panY
    };
  }

  function handlePointerMove(event: PointerEvent) {
    if (!dragStart) return;
    panX = dragStart.panX + (event.clientX - dragStart.x);
    panY = dragStart.panY + (event.clientY - dragStart.y);
  }

  function handlePointerUp() {
    dragStart = null;
  }
  onMount(() => {
    void loadGraph();
  });
</script>

<svelte:window onpointermove={handlePointerMove} onpointerup={handlePointerUp} />

<div class="h-full w-full overflow-hidden bg-background text-foreground">
  <main class="mx-auto flex h-full w-full max-w-[1600px] flex-col px-2 pb-4">
    <section class="mt-2 flex min-h-0 flex-1 flex-col overflow-hidden rounded-[1.75rem] border border-border/80 bg-card/80 shadow-sm backdrop-blur-md">
      <div class="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 px-6 py-5">
        <div>
          <p class="text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">Map</p>
          <p class="mt-1 text-sm text-muted-foreground">Note-level semantic graph. Filter or tighten the edge threshold if it gets noisy.</p>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <input
            class="rounded-full border border-border bg-background px-4 py-2 text-sm outline-none"
            type="search"
            placeholder="Filter notes"
            bind:value={filterQuery}
          />
          <label class="flex items-center gap-2 rounded-full border border-border bg-background px-3 py-2 text-sm">
            <input type="checkbox" bind:checked={strongestOnly} />
            Strongest links
          </label>
          <label class="flex items-center gap-2 rounded-full border border-border bg-background px-3 py-2 text-sm">
            Min score
            <input type="range" min="0.12" max="0.92" step="0.02" bind:value={minScore} />
            <span class="w-10 text-right">{minScore.toFixed(2)}</span>
          </label>
          <button
            class="rounded-full border border-border bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent"
            type="button"
            onclick={() => void loadGraph()}
          >
            Refresh
          </button>
        </div>
      </div>

      <div class="flex-1 min-h-0 p-4">
        {#if isLoading}
          <div class="flex h-full items-center justify-center rounded-[1.5rem] border border-dashed border-border bg-background/60 text-sm text-muted-foreground">
            Building note graph…
          </div>
        {:else if !graph || graph.nodes.length === 0}
          <div class="flex h-full items-center justify-center rounded-[1.5rem] border border-dashed border-border bg-background/60 text-sm text-muted-foreground">
            No semantic graph yet. Let indexing finish, then refresh this view.
          </div>
        {:else}
          {@const nodes = filteredNodes()}
          {@const edges = filteredEdges(nodes)}

          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="relative h-full overflow-hidden rounded-[1.5rem] border border-border/70 bg-[radial-gradient(circle_at_top,_rgba(120,140,160,0.12),_transparent_55%),linear-gradient(180deg,rgba(255,255,255,0.04),transparent)]"
            onwheel={handleWheel}
            onpointerdown={handlePointerDown}
          >
            <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} class="h-full w-full">
              <g transform={`translate(${panX} ${panY}) scale(${zoom})`}>
                {#each edges as edge}
                  {@const source = nodes.find((node) => node.notePath === edge.sourceNotePath)}
                  {@const target = nodes.find((node) => node.notePath === edge.targetNotePath)}
                  {#if source && target}
                    <line
                      x1={normalizedNodeX(source)}
                      y1={normalizedNodeY(source)}
                      x2={normalizedNodeX(target)}
                      y2={normalizedNodeY(target)}
                      stroke="currentColor"
                      stroke-opacity={Math.min(0.65, Math.max(0.16, edge.score))}
                      stroke-width={Math.max(1.2, edge.score * 3.4)}
                      class="text-muted-foreground"
                    />
                  {/if}
                {/each}

                {#each nodes as node}
                  <!-- svelte-ignore a11y_click_events_have_key_events -->
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <g
                    transform={`translate(${normalizedNodeX(node)} ${normalizedNodeY(node)})`}
                    class="cursor-pointer"
                    onclick={() => void openNode(node.notePath)}
                  >
                    <circle
                      r={Math.max(12, 12 + node.degree * 1.6)}
                      class="fill-background stroke-foreground/35"
                      stroke-width="1.5"
                    />
                    <text
                      y={Math.max(26, 24 + node.degree * 1.4)}
                      text-anchor="middle"
                      class="fill-foreground text-[11px] font-medium"
                    >
                      {node.title}
                    </text>
                  </g>
                {/each}
              </g>
            </svg>
          </div>
        {/if}
      </div>
    </section>
  </main>
</div>
