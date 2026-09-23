<script lang="ts">
  import { Monitor, Moon, RefreshCcw, Sun, FolderOpen, Search, X, ArrowUpRight, Palette, Keyboard, Timer, Sparkles, ScanSearch, History, ArchiveRestore } from '@lucide/svelte';
  import { onDestroy, onMount, tick } from 'svelte';
  import ForgottenNotesPanel from '$lib/features/settings/ForgottenNotesPanel.svelte';
  import MissingNotesPanel from '$lib/features/settings/MissingNotesPanel.svelte';
  import KeyboardShortcutsPanel from '$lib/features/settings/KeyboardShortcutsPanel.svelte';
  import SemanticSettingsPanel from '$lib/features/settings/SemanticSettingsPanel.svelte';
  import ChatSettingsPanel from '$lib/features/settings/ChatSettingsPanel.svelte';
  import EditorTextSizePanel from '$lib/features/settings/EditorTextSizePanel.svelte';
  import HistorySettingsPanel from '$lib/features/settings/HistorySettingsPanel.svelte';
  import SettingsCard from '$lib/features/settings/SettingsCard.svelte';
  import SettingsLabel from '$lib/features/settings/SettingsLabel.svelte';
  import {
    averageDuration,
    formatMillis,
    formatForgottenRetention,
    formatTimestamp
  } from '$lib/features/settings/formatters';
  import {
    appSettings,
    forgetButtonDurationOptions,
    forgottenNoteRetentionOptions,
    setForgottenNoteRetentionPreference,
    setForgetButtonDurationPreference
  } from '$lib/appSettings.svelte';
  import {
    setThemePreference,
    themeOptions,
    themeStore,
    type ThemePreference
  } from '$lib/theme.svelte';
  import { createSettingsStore } from '$lib/features/settings/store.svelte';
  import { logDevError } from '$lib/logDevError';

  import { settingsCategories, settingsSearchEntries, searchSettings, type SettingsCategory, type SettingsSearchEntry } from '$lib/features/settings/settingsCatalog';
  import { keyboardShortcutDefinitions } from '$lib/keyboardShortcuts.svelte';
  import '$lib/features/settings/settings.css';

  const categoryIcons = { appearance: Palette, shortcuts: Keyboard, forgetting: Timer, ai: Sparkles, search: ScanSearch, vault: FolderOpen, history: History, forgotten: ArchiveRestore };
  const categoryGroups = [...new Set(settingsCategories.map((item) => item.group))];
  const searchEntries: SettingsSearchEntry[] = [
    ...settingsSearchEntries,
    ...keyboardShortcutDefinitions.map((shortcut) => ({
      id: `shortcut-${shortcut.id}`, category: 'shortcuts' as const,
      title: shortcut.label, description: shortcut.description,
      keywords: 'keyboard shortcut key binding hotkey', anchor: `shortcut-${shortcut.id}`
    }))
  ];
  let query = $state('');
  let searchInput: HTMLInputElement;
  let content: HTMLDivElement;
  let destination = $state<string | null>(null);
  const searching = $derived(query.trim().length > 0);
  const results = $derived(searchSettings(query, searchEntries));
  const themeIcons: Record<ThemePreference, typeof Monitor> = {
    auto: Monitor,
    light: Sun,
    dark: Moon
  };

  const settings = createSettingsStore();
  const activeCategory = $derived(settings.activeTab === 'forgotten' ? 'forgotten' : settings.activeGeneralSection);
  const activeSectionMeta = $derived(settingsCategories.find((item) => item.id === activeCategory)!);

  async function selectCategory(category: SettingsCategory, anchor: string | null = null) {
    destination = null;
    query = '';
    if (category === 'forgotten') {
      settings.setActiveTab('forgotten');
      void settings.loadForgottenNotes();
    } else {
      settings.setActiveTab('general');
      settings.setActiveGeneralSection(category);
    }
    await tick();
    content?.scrollTo({ top: 0 });
    destination = anchor;
    if (!anchor) content?.querySelector<HTMLElement>('#settings-category-title')?.focus({ preventScroll: true });
  }

  function clearSearch() {
    query = '';
    searchInput?.focus();
  }

  // Panels may load asynchronously. Reveal the destination as soon as its
  // presentation anchor exists, without touching the setting's value.
  $effect(() => {
    const anchor = destination;
    if (!anchor || !content || searching) return;
    let highlighted: HTMLElement | null = null;
    const reveal = () => {
      const element = content.querySelector<HTMLElement>(`[data-settings-anchor="${anchor}"]`)
        // Provider-specific fields may not apply to the current provider/model.
        ?? (anchor.startsWith('chat-') ? content.querySelector<HTMLElement>('[data-settings-anchor="chat-defaults"]') : null);
      if (!element) return false;
      for (const details of content.querySelectorAll('details')) {
        if (details.contains(element) || details === element) details.open = true;
      }
      element.tabIndex = -1;
      element.classList.add('settings-destination');
      element.scrollIntoView({ block: 'start', behavior: 'instant' });
      element.focus({ preventScroll: true });
      highlighted = element;
      return true;
    };
    const observer = new MutationObserver(() => { if (reveal()) observer.disconnect(); });
    if (!reveal()) observer.observe(content, { childList: true, subtree: true });
    return () => { observer.disconnect(); highlighted?.classList.remove('settings-destination'); };
  });
  let allForgottenSelected = $derived(
    settings.forgottenNotes.length > 0 &&
      settings.forgottenNotes.every((note) =>
        settings.selectedForgottenPaths.includes(note.forgottenPath)
      )
  );

  function normalizeVaultPath(path: string) {
    return path.trim().replace(/[\\/]+$/u, '');
  }

  let selectedVaultPath = $derived(
    settings.vaultPathInput.trim() || settings.vaultInfo?.selectedPath || ''
  );
  let savedVaultPath = $derived(settings.vaultInfo?.selectedPath ?? '');
  let hasUnsavedVaultChange = $derived(
    Boolean(savedVaultPath) &&
      normalizeVaultPath(selectedVaultPath) !== normalizeVaultPath(savedVaultPath)
  );
  let vaultNeedsRestart = $derived(settings.vaultInfo?.requiresRestart ?? false);

  function handleVisibilityChange() {
    void settings.handleVisibilityChange();
  }

  onMount(() => {
    void settings.initialize();
  });

  onDestroy(() => {
    settings.dispose();
  });
</script>

<svelte:document onvisibilitychange={handleVisibilityChange} />

<main class="settings-workspace w-full max-w-5xl border-y border-border sm:rounded-4xl sm:border" aria-label="Settings">
  <aside class="settings-sidebar">
    <div class="settings-sidebar-heading">
      <h1>Settings</h1>
    </div>
    <nav aria-label="Settings categories">
      {#each categoryGroups as group}
        <div class="settings-nav-group">
          <p class="settings-nav-label">{group}</p>
          {#each settingsCategories.filter((item) => item.group === group) as item}
            {@const Icon = categoryIcons[item.id]}
            <button type="button" data-settings-section={item.id}
              class="settings-nav-item" class:active={activeCategory === item.id && !searching}
              aria-current={activeCategory === item.id && !searching ? 'page' : undefined}
              onclick={() => void selectCategory(item.id)}>
              <Icon size={16} strokeWidth={1.6} />
              <span>{item.label}</span>
            </button>
          {/each}
        </div>
      {/each}
    </nav>
  </aside>

  <section class="settings-main" aria-label="Settings controls">
    <div class="settings-toolbar">
      <div class="settings-search">
        <Search size={17} strokeWidth={1.7} aria-hidden="true" />
        <input bind:this={searchInput} bind:value={query} type="search" aria-label="Search settings"
          placeholder="Search settings…" autocomplete="off" spellcheck="false"
          oninput={() => { destination = null; content?.scrollTo({ top: 0 }); }}
          onkeydown={(event) => {
            if (event.key === 'Escape') { event.preventDefault(); clearSearch(); }
            if (event.key === 'Enter' && results.length > 0) {
              event.preventDefault();
              void selectCategory(results[0].category, results[0].anchor);
            }
          }} />
        {#if query}
          <button type="button" aria-label="Clear settings search" onclick={clearSearch}><X size={16} /></button>
        {/if}
      </div>
    </div>

    <div class="settings-content" bind:this={content}>
      {#if settings.settingsLoadError}
        <p class="mb-6 text-sm text-destructive" role="alert">Settings could not be loaded: {settings.settingsLoadError}</p>
      {/if}
      {#if searching}
        <div class="settings-page-heading">
          <h2>Search results</h2>
          <p role="status" aria-live="polite">{results.length} {results.length === 1 ? 'result' : 'results'} for “{query.trim()}”</p>
        </div>
        {#if results.length > 0}
          <ul class="settings-results" aria-label="Settings search results">
            {#each results as result (result.id)}
              <li>
                <button type="button" data-settings-result={result.id} onclick={() => void selectCategory(result.category, result.anchor)}>
                  <span class="min-w-0">
                    <span class="settings-result-category">{settingsCategories.find((item) => item.id === result.category)?.label}</span>
                    <span class="settings-result-title">{result.title}</span>
                    <span class="settings-result-description">{result.description}</span>
                  </span>
                  <ArrowUpRight size={17} aria-hidden="true" />
                </button>
              </li>
            {/each}
          </ul>
        {:else}
          <div class="settings-empty">
            <Search size={28} strokeWidth={1.3} aria-hidden="true" />
            <h3>No settings found</h3>
            <p>Try a different word, like “theme”, “font”, or “API key”.</p>
            <button type="button" onclick={clearSearch}>Clear search</button>
          </div>
        {/if}
      {/if}
      <!-- Keep mounted while searching so unsaved input and in-flight actions survive. -->
      <div hidden={searching}>
        <header class="settings-page-heading">
          <h2 id="settings-category-title" tabindex="-1">{activeSectionMeta.label}</h2>
        </header>
        {#if settings.activeTab === 'general'}
            {#if settings.activeGeneralSection === 'appearance'}
              <div class="space-y-5">
                <div class="settings-section" data-settings-anchor="theme">
                  <p class="text-sm font-medium">Theme</p>
                  <p class="mt-1 text-xs text-muted-foreground">Auto follows your system.</p>
                  <fieldset class="settings-theme-options">
                    <legend class="sr-only">Theme preference</legend>
                    {#each themeOptions as option}
                      {@const Icon = themeIcons[option.id]}
                      <label class="settings-theme-option" class:selected={themeStore.preference === option.id} title={option.description}>
                        <input class="sr-only" type="radio" name="theme-preference" value={option.id}
                          checked={themeStore.preference === option.id} onchange={() => void setThemePreference(option.id)} />
                        <span class="settings-theme-preview settings-theme-preview--{option.id}" aria-hidden="true"></span>
                        <span class="settings-theme-caption"><Icon size={14} />{option.label}</span>
                      </label>
                    {/each}
                  </fieldset>
                </div>

                <EditorTextSizePanel />
              </div>
            {:else if settings.activeGeneralSection === 'shortcuts'}
              <KeyboardShortcutsPanel targetAnchor={destination} />
            {:else if settings.activeGeneralSection === 'ai'}
              <ChatSettingsPanel />
            {:else if settings.activeGeneralSection === 'forgetting'}
              <div class="space-y-5">
                <div class="settings-section" data-settings-anchor="forget-duration">
                  <div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <p class="text-sm font-medium">Forget button duration</p>
                      <p class="mt-0.5 text-xs text-muted-foreground">
                        Hold before forgetting, or choose Instant.
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
                            appSettings.forgetButtonDurationPreference === option.id
                              ? 'bg-foreground text-background shadow-sm'
                              : 'text-muted-foreground hover:text-foreground'
                          }`}
                        >
                          <input
                            class="sr-only"
                            type="radio"
                            name="forget-button-duration"
                            value={option.id}
                            checked={appSettings.forgetButtonDurationPreference === option.id}
                            onchange={() => setForgetButtonDurationPreference(option.id)}
                          />
                          <span>{option.label}</span>
                        </label>
                      {/each}
                    </fieldset>
                  </div>
                </div>

                <div class="settings-section" data-settings-anchor="retention">
                  <div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <p class="text-sm font-medium">Forgotten note retention</p>
                      <p class="mt-0.5 text-xs text-muted-foreground">
                        Time to recover forgotten notes and chats before permanent deletion.
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
                            appSettings.forgottenNoteRetentionPreference === option.id
                              ? 'bg-foreground text-background shadow-sm'
                              : 'text-muted-foreground hover:text-foreground'
                          }`}
                        >
                          <input
                            class="sr-only"
                            type="radio"
                            name="forgotten-note-retention"
                            value={option.id}
                            checked={appSettings.forgottenNoteRetentionPreference === option.id}
                            onchange={() => {
                              void setForgottenNoteRetentionPreference(option.id).catch((error) => {
                                logDevError('Failed to update forgotten-note retention', error);
                              });
                            }}
                          />
                          <span>{option.label}</span>
                        </label>
                      {/each}
                    </fieldset>
                  </div>
                </div>

                <p class="text-sm">
                  <button
                    type="button"
                    class="font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground"
                    onclick={() => {
                      void selectCategory('forgotten');
                    }}
                  >
                    Manage forgotten items →
                  </button>
                </p>
              </div>
            {:else if settings.activeGeneralSection === 'vault'}
              <div class="flex flex-col gap-4" data-settings-anchor="vault-folder">
          <div class="flex items-start justify-between gap-4">
            <div>
              <p class="text-sm font-medium">
                {settings.usesVaultContainer ? 'Vault folders' : 'Notes folder'}
              </p>
              <p class="mt-0.5 text-xs text-muted-foreground">
                {#if settings.usesVaultContainer}
                  Choose a vault in Files → On My iPhone → Gneauxghts. Changes require a restart.
                {:else if settings.vaultInfo?.canConfigurePath ?? true}
                  Folder changes take effect after restarting.
                {:else}
                  Vault location cannot be configured on this build.
                {/if}
              </p>
            </div>
          </div>

          <SettingsCard>
            <SettingsLabel text={settings.usesVaultContainer ? 'Selected vault' : 'Selected folder'} />
            <p class="mt-3 break-all text-sm font-medium">
              {#if selectedVaultPath}
                {selectedVaultPath}
              {:else}
                <span class="text-muted-foreground">No folder selected yet</span>
              {/if}
            </p>
            {#if hasUnsavedVaultChange}
              <p class="mt-2 text-xs text-amber-700 dark:text-amber-300">
                Not applied. Apply for next launch, then restart.
              </p>
            {/if}
          </SettingsCard>

          {#if settings.usesVaultContainer}
            <SettingsCard>
              <SettingsLabel text="Available vaults" />
              {#if settings.isLoadingVaultFolders}
                <p class="mt-3 text-sm text-muted-foreground">Loading vault folders…</p>
              {:else if settings.vaultFolders.length === 0}
                <p class="mt-3 text-sm text-muted-foreground">
                  No vault folders yet. Create one below, or use the default Notes vault.
                </p>
              {:else}
                <ul class="mt-3 flex flex-col gap-2">
                  {#each settings.vaultFolders as folder (folder.path)}
                    {@const isSelected =
                      normalizeVaultPath(folder.path) === normalizeVaultPath(selectedVaultPath)}
                    <li>
                      <button
                        type="button"
                        class={`flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-left transition-colors ${
                          isSelected
                            ? 'border-foreground bg-foreground text-background'
                            : 'border-border bg-background hover:bg-accent'
                        }`}
                        disabled={settings.isSavingVault || settings.isCreatingVaultFolder}
                        onclick={() => settings.selectVaultFolder(folder.path)}
                      >
                        <span class="min-w-0">
                          <span class="block text-sm font-medium">{folder.name}</span>
                          <span
                            class={`mt-0.5 block truncate text-xs ${
                              isSelected ? 'text-background/70' : 'text-muted-foreground'
                            }`}
                          >
                            {folder.path}
                          </span>
                        </span>
                        {#if isSelected}
                          <span class="ml-3 shrink-0 text-xs font-medium">Selected</span>
                        {/if}
                      </button>
                    </li>
                  {/each}
                </ul>
              {/if}

              <div class="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
                <label class="sr-only" for="new-vault-name">New vault name</label>
                <input
                  id="new-vault-name"
                  class="min-w-0 flex-1 rounded-full border border-border bg-background px-4 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-foreground/20"
                  type="text"
                  placeholder="New vault name"
                  autocomplete="off"
                  value={settings.newVaultName}
                  disabled={settings.isCreatingVaultFolder || settings.isSavingVault}
                  oninput={(event) => settings.setNewVaultName(event.currentTarget.value)}
                  onkeydown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      void settings.createVaultFolder();
                    }
                  }}
                />
                <button
                  class="rounded-full border border-border bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-60"
                  type="button"
                  disabled={
                    settings.isCreatingVaultFolder ||
                    settings.isSavingVault ||
                    settings.newVaultName.trim() === ''
                  }
                  onclick={() => void settings.createVaultFolder()}
                >
                  {settings.isCreatingVaultFolder ? 'Creating…' : 'Create vault'}
                </button>
              </div>
            </SettingsCard>
          {/if}

          <div class="flex flex-wrap items-center gap-2">
            {#if !settings.usesVaultContainer}
              <button
                class="inline-flex items-center gap-2 rounded-full border border-border bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-60"
                type="button"
                disabled={
                  settings.isPickingVault ||
                  settings.isSavingVault ||
                  !(settings.vaultInfo?.canConfigurePath ?? true)
                }
                onclick={() => void settings.pickVaultDirectory()}
              >
                <FolderOpen class="h-4 w-4" />
                {settings.isPickingVault ? 'Opening picker…' : 'Choose folder'}
              </button>
            {/if}
            <button
              class="rounded-full border border-border bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-60"
              type="button"
              disabled={settings.isSavingVault || !(settings.vaultInfo?.canConfigurePath ?? true)}
              onclick={() => {
                settings.setVaultPathInput(settings.vaultInfo?.defaultPath ?? '');
                void settings.saveVaultDirectory();
              }}
            >
              Use default
            </button>
            <button
              class="rounded-full border border-border bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-60"
              type="button"
              disabled={
                settings.isSavingVault ||
                !(settings.vaultInfo?.canConfigurePath ?? true) ||
                !hasUnsavedVaultChange
              }
              onclick={() => void settings.saveVaultDirectory()}
            >
              {settings.isSavingVault ? 'Saving…' : 'Apply for next launch'}
            </button>
          </div>

          {#if vaultNeedsRestart}
            <div class="rounded-xl border border-amber-300/70 bg-amber-50 px-5 py-4 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-100">
              <p class="font-medium">Restart required</p>
              <p class="mt-1 text-sm text-amber-800 dark:text-amber-200">
                The app is still using
                <span class="font-medium break-all">{settings.vaultInfo?.runningPath}</span>.
                Restart now to open notes from
                <span class="font-medium break-all">{savedVaultPath}</span>.
              </p>
              <button
                class="mt-4 rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-60"
                type="button"
                disabled={settings.isRestarting}
                onclick={() => void settings.restartApp()}
              >
                {settings.isRestarting
                  ? 'Preparing restart…'
                  : settings.restartReady
                    ? 'Retry Restart'
                    : 'Restart app'}
              </button>
            </div>
          {/if}

          {#if settings.vaultSaveError}
            <div class="rounded-xl border border-destructive/40 bg-destructive/10 px-5 py-4 text-sm text-destructive">
              {settings.vaultSaveError}
            </div>
          {/if}

          {#if settings.vaultInfo?.pathConfigurationNote}
            <div class="rounded-xl border border-sky-300/60 bg-sky-50 px-5 py-4 text-sm text-sky-700 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-200">
              {settings.vaultInfo.pathConfigurationNote}
            </div>
          {/if}

          {#if settings.vaultInfo}
            <details class="settings-disclosure" data-settings-anchor="vault-details">
              <summary>Folder details · {settings.vaultInfo.noteCount} notes</summary>
              <div class="mt-4 grid gap-4">
              <SettingsCard>
                <SettingsLabel text="Running Vault" />
                <p class="mt-2 text-sm font-medium break-all">{settings.vaultInfo.runningPath}</p>
              </SettingsCard>
              <SettingsCard>
                <SettingsLabel text="Forgotten items" />
                <p class="mt-2 text-sm font-medium break-all">{settings.vaultInfo.forgottenPath}</p>
              </SettingsCard>
              <SettingsCard>
                <SettingsLabel text="Vault stats" />
                <p class="mt-2 text-sm font-medium">{settings.vaultInfo.noteCount} notes</p>
                <p class="mt-1 text-xs text-muted-foreground">
                  {settings.vaultInfo.isDefault ? 'Using default path' : 'Custom path'} · {settings.vaultInfo.requiresRestart ? 'next launch staged' : 'active selection'}
                </p>
              </SettingsCard>
              </div>
            </details>
          {/if}
        </div>
            {:else if settings.activeGeneralSection === 'history'}
              <HistorySettingsPanel
                historyHealth={settings.historyHealth}
                isRunningAction={settings.isRunningHistoryAction}
                actionError={settings.historyActionError}
                retryHistory={settings.retryHistory}
                resetCorruptHistory={settings.resetCorruptHistory}
                clearVaultHistory={settings.clearVaultHistory}
              />
            {:else if settings.activeGeneralSection === 'search'}
      <SemanticSettingsPanel
        embedded
        semanticSettings={settings.semanticSettings}
        semanticStatus={settings.semanticStatus}
        semanticDebug={settings.semanticDebug}
        semanticLayerError={settings.semanticLayerError}
        semanticLayerMessage={settings.semanticLayerMessage}
        isSaving={settings.isSaving}
        isRunningAction={settings.isRunningAction}
        loadSemanticState={settings.loadSemanticState}
        updateSetting={settings.updateSetting}
        runAction={settings.runAction}
        downloadEmbeddingModel={settings.downloadEmbeddingModel}
        clearDebugMetrics={settings.clearDebugMetrics}
        clearAtlasCache={settings.clearAtlasCache}
        {formatTimestamp}
        {formatMillis}
        {averageDuration}
      />
            {/if}

        {:else}
        <MissingNotesPanel
          missingNotes={settings.missingNotes}
          isLoading={settings.isLoadingForgottenNotes}
          isUpdating={settings.isUpdatingMissingNotes}
          loadingTimelineNoteId={settings.loadingMissingTimelineNoteId}
          actionMessage={settings.missingActionMessage}
          actionError={settings.missingActionError}
          loadMissingNotes={settings.loadForgottenNotes}
          loadMoreHistory={settings.loadMoreMissingNoteHistory}
          recoverMissingNote={settings.recoverMissingNote}
          deleteMissingNote={settings.deleteMissingNote}
          {formatTimestamp}
          {formatForgottenRetention}
        />
        <ForgottenNotesPanel
          forgottenNotes={settings.forgottenNotes}
          {allForgottenSelected}
          selectedForgottenPaths={settings.selectedForgottenPaths}
          isLoadingForgottenNotes={settings.isLoadingForgottenNotes}
          isUpdatingForgottenNotes={settings.isUpdatingForgottenNotes}
          forgottenActionMessage={settings.forgottenActionMessage}
          forgottenActionError={settings.forgottenActionError}
          loadForgottenNotes={settings.loadForgottenNotes}
          runForgottenAction={settings.runForgottenAction}
          toggleForgottenSelection={settings.toggleForgottenSelection}
          toggleAllForgottenSelections={settings.toggleAllForgottenSelections}
          {formatTimestamp}
          {formatForgottenRetention}
        />

        {/if}
      </div>
    </div>
  </section>
</main>
