<script lang="ts">
  import type { SemanticDebugSnapshot, SemanticSettings, SemanticStatus } from '$lib/types/semantic';
  import { Check, ChevronRight, CircleAlert, Clock3, LoaderCircle, Pause, RefreshCcw, SearchCheck } from '@lucide/svelte';
  import { searchReadiness } from './semanticStatus';

  type SemanticAction =
    | 'rebuild_semantic_index'
    | 'retry_semantic_index'
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
    clearAtlasCache,
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
    clearAtlasCache: () => Promise<void>;
    formatTimestamp: (value: number | null) => string;
    formatMillis: (value: number | null) => string;
    averageDuration: (total: number, count: number) => number;
  } = $props();

  let isRefreshing = $state(false);
  let refreshError = $state<string | null>(null);
  const busy = $derived(isSaving || isRunningAction || isRefreshing);
  const readiness = $derived(semanticStatus && semanticSettings ? searchReadiness(semanticStatus, semanticSettings) : null);

  function resolveAction() {
    if (readiness?.action === 'download') void downloadEmbeddingModel();
    else if (readiness?.action) void runAction(readiness.action);
  }

  async function refresh() {
    isRefreshing = true;
    refreshError = null;
    try { await loadSemanticState(); }
    catch (error) { refreshError = String(error); }
    finally { isRefreshing = false; }
  }
</script>

{#snippet action(label: string, onclick: () => void, primary = false)}
  <button class="semantic-button" class:primary type="button" disabled={busy} {onclick}>{label}</button>
{/snippet}

<div class="semantic-panel" class:standalone={!embedded}>
  {#if semanticSettings && semanticStatus && readiness}
    <div class="semantic-preference" data-settings-anchor="semantic-search">
      <div>
        <h3 id="semantic-toggle-label">Search beyond exact words</h3>
        <p id="semantic-toggle-hint">Find notes by meaning, alongside your keyword matches.</p>
      </div>
      <label class="semantic-switch">
        <input type="checkbox" role="switch" checked={semanticSettings.semanticSearchEnabled}
          disabled={busy || !semanticStatus.platformSupported}
          aria-labelledby="semantic-toggle-label" aria-describedby="semantic-toggle-hint"
          onchange={(event) => updateSetting('semanticSearchEnabled', event.currentTarget.checked)} />
        <span class="semantic-switch-track" aria-hidden="true"><span></span></span>
      </label>
    </div>

    {#if !semanticStatus.platformSupported}
      <p class="semantic-notice" role="status">{semanticStatus.disabledReason ?? 'Semantic search is unavailable on this platform.'}</p>
    {/if}
    {#if semanticLayerError || refreshError}
      <p class="semantic-notice error" role="alert">{semanticLayerError ?? refreshError}</p>
    {/if}
    {#if semanticLayerMessage}
      <p class="semantic-notice" role="status">{semanticLayerMessage}</p>
    {/if}

    <section class="semantic-index" data-state={readiness.state} data-settings-anchor="semantic-actions" aria-label="Search index status">
      <div class="semantic-index-heading">
        <span class="semantic-kicker">{readiness.guidance}</span>
        <button class="semantic-refresh" type="button" aria-label="Refresh semantic search" title="Refresh status"
          disabled={busy} onclick={() => void refresh()}>
          <RefreshCcw size={15} class={isRefreshing ? 'animate-spin' : ''} />
        </button>
      </div>
      <div class="semantic-index-body">
        <div class="semantic-status-icon" aria-hidden="true">
          {#if readiness.state === 'working'}<LoaderCircle size={22} class="animate-spin" />
          {:else if readiness.state === 'paused'}<Pause size={22} />
          {:else if readiness.state === 'ready'}<Check size={22} />
          {:else if readiness.state === 'attention'}<CircleAlert size={22} />
          {:else if readiness.state === 'waiting'}<Clock3 size={22} />
          {:else}<SearchCheck size={22} />{/if}
        </div>
        <div class="semantic-index-copy" role="status" aria-live="polite">
          <h3>{readiness.title}</h3>
          <p>{readiness.description}</p>
        </div>
        {#if readiness.action}
          <div class="semantic-actions">
            {@render action(readiness.actionLabel!, resolveAction, true)}
          </div>
        {:else if readiness.state === 'working'}
          <div class="semantic-actions">
            {@render action('Pause indexing', () => void runAction('pause_semantic_indexing'))}
          </div>
        {/if}
      </div>
      {#if readiness.state === 'working' && semanticStatus.progressTotal > 0}
        <progress class="semantic-progress" aria-label="Indexing progress" value={semanticStatus.progressCurrent} max={semanticStatus.progressTotal}></progress>
      {/if}
      <div class="semantic-index-footer">
        <span><strong>{semanticStatus.indexedNotes.toLocaleString()}</strong> notes indexed</span>
        <span>{semanticStatus.lastIndexedAtMillis ? `Last indexed ${formatTimestamp(semanticStatus.lastIndexedAtMillis)}` : 'No notes indexed yet'}</span>
        {#if busy}<span role="status">Updating…</span>{/if}
      </div>
      {#if semanticStatus.retryAttempt > 0}
        <p class="semantic-index-detail">Retry {semanticStatus.retryAttempt}/{semanticStatus.retryMaxAttempts}{semanticStatus.retryExhausted ? ' · retries exhausted' : ''}</p>
      {/if}
      {#if semanticStatus.rebuildReason}<p class="semantic-index-detail">{semanticStatus.rebuildReason}</p>{/if}
    </section>

    {#if semanticStatus.lastError || semanticStatus.model.error || semanticStatus.latestJob?.errorText}
      <p class="semantic-notice error" role="alert">{semanticStatus.lastError ?? semanticStatus.model.error ?? semanticStatus.latestJob?.errorText}</p>
    {/if}

    <section class="semantic-model semantic-row" data-settings-anchor="semantic-model" aria-label="Embedding model">
      <div class="semantic-row-copy">
        <h3>Embedding model</h3>
        <p class="semantic-model-name">{semanticStatus.model.label}</p>
        {#if !semanticStatus.modelAvailable}
        <p>{!semanticStatus.platformSupported ? 'Unavailable on this device.' : semanticStatus.model.error ? 'Needs attention · see the message above.' : semanticSettings.semanticSearchEnabled ? 'Setup incomplete · see the step above.' : 'Not installed. Download it in Maintenance when needed.'}</p>
        {/if}
      </div>
      {#if semanticStatus.modelAvailable}
        <span class="semantic-installed"><Check size={14} aria-hidden="true" /> Installed</span>
      {/if}
    </section>

    <details class="semantic-disclosure" data-settings-anchor="semantic-maintenance">
      <summary><span><span class="semantic-disclosure-title">Maintenance</span></span><ChevronRight size={16} /></summary>
      <div class="semantic-disclosure-body">
        <div class="semantic-row" data-settings-anchor="semantic-background">
          <div class="semantic-row-copy"><h4>Automatic indexing · {semanticStatus.indexingPaused ? 'Paused' : 'On'}</h4><p>{semanticStatus.indexingPaused ? 'New and edited notes wait until you resume.' : 'Waits between updates. Runs when notes or search resources change.'}</p></div>
          {#if semanticStatus.platformSupported}
            {@render action(semanticStatus.indexingPaused ? 'Resume automatic updates' : 'Pause automatic updates', () => void runAction(semanticStatus.indexingPaused ? 'resume_semantic_indexing' : 'pause_semantic_indexing'))}
          {/if}
        </div>
        <div class="semantic-row" data-settings-anchor="semantic-prepare">
          <div class="semantic-row-copy"><h4>Prepare local model</h4><p>Loads automatically. Start manually to check or retry.</p></div>
          {#if semanticStatus.platformSupported}{@render action('Prepare local model', () => void runAction('prepare_semantic_model'))}{/if}
        </div>
        <div class="semantic-row" data-settings-anchor="semantic-rebuild">
          <div class="semantic-row-copy"><h4>Rebuild search index</h4><p>Reprocess your notes and rebuild their semantic matches.</p></div>
          {#if semanticStatus.platformSupported}{@render action('Rebuild semantic index', () => void runAction('rebuild_semantic_index'))}{/if}
        </div>
        <div class="semantic-row" data-settings-anchor="semantic-cache">
          <div class="semantic-row-copy"><h4>Map layout cache</h4><p>Clear saved positions so the next Map open generates a new layout.</p></div>
          {#if semanticStatus.platformSupported}{@render action('Clear map cache', () => void clearAtlasCache())}{/if}
        </div>
        <div class="semantic-row" data-settings-anchor="semantic-download">
          <div class="semantic-row-copy"><h4>Model files</h4><p>Download or verify the model files.</p></div>
          {#if semanticStatus.platformSupported}{@render action('Download embedding model', () => void downloadEmbeddingModel())}{/if}
        </div>
      </div>
    </details>

    <details class="semantic-disclosure" data-settings-anchor="semantic-diagnostics">
      <summary><span><span class="semantic-disclosure-title">Diagnostics &amp; recent activity</span></span><ChevronRight size={16} /></summary>
      <div class="semantic-disclosure-body">
        <h4 class="semantic-detail-heading">Local model</h4>
        <dl class="semantic-facts">
          <div><dt>Status</dt><dd>{semanticStatus.model.status}</dd></div>
          <div><dt>Available</dt><dd>{semanticStatus.modelAvailable ? 'Yes' : 'No'}</dd></div>
          <div><dt>Dimensions</dt><dd>{semanticStatus.model.dimensions}</dd></div>
          <div><dt>Runtime</dt><dd>{semanticStatus.model.runtimeBinaryPath ?? 'Not installed'}</dd></div>
          <div><dt>Model files</dt><dd>{semanticStatus.model.modelPath ?? semanticStatus.model.modelRepoId}</dd></div>
        </dl>
        <h4 class="semantic-detail-heading">Vector index · ANN</h4>
        <dl class="semantic-facts">
          <div><dt>Indexed chunks</dt><dd>{semanticStatus.indexedChunks}</dd></div>
          <div><dt>ANN state</dt><dd>{semanticStatus.annIndexLoaded ? 'Loaded' : 'Pending rebuild'}</dd></div>
          <div><dt>ANN chunks</dt><dd>{semanticStatus.annIndexedChunks}</dd></div>
          <div><dt>Dirty</dt><dd>{semanticStatus.annIndexDirty ? 'Yes' : 'No'}</dd></div>
          <div><dt>Rebuild pending</dt><dd>{semanticStatus.annRebuildPending ? 'Yes' : 'No'}</dd></div>
          <div><dt>Last dump</dt><dd>{formatTimestamp(semanticStatus.annLastDumpedAtMillis)}</dd></div>
        </dl>
        {#if semanticStatus.latestJob}
          <h4 class="semantic-detail-heading">Latest job</h4>
          <dl class="semantic-facts">
            <div><dt>Status</dt><dd>{semanticStatus.latestJob.status}</dd></div>
            <div><dt>Processed</dt><dd>{semanticStatus.latestJob.scannedCount} scanned · {semanticStatus.latestJob.embeddedCount} embedded</dd></div>
            <div><dt>Started</dt><dd>{formatTimestamp(semanticStatus.latestJob.startedAtMillis)}</dd></div>
            <div><dt>Updated</dt><dd>{formatTimestamp(semanticStatus.latestJob.updatedAtMillis)}</dd></div>
          </dl>
        {/if}
        <div class="semantic-telemetry-heading">
          <div><h4>Performance</h4>{#if semanticDebug}<p>Captured {formatTimestamp(semanticDebug.capturedAtMillis)}</p>{/if}</div>
          <div class="semantic-actions">
            {@render action('Refresh diagnostics', () => void refresh())}
            {#if semanticDebug}{@render action('Clear diagnostics', () => void clearDebugMetrics())}{/if}
          </div>
        </div>
        {#if semanticDebug}
          {@const metrics = semanticDebug.metrics}
          <table class="semantic-metrics"><caption class="sr-only">Semantic performance metrics</caption><tbody>
<tr><th scope="row">Embeddings</th><td><p class="semantic-metric-line">{metrics.embeddingRequestCount} requests</p>
            <p class="semantic-metric-line">
              avg {formatMillis(averageDuration(metrics.embeddingDurationTotalMillis, metrics.embeddingRequestCount))}
              · max {formatMillis(metrics.embeddingDurationMaxMillis)}
            </p>
            <p class="semantic-metric-line">
              texts {metrics.embeddingTextCountTotal} · chars {metrics.embeddingCharCountTotal}
            </p></td></tr>
<tr><th scope="row">Runtime</th><td><p class="semantic-metric-line">
              spawns {metrics.runtimeSpawnCount} · restarts {metrics.runtimeRestartCount}
            </p>
            <p class="semantic-metric-line">
              ready {metrics.runtimeReadyCount} · shutdowns {metrics.runtimeShutdownCount}
            </p>
            <p class="semantic-metric-line">
              warmup {formatMillis(metrics.modelWarmupLastMillis)} · prepare {formatMillis(metrics.modelPrepareLastMillis)}
            </p></td></tr>
<tr><th scope="row">Requests</th><td><p class="semantic-metric-line">
              search {metrics.searchRequestCount} · related {metrics.relatedRequestCount}
            </p>
            <p class="semantic-metric-line">
              search semantic used {metrics.searchSemanticUsedCount} · skipped {metrics.searchSemanticSkippedCount}
            </p>
            <p class="semantic-metric-line">
              related unavailable {metrics.relatedUnavailableCount}
            </p></td></tr>
<tr><th scope="row">ANN Queries</th><td><p class="semantic-metric-line">{metrics.annQueryCount} queries</p>
            <p class="semantic-metric-line">
              candidates {metrics.annQueryCandidateTotal} · reranked {metrics.annQueryRerankTotal}
            </p>
            <p class="semantic-metric-line">
              avg {formatMillis(averageDuration(metrics.annQueryDurationTotalMillis, metrics.annQueryCount))}
              · max {formatMillis(metrics.annQueryDurationMaxMillis)}
            </p></td></tr>
<tr><th scope="row">Index</th><td><p class="semantic-metric-line">
              jobs {metrics.indexJobStartedCount} · zero-work {metrics.indexZeroWorkCount}
            </p>
            <p class="semantic-metric-line">
              scanned {metrics.indexScannedTotal} · embedded {metrics.indexEmbeddedTotal}
            </p>
            <p class="semantic-metric-line">
              avg {formatMillis(averageDuration(metrics.indexDurationTotalMillis, metrics.indexJobCompletedCount + metrics.indexJobFailedCount))}
              · max {formatMillis(metrics.indexDurationMaxMillis)}
            </p></td></tr>
<tr><th scope="row">Related Panel</th><td><p class="semantic-metric-line">
              note {metrics.relatedNoteRequestCount} · selection {metrics.relatedSelectionRequestCount}
            </p>
            <p class="semantic-metric-line">
              cache {metrics.relatedCacheHitCount} · edges {metrics.relatedEdgeReuseCount} · note-ann {metrics.relatedNoteAnnCount} · semantic {metrics.relatedSemanticQueryCount}
            </p>
            <p class="semantic-metric-line">
              avg {formatMillis(averageDuration(metrics.relatedDurationTotalMillis, metrics.relatedRequestCount))}
              · max {formatMillis(metrics.relatedDurationMaxMillis)}
            </p></td></tr>
<tr><th scope="row">Failures</th><td><p class="semantic-metric-line">
              embedding {metrics.embeddingRequestFailureCount} · index {metrics.indexJobFailedCount} · ann {metrics.annLoadFailureCount + metrics.annUpdateFailureCount}
            </p>
            <p class="semantic-metric-line">
              prepare {metrics.modelPrepareFailureCount} · warmup {metrics.modelWarmupFailureCount} · timeouts {metrics.runtimeTimeoutCount}
            </p></td></tr>
<tr><th scope="row">ANN Lifecycle</th><td><p class="semantic-metric-line">
              loads {metrics.annLoadSuccessCount} · rebuilds {metrics.annRebuildCount}
            </p>
            <p class="semantic-metric-line">
              pending {metrics.annRebuildPendingCount} · update failures {metrics.annUpdateFailureCount}
            </p>
            <p class="semantic-metric-line">
              avg {formatMillis(averageDuration(metrics.annRebuildDurationTotalMillis, metrics.annRebuildCount))}
              · max {formatMillis(metrics.annRebuildDurationMaxMillis)}
            </p></td></tr>
<tr><th scope="row">Related Outcomes</th><td><p class="semantic-metric-line">
              results {metrics.relatedResultTotal} · insufficient {metrics.relatedInsufficientContentCount}
            </p>
            <p class="semantic-metric-line">
              unavailable {metrics.relatedUnavailableCount} · requests {metrics.relatedRequestCount}
            </p></td></tr>
          </tbody></table>
          <h4 class="semantic-detail-heading">Recent events</h4>
          <div class="semantic-events">
            {#if semanticDebug.recentEvents.length === 0}
              <p class="text-sm text-muted-foreground">No events captured yet.</p>
            {:else}
              {#each semanticDebug.recentEvents as event, eventIndex (`${event.timestampMillis}:${event.category}:${event.action}:${event.detail ?? ''}:${event.durationMillis ?? ''}:${eventIndex}`)}
                <div class="semantic-event">
                  <div class="flex flex-wrap items-center justify-between gap-2">
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

        {:else}
          <p class="semantic-no-metrics">No diagnostics available yet. Refresh to check again.</p>
        {/if}
      </div>
    </details>
  {:else}
    <p class="semantic-notice" role="status">Loading semantic search settings…</p>
  {/if}
</div>

<style>
  .semantic-panel { container-type: inline-size; }
  .standalone { padding: 24px; }
  .semantic-preference { display: flex; align-items: center; justify-content: space-between; gap: 24px; padding-bottom: 20px; }
  .semantic-panel h3, .semantic-panel h4 { font-size: 13px; font-weight: 550; }
  .semantic-panel p { margin-top: 6px; font-size: 12px; line-height: 1.6; color: var(--muted-foreground); }
  .semantic-switch { position: relative; display: flex; align-items: center; flex-shrink: 0; height: 44px; cursor: pointer; }
  .semantic-switch input { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; z-index: 1; }
  .semantic-switch-track { display: block; padding: 3px; width: 38px; height: 22px; border-radius: 20px; background: var(--input); transition: background 120ms; }
  .semantic-switch-track > span { display: block; width: 16px; height: 16px; border-radius: 50%; background: var(--card); box-shadow: 0 1px 3px rgb(0 0 0 / 0.18); transition: transform 120ms; }
  .semantic-switch input:checked + span { background: var(--foreground); }
  .semantic-switch input:checked + span > span { transform: translateX(16px); background: var(--background); }
  .semantic-switch input:focus-visible + span { outline: 2px solid var(--ring); outline-offset: 4px; }
  .semantic-switch:has(input:disabled) { opacity: 0.45; cursor: not-allowed; }
  .semantic-index { padding: 12px 18px 0; border: 1px solid var(--border); border-radius: 12px; background: var(--background); }
  .semantic-index[data-state="attention"] { border-color: color-mix(in oklab, var(--destructive) 45%, var(--border)); }
  .semantic-index[data-state="attention"] .semantic-kicker { color: var(--destructive); }
  .semantic-installed { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; color: var(--muted-foreground); }
  .semantic-index-heading { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
  .semantic-kicker { font-size: 10px; font-weight: 500; color: var(--muted-foreground); letter-spacing: 0.08em; text-transform: uppercase; }
  .semantic-refresh { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 6px; color: var(--muted-foreground); }
  .semantic-refresh:hover { background: var(--muted); color: var(--foreground); }
  .semantic-index-body { display: flex; align-items: center; gap: 14px; }
  .semantic-status-icon { display: grid; place-items: center; flex-shrink: 0; width: 42px; height: 42px; border: 1px solid var(--border); border-radius: 50%; background: var(--card); }
  .semantic-index-copy { flex: 1; min-width: 0; }
  .semantic-index-copy h3 { font-size: 18px; letter-spacing: -0.025em; line-height: 1.4; }
  .semantic-index-copy p { margin-top: 3px; }
  .semantic-index-footer { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 20px; margin-top: 16px; padding: 12px 0; border-top: 1px solid var(--border); font-size: 11px; color: var(--muted-foreground); }
  .semantic-index-footer strong { color: var(--foreground); font-weight: 550; }
  .semantic-panel .semantic-index-detail { margin: 0 0 12px; }
  .semantic-progress { display: block; width: 100%; height: 4px; margin-top: 20px; accent-color: var(--foreground); }
  .semantic-row { display: flex; align-items: center; justify-content: space-between; gap: 24px; padding: 20px 0; }
  .semantic-row-copy { min-width: 0; max-width: 390px; }
  .semantic-model { padding-block: 20px; }
  .semantic-panel .semantic-model-name { color: var(--foreground); font-size: 13px; overflow-wrap: anywhere; }
  .semantic-actions { display: flex; align-items: center; flex-wrap: wrap; justify-content: flex-end; gap: 8px; flex-shrink: 0; }
  .semantic-panel :global(.semantic-button) { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 34px; padding: 7px 11px; border: 1px solid var(--border); border-radius: 7px; background: var(--card); font-size: 11px; font-weight: 500; white-space: nowrap; }
  .semantic-panel :global(.semantic-button:hover) { background: var(--muted); }
  .semantic-panel :global(.semantic-button.primary) { background: var(--foreground); border-color: var(--foreground); color: var(--background); }
  .semantic-panel :global(button:disabled) { opacity: 0.45; cursor: not-allowed; }
  .semantic-notice { padding: 12px 14px; margin-bottom: 18px; background: var(--muted); border-radius: 8px; overflow-wrap: anywhere; }
  .semantic-panel .error { color: var(--destructive); background: color-mix(in oklab, var(--destructive) 7%, var(--card)); }
  .semantic-disclosure { border-top: 1px solid var(--border); }
  .semantic-disclosure > summary { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 16px 4px 16px 0; list-style: none; cursor: pointer; }
  .semantic-disclosure > summary::-webkit-details-marker { display: none; }
  .semantic-disclosure > summary :global(svg) { flex-shrink: 0; color: var(--muted-foreground); transition: transform 120ms; }
  .semantic-disclosure[open] > summary :global(svg) { transform: rotate(90deg); }
  .semantic-disclosure-title { display: block; font-size: 13px; font-weight: 550; }
  .semantic-disclosure-body { padding-bottom: 20px; }
  .semantic-disclosure-body .semantic-row + .semantic-row { border-top: 1px solid var(--border); }
  .semantic-detail-heading { padding: 18px 0 10px; }
  .semantic-facts { font-size: 12px; }
  .semantic-facts > div { display: grid; grid-template-columns: 140px minmax(0, 1fr); gap: 20px; padding: 8px 0; border-bottom: 1px solid color-mix(in oklab, var(--border) 50%, transparent); }
  .semantic-facts dt { color: var(--muted-foreground); }
  .semantic-facts dd { overflow-wrap: anywhere; }
  .semantic-telemetry-heading { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 30px 0 16px; }
  .semantic-metrics { width: 100%; border-collapse: collapse; }
  .semantic-metrics th { width: 140px; text-align: left; vertical-align: top; font-size: 12px; font-weight: 500; }
  .semantic-metrics :is(th, td) { border-top: 1px solid var(--border); padding: 12px 0; }
  .semantic-metrics td { padding-left: 20px; }
  .semantic-panel .semantic-metric-line { margin: 0; font-size: 11px; }
  .semantic-events { max-height: 300px; overflow-y: auto; }
  .semantic-event { border-top: 1px solid var(--border); padding: 12px 0; }
  @container (max-width: 620px) {
    .semantic-index-body { flex-wrap: wrap; }
    .semantic-index-body > .semantic-actions { width: 100%; justify-content: flex-start; padding-left: 56px; }
    .semantic-row { flex-direction: column; align-items: flex-start; gap: 14px; }
    .semantic-actions { flex-wrap: wrap; justify-content: flex-start; }
    .semantic-telemetry-heading { flex-direction: column; align-items: flex-start; }
  }
  @container (max-width: 380px) {
    .semantic-index { padding: 14px 16px 0; }
    .semantic-index-body > .semantic-actions { padding-left: 0; }
    .semantic-status-icon { display: none; }
    .semantic-facts > div { grid-template-columns: 95px minmax(0, 1fr); gap: 12px; }
    .semantic-metrics th { width: 95px; }
    .semantic-metrics td { padding-left: 12px; }
    .semantic-panel :global(.semantic-button) { min-height: 44px; }
  }
  @media (prefers-reduced-motion: reduce) {
    .semantic-switch-track, .semantic-switch-track > span, .semantic-disclosure > summary :global(svg) { transition: none; }
  }
</style>
