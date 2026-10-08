import { readFileSync } from 'node:fs';
import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import type { SemanticStatus, SemanticSetupProgress } from '$lib/types/semantic';
import { searchReadiness } from './semanticStatus';
import SemanticSettingsPanel from './SemanticSettingsPanel.svelte';

const fixture = JSON.parse(
  readFileSync(
    new URL(
      '../../../../src-tauri/test-fixtures/contracts/app-events.json',
      import.meta.url
    ).pathname,
    'utf8'
  )
) as { events: Array<{ channel: string; payload: SemanticStatus }> };

const freshStatus = fixture.events.find(
  ({ channel }) => channel === 'semantic-status-changed'
)!.payload;

function renderPanel(semanticStatus: SemanticStatus, isSettingUpLocalSearch = false) {
  return render(SemanticSettingsPanel, {
    props: {
      embedded: true,
      semanticSettings: semanticStatus.settings,
      semanticStatus,
      semanticDebug: null,
      semanticLayerError: null,
      semanticLayerMessage: null,
      isSaving: false,
      isRunningAction: false,
      isSettingUpLocalSearch,
      loadSemanticState: vi.fn(),
      updateSetting: vi.fn(),
      runAction: vi.fn(),
      downloadEmbeddingModel: vi.fn(),
      clearDebugMetrics: vi.fn(),
      clearAtlasCache: vi.fn(),
      formatTimestamp: () => 'now',
      formatMillis: () => '0 ms',
      averageDuration: () => 0
    }
  }).body;
}

describe('SemanticSettingsPanel health actions', () => {
  it('renders Retry now only for degraded status', () => {
    expect(renderPanel(freshStatus)).not.toContain('Retry now');
    expect(
      renderPanel({
        ...freshStatus,
        health: 'degraded',
        retryAttempt: 3,
        retryExhausted: true
      })
    ).toContain('Retry now');
  });
  it('keeps model failures visible even when the index has no error', () => {
    expect(renderPanel({ ...freshStatus, lastError: null, model: { ...freshStatus.model, error: 'Model could not load.' } }))
      .toContain('Model could not load.');
  });

  it('disables the preference and omits unavailable actions on unsupported platforms', () => {
    const html = renderPanel({ ...freshStatus, platformSupported: false, disabledReason: 'Unavailable here.' });
    expect(html).toContain('Unavailable here.');
    expect(html).toContain('role="switch"');
    expect(html).not.toContain('>Pause indexing');
    expect(html).not.toMatch(/<button[^>]*>Prepare local model<\/button>/);
  });

});

describe('local search setup progress', () => {
  const progress: SemanticSetupProgress = {
    phase: 'downloading', fileLabel: 'EmbeddingGemma 2 text and image model',
    fileName: 'embeddinggemma-2-text-vision-440m.litertlm', fileIndex: 2, fileCount: 2,
    downloadedBytes: 193_855_488, totalBytes: 387_710_976, error: null
  };
  const status: SemanticStatus = {
    ...freshStatus, modelAvailable: false, retryAttempt: 3, retryExhausted: true,
    lastError: 'Old indexing failure', model: { ...freshStatus.model, runtimeBinaryPath: null, error: 'Old model failure' },
    setupProgress: progress
  };

  it('shows actual file and byte progress while suppressing previous failures and indexing actions', () => {
    const html = renderPanel(status).split('<details')[0];
    expect(html).toContain('Downloading EmbeddingGemma 2');
    expect(html).toContain('File 2 of 2');
    expect(html).toContain(progress.fileName);
    expect(html).toContain('193.9 MB of 387.7 MB · 50%');
    expect(html).toMatch(/<progress[^>]*value="193855488"[^>]*max="387710976"/);
    expect(html).not.toContain('Old indexing failure');
    expect(html).not.toContain('Old model failure');
    expect(html).not.toContain('retries exhausted');
    expect(html).not.toContain('Pause indexing');
    expect(html).not.toContain('Setup required');
  });

  it('uses an indeterminate indicator when the server provides no file size', () => {
    const html = renderPanel({ ...status, setupProgress: { ...progress, fileIndex: 1, fileLabel: 'LiteRT runtime', totalBytes: null } });
    expect(html).toContain('193.9 MB downloaded · total size unavailable');
    expect(html).not.toContain('50%');
    expect(html).toMatch(/<progress[^>]*aria-label="Downloading LiteRT runtime"[^>]*><\/progress>/);
  });

  it.each(['checking', 'verifying', 'installing', 'starting'] as const)('distinguishes %s from byte transfer', phase => {
    const html = renderPanel({ ...status, setupProgress: { ...progress, phase } }).split('<details')[0];
    expect(html).toContain('Local search setup');
    expect(html).not.toContain('50%');
    expect(html).not.toMatch(/<progress[^>]*value=/);
    if (phase === 'starting') expect(html).toContain('first load can take a few minutes');
  });

  it('shows an interrupted download with the last byte count and a setup retry', () => {
    const html = renderPanel({ ...status, setupProgress: { ...progress, phase: 'failed', failedPhase: 'downloading', error: 'Connection lost' } }).split('<details')[0];
    expect(html).toContain('Setup interrupted');
    expect(html).toContain('193.9 MB of 387.7 MB · 50%');
    expect(html).toContain('Retry local search setup');
    expect(html).toContain('Connection lost');
    expect(html).not.toContain('retries exhausted');
    expect(html).not.toContain('<progress');
  });

  it('distinguishes a startup failure from a download failure', () => {
    const html = renderPanel({ ...status, setupProgress: { ...progress, phase: 'failed', failedPhase: 'starting', error: 'Model could not start' } }).split('<details')[0];
    expect(html).toContain('files are installed, but local search could not start');
    expect(html).not.toContain('50%');
  });

  it('shows setup as soon as the action starts, before the backend snapshot arrives', () => {
    const html = renderPanel({ ...status, setupProgress: undefined }, true).split('<details')[0];
    expect(html).toContain('Checking local search files');
    expect(html).not.toContain('Setup required');
    expect(html).not.toContain('Old indexing failure');
  });

  it('explains the Gemma downloads before setup starts and returns to index status after setup', () => {
    const missing = { ...freshStatus, modelAvailable: false, model: { ...freshStatus.model, label: 'EmbeddingGemma 2', runtimeBinaryPath: null } };
    expect(renderPanel(missing)).toContain('EmbeddingGemma 2 model · 387.7 MB');
    expect(renderPanel(missing)).toContain('LiteRT 0.18.0 runtime');
    expect(renderPanel({ ...freshStatus, setupProgress: { ...progress, phase: 'complete' } })).toContain('Ready to use');
  });
});

describe('semantic search readiness', () => {
  const readiness = (overrides: Partial<SemanticStatus> = {}) => {
    const status = { ...freshStatus, ...overrides };
    return searchReadiness(status, status.settings);
  };

  it('makes completed setup explicit without prominent maintenance actions', () => {
    expect(readiness()).toMatchObject({ state: 'ready', title: 'Ready to use', guidance: 'No action needed' });
    const overview = renderPanel(freshStatus).split('<details')[0];
    expect(overview).toContain('New and edited notes will be indexed automatically.');
    expect(overview).not.toContain('Pause indexing');
    expect(overview).not.toContain('Prepare local model');
    expect(overview).not.toContain('animate-spin');
  });

  it('distinguishes missing model files from runtime failures', () => {
    expect(readiness({ modelAvailable: false })).toMatchObject({ guidance: 'Setup required', action: 'download' });
    expect(readiness({ modelAvailable: false, model: { ...freshStatus.model, error: 'Failed' } }))
      .toMatchObject({ guidance: 'Action needed', action: 'prepare_semantic_model' });
    expect(readiness({ modelAvailable: false, model: { ...freshStatus.model, runtimeBinaryPath: null } }))
      .toMatchObject({ title: 'Set up local search', action: 'download', actionLabel: 'Set up local search' });
  });

  it('offers in-app setup on a fresh install even after a failed startup', () => {
    const html = renderPanel({ ...freshStatus, modelAvailable: false, model: {
      ...freshStatus.model, runtimeBinaryPath: null, error: 'Runtime missing'
    } });
    expect(html.split('<details')[0]).toContain('>Set up local search</button>');
    expect(html).not.toContain('Reinstall');
  });

  it('does not confuse queued work with active indexing', () => {
    expect(readiness({ health: 'working', indexingInProgress: false })).toMatchObject({ state: 'waiting', title: 'Updates queued' });
    expect(readiness({ health: 'working', indexingInProgress: true })).toMatchObject({ state: 'working', guidance: 'No action needed' });
    expect(renderPanel({ ...freshStatus, health: 'working', indexingInProgress: false }).split('<details')[0]).not.toContain('animate-spin');
    expect(renderPanel({ ...freshStatus, health: 'working', indexingInProgress: true }).split('<details')[0]).toContain('Pause indexing');
  });

  it('offers recovery or resume only when needed', () => {
    expect(readiness({ retryExhausted: true })).toMatchObject({ action: 'retry_semantic_index' });
    expect(readiness({ health: 'degraded' })).toMatchObject({ action: 'retry_semantic_index', guidance: 'Action needed' });
    expect(readiness({ health: 'paused', indexingPaused: true, indexingInProgress: true }))
      .toMatchObject({ state: 'paused', action: 'resume_semantic_indexing' });
    expect(readiness({ indexUsable: false })).toMatchObject({ action: 'rebuild_semantic_index' });
  });

  it('handles disabled search, empty vaults, and model warmup explicitly', () => {
    expect(readiness({ settings: { ...freshStatus.settings, semanticSearchEnabled: false } }))
      .toMatchObject({ state: 'off', title: 'Semantic search is off' });
    expect(readiness({ indexedNotes: 0, indexedChunks: 0, indexUsable: false }))
      .toMatchObject({ state: 'ready', title: 'Ready for your notes' });
    expect(readiness({ model: { ...freshStatus.model, ready: false, loading: true } }))
      .toMatchObject({ state: 'waiting', title: 'Getting search ready' });
    expect(readiness({ platformSupported: false })).toMatchObject({ state: 'unavailable' });
  });
});

it('offers both image budgets and selects the persisted preference', () => {
  const html = renderPanel({ ...freshStatus, settings: { ...freshStatus.settings, imageTokens: 140 } });
  expect(html).toContain('Standard · 70 tokens');
  expect(html).toContain('Higher detail · 140 tokens');
  expect(html).toMatch(/<option[^>]*value="140"[^>]*selected/);
  expect(html).toContain('rebuilds image embeddings');
});
