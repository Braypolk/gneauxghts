import { invoke } from '@tauri-apps/api/core';
import { appStore } from '$lib/app/appStore.svelte';
import type {
  AtlasCloud,
  AtlasLink,
  AtlasNode,
  AtlasSearchMatch,
  AtlasSearchResponse,
  VaultAtlasResponse
} from '$lib/types/atlas';

export type AtlasZoomTier = 'far' | 'mid' | 'near' | 'close';
export type AtlasLinkedNote = {
  node: AtlasNode;
  link: AtlasLink;
};

const LINK_CONFIDENCE_FLOORS: Record<AtlasZoomTier, number> = {
  far: 0.92,
  mid: 0.86,
  near: 0.8,
  close: 0.76
};
const FOCUSED_LINK_CONFIDENCE_FLOOR = 0.7;
const SELECTED_CLOUD_LINK_CONFIDENCE_FLOOR = 0.74;
const ATLAS_SEARCH_HIT_MIN_SCORE = 0.32;
const ATLAS_SEARCH_HIT_MIN_SEMANTIC = 0.5;
const ATLAS_SEARCH_HIT_MIN_LEXICAL = 0.65;
const ATLAS_SEARCH_HIT_MIN_STRUCTURAL = 0.38;

export class AtlasStore {
  response = $state<VaultAtlasResponse | null>(null);
  isLoading = $state(false);
  isStale = $state(false);
  error = $state<string | null>(null);
  searchError = $state<string | null>(null);
  searchResponse = $state<AtlasSearchResponse | null>(null);
  isSearching = $state(false);
  selectedNodeId = $state<string | null>(null);
  selectedCloudId = $state<string | null>(null);
  hoveredCloudId = $state<string | null>(null);
  hoveredNodeId = $state<string | null>(null);
  searchQuery = $state('');
  matchCase = $state(false);
  matchWholeWord = $state(false);
  driftStaleNotes = $state(false);
  showLinks = $state(true);
  zoom = $state(1);

  #refreshTimer: number | null = null;
  #searchTimer: number | null = null;
  #disposeCallbacks: (() => void)[] = [];
  #lastIndexingInProgress = false;
  #lastIndexedAtMillis: number | null = null;
  #refreshRequestedDuringLoad = false;
  #searchSequence = 0;

  selectedNode = $derived.by(() =>
    this.response?.nodes.find((node) => node.id === this.selectedNodeId) ?? null
  );

  selectedCloud = $derived.by(() =>
    this.response?.clouds.find((cloud) => cloud.id === this.selectedCloudId) ?? null
  );

  hoveredCloud = $derived.by(() =>
    this.response?.clouds.find((cloud) => cloud.id === this.hoveredCloudId) ?? null
  );

  selectedNodeLinkedNotes = $derived.by(() => {
    const selectedNodeId = this.selectedNodeId;
    const response = this.response;
    if (!selectedNodeId || !response) {
      return { wikilinks: [] as AtlasLinkedNote[], semantic: [] as AtlasLinkedNote[] };
    }
    const nodesById = new Map(response.nodes.map((node) => [node.id, node]));
    const linked = response.links
      .filter((link) => link.sourceId === selectedNodeId || link.targetId === selectedNodeId)
      .filter((link) => isHighConfidenceLink(link, FOCUSED_LINK_CONFIDENCE_FLOOR))
      .map((link) => {
        const otherId = link.sourceId === selectedNodeId ? link.targetId : link.sourceId;
        const node = nodesById.get(otherId);
        return node ? { node, link } : null;
      })
      .filter((item): item is AtlasLinkedNote => item !== null)
      .sort((left, right) => {
        const kindBoost = (right.link.kind === 'wikilink' ? 1 : 0) - (left.link.kind === 'wikilink' ? 1 : 0);
        return kindBoost || right.link.strength - left.link.strength || left.node.title.localeCompare(right.node.title);
      });
    return {
      wikilinks: linked.filter((item) => item.link.kind === 'wikilink'),
      semantic: linked.filter((item) => item.link.kind === 'semantic')
    };
  });

  zoomTier = $derived.by((): AtlasZoomTier => getZoomTier(this.zoom));

  searchMatchesByPath = $derived.by(() => {
    const matches = this.searchResponse?.matches ?? [];
    return new Map(matches.map((match) => [match.notePath, match]));
  });

  searchMatchesByNodeId = $derived.by(() => {
    const nodes = this.response?.nodes ?? [];
    const byPath = this.searchMatchesByPath;
    return new Map(
      nodes
        .map((node) => {
          const match = byPath.get(node.notePath) ?? null;
          return match ? ([node.id, match] as const) : null;
        })
        .filter((item): item is readonly [string, AtlasSearchMatch] => item !== null)
    );
  });

  visibleNodes = $derived.by(() => {
    return this.response?.nodes ?? [];
  });

  visibleNodeIds = $derived.by(() => new Set(this.visibleNodes.map((node) => node.id)));

  visibleLinks = $derived.by(() => {
    if (!this.showLinks) return [];
    const ids = this.visibleNodeIds;
    const tier = this.zoomTier;
    const selectedNodeId = this.selectedNodeId;
    const selectedCloudId = this.selectedCloudId;
    const hoveredNodeId = this.hoveredNodeId;
    if (!selectedNodeId && !selectedCloudId && !hoveredNodeId && (tier === 'far' || tier === 'mid')) {
      return [];
    }
    const nodesById = new Map((this.response?.nodes ?? []).map((node) => [node.id, node]));
    const candidates = (this.response?.links ?? []).filter((link) => {
      if (!ids.has(link.sourceId) || !ids.has(link.targetId)) return false;
      const touchesSelection = selectedNodeId
        ? link.sourceId === selectedNodeId || link.targetId === selectedNodeId
        : false;
      if (selectedNodeId) return touchesSelection && isHighConfidenceLink(link, FOCUSED_LINK_CONFIDENCE_FLOOR);
      const touchesHover = hoveredNodeId
        ? link.sourceId === hoveredNodeId || link.targetId === hoveredNodeId
        : false;
      if (touchesHover) return isHighConfidenceLink(link, FOCUSED_LINK_CONFIDENCE_FLOOR);
      if (touchesSelection) return isHighConfidenceLink(link, FOCUSED_LINK_CONFIDENCE_FLOOR);
      if (tier === 'far') return isHighConfidenceLink(link, LINK_CONFIDENCE_FLOORS.far);
      if (tier === 'mid') return isHighConfidenceLink(link, LINK_CONFIDENCE_FLOORS.mid);
      if (tier === 'near') return isHighConfidenceLink(link, LINK_CONFIDENCE_FLOORS.near);
      if (selectedCloudId) {
        const sourceCloudId = nodesById.get(link.sourceId)?.cloudId ?? null;
        const targetCloudId = nodesById.get(link.targetId)?.cloudId ?? null;
        const insideSelectedCloud = sourceCloudId === selectedCloudId && targetCloudId === selectedCloudId;
        return insideSelectedCloud && isHighConfidenceLink(link, SELECTED_CLOUD_LINK_CONFIDENCE_FLOOR);
      }
      return isHighConfidenceLink(link, LINK_CONFIDENCE_FLOORS.close);
    });
    if (selectedNodeId || hoveredNodeId) return strongestLinksPerNode(candidates, 4);
    return strongestLinksPerNode(candidates, tier === 'close' ? 2 : tier === 'near' ? 2 : 1);
  });

  visibleClouds = $derived.by(() => {
    const clouds = this.response?.clouds ?? [];
    const topLevelClouds = clouds.filter((cloud) => cloud.level === 0 || cloud.parentId === null);
    const selectedNode = this.selectedNode;
    const focusedCloud = this.hoveredCloud ?? this.selectedCloud;
    const focusedParentCloudId =
      focusedCloud?.level === 0
        ? focusedCloud.id
        : focusedCloud?.parentId ?? selectedNode?.cloudId ?? null;
    if (this.zoomTier === 'far' || this.zoomTier === 'mid') {
      if (!focusedParentCloudId) return this.filterSearchClouds(topLevelClouds);
      return this.filterSearchClouds(
        clouds.filter((cloud) => cloud.parentId === null || cloud.parentId === focusedParentCloudId)
      );
    }
    const selectedParentCloudId =
      focusedCloud?.level === 0
        ? focusedCloud.id
        : focusedCloud?.parentId ?? selectedNode?.cloudId ?? null;
    if (!selectedParentCloudId) return this.filterSearchClouds(topLevelClouds);
    return this.filterSearchClouds(
      clouds.filter((cloud) => cloud.parentId === null || cloud.parentId === selectedParentCloudId)
    );
  });

  async initialize() {
    await appStore.bootstrap().catch(() => undefined);
    this.#lastIndexingInProgress = appStore.semanticStatus?.indexingInProgress ?? false;
    this.#lastIndexedAtMillis = appStore.semanticStatus?.lastIndexedAtMillis ?? null;
    this.#disposeCallbacks.push(
      appStore.subscribeVaultNoteChanged(() => this.scheduleRefresh()),
      appStore.subscribeNoteSaved(() => this.scheduleRefresh()),
      appStore.subscribeVaultChanged(() => {
        this.response = null;
        this.selectedNodeId = null;
        this.selectedCloudId = null;
        this.hoveredCloudId = null;
        this.scheduleRefresh(80);
      }),
      appStore.subscribeSemanticStatusChanged((status) => {
        const wasIndexing = this.#lastIndexingInProgress;
        const lastIndexedAtMillis = this.#lastIndexedAtMillis;
        this.#lastIndexingInProgress = status.indexingInProgress;
        this.#lastIndexedAtMillis = status.lastIndexedAtMillis;
        if (status.indexingInProgress) {
          this.isStale = true;
          return;
        }
        if (wasIndexing || lastIndexedAtMillis !== status.lastIndexedAtMillis) {
          this.scheduleRefresh(120);
        }
      })
    );
    if (this.hasCurrentCachedResponse()) {
      this.isLoading = false;
      this.isStale = false;
      this.error = null;
      this.scheduleSearch(80);
      return;
    }
    await this.refresh();
  }

  dispose() {
    if (this.#refreshTimer) {
      window.clearTimeout(this.#refreshTimer);
      this.#refreshTimer = null;
    }
    if (this.#searchTimer) {
      window.clearTimeout(this.#searchTimer);
      this.#searchTimer = null;
    }
    for (const dispose of this.#disposeCallbacks) {
      dispose();
    }
    this.#disposeCallbacks = [];
  }

  scheduleRefresh(delay = 700) {
    this.isStale = true;
    if (this.#refreshTimer) {
      window.clearTimeout(this.#refreshTimer);
    }
    this.#refreshTimer = window.setTimeout(() => {
      this.#refreshTimer = null;
      void this.refresh();
    }, delay);
  }

  hasCurrentCachedResponse(): boolean {
    return Boolean(
      this.response &&
        this.response.status === 'ready' &&
        this.response.revision === appStore.indexRevision &&
        !appStore.semanticStatus?.indexingInProgress
    );
  }

  async refresh() {
    if (this.isLoading) {
      this.#refreshRequestedDuringLoad = true;
      this.isStale = true;
      return;
    }
    this.isLoading = true;
    this.error = null;
    try {
      this.response = await invoke<VaultAtlasResponse>('get_vault_atlas');
      this.isStale = false;
      this.scheduleSearch(80);
      if (this.selectedNodeId && !this.response.nodes.some((node) => node.id === this.selectedNodeId)) {
        this.selectedNodeId = null;
      }
      if (
        this.selectedCloudId &&
        !this.response.clouds.some((cloud) => cloud.id === this.selectedCloudId)
      ) {
        this.selectedCloudId = null;
      }
      if (
        this.hoveredCloudId &&
        !this.response.clouds.some((cloud) => cloud.id === this.hoveredCloudId)
      ) {
        this.hoveredCloudId = null;
      }
    } catch (error) {
      this.error = String(error);
    } finally {
      this.isLoading = false;
      if (this.#refreshRequestedDuringLoad) {
        this.#refreshRequestedDuringLoad = false;
        this.scheduleRefresh(80);
      }
    }
  }

  selectNode(node: AtlasNode | null) {
    this.selectedNodeId = node?.id ?? null;
    if (node) {
      this.selectedCloudId = node.cloudId;
    }
  }

  hoverNode(node: AtlasNode | null) {
    this.hoveredNodeId = node?.id ?? null;
  }

  hoverCloud(cloud: AtlasCloud | null) {
    this.hoveredCloudId = cloud?.id ?? null;
  }

  selectCloud(cloud: AtlasCloud | null) {
    this.selectedCloudId = cloud?.id ?? null;
    this.selectedNodeId = null;
  }

  clearSelection() {
    this.selectedNodeId = null;
    this.selectedCloudId = null;
  }

  setZoom(zoom: number) {
    this.zoom = Math.max(0.08, Math.min(8, zoom));
  }

  setSearchQuery(query: string) {
    this.searchQuery = query;
    if (this.searchResponse?.query !== query.trim()) {
      this.searchResponse = null;
    }
    this.scheduleSearch();
  }

  scheduleSearch(delay = 180) {
    if (this.#searchTimer) {
      window.clearTimeout(this.#searchTimer);
    }
    const query = this.searchQuery.trim();
    if (!query) {
      this.searchResponse = null;
      this.searchError = null;
      this.isSearching = false;
      return;
    }
    this.#searchTimer = window.setTimeout(() => {
      this.#searchTimer = null;
      void this.runSearch(query);
    }, delay);
  }

  async runSearch(query = this.searchQuery.trim()) {
    const sequence = ++this.#searchSequence;
    if (!query) {
      this.searchResponse = null;
      this.searchError = null;
      this.isSearching = false;
      return;
    }
    this.isSearching = true;
    this.searchError = null;
    try {
      const response = await invoke<AtlasSearchResponse>('search_vault_atlas', { query });
      if (sequence !== this.#searchSequence || query !== this.searchQuery.trim()) return;
      this.searchResponse = response;
    } catch (error) {
      if (sequence !== this.#searchSequence) return;
      this.searchError = String(error);
    } finally {
      if (sequence === this.#searchSequence) {
        this.isSearching = false;
      }
    }
  }

  searchMatchForNode(node: AtlasNode): AtlasSearchMatch | null {
    if (!this.searchQuery.trim()) return null;
    return this.searchMatchesByNodeId.get(node.id) ?? null;
  }

  nodeHasSearchHit(node: AtlasNode): boolean {
    if (!this.searchQuery.trim()) return true;
    return isAtlasSearchHit(this.searchMatchForNode(node));
  }

  nodeSearchOpacity(node: AtlasNode): number {
    if (!this.searchQuery.trim()) return 1;
    const match = this.searchMatchForNode(node);
    if (!match) return 0.08;
    return Math.max(0.22, Math.min(1, 0.28 + match.score * 0.82));
  }

  nodeSearchRadiusMultiplier(node: AtlasNode): number {
    if (!this.searchQuery.trim()) return 1;
    const match = this.searchMatchForNode(node);
    if (!match) return 0.7;
    return 0.95 + Math.min(0.75, match.score * 0.85);
  }

  cloudSearchOpacity(cloud: AtlasCloud): number {
    if (!this.searchQuery.trim()) return 1;
    const ids = new Set(cloud.memberNodeIds);
    const scores = [...this.searchMatchesByNodeId.entries()]
      .filter(([nodeId, match]) => ids.has(nodeId) && isAtlasSearchHit(match))
      .map(([, match]) => match.score);
    if (scores.length === 0) return 0.16;
    return Math.max(0.28, Math.min(1, 0.35 + Math.max(...scores) * 0.75));
  }

  cloudHasSearchHit(cloud: AtlasCloud): boolean {
    if (!this.searchQuery.trim()) return true;
    const ids = new Set(cloud.memberNodeIds);
    return [...this.searchMatchesByNodeId.entries()].some(
      ([nodeId, match]) => ids.has(nodeId) && isAtlasSearchHit(match)
    );
  }

  filterSearchClouds(clouds: AtlasCloud[]): AtlasCloud[] {
    return clouds;
  }

  toggleDrift() {
    this.driftStaleNotes = !this.driftStaleNotes;
  }

  toggleLinks() {
    this.showLinks = !this.showLinks;
  }
}

export const atlasStore = new AtlasStore();

export function getZoomTier(zoom: number): AtlasZoomTier {
  if (zoom < 0.4) return 'far';
  if (zoom < 0.85) return 'mid';
  if (zoom < 1.6) return 'near';
  return 'close';
}

export function isHighConfidenceLink(link: AtlasLink, minimumStrength: number): boolean {
  return link.kind === 'wikilink' || link.strength >= minimumStrength;
}

export function isAtlasSearchHit(match: AtlasSearchMatch | null): boolean {
  if (!match) return false;
  return (
    match.score >= ATLAS_SEARCH_HIT_MIN_SCORE ||
    match.semanticScore >= ATLAS_SEARCH_HIT_MIN_SEMANTIC ||
    match.lexicalScore >= ATLAS_SEARCH_HIT_MIN_LEXICAL ||
    match.structuralScore >= ATLAS_SEARCH_HIT_MIN_STRUCTURAL
  );
}

export function strongestLinksPerNode(links: AtlasLink[], maxPerNode: number): AtlasLink[] {
  const counts = new Map<string, number>();
  return [...links]
    .sort((left, right) => {
      const leftKindBoost = left.kind === 'wikilink' ? 1 : 0;
      const rightKindBoost = right.kind === 'wikilink' ? 1 : 0;
      return (
        rightKindBoost - leftKindBoost ||
        right.strength - left.strength ||
        right.score - left.score ||
        left.id.localeCompare(right.id)
      );
    })
    .filter((link) => {
      const sourceCount = counts.get(link.sourceId) ?? 0;
      const targetCount = counts.get(link.targetId) ?? 0;
      if (sourceCount >= maxPerNode || targetCount >= maxPerNode) return false;
      counts.set(link.sourceId, sourceCount + 1);
      counts.set(link.targetId, targetCount + 1);
      return true;
    });
}

export function getNodePosition(node: AtlasNode, driftStaleNotes: boolean): [number, number] {
  return driftStaleNotes ? [node.driftX, node.driftY] : [node.x, node.y];
}

export function linkEndpoints(
  link: AtlasLink,
  nodeById: Map<string, AtlasNode>,
  driftStaleNotes: boolean
): [number, number][] {
  const source = nodeById.get(link.sourceId);
  const target = nodeById.get(link.targetId);
  if (!source || !target) return [];
  return [getNodePosition(source, driftStaleNotes), getNodePosition(target, driftStaleNotes)];
}
