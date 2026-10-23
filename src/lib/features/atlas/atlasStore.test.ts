import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AtlasStore, isAtlasResponsePending, isAtlasSearchHit } from './atlasStore.svelte';
import type {
  AtlasNode,
  AtlasSearchMatch,
  VaultAtlasResponse
} from '#lib/types/atlas.js';
import { vaultFixture } from '#lib/app/testFixtures.js';
import type { VaultInfo } from '#lib/types/vault.js';

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

vi.mock('#lib/app/appStore.svelte.js', () => ({ appStore: appStoreMock }));

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

  it('uses native relevance admission rather than applying a second similarity policy', () => {
    expect(isAtlasSearchHit(null)).toBe(false);
    expect(isAtlasSearchHit(searchMatch({ score: 0.1 }))).toBe(true);
    expect(isAtlasSearchHit(searchMatch({ score: 0.34 }))).toBe(true);
    expect(isAtlasSearchHit(searchMatch({ semanticScore: 0.52 }))).toBe(true);
    expect(isAtlasSearchHit(searchMatch({ lexicalScore: 0.7 }))).toBe(true);
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
      .fn<() => Promise<VaultAtlasResponse>>()
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

  it('continues capped-delay polling beyond the former attempt ceiling', async () => {
    const pending = atlasResponse(1, { stale: true, publishInProgress: true });
    const loadAtlas = vi
      .fn<() => Promise<VaultAtlasResponse>>()
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
      .fn<() => Promise<VaultAtlasResponse>>()
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


});

describe('AtlasStore asynchronous admission', () => {
  afterEach(() => { vi.clearAllMocks(); vi.useRealTimers(); });

  it('joins initialization and never subscribes after disposal during bootstrap', async () => {
    const bootstrap = deferred<undefined>();
    appStoreMock.bootstrap.mockImplementationOnce(() => bootstrap.promise);
    const loader = vi.fn(async () => atlasResponse(1));
    const store = new AtlasStore(loader);
    const first = store.initialize();
    const joined = store.initialize();
    expect(first).toBe(joined);
    expect(appStoreMock.bootstrap).toHaveBeenCalledOnce();
    store.dispose();
    bootstrap.resolve(undefined);
    await first;
    expect(appStoreMock.subscribeNoteSaved).not.toHaveBeenCalled();
    expect(store.response).toBeNull();
    expect(loader).not.toHaveBeenCalled();
  });

  it('does not let an old refresh clear a newer lifetime loading state', async () => {
    const old = deferred<VaultAtlasResponse>();
    const current = deferred<VaultAtlasResponse>();
    const loader = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    const store = new AtlasStore(loader);
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

  it.each(['query', 'clear', 'cache', 'dispose'] as const)('invalidates a pending search immediately on %s', async (change) => {
    const result = deferred<import('#lib/types/atlas.js').AtlasSearchResponse>();
    const store = new AtlasStore(async () => atlasResponse(1), () => result.promise);
    store.setSearchQuery('old');
    const searching = store.runSearch();
    if (change === 'query') {
      store.setSearchQuery('new');
      expect(store.isSearching).toBe(false);
      // Returning to the same query must not readmit the older request.
      store.setSearchQuery('old');
    }
    if (change === 'clear') store.setSearchQuery('');
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
    const store = new AtlasStore(async () => atlasResponse(1), () => new Promise((_resolve, no) => { reject = no; }));
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
    const store = new AtlasStore(loader);
    await store.initialize();
    store.dispose();
    const reopening = store.initialize();
    expect(store.response?.revision).toBe(1);
    expect(store.isRevalidating).toBe(true);
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
    const store = new AtlasStore(async () => atlasResponse(1));
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

describe('Atlas node filtering', () => {
  afterEach(() => { vi.clearAllMocks(); });

  function match(note: AtlasNode, score: number, overrides: Partial<AtlasSearchMatch> = {}): AtlasSearchMatch {
    return { noteId: note.noteId, notePath: note.notePath, documentKind: 'note', score,
      lexicalScore: 0, semanticScore: 0, structuralScore: 0, reasonLabels: [], ...overrides };
  }

  it('filters to admitted map hits without modifying accepted geography', () => {
    const notes = [node('alpha', -200, 15), node('beta', 200, -20), node('weak', 0, 3), node('replacement', 50, 50)];
    const store = new AtlasStore();
    const accepted = atlasResponse(1, { nodes: notes });
    store.response = accepted;
    store.searchQuery = 'remembered idea';
    store.searchResponse = { status: 'ready', reason: null, query: store.searchQuery, generatedAtMillis: 1,
      matches: [match(notes[0], .5), match(notes[1], .8),
        match(notes[3], .9, { noteId: 'old-identity' }), match(node('removed', 1, 2), 1)] };

    expect([...store.matchingNodeIds]).toEqual(['alpha', 'beta']);
    expect(store.searchMatchForNode(notes[3])).toBeNull();
    expect(store.response).toBe(accepted);
    expect(store.response.nodes.map(({ id, x, y }) => ({ id, x, y }))).toEqual(notes.map(({ id, x, y }) => ({ id, x, y })));
    store.dispose();
  });

  it('retains compatible matches on failed retry and removes them immediately for another query', async () => {
    const alpha = node('alpha', 0, 0);
    const store = new AtlasStore(async () => atlasResponse(1), async () => { throw new Error('Unavailable'); });
    store.response = atlasResponse(1, { nodes: [alpha] });
    store.searchQuery = 'first';
    store.searchResponse = { status: 'ready', reason: null, query: 'first', generatedAtMillis: 1, matches: [match(alpha, .8)] };
    await store.runSearch();
    expect(store.searchError).toContain('Unavailable');
    expect([...store.matchingNodeIds]).toEqual(['alpha']);
    store.setSearchQuery('second');
    expect([...store.matchingNodeIds]).toEqual([]);
    store.dispose();
  });
});

describe('Atlas cloud naming admission', () => {
  it('keeps a committed name when an older refresh finishes afterward', async () => {
    const {createDemoAtlas} = await import('../../../../scripts/fixtures/atlasDemo');
    const initial = createDemoAtlas();
    const pending = deferred<VaultAtlasResponse>();
    const store = new AtlasStore(() => pending.promise);
    store.response = initial;
    const id = initial.clouds[0].id;
    const refresh = store.refresh();
    invokeMock.mockImplementationOnce(async () => ({cloudId:id,userName:'My garden',label:'My garden',nameRevision:2} as never));
    await store.renameCloud(id,'My garden');
    pending.resolve({...initial,nameRevision:1,clouds:initial.clouds.map(cloud=>({...cloud,label:'Old auto name'}))});
    await refresh;
    expect(store.response?.clouds.find(cloud=>cloud.id===id)?.label).toBe('My garden');
    expect(store.response?.nameRevision).toBe(2);
    store.dispose();
  });
});
