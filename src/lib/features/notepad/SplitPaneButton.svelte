<script lang="ts">
  import { Columns2, FileText, History, MessagesSquare } from '@lucide/svelte';
  import { PANE_COMMAND_SPLIT_OPTIONS, type PaneCommandChoice } from '$lib/features/notepad/paneCommandPicker';

  interface Props {
    onSplit: (choice?: PaneCommandChoice) => void | Promise<void>;
    onOpenCurrent: (choice: PaneCommandChoice) => void | Promise<void>;
  }

  let { onSplit, onOpenCurrent }: Props = $props();
  let splitMode = $state(false);
  let controlElement = $state<HTMLDivElement | null>(null);
  const quickOptions = [...PANE_COMMAND_SPLIT_OPTIONS.slice(1)].reverse();

  const optionIcons = {
    typing: Columns2,
    current: FileText,
    previous: History,
    thoughtPartner: MessagesSquare
  } as const;

  const optionLabels = {
    typing: 'Open split pane options',
    current: 'Split with current note',
    previous: 'Split with previous note',
    thoughtPartner: 'Split with thought partner'
  } as const;

  const currentPaneLabels = {
    typing: 'Open split pane options',
    current: 'Open current note',
    previous: 'Open previous note in this pane',
    thoughtPartner: 'Open thought partner in this pane'
  } as const;

  function handleOptionClick(choice: PaneCommandChoice) {
    return splitMode ? onSplit(choice) : onOpenCurrent(choice);
  }

  function handleFocusOut(event: FocusEvent) {
    const next = event.relatedTarget;
    if (!(next instanceof Node) || !controlElement?.contains(next)) {
      splitMode = false;
    }
  }
</script>

<div
  bind:this={controlElement}
  class="split-pane-control relative hidden h-9 w-9 shrink-0 sm:block"
  class:split-pane-control--split={splitMode}
  role="group"
  aria-label="Pane actions"
  onpointerleave={() => (splitMode = false)}
  onfocusout={handleFocusOut}
>
  {#each quickOptions as option, index}
    {@const OptionIcon = optionIcons[option.choice]}
    <button
      type="button"
      class="split-pane-option absolute top-0 inline-flex h-9 w-9 items-center justify-center rounded-full border border-transparent bg-muted/72 text-xs font-semibold text-muted-foreground shadow-sm outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-35"
      class:split-pane-option--current={option.choice === 'current'}
      style={`--split-pane-position: ${quickOptions.length - index}; --current-pane-position: ${quickOptions.length - index - 1}`}
      aria-label={splitMode ? optionLabels[option.choice] : currentPaneLabels[option.choice]}
      title={splitMode ? optionLabels[option.choice] : currentPaneLabels[option.choice]}
      onclick={() => void handleOptionClick(option.choice)}
    >
      <OptionIcon class="h-4 w-4" />
      <Columns2 class="split-pane-indicator absolute h-2.5 w-2.5" aria-hidden="true" />
    </button>
  {/each}

  <span class="split-pane-divider pointer-events-none absolute" aria-hidden="true"></span>

  <button
    type="button"
    class="relative z-10 inline-flex h-9 w-9 items-center justify-center rounded-full bg-muted/72 text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring"
    onclick={() => void onSplit()}
    onpointerenter={() => (splitMode = true)}
    onfocus={() => (splitMode = true)}
    aria-label={optionLabels.typing}
    title={optionLabels.typing}
  >
    <Columns2 class="h-4 w-4" />
  </button>
</div>

<style>
  .split-pane-option {
    right: 0;
    z-index: 0;
    opacity: 1;
    pointer-events: auto;
    transform: translateX(calc(var(--current-pane-position) * -2.75rem - 1rem)) scale(1);
    transition:
      transform 200ms cubic-bezier(0.22, 0.8, 0.24, 1),
      opacity 160ms ease,
      color 200ms ease,
      background-color 200ms ease,
      border-color 140ms ease,
      box-shadow 140ms ease;
  }

  .split-pane-option--current {
    opacity: 0;
    pointer-events: none;
    transform: translateX(0) scale(0.72);
  }

  :global(.split-pane-indicator) {
    right: 0.3rem;
    bottom: 0.3rem;
    opacity: 0;
    transform: scale(0.6);
    transition:
      opacity 160ms ease,
      transform 200ms cubic-bezier(0.22, 0.8, 0.24, 1);
  }

  .split-pane-control::before {
    content: '';
    position: absolute;
    inset: -0.35rem 0 -0.35rem -9.5rem;
    pointer-events: none;
  }

  .split-pane-divider {
    left: -0.78rem;
    top: 0.45rem;
    width: 1px;
    height: 1.35rem;
    border-radius: 999px;
    background-color: color-mix(in srgb, var(--border) 72%, transparent);
    transition:
      opacity 140ms ease,
      background-color 200ms ease,
      transform 200ms cubic-bezier(0.22, 0.8, 0.24, 1);
  }

  .split-pane-control--split::before {
    pointer-events: auto;
  }

  .split-pane-control--split .split-pane-divider {
    opacity: 0;
    transform: scaleY(0.8);
  }

  .split-pane-control--split .split-pane-option {
    opacity: 1;
    pointer-events: auto;
    transform: translateX(calc(var(--split-pane-position) * -2.75rem)) scale(1);
    background-color: color-mix(in srgb, var(--primary) 14%, var(--muted));
    color: var(--primary);
  }

  .split-pane-control--split :global(.split-pane-indicator) {
    opacity: 0.9;
    transform: scale(1);
  }

  .split-pane-control--split .split-pane-option:hover,
  .split-pane-control--split .split-pane-option:focus-visible {
    border-color: color-mix(in srgb, var(--primary) 72%, transparent);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--primary) 14%, transparent);
  }

  @media (prefers-reduced-motion: reduce) {
    .split-pane-option { transition-duration: 0ms; }
  }
</style>
