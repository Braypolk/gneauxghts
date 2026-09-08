import { describe, expect, it } from 'vitest';
import {
  buildHistoryTimelineItems,
  type HistoryTimelineItem
} from './historyTimeline';
import type {
  HistoryModeRecord,
  HistoryRevisionRecord
} from './historyModeMachine';

function revision(
  revisionId: string,
  occurredAtMillis: number,
  source: HistoryRevisionRecord['source'] = 'editor',
  timelineOrdinal = occurredAtMillis
): HistoryRevisionRecord {
  return {
    kind: 'revision',
    recordId: revisionId,
    revisionId,
    source,
    occurredAtMillis,
    timelineOrdinal,
    timeKind: 'committed',
    modifiedAtMillis: null,
    revisionLabel: null,
    lineCount: 2,
    characterCount: 20
  };
}

function revisionIds(item: HistoryTimelineItem): string[] {
  return item.kind === 'standaloneRevision'
      ? [item.revision.revisionId]
      : [];
}

describe('buildHistoryTimelineItems', () => {
  it('keeps windows, actions, and external observations individually selectable in lineage order', () => {
    const window: HistoryRevisionRecord = {
      ...revision('window', 100), timeKind: 'editingWindow',
      timeEvidence: {kind: 'editingWindow', version: 1, firstWallMillis: 20, lastWallMillis: 100, minWallMillis: 20, maxWallMillis: 100, clockDiscontinuity: false}
    };
    const records: HistoryModeRecord[] = [
      window, revision('external-1', 200, 'externalEdit'), revision('external-2', 201, 'externalEdit'),
      revision('task', 300, 'taskAction'), revision('baseline', 0, 'baselineInitialization')
    ];
    const items = buildHistoryTimelineItems(records);
    expect(items.every(item => item.kind === 'standaloneRevision')).toBe(true);
    expect(items.map(revisionIds)).toEqual([['task'], ['external-2'], ['external-1'], ['window'], ['baseline']]);
  });
  it('uses lineage ordinals at timestamp ties and keeps lifecycle events separate', () => {
    const items = buildHistoryTimelineItems([
      revision('z-first', 1000, 'editor', 0), revision('a-last', 1000, 'editor', 2),
      {kind: 'lifecycleEvent', recordId: 'event', eventId: 'event', eventKind: 'renamed', occurredAtMillis: 1000, timelineOrdinal: 1, previousPath: '/old.md', path: '/new.md'}
    ]);
    expect(items.map(revisionIds)).toEqual([['a-last'], [], ['z-first']]);
  });
});
describe('finalized Editing Windows', () => {
  const window = {
    ...revision('window-1', 3_000),
    timeKind: 'editingWindow' as const,
    timeEvidence: {
      kind: 'editingWindow' as const, version: 1 as const,
      firstWallMillis: 1_000, lastWallMillis: 3_000,
      minWallMillis: 1_000, maxWallMillis: 3_000, clockDiscontinuity: false
    }
  };

  it('keeps every window directly selectable across action boundaries', () => {
    const items = buildHistoryTimelineItems([
      window,
      { ...window, recordId: 'window-2', revisionId: 'window-2', timelineOrdinal: 4_000 },
      revision('task', 5_000, 'taskAction')
    ]);
    expect(items.map(item => item.kind)).toEqual([
      'standaloneRevision', 'standaloneRevision', 'standaloneRevision'
    ]);
    expect(items.map(revisionIds)).toEqual([['task'], ['window-2'], ['window-1']]);
  });

  it('displays the interval and explicitly uncertain raw clock evidence without inventing a point', async () => {
    const { historyIntervalTimeSummary, historyRevisionTimeSummary } = await import('./historyTimeline');
    expect(historyRevisionTimeSummary(window)).toBe(historyIntervalTimeSummary(1_000, 3_000));
    const reversed = { ...window, timeEvidence: { ...window.timeEvidence, firstWallMillis: 3_000, lastWallMillis: 1_000, clockDiscontinuity: true } };
    expect(historyRevisionTimeSummary(reversed)).toContain('Time uncertain (clock changed)');
    expect(historyRevisionTimeSummary({ ...window, timeEvidence: undefined })).toBe('Time unavailable');
  });
});
