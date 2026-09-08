import type {
  HistoricalDiff,
  HistoryLifecycleRecord,
  HistoryModeRecord,
  HistoryMutationSource,
  HistoryRevisionRecord
} from './historyModeMachine';
import { compareHistoryRecordsNewestFirst } from './historyModeMachine';

export const historySourceLabels: Record<HistoryMutationSource, string> = {
  editor: 'Edited',
  taskAction: 'Task updated',
  acceptedChatProposal: 'Accepted chat suggestion',
  externalEdit: 'External edit',
  versionRestore: 'Restored version',
  noteCreation: 'Note created',
  baselineInitialization: 'First saved version',
  recoveryReconciliation: 'Recovered version'
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
  const source = historySourceLabels[record.source];
  return `${source} · ${historyCountLabel(record.lineCount, 'line')} · ${historyCountLabel(record.characterCount, 'character')}`;
}

export function historyRevisionTimeSummary(record: HistoryRevisionRecord) {
  const timestamp = formatHistoryTime(record.occurredAtMillis);
  switch (record.timeKind) {
    case 'editingWindow': {
      const evidence = record.timeEvidence;
      if (evidence?.kind !== 'editingWindow') return 'Time unavailable';
      if (evidence.clockDiscontinuity) {
        return `Time uncertain (clock changed) · ${historyIntervalTimeSummary(evidence.minWallMillis, evidence.maxWallMillis)}`;
      }
      return historyIntervalTimeSummary(evidence.firstWallMillis, evidence.lastWallMillis);
    }
    case 'knownSince':
      return `Known since ${timestamp}`;
    case 'committed':
      return timestamp;
    case 'observed':
      return timestamp;
  }
}

export function historyIntervalTimeSummary(
  startedAtMillis: number,
  endedAtMillis: number
) {
  if (startedAtMillis === endedAtMillis) return formatHistoryTime(endedAtMillis);
  const startedAt = new Date(startedAtMillis);
  const endedAt = new Date(endedAtMillis);
  if (
    startedAt.getFullYear() === endedAt.getFullYear() &&
    startedAt.getMonth() === endedAt.getMonth() &&
    startedAt.getDate() === endedAt.getDate()
  ) {
    const date = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(startedAt);
    const time = new Intl.DateTimeFormat(undefined, { timeStyle: 'short' });
    return `${date}, ${time.format(startedAt)} – ${time.format(endedAt)}`;
  }
  return `${formatHistoryTime(startedAtMillis)} – ${formatHistoryTime(endedAtMillis)}`;
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
  | StandaloneRevisionTimelineItem
  | LifecycleEventTimelineItem;

export function buildHistoryTimelineItems(
  records: HistoryModeRecord[]
): HistoryTimelineItem[] {
  return [...records].sort(compareHistoryRecordsNewestFirst).map(record =>
    record.kind === 'lifecycleEvent'
      ? { kind: 'lifecycleEvent', record }
      : { kind: 'standaloneRevision', revision: record }
  );
}

/** Counts the retained transition, including unmanaged property changes. */
export function historyDiffSummary(diff: HistoricalDiff) {
  const lines = [...diff.bodyLines, ...diff.propertiesLines];
  const added = lines.filter(line => line.kind === 'added').length;
  const removed = lines.filter(line => line.kind === 'removed').length;
  return `${historyCountLabel(added, 'line')} added · ${historyCountLabel(removed, 'line')} removed`;
}
