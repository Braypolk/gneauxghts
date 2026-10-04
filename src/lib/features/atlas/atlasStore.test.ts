import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  atlasLabelRenderKey,
  AtlasStore,
  getNodeRadiusZoomMultiplier,
  getNodePosition,
  getZoomTier,
  isAtlasResponsePending,
  isAtlasSearchHit,
  isHighConfidenceLink,
  linkEndpoints,
  strongestLinksPerNode
} from './atlasStore.svelte';
import type {
  AtlasLink,
  AtlasNode,
  AtlasSearchMatch,
  VaultAtlasResponse
} from '$lib/types/atlas';
import { vaultFixture } from '$lib/app/testFixtures';
import type { VaultInfo } from '$lib/types/vault';
import type { AtlasChatVisibility } from '$lib/features/chat/types';

const appStoreMock = vi.hoisted(() => ({
  bootstrap: vi.fn(async () => undefined),
  semanticStatus: null,
  vaultInfo: null as VaultInfo | null,
  subscribeVaultNoteChanged: vi.fn(() => () => undefined),
  subscribeNoteSaved: vi.fn(() => () => undefined),
  subscribeVaultChanged: vi.fn((_listener: (vault: VaultInfo) => void) => () => undefined),
  subscribeSemanticStatusChanged: vi.fn(() => () => undefined)
}));

const invokeMock = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

vi.mock('$lib/app/appStore.svelte', () => ({ appStore: appStoreMock }));

function node(id: string, x: number, y: number): AtlasNode {
  return {
    id,
    noteId: id,
    notePath: `/vault/${id}.md`,
    title: id,
    fileName: `${id}.md`,
    documentKind: 'note',
    x,
    y,
    radius: 5,
    cloudId: null,
    parentCloudId: null,
    childCloudId: null,
    clusterId: null,
    subclusterId: null,
    centrality: 0,
    importance: 0,
    lastViewedAtMillis: null,
    createdAtMillis: 1,
    updatedAtMillis: 1,
    preview: '',
    tags: [],
    isolated: true
  };
}

function atlasResponse(
  revision: number,
  overrides: Partial<VaultAtlasResponse> = {}
): VaultAtlasResponse {
  return {
    status: 'ready',
    reason: null,
    revision,
    generatedAtMillis: revision,
    structuralGeneration: `structural-${revision}`,
    labelGeneration: `labels-${revision}`,
    publishedAtMillis: revision,
    stale: false,
    publishInProgress: false,
    nodes: [node(`note-${revision}`, revision, revision)],
    links: [],
    clouds: [],
    ...overrides
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

describe('atlas view helpers', () => {
  function searchMatch(overrides: Partial<AtlasSearchMatch>): AtlasSearchMatch {
    return {
      noteId: 'note',
      notePath: '/vault/note.md',
      documentKind: 'note',
      score: 0,
      semanticScore: 0,
      lexicalScore: 0,
      structuralScore: 0,
      reasonLabels: [],
      ...overrides
    };
  }

  it('maps zoom values to semantic focus tiers', () => {
    expect(getZoomTier(0.25)).toBe('far');
    expect(getZoomTier(0.6)).toBe('mid');
    expect(getZoomTier(1.1)).toBe('near');
    expect(getZoomTier(2)).toBe('close');
  });

  it('shrinks node radii with zoom while keeping the default size when zoomed in', () => {
    expect(getNodeRadiusZoomMultiplier(0.25)).toBe(0.25);
    expect(getNodeRadiusZoomMultiplier(0.6)).toBe(0.6);
    expect(getNodeRadiusZoomMultiplier(1)).toBe(1);
    expect(getNodeRadiusZoomMultiplier(2)).toBe(1);
    expect(getNodeRadiusZoomMultiplier(0)).toBe(0.08);
  });

  it('does not treat weak recency-only atlas matches as colored search hits', () => {
    expect(isAtlasSearchHit(null)).toBe(false);
    expect(isAtlasSearchHit(searchMatch({ score: 0.1 }))).toBe(false);
    expect(isAtlasSearchHit(searchMatch({ score: 0.34 }))).toBe(true);
    expect(isAtlasSearchHit(searchMatch({ semanticScore: 0.52 }))).toBe(true);
    expect(isAtlasSearchHit(searchMatch({ lexicalScore: 0.7 }))).toBe(true);
  });

  it('uses stable atlas positions without mutating nodes', () => {
    const item = node('a', 1, 2);

    expect(getNodePosition(item)).toEqual([1, 2]);
    expect(item.x).toBe(1);
  });

  it('resolves link endpoints from visible nodes', () => {
    const first = node('a', 1, 2);
    const second = node('b', 3, 4);
    const byId = new Map([
      [first.id, first],
      [second.id, second]
    ]);

    expect(
      linkEndpoints(
        { id: 'a:b', sourceId: 'a', targetId: 'b', kind: 'semantic', score: 0.5, strength: 0.5 },
        byId
      )
    ).toEqual([
      [1, 2],
      [3, 4]
    ]);
  });

  it('caps displayed links per node while preferring wikilinks and strong semantic edges', () => {
    const links: AtlasLink[] = [
      { id: 'a:b', sourceId: 'a', targetId: 'b', kind: 'semantic', score: 0.9, strength: 0.9 },
      { id: 'a:c', sourceId: 'a', targetId: 'c', kind: 'semantic', score: 0.8, strength: 0.8 },
      { id: 'a:d', sourceId: 'a', targetId: 'd', kind: 'semantic', score: 0.7, strength: 0.7 },
      { id: 'a:e', sourceId: 'a', targetId: 'e', kind: 'wikilink', score: 1, strength: 0.82 }
    ];

    expect(strongestLinksPerNode(links, 2).map((link) => link.id)).toEqual(['a:e', 'a:b']);
  });

  it('keeps weak semantic links out of high-confidence link displays', () => {
    expect(
      isHighConfidenceLink(
        { id: 'a:b', sourceId: 'a', targetId: 'b', kind: 'semantic', score: 0.7, strength: 0.69 },
        0.7
      )
    ).toBe(false);
    expect(
      isHighConfidenceLink(
        { id: 'a:c', sourceId: 'a', targetId: 'c', kind: 'semantic', score: 0.82, strength: 0.82 },
        0.7
      )
    ).toBe(true);
    expect(
      isHighConfidenceLink(
        { id: 'a:d', sourceId: 'a', targetId: 'd', kind: 'wikilink', score: 1, strength: 0.82 },
        0.95
      )
    ).toBe(true);
  });
});

describe('AtlasStore stale-while-revalidate', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('accepts a stale published response and polls until it becomes current', async () => {
    const stale = atlasResponse(1, { stale: true, publishInProgress: true });
    const current = atlasResponse(2);
    const loadAtlas = vi
      .fn<(visibility: AtlasChatVisibility) => Promise<VaultAtlasResponse>>()
      .mockResolvedValueOnce(stale)
      .mockResolvedValueOnce(current);
    const store = new AtlasStore(loadAtlas);

    await store.refresh();

    expect(store.response).toBe(stale);
    expect(store.isStale).toBe(true);
    expect(store.isRevalidating).toBe(true);

    await vi.advanceTimersByTimeAsync(400);

    expect(store.response).toBe(current);
    expect(store.isStale).toBe(false);
    expect(store.isRevalidating).toBe(false);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(loadAtlas).toHaveBeenCalledTimes(2);
    store.dispose();
  });

  const pendingCloudLabels = atlasResponse(1, {
    labelGeneration: null,
    clouds: [
      {
        id: 'cloud',
        parentId: null,
        level: 0,
        label: null,
        labelSource: 'pending',
        noteCount: 1,
        density: 1,
        color: [1, 2, 3, 255],
        centroid: [0, 0],
        radius: 10,
        hull: [],
        memberNodeIds: ['note-1'],
        coreNodeIds: ['note-1'],
        outlierNodeIds: [],
        childCloudIds: [],
        representativeNodeIds: ['note-1']
      }
    ]
  });

  it('treats missing cloud labels as pending even without a stale flag', () => {
    expect(isAtlasResponsePending(pendingCloudLabels)).toBe(true);
  });

  it('changes the renderer label key when generated cloud labels arrive', () => {
    const labelled = {
      ...pendingCloudLabels,
      labelGeneration: 'keybert-1',
      clouds: pendingCloudLabels.clouds.map((cloud) => ({ ...cloud, label: 'Machine learning' }))
    };

    expect(atlasLabelRenderKey(labelled)).not.toBe(atlasLabelRenderKey(pendingCloudLabels));
    expect(atlasLabelRenderKey(labelled)).toContain('Machine learning');
  });

  it('continues capped-delay polling beyond the former attempt ceiling', async () => {
    const pending = atlasResponse(1, { stale: true, publishInProgress: true });
    const loadAtlas = vi
      .fn<(visibility: AtlasChatVisibility) => Promise<VaultAtlasResponse>>()
      .mockResolvedValue(pending);
    const store = new AtlasStore(loadAtlas);

    await store.refresh();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(loadAtlas.mock.calls.length).toBeGreaterThan(21);
    expect(store.isRevalidating).toBe(true);
    store.dispose();
  });

  it('keeps debounce refresh and background poll timers independent', async () => {
    const pending = atlasResponse(1, { stale: true, publishInProgress: true });
    const debounced = deferred<VaultAtlasResponse>();
    const loadAtlas = vi
      .fn<(visibility: AtlasChatVisibility) => Promise<VaultAtlasResponse>>()
      .mockResolvedValueOnce(pending)
      .mockImplementationOnce(() => debounced.promise)
      .mockResolvedValueOnce(atlasResponse(2));
    const store = new AtlasStore(loadAtlas);

    await store.refresh();
    store.scheduleRefresh(100);
    await vi.advanceTimersByTimeAsync(100);
    expect(loadAtlas).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(300);
    debounced.resolve(pending);
    await vi.advanceTimersByTimeAsync(0);
    expect(loadAtlas).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(80);
    expect(loadAtlas).toHaveBeenCalledTimes(3);
    expect(store.response?.revision).toBe(2);
    store.dispose();
  });

  it('initializes visibility from persisted chat settings before loading the atlas', async () => {
    const loadAtlas = vi
      .fn<(visibility: AtlasChatVisibility) => Promise<VaultAtlasResponse>>()
      .mockResolvedValue(atlasResponse(1));
    const store = new AtlasStore(loadAtlas, async () => 'remembered', async () => undefined);

    await store.initialize();

    expect(store.chatVisibility).toBe('remembered');
    expect(loadAtlas).toHaveBeenCalledWith('remembered');
    store.dispose();
  });

  it('preserves a local visibility selection while persisted settings are loading', async () => {
    const persisted = deferred<AtlasChatVisibility>();
    const saveVisibility = vi.fn(async (_visibility: AtlasChatVisibility) => undefined);
    const loadAtlas = vi
      .fn<(visibility: AtlasChatVisibility) => Promise<VaultAtlasResponse>>()
      .mockResolvedValue(atlasResponse(1));
    const store = new AtlasStore(loadAtlas, () => persisted.promise, saveVisibility);

    const initialize = store.initialize();
    store.setChatVisibility('all');
    persisted.resolve('remembered');
    await initialize;
    await Promise.resolve();

    expect(store.chatVisibility).toBe('all');
    expect(loadAtlas).toHaveBeenCalledWith('all');
    expect(saveVisibility).toHaveBeenCalledWith('all');
    store.dispose();
  });

  it('discards an obsolete visibility request and loads the selected variant', async () => {
    const obsolete = deferred<VaultAtlasResponse>();
    const initial = atlasResponse(1);
    const selectedVariant = atlasResponse(3);
    const loadAtlas = vi
      .fn<(visibility: AtlasChatVisibility) => Promise<VaultAtlasResponse>>()
      .mockResolvedValueOnce(initial)
      .mockImplementationOnce(() => obsolete.promise)
      .mockResolvedValueOnce(selectedVariant);
    const store = new AtlasStore(loadAtlas, async () => 'hidden', async () => undefined);
    await store.initialize();

    const oldRefresh = store.refresh();
    store.setChatVisibility('all');

    expect(store.response).toBeNull();

    await vi.advanceTimersByTimeAsync(0);
    obsolete.resolve(atlasResponse(2));
    await oldRefresh;
    await vi.advanceTimersByTimeAsync(80);

    expect(loadAtlas.mock.calls.map(([visibility]) => visibility)).toEqual([
      'hidden',
      'hidden',
      'all'
    ]);
    expect(store.response).toBe(selectedVariant);
    store.dispose();
  });
});

describe('AtlasStore asynchronous admission', () => {
  afterEach(() => { vi.clearAllMocks(); vi.useRealTimers(); });

  it('joins initialization and never subscribes after disposal during visibility loading', async () => {
    const visibility = deferred<AtlasChatVisibility>();
    const loadVisibility = vi.fn(() => visibility.promise);
    const loader = vi.fn(async () => atlasResponse(1));
    const store = new AtlasStore(loader, loadVisibility);
    const first = store.initialize();
    const joined = store.initialize();
    expect(first).toBe(joined);
    expect(loadVisibility).toHaveBeenCalledOnce();
    store.dispose();
    visibility.resolve('all');
    await first;
    expect(appStoreMock.subscribeNoteSaved).not.toHaveBeenCalled();
    expect(store.chatVisibility).toBe('hidden');
    expect(store.response).toBeNull();
    expect(loader).not.toHaveBeenCalled();
  });

  it('does not let an old refresh clear a newer lifetime loading state', async () => {
    const old = deferred<VaultAtlasResponse>();
    const current = deferred<VaultAtlasResponse>();
    const loader = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    const store = new AtlasStore(loader, async () => 'hidden');
    const refresh = store.refresh();
    store.dispose();
    const reopened = store.initialize();
    await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(2));
    old.resolve(atlasResponse(99)); await refresh;
    expect(store.isLoading).toBe(true);
    expect(store.response).toBeNull();
    current.resolve(atlasResponse(2)); await reopened;
    expect(store.response?.revision).toBe(2);
    expect(store.isLoading).toBe(false);
    store.dispose();
  });

  it.each(['query', 'clear', 'visibility', 'cache', 'dispose'] as const)('invalidates a pending search immediately on %s', async (change) => {
    const result = deferred<import('$lib/types/atlas').AtlasSearchResponse>();
    const store = new AtlasStore(async () => atlasResponse(1), async () => 'hidden', async () => undefined, () => result.promise);
    store.setSearchQuery('old');
    const searching = store.runSearch();
    if (change === 'query') {
      store.setSearchQuery('new');
      expect(store.isSearching).toBe(false);
      // Returning to the same query must not readmit the older request.
      store.setSearchQuery('old');
    }
    if (change === 'clear') store.setSearchQuery('');
    if (change === 'visibility') store.setChatVisibility('all');
    if (change === 'cache') await store.clearCache();
    if (change === 'dispose') store.dispose();
    result.resolve({ status: 'ready', reason: null, query: 'old', generatedAtMillis: 1, matches: [] });
    await searching;
    expect(store.searchResponse).toBeNull();
    expect(store.isSearching).toBe(false);
    store.dispose();
  });

  it('suppresses stale search errors during the new query debounce', async () => {
    let reject!: (error: Error) => void;
    const store = new AtlasStore(async () => atlasResponse(1), async () => 'hidden', async () => undefined, () => new Promise((_resolve, no) => { reject = no; }));
    store.setSearchQuery('old'); const searching = store.runSearch();
    store.setSearchQuery('new'); reject(new Error('old failure')); await searching;
    expect(store.searchError).toBeNull();
    store.dispose();
  });

  it('clears a removed selection and retains the accepted response after refresh fails', async () => {
    const initial = atlasResponse(1);
    const loader = vi.fn()
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce({ ...initial, nodes: [] })
      .mockRejectedValueOnce(new Error('Unavailable'));
    const store = new AtlasStore(loader);
    await store.refresh();
    store.selectNode(initial.nodes[0]);
    await store.refresh();
    expect(store.selectedNodeId).toBeNull();
    const last = store.response;
    await store.refresh();
    expect(store.response).toBe(last);
    expect(store.error).toContain('Unavailable');
    store.dispose();
  });

});

describe('Atlas activation freshness', () => {
  it('retains cached display but revalidates after events were detached', async () => {
    const revalidation = deferred<VaultAtlasResponse>();
    const loader = vi.fn().mockResolvedValueOnce(atlasResponse(1)).mockReturnValueOnce(revalidation.promise);
    const visibility = deferred<AtlasChatVisibility>();
    const loadVisibility = vi.fn<() => Promise<AtlasChatVisibility>>().mockResolvedValueOnce('hidden').mockReturnValueOnce(visibility.promise);
    const store = new AtlasStore(loader, loadVisibility);
    await store.initialize();
    store.dispose();
    const reopening = store.initialize();
    expect(store.response?.revision).toBe(1);
    expect(store.isRevalidating).toBe(true);
    visibility.resolve('hidden');
    await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(2));
    expect(store.response?.revision).toBe(1);
    expect(store.isRevalidating).toBe(true);
    revalidation.resolve(atlasResponse(2)); await reopening;
    expect(store.response?.revision).toBe(2);
    expect(store.isStale).toBe(false);
    store.dispose();
  });

  it('does not discard the Running Vault graph for a staged next-launch selection', async () => {
    appStoreMock.vaultInfo = vaultFixture;
    const store = new AtlasStore(async () => atlasResponse(1), async () => 'hidden');
    await store.initialize();
    store.selectedNodeId = 'note-1';
    const callback = vi.mocked(appStoreMock.subscribeVaultChanged).mock.calls.at(-1)?.[0];
    if (!callback) throw new Error('Expected vault subscription');
    callback({ ...vaultFixture, selectedPath: '/other', requiresRestart: true });
    expect(store.response?.revision).toBe(1);
    expect(store.selectedNodeId).toBe('note-1');
    store.dispose();
  });
});
