import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { get, writable } from 'svelte/store';
import { cancelScheduledAutoSync, runAutoSyncNow, scheduleAutoSync } from '$lib/sync/autoSync';
import type { ForgottenNoteSummary } from '$lib/types/forgottenNotes';
import type {
  RequestMagicLinkResponse,
  SyncConflict,
  SyncConflictDetail,
  SyncStatus,
  VaultInfo
} from '$lib/types/sync';
import type {
  SemanticDebugSnapshot,
  SemanticSettings,
  SemanticStatus
} from '$lib/types/semantic';

type SettingsTab = 'general' | 'forgotten';
type GeneralSection = 'appearance' | 'forgetting' | 'ai' | 'vault' | 'sync' | 'search';
type ForgottenAction = 'restore_forgotten_notes' | 'delete_forgotten_notes';
type SemanticAction =
  | 'rebuild_semantic_index'
  | 'pause_semantic_indexing'
  | 'resume_semantic_indexing'
  | 'prepare_semantic_model';

interface SettingsState {
  semanticStatus: SemanticStatus | null;
  semanticSettings: SemanticSettings | null;
  semanticDebug: SemanticDebugSnapshot | null;
  vaultInfo: VaultInfo | null;
  syncStatus: SyncStatus | null;
  syncConflicts: SyncConflict[];
  activeConflictNoteId: string | null;
  activeConflictDetail: SyncConflictDetail | null;
  vaultPathInput: string;
  syncBaseUrlInput: string;
  syncEmailInput: string;
  magicLinkTokenInput: string;
  lastMagicLinkResponse: RequestMagicLinkResponse | null;
  isSavingVault: boolean;
  isRequestingMagicLink: boolean;
  isCompletingSyncSignIn: boolean;
  isSyncingNow: boolean;
  isTogglingSyncPause: boolean;
  isSigningOutSync: boolean;
  isLoadingConflictDetail: boolean;
  dismissingConflictNoteIds: string[];
  resolvingConflictNoteIds: string[];
  syncUiError: string | null;
  syncUiMessage: string | null;
  activeTab: SettingsTab;
  activeGeneralSection: GeneralSection;
  forgottenNotes: ForgottenNoteSummary[];
  selectedForgottenPaths: string[];
  isLoadingForgottenNotes: boolean;
  isUpdatingForgottenNotes: boolean;
  isSaving: boolean;
  isRunningAction: boolean;
}

function createInitialState(): SettingsState {
  return {
    semanticStatus: null,
    semanticSettings: null,
    semanticDebug: null,
    vaultInfo: null,
    syncStatus: null,
    syncConflicts: [],
    activeConflictNoteId: null,
    activeConflictDetail: null,
    vaultPathInput: '',
    syncBaseUrlInput: '',
    syncEmailInput: '',
    magicLinkTokenInput: '',
    lastMagicLinkResponse: null,
    isSavingVault: false,
    isRequestingMagicLink: false,
    isCompletingSyncSignIn: false,
    isSyncingNow: false,
    isTogglingSyncPause: false,
    isSigningOutSync: false,
    isLoadingConflictDetail: false,
    dismissingConflictNoteIds: [],
    resolvingConflictNoteIds: [],
    syncUiError: null,
    syncUiMessage: null,
    activeTab: 'general',
    activeGeneralSection: 'appearance',
    forgottenNotes: [],
    selectedForgottenPaths: [],
    isLoadingForgottenNotes: false,
    isUpdatingForgottenNotes: false,
    isSaving: false,
    isRunningAction: false
  };
}

export function createSettingsStore() {
  const store = writable<SettingsState>(createInitialState());
  const { subscribe, update } = store;

  let semanticPollTimer: ReturnType<typeof window.setInterval> | null = null;
  let vaultNoteChangeUnlisten: UnlistenFn | null = null;

  function patch(partial: Partial<SettingsState>) {
    update((state) => ({ ...state, ...partial }));
  }

  function setActiveTab(activeTab: SettingsTab) {
    patch({ activeTab });
  }

  function setActiveGeneralSection(activeGeneralSection: GeneralSection) {
    patch({ activeGeneralSection });
  }

  function setVaultPathInput(vaultPathInput: string) {
    patch({ vaultPathInput });
  }

  function setSyncBaseUrlInput(syncBaseUrlInput: string) {
    patch({ syncBaseUrlInput });
  }

  function setSyncEmailInput(syncEmailInput: string) {
    patch({ syncEmailInput });
  }

  function setMagicLinkTokenInput(magicLinkTokenInput: string) {
    patch({ magicLinkTokenInput });
  }

  function setSelectedForgottenPaths(
    selectedForgottenPaths: string[] | ((current: string[]) => string[])
  ) {
    update((state) => ({
      ...state,
      selectedForgottenPaths:
        typeof selectedForgottenPaths === 'function'
          ? selectedForgottenPaths(state.selectedForgottenPaths)
          : selectedForgottenPaths
    }));
  }

  function stopSemanticPolling() {
    if (semanticPollTimer) {
      window.clearInterval(semanticPollTimer);
      semanticPollTimer = null;
    }
  }

  function shouldPollSemanticState() {
    const state = get(store);
    return Boolean(
      state.semanticStatus?.indexingInProgress || state.isRunningAction || state.isSaving
    );
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
      patch({ semanticStatus: await invoke<SemanticStatus>('get_semantic_status') });
      syncSemanticPolling();
    } catch (error) {
      console.error('Failed to load semantic status:', error);
    }
  }

  async function loadSemanticState() {
    try {
      const [status, settings, debug, nextVaultInfo, nextSyncStatus, nextSyncConflicts] =
        await Promise.all([
          invoke<SemanticStatus>('get_semantic_status'),
          invoke<SemanticSettings>('get_semantic_settings'),
          invoke<SemanticDebugSnapshot>('get_semantic_debug_metrics'),
          invoke<VaultInfo>('get_vault_info'),
          invoke<SyncStatus>('get_sync_status'),
          invoke<SyncConflict[]>('list_sync_conflicts')
        ]);

      update((state) => ({
        ...state,
        semanticStatus: status,
        semanticSettings: settings,
        semanticDebug: debug,
        vaultInfo: nextVaultInfo,
        syncStatus: nextSyncStatus,
        syncConflicts: nextSyncConflicts,
        vaultPathInput:
          state.vaultPathInput.trim() === '' ? nextVaultInfo.currentPath : state.vaultPathInput,
        syncBaseUrlInput:
          state.syncBaseUrlInput.trim() === '' && nextSyncStatus.syncBaseUrl
            ? nextSyncStatus.syncBaseUrl
            : state.syncBaseUrlInput,
        syncEmailInput:
          state.syncEmailInput.trim() === '' && nextSyncStatus.authEmail
            ? nextSyncStatus.authEmail
            : state.syncEmailInput
      }));
      syncSemanticPolling();
    } catch (error) {
      console.error('Failed to load semantic settings:', error);
    }
  }

  async function loadForgottenNotes() {
    patch({ isLoadingForgottenNotes: true });
    try {
      const forgottenNotes = await invoke<ForgottenNoteSummary[]>('list_forgotten_notes');
      update((state) => ({
        ...state,
        forgottenNotes,
        selectedForgottenPaths: state.selectedForgottenPaths.filter((path) =>
          forgottenNotes.some((note) => note.forgottenPath === path)
        )
      }));
    } catch (error) {
      console.error('Failed to load forgotten notes:', error);
    } finally {
      patch({ isLoadingForgottenNotes: false });
    }
  }

  async function runForgottenAction(command: ForgottenAction, forgottenPaths: string[]) {
    if (forgottenPaths.length === 0) return;

    patch({ isUpdatingForgottenNotes: true });
    try {
      await invoke(command, { forgottenPaths });
      setSelectedForgottenPaths((current) => current.filter((path) => !forgottenPaths.includes(path)));
      await loadForgottenNotes();
    } catch (error) {
      console.error(`Failed to run ${command}:`, error);
    } finally {
      patch({ isUpdatingForgottenNotes: false });
    }
  }

  function toggleForgottenSelection(forgottenPath: string, checked: boolean) {
    setSelectedForgottenPaths((current) =>
      checked ? Array.from(new Set([...current, forgottenPath])) : current.filter((path) => path !== forgottenPath)
    );
  }

  function toggleAllForgottenSelections(checked: boolean) {
    const state = get(store);
    setSelectedForgottenPaths(
      checked ? state.forgottenNotes.map((note) => note.forgottenPath) : []
    );
  }

  async function saveSettings() {
    const state = get(store);
    if (!state.semanticSettings) return;

    patch({ isSaving: true });
    try {
      patch({
        semanticSettings: await invoke<SemanticSettings>('set_semantic_settings', {
          settings: state.semanticSettings
        })
      });
      await loadSemanticState();
    } catch (error) {
      console.error('Failed to save semantic settings:', error);
    } finally {
      patch({ isSaving: false });
    }
  }

  function updateSetting<Key extends keyof SemanticSettings>(key: Key, value: SemanticSettings[Key]) {
    update((state) => {
      if (!state.semanticSettings) {
        return state;
      }

      return {
        ...state,
        semanticSettings: {
          ...state.semanticSettings,
          [key]: value
        }
      };
    });
    void saveSettings();
  }

  async function runAction(command: SemanticAction) {
    patch({ isRunningAction: true });
    try {
      await invoke(command);
      await loadSemanticState();
    } catch (error) {
      console.error(`Failed to run ${command}:`, error);
    } finally {
      patch({ isRunningAction: false });
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

  async function saveVaultDirectory() {
    patch({ isSavingVault: true });
    try {
      const state = get(store);
      const nextVaultInfo = await invoke<VaultInfo>('set_vault_directory', {
        path: state.vaultPathInput.trim() === '' ? null : state.vaultPathInput.trim()
      });
      patch({
        vaultInfo: nextVaultInfo,
        syncStatus: await invoke<SyncStatus>('get_sync_status')
      });
    } catch (error) {
      console.error('Failed to save vault directory:', error);
    } finally {
      patch({ isSavingVault: false });
    }
  }

  async function requestMagicLink() {
    const state = get(store);
    if (state.syncBaseUrlInput.trim() === '' || state.syncEmailInput.trim() === '') return;

    patch({
      isRequestingMagicLink: true,
      syncUiError: null,
      syncUiMessage: null
    });

    try {
      const response = await invoke<RequestMagicLinkResponse>('request_sync_magic_link', {
        syncBaseUrl: state.syncBaseUrlInput.trim(),
        email: state.syncEmailInput.trim()
      });
      patch({
        lastMagicLinkResponse: response,
        magicLinkTokenInput: response.magicLinkToken ?? get(store).magicLinkTokenInput,
        syncStatus: await invoke<SyncStatus>('get_sync_status'),
        syncUiMessage: 'Magic link requested.'
      });
    } catch (error) {
      console.error('Failed to request magic link:', error);
      patch({ syncUiError: String(error) });
    } finally {
      patch({ isRequestingMagicLink: false });
    }
  }

  async function completeSyncSignIn() {
    const state = get(store);
    if (
      state.syncBaseUrlInput.trim() === '' ||
      state.syncEmailInput.trim() === '' ||
      state.magicLinkTokenInput.trim() === ''
    ) {
      return;
    }

    patch({
      isCompletingSyncSignIn: true,
      syncUiError: null,
      syncUiMessage: null
    });
    try {
      patch({
        syncStatus: await invoke<SyncStatus>('complete_sync_sign_in', {
          syncBaseUrl: state.syncBaseUrlInput.trim(),
          email: state.syncEmailInput.trim(),
          magicLinkToken: state.magicLinkTokenInput.trim(),
          deviceName: navigator.platform || null
        })
      });
      await loadSemanticState();
      patch({ syncUiMessage: 'This device is linked and ready to sync.' });
    } catch (error) {
      console.error('Failed to complete sync sign-in:', error);
      patch({ syncUiError: String(error) });
    } finally {
      patch({ isCompletingSyncSignIn: false });
    }
  }

  async function runSyncNow() {
    patch({
      isSyncingNow: true,
      syncUiError: null,
      syncUiMessage: null
    });
    try {
      patch({ syncStatus: await invoke<SyncStatus>('sync_now') });
      await loadForgottenNotes();
      await loadSemanticState();
      patch({ syncUiMessage: 'Sync completed.' });
    } catch (error) {
      console.error('Failed to sync:', error);
      patch({ syncUiError: String(error) });
      await loadSemanticState();
    } finally {
      patch({ isSyncingNow: false });
    }
  }

  async function signOutSync(keepServerUrl = true) {
    patch({
      isSigningOutSync: true,
      syncUiError: null,
      syncUiMessage: null
    });
    try {
      patch({
        syncStatus: await invoke<SyncStatus>('sign_out_sync', { keepServerUrl }),
        magicLinkTokenInput: '',
        lastMagicLinkResponse: null,
        syncConflicts: await invoke<SyncConflict[]>('list_sync_conflicts'),
        syncUiMessage: 'Signed out on this device.'
      });
    } catch (error) {
      console.error('Failed to sign out of sync:', error);
      patch({ syncUiError: String(error) });
    } finally {
      patch({ isSigningOutSync: false });
    }
  }

  async function dismissSyncConflict(noteId: string) {
    update((state) => ({
      ...state,
      dismissingConflictNoteIds: Array.from(new Set([...state.dismissingConflictNoteIds, noteId])),
      syncUiError: null
    }));

    try {
      const nextStatus = await invoke<SyncStatus>('dismiss_sync_conflict', { noteId });
      const nextConflicts = await invoke<SyncConflict[]>('list_sync_conflicts');
      update((state) => ({
        ...state,
        syncStatus: nextStatus,
        syncConflicts: nextConflicts,
        activeConflictNoteId: state.activeConflictNoteId === noteId ? null : state.activeConflictNoteId,
        activeConflictDetail: state.activeConflictNoteId === noteId ? null : state.activeConflictDetail
      }));
    } catch (error) {
      console.error('Failed to dismiss sync conflict:', error);
      patch({ syncUiError: String(error) });
    } finally {
      update((state) => ({
        ...state,
        dismissingConflictNoteIds: state.dismissingConflictNoteIds.filter((id) => id !== noteId)
      }));
    }
  }

  async function toggleSyncConflictDetail(noteId: string) {
    const state = get(store);
    if (state.activeConflictNoteId === noteId) {
      patch({
        activeConflictNoteId: null,
        activeConflictDetail: null
      });
      return;
    }

    patch({
      isLoadingConflictDetail: true,
      syncUiError: null
    });

    try {
      const detail = await invoke<SyncConflictDetail | null>('get_sync_conflict_detail', { noteId });
      patch({
        activeConflictDetail: detail,
        activeConflictNoteId: detail ? noteId : null
      });
    } catch (error) {
      console.error('Failed to load sync conflict detail:', error);
      patch({
        syncUiError: String(error),
        activeConflictNoteId: null,
        activeConflictDetail: null
      });
    } finally {
      patch({ isLoadingConflictDetail: false });
    }
  }

  async function resolveSyncConflict(noteId: string, strategy: 'keep-local' | 'keep-remote') {
    update((state) => ({
      ...state,
      resolvingConflictNoteIds: Array.from(new Set([...state.resolvingConflictNoteIds, noteId])),
      syncUiError: null,
      syncUiMessage: null
    }));

    try {
      const nextStatus = await invoke<SyncStatus>(
        strategy === 'keep-local'
          ? 'resolve_sync_conflict_keep_local'
          : 'resolve_sync_conflict_keep_remote',
        { noteId }
      );
      const nextConflicts = await invoke<SyncConflict[]>('list_sync_conflicts');
      update((state) => ({
        ...state,
        syncStatus: nextStatus,
        syncConflicts: nextConflicts,
        activeConflictNoteId: state.activeConflictNoteId === noteId ? null : state.activeConflictNoteId,
        activeConflictDetail: state.activeConflictNoteId === noteId ? null : state.activeConflictDetail,
        syncUiMessage:
          strategy === 'keep-local'
            ? 'Conflict resolved by restoring the local version to the canonical note.'
            : 'Conflict resolved by keeping the remote canonical version.'
      }));
      await loadSemanticState();
    } catch (error) {
      console.error('Failed to resolve sync conflict:', error);
      patch({ syncUiError: String(error) });
    } finally {
      update((state) => ({
        ...state,
        resolvingConflictNoteIds: state.resolvingConflictNoteIds.filter((id) => id !== noteId)
      }));
    }
  }

  async function toggleSyncPaused() {
    const state = get(store);
    if (!state.syncStatus) return;

    patch({
      isTogglingSyncPause: true,
      syncUiError: null,
      syncUiMessage: null
    });
    try {
      const nextStatus = await invoke<SyncStatus>('set_sync_paused', {
        paused: !state.syncStatus.paused
      });
      patch({
        syncStatus: nextStatus,
        syncUiMessage: nextStatus.paused
          ? 'Syncing is paused on this device.'
          : 'Syncing resumed on this device.'
      });
      if (!nextStatus.paused) {
        await loadSemanticState();
      }
    } catch (error) {
      console.error('Failed to toggle sync pause:', error);
      patch({ syncUiError: String(error) });
    } finally {
      patch({ isTogglingSyncPause: false });
    }
  }

  async function handleVisibilityChange() {
    if (document.visibilityState === 'visible') {
      await loadSemanticStatus();
      await runAutoSyncNow('settings-visible');
      await loadSemanticState();
      syncSemanticPolling();
      return;
    }

    stopSemanticPolling();
  }

  async function initialize() {
    await Promise.all([loadSemanticState(), loadForgottenNotes()]);
    vaultNoteChangeUnlisten = await listen('vault-note-changed', () => {
      scheduleAutoSync('settings-vault-note-change', 1200);
      void loadForgottenNotes();
      void loadSemanticState();
    });
    scheduleAutoSync('settings-mounted', 900);
  }

  function dispose() {
    stopSemanticPolling();
    cancelScheduledAutoSync();
    vaultNoteChangeUnlisten?.();
    vaultNoteChangeUnlisten = null;
  }

  return {
    subscribe,
    initialize,
    dispose,
    handleVisibilityChange,
    setActiveTab,
    setActiveGeneralSection,
    setVaultPathInput,
    setSyncBaseUrlInput,
    setSyncEmailInput,
    setMagicLinkTokenInput,
    loadForgottenNotes,
    runForgottenAction,
    toggleForgottenSelection,
    toggleAllForgottenSelections,
    loadSemanticStatus,
    loadSemanticState,
    updateSetting,
    runAction,
    clearDebugMetrics,
    saveVaultDirectory,
    requestMagicLink,
    completeSyncSignIn,
    runSyncNow,
    signOutSync,
    dismissSyncConflict,
    toggleSyncConflictDetail,
    resolveSyncConflict,
    toggleSyncPaused
  };
}

export type { GeneralSection, SettingsState, SettingsTab };
