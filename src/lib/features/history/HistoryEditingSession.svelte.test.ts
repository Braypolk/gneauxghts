import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import HistoryEditingSession from './HistoryEditingSession.svelte';
import type { EditingSessionTimelineItem } from './historyTimeline';

const session: EditingSessionTimelineItem = {
  kind: 'editingSession',
  sessionId: 'revision-1',
  source: 'externalEdit',
  startedAtMillis: 1_800,
  endedAtMillis: 2_000,
  revisions: [
    {
      kind: 'revision',
      recordId: 'revision-2',
      revisionId: 'revision-2',
      source: 'externalEdit',
      occurredAtMillis: 2_000,
      timelineOrdinal: 2,
      timeKind: 'observed',
      modifiedAtMillis: 1_900,
      editingSessionId: 'revision-1',
      revisionLabel: 'Release candidate',
      lineCount: 2,
      characterCount: 31
    },
    {
      kind: 'revision',
      recordId: 'revision-1',
      revisionId: 'revision-1',
      source: 'externalEdit',
      occurredAtMillis: 1_800,
      timelineOrdinal: 1,
      timeKind: 'knownSince',
      modifiedAtMillis: null,
      editingSessionId: 'revision-1',
      revisionLabel: null,
      lineCount: 1,
      characterCount: 14
    }
  ]
};

function renderSession(item: EditingSessionTimelineItem, expanded: boolean) {
  return render(HistoryEditingSession, {
    props: {
      item,
      selectedRevisionId: 'revision-2',
      disabled: false,
      expanded,
      onToggle: vi.fn(),
      onSelectRevision: vi.fn()
    }
  }).body;
}

describe('HistoryEditingSession', () => {
  it('renders collapsed and expanded states', () => {
    const collapsed = renderSession(session, false);
    expect(collapsed).toContain('aria-expanded="false"');
    expect(collapsed).toContain('2 revisions');
    expect(collapsed).toContain('Latest revision · 2 lines · 31 characters');
    expect(collapsed.match(/data-revision-id=/gu)).toBeNull();

    const expanded = renderSession(session, true);
    expect(expanded).toContain('aria-expanded="true"');
    expect(expanded.match(/data-revision-id=/gu)).toHaveLength(2);
    expect(expanded.indexOf('data-revision-id="revision-2"')).toBeLessThan(
      expanded.indexOf('data-revision-id="revision-1"')
    );
    expect(expanded).toContain('Observed');
    expect(expanded).toContain('Known since');
    expect(expanded).toContain('File timestamp');
    expect(expanded).toContain('(untrusted)');
  });

  it('renders a newly arrived revision while the controlled session stays expanded', () => {
    const liveSession: EditingSessionTimelineItem = {
      ...session,
      endedAtMillis: 2_200,
      revisions: [
        {
          ...session.revisions[0],
          recordId: 'revision-3',
          revisionId: 'revision-3',
          occurredAtMillis: 2_200,
          timelineOrdinal: 3,
          timeKind: 'committed',
          modifiedAtMillis: null,
          lineCount: 3,
          characterCount: 42
        },
        ...session.revisions
      ]
    };
    const body = renderSession(liveSession, true);

    expect(body).toContain('3 revisions');
    expect(body.match(/data-revision-id=/gu)).toHaveLength(3);
    expect(body.indexOf('data-revision-id="revision-3"')).toBeLessThan(
      body.indexOf('data-revision-id="revision-2"')
    );
    expect(body).toContain('Committed');
  });
});
