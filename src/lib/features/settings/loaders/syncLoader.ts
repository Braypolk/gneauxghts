import { invoke } from '@tauri-apps/api/core';
import type { SyncConflict, SyncStatus } from '$lib/types/sync';

export interface SyncSlice {
  status: SyncStatus;
  conflicts: SyncConflict[] | null;
}

export async function loadSyncSlice(includeConflicts = true): Promise<SyncSlice> {
  const [status, conflicts] = includeConflicts
    ? await Promise.all([invoke<SyncStatus>('get_sync_status'), invoke<SyncConflict[]>('list_sync_conflicts')])
    : [await invoke<SyncStatus>('get_sync_status'), null];
  return { status, conflicts };
}
