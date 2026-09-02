import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import HistoryMode from './HistoryMode.svelte';
import type { HistoryModeState } from './historyModeMachine';

const openState: HistoryModeState = {
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
      timeKind: 'observed',
      modifiedAtMillis: 1_900
    },
    {
      kind: 'lifecycleEvent',
      recordId: 'event-1',
      eventId: 'event-1',
      eventKind: 'renamed',
      occurredAtMillis: 1_500,
      previousPath: '/vault/Old.md',
      path: '/vault/Timeline note.md'
    }
  ],
  nextCursor: 'event-1',
  selectedRevisionId: 'revision-2',
  selectedRevision: {
    revisionId: 'revision-2',
    unmanagedFrontmatter: 'project: atlas\n',
    body: '# Historical body'
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
        onLoadMore: vi.fn(),
        onRetry: vi.fn()
      }
    }).body;

    expect(body).toContain('History Mode');
    expect(body).toContain('Read only');
    expect(body).toContain('Timeline note');
    expect(body).toContain('External edit');
    expect(body).toContain('Renamed');
    expect(body).toContain('Old.md');
    expect(body).toContain('# Historical body');
    expect(body).toContain('project: atlas');
    expect(body).toContain('Load older history');
    expect(body).not.toContain('contenteditable');
    expect(body).not.toContain('<textarea');
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
        onLoadMore: vi.fn(),
        onRetry: vi.fn()
      }
    }).body;

    expect(body).toContain('History became unavailable.');
    expect(body).toContain('Retry');
    expect(body).toContain('Back to workspace');
  });
});
