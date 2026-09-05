<script lang="ts">
  import type { HistoryModeRecord } from '$lib/features/history/historyModeMachine';
  import type { MissingNoteSummary } from '$lib/types/missingNotes';
  import SettingsRefreshButton from './SettingsRefreshButton.svelte';

  let {
    missingNotes,
    isLoading,
    isUpdating,
    loadingTimelineNoteId,
    actionMessage = null,
    actionError = null,
    loadMissingNotes,
    loadMoreHistory,
    recoverMissingNote,
    deleteMissingNote,
    formatTimestamp,
    formatForgottenRetention
  }: {
    missingNotes: MissingNoteSummary[];
    isLoading: boolean;
    isUpdating: boolean;
    loadingTimelineNoteId: string | null;
    actionMessage?: string | null;
    actionError?: string | null;
    loadMissingNotes: () => Promise<void>;
    loadMoreHistory: (noteId: string) => Promise<void>;
    recoverMissingNote: (noteId: string) => Promise<void>;
    deleteMissingNote: (noteId: string) => Promise<void>;
    formatTimestamp: (value: number | null) => string;
    formatForgottenRetention: (days: number) => string;
  } = $props();

  let pendingDelete = $state<string | null>(null);

  function recordLabel(record: HistoryModeRecord): string {
    if (record.kind === 'lifecycleEvent') {
      return `${record.eventKind.charAt(0).toUpperCase()}${record.eventKind.slice(1)} event`;
    }
    const source = record.source.replace(/([A-Z])/g, ' $1').toLowerCase();
    return `${source.charAt(0).toUpperCase()}${source.slice(1)} revision`;
  }
</script>

<div class="border-t border-border/70 px-6 py-5">
  <div class="flex items-start justify-between gap-4">
    <div>
      <p class="text-sm font-medium">Missing Notes</p>
      <p class="mt-0.5 text-xs text-muted-foreground">
        Files deleted outside Gneauxghts remain recoverable until their captured deadline.
      </p>
      <p class="mt-1 text-xs text-muted-foreground">
        Recovery uses the last retained revision and will not overwrite a file that now occupies the old path.
      </p>
    </div>
    <SettingsRefreshButton
      disabled={isLoading || isUpdating || loadingTimelineNoteId !== null}
      onclick={() => void loadMissingNotes()}
    />
  </div>

  {#if actionMessage}
    <p class="mt-4 rounded-2xl border border-amber-300/70 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-100">{actionMessage}</p>
  {/if}
  {#if actionError}
    <p class="mt-4 rounded-2xl border border-rose-300/70 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-100">{actionError}</p>
  {/if}

  {#if isLoading}
    <p class="mt-4 text-sm text-muted-foreground">Loading missing notes…</p>
  {:else if missingNotes.length === 0}
    <p class="mt-4 text-sm text-muted-foreground">No missing notes right now.</p>
  {:else}
    <div class="mt-4 space-y-3">
      {#each missingNotes as note (note.noteId)}
        <article
          class="rounded-2xl border border-border/70 bg-card/70 px-4 py-4"
          data-note-id={note.noteId}
        >
          <div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <p class="text-sm font-medium">{note.title}</p>
                <span class="rounded-full border border-amber-300/70 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-700 dark:border-amber-900 dark:text-amber-200">missing</span>
              </div>
              <p class="mt-1 text-xs text-muted-foreground">{note.fileName} · missing {formatTimestamp(note.missingAtMillis)}</p>
              <p class="mt-1 text-xs text-muted-foreground">Purges {formatTimestamp(note.purgeAtMillis)} after {formatForgottenRetention(note.retentionDays)}</p>
              <p class="mt-1 break-all text-xs text-muted-foreground">Last known path: {note.path}</p>
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <button class="rounded-full border border-border bg-background px-3 py-2 text-sm font-medium disabled:opacity-50" type="button" disabled={isUpdating} onclick={() => void recoverMissingNote(note.noteId)}>Recover</button>
              <button class="rounded-full border border-rose-300/70 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700 disabled:opacity-50 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200" type="button" disabled={isUpdating} onclick={() => (pendingDelete = note.noteId)}>Permanently delete</button>
            </div>
          </div>

          <details class="mt-4 rounded-xl border border-border/60 bg-background/60 px-3 py-2">
            <summary class="cursor-pointer text-xs font-medium">Retained timeline · {note.timeline.records.length} loaded records</summary>
            <ol class="mt-3 space-y-2">
              {#each note.timeline.records as record (record.recordId)}
                <li class="text-xs text-muted-foreground">
                  <span class="font-medium text-foreground">{record.kind === 'revision' && record.revisionLabel ? record.revisionLabel : recordLabel(record)}</span>
                  {#if record.kind === 'revision' && record.revisionLabel}
                    · {recordLabel(record)}
                  {/if}
                  · {formatTimestamp(record.occurredAtMillis)}
                </li>
              {/each}
            </ol>
            {#if note.timeline.nextCursor}
              <button
                class="mt-3 rounded-full border border-border bg-background px-3 py-2 text-xs font-medium disabled:opacity-50"
                type="button"
                disabled={loadingTimelineNoteId !== null}
                onclick={() => void loadMoreHistory(note.noteId)}
              >
                {loadingTimelineNoteId === note.noteId ? 'Loading older history…' : 'Load older history'}
              </button>
            {/if}
          </details>

          {#if pendingDelete === note.noteId}
            <div class="mt-4 rounded-2xl border border-rose-300/70 bg-rose-50 px-4 py-4 text-rose-900 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-100" role="alertdialog" aria-label="Confirm Missing Note deletion">
              <p class="text-sm font-semibold">Permanently delete this Missing Note?</p>
              <p class="mt-1 text-xs">Its complete retained timeline will be purged. Any unrelated file at the old path remains untouched.</p>
              <div class="mt-3 flex gap-2">
                <button class="rounded-full bg-rose-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50" type="button" disabled={isUpdating} onclick={() => { void deleteMissingNote(note.noteId); pendingDelete = null; }}>Confirm permanent deletion</button>
                <button class="rounded-full border border-rose-300 px-4 py-2 text-sm font-medium disabled:opacity-50 dark:border-rose-800" type="button" disabled={isUpdating} onclick={() => (pendingDelete = null)}>Cancel</button>
              </div>
            </div>
          {/if}
        </article>
      {/each}
    </div>
  {/if}
</div>
