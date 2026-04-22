<script lang="ts">
  type SplitChoice = 'current' | 'previous' | 'new' | 'chat';

  interface Props {
    highlightedIndex: number;
    currentNoteLabel: string;
    previousNoteLabel: string | null;
    focusRoot?: HTMLElement | null;
    onHighlightChange: (index: number) => void;
    onChoose: (choice: SplitChoice) => void;
  }

  let {
    highlightedIndex,
    currentNoteLabel,
    previousNoteLabel,
    focusRoot = $bindable<HTMLElement | null>(null),
    onHighlightChange,
    onChoose
  }: Props = $props();

  const hasPrevious = $derived(previousNoteLabel !== null);
  const activeDescendantId = $derived.by(() => {
    if (highlightedIndex === 0) {
      return 'split-choice-current';
    }

    if (highlightedIndex === 1) {
      return 'split-choice-previous';
    }

    if (highlightedIndex === 2) {
      return 'split-choice-new';
    }

    return 'split-choice-chat';
  });

  function optionClass(index: number, enabled: boolean) {
    const active = highlightedIndex === index;
    return [
      'flex w-full cursor-pointer select-none items-start gap-3 rounded-2xl border px-4 py-3 text-left text-sm transition-colors outline-none',
      enabled
        ? active
          ? 'border-primary/55 bg-primary/10 text-foreground shadow-sm'
          : 'border-border/60 bg-background/40 text-foreground hover:border-border hover:bg-accent/40'
        : 'cursor-not-allowed border-border/40 bg-muted/20 text-muted-foreground/70'
    ].join(' ');
  }
</script>

<div
  bind:this={focusRoot}
  role="listbox"
  aria-label="Choose content for this pane"
  aria-activedescendant={activeDescendantId}
  tabindex="0"
  class="flex min-h-0 flex-1 flex-col items-center justify-center px-6 pt-28 pb-16 outline-none"
>
  <div class="w-full max-w-md space-y-3">
    <div class="mb-2 text-center">
      <div class="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Split pane</div>
    </div>

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
      <span class="mt-0.5 shrink-0 rounded-md bg-muted/80 px-2 py-0.5 text-xs font-medium text-muted-foreground">1</span>
      <span>
        <span class="font-medium">Current note</span>
        <span class="mt-0.5 block text-xs text-muted-foreground">{currentNoteLabel}</span>
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
      <span class="mt-0.5 shrink-0 rounded-md bg-muted/80 px-2 py-0.5 text-xs font-medium text-muted-foreground">2</span>
      <span>
        <span class="font-medium">Previous note</span>
        <span class="mt-0.5 block text-xs text-muted-foreground">
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
      <span class="mt-0.5 shrink-0 rounded-md bg-muted/80 px-2 py-0.5 text-xs font-medium text-muted-foreground">3</span>
      <span>
        <span class="font-medium">New note</span>
        <span class="mt-0.5 block text-xs text-muted-foreground">Start a fresh note in this pane</span>
      </span>
    </button>

    <button
      type="button"
      id="split-choice-chat"
      role="option"
      aria-selected={highlightedIndex === 3}
      class={optionClass(3, true)}
      onclick={() => onChoose('chat')}
      onmouseenter={() => onHighlightChange(3)}
      onfocus={() => onHighlightChange(3)}
    >
      <span class="mt-0.5 shrink-0 rounded-md bg-muted/80 px-2 py-0.5 text-xs font-medium text-muted-foreground">4</span>
      <span>
        <span class="font-medium">Chat</span>
        <span class="mt-0.5 block text-xs text-muted-foreground">LLM chat placeholder for this pane</span>
      </span>
    </button>
  </div>
</div>
