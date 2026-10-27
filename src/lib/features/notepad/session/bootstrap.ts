import { invoke } from '@tauri-apps/api/core';
import type { NoteSession } from '#lib/features/notepad/model/types.js';
import type { SemanticStatus } from '#lib/types/semantic.js';
import type { VaultInfo, WatcherHealth } from '#lib/types/vault.js';
import { createSessionSnapshot, type SessionSnapshot } from './session';

export interface BootstrapAppPayload {
  vault: VaultInfo;
  watcherHealth: WatcherHealth;
  noteSession: NoteSession;
  semanticStatus: SemanticStatus;
  indexRevision: number;
}

export interface BootstrapAppResult {
  vault: VaultInfo;
  watcherHealth: WatcherHealth;
  session: SessionSnapshot;
  semanticStatus: SemanticStatus;
  indexRevision: number;
}

export async function loadBootstrapPayload(): Promise<BootstrapAppResult> {
  const payload = await invoke<BootstrapAppPayload>('bootstrap_app');
  return {
    vault: payload.vault,
    watcherHealth: payload.watcherHealth,
    session: createSessionSnapshot(payload.noteSession),
    semanticStatus: payload.semanticStatus,
    indexRevision: payload.indexRevision
  };
}
