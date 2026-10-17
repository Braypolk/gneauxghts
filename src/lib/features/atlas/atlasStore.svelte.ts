import { invoke } from '@tauri-apps/api/core';
import { SvelteMap } from 'svelte/reactivity';
import { appStore } from '$lib/app/appStore.svelte';
import type {
  AtlasCloudName,
  AtlasNode,
  AtlasSearchMatch,
  AtlasSearchResponse,
  VaultAtlasResponse
} from '$lib/types/atlas';

const ATLAS_SEARCH_HIT_MIN_SCORE = 0.32;
const ATLAS_SEARCH_HIT_MIN_SEMANTIC = 0.5;
const ATLAS_SEARCH_HIT_MIN_LEXICAL = 0.65;
const ATLAS_SEARCH_HIT_MIN_STRUCTURAL = 0.38;
const ATLAS_POLL_INITIAL_DELAY_MILLIS = 400;
const ATLAS_POLL_MAX_DELAY_MILLIS = 2_500;

type AtlasResponseLoader = () => Promise<VaultAtlasResponse>;

export class AtlasStore {
  response = $state.raw<VaultAtlasResponse | null>(null);
  isLoading = $state(false);
  isStale = $state(false);
  error = $state<string | null>(null);
  searchError = $state<string | null>(null);
  searchResponse = $state<AtlasSearchResponse | null>(null);
  isSearching = $state(false);
  selectedNodeId = $state<string | null>(null);
  searchQuery = $state('');

  #refreshTimer: ReturnType<typeof setTimeout> | null = null;
  #pollTimer: ReturnType<typeof setTimeout> | null = null;
  #searchTimer: ReturnType<typeof setTimeout> | null = null;
  #disposeCallbacks: (() => void)[] = [];
  #lastIndexingInProgress = false;
  #lastIndexedAtMillis: number | null = null;
  #refreshRequestedDuringLoad = false;
  #refreshSequence = 0;
  #pollAttempts = 0;
  #lifetime = 0;
  #initializePromise: Promise<void> | null = null;
  #disposed = false;
  #searchSequence = 0;
  #loadAtlas: AtlasResponseLoader;

  constructor(
    loadAtlas: AtlasResponseLoader = () => invoke<VaultAtlasResponse>('get_vault_atlas'),
    private readonly loadSearch = (query: string) => invoke<AtlasSearchResponse>('search_vault_atlas', { query })
  ) {
    this.#loadAtlas = loadAtlas;
  }

  isRevalidating = $derived(
    Boolean(this.response) && (this.isLoading || this.isStale || isAtlasResponsePending(this.response))
  );

  searchMatchesByPath = $derived.by(() => {
    const matches = this.searchResponse?.matches ?? [];
    return new SvelteMap(matches.map((match) => [match.notePath, match]));
  });

  searchMatchesByNodeId = $derived.by(() => {
    const nodes = this.response?.nodes ?? [];
    const byPath = this.searchMatchesByPath;
    return new SvelteMap(
      nodes
        .map((node) => {
          const match = byPath.get(node.notePath) ?? null;
          return match ? ([node.id, match] as const) : null;
        })
        .filter((item): item is readonly [string, AtlasSearchMatch] => item !== null)
    );
  });

  initialize() {
    if (this.#initializePromise) return this.#initializePromise;
    this.#disposed = false;
    this.isStale = Boolean(this.response);
    const lifetime = this.#lifetime;
    this.#initializePromise = this.#initialize(lifetime);
    return this.#initializePromise;
  }

  async #initialize(lifetime: number) {
    await appStore.bootstrap().catch(() => undefined);
    if (lifetime !== this.#lifetime) return;
    this.#lastIndexingInProgress = appStore.semanticStatus?.indexingInProgress ?? false;
    this.#lastIndexedAtMillis = appStore.semanticStatus?.lastIndexedAtMillis ?? null;
    const runningPath = appStore.vaultInfo?.runningPath;
    this.#disposeCallbacks.push(
      appStore.subscribeVaultNoteChanged(() => this.scheduleRefresh()),
      appStore.subscribeNoteSaved(() => this.scheduleRefresh()),
      appStore.subscribeVaultChanged((vault) => {
        if (vault.runningPath === runningPath) return;
        this.#refreshSequence += 1;
        this.#invalidateSearch();
        this.searchResponse = null;
        this.response = null;
        this.selectedNodeId = null;
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
    // Events were detached while Map was closed. Only the backend can establish
    // whether the retained graph still matches its current inputs.
    await this.refresh();
  }

  dispose() {
    this.#disposed = true;
    this.#lifetime += 1;
    this.#initializePromise = null;
    this.#invalidateSearch();
    this.isLoading = false;
    this.#refreshRequestedDuringLoad = false;
    this.#refreshSequence += 1;
    if (this.#refreshTimer) {
      globalThis.clearTimeout(this.#refreshTimer);
      this.#refreshTimer = null;
    }
    this.#stopPolling();
    if (this.#searchTimer) {
      globalThis.clearTimeout(this.#searchTimer);
      this.#searchTimer = null;
    }
    for (const dispose of this.#disposeCallbacks) {
      dispose();
    }
    this.#disposeCallbacks = [];
  }

  scheduleRefresh(delay = 700) {
    if (this.#disposed) return;
    this.isStale = true;
    if (this.#refreshTimer) {
      globalThis.clearTimeout(this.#refreshTimer);
    }
    this.#refreshTimer = globalThis.setTimeout(() => {
      this.#refreshTimer = null;
      void this.refresh();
    }, delay);
  }

  async renameCloud(cloudId: string, name: string | null) {
    const lifetime = this.#lifetime;
    const result = await invoke<AtlasCloudName>('rename_atlas_cloud', {cloudId, name});
    if (lifetime !== this.#lifetime || !this.response) return;
    if (result.nameRevision < (this.response.nameRevision ?? 0)) { await this.refresh(); return; }
    this.response = {...this.response, nameRevision: result.nameRevision, clouds: this.response.clouds.map(cloud =>
      cloud.id === result.cloudId ? {...cloud, userName: result.userName, label: result.label,
        labelSource: result.userName === null ? 'topic' : 'user'} : cloud)};
  }

  /** Drop the in-memory atlas payload so the next open/refetch hits the backend. */
  async clearCache() {
    await invoke('clear_atlas_cache');
    this.#invalidateCachedResponse();
  }

  #invalidateCachedResponse() {
    this.#invalidateSearch();
    this.#refreshSequence += 1;
    this.response = null;
    this.searchResponse = null;
    this.isStale = true;
    this.error = null;
    this.searchError = null;
    if (this.#disposeCallbacks.length > 0) {
      this.scheduleRefresh(0);
    }
  }

  async refresh() {
    if (this.#disposed) return;
    if (this.isLoading) {
      this.#refreshRequestedDuringLoad = true;
      this.isStale = true;
      return;
    }
    const lifetime = this.#lifetime;
    const sequence = ++this.#refreshSequence;
    this.isLoading = true;
    this.error = null;
    try {
      const response = await this.#loadAtlas();
      if (sequence !== this.#refreshSequence) return;
      const prior = this.response;
      if (prior && (prior.nameRevision ?? 0) > (response.nameRevision ?? 0)) {
        const names = new Map(prior.clouds.map(cloud => [cloud.id, cloud]));
        response.clouds = response.clouds.map(cloud => {
          const saved = names.get(cloud.id);
          return saved ? {...cloud, userName: saved.userName, label: saved.label, labelSource: saved.labelSource} : cloud;
        });
        response.nameRevision = prior.nameRevision;
      }
      this.response = response;
      this.isStale = isAtlasResponsePending(response);
      this.scheduleSearch(80);
      if (this.selectedNodeId && !response.nodes.some((node) => node.id === this.selectedNodeId)) {
        const identity = prior?.nodes.find(node => node.id === this.selectedNodeId)?.noteId;
        this.selectedNodeId = identity ? response.nodes.find(node => node.noteId === identity)?.id ?? null : null;
      }
      if (isAtlasResponsePending(response)) {
        this.#schedulePoll();
      } else {
        this.#stopPolling();
      }
    } catch (error) {
      if (sequence === this.#refreshSequence) {
        this.error = String(error);
        if (this.response && (this.isStale || isAtlasResponsePending(this.response))) {
          this.#schedulePoll();
        }
      }
    } finally {
      if (lifetime !== this.#lifetime) return;
      this.isLoading = false;
      if (this.#refreshRequestedDuringLoad) {
        this.#refreshRequestedDuringLoad = false;
        this.scheduleRefresh(80);
      }
    }
  }

  #schedulePoll() {
    if (this.#disposed) return;
    const delay = Math.min(
      ATLAS_POLL_INITIAL_DELAY_MILLIS * 2 ** Math.min(this.#pollAttempts, 3),
      ATLAS_POLL_MAX_DELAY_MILLIS
    );
    this.#pollAttempts += 1;
    if (this.#pollTimer) globalThis.clearTimeout(this.#pollTimer);
    this.#pollTimer = globalThis.setTimeout(() => {
      this.#pollTimer = null;
      void this.refresh();
    }, delay);
  }

  #stopPolling() {
    this.#pollAttempts = 0;
    if (!this.#pollTimer) return;
    globalThis.clearTimeout(this.#pollTimer);
    this.#pollTimer = null;
  }

  selectNode(node: AtlasNode | null) {
    this.selectedNodeId = node?.id ?? null;
  }

  #invalidateSearch() {
    this.#searchSequence += 1;
    this.isSearching = false;
    this.searchError = null;
    if (this.#searchTimer) globalThis.clearTimeout(this.#searchTimer);
    this.#searchTimer = null;
  }

  setSearchQuery(query: string) {
    this.#invalidateSearch();
    this.searchQuery = query;
    if (this.searchResponse?.query !== query.trim()) {
      this.searchResponse = null;
    }
    this.scheduleSearch();
  }

  scheduleSearch(delay = 180) {
    if (this.#disposed) return;
    if (this.#searchTimer) {
      globalThis.clearTimeout(this.#searchTimer);
    }
    const query = this.searchQuery.trim();
    if (!query) {
      this.searchResponse = null;
      this.searchError = null;
      this.isSearching = false;
      return;
    }
    this.#searchTimer = globalThis.setTimeout(() => {
      this.#searchTimer = null;
      void this.runSearch(query);
    }, delay);
  }

  async runSearch(query = this.searchQuery.trim()) {
    if (this.#disposed) return;
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
      const response = await this.loadSearch(query);
      if (sequence !== this.#searchSequence || query !== this.searchQuery.trim()) return;
      this.searchResponse = response;
    } catch (error) {
      if (sequence !== this.#searchSequence || query !== this.searchQuery.trim()) return;
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
}

export const atlasStore = new AtlasStore();

export function isAtlasResponsePending(response: VaultAtlasResponse | null): boolean {
  if (!response) return false;
  if (response.publishInProgress) return true;
  if (response.status !== 'ready') return false;
  const labelsPending = response.clouds.length > 0 && response.labelGeneration === null;
  return response.stale || labelsPending;
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
