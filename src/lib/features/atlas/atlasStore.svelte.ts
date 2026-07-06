import { invoke } from '@tauri-apps/api/core';
import { appStore } from '$lib/app/appStore.svelte';
import type { AtlasCloud, AtlasLink, AtlasNode, VaultAtlasResponse } from '$lib/types/atlas';

export type AtlasZoomTier = 'far' | 'mid' | 'near' | 'close';

export class AtlasStore {
  response = $state<VaultAtlasResponse | null>(null);
  isLoading = $state(false);
  isStale = $state(false);
  error = $state<string | null>(null);
  selectedNodeId = $state<string | null>(null);
  selectedCloudId = $state<string | null>(null);
  hoveredNodeId = $state<string | null>(null);
  searchQuery = $state('');
  driftStaleNotes = $state(false);
  showLinks = $state(true);
  zoom = $state(1);

  #refreshTimer: number | null = null;
  #disposeCallbacks: (() => void)[] = [];
  #lastIndexingInProgress = false;
  #lastIndexedAtMillis: number | null = null;
  #refreshRequestedDuringLoad = false;

  selectedNode = $derived.by(() =>
    this.response?.nodes.find((node) => node.id === this.selectedNodeId) ?? null
  );

  selectedCloud = $derived.by(() =>
    this.response?.clouds.find((cloud) => cloud.id === this.selectedCloudId) ?? null
  );

  zoomTier = $derived.by((): AtlasZoomTier => getZoomTier(this.zoom));

  visibleNodes = $derived.by(() => {
    const nodes = this.response?.nodes ?? [];
    const query = this.searchQuery.trim().toLowerCase();
    if (!query) return nodes;
    return nodes.filter((node) =>
      `${node.title} ${node.fileName} ${node.notePath}`.toLowerCase().includes(query)
    );
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
      if (selectedNodeId) return touchesSelection;
      const touchesHover = hoveredNodeId
        ? link.sourceId === hoveredNodeId || link.targetId === hoveredNodeId
        : false;
      if (touchesHover) return link.kind === 'wikilink' || link.strength >= 0.46;
      if (touchesSelection) return link.kind === 'wikilink' || link.strength >= 0.46;
      if (tier === 'far') return link.kind === 'wikilink' && link.strength >= 0.8;
      if (tier === 'mid') return link.kind === 'wikilink' || link.strength >= 0.78;
      if (tier === 'near') return link.kind === 'wikilink' || link.strength >= 0.66;
      if (selectedCloudId) {
        const sourceCloudId = nodesById.get(link.sourceId)?.cloudId ?? null;
        const targetCloudId = nodesById.get(link.targetId)?.cloudId ?? null;
        const insideSelectedCloud = sourceCloudId === selectedCloudId && targetCloudId === selectedCloudId;
        return link.kind === 'wikilink' || (insideSelectedCloud && link.strength >= 0.52);
      }
      return link.kind === 'wikilink' || link.strength >= 0.58;
    });
    if (selectedNodeId || hoveredNodeId) return candidates;
    return strongestLinksPerNode(candidates, tier === 'close' ? 5 : tier === 'near' ? 3 : 2);
  });

  visibleClouds = $derived.by(() => {
    const clouds = this.response?.clouds ?? [];
    if (this.zoomTier === 'far' || this.zoomTier === 'mid') {
      return clouds.filter((cloud) => cloud.parentId === null);
    }
    return clouds;
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
    await this.refresh();
  }

  dispose() {
    if (this.#refreshTimer) {
      window.clearTimeout(this.#refreshTimer);
      this.#refreshTimer = null;
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
      if (this.selectedNodeId && !this.response.nodes.some((node) => node.id === this.selectedNodeId)) {
        this.selectedNodeId = null;
      }
      if (
        this.selectedCloudId &&
        !this.response.clouds.some((cloud) => cloud.id === this.selectedCloudId)
      ) {
        this.selectedCloudId = null;
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

  toggleDrift() {
    this.driftStaleNotes = !this.driftStaleNotes;
  }

  toggleLinks() {
    this.showLinks = !this.showLinks;
  }
}

export function getZoomTier(zoom: number): AtlasZoomTier {
  if (zoom < 0.4) return 'far';
  if (zoom < 0.85) return 'mid';
  if (zoom < 1.6) return 'near';
  return 'close';
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
