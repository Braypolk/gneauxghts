<script lang="ts">
  import { Eye, EyeOff, KeyRound, LoaderCircle } from '@lucide/svelte';
  import SettingsField from './SettingsField.svelte';
  import ExcludedNotesSettings from './ExcludedNotesSettings.svelte';
  import LocalModelSettings from './LocalModelSettings.svelte';
  import { onMount } from 'svelte';
  import { TauriChatApi } from '$lib/features/chat/api';
  import type { ChatProvider, ChatSettings } from '$lib/features/chat/types';
  import {
    chatReasoningChoices,
    normalizeChatReasoningEffort,
    OPENAI_CHAT_MODELS
  } from '$lib/features/chat/chatConfiguration';

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
  const defaultReasoningOptions = $derived(
    settings ? chatReasoningChoices('openai', settings.openaiModel) : []
  );

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
      if (settings.provider === 'openai') {
        settings.reasoningEffort = normalizeChatReasoningEffort(
          settings.provider,
          settings.model,
          settings.reasoningEffort
        );
      }
      settings = await api.setSettings(settings);
      message = 'Chat defaults saved in this vault.';
    } catch (saveError) {
      error = String(saveError);
    } finally {
      isSavingSettings = false;
    }
  }

  onMount(() => {
    void load();
  });
</script>

{#if isLoading}
  <div class="flex items-center gap-2 rounded-lg border border-border/70 bg-background/40 px-5 py-5 text-sm text-muted-foreground">
    <LoaderCircle class="h-4 w-4 animate-spin" />
    Loading AI settings…
  </div>
{:else}
  <div class="space-y-5">
    <section class="settings-section" data-settings-anchor="api-keys">
      <div class="flex items-start gap-3">
        <div class="rounded-xl bg-muted p-2 text-muted-foreground"><KeyRound class="h-4 w-4" /></div>
        <div>
          <h3 class="text-sm font-medium">Provider API keys</h3>
          <p class="mt-1 text-xs leading-relaxed text-muted-foreground">
            Stored securely on this device, outside your vault.
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
          Optional. Only needed if your local server requires authentication.
        </p>
      {/if}
    </section>

    {#if settings}
      <section class="settings-section" data-settings-anchor="chat-defaults">
        <h3 class="text-sm font-medium">Chat defaults</h3>
        <p class="mt-1 text-xs text-muted-foreground">Saved with this vault. Applies to new chats.</p>

        <div class="mt-5 grid gap-4 sm:grid-cols-2">
          <SettingsField label="Provider" anchor="chat-provider">
            <select class="settings-control" bind:value={settings.provider}>
              <option value="openai">OpenAI Responses API</option>
              <option value="local">Local OpenAI-compatible</option>
            </select>
          </SettingsField>
          {#if settings.provider === 'openai'}
            <SettingsField label="OpenAI model" anchor="chat-model">
              <input class="settings-control" bind:value={settings.openaiModel} list="openai-chat-models" spellcheck="false" />
              <datalist id="openai-chat-models">
                {#each OPENAI_CHAT_MODELS as model (model.id)}
                  <option value={model.id}>{model.label}</option>
                {/each}
              </datalist>
            </SettingsField>
            {#if defaultReasoningOptions.length > 0}
              <SettingsField label="Reasoning" anchor="chat-reasoning">
                <select class="settings-control" bind:value={settings.reasoningEffort}>
                  {#each defaultReasoningOptions as option (option.value)}
                    <option value={option.value}>{option.label}</option>
                  {/each}
                </select>
              </SettingsField>
            {/if}
            <SettingsField label="Processing" anchor="chat-processing">
              <select class="settings-control" bind:value={settings.serviceTier}>
                <option value="standard">Standard</option>
                <option value="flex">Flex — lower cost, slower</option>
              </select>
            </SettingsField>
            <SettingsField label="OpenAI web access" anchor="chat-web">
              <select class="settings-control" bind:value={settings.webAccess}>
                <option value="auto">Auto — search when useful</option>
                <option value="off">Off by default</option>
              </select>
            </SettingsField>
          {:else}
            <SettingsField label="Local endpoint" anchor="chat-endpoint">
              <input class="settings-control" bind:value={settings.localBaseUrl} spellcheck="false" placeholder="http://localhost:1234/v1" />
            </SettingsField>
            <div class="sm:col-span-2" data-settings-anchor="chat-model">
              <LocalModelSettings
                baseUrl={settings.localBaseUrl}
                selectedModel={settings.localModel}
                onSelect={(model) => {
                  if (!settings) return;
                  settings.localModel = model;
                }}
                onStatus={(status) => { error = null; message = status; }}
                onError={(detail) => { message = null; error = detail; }}
              />
            </div>
          {/if}
          <SettingsField label="Default vault access" anchor="chat-access">
            <select class="settings-control" bind:value={settings.defaultVaultAccess}>
              <option value="none">None</option>
              <option value="approved">Approved only</option>
              <option value="full">Full</option>
            </select>
          </SettingsField>
          <SettingsField label="Map chat visibility" anchor="chat-visibility">
            <select class="settings-control" bind:value={settings.atlasVisibility}>
              <option value="hidden">Hidden</option>
              <option value="remembered">Remembered</option>
              <option value="all">All</option>
            </select>
          </SettingsField>
        </div>

        {#if settings.provider === 'local'}
          <p class="mt-3 text-xs leading-relaxed text-muted-foreground">Vault search and note changes require a model with tool calling.</p>
        {/if}

        {#if settings.provider === 'openai' && settings.serviceTier === 'flex'}
          <p class="mt-4 rounded-xl border border-border/70 bg-muted/30 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
            Flex may be slower or temporarily unavailable. Requests never fall back to Standard pricing.
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
