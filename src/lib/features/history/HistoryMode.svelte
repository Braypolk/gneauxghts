<script lang="ts">
  import { ArrowLeft, Clock3, LoaderCircle, Pencil, RotateCcw } from '@lucide/svelte';
  import type {
    HistoryDiffComparison,
    HistoryLifecycleRecord,
    HistoryModeState
  } from './historyModeMachine';
  import { canExitHistoryMode } from './historyModeMachine';
  import HistoryDiff from './HistoryDiff.svelte';
  import HistoryTimelineRevision from './HistoryTimelineRevision.svelte';
  import {
    buildHistoryTimelineItems,
    formatHistoryTime,
    historyRevisionTimeSummary,
    historySourceLabels
  } from './historyTimeline';

  interface Props {
    state: Exclude<HistoryModeState, { phase: 'inactive' | 'restoring' }>;
    onExit: () => void | Promise<void>;
    onSelectRevision: (revisionId: string) => void | Promise<void>;
    onSetComparison?: (comparison: HistoryDiffComparison) => void | Promise<void>;
    onPreviewRestore: () => void | Promise<void>;
    onCancelRestore: () => void;
    onConfirmRestore: () => void | Promise<void>;
    onNameRevision: (revisionId: string, label: string) => void | Promise<void>;
    onRemoveRevisionName: (revisionId: string) => void | Promise<void>;
    onClearHistory: () => void | Promise<void>;
    onCheckHealth: () => void | Promise<void>;
    onLoadMore: () => void | Promise<void>;
    onLoadNewer?: () => void | Promise<void>;
    onRetry: () => void | Promise<void>;
  }

  let {
    state: historyState,
    onExit,
    onSelectRevision,
    onSetComparison,
    onPreviewRestore,
    onCancelRestore,
    onConfirmRestore,
    onNameRevision,
    onRemoveRevisionName,
    onClearHistory,
    onCheckHealth,
    onLoadMore,
    onLoadNewer,
    onRetry
  }: Props = $props();
  let confirmingClear = $state(false);
  let renamingRevisionId = $state<string | null>(null);

  function fileName(path: string | null) {
    if (!path) return null;
    return path.split(/[\\/]/u).at(-1) ?? path;
  }

  function formatByteCount(bytes: number) {
    return `${bytes.toLocaleString('en-US')} ${bytes === 1 ? 'byte' : 'bytes'}`;
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
  const selectedRevision = $derived(
    historyState.phase === 'open'
      ? historyState.records.find(
          (record) =>
            record.kind === 'revision' && record.revisionId === historyState.selectedRevisionId
        )
      : undefined
  );
  const newestRevisionId = $derived(
    historyState.phase === 'open' && !historyState.target.citationRevisionId
      ? historyState.records.find((record) => record.kind === 'revision')?.revisionId ?? null
      : null
  );
  const selectedIsCurrent = $derived(
    selectedRevision?.kind === 'revision' && selectedRevision.revisionId === newestRevisionId
  );
  const selectedVersionTime = $derived(
    selectedRevision?.kind === 'revision' ? historyRevisionTimeSummary(selectedRevision) : null
  );
  const selectedVersionTitle = $derived(
    selectedRevision?.kind === 'revision'
      ? selectedRevision.revisionLabel ?? (selectedIsCurrent ? 'Current version' : `Version from ${selectedVersionTime}`)
      : null
  );
  const selectedVersionLabel = $derived(
    selectedRevision?.kind === 'revision' ? selectedRevision.revisionLabel : null
  );

  async function clearHistory() {
    await onClearHistory();
    confirmingClear = false;
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (canExitHistoryMode(historyState)) void onExit();
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div
  class="history-pane absolute inset-0 z-50 flex min-h-0 flex-col overflow-hidden border-y border-border bg-card text-card-foreground shadow-sm sm:rounded-4xl sm:border"
  role="dialog"
  aria-modal="true"
  aria-label="History Mode"
  data-testid="history-mode"
>
  <header class="relative flex min-h-20 shrink-0 items-start px-3 pt-3 pb-4 sm:px-4 sm:pt-4">
    <button
      type="button"
      class="mobile-touch-target inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted/72 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-30"
      disabled={!canExitHistoryMode(historyState)}
      onclick={() => void onExit()}
      aria-label="Back to workspace"
      title="Back to workspace (Escape)"
    >
      <ArrowLeft class="h-4 w-4" />
    </button>
    <div class="absolute inset-x-16 top-3 flex min-w-0 flex-col items-center sm:top-4">
      <h1 class="w-full truncate text-center text-lg font-semibold tracking-tight sm:text-2xl">
        {historyState.phase !== 'exiting' ? historyState.target.noteTitle : 'History'}
      </h1>
      <p class="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Clock3 class="h-3 w-3" aria-hidden="true" />
        <span>Version history</span><span aria-hidden="true">·</span><span>Read only</span>
      </p>
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
      <div class="max-w-md p-6 text-center">
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
    <div class="grid min-h-0 flex-1 grid-rows-[minmax(11rem,36%)_minmax(0,1fr)] md:grid-cols-[16rem_minmax(0,1fr)] md:grid-rows-1">
      <aside class="flex min-h-0 flex-col overflow-hidden border-b border-border/60 px-3 pb-4 md:border-r md:border-b-0 sm:px-4" aria-label="Note timeline" aria-busy={historyState.request?.kind === 'page'} data-history-record-count={historyState.records.length}>
        <h2 class="shrink-0 px-3 py-3 text-xs font-medium text-muted-foreground">Versions</h2>
        <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {#if historyState.previousCursor}
            <button type="button"
              class="mb-2 w-full rounded-lg px-3 py-2 text-left text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
              disabled={historyState.request !== null}
              onclick={() => void onLoadNewer?.()}>Load newer history</button>
          {/if}
          <ol class="space-y-0.5">
            {#each timelineItems as item (item.kind === 'standaloneRevision' ? `revision:${item.revision.recordId}` : `event:${item.record.recordId}`)}
              <li>
                {#if item.kind === 'standaloneRevision'}
                  <HistoryTimelineRevision
                    revision={item.revision}
                    bind:renamingRevisionId
                    selected={historyState.selectedRevisionId === item.revision.revisionId}
                    isCurrentVersion={item.revision.revisionId === newestRevisionId}
                    busy={historyState.request !== null}
                    onSelect={onSelectRevision}
                    onSave={onNameRevision}
                    onRemove={onRemoveRevisionName}
                  />
                {:else}
                  <div class="border-l-2 border-transparent px-3 py-3 text-xs text-muted-foreground">
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
              class="mt-2 w-full rounded-lg px-3 py-2 text-left text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
              disabled={historyState.request !== null}
              onclick={() => void onLoadMore()}
            >
              {historyState.request?.kind === 'page' ? 'Loading…' : 'Load older history'}
            </button>
          {/if}
        </div>
        <details class="max-h-[50%] shrink-0 overflow-y-auto border-t border-border/60 pt-2" aria-label="History tools">
          <summary class="w-fit cursor-pointer py-2 text-xs font-medium text-muted-foreground hover:text-foreground">History tools</summary>
          <button type="button"
            class="rounded-full px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
            disabled={historyState.request !== null}
            onclick={() => void onCheckHealth()}
          >{historyState.request?.kind === 'diagnostics' ? 'Checking history…' : 'Check history health and storage'}</button>
          {#if historyState.diagnostics}
            <section class="mt-2 px-3 py-2" aria-label="Note history health and storage">
              <p class="text-sm font-semibold">Note history {historyState.diagnostics.note.state}</p>
              <p class="mt-1 text-xs text-muted-foreground">
                {historyState.diagnostics.note.revisionCount} retained revisions · {historyState.diagnostics.note.lifecycleEventCount} lifecycle events · {formatByteCount(historyState.diagnostics.note.revisionPayloadBytes)} retained revision content
              </p>
              {#if historyState.diagnostics.storage}
                <p class="mt-1 text-xs text-muted-foreground">
                  Vault storage: {formatByteCount(historyState.diagnostics.storage.allocatedBytes)} allocated · {formatByteCount(historyState.diagnostics.storage.reclaimableBytes)} reclaimable
                </p>
              {/if}
            </section>
          {/if}
          <section class="mt-5 px-3 pb-3" aria-label="Clear note history">
            <p class="text-sm font-semibold">Clear note history</p>
            <p class="mt-1 text-xs leading-relaxed text-muted-foreground">
              Clear this note’s saved revisions and start from its current content as a new Baseline Revision. This cannot be undone.
            </p>
            {#if confirmingClear}
              <div class="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  class="rounded-full bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground disabled:opacity-50"
                  disabled={historyState.request !== null}
                  onclick={() => void clearHistory()}
                >Confirm clear note history</button>
                <button
                  type="button"
                  class="rounded-full px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
                  disabled={historyState.request !== null}
                  onclick={() => (confirmingClear = false)}
                >Cancel</button>
              </div>
            {:else}
              <button
                type="button"
                class="mt-3 rounded-full px-3 py-2 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
                disabled={historyState.request !== null}
                onclick={() => (confirmingClear = true)}
              >Clear note history</button>
            {/if}
          </section>
        </details>
      </aside>

      <main class="min-h-0 min-w-0 overflow-y-auto overscroll-contain px-4 pb-8 sm:px-6 md:px-8" aria-label="Historical revision">
        <div class="mx-auto w-full min-w-0 max-w-(--content-readable-width) pt-4">
          {#if historyState.error}
            <p class="mb-4 border-l-2 border-destructive/60 pl-3 text-sm text-destructive">{historyState.error}</p>
          {/if}
          {#if selectedRevision?.kind === 'revision'}
            <section class="mb-5 border-b border-border/60 pb-4" aria-label="Selected version">
              <div class="flex flex-wrap items-start justify-between gap-3">
                <div class="min-w-0">
                  <p class="text-[0.6875rem] font-semibold tracking-[0.14em] text-muted-foreground uppercase">Selected version</p>
                  <h2 class="mt-1 text-base font-semibold">{selectedVersionTitle}</h2>
                  <p class="mt-1 text-xs text-muted-foreground">
                    {historySourceLabels[selectedRevision.source]} · {selectedVersionTime}
                  </p>
                </div>
                <div class="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    class="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
                    disabled={historyState.request !== null}
                    onclick={() => (renamingRevisionId = selectedRevision.revisionId)}
                  ><Pencil class="h-3 w-3" /> Rename</button>
                  {#if !selectedIsCurrent}
                    <button
                      type="button"
                      class="rounded-full bg-foreground px-4 py-2 text-xs font-medium text-background disabled:opacity-50"
                      aria-expanded={historyState.restorePreview !== null}
                      disabled={historyState.request !== null}
                      onclick={() => historyState.restorePreview ? onCancelRestore() : void onPreviewRestore()}
                    >{historyState.request?.kind === 'restorePreview' ? 'Preparing preview…' : 'Restore this version…'}</button>
                  {/if}
                </div>
              </div>
              <div class="mt-4 inline-flex rounded-full bg-muted/70 p-1" role="group" aria-label="Compare selected version with">
                <button
                  type="button"
                  class="rounded-full px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50"
                  class:bg-foreground={historyState.selectedComparison === 'current'}
                  class:text-background={historyState.selectedComparison === 'current'}
                  class:text-muted-foreground={historyState.selectedComparison !== 'current'}
                  aria-pressed={historyState.selectedComparison === 'current'}
                  disabled={historyState.request !== null}
                  onclick={() => void onSetComparison?.('current')}
                >Current note</button>
                <button
                  type="button"
                  class="rounded-full px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50"
                  class:bg-foreground={historyState.selectedComparison === 'parent'}
                  class:text-background={historyState.selectedComparison === 'parent'}
                  class:text-muted-foreground={historyState.selectedComparison !== 'parent'}
                  aria-pressed={historyState.selectedComparison === 'parent'}
                  disabled={historyState.request !== null}
                  onclick={() => void onSetComparison?.('parent')}
                >Previous version</button>
              </div>
            </section>
          {/if}
          {#if historyState.restorePreview}
            <div class="mb-6 rounded-xl border border-destructive/30 bg-destructive/[0.04] p-4" role="alertdialog" aria-label="Restore version preview">
              <p class="text-sm font-semibold">Restore this version?</p>
              <p class="mt-1 text-xs leading-relaxed text-muted-foreground">
                Replace the current note with {selectedVersionLabel ? `“${selectedVersionLabel}”` : `the version from ${selectedVersionTime}`}. The current version will stay available in History. Ordinary undo cannot reverse this restore.
              </p>
              <pre class="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-words bg-muted/40 p-3 text-xs">{historyState.restorePreview.unmanagedFrontmatter ? `---\n${historyState.restorePreview.unmanagedFrontmatter}\n---\n\n` : ''}{historyState.restorePreview.body}</pre>
              <div class="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  class="rounded-full bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground disabled:opacity-50"
                  disabled={historyState.request !== null}
                  onclick={() => void onConfirmRestore()}
                >{historyState.request?.kind === 'restoreCommit' ? 'Restoring…' : 'Restore version'}</button>
                <button
                  type="button"
                  class="rounded-full px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
                  disabled={historyState.request !== null}
                  onclick={onCancelRestore}
                >Cancel</button>
              </div>
            </div>
          {/if}
          {#if historyState.request?.kind === 'diff'}
            <div class="flex items-center gap-2 text-sm text-muted-foreground">
              <LoaderCircle class="h-4 w-4 animate-spin" /> Loading revision diff…
            </div>
          {:else if historyState.selectedDiff}
            <HistoryDiff diff={historyState.selectedDiff} />
          {:else}
            <p class="text-sm text-muted-foreground">
              {historyState.selectedRevisionId
                ? 'The selected revision diff is unavailable.'
                : 'This page contains lifecycle events but no selectable revision.'}
            </p>
          {/if}


        </div>
      </main>
    </div>
  {/if}
</div>

<style>
  .history-pane :global(button:focus-visible),
  .history-pane :global(summary:focus-visible) {
    outline: 2px solid var(--ring);
    outline-offset: 3px;
  }
</style>
