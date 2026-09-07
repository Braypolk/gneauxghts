import type {
  HistoricalDiff,
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
  const source = record.timeKind === 'editingWindow' ? 'Editing Window · Editor' : historySourceLabels[record.source];
  return `${source} · ${historyCountLabel(record.lineCount, 'line')} · ${historyCountLabel(record.characterCount, 'character')}`;
}

export function historyRevisionTimeSummary(record: HistoryRevisionRecord) {
  const timestamp = formatHistoryTime(record.occurredAtMillis);
  switch (record.timeKind) {
    case 'editingWindow': {
      const evidence = record.timeEvidence;
      if (evidence?.kind !== 'editingWindow') return 'Editing interval unavailable';
      if (evidence.clockDiscontinuity) {
        return `Time uncertain (clock changed) · first saved ${formatHistoryTime(evidence.firstWallMillis)}, last saved ${formatHistoryTime(evidence.lastWallMillis)} · wall-time range ${historyIntervalTimeSummary(evidence.minWallMillis, evidence.maxWallMillis)}`;
      }
      return `Saved ${historyIntervalTimeSummary(evidence.firstWallMillis, evidence.lastWallMillis)}`;
    }
    case 'knownSince':
      return `Known since ${timestamp}`;
    case 'committed':
      return `Committed ${timestamp}`;
    case 'observed':
      return `Observed ${timestamp}`;
  }
}

export function historyIntervalTimeSummary(
  startedAtMillis: number,
  endedAtMillis: number
) {
  if (startedAtMillis === endedAtMillis) return formatHistoryTime(endedAtMillis);
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
