<script lang="ts">
  import { getContext, type Snippet } from 'svelte';
  import { mountInSlot } from './mountInSlot';
  import { workspaceTitleSlotKey, type WorkspaceTitleSlot } from './workspaceTitleSlot';
  import { MediaQuery } from 'svelte/reactivity';

  // Match the note card's edge-to-edge breakpoint.
  const compact = new MediaQuery('(max-width: 639px), (any-pointer: coarse) and (max-height: 559px)');

  interface Props {
    titleText: string;
    titlePlaceholder: string;
    title: Snippet;
    secondaryActions?: Snippet;
    right?: Snippet;
    primaryActions?: Snippet;
    subtitle?: Snippet;
    titleShell?: HTMLDivElement | null;
    titleMeasureTestId?: string;
    workspace?: boolean;
    split?: boolean;
    mobileTitleActive?: boolean;
  }

  let {
    titleText, titlePlaceholder, title, secondaryActions, right, primaryActions, subtitle,
    titleShell = $bindable(null), titleMeasureTestId,
    workspace = false, split = false, mobileTitleActive = true
  }: Props = $props();
  const getTitleSlot = getContext<WorkspaceTitleSlot | undefined>(workspaceTitleSlotKey);
  const titleSlot = $derived(compact.current && workspace && mobileTitleActive ? getTitleSlot?.() : null);
  let titleOverflows = $state(false);

  function trackTitleOverflow(node: HTMLElement, _text: string) {
    const measure = () => {
      titleOverflows = node.scrollWidth > node.clientWidth + 1;
      const input = node.parentElement?.querySelector('input');
      if (input && document.activeElement !== input) input.scrollLeft = 0;
    };
    const afterBlur = () => queueMicrotask(measure);
    const titleSurface = node.parentElement!;
    titleSurface.addEventListener('blur', afterBlur, true);
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return {
      update() { queueMicrotask(measure); },
      destroy() { observer.disconnect(); titleSurface.removeEventListener('blur', afterBlur, true); }
    };
  }
</script>

<header class="pane-header" class:pane-header--compact={compact.current} class:pane-header--workspace={workspace} class:pane-header--split={split} class:pane-header--subtitle={Boolean(subtitle)}>
  <div class="pane-header-left">{#if secondaryActions}{@render secondaryActions()}{/if}</div>
  <div class="pane-header-title-wrap" class:pane-header-title-wrap--mobile-slot={Boolean(titleSlot)} use:mountInSlot={titleSlot}>
    <div bind:this={titleShell} class="pane-header-title" class:pane-header-title--leading={Boolean(primaryActions)} class:pane-header-title--overflow={titleOverflows}>
      {#if primaryActions}{@render primaryActions()}{/if}
      <span class="pane-header-title-measure" aria-hidden="true" use:trackTitleOverflow={titleText || titlePlaceholder}><span data-testid={titleMeasureTestId}>{titleText || titlePlaceholder}</span></span>
      {@render title()}
    </div>
    {#if subtitle}<div class="pane-header-subtitle">{@render subtitle()}</div>{/if}
  </div>
  <div class="pane-header-right">
    {#if right}{@render right()}{/if}
  </div>
</header>

<style>
  /* Both scrolling surfaces reserve the same space beneath this overlay. */
  :global(.pane-header-host) { container: pane-header / inline-size; --pane-header-block-size: 4rem; }
  :global(.pane-header-host:has(> .pane-header--subtitle)) { --pane-header-block-size: 4.5rem; }
  .pane-header {
    position: relative;
    z-index: 20;
    isolation: isolate;
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 1rem 1rem 0.75rem;
    min-height: var(--pane-header-block-size, 4rem);
  }
  .pane-header::before {
    content: '';
    position: absolute;
    inset: 0;
    z-index: -1;
    pointer-events: none;
    background: color-mix(in oklab, var(--card) 58%, transparent);
    backdrop-filter: blur(var(--blur-sm, 8px));
    -webkit-backdrop-filter: blur(var(--blur-sm, 8px));
    mask-image: linear-gradient(to top, transparent 0%, black 40%, black 100%);
    -webkit-mask-image: linear-gradient(to top, transparent 0%, black 40%, black 100%);
  }
  .pane-header--subtitle { min-height: var(--pane-header-block-size, 4.5rem); padding-bottom: 1.25rem; }
  .pane-header-left, .pane-header-right {
    position: relative;
    z-index: 1;
    display: flex;
    flex-shrink: 0;
    align-items: center;
    gap: 0.5rem;
  }
  .pane-header-title-wrap {
    position: absolute;
    inset: 1rem 4rem auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    pointer-events: none;
  }
  .pane-header-title {
    position: relative;
    display: grid;
    width: fit-content;
    min-width: 4rem;
    max-width: min(24rem, 100%);
    pointer-events: auto;
  }
  .pane-header-title--leading { max-width: min(24rem, calc(100% - 2.75rem)); }
  .pane-header-title-measure, .pane-header-title :global(input) {
    grid-column: 1;
    grid-row: 1;
    min-width: 0;
    font-size: 1.5rem;
    font-weight: 600;
    letter-spacing: -0.025em;
    line-height: 2rem;
  }
  .pane-header-title-measure { opacity: 0; pointer-events: none; overflow: hidden; white-space: pre; }
  .pane-header-title :global(input) {
    width: 100%;
    background: transparent;
    text-align: center;
    outline: none;
  }
  .pane-header-title :global(input::placeholder) { color: color-mix(in oklab, var(--muted-foreground) 55%, transparent); }
  .pane-header-title--overflow :global(input) { text-align: left; }
  .pane-header-title--overflow :global(input:not(:focus)) {
    mask-image: linear-gradient(to right, black calc(100% - 1rem), transparent);
    -webkit-mask-image: linear-gradient(to right, black calc(100% - 1rem), transparent);
  }
  .pane-header-subtitle { min-width: 0; max-width: 100%; pointer-events: auto; }
  .pane-header :global(.pane-header-action) {
    display: inline-flex;
    width: 2.25rem;
    height: 2.25rem;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    border-radius: 9999px;
    background: color-mix(in oklab, var(--muted) 72%, transparent);
    color: var(--muted-foreground);
    transition: background-color 160ms ease, color 160ms ease;
  }
  .pane-header :global(.pane-header-action:hover:not(:disabled)),
  .pane-header :global(.pane-header-action[aria-expanded="true"]) { background: var(--accent); color: var(--accent-foreground); }
  .pane-header :global(.pane-header-action:focus-visible) { outline: 2px solid var(--ring); outline-offset: 2px; }
  .pane-header :global(.pane-header-action:disabled) { opacity: 0.35; }
  @media (max-width: 639px), (any-pointer: coarse) and (max-height: 559px) {
    :global(.pane-header-host) { --pane-header-block-size: 4rem; }
    :global(.pane-header-host:has(> .pane-header--subtitle)) { --pane-header-block-size: 4.5rem; }
    :global(.pane-header-host:has(> .pane-header--workspace)) { --pane-header-block-size: calc(4rem + var(--app-shell-top-inset, 0px)); }
    .pane-header { gap: 0.25rem; padding: 0.625rem 0.75rem; }
    .pane-header-title-wrap { position: relative; inset: auto; flex: 1; min-width: 0; }
    .pane-header-title { min-width: 0; }
    .pane-header-title--leading { max-width: 100%; }
    .pane-header-title-wrap:has(.pane-header-title--leading) { padding-left: 3rem; }
    .pane-header-title-measure, .pane-header-title :global(input) { font-size: 1.125rem; line-height: 1.75rem; }
    .pane-header-right { gap: 0.25rem; }
    .pane-header :global(.pane-header-action) { width: 2.75rem; height: 2.75rem; }
    /* The edge-to-edge workspace shares this row with the global tab selector. */
    .pane-header--workspace { padding-left: 0.75rem; padding-top: calc(0.625rem + var(--app-shell-top-inset, 0px)); }
    .pane-header--workspace::before {
      /* Keep the same bottom fade while the backdrop covers both rows. */
      mask-image: linear-gradient(to top, transparent, black 2.4rem, black 100%);
      -webkit-mask-image: linear-gradient(to top, transparent, black 2.4rem, black 100%);
    }
    .pane-header--workspace > .pane-header-title-wrap { visibility: hidden; }
  }
  @media (max-width: 479px) {
    .pane-header { padding-right: 0.5rem; }
    .pane-header :global(.pane-header-action) { width: 2rem; height: 2rem; min-width: 2rem; min-height: 2rem; }
    .pane-header :global(.pane-header-pin) { min-width: 2rem; min-height: 2rem; }
    .pane-header-title-wrap:has(.pane-header-title--leading) { padding-left: 2.25rem; }
  }
  @media (max-width: 639px), (any-pointer: coarse) and (max-height: 559px) {
    .pane-header-title-wrap--mobile-slot {
      position: relative;
      inset: auto;
      flex: 1;
      width: 100%;
      height: 100%;
      justify-content: center;
    }
    .pane-header-title-wrap--mobile-slot:has(.pane-header-title--leading) { padding-left: 2.25rem; }
    .pane-header-title-wrap--mobile-slot .pane-header-title { max-width: 100%; }
    .pane-header-title-wrap--mobile-slot :global(input) { min-height: 0; }
    .pane-header-title-wrap--mobile-slot :global(.pane-header-pin) { min-width: 2rem; min-height: 2rem; }
  }
  @media (max-height: 559px) and (min-width: 640px) {
    :global(.pane-header-host) { --pane-header-block-size: 3.5rem; }
    :global(.pane-header-host:has(> .pane-header--subtitle)) { --pane-header-block-size: 4.5rem; }
    .pane-header { gap: 0.5rem; padding: 0.75rem 0.75rem 0.5rem; }
    .pane-header-title-wrap { top: 0.75rem; left: 3.5rem; right: 3.5rem; }
  }
  @media (any-pointer: coarse) and (orientation: landscape) {
    :global(.app-shell[data-keyboard-open='true'] .pane-header-host) { --pane-header-block-size: 2.75rem; }
    :global(.app-shell[data-keyboard-open='true']) .pane-header--workspace {
      min-height: 2.75rem;
      padding: 0 0.75rem;
    }
  }
  @media (min-width: 640px) {
    /* Split headers use the space in their pane, even in a wide window. */
    @container pane-header (max-width: 28rem) {
      .pane-header--split .pane-header-title-wrap { left: 3.5rem; right: 6.5rem; }
      .pane-header--split .pane-header-right { margin-right: 0; }
      .pane-header--split .pane-header-title-wrap:has(.pane-header-title--leading) { left: 6.5rem; right: 9rem; }
      .pane-header--split .pane-header-title--leading { min-width: 0; max-width: 100%; }
      .pane-header--split .pane-header-title-measure,
      .pane-header--split .pane-header-title :global(input) { font-size: 1.125rem; }
    }
    @container pane-header (max-width: 22rem) {
      /* A retained pane beside a rail still needs a readable title and full
         action targets. Give the actions their own row at phone widths. */
      .pane-header--split { display: grid; grid-template-columns: auto minmax(0, 1fr); }
      .pane-header--split .pane-header-left { grid-column: 1; grid-row: 1; }
      .pane-header--split .pane-header-title-wrap,
      .pane-header--workspace.pane-header--split .pane-header-title-wrap,
      .pane-header--split .pane-header-title-wrap:has(.pane-header-title--leading) {
        position: relative;
        inset: auto;
        grid-column: 2;
        grid-row: 1;
        min-width: 0;
      }
      .pane-header--split .pane-header-title-wrap:has(.pane-header-title--leading) { margin-left: 2.75rem; }
      .pane-header--split .pane-header-title { min-width: 0; max-width: 100%; }
      .pane-header--split .pane-header-right { grid-column: 1 / -1; grid-row: 2; justify-content: flex-end; }
    }
  }
  @media (prefers-reduced-motion: reduce) { .pane-header :global(.pane-header-action) { transition: none; } }
</style>
