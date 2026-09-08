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
  it.each([
    ['collapsed cursor', { anchor: 6, head: 6, scrollTop: 0 }],
    ['forward selection', { anchor: 2, head: 12, scrollTop: 320 }],
    ['reversed selection', { anchor: 14, head: 4, scrollTop: 640 }]
  ])('keeps the captured %s opaque and unchanged', (_label, viewState) => {
    const state: Extract<HistoryModeState, { phase: 'open' }> = {
      ...openState,
      workspace: {
        ...openState.workspace,
        editor: { noteId: 'note-1', viewState }
      }
    };

    const body = render(HistoryMode, {
      props: {
        state,
        onExit: vi.fn(),
        onSelectRevision: vi.fn(),
        onPreviewRestore: vi.fn(),
        onCancelRestore: vi.fn(),
        onConfirmRestore: vi.fn(),
        onNameRevision: vi.fn(),
        onRemoveRevisionName: vi.fn(),
        onClearHistory: vi.fn(),
        onCheckHealth: vi.fn(),
        onLoadMore: vi.fn(),
        onRetry: vi.fn()
      }
    }).body;

    expect(body).toContain('Read only');
    expect(state.workspace.editor?.viewState).toEqual(viewState);
  });

  it('renders revisions and lifecycle events as a global read-only surface', () => {
    const entryViewState = openState.workspace.editor?.viewState;
    const body = render(HistoryMode, {
      props: {
        state: openState,
        onExit: vi.fn(),
        onSelectRevision: vi.fn(),
        onPreviewRestore: vi.fn(),
        onCancelRestore: vi.fn(),
        onConfirmRestore: vi.fn(),
        onNameRevision: vi.fn(),
        onRemoveRevisionName: vi.fn(),
        onClearHistory: vi.fn(),
        onCheckHealth: vi.fn(),
        onLoadMore: vi.fn(),
        onRetry: vi.fn()
      }
    }).body;

    expect(body).toContain('History Mode');
    expect(body).toContain('Read only');
    expect(body).toContain('Timeline note');
    expect(body).toContain('External edit');
    expect(body.match(/data-revision-id=/gu)).toHaveLength(2);
    expect(body).toContain('2 lines');
    expect(body).not.toContain('31 characters');
    expect(body).toContain('Renamed Old.md to Timeline note.md');
    expect(body).toContain('# Historical body');
    expect(body).toContain('project: atlas');
    expect(body).not.toContain('Previous revision');
    expect(body).not.toContain('Current note');
    expect(body).toContain('Preview complete replacement');
    expect(body).not.toContain('Restore complete revision');
    expect(body).toContain('Release candidate');
    expect(body).not.toContain('aria-label="Revision name"');
    expect(body).toContain('aria-label="Rename revision"');
    expect(body).toContain('Clear note history');
    expect(body).toContain('new Baseline Revision');
    expect(body).toContain('This cannot be undone.');
    expect(body).toContain('Note history healthy');
    expect(body).toContain('512 bytes retained revision content');
    expect(body).toContain('4,096 bytes allocated');
    expect(body).toContain('1,024 bytes reclaimable');
    expect(body).toContain('Load older history');
    expect(body).not.toContain('contenteditable');
    expect(body).not.toContain('<textarea');
    expect(openState.workspace.editor?.viewState).toBe(entryViewState);
  });

  it('renders every retained revision directly selectable', () => {
    const body = render(HistoryMode, {
      props: {
        state: openState,
        onExit: vi.fn(),
        onSelectRevision: vi.fn(),
        onPreviewRestore: vi.fn(),
        onCancelRestore: vi.fn(),
        onConfirmRestore: vi.fn(),
        onNameRevision: vi.fn(),
        onRemoveRevisionName: vi.fn(),
        onClearHistory: vi.fn(),
        onCheckHealth: vi.fn(),
        onLoadMore: vi.fn(),
        onRetry: vi.fn()
      }
    }).body;

    expect(body).not.toContain('Editing Session');
    expect(body.match(/data-revision-id=/gu)).toHaveLength(2);
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
        onPreviewRestore: vi.fn(),
        onCancelRestore: vi.fn(),
        onConfirmRestore: vi.fn(),
        onNameRevision: vi.fn(),
        onRemoveRevisionName: vi.fn(),
        onClearHistory: vi.fn(),
        onCheckHealth: vi.fn(),
        onLoadMore: vi.fn(),
        onRetry: vi.fn()
      }
    }).body;

    expect(body).toContain('History became unavailable.');
    expect(body).toContain('Retry');
    expect(body).toContain('Back to workspace');
  });

  it('renders a complete replacement preview with explicit confirmation', () => {
    const state: HistoryModeState = {
      ...openState,
      restorePreview: {
            revisionId: 'revision-2',
            currentAuthoredContentHash: 'current-hash',
            unmanagedFrontmatter: 'project: atlas',
            body: '# Historical body\n\nComplete replacement'
          }
    };
    const body = render(HistoryMode, {
      props: {
        state,
        onExit: vi.fn(),
        onSelectRevision: vi.fn(),
        onPreviewRestore: vi.fn(),
        onCancelRestore: vi.fn(),
        onConfirmRestore: vi.fn(),
        onNameRevision: vi.fn(),
        onRemoveRevisionName: vi.fn(),
        onClearHistory: vi.fn(),
        onCheckHealth: vi.fn(),
        onLoadMore: vi.fn(),
        onRetry: vi.fn()
      }
    }).body;

    expect(body).toContain('Complete replacement preview');
    expect(body).toContain('project: atlas');
    expect(body).toContain('# Historical body');
    expect(body).toContain('Confirm Version Restore');
    expect(body).toContain('Cancel');
    expect(body).not.toContain('<textarea');
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
    onExit: vi.fn(), onSelectRevision: vi.fn(), onPreviewRestore: vi.fn(),
    onCancelRestore: vi.fn(), onConfirmRestore: vi.fn(), onNameRevision: vi.fn(), onRemoveRevisionName: vi.fn(),
    onClearHistory: vi.fn(), onCheckHealth: vi.fn(), onLoadMore: vi.fn(), onRetry: vi.fn()
  }}).body;
  expect(body.match(/data-revision-id="revision-2"/gu)).toHaveLength(1);
  expect(body).toContain('Editing Window · Editor');
  expect(body).toContain('Saved');
  expect(body).not.toContain('Individual revisions');
  expect(body).not.toContain('Editing Session');
  expect(body).toContain('Release candidate');
  expect(body).toContain('2 lines added · 0 lines removed');
  expect(body).toContain('Compared with previous revision');
  expect(body).not.toContain('File timestamp Jan');
});


it('renders both adjacent context directions around an old citation', () => {
  const body = render(HistoryMode, { props: {
    state: { ...openState, previousCursor: 'newer', target: { ...openState.target, citationRevisionId: 'revision-2' } },
    onExit: vi.fn(), onSelectRevision: vi.fn(), onPreviewRestore: vi.fn(), onCancelRestore: vi.fn(), onConfirmRestore: vi.fn(),
    onNameRevision: vi.fn(), onRemoveRevisionName: vi.fn(), onClearHistory: vi.fn(), onCheckHealth: vi.fn(), onLoadMore: vi.fn(), onLoadNewer: vi.fn(), onRetry: vi.fn()
  }}).body;
  expect(body).toContain('Load newer history');
  expect(body).toContain('Load older history');
  expect(body).toContain('data-history-record-count="3"');
});
