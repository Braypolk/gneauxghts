<script lang="ts">
  import { goto } from '$app/navigation';
  import {
    ArrowDownLeftFromCircle,
    ExternalLink,
    EyeOff,
    Focus,
    Link as LinkIcon,
    LoaderCircle,
    Search,
    X
  } from '@lucide/svelte';
  import { onDestroy, onMount, tick } from 'svelte';
  import { AtlasStore, getNodePosition, linkEndpoints } from '$lib/features/atlas/atlasStore.svelte';
  import { storePendingNoteTarget } from '$lib/noteNavigation';
  import type { AtlasCloud, AtlasNode } from '$lib/types/atlas';

  const atlas = new AtlasStore();

  let containerEl = $state<HTMLDivElement | null>(null);
  let deck: any = null;
  let deckCore: any = null;
  let deckLayers: any = null;
  let viewState = $state<{ target: [number, number, number]; zoom: number }>({
    target: [0, 0, 0],
    zoom: 0
  });

  const nodeById = $derived(new Map((atlas.response?.nodes ?? []).map((node) => [node.id, node])));

  function atlasThemeColors() {
    const isDark =
      typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
    return isDark
      ? {
          foreground: [255, 255, 255, 255],
          muted: [176, 176, 176, 255],
          border: [96, 96, 96, 120],
          cloudFill: [255, 255, 255, 22],
          labelBackground: [22, 22, 22, 220],
          noteStroke: [0, 0, 0, 190]
        }
      : {
          foreground: [0, 0, 0, 255],
          muted: [112, 112, 112, 255],
          border: [118, 118, 118, 95],
          cloudFill: [0, 0, 0, 12],
          labelBackground: [255, 255, 255, 220],
          noteStroke: [255, 255, 255, 180]
        };
  }

  function getCloudDriftOffset(cloud: AtlasCloud): [number, number] {
    if (!atlas.driftStaleNotes) return [0, 0];
    let totalX = 0;
    let totalY = 0;
    let count = 0;
    for (const id of cloud.memberNodeIds) {
      const node = nodeById.get(id);
      if (!node) continue;
      totalX += node.driftX - node.x;
      totalY += node.driftY - node.y;
      count += 1;
    }
    return count > 0 ? [totalX / count, totalY / count] : [0, 0];
  }

  function getCloudHull(cloud: AtlasCloud): [number, number][] {
    const [dx, dy] = getCloudDriftOffset(cloud);
    if (dx === 0 && dy === 0) return cloud.hull;
    return cloud.hull.map(([x, y]) => [x + dx, y + dy]);
  }

  function getCloudCentroid(cloud: AtlasCloud): [number, number] {
    const [dx, dy] = getCloudDriftOffset(cloud);
    return [cloud.centroid[0] + dx, cloud.centroid[1] + dy];
  }

  function buildLayers() {
    if (!deckLayers || !deckCore || !atlas.response) return [];
    const { ScatterplotLayer, LineLayer, PathLayer, SolidPolygonLayer, TextLayer } = deckLayers;
    const colors = atlasThemeColors();
    const foreground = colors.foreground;
    const muted = colors.muted;
    const border = colors.border;
    const selectedNodeId = atlas.selectedNodeId;
    const selectedCloudId = atlas.selectedCloudId;
    const hoveredNodeId = atlas.hoveredNodeId;
    const tier = atlas.zoomTier;
    const showAllTitles = tier === 'close';
    const showRepresentativeTitles = tier === 'near';
    const titleNodeIds = new Set<string>();
    for (const cloud of atlas.visibleClouds) {
      for (const id of cloud.representativeNodeIds) titleNodeIds.add(id);
    }

    const clouds = atlas.visibleClouds;
    const nodes = atlas.visibleNodes;
    const links = atlas.visibleLinks
      .map((link) => ({
        ...link,
        path: linkEndpoints(link, nodeById, atlas.driftStaleNotes)
      }))
      .filter((link) => link.path.length === 2);

    const labelNodes = nodes.filter(
      (node) => showAllTitles || (showRepresentativeTitles && titleNodeIds.has(node.id))
    );

    return [
      new SolidPolygonLayer({
        id: 'atlas-cloud-fills',
        data: clouds,
        getPolygon: getCloudHull,
        updateTriggers: { getPolygon: [atlas.driftStaleNotes] },
        getFillColor: (cloud: AtlasCloud) =>
          cloud.id === selectedCloudId
            ? [foreground[0], foreground[1], foreground[2], 38]
            : colors.cloudFill,
        pickable: true,
        stroked: false,
        onClick: ({ object }: { object?: AtlasCloud }) => {
          if (!object) return;
          atlas.selectCloud(object);
          renderDeck();
        }
      }),
      new PathLayer({
        id: 'atlas-cloud-outlines',
        data: clouds,
        getPath: getCloudHull,
        updateTriggers: { getPath: [atlas.driftStaleNotes] },
        getColor: (cloud: AtlasCloud) =>
          cloud.id === selectedCloudId ? [foreground[0], foreground[1], foreground[2], 130] : border,
        getWidth: (cloud: AtlasCloud) => (cloud.parentId ? 1 : 1.5),
        widthUnits: 'pixels',
        parameters: { depthTest: false }
      }),
      new LineLayer({
        id: 'atlas-links',
        data: links,
        getSourcePosition: (link: { path: [number, number][] }) => link.path[0],
        getTargetPosition: (link: { path: [number, number][] }) => link.path[1],
        getColor: (link: {
          kind: string;
          sourceId: string;
          targetId: string;
          strength: number;
        }) => {
          const activeNodeId = selectedNodeId ?? hoveredNodeId;
          const incident =
            activeNodeId && (link.sourceId === activeNodeId || link.targetId === activeNodeId);
          if (activeNodeId && !incident) {
            return [muted[0], muted[1], muted[2], 22];
          }
          if (incident) {
            return [foreground[0], foreground[1], foreground[2], Math.round(150 + link.strength * 90)];
          }
          return link.kind === 'wikilink'
            ? [foreground[0], foreground[1], foreground[2], Math.round(75 + link.strength * 95)]
            : [muted[0], muted[1], muted[2], Math.round(28 + link.strength * 70)];
        },
        getWidth: (link: { kind: string; sourceId: string; targetId: string; strength: number }) => {
          const activeNodeId = selectedNodeId ?? hoveredNodeId;
          const incident =
            activeNodeId && (link.sourceId === activeNodeId || link.targetId === activeNodeId);
          if (activeNodeId && !incident) return 0.45;
          if (incident) return 1.15 + link.strength * 0.85;
          return link.kind === 'wikilink' ? 1.4 + link.strength : 0.7 + link.strength;
        },
        widthUnits: 'pixels',
        parameters: { depthTest: false }
      }),
      new ScatterplotLayer({
        id: 'atlas-notes',
        data: nodes,
        getPosition: (node: AtlasNode) => getNodePosition(node, atlas.driftStaleNotes),
        updateTriggers: { getPosition: [atlas.driftStaleNotes] },
        getRadius: (node: AtlasNode) => (node.id === selectedNodeId ? node.radius + 4 : node.radius),
        radiusUnits: 'pixels',
        getFillColor: (node: AtlasNode) =>
          node.id === selectedNodeId
            ? [foreground[0], foreground[1], foreground[2], 255]
            : node.isolated
              ? [muted[0], muted[1], muted[2], 145]
              : [foreground[0], foreground[1], foreground[2], Math.round(110 + node.centrality * 105)],
        getLineColor: colors.noteStroke,
        lineWidthUnits: 'pixels',
        getLineWidth: (node: AtlasNode) => (node.id === selectedNodeId ? 2 : 0),
        pickable: true,
        autoHighlight: true,
        highlightColor: [foreground[0], foreground[1], foreground[2], 34],
        onHover: ({ object }: { object?: AtlasNode }) => handleNodeHover(object ?? null),
        onClick: ({ object }: { object?: AtlasNode }) => handleNodeClick(object ?? null)
      }),
      new TextLayer({
        id: 'atlas-cloud-labels',
        data: clouds,
        getPosition: getCloudCentroid,
        updateTriggers: { getPosition: [atlas.driftStaleNotes] },
        getText: (cloud: AtlasCloud) => `${cloud.label} ${cloud.noteCount}`,
        getSize: (cloud: AtlasCloud) => (cloud.parentId ? 11 : 13),
        sizeUnits: 'pixels',
        getColor: [foreground[0], foreground[1], foreground[2], 190],
        getTextAnchor: 'middle',
        getAlignmentBaseline: 'center',
        parameters: { depthTest: false }
      }),
      new TextLayer({
        id: 'atlas-note-labels',
        data: labelNodes,
        getPosition: (node: AtlasNode) => {
          const [x, y] = getNodePosition(node, atlas.driftStaleNotes);
          return [x + node.radius + 5, y - node.radius - 2];
        },
        updateTriggers: { getPosition: [atlas.driftStaleNotes] },
        getText: (node: AtlasNode) => node.title || node.fileName,
        getSize: tier === 'close' ? 12 : 10,
        sizeUnits: 'pixels',
        getColor: [foreground[0], foreground[1], foreground[2], tier === 'close' ? 220 : 155],
        getTextAnchor: 'start',
        getAlignmentBaseline: 'center',
        background: tier === 'close',
        getBackgroundColor: colors.labelBackground,
        backgroundPadding: [3, 2],
        parameters: { depthTest: false }
      })
    ];
  }

  function renderDeck() {
    if (!deck) return;
    deck.setProps({
      viewState,
      layers: buildLayers()
    });
  }

  function fitView() {
    const nodes = atlas.visibleNodes;
    if (nodes.length === 0) return;
    const positions = nodes.map((node) => getNodePosition(node, atlas.driftStaleNotes));
    const minX = Math.min(...positions.map(([x]) => x));
    const maxX = Math.max(...positions.map(([x]) => x));
    const minY = Math.min(...positions.map(([, y]) => y));
    const maxY = Math.max(...positions.map(([, y]) => y));
    const width = Math.max(1, maxX - minX);
    const height = Math.max(1, maxY - minY);
    const viewportWidth = containerEl?.clientWidth ?? 900;
    const viewportHeight = containerEl?.clientHeight ?? 600;
    const scale = Math.min(viewportWidth / (width + 220), viewportHeight / (height + 220));
    viewState = {
      target: [(minX + maxX) / 2, (minY + maxY) / 2, 0],
      zoom: Math.max(-4, Math.min(0.05, Math.log2(scale)))
    };
    atlas.setZoom(Math.pow(2, viewState.zoom));
    renderDeck();
  }

  async function openSelectedNode() {
    const node = atlas.selectedNode;
    if (!node) return;
    storePendingNoteTarget({ noteId: node.noteId, notePath: node.notePath });
    await goto('/');
  }

  function handleNodeHover(node: AtlasNode | null) {
    if (atlas.hoveredNodeId === (node?.id ?? null)) return;
    atlas.hoverNode(node);
    renderDeck();
  }

  function handleNodeClick(node: AtlasNode | null) {
    if (!node) return;
    atlas.selectNode(node);
    renderDeck();
  }

  function handleToggleDrift() {
    atlas.toggleDrift();
    renderDeck();
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      atlas.clearSelection();
      renderDeck();
      return;
    }
    if (event.key === 'Enter' && atlas.selectedNode) {
      event.preventDefault();
      void openSelectedNode();
      return;
    }
    if (event.key === '0') {
      event.preventDefault();
      fitView();
      return;
    }
    if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      viewState = { ...viewState, zoom: Math.min(4, viewState.zoom + 0.35) };
      atlas.setZoom(Math.pow(2, viewState.zoom));
      renderDeck();
      return;
    }
    if (event.key === '-') {
      event.preventDefault();
      viewState = { ...viewState, zoom: Math.max(-4, viewState.zoom - 0.35) };
      atlas.setZoom(Math.pow(2, viewState.zoom));
      renderDeck();
    }
  }

  onMount(() => {
    let mounted = true;
    (async () => {
      await atlas.initialize();
      if (!mounted || !containerEl) return;
      const [{ Deck, OrthographicView }, layers] = await Promise.all([
        import('@deck.gl/core'),
        import('@deck.gl/layers')
      ]);
      if (!mounted || !containerEl) return;
      const DeckCtor = Deck as any;
      const OrthographicViewCtor = OrthographicView as any;
      deckCore = { Deck: DeckCtor, OrthographicView: OrthographicViewCtor };
      deckLayers = layers;
      deck = new DeckCtor({
        parent: containerEl,
        views: [new OrthographicViewCtor({ controller: true })],
        controller: true,
        viewState,
        onViewStateChange: ({ viewState: nextViewState }: { viewState: any }) => {
          viewState = {
            target: [
              nextViewState.target?.[0] ?? 0,
              nextViewState.target?.[1] ?? 0,
              nextViewState.target?.[2] ?? 0
            ],
            zoom: nextViewState.zoom ?? 0
          };
          atlas.setZoom(Math.pow(2, nextViewState.zoom));
          renderDeck();
        },
        onClick: ({ object }: { object?: unknown }) => {
          if (!object) {
            atlas.clearSelection();
            renderDeck();
          }
        }
      });
      renderDeck();
      await tick();
      fitView();
    })();

    return () => {
      mounted = false;
      atlas.dispose();
      deck?.finalize();
      deck = null;
    };
  });

  onDestroy(() => {
    atlas.dispose();
  });

  $effect(() => {
    atlas.searchQuery;
    atlas.driftStaleNotes;
    atlas.showLinks;
    atlas.selectedNodeId;
    atlas.selectedCloudId;
    atlas.response;
    renderDeck();
  });
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="relative h-full w-full overflow-hidden bg-background text-foreground">
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div bind:this={containerEl} ondblclick={() => void openSelectedNode()} class="absolute inset-0"></div>

  <div class="pointer-events-none absolute inset-x-0 top-3 z-10 flex justify-center px-3 sm:top-4">
    <div
      class="pointer-events-auto flex max-w-[calc(100vw-1.5rem)] items-center gap-1 rounded-full border border-border/80 bg-card/80 p-1 shadow-sm backdrop-blur-md"
    >
      <div class="flex min-w-0 items-center gap-2 rounded-full bg-background/60 px-3 py-2">
        <Search class="h-4 w-4 shrink-0 text-muted-foreground" />
        <input
          class="w-34 bg-transparent text-sm outline-none placeholder:text-muted-foreground sm:w-56"
          placeholder="Find notes"
          bind:value={atlas.searchQuery}
        />
      </div>
      <button
        type="button"
        class={`inline-flex h-9 w-9 items-center justify-center rounded-full transition-colors ${
          atlas.driftStaleNotes ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-accent hover:text-foreground'
        }`}
        title="Drift stale notes"
        onclick={handleToggleDrift}
      >
        <ArrowDownLeftFromCircle class="h-4 w-4" />
      </button>
      <button
        type="button"
        class={`inline-flex h-9 w-9 items-center justify-center rounded-full transition-colors ${
          atlas.showLinks ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-accent hover:text-foreground'
        }`}
        title="Toggle links"
        onclick={() => atlas.toggleLinks()}
      >
        <LinkIcon class="h-4 w-4" />
      </button>
      <button
        type="button"
        class="inline-flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        title="Fit view"
        onclick={fitView}
      >
        <Focus class="h-4 w-4" />
      </button>
    </div>
  </div>

  {#if atlas.error || atlas.response?.status === 'unavailable' || atlas.response?.status === 'empty'}
    <div class="absolute inset-0 z-20 flex items-center justify-center px-4">
      <div class="max-w-md rounded-[1.5rem] border border-border/80 bg-card/90 px-5 py-5 text-center shadow-md backdrop-blur-md">
        <p class="text-sm font-semibold">
          {atlas.error ? 'Atlas unavailable' : atlas.response?.status === 'empty' ? 'No atlas yet' : 'Semantic atlas unavailable'}
        </p>
        <p class="mt-2 text-sm text-muted-foreground">
          {atlas.error ?? atlas.response?.reason ?? 'Semantic indexing needs to finish before the atlas can be shown.'}
        </p>
        {#if atlas.response?.status === 'unavailable'}
          <button
            type="button"
            class="mt-4 rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background"
            onclick={() => void goto('/settings')}
          >
            Open Settings
          </button>
        {/if}
      </div>
    </div>
  {:else if atlas.isLoading && !atlas.response}
    <div class="absolute inset-0 z-20 flex items-center justify-center">
      <div class="inline-flex items-center gap-2 rounded-full border border-border/80 bg-card/90 px-4 py-2 text-sm text-muted-foreground shadow-sm backdrop-blur-md">
        <LoaderCircle class="h-4 w-4 animate-spin" />
        Building atlas
      </div>
    </div>
  {/if}

  <div class="pointer-events-none absolute bottom-4 left-4 z-10 hidden sm:block">
    <div class="rounded-2xl border border-border/80 bg-card/80 px-4 py-3 text-xs text-muted-foreground shadow-sm backdrop-blur-md">
      <p class="font-medium text-foreground">
        {atlas.response?.stats.noteCount ?? 0} notes · {atlas.response?.stats.cloudCount ?? 0} clouds
      </p>
      <p class="mt-1">
        {atlas.zoomTier} focus · {atlas.response?.stats.linkCount ?? 0} links
        {atlas.isStale ? ' · refresh pending' : ''}
      </p>
    </div>
  </div>

  {#if atlas.selectedNode}
    <aside class="absolute bottom-4 right-4 z-20 w-[min(22rem,calc(100vw-2rem))] rounded-[1.5rem] border border-border/80 bg-card/90 p-4 shadow-lg backdrop-blur-md">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <p class="truncate text-sm font-semibold">{atlas.selectedNode.title}</p>
          <p class="mt-1 truncate text-xs text-muted-foreground">{atlas.selectedNode.fileName}</p>
        </div>
        <button
          type="button"
          class="rounded-full p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          title="Clear selection"
          onclick={() => atlas.clearSelection()}
        >
          <X class="h-4 w-4" />
        </button>
      </div>
      <div class="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
        <div class="rounded-xl bg-muted/50 px-2 py-2">
          <p class="font-medium text-foreground">{Math.round(atlas.selectedNode.centrality * 100)}%</p>
          <p class="mt-0.5 text-muted-foreground">central</p>
        </div>
        <div class="rounded-xl bg-muted/50 px-2 py-2">
          <p class="font-medium text-foreground">{Math.round(atlas.selectedNode.staleScore * 100)}%</p>
          <p class="mt-0.5 text-muted-foreground">stale</p>
        </div>
        <div class="rounded-xl bg-muted/50 px-2 py-2">
          <p class="font-medium text-foreground">{atlas.selectedNode.isolated ? 'No' : 'Yes'}</p>
          <p class="mt-0.5 text-muted-foreground">cloud</p>
        </div>
      </div>
      <button
        type="button"
        class="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background"
        onclick={() => void openSelectedNode()}
      >
        <ExternalLink class="h-4 w-4" />
        Open note
      </button>
    </aside>
  {:else if atlas.selectedCloud}
    <aside class="absolute bottom-4 right-4 z-20 w-[min(22rem,calc(100vw-2rem))] rounded-[1.5rem] border border-border/80 bg-card/90 p-4 shadow-lg backdrop-blur-md">
      <div class="flex items-start justify-between gap-3">
        <div>
          <p class="text-sm font-semibold">{atlas.selectedCloud.label ?? 'Semantic cloud'}</p>
          <p class="mt-1 text-xs text-muted-foreground">
            {atlas.selectedCloud.noteCount} notes · {Math.round(atlas.selectedCloud.density * 100)}% density
          </p>
        </div>
        <button
          type="button"
          class="rounded-full p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          title="Clear selection"
          onclick={() => atlas.clearSelection()}
        >
          <X class="h-4 w-4" />
        </button>
      </div>
      <button
        type="button"
        class="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-full border border-border/80 px-4 py-2 text-sm font-medium text-foreground hover:bg-accent"
        onclick={() => {
          const target = atlas.selectedCloud ? getCloudCentroid(atlas.selectedCloud) : [0, 0];
          viewState = {
            target: [target[0], target[1], 0],
            zoom: Math.max(viewState.zoom, 1.2)
          };
          atlas.setZoom(Math.pow(2, viewState.zoom));
          renderDeck();
        }}
      >
        <Focus class="h-4 w-4" />
        Focus cloud
      </button>
    </aside>
  {/if}

  {#if atlas.response?.status === 'building'}
    <div class="absolute bottom-4 right-4 z-20 inline-flex items-center gap-2 rounded-full border border-border/80 bg-card/90 px-4 py-2 text-sm text-muted-foreground shadow-sm backdrop-blur-md">
      <EyeOff class="h-4 w-4" />
      Semantic index is warming
    </div>
  {/if}
</div>
