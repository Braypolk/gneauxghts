<script lang="ts">
  import { onMount } from 'svelte';
  import { hiddenFloatingPanelStyle, positionFloatingPanel } from '$lib/ui/floatingPanel';
  import { mountInSlot } from '$lib/ui/mountInSlot';
  import type { ExternalLinkActionsSession } from './externalLinkExtension';

  let { session, onClose }: { session: ExternalLinkActionsSession; onClose: () => void } = $props();
  let panel: HTMLDivElement;
  let openButton: HTMLButtonElement;
  let panelStyle = $state(hiddenFloatingPanelStyle);

  function dismiss(restoreFocus = false) {
    if (restoreFocus) session.focus();
    onClose();
  }

  onMount(() => {
    const stopPositioning = positionFloatingPanel(session.anchor, panel, style => { panelStyle = style; });
    const unsubscribe = session.subscribe(onClose);
    openButton.focus({ preventScroll: true });
    return () => { unsubscribe(); stopPositioning(); };
  });

  function outside(event: PointerEvent) {
    if (event.target instanceof Node && !panel.contains(event.target) && !session.anchor.contains(event.target)) dismiss();
  }
  function keydown(event: KeyboardEvent) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    dismiss(true);
  }
</script>

<svelte:document onpointerdowncapture={outside} onkeydowncapture={keydown}
  onvisibilitychange={() => { if (document.hidden) dismiss(); }} />
<svelte:window onblur={() => dismiss()} />

<div bind:this={panel} use:mountInSlot={document.body} class="gn-external-link-actions"
  role="dialog" aria-label="External link actions" tabindex="-1" style={panelStyle}>
  <div class="destination">{session.rawUrl}</div>
  <button bind:this={openButton} type="button" onclick={() => { session.open(); onClose(); }}>Open link</button>
  <button type="button" onclick={() => { session.edit(); onClose(); }}>Edit link</button>
  <button type="button" onclick={() => dismiss(true)}>Close</button>
</div>

<style>
  .gn-external-link-actions {
    z-index: 60;
    width: 18rem;
    padding: 0.4rem;
    border: 1px solid var(--border);
    border-radius: 1rem;
    background: var(--popover);
    color: var(--popover-foreground);
    box-shadow: 0 12px 36px -16px color-mix(in oklab, var(--foreground) 35%, transparent);
    overflow-y: auto;
  }
  .destination {
    padding: 0.5rem;
    font-size: 0.75rem;
    overflow-wrap: anywhere;
    color: var(--muted-foreground);
  }
  button {
    display: block;
    width: 100%;
    min-height: 44px;
    padding: 0.5rem;
    border-radius: 0.6rem;
    text-align: left;
    font-size: 0.875rem;
    touch-action: manipulation;
  }
  button:is(:hover, :focus-visible) {
    background: var(--accent);
    outline: 2px solid var(--ring);
    outline-offset: -2px;
  }
</style>
