import { invoke } from '@tauri-apps/api/core';
import {
  historyCommandMessage,
  invokeHistoryCommand
} from '$lib/contracts/historyCommand';
import { open } from '@tauri-apps/plugin-dialog';
import { appStore } from '$lib/app/appStore.svelte';
import { restartLifecycle } from '$lib/app/restartLifecycle.svelte';
import { atlasStore } from '$lib/features/atlas/atlasStore.svelte';
import type {
  ForgottenNoteSummary,
  RestoredForgottenNote
} from '$lib/types/forgottenNotes';
import type { MissingNoteSummary, RecoveredMissingNote } from '$lib/types/missingNotes';
import { compareHistoryRecordsNewestFirst } from '$lib/features/history/historyModeMachine';
import type { VaultFolderInfo, VaultInfo } from '$lib/types/vault';
import type { HistoryHealthReport } from '$lib/types/history';
import type {
  SemanticDebugSnapshot,
  SemanticModelDownloadResult,
  SemanticSettings,
  SemanticStatus
} from '$lib/types/semantic';
import {
  refreshSettingsAfterVaultChange,
  refreshSettingsForVisibility
} from './refreshCoordinator';
import {
  loadForgottenNotesSlice,
  loadMissingNoteTimelinePage,
  loadMissingNotesSlice
} from './loaders/forgottenLoader';
import {
  retrySemanticIndex
} from './loaders/semanticLoader';
import { loadSettingsViewSlice } from './loaders/settingsViewLoader';
import {
  clearVaultHistory as requestVaultHistoryClear,
  loadHistoryHealthSlice,
  resetCorruptHistory as requestCorruptHistoryReset,
  retryHistoryRecovery
} from './loaders/historyLoader';
import {
  createVaultFolderSlice,
  listVaultFoldersSlice
} from './loaders/vaultLoader';

type SettingsTab = 'general' | 'forgotten';
type GeneralSection =
  | 'appearance'
  | 'shortcuts'
  | 'forgetting'
  | 'vault'
  | 'history'
  | 'ai'
  | 'search';
type ForgottenAction = 'restore_forgotten_notes' | 'delete_forgotten_notes';
type SemanticAction =
  | 'rebuild_semantic_index'
  | 'retry_semantic_index'
  | 'pause_semantic_indexing'
  | 'resume_semantic_indexing'
  | 'prepare_semantic_model';

export type { GeneralSection, SettingsTab };

export class SettingsStore {
  semanticSettings = $state<SemanticSettings | null>(null);
  semanticDebug = $state<SemanticDebugSnapshot | null>(null);
  settingsLoadError = $state<string | null>(null);
  historyHealth = $state<HistoryHealthReport | null>(null);
  historyActionError = $state<string | null>(null);
  isRunningHistoryAction = $state(false);
  vaultPathInput = $state('');
  vaultSaveError = $state<string | null>(null);
  isSavingVault = $state(false);
  isPickingVault = $state(false);
  vaultFolders = $state<VaultFolderInfo[]>([]);
  newVaultName = $state('');
  isLoadingVaultFolders = $state(false);
  isCreatingVaultFolder = $state(false);
  activeTab = $state<SettingsTab>('general');
  activeGeneralSection = $state<GeneralSection>('appearance');
  forgottenNotes = $state<ForgottenNoteSummary[]>([]);
  missingNotes = $state<MissingNoteSummary[]>([]);
  selectedForgottenPaths = $state<string[]>([]);
  isLoadingForgottenNotes = $state(false);
  isUpdatingForgottenNotes = $state(false);
  forgottenActionMessage = $state<string | null>(null);
  forgottenActionError = $state<string | null>(null);
  isUpdatingMissingNotes = $state(false);
  loadingMissingTimelineNoteId = $state<string | null>(null);
  missingActionMessage = $state<string | null>(null);
  missingActionError = $state<string | null>(null);
  isSaving = $state(false);
  isRunningAction = $state(false);
  semanticLayerError = $state<string | null>(null);
  semanticLayerMessage = $state<string | null>(null);

  #semanticPollTimer: number | null = null;
  #vaultChangeRefreshTimer: number | null = null;
  #semanticStatusRequest: Promise<void> | null = null;
  #semanticStateRequest: Promise<void> | null = null;
  #forgottenNotesRequest: Promise<void> | null = null;
  #missingNotesGeneration = 0;
  #vaultSaveGeneration = 0;
  #disposeVaultNoteChanged: (() => void) | null = null;
  #disposeSemanticStatus: (() => void) | null = null;
  #disposeVaultChanged: (() => void) | null = null;

  get semanticStatus(): SemanticStatus | null {
    return appStore.semanticStatus;
  }

  get vaultInfo(): VaultInfo | null {
    return appStore.vaultInfo;
  }

  get usesVaultContainer() {
    return this.vaultInfo != null && this.vaultInfo.canPickArbitraryPath === false;
  }

  get isRestarting() {
    return restartLifecycle.phase === 'preparing';
  }

  get restartReady() {
    return restartLifecycle.workspaceMutationsBlocked && restartLifecycle.phase !== 'preparing';
  }

  setActiveTab(activeTab: SettingsTab) {
    this.activeTab = activeTab;
  }

  setActiveGeneralSection(activeGeneralSection: GeneralSection) {
    this.activeGeneralSection = activeGeneralSection;
    if (activeGeneralSection === 'history') void this.loadHistoryHealth();
  }

  setVaultPathInput(vaultPathInput: string) {
    this.vaultPathInput = vaultPathInput;
    this.vaultSaveError = null;
  }

  setNewVaultName(newVaultName: string) {
    this.newVaultName = newVaultName;
    this.vaultSaveError = null;
  }

  setSelectedForgottenPaths(
    selectedForgottenPaths: string[] | ((current: string[]) => string[])
  ) {
    this.selectedForgottenPaths =
      typeof selectedForgottenPaths === 'function'
        ? selectedForgottenPaths(this.selectedForgottenPaths)
        : selectedForgottenPaths;
  }

  #syncVaultSnapshot(resetInput = false) {
    const nextVaultInfo = this.vaultInfo;
    if (!nextVaultInfo) return;
    this.vaultPathInput = resetInput
      ? nextVaultInfo.selectedPath
      : this.vaultPathInput.trim() === ''
        ? nextVaultInfo.selectedPath
        : this.vaultPathInput;
    this.vaultSaveError = null;
    if (!nextVaultInfo.canPickArbitraryPath) {
      void this.loadVaultFolders();
    } else {
      this.vaultFolders = [];
    }
  }

  async loadVaultFolders() {
    if (this.vaultInfo?.canPickArbitraryPath !== false) {
      this.vaultFolders = [];
      return;
    }

    this.isLoadingVaultFolders = true;
    try {
      this.vaultFolders = await listVaultFoldersSlice();
    } catch (error) {
      console.error('Failed to list vault folders:', error);
      this.vaultSaveError = String(error);
    } finally {
      this.isLoadingVaultFolders = false;
    }
  }

  selectVaultFolder(path: string) {
    this.setVaultPathInput(path);
  }

  async createVaultFolder() {
    const name = this.newVaultName.trim();
    if (name === '') {
      this.vaultSaveError = 'Enter a vault name.';
      return;
    }

    this.isCreatingVaultFolder = true;
    this.vaultSaveError = null;
    try {
      const result = await createVaultFolderSlice(name);
      this.vaultFolders = result.folders;
      this.newVaultName = '';
      this.setVaultPathInput(result.createdPath);
    } catch (error) {
      console.error('Failed to create vault folder:', error);
      this.vaultSaveError = String(error);
    } finally {
      this.isCreatingVaultFolder = false;
    }
  }

  async pickVaultDirectory() {
    if (!(this.vaultInfo?.canConfigurePath ?? true)) {
      return;
    }
    if (this.vaultInfo?.canPickArbitraryPath === false) {
      return;
    }

    this.isPickingVault = true;
    this.vaultSaveError = null;
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        defaultPath: this.vaultPathInput.trim() || this.vaultInfo?.selectedPath || undefined,
        title: 'Choose vault folder'
      });
      if (typeof selected === 'string' && selected.trim() !== '') {
        this.vaultPathInput = selected;
      }
    } catch (error) {
      console.error('Failed to pick vault directory:', error);
      this.vaultSaveError = String(error);
    } finally {
      this.isPickingVault = false;
    }
  }

  async restartApp() {
    await restartLifecycle.restart();
    this.vaultSaveError = restartLifecycle.error;
  }

  #stopSemanticPolling() {
    if (this.#semanticPollTimer) {
      window.clearInterval(this.#semanticPollTimer);
      this.#semanticPollTimer = null;
    }
  }

  #shouldPollSemanticState() {
    return Boolean(
      this.semanticStatus?.indexingInProgress || this.isRunningAction || this.isSaving
    );
  }

  #syncSemanticPolling() {
    if (typeof document === 'undefined' || document.visibilityState !== 'visible') {
      this.#stopSemanticPolling();
      return;
    }

    if (!this.#shouldPollSemanticState()) {
      this.#stopSemanticPolling();
      return;
    }

    if (this.#semanticPollTimer) {
      return;
    }

    this.#semanticPollTimer = window.setInterval(() => {
      void this.loadSemanticStatus();
    }, 5000);
  }

  async loadVaultInfo() {
    try {
      await appStore.refreshVaultInfo();
      this.#syncVaultSnapshot();
    } catch (error) {
      console.error('Failed to load vault info:', error);
    }
  }

  async loadSemanticStatus() {
    if (this.#semanticStatusRequest) {
      return this.#semanticStatusRequest;
    }

    this.#semanticStatusRequest = (async () => {
      try {
        await appStore.refreshSemanticStatus();
        this.#syncSemanticPolling();
      } catch (error) {
        console.error('Failed to load semantic status:', error);
      } finally {
        this.#semanticStatusRequest = null;
      }
    })();

    return this.#semanticStatusRequest;
  }

  loadSemanticState = async () => {
    if (this.#semanticStateRequest) {
      return this.#semanticStateRequest;
    }

    this.#semanticStateRequest = (async () => {
      const admission = appStore.beginSnapshotAdmission('vault', 'semanticStatus');
      try {
        const view = await loadSettingsViewSlice();
        appStore.admitSnapshot(
          { vault: view.vault, semanticStatus: view.semanticStatus },
          admission
        );
        this.semanticSettings = view.semanticSettings;
        this.semanticDebug = view.semanticDebug;
        this.historyHealth = view.historyHealth;
        this.#syncVaultSnapshot();
        this.settingsLoadError = null;
        this.#syncSemanticPolling();
      } catch (error) {
        console.error('Failed to load semantic settings:', error);
        this.settingsLoadError = String(error);
      } finally {
        this.#semanticStateRequest = null;
      }
    })();

    return this.#semanticStateRequest;
  };

  loadForgottenNotes = async () => {
    if (this.#forgottenNotesRequest) {
      return this.#forgottenNotesRequest;
    }

    this.isLoadingForgottenNotes = true;
    const missingNotesGeneration = ++this.#missingNotesGeneration;

    this.#forgottenNotesRequest = (async () => {
      try {
        const [forgottenNotes, missingNotes] = await Promise.all([
          loadForgottenNotesSlice(),
          loadMissingNotesSlice()
        ]);
        this.forgottenNotes = forgottenNotes;
        if (missingNotesGeneration === this.#missingNotesGeneration) {
          this.missingNotes = missingNotes;
        }
        this.selectedForgottenPaths = this.selectedForgottenPaths.filter((path) =>
          forgottenNotes.some((note) => note.forgottenPath === path)
        );
      } catch (error) {
        console.error('Failed to load forgotten notes:', error);
      } finally {
        this.#forgottenNotesRequest = null;
        this.isLoadingForgottenNotes = false;
      }
    })();

    return this.#forgottenNotesRequest;
  };

  loadHistoryHealth = async () => {
    try {
      this.historyHealth = await loadHistoryHealthSlice();
      this.historyActionError = null;
    } catch (error) {
      console.error('Failed to load history health:', error);
      this.historyActionError = historyCommandMessage(error);
    }
  };

  retryHistory = async () => {
    this.isRunningHistoryAction = true;
    this.historyActionError = null;
    try {
      this.historyHealth = await retryHistoryRecovery();
    } catch (error) {
      console.error('Failed to retry history recovery:', error);
      this.historyActionError = historyCommandMessage(error);
    } finally {
      this.isRunningHistoryAction = false;
    }
  };

  resetCorruptHistory = async () => {
    this.isRunningHistoryAction = true;
    this.historyActionError = null;
    try {
      await requestCorruptHistoryReset();
      this.historyHealth = await loadHistoryHealthSlice();
    } catch (error) {
      console.error('Failed to reset corrupt history:', error);
      this.historyActionError = historyCommandMessage(error);
    } finally {
      this.isRunningHistoryAction = false;
    }
  };

  clearVaultHistory = async () => {
    this.isRunningHistoryAction = true;
    this.historyActionError = null;
    try {
      await requestVaultHistoryClear();
    } catch (error) {
      console.error('Failed to clear vault history:', error);
      this.historyActionError = historyCommandMessage(error);
      this.isRunningHistoryAction = false;
      return;
    }

    try {
      this.historyHealth = await loadHistoryHealthSlice();
    } catch (error) {
      console.error('Vault history was cleared, but storage reporting could not refresh:', error);
      this.historyActionError = `Vault history was cleared, but storage reporting could not refresh: ${historyCommandMessage(error)}`;
    } finally {
      this.isRunningHistoryAction = false;
    }
  };

  runForgottenAction = async (command: ForgottenAction, forgottenPaths: string[]) => {
    if (forgottenPaths.length === 0) return;

    this.isUpdatingForgottenNotes = true;
    this.forgottenActionMessage = null;
    this.forgottenActionError = null;
    try {
      let restored: RestoredForgottenNote[] = [];
      if (command === 'restore_forgotten_notes') {
        restored =
          (await invoke<RestoredForgottenNote[]>(command, { forgottenPaths })) ?? [];
      } else {
        await invoke(command, { forgottenPaths });
      }
      for (const note of restored) {
        if (note.commitWarning) {
          console.warn(
            'Forgotten item was recovered with incomplete timeline synchronization:',
            note.commitWarning
          );
          this.forgottenActionMessage = note.commitWarning.message;
        }
      }
      this.setSelectedForgottenPaths((current) =>
        current.filter((path) => !forgottenPaths.includes(path))
      );
      await this.loadForgottenNotes();
    } catch (error) {
      console.error(`Failed to run ${command}:`, error);
      this.forgottenActionError = String(error);
    } finally {
      this.isUpdatingForgottenNotes = false;
    }
  };

  recoverMissingNote = async (noteId: string) => {
    this.isUpdatingMissingNotes = true;
    this.missingActionMessage = null;
    this.missingActionError = null;
    try {
      const recovered = await invokeHistoryCommand<RecoveredMissingNote>(
        'recover_missing_note',
        { noteId }
      );
      if (recovered.commitWarning) {
        console.warn(
          'Missing Note was recovered with incomplete timeline synchronization:',
          recovered.commitWarning
        );
      }
      this.missingActionMessage =
        recovered.commitWarning?.message ?? `Recovered Missing Note to ${recovered.restoredPath}.`;
      await this.loadForgottenNotes();
    } catch (error) {
      console.error('Failed to recover Missing Note:', error);
      this.missingActionError = historyCommandMessage(error);
      await this.loadForgottenNotes();
    } finally {
      this.isUpdatingMissingNotes = false;
    }
  };

  loadMoreMissingNoteHistory = async (noteId: string) => {
    const missing = this.missingNotes.find((note) => note.noteId === noteId);
    const cursor = missing?.timeline.nextCursor;
    if (!missing || !cursor || this.loadingMissingTimelineNoteId) return;

    this.loadingMissingTimelineNoteId = noteId;
    const missingNotesGeneration = this.#missingNotesGeneration;
    this.missingActionError = null;
    try {
      const page = await loadMissingNoteTimelinePage(noteId, cursor);
      if (missingNotesGeneration !== this.#missingNotesGeneration) return;
      const current = this.missingNotes.find((note) => note.noteId === noteId);
      if (!current || current.timeline.nextCursor !== cursor) return;
      const recordsById = new Map(
        current.timeline.records.map((record) => [record.recordId, record])
      );
      for (const record of page.records) recordsById.set(record.recordId, record);
      const timeline = {
        records: [...recordsById.values()].sort(compareHistoryRecordsNewestFirst),
        nextCursor: page.nextCursor
      };
      this.missingNotes = this.missingNotes.map((note) =>
        note.noteId === noteId ? { ...note, timeline } : note
      );
    } catch (error) {
      if (missingNotesGeneration !== this.#missingNotesGeneration) return;
      console.error('Failed to load older Missing Note history:', error);
      this.missingActionError = historyCommandMessage(error);
    } finally {
      this.loadingMissingTimelineNoteId = null;
    }
  };

  deleteMissingNote = async (noteId: string) => {
    this.isUpdatingMissingNotes = true;
    this.missingActionMessage = null;
    this.missingActionError = null;
    try {
      await invokeHistoryCommand<void>('delete_missing_notes', { noteIds: [noteId] });
      this.missingActionMessage = 'Missing Note timeline permanently deleted.';
      await this.loadForgottenNotes();
    } catch (error) {
      console.error('Failed to permanently delete Missing Note:', error);
      this.missingActionError = historyCommandMessage(error);
    } finally {
      this.isUpdatingMissingNotes = false;
    }
  };

  toggleForgottenSelection = (forgottenPath: string, checked: boolean) => {
    this.setSelectedForgottenPaths((current) =>
      checked
        ? Array.from(new Set([...current, forgottenPath]))
        : current.filter((path) => path !== forgottenPath)
    );
  };

  toggleAllForgottenSelections = (checked: boolean) => {
    this.setSelectedForgottenPaths(
      checked ? this.forgottenNotes.map((note) => note.forgottenPath) : []
    );
  };

  async saveSettings() {
    if (!this.semanticSettings) return;

    this.isSaving = true;
    try {
      this.semanticSettings = await invoke<SemanticSettings>('set_semantic_settings', {
        settings: this.semanticSettings
      });
      await this.loadSemanticState();
    } catch (error) {
      console.error('Failed to save semantic settings:', error);
    } finally {
      this.isSaving = false;
    }
  }

  updateSetting = <Key extends keyof SemanticSettings>(
    key: Key,
    value: SemanticSettings[Key]
  ) => {
    if (!this.semanticSettings) {
      return;
    }

    this.semanticSettings = {
      ...this.semanticSettings,
      [key]: value
    };
    void this.saveSettings();
  };

  runAction = async (command: SemanticAction) => {
    this.isRunningAction = true;
    this.semanticLayerError = null;
    this.semanticLayerMessage = null;
    try {
      if (command === 'retry_semantic_index') {
        await retrySemanticIndex();
      } else {
        await invoke(command);
      }
      await this.loadSemanticState();
    } catch (error) {
      console.error(`Failed to run ${command}:`, error);
      this.semanticLayerError = String(error);
      this.semanticLayerMessage = null;
    } finally {
      this.isRunningAction = false;
    }
  };

  downloadEmbeddingModel = async () => {
    if (this.isRunningAction) return;
    this.isRunningAction = true;
    this.semanticLayerError = null;
    this.semanticLayerMessage = null;
    try {
      this.semanticLayerMessage = 'Setting up local search… Downloading any missing files. You can keep using the app.';
      await invoke<SemanticModelDownloadResult>(
        'download_semantic_embedding_model'
      );
      this.semanticLayerMessage = 'Starting local search… The first load can take a few minutes.';
      await invoke('prepare_semantic_model');
      await retrySemanticIndex();
      this.semanticLayerMessage = 'Local search is set up. Your notes will now be indexed.';
      this.semanticLayerError = null;
      await this.loadSemanticState();
    } catch (error) {
      console.error('Failed to download embedding model:', error);
      this.semanticLayerError = String(error);
      this.semanticLayerMessage = null;
    } finally {
      this.isRunningAction = false;
    }
  };

  clearDebugMetrics = async () => {
    try {
      await invoke('clear_semantic_debug_metrics');
      await this.loadSemanticState();
    } catch (error) {
      console.error('Failed to clear semantic debug metrics:', error);
    }
  };

  clearAtlasCache = async () => {
    this.isRunningAction = true;
    this.semanticLayerError = null;
    this.semanticLayerMessage = null;
    try {
      await invoke('clear_atlas_cache');
      atlasStore.invalidateCachedResponse();
      this.semanticLayerMessage =
        'Map cache cleared. Re-open Map to run a full cold generation.';
      this.semanticLayerError = null;
    } catch (error) {
      console.error('Failed to clear atlas cache:', error);
      this.semanticLayerError = String(error);
      this.semanticLayerMessage = null;
    } finally {
      this.isRunningAction = false;
    }
  };

  async saveVaultDirectory() {
    const operation = ++this.#vaultSaveGeneration;
    const admission = appStore.beginSnapshotAdmission('vault');
    this.isSavingVault = true;
    this.vaultSaveError = null;
    try {
      const nextVaultInfo = await invoke<VaultInfo>('set_vault_directory', {
        path: this.vaultPathInput.trim() === '' ? null : this.vaultPathInput.trim()
      });
      if (operation !== this.#vaultSaveGeneration) return;
      const admitted = appStore.admitSnapshot({ vault: nextVaultInfo }, admission).vault;
      this.#syncVaultSnapshot(
        admitted || this.vaultInfo?.selectedPath === nextVaultInfo.selectedPath
      );
    } catch (error) {
      if (operation !== this.#vaultSaveGeneration) return;
      console.error('Failed to save vault directory:', error);
      this.vaultSaveError = String(error);
    } finally {
      if (operation === this.#vaultSaveGeneration) this.isSavingVault = false;
    }
  }

  async handleVisibilityChange() {
    if (document.visibilityState === 'visible') {
      await refreshSettingsForVisibility(this.activeGeneralSection, {
        loadSemanticState: () => this.loadSemanticState(),
        loadSemanticStatus: () => this.loadSemanticStatus(),
        loadVaultInfo: () => this.loadVaultInfo(),
        loadForgottenNotes: () => this.loadForgottenNotes()
      });
      this.#syncSemanticPolling();
      return;
    }

    this.#stopSemanticPolling();
  }

  #scheduleVaultChangeRefresh(delayMs = 350) {
    if (this.#vaultChangeRefreshTimer) {
      window.clearTimeout(this.#vaultChangeRefreshTimer);
    }

    this.#vaultChangeRefreshTimer = window.setTimeout(() => {
      this.#vaultChangeRefreshTimer = null;
      void refreshSettingsAfterVaultChange({
        loadSemanticStatus: () => this.loadSemanticStatus(),
        loadVaultInfo: () => this.loadVaultInfo(),
        loadForgottenNotes: () => this.loadForgottenNotes()
      });
      void this.loadHistoryHealth();
    }, delayMs);
  }

  async initialize() {
    try {
      await appStore.bootstrap();
    } catch (error) {
      this.settingsLoadError = String(error);
      return;
    }
    this.#syncVaultSnapshot();
    this.#disposeVaultNoteChanged?.();
    this.#disposeSemanticStatus?.();
    this.#disposeVaultChanged?.();
    this.#disposeVaultNoteChanged = appStore.subscribeVaultNoteChanged((payload) => {
      if (payload.documentKind && payload.documentKind !== 'note') return;
      this.#scheduleVaultChangeRefresh();
    });
    // Backend pushes `semantic-status-changed` after mutations (settings
    // save, rebuild/pause/resume, vault change). Reduce to listening
    // instead of polling those code paths; we still poll while indexing
    // is in progress because background workers don't currently emit.
    this.#disposeSemanticStatus = appStore.subscribeSemanticStatusChanged(() => {
      this.#syncSemanticPolling();
    });
    this.#disposeVaultChanged = appStore.subscribeVaultChanged(() => {
      this.#syncVaultSnapshot();
    });
    await Promise.all([this.loadSemanticState(), this.loadForgottenNotes()]);
  }

  dispose() {
    this.#stopSemanticPolling();
    if (this.#vaultChangeRefreshTimer) {
      window.clearTimeout(this.#vaultChangeRefreshTimer);
      this.#vaultChangeRefreshTimer = null;
    }
    this.#disposeVaultNoteChanged?.();
    this.#disposeVaultNoteChanged = null;
    this.#disposeSemanticStatus?.();
    this.#disposeSemanticStatus = null;
    this.#disposeVaultChanged?.();
    this.#disposeVaultChanged = null;
  }
}

export function createSettingsStore() {
  return new SettingsStore();
}
