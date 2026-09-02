import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.fn();
const loadForgottenNotesSliceMock = vi.fn();
const loadSettingsViewSliceMock = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: vi.fn() }));
vi.mock('$lib/app/appStore.svelte', () => ({
  appStore: {
    bootstrap: vi.fn().mockResolvedValue(undefined),
    subscribeVaultNoteChanged: vi.fn(() => () => undefined),
    subscribeSemanticStatusChanged: vi.fn(() => () => undefined)
  }
}));
vi.mock('$lib/features/atlas/atlasStore.svelte', () => ({
  atlasStore: { invalidateCachedResponse: vi.fn() }
}));
vi.mock('./loaders/forgottenLoader', () => ({
  loadForgottenNotesSlice: loadForgottenNotesSliceMock
}));
vi.mock('./loaders/settingsViewLoader', () => ({
  loadSettingsViewSlice: loadSettingsViewSliceMock
}));

describe('SettingsStore actions', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    loadForgottenNotesSliceMock.mockReset();
    invokeMock.mockResolvedValue(undefined);
    loadForgottenNotesSliceMock.mockResolvedValue([]);
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
        currentPath: '/vault',
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
});
