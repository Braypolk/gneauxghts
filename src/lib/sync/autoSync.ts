import { invoke } from '@tauri-apps/api/core';
import type { SyncStatus } from '$lib/types/sync';

let scheduledSyncTimer: ReturnType<typeof window.setTimeout> | null = null;
let scheduledSyncFirstRequestedAt: number | null = null;
let syncQueue: Promise<SyncStatus | null> = Promise.resolve(null);

const MAX_SCHEDULED_SYNC_DELAY_MS = 10_000;

async function loadSyncStatus() {
  return invoke<SyncStatus>('get_sync_status');
}

async function runLinkedSync(reason: string) {
  const status = await loadSyncStatus();
  if (status.paused || !status.linkedVault.linked || !status.syncBaseUrl) {
    return status;
  }

  try {
    return await invoke<SyncStatus>('sync_now');
  } catch (error) {
    console.error(`Auto sync failed (${reason}):`, error);
    return null;
  }
}

export function runAutoSyncNow(reason: string) {
  syncQueue = syncQueue
    .catch(() => null)
    .then(() => runLinkedSync(reason));
  return syncQueue;
}

export function scheduleAutoSync(reason: string, delayMs = 1500) {
  const now = Date.now();
  scheduledSyncFirstRequestedAt ??= now;
  if (scheduledSyncTimer) {
    window.clearTimeout(scheduledSyncTimer);
  }

  const elapsed = now - scheduledSyncFirstRequestedAt;
  const boundedDelay = Math.min(delayMs, Math.max(0, MAX_SCHEDULED_SYNC_DELAY_MS - elapsed));
  scheduledSyncTimer = window.setTimeout(() => {
    scheduledSyncTimer = null;
    scheduledSyncFirstRequestedAt = null;
    void runAutoSyncNow(reason);
  }, boundedDelay);
}

export function cancelScheduledAutoSync() {
  if (!scheduledSyncTimer) {
    return;
  }

  window.clearTimeout(scheduledSyncTimer);
  scheduledSyncTimer = null;
  scheduledSyncFirstRequestedAt = null;
}
