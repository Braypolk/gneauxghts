import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.fn();
const loadForgottenNotesSliceMock = vi.fn();
const loadMissingNotesSliceMock = vi.fn();
const loadMissingNoteTimelinePageMock = vi.fn();
const loadSettingsViewSliceMock = vi.fn();
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const appStoreMock = vi.hoisted(() => {
  const store: any = {
    vaultInfo: null,
    semanticStatus: null,
    vaultRevision: 0,
    semanticRevision: 0,
    bootstrap: vi.fn().mockResolvedValue(undefined),
    subscribeVaultNoteChanged: vi.fn(() => () => undefined),
    subscribeSemanticStatusChanged: vi.fn(() => () => undefined),
    subscribeVaultChanged: vi.fn(() => () => undefined),
    refreshVaultInfo: vi.fn().mockResolvedValue(undefined),
    refreshSemanticStatus: vi.fn().mockResolvedValue(undefined)
  };
  store.beginSnapshotAdmission = vi.fn((...slices: string[]) => ({
    generation: 0,
    vault: slices.includes('vault') ? ++store.vaultRevision : null,
    semanticStatus: slices.includes('semanticStatus') ? ++store.semanticRevision : null,
    indexRevision: null
  }));
  store.admitSnapshot = vi.fn((snapshot: any, admission: any) => {
    const admitted = { vault: false, semanticStatus: false, indexRevision: false };
    if ('vault' in snapshot && admission.vault === store.vaultRevision) {
      store.vaultInfo = snapshot.vault;
      admitted.vault = true;
    }
    if (
      'semanticStatus' in snapshot &&
      admission.semanticStatus === store.semanticRevision
    ) {
      store.semanticStatus = snapshot.semanticStatus;
      admitted.semanticStatus = true;
    }
    return admitted;
  });
  return store;
});

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: vi.fn() }));
vi.mock('$lib/app/appStore.svelte', () => ({
  appStore: appStoreMock
}));
vi.mock('$lib/features/atlas/atlasStore.svelte', () => ({
  atlasStore: { invalidateCachedResponse: vi.fn() }
}));
vi.mock('./loaders/forgottenLoader', () => ({
  loadForgottenNotesSlice: loadForgottenNotesSliceMock,
  loadMissingNotesSlice: loadMissingNotesSliceMock,
  loadMissingNoteTimelinePage: loadMissingNoteTimelinePageMock
}));
vi.mock('./loaders/settingsViewLoader', () => ({
  loadSettingsViewSlice: loadSettingsViewSliceMock
}));

describe('SettingsStore actions', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    loadForgottenNotesSliceMock.mockReset();
    loadMissingNotesSliceMock.mockReset();
    loadMissingNoteTimelinePageMock.mockReset();
    appStoreMock.vaultInfo = null;
    appStoreMock.semanticStatus = null;
    appStoreMock.vaultRevision = 0;
    appStoreMock.semanticRevision = 0;
    appStoreMock.bootstrap.mockReset().mockResolvedValue(undefined);
    appStoreMock.subscribeVaultNoteChanged.mockReset().mockReturnValue(() => undefined);
    appStoreMock.subscribeSemanticStatusChanged.mockReset().mockReturnValue(() => undefined);
    appStoreMock.subscribeVaultChanged.mockReset().mockReturnValue(() => undefined);
    appStoreMock.refreshVaultInfo.mockReset().mockResolvedValue(undefined);
    appStoreMock.refreshSemanticStatus.mockReset().mockResolvedValue(undefined);
    invokeMock.mockResolvedValue(undefined);
    loadForgottenNotesSliceMock.mockResolvedValue([]);
    loadMissingNotesSliceMock.mockResolvedValue([]);
    loadMissingNoteTimelinePageMock.mockResolvedValue({ records: [], nextCursor: null });
    loadSettingsViewSliceMock.mockResolvedValue({
      historyHealth: {
        state: 'healthy',
        integrity: 'verified',
        initialization: {
          phase: 'complete',
          discoveredNotes: 0,
          baselineRevisions: 0,
          readyNotes: 0,
          failedNotes: 0
        },
        storage: { allocatedBytes: 4096, reclaimableBytes: 0 },
        pendingRepairs: 0,
        canRetry: false,
        canReset: false
      },
      semanticStatus: null,
      semanticSettings: null,
      semanticDebug: null,
      vault: {
        runningPath: '/vault',
        selectedPath: '/vault',
        defaultPath: '/vault',
        forgottenPath: '/vault/.forgotten',
        isDefault: true,
        noteCount: 0,
        requiresRestart: false,
        canConfigurePath: true,
        canPickArbitraryPath: true,
        vaultContainerPath: null,
        pathConfigurationNote: null
      }
    });
  });

  it('keeps component-passed actions bound to the settings store', async () => {
    const { createSettingsStore } = await import('./store.svelte');
    const store = createSettingsStore();
    const forgottenPath = '/vault/.forgotten/2026-07-28-chat';
    store.selectedForgottenPaths = [forgottenPath];

    const runForgottenAction = store.runForgottenAction;
    const toggleForgottenSelection = store.toggleForgottenSelection;
    await runForgottenAction('restore_forgotten_notes', [forgottenPath]);
    toggleForgottenSelection(forgottenPath, true);

    expect(invokeMock).toHaveBeenCalledWith('restore_forgotten_notes', {
      forgottenPaths: [forgottenPath]
    });
    expect(loadForgottenNotesSliceMock).toHaveBeenCalledOnce();
    expect(store.selectedForgottenPaths).toEqual([forgottenPath]);
    expect(store.isUpdatingForgottenNotes).toBe(false);
  });

  it('finishes local search setup by starting the model and retrying indexing', async () => {
    const { createSettingsStore } = await import('./store.svelte');
    const store = createSettingsStore();
    const download = deferred<{ alreadyPresent: boolean; path: string }>();
    invokeMock.mockImplementation((command: string) => command === 'download_semantic_embedding_model'
      ? download.promise : Promise.resolve(undefined));

    const setup = store.downloadEmbeddingModel();
    expect(store.isRunningAction).toBe(true);
    expect(store.semanticLayerMessage).toContain('Downloading any missing files');
    await store.downloadEmbeddingModel();
    expect(invokeMock).toHaveBeenCalledOnce();
    download.resolve({ alreadyPresent: true, path: '/app/model.gguf' });
    await setup;

    expect(invokeMock.mock.calls.map(([command]) => command)).toEqual([
      'download_semantic_embedding_model', 'prepare_semantic_model', 'retry_semantic_index'
    ]);
    expect(store.semanticLayerMessage).toBe('Local search is set up. Your notes will now be indexed.');
    expect(store.semanticLayerError).toBeNull();
    expect(store.isRunningAction).toBe(false);
    expect(loadSettingsViewSliceMock).toHaveBeenCalledOnce();
  });

  it('keeps failed setup retryable without starting a missing model', async () => {
    const { createSettingsStore } = await import('./store.svelte');
    const store = createSettingsStore();
    invokeMock.mockRejectedValueOnce('Download interrupted. Try setup again.');
    await store.downloadEmbeddingModel();
    expect(invokeMock).toHaveBeenCalledOnce();
    expect(store.semanticLayerError).toBe('Download interrupted. Try setup again.');
    expect(store.semanticLayerMessage).toBeNull();
    expect(store.isRunningAction).toBe(false);
  });

  it('surfaces committed recovery warnings in settings', async () => {
    const { createSettingsStore } = await import('./store.svelte');
    const store = createSettingsStore();
    invokeMock.mockResolvedValue([
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
    ]);

    await store.runForgottenAction('restore_forgotten_notes', [
      '/vault/.forgotten/Note.md'
    ]);

    expect(store.forgottenActionMessage).toBe('Timeline recovery is pending.');
    expect(store.forgottenActionError).toBeNull();
  });

  it('routes Missing Note recovery and purge through identity-scoped commands', async () => {
    const { createSettingsStore } = await import('./store.svelte');
    const store = createSettingsStore();
    invokeMock.mockResolvedValue({
      noteId: 'missing-note-1',
      restoredPath: '/vault/Missing note.md',
      title: 'Missing note'
    });

    await store.recoverMissingNote('missing-note-1');
    await store.deleteMissingNote('missing-note-2');

    expect(invokeMock).toHaveBeenCalledWith('recover_missing_note', {
      noteId: 'missing-note-1'
    });
    expect(invokeMock).toHaveBeenCalledWith('delete_missing_notes', {
      noteIds: ['missing-note-2']
    });
    expect(loadMissingNotesSliceMock).toHaveBeenCalledTimes(2);
    expect(store.isUpdatingMissingNotes).toBe(false);
  });

  it('loads older Missing Note history without replacing its recovery metadata', async () => {
    const { createSettingsStore } = await import('./store.svelte');
    const store = createSettingsStore();
    store.missingNotes = [
      {
        noteId: 'missing-note-1',
        path: '/vault/Ideas.md',
        title: 'Ideas',
        fileName: 'Ideas.md',
        missingAtMillis: 10,
        retentionDays: 7,
        purgeAtMillis: 20,
        timeline: {
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
        }
      }
    ];
    loadMissingNoteTimelinePageMock.mockResolvedValue({
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
    });

    await store.loadMoreMissingNoteHistory('missing-note-1');

    expect(loadMissingNoteTimelinePageMock).toHaveBeenCalledWith(
      'missing-note-1',
      'page-2'
    );
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
    const store = createSettingsStore();
    store.missingNotes = [
      {
        noteId: 'missing-note-1',
        path: '/vault/Ideas.md',
        title: 'Ideas',
        fileName: 'Ideas.md',
        missingAtMillis: 10,
        retentionDays: 7,
        purgeAtMillis: 20,
        timeline: { records: [], nextCursor: 'page-2' }
      }
    ];
    let resolvePage!: (value: unknown) => void;
    loadMissingNoteTimelinePageMock.mockImplementation(
      () => new Promise((resolve) => (resolvePage = resolve))
    );
    loadMissingNotesSliceMock.mockResolvedValue([
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
    ]);

    const paging = store.loadMoreMissingNoteHistory('missing-note-1');
    await store.loadForgottenNotes();
    resolvePage({
      records: [
        {
          kind: 'revision',
          recordId: 'stale-revision',
          revisionId: 'stale-revision'
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
    const store = createSettingsStore();
    store.missingNotes = [
      {
        noteId: 'missing-note-1',
        path: '/vault/Ideas.md',
        title: 'Ideas',
        fileName: 'Ideas.md',
        missingAtMillis: 10,
        retentionDays: 7,
        purgeAtMillis: 20,
        timeline: { records: [], nextCursor: 'page-2' }
      }
    ];
    let rejectPage!: (reason: unknown) => void;
    loadMissingNoteTimelinePageMock.mockImplementation(
      () => new Promise((_, reject) => (rejectPage = reject))
    );
    loadMissingNotesSliceMock.mockResolvedValue(store.missingNotes);

    const paging = store.loadMoreMissingNoteHistory('missing-note-1');
    await store.loadForgottenNotes();
    rejectPage(new Error('stale paging failure'));
    await paging;

    expect(store.missingActionError).toBeNull();
    expect(store.loadingMissingTimelineNoteId).toBeNull();
  });

  it('routes Retry now through the focused semantic command adapter', async () => {
    const { createSettingsStore } = await import('./store.svelte');
    const store = createSettingsStore();

    await store.runAction('retry_semantic_index');

    expect(invokeMock).toHaveBeenCalledWith('retry_semantic_index');
    expect(store.isRunningAction).toBe(false);
  });

  it('keeps component-passed semantic setting updates bound to the store', async () => {
    const { createSettingsStore } = await import('./store.svelte');
    const store = createSettingsStore();
    store.semanticSettings = {
      semanticSearchEnabled: true,
      lexicalWeight: 0.4,
      semanticWeight: 0.6
    };
    invokeMock.mockImplementation(async (command, args) =>
      command === 'set_semantic_settings' ? args.settings : undefined
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
    const store = createSettingsStore();
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
    const store = createSettingsStore();
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
    const store = createSettingsStore();
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
    const store = createSettingsStore();
    store.setVaultPathInput('/next-vault');
    invokeMock.mockResolvedValue({
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
    });

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
    const store = createSettingsStore();
    const resultB = deferred<any>();
    const resultC = deferred<any>();
    invokeMock.mockImplementation((_command, args) =>
      args.path === '/vault-b' ? resultB.promise : resultC.promise
    );
    store.setVaultPathInput('/vault-b');
    const applyB = store.saveVaultDirectory();
    store.setVaultPathInput('/vault-c');
    const applyC = store.saveVaultDirectory();
    resultC.resolve({
      ...loadSettingsViewSliceMock.mock.results[0]?.value?.vault,
      runningPath: '/vault-a', selectedPath: '/vault-c', canPickArbitraryPath: true
    });
    await applyC;
    resultB.resolve({
      runningPath: '/vault-a', selectedPath: '/vault-b', canPickArbitraryPath: true
    });
    await applyB;
    expect(store.vaultInfo?.selectedPath).toBe('/vault-c');
    expect(store.vaultPathInput).toBe('/vault-c');
  });

  it('does not let a delayed Settings view replace newer vault and semantic snapshots', async () => {
    const { createSettingsStore } = await import('./store.svelte');
    const store = createSettingsStore();
    const delayed = deferred<any>();
    loadSettingsViewSliceMock.mockReturnValue(delayed.promise);
    const loading = store.loadSemanticState();
    const newer = appStoreMock.beginSnapshotAdmission('vault', 'semanticStatus');
    appStoreMock.admitSnapshot(
      {
        vault: { runningPath: '/vault-a', selectedPath: '/vault-c' },
        semanticStatus: { phase: 'newer-event' }
      },
      newer
    );
    delayed.resolve({
      vault: { runningPath: '/vault-a', selectedPath: '/vault-b' },
      semanticStatus: { phase: 'older-load' },
      semanticSettings: { semanticSearchEnabled: true },
      semanticDebug: { queuedNotes: 0 },
      historyHealth: { state: 'healthy' }
    });
    await loading;
    expect(store.vaultInfo?.selectedPath).toBe('/vault-c');
    expect((store.semanticStatus as any)?.phase).toBe('newer-event');
    expect(store.semanticSettings).toEqual({ semanticSearchEnabled: true });
  });

  it('surfaces bundled Settings failure without invoking equivalent fallback RPCs', async () => {
    const { createSettingsStore } = await import('./store.svelte');
    const store = createSettingsStore();
    loadSettingsViewSliceMock.mockRejectedValue(new Error('settings bundle unavailable'));
    await store.loadSemanticState();
    expect(store.settingsLoadError).toContain('settings bundle unavailable');
    expect(invokeMock).not.toHaveBeenCalledWith('get_semantic_status');
    expect(invokeMock).not.toHaveBeenCalledWith('get_vault_info');
    expect(invokeMock).not.toHaveBeenCalledWith('get_history_health');
  });
});
