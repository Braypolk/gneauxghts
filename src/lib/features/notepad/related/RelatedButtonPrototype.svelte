<!-- Throwaway: three compact Related placements plus baseline, on /?variant=.
     Browser fixtures supplied by pnpm related:lab; no native mutations. -->
<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { Network, ChevronUp } from '@lucide/svelte';
  import PrototypeSwitcher from '$lib/ui/PrototypeSwitcher.svelte';

  const variants = [
    { key: 'A', name: 'Note header' },
    { key: 'B', name: 'Attached tray tab' },
    { key: 'C', name: 'Left edge tab' },
    { key: 'D', name: 'Current placement' }
  ];
  const details: Record<string, string> = {
    A: 'A note-level action. Frees the writing area; adds header density.',
    B: 'An attached drawer handle. Easy to find; still shares space with the dock.',
    C: 'Matches the wide layout’s left-side entry. Quiet, but less obvious.',
    D: 'Baseline: a floating pill above the bottom controls.'
  };
  let variant = $derived(variants.some(item => item.key === page.url.searchParams.get('variant')) ? page.url.searchParams.get('variant')! : 'A');
  let placement = $state('');
  let compact = $state(false);
  let expanded = $state(false);
  let viewportWidth = $state(0);
  let originalButton: HTMLButtonElement | null = null;

  onMount(() => {
    document.body.dataset.relatedPrototype = variant;
    function measure() {
      const sheet = document.querySelector<HTMLElement>('.related-bottom-sheet');
      compact = Boolean(sheet);
      originalButton = sheet?.querySelector<HTMLButtonElement>('button[aria-controls="related-drawer-panel"]') ?? null;
      expanded = originalButton?.getAttribute('aria-expanded') === 'true';
      viewportWidth = window.innerWidth;
      const card = document.querySelector<HTMLElement>('.notepad-workspace-card')?.getBoundingClientRect();
      const header = document.querySelector<HTMLElement>('.pane-header')?.getBoundingClientRect();
      const dock = document.querySelector<HTMLElement>('.workspace-input-dock .dock-body')?.getBoundingClientRect();
      if (!card || !header || !dock) return;
      if (variant === 'A') placement = `left:${header.left + 62}px;top:${header.top + 11}px;`;
      if (variant === 'B') placement = `left:${dock.right - 100}px;top:${dock.top - 29}px;`;
      if (variant === 'C') placement = `left:${card.left}px;top:${header.bottom + (dock.top - header.bottom) * 0.45}px;`;
    }
    measure();
    const timer = setInterval(measure, 100);
    return () => { clearInterval(timer); delete document.body.dataset.relatedPrototype; };
  });
  $effect(() => {
    if (typeof document !== 'undefined') document.body.dataset.relatedPrototype = variant;
  });
</script>

{#if import.meta.env.DEV}
  {#if compact && variant !== 'D'}
    <button
      class="prototype-related" class:header-action={variant === 'A'}
      class:tray-tab={variant === 'B'} class:edge-tab={variant === 'C'}
      style={placement} aria-label="Toggle related notes prototype" aria-expanded={expanded}
      title="Related notes" onclick={() => originalButton?.click()}
    >
      {#if variant === 'A'}<Network size={16} />{/if}
      {#if variant !== 'A' || viewportWidth >= 500}<span>Related</span>{/if}
      {#if variant === 'B'}<ChevronUp size={13} />{/if}
    </button>
  {/if}
  <PrototypeSwitcher {variants} current={variant} detail={details[variant]}
    state={`${viewportWidth}px · ${compact ? 'compact' : 'wide (existing side drawer)'} · panel ${expanded ? 'open' : 'closed'} · fixture data`} />
{/if}

<style>
  :global(body[data-related-prototype] .app-shell) { height: calc(100svh - 108px) !important; min-height: calc(100svh - 108px) !important; }
  :global(body[data-related-prototype]:not([data-related-prototype='D']) .related-bottom-sheet button[aria-controls='related-drawer-panel']) { visibility: hidden; }
  :global(body[data-related-prototype='A'] .pane-header-title-wrap) { margin-left: 94px; }
  .prototype-related { position: fixed; z-index: 45; display: inline-flex; align-items: center; justify-content: center; gap: 7px; border: 1px solid var(--border); background: var(--card); color: var(--muted-foreground); font: 500 12px/1 system-ui; cursor: pointer; }
  .prototype-related:hover, .prototype-related[aria-expanded='true'] { background: var(--accent); color: var(--foreground); }
  .header-action { height: 42px; padding: 0 12px; border-radius: 999px; border-color: transparent; }
  .tray-tab { width: 90px; height: 30px; min-height: 30px; border-bottom: 0; border-radius: 13px 13px 0 0; }
  .edge-tab { width: 25px; height: 100px; border-left: 0; border-radius: 0 13px 13px 0; }
  .edge-tab span { transform: rotate(-90deg); }
  @media (max-width: 499px) {
    :global(body[data-related-prototype='A'] .pane-header-title-wrap) { margin-left: 44px; }
  }
  @media (max-width: 450px) {
    :global(body[data-related-prototype] .app-shell) { height: calc(100svh - 136px) !important; min-height: calc(100svh - 136px) !important; }
  }
</style>
