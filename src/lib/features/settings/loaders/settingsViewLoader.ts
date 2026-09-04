import { invoke } from '@tauri-apps/api/core';
import type {
  SemanticDebugSnapshot,
  SemanticSettings,
  SemanticStatus
} from '$lib/types/semantic';
import type { HistoryHealthReport } from '$lib/types/history';
import type { VaultInfo } from '$lib/types/vault';

export interface SettingsViewPayload {
  vault: VaultInfo;
  historyHealth: HistoryHealthReport;
  semanticStatus: SemanticStatus;
  semanticSettings: SemanticSettings;
  semanticDebug: SemanticDebugSnapshot;
}

export function loadSettingsViewSlice() {
  return invoke<SettingsViewPayload>('get_settings_view');
}
