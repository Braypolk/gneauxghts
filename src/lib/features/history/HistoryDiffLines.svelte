<script lang="ts">
  import type { HistoryDiffLine } from './historyModeMachine';

  interface Props {
    lines: HistoryDiffLine[];
    compact?: boolean;
    ariaLabel?: string;
  }

  let { lines, compact = false, ariaLabel }: Props = $props();
  let expandedLines = $state<HistoryDiffLine[] | null>(null);
  const collapsedRows = $derived.by(() => {
    const result: Array<HistoryDiffLine | { hidden: number }> = [];
    for (let index = 0; index < lines.length;) {
      if (lines[index].kind !== 'context') {
        result.push(lines[index++]);
        continue;
      }
      const start = index;
      while (index < lines.length && lines[index].kind === 'context') index++;
      // Context belongs beside a change, not at unrelated file boundaries.
      const length = index - start;
      const before = start > 0 ? Math.min(3, length) : 0;
      const after = index < lines.length ? Math.min(3, length - before) : 0;
      result.push(...lines.slice(start, start + before));
      if (length > before + after) result.push({ hidden: length - before - after });
      result.push(...lines.slice(index - after, index));
    }
    return result;
  });

  const rows = $derived(expandedLines === lines ? lines : collapsedRows);

  const presentation = {
    added: {
      marker: '+',
      className: 'bg-emerald-500/10 text-foreground'
    },
    removed: {
      marker: '−',
      className: 'bg-rose-500/10 text-foreground'
    },
    context: { marker: ' ', className: 'text-foreground' }
  } satisfies Record<HistoryDiffLine['kind'], { marker: string; className: string }>;

  function displayText(text: string) {
    return text.endsWith('\n') ? text.slice(0, -1) : text;
  }
</script>

<div
  class={`overflow-x-auto font-mono ${compact ? 'text-xs' : 'text-sm'}`}
  aria-label={ariaLabel}
>
  {#if collapsedRows.some((row) => 'hidden' in row)}
    <button
      class="w-full border-b border-border px-3 py-2 text-left text-xs text-muted-foreground hover:bg-muted"
      aria-expanded={expandedLines === lines}
      onclick={() => { expandedLines = expandedLines === lines ? null : lines; }}
    >{expandedLines === lines ? 'Show changes with context' : 'Show all unchanged lines'}</button>
  {/if}
  {#each rows as line, index (index)}
    {#if 'hidden' in line}
      <div class="border-y border-border/50 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        {line.hidden} unchanged lines
      </div>
    {:else}
      {@const style = presentation[line.kind]}
      <div
        class={`grid ${compact ? 'grid-cols-[2.5rem_2.5rem_1.25rem_minmax(0,1fr)]' : 'min-h-6 grid-cols-[3rem_3rem_1.5rem_minmax(0,1fr)]'} ${style.className}`}
        data-diff-kind={line.kind}
      >
        <span class={`select-none px-2 py-0.5 text-right text-muted-foreground ${compact ? '' : 'text-xs'}`}>{line.oldLineNumber ?? ''}</span>
        <span class={`select-none px-2 py-0.5 text-right text-muted-foreground ${compact ? '' : 'text-xs'}`}>{line.newLineNumber ?? ''}</span>
        <span class="select-none px-1 py-0.5 text-center">{style.marker}</span>
        <span class={`whitespace-pre-wrap break-words py-0.5 ${compact ? 'pr-3' : 'pr-4'}`}>{displayText(line.text)}</span>
      </div>
    {/if}
  {/each}
</div>
