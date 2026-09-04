import { invokeHistoryCommand } from '$lib/contracts/historyCommand';
import type {
  HistoryHealthReport,
  HistoryResetDiagnostic,
  NoteHistoryHealth
} from '$lib/types/history';

export function loadHistoryHealthSlice() {
  return invokeHistoryCommand<HistoryHealthReport>('get_history_health');
}

export function retryHistoryRecovery() {
  return invokeHistoryCommand<HistoryHealthReport>('retry_history_recovery');
}

export function loadNoteHistoryHealth(noteId: string) {
  return invokeHistoryCommand<NoteHistoryHealth>('get_note_history_health', { noteId });
}

export function resetCorruptHistory() {
  return invokeHistoryCommand<HistoryResetDiagnostic>('reset_corrupt_history', { confirmed: true });
}

export function clearVaultHistory() {
  return invokeHistoryCommand<void>('clear_vault_history', { confirmed: true });
}
