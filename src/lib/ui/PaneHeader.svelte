<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    titleText: string;
    titlePlaceholder: string;
    title: Snippet;
    left?: Snippet;
    right?: Snippet;
    titleLeading?: Snippet;
    subtitle?: Snippet;
    titleShell?: HTMLDivElement | null;
    titleMeasureTestId?: string;
    workspace?: boolean;
    split?: boolean;
  }

  let {
    titleText, titlePlaceholder, title, left, right, titleLeading, subtitle,
    titleShell = $bindable(null), titleMeasureTestId,
    workspace = false, split = false
  }: Props = $props();
</script>

<header class="pane-header" class:pane-header--workspace={workspace} class:pane-header--split={split} class:pane-header--subtitle={Boolean(subtitle)}>
  <div class="pane-header-left">{#if left}{@render left()}{/if}</div>
  <div class="pane-header-title-wrap">
    <div bind:this={titleShell} class="pane-header-title" class:pane-header-title--leading={Boolean(titleLeading)}>
      {#if titleLeading}{@render titleLeading()}{/if}
      <span class="pane-header-title-measure" aria-hidden="true"><span data-testid={titleMeasureTestId}>{titleText || titlePlaceholder}</span></span>
      {@render title()}
    </div>
    {#if subtitle}<div class="pane-header-subtitle">{@render subtitle()}</div>{/if}
  </div>
  <div class="pane-header-right">{#if right}{@render right()}{/if}</div>
</header>

<style>
  /* Both scrolling surfaces reserve the same space beneath this overlay. */
  :global(.pane-header-host) { --pane-header-block-size: 4rem; }
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
  .pane-header-title-measure { visibility: hidden; overflow: hidden; white-space: pre; }
  .pane-header-title :global(input) {
    width: 100%;
    background: transparent;
    text-align: center;
    outline: none;
  }
  .pane-header-title :global(input::placeholder) { color: color-mix(in oklab, var(--muted-foreground) 55%, transparent); }
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
  @media (max-width: 639px) {
    :global(.pane-header-host) { --pane-header-block-size: 3.75rem; }
    :global(.pane-header-host:has(> .pane-header--subtitle)) { --pane-header-block-size: 4.5rem; }
    :global(.pane-header-host:has(> .pane-header--workspace)) { --pane-header-block-size: calc(6.5rem + env(safe-area-inset-top, 0px)); }
    .pane-header { gap: 0.5rem; padding: 0.75rem 0.75rem 0.5rem; }
    .pane-header-title-wrap { top: 0.75rem; left: 3.5rem; right: 3.5rem; }
    .pane-header-title-measure, .pane-header-title :global(input) { font-size: 1.125rem; line-height: 1.75rem; }
    .pane-header :global(.pane-header-action) { width: 2.5rem; height: 2.5rem; }
    .pane-header--workspace { padding-top: calc(3.5rem + env(safe-area-inset-top, 0px)); }
    .pane-header--workspace .pane-header-title-wrap { top: calc(3.5rem + env(safe-area-inset-top, 0px)); left: 4rem; right: 4rem; }
    .pane-header--workspace .pane-header-right { margin-right: 4.25rem; }
    .pane-header--workspace.pane-header--split .pane-header-title-wrap { right: 10rem; }
  }
  @media (max-height: 559px) and (min-width: 640px) {
    :global(.pane-header-host) { --pane-header-block-size: 3.5rem; }
    :global(.pane-header-host:has(> .pane-header--subtitle)) { --pane-header-block-size: 4.5rem; }
    .pane-header { gap: 0.5rem; padding: 0.75rem 0.75rem 0.5rem; }
    .pane-header-title-wrap { top: 0.75rem; left: 3.5rem; right: 3.5rem; }
  }
  @media (prefers-reduced-motion: reduce) { .pane-header :global(.pane-header-action) { transition: none; } }
</style>
