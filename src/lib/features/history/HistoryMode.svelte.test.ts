import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import HistoryMode from './HistoryMode.svelte';
import type { HistoryModeState } from './historyModeMachine';

const openState: Extract<HistoryModeState, { phase: 'open' }> = {
  phase: 'open',
  target: {
    noteId: 'note-1',
    noteTitle: 'Timeline note',
    notePath: '/vault/Timeline note.md'
  },
  workspace: { activePaneId: 'notepad-pane-1', focusTarget: 'editor' },
  records: [
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
      timeKind: 'observed',
      modifiedAtMillis: 1_700,
      editingSessionId: 'revision-1',
      lineCount: 1,
      characterCount: 14
    },
    {
      kind: 'lifecycleEvent',
      recordId: 'event-1',
      eventId: 'event-1',
      eventKind: 'renamed',
      occurredAtMillis: 1_500,
      timelineOrdinal: 0,
      previousPath: '/vault/Old.md',
      path: '/vault/Timeline note.md'
    }
  ],
  nextCursor: 'event-1',
  selectedRevisionId: 'revision-2',
  selectedComparison: 'parent',
  selectedDiff: {
    revisionId: 'revision-2',
    comparison: 'parent',
    fromRevisionId: 'revision-1',
    toRevisionId: 'revision-2',
    bodyLines: [
      {
        kind: 'added',
        text: '# Historical body',
        oldLineNumber: null,
        newLineNumber: 1
      }
    ],
    propertiesLines: [
      {
        kind: 'added',
        text: 'project: atlas',
        oldLineNumber: null,
        newLineNumber: 1
      }
    ],
    missingAssets: []
  },
  request: null,
  error: null
};

describe('HistoryMode', () => {
  it('renders revisions and lifecycle events as a global read-only surface', () => {
    const body = render(HistoryMode, {
      props: {
        state: openState,
        onExit: vi.fn(),
        onSelectRevision: vi.fn(),
        onSetComparison: vi.fn(),
        onLoadMore: vi.fn(),
        onRetry: vi.fn()
      }
    }).body;

    expect(body).toContain('History Mode');
    expect(body).toContain('Read only');
    expect(body).toContain('Timeline note');
    expect(body).toContain('External edit');
    expect(body).toContain('2 revisions');
    expect(body).toContain('2 lines');
    expect(body).toContain('31 characters');
    expect(body).toContain('Renamed Old.md to Timeline note.md');
    expect(body).toContain('# Historical body');
    expect(body).toContain('project: atlas');
    expect(body).toContain('Previous revision');
    expect(body).toContain('Current note');
    expect(body).toContain('Load older history');
    expect(body).not.toContain('contenteditable');
    expect(body).not.toContain('<textarea');
  });

  it('renders Editing Sessions collapsed by default', () => {
    const body = render(HistoryMode, {
      props: {
        state: openState,
        onExit: vi.fn(),
        onSelectRevision: vi.fn(),
        onSetComparison: vi.fn(),
        onLoadMore: vi.fn(),
        onRetry: vi.fn()
      }
    }).body;

    expect(body).toContain('aria-expanded="false"');
    expect(body.match(/data-revision-id=/gu)).toBeNull();
  });

  it('keeps unavailable history escapable', () => {
    const state: HistoryModeState = {
      phase: 'historyUnavailable',
      target: openState.target,
      workspace: openState.workspace,
      error: 'History became unavailable.'
    };
    const body = render(HistoryMode, {
      props: {
        state,
        onExit: vi.fn(),
        onSelectRevision: vi.fn(),
        onSetComparison: vi.fn(),
        onLoadMore: vi.fn(),
        onRetry: vi.fn()
      }
    }).body;

    expect(body).toContain('History became unavailable.');
    expect(body).toContain('Retry');
    expect(body).toContain('Back to workspace');
  });
});
