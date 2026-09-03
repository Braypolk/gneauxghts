import { invoke } from '@tauri-apps/api/core';
import type { HistoryStorageUsage, NoteHistoryHealth } from '$lib/types/history';
import type {
  HistoricalDiff,
  HistoricalRevision,
  HistoryDiffComparison,
  HistoryModeDiagnostics,
  HistoryModePage,
  HistoryRestoreCommit,
  HistoryRestorePreview
} from './historyModeMachine';

const HISTORY_PAGE_SIZE = 30;

export function getHistoryModePage(
  noteId: string,
  cursor: string | null = null
): Promise<HistoryModePage> {
  return invoke<HistoryModePage>('get_note_history_page', {
    noteId,
    cursor,
    limit: HISTORY_PAGE_SIZE
  });
}

export function getHistoryModeRevision(
  noteId: string,
  revisionId: string
): Promise<HistoricalRevision> {
  return invoke<HistoricalRevision>('get_note_history_revision', {
    noteId,
    revisionId
  });
}

export function getHistoryModeDiff(
  noteId: string,
  revisionId: string,
  comparison: HistoryDiffComparison
): Promise<HistoricalDiff> {
  return invoke<HistoricalDiff>('get_note_history_diff', {
    noteId,
    revisionId,
    comparison
  });
}

export function previewHistoryRevisionRestore(
  noteId: string,
  revisionId: string
): Promise<HistoryRestorePreview> {
  return invoke<HistoryRestorePreview>('preview_note_revision_restore', {
    noteId,
    revisionId
  });
}

export function restoreHistoryRevision(
  noteId: string,
  revisionId: string,
  expectedCurrentAuthoredContentHash: string
): Promise<HistoryRestoreCommit> {
  return invoke<HistoryRestoreCommit>('restore_note_revision', {
    noteId,
    revisionId,
    expectedCurrentAuthoredContentHash,
    confirmed: true
  });
}

export function nameHistoryRevision(
  noteId: string,
  revisionId: string,
  label: string
): Promise<void> {
  return invoke('name_note_revision', { noteId, revisionId, label });
}

export function removeHistoryRevisionName(
  noteId: string,
  revisionId: string
): Promise<void> {
  return invoke('remove_note_revision_name', { noteId, revisionId });
}

export function clearNoteHistory(noteId: string): Promise<void> {
  return invoke('clear_note_history', { noteId, confirmed: true });
}

export async function getHistoryModeDiagnostics(
  noteId: string
): Promise<HistoryModeDiagnostics> {
  const [note, vault] = await Promise.all([
    invoke<NoteHistoryHealth>('get_note_history_health', { noteId }),
    invoke<{ storage?: HistoryStorageUsage }>('get_history_health')
  ]);
  return { note, storage: vault.storage ?? null };
}
