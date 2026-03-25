<script lang="ts">
  import { RefreshCcw } from 'lucide-svelte';
  import type { ForgottenNoteSummary } from '$lib/types/forgottenNotes';

  type ForgottenAction = 'restore_forgotten_notes' | 'delete_forgotten_notes';

  let {
    forgottenNotes,
    allForgottenSelected,
    selectedForgottenPaths,
    isLoadingForgottenNotes,
    isUpdatingForgottenNotes,
    loadForgottenNotes,
    runForgottenAction,
    toggleForgottenSelection,
    toggleAllForgottenSelections,
    formatTimestamp,
    formatForgottenRetention
  }: {
    forgottenNotes: ForgottenNoteSummary[];
    allForgottenSelected: boolean;
    selectedForgottenPaths: string[];
    isLoadingForgottenNotes: boolean;
    isUpdatingForgottenNotes: boolean;
    loadForgottenNotes: () => Promise<void>;
    runForgottenAction: (command: ForgottenAction, forgottenPaths: string[]) => Promise<void>;
    toggleForgottenSelection: (forgottenPath: string, checked: boolean) => void;
    toggleAllForgottenSelections: (checked: boolean) => void;
    formatTimestamp: (value: number | null) => string;
    formatForgottenRetention: (days: number) => string;
  } = $props();
</script>

<div class="border-t border-border/70 px-6 py-5">
  <div class="flex items-start justify-between gap-4">
    <div>
      <p class="text-sm font-medium">Forgotten Notes</p>
      <p class="mt-0.5 text-xs text-muted-foreground">
        Review notes in `.forgotten`, then restore or permanently delete them.
      </p>
    </div>

    <button
      class="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      type="button"
      disabled={isLoadingForgottenNotes || isUpdatingForgottenNotes}
      onclick={() => void loadForgottenNotes()}
    >
      <RefreshCcw class="h-4 w-4" />
      Refresh
    </button>
  </div>

  <div class="mt-6 rounded-3xl border border-border/70 bg-background/70 px-5 py-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <label class="inline-flex items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          checked={allForgottenSelected}
          onchange={(event) =>
            toggleAllForgottenSelections((event.currentTarget as HTMLInputElement).checked)}
        />
        <span>Select all</span>
      </label>

      <div class="flex flex-wrap items-center gap-2">
        <button
          class="rounded-full border border-border bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
          type="button"
          disabled={selectedForgottenPaths.length === 0 || isUpdatingForgottenNotes}
          onclick={() => void runForgottenAction('restore_forgotten_notes', selectedForgottenPaths)}
        >
          Restore selected
        </button>
        <button
          class="rounded-full border border-rose-300/70 bg-rose-50 px-4 py-2 text-sm font-medium text-rose-700 transition-colors hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200"
          type="button"
          disabled={selectedForgottenPaths.length === 0 || isUpdatingForgottenNotes}
          onclick={() => void runForgottenAction('delete_forgotten_notes', selectedForgottenPaths)}
        >
          Delete selected
        </button>
      </div>
    </div>

    {#if isLoadingForgottenNotes}
      <p class="mt-4 text-sm text-muted-foreground">Loading forgotten notes…</p>
    {:else if forgottenNotes.length === 0}
      <p class="mt-4 text-sm text-muted-foreground">No forgotten notes right now.</p>
    {:else}
      <div class="mt-4 space-y-3">
        {#each forgottenNotes as note}
          <div class="rounded-2xl border border-border/70 bg-card/70 px-4 py-4">
            <div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div class="flex items-start gap-3">
                <input
                  class="mt-1"
                  type="checkbox"
                  checked={selectedForgottenPaths.includes(note.forgottenPath)}
                  onchange={(event) =>
                    toggleForgottenSelection(
                      note.forgottenPath,
                      (event.currentTarget as HTMLInputElement).checked
                    )}
                />

                <div>
                  <p class="text-sm font-medium">{note.title}</p>
                  <p class="mt-1 text-xs text-muted-foreground">
                    {note.fileName} · forgotten {formatTimestamp(note.forgottenAtMillis)}
                  </p>
                  <p class="mt-1 text-xs text-muted-foreground">
                    Purges {formatTimestamp(note.purgeAtMillis)} after {formatForgottenRetention(note.purgeAfterDays)}
                  </p>
                  <p class="mt-1 break-all text-xs text-muted-foreground">
                    Original path: {note.originalPath}
                  </p>
                </div>
              </div>

              <div class="flex flex-wrap items-center gap-2">
                <button
                  class="rounded-full border border-border bg-background px-3 py-2 text-sm font-medium transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                  type="button"
                  disabled={isUpdatingForgottenNotes}
                  onclick={() => void runForgottenAction('restore_forgotten_notes', [note.forgottenPath])}
                >
                  Restore
                </button>
                <button
                  class="rounded-full border border-rose-300/70 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700 transition-colors hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200"
                  type="button"
                  disabled={isUpdatingForgottenNotes}
                  onclick={() => void runForgottenAction('delete_forgotten_notes', [note.forgottenPath])}
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>
