<script lang="ts">
  import { onDestroy } from 'svelte';
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
  import { chatSettings } from '#lib/features/chat/pi/settings.js';
  import type {
    ChatReasoningEffort,
    ChatModelCapabilities,
    LocalModel,
    LocalModelCapabilitySelection
  } from '#lib/features/chat/types.js';
  import { mergeLocalModels } from './localModels';
  import { chatReasoningChoices } from '#lib/features/chat/chatConfiguration.js';

  interface Props {
    baseUrl: string;
    selectedModel: string;
    onSelect: (model: string) => void;
    onStatus?: (message: string) => void;
    onError?: (message: string) => void;
  }

  type Capability = 'images' | 'tools' | 'audio' | 'video';

  let { baseUrl, selectedModel, onSelect, onStatus, onError }: Props = $props();

  const api = chatSettings;
  const defaultCapabilities: LocalModelCapabilitySelection = {
    images: false,
    tools: true,
    audio: false,
    video: false,
    reasoningEffort: 'medium'
  };

  let discoveredModels = $state<LocalModel[]>([]);
  let capabilitiesByModel = $state<Record<string, LocalModelCapabilitySelection>>({});
  let metadataByModel = $state<Record<string, ChatModelCapabilities>>({});
  let isDiscovering = $state(false);
  let discoveryError = $state<string | null>(null);
  let showManualEntry = $state(false);
  let manualModel = $state('');
  let editingModel = $state<string | null>(null);
  let draftCapabilities = $state<LocalModelCapabilitySelection>({ ...defaultCapabilities });
  let loadingCapabilitiesFor = $state<string | null>(null);
  let isSavingCapabilities = $state(false);
  let editorOrigin: HTMLElement | null = null;

  let disposed = false;
  let discoveryGeneration = 0;
  let endpointGeneration = 0;
  onDestroy(() => { disposed = true; discoveryGeneration++; endpointGeneration++; });
  $effect(() => {
    // Endpoint edits retire only this view's results; they never start discovery.
    baseUrl;
    discoveryGeneration++;
    endpointGeneration++;
    discoveredModels = [];
    capabilitiesByModel = {};
    metadataByModel = {};
    discoveryError = null;
    isDiscovering = false;
  });

  const models = $derived(mergeLocalModels(discoveredModels, selectedModel));
  const reasoningOptions = $derived(
    editingModel ? chatReasoningChoices('local', editingModel, metadataByModel[editingModel]) : []
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
    const endpoint = baseUrl;
    const generation = endpointGeneration;
    const metadata = await api.getModelCapabilities('local', model, endpoint);
    if (disposed || generation !== endpointGeneration || endpoint !== baseUrl) throw new Error('Server endpoint changed while loading model capabilities.');
    metadataByModel = { ...metadataByModel, [model]: metadata };
    const capabilities = capabilitySelection(metadata);
    capabilitiesByModel = { ...capabilitiesByModel, [model]: capabilities };
    return capabilities;
  }

  // Discovery can unlock a saved server credential. Keep Settings inspection
  // passive; refresh and model configuration are explicit user actions.
  async function refreshModels() {
    if (!baseUrl.trim()) {
      discoveryError = 'Enter a local endpoint before refreshing models.';
      return;
    }
    const endpoint = baseUrl;
    const generation = ++discoveryGeneration;
    const current = () => !disposed && endpoint === baseUrl && generation === discoveryGeneration;
    isDiscovering = true;
    discoveryError = null;
    try {
      const discovered = await api.listLocalModels(endpoint);
      if (!current()) return;
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
      if (!current()) return;
      onStatus?.(
        discovered.length
          ? `Found ${discovered.length} local model${discovered.length === 1 ? '' : 's'}.`
          : 'The local endpoint is reachable, but it returned no models.'
      );
    } catch (refreshError) {
      if (current()) discoveryError = errorText(refreshError, 'Unable to reach the local model endpoint.');
    } finally {
      if (current()) isDiscovering = false;
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

  async function openEditor(
    model: string,
    origin: HTMLElement | null = document.activeElement instanceof HTMLElement ? document.activeElement : null
  ) {
    if (disposed) return;
    editorOrigin = origin;
    const endpoint = baseUrl;
    const generation = endpointGeneration;
    const current = () => !disposed && endpoint === baseUrl && generation === endpointGeneration && editingModel === model;
    editingModel = model;
    loadingCapabilitiesFor = model;
    draftCapabilities = capabilitiesByModel[model] ?? { ...defaultCapabilities };
    try {
      const capabilities = await loadCapabilities(model);
      if (current()) draftCapabilities = capabilities;
    } catch (loadError) {
      if (current()) {
        onError?.(errorText(loadError, 'Unable to load this model’s capabilities.'));
      }
    } finally {
      if (!disposed && loadingCapabilitiesFor === model) loadingCapabilitiesFor = null;
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

  function mountEditorDialog(dialog: HTMLDialogElement) {
    const origin = editorOrigin;
    dialog.showModal();
    dialog.querySelector<HTMLButtonElement>('[data-model-editor-close]')?.focus({ preventScroll: true });
    return {
      destroy() {
        dialog.close();
        if (origin?.isConnected) origin.focus({ preventScroll: true });
      }
    };
  }

  function handleEditorKeydown(event: KeyboardEvent) {
    event.stopPropagation();
    if (event.key !== 'Tab') return;
    const dialog = event.currentTarget as HTMLDialogElement;
    const controls = [...dialog.querySelectorAll<HTMLElement>('button, input, select, textarea, [tabindex]')]
      .filter(control => control.tabIndex >= 0 && !control.matches(':disabled') &&
        control.getClientRects().length > 0 && getComputedStyle(control).visibility === 'visible');
    const boundary = event.shiftKey ? controls[0] : controls.at(-1);
    if (document.activeElement !== boundary) return;
    event.preventDefault();
    (event.shiftKey ? controls.at(-1) : controls[0])?.focus();
  }

</script>

<div class="overflow-hidden rounded-lg border border-border/80 bg-background/60">
  <div class="flex items-center justify-between gap-3 border-b border-border/70 px-4 py-3">
    <div>
      <h4 class="text-sm font-semibold">Models</h4>
    </div>
    <div class="flex items-center gap-1.5">
      <button
        type="button"
        class="coarse-touch-target inline-flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
        aria-label="Refresh server models"
        title="Refresh models from the server endpoint"
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
        class="coarse-touch-target inline-flex h-9 w-9 items-center justify-center rounded-full bg-muted text-muted-foreground transition-colors hover:text-foreground"
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
      <label class="sr-only" for="manual-local-model">Server model ID</label>
      <input
        id="manual-local-model"
        class="settings-control min-w-0 flex-1"
        bind:value={manualModel}
        placeholder="Model ID from your server"
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
                {#if chatReasoningChoices('local', model.id, metadataByModel[model.id]).length}
                  <Brain class="h-3.5 w-3.5" aria-label={`Reasoning: ${capabilities.reasoningEffort}`} />
                {/if}
              </span>
            {/if}
          </button>
          <button
            type="button"
            class="coarse-touch-target inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label={`Configure ${model.id}`}
            title="Configure model capabilities"
            onclick={(event) => void openEditor(model.id, event.currentTarget)}
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
  <dialog
    use:mountEditorDialog
    class="model-editor-dialog safe-area-overlay fixed z-50 bg-background/70 backdrop-blur-sm"
    aria-labelledby="local-model-editor-title"
    onkeydown={handleEditorKeydown}
    oncancel={(event) => { event.preventDefault(); closeEditor(); }}
    onpointerdown={(event) => {
      if (event.target !== event.currentTarget) return;
      // Keep the pointer's default focus change from undoing focus restoration.
      event.preventDefault();
      closeEditor();
    }}
  >
    <div
      class="relative z-10 max-h-full w-full max-w-lg overflow-y-auto overscroll-contain rounded-lg border border-border bg-card p-5 text-card-foreground shadow-2xl sm:p-6"
    >
      <div class="flex items-start justify-between gap-4">
        <div class="min-w-0">
          <h3 id="local-model-editor-title" class="truncate text-base font-semibold">Configure model</h3>
          <p class="mt-1 truncate text-xs text-muted-foreground">{editingModel}</p>
        </div>
        <button
          type="button"
          class="coarse-touch-target inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
          data-model-editor-close
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
                  class="coarse-touch-target inline-flex h-6 w-11 shrink-0 items-center justify-center rounded-full"
                  onclick={() => toggleCapability(item.key as Capability)}
                >
                  <span class={`relative h-6 w-11 rounded-full transition-colors ${draftCapabilities[item.key as Capability] ? 'bg-primary' : 'bg-muted'}`} aria-hidden="true">
                    <span class={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-background shadow-sm transition-transform ${draftCapabilities[item.key as Capability] ? 'translate-x-5' : 'translate-x-0'}`}></span>
                  </span>
                </button>
              </div>
            {/each}
          </div>
        {/if}
      </div>

      <div class="mt-6 flex justify-end gap-2">
        <button type="button" class="coarse-touch-target h-9 rounded-xl px-3 text-sm font-medium text-muted-foreground hover:bg-muted" onclick={closeEditor}>Cancel</button>
        <button
          type="button"
          class="coarse-touch-target h-9 rounded-xl bg-foreground px-4 text-sm font-medium text-background disabled:opacity-50"
          disabled={loadingCapabilitiesFor === editingModel || isSavingCapabilities}
          onclick={() => void saveCapabilities()}
        >{isSavingCapabilities ? 'Saving…' : 'Save changes'}</button>
      </div>
    </div>
  </dialog>
{/if}

<style>
  .model-editor-dialog { width: 100%; max-width: none; max-height: none; margin: 0; border: 0; }
  .model-editor-dialog[open] { display: flex; align-items: center; justify-content: center; }
  .model-editor-dialog::backdrop { background: transparent; }
</style>
