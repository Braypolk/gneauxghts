<script lang="ts">
  import {
    getSplitChoiceByIndex,
    getSplitOptionId,
    type SplitChoice,
    type SplitPickerMode
  } from '$lib/features/notepad/splitPanePicker';

  interface Props {
    highlightedIndex: number;
    mode: SplitPickerMode;
    presentation?: 'inline' | 'embedded';
    currentNoteLabel: string;
    previousNoteLabel: string | null;
    focusRoot?: HTMLElement | null;
    onHighlightChange: (index: number) => void;
    onChoose: (choice: SplitChoice) => void;
  }

  let {
    highlightedIndex,
    mode,
    presentation = 'inline',
    currentNoteLabel,
    previousNoteLabel,
    focusRoot = $bindable<HTMLElement | null>(null),
    onHighlightChange,
    onChoose
  }: Props = $props();

  const hasPrevious = $derived(previousNoteLabel !== null);
  const isEmbedded = $derived(presentation === 'embedded');
  const heading = $derived(mode === 'start' ? 'Start a note' : 'Choose pane content');
  const description = $derived(
    mode === 'start'
      ? 'Start typing to use this blank note, or pick recent context below.'
      : 'Fill the new pane with the current note, recent context, or a blank note.'
  );
  const pickerLabel = $derived(
    mode === 'start' ? 'Choose how to start this note' : 'Choose content for this pane'
  );
  const activeDescendantId = $derived.by(() => {
    const activeChoice = getSplitChoiceByIndex(highlightedIndex, hasPrevious) ?? 'current';
    return getSplitOptionId(activeChoice);
  });

  function optionClass(index: number, enabled: boolean) {
    const active = highlightedIndex === index;
    if (isEmbedded) {
      return [
        'pointer-events-auto flex w-full cursor-pointer select-none items-start gap-3 rounded-xl px-2 py-2 text-left text-sm transition-colors outline-none',
        enabled
          ? active
            ? 'text-foreground'
            : 'text-foreground/86 hover:bg-accent/30 hover:text-foreground'
          : 'cursor-not-allowed text-muted-foreground/60'
      ].join(' ');
    }

    return [
      'flex w-full cursor-pointer select-none items-start gap-3 rounded-2xl border px-4 py-3 text-left text-sm transition-colors outline-none',
      enabled
        ? active
          ? 'border-primary/55 bg-primary/10 text-foreground shadow-sm'
          : 'border-border/60 bg-background/40 text-foreground hover:border-border hover:bg-accent/40'
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
  data-split-picker={mode}
  role="listbox"
  aria-label={pickerLabel}
  aria-activedescendant={activeDescendantId}
  tabindex="0"
  class={rootClass}
>
  <div class={isEmbedded ? 'w-full space-y-2' : 'w-full max-w-md space-y-3'}>
    {#if !isEmbedded}
      <div class="mb-4 text-center">
        <div class="text-sm font-semibold text-foreground">{heading}</div>
        <p class="mx-auto mt-1 max-w-sm text-xs leading-5 text-muted-foreground">{description}</p>
      </div>
    {/if}

    <button
      type="button"
      id="split-choice-current"
      role="option"
      aria-selected={highlightedIndex === 0}
      class={optionClass(0, true)}
      onclick={() => onChoose('current')}
      onmouseenter={() => onHighlightChange(0)}
      onfocus={() => onHighlightChange(0)}
    >
      <span class={optionKeyClass}>1</span>
      <span>
        <span class="font-medium">{mode === 'start' ? 'Keep writing' : 'Current note'}</span>
        <span class="mt-0.5 block text-xs text-muted-foreground/82">{currentNoteLabel}</span>
      </span>
    </button>

    <button
      type="button"
      id="split-choice-previous"
      role="option"
      aria-selected={highlightedIndex === 1}
      aria-disabled={!hasPrevious}
      class={optionClass(1, hasPrevious)}
      onclick={() => hasPrevious && onChoose('previous')}
      onmouseenter={() => hasPrevious && onHighlightChange(1)}
      onfocus={() => hasPrevious && onHighlightChange(1)}
    >
      <span class={optionKeyClass}>2</span>
      <span>
        <span class="font-medium">Previous note</span>
        <span class="mt-0.5 block text-xs text-muted-foreground/82">
          {hasPrevious ? previousNoteLabel : 'No other recent note yet'}
        </span>
      </span>
    </button>

    <button
      type="button"
      id="split-choice-new"
      role="option"
      aria-selected={highlightedIndex === 2}
      class={optionClass(2, true)}
      onclick={() => onChoose('new')}
      onmouseenter={() => onHighlightChange(2)}
      onfocus={() => onHighlightChange(2)}
    >
      <span class={optionKeyClass}>3</span>
      <span>
        <span class="font-medium">New note</span>
        <span class="mt-0.5 block text-xs text-muted-foreground/82">
          {mode === 'start' ? 'Open a clean page for the next thought' : 'Start a fresh note in this pane'}
        </span>
      </span>
    </button>
  </div>
</div>
