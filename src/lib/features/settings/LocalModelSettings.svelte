<script lang="ts">
  import {
    Check,
    Brain,
    Eye,
    Headphones,
    LoaderCircle,
    Pencil,
    Plus,
    RefreshCw,
    TriangleAlert,
    Video,
    Wrench,
    X
  } from '@lucide/svelte';
  import { onMount } from 'svelte';
  import { TauriChatApi } from '$lib/features/chat/api';
  import type {
    ChatReasoningEffort,
    ChatModelCapabilities,
    LocalModel,
    LocalModelCapabilitySelection
  } from '$lib/features/chat/types';
  import { mergeLocalModels } from './localModels';
  import { chatReasoningChoices } from '$lib/features/chat/chatConfiguration';

  interface Props {
    baseUrl: string;
    selectedModel: string;
    onSelect: (model: string) => void;
    onStatus?: (message: string) => void;
    onError?: (message: string) => void;
  }

  type Capability = 'images' | 'tools' | 'audio' | 'video';

  let { baseUrl, selectedModel, onSelect, onStatus, onError }: Props = $props();

  const api = new TauriChatApi();
  const defaultCapabilities: LocalModelCapabilitySelection = {
    images: false,
    tools: true,
    audio: false,
    video: false,
    reasoningEffort: 'medium'
  };

  let discoveredModels = $state<LocalModel[]>([]);
  let capabilitiesByModel = $state<Record<string, LocalModelCapabilitySelection>>({});
  let isDiscovering = $state(false);
  let discoveryError = $state<string | null>(null);
  let showManualEntry = $state(false);
  let manualModel = $state('');
  let editingModel = $state<string | null>(null);
  let draftCapabilities = $state<LocalModelCapabilitySelection>({ ...defaultCapabilities });
  let loadingCapabilitiesFor = $state<string | null>(null);
  let isSavingCapabilities = $state(false);

  const models = $derived(mergeLocalModels(discoveredModels, selectedModel));
  const reasoningOptions = $derived(
    editingModel ? chatReasoningChoices('local', editingModel) : []
  );

  function errorText(value: unknown, fallback: string) {
    if (value instanceof Error && value.message.trim()) return value.message;
    if (typeof value === 'string' && value.trim()) return value;
    return fallback;
  }

  function capabilitySelection(
    capabilities: ChatModelCapabilities
  ): LocalModelCapabilitySelection {
    return {
      images: capabilities.images,
      tools: capabilities.tools,
      audio: capabilities.audio,
      video: capabilities.video,
      reasoningEffort: capabilities.defaultReasoningEffort ?? 'medium'
    };
  }

  async function loadCapabilities(model: string) {
    const capabilities = capabilitySelection(
      await api.getModelCapabilities('local', model)
    );
    capabilitiesByModel = { ...capabilitiesByModel, [model]: capabilities };
    return capabilities;
  }

  async function refreshModels(announce = true) {
    if (!baseUrl.trim()) {
      discoveryError = 'Enter a local endpoint before refreshing models.';
      return;
    }
    isDiscovering = true;
    discoveryError = null;
    try {
      const discovered = await api.listLocalModels(baseUrl);
      discoveredModels = discovered;
      const nextModels = mergeLocalModels(discovered, selectedModel);
      if (!selectedModel.trim() && nextModels[0]) onSelect(nextModels[0].id);
      await Promise.all(
        nextModels.map(async (model) => {
          try {
            await loadCapabilities(model.id);
          } catch {
            // One missing profile should not make model discovery unusable.
          }
        })
      );
      if (announce) {
        onStatus?.(
          discovered.length
            ? `Found ${discovered.length} local model${discovered.length === 1 ? '' : 's'}.`
            : 'The local endpoint is reachable, but it returned no models.'
        );
      }
    } catch (refreshError) {
      discoveryError = errorText(refreshError, 'Unable to reach the local model endpoint.');
    } finally {
      isDiscovering = false;
    }
  }

  async function selectModel(model: string) {
    onSelect(model);
    if (!capabilitiesByModel[model]) {
      try {
        await loadCapabilities(model);
      } catch {
        // Selection remains usable even if its saved profile cannot be loaded.
      }
    }
  }

  async function openEditor(model: string) {
    editingModel = model;
    loadingCapabilitiesFor = model;
    draftCapabilities = capabilitiesByModel[model] ?? { ...defaultCapabilities };
    try {
      const capabilities = await loadCapabilities(model);
      if (editingModel === model) draftCapabilities = capabilities;
    } catch (loadError) {
      if (editingModel === model) {
        onError?.(errorText(loadError, 'Unable to load this model’s capabilities.'));
      }
    } finally {
      if (loadingCapabilitiesFor === model) loadingCapabilitiesFor = null;
    }
  }

  function closeEditor() {
    if (isSavingCapabilities) return;
    editingModel = null;
  }

  function toggleCapability(capability: Capability) {
    draftCapabilities = {
      ...draftCapabilities,
      [capability]: !draftCapabilities[capability]
    };
  }

  async function saveCapabilities() {
    if (!editingModel) return;
    isSavingCapabilities = true;
    try {
      const saved = await api.setLocalModelCapabilities(editingModel, draftCapabilities);
      capabilitiesByModel = { ...capabilitiesByModel, [editingModel]: saved };
      onStatus?.(`Capabilities saved for ${editingModel}.`);
      editingModel = null;
    } catch (saveError) {
      onError?.(errorText(saveError, 'Unable to save this model’s capabilities.'));
    } finally {
      isSavingCapabilities = false;
    }
  }

  async function addManualModel() {
    const model = manualModel.trim();
    if (!model) return;
    discoveredModels = mergeLocalModels(discoveredModels, model);
    manualModel = '';
    showManualEntry = false;
    await selectModel(model);
    await openEditor(model);
  }

  function handleWindowKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && editingModel) closeEditor();
  }

  onMount(() => {
    void refreshModels(false);
  });
</script>

<svelte:window onkeydown={handleWindowKeydown} />

<div class="overflow-hidden rounded-lg border border-border/80 bg-background/60">
  <div class="flex items-center justify-between gap-3 border-b border-border/70 px-4 py-3">
    <div>
      <h4 class="text-sm font-semibold">Models</h4>
    </div>
    <div class="flex items-center gap-1.5">
      <button
        type="button"
        class="inline-flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
        aria-label="Refresh local models"
        title="Refresh models from the local endpoint"
        disabled={isDiscovering}
        onclick={() => void refreshModels()}
      >
        {#if isDiscovering}
          <LoaderCircle class="h-4 w-4 animate-spin" />
        {:else}
          <RefreshCw class="h-4 w-4" />
        {/if}
      </button>
      <button
        type="button"
        class="inline-flex h-9 w-9 items-center justify-center rounded-full bg-muted text-muted-foreground transition-colors hover:text-foreground"
        aria-label="Add a model manually"
        title="Add a model manually"
        aria-expanded={showManualEntry}
        onclick={() => showManualEntry = !showManualEntry}
      >
        <Plus class="h-4 w-4" />
      </button>
    </div>
  </div>

  {#if showManualEntry}
    <form class="flex gap-2 border-b border-border/70 bg-muted/20 p-3" onsubmit={(event) => { event.preventDefault(); void addManualModel(); }}>
      <label class="sr-only" for="manual-local-model">Local model ID</label>
      <input
        id="manual-local-model"
        class="settings-control min-w-0 flex-1"
        bind:value={manualModel}
        placeholder="Model ID from LM Studio"
        spellcheck="false"
      />
      <button
        type="submit"
        class="h-10 rounded-xl bg-foreground px-3 text-sm font-medium text-background disabled:opacity-50"
        disabled={!manualModel.trim()}
      >Add</button>
    </form>
  {/if}

  {#if models.length}
    <div class="divide-y divide-border/70">
      {#each models as model (model.id)}
        {@const capabilities = capabilitiesByModel[model.id]}
        {@const selected = model.id === selectedModel}
        <div class={`flex min-w-0 items-center gap-2 px-2 py-1.5 transition-colors ${selected ? 'bg-primary/6' : 'hover:bg-muted/30'}`}>
          <button
            type="button"
            class="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-2 py-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
            aria-pressed={selected}
            onclick={() => void selectModel(model.id)}
          >
            <span class={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${selected ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-transparent'}`}>
              <Check class="h-3 w-3" />
            </span>
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm font-medium">{model.id}</span>
              {#if model.ownedBy}
                <span class="mt-0.5 block truncate text-[11px] text-muted-foreground">{model.ownedBy}</span>
              {/if}
            </span>
            {#if capabilities}
              <span class="hidden shrink-0 items-center gap-2 text-muted-foreground sm:flex" aria-label="Enabled capabilities">
                {#if capabilities.tools}<Wrench class="h-3.5 w-3.5" aria-label="Tools" />{/if}
                {#if capabilities.images}<Eye class="h-3.5 w-3.5" aria-label="Vision" />{/if}
                {#if capabilities.audio}<Headphones class="h-3.5 w-3.5" aria-label="Audio" />{/if}
                {#if capabilities.video}<Video class="h-3.5 w-3.5" aria-label="Video" />{/if}
                {#if chatReasoningChoices('local', model.id).length}
                  <Brain class="h-3.5 w-3.5" aria-label={`Reasoning: ${capabilities.reasoningEffort}`} />
                {/if}
              </span>
            {/if}
          </button>
          <button
            type="button"
            class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label={`Configure ${model.id}`}
            title="Configure model capabilities"
            onclick={() => void openEditor(model.id)}
          >
            <Pencil class="h-4 w-4" />
          </button>
        </div>
      {/each}
    </div>
  {:else if isDiscovering}
    <div class="flex items-center gap-2 px-4 py-5 text-sm text-muted-foreground">
      <LoaderCircle class="h-4 w-4 animate-spin" />
      Loading models…
    </div>
  {:else}
    <div class="px-4 py-5 text-sm text-muted-foreground">
      Load a model in LM Studio, then refresh—or add its ID.
    </div>
  {/if}

  {#if discoveryError}
    <div class="border-t border-amber-500/25 bg-amber-500/8 px-4 py-3 text-xs leading-relaxed text-muted-foreground" role="status">
      {discoveryError} The currently configured model remains available for offline setup.
    </div>
  {/if}
</div>

{#if editingModel}
  <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
    <button
      type="button"
      class="absolute inset-0 cursor-default bg-background/70 backdrop-blur-sm"
      aria-label="Close model editor"
      onclick={closeEditor}
    ></button>
    <div
      class="relative z-10 w-full max-w-lg rounded-lg border border-border bg-card p-5 text-card-foreground shadow-2xl sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="local-model-editor-title"
    >
      <div class="flex items-start justify-between gap-4">
        <div class="min-w-0">
          <h3 id="local-model-editor-title" class="truncate text-base font-semibold">Configure model</h3>
          <p class="mt-1 truncate text-xs text-muted-foreground">{editingModel}</p>
        </div>
        <button
          type="button"
          class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Close model editor"
          onclick={closeEditor}
        ><X class="h-4 w-4" /></button>
      </div>

      <div class="mt-5 flex gap-3 rounded-xl border border-amber-500/25 bg-amber-500/8 p-3">
        <TriangleAlert class="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <div>
          <p class="mt-1 text-xs leading-relaxed text-muted-foreground">
            Enable only capabilities supported by the model and LM Studio to avoid request errors.
          </p>
        </div>
      </div>

      {#if reasoningOptions.length}
        <label class="mt-5 block">
          <span class="text-xs font-medium">Reasoning effort</span>
          <select
            class="settings-control mt-2 w-full"
            value={draftCapabilities.reasoningEffort}
            onchange={(event) => {
              draftCapabilities = {
                ...draftCapabilities,
                reasoningEffort: event.currentTarget.value as ChatReasoningEffort
              };
            }}
          >
            {#each reasoningOptions as option (option.value)}
              <option value={option.value}>{option.label}</option>
            {/each}
          </select>
        </label>
      {/if}

      <div class="mt-5">
        <p class="text-xs font-medium">Capabilities</p>
        {#if loadingCapabilitiesFor === editingModel}
          <div class="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle class="h-4 w-4 animate-spin" /> Loading configuration…
          </div>
        {:else}
          <div class="mt-2 divide-y divide-border/60">
            {#each [
              { key: 'tools', label: 'Tools', description: 'Function and vault tool calling', icon: Wrench },
              { key: 'images', label: 'Vision', description: 'Image attachments', icon: Eye },
              { key: 'audio', label: 'Audio', description: 'Audio attachments', icon: Headphones },
              { key: 'video', label: 'Video', description: 'Video attachments', icon: Video }
            ] as item (item.key)}
              <div class="flex items-center gap-3 py-3">
                <item.icon class="h-4 w-4 shrink-0 text-muted-foreground" />
                <span class="min-w-0 flex-1">
                  <span class="block text-sm font-medium">{item.label}</span>
                  <span class="block text-xs text-muted-foreground">{item.description}</span>
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={draftCapabilities[item.key as Capability]}
                  aria-label={`${item.label} capability`}
                  class={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${draftCapabilities[item.key as Capability] ? 'bg-primary' : 'bg-muted'}`}
                  onclick={() => toggleCapability(item.key as Capability)}
                >
                  <span class={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-background shadow-sm transition-transform ${draftCapabilities[item.key as Capability] ? 'translate-x-5' : 'translate-x-0'}`}></span>
                </button>
              </div>
            {/each}
          </div>
        {/if}
      </div>

      <div class="mt-6 flex justify-end gap-2">
        <button type="button" class="h-9 rounded-xl px-3 text-sm font-medium text-muted-foreground hover:bg-muted" onclick={closeEditor}>Cancel</button>
        <button
          type="button"
          class="h-9 rounded-xl bg-foreground px-4 text-sm font-medium text-background disabled:opacity-50"
          disabled={loadingCapabilitiesFor === editingModel || isSavingCapabilities}
          onclick={() => void saveCapabilities()}
        >{isSavingCapabilities ? 'Saving…' : 'Save changes'}</button>
      </div>
    </div>
  </div>
{/if}
