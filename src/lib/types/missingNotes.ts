import type { CommittedMutationWarning } from '$lib/contracts/committedMutation';
import type { HistoryModePage } from '$lib/features/history/historyModeMachine';

export interface MissingNoteSummary {
  noteId: string;
  path: string;
  title: string;
  fileName: string;
  missingAtMillis: number;
  retentionDays: 1 | 7 | 30;
  purgeAtMillis: number;
  timeline: HistoryModePage;
}

export interface RecoveredMissingNote {
  noteId: string;
  restoredPath: string;
  title: string;
  commitWarning?: CommittedMutationWarning | null;
}
