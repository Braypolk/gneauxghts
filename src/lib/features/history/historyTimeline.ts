import type {
  HistoryLifecycleRecord,
  HistoryModeRecord,
  HistoryMutationSource,
  HistoryRevisionRecord
} from './historyModeMachine';
import { compareHistoryRecordsNewestFirst } from './historyModeMachine';

export const historySourceLabels: Record<HistoryMutationSource, string> = {
  editor: 'Editor revision',
  taskAction: 'Task action',
  acceptedChatProposal: 'Accepted chat proposal',
  externalEdit: 'External edit',
  versionRestore: 'Version restore',
  noteCreation: 'Note created',
  baselineInitialization: 'Baseline revision',
  recoveryReconciliation: 'Recovery reconciliation'
};

export function formatHistoryTime(millis: number) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(millis));
}

export function historyCountLabel(value: number, singular: string) {
  return `${value} ${singular}${value === 1 ? '' : 's'}`;
}

export function historyRevisionSummary(record: HistoryRevisionRecord) {
  return `${historySourceLabels[record.source]} · ${historyCountLabel(record.lineCount, 'line')} · ${historyCountLabel(record.characterCount, 'character')}`;
}

export function historyRevisionTimeSummary(record: HistoryRevisionRecord) {
  const timestamp = formatHistoryTime(record.occurredAtMillis);
  switch (record.timeKind) {
    case 'knownSince':
      return `Known since ${timestamp}`;
    case 'committed':
      return `Committed ${timestamp}`;
    case 'observed':
      return `Observed ${timestamp}`;
  }
}

export function historySessionTimeSummary(
  startedAtMillis: number,
  endedAtMillis: number
) {
  if (startedAtMillis === endedAtMillis) return formatHistoryTime(endedAtMillis);
  return `${formatHistoryTime(startedAtMillis)} – ${formatHistoryTime(endedAtMillis)}`;
}

export interface EditingSessionTimelineItem {
  kind: 'editingSession';
  sessionId: string;
  source: HistoryMutationSource;
  startedAtMillis: number;
  endedAtMillis: number;
  revisions: HistoryRevisionRecord[];
}

export interface StandaloneRevisionTimelineItem {
  kind: 'standaloneRevision';
  revision: HistoryRevisionRecord;
}

export interface LifecycleEventTimelineItem {
  kind: 'lifecycleEvent';
  record: HistoryLifecycleRecord;
}

export type HistoryTimelineItem =
  | EditingSessionTimelineItem
  | StandaloneRevisionTimelineItem
  | LifecycleEventTimelineItem;

export function buildHistoryTimelineItems(
  records: HistoryModeRecord[]
): HistoryTimelineItem[] {
  const items: HistoryTimelineItem[] = [];

  for (const record of [...records].sort(compareHistoryRecordsNewestFirst)) {
    if (record.kind === 'lifecycleEvent') {
      items.push({ kind: 'lifecycleEvent', record });
      continue;
    }
    if (record.editingSessionId === null) {
      items.push({ kind: 'standaloneRevision', revision: record });
      continue;
    }

    const previous = items.at(-1);
    if (
      previous?.kind === 'editingSession' &&
      previous.sessionId === record.editingSessionId
    ) {
      previous.revisions.push(record);
      previous.startedAtMillis = Math.min(
        previous.startedAtMillis,
        record.occurredAtMillis
      );
      continue;
    }

    items.push({
      kind: 'editingSession',
      sessionId: record.editingSessionId,
      source: record.source,
      startedAtMillis: record.occurredAtMillis,
      endedAtMillis: record.occurredAtMillis,
      revisions: [record]
    });
  }

  return items;
}
