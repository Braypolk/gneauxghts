import { invoke } from '@tauri-apps/api/core';
import type { NoteSession } from '$lib/features/notepad/model/types';
import type { SemanticStatus } from '$lib/types/semantic';
import type { VaultInfo } from '$lib/types/vault';
import { createSessionSnapshot, type SessionSnapshot } from './session';

export interface BootstrapAppPayload {
  vault: VaultInfo;
  noteSession: NoteSession;
  semanticStatus: SemanticStatus;
  indexRevision: number;
}

export interface BootstrapAppResult {
  vault: VaultInfo;
  session: SessionSnapshot;
  semanticStatus: SemanticStatus;
  indexRevision: number;
}

export async function loadBootstrapPayload(): Promise<BootstrapAppResult> {
  const payload = await invoke<BootstrapAppPayload>('bootstrap_app');
  return {
    vault: payload.vault,
    session: createSessionSnapshot(payload.noteSession),
    semanticStatus: payload.semanticStatus,
    indexRevision: payload.indexRevision
  };
}
