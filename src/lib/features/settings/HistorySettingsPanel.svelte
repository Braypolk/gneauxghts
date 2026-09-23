<script lang="ts">
  import type { HistoryHealthReport, HistoryHealthState } from '$lib/types/history';
  import SettingsCard from './SettingsCard.svelte';

  let {
    historyHealth,
    isRunningAction,
    actionError,
    retryHistory,
    resetCorruptHistory,
    clearVaultHistory
  }: {
    historyHealth: HistoryHealthReport | null;
    isRunningAction: boolean;
    actionError: string | null;
    retryHistory: () => void | Promise<void>;
    resetCorruptHistory: () => void | Promise<void>;
    clearVaultHistory: () => void | Promise<void>;
  } = $props();

  let confirmingReset = $state(false);
  let confirmingClear = $state(false);

  async function clearAllHistory() {
    await clearVaultHistory();
    confirmingClear = false;
  }

  const stateCopy: Record<HistoryHealthState, { title: string; detail: string }> = {
    healthy: {
      title: 'History is healthy',
      detail: 'No action needed.'
    },
    initializing: {
      title: 'History is initializing',
      detail: 'Preparing Note Timelines in the background.'
    },
    degraded: {
      title: 'History needs attention',
      detail: 'Some notes need another attempt. Your notes are still readable.'
    },
    warning: {
      title: 'A saved change needs history repair',
      detail: 'Your change was saved. Retry to repair its history.'
    },
    unavailable: {
      title: 'History is unavailable',
      detail: 'Notes are readable. Editing is paused until history recovers.'
    },
    corrupt: {
      title: 'History is corrupt',
      detail: 'Notes are readable. Reset to replace damaged timelines.'
    }
  };

  function formatBytes(bytes: number) {
    if (bytes < 1024) return `${bytes} ${bytes === 1 ? 'byte' : 'bytes'}`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    if (bytes < 1024 * 1024 * 1024) {
      return `${(bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/u, '')} MB`;
    }
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1).replace(/\.0$/u, '')} GB`;
  }
</script>

{#if historyHealth}
  {@const copy = stateCopy[historyHealth.state]}
  <div class="space-y-4">
    <SettingsCard anchor="history-health">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p class="text-sm font-semibold">{copy.title}</p>
          <p class="mt-1 text-xs leading-relaxed text-muted-foreground">{copy.detail}</p>
          <p class="mt-2 text-xs text-muted-foreground">
            Integrity {historyHealth.integrity} ·
            {historyHealth.initialization.readyNotes} of {historyHealth.initialization.discoveredNotes} notes ready
            {#if historyHealth.initialization.failedNotes > 0}
              · {historyHealth.initialization.failedNotes} failed
            {/if}
          </p>
        </div>
        {#if historyHealth.canRetry}
          <button
            type="button"
            class="shrink-0 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium disabled:opacity-50"
            disabled={isRunningAction}
            onclick={() => void retryHistory()}
          >
            {isRunningAction ? 'Working…' : 'Retry history'}
          </button>
        {/if}
      </div>
    </SettingsCard>

    {#if historyHealth.storage}
      <div class="flex flex-wrap gap-x-6 gap-y-2 px-1 py-2 text-xs text-muted-foreground">
        <span>{formatBytes(historyHealth.storage.allocatedBytes)} allocated</span>
        <span>{formatBytes(historyHealth.storage.reclaimableBytes)} reclaimable</span>
      </div>
    {/if}

    {#if historyHealth.canReset}
      <SettingsCard class="border-amber-500/35">
        <p class="text-sm font-medium">Recovery reset</p>
        <p class="mt-1 text-xs leading-relaxed text-muted-foreground">
          Back up your Markdown vault before resetting. Quit the app first to include readable history.
        </p>
        <p class="mt-2 text-xs leading-relaxed text-muted-foreground">
          Reset deletes retained history, revision names, and citations. Current notes stay unchanged and become new Baseline Revisions.
        </p>
        {#if confirmingReset}
          <div class="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              class="rounded-full bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground disabled:opacity-50"
              disabled={isRunningAction}
              onclick={() => void resetCorruptHistory()}
            >
              {isRunningAction ? 'Resetting…' : 'Confirm reset history'}
            </button>
            <button
              type="button"
              class="rounded-full px-3 py-1.5 text-xs text-muted-foreground"
              disabled={isRunningAction}
              onclick={() => (confirmingReset = false)}
            >Cancel</button>
          </div>
        {:else}
          <button
            type="button"
            class="mt-3 rounded-full border border-amber-500/40 px-3 py-1.5 text-xs font-medium"
            onclick={() => (confirmingReset = true)}
          >Reset history</button>
        {/if}
      </SettingsCard>
    {/if}

    <section data-settings-anchor="clear-history" class="border-t border-border pt-5">
      <p class="text-sm font-medium">Clear vault history</p>
      <p class="mt-1 text-xs leading-relaxed text-muted-foreground">
        Permanently remove history for active notes. Current notes stay unchanged. Missing and forgotten timelines are retained.
      </p>
      {#if confirmingClear}
        <div class="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            class="rounded-full bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground disabled:opacity-50"
            disabled={isRunningAction || historyHealth.integrity !== 'verified'}
            onclick={() => void clearAllHistory()}
          >{isRunningAction ? 'Clearing…' : 'Confirm clear vault history'}</button>
          <button
            type="button"
            class="rounded-full px-3 py-1.5 text-xs text-muted-foreground"
            disabled={isRunningAction}
            onclick={() => (confirmingClear = false)}
          >Cancel</button>
        </div>
      {:else}
        <button
          type="button"
          class="mt-3 rounded-full border border-destructive/40 px-3 py-1.5 text-xs font-medium text-destructive disabled:opacity-50"
          disabled={isRunningAction || historyHealth.integrity !== 'verified'}
          onclick={() => (confirmingClear = true)}
        >Clear vault history</button>
      {/if}
    </section>

    {#if historyHealth.lastReset}
      <SettingsCard>
        <p class="text-sm font-medium">History was reset</p>
        <p class="mt-1 text-xs text-muted-foreground">
          Recovery advanced history generation {historyHealth.lastReset.previousGeneration} to {historyHealth.lastReset.generation} and retained this diagnostic without deleted note prose.
        </p>
      </SettingsCard>
    {/if}

    {#if actionError}
      <p class="text-xs text-destructive" role="alert">{actionError}</p>
    {/if}
  </div>
{:else}
  <p class="text-sm text-muted-foreground">Loading history health…</p>
{/if}
