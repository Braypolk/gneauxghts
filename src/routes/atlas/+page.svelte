<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import {
    ArrowDownLeftFromCircle,
    ExternalLink,
    Focus,
    Link as LinkIcon,
    LoaderCircle,
    X
  } from '@lucide/svelte';
  import { onMount, tick } from 'svelte';
  import { SvelteMap, SvelteSet } from 'svelte/reactivity';
  import {
    atlasLabelRenderKey,
    atlasStore,
    getNodePosition,
    linkEndpoints
  } from '$lib/features/atlas/atlasStore.svelte';
  import { storePendingNoteTarget } from '$lib/noteNavigation';
  import SearchBar from '$lib/ui/search/SearchBar.svelte';
  import SearchDock from '$lib/ui/search/SearchDock.svelte';
  import type { AtlasCloud, AtlasNode } from '$lib/types/atlas';

  const atlas = atlasStore;
  const NOTE_LABEL_MAX_LENGTH = 24;
  const CLOUD_LABEL_MAX_LENGTH = 22;
  const SEARCH_DIM_NODE_COLOR: [number, number, number] = [112, 121, 136];
  const SEARCH_DIM_CLOUD_COLOR: [number, number, number] = [88, 98, 113];
  const DARK_CLOUD_NEUTRAL: [number, number, number] = [132, 146, 160];
  const LIGHT_CLOUD_NEUTRAL: [number, number, number] = [96, 108, 122];
  const DARK_NODE_NEUTRAL: [number, number, number] = [176, 187, 198];
  const LIGHT_NODE_NEUTRAL: [number, number, number] = [76, 86, 98];

  let containerEl = $state<HTMLDivElement | null>(null);
  let deck = $state.raw<any>(null);
  let deckCore = $state.raw<any>(null);
  let deckLayers = $state.raw<any>(null);
  let isDeckVisible = $state(false);
  let isHoveringNote = $state(false);
  let viewState = $state<{ target: [number, number, number]; zoom: number }>({
    target: [0, 0, 0],
    zoom: 0
  });

  const nodeById = $derived(
    new SvelteMap((atlas.response?.nodes ?? []).map((node) => [node.id, node]))
  );
  const cloudById = $derived(
    new SvelteMap((atlas.response?.clouds ?? []).map((cloud) => [cloud.id, cloud]))
  );
  const hasReadyMap = $derived(
    atlas.response?.status === 'ready' && atlas.response.nodes.length > 0
  );
  const isColdBuilding = $derived(
    !hasReadyMap && (atlas.isLoading || atlas.response?.status === 'building')
  );
  const labelRenderKey = $derived(atlasLabelRenderKey(atlas.response));

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
          cloudLabel: [221, 228, 235, 218],
          cloudLabelMuted: [176, 187, 198, 164],
          noteStroke: [0, 0, 0, 190]
        }
      : {
          foreground: [0, 0, 0, 255],
          muted: [112, 112, 112, 255],
          border: [118, 118, 118, 95],
          cloudFill: [0, 0, 0, 12],
          labelBackground: [255, 255, 255, 220],
          cloudLabel: [34, 40, 48, 218],
          cloudLabelMuted: [82, 94, 108, 164],
          noteStroke: [255, 255, 255, 180]
        };
  }

  function atlasIsDark() {
    return typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
  }

  function mixColor(
    source: [number, number, number],
    target: [number, number, number],
    amount: number
  ): [number, number, number] {
    const clamp = Math.max(0, Math.min(1, amount));
    return [
      Math.round(source[0] + (target[0] - source[0]) * clamp),
      Math.round(source[1] + (target[1] - source[1]) * clamp),
      Math.round(source[2] + (target[2] - source[2]) * clamp)
    ];
  }

  function refinedNodeColor(node: AtlasNode): [number, number, number] {
    const color = nodeColor(node);
    return mixColor(color, atlasIsDark() ? DARK_NODE_NEUTRAL : LIGHT_NODE_NEUTRAL, 0.18);
  }

  function refinedCloudColor(cloud: AtlasCloud): [number, number, number] {
    const color = cloudColor(cloud);
    return mixColor(color, atlasIsDark() ? DARK_CLOUD_NEUTRAL : LIGHT_CLOUD_NEUTRAL, 0.48);
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
    return buildVisibleCloudHull(cloud);
  }

  function getCloudCentroid(cloud: AtlasCloud): [number, number] {
    const [dx, dy] = getCloudDriftOffset(cloud);
    return [cloud.centroid[0] + dx, cloud.centroid[1] + dy];
  }

  function getVisibleCloudNodes(cloud: AtlasCloud): AtlasNode[] {
    return cloud.memberNodeIds
      .map((id) => nodeById.get(id))
      .filter((node): node is AtlasNode => Boolean(node))
      .filter((node) => !atlas.searchQuery.trim() || atlas.nodeSearchOpacity(node) > 0.1);
  }

  function getCloudLabelPosition(cloud: AtlasCloud): [number, number] {
    const nodes = getVisibleCloudNodes(cloud);
    if (nodes.length === 0) {
      const hull = getCloudHull(cloud);
      const minX = Math.min(...hull.map(([x]) => x));
      const maxX = Math.max(...hull.map(([x]) => x));
      const minY = Math.min(...hull.map(([, y]) => y));
      return [(minX + maxX) / 2, minY + labelInsetWorldUnits(cloud)];
    }
    const positions = nodes.map((node) => getNodePosition(node, atlas.driftStaleNotes));
    const minX = Math.min(...positions.map(([x]) => x));
    const maxX = Math.max(...positions.map(([x]) => x));
    const minY = Math.min(...positions.map(([, y]) => y));
    const maxRadius = Math.max(...nodes.map((node) => node.radius));
    return [(minX + maxX) / 2, minY - labelClearanceWorldUnits(cloud, maxRadius)];
  }

  function labelClearanceWorldUnits(cloud: AtlasCloud, maxNodeRadius: number) {
    const labelSize = getCloudLabelSize(cloud);
    return (maxNodeRadius + labelSize + 10) / Math.max(0.7, atlas.zoom);
  }

  function labelInsetWorldUnits(cloud: AtlasCloud) {
    return (getCloudLabelSize(cloud) + 8) / Math.max(0.7, atlas.zoom);
  }

  function nodeColor(node: AtlasNode): [number, number, number] {
    if (atlas.searchQuery.trim() && !atlas.nodeHasSearchHit(node)) return SEARCH_DIM_NODE_COLOR;
    const cloud = node.childCloudId ? cloudById.get(node.childCloudId) : node.cloudId ? cloudById.get(node.cloudId) : null;
    const color = cloud?.color ?? (node.cloudId ? cloudById.get(node.cloudId)?.color : null);
    return color ? [color[0], color[1], color[2]] : [190, 198, 210];
  }

  function cloudColor(cloud: AtlasCloud): [number, number, number] {
    if (atlas.searchQuery.trim() && !atlas.cloudHasSearchHit(cloud)) return SEARCH_DIM_CLOUD_COLOR;
    return [cloud.color[0], cloud.color[1], cloud.color[2]];
  }

  function buildVisibleCloudHull(cloud: AtlasCloud): [number, number][] {
    const nodes = getVisibleCloudNodes(cloud);
    if (nodes.length === 0) return cloud.hull;
    const positions = nodes.map((node) => getNodePosition(node, atlas.driftStaleNotes));
    const maxNodeRadius = Math.max(...nodes.map((node) => node.radius));
    const reservedLabelSpace = maxNodeRadius + getCloudLabelSize(cloud) + 18;
    const padding = Math.max(cloud.level === 0 ? 42 : 26, reservedLabelSpace) / Math.max(0.7, atlas.zoom);
    if (positions.length < 3) {
      return circleHull(getCloudCentroid(cloud), padding + 28, cloud.id);
    }
    const centroid = positions.reduce(
      (acc, point) => [acc[0] + point[0] / positions.length, acc[1] + point[1] / positions.length] as [number, number],
      [0, 0] as [number, number]
    );
    const radial = Array.from({ length: cloud.level === 0 ? 42 : 28 }, (_, index) => {
      const angle = (index / (cloud.level === 0 ? 42 : 28)) * Math.PI * 2;
      const extent = positions.reduce((max, [x, y]) => {
        const projection = (x - centroid[0]) * Math.cos(angle) + (y - centroid[1]) * Math.sin(angle);
        return Math.max(max, projection);
      }, 24);
      const wobble = 1 + Math.sin(angle * 2 + stableNumericHash(cloud.id) * 0.0001) * 0.018;
      const radius = Math.max(48, extent + padding) * wobble;
      return [centroid[0] + Math.cos(angle) * radius, centroid[1] + Math.sin(angle) * radius] as [number, number];
    });
    return chaikin(radial, 2);
  }

  function circleHull(center: [number, number], radius: number, seed: string): [number, number][] {
    const offset = stableNumericHash(seed) % 31;
    return Array.from({ length: 24 }, (_, index) => {
      const angle = ((index + offset / 31) / 24) * Math.PI * 2;
      return [center[0] + Math.cos(angle) * radius, center[1] + Math.sin(angle) * radius] as [number, number];
    });
  }

  function chaikin(points: [number, number][], iterations: number): [number, number][] {
    let current = points;
    for (let pass = 0; pass < iterations; pass += 1) {
      const next: [number, number][] = [];
      for (let index = 0; index < current.length; index += 1) {
        const a = current[index];
        const b = current[(index + 1) % current.length];
        next.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
        next.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
      }
      current = next;
    }
    return current;
  }

  function stableNumericHash(value: string) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function formatTimestamp(value: number | null) {
    if (!value) return 'Never';
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    }).format(new Date(value));
  }

  function cloudLabel(id: string | null) {
    if (!id) return 'None';
    const cloud = cloudById.get(id);
    if (!cloud) return id;
    return formatCloudLabelText(cloud);
  }

  function truncateAtlasLabel(label: string) {
    const normalized = label.trim();
    if (normalized.length <= NOTE_LABEL_MAX_LENGTH) return normalized;
    return `${normalized.slice(0, NOTE_LABEL_MAX_LENGTH - 3).trimEnd()}...`;
  }

  function truncateCloudLabel(cloud: AtlasCloud) {
    const raw = formatCloudLabelText(cloud);
    if (raw.length <= CLOUD_LABEL_MAX_LENGTH) return raw;
    return `${raw.slice(0, CLOUD_LABEL_MAX_LENGTH - 3).trimEnd()}...`;
  }

  function formatCloudLabelText(cloud: AtlasCloud) {
    const source = cloud.labelSource ?? 'pending';
    if (source === 'pending') {
      return 'Naming…';
    }
    const base = (cloud.label ?? 'Semantic cloud').trim();
    if (source === 'medoid') {
      return `~ ${base}`;
    }
    return base;
  }

  function getCloudLabelSize(cloud: AtlasCloud) {
    const label = formatCloudLabelText(cloud);
    const baseSize = cloud.parentId ? 11 : 14;
    return label.length > 16 ? baseSize - 1 : baseSize;
  }

  function getNoteLabelOffsetWorldUnits(node: AtlasNode) {
    return (node.radius / 2) / Math.max(0.7, atlas.zoom);
  }

  function buildLayers() {
    if (!deckLayers || !deckCore || !atlas.response) return [];
    const { ScatterplotLayer, LineLayer, PathLayer, SolidPolygonLayer, TextLayer } = deckLayers;
    const colors = atlasThemeColors();
    const foreground = colors.foreground;
    const muted = colors.muted;
    const selectedNodeId = atlas.selectedNodeId;
    const selectedCloudId = atlas.selectedCloudId;
    const hoveredCloudId = atlas.hoveredCloudId;
    const hoveredNodeId = atlas.hoveredNodeId;
    const tier = atlas.zoomTier;
    const showAllTitles = tier === 'close';
    const showRepresentativeTitles = tier === 'near';
    const titleNodeIds = new SvelteSet<string>();
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
      (node) =>
        showAllTitles ||
        (showRepresentativeTitles && titleNodeIds.has(node.id)) ||
        node.id === selectedNodeId ||
        node.id === hoveredNodeId ||
        (atlas.searchQuery.trim() && (atlas.searchMatchForNode(node)?.score ?? 0) > 0.42)
    );

    return [
      new SolidPolygonLayer({
        id: 'atlas-cloud-fills',
        data: clouds,
        getPolygon: getCloudHull,
        updateTriggers: {
          getPolygon: [atlas.driftStaleNotes, atlas.searchResponse, atlas.zoom],
          getFillColor: [atlas.searchResponse, selectedCloudId, hoveredCloudId]
        },
        getFillColor: (cloud: AtlasCloud) => {
          const isActive = cloud.id === selectedCloudId || cloud.id === hoveredCloudId;
          const alpha = Math.round((isActive ? 68 : 34) * atlas.cloudSearchOpacity(cloud));
          const [r, g, b] = refinedCloudColor(cloud);
          return [r, g, b, Math.max(5, Math.min(76, alpha))];
        },
        pickable: true,
        stroked: false,
        onClick: ({ object }: { object?: AtlasCloud }) => {
          if (!object) return;
          atlas.selectCloud(object);
          renderDeck();
        },
        onHover: ({ object }: { object?: AtlasCloud }) => {
          handleCloudHover(object ?? null);
        }
      }),
      new PathLayer({
        id: 'atlas-cloud-outlines',
        data: clouds,
        getPath: getCloudHull,
        updateTriggers: {
          getPath: [atlas.driftStaleNotes, atlas.searchResponse, atlas.zoom],
          getColor: [atlas.searchResponse, selectedCloudId, hoveredCloudId]
        },
        getColor: (cloud: AtlasCloud) => {
          const isActive = cloud.id === selectedCloudId || cloud.id === hoveredCloudId;
          const alpha = isActive ? 126 : Math.round(58 * atlas.cloudSearchOpacity(cloud));
          const [r, g, b] = refinedCloudColor(cloud);
          return [r, g, b, alpha];
        },
        getWidth: (cloud: AtlasCloud) => (cloud.parentId ? 0.75 : 1),
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
        updateTriggers: {
          getPosition: [atlas.driftStaleNotes],
          getRadius: [atlas.searchResponse, selectedNodeId],
          getFillColor: [atlas.searchResponse, selectedNodeId],
          getLineWidth: [selectedNodeId]
        },
        getRadius: (node: AtlasNode) =>
          (node.id === selectedNodeId ? node.radius + 4 : node.radius) * atlas.nodeSearchRadiusMultiplier(node),
        radiusUnits: 'pixels',
        getFillColor: (node: AtlasNode) => {
          const [r, g, b] = node.id === selectedNodeId ? [255, 255, 255] : refinedNodeColor(node);
          const alpha = node.id === selectedNodeId
            ? 255
            : Math.round((node.isolated ? 135 : 118 + node.centrality * 106) * atlas.nodeSearchOpacity(node));
          return [r, g, b, Math.max(18, Math.min(255, alpha))];
        },
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
        getPosition: getCloudLabelPosition,
        updateTriggers: {
          getPosition: [atlas.driftStaleNotes, atlas.searchResponse, atlas.zoom],
          getColor: [atlas.searchResponse, selectedCloudId, hoveredCloudId],
          getText: [labelRenderKey],
          getSize: [labelRenderKey]
        },
        getText: (cloud: AtlasCloud) => truncateCloudLabel(cloud),
        getSize: getCloudLabelSize,
        sizeUnits: 'pixels',
        getColor: (cloud: AtlasCloud) => {
          const source = cloud.labelSource ?? 'pending';
          const base =
            cloud.id === selectedCloudId || cloud.id === hoveredCloudId
              ? colors.cloudLabel
              : colors.cloudLabelMuted;
          const sourceAlpha =
            source === 'keybert' ? 1 : source === 'medoid' ? 0.72 : 0.55;
          return [
            base[0],
            base[1],
            base[2],
            Math.round(base[3] * sourceAlpha * atlas.cloudSearchOpacity(cloud))
          ];
        },
        getTextAnchor: 'middle',
        getAlignmentBaseline: 'center',
        parameters: { depthTest: false }
      }),
      new TextLayer({
        id: 'atlas-note-labels',
        data: labelNodes,
        getPosition: (node: AtlasNode) => {
          const [x, y] = getNodePosition(node, atlas.driftStaleNotes);
          return [x, y - getNoteLabelOffsetWorldUnits(node)];
        },
        updateTriggers: {
          getPosition: [atlas.driftStaleNotes, atlas.zoom],
          getText: [selectedNodeId, hoveredNodeId]
        },
        getText: (node: AtlasNode) =>
          node.id === atlas.hoveredNodeId || node.id === atlas.selectedNodeId
            ? node.title || node.fileName
            : truncateAtlasLabel(node.title || node.fileName),
        getSize: tier === 'close' ? 12 : 10,
        sizeUnits: 'pixels',
        getColor: [foreground[0], foreground[1], foreground[2], tier === 'close' ? 220 : 155],
        getTextAnchor: 'middle',
        getAlignmentBaseline: 'bottom',
        background: tier === 'close',
        getBackgroundColor: colors.labelBackground,
        backgroundPadding: [3, 2],
        parameters: { depthTest: false }
      })
    ];
  }

  const renderedLayers = $derived.by(() => buildLayers());

  function renderDeck() {
    if (!deck) return;
    deck.setProps({
      viewState,
      layers: buildLayers()
    });
  }

  function syncDeckLayers() {
    const currentDeck = deck;
    const layers = renderedLayers;
    if (!currentDeck) return;
    currentDeck.setProps({ layers });
  }

  function fittedViewState(): { target: [number, number, number]; zoom: number } | null {
    const nodes = atlas.visibleNodes;
    if (nodes.length === 0) return null;
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
    return {
      target: [(minX + maxX) / 2, (minY + maxY) / 2, 0] as [number, number, number],
      zoom: Math.max(-4, Math.min(0.05, Math.log2(scale)))
    };
  }

  function fitView() {
    const nextViewState = fittedViewState();
    if (!nextViewState) return;
    viewState = nextViewState;
    atlas.setZoom(Math.pow(2, viewState.zoom));
    renderDeck();
  }

  function nextAnimationFrame() {
    return new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
  }

  async function openSelectedNode() {
    const node = atlas.selectedNode;
    if (!node) return;
    await openNode(node);
  }

  async function openNode(node: AtlasNode) {
    storePendingNoteTarget({
      noteId: node.noteId,
      notePath: node.notePath,
      documentKind: node.documentKind
    });
    await goto(resolve('/'));
  }

  function handleNodeHover(node: AtlasNode | null) {
    if (atlas.hoveredNodeId === (node?.id ?? null)) return;
    isHoveringNote = node !== null;
    atlas.hoverNode(node);
    renderDeck();
  }

  function handleCloudHover(cloud: AtlasCloud | null) {
    if (atlas.hoveredCloudId === (cloud?.id ?? null)) return;
    atlas.hoverCloud(cloud);
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

  function attachContainer(element: HTMLDivElement) {
    containerEl = element;
    if (deck) {
      deck.setProps({
        viewState,
        layers: renderedLayers
      });
    }
    return () => {
      if (containerEl === element) containerEl = null;
    };
  }

  onMount(() => {
    let mounted = true;
    (async () => {
      isDeckVisible = false;
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
      await tick();
      if (!mounted || !containerEl) return;
      const initialViewState = fittedViewState();
      if (initialViewState) {
        viewState = initialViewState;
        atlas.setZoom(Math.pow(2, viewState.zoom));
      }
      const nextDeck = new DeckCtor({
        parent: containerEl,
        views: [new OrthographicViewCtor({ controller: true })],
        controller: true,
        viewState,
        getCursor: ({ isDragging }: { isDragging?: boolean }) => {
          if (isDragging) return 'grabbing';
          return isHoveringNote ? 'pointer' : 'grab';
        },
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
          // Push viewState only; layer rebuilds come from `$derived`
          // `renderedLayers` → `syncDeckLayers` when zoom tier / selection changes.
          deck?.setProps({ viewState });
        },
        onClick: ({ object }: { object?: unknown }) => {
          if (!object) {
            atlas.clearSelection();
            renderDeck();
          }
        }
      });
      if (!mounted) {
        nextDeck.finalize();
        return;
      }
      deck = nextDeck;
      renderDeck();
      await nextAnimationFrame();
      await nextAnimationFrame();
      if (mounted) {
        isDeckVisible = true;
      }
    })();

    return () => {
      mounted = false;
      atlas.dispose();
      deck?.finalize();
      deck = null;
    };
  });

</script>

<svelte:window onkeydown={handleKeydown} />

<div class="atlas-surface relative h-full w-full overflow-hidden text-white">
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    {@attach attachContainer}
    {@attach syncDeckLayers}
    ondblclick={() => void openSelectedNode()}
    class={`absolute inset-0 transition-opacity duration-100 ${isDeckVisible ? 'opacity-100' : 'opacity-0'} ${isHoveringNote ? 'cursor-pointer' : 'cursor-grab'}`}
  ></div>

  <SearchDock>
    <SearchBar
      value={atlas.searchQuery}
      placeholder="Find notes"
      ariaLabel="Search atlas notes"
      matchCase={atlas.matchCase}
      matchWholeWord={atlas.matchWholeWord}
      showMatchOptions={false}
      shortcut={{ enabled: true }}
      onValueChange={(value) => {
        atlas.setSearchQuery(value);
      }}
      onMatchCaseChange={(enabled) => {
        atlas.matchCase = enabled;
      }}
      onMatchWholeWordChange={(enabled) => {
        atlas.matchWholeWord = enabled;
      }}
    >
        <label class="sr-only" for="atlas-chat-visibility">Chat visibility</label>
        <select
          id="atlas-chat-visibility"
          class="h-8 rounded-full border border-border bg-background px-2 text-xs text-foreground"
          value={atlas.chatVisibility}
          title="Chat visibility in Atlas"
          onchange={(event) => atlas.setChatVisibility(event.currentTarget.value as 'hidden' | 'remembered' | 'all')}
        >
          <option value="hidden">Notes only</option>
          <option value="remembered">Remembered chats</option>
          <option value="all">All chats</option>
        </select>
        <button
          type="button"
          class={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors ${
            atlas.driftStaleNotes ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-accent hover:text-foreground'
          }`}
          title="Drift stale notes"
          onclick={handleToggleDrift}
        >
          <ArrowDownLeftFromCircle class="h-4 w-4" />
        </button>
        <button
          type="button"
          class={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors ${
            atlas.showLinks ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-accent hover:text-foreground'
          }`}
          title="Toggle links"
          onclick={() => atlas.toggleLinks()}
        >
          <LinkIcon class="h-4 w-4" />
        </button>
        <button
          type="button"
          class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          title="Fit view"
          onclick={fitView}
        >
          <Focus class="h-4 w-4" />
        </button>
    </SearchBar>
  </SearchDock>

  {#if (!hasReadyMap && atlas.error) || atlas.response?.status === 'unavailable' || atlas.response?.status === 'empty'}
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
            onclick={() => void goto(resolve('/settings'))}
          >
            Open Settings
          </button>
        {/if}
      </div>
    </div>
  {:else if isColdBuilding}
    <div class="absolute inset-0 z-20 flex items-center justify-center">
      <div class="max-w-md rounded-[1.5rem] border border-border/80 bg-card/90 px-5 py-5 text-center shadow-md backdrop-blur-md">
        <LoaderCircle class="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
        <p class="mt-3 text-sm font-semibold">Building your atlas</p>
        <p class="mt-2 text-sm text-muted-foreground">
          {atlas.response?.reason ?? 'Semantic structure is being prepared in the background.'}
        </p>
      </div>
    </div>
  {/if}

  {#if hasReadyMap && atlas.isRevalidating}
    <div
      class="pointer-events-none absolute bottom-5 left-5 z-20 inline-flex items-center gap-2 rounded-full border border-border/70 bg-card/80 px-3 py-1.5 text-xs text-muted-foreground shadow-sm backdrop-blur-md"
      aria-live="polite"
    >
      <LoaderCircle class="h-3.5 w-3.5 animate-spin" />
      Updating atlas
    </div>
  {/if}

  {#if atlas.selectedNode}
    <aside class="absolute right-5 top-14 z-20 flex max-h-[calc(100vh-5.5rem)] w-[min(23rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-border/80 bg-card/90 p-4 text-foreground shadow-lg backdrop-blur-md">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <p class="text-[0.68rem] font-medium uppercase tracking-wide text-muted-foreground">Note</p>
          <p class="mt-5 min-w-0 text-xl font-semibold leading-7 text-foreground">{atlas.selectedNode.title}</p>
          <div class="mt-1.5 flex items-center gap-2">
            <span class="shrink-0 rounded-full border border-border/80 bg-muted/40 px-2 py-0.5 text-[0.7rem] text-muted-foreground">
              Importance {Math.round(atlas.selectedNode.importance * 100)}%
            </span>
          </div>
        </div>
        <div class="flex shrink-0 items-center gap-1">
          <button
            type="button"
            class="rounded-full p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            title="Open note"
            onclick={() => void openSelectedNode()}
          >
            <ExternalLink class="h-4 w-4" />
          </button>
          <button
            type="button"
            class="rounded-full p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            title="Clear selection"
            onclick={() => atlas.clearSelection()}
          >
            <X class="h-4 w-4" />
          </button>
        </div>
      </div>
      {#if atlas.selectedNode.preview}
        <div class="mt-5 border-t border-border/70 pt-4">
          <p class="text-[0.68rem] font-medium uppercase tracking-wide text-muted-foreground">Preview</p>
          <p class="mt-2 max-h-24 overflow-hidden text-sm leading-6 text-muted-foreground">{atlas.selectedNode.preview}</p>
        </div>
      {/if}
      <div class="mt-4 grid gap-2 border-t border-border/70 pt-4 text-xs">
        <div class="flex items-center justify-between gap-3">
          <span class="text-muted-foreground">Last accessed</span>
          <span class="truncate text-foreground/80">{formatTimestamp(atlas.selectedNode.lastViewedAtMillis)}</span>
        </div>
        <div class="flex items-center justify-between gap-3">
          <span class="text-muted-foreground">Created</span>
          <span class="truncate text-foreground/80">{formatTimestamp(atlas.selectedNode.createdAtMillis)}</span>
        </div>
        <div class="flex items-center justify-between gap-3">
          <span class="text-muted-foreground">Updated</span>
          <span class="truncate text-foreground/80">{formatTimestamp(atlas.selectedNode.updatedAtMillis)}</span>
        </div>
        <div class="flex items-center justify-between gap-3">
          <span class="text-muted-foreground">Cluster</span>
          <span class="truncate text-foreground/80">{cloudLabel(atlas.selectedNode.clusterId)}</span>
        </div>
        <div class="flex items-center justify-between gap-3">
          <span class="text-muted-foreground">Sub-cluster</span>
          <span class="truncate text-foreground/80">{cloudLabel(atlas.selectedNode.subclusterId)}</span>
        </div>
      </div>
      {#if atlas.selectedNode.tags.length > 0}
        <div class="mt-4">
          <p class="text-[0.68rem] font-medium uppercase tracking-wide text-muted-foreground">Tags</p>
          <div class="mt-2 flex flex-wrap gap-1.5">
            {#each atlas.selectedNode.tags as tag (tag)}
              <span class="rounded-full border border-border/80 bg-muted/40 px-2 py-1 text-[0.68rem] text-muted-foreground">{tag}</span>
            {/each}
          </div>
        </div>
      {/if}
      <div class="mt-4 flex min-h-0 flex-1 flex-col border-t border-border/70 pt-3">
        <div class="flex shrink-0 items-center justify-between gap-3">
          <p class="text-[0.68rem] font-medium uppercase tracking-wide text-muted-foreground">Related notes</p>
          <p class="text-xs text-muted-foreground">
            {atlas.selectedNodeLinkedNotes.wikilinks.length + atlas.selectedNodeLinkedNotes.semantic.length}
          </p>
        </div>
        <div class="mt-2 min-h-0 flex-1 overflow-y-auto pr-1">
          {#if atlas.selectedNodeLinkedNotes.wikilinks.length === 0 && atlas.selectedNodeLinkedNotes.semantic.length === 0}
            <p class="rounded-xl bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              No high-confidence linked notes.
            </p>
          {:else}
            {#if atlas.selectedNodeLinkedNotes.wikilinks.length > 0}
              <div class="mb-3">
                <p class="mb-1.5 px-1 text-[0.65rem] font-medium uppercase tracking-wide text-muted-foreground">
                  Wikilinks
                </p>
                <div class="space-y-0.5">
                  {#each atlas.selectedNodeLinkedNotes.wikilinks as item (item.link.id)}
                    <div class="group flex items-center gap-1 rounded-lg hover:bg-accent">
                      <button
                        type="button"
                        class="min-w-0 flex-1 px-2.5 py-2 text-left text-xs"
                        onclick={() => {
                          atlas.selectNode(item.node);
                          renderDeck();
                        }}
                      >
                        <span class="block truncate font-medium text-foreground">{item.node.title}</span>
                      </button>
                      <button
                        type="button"
                        class="mr-1 shrink-0 rounded-full p-1.5 text-muted-foreground opacity-70 hover:bg-background/80 hover:text-foreground hover:opacity-100"
                        title="Open note"
                        onclick={() => void openNode(item.node)}
                      >
                        <ExternalLink class="h-3.5 w-3.5" />
                      </button>
                    </div>
                  {/each}
                </div>
              </div>
            {/if}
            {#if atlas.selectedNodeLinkedNotes.semantic.length > 0}
              <div>
                <p class="mb-1.5 px-1 text-[0.65rem] font-medium uppercase tracking-wide text-muted-foreground">
                  Semantic
                </p>
                <div class="space-y-0.5">
                  {#each atlas.selectedNodeLinkedNotes.semantic as item (item.link.id)}
                    <div class="group flex items-center gap-1 rounded-lg hover:bg-accent">
                      <button
                        type="button"
                        class="min-w-0 flex-1 px-2.5 py-2 text-left text-xs"
                        onclick={() => {
                          atlas.selectNode(item.node);
                          renderDeck();
                        }}
                      >
                        <span class="flex min-w-0 items-center justify-between gap-2">
                          <span class="truncate font-medium text-foreground">{item.node.title}</span>
                          <span class="shrink-0 rounded-full bg-muted/60 px-1.5 py-0.5 text-[0.65rem] text-muted-foreground">
                            {Math.round(item.link.strength * 100)}%
                          </span>
                        </span>
                      </button>
                      <button
                        type="button"
                        class="mr-1 shrink-0 rounded-full p-1.5 text-muted-foreground opacity-70 hover:bg-background/80 hover:text-foreground hover:opacity-100"
                        title="Open note"
                        onclick={() => void openNode(item.node)}
                      >
                        <ExternalLink class="h-3.5 w-3.5" />
                      </button>
                    </div>
                  {/each}
                </div>
              </div>
            {/if}
          {/if}
        </div>
      </div>
    </aside>
  {:else if atlas.selectedCloud}
    <aside class="absolute bottom-24 right-4 z-20 w-[min(22rem,calc(100vw-2rem))] rounded-[1.5rem] border border-border/80 bg-card/90 p-4 shadow-lg backdrop-blur-md">
      <div class="flex items-start justify-between gap-3">
        <div>
          <p class="text-sm font-semibold">{formatCloudLabelText(atlas.selectedCloud)}</p>
          <p class="mt-1 text-xs text-muted-foreground">
            {atlas.selectedCloud.noteCount} notes · {Math.round(atlas.selectedCloud.density * 100)}% density
            {#if (atlas.selectedCloud.labelSource ?? 'pending') === 'pending'}
              · naming in progress
            {:else if atlas.selectedCloud.labelSource === 'medoid'}
              · title fallback
            {/if}
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

</div>

<style>
  .atlas-surface {
    background: var(--background);
  }

  .atlas-surface::before {
    content: none;
  }
</style>
