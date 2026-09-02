<script lang="ts">
  import type { DocumentStatusViewModel } from '$lib/features/notepad/document/documentState';

  interface Props {
    status: DocumentStatusViewModel;
    onKeepMyEdits: () => void | Promise<void>;
    onLoadDiskVersion: () => void | Promise<void>;
    onCopyMyEdits: () => void | Promise<void>;
  }

  let {
    status,
    onKeepMyEdits,
    onLoadDiskVersion,
    onCopyMyEdits
  }: Props = $props();

  let pendingAction = $state<
    'keep' | 'load' | 'copy' | null
  >(null);
  let errorMessage = $state('');

  async function run(
    action: 'keep' | 'load' | 'copy',
    callback: () => void | Promise<void>
  ) {
    if (pendingAction) return;
    pendingAction = action;
    errorMessage = '';
    try {
      await callback();
    } catch (error) {
      errorMessage =
        error instanceof Error
          ? error.message
          : 'Could not resolve this conflict.';
    } finally {
      pendingAction = null;
    }
  }
</script>

{#if status.kind === 'conflict'}
  <aside
    class="absolute inset-x-3 top-[4.75rem] z-30 mx-auto max-w-2xl rounded-2xl border border-amber-500/35 bg-card/95 px-3 py-3 shadow-lg backdrop-blur-xl sm:inset-x-4 sm:top-[5.25rem] sm:px-4"
    aria-label="External note conflict"
  >
    <div class="flex flex-col gap-3">
      <div>
        <p class="text-sm font-semibold text-foreground">
          {status.externalKind === 'deletion' ? 'Deleted outside the app' : status.label}
        </p>
        <p class="mt-0.5 text-xs text-muted-foreground">
          {status.externalKind === 'deletion'
            ? 'Recreate the file with your edits, or keep the text as a new unsaved draft.'
            : 'Choose which version to keep. Your edits will not be discarded automatically.'}
        </p>
      </div>
      <div class="flex flex-wrap gap-2">
        <button
          type="button"
          class="rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
          disabled={pendingAction !== null}
          onclick={() => void run('keep', onKeepMyEdits)}
        >
          {pendingAction === 'keep' ? 'Saving…' : 'Keep my edits'}
        </button>
        <button
          type="button"
          class="rounded-full border border-border bg-background/80 px-3 py-1.5 text-xs font-medium text-foreground disabled:opacity-50"
          disabled={pendingAction !== null}
          onclick={() => void run('load', onLoadDiskVersion)}
        >
          {pendingAction === 'load'
            ? 'Loading…'
            : status.externalKind === 'deletion'
              ? 'Keep as new draft'
              : 'Load disk version'}
        </button>
        <button
          type="button"
          class="rounded-full px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted disabled:opacity-50"
          disabled={pendingAction !== null}
          onclick={() => void run('copy', onCopyMyEdits)}
        >
          {pendingAction === 'copy' ? 'Copying…' : 'Copy my edits'}
        </button>
      </div>
      {#if errorMessage}
        <p class="text-xs text-destructive" aria-live="polite">
          {errorMessage}
        </p>
      {/if}
    </div>
  </aside>
{:else if status.kind === 'warning'}
  <aside
    class="absolute inset-x-4 top-[4.75rem] z-30 mx-auto max-w-xl rounded-xl border border-amber-500/35 bg-card/95 px-3 py-2 text-center shadow-sm backdrop-blur-xl sm:top-[5.25rem]"
    role="status"
    aria-label="Saved note synchronization warning"
  >
    <p class="text-xs font-medium text-foreground">
      {status.hasUnsavedChanges ? 'Unsaved changes' : 'Saved to Markdown'}
    </p>
    <p class="mt-0.5 text-xs text-muted-foreground">
      {status.label}
      {status.repairAction === 'historySettings'
        ? ' Retry history from Settings.'
        : ' The app will keep retrying the remaining synchronization work.'}
    </p>
  </aside>
{:else if status.kind === 'failed'}
  <p
    class="absolute inset-x-4 top-[4.75rem] z-30 mx-auto max-w-xl rounded-xl border border-destructive/30 bg-card/95 px-3 py-2 text-center text-xs text-destructive shadow-sm backdrop-blur-xl sm:top-[5.25rem]"
    role="alert"
  >
    {status.label}
  </p>
{/if}
