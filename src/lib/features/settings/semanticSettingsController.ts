import { invoke } from '@tauri-apps/api/core';
import type { SyncConflict, SyncStatus, VaultInfo } from '$lib/types/sync';
import type {
  SemanticDebugSnapshot,
  SemanticSettings,
  SemanticStatus
} from '$lib/types/semantic';

type SemanticAction =
  | 'rebuild_semantic_index'
  | 'pause_semantic_indexing'
  | 'resume_semantic_indexing'
  | 'prepare_semantic_model';

interface SemanticSettingsControllerDeps {
  getSemanticStatus: () => SemanticStatus | null;
  setSemanticStatus: (value: SemanticStatus | null) => void;
  getSemanticSettings: () => SemanticSettings | null;
  setSemanticSettings: (value: SemanticSettings | null) => void;
  setSemanticDebug: (value: SemanticDebugSnapshot | null) => void;
  setVaultInfo: (value: VaultInfo | null) => void;
  setSyncStatus: (value: SyncStatus | null) => void;
  setSyncConflicts: (value: SyncConflict[]) => void;
  getVaultPathInput: () => string;
  setVaultPathInput: (value: string) => void;
  getSyncBaseUrlInput: () => string;
  setSyncBaseUrlInput: (value: string) => void;
  getSyncEmailInput: () => string;
  setSyncEmailInput: (value: string) => void;
  getIsSaving: () => boolean;
  setIsSaving: (value: boolean) => void;
  getIsRunningAction: () => boolean;
  setIsRunningAction: (value: boolean) => void;
}

export function createSemanticSettingsController({
  getSemanticStatus,
  setSemanticStatus,
  getSemanticSettings,
  setSemanticSettings,
  setSemanticDebug,
  setVaultInfo,
  setSyncStatus,
  setSyncConflicts,
  getVaultPathInput,
  setVaultPathInput,
  getSyncBaseUrlInput,
  setSyncBaseUrlInput,
  getSyncEmailInput,
  setSyncEmailInput,
  getIsSaving,
  setIsSaving,
  getIsRunningAction,
  setIsRunningAction
}: SemanticSettingsControllerDeps) {
  let semanticPollTimer: ReturnType<typeof window.setInterval> | null = null;

  function stopSemanticPolling() {
    if (semanticPollTimer) {
      window.clearInterval(semanticPollTimer);
      semanticPollTimer = null;
    }
  }

  function shouldPollSemanticState() {
    return Boolean(getSemanticStatus()?.indexingInProgress || getIsRunningAction() || getIsSaving());
  }

  function syncSemanticPolling() {
    if (typeof document === 'undefined' || document.visibilityState !== 'visible') {
      stopSemanticPolling();
      return;
    }

    if (!shouldPollSemanticState()) {
      stopSemanticPolling();
      return;
    }

    if (semanticPollTimer) {
      return;
    }

    semanticPollTimer = window.setInterval(() => {
      void loadSemanticStatus();
    }, 5000);
  }

  async function loadSemanticStatus() {
    try {
      setSemanticStatus(await invoke<SemanticStatus>('get_semantic_status'));
      syncSemanticPolling();
    } catch (error) {
      console.error('Failed to load semantic status:', error);
    }
  }

  async function loadSemanticState() {
    try {
      const [status, settings, debug, nextVaultInfo, nextSyncStatus, nextSyncConflicts] = await Promise.all([
        invoke<SemanticStatus>('get_semantic_status'),
        invoke<SemanticSettings>('get_semantic_settings'),
        invoke<SemanticDebugSnapshot>('get_semantic_debug_metrics'),
        invoke<VaultInfo>('get_vault_info'),
        invoke<SyncStatus>('get_sync_status'),
        invoke<SyncConflict[]>('list_sync_conflicts')
      ]);
      setSemanticStatus(status);
      setSemanticSettings(settings);
      setSemanticDebug(debug);
      setVaultInfo(nextVaultInfo);
      setSyncStatus(nextSyncStatus);
      setSyncConflicts(nextSyncConflicts);
      if (getVaultPathInput().trim() === '') {
        setVaultPathInput(nextVaultInfo.currentPath);
      }
      if (getSyncBaseUrlInput().trim() === '' && nextSyncStatus.syncBaseUrl) {
        setSyncBaseUrlInput(nextSyncStatus.syncBaseUrl);
      }
      if (getSyncEmailInput().trim() === '' && nextSyncStatus.authEmail) {
        setSyncEmailInput(nextSyncStatus.authEmail);
      }
      syncSemanticPolling();
    } catch (error) {
      console.error('Failed to load semantic settings:', error);
    }
  }

  async function saveSettings() {
    const semanticSettings = getSemanticSettings();
    if (!semanticSettings) return;
    setIsSaving(true);

    try {
      setSemanticSettings(
        await invoke<SemanticSettings>('set_semantic_settings', {
          settings: semanticSettings
        })
      );
      await loadSemanticState();
    } catch (error) {
      console.error('Failed to save semantic settings:', error);
    } finally {
      setIsSaving(false);
    }
  }

  function updateSetting<Key extends keyof SemanticSettings>(key: Key, value: SemanticSettings[Key]) {
    const semanticSettings = getSemanticSettings();
    if (!semanticSettings) return;
    setSemanticSettings({
      ...semanticSettings,
      [key]: value
    });
    void saveSettings();
  }

  async function runAction(command: SemanticAction) {
    setIsRunningAction(true);
    try {
      await invoke(command);
      await loadSemanticState();
    } catch (error) {
      console.error(`Failed to run ${command}:`, error);
    } finally {
      setIsRunningAction(false);
    }
  }

  async function clearDebugMetrics() {
    try {
      await invoke('clear_semantic_debug_metrics');
      await loadSemanticState();
    } catch (error) {
      console.error('Failed to clear semantic debug metrics:', error);
    }
  }

  return {
    stopSemanticPolling,
    syncSemanticPolling,
    loadSemanticStatus,
    loadSemanticState,
    saveSettings,
    updateSetting,
    runAction,
    clearDebugMetrics
  };
}

export function formatTimestamp(value: number | null) {
  if (!value) return 'Never';
  return new Date(value).toLocaleString();
}

export function formatMillis(value: number | null) {
  if (value === null || Number.isNaN(value)) return '0 ms';
  if (value >= 1000) return `${(value / 1000).toFixed(2)} s`;
  return `${Math.round(value)} ms`;
}

export function averageDuration(total: number, count: number) {
  if (!count) return 0;
  return total / count;
}
