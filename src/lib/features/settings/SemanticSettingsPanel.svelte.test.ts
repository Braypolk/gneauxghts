import { readFileSync } from 'node:fs';
import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import type { SemanticStatus } from '$lib/types/semantic';
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
});
