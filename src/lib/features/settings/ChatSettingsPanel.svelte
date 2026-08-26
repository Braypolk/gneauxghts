<script lang="ts">
  import { Eye, EyeOff, KeyRound, LoaderCircle, RefreshCw } from '@lucide/svelte';
  import SettingsField from './SettingsField.svelte';
  import ExcludedNotesSettings from './ExcludedNotesSettings.svelte';
  import { onMount } from 'svelte';
  import { TauriChatApi } from '$lib/features/chat/api';
  import type { ChatProvider, ChatSettings, LocalModel } from '$lib/features/chat/types';

  const api = new TauriChatApi();

  let settings = $state<ChatSettings | null>(null);
  let credentialProvider = $state<ChatProvider>('openai');
  let apiKey = $state('');
  let keyStatuses = $state<Record<ChatProvider, boolean>>({ openai: false, local: false });
  let keyConfigured = $derived(keyStatuses[credentialProvider]);
  let revealKey = $state(false);
  let isLoading = $state(true);
  let isSavingKey = $state(false);
  let isSavingSettings = $state(false);
  let error = $state<string | null>(null);
  let message = $state<string | null>(null);
  let localModels = $state<LocalModel[]>([]);
  let isDiscoveringLocal = $state(false);

  async function load() {
    isLoading = true;
    error = null;
    try {
      const [loadedSettings, openaiKeyStatus, localKeyStatus] = await Promise.all([
        api.getSettings(),
        api.getKeyStatus('openai'),
        api.getKeyStatus('local')
      ]);
      settings = loadedSettings;
      credentialProvider = loadedSettings.provider;
      keyStatuses.openai = openaiKeyStatus.configured;
      keyStatuses.local = localKeyStatus.configured;
    } catch (loadError) {
      error = String(loadError);
    } finally {
      isLoading = false;
    }
  }

  async function saveKey() {
    const value = apiKey.trim();
    if (!value) {
      error = 'Enter an API key before saving.';
      return;
    }
    isSavingKey = true;
    error = null;
    message = null;
    try {
      const status = await api.setApiKey(credentialProvider, value);
      keyStatuses[credentialProvider] = status.configured;
      apiKey = '';
      revealKey = false;
      message = `${credentialProvider === 'openai' ? 'OpenAI' : 'Local provider'} API key saved securely on this machine.`;
    } catch (saveError) {
      error = String(saveError);
    } finally {
      isSavingKey = false;
    }
  }

  async function removeKey() {
    isSavingKey = true;
    error = null;
    message = null;
    try {
      const status = await api.setApiKey(credentialProvider, '');
      keyStatuses[credentialProvider] = status.configured;
      apiKey = '';
      revealKey = false;
      message = `${credentialProvider === 'openai' ? 'OpenAI' : 'Local provider'} API key removed.`;
    } catch (removeError) {
      error = String(removeError);
    } finally {
      isSavingKey = false;
    }
  }

  async function saveDefaults() {
    if (!settings) return;
    isSavingSettings = true;
    error = null;
    message = null;
    try {
      settings.model = settings.provider === 'local' ? settings.localModel : settings.openaiModel;
      settings = await api.setSettings(settings);
      message = 'Chat defaults saved in this vault.';
    } catch (saveError) {
      error = String(saveError);
    } finally {
      isSavingSettings = false;
    }
  }

  async function discoverLocalModels() {
    if (!settings) return;
    isDiscoveringLocal = true;
    error = null;
    try {
      localModels = await api.listLocalModels(settings.localBaseUrl);
      if (!localModels.length) {
        message = 'The local endpoint is reachable, but it returned no models.';
      } else {
        if (!localModels.some((model) => model.id === settings?.localModel)) {
          settings.localModel = localModels[0].id;
        }
        message = `Found ${localModels.length} local model${localModels.length === 1 ? '' : 's'}.`;
      }
    } catch (discoverError) {
      error = String(discoverError);
    } finally {
      isDiscoveringLocal = false;
    }
  }

  onMount(() => {
    void load();
  });
</script>

{#if isLoading}
  <div class="flex items-center gap-2 rounded-2xl border border-border/70 bg-background/40 px-5 py-5 text-sm text-muted-foreground">
    <LoaderCircle class="h-4 w-4 animate-spin" />
    Loading AI settings…
  </div>
{:else}
  <div class="space-y-5">
    <section class="settings-section">
      <div class="flex items-start gap-3">
        <div class="rounded-xl bg-muted p-2 text-muted-foreground"><KeyRound class="h-4 w-4" /></div>
        <div>
          <h3 class="text-sm font-medium">Provider API keys</h3>
          <p class="mt-1 text-xs leading-relaxed text-muted-foreground">
            Each provider has its own key in your operating system credential store. Keys are never written to the vault or shown again.
          </p>
        </div>
      </div>

      <div class="mt-4 max-w-sm">
        <SettingsField label="Credential provider">
          <select
            class="settings-control"
            bind:value={credentialProvider}
            onchange={() => {
              apiKey = '';
              revealKey = false;
              error = null;
              message = null;
            }}
          >
            <option value="openai">OpenAI Responses API</option>
            <option value="local">Local OpenAI-compatible</option>
          </select>
        </SettingsField>
      </div>

      <div class="mt-4 flex items-center gap-2 text-xs">
        <span class={`h-2 w-2 rounded-full ${keyConfigured ? 'bg-emerald-500' : 'bg-amber-500'}`}></span>
        <span class="font-medium">
          {keyConfigured ? 'Key configured' : credentialProvider === 'local' ? 'No key configured (optional)' : 'No key configured'}
        </span>
      </div>

      <div class="mt-4 flex flex-col gap-2 sm:flex-row">
        <div class="relative min-w-0 flex-1">
          <label class="sr-only" for="provider-api-key">{credentialProvider === 'openai' ? 'OpenAI' : 'Local provider'} API key</label>
          <input
            id="provider-api-key"
            class="h-10 w-full rounded-xl border border-border bg-background px-3 pr-10 text-sm outline-none focus:ring-2 focus:ring-ring"
            type={revealKey ? 'text' : 'password'}
            bind:value={apiKey}
            autocomplete="off"
            spellcheck="false"
            placeholder={keyConfigured ? 'Enter a replacement key' : credentialProvider === 'openai' ? 'sk-…' : 'Optional bearer token'}
            onkeydown={(event) => {
              if (event.key === 'Enter') void saveKey();
            }}
          />
          <button
            type="button"
            class="absolute right-1 top-1 inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={revealKey ? 'Hide API key' : 'Show API key'}
            onclick={() => revealKey = !revealKey}
          >
            {#if revealKey}<EyeOff class="h-4 w-4" />{:else}<Eye class="h-4 w-4" />{/if}
          </button>
        </div>
        <button
          type="button"
          class="h-10 rounded-xl bg-foreground px-4 text-sm font-medium text-background disabled:opacity-50"
          disabled={isSavingKey || !apiKey.trim()}
          onclick={() => void saveKey()}
        >
          {isSavingKey ? 'Saving…' : keyConfigured ? 'Replace key' : 'Save key'}
        </button>
        {#if keyConfigured}
          <button
            type="button"
            class="h-10 rounded-xl border border-border px-4 text-sm font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
            disabled={isSavingKey}
            onclick={() => void removeKey()}
          >Remove</button>
        {/if}
      </div>
      {#if credentialProvider === 'local'}
        <p class="mt-3 text-xs leading-relaxed text-muted-foreground">
          Leave this unset for LM Studio or another unauthenticated local server. When set, it is sent as the bearer token for model discovery and chat requests.
        </p>
      {/if}
    </section>

    {#if settings}
      <section class="settings-section">
        <h3 class="text-sm font-medium">Provider and defaults</h3>
        <p class="mt-1 text-xs text-muted-foreground">These settings are stored with this vault. The API key remains machine-local.</p>

        <div class="mt-5 grid gap-4 sm:grid-cols-2">
          <SettingsField label="Provider">
            <select class="settings-control" bind:value={settings.provider}>
              <option value="openai">OpenAI Responses API</option>
              <option value="local">Local OpenAI-compatible</option>
            </select>
          </SettingsField>
          {#if settings.provider === 'openai'}
            <SettingsField label="OpenAI model">
              <input class="settings-control" bind:value={settings.openaiModel} spellcheck="false" />
            </SettingsField>
            <SettingsField label="Processing">
              <select class="settings-control" bind:value={settings.serviceTier}>
                <option value="standard">Standard</option>
                <option value="flex">Flex — lower cost, slower</option>
              </select>
            </SettingsField>
            <SettingsField label="OpenAI web access">
              <select class="settings-control" bind:value={settings.webAccess}>
                <option value="auto">Auto — search when useful</option>
                <option value="off">Off by default</option>
              </select>
            </SettingsField>
          {:else}
            <SettingsField label="Local endpoint">
              <input class="settings-control" bind:value={settings.localBaseUrl} spellcheck="false" placeholder="http://localhost:1234/v1" />
            </SettingsField>
            <SettingsField label="Local model">
              <div class="flex gap-2">
                {#if localModels.length}
                  <select class="settings-control min-w-0" bind:value={settings.localModel}>
                    {#each localModels as model (model.id)}
                      <option value={model.id}>{model.id}</option>
                    {/each}
                  </select>
                {:else}
                  <input class="settings-control min-w-0" bind:value={settings.localModel} placeholder="Load a model in LM Studio, then discover" spellcheck="false" />
                {/if}
                <button type="button" class="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border" disabled={isDiscoveringLocal} onclick={() => void discoverLocalModels()} aria-label="Discover local models" title="Discover models from the OpenAI-compatible endpoint">
                  {#if isDiscoveringLocal}<LoaderCircle class="h-4 w-4 animate-spin" />{:else}<RefreshCw class="h-4 w-4" />{/if}
                </button>
              </div>
            </SettingsField>
          {/if}
          <SettingsField label="Default vault access">
            <select class="settings-control" bind:value={settings.defaultVaultAccess}>
              <option value="none">None</option>
              <option value="approved">Approved only</option>
              <option value="full">Full</option>
            </select>
          </SettingsField>
          <SettingsField label="Map chat visibility">
            <select class="settings-control" bind:value={settings.atlasVisibility}>
              <option value="hidden">Hidden</option>
              <option value="remembered">Remembered</option>
              <option value="all">All</option>
            </select>
          </SettingsField>
        </div>

        <p class="mt-3 text-xs leading-relaxed text-muted-foreground">
          LM Studio defaults to http://localhost:1234/v1. Local models must support OpenAI-compatible tool calling for vault search and reviewed note changes. Hosted OpenAI alone can use web search and Flex processing.
        </p>

        {#if settings.provider === 'openai' && settings.serviceTier === 'flex'}
          <p class="mt-4 rounded-xl border border-border/70 bg-muted/30 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
            Flex uses lower-cost capacity and may respond more slowly or be temporarily unavailable. Gneauxghts will not silently retry at Standard pricing.
          </p>
        {/if}

        <div class="mt-5 flex justify-end">
          <button
            type="button"
            class="h-10 rounded-xl bg-foreground px-4 text-sm font-medium text-background disabled:opacity-50"
            disabled={isSavingSettings || !(settings.provider === 'local' ? settings.localModel : settings.openaiModel).trim()}
            onclick={() => void saveDefaults()}
          >{isSavingSettings ? 'Saving…' : 'Save defaults'}</button>
        </div>
      </section>
    {/if}

    <ExcludedNotesSettings />

    {#if error}
      <p class="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">{error}</p>
    {:else if message}
      <p class="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-foreground" role="status">{message}</p>
    {/if}
  </div>
{/if}
