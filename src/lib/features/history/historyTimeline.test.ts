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
  editingSessionId: string | null,
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
    editingSessionId,
    revisionLabel: null,
    lineCount: 2,
    characterCount: 20
  };
}

function revisionIds(item: HistoryTimelineItem): string[] {
  return item.kind === 'editingSession'
    ? item.revisions.map((record) => record.revisionId)
    : item.kind === 'standaloneRevision'
      ? [item.revision.revisionId]
      : [];
}

describe('buildHistoryTimelineItems', () => {
  it('orders records newest first while retaining every revision inside its Editing Session', () => {
    const records: HistoryModeRecord[] = [
      revision('revision-1', 1_000, 'revision-1'),
      revision('revision-3', 3_000, 'revision-1'),
      revision('revision-2', 2_000, 'revision-1')
    ];

    const items = buildHistoryTimelineItems(records);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: 'editingSession',
      sessionId: 'revision-1',
      startedAtMillis: 1_000,
      endedAtMillis: 3_000
    });
    expect(revisionIds(items[0])).toEqual([
      'revision-3',
      'revision-2',
      'revision-1'
    ]);
  });

  it('merges a live revision into the stable session and leaves boundaries standalone', () => {
    const lifecycle: HistoryModeRecord = {
      kind: 'lifecycleEvent',
      recordId: 'event-1',
      eventId: 'event-1',
      eventKind: 'renamed',
      occurredAtMillis: 3_000,
      timelineOrdinal: 3_000,
      previousPath: '/vault/Before.md',
      path: '/vault/After.md'
    };
    const items = buildHistoryTimelineItems([
      revision('revision-4', 4_000, 'revision-4'),
      lifecycle,
      revision('restore', 2_000, null, 'versionRestore'),
      revision('revision-1', 1_000, 'revision-1')
    ]);

    expect(items.map((item) => item.kind)).toEqual([
      'editingSession',
      'lifecycleEvent',
      'standaloneRevision',
      'editingSession'
    ]);
    expect(revisionIds(items[2])).toEqual(['restore']);

    const refreshed = buildHistoryTimelineItems([
      revision('revision-5', 4_500, 'revision-4'),
      revision('revision-4', 4_000, 'revision-4'),
      lifecycle,
      revision('restore', 2_000, null, 'versionRestore'),
      revision('revision-1', 1_000, 'revision-1')
    ]);
    expect(refreshed[0]).toMatchObject({
      kind: 'editingSession',
      sessionId: 'revision-4'
    });
    expect(revisionIds(refreshed[0])).toEqual(['revision-5', 'revision-4']);
  });

  it('uses predecessor-derived ordinals instead of opaque identities at timestamp ties', () => {
    const items = buildHistoryTimelineItems([
      revision('z-first', 1_000, 'z-first', 'editor', 0),
      revision('a-last', 1_000, 'a-last', 'editor', 1)
    ]);

    expect(items.map(revisionIds)).toEqual([['a-last'], ['z-first']]);
  });
});
