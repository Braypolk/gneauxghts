<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import { listen, type UnlistenFn } from '@tauri-apps/api/event';
  import { Monitor, Moon, RefreshCcw, Sun } from 'lucide-svelte';
  import { onDestroy, onMount } from 'svelte';
  import { runAutoSyncNow, scheduleAutoSync, cancelScheduledAutoSync } from '$lib/sync/autoSync';
  import {
    forgetButtonDurationOptions,
    forgetButtonDurationPreference,
    forgottenNoteRetentionOptions,
    forgottenNoteRetentionPreference,
    setForgottenNoteRetentionPreference,
    setForgetButtonDurationPreference
  } from '$lib/appSettings';
  import {
    setThemePreference,
    themeOptions,
    themePreference,
    type ThemePreference
  } from '$lib/theme';
  import type { ForgottenNoteSummary } from '$lib/types/forgottenNotes';
  import type {
    RequestMagicLinkResponse,
    SyncConflict,
    SyncConflictDetail,
    SyncStatus,
    VaultInfo
  } from '$lib/types/sync';
  import type {
    SemanticDebugMetrics,
    SemanticDebugSnapshot,
    SemanticSettings,
    SemanticStatus
  } from '$lib/types/semantic';

  type SettingsTab = 'general' | 'forgotten';

  const themeIcons: Record<ThemePreference, typeof Monitor> = {
    auto: Monitor,
    light: Sun,
    dark: Moon
  };

  let semanticStatus = $state<SemanticStatus | null>(null);
  let semanticSettings = $state<SemanticSettings | null>(null);
  let semanticDebug = $state<SemanticDebugSnapshot | null>(null);
  let vaultInfo = $state<VaultInfo | null>(null);
  let syncStatus = $state<SyncStatus | null>(null);
  let syncConflicts = $state<SyncConflict[]>([]);
  let activeConflictNoteId = $state<string | null>(null);
  let activeConflictDetail = $state<SyncConflictDetail | null>(null);
  let vaultPathInput = $state('');
  let syncBaseUrlInput = $state('');
  let syncEmailInput = $state('');
  let magicLinkTokenInput = $state('');
  let lastMagicLinkResponse = $state<RequestMagicLinkResponse | null>(null);
  let isSavingVault = $state(false);
  let isRequestingMagicLink = $state(false);
  let isCompletingSyncSignIn = $state(false);
  let isSyncingNow = $state(false);
  let isTogglingSyncPause = $state(false);
  let isSigningOutSync = $state(false);
  let isLoadingConflictDetail = $state(false);
  let dismissingConflictNoteIds = $state<string[]>([]);
  let resolvingConflictNoteIds = $state<string[]>([]);
  let syncUiError = $state<string | null>(null);
  let syncUiMessage = $state<string | null>(null);
  let activeTab = $state<SettingsTab>('general');
  let forgottenNotes = $state<ForgottenNoteSummary[]>([]);
  let selectedForgottenPaths = $state<string[]>([]);
  let isLoadingForgottenNotes = $state(false);
  let isUpdatingForgottenNotes = $state(false);
  let isSaving = $state(false);
  let isRunningAction = $state(false);
  let semanticPollTimer: ReturnType<typeof window.setInterval> | null = null;
  let vaultNoteChangeUnlisten: UnlistenFn | null = null;
  let allForgottenSelected = $derived(
    forgottenNotes.length > 0 &&
      forgottenNotes.every((note) => selectedForgottenPaths.includes(note.forgottenPath))
  );

  function stopSemanticPolling() {
    if (semanticPollTimer) {
      window.clearInterval(semanticPollTimer);
      semanticPollTimer = null;
    }
  }

  function shouldPollSemanticState() {
    return Boolean(semanticStatus?.indexingInProgress || isRunningAction || isSaving);
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
      semanticStatus = await invoke<SemanticStatus>('get_semantic_status');
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
      semanticStatus = status;
      semanticSettings = settings;
      semanticDebug = debug;
      vaultInfo = nextVaultInfo;
      syncStatus = nextSyncStatus;
      syncConflicts = nextSyncConflicts;
      if (vaultPathInput.trim() === '') {
        vaultPathInput = nextVaultInfo.currentPath;
      }
      if (syncBaseUrlInput.trim() === '' && nextSyncStatus.syncBaseUrl) {
        syncBaseUrlInput = nextSyncStatus.syncBaseUrl;
      }
      if (syncEmailInput.trim() === '' && nextSyncStatus.authEmail) {
        syncEmailInput = nextSyncStatus.authEmail;
      }
      syncSemanticPolling();
    } catch (error) {
      console.error('Failed to load semantic settings:', error);
    }
  }

  async function saveSettings() {
    if (!semanticSettings) return;
    isSaving = true;

    try {
      semanticSettings = await invoke<SemanticSettings>('set_semantic_settings', {
        settings: semanticSettings
      });
      await loadSemanticState();
    } catch (error) {
      console.error('Failed to save semantic settings:', error);
    } finally {
      isSaving = false;
    }
  }

  function updateSetting<Key extends keyof SemanticSettings>(key: Key, value: SemanticSettings[Key]) {
    if (!semanticSettings) return;
    semanticSettings = {
      ...semanticSettings,
      [key]: value
    };
    void saveSettings();
  }

  async function runAction(
    command:
      | 'rebuild_semantic_index'
      | 'pause_semantic_indexing'
      | 'resume_semantic_indexing'
      | 'prepare_semantic_model'
  ) {
    isRunningAction = true;
    try {
      await invoke(command);
      await loadSemanticState();
    } catch (error) {
      console.error(`Failed to run ${command}:`, error);
    } finally {
      isRunningAction = false;
    }
  }

  function formatTimestamp(value: number | null) {
    if (!value) return 'Never';
    return new Date(value).toLocaleString();
  }

  function formatMillis(value: number | null) {
    if (value === null || Number.isNaN(value)) return '0 ms';
    if (value >= 1000) return `${(value / 1000).toFixed(2)} s`;
    return `${Math.round(value)} ms`;
  }

  function averageDuration(total: number, count: number) {
    if (!count) return 0;
    return total / count;
  }

  async function clearDebugMetrics() {
    try {
      await invoke('clear_semantic_debug_metrics');
      await loadSemanticState();
    } catch (error) {
      console.error('Failed to clear semantic debug metrics:', error);
    }
  }

  async function loadForgottenNotes() {
    isLoadingForgottenNotes = true;

    try {
      forgottenNotes = await invoke<ForgottenNoteSummary[]>('list_forgotten_notes');
      selectedForgottenPaths = selectedForgottenPaths.filter((path) =>
        forgottenNotes.some((note) => note.forgottenPath === path)
      );
    } catch (error) {
      console.error('Failed to load forgotten notes:', error);
    } finally {
      isLoadingForgottenNotes = false;
    }
  }

  async function saveVaultDirectory() {
    isSavingVault = true;

    try {
      vaultInfo = await invoke<VaultInfo>('set_vault_directory', {
        path: vaultPathInput.trim() === '' ? null : vaultPathInput.trim()
      });
      syncStatus = await invoke<SyncStatus>('get_sync_status');
    } catch (error) {
      console.error('Failed to save vault directory:', error);
    } finally {
      isSavingVault = false;
    }
  }

  function formatSyncTimestamp(value: number | null) {
    if (!value) return 'Never';
    return new Date(value).toLocaleString();
  }

  type ConflictDiffRow = {
    lineNumber: number;
    localLine: string;
    remoteLine: string;
    kind: 'same' | 'changed' | 'local-only' | 'remote-only';
  };

  function buildConflictDiffRows(detail: SyncConflictDetail | null) {
    if (!detail) return [] as ConflictDiffRow[];
    const localLines = detail.localMarkdown.replace(/\r\n/g, '\n').split('\n');
    const remoteLines = detail.remoteMarkdown.replace(/\r\n/g, '\n').split('\n');
    const length = Math.max(localLines.length, remoteLines.length);
    const rows: ConflictDiffRow[] = [];

    for (let index = 0; index < length; index += 1) {
      const localLine = localLines[index] ?? '';
      const remoteLine = remoteLines[index] ?? '';
      let kind: ConflictDiffRow['kind'] = 'same';
      if (index >= localLines.length) {
        kind = 'remote-only';
      } else if (index >= remoteLines.length) {
        kind = 'local-only';
      } else if (localLine !== remoteLine) {
        kind = 'changed';
      }

      rows.push({
        lineNumber: index + 1,
        localLine,
        remoteLine,
        kind
      });
    }

    return rows;
  }

  function conflictRowClass(kind: ConflictDiffRow['kind']) {
    switch (kind) {
      case 'changed':
        return 'bg-amber-50 dark:bg-amber-950/20';
      case 'local-only':
        return 'bg-emerald-50 dark:bg-emerald-950/20';
      case 'remote-only':
        return 'bg-sky-50 dark:bg-sky-950/20';
      default:
        return '';
    }
  }

  async function requestMagicLink() {
    if (syncBaseUrlInput.trim() === '' || syncEmailInput.trim() === '') return;
    isRequestingMagicLink = true;
    syncUiError = null;
    syncUiMessage = null;

    try {
      lastMagicLinkResponse = await invoke<RequestMagicLinkResponse>('request_sync_magic_link', {
        syncBaseUrl: syncBaseUrlInput.trim(),
        email: syncEmailInput.trim()
      });
      if (lastMagicLinkResponse.magicLinkToken) {
        magicLinkTokenInput = lastMagicLinkResponse.magicLinkToken;
      }
      syncStatus = await invoke<SyncStatus>('get_sync_status');
      syncUiMessage = 'Magic link requested.';
    } catch (error) {
      console.error('Failed to request magic link:', error);
      syncUiError = String(error);
    } finally {
      isRequestingMagicLink = false;
    }
  }

  async function completeSyncSignIn() {
    if (
      syncBaseUrlInput.trim() === '' ||
      syncEmailInput.trim() === '' ||
      magicLinkTokenInput.trim() === ''
    ) {
      return;
    }

    isCompletingSyncSignIn = true;
    syncUiError = null;
    syncUiMessage = null;
    try {
      syncStatus = await invoke<SyncStatus>('complete_sync_sign_in', {
        syncBaseUrl: syncBaseUrlInput.trim(),
        email: syncEmailInput.trim(),
        magicLinkToken: magicLinkTokenInput.trim(),
        deviceName: navigator.platform || null
      });
      await loadSemanticState();
      syncUiMessage = 'This device is linked and ready to sync.';
    } catch (error) {
      console.error('Failed to complete sync sign-in:', error);
      syncUiError = String(error);
    } finally {
      isCompletingSyncSignIn = false;
    }
  }

  async function runSyncNow() {
    isSyncingNow = true;
    syncUiError = null;
    syncUiMessage = null;
    try {
      syncStatus = await invoke<SyncStatus>('sync_now');
      await loadForgottenNotes();
      await loadSemanticState();
      syncUiMessage = 'Sync completed.';
    } catch (error) {
      console.error('Failed to sync:', error);
      syncUiError = String(error);
      await loadSemanticState();
    } finally {
      isSyncingNow = false;
    }
  }

  async function signOutSync(keepServerUrl = true) {
    isSigningOutSync = true;
    syncUiError = null;
    syncUiMessage = null;
    try {
      syncStatus = await invoke<SyncStatus>('sign_out_sync', { keepServerUrl });
      magicLinkTokenInput = '';
      lastMagicLinkResponse = null;
      syncConflicts = await invoke<SyncConflict[]>('list_sync_conflicts');
      syncUiMessage = 'Signed out on this device.';
    } catch (error) {
      console.error('Failed to sign out of sync:', error);
      syncUiError = String(error);
    } finally {
      isSigningOutSync = false;
    }
  }

  async function dismissSyncConflict(noteId: string) {
    dismissingConflictNoteIds = Array.from(new Set([...dismissingConflictNoteIds, noteId]));
    syncUiError = null;
    try {
      syncStatus = await invoke<SyncStatus>('dismiss_sync_conflict', { noteId });
      syncConflicts = await invoke<SyncConflict[]>('list_sync_conflicts');
      if (activeConflictNoteId === noteId) {
        activeConflictNoteId = null;
        activeConflictDetail = null;
      }
    } catch (error) {
      console.error('Failed to dismiss sync conflict:', error);
      syncUiError = String(error);
    } finally {
      dismissingConflictNoteIds = dismissingConflictNoteIds.filter((id) => id !== noteId);
    }
  }

  async function toggleSyncConflictDetail(noteId: string) {
    if (activeConflictNoteId === noteId) {
      activeConflictNoteId = null;
      activeConflictDetail = null;
      return;
    }

    isLoadingConflictDetail = true;
    syncUiError = null;
    try {
      activeConflictDetail = await invoke<SyncConflictDetail | null>('get_sync_conflict_detail', {
        noteId
      });
      activeConflictNoteId = activeConflictDetail ? noteId : null;
    } catch (error) {
      console.error('Failed to load sync conflict detail:', error);
      syncUiError = String(error);
      activeConflictNoteId = null;
      activeConflictDetail = null;
    } finally {
      isLoadingConflictDetail = false;
    }
  }

  async function resolveSyncConflict(noteId: string, strategy: 'keep-local' | 'keep-remote') {
    resolvingConflictNoteIds = Array.from(new Set([...resolvingConflictNoteIds, noteId]));
    syncUiError = null;
    syncUiMessage = null;
    try {
      syncStatus = await invoke<SyncStatus>(
        strategy === 'keep-local'
          ? 'resolve_sync_conflict_keep_local'
          : 'resolve_sync_conflict_keep_remote',
        { noteId }
      );
      syncConflicts = await invoke<SyncConflict[]>('list_sync_conflicts');
      if (activeConflictNoteId === noteId) {
        activeConflictNoteId = null;
        activeConflictDetail = null;
      }
      syncUiMessage =
        strategy === 'keep-local'
          ? 'Conflict resolved by restoring the local version to the canonical note.'
          : 'Conflict resolved by keeping the remote canonical version.';
      await loadSemanticState();
    } catch (error) {
      console.error('Failed to resolve sync conflict:', error);
      syncUiError = String(error);
    } finally {
      resolvingConflictNoteIds = resolvingConflictNoteIds.filter((id) => id !== noteId);
    }
  }

  async function toggleSyncPaused() {
    if (!syncStatus) return;

    isTogglingSyncPause = true;
    syncUiError = null;
    syncUiMessage = null;
    try {
      syncStatus = await invoke<SyncStatus>('set_sync_paused', { paused: !syncStatus.paused });
      syncUiMessage = syncStatus.paused
        ? 'Syncing is paused on this device.'
        : 'Syncing resumed on this device.';
      if (!syncStatus.paused) {
        await loadSemanticState();
      }
    } catch (error) {
      console.error('Failed to toggle sync pause:', error);
      syncUiError = String(error);
    } finally {
      isTogglingSyncPause = false;
    }
  }

  async function runForgottenAction(
    command: 'restore_forgotten_notes' | 'delete_forgotten_notes',
    forgottenPaths: string[]
  ) {
    if (forgottenPaths.length === 0) return;

    isUpdatingForgottenNotes = true;
    try {
      await invoke(command, { forgottenPaths });
      selectedForgottenPaths = selectedForgottenPaths.filter(
        (path) => !forgottenPaths.includes(path)
      );
      await loadForgottenNotes();
    } catch (error) {
      console.error(`Failed to run ${command}:`, error);
    } finally {
      isUpdatingForgottenNotes = false;
    }
  }

  function toggleForgottenSelection(forgottenPath: string, checked: boolean) {
    if (checked) {
      selectedForgottenPaths = Array.from(new Set([...selectedForgottenPaths, forgottenPath]));
      return;
    }

    selectedForgottenPaths = selectedForgottenPaths.filter((path) => path !== forgottenPath);
  }

  function toggleAllForgottenSelections(checked: boolean) {
    selectedForgottenPaths = checked ? forgottenNotes.map((note) => note.forgottenPath) : [];
  }

  function formatForgottenRetention(days: number) {
    return `${days} day${days === 1 ? '' : 's'}`;
  }

  function handleVisibilityChange() {
    if (document.visibilityState === 'visible') {
      void loadSemanticStatus();
      void runAutoSyncNow('settings-visible').then(() => loadSemanticState());
      syncSemanticPolling();
      return;
    }

    stopSemanticPolling();
  }

  onMount(() => {
    void loadSemanticState();
    void loadForgottenNotes();
    void listen('vault-note-changed', () => {
      scheduleAutoSync('settings-vault-note-change', 1200);
      void loadForgottenNotes();
      void loadSemanticState();
    }).then((unlisten) => {
      vaultNoteChangeUnlisten = unlisten;
    });
    scheduleAutoSync('settings-mounted', 900);
  });

  onDestroy(() => {
    stopSemanticPolling();
    cancelScheduledAutoSync();
    vaultNoteChangeUnlisten?.();
    vaultNoteChangeUnlisten = null;
  });
</script>

<svelte:document onvisibilitychange={handleVisibilityChange} />

<div class="h-full w-full overflow-auto bg-background text-foreground">
  <main class="mx-auto flex min-h-full w-full max-w-4xl items-start justify-center px-2 pb-10">
    <section class="mt-2 w-full overflow-hidden rounded-[1.75rem] border border-border/80 bg-card/80 shadow-sm backdrop-blur-md">
      <div class="px-6 py-5">
        <p class="text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">Settings</p>
      </div>

      <div class="border-t border-border/70 px-6 py-4">
        <div class="inline-flex items-center gap-1 rounded-full border border-border/80 bg-background/60 p-1">
          <button
            class={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === 'general'
                ? 'bg-foreground text-background shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
            type="button"
            onclick={() => (activeTab = 'general')}
          >
            General
          </button>
          <button
            class={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === 'forgotten'
                ? 'bg-foreground text-background shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
            type="button"
            onclick={() => {
              activeTab = 'forgotten';
              void loadForgottenNotes();
            }}
          >
            Forgotten Notes
          </button>
        </div>
      </div>

      {#if activeTab === 'general'}
      <div class="border-t border-border/70 px-6 py-5">
        <div class="flex items-center justify-between gap-4">
          <div>
            <p class="text-sm font-medium">Theme</p>
            <p class="mt-0.5 text-xs text-muted-foreground">Auto follows your system appearance.</p>
          </div>

          <fieldset class="flex shrink-0 items-center gap-1 rounded-full border border-border/80 bg-background/60 p-1">
            <legend class="sr-only">Theme preference</legend>

            {#each themeOptions as option}
              {@const Icon = themeIcons[option.id]}
              <label
                title={option.description}
                class={`flex cursor-pointer items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                  $themePreference === option.id
                    ? 'bg-foreground text-background shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <input
                  class="sr-only"
                  type="radio"
                  name="theme-preference"
                  value={option.id}
                  checked={$themePreference === option.id}
                  onchange={() => void setThemePreference(option.id)}
                />
                <Icon class="h-3.5 w-3.5" />
                <span>{option.label}</span>
              </label>
            {/each}
          </fieldset>
        </div>
      </div>

      <div class="border-t border-border/70 px-6 py-5">
        <div class="flex items-center justify-between gap-4">
          <div>
            <p class="text-sm font-medium">Forget Button Duration</p>
            <p class="mt-0.5 text-xs text-muted-foreground">
              Choose whether forgetting happens instantly or after a hold.
            </p>
          </div>

          <fieldset class="flex shrink-0 flex-wrap items-center gap-1 rounded-full border border-border/80 bg-background/60 p-1">
            <legend class="sr-only">Forget button duration</legend>

            {#each forgetButtonDurationOptions as option}
              <label
                title={option.description}
                class={`flex cursor-pointer items-center rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                  $forgetButtonDurationPreference === option.id
                    ? 'bg-foreground text-background shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <input
                  class="sr-only"
                  type="radio"
                  name="forget-button-duration"
                  value={option.id}
                  checked={$forgetButtonDurationPreference === option.id}
                  onchange={() => setForgetButtonDurationPreference(option.id)}
                />
                <span>{option.label}</span>
              </label>
            {/each}
          </fieldset>
        </div>
      </div>

      <div class="border-t border-border/70 px-6 py-5">
        <div class="flex items-center justify-between gap-4">
          <div>
            <p class="text-sm font-medium">Forgotten Note Retention</p>
            <p class="mt-0.5 text-xs text-muted-foreground">
              Forgotten notes move into `.forgotten` before they are permanently deleted.
            </p>
          </div>

          <fieldset class="flex shrink-0 flex-wrap items-center gap-1 rounded-full border border-border/80 bg-background/60 p-1">
            <legend class="sr-only">Forgotten note retention</legend>

            {#each forgottenNoteRetentionOptions as option}
              <label
                title={option.description}
                class={`flex cursor-pointer items-center rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                  $forgottenNoteRetentionPreference === option.id
                    ? 'bg-foreground text-background shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <input
                  class="sr-only"
                  type="radio"
                  name="forgotten-note-retention"
                  value={option.id}
                  checked={$forgottenNoteRetentionPreference === option.id}
                  onchange={() => setForgottenNoteRetentionPreference(option.id)}
                />
                <span>{option.label}</span>
              </label>
            {/each}
          </fieldset>
        </div>
      </div>

      <div class="border-t border-border/70 px-6 py-5">
        <div class="flex flex-col gap-4">
          <div class="flex items-start justify-between gap-4">
            <div>
              <p class="text-sm font-medium">Vault Directory</p>
              <p class="mt-0.5 text-xs text-muted-foreground">
                Desktop vaults can live in any normal folder. Changing the directory updates future note IO and takes full effect after restarting the app.
              </p>
            </div>
          </div>

          <div class="grid gap-4 md:grid-cols-[1fr_auto]">
            <label class="rounded-3xl border border-border/70 bg-background/70 px-5 py-4">
              <span class="text-xs uppercase tracking-[0.18em] text-muted-foreground">Path</span>
              <input
                class="mt-3 w-full bg-transparent text-sm font-medium outline-none"
                bind:value={vaultPathInput}
                placeholder={vaultInfo?.defaultPath ?? 'Vault path'}
              />
            </label>

            <div class="flex items-center gap-2 md:justify-end">
              <button
                class="rounded-full border border-border bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-60"
                type="button"
                disabled={isSavingVault}
                onclick={() => {
                  vaultPathInput = vaultInfo?.defaultPath ?? '';
                  void saveVaultDirectory();
                }}
              >
                Use default
              </button>
              <button
                class="rounded-full border border-border bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-60"
                type="button"
                disabled={isSavingVault}
                onclick={() => void saveVaultDirectory()}
              >
                {isSavingVault ? 'Saving…' : 'Save vault'}
              </button>
            </div>
          </div>

          {#if vaultInfo}
            <div class="grid gap-4 md:grid-cols-3">
              <div class="rounded-3xl border border-border/70 bg-background/70 px-5 py-4">
                <p class="text-xs uppercase tracking-[0.18em] text-muted-foreground">Current vault</p>
                <p class="mt-2 text-sm font-medium break-all">{vaultInfo.currentPath}</p>
              </div>
              <div class="rounded-3xl border border-border/70 bg-background/70 px-5 py-4">
                <p class="text-xs uppercase tracking-[0.18em] text-muted-foreground">Forgotten notes</p>
                <p class="mt-2 text-sm font-medium break-all">{vaultInfo.forgottenPath}</p>
              </div>
              <div class="rounded-3xl border border-border/70 bg-background/70 px-5 py-4">
                <p class="text-xs uppercase tracking-[0.18em] text-muted-foreground">Vault stats</p>
                <p class="mt-2 text-sm font-medium">{vaultInfo.noteCount} notes</p>
                <p class="mt-1 text-xs text-muted-foreground">
                  {vaultInfo.isDefault ? 'Using default path' : 'Custom path'} · {vaultInfo.requiresRestart ? 'restart required after changes' : 'live'}
                </p>
              </div>
            </div>
          {/if}
        </div>
      </div>

      <div class="border-t border-border/70 px-6 py-5">
        <div class="flex flex-col gap-4">
          <div>
            <p class="text-sm font-medium">Sync</p>
            <p class="mt-0.5 text-xs text-muted-foreground">
              Connect this device to a hosted or self-hosted sync server. Desktop now syncs in the background, but manual sync is still available as a direct override.
            </p>
          </div>

          <div class="grid gap-4 md:grid-cols-2">
            <label class="rounded-3xl border border-border/70 bg-background/70 px-5 py-4">
              <span class="text-xs uppercase tracking-[0.18em] text-muted-foreground">Server URL</span>
              <input
                class="mt-3 w-full bg-transparent text-sm font-medium outline-none"
                bind:value={syncBaseUrlInput}
                placeholder="http://localhost:8787"
              />
            </label>

            <label class="rounded-3xl border border-border/70 bg-background/70 px-5 py-4">
              <span class="text-xs uppercase tracking-[0.18em] text-muted-foreground">Email</span>
              <input
                class="mt-3 w-full bg-transparent text-sm font-medium outline-none"
                bind:value={syncEmailInput}
                placeholder="you@example.com"
              />
            </label>
          </div>

          <div class="grid gap-4 md:grid-cols-[1fr_auto_auto]">
            <label class="rounded-3xl border border-border/70 bg-background/70 px-5 py-4">
              <span class="text-xs uppercase tracking-[0.18em] text-muted-foreground">Magic Link Token</span>
              <input
                class="mt-3 w-full bg-transparent text-sm font-medium outline-none"
                bind:value={magicLinkTokenInput}
                placeholder="Paste the token from the magic link flow"
              />
            </label>

            <button
              class="rounded-full border border-border bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-60"
              type="button"
              disabled={isRequestingMagicLink}
              onclick={() => void requestMagicLink()}
            >
              {isRequestingMagicLink ? 'Requesting…' : 'Request magic link'}
            </button>

            <button
              class="rounded-full border border-border bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-60"
              type="button"
              disabled={isCompletingSyncSignIn}
              onclick={() => void completeSyncSignIn()}
            >
              {isCompletingSyncSignIn ? 'Signing in…' : 'Complete sign-in'}
            </button>
          </div>

          {#if lastMagicLinkResponse}
            <div class="rounded-3xl border border-border/70 bg-background/70 px-5 py-4">
              <p class="text-xs uppercase tracking-[0.18em] text-muted-foreground">Magic link</p>
              <p class="mt-2 text-sm font-medium">
                Expires {new Date(lastMagicLinkResponse.expiresAt).toLocaleString()}
              </p>
              <p class="mt-1 text-xs text-muted-foreground">
                {#if lastMagicLinkResponse.magicLinkToken}
                  Development mode returned a token directly. It has been copied into the token field above.
                {:else}
                  The server accepted the request. Use your normal magic link delivery path to retrieve the token.
                {/if}
              </p>
            </div>
          {/if}

          {#if syncStatus}
            <div class="grid gap-4 md:grid-cols-4">
              <div class="rounded-3xl border border-border/70 bg-background/70 px-5 py-4">
                <p class="text-xs uppercase tracking-[0.18em] text-muted-foreground">Device</p>
                <p class="mt-2 text-sm font-medium break-all">{syncStatus.deviceId}</p>
              </div>
              <div class="rounded-3xl border border-border/70 bg-background/70 px-5 py-4">
                <p class="text-xs uppercase tracking-[0.18em] text-muted-foreground">Tracked notes</p>
                <p class="mt-2 text-sm font-medium">{syncStatus.trackedNoteCount}</p>
                <p class="mt-1 text-xs text-muted-foreground">{syncStatus.dirtyNoteCount} dirty</p>
              </div>
              <div class="rounded-3xl border border-border/70 bg-background/70 px-5 py-4">
                <p class="text-xs uppercase tracking-[0.18em] text-muted-foreground">Conflicts</p>
                <p class="mt-2 text-sm font-medium">{syncStatus.conflictedNoteCount}</p>
                <p class="mt-1 text-xs text-muted-foreground">
                  {#if syncStatus.paused}
                    Paused on this device
                  {:else if syncStatus.linkedVault.linked}
                    Linked to remote vault
                  {:else}
                    Not signed in
                  {/if}
                </p>
              </div>
              <div class="rounded-3xl border border-border/70 bg-background/70 px-5 py-4">
                <p class="text-xs uppercase tracking-[0.18em] text-muted-foreground">Last sync</p>
                <p class="mt-2 text-sm font-medium">{formatSyncTimestamp(syncStatus.lastSyncAtMillis)}</p>
              </div>
            </div>

            <div class="flex flex-wrap items-center gap-3">
              <button
                class="rounded-full border border-border bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-60"
                type="button"
                disabled={isSyncingNow || syncStatus.paused}
                onclick={() => void runSyncNow()}
              >
                {isSyncingNow ? 'Syncing…' : 'Sync now'}
              </button>
              <button
                class="rounded-full border border-border bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-60"
                type="button"
                disabled={isTogglingSyncPause}
                onclick={() => void toggleSyncPaused()}
              >
                {#if isTogglingSyncPause}
                  {syncStatus.paused ? 'Resuming…' : 'Pausing…'}
                {:else}
                  {syncStatus.paused ? 'Resume syncing' : 'Pause syncing'}
                {/if}
              </button>
              <button
                class="rounded-full border border-border bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-60"
                type="button"
                disabled={isSigningOutSync || !syncStatus.linkedVault.linked}
                onclick={() => void signOutSync(true)}
              >
                {isSigningOutSync ? 'Signing out…' : 'Sign out'}
              </button>
              <p class="text-xs text-muted-foreground break-all">
                Server: {syncStatus.syncBaseUrl ?? 'not configured'} · Vault: {syncStatus.linkedVault.vaultId ?? 'not linked'}
              </p>
            </div>

            {#if syncStatus.paused}
              <div class="rounded-3xl border border-amber-300/60 bg-amber-50 px-5 py-4 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
                Syncing is paused on this device. Local edits still save normally and will remain dirty until you resume.
              </div>
            {/if}

            {#if syncUiMessage}
              <div class="rounded-3xl border border-emerald-300/60 bg-emerald-50 px-5 py-4 text-sm text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200">
                {syncUiMessage}
              </div>
            {/if}

            {#if syncUiError}
              <div class="rounded-3xl border border-rose-300/60 bg-rose-50 px-5 py-4 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200">
                {syncUiError}
              </div>
            {/if}

            {#if syncStatus.lastSyncError}
              <div class="rounded-3xl border border-rose-300/60 bg-rose-50 px-5 py-4 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200">
                {syncStatus.lastSyncError}
              </div>
            {/if}

            <div class="rounded-3xl border border-border/70 bg-background/70 px-5 py-4">
              <div class="flex items-start justify-between gap-4">
                <div>
                  <p class="text-xs uppercase tracking-[0.18em] text-muted-foreground">Conflict details</p>
                  <p class="mt-1 text-xs text-muted-foreground">
                    Conflicts create a preserved copy locally. Dismissing a conflict only clears the sync badge for that note.
                  </p>
                </div>
                <p class="text-sm font-medium">{syncConflicts.length}</p>
              </div>

              {#if syncConflicts.length === 0}
                <p class="mt-4 text-sm text-muted-foreground">No outstanding sync conflicts.</p>
              {:else}
                <div class="mt-4 flex flex-col gap-3">
                  {#each syncConflicts as conflict}
                    <div class="rounded-2xl border border-border/70 bg-card/80 px-4 py-3">
                      <div class="flex flex-wrap items-start justify-between gap-3">
                        <div class="min-w-0 flex-1">
                          <p class="text-sm font-medium break-words">{conflict.title}</p>
                          <p class="mt-1 text-xs text-muted-foreground break-all">{conflict.notePath}</p>
                          <p class="mt-1 text-xs text-muted-foreground">
                            {formatSyncTimestamp(conflict.updatedAtMillis)} · {conflict.deleted ? 'trashed' : 'local conflicted copy'}
                          </p>
                        </div>
                        <div class="flex items-center gap-2">
                          <button
                            class="rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-60"
                            type="button"
                            disabled={isLoadingConflictDetail && activeConflictNoteId !== conflict.noteId}
                            onclick={() => void toggleSyncConflictDetail(conflict.noteId)}
                          >
                            {#if activeConflictNoteId === conflict.noteId}
                              Hide diff
                            {:else if isLoadingConflictDetail}
                              Loading…
                            {:else}
                              View diff
                            {/if}
                          </button>
                          <button
                            class="rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-60"
                            type="button"
                            disabled={dismissingConflictNoteIds.includes(conflict.noteId)}
                            onclick={() => void dismissSyncConflict(conflict.noteId)}
                          >
                            {dismissingConflictNoteIds.includes(conflict.noteId) ? 'Dismissing…' : 'Dismiss'}
                          </button>
                        </div>
                      </div>

                      {#if activeConflictNoteId === conflict.noteId && activeConflictDetail}
                        <div class="mt-4 rounded-2xl border border-border/70 bg-background/80 p-4">
                          <div class="flex flex-col gap-1">
                            <p class="text-sm font-medium">Frozen conflict snapshots</p>
                            <p class="text-xs text-muted-foreground">
                              Original note: {activeConflictDetail.originalNotePath ?? 'unknown'}
                            </p>
                            <p class="text-xs text-muted-foreground">
                              The conflicted copy is frozen locally. This viewer shows the local version that conflicted against the remote canonical version.
                            </p>
                          </div>

                          <div class="mt-4 grid gap-4 xl:grid-cols-2">
                            <div class="rounded-2xl border border-border/70 bg-card/80 overflow-hidden">
                              <div class="border-b border-border/70 px-4 py-2">
                                <p class="text-xs uppercase tracking-[0.18em] text-muted-foreground">Local snapshot</p>
                              </div>
                              <div class="max-h-96 overflow-auto font-mono text-xs">
                                {#each buildConflictDiffRows(activeConflictDetail) as row}
                                  <div class={`grid grid-cols-[3rem_1fr] gap-3 px-3 py-1 ${conflictRowClass(row.kind)}`}>
                                    <span class="text-right text-muted-foreground">{row.lineNumber}</span>
                                    <pre class="whitespace-pre-wrap break-words text-foreground">{row.localLine || ' '}</pre>
                                  </div>
                                {/each}
                              </div>
                            </div>

                            <div class="rounded-2xl border border-border/70 bg-card/80 overflow-hidden">
                              <div class="border-b border-border/70 px-4 py-2">
                                <p class="text-xs uppercase tracking-[0.18em] text-muted-foreground">Remote snapshot</p>
                              </div>
                              <div class="max-h-96 overflow-auto font-mono text-xs">
                                {#each buildConflictDiffRows(activeConflictDetail) as row}
                                  <div class={`grid grid-cols-[3rem_1fr] gap-3 px-3 py-1 ${conflictRowClass(row.kind)}`}>
                                    <span class="text-right text-muted-foreground">{row.lineNumber}</span>
                                    <pre class="whitespace-pre-wrap break-words text-foreground">{row.remoteLine || ' '}</pre>
                                  </div>
                                {/each}
                              </div>
                            </div>
                          </div>

                          <div class="mt-4 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                            <span class="rounded-full border border-border px-3 py-1">Changed: amber</span>
                            <span class="rounded-full border border-border px-3 py-1">Local only: green</span>
                            <span class="rounded-full border border-border px-3 py-1">Remote only: blue</span>
                          </div>

                          <div class="mt-4 flex flex-wrap items-center gap-3">
                            <button
                              class="rounded-full border border-border bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-60"
                              type="button"
                              disabled={resolvingConflictNoteIds.includes(conflict.noteId)}
                              onclick={() => void resolveSyncConflict(conflict.noteId, 'keep-local')}
                            >
                              {resolvingConflictNoteIds.includes(conflict.noteId) ? 'Resolving…' : 'Keep local'}
                            </button>
                            <button
                              class="rounded-full border border-border bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-60"
                              type="button"
                              disabled={resolvingConflictNoteIds.includes(conflict.noteId)}
                              onclick={() => void resolveSyncConflict(conflict.noteId, 'keep-remote')}
                            >
                              {resolvingConflictNoteIds.includes(conflict.noteId) ? 'Resolving…' : 'Keep remote'}
                            </button>
                            <p class="text-xs text-muted-foreground">
                              `Keep local` restores your frozen local snapshot into the canonical note and queues it for sync. `Keep remote` discards the frozen local conflict copy.
                            </p>
                          </div>
                        </div>
                      {/if}
                    </div>
                  {/each}
                </div>
              {/if}
            </div>
          {/if}
        </div>
      </div>

      <div class="border-t border-border/70 px-6 py-5">
        <div class="flex items-start justify-between gap-4">
          <div>
            <p class="text-sm font-medium">Semantic Layer</p>
            <p class="mt-0.5 text-xs text-muted-foreground">
              Local-first semantic indexing stays on top of your markdown files instead of replacing them.
            </p>
          </div>

          <button
            class="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            type="button"
            onclick={() => void loadSemanticState()}
          >
            <RefreshCcw class="h-4 w-4" />
            Refresh
          </button>
        </div>

        {#if semanticSettings && semanticStatus}
          <div class="mt-6 grid gap-4 md:grid-cols-2">
            <label class="rounded-3xl border border-border/70 bg-background/70 px-5 py-4">
              <div class="flex items-start justify-between gap-4">
                <div>
                  <p class="text-sm font-medium">Semantic Search</p>
                  <p class="mt-1 text-xs text-muted-foreground">Blend semantic matches into the existing keyword search.</p>
                </div>
                <input
                  type="checkbox"
                  checked={semanticSettings.semanticSearchEnabled}
                  onchange={(event) => updateSetting('semanticSearchEnabled', (event.currentTarget as HTMLInputElement).checked)}
                />
              </div>
            </label>

            <label class="rounded-3xl border border-border/70 bg-background/70 px-5 py-4">
              <div class="flex items-start justify-between gap-4">
                <div>
                  <p class="text-sm font-medium">Local-only Mode</p>
                  <p class="mt-1 text-xs text-muted-foreground">Refuse any model download flow and stay offline.</p>
                </div>
                <input
                  type="checkbox"
                  checked={semanticSettings.localOnlyMode}
                  onchange={(event) => updateSetting('localOnlyMode', (event.currentTarget as HTMLInputElement).checked)}
                />
              </div>
            </label>

            <label class="rounded-3xl border border-border/70 bg-background/70 px-5 py-4">
              <div class="flex items-start justify-between gap-4">
                <div>
                  <p class="text-sm font-medium">Auto-download Models</p>
                  <p class="mt-1 text-xs text-muted-foreground">Reserved for future runtime providers that need local model files.</p>
                </div>
                <input
                  type="checkbox"
                  checked={semanticSettings.autoDownloadModel}
                  onchange={(event) => updateSetting('autoDownloadModel', (event.currentTarget as HTMLInputElement).checked)}
                />
              </div>
            </label>
          </div>

          <div class="mt-6 grid gap-4 md:grid-cols-3">
            <div class="rounded-3xl border border-border/70 bg-background/70 px-5 py-4">
              <p class="text-xs uppercase tracking-[0.18em] text-muted-foreground">Model</p>
              <p class="mt-2 text-sm font-medium">{semanticStatus.model.label}</p>
              <p class="mt-1 text-xs text-muted-foreground">
                {semanticStatus.model.dimensions} dimensions · {semanticStatus.model.status}
              </p>
              <p class="mt-1 text-xs text-muted-foreground">
                Runtime: {semanticStatus.model.runtimeBinaryPath ?? 'not installed'}
              </p>
              <p class="mt-1 text-xs text-muted-foreground">
                Model: {semanticStatus.model.modelPath ?? semanticStatus.model.modelRepoId}
              </p>
            </div>

            <div class="rounded-3xl border border-border/70 bg-background/70 px-5 py-4">
              <p class="text-xs uppercase tracking-[0.18em] text-muted-foreground">Index</p>
              <p class="mt-2 text-sm font-medium">{semanticStatus.indexedNotes} notes</p>
              <p class="mt-1 text-xs text-muted-foreground">{semanticStatus.indexedChunks} chunks · last run {formatTimestamp(semanticStatus.lastIndexedAtMillis)}</p>
            </div>

            <div class="rounded-3xl border border-border/70 bg-background/70 px-5 py-4">
              <p class="text-xs uppercase tracking-[0.18em] text-muted-foreground">ANN</p>
              <p class="mt-2 text-sm font-medium">
                {semanticStatus.annIndexLoaded ? 'Loaded' : 'Pending rebuild'}
              </p>
              <p class="mt-1 text-xs text-muted-foreground">
                {semanticStatus.annIndexedChunks} indexed chunks · dirty {semanticStatus.annIndexDirty ? 'yes' : 'no'}
              </p>
              <p class="mt-1 text-xs text-muted-foreground">
                rebuild pending {semanticStatus.annRebuildPending ? 'yes' : 'no'} · dump {formatTimestamp(semanticStatus.annLastDumpedAtMillis)}
              </p>
            </div>

            <div class="rounded-3xl border border-border/70 bg-background/70 px-5 py-4">
              <p class="text-xs uppercase tracking-[0.18em] text-muted-foreground">Status</p>
              <p class="mt-2 text-sm font-medium">
                {#if semanticStatus.indexingPaused}
                  Paused
                {:else if semanticStatus.indexingInProgress}
                  {semanticStatus.currentJobLabel ?? 'Indexing'}
                {:else}
                  Ready
                {/if}
              </p>
              <p class="mt-1 text-xs text-muted-foreground">Model available: {semanticStatus.modelAvailable ? 'yes' : 'no'}</p>
            </div>
          </div>

          <div class="mt-6 flex flex-wrap items-center gap-3">
            <button
              class="rounded-full border border-border bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent"
              type="button"
              disabled={isRunningAction}
              onclick={() => void runAction('prepare_semantic_model')}
            >
              Prepare local model
            </button>

            <button
              class="rounded-full border border-border bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent"
              type="button"
              disabled={isRunningAction}
              onclick={() => void runAction('rebuild_semantic_index')}
            >
              Rebuild semantic index
            </button>

            <button
              class="rounded-full border border-border bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent"
              type="button"
              disabled={isRunningAction}
              onclick={() =>
                void runAction(
                  semanticStatus?.indexingPaused ? 'resume_semantic_indexing' : 'pause_semantic_indexing'
                )}
            >
              {semanticStatus.indexingPaused ? 'Resume indexing' : 'Pause indexing'}
            </button>

            {#if isSaving || isRunningAction}
              <p class="text-xs uppercase tracking-[0.18em] text-muted-foreground">Updating…</p>
            {/if}
          </div>

          {#if semanticStatus.latestJob}
            <div class="mt-6 rounded-3xl border border-border/70 bg-background/70 px-5 py-4">
              <p class="text-xs uppercase tracking-[0.18em] text-muted-foreground">Latest job</p>
              <p class="mt-2 text-sm font-medium">
                {semanticStatus.latestJob.status} · scanned {semanticStatus.latestJob.scannedCount} · embedded {semanticStatus.latestJob.embeddedCount}
              </p>
              <p class="mt-1 text-xs text-muted-foreground">
                Started {formatTimestamp(semanticStatus.latestJob.startedAtMillis)} · Updated {formatTimestamp(semanticStatus.latestJob.updatedAtMillis)}
              </p>
            </div>
          {/if}

          {#if semanticStatus.lastError || semanticStatus.latestJob?.errorText}
            <div class="mt-6 rounded-3xl border border-rose-300/60 bg-rose-50 px-5 py-4 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200">
              {semanticStatus.lastError ?? semanticStatus.model.error ?? semanticStatus.latestJob?.errorText}
            </div>
          {/if}

          {#if semanticDebug}
            {@const metrics = semanticDebug.metrics}
            <div class="mt-6 rounded-3xl border border-border/70 bg-background/70 px-5 py-4">
              <div class="flex items-start justify-between gap-4">
                <div>
                  <p class="text-xs uppercase tracking-[0.18em] text-muted-foreground">Diagnostics</p>
                  <p class="mt-2 text-sm font-medium">Live semantic telemetry</p>
                  <p class="mt-1 text-xs text-muted-foreground">
                    Captured {formatTimestamp(semanticDebug.capturedAtMillis)}
                  </p>
                </div>

                <div class="flex flex-wrap items-center gap-2">
                  <button
                    class="rounded-full border border-border bg-background px-3 py-2 text-xs font-medium transition-colors hover:bg-accent"
                    type="button"
                    onclick={() => void loadSemanticState()}
                  >
                    Refresh diagnostics
                  </button>
                  <button
                    class="rounded-full border border-border bg-background px-3 py-2 text-xs font-medium transition-colors hover:bg-accent"
                    type="button"
                    onclick={() => void clearDebugMetrics()}
                  >
                    Clear diagnostics
                  </button>
                </div>
              </div>

              <div class="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <div class="rounded-2xl border border-border/70 bg-card/70 px-4 py-3">
                  <p class="text-xs uppercase tracking-[0.18em] text-muted-foreground">Embeddings</p>
                  <p class="mt-2 text-sm font-medium">{metrics.embeddingRequestCount} requests</p>
                  <p class="mt-1 text-xs text-muted-foreground">
                    avg {formatMillis(averageDuration(metrics.embeddingDurationTotalMillis, metrics.embeddingRequestCount))}
                    · max {formatMillis(metrics.embeddingDurationMaxMillis)}
                  </p>
                  <p class="mt-1 text-xs text-muted-foreground">
                    texts {metrics.embeddingTextCountTotal} · chars {metrics.embeddingCharCountTotal}
                  </p>
                </div>

                <div class="rounded-2xl border border-border/70 bg-card/70 px-4 py-3">
                  <p class="text-xs uppercase tracking-[0.18em] text-muted-foreground">Runtime</p>
                  <p class="mt-2 text-sm font-medium">
                    spawns {metrics.runtimeSpawnCount} · restarts {metrics.runtimeRestartCount}
                  </p>
                  <p class="mt-1 text-xs text-muted-foreground">
                    ready {metrics.runtimeReadyCount} · shutdowns {metrics.runtimeShutdownCount}
                  </p>
                  <p class="mt-1 text-xs text-muted-foreground">
                    warmup {formatMillis(metrics.modelWarmupLastMillis)} · prepare {formatMillis(metrics.modelPrepareLastMillis)}
                  </p>
                </div>

                <div class="rounded-2xl border border-border/70 bg-card/70 px-4 py-3">
                  <p class="text-xs uppercase tracking-[0.18em] text-muted-foreground">Requests</p>
                  <p class="mt-2 text-sm font-medium">
                    search {metrics.searchRequestCount} · map {metrics.mapRequestCount}
                  </p>
                  <p class="mt-1 text-xs text-muted-foreground">
                    search semantic used {metrics.searchSemanticUsedCount} · skipped {metrics.searchSemanticSkippedCount}
                  </p>
                </div>

                <div class="rounded-2xl border border-border/70 bg-card/70 px-4 py-3">
                  <p class="text-xs uppercase tracking-[0.18em] text-muted-foreground">ANN Queries</p>
                  <p class="mt-2 text-sm font-medium">{metrics.annQueryCount} queries</p>
                  <p class="mt-1 text-xs text-muted-foreground">
                    candidates {metrics.annQueryCandidateTotal} · reranked {metrics.annQueryRerankTotal}
                  </p>
                  <p class="mt-1 text-xs text-muted-foreground">
                    avg {formatMillis(averageDuration(metrics.annQueryDurationTotalMillis, metrics.annQueryCount))}
                    · max {formatMillis(metrics.annQueryDurationMaxMillis)}
                  </p>
                </div>

                <div class="rounded-2xl border border-border/70 bg-card/70 px-4 py-3">
                  <p class="text-xs uppercase tracking-[0.18em] text-muted-foreground">Index</p>
                  <p class="mt-2 text-sm font-medium">
                    jobs {metrics.indexJobStartedCount} · zero-work {metrics.indexZeroWorkCount}
                  </p>
                  <p class="mt-1 text-xs text-muted-foreground">
                    scanned {metrics.indexScannedTotal} · embedded {metrics.indexEmbeddedTotal}
                  </p>
                  <p class="mt-1 text-xs text-muted-foreground">
                    avg {formatMillis(averageDuration(metrics.indexDurationTotalMillis, metrics.indexJobCompletedCount + metrics.indexJobFailedCount))}
                    · max {formatMillis(metrics.indexDurationMaxMillis)}
                  </p>
                </div>
              </div>

              <div class="mt-4 grid gap-4 md:grid-cols-2">
                <div class="rounded-2xl border border-border/70 bg-card/70 px-4 py-3">
                  <p class="text-xs uppercase tracking-[0.18em] text-muted-foreground">Failures</p>
                  <p class="mt-2 text-sm font-medium">
                    embedding {metrics.embeddingRequestFailureCount} · index {metrics.indexJobFailedCount} · ann {metrics.annLoadFailureCount + metrics.annUpdateFailureCount}
                  </p>
                  <p class="mt-1 text-xs text-muted-foreground">
                    prepare {metrics.modelPrepareFailureCount} · warmup {metrics.modelWarmupFailureCount} · timeouts {metrics.runtimeTimeoutCount}
                  </p>
                </div>

                <div class="rounded-2xl border border-border/70 bg-card/70 px-4 py-3">
                  <p class="text-xs uppercase tracking-[0.18em] text-muted-foreground">ANN Lifecycle</p>
                  <p class="mt-2 text-sm font-medium">
                    loads {metrics.annLoadSuccessCount} · rebuilds {metrics.annRebuildCount}
                  </p>
                  <p class="mt-1 text-xs text-muted-foreground">
                    pending {metrics.annRebuildPendingCount} · update failures {metrics.annUpdateFailureCount}
                  </p>
                  <p class="mt-1 text-xs text-muted-foreground">
                    avg {formatMillis(averageDuration(metrics.annRebuildDurationTotalMillis, metrics.annRebuildCount))}
                    · max {formatMillis(metrics.annRebuildDurationMaxMillis)}
                  </p>
                </div>
              </div>

              <div class="mt-4 rounded-2xl border border-border/70 bg-card/70 px-4 py-3">
                <p class="text-xs uppercase tracking-[0.18em] text-muted-foreground">Recent Events</p>
                <div class="mt-3 max-h-72 overflow-y-auto space-y-2">
                  {#if semanticDebug.recentEvents.length === 0}
                    <p class="text-sm text-muted-foreground">No events captured yet.</p>
                  {:else}
                    {#each semanticDebug.recentEvents as event}
                      <div class="rounded-xl border border-border/70 bg-background/80 px-3 py-2">
                        <div class="flex items-center justify-between gap-3">
                          <p class="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                            {event.category} · {event.action}
                          </p>
                          <p class="text-[11px] text-muted-foreground">
                            {formatTimestamp(event.timestampMillis)}
                          </p>
                        </div>
                        {#if event.detail}
                          <p class="mt-1 text-sm text-foreground break-words">{event.detail}</p>
                        {/if}
                        {#if event.durationMillis !== null}
                          <p class="mt-1 text-xs text-muted-foreground">Duration {formatMillis(event.durationMillis)}</p>
                        {/if}
                      </div>
                    {/each}
                  {/if}
                </div>
              </div>
            </div>
          {/if}
        {/if}
      </div>
      {:else}
        <div class="border-t border-border/70 px-6 py-5">
          <div class="flex items-start justify-between gap-4">
            <div>
              <p class="text-sm font-medium">Forgotten Notes</p>
              <p class="mt-0.5 text-xs text-muted-foreground">
                Review notes in `.forgotten`, then restore or permanently delete them.
              </p>
            </div>

            <button
              class="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
              type="button"
              disabled={isLoadingForgottenNotes || isUpdatingForgottenNotes}
              onclick={() => void loadForgottenNotes()}
            >
              <RefreshCcw class="h-4 w-4" />
              Refresh
            </button>
          </div>

          <div class="mt-6 rounded-3xl border border-border/70 bg-background/70 px-5 py-4">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <label class="inline-flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={allForgottenSelected}
                  onchange={(event) =>
                    toggleAllForgottenSelections((event.currentTarget as HTMLInputElement).checked)}
                />
                <span>Select all</span>
              </label>

              <div class="flex flex-wrap items-center gap-2">
                <button
                  class="rounded-full border border-border bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                  type="button"
                  disabled={selectedForgottenPaths.length === 0 || isUpdatingForgottenNotes}
                  onclick={() =>
                    void runForgottenAction('restore_forgotten_notes', selectedForgottenPaths)}
                >
                  Restore selected
                </button>
                <button
                  class="rounded-full border border-rose-300/70 bg-rose-50 px-4 py-2 text-sm font-medium text-rose-700 transition-colors hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200"
                  type="button"
                  disabled={selectedForgottenPaths.length === 0 || isUpdatingForgottenNotes}
                  onclick={() =>
                    void runForgottenAction('delete_forgotten_notes', selectedForgottenPaths)}
                >
                  Delete selected
                </button>
              </div>
            </div>

            {#if isLoadingForgottenNotes}
              <p class="mt-4 text-sm text-muted-foreground">Loading forgotten notes…</p>
            {:else if forgottenNotes.length === 0}
              <p class="mt-4 text-sm text-muted-foreground">No forgotten notes right now.</p>
            {:else}
              <div class="mt-4 space-y-3">
                {#each forgottenNotes as note}
                  <div class="rounded-2xl border border-border/70 bg-card/70 px-4 py-4">
                    <div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div class="flex items-start gap-3">
                        <input
                          class="mt-1"
                          type="checkbox"
                          checked={selectedForgottenPaths.includes(note.forgottenPath)}
                          onchange={(event) =>
                            toggleForgottenSelection(
                              note.forgottenPath,
                              (event.currentTarget as HTMLInputElement).checked
                            )}
                        />

                        <div>
                          <p class="text-sm font-medium">{note.title}</p>
                          <p class="mt-1 text-xs text-muted-foreground">
                            {note.fileName} · forgotten {formatTimestamp(note.forgottenAtMillis)}
                          </p>
                          <p class="mt-1 text-xs text-muted-foreground">
                            Purges {formatTimestamp(note.purgeAtMillis)} after {formatForgottenRetention(note.purgeAfterDays)}
                          </p>
                          <p class="mt-1 break-all text-xs text-muted-foreground">
                            Original path: {note.originalPath}
                          </p>
                        </div>
                      </div>

                      <div class="flex flex-wrap items-center gap-2">
                        <button
                          class="rounded-full border border-border bg-background px-3 py-2 text-sm font-medium transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                          type="button"
                          disabled={isUpdatingForgottenNotes}
                          onclick={() =>
                            void runForgottenAction('restore_forgotten_notes', [note.forgottenPath])}
                        >
                          Restore
                        </button>
                        <button
                          class="rounded-full border border-rose-300/70 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700 transition-colors hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200"
                          type="button"
                          disabled={isUpdatingForgottenNotes}
                          onclick={() =>
                            void runForgottenAction('delete_forgotten_notes', [note.forgottenPath])}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        </div>
      {/if}
    </section>
  </main>
</div>
