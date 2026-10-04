import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import HistoryMode from './HistoryMode.svelte';
import type { HistoryModeState } from './historyModeMachine';

// SSR inspects output only; interactions belong to mounted History specs.
const noop = () => {};
const callbacks = {
  onExit: noop, onSelectRevision: noop, onPreviewRestore: noop,
  onCancelRestore: noop, onConfirmRestore: noop, onNameRevision: noop,
  onRemoveRevisionName: noop, onClearHistory: noop, onCheckHealth: noop,
  onLoadMore: noop, onRetry: noop
};

const openState: Extract<HistoryModeState, { phase: 'open' }> = {
  phase: 'open',
  target: {
    noteId: 'note-1',
    noteTitle: 'Timeline note',
    notePath: '/vault/Timeline note.md'
  },
  workspace: {
    activePaneId: 'notepad-pane-1',
    focusTarget: 'editor',
    editor: {
      noteId: 'note-1',
      viewState: { anchor: 18, head: 7, scrollTop: 640 }
    }
  },
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
      timeKind: 'observed',
      modifiedAtMillis: 1_700,
      revisionLabel: null,
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
  selectedComparison: 'current',
  selectedDiff: {
    revisionId: 'revision-2',
    comparison: 'current',
    fromRevisionId: 'revision-2',
    toRevisionId: null,
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
  diagnostics: {
    note: {
      noteId: 'note-1',
      state: 'healthy',
      revisionCount: 2,
      lifecycleEventCount: 1,
      revisionPayloadBytes: 512
    },
    storage: { allocatedBytes: 4096, reclaimableBytes: 1024 }
  },
  request: null,
  error: null
};

describe('HistoryMode', () => {
  it('renders revisions and lifecycle events as a global read-only surface', () => {
    const body = render(HistoryMode, {
      props: {
        state: openState,
        ...callbacks
      }
    }).body;

    expect(body).toContain('History Mode');
    expect(body).toContain('Read only');
    expect(body).toContain('Timeline note');
    expect(body).toContain('External edit');
    expect(body.match(/data-revision-id=/gu)).toHaveLength(2);
    expect(body).not.toContain('Editing Session');
    expect(body).toContain('2 lines');
    expect(body).not.toContain('31 characters');
    expect(body).toContain('Renamed Old.md to Timeline note.md');
    expect(body).toContain('# Historical body');
    expect(body).toContain('project: atlas');
    expect(body).toContain('Note history healthy');
    expect(body).toContain('512 bytes retained revision content');
    expect(body).toContain('4,096 bytes allocated');
    expect(body).toContain('1,024 bytes reclaimable');
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
        ...callbacks
      }
    }).body;

    expect(body).toContain('History became unavailable.');
    expect(body).toContain('Retry');
    expect(body).toContain('Back to workspace');
  });


});

it('renders one selectable named window with its interval and combined net diff beside a point revision', () => {
  const revision = openState.records[0];
  if (revision.kind !== 'revision') throw new Error('fixture');
  const window = {
    ...revision, source: 'editor' as const, timeKind: 'editingWindow' as const,
    timeEvidence: { kind: 'editingWindow' as const, version: 1 as const,
      firstWallMillis: 1_000, lastWallMillis: 120_000, minWallMillis: 1_000, maxWallMillis: 120_000, clockDiscontinuity: false },
    modifiedAtMillis: null
  };
  const body = render(HistoryMode, { props: {
    state: { ...openState, records: [window, ...openState.records.slice(1)] },
    ...callbacks
  }}).body;
  expect(body.match(/data-revision-id="revision-2"/gu)).toHaveLength(1);
  expect(body).toContain('Edited');
  expect(body).not.toContain('Editing Window');
  expect(body).not.toContain('Individual revisions');
  expect(body).not.toContain('Editing Session');
  expect(body).toContain('Release candidate');
  expect(body).toContain('2 lines added · 0 lines removed');
  expect(body).toContain('Changes since this version');
  expect(body).not.toContain('File timestamp Jan');
});
