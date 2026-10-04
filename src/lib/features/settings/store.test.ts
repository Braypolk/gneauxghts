import type { SettingsViewPayload } from '$lib/app/appStore.svelte';
import type { MissingNoteSummary } from '$lib/types/missingNotes';
import type { HistoryModePage } from '$lib/features/history/historyModeMachine';
import type { VaultInfo } from '$lib/types/vault';
import { AppStore } from '$lib/app/appStore.svelte';
import { bootstrapFixture, settingsViewFixture, semanticStatusFixture, vaultFixture } from '$lib/app/testFixtures';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.hoisted(() => vi.fn());
let responses: Record<string, unknown>;
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
let appStoreMock: AppStore;

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: vi.fn() }));
vi.mock('$lib/features/atlas/atlasStore.svelte', () => ({
  atlasStore: { clearCache: vi.fn() }
}));
beforeEach(() => {
  appStoreMock = new AppStore();
  vi.spyOn(appStoreMock, 'bootstrap').mockResolvedValue(bootstrapFixture());
  vi.spyOn(appStoreMock, 'refreshVaultInfo').mockResolvedValue(undefined);
  vi.spyOn(appStoreMock, 'refreshSemanticStatus').mockResolvedValue(undefined);
  responses = {
    get_settings_view: settingsViewFixture(),
    list_forgotten_notes: [],
    list_missing_notes: [],
    get_missing_note_history_page: { records: [], nextCursor: null }
  };
  invokeMock.mockReset().mockImplementation(async (command: string) => responses[command]);
});

function missingNote(timeline: HistoryModePage = { records: [], nextCursor: 'page-2' }): MissingNoteSummary {
  return {
    noteId: 'missing-note-1',
    path: '/vault/Ideas.md',
    title: 'Ideas',
    fileName: 'Ideas.md',
    missingAtMillis: 10,
    retentionDays: 7,
    purgeAtMillis: 20,
    timeline
  };
}

describe('SettingsStore actions', () => {
  it('keeps component-passed actions bound to the settings store', async () => {
    const { createSettingsStore } = await import('./store.svelte');
    const store = createSettingsStore(appStoreMock);
    const forgottenPath = '/vault/.forgotten/2026-07-28-chat';
    store.selectedForgottenPaths = [forgottenPath];

    const runForgottenAction = store.runForgottenAction;
    const toggleForgottenSelection = store.toggleForgottenSelection;
    await runForgottenAction('restore_forgotten_notes', [forgottenPath]);
    toggleForgottenSelection(forgottenPath, true);

    expect(invokeMock).toHaveBeenCalledWith('restore_forgotten_notes', {
      forgottenPaths: [forgottenPath]
    });
    expect(invokeMock.mock.calls.filter(([command]) => command === 'list_forgotten_notes')).toHaveLength(1);
    expect(store.selectedForgottenPaths).toEqual([forgottenPath]);
    expect(store.isUpdatingForgottenNotes).toBe(false);
  });

  it('finishes local search setup by starting the model and retrying indexing', async () => {
    const { createSettingsStore } = await import('./store.svelte');
    const store = createSettingsStore(appStoreMock);
    const download = deferred<{ alreadyPresent: boolean; path: string }>();
    responses.download_semantic_embedding_model = download.promise;

    const setup = store.downloadEmbeddingModel();
    expect(store.isRunningAction).toBe(true);
    expect(store.semanticLayerMessage).toContain('Downloading any missing files');
    await store.downloadEmbeddingModel();
    expect(invokeMock).toHaveBeenCalledOnce();
    download.resolve({ alreadyPresent: true, path: '/app/model.gguf' });
    await setup;

    expect(invokeMock.mock.calls.map(([command]) => command)).toEqual([
      'download_semantic_embedding_model', 'prepare_semantic_model', 'retry_semantic_index', 'get_settings_view'
    ]);
    expect(store.semanticLayerMessage).toBe('Local search is set up. Your notes will now be indexed.');
    expect(store.semanticLayerError).toBeNull();
    expect(store.isRunningAction).toBe(false);
    expect(invokeMock.mock.calls.filter(([command]) => command === 'get_settings_view')).toHaveLength(1);
  });

  it('keeps failed setup retryable without starting a missing model', async () => {
    const { createSettingsStore } = await import('./store.svelte');
    const store = createSettingsStore(appStoreMock);
    invokeMock.mockRejectedValueOnce('Download interrupted. Try setup again.');
    await store.downloadEmbeddingModel();
    expect(invokeMock).toHaveBeenCalledOnce();
    expect(store.semanticLayerError).toBe('Download interrupted. Try setup again.');
    expect(store.semanticLayerMessage).toBeNull();
    expect(store.isRunningAction).toBe(false);
  });

  it('surfaces committed recovery warnings in settings', async () => {
    const { createSettingsStore } = await import('./store.svelte');
    const store = createSettingsStore(appStoreMock);
    responses.restore_forgotten_notes = [
      {
        forgottenPath: '/vault/.forgotten/Note.md',
        restoredPath: '/vault/Note.md',
        title: 'Note',
        kind: 'note',
        commitWarning: {
          message: 'Timeline recovery is pending.',
          issues: [{ stage: 'historyFinalization', message: 'store unavailable' }]
        }
      }
    ];

    await store.runForgottenAction('restore_forgotten_notes', [
      '/vault/.forgotten/Note.md'
    ]);

    expect(store.forgottenActionMessage).toBe('Timeline recovery is pending.');
    expect(store.forgottenActionError).toBeNull();
  });

  it('routes Missing Note recovery and purge through identity-scoped commands', async () => {
    const { createSettingsStore } = await import('./store.svelte');
    const store = createSettingsStore(appStoreMock);
    responses.recover_missing_note = {
      noteId: 'missing-note-1',
      restoredPath: '/vault/Missing note.md',
      title: 'Missing note'
    };

    await store.recoverMissingNote('missing-note-1');
    await store.deleteMissingNote('missing-note-2');

    expect(invokeMock).toHaveBeenCalledWith('recover_missing_note', {
      noteId: 'missing-note-1'
    });
    expect(invokeMock).toHaveBeenCalledWith('delete_missing_notes', {
      noteIds: ['missing-note-2']
    });
    expect(invokeMock.mock.calls.filter(([command]) => command === 'list_missing_notes')).toHaveLength(2);
    expect(store.isUpdatingMissingNotes).toBe(false);
  });

  it('loads older Missing Note history without replacing its recovery metadata', async () => {
    const { createSettingsStore } = await import('./store.svelte');
    const store = createSettingsStore(appStoreMock);
    store.missingNotes = [missingNote({
      nextCursor: 'page-2',
      records: [
        {
          kind: 'lifecycleEvent',
          recordId: 'missing-event',
          eventId: 'missing-event',
          eventKind: 'missing',
          occurredAtMillis: 10,
          timelineOrdinal: 2,
          previousPath: null,
          path: '/vault/Ideas.md'
        }
      ]
    })];
    responses.get_missing_note_history_page = {
      nextCursor: null,
      records: [
        {
          kind: 'revision',
          recordId: 'revision-1',
          revisionId: 'revision-1',
          source: 'editor',
          occurredAtMillis: 5,
          timelineOrdinal: 1,
          timeKind: 'committed',
          modifiedAtMillis: null,
          revisionLabel: 'Before deletion',
          lineCount: 1,
          characterCount: 4
        }
      ]
    };

    await store.loadMoreMissingNoteHistory('missing-note-1');

    expect(invokeMock).toHaveBeenCalledWith('get_missing_note_history_page', {
      noteId: 'missing-note-1', cursor: 'page-2', limit: 30
    });
    expect(store.missingNotes[0]).toMatchObject({
      path: '/vault/Ideas.md',
      missingAtMillis: 10,
      retentionDays: 7,
      purgeAtMillis: 20
    });
    expect(store.missingNotes[0].timeline.records.map((record) => record.recordId)).toEqual([
      'missing-event',
      'revision-1'
    ]);
    expect(store.missingNotes[0].timeline.nextCursor).toBeNull();
    expect(store.loadingMissingTimelineNoteId).toBeNull();
  });

  it('ignores an older Missing Note page when a later refresh replaces the timeline', async () => {
    const { createSettingsStore } = await import('./store.svelte');
    const store = createSettingsStore(appStoreMock);
    store.missingNotes = [missingNote()];
    const page = deferred<HistoryModePage>();
    responses.get_missing_note_history_page = page.promise;
    responses.list_missing_notes = [
      {
        ...store.missingNotes[0],
        timeline: {
          records: [
            {
              kind: 'lifecycleEvent',
              recordId: 'refreshed-missing-event',
              eventId: 'refreshed-missing-event',
              eventKind: 'missing',
              occurredAtMillis: 12,
              timelineOrdinal: 3,
              previousPath: null,
              path: '/vault/Ideas.md'
            }
          ],
          nextCursor: 'refreshed-page-2'
        }
      }
    ];

    const paging = store.loadMoreMissingNoteHistory('missing-note-1');
    await store.loadForgottenNotes();
    page.resolve({
      records: [
        {
          kind: 'revision',
          recordId: 'stale-revision',
          revisionId: 'stale-revision', source: 'editor', occurredAtMillis: 5,
          timelineOrdinal: 1, timeKind: 'committed', modifiedAtMillis: null,
          revisionLabel: 'Stale', lineCount: 1, characterCount: 4
        }
      ],
      nextCursor: null
    });
    await paging;

    expect(store.missingNotes[0].timeline.records.map((record) => record.recordId)).toEqual([
      'refreshed-missing-event'
    ]);
    expect(store.missingNotes[0].timeline.nextCursor).toBe('refreshed-page-2');
    expect(store.loadingMissingTimelineNoteId).toBeNull();
  });

  it('ignores an older Missing Note page error after a later refresh succeeds', async () => {
    const { createSettingsStore } = await import('./store.svelte');
    const store = createSettingsStore(appStoreMock);
    store.missingNotes = [missingNote()];
    const page = deferred<HistoryModePage>();
    responses.get_missing_note_history_page = page.promise;
    responses.list_missing_notes = store.missingNotes;

    const paging = store.loadMoreMissingNoteHistory('missing-note-1');
    await store.loadForgottenNotes();
    page.reject(new Error('stale paging failure'));
    await paging;

    expect(store.missingActionError).toBeNull();
    expect(store.loadingMissingTimelineNoteId).toBeNull();
  });

  it('keeps component-passed semantic setting updates bound to the store', async () => {
    const { createSettingsStore } = await import('./store.svelte');
    const store = createSettingsStore(appStoreMock);
    store.semanticSettings = {
      semanticSearchEnabled: true,
      lexicalWeight: 0.4,
      semanticWeight: 0.6
    };
    invokeMock.mockImplementation(async (command, args) =>
      command === 'set_semantic_settings' ? args.settings : responses[command]
    );

    const updateSetting = store.updateSetting;
    updateSetting('semanticSearchEnabled', false);

    await vi.waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('set_semantic_settings', {
        settings: {
          semanticSearchEnabled: false,
          lexicalWeight: 0.4,
          semanticWeight: 0.6
        }
      });
    });
  });

  it('retries and explicitly confirms destructive history recovery', async () => {
    const { createSettingsStore } = await import('./store.svelte');
    const store = createSettingsStore(appStoreMock);
    const repaired = {
      state: 'healthy',
      integrity: 'verified',
      initialization: {
        phase: 'complete',
        discoveredNotes: 1,
        baselineRevisions: 1,
        readyNotes: 1,
        failedNotes: 0
      },
      storage: { allocatedBytes: 8192, reclaimableBytes: 0 },
      pendingRepairs: 0,
      canRetry: false,
      canReset: false
    };
    invokeMock.mockImplementation(async (command, args) => {
      if (command === 'retry_history_recovery') return repaired;
      if (command === 'reset_corrupt_history') {
        expect(args).toEqual({ confirmed: true });
        return { operationId: 'reset-1' };
      }
      if (command === 'get_history_health') return repaired;
      return undefined;
    });

    await store.retryHistory();
    await store.resetCorruptHistory();

    expect(invokeMock).toHaveBeenCalledWith('retry_history_recovery');
    expect(invokeMock).toHaveBeenCalledWith('reset_corrupt_history', { confirmed: true });
    expect(invokeMock).toHaveBeenCalledWith('get_history_health');
    expect(store.historyHealth).toEqual(repaired);
    expect(store.historyActionError).toBeNull();
  });

  it('explicitly confirms vault-wide history clear and refreshes storage reporting', async () => {
    const { createSettingsStore } = await import('./store.svelte');
    const store = createSettingsStore(appStoreMock);
    const afterClear = {
      state: 'healthy',
      integrity: 'verified',
      initialization: {
        phase: 'complete',
        discoveredNotes: 2,
        baselineRevisions: 2,
        readyNotes: 2,
        failedNotes: 0
      },
      storage: { allocatedBytes: 16_384, reclaimableBytes: 8_192 },
      pendingRepairs: 0,
      canRetry: false,
      canReset: false
    };
    invokeMock.mockImplementation(async (command, args) => {
      if (command === 'clear_vault_history') {
        expect(args).toEqual({ confirmed: true });
        return undefined;
      }
      if (command === 'get_history_health') return afterClear;
      return undefined;
    });

    await store.clearVaultHistory();

    expect(invokeMock).toHaveBeenCalledWith('clear_vault_history', { confirmed: true });
    expect(store.historyHealth).toEqual(afterClear);
    expect(store.historyActionError).toBeNull();
  });

  it('reports a committed vault clear honestly when storage reporting cannot refresh', async () => {
    const { createSettingsStore } = await import('./store.svelte');
    const store = createSettingsStore(appStoreMock);
    invokeMock.mockImplementation(async (command) => {
      if (command === 'clear_vault_history') return undefined;
      if (command === 'get_history_health') throw new Error('history health unavailable');
      return undefined;
    });

    await store.clearVaultHistory();

    expect(invokeMock).toHaveBeenCalledWith('clear_vault_history', { confirmed: true });
    expect(store.historyActionError).toBe(
      'Vault history was cleared, but storage reporting could not refresh: History is unavailable right now.'
    );
    expect(store.isRunningHistoryAction).toBe(false);
  });

  it('stages the selected path without replacing the backend running vault', async () => {
    const { createSettingsStore } = await import('./store.svelte');
    const store = createSettingsStore(appStoreMock);
    store.setVaultPathInput('/next-vault');
    responses.set_vault_directory = {
      runningPath: '/running-vault',
      selectedPath: '/next-vault',
      defaultPath: '/default-vault',
      forgottenPath: '/running-vault/.forgotten',
      isDefault: false,
      noteCount: 3,
      requiresRestart: true,
      canConfigurePath: true,
      canPickArbitraryPath: true,
      vaultContainerPath: null,
      pathConfigurationNote: null
    };

    await store.saveVaultDirectory();

    expect(invokeMock).toHaveBeenCalledWith('set_vault_directory', {
      path: '/next-vault'
    });
    expect(store.vaultInfo).toMatchObject({
      runningPath: '/running-vault',
      selectedPath: '/next-vault',
      requiresRestart: true
    });
    expect(store.vaultPathInput).toBe('/next-vault');
  });

  it('keeps a newer staged vault when an older Apply result arrives later', async () => {
    const { createSettingsStore } = await import('./store.svelte');
    const store = createSettingsStore(appStoreMock);
    const resultB = deferred<VaultInfo>();
    const resultC = deferred<VaultInfo>();
    invokeMock.mockImplementation((_command, args) =>
      args.path === '/vault-b' ? resultB.promise : resultC.promise
    );
    store.setVaultPathInput('/vault-b');
    const applyB = store.saveVaultDirectory();
    store.setVaultPathInput('/vault-c');
    const applyC = store.saveVaultDirectory();
    resultC.resolve({
      ...vaultFixture,
      runningPath: '/vault-a', selectedPath: '/vault-c', canPickArbitraryPath: true
    });
    await applyC;
    resultB.resolve({
      ...vaultFixture, runningPath: '/vault-a', selectedPath: '/vault-b', canPickArbitraryPath: true
    });
    await applyB;
    expect(store.vaultInfo?.selectedPath).toBe('/vault-c');
    expect(store.vaultPathInput).toBe('/vault-c');
  });

  it('does not let a delayed Settings view replace newer vault and semantic snapshots', async () => {
    const { createSettingsStore } = await import('./store.svelte');
    const store = createSettingsStore(appStoreMock);
    const delayed = deferred<SettingsViewPayload>();
    responses.get_settings_view = delayed.promise;
    const loading = store.loadSemanticState();
    const staged = { ...vaultFixture, runningPath: '/vault-a', selectedPath: '/vault-c' };
    responses.set_vault_directory = staged;
    responses.get_semantic_status = { ...semanticStatusFixture, indexedNotes: 999 };
    await appStoreMock.stageVaultSelection('/vault-c');
    vi.mocked(appStoreMock.refreshSemanticStatus).mockRestore();
    await appStoreMock.refreshSemanticStatus();
    delayed.resolve({
      ...settingsViewFixture(),
      vault: { ...vaultFixture, runningPath: '/vault-a', selectedPath: '/vault-b' },
      semanticStatus: { ...semanticStatusFixture, indexedNotes: 1 }
    });
    await loading;
    expect(store.vaultInfo?.selectedPath).toBe('/vault-c');
    expect(store.semanticStatus?.indexedNotes).toBe(999);
    expect(store.semanticSettings).toEqual(settingsViewFixture().semanticSettings);
  });

  it('surfaces bundled Settings failure without invoking equivalent fallback RPCs', async () => {
    const { createSettingsStore } = await import('./store.svelte');
    const store = createSettingsStore(appStoreMock);
    responses.get_settings_view = Promise.reject(new Error('settings bundle unavailable'));
    await store.loadSemanticState();
    expect(store.settingsLoadError).toContain('settings bundle unavailable');
    expect(invokeMock).not.toHaveBeenCalledWith('get_semantic_status');
    expect(invokeMock).not.toHaveBeenCalledWith('get_vault_info');
    expect(invokeMock).not.toHaveBeenCalledWith('get_history_health');
  });
});

describe('SettingsStore asynchronous admission', () => {
  it('joins initialization and never subscribes after disposal during bootstrap', async () => {
    const { createSettingsStore } = await import('./store.svelte');
    const boot = deferred<ReturnType<typeof bootstrapFixture>>();
    vi.mocked(appStoreMock.bootstrap).mockReturnValue(boot.promise);
    const subscribe = vi.spyOn(appStoreMock, 'subscribeVaultChanged');
    const store = createSettingsStore(appStoreMock);
    const first = store.initialize(); expect(store.initialize()).toBe(first);
    store.dispose(); boot.resolve(bootstrapFixture()); await first;
    expect(subscribe).not.toHaveBeenCalled();
    expect(invokeMock).not.toHaveBeenCalledWith('get_settings_view');
    await store.initialize(); expect(subscribe).toHaveBeenCalledOnce();
    store.dispose();
  });

  it('ignores a delayed view after disposal and admits a fresh view after reopening', async () => {
    const { createSettingsStore } = await import('./store.svelte');
    const old = deferred<ReturnType<typeof settingsViewFixture>>();
    responses.get_settings_view = old.promise;
    const store = createSettingsStore(appStoreMock);
    const loading = store.loadSemanticState(); store.dispose();
    responses.get_settings_view = settingsViewFixture();
    await store.initialize();
    const stale = settingsViewFixture(); stale.semanticSettings.lexicalWeight = 0.99;
    old.resolve(stale); await loading;
    expect(store.semanticSettings).toEqual(settingsViewFixture().semanticSettings);
    store.dispose();
  });

  it('keeps newer history health when an older settings bundle finishes', async () => {
    const { createSettingsStore } = await import('./store.svelte');
    const old = deferred<ReturnType<typeof settingsViewFixture>>();
    responses.get_settings_view = old.promise;
    const store = createSettingsStore(appStoreMock); const loading = store.loadSemanticState();
    const health = { ...settingsViewFixture().historyHealth, pendingRepairs: 4 };
    responses.get_history_health = health; await store.loadHistoryHealth();
    old.resolve(settingsViewFixture()); await loading;
    expect(store.historyHealth).toEqual(health);
    store.dispose();
  });

  it('serializes semantic writes and protects newer edits from old acknowledgements and refreshes', async () => {
    const { createSettingsStore } = await import('./store.svelte');
    const first = deferred<ReturnType<typeof settingsViewFixture>['semanticSettings']>();
    const second = deferred<ReturnType<typeof settingsViewFixture>['semanticSettings']>();
    const writes = [first.promise, second.promise];
    invokeMock.mockImplementation(async command =>
      command === 'set_semantic_settings' ? writes.shift() : responses[command]
    );
    const store = createSettingsStore(appStoreMock);
    store.semanticSettings = settingsViewFixture().semanticSettings;
    const oldView = deferred<ReturnType<typeof settingsViewFixture>>();
    responses.get_settings_view = oldView.promise;
    const refreshing = store.loadSemanticState();
    store.updateSetting('lexicalWeight', 0.2);
    store.updateSetting('semanticWeight', 0.8);
    await vi.waitFor(() => expect(invokeMock.mock.calls.filter(([command]) => command === 'set_semantic_settings')).toHaveLength(1));
    oldView.resolve(settingsViewFixture()); await refreshing;
    expect(store.semanticSettings?.semanticWeight).toBe(0.8);
    first.resolve({ ...settingsViewFixture().semanticSettings, lexicalWeight: 0.2 });
    await vi.waitFor(() => expect(invokeMock.mock.calls.filter(([command]) => command === 'set_semantic_settings')).toHaveLength(2));
    expect(invokeMock).toHaveBeenLastCalledWith('set_semantic_settings', {
      settings: expect.objectContaining({ lexicalWeight: 0.2, semanticWeight: 0.8 })
    });
    const saved = { semanticSearchEnabled: true, lexicalWeight: 0.2, semanticWeight: 0.8 };
    responses.get_settings_view = { ...settingsViewFixture(), semanticSettings: saved };
    second.resolve(saved);
    await vi.waitFor(() => expect(store.isSaving).toBe(false));
    expect(store.semanticSettings).toEqual(saved);
    store.dispose();
  });

  it.each([
    ['search', 'loadSemanticState'], ['vault', 'loadVaultInfo'], ['forgetting', 'loadForgottenNotes'], ['history', 'loadHistoryHealth'], ['appearance', 'loadSemanticStatus']
  ] as const)('refreshes the visible %s section through the owner', async (section, method) => {
    const { createSettingsStore } = await import('./store.svelte');
    const store = createSettingsStore(appStoreMock);
    const methods = ['loadSemanticState', 'loadVaultInfo', 'loadForgottenNotes', 'loadHistoryHealth', 'loadSemanticStatus'] as const;
    const spies = methods.map(name => vi.spyOn(store, name).mockResolvedValue(undefined));
    store.activeGeneralSection = section;
    vi.stubGlobal('document', { visibilityState: 'visible' });
    try {
      await store.handleVisibilityChange();
      methods.forEach((name, index) => expect(spies[index]).toHaveBeenCalledTimes(name === method ? 1 : 0));
    } finally { store.dispose(); vi.unstubAllGlobals(); }
  });
});

describe('SettingsStore mutation/read conflicts', () => {
  it('does not admit a settings bundle begun during a history mutation', async () => {
    const { createSettingsStore } = await import('./store.svelte');
    const action = deferred<ReturnType<typeof settingsViewFixture>['historyHealth']>();
    responses.retry_history_recovery = action.promise;
    const store = createSettingsStore(appStoreMock); const retry = store.retryHistory();
    const bundle = deferred<ReturnType<typeof settingsViewFixture>>();
    responses.get_settings_view = bundle.promise; const loading = store.loadSemanticState();
    const health = { ...settingsViewFixture().historyHealth, pendingRepairs: 7 };
    action.resolve(health); await retry;
    bundle.resolve(settingsViewFixture()); await loading;
    expect(store.historyHealth).toEqual(health); store.dispose();
  });

  it('refetches after a forgotten mutation instead of joining a pre-mutation read', async () => {
    const { createSettingsStore } = await import('./store.svelte');
    const prior = deferred<import('$lib/types/forgottenNotes').ForgottenNoteSummary[]>();
    responses.list_forgotten_notes = prior.promise;
    const store = createSettingsStore(appStoreMock); const reading = store.loadForgottenNotes();
    responses.list_forgotten_notes = [];
    await store.runForgottenAction('delete_forgotten_notes', ['/old']);
    expect(invokeMock.mock.calls.filter(([command]) => command === 'list_forgotten_notes')).toHaveLength(2);
    prior.resolve([{ kind: 'note', forgottenPath: '/old', originalPath: '/vault/old.md', title: 'Old', fileName: 'old.md', forgottenAtMillis: 1, purgeAfterDays: 7, purgeAtMillis: 2 }]);
    await reading; expect(store.forgottenNotes).toEqual([]); store.dispose();
  });
});
