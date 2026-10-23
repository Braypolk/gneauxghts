import { invoke } from '@tauri-apps/api/core';
import {
  historyCommandMessage,
  invokeHistoryCommand
} from '#lib/contracts/historyCommand.js';
import { open } from '@tauri-apps/plugin-dialog';
import { appStore, type AppStore } from '#lib/app/appStore.svelte.js';
import { restartLifecycle } from '#lib/app/restartLifecycle.svelte.js';
import { atlasStore } from '#lib/features/atlas/atlasStore.svelte.js';
import type {
  ForgottenNoteSummary,
  RestoredForgottenNote
} from '#lib/types/forgottenNotes.js';
import type { MissingNoteSummary, RecoveredMissingNote } from '#lib/types/missingNotes.js';
import { compareHistoryRecordsNewestFirst, type HistoryModePage } from '#lib/features/history/historyModeMachine.js';
import type { CreateVaultFolderResult, VaultFolderInfo, VaultInfo } from '#lib/types/vault.js';
import type { HistoryHealthReport } from '#lib/types/history.js';
import type {
  SemanticDebugSnapshot,
  SemanticModelDownloadResult,
  SemanticSettings,
  SemanticStatus
} from '#lib/types/semantic.js';
import {
  clearVaultHistory as requestVaultHistoryClear,
  loadHistoryHealthSlice,
  resetCorruptHistory as requestCorruptHistoryReset,
  retryHistoryRecovery
} from './loaders/historyLoader';

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
  constructor(private readonly app: AppStore = appStore) {}
  #lifetime = 0;
  #disposed = false;
  #initialization: Promise<void> | null = null;
  #historyRevision = 0;
  #settingsRevision = 0;
  #settingsWrites: Promise<void> = Promise.resolve();

  semanticSettings = $state<SemanticSettings | null>(null);
  semanticDebug = $state<SemanticDebugSnapshot | null>(null);
  settingsLoadError = $state<string | null>(null);
  historyHealth = $state<HistoryHealthReport | null>(null);
  historyActionError = $state<string | null>(null);
  isLoadingHistoryHealth = $state(false);
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
  isSettingUpLocalSearch = $state(false);
  semanticLayerError = $state<string | null>(null);
  semanticLayerMessage = $state<string | null>(null);

  #semanticPollTimer: number | null = null;
  #semanticPollInterval = 0;
  #vaultChangeRefreshTimer: number | null = null;
  #semanticStatusRequest: Promise<void> | null = null;
  #semanticStateRequest: Promise<void> | null = null;
  #historyHealthRequest: Promise<void> | null = null;
  #forgottenNotesRequest: Promise<void> | null = null;
  #missingNotesGeneration = 0;
  #vaultSaveGeneration = 0;
  #disposeVaultNoteChanged: (() => void) | null = null;
  #disposeSemanticStatus: (() => void) | null = null;
  #disposeVaultChanged: (() => void) | null = null;

  get semanticStatus(): SemanticStatus | null {
    return this.app.semanticStatus;
  }

  get vaultInfo(): VaultInfo | null {
    return this.app.vaultInfo;
  }

  get usesVaultContainer() {
    return this.vaultInfo != null && this.vaultInfo.canPickArbitraryPath === false;
  }

  get canRelaunch() {
    return this.vaultInfo?.canRelaunch === true;
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
    if (this.#disposed) return;
    const lifetime = this.#lifetime;
    if (this.vaultInfo?.canPickArbitraryPath !== false) {
      this.vaultFolders = [];
      return;
    }

    this.isLoadingVaultFolders = true;
    try {
      const folders = await invoke<VaultFolderInfo[]>('list_vault_folders');
      if (lifetime !== this.#lifetime) return;
      this.vaultFolders = folders;
    } catch (error) {
      if (lifetime !== this.#lifetime) return;
      console.error('Failed to list vault folders:', error);
      this.vaultSaveError = String(error);
    } finally {
      if (lifetime !== this.#lifetime) return;
      this.isLoadingVaultFolders = false;
    }
  }

  selectVaultFolder(path: string) {
    this.setVaultPathInput(path);
  }

  async createVaultFolder() {
    if (this.#disposed) return;
    const lifetime = this.#lifetime;
    const name = this.newVaultName.trim();
    if (name === '') {
      this.vaultSaveError = 'Enter a vault name.';
      return;
    }

    this.isCreatingVaultFolder = true;
    this.vaultSaveError = null;
    try {
      const result = await invoke<CreateVaultFolderResult>('create_vault_folder', { name });
      if (lifetime !== this.#lifetime) return;
      this.vaultFolders = result.folders;
      this.newVaultName = '';
      this.setVaultPathInput(result.createdPath);
    } catch (error) {
      if (lifetime !== this.#lifetime) return;
      console.error('Failed to create vault folder:', error);
      this.vaultSaveError = String(error);
    } finally {
      if (lifetime !== this.#lifetime) return;
      this.isCreatingVaultFolder = false;
    }
  }

  async pickVaultDirectory() {
    if (this.#disposed) return;
    const lifetime = this.#lifetime;
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
      if (lifetime !== this.#lifetime) return;
      if (typeof selected === 'string' && selected.trim() !== '') {
        this.vaultPathInput = selected;
      }
    } catch (error) {
      if (lifetime !== this.#lifetime) return;
      console.error('Failed to pick vault directory:', error);
      this.vaultSaveError = String(error);
    } finally {
      if (lifetime !== this.#lifetime) return;
      this.isPickingVault = false;
    }
  }

  async restartApp() {
    if (this.#disposed) return;
    if (!this.canRelaunch) {
      this.vaultSaveError = 'To open the selected vault, swipe Gneauxghts away in the App Switcher, then open it again. Returning to the Home Screen keeps the current vault open.';
      return;
    }
    const lifetime = this.#lifetime;
    await restartLifecycle.restart();
    if (lifetime === this.#lifetime) this.vaultSaveError = restartLifecycle.error;
  }

  #stopSemanticPolling() {
    if (this.#semanticPollTimer) {
      window.clearInterval(this.#semanticPollTimer);
      this.#semanticPollTimer = null;
    }
  }

  #shouldPollSemanticState() {
    return Boolean(
      this.semanticStatus?.indexingInProgress || this.isRunningAction || this.isSaving ||
      (this.semanticStatus?.setupProgress && !['complete', 'failed'].includes(this.semanticStatus.setupProgress.phase))
    );
  }

  #syncSemanticPolling() {
    if (this.#disposed) return;
    if (typeof document === 'undefined' || document.visibilityState !== 'visible') {
      this.#stopSemanticPolling();
      return;
    }

    if (!this.#shouldPollSemanticState()) {
      this.#stopSemanticPolling();
      return;
    }

    const setup = this.semanticStatus?.setupProgress;
    const interval = this.isSettingUpLocalSearch || (setup && !['complete', 'failed'].includes(setup.phase)) ? 1000 : 5000;
    if (this.#semanticPollTimer && this.#semanticPollInterval === interval) return;
    this.#stopSemanticPolling();
    this.#semanticPollInterval = interval;

    this.#semanticPollTimer = window.setInterval(() => {
      void this.loadSemanticStatus();
    }, interval);
  }

  async loadVaultInfo() {
    if (this.#disposed) return;
    const lifetime = this.#lifetime;
    try {
      await this.app.refreshVaultInfo();
      if (lifetime !== this.#lifetime) return;
      this.#syncVaultSnapshot();
    } catch (error) {
      console.error('Failed to load vault info:', error);
    }
  }

  async loadSemanticStatus() {
    if (this.#disposed) return;
    const lifetime = this.#lifetime;
    if (this.#semanticStatusRequest) {
      return this.#semanticStatusRequest;
    }

    this.#semanticStatusRequest = (async () => {
      try {
        await this.app.refreshSemanticStatus();
        this.#syncSemanticPolling();
      } catch (error) {
        console.error('Failed to load semantic status:', error);
      } finally {
        if (lifetime === this.#lifetime) this.#semanticStatusRequest = null;
      }
    })();

    return this.#semanticStatusRequest;
  }

  loadSemanticState = async () => {
    if (this.#disposed) return;
    const lifetime = this.#lifetime;
    const settingsRevision = this.#settingsRevision;
    const settingsWritePending = this.isSaving;
    if (this.#semanticStateRequest) {
      return this.#semanticStateRequest;
    }

    this.#semanticStateRequest = (async () => {
      try {
        const view = await this.app.loadSettingsView();
        if (lifetime !== this.#lifetime) return;
        if (!settingsWritePending && !this.isSaving && settingsRevision === this.#settingsRevision) this.semanticSettings = view.semanticSettings;
        this.semanticDebug = view.semanticDebug;
        this.#syncVaultSnapshot();
        this.settingsLoadError = null;
        this.#syncSemanticPolling();
      } catch (error) {
        if (lifetime !== this.#lifetime) return;
        console.error('Failed to load semantic settings:', error);
        this.settingsLoadError = String(error);
      } finally {
        if (lifetime === this.#lifetime) this.#semanticStateRequest = null;
      }
    })();

    return this.#semanticStateRequest;
  };

  loadForgottenNotes = async () => {
    if (this.#disposed) return;
    const lifetime = this.#lifetime;
    if (this.#forgottenNotesRequest) {
      return this.#forgottenNotesRequest;
    }

    this.isLoadingForgottenNotes = true;
    const missingNotesGeneration = ++this.#missingNotesGeneration;
    this.loadingMissingTimelineNoteId = null;

    this.#forgottenNotesRequest = (async () => {
      try {
        const [forgottenNotes, missingNotes] = await Promise.all([
          invoke<ForgottenNoteSummary[]>('list_forgotten_notes'),
          invokeHistoryCommand<MissingNoteSummary[]>('list_missing_notes')
        ]);
        if (lifetime !== this.#lifetime || missingNotesGeneration !== this.#missingNotesGeneration) return;
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
        if (lifetime === this.#lifetime && missingNotesGeneration === this.#missingNotesGeneration) {
          this.#forgottenNotesRequest = null;
          this.isLoadingForgottenNotes = false;
        }
      }
    })();

    return this.#forgottenNotesRequest;
  };

  loadHistoryHealth = async () => {
    if (this.#disposed || this.isRunningHistoryAction) return;
    if (this.#historyHealthRequest) return this.#historyHealthRequest;
    const revision = ++this.#historyRevision;
    this.isLoadingHistoryHealth = true;
    this.historyActionError = null;
    const request = (async () => {
      try {
        const health = await loadHistoryHealthSlice();
        if (revision !== this.#historyRevision) return;
        this.historyHealth = health;
      } catch (error) {
        if (revision !== this.#historyRevision) return;
        console.error('Failed to load history health:', error);
        this.historyActionError = historyCommandMessage(error);
      } finally {
        if (revision === this.#historyRevision) {
          this.#historyHealthRequest = null;
          this.isLoadingHistoryHealth = false;
        }
      }
    })();
    this.#historyHealthRequest = request;
    return request;
  };

  #beginHistoryAction() {
    if (this.#disposed || this.isRunningHistoryAction) return null;
    const revision = ++this.#historyRevision;
    this.#historyHealthRequest = null;
    this.isLoadingHistoryHealth = false;
    this.isRunningHistoryAction = true;
    this.historyActionError = null;
    return revision;
  }

  retryHistory = async () => {
    const revision = this.#beginHistoryAction();
    if (revision === null) return;
    try {
      const health = await retryHistoryRecovery();
      if (revision !== this.#historyRevision) return;
      this.historyHealth = health;
    } catch (error) {
      if (revision !== this.#historyRevision) return;
      console.error('Failed to retry history recovery:', error);
      this.historyActionError = historyCommandMessage(error);
    } finally {
      if (revision === this.#historyRevision) this.isRunningHistoryAction = false;
    }
  };

  resetCorruptHistory = async () => {
    const revision = this.#beginHistoryAction();
    if (revision === null) return;
    try {
      await requestCorruptHistoryReset();
      if (revision !== this.#historyRevision) return;
      const health = await loadHistoryHealthSlice();
      if (revision !== this.#historyRevision) return;
      this.historyHealth = health;
    } catch (error) {
      if (revision !== this.#historyRevision) return;
      console.error('Failed to reset corrupt history:', error);
      this.historyActionError = historyCommandMessage(error);
    } finally {
      if (revision === this.#historyRevision) this.isRunningHistoryAction = false;
    }
  };

  clearVaultHistory = async () => {
    const revision = this.#beginHistoryAction();
    if (revision === null) return;
    try {
      await requestVaultHistoryClear();
      if (revision !== this.#historyRevision) return;
    } catch (error) {
      if (revision !== this.#historyRevision) return;
      console.error('Failed to clear vault history:', error);
      this.historyActionError = historyCommandMessage(error);
      if (revision === this.#historyRevision) this.isRunningHistoryAction = false;
      return;
    }

    try {
      const health = await loadHistoryHealthSlice();
      if (revision !== this.#historyRevision) return;
      this.historyHealth = health;
    } catch (error) {
      if (revision !== this.#historyRevision) return;
      console.error('Vault history was cleared, but storage reporting could not refresh:', error);
      this.historyActionError = `Vault history was cleared, but storage reporting could not refresh: ${historyCommandMessage(error)}`;
    } finally {
      if (revision === this.#historyRevision) this.isRunningHistoryAction = false;
    }
  };

  async #refreshForgottenAfterMutation() {
    this.#missingNotesGeneration += 1;
    this.#forgottenNotesRequest = null;
    this.loadingMissingTimelineNoteId = null;
    await this.loadForgottenNotes();
  }

  runForgottenAction = async (command: ForgottenAction, forgottenPaths: string[]) => {
    if (this.#disposed) return;
    const lifetime = this.#lifetime;
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
      if (lifetime !== this.#lifetime) return;
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
      await this.#refreshForgottenAfterMutation();
    } catch (error) {
      if (lifetime !== this.#lifetime) return;
      console.error(`Failed to run ${command}:`, error);
      this.forgottenActionError = String(error);
    } finally {
      if (lifetime !== this.#lifetime) return;
      this.isUpdatingForgottenNotes = false;
    }
  };

  recoverMissingNote = async (noteId: string) => {
    if (this.#disposed) return;
    const lifetime = this.#lifetime;
    this.isUpdatingMissingNotes = true;
    this.missingActionMessage = null;
    this.missingActionError = null;
    try {
      const recovered = await invokeHistoryCommand<RecoveredMissingNote>(
        'recover_missing_note',
        { noteId }
      );
      if (lifetime !== this.#lifetime) return;
      if (recovered.commitWarning) {
        console.warn(
          'Missing Note was recovered with incomplete timeline synchronization:',
          recovered.commitWarning
        );
      }
      this.missingActionMessage =
        recovered.commitWarning?.message ?? `Recovered Missing Note to ${recovered.restoredPath}.`;
      await this.#refreshForgottenAfterMutation();
    } catch (error) {
      if (lifetime !== this.#lifetime) return;
      console.error('Failed to recover Missing Note:', error);
      this.missingActionError = historyCommandMessage(error);
      await this.#refreshForgottenAfterMutation();
    } finally {
      if (lifetime !== this.#lifetime) return;
      this.isUpdatingMissingNotes = false;
    }
  };

  loadMoreMissingNoteHistory = async (noteId: string) => {
    if (this.#disposed) return;
    const missing = this.missingNotes.find((note) => note.noteId === noteId);
    const cursor = missing?.timeline.nextCursor;
    if (!missing || !cursor || this.loadingMissingTimelineNoteId) return;

    this.loadingMissingTimelineNoteId = noteId;
    const missingNotesGeneration = this.#missingNotesGeneration;
    this.missingActionError = null;
    try {
      const page = await invokeHistoryCommand<HistoryModePage>('get_missing_note_history_page', {
        noteId, cursor, limit: 30
      });
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
      if (missingNotesGeneration === this.#missingNotesGeneration) this.loadingMissingTimelineNoteId = null;
    }
  };

  deleteMissingNote = async (noteId: string) => {
    if (this.#disposed) return;
    const lifetime = this.#lifetime;
    this.isUpdatingMissingNotes = true;
    this.missingActionMessage = null;
    this.missingActionError = null;
    try {
      await invokeHistoryCommand<void>('delete_missing_notes', { noteIds: [noteId] });
      if (lifetime !== this.#lifetime) return;
      this.missingActionMessage = 'Missing Note timeline permanently deleted.';
      await this.#refreshForgottenAfterMutation();
    } catch (error) {
      if (lifetime !== this.#lifetime) return;
      console.error('Failed to permanently delete Missing Note:', error);
      this.missingActionError = historyCommandMessage(error);
    } finally {
      if (lifetime !== this.#lifetime) return;
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

  saveSettings() {
    if (!this.semanticSettings || this.#disposed) return Promise.resolve();
    const settings = { ...this.semanticSettings };
    const revision = ++this.#settingsRevision;
    const lifetime = this.#lifetime;
    this.isSaving = true;
    this.semanticLayerError = null;
    const write = this.#settingsWrites.catch(() => undefined).then(async () => {
      try {
        const saved = await invoke<SemanticSettings>('set_semantic_settings', { settings });
        if (lifetime !== this.#lifetime || revision !== this.#settingsRevision) return;
        this.semanticSettings = saved;
        await this.loadSemanticState();
      } catch (error) {
        if (lifetime !== this.#lifetime || revision !== this.#settingsRevision) return;
        console.error('Failed to save semantic settings:', error);
        this.semanticLayerError = String(error);
      } finally {
        if (lifetime === this.#lifetime && revision === this.#settingsRevision) this.isSaving = false;
      }
    });
    this.#settingsWrites = write;
    return write;
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
    if (this.#disposed) return;
    const lifetime = this.#lifetime;
    this.isRunningAction = true;
    this.semanticLayerError = null;
    this.semanticLayerMessage = null;
    try {
      await invoke(command);
      if (lifetime !== this.#lifetime) return;
      await this.loadSemanticState();
    } catch (error) {
      if (lifetime !== this.#lifetime) return;
      console.error(`Failed to run ${command}:`, error);
      this.semanticLayerError = String(error);
      this.semanticLayerMessage = null;
    } finally {
      if (lifetime !== this.#lifetime) return;
      this.isRunningAction = false;
    }
  };

  downloadEmbeddingModel = async () => {
    if (this.#disposed) return;
    const lifetime = this.#lifetime;
    if (this.isRunningAction) return;
    this.isRunningAction = true;
    this.isSettingUpLocalSearch = true;
    this.#syncSemanticPolling();
    this.semanticLayerError = null;
    this.semanticLayerMessage = null;
    try {
      this.semanticLayerMessage = 'Checking local search files… Setup progress appears below. You can keep using the app.';
      await invoke<SemanticModelDownloadResult>(
        'download_semantic_embedding_model'
      );
      if (lifetime !== this.#lifetime) return;
      this.semanticLayerMessage = 'Starting local search… The first load can take a few minutes.';
      await invoke('prepare_semantic_model');
      if (lifetime !== this.#lifetime) return;
      await invoke<void>('retry_semantic_index');
      if (lifetime !== this.#lifetime) return;
      this.semanticLayerMessage = 'Local search is set up. Your notes will now be indexed.';
      this.semanticLayerError = null;
      await this.loadSemanticState();
    } catch (error) {
      if (lifetime !== this.#lifetime) return;
      console.error('Failed to download embedding model:', error);
      this.semanticLayerError = String(error);
      this.semanticLayerMessage = null;
      await this.loadSemanticStatus();
    } finally {
      if (lifetime !== this.#lifetime) return;
      this.isRunningAction = false;
      this.isSettingUpLocalSearch = false;
      this.#syncSemanticPolling();
    }
  };

  clearDebugMetrics = async () => {
    if (this.#disposed) return;
    const lifetime = this.#lifetime;
    try {
      await invoke('clear_semantic_debug_metrics');
      if (lifetime !== this.#lifetime) return;
      await this.loadSemanticState();
    } catch (error) {
      console.error('Failed to clear semantic debug metrics:', error);
    }
  };

  clearAtlasCache = async () => {
    if (this.#disposed) return;
    const lifetime = this.#lifetime;
    this.isRunningAction = true;
    this.semanticLayerError = null;
    this.semanticLayerMessage = null;
    try {
      await atlasStore.clearCache();
      if (lifetime !== this.#lifetime) return;
      this.semanticLayerMessage =
        'Map cache cleared. Re-open Map to run a full cold generation.';
      this.semanticLayerError = null;
    } catch (error) {
      if (lifetime !== this.#lifetime) return;
      console.error('Failed to clear atlas cache:', error);
      this.semanticLayerError = String(error);
      this.semanticLayerMessage = null;
    } finally {
      if (lifetime !== this.#lifetime) return;
      this.isRunningAction = false;
    }
  };

  async saveVaultDirectory() {
    if (this.#disposed) return;
    const operation = ++this.#vaultSaveGeneration;
    this.isSavingVault = true;
    this.vaultSaveError = null;
    try {
      await this.app.stageVaultSelection(this.vaultPathInput.trim() || null);
      if (operation !== this.#vaultSaveGeneration) return;
      this.#syncVaultSnapshot(true);
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
      if (this.activeTab === 'forgotten') {
        await this.loadForgottenNotes();
      } else {
        switch (this.activeGeneralSection) {
          case 'search': await this.loadSemanticState(); break;
          case 'vault': await this.loadVaultInfo(); break;
          case 'forgetting': await this.loadForgottenNotes(); break;
          case 'history': await this.loadHistoryHealth(); break;
          default: await this.loadSemanticStatus();
        }
      }
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
      void this.loadSemanticStatus();
      void this.loadForgottenNotes();
      if (this.activeTab === 'general' && this.activeGeneralSection === 'history') {
        void this.loadHistoryHealth();
      }
    }, delayMs);
  }

  initialize() {
    if (this.#initialization) return this.#initialization;
    this.#disposed = false;
    this.#initialization = this.#initialize(this.#lifetime);
    return this.#initialization;
  }

  async #initialize(lifetime: number) {
    try {
      await this.app.bootstrap();
    } catch (error) {
      if (lifetime !== this.#lifetime) return;
      this.settingsLoadError = String(error);
      this.#initialization = null;
      return;
    }
    if (lifetime !== this.#lifetime) return;
    this.#syncVaultSnapshot();
    this.#disposeVaultNoteChanged?.();
    this.#disposeSemanticStatus?.();
    this.#disposeVaultChanged?.();
    this.#disposeVaultNoteChanged = this.app.subscribeVaultNoteChanged((payload) => {
      if (payload.documentKind && payload.documentKind !== 'note') return;
      this.#scheduleVaultChangeRefresh();
    });
    // Backend pushes `semantic-status-changed` after mutations (settings
    // save, rebuild/pause/resume, vault change). Reduce to listening
    // instead of polling those code paths; we still poll while indexing
    // is in progress because background workers don't currently emit.
    this.#disposeSemanticStatus = this.app.subscribeSemanticStatusChanged(() => {
      this.#syncSemanticPolling();
    });
    this.#disposeVaultChanged = this.app.subscribeVaultChanged(() => {
      this.#syncVaultSnapshot();
    });
    await Promise.all([this.loadSemanticState(), this.loadForgottenNotes()]);
  }

  dispose() {
    this.#disposed = true;
    this.#lifetime += 1;
    this.#historyRevision += 1;
    this.#settingsRevision += 1;
    this.#missingNotesGeneration += 1;
    this.#vaultSaveGeneration += 1;
    this.#initialization = null;
    this.#semanticStateRequest = null;
    this.#historyHealthRequest = null;
    this.isLoadingHistoryHealth = false;
    this.#semanticStatusRequest = null;
    this.#forgottenNotesRequest = null;
    this.isLoadingForgottenNotes = false;
    this.isRunningHistoryAction = false;
    this.isSaving = false;
    this.isSavingVault = false;
    this.isRunningAction = false;
    this.isSettingUpLocalSearch = false;
    this.isPickingVault = false;
    this.isLoadingVaultFolders = false;
    this.isCreatingVaultFolder = false;
    this.isUpdatingForgottenNotes = false;
    this.isUpdatingMissingNotes = false;
    this.loadingMissingTimelineNoteId = null;
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

export function createSettingsStore(app: AppStore = appStore) {
  return new SettingsStore(app);
}
