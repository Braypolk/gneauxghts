<script lang="ts">
  import type { HistoryHealthReport, HistoryHealthState } from '$lib/types/history';
  import SettingsCard from './SettingsCard.svelte';

  let {
    historyHealth,
    isRunningAction,
    actionError,
    retryHistory,
    resetCorruptHistory
  }: {
    historyHealth: HistoryHealthReport | null;
    isRunningAction: boolean;
    actionError: string | null;
    retryHistory: () => void | Promise<void>;
    resetCorruptHistory: () => void | Promise<void>;
  } = $props();

  let confirmingReset = $state(false);

  const stateCopy: Record<HistoryHealthState, { title: string; detail: string }> = {
    healthy: {
      title: 'History is healthy',
      detail: 'Current Markdown and retained Note Timelines are available.'
    },
    initializing: {
      title: 'History is initializing',
      detail: 'Existing notes are receiving truthful Baseline Revisions in the background.'
    },
    degraded: {
      title: 'History needs attention',
      detail: 'Some notes could not be initialized. Current Markdown remains readable.'
    },
    warning: {
      title: 'A saved change needs history repair',
      detail: 'Markdown was committed and is authoritative. Retry repairs history without replaying the write.'
    },
    unavailable: {
      title: 'History is unavailable',
      detail: 'Current Markdown remains readable, but new app-owned note changes are blocked until history recovers.'
    },
    corrupt: {
      title: 'History is corrupt',
      detail: 'Current Markdown remains readable. Reset can replace damaged timelines with new Baseline Revisions.'
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
    <SettingsCard>
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
      <div class="grid gap-3 sm:grid-cols-2">
        <SettingsCard variant="metric">
          <p class="text-xs text-muted-foreground">Allocated storage</p>
          <p class="mt-1 text-sm font-medium">{formatBytes(historyHealth.storage.allocatedBytes)} allocated</p>
        </SettingsCard>
        <SettingsCard variant="metric">
          <p class="text-xs text-muted-foreground">Reclaimable storage</p>
          <p class="mt-1 text-sm font-medium">{formatBytes(historyHealth.storage.reclaimableBytes)} reclaimable</p>
        </SettingsCard>
      </div>
    {/if}

    {#if historyHealth.canReset}
      <SettingsCard class="border-amber-500/35">
        <p class="text-sm font-medium">Recovery reset</p>
        <p class="mt-1 text-xs leading-relaxed text-muted-foreground">
          Back up your Markdown vault before resetting. Quit Gneauxghts before copying the vault if you also want a portable copy of any readable history.
        </p>
        <p class="mt-2 text-xs leading-relaxed text-muted-foreground">
          Reset removes retained historical content, names, and citations, then makes each current note a new Baseline Revision. Current Markdown is not rewritten.
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
