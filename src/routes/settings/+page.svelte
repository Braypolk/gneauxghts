<script lang="ts">
  import { listen, type UnlistenFn } from '@tauri-apps/api/event';
  import { Monitor, Moon, RefreshCcw, Sun } from 'lucide-svelte';
  import { onDestroy, onMount } from 'svelte';
  import AiRememberSettingsPanel from '$lib/features/settings/AiRememberSettingsPanel.svelte';
  import ForgottenNotesPanel from '$lib/features/settings/ForgottenNotesPanel.svelte';
  import SemanticSettingsPanel from '$lib/features/settings/SemanticSettingsPanel.svelte';
  import SyncSettingsPanel from '$lib/features/settings/SyncSettingsPanel.svelte';
  import {
    createForgottenNotesController,
    formatForgottenRetention
  } from '$lib/features/settings/forgottenNotesController';
  import {
    averageDuration,
    createSemanticSettingsController,
    formatMillis,
    formatTimestamp
  } from '$lib/features/settings/semanticSettingsController';
  import {
    buildConflictDiffRows,
    conflictRowClass,
    createSyncSettingsController,
    formatSyncTimestamp
  } from '$lib/features/settings/syncSettingsController';
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
    SyncConflict,
    SyncConflictDetail,
    SyncStatus,
    VaultInfo
  } from '$lib/types/sync';
  import type {
    RequestMagicLinkResponse
  } from '$lib/types/sync';
  import type { SemanticDebugSnapshot, SemanticSettings, SemanticStatus } from '$lib/types/semantic';

  type SettingsTab = 'general' | 'forgotten';
  type GeneralSection = 'appearance' | 'forgetting' | 'ai' | 'vault' | 'sync' | 'search';

  const generalSectionsNav: {
    id: GeneralSection;
    label: string;
    description: string;
  }[] = [
    { id: 'appearance', label: 'Appearance', description: 'Theme and display' },
    {
      id: 'forgetting',
      label: 'Forgetting',
      description: 'Forget button timing and trash retention'
    },
    { id: 'ai', label: 'AI & Remember', description: 'Connection, defaults, and token usage' },
    { id: 'vault', label: 'Vault', description: 'Where your notes are stored' },
    { id: 'sync', label: 'Sync', description: 'Account, server, and conflicts' },
    { id: 'search', label: 'Semantic search', description: 'Local index and embeddings' }
  ];

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
  let activeGeneralSection = $state<GeneralSection>('appearance');
  const activeSectionMeta = $derived(
    generalSectionsNav.find((s) => s.id === activeGeneralSection) ?? generalSectionsNav[0]
  );
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
  const forgottenNotesController = createForgottenNotesController({
    getSelectedForgottenPaths: () => selectedForgottenPaths,
    setSelectedForgottenPaths: (value) => (selectedForgottenPaths = value),
    getForgottenNotes: () => forgottenNotes,
    setForgottenNotes: (value) => (forgottenNotes = value),
    setIsLoadingForgottenNotes: (value) => (isLoadingForgottenNotes = value),
    setIsUpdatingForgottenNotes: (value) => (isUpdatingForgottenNotes = value)
  });

  const {
    loadForgottenNotes,
    runForgottenAction,
    toggleForgottenSelection,
    toggleAllForgottenSelections
  } = forgottenNotesController;

  const semanticController = createSemanticSettingsController({
    getSemanticStatus: () => semanticStatus,
    setSemanticStatus: (value) => (semanticStatus = value),
    getSemanticSettings: () => semanticSettings,
    setSemanticSettings: (value) => (semanticSettings = value),
    setSemanticDebug: (value) => (semanticDebug = value),
    setVaultInfo: (value) => (vaultInfo = value),
    setSyncStatus: (value) => (syncStatus = value),
    setSyncConflicts: (value) => (syncConflicts = value),
    getVaultPathInput: () => vaultPathInput,
    setVaultPathInput: (value) => (vaultPathInput = value),
    getSyncBaseUrlInput: () => syncBaseUrlInput,
    setSyncBaseUrlInput: (value) => (syncBaseUrlInput = value),
    getSyncEmailInput: () => syncEmailInput,
    setSyncEmailInput: (value) => (syncEmailInput = value),
    getIsSaving: () => isSaving,
    setIsSaving: (value) => (isSaving = value),
    getIsRunningAction: () => isRunningAction,
    setIsRunningAction: (value) => (isRunningAction = value)
  });

  const {
    stopSemanticPolling,
    syncSemanticPolling,
    loadSemanticStatus,
    loadSemanticState,
    updateSetting,
    runAction,
    clearDebugMetrics
  } = semanticController;

  const syncController = createSyncSettingsController({
    getVaultPathInput: () => vaultPathInput,
    setVaultInfo: (value) => (vaultInfo = value),
    setSyncStatus: (value) => (syncStatus = value),
    getSyncStatus: () => syncStatus,
    getSyncBaseUrlInput: () => syncBaseUrlInput,
    getSyncEmailInput: () => syncEmailInput,
    getMagicLinkTokenInput: () => magicLinkTokenInput,
    setMagicLinkTokenInput: (value) => (magicLinkTokenInput = value),
    setLastMagicLinkResponse: (value) => (lastMagicLinkResponse = value),
    setSyncConflicts: (value) => (syncConflicts = value),
    getActiveConflictNoteId: () => activeConflictNoteId,
    setActiveConflictNoteId: (value) => (activeConflictNoteId = value),
    getActiveConflictDetail: () => activeConflictDetail,
    setActiveConflictDetail: (value) => (activeConflictDetail = value),
    getDismissingConflictNoteIds: () => dismissingConflictNoteIds,
    setDismissingConflictNoteIds: (value) => (dismissingConflictNoteIds = value),
    getResolvingConflictNoteIds: () => resolvingConflictNoteIds,
    setResolvingConflictNoteIds: (value) => (resolvingConflictNoteIds = value),
    setSyncUiError: (value) => (syncUiError = value),
    setSyncUiMessage: (value) => (syncUiMessage = value),
    setIsSavingVault: (value) => (isSavingVault = value),
    setIsRequestingMagicLink: (value) => (isRequestingMagicLink = value),
    setIsCompletingSyncSignIn: (value) => (isCompletingSyncSignIn = value),
    setIsSyncingNow: (value) => (isSyncingNow = value),
    setIsTogglingSyncPause: (value) => (isTogglingSyncPause = value),
    setIsSigningOutSync: (value) => (isSigningOutSync = value),
    setIsLoadingConflictDetail: (value) => (isLoadingConflictDetail = value),
    loadSemanticState,
    loadForgottenNotes
  });

  const {
    saveVaultDirectory,
    requestMagicLink,
    completeSyncSignIn,
    runSyncNow,
    signOutSync,
    dismissSyncConflict,
    toggleSyncConflictDetail,
    resolveSyncConflict,
    toggleSyncPaused
  } = syncController;

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
  <main class="mx-auto flex min-h-full w-full max-w-6xl items-start justify-center px-0 pb-6 sm:px-2 sm:pb-10">
    <section class="mt-0 w-full overflow-hidden border-y border-border/80 bg-card/80 shadow-sm backdrop-blur-md sm:mt-2 sm:rounded-[1.75rem] sm:border">
      <div class="px-4 py-4 sm:px-6 sm:py-5">
        <p class="text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">Settings</p>
      </div>

      <div class="border-t border-border/70 px-4 py-3 sm:px-6 sm:py-4">
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
      <div class="border-t border-border/70">
        <div
          class="flex flex-col lg:grid lg:grid-cols-[minmax(10.5rem,13.5rem)_minmax(0,1fr)] lg:items-start lg:divide-x lg:divide-border/70"
        >
          <nav
            class="flex gap-2 overflow-x-auto overscroll-x-contain border-b border-border/70 px-4 py-3 [-ms-overflow-style:none] [scrollbar-width:none] sm:px-6 lg:sticky lg:top-4 lg:z-10 lg:max-h-[min(100vh-5rem,52rem)] lg:flex-col lg:overflow-y-auto lg:overflow-x-visible lg:border-b-0 lg:bg-card/90 lg:px-3 lg:py-6 lg:backdrop-blur-sm xl:px-4 [&::-webkit-scrollbar]:hidden"
            aria-label="Settings categories"
          >
            {#each generalSectionsNav as item}
              <button
                type="button"
                class={`shrink-0 rounded-xl border px-3 py-2 text-left transition-colors lg:w-full lg:px-3.5 lg:py-2.5 ${
                  activeGeneralSection === item.id
                    ? 'border-border bg-foreground text-background shadow-sm'
                    : 'border-transparent bg-muted/30 text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                }`}
                aria-current={activeGeneralSection === item.id ? 'page' : undefined}
                onclick={() => (activeGeneralSection = item.id)}
              >
                <span class="block text-sm font-medium">{item.label}</span>
                <span
                  class={`mt-0.5 hidden text-xs leading-snug sm:block lg:mt-1 ${
                    activeGeneralSection === item.id ? 'text-background/75' : ''
                  }`}
                >
                  {item.description}
                </span>
              </button>
            {/each}
          </nav>

          <div class="min-w-0 px-4 pb-10 pt-5 sm:px-6 lg:px-8 lg:pb-12 lg:pt-8">
            <header class="mb-6 border-b border-border/60 pb-5">
              <h2 class="text-lg font-semibold tracking-tight">{activeSectionMeta.label}</h2>
              <p class="mt-1 text-sm text-muted-foreground">{activeSectionMeta.description}</p>
            </header>

            {#if activeGeneralSection === 'appearance'}
              <div class="rounded-2xl border border-border/70 bg-background/40 px-5 py-5 sm:px-6">
                <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p class="text-sm font-medium">Theme</p>
                    <p class="mt-0.5 text-xs text-muted-foreground">Auto follows your system appearance.</p>
                  </div>

                  <fieldset
                    class="flex shrink-0 flex-wrap items-center gap-1 rounded-full border border-border/80 bg-background/60 p-1"
                  >
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
            {:else if activeGeneralSection === 'forgetting'}
              <div class="space-y-5">
                <div class="rounded-2xl border border-border/70 bg-background/40 px-5 py-5 sm:px-6">
                  <div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <p class="text-sm font-medium">Forget button duration</p>
                      <p class="mt-0.5 text-xs text-muted-foreground">
                        Choose whether forgetting happens instantly or after a hold.
                      </p>
                    </div>

                    <fieldset
                      class="flex shrink-0 flex-wrap items-center gap-1 rounded-full border border-border/80 bg-background/60 p-1"
                    >
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

                <div class="rounded-2xl border border-border/70 bg-background/40 px-5 py-5 sm:px-6">
                  <div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <p class="text-sm font-medium">Forgotten note retention</p>
                      <p class="mt-0.5 text-xs text-muted-foreground">
                        Forgotten notes move into `.forgotten` before they are permanently deleted.
                      </p>
                    </div>

                    <fieldset
                      class="flex shrink-0 flex-wrap items-center gap-1 rounded-full border border-border/80 bg-background/60 p-1"
                    >
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

                <p class="text-center text-sm text-muted-foreground">
                  To restore or permanently delete notes in
                  <code class="rounded bg-muted/50 px-1 py-0.5 text-xs">.forgotten</code>
                  , open the
                  <button
                    type="button"
                    class="font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground"
                    onclick={() => {
                      activeTab = 'forgotten';
                      void loadForgottenNotes();
                    }}
                  >
                    Forgotten Notes
                  </button>
                  tab.
                </p>
              </div>
            {:else if activeGeneralSection === 'ai'}
              <AiRememberSettingsPanel />
            {:else if activeGeneralSection === 'vault'}
              <div class="flex flex-col gap-4">
          <div class="flex items-start justify-between gap-4">
            <div>
              <p class="text-sm font-medium">Vault Directory</p>
              <p class="mt-0.5 text-xs text-muted-foreground">
                {#if vaultInfo?.canConfigurePath ?? true}
                  Desktop vaults can live in any normal folder. Changing the directory updates future note IO and takes full effect after restarting the app.
                {:else}
                  iPhone builds currently keep notes inside the app sandbox. Custom vault locations are disabled for now.
                {/if}
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
                disabled={!(vaultInfo?.canConfigurePath ?? true)}
              />
            </label>

            <div class="flex items-center gap-2 md:justify-end">
              <button
                class="rounded-full border border-border bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-60"
                type="button"
                disabled={isSavingVault || !(vaultInfo?.canConfigurePath ?? true)}
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
                disabled={isSavingVault || !(vaultInfo?.canConfigurePath ?? true)}
                onclick={() => void saveVaultDirectory()}
              >
                {isSavingVault ? 'Saving…' : 'Save vault'}
              </button>
            </div>
          </div>

          {#if vaultInfo?.pathConfigurationNote}
            <div class="rounded-3xl border border-sky-300/60 bg-sky-50 px-5 py-4 text-sm text-sky-700 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-200">
              {vaultInfo.pathConfigurationNote}
            </div>
          {/if}

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
            {:else if activeGeneralSection === 'sync'}
      <SyncSettingsPanel
        embedded
        {syncStatus}
        {syncConflicts}
        bind:syncBaseUrlInput
        bind:syncEmailInput
        bind:magicLinkTokenInput
        {lastMagicLinkResponse}
        {activeConflictNoteId}
        {activeConflictDetail}
        {isRequestingMagicLink}
        {isCompletingSyncSignIn}
        {isSyncingNow}
        {isTogglingSyncPause}
        {isSigningOutSync}
        {isLoadingConflictDetail}
        {dismissingConflictNoteIds}
        {resolvingConflictNoteIds}
        {syncUiError}
        {syncUiMessage}
        {requestMagicLink}
        {completeSyncSignIn}
        {runSyncNow}
        {signOutSync}
        {dismissSyncConflict}
        {toggleSyncConflictDetail}
        {resolveSyncConflict}
        {toggleSyncPaused}
        {formatSyncTimestamp}
        {buildConflictDiffRows}
        {conflictRowClass}
      />

            {:else if activeGeneralSection === 'search'}
      <SemanticSettingsPanel
        embedded
        {semanticSettings}
        {semanticStatus}
        {semanticDebug}
        {isSaving}
        {isRunningAction}
        {loadSemanticState}
        {updateSetting}
        {runAction}
        {clearDebugMetrics}
        {formatTimestamp}
        {formatMillis}
        {averageDuration}
      />
            {/if}
          </div>
        </div>
      </div>
      {:else}
        <ForgottenNotesPanel
          {forgottenNotes}
          {allForgottenSelected}
          {selectedForgottenPaths}
          {isLoadingForgottenNotes}
          {isUpdatingForgottenNotes}
          {loadForgottenNotes}
          {runForgottenAction}
          {toggleForgottenSelection}
          {toggleAllForgottenSelections}
          {formatTimestamp}
          {formatForgottenRetention}
        />
      {/if}
    </section>
  </main>
</div>
