import { readFileSync } from 'node:fs';
import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import type { SemanticStatus } from '$lib/types/semantic';
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

function renderPanel(semanticStatus: SemanticStatus) {
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
