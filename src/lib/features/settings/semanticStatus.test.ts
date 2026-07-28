import { describe, expect, it } from 'vitest';
import type { SemanticStatus } from '$lib/types/semantic';
import { semanticStatusLabel, shouldShowSemanticRetry } from './semanticStatus';

function status(overrides: Partial<SemanticStatus> = {}): SemanticStatus {
  return {
    health: 'fresh',
    indexUsable: true,
    retryAttempt: 0,
    retryMaxAttempts: 3,
    retryExhausted: false,
    currentJobLabel: null,
    progressCurrent: 0,
    progressTotal: 0,
    ...overrides
  } as SemanticStatus;
}

describe('semantic status presentation', () => {
  it('uses one label for each backend health state', () => {
    expect(semanticStatusLabel(status({ health: 'fresh' }))).toBe('Ready');
    expect(
      semanticStatusLabel(
        status({
          health: 'working',
          currentJobLabel: 'Rebuilding',
          progressCurrent: 2,
          progressTotal: 5
        })
      )
    ).toBe('Rebuilding 2/5');
    expect(semanticStatusLabel(status({ health: 'stale' }))).toBe(
      'Stale · using last good index'
    );
    expect(semanticStatusLabel(status({ health: 'degraded' }))).toBe(
      'Degraded · using last good index'
    );
    expect(semanticStatusLabel(status({ health: 'paused' }))).toBe('Paused');
  });

  it('offers Retry now only for degraded or exhausted status', () => {
    expect(shouldShowSemanticRetry(status())).toBe(false);
    expect(shouldShowSemanticRetry(status({ health: 'working' }))).toBe(false);
    expect(shouldShowSemanticRetry(status({ health: 'degraded' }))).toBe(true);
    expect(shouldShowSemanticRetry(status({ retryExhausted: true }))).toBe(true);
  });
});
