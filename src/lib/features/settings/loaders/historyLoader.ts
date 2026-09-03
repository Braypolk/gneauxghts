import { invoke } from '@tauri-apps/api/core';
import type {
  HistoryHealthReport,
  HistoryResetDiagnostic,
  NoteHistoryHealth
} from '$lib/types/history';

export function loadHistoryHealthSlice() {
  return invoke<HistoryHealthReport>('get_history_health');
}

export function retryHistoryRecovery() {
  return invoke<HistoryHealthReport>('retry_history_recovery');
}

export function loadNoteHistoryHealth(noteId: string) {
  return invoke<NoteHistoryHealth>('get_note_history_health', { noteId });
}

export function resetCorruptHistory() {
  return invoke<HistoryResetDiagnostic>('reset_corrupt_history', { confirmed: true });
}

export function clearVaultHistory() {
  return invoke<void>('clear_vault_history', { confirmed: true });
}
