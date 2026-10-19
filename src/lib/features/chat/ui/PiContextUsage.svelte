<script lang="ts">
  import { Tooltip } from 'bits-ui';
  import { estimateMessageTokens } from '@earendil-works/pi-ai/utils/estimate';
  import type { AssistantMessage } from '@earendil-works/pi-ai';

  let { usage, message, compacting = false }: {
    usage?: { tokens: number; capacity: number }; message?: AssistantMessage; compacting?: boolean;
  } = $props();
  let open = $state(false);
  const tokens = $derived(usage ? usage.tokens + (message ? estimateMessageTokens(message) : 0) : undefined);
  const capacity = $derived(usage && usage.capacity > 0 ? usage.capacity : undefined);
  const percent = $derived(tokens !== undefined && capacity ? Math.min(100, Math.round(tokens / capacity * 100)) : undefined);
  const count = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
  const details = $derived(tokens === undefined ? 'Usage will appear after you send a message.'
    : capacity ? `Approximately ${count.format(tokens)} / ${count.format(capacity)} tokens used`
    : `Approximately ${count.format(tokens)} tokens used · capacity unavailable`);
  const label = $derived(`Context window: ${percent === undefined ? details : `${percent}% used (${100 - percent}% left). ${details}`}${compacting ? '. Compacting conversation.' : ''}`);
</script>

<Tooltip.Provider delayDuration={200}>
  <Tooltip.Root bind:open disableCloseOnTriggerClick>
    <Tooltip.Trigger class="context-usage" aria-label={label} data-testid="pi-context-usage" onclick={() => open = true}>
      <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <circle cx="10" cy="10" r="7" stroke="currentColor" stroke-width="2.5" opacity=".2" />
        {#if percent !== undefined}<circle cx="10" cy="10" r="7" stroke="currentColor" stroke-width="2.5" pathLength="100" stroke-dasharray={`${percent} 100`} transform="rotate(-90 10 10)" />{/if}
      </svg>
      <span>{percent === undefined ? '—' : `${percent}%`}</span>
    </Tooltip.Trigger>
    <Tooltip.Portal>
      <Tooltip.Content side="top" sideOffset={8} class="context-usage-tooltip" data-testid="pi-context-tooltip">
        <p class="text-muted-foreground">Context window</p>
        {#if percent !== undefined}<p>{percent}% used ({100 - percent}% left)</p>{/if}
        <p>{details}</p>
        {#if compacting}<p class="text-muted-foreground">Compacting conversation…</p>{/if}
      </Tooltip.Content>
    </Tooltip.Portal>
  </Tooltip.Root>
</Tooltip.Provider>

<style>
  :global(.context-usage) { display: inline-flex; flex: none; align-items: center; gap: .3rem; min-height: 1.65rem; padding: .2rem .35rem; border-radius: 9999px; color: var(--muted-foreground); font-size: .65rem; font-variant-numeric: tabular-nums; }
  :global(.context-usage:hover), :global(.context-usage[data-state="instant-open"]), :global(.context-usage[data-state="delayed-open"]) { background: color-mix(in oklab, var(--foreground) 8%, transparent); color: var(--foreground); }
  :global(.context-usage:focus-visible) { outline: 2px solid var(--ring); outline-offset: 2px; }
  :global(.context-usage-tooltip) { z-index: 50; max-width: calc(100vw - 1rem); border-radius: .85rem; background: var(--popover); color: var(--popover-foreground); padding: .65rem .9rem; box-shadow: 0 4px 20px #0002; border: 1px solid var(--border); text-align: center; font-size: .8rem; line-height: 1.6; }
</style>
