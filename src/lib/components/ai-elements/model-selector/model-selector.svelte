<script lang="ts">
  import { Brain, Check, ChevronDown, Cpu, LoaderCircle, RefreshCw, Sparkles } from '@lucide/svelte';
  import type { ChatProvider, ChatReasoningEffort } from '$lib/features/chat/types';
  import type { ChatModelChoice, ChatReasoningChoice } from '$lib/features/chat/chatConfiguration';

  const providers: { value: ChatProvider; label: string }[] = [
    { value: 'openai', label: 'ChatGPT' },
    { value: 'local', label: 'Local' }
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
    providerOpen,
    modelOpen,
    reasoningOpen,
    onProviderOpenChange,
    onModelOpenChange,
    onReasoningOpenChange,
    onSelectProvider,
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
    providerOpen: boolean;
    modelOpen: boolean;
    reasoningOpen: boolean;
    onProviderOpenChange: (open: boolean) => void;
    onModelOpenChange: (open: boolean) => void;
    onReasoningOpenChange: (open: boolean) => void;
    onSelectProvider: (provider: ChatProvider) => void | Promise<void>;
    onSelectModel: (option: ChatModelChoice) => void | Promise<void>;
    onSelectReasoning: (effort: ChatReasoningEffort) => void | Promise<void>;
    onDiscoverLocal?: () => void | Promise<void>;
    onDiscoverOpenAi?: () => void | Promise<void>;
  } = $props();

  let customModel = $state('');

  const providerLabel = $derived(
    providers.find((option) => option.value === provider)?.label ?? provider
  );
  const providerModels = $derived(
    options.filter((option) => option.provider === provider)
  );

  function useCustomModel(event: SubmitEvent) {
    event.preventDefault();
    const selectedModel = customModel.trim();
    if (!selectedModel || disabled) return;
    void onSelectModel({
      provider,
      model: selectedModel,
      displayName: selectedModel,
      description: 'Custom'
    });
    customModel = '';
  }

  const selectedModelLabel = $derived(
    providerModels.find((option) => option.model === model)?.displayName ?? model
  );
  const selectedReasoningLabel = $derived(
    reasoningOptions.find((option) => option.value === reasoningEffort)?.label ?? reasoningEffort
  );
</script>

<div class="contents" data-slot="model-selector">
  <div class="relative" data-chat-menu>
    <button
      type="button"
      class="chat-composer-chip"
      {disabled}
      aria-label="AI provider"
      aria-expanded={providerOpen}
      aria-haspopup="menu"
      onclick={() => !disabled && onProviderOpenChange(!providerOpen)}
    >
      {#if provider === 'local'}<Cpu class="h-3.5 w-3.5" />{:else}<Sparkles class="h-3.5 w-3.5" />{/if}
      <span>{providerLabel}</span>
      <ChevronDown class="h-3 w-3 opacity-60" />
    </button>

    {#if providerOpen}
      <div class="chat-menu chat-menu--up" role="menu" aria-label="AI provider picker">
        {#each providers as option (option.value)}
          <button
            type="button"
            class="chat-menu-item w-full"
            class:chat-menu-item--active={option.value === provider}
            role="menuitem"
            onclick={() => void onSelectProvider(option.value)}
          >
            {#if option.value === 'local'}<Cpu class="h-3.5 w-3.5 shrink-0" />{:else}<Sparkles class="h-3.5 w-3.5 shrink-0" />{/if}
            <span class="min-w-0 flex-1">{option.label}</span>
            {#if option.value === provider}<Check class="h-3.5 w-3.5 shrink-0" />{/if}
          </button>
        {/each}
      </div>
    {/if}
  </div>

  <div class="relative min-w-0" data-chat-menu>
    <button
      type="button"
      class="chat-composer-chip"
      {disabled}
      aria-label="AI model"
      aria-expanded={modelOpen}
      aria-haspopup="menu"
      onclick={() => !disabled && onModelOpenChange(!modelOpen)}
    >
      <span class="max-w-28 truncate">{selectedModelLabel || 'Choose model'}</span>
      <ChevronDown class="h-3 w-3 opacity-60" />
    </button>

    {#if modelOpen}
      <div class="chat-menu chat-menu--up min-w-72" aria-label="AI model picker">
        <div role="menu" aria-label={`${providerLabel} models`}>
          {#each providerModels as option (option.model)}
            <button
              type="button"
              class="chat-menu-item w-full"
              class:chat-menu-item--active={option.model === model}
              role="menuitem"
              onclick={() => void onSelectModel(option)}
            >
              <span class="min-w-0 flex-1">
                <span class="block truncate font-medium">{option.displayName}</span>
                <span class="block truncate text-[11px] font-normal text-muted-foreground">
                  {option.description || option.model}
                </span>
              </span>
              {#if option.model === model}<Check class="h-3.5 w-3.5 shrink-0" />{/if}
            </button>
          {/each}

          {#if providerModels.length === 0}
            <div class="px-2 py-1.5 text-xs text-muted-foreground">
              No known models for {providerLabel}.
            </div>
          {/if}

          {#if provider === 'local' && onDiscoverLocal}
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
                <span>Discover local models</span>
              {/if}
            </button>
          {/if}
          {#if provider === 'openai' && onDiscoverOpenAi}
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
            Use a {providerLabel} model ID
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
        class="chat-composer-chip"
        {disabled}
        aria-label="Reasoning effort"
        aria-expanded={reasoningOpen}
        aria-haspopup="menu"
        onclick={() => !disabled && onReasoningOpenChange(!reasoningOpen)}
      >
        <Brain class="h-3.5 w-3.5" />
        <span>{selectedReasoningLabel}</span>
        <ChevronDown class="h-3 w-3 opacity-60" />
      </button>
      {#if reasoningOpen}
        <div class="chat-menu chat-menu--up" role="menu" aria-label="Reasoning effort picker">
          {#each reasoningOptions as option (option.value)}
            <button
              type="button"
              class="chat-menu-item w-full"
              class:chat-menu-item--active={option.value === reasoningEffort}
              role="menuitem"
              onclick={() => void onSelectReasoning(option.value)}
            >
              <span class="min-w-0 flex-1">{option.label}</span>
              {#if option.value === reasoningEffort}<Check class="h-3.5 w-3.5 shrink-0" />{/if}
            </button>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>
