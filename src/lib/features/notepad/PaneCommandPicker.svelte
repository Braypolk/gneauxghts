<script lang="ts">
  import {
    getPaneCommandChoiceByIndex,
    getPaneCommandOptionId,
    getPaneCommandShortcutLabel,
    isHiddenPaneCommandIndex,
    PANE_COMMAND_SPLIT_INDEX,
    PANE_COMMAND_START_INDEX,
    type PaneCommandChoice,
    type PaneCommandMode
  } from '$lib/features/notepad/paneCommandPicker';

  interface Props {
    highlightedIndex: number;
    mode: PaneCommandMode;
    presentation?: 'inline' | 'embedded';
    currentNoteLabel: string;
    previousNoteLabel: string | null;
    previousNoteShortcutLabel: string;
    focusRoot?: HTMLElement | null;
    onHighlightChange: (index: number) => void;
    onChoose: (choice: PaneCommandChoice) => void;
  }

  let {
    highlightedIndex,
    mode,
    presentation = 'inline',
    currentNoteLabel,
    previousNoteLabel,
    previousNoteShortcutLabel,
    focusRoot = $bindable<HTMLElement | null>(null),
    onHighlightChange,
    onChoose
  }: Props = $props();

  const hasPrevious = $derived(previousNoteLabel !== null);
  const isEmbedded = $derived(presentation === 'embedded');
  const heading = $derived(mode === 'start' ? 'Start a note' : 'Choose pane content');
  const description = $derived(
    mode === 'start'
      ? 'Start typing, reopen recent context, or switch into a thought partner.'
      : 'Fill the new pane with the current note, recent context, or a thought partner.'
  );
  const pickerLabel = $derived(
    mode === 'start' ? 'Choose how to start this note' : 'Choose content for this pane'
  );
  const previousIndex = $derived(
    mode === 'split' ? PANE_COMMAND_SPLIT_INDEX.previous : PANE_COMMAND_START_INDEX.previous
  );
  const thoughtPartnerIndex = $derived(
    mode === 'split'
      ? PANE_COMMAND_SPLIT_INDEX.thoughtPartner
      : PANE_COMMAND_START_INDEX.thoughtPartner
  );
  const activeDescendantId = $derived.by(() => {
    if (isHiddenPaneCommandIndex(highlightedIndex)) {
      return undefined;
    }
    const activeChoice = getPaneCommandChoiceByIndex(highlightedIndex, hasPrevious, mode);
    return activeChoice ? getPaneCommandOptionId(activeChoice) : undefined;
  });

  function optionClass(index: number, enabled: boolean) {
    const active = highlightedIndex === index;
    if (isEmbedded) {
      return [
        'pointer-events-auto flex w-full cursor-pointer select-none items-start gap-3 rounded-xl px-2 py-2 text-left text-sm transition-colors outline-none',
        enabled
          ? active
            ? 'bg-accent text-accent-foreground'
            : 'text-foreground/86'
          : 'cursor-not-allowed text-muted-foreground/60'
      ].join(' ');
    }

    return [
      'flex w-full cursor-pointer select-none items-start gap-3 rounded-2xl border px-4 py-3 text-left text-sm transition-colors outline-none',
      enabled
        ? active
          ? 'border-primary/55 bg-accent text-accent-foreground shadow-sm'
          : 'border-border/60 bg-background/40 text-foreground'
        : 'cursor-not-allowed border-border/40 bg-muted/20 text-muted-foreground/70'
    ].join(' ');
  }

  const rootClass = $derived(
    isEmbedded
      ? 'pointer-events-none w-full outline-none'
      : 'flex min-h-0 flex-1 flex-col items-center justify-center px-6 pt-28 pb-16 outline-none'
  );

  const optionKeyClass = $derived(
    isEmbedded
      ? 'mt-0.5 shrink-0 rounded-md px-1.5 py-0.5 text-xs font-medium text-muted-foreground/70'
      : 'mt-0.5 shrink-0 rounded-md bg-muted/80 px-2 py-0.5 text-xs font-medium text-muted-foreground'
  );
</script>

<div
  bind:this={focusRoot}
  data-pane-command={mode}
  role="listbox"
  aria-label={pickerLabel}
  aria-activedescendant={activeDescendantId}
  tabindex="0"
  class={rootClass}
>
  <div class={isEmbedded ? 'mx-auto w-full max-w-md space-y-2' : 'w-full max-w-md space-y-3'}>
    {#if !isEmbedded}
      <div class="mb-4 text-center">
        <div class="text-sm font-semibold text-foreground">{heading}</div>
        <p class="mx-auto mt-1 max-w-sm text-xs leading-5 text-muted-foreground">{description}</p>
      </div>
    {/if}

    {#if mode === 'split'}
      <button
        type="button"
        id="pane-command-current"
        role="option"
        aria-selected={highlightedIndex === PANE_COMMAND_SPLIT_INDEX.current}
        class={optionClass(PANE_COMMAND_SPLIT_INDEX.current, true)}
        onclick={() => onChoose('current')}
        onmouseenter={() => onHighlightChange(PANE_COMMAND_SPLIT_INDEX.current)}
        onfocus={() => onHighlightChange(PANE_COMMAND_SPLIT_INDEX.current)}
      >
        <span class={optionKeyClass}>
          {getPaneCommandShortcutLabel(PANE_COMMAND_SPLIT_INDEX.current, mode)}
        </span>
        <span>
          <span class="font-medium">Open Current Note</span>
          <span class="mt-0.5 block text-xs text-muted-foreground/82">{currentNoteLabel}</span>
        </span>
      </button>
    {/if}

    <button
      type="button"
      id="pane-command-previous"
      role="option"
      aria-selected={highlightedIndex === previousIndex}
      aria-disabled={!hasPrevious}
      class={optionClass(previousIndex, hasPrevious)}
      onclick={() => hasPrevious && onChoose('previous')}
      onmouseenter={() => hasPrevious && onHighlightChange(previousIndex)}
      onfocus={() => hasPrevious && onHighlightChange(previousIndex)}
    >
      <span class={optionKeyClass}>
        {getPaneCommandShortcutLabel(previousIndex, mode)}
      </span>
      <span>
        <span class="font-medium">
          Open Previous Note
          <span class="font-normal text-muted-foreground/70">({previousNoteShortcutLabel})</span>
        </span>
        <span class="mt-0.5 block text-xs text-muted-foreground/82">
          {hasPrevious ? previousNoteLabel : 'No other recent note yet'}
        </span>
      </span>
    </button>

    <button
      type="button"
      id="pane-command-thought-partner"
      role="option"
      aria-selected={highlightedIndex === thoughtPartnerIndex}
      class={optionClass(thoughtPartnerIndex, true)}
      onclick={() => onChoose('thoughtPartner')}
      onmouseenter={() => onHighlightChange(thoughtPartnerIndex)}
      onfocus={() => onHighlightChange(thoughtPartnerIndex)}
    >
      <span class={optionKeyClass}>
        {getPaneCommandShortcutLabel(thoughtPartnerIndex, mode)}
      </span>
      <span>
        <span class="font-medium">Open Thought partner</span>
        <span class="mt-0.5 block text-xs text-muted-foreground/82">
          Open AI chat alongside this thought
        </span>
      </span>
    </button>
  </div>
</div>
