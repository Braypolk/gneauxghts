<script lang="ts">
  import { ArrowLeft, Clock3, LoaderCircle, RotateCcw } from '@lucide/svelte';
  import type {
    HistoryLifecycleEventKind,
    HistoryModeRecord,
    HistoryModeState,
    HistoryMutationSource
  } from './historyModeMachine';

  interface Props {
    state: Exclude<HistoryModeState, { phase: 'inactive' | 'restoring' }>;
    onExit: () => void | Promise<void>;
    onSelectRevision: (revisionId: string) => void | Promise<void>;
    onLoadMore: () => void | Promise<void>;
    onRetry: () => void | Promise<void>;
  }

  let { state, onExit, onSelectRevision, onLoadMore, onRetry }: Props = $props();

  const sourceLabels: Record<HistoryMutationSource, string> = {
    editor: 'Editor revision',
    taskAction: 'Task action',
    acceptedChatProposal: 'Accepted chat proposal',
    externalEdit: 'External edit',
    versionRestore: 'Version restore',
    noteCreation: 'Note created',
    baselineInitialization: 'Baseline revision',
    recoveryReconciliation: 'Recovery reconciliation'
  };

  const lifecycleLabels: Record<HistoryLifecycleEventKind, string> = {
    created: 'Created',
    renamed: 'Renamed',
    moved: 'Moved',
    forgotten: 'Forgotten',
    recovered: 'Recovered',
    missing: 'Missing',
    reattached: 'Reattached',
    purged: 'Purged'
  };

  function formatTime(millis: number) {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(new Date(millis));
  }

  function fileName(path: string | null) {
    if (!path) return null;
    return path.split(/[\\/]/u).at(-1) ?? path;
  }

  function recordLabel(record: HistoryModeRecord) {
    return record.kind === 'revision'
      ? sourceLabels[record.source]
      : lifecycleLabels[record.eventKind];
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
      {#if state.phase !== 'exiting'}
        <p class="truncate text-sm text-muted-foreground">{state.target.noteTitle}</p>
      {/if}
    </div>
  </header>

  {#if state.phase === 'entering' || state.phase === 'exiting'}
    <div class="flex min-h-0 flex-1 items-center justify-center p-8" data-testid="history-loading">
      <div class="flex items-center gap-3 text-sm text-muted-foreground">
        <LoaderCircle class="h-5 w-5 animate-spin" />
        <span>{state.phase === 'entering' ? 'Saving and opening history…' : 'Returning to workspace…'}</span>
      </div>
    </div>
  {:else if state.phase === 'historyUnavailable' || state.phase === 'noteUnavailable'}
    <div class="flex min-h-0 flex-1 items-center justify-center p-6">
      <div class="max-w-md rounded-3xl border border-border bg-card p-6 text-center shadow-sm">
        <Clock3 class="mx-auto mb-3 h-6 w-6 text-muted-foreground" />
        <h2 class="text-lg font-semibold">
          {state.phase === 'noteUnavailable' ? 'Note history is no longer available' : 'History is unavailable'}
        </h2>
        <p class="mt-2 text-sm leading-relaxed text-muted-foreground">{state.error}</p>
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
          {#each state.records as record (record.recordId)}
            <li>
              {#if record.kind === 'revision'}
                <button
                  type="button"
                  class={`w-full rounded-2xl border px-3 py-3 text-left transition-colors ${state.selectedRevisionId === record.revisionId ? 'border-foreground/30 bg-card shadow-sm' : 'border-transparent hover:border-border hover:bg-card/70'}`}
                  aria-pressed={state.selectedRevisionId === record.revisionId}
                  disabled={state.request !== null}
                  onclick={() => void onSelectRevision(record.revisionId)}
                >
                  <span class="block text-sm font-semibold">{recordLabel(record)}</span>
                  <span class="mt-1 block text-xs text-muted-foreground">{formatTime(record.occurredAtMillis)}</span>
                </button>
              {:else}
                <div class="rounded-2xl border border-dashed border-border px-3 py-3 text-sm">
                  <span class="font-semibold">{recordLabel(record)}</span>
                  <span class="mt-1 block text-xs text-muted-foreground">{formatTime(record.occurredAtMillis)}</span>
                  {#if record.previousPath || record.path}
                    <span class="mt-1 block truncate text-xs text-muted-foreground">
                      {fileName(record.previousPath)}{record.previousPath && record.path ? ' → ' : ''}{fileName(record.path)}
                    </span>
                  {/if}
                </div>
              {/if}
            </li>
          {/each}
        </ol>
        {#if state.nextCursor}
          <button
            type="button"
            class="mt-3 w-full rounded-full border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-60"
            disabled={state.request !== null}
            onclick={() => void onLoadMore()}
          >
            {state.request?.kind === 'page' ? 'Loading…' : 'Load older history'}
          </button>
        {/if}
      </aside>

      <main class="min-h-0 overflow-y-auto p-4 sm:p-6 md:p-8" aria-label="Historical revision">
        {#if state.error}
          <p class="mb-4 rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{state.error}</p>
        {/if}
        {#if state.request?.kind === 'selection'}
          <div class="flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle class="h-4 w-4 animate-spin" /> Loading revision…
          </div>
        {:else if state.selectedRevision}
          {#if state.selectedRevision.unmanagedFrontmatter}
            <details class="mb-5 rounded-2xl border border-border bg-muted/30 px-4 py-3">
              <summary class="cursor-pointer text-sm font-medium">Properties</summary>
              <pre class="mt-3 overflow-x-auto whitespace-pre-wrap text-xs text-muted-foreground">{state.selectedRevision.unmanagedFrontmatter}</pre>
            </details>
          {/if}
          <pre class="whitespace-pre-wrap break-words font-sans text-[0.98rem] leading-7" data-testid="historical-revision-content">{state.selectedRevision.body}</pre>
        {:else}
          <p class="text-sm text-muted-foreground">This page contains lifecycle events but no selectable revision.</p>
        {/if}
      </main>
    </div>
  {/if}
</div>
