<script lang="ts">
  import { ArrowLeft, Clock3, LoaderCircle, RotateCcw } from '@lucide/svelte';
  import type {
    HistoryLifecycleRecord,
    HistoryModeState
  } from './historyModeMachine';
  import HistoryEditingSession from './HistoryEditingSession.svelte';
  import HistoryRevisionSummary from './HistoryRevisionSummary.svelte';
  import { buildHistoryTimelineItems, formatHistoryTime } from './historyTimeline';

  interface Props {
    state: Exclude<HistoryModeState, { phase: 'inactive' | 'restoring' }>;
    onExit: () => void | Promise<void>;
    onSelectRevision: (revisionId: string) => void | Promise<void>;
    onLoadMore: () => void | Promise<void>;
    onRetry: () => void | Promise<void>;
  }

  let {
    state: historyState,
    onExit,
    onSelectRevision,
    onLoadMore,
    onRetry
  }: Props = $props();
  let expandedSessionIds = $state<string[]>([]);

  function fileName(path: string | null) {
    if (!path) return null;
    return path.split(/[\\/]/u).at(-1) ?? path;
  }

  function lifecycleSummary(record: HistoryLifecycleRecord) {
    const previous = fileName(record.previousPath);
    const current = fileName(record.path);
    switch (record.eventKind) {
      case 'created':
        return current ? `Created ${current}` : 'Created';
      case 'renamed':
        return previous && current
          ? `Renamed ${previous} to ${current}`
          : 'Renamed';
      case 'moved':
        return record.previousPath && record.path
          ? `Moved ${record.previousPath} to ${record.path}`
          : 'Moved';
      case 'forgotten':
        return previous ? `Forgotten ${previous}` : 'Forgotten';
      case 'recovered':
        return current ? `Recovered ${current}` : 'Recovered';
      case 'missing':
        return `Marked ${previous ?? current ?? 'note'} as missing`;
      case 'reattached':
        return current ? `Reattached ${current}` : 'Reattached';
      case 'purged':
        return 'Permanently purged';
    }
  }

  const timelineItems = $derived(
    historyState.phase === 'open' ? buildHistoryTimelineItems(historyState.records) : []
  );

  function sessionExpanded(sessionId: string) {
    return expandedSessionIds.includes(sessionId);
  }

  function toggleSession(sessionId: string) {
    expandedSessionIds = sessionExpanded(sessionId)
      ? expandedSessionIds.filter((candidate) => candidate !== sessionId)
      : [...expandedSessionIds, sessionId];
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void onExit();
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div
  class="absolute inset-0 z-50 flex min-h-0 flex-col overflow-hidden bg-background/96 text-foreground backdrop-blur-xl sm:rounded-4xl"
  role="dialog"
  aria-modal="true"
  aria-label="History Mode"
  data-testid="history-mode"
>
  <header class="flex shrink-0 items-center gap-3 border-b border-border/80 px-4 py-3 sm:px-6 sm:py-4">
    <button
      type="button"
      class="mobile-touch-target inline-flex h-10 items-center gap-2 rounded-full bg-muted px-4 text-sm font-medium transition-colors hover:bg-accent"
      onclick={() => void onExit()}
      aria-label="Back to workspace"
    >
      <ArrowLeft class="h-4 w-4" />
      <span>Back to workspace</span>
    </button>
    <div class="min-w-0 flex-1">
      <div class="flex items-center gap-2">
        <h1 class="truncate text-base font-semibold sm:text-lg">History Mode</h1>
        <span class="rounded-full border border-border bg-muted/70 px-2 py-0.5 text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Read only</span>
      </div>
      {#if historyState.phase !== 'exiting'}
        <p class="truncate text-sm text-muted-foreground">{historyState.target.noteTitle}</p>
      {/if}
    </div>
  </header>

  {#if historyState.phase === 'entering' || historyState.phase === 'exiting'}
    <div class="flex min-h-0 flex-1 items-center justify-center p-8" data-testid="history-loading">
      <div class="flex items-center gap-3 text-sm text-muted-foreground">
        <LoaderCircle class="h-5 w-5 animate-spin" />
        <span>{historyState.phase === 'entering' ? 'Saving and opening history…' : 'Returning to workspace…'}</span>
      </div>
    </div>
  {:else if historyState.phase === 'historyUnavailable' || historyState.phase === 'noteUnavailable'}
    <div class="flex min-h-0 flex-1 items-center justify-center p-6">
      <div class="max-w-md rounded-3xl border border-border bg-card p-6 text-center shadow-sm">
        <Clock3 class="mx-auto mb-3 h-6 w-6 text-muted-foreground" />
        <h2 class="text-lg font-semibold">
          {historyState.phase === 'noteUnavailable' ? 'Note history is no longer available' : 'History is unavailable'}
        </h2>
        <p class="mt-2 text-sm leading-relaxed text-muted-foreground">{historyState.error}</p>
        <div class="mt-5 flex justify-center gap-2">
          <button type="button" class="rounded-full bg-muted px-4 py-2 text-sm font-medium hover:bg-accent" onclick={() => void onRetry()}>
            <RotateCcw class="mr-1 inline h-4 w-4" /> Retry
          </button>
          <button type="button" class="rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background" onclick={() => void onExit()}>
            Back to workspace
          </button>
        </div>
      </div>
    </div>
  {:else}
    <div class="grid min-h-0 flex-1 grid-rows-[minmax(12rem,40%)_minmax(0,1fr)] md:grid-cols-[minmax(16rem,21rem)_minmax(0,1fr)] md:grid-rows-1">
      <aside class="min-h-0 overflow-y-auto border-b border-border/80 bg-muted/20 p-3 md:border-r md:border-b-0 sm:p-4" aria-label="Note timeline">
        <ol class="space-y-2">
          {#each timelineItems as item (item.kind === 'editingSession' ? `session:${item.sessionId}` : item.kind === 'standaloneRevision' ? `revision:${item.revision.recordId}` : `event:${item.record.recordId}`)}
            <li>
              {#if item.kind === 'editingSession'}
                <HistoryEditingSession
                  {item}
                  selectedRevisionId={historyState.selectedRevisionId}
                  disabled={historyState.request !== null}
                  expanded={sessionExpanded(item.sessionId)}
                  onToggle={() => toggleSession(item.sessionId)}
                  {onSelectRevision}
                />
              {:else if item.kind === 'standaloneRevision'}
                <button
                  type="button"
                  class={`w-full rounded-2xl border px-3 py-3 text-left transition-colors ${historyState.selectedRevisionId === item.revision.revisionId ? 'border-foreground/30 bg-card shadow-sm' : 'border-transparent hover:border-border hover:bg-card/70'}`}
                  aria-pressed={historyState.selectedRevisionId === item.revision.revisionId}
                  disabled={historyState.request !== null}
                  data-revision-id={item.revision.revisionId}
                  onclick={() => void onSelectRevision(item.revision.revisionId)}
                >
                  <HistoryRevisionSummary revision={item.revision} emphasis="prominent" />
                </button>
              {:else}
                <div class="rounded-2xl border border-dashed border-border px-3 py-3 text-sm">
                  <span class="font-semibold">{lifecycleSummary(item.record)}</span>
                  <span class="mt-1 block text-xs text-muted-foreground">{formatHistoryTime(item.record.occurredAtMillis)}</span>
                </div>
              {/if}
            </li>
          {/each}
        </ol>
        {#if historyState.nextCursor}
          <button
            type="button"
            class="mt-3 w-full rounded-full border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-60"
            disabled={historyState.request !== null}
            onclick={() => void onLoadMore()}
          >
            {historyState.request?.kind === 'page' ? 'Loading…' : 'Load older history'}
          </button>
        {/if}
      </aside>

      <main class="min-h-0 overflow-y-auto p-4 sm:p-6 md:p-8" aria-label="Historical revision">
        {#if historyState.error}
          <p class="mb-4 rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{historyState.error}</p>
        {/if}
        {#if historyState.request?.kind === 'selection'}
          <div class="flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle class="h-4 w-4 animate-spin" /> Loading revision…
          </div>
        {:else if historyState.selectedRevision}
          {#if historyState.selectedRevision.unmanagedFrontmatter}
            <details class="mb-5 rounded-2xl border border-border bg-muted/30 px-4 py-3">
              <summary class="cursor-pointer text-sm font-medium">Properties</summary>
              <pre class="mt-3 overflow-x-auto whitespace-pre-wrap text-xs text-muted-foreground">{historyState.selectedRevision.unmanagedFrontmatter}</pre>
            </details>
          {/if}
          <pre class="whitespace-pre-wrap break-words font-sans text-[0.98rem] leading-7" data-testid="historical-revision-content">{historyState.selectedRevision.body}</pre>
        {:else}
          <p class="text-sm text-muted-foreground">This page contains lifecycle events but no selectable revision.</p>
        {/if}
      </main>
    </div>
  {/if}
</div>
