<script lang="ts">
  import { Eye, EyeOff, KeyRound, LoaderCircle } from '@lucide/svelte';
  import SettingsField from './SettingsField.svelte';
  import { onMount } from 'svelte';
  import { TauriChatApi } from '$lib/features/chat/api';
  import type {
    AtlasChatVisibility,
    ChatMode,
    VaultAccess, ChatSettings
  } from '$lib/features/chat/types';

  const api = new TauriChatApi();

  let settings = $state<ChatSettings | null>(null);
  let apiKey = $state('');
  let keyConfigured = $state(false);
  let revealKey = $state(false);
  let isLoading = $state(true);
  let isSavingKey = $state(false);
  let isSavingSettings = $state(false);
  let error = $state<string | null>(null);
  let message = $state<string | null>(null);

  async function load() {
    isLoading = true;
    error = null;
    try {
      const [loadedSettings, keyStatus] = await Promise.all([
        api.getSettings(),
        api.getKeyStatus('openai')
      ]);
      settings = loadedSettings;
      keyConfigured = keyStatus.configured;
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
      const status = await api.setApiKey('openai', value);
      keyConfigured = status.configured;
      apiKey = '';
      revealKey = false;
      message = 'API key saved securely on this machine.';
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
      const status = await api.setApiKey('openai', '');
      keyConfigured = status.configured;
      apiKey = '';
      message = 'Stored API key removed.';
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
          <h3 class="text-sm font-medium">OpenAI API key</h3>
          <p class="mt-1 text-xs leading-relaxed text-muted-foreground">
            The key is stored in your operating system credential store and is never written to the vault or shown again.
          </p>
        </div>
      </div>

      <div class="mt-4 flex items-center gap-2 text-xs">
        <span class={`h-2 w-2 rounded-full ${keyConfigured ? 'bg-emerald-500' : 'bg-amber-500'}`}></span>
        <span class="font-medium">{keyConfigured ? 'Key configured' : 'No key configured'}</span>
      </div>

      <div class="mt-4 flex flex-col gap-2 sm:flex-row">
        <div class="relative min-w-0 flex-1">
          <label class="sr-only" for="openai-api-key">OpenAI API key</label>
          <input
            id="openai-api-key"
            class="h-10 w-full rounded-xl border border-border bg-background px-3 pr-10 text-sm outline-none focus:ring-2 focus:ring-ring"
            type={revealKey ? 'text' : 'password'}
            bind:value={apiKey}
            autocomplete="off"
            spellcheck="false"
            placeholder={keyConfigured ? 'Enter a replacement key' : 'sk-…'}
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
    </section>

    {#if settings}
      <section class="settings-section">
        <h3 class="text-sm font-medium">Provider and defaults</h3>
        <p class="mt-1 text-xs text-muted-foreground">These settings are stored with this vault. The API key remains machine-local.</p>

        <div class="mt-5 grid gap-4 sm:grid-cols-2">
          <SettingsField label="Provider">
            <input class="settings-control bg-muted/40! text-muted-foreground" value="OpenAI Responses API" disabled />
          </SettingsField>
          <SettingsField label="Model">
            <input class="settings-control" bind:value={settings.model} spellcheck="false" />
          </SettingsField>
          <SettingsField label="Processing">
            <select class="settings-control" bind:value={settings.serviceTier}>
              <option value="standard">Standard</option>
              <option value="flex">Flex — lower cost, slower</option>
            </select>
          </SettingsField>
          <SettingsField label="Default chat mode">
            <select class="settings-control" bind:value={settings.defaultMode}>
              {#each ['auto', 'explore', 'challenge', 'research', 'make'] as mode (mode)}
                <option value={mode}>{mode[0].toUpperCase() + mode.slice(1)}</option>
              {/each}
            </select>
          </SettingsField>
          <SettingsField label="Default vault access">
            <select class="settings-control" bind:value={settings.defaultVaultAccess}>
              <option value="none">None</option>
              <option value="limited">Limited</option>
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

        {#if settings.serviceTier === 'flex'}
          <p class="mt-4 rounded-xl border border-border/70 bg-muted/30 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
            Flex uses lower-cost capacity and may respond more slowly or be temporarily unavailable. Gneauxghts will not silently retry at Standard pricing.
          </p>
        {/if}

        <div class="mt-5 flex justify-end">
          <button
            type="button"
            class="h-10 rounded-xl bg-foreground px-4 text-sm font-medium text-background disabled:opacity-50"
            disabled={isSavingSettings || !settings.model.trim()}
            onclick={() => void saveDefaults()}
          >{isSavingSettings ? 'Saving…' : 'Save defaults'}</button>
        </div>
      </section>
    {/if}

    {#if error}
      <p class="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">{error}</p>
    {:else if message}
      <p class="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-foreground" role="status">{message}</p>
    {/if}
  </div>
{/if}
