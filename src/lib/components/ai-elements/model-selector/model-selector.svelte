<script lang="ts">
  import { Check, ChevronDown, LoaderCircle, RefreshCw } from '@lucide/svelte';
  import type { ChatProvider, ChatReasoningEffort } from '$lib/features/chat/types';
  import type { ChatModelChoice, ChatReasoningChoice } from '$lib/features/chat/chatConfiguration';

  const providers: { value: ChatProvider; label: string }[] = [
    { value: 'openai', label: 'ChatGPT' },
    { value: 'local', label: 'Server' }
  ];

  let {
    options,
    provider,
    model,
    reasoningEffort,
    reasoningOptions,
    disabled = false,
    isDiscoveringLocal = false,
    isDiscoveringOpenAi = false,
    modelOpen,
    reasoningOpen,
    onModelOpenChange,
    onReasoningOpenChange,
    onSelectModel,
    onSelectReasoning,
    onDiscoverLocal,
    onDiscoverOpenAi
  }: {
    options: ChatModelChoice[];
    provider: ChatProvider;
    model: string;
    reasoningEffort: ChatReasoningEffort;
    reasoningOptions: ChatReasoningChoice[];
    disabled?: boolean;
    isDiscoveringLocal?: boolean;
    isDiscoveringOpenAi?: boolean;
    modelOpen: boolean;
    reasoningOpen: boolean;
    onModelOpenChange: (open: boolean) => void;
    onReasoningOpenChange: (open: boolean) => void;
    onSelectModel: (option: ChatModelChoice) => void | Promise<void>;
    onSelectReasoning: (effort: ChatReasoningEffort) => void | Promise<void>;
    onDiscoverLocal?: () => void | Promise<void>;
    onDiscoverOpenAi?: () => void | Promise<void>;
  } = $props();

  let customModel = $state('');
  let browsingProvider = $state<ChatProvider | null>(null);

  $effect(() => {
    if (!modelOpen) browsingProvider = null;
  });

  const menuProvider = $derived(browsingProvider ?? provider);
  let previewReasoningEffort = $state<ChatReasoningEffort | null>(null);
  let reasoningSelectionSequence = 0;
  let pendingReasoning = $state<{
    id: number; provider: ChatProvider; model: string; effort: ChatReasoningEffort;
  } | null>(null);

  $effect(() => {
    model;
    reasoningEffort;
    reasoningOpen;
    previewReasoningEffort = null;
  });

  const providerLabel = $derived(
    providers.find((option) => option.value === menuProvider)?.label ?? menuProvider
  );
  const providerModels = $derived(
    options.filter((option) => option.provider === menuProvider)
  );

  function useCustomModel(event: SubmitEvent) {
    event.preventDefault();
    const selectedModel = customModel.trim();
    if (!selectedModel || disabled) return;
    void onSelectModel({
      provider: menuProvider,
      model: selectedModel,
      displayName: selectedModel,
      description: 'Custom'
    });
    customModel = '';
  }

  const selectedModelLabel = $derived(
    options.find((option) => option.provider === provider && option.model === model)?.displayName ?? model
  );
  const committedReasoningEffort = $derived(
    pendingReasoning?.provider === provider && pendingReasoning.model === model
      ? pendingReasoning.effort : reasoningEffort
  );
  const committedReasoningLabel = $derived(
    reasoningOptions.find((option) => option.value === committedReasoningEffort)?.label ?? committedReasoningEffort
  );
  const selectedReasoningLabel = $derived(
    reasoningOptions.find((option) => option.value === (previewReasoningEffort ?? committedReasoningEffort))?.label ?? committedReasoningEffort
  );
  const selectedReasoningIndex = $derived(
    Math.max(0, reasoningOptions.findIndex((option) => option.value === (previewReasoningEffort ?? committedReasoningEffort)))
  );

  async function selectReasoning(effort: ChatReasoningEffort) {
    if (disabled) return;
    const id = ++reasoningSelectionSequence;
    // Keep the accepted label through the parent's asynchronous save. Closing
    // the popup clears its preview before the persisted prop reaches us.
    pendingReasoning = { id, provider, model, effort };
    try {
      await onSelectReasoning(effort);
    } finally {
      if (pendingReasoning?.id === id) pendingReasoning = null;
    }
  }
</script>

<div class="chat-model-selector" data-slot="model-selector">
  <div class="relative min-w-0" data-chat-menu>
    <button
      type="button"
      class="chat-model-control chat-model-name"
      {disabled}
      aria-label="AI model"
      title={`${provider === 'local' ? 'Server' : 'ChatGPT'} · ${selectedModelLabel || 'Choose model'}`}
      aria-expanded={modelOpen}
      aria-haspopup="dialog"
      onclick={() => !disabled && onModelOpenChange(!modelOpen)}
    >
      <span class="max-w-28 truncate">{selectedModelLabel || 'Choose model'}</span>
      <ChevronDown class="h-3 w-3 opacity-60" />
    </button>

    {#if modelOpen}
      <div class="chat-menu chat-menu--up chat-menu--right chat-model-menu" role="dialog" aria-label="AI model picker">
        <div class="chat-model-provider-picker" role="group" aria-label="AI provider picker">
          {#each providers as option (option.value)}
            <button
              type="button"
              class="chat-model-provider-option"
              aria-pressed={option.value === menuProvider}
              {disabled}
              onclick={() => {
                browsingProvider = option.value;
                customModel = '';
              }}
            >{option.label}</button>
          {/each}
        </div>
        <div role="menu" aria-label={`${providerLabel} models`}>
          {#each providerModels as option (option.model)}
            <button
              type="button"
              class="chat-menu-item w-full"
              class:chat-menu-item--active={option.provider === provider && option.model === model}
              role="menuitem"
              onclick={() => void onSelectModel(option)}
            >
              <span class="min-w-0 flex-1">
                <span class="block truncate font-medium">{option.displayName}</span>
                <span class="block truncate text-[11px] font-normal text-muted-foreground">
                  {option.description || option.model}
                </span>
              </span>
              {#if option.provider === provider && option.model === model}<Check class="h-3.5 w-3.5 shrink-0" />{/if}
            </button>
          {/each}

          {#if providerModels.length === 0}
            <div class="px-2 py-1.5 text-xs text-muted-foreground">
              No known models for {providerLabel}.
            </div>
          {/if}

          {#if menuProvider === 'local' && onDiscoverLocal}
            <button
              type="button"
              class="chat-menu-item w-full text-muted-foreground"
              disabled={isDiscoveringLocal}
              role="menuitem"
              onclick={() => void onDiscoverLocal?.()}
            >
              {#if isDiscoveringLocal}
                <LoaderCircle class="h-3.5 w-3.5 shrink-0 animate-spin" />
                <span>Discovering models…</span>
              {:else}
                <RefreshCw class="h-3.5 w-3.5 shrink-0" />
                <span>Discover server models</span>
              {/if}
            </button>
          {/if}
          {#if menuProvider === 'openai' && onDiscoverOpenAi}
            <button
              type="button"
              class="chat-menu-item w-full text-muted-foreground"
              disabled={isDiscoveringOpenAi}
              role="menuitem"
              onclick={() => void onDiscoverOpenAi?.()}
            >
              {#if isDiscoveringOpenAi}
                <LoaderCircle class="h-3.5 w-3.5 shrink-0 animate-spin" />
                <span>Checking availability…</span>
              {:else}
                <RefreshCw class="h-3.5 w-3.5 shrink-0" />
                <span>Check available models</span>
              {/if}
            </button>
          {/if}
        </div>

        <form class="mt-1 space-y-2 border-t border-border/70 px-2 pb-1 pt-2" onsubmit={useCustomModel}>
          <div class="text-[11px] font-medium text-muted-foreground">
            Use a model ID
          </div>
          <div class="flex gap-1.5">
            <input
              class="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-xs outline-none placeholder:text-muted-foreground"
              bind:value={customModel}
              placeholder="Model ID"
              spellcheck="false"
              aria-label="Custom model ID"
            />
            <button
              type="submit"
              class="rounded-md bg-foreground px-2.5 py-1.5 text-xs font-medium text-background disabled:opacity-40"
              disabled={!customModel.trim()}
            >Use</button>
          </div>
        </form>
      </div>
    {/if}
  </div>

  {#if reasoningOptions.length > 0}
    <div class="relative" data-chat-menu>
      <button
        type="button"
        class="chat-model-control chat-model-effort"
        {disabled}
        aria-label="Reasoning effort"
        aria-expanded={reasoningOpen}
        aria-haspopup="dialog"
        onclick={() => !disabled && onReasoningOpenChange(!reasoningOpen)}
      >
        <span class="chat-model-effort-label">
          {#each reasoningOptions as option (option.value)}
            <span class="chat-model-effort-measure" aria-hidden="true">{option.label}</span>
          {/each}
          <span>{committedReasoningLabel}</span>
        </span>
        <ChevronDown class="h-3 w-3 opacity-60" />
      </button>
      {#if reasoningOpen}
        <div class="chat-menu chat-menu--up chat-menu--right chat-effort-menu" role="dialog" aria-label="Reasoning effort picker">
          <div class="chat-effort-heading">
            <span>{selectedReasoningLabel}</span>
          </div>
          <p class="chat-effort-model">{selectedModelLabel}</p>
          {#if reasoningOptions.length > 1}
            <input
              class="chat-effort-slider"
              type="range"
              min="0"
              max={reasoningOptions.length - 1}
              step="1"
              value={selectedReasoningIndex}
              style={`--effort-progress: ${selectedReasoningIndex / (reasoningOptions.length - 1) * 100}%`}
              aria-label="Reasoning effort level"
              aria-valuetext={selectedReasoningLabel}
              {disabled}
              oninput={(event) => {
                previewReasoningEffort = reasoningOptions[Number(event.currentTarget.value)]?.value ?? null;
              }}
              onchange={(event) => {
                const option = reasoningOptions[Number(event.currentTarget.value)];
                if (option) void selectReasoning(option.value);
              }}
            />
          {/if}
          <div class="chat-effort-options" role="menu" aria-label="Reasoning effort choices">
            {#each reasoningOptions as option (option.value)}
              <button
                type="button"
                class="chat-effort-option"
                class:chat-effort-option--active={option.value === (previewReasoningEffort ?? committedReasoningEffort)}
                role="menuitem"
                onclick={() => void selectReasoning(option.value)}
              >
                <span>{option.label}</span>
              </button>
            {/each}
          </div>
        </div>
      {/if}
    </div>
  {/if}
</div>
