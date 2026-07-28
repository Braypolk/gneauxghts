import type { SemanticStatus } from '$lib/types/semantic';

export function semanticStatusLabel(status: SemanticStatus): string {
  switch (status.health) {
    case 'paused':
      return 'Paused';
    case 'degraded':
      return status.indexUsable ? 'Degraded · using last good index' : 'Degraded';
    case 'stale':
      return status.indexUsable ? 'Stale · using last good index' : 'Stale';
    case 'working':
      if (status.progressTotal > 0) {
        return `${status.currentJobLabel ?? 'Indexing'} ${status.progressCurrent}/${status.progressTotal}`;
      }
      return status.currentJobLabel ?? 'Indexing';
    case 'fresh':
      return 'Ready';
  }
}

export function shouldShowSemanticRetry(status: SemanticStatus): boolean {
  return status.health === 'degraded' || status.retryExhausted;
}
