<script lang="ts">
  import type { HistoryDiffLine } from './historyModeMachine';

  interface Props {
    lines: HistoryDiffLine[];
    compact?: boolean;
    ariaLabel?: string;
  }

  let { lines, compact = false, ariaLabel }: Props = $props();
  let expandedLines = $state<HistoryDiffLine[] | null>(null);
  const rows = $derived.by(() => {
    const result: Array<HistoryDiffLine | { hidden: number }> = [];
    for (let index = 0; index < lines.length;) {
      if (lines[index].kind !== 'context' || expandedLines === lines) {
        result.push(lines[index++]);
        continue;
      }
      const start = index;
      while (index < lines.length && lines[index].kind === 'context') index++;
      // Keep three lines on each side so changes retain their nearby context.
      if (index - start <= 6) result.push(...lines.slice(start, index));
      else {
        result.push(...lines.slice(start, start + 3));
        result.push({ hidden: index - start - 6 });
        result.push(...lines.slice(index - 3, index));
      }
    }
    return result;
  });

  const presentation = {
    added: {
      marker: '+',
      className: 'bg-emerald-500/10 text-emerald-950 dark:text-emerald-100'
    },
    removed: {
      marker: '−',
      className: 'bg-rose-500/10 text-rose-950 dark:text-rose-100'
    },
    context: { marker: ' ', className: 'text-foreground' }
  } satisfies Record<HistoryDiffLine['kind'], { marker: string; className: string }>;

  function displayText(text: string) {
    return text.endsWith('\n') ? text.slice(0, -1) : text;
  }
</script>

<div
  class={`overflow-x-auto rounded-xl border border-border/70 bg-background font-mono ${compact ? 'text-xs' : 'text-sm'}`}
  aria-label={ariaLabel}
>
  {#if rows.some((row) => 'hidden' in row)}
    <button
      class="w-full border-b border-border px-3 py-2 text-left text-xs text-muted-foreground hover:bg-muted"
      onclick={() => { expandedLines = lines; }}
    >Show all unchanged lines</button>
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
        <span class={`select-none border-r border-border/50 px-2 py-0.5 text-right text-muted-foreground ${compact ? '' : 'text-xs'}`}>{line.oldLineNumber ?? ''}</span>
        <span class={`select-none border-r border-border/50 px-2 py-0.5 text-right text-muted-foreground ${compact ? '' : 'text-xs'}`}>{line.newLineNumber ?? ''}</span>
        <span class="select-none px-1 py-0.5 text-center">{style.marker}</span>
        <span class={`whitespace-pre-wrap break-words py-0.5 ${compact ? 'pr-3' : 'pr-4'}`}>{displayText(line.text)}</span>
      </div>
    {/if}
  {/each}
</div>
