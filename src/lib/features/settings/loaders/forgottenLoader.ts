import { invokeHistoryCommand } from '$lib/contracts/historyCommand';
import { invokeForgottenItemCommand } from '$lib/contracts/forgottenItemCommand';
import type { ForgottenNoteSummary } from '$lib/types/forgottenNotes';
import type { MissingNoteSummary } from '$lib/types/missingNotes';
import type { HistoryModePage } from '$lib/features/history/historyModeMachine';

const MISSING_NOTE_HISTORY_PAGE_SIZE = 30;

export function loadForgottenNotesSlice() {
  return invokeForgottenItemCommand<ForgottenNoteSummary[]>('list_forgotten_notes');
}

export function loadMissingNotesSlice() {
  return invokeHistoryCommand<MissingNoteSummary[]>('list_missing_notes');
}

export function loadMissingNoteTimelinePage(noteId: string, cursor: string) {
  return invokeHistoryCommand<HistoryModePage>('get_missing_note_history_page', {
    noteId,
    cursor,
    limit: MISSING_NOTE_HISTORY_PAGE_SIZE
  });
}
