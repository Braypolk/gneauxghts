<script lang="ts">
  import { RefreshCcw } from '@lucide/svelte';
  import type { SemanticDebugSnapshot, SemanticSettings, SemanticStatus } from '$lib/types/semantic';

  type SemanticAction =
    | 'rebuild_semantic_index'
    | 'pause_semantic_indexing'
    | 'resume_semantic_indexing'
    | 'prepare_semantic_model';

  let {
    embedded = false,
    semanticSettings,
    semanticStatus,
    semanticDebug,
    semanticLayerError,
    semanticLayerMessage,
    isSaving,
    isRunningAction,
    loadSemanticState,
    updateSetting,
    runAction,
    downloadEmbeddingModel,
    clearDebugMetrics,
    formatTimestamp,
    formatMillis,
    averageDuration
  }: {
    embedded?: boolean;
    semanticSettings: SemanticSettings | null;
    semanticStatus: SemanticStatus | null;
    semanticDebug: SemanticDebugSnapshot | null;
    semanticLayerError: string | null;
    semanticLayerMessage: string | null;
    isSaving: boolean;
    isRunningAction: boolean;
    loadSemanticState: () => Promise<void>;
    updateSetting: <Key extends keyof SemanticSettings>(
      key: Key,
      value: SemanticSettings[Key]
    ) => void;
    runAction: (command: SemanticAction) => Promise<void>;
    downloadEmbeddingModel: () => Promise<void>;
    clearDebugMetrics: () => Promise<void>;
    formatTimestamp: (value: number | null) => string;
    formatMillis: (value: number | null) => string;
    averageDuration: (total: number, count: number) => number;
  } = $props();
</script>

<div class={embedded ? 'px-0 py-0' : 'border-t border-border/70 px-6 py-5'}>
  <div class={`flex items-start justify-between gap-4 ${embedded ? 'justify-end' : ''}`}>
    {#if !embedded}
      <div>
        <p class="text-sm font-medium">Semantic Layer</p>
        <p class="mt-0.5 text-xs text-muted-foreground">
          Local-first semantic indexing stays on top of your markdown files instead of replacing them.
        </p>
      </div>
    {/if}

    <button
      class="inline-flex shrink-0 items-center gap-2 rounded-full border border-border bg-background px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      type="button"
      onclick={() => void loadSemanticState()}
    >
      <RefreshCcw class="h-4 w-4" />
      Refresh
    </button>
  </div>

  {#if semanticSettings && semanticStatus}
    {#if !semanticStatus.platformSupported}
      <div class="mt-6 rounded-3xl border border-sky-300/60 bg-sky-50 px-5 py-4 text-sm text-sky-700 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-200">
        {semanticStatus.disabledReason ?? 'Semantic search is unavailable on this platform.'}
      </div>
    {:else}
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
              onchange={(event) =>
                updateSetting(
                  'semanticSearchEnabled',
                  (event.currentTarget as HTMLInputElement).checked
                )}
            />
          </div>
        </label>

        <label class="rounded-3xl border border-border/70 bg-background/70 px-5 py-4">
          <div class="flex items-start justify-between gap-4">
            <div>
              <p class="text-sm font-medium">Local-only Mode</p>
              <p class="mt-1 text-xs text-muted-foreground">
                Stay offline for the semantic runtime. Turn off temporarily to download the embedding model from Hugging Face.
              </p>
            </div>
            <input
              type="checkbox"
              checked={semanticSettings.localOnlyMode}
              onchange={(event) =>
                updateSetting('localOnlyMode', (event.currentTarget as HTMLInputElement).checked)}
            />
          </div>
        </label>

      </div>
    {/if}

    {#if semanticLayerError}
      <div class="mt-6 rounded-3xl border border-rose-300/60 bg-rose-50 px-5 py-4 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200">
        {semanticLayerError}
      </div>
    {/if}
    {#if semanticLayerMessage}
      <div class="mt-6 rounded-3xl border border-emerald-300/60 bg-emerald-50 px-5 py-4 text-sm text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200">
        {semanticLayerMessage}
      </div>
    {/if}

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
        <p class="mt-1 text-xs text-muted-foreground">
          {semanticStatus.indexedChunks} chunks · last run {formatTimestamp(semanticStatus.lastIndexedAtMillis)}
        </p>
      </div>

      <div class="rounded-3xl border border-border/70 bg-background/70 px-5 py-4">
        <p class="text-xs uppercase tracking-[0.18em] text-muted-foreground">ANN</p>
        <p class="mt-2 text-sm font-medium">
          {semanticStatus.annIndexLoaded ? 'Loaded' : 'Pending rebuild'}
        </p>
        <p class="mt-1 text-xs text-muted-foreground">
          {semanticStatus.annIndexedChunks} indexed chunks · dirty {semanticStatus.annIndexDirty ? 'yes' : 'no'}
        </p>
        <p class="mt-1 text-xs text-muted-foreground">
          rebuild pending {semanticStatus.annRebuildPending ? 'yes' : 'no'} · dump {formatTimestamp(semanticStatus.annLastDumpedAtMillis)}
        </p>
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

    {#if semanticStatus.platformSupported}
      <div class="mt-6 flex flex-wrap items-center gap-3">
        <button
          class="rounded-full border border-border bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent"
          type="button"
          disabled={isRunningAction}
          onclick={() => void downloadEmbeddingModel()}
        >
          Download embedding model
        </button>

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
              semanticStatus.indexingPaused
                ? 'resume_semantic_indexing'
                : 'pause_semantic_indexing'
            )}
        >
          {semanticStatus.indexingPaused ? 'Resume indexing' : 'Pause indexing'}
        </button>

        {#if isSaving || isRunningAction}
          <p class="text-xs uppercase tracking-[0.18em] text-muted-foreground">Updating…</p>
        {/if}
      </div>
    {/if}

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
              search {metrics.searchRequestCount} · related {metrics.relatedRequestCount}
            </p>
            <p class="mt-1 text-xs text-muted-foreground">
              search semantic used {metrics.searchSemanticUsedCount} · skipped {metrics.searchSemanticSkippedCount}
            </p>
            <p class="mt-1 text-xs text-muted-foreground">
              related unavailable {metrics.relatedUnavailableCount}
            </p>
          </div>

          <div class="rounded-2xl border border-border/70 bg-card/70 px-4 py-3">
            <p class="text-xs uppercase tracking-[0.18em] text-muted-foreground">ANN Queries</p>
            <p class="mt-2 text-sm font-medium">{metrics.annQueryCount} queries</p>
            <p class="mt-1 text-xs text-muted-foreground">
              candidates {metrics.annQueryCandidateTotal} · reranked {metrics.annQueryRerankTotal}
            </p>
            <p class="mt-1 text-xs text-muted-foreground">
              avg {formatMillis(averageDuration(metrics.annQueryDurationTotalMillis, metrics.annQueryCount))}
              · max {formatMillis(metrics.annQueryDurationMaxMillis)}
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

          <div class="rounded-2xl border border-border/70 bg-card/70 px-4 py-3">
            <p class="text-xs uppercase tracking-[0.18em] text-muted-foreground">Related Panel</p>
            <p class="mt-2 text-sm font-medium">
              note {metrics.relatedNoteRequestCount} · selection {metrics.relatedSelectionRequestCount}
            </p>
            <p class="mt-1 text-xs text-muted-foreground">
              cache {metrics.relatedCacheHitCount} · edges {metrics.relatedEdgeReuseCount} · semantic {metrics.relatedSemanticQueryCount}
            </p>
            <p class="mt-1 text-xs text-muted-foreground">
              avg {formatMillis(averageDuration(metrics.relatedDurationTotalMillis, metrics.relatedRequestCount))}
              · max {formatMillis(metrics.relatedDurationMaxMillis)}
            </p>
          </div>
        </div>

        <div class="mt-4 grid gap-4 md:grid-cols-2">
          <div class="rounded-2xl border border-border/70 bg-card/70 px-4 py-3">
            <p class="text-xs uppercase tracking-[0.18em] text-muted-foreground">Failures</p>
            <p class="mt-2 text-sm font-medium">
              embedding {metrics.embeddingRequestFailureCount} · index {metrics.indexJobFailedCount} · ann {metrics.annLoadFailureCount + metrics.annUpdateFailureCount}
            </p>
            <p class="mt-1 text-xs text-muted-foreground">
              prepare {metrics.modelPrepareFailureCount} · warmup {metrics.modelWarmupFailureCount} · timeouts {metrics.runtimeTimeoutCount}
            </p>
          </div>

          <div class="rounded-2xl border border-border/70 bg-card/70 px-4 py-3">
            <p class="text-xs uppercase tracking-[0.18em] text-muted-foreground">ANN Lifecycle</p>
            <p class="mt-2 text-sm font-medium">
              loads {metrics.annLoadSuccessCount} · rebuilds {metrics.annRebuildCount}
            </p>
            <p class="mt-1 text-xs text-muted-foreground">
              pending {metrics.annRebuildPendingCount} · update failures {metrics.annUpdateFailureCount}
            </p>
            <p class="mt-1 text-xs text-muted-foreground">
              avg {formatMillis(averageDuration(metrics.annRebuildDurationTotalMillis, metrics.annRebuildCount))}
              · max {formatMillis(metrics.annRebuildDurationMaxMillis)}
            </p>
          </div>

          <div class="rounded-2xl border border-border/70 bg-card/70 px-4 py-3">
            <p class="text-xs uppercase tracking-[0.18em] text-muted-foreground">Related Outcomes</p>
            <p class="mt-2 text-sm font-medium">
              results {metrics.relatedResultTotal} · insufficient {metrics.relatedInsufficientContentCount}
            </p>
            <p class="mt-1 text-xs text-muted-foreground">
              unavailable {metrics.relatedUnavailableCount} · requests {metrics.relatedRequestCount}
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
