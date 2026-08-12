<script lang="ts">
  import { Check, ChevronDown, Cpu, Sparkles } from '@lucide/svelte';
  import type { ChatProvider } from '$lib/features/chat/types';

  export interface ModelOption {
    provider: ChatProvider;
    model: string;
    label: string;
    configured: boolean;
  }

  let {
    options,
    provider,
    model,
    open,
    onOpenChange,
    onSelect
  }: {
    options: ModelOption[];
    provider: ChatProvider;
    model: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSelect: (option: ModelOption) => void | Promise<void>;
  } = $props();
</script>

<div class="relative" data-chat-menu data-slot="model-selector">
  <button
    type="button"
    class="chat-composer-chip"
    aria-label="AI model"
    aria-expanded={open}
    aria-haspopup="menu"
    onclick={() => onOpenChange(!open)}
  >
    {#if provider === 'local'}<Cpu class="h-3.5 w-3.5" />{:else}<Sparkles class="h-3.5 w-3.5" />{/if}
    <span class="max-w-28 truncate">{model || (provider === 'local' ? 'Local' : 'OpenAI')}</span>
    <ChevronDown class="h-3 w-3 opacity-60" />
  </button>
  {#if open}
    <div class="chat-menu chat-menu--up min-w-64" role="menu" aria-label="AI model">
      {#each options as option (`${option.provider}:${option.model}`)}
        <button
          type="button"
          class="chat-menu-item"
          class:chat-menu-item--active={option.provider === provider && option.model === model}
          disabled={!option.configured}
          role="menuitem"
          onclick={() => void onSelect(option)}
        >
          {#if option.provider === 'local'}<Cpu class="h-3.5 w-3.5 shrink-0" />{:else}<Sparkles class="h-3.5 w-3.5 shrink-0" />{/if}
          <span class="min-w-0 flex-1">
            <span class="block font-medium">{option.label}</span>
            <span class="block truncate text-[11px] font-normal text-muted-foreground">
              {option.model || 'Configure in Settings'}
            </span>
          </span>
          {#if option.provider === provider && option.model === model}<Check class="h-3.5 w-3.5 shrink-0" />{/if}
        </button>
      {/each}
    </div>
  {/if}
</div>
