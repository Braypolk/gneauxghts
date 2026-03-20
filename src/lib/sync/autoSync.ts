import { invoke } from '@tauri-apps/api/core';
import type { SyncStatus } from '$lib/types/sync';

let scheduledSyncTimer: ReturnType<typeof window.setTimeout> | null = null;
let syncQueue: Promise<SyncStatus | null> = Promise.resolve(null);

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
  if (scheduledSyncTimer) {
    window.clearTimeout(scheduledSyncTimer);
  }

  scheduledSyncTimer = window.setTimeout(() => {
    scheduledSyncTimer = null;
    void runAutoSyncNow(reason);
  }, delayMs);
}

export function cancelScheduledAutoSync() {
  if (!scheduledSyncTimer) {
    return;
  }

  window.clearTimeout(scheduledSyncTimer);
  scheduledSyncTimer = null;
}
