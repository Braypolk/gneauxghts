import { invoke } from '@tauri-apps/api/core';
import type { SemanticDebugSnapshot, SemanticSettings, SemanticStatus } from '$lib/types/semantic';

export interface SemanticSlice {
  status: SemanticStatus;
  settings: SemanticSettings;
  debug: SemanticDebugSnapshot;
}

export function loadSemanticStatusSlice() {
  return invoke<SemanticStatus>('get_semantic_status');
}

export async function loadSemanticSlice(): Promise<SemanticSlice> {
  const [status, settings, debug] = await Promise.all([
    loadSemanticStatusSlice(),
    invoke<SemanticSettings>('get_semantic_settings'),
    invoke<SemanticDebugSnapshot>('get_semantic_debug_metrics')
  ]);
  return { status, settings, debug };
}
