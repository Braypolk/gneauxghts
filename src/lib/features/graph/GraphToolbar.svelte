<script lang="ts">
  import { Search, Maximize2, Clock, Palette } from '@lucide/svelte';
  import {
    formatGraphDateShort,
    formatGraphFilterDate
  } from './graphFormatting';

  interface Props {
    searchQuery: string;
    onSearchChange: (query: string) => void;
    zoomLevel: number;
    onFitAll: () => void;
    scrubberActive: boolean;
    onToggleScrubber: () => void;
    colorGroupCount: number;
    onColorGroupCountChange: (count: number) => void;
    timeRange: [number, number];
    timeFilterRange: [number, number] | null;
    onTimeFilterChange: (range: [number, number] | null) => void;
  }

  let {
    searchQuery,
    onSearchChange,
    zoomLevel,
    onFitAll,
    scrubberActive,
    onToggleScrubber,
    colorGroupCount,
    onColorGroupCountChange,
    timeRange,
    timeFilterRange,
    onTimeFilterChange
  }: Props = $props();

  let scrubberStart = $state(0);
  let scrubberEnd = $state(100);

  $effect(() => {
    if (timeFilterRange && timeRange[1] > timeRange[0]) {
      const span = timeRange[1] - timeRange[0];
      scrubberStart = Math.round(((timeFilterRange[0] - timeRange[0]) / span) * 100);
      scrubberEnd = Math.round(((timeFilterRange[1] - timeRange[0]) / span) * 100);
    } else {
      scrubberStart = 0;
      scrubberEnd = 100;
    }
  });

  function handleScrubberInput(which: 'start' | 'end', value: number) {
    const clampedValue = Math.max(0, Math.min(100, value));

    if (which === 'start') {
      scrubberStart = Math.min(clampedValue, scrubberEnd);
    } else {
      scrubberEnd = Math.max(clampedValue, scrubberStart);
    }

    const span = timeRange[1] - timeRange[0];
    if (span <= 0) return;

    const startMs = timeRange[0] + (scrubberStart / 100) * span;
    const endMs = timeRange[0] + (scrubberEnd / 100) * span;

    if (scrubberStart <= 0 && scrubberEnd >= 100) {
      onTimeFilterChange(null);
    } else {
      onTimeFilterChange([startMs, endMs]);
    }
  }
</script>

<div class="flex flex-col gap-2">
  <div class="flex items-center gap-2">
    <div class="relative flex-1">
      <Search class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <input
        type="text"
        placeholder="Search notes in graph..."
        value={searchQuery}
        oninput={(e) => onSearchChange(e.currentTarget.value)}
        class="h-9 w-full rounded-lg border border-border/80 bg-card pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-foreground/20"
        data-no-window-drag
      />
    </div>

    <button
      onclick={onFitAll}
      class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border/80 bg-card text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
      title="Fit all (double-click canvas)"
    >
      <Maximize2 class="h-4 w-4" />
    </button>

    <span class="shrink-0 min-w-[52px] text-center text-xs tabular-nums text-muted-foreground">
      {Math.round(zoomLevel * 100)}%
    </span>

    <label
      class="flex h-9 shrink-0 items-center gap-2 rounded-lg border border-border/80 bg-card px-2 text-muted-foreground"
      title="Semantic color groups"
    >
      <Palette class="h-4 w-4" />
      <select
        value={colorGroupCount}
        oninput={(e) => onColorGroupCountChange(Number(e.currentTarget.value))}
        class="bg-transparent text-xs text-foreground focus:outline-none"
        data-no-window-drag
      >
        {#each [2, 3, 4, 5] as option}
          <option value={option}>{option} colors</option>
        {/each}
      </select>
    </label>

    <button
      onclick={onToggleScrubber}
      class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border/80 transition-colors {scrubberActive
        ? 'bg-foreground/10 text-foreground'
        : 'bg-card text-muted-foreground hover:bg-accent hover:text-accent-foreground'}"
      title="Time scrubber"
    >
      <Clock class="h-4 w-4" />
    </button>
  </div>

  {#if scrubberActive && timeRange[1] > timeRange[0]}
    <div class="flex items-center gap-3 rounded-lg border border-border/80 bg-card px-3 py-2">
      <span class="shrink-0 text-[11px] text-muted-foreground">{formatGraphDateShort(timeRange[0])}</span>

      <div class="relative flex-1">
        <input
          type="range"
          min="0"
          max="100"
          value={scrubberStart}
          oninput={(e) => handleScrubberInput('start', Number(e.currentTarget.value))}
          class="absolute inset-0 w-full appearance-none bg-transparent [&::-webkit-slider-thumb]:relative [&::-webkit-slider-thumb]:z-10 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-foreground"
          data-no-window-drag
        />
        <input
          type="range"
          min="0"
          max="100"
          value={scrubberEnd}
          oninput={(e) => handleScrubberInput('end', Number(e.currentTarget.value))}
          class="absolute inset-0 w-full appearance-none bg-transparent [&::-webkit-slider-thumb]:relative [&::-webkit-slider-thumb]:z-10 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-foreground"
          data-no-window-drag
        />
        <div class="pointer-events-none absolute top-1/2 h-0.5 w-full -translate-y-1/2 rounded-full bg-border">
          <div
            class="absolute top-0 h-full rounded-full bg-foreground/30"
            style="left: {scrubberStart}%; width: {scrubberEnd - scrubberStart}%"
          ></div>
        </div>
      </div>

      <span class="shrink-0 text-[11px] text-muted-foreground">{formatGraphDateShort(timeRange[1])}</span>
    </div>

    {#if timeFilterRange}
      <div class="text-center text-[11px] text-muted-foreground">
        {formatGraphFilterDate(timeFilterRange[0])} — {formatGraphFilterDate(timeFilterRange[1])}
      </div>
    {/if}
  {/if}
</div>
