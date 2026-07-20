import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { relaunch } from '@tauri-apps/plugin-process';
import { appStore } from '$lib/app/appStore.svelte';
import { atlasStore } from '$lib/features/atlas/atlasStore.svelte';
import type { ForgottenNoteSummary } from '$lib/types/forgottenNotes';
import type { VaultInfo } from '$lib/types/vault';
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
import { loadForgottenNotesSlice } from './loaders/forgottenLoader';
import { loadSemanticSlice, loadSemanticStatusSlice } from './loaders/semanticLoader';
import { loadSettingsViewSlice } from './loaders/settingsViewLoader';
import { loadVaultInfoSlice } from './loaders/vaultLoader';

type SettingsTab = 'general' | 'forgotten';
type GeneralSection =
  | 'appearance'
  | 'shortcuts'
  | 'forgetting'
  | 'vault'
  | 'ai'
  | 'search';
type ForgottenAction = 'restore_forgotten_notes' | 'delete_forgotten_notes';
type SemanticAction =
  | 'rebuild_semantic_index'
  | 'pause_semantic_indexing'
  | 'resume_semantic_indexing'
  | 'prepare_semantic_model';

export type { GeneralSection, SettingsTab };

export class SettingsStore {
  semanticStatus = $state<SemanticStatus | null>(null);
  semanticSettings = $state<SemanticSettings | null>(null);
  semanticDebug = $state<SemanticDebugSnapshot | null>(null);
  vaultInfo = $state<VaultInfo | null>(null);
  vaultPathInput = $state('');
  activeVaultPath = $state('');
  vaultSaveError = $state<string | null>(null);
  isSavingVault = $state(false);
  isPickingVault = $state(false);
  isRestarting = $state(false);
  activeTab = $state<SettingsTab>('general');
  activeGeneralSection = $state<GeneralSection>('appearance');
  forgottenNotes = $state<ForgottenNoteSummary[]>([]);
  selectedForgottenPaths = $state<string[]>([]);
  isLoadingForgottenNotes = $state(false);
  isUpdatingForgottenNotes = $state(false);
  isSaving = $state(false);
  isRunningAction = $state(false);
  semanticLayerError = $state<string | null>(null);
  semanticLayerMessage = $state<string | null>(null);

  #semanticPollTimer: number | null = null;
  #vaultChangeRefreshTimer: number | null = null;
  #semanticStatusRequest: Promise<void> | null = null;
  #semanticStateRequest: Promise<void> | null = null;
  #forgottenNotesRequest: Promise<void> | null = null;
  #disposeVaultNoteChanged: (() => void) | null = null;
  #disposeSemanticStatus: (() => void) | null = null;

  setActiveTab(activeTab: SettingsTab) {
    this.activeTab = activeTab;
  }

  setActiveGeneralSection(activeGeneralSection: GeneralSection) {
    this.activeGeneralSection = activeGeneralSection;
  }

  setVaultPathInput(vaultPathInput: string) {
    this.vaultPathInput = vaultPathInput;
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

  #applyVaultInfo(nextVaultInfo: VaultInfo, resetInput = false) {
    this.vaultInfo = nextVaultInfo;
    this.vaultPathInput = resetInput
      ? nextVaultInfo.currentPath
      : this.vaultPathInput.trim() === ''
        ? nextVaultInfo.currentPath
        : this.vaultPathInput;
    this.activeVaultPath =
      this.activeVaultPath === '' ? nextVaultInfo.currentPath : this.activeVaultPath;
    this.vaultSaveError = null;
  }

  async pickVaultDirectory() {
    if (!(this.vaultInfo?.canConfigurePath ?? true)) {
      return;
    }

    this.isPickingVault = true;
    this.vaultSaveError = null;
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        defaultPath: this.vaultPathInput.trim() || this.vaultInfo?.currentPath || undefined,
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
    this.isRestarting = true;
    try {
      await relaunch();
    } catch (error) {
      console.error('Failed to restart app:', error);
      this.vaultSaveError = String(error);
      this.isRestarting = false;
    }
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
      this.#applyVaultInfo(await loadVaultInfoSlice());
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
        this.semanticStatus = await loadSemanticStatusSlice();
        this.#syncSemanticPolling();
      } catch (error) {
        console.error('Failed to load semantic status:', error);
      } finally {
        this.#semanticStatusRequest = null;
      }
    })();

    return this.#semanticStatusRequest;
  }

  async loadSemanticState() {
    if (this.#semanticStateRequest) {
      return this.#semanticStateRequest;
    }

    this.#semanticStateRequest = (async () => {
      try {
        // Prefer the bundled get_settings_view command which collapses
        // the four parallel invokes into one. Fall back to the legacy
        // parallel fan-out if the bundled command errors so the
        // settings panel keeps working.
        try {
          const view = await loadSettingsViewSlice();
          this.semanticStatus = view.semanticStatus;
          this.semanticSettings = view.semanticSettings;
          this.semanticDebug = view.semanticDebug;
          this.#applyVaultInfo(view.vault);
        } catch (bundledError) {
          console.warn(
            'get_settings_view failed, falling back to individual loads:',
            bundledError
          );
          const [semantic, nextVaultInfo] = await Promise.all([
            loadSemanticSlice(),
            loadVaultInfoSlice()
          ]);
          this.semanticStatus = semantic.status;
          this.semanticSettings = semantic.settings;
          this.semanticDebug = semantic.debug;
          this.#applyVaultInfo(nextVaultInfo);
        }
        this.#syncSemanticPolling();
      } catch (error) {
        console.error('Failed to load semantic settings:', error);
      } finally {
        this.#semanticStateRequest = null;
      }
    })();

    return this.#semanticStateRequest;
  }

  async loadForgottenNotes() {
    if (this.#forgottenNotesRequest) {
      return this.#forgottenNotesRequest;
    }

    this.isLoadingForgottenNotes = true;

    this.#forgottenNotesRequest = (async () => {
      try {
        const forgottenNotes = await loadForgottenNotesSlice();
        this.forgottenNotes = forgottenNotes;
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
  }

  async runForgottenAction(command: ForgottenAction, forgottenPaths: string[]) {
    if (forgottenPaths.length === 0) return;

    this.isUpdatingForgottenNotes = true;
    try {
      await invoke(command, { forgottenPaths });
      this.setSelectedForgottenPaths((current) =>
        current.filter((path) => !forgottenPaths.includes(path))
      );
      await this.loadForgottenNotes();
    } catch (error) {
      console.error(`Failed to run ${command}:`, error);
    } finally {
      this.isUpdatingForgottenNotes = false;
    }
  }

  toggleForgottenSelection(forgottenPath: string, checked: boolean) {
    this.setSelectedForgottenPaths((current) =>
      checked
        ? Array.from(new Set([...current, forgottenPath]))
        : current.filter((path) => path !== forgottenPath)
    );
  }

  toggleAllForgottenSelections(checked: boolean) {
    this.setSelectedForgottenPaths(
      checked ? this.forgottenNotes.map((note) => note.forgottenPath) : []
    );
  }

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

  updateSetting<Key extends keyof SemanticSettings>(key: Key, value: SemanticSettings[Key]) {
    if (!this.semanticSettings) {
      return;
    }

    this.semanticSettings = {
      ...this.semanticSettings,
      [key]: value
    };
    void this.saveSettings();
  }

  async runAction(command: SemanticAction) {
    this.isRunningAction = true;
    this.semanticLayerError = null;
    this.semanticLayerMessage = null;
    try {
      await invoke(command);
      await this.loadSemanticState();
    } catch (error) {
      console.error(`Failed to run ${command}:`, error);
      this.semanticLayerError = String(error);
      this.semanticLayerMessage = null;
    } finally {
      this.isRunningAction = false;
    }
  }

  async downloadEmbeddingModel() {
    this.isRunningAction = true;
    this.semanticLayerError = null;
    this.semanticLayerMessage = null;
    try {
      const result = await invoke<SemanticModelDownloadResult>(
        'download_semantic_embedding_model'
      );
      this.semanticLayerMessage = result.alreadyPresent
        ? 'Embedding model is already installed.'
        : 'Embedding model downloaded successfully.';
      this.semanticLayerError = null;
      await this.loadSemanticState();
    } catch (error) {
      console.error('Failed to download embedding model:', error);
      this.semanticLayerError = String(error);
      this.semanticLayerMessage = null;
    } finally {
      this.isRunningAction = false;
    }
  }

  async clearDebugMetrics() {
    try {
      await invoke('clear_semantic_debug_metrics');
      await this.loadSemanticState();
    } catch (error) {
      console.error('Failed to clear semantic debug metrics:', error);
    }
  }

  async clearAtlasCache() {
    this.isRunningAction = true;
    this.semanticLayerError = null;
    this.semanticLayerMessage = null;
    try {
      await invoke('clear_atlas_cache');
      atlasStore.invalidateCachedResponse();
      this.semanticLayerMessage =
        'Atlas cache cleared. Re-open Atlas to run a full cold generation.';
      this.semanticLayerError = null;
    } catch (error) {
      console.error('Failed to clear atlas cache:', error);
      this.semanticLayerError = String(error);
      this.semanticLayerMessage = null;
    } finally {
      this.isRunningAction = false;
    }
  }

  async saveVaultDirectory() {
    this.isSavingVault = true;
    this.vaultSaveError = null;
    try {
      const nextVaultInfo = await invoke<VaultInfo>('set_vault_directory', {
        path: this.vaultPathInput.trim() === '' ? null : this.vaultPathInput.trim()
      });
      this.#applyVaultInfo(nextVaultInfo, true);
    } catch (error) {
      console.error('Failed to save vault directory:', error);
      this.vaultSaveError = String(error);
    } finally {
      this.isSavingVault = false;
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
    }, delayMs);
  }

  async initialize() {
    await Promise.all([this.loadSemanticState(), this.loadForgottenNotes()]);
    await appStore.bootstrap().catch(() => undefined);
    this.#disposeVaultNoteChanged?.();
    this.#disposeSemanticStatus?.();
    this.#disposeVaultNoteChanged = appStore.subscribeVaultNoteChanged((payload) => {
      if (payload.documentKind && payload.documentKind !== 'note') return;
      this.#scheduleVaultChangeRefresh();
    });
    // Backend pushes `semantic-status-changed` after mutations (settings
    // save, rebuild/pause/resume, vault change). Reduce to listening
    // instead of polling those code paths; we still poll while indexing
    // is in progress because background workers don't currently emit.
    this.#disposeSemanticStatus = appStore.subscribeSemanticStatusChanged((payload) => {
      this.semanticStatus = payload;
      this.#syncSemanticPolling();
    });
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
  }
}

export function createSettingsStore() {
  return new SettingsStore();
}
