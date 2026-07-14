import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  atlasLabelRenderKey,
  AtlasStore,
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
import type { AtlasChatVisibility } from '$lib/features/chat/types';

const appStoreMock = vi.hoisted(() => ({
  bootstrap: vi.fn(async () => undefined),
  semanticStatus: null,
  subscribeVaultNoteChanged: vi.fn(() => () => undefined),
  subscribeNoteSaved: vi.fn(() => () => undefined),
  subscribeVaultChanged: vi.fn(() => () => undefined),
  subscribeSemanticStatusChanged: vi.fn(() => () => undefined)
}));

vi.mock('$lib/app/appStore.svelte', () => ({ appStore: appStoreMock }));

function node(id: string, x: number, y: number, driftX = x + 10, driftY = y + 10): AtlasNode {
  return {
    id,
    noteId: id,
    notePath: `/vault/${id}.md`,
    title: id,
    fileName: `${id}.md`,
    documentKind: 'note',
    x,
    y,
    driftX,
    driftY,
    radius: 5,
    cloudId: null,
    parentCloudId: null,
    childCloudId: null,
    clusterId: null,
    subclusterId: null,
    centrality: 0,
    degree: 0,
    importance: 0,
    modifiedAtMillis: 1,
    lastViewedAtMillis: null,
    createdAtMillis: 1,
    updatedAtMillis: 1,
    staleScore: 0,
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
    stats: {
      noteCount: 1,
      cloudCount: 0,
      linkCount: 0,
      isolatedCount: 1
    },
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
      score: 0,
      semanticScore: 0,
      lexicalScore: 0,
      structuralScore: 0,
      recencyScore: 0,
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

  it('does not treat weak recency-only atlas matches as colored search hits', () => {
    expect(isAtlasSearchHit(null)).toBe(false);
    expect(isAtlasSearchHit(searchMatch({ score: 0.1, recencyScore: 1 }))).toBe(false);
    expect(isAtlasSearchHit(searchMatch({ score: 0.34 }))).toBe(true);
    expect(isAtlasSearchHit(searchMatch({ semanticScore: 0.52 }))).toBe(true);
    expect(isAtlasSearchHit(searchMatch({ lexicalScore: 0.7 }))).toBe(true);
  });

  it('switches between stable and stale-drift positions without mutating nodes', () => {
    const item = node('a', 1, 2, 30, 40);

    expect(getNodePosition(item, false)).toEqual([1, 2]);
    expect(getNodePosition(item, true)).toEqual([30, 40]);
    expect(item.x).toBe(1);
    expect(item.driftX).toBe(30);
  });

  it('resolves link endpoints from visible nodes', () => {
    const first = node('a', 1, 2);
    const second = node('b', 3, 4, 9, 10);
    const byId = new Map([
      [first.id, first],
      [second.id, second]
    ]);

    expect(
      linkEndpoints(
        { id: 'a:b', sourceId: 'a', targetId: 'b', kind: 'semantic', score: 0.5, strength: 0.5 },
        byId,
        false
      )
    ).toEqual([
      [1, 2],
      [3, 4]
    ]);
    expect(
      linkEndpoints(
        { id: 'a:b', sourceId: 'a', targetId: 'b', kind: 'semantic', score: 0.5, strength: 0.5 },
        byId,
        true
      )
    ).toEqual([
      [11, 12],
      [9, 10]
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

  it('retains the published response during revalidation', async () => {
    const next = deferred<VaultAtlasResponse>();
    const initial = atlasResponse(1);
    const loadAtlas = vi
      .fn<(visibility: AtlasChatVisibility) => Promise<VaultAtlasResponse>>()
      .mockResolvedValueOnce(initial)
      .mockImplementationOnce(() => next.promise);
    const store = new AtlasStore(loadAtlas);

    await store.refresh();
    const refresh = store.refresh();

    expect(store.response).toBe(initial);
    expect(store.isLoading).toBe(true);
    expect(store.isRevalidating).toBe(true);

    const updated = atlasResponse(2);
    next.resolve(updated);
    await refresh;

    expect(store.response).toBe(updated);
    expect(store.isLoading).toBe(false);
    store.dispose();
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

  it('treats missing cloud labels as pending even without a stale flag', () => {
    const pending = atlasResponse(1, {
      labelGeneration: null,
      clouds: [
        {
          id: 'cloud',
          parentId: null,
          level: 0,
          label: null,
          labelConfidence: 0,
          noteCount: 1,
          density: 1,
          color: [1, 2, 3, 255],
          centroid: [0, 0],
          labelAnchor: [0, 0],
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

    expect(isAtlasResponsePending(pending)).toBe(true);
  });

  it('changes the renderer label key when generated cloud labels arrive', () => {
    const pending = atlasResponse(1, {
      labelGeneration: null,
      clouds: [
        {
          id: 'cloud',
          parentId: null,
          level: 0,
          label: null,
          labelConfidence: 0,
          noteCount: 1,
          density: 1,
          color: [1, 2, 3, 255],
          centroid: [0, 0],
          labelAnchor: [0, 0],
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
    const labelled = {
      ...pending,
      labelGeneration: 'keybert-1',
      clouds: pending.clouds.map((cloud) => ({ ...cloud, label: 'Machine learning' }))
    };

    expect(atlasLabelRenderKey(labelled)).not.toBe(atlasLabelRenderKey(pending));
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
