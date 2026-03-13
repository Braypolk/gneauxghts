<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import { Monitor, Moon, RefreshCcw, Sun } from 'lucide-svelte';
  import { onDestroy, onMount } from 'svelte';
  import {
    setThemePreference,
    themeOptions,
    themePreference,
    type ThemePreference
  } from '$lib/theme';
  import type {
    SemanticDebugMetrics,
    SemanticDebugSnapshot,
    SemanticSettings,
    SemanticStatus
  } from '$lib/types/semantic';

  const themeIcons: Record<ThemePreference, typeof Monitor> = {
    auto: Monitor,
    light: Sun,
    dark: Moon
  };

  let semanticStatus = $state<SemanticStatus | null>(null);
  let semanticSettings = $state<SemanticSettings | null>(null);
  let semanticDebug = $state<SemanticDebugSnapshot | null>(null);
  let isSaving = $state(false);
  let isRunningAction = $state(false);
  let debugPollTimer: ReturnType<typeof window.setInterval> | null = null;

  async function loadSemanticState() {
    try {
      const [status, settings, debug] = await Promise.all([
        invoke<SemanticStatus>('get_semantic_status'),
        invoke<SemanticSettings>('get_semantic_settings'),
        invoke<SemanticDebugSnapshot>('get_semantic_debug_metrics')
      ]);
      semanticStatus = status;
      semanticSettings = settings;
      semanticDebug = debug;
    } catch (error) {
      console.error('Failed to load semantic settings:', error);
    }
  }

  async function saveSettings() {
    if (!semanticSettings) return;
    isSaving = true;

    try {
      semanticSettings = await invoke<SemanticSettings>('set_semantic_settings', {
        settings: semanticSettings
      });
      await loadSemanticState();
    } catch (error) {
      console.error('Failed to save semantic settings:', error);
    } finally {
      isSaving = false;
    }
  }

  function updateSetting<Key extends keyof SemanticSettings>(key: Key, value: SemanticSettings[Key]) {
    if (!semanticSettings) return;
    semanticSettings = {
      ...semanticSettings,
      [key]: value
    };
    void saveSettings();
  }

  async function runAction(
    command:
      | 'rebuild_semantic_index'
      | 'pause_semantic_indexing'
      | 'resume_semantic_indexing'
      | 'prepare_semantic_model'
  ) {
    isRunningAction = true;
    try {
      await invoke(command);
      await loadSemanticState();
    } catch (error) {
      console.error(`Failed to run ${command}:`, error);
    } finally {
      isRunningAction = false;
    }
  }

  function formatTimestamp(value: number | null) {
    if (!value) return 'Never';
    return new Date(value).toLocaleString();
  }

  function formatMillis(value: number | null) {
    if (value === null || Number.isNaN(value)) return '0 ms';
    if (value >= 1000) return `${(value / 1000).toFixed(2)} s`;
    return `${Math.round(value)} ms`;
  }

  function averageDuration(total: number, count: number) {
    if (!count) return 0;
    return total / count;
  }

  async function clearDebugMetrics() {
    try {
      await invoke('clear_semantic_debug_metrics');
      await loadSemanticState();
    } catch (error) {
      console.error('Failed to clear semantic debug metrics:', error);
    }
  }

  onMount(() => {
    void loadSemanticState();
    debugPollTimer = window.setInterval(() => {
      void loadSemanticState();
    }, 2500);
  });

  onDestroy(() => {
    if (debugPollTimer) {
      window.clearInterval(debugPollTimer);
      debugPollTimer = null;
    }
  });
</script>

<div class="h-full w-full overflow-auto bg-background text-foreground">
  <main class="mx-auto flex min-h-full w-full max-w-4xl items-start justify-center px-2 pb-10">
    <section class="mt-2 w-full overflow-hidden rounded-[1.75rem] border border-border/80 bg-card/80 shadow-sm backdrop-blur-md">
      <div class="px-6 py-5">
        <p class="text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">Settings</p>
      </div>

      <div class="border-t border-border/70 px-6 py-5">
        <div class="flex items-center justify-between gap-4">
          <div>
            <p class="text-sm font-medium">Theme</p>
            <p class="mt-0.5 text-xs text-muted-foreground">Auto follows your system appearance.</p>
          </div>

          <fieldset class="flex shrink-0 items-center gap-1 rounded-full border border-border/80 bg-background/60 p-1">
            <legend class="sr-only">Theme preference</legend>

            {#each themeOptions as option}
              {@const Icon = themeIcons[option.id]}
              <label
                title={option.description}
                class={`flex cursor-pointer items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                  $themePreference === option.id
                    ? 'bg-foreground text-background shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <input
                  class="sr-only"
                  type="radio"
                  name="theme-preference"
                  value={option.id}
                  checked={$themePreference === option.id}
                  onchange={() => void setThemePreference(option.id)}
                />
                <Icon class="h-3.5 w-3.5" />
                <span>{option.label}</span>
              </label>
            {/each}
          </fieldset>
        </div>
      </div>

      <div class="border-t border-border/70 px-6 py-5">
        <div class="flex items-start justify-between gap-4">
          <div>
            <p class="text-sm font-medium">Semantic Layer</p>
            <p class="mt-0.5 text-xs text-muted-foreground">
              Local-first semantic indexing stays on top of your markdown files instead of replacing them.
            </p>
          </div>

          <button
            class="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            type="button"
            onclick={() => void loadSemanticState()}
          >
            <RefreshCcw class="h-4 w-4" />
            Refresh
          </button>
        </div>

        {#if semanticSettings && semanticStatus}
          <div class="mt-6 grid gap-4 md:grid-cols-2">
            <label class="rounded-3xl border border-border/70 bg-background/70 px-5 py-4">
              <div class="flex items-start justify-between gap-4">
                <div>
                  <p class="text-sm font-medium">Semantic Search</p>
                  <p class="mt-1 text-xs text-muted-foreground">Blend semantic matches into the existing keyword search.</p>
                </div>
                <input
                  type="checkbox"
                  checked={semanticSettings.semanticSearchEnabled}
                  onchange={(event) => updateSetting('semanticSearchEnabled', (event.currentTarget as HTMLInputElement).checked)}
                />
              </div>
            </label>

            <label class="rounded-3xl border border-border/70 bg-background/70 px-5 py-4">
              <div class="flex items-start justify-between gap-4">
                <div>
                  <p class="text-sm font-medium">Local-only Mode</p>
                  <p class="mt-1 text-xs text-muted-foreground">Refuse any model download flow and stay offline.</p>
                </div>
                <input
                  type="checkbox"
                  checked={semanticSettings.localOnlyMode}
                  onchange={(event) => updateSetting('localOnlyMode', (event.currentTarget as HTMLInputElement).checked)}
                />
              </div>
            </label>

            <label class="rounded-3xl border border-border/70 bg-background/70 px-5 py-4">
              <div class="flex items-start justify-between gap-4">
                <div>
                  <p class="text-sm font-medium">Auto-download Models</p>
                  <p class="mt-1 text-xs text-muted-foreground">Reserved for future runtime providers that need local model files.</p>
                </div>
                <input
                  type="checkbox"
                  checked={semanticSettings.autoDownloadModel}
                  onchange={(event) => updateSetting('autoDownloadModel', (event.currentTarget as HTMLInputElement).checked)}
                />
              </div>
            </label>
          </div>

          <div class="mt-6 grid gap-4 md:grid-cols-3">
            <div class="rounded-3xl border border-border/70 bg-background/70 px-5 py-4">
              <p class="text-xs uppercase tracking-[0.18em] text-muted-foreground">Model</p>
              <p class="mt-2 text-sm font-medium">{semanticStatus.model.label}</p>
              <p class="mt-1 text-xs text-muted-foreground">
                {semanticStatus.model.dimensions} dimensions · {semanticStatus.model.status}
              </p>
              <p class="mt-1 text-xs text-muted-foreground">
                Runtime: {semanticStatus.model.runtimeBinaryPath ?? 'not installed'}
              </p>
              <p class="mt-1 text-xs text-muted-foreground">
                Model: {semanticStatus.model.modelPath ?? semanticStatus.model.modelRepoId}
              </p>
            </div>

            <div class="rounded-3xl border border-border/70 bg-background/70 px-5 py-4">
              <p class="text-xs uppercase tracking-[0.18em] text-muted-foreground">Index</p>
              <p class="mt-2 text-sm font-medium">{semanticStatus.indexedNotes} notes</p>
              <p class="mt-1 text-xs text-muted-foreground">{semanticStatus.indexedChunks} chunks · last run {formatTimestamp(semanticStatus.lastIndexedAtMillis)}</p>
            </div>

            <div class="rounded-3xl border border-border/70 bg-background/70 px-5 py-4">
              <p class="text-xs uppercase tracking-[0.18em] text-muted-foreground">Status</p>
              <p class="mt-2 text-sm font-medium">
                {#if semanticStatus.indexingPaused}
                  Paused
                {:else if semanticStatus.indexingInProgress}
                  {semanticStatus.currentJobLabel ?? 'Indexing'}
                {:else}
                  Ready
                {/if}
              </p>
              <p class="mt-1 text-xs text-muted-foreground">Model available: {semanticStatus.modelAvailable ? 'yes' : 'no'}</p>
            </div>
          </div>

          <div class="mt-6 flex flex-wrap items-center gap-3">
            <button
              class="rounded-full border border-border bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent"
              type="button"
              disabled={isRunningAction}
              onclick={() => void runAction('prepare_semantic_model')}
            >
              Prepare local model
            </button>

            <button
              class="rounded-full border border-border bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent"
              type="button"
              disabled={isRunningAction}
              onclick={() => void runAction('rebuild_semantic_index')}
            >
              Rebuild semantic index
            </button>

            <button
              class="rounded-full border border-border bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent"
              type="button"
              disabled={isRunningAction}
              onclick={() =>
                void runAction(
                  semanticStatus?.indexingPaused ? 'resume_semantic_indexing' : 'pause_semantic_indexing'
                )}
            >
              {semanticStatus.indexingPaused ? 'Resume indexing' : 'Pause indexing'}
            </button>

            {#if isSaving || isRunningAction}
              <p class="text-xs uppercase tracking-[0.18em] text-muted-foreground">Updating…</p>
            {/if}
          </div>

          {#if semanticStatus.latestJob}
            <div class="mt-6 rounded-3xl border border-border/70 bg-background/70 px-5 py-4">
              <p class="text-xs uppercase tracking-[0.18em] text-muted-foreground">Latest job</p>
              <p class="mt-2 text-sm font-medium">
                {semanticStatus.latestJob.status} · scanned {semanticStatus.latestJob.scannedCount} · embedded {semanticStatus.latestJob.embeddedCount}
              </p>
              <p class="mt-1 text-xs text-muted-foreground">
                Started {formatTimestamp(semanticStatus.latestJob.startedAtMillis)} · Updated {formatTimestamp(semanticStatus.latestJob.updatedAtMillis)}
              </p>
            </div>
          {/if}

          {#if semanticStatus.lastError || semanticStatus.latestJob?.errorText}
            <div class="mt-6 rounded-3xl border border-rose-300/60 bg-rose-50 px-5 py-4 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200">
              {semanticStatus.lastError ?? semanticStatus.model.error ?? semanticStatus.latestJob?.errorText}
            </div>
          {/if}

          {#if semanticDebug}
            {@const metrics = semanticDebug.metrics}
            <div class="mt-6 rounded-3xl border border-border/70 bg-background/70 px-5 py-4">
              <div class="flex items-start justify-between gap-4">
                <div>
                  <p class="text-xs uppercase tracking-[0.18em] text-muted-foreground">Diagnostics</p>
                  <p class="mt-2 text-sm font-medium">Live semantic telemetry</p>
                  <p class="mt-1 text-xs text-muted-foreground">
                    Captured {formatTimestamp(semanticDebug.capturedAtMillis)}
                  </p>
                </div>

                <div class="flex flex-wrap items-center gap-2">
                  <button
                    class="rounded-full border border-border bg-background px-3 py-2 text-xs font-medium transition-colors hover:bg-accent"
                    type="button"
                    onclick={() => void loadSemanticState()}
                  >
                    Refresh diagnostics
                  </button>
                  <button
                    class="rounded-full border border-border bg-background px-3 py-2 text-xs font-medium transition-colors hover:bg-accent"
                    type="button"
                    onclick={() => void clearDebugMetrics()}
                  >
                    Clear diagnostics
                  </button>
                </div>
              </div>

              <div class="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <div class="rounded-2xl border border-border/70 bg-card/70 px-4 py-3">
                  <p class="text-xs uppercase tracking-[0.18em] text-muted-foreground">Embeddings</p>
                  <p class="mt-2 text-sm font-medium">{metrics.embeddingRequestCount} requests</p>
                  <p class="mt-1 text-xs text-muted-foreground">
                    avg {formatMillis(averageDuration(metrics.embeddingDurationTotalMillis, metrics.embeddingRequestCount))}
                    · max {formatMillis(metrics.embeddingDurationMaxMillis)}
                  </p>
                  <p class="mt-1 text-xs text-muted-foreground">
                    texts {metrics.embeddingTextCountTotal} · chars {metrics.embeddingCharCountTotal}
                  </p>
                </div>

                <div class="rounded-2xl border border-border/70 bg-card/70 px-4 py-3">
                  <p class="text-xs uppercase tracking-[0.18em] text-muted-foreground">Runtime</p>
                  <p class="mt-2 text-sm font-medium">
                    spawns {metrics.runtimeSpawnCount} · restarts {metrics.runtimeRestartCount}
                  </p>
                  <p class="mt-1 text-xs text-muted-foreground">
                    ready {metrics.runtimeReadyCount} · shutdowns {metrics.runtimeShutdownCount}
                  </p>
                  <p class="mt-1 text-xs text-muted-foreground">
                    warmup {formatMillis(metrics.modelWarmupLastMillis)} · prepare {formatMillis(metrics.modelPrepareLastMillis)}
                  </p>
                </div>

                <div class="rounded-2xl border border-border/70 bg-card/70 px-4 py-3">
                  <p class="text-xs uppercase tracking-[0.18em] text-muted-foreground">Requests</p>
                  <p class="mt-2 text-sm font-medium">
                    search {metrics.searchRequestCount} · map {metrics.mapRequestCount}
                  </p>
                  <p class="mt-1 text-xs text-muted-foreground">
                    search semantic used {metrics.searchSemanticUsedCount} · skipped {metrics.searchSemanticSkippedCount}
                  </p>
                </div>

                <div class="rounded-2xl border border-border/70 bg-card/70 px-4 py-3">
                  <p class="text-xs uppercase tracking-[0.18em] text-muted-foreground">Index</p>
                  <p class="mt-2 text-sm font-medium">
                    jobs {metrics.indexJobStartedCount} · zero-work {metrics.indexZeroWorkCount}
                  </p>
                  <p class="mt-1 text-xs text-muted-foreground">
                    scanned {metrics.indexScannedTotal} · embedded {metrics.indexEmbeddedTotal}
                  </p>
                  <p class="mt-1 text-xs text-muted-foreground">
                    avg {formatMillis(averageDuration(metrics.indexDurationTotalMillis, metrics.indexJobCompletedCount + metrics.indexJobFailedCount))}
                    · max {formatMillis(metrics.indexDurationMaxMillis)}
                  </p>
                </div>
              </div>

              <div class="mt-4 grid gap-4 md:grid-cols-2">
                <div class="rounded-2xl border border-border/70 bg-card/70 px-4 py-3">
                  <p class="text-xs uppercase tracking-[0.18em] text-muted-foreground">Failures</p>
                  <p class="mt-2 text-sm font-medium">
                    embedding {metrics.embeddingRequestFailureCount} · index {metrics.indexJobFailedCount}
                  </p>
                  <p class="mt-1 text-xs text-muted-foreground">
                    prepare {metrics.modelPrepareFailureCount} · warmup {metrics.modelWarmupFailureCount} · timeouts {metrics.runtimeTimeoutCount}
                  </p>
                </div>
              </div>

              <div class="mt-4 rounded-2xl border border-border/70 bg-card/70 px-4 py-3">
                <p class="text-xs uppercase tracking-[0.18em] text-muted-foreground">Recent Events</p>
                <div class="mt-3 max-h-72 overflow-y-auto space-y-2">
                  {#if semanticDebug.recentEvents.length === 0}
                    <p class="text-sm text-muted-foreground">No events captured yet.</p>
                  {:else}
                    {#each semanticDebug.recentEvents as event}
                      <div class="rounded-xl border border-border/70 bg-background/80 px-3 py-2">
                        <div class="flex items-center justify-between gap-3">
                          <p class="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                            {event.category} · {event.action}
                          </p>
                          <p class="text-[11px] text-muted-foreground">
                            {formatTimestamp(event.timestampMillis)}
                          </p>
                        </div>
                        {#if event.detail}
                          <p class="mt-1 text-sm text-foreground break-words">{event.detail}</p>
                        {/if}
                        {#if event.durationMillis !== null}
                          <p class="mt-1 text-xs text-muted-foreground">Duration {formatMillis(event.durationMillis)}</p>
                        {/if}
                      </div>
                    {/each}
                  {/if}
                </div>
              </div>
            </div>
          {/if}
        {/if}
      </div>
    </section>
  </main>
</div>
