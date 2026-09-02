import { invoke } from '@tauri-apps/api/core';
import type {
  HistoricalDiff,
  HistoricalRevision,
  HistoryDiffComparison,
  HistoryModePage
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
