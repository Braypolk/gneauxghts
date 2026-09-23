import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import type { HistoryHealthReport } from '$lib/types/history';
import HistorySettingsPanel from './HistorySettingsPanel.svelte';

function report(overrides: Partial<HistoryHealthReport> = {}): HistoryHealthReport {
  return {
    state: 'healthy',
    integrity: 'verified',
    initialization: {
      phase: 'complete',
      discoveredNotes: 4,
      baselineRevisions: 4,
      readyNotes: 4,
      failedNotes: 0
    },
    storage: { allocatedBytes: 2_048, reclaimableBytes: 512 },
    pendingRepairs: 0,
    canRetry: false,
    canReset: false,
    ...overrides
  };
}

function renderPanel(historyHealth: HistoryHealthReport) {
  return render(HistorySettingsPanel, {
    props: {
      historyHealth,
      isRunningAction: false,
      actionError: null,
      retryHistory: vi.fn(),
      resetCorruptHistory: vi.fn(),
      clearVaultHistory: vi.fn()
    }
  }).body;
}

describe('HistorySettingsPanel health and recovery states', () => {
  it('presents healthy storage, initialization, and reclaimable usage', () => {
    const body = renderPanel(report());
    expect(body).toContain('History is healthy');
    expect(body).toContain('Integrity verified');
    expect(body).toContain('4 of 4 notes ready');
    expect(body).toContain('2 KB allocated');
    expect(body).toContain('512 bytes reclaimable');
    expect(body).toContain('Clear vault history');
    expect(body).toContain('active notes');
    expect(body).toContain('Current notes stay unchanged');
    expect(body).toContain('Missing and forgotten timelines are retained');
  });

  it.each([
    ['initializing', 'History is initializing'],
    ['degraded', 'History needs attention'],
    ['warning', 'A saved change needs history repair'],
    ['unavailable', 'History is unavailable'],
    ['corrupt', 'History is corrupt']
  ] as const)('renders the %s state actionably', (state, label) => {
    const body = renderPanel(
      report({
        state,
        integrity: state === 'corrupt' ? 'corrupt' : state === 'unavailable' ? 'unavailable' : 'verified',
        canRetry: state !== 'initializing',
        canReset: state === 'unavailable' || state === 'corrupt'
      })
    );
    expect(body).toContain(label);
    if (state !== 'initializing') expect(body).toContain('Retry history');
    if (state === 'unavailable' || state === 'corrupt') {
      expect(body).toContain('Back up your Markdown vault');
      expect(body).toContain('Reset history');
    }
  });

  it('keeps the prose-free reset diagnostic visible after recovery', () => {
    const body = renderPanel(
      report({
        lastReset: {
          operationId: 'reset-operation',
          previousGeneration: 2,
          generation: 3,
          resetAtMillis: 1_788_000_000_000,
          initialization: {
            phase: 'complete',
            discoveredNotes: 4,
            baselineRevisions: 4,
            readyNotes: 4,
            failedNotes: 0
          }
        }
      })
    );
    expect(body).toContain('History was reset');
    expect(body).toContain('generation 2 to 3');
    expect(body).not.toContain('Readable Markdown');
  });
});
