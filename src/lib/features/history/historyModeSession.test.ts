import { describe, expect, it, vi } from 'vitest';
import { HistoryModeSession } from './historyModeSession.svelte';
import type {
  HistoricalDiff,
  HistoryRestorePreview,
  HistoryModePage,
  HistoryRevisionRecord,
  HistoryModeTarget,
  HistoryWorkspaceSnapshot
} from './historyModeMachine';

const target: HistoryModeTarget = {
  noteId: 'note-1',
  noteTitle: 'A note',
  notePath: '/vault/A note.md'
};
const workspace: HistoryWorkspaceSnapshot = {
  activePaneId: 'notepad-pane-1',
  focusTarget: 'editor',
  editor: {
    noteId: 'note-1',
    viewState: { anchor: 18, head: 7, scrollTop: 640 }
  }
};
const firstPage: HistoryModePage = {
  records: [
    {
      kind: 'revision',
      recordId: 'revision-1',
      revisionId: 'revision-1',
      source: 'editor',
      occurredAtMillis: 10,
      timelineOrdinal: 1,
      timeKind: 'committed',
      modifiedAtMillis: null,
      editingSessionId: 'revision-1',
      revisionLabel: null,
      lineCount: 1,
      characterCount: 10
    }
  ],
  nextCursor: null
};
const revisionDiff: HistoricalDiff = {
  revisionId: 'revision-1',
  comparison: 'parent',
  fromRevisionId: null,
  toRevisionId: 'revision-1',
  bodyLines: [
    {
      kind: 'added',
      text: 'saved body',
      oldLineNumber: null,
      newLineNumber: 1
    }
  ],
  propertiesLines: [],
  missingAssets: []
};

const restorePreview: HistoryRestorePreview = {
  revisionId: 'revision-1',
  currentAuthoredContentHash: 'current-hash',
  unmanagedFrontmatter: 'project: atlas',
  body: 'saved body'
};
const restoredNote = {
  noteId: 'note-1',
  title: 'A note',
  markdown: 'saved body',
  path: '/vault/A note.md'
};
const restoreCommit = {
  revisionId: 'revision-restored',
  session: restoredNote
};

function setup(overrides: Partial<ConstructorParameters<typeof HistoryModeSession>[0]> = {}) {
  const deps: ConstructorParameters<typeof HistoryModeSession>[0] = {
    flushWorkspace: vi.fn().mockResolvedValue(undefined),
    captureWorkspace: vi.fn(() => workspace),
    readTarget: vi.fn(() => target),
    restoreWorkspace: vi.fn(),
    restoreEditorState: vi.fn(),
    restoreFocus: vi.fn(),
    loadPage: vi.fn().mockResolvedValue(firstPage),
    loadDiff: vi.fn().mockResolvedValue(revisionDiff),
    loadRestorePreview: vi.fn().mockResolvedValue(restorePreview),
    restoreRevision: vi.fn().mockResolvedValue(restoreCommit),
    adoptRestoredRevision: vi.fn().mockResolvedValue(undefined),
    nameRevision: vi.fn().mockResolvedValue(undefined),
    removeRevisionName: vi.fn().mockResolvedValue(undefined),
    clearNoteHistory: vi.fn().mockResolvedValue(undefined),
    loadDiagnostics: vi.fn().mockResolvedValue({
      note: {
        noteId: 'note-1',
        state: 'healthy',
        revisionCount: 1,
        lifecycleEventCount: 0,
        revisionPayloadBytes: 10
      },
      storage: { allocatedBytes: 4096, reclaimableBytes: 0 }
    }),
    ...overrides
  };
  return { session: new HistoryModeSession(deps), deps };
}

describe('HistoryModeSession', () => {
  it('crosses the save barrier before requesting role-limited history', async () => {
    const callOrder: string[] = [];
    const { session } = setup({
      flushWorkspace: vi.fn(async () => {
        callOrder.push('flush');
      }),
      loadPage: vi.fn(async () => {
        callOrder.push('history');
        return firstPage;
      })
    });

    await session.enter('notepad-pane-1');

    expect(callOrder).toEqual(['flush', 'history']);
    expect(session.state).toMatchObject({
      phase: 'open',
      selectedRevisionId: 'revision-1',
      selectedComparison: 'parent',
      selectedDiff: revisionDiff
    });
  });

  it('names, edits, and removes the selected revision without changing its identity', async () => {
    const { session, deps } = setup();
    await session.enter('notepad-pane-1');

    await session.nameRevision('revision-1', 'Milestone');
    expect(deps.nameRevision).toHaveBeenCalledWith('note-1', 'revision-1', 'Milestone');
    expect(session.state).toMatchObject({
      phase: 'open',
      selectedRevisionId: 'revision-1',
      records: [{ revisionId: 'revision-1', revisionLabel: 'Milestone' }]
    });

    await session.removeRevisionName('revision-1');
    expect(deps.removeRevisionName).toHaveBeenCalledWith('note-1', 'revision-1');
    expect(session.state).toMatchObject({
      phase: 'open',
      selectedRevisionId: 'revision-1',
      records: [{ revisionId: 'revision-1', revisionLabel: null }]
    });
  });

  it('previews and explicitly confirms a complete Version Restore before refreshing history', async () => {
    const restoredRevision: HistoryRevisionRecord = {
      ...(firstPage.records[0] as HistoryRevisionRecord),
      recordId: 'revision-restored',
      revisionId: 'revision-restored',
      source: 'versionRestore',
      occurredAtMillis: 20,
      timelineOrdinal: 2,
      editingSessionId: null
    };
    const restoredPage = { records: [restoredRevision, ...firstPage.records], nextCursor: null };
    const restoredDiff = {
      ...revisionDiff,
      revisionId: 'revision-restored',
      fromRevisionId: 'revision-1',
      toRevisionId: 'revision-restored'
    };
    const loadPage = vi.fn().mockResolvedValueOnce(firstPage).mockResolvedValueOnce(restoredPage);
    const loadDiff = vi.fn().mockResolvedValueOnce(revisionDiff).mockResolvedValueOnce(restoredDiff);
    const { session, deps } = setup({ loadPage, loadDiff });
    await session.enter('notepad-pane-1');

    await session.previewRestore();
    expect(deps.loadRestorePreview).toHaveBeenCalledWith('note-1', 'revision-1');
    expect(session.state).toMatchObject({ phase: 'open', restorePreview });
    expect(deps.restoreRevision).not.toHaveBeenCalled();

    await session.confirmRestore();

    expect(deps.restoreRevision).toHaveBeenCalledWith(
      'note-1',
      'revision-1',
      'current-hash'
    );
    expect(deps.adoptRestoredRevision).toHaveBeenCalledWith(restoredNote);
    expect(session.state).toMatchObject({
      phase: 'open',
      selectedRevisionId: 'revision-restored',
      selectedDiff: restoredDiff,
      restorePreview: null
    });
  });

  it('invalidates a stale restore preview after current authored content changes', async () => {
    const { session, deps } = setup({
      restoreRevision: vi.fn().mockRejectedValue(
        new Error('Current authored content changed after this restore preview was created')
      )
    });
    await session.enter('notepad-pane-1');
    await session.previewRestore();

    await session.confirmRestore();

    expect(deps.loadPage).toHaveBeenCalledTimes(1);
    expect(session.state).toMatchObject({
      phase: 'open',
      restorePreview: null,
      error: 'Version Restore was not committed: Current authored content changed after this restore preview was created'
    });
  });

  it('reports editor adoption failure as post-commit without retrying the restore', async () => {
    const { session, deps } = setup({
      adoptRestoredRevision: vi.fn().mockRejectedValue(new Error('editor unavailable'))
    });
    await session.enter('notepad-pane-1');
    await session.previewRestore();

    await session.confirmRestore();

    expect(deps.restoreRevision).toHaveBeenCalledOnce();
    expect(session.state).toMatchObject({
      phase: 'historyUnavailable',
      error: 'Version Restore committed, but the workspace could not adopt it: editor unavailable'
    });
  });

  it('does not misidentify an older Version Restore when the exact committed revision is unavailable', async () => {
    const olderRestore: HistoryRevisionRecord = {
      ...(firstPage.records[0] as HistoryRevisionRecord),
      recordId: 'revision-restored-older',
      revisionId: 'revision-restored-older',
      source: 'versionRestore',
      occurredAtMillis: 15,
      timelineOrdinal: 2,
      editingSessionId: null
    };
    const loadPage = vi
      .fn()
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce({ records: [olderRestore, ...firstPage.records], nextCursor: null });
    const { session, deps } = setup({ loadPage });
    await session.enter('notepad-pane-1');
    await session.previewRestore();

    await session.confirmRestore();

    expect(deps.adoptRestoredRevision).toHaveBeenCalledWith(restoredNote);
    expect(deps.loadDiff).toHaveBeenCalledTimes(1);
    expect(session.state).toMatchObject({
      phase: 'historyUnavailable',
      error: 'Version Restore committed, but its new revision could not be displayed: The new Version Restore revision is unavailable.'
    });
  });

  it('replaces cleared history with the new truthful baseline', async () => {
    const baselinePage: HistoryModePage = {
      records: [
        {
          ...(firstPage.records[0] as HistoryRevisionRecord),
          recordId: 'baseline-after-clear',
          revisionId: 'baseline-after-clear',
          source: 'baselineInitialization',
          timeKind: 'knownSince',
          revisionLabel: null
        }
      ],
      nextCursor: null
    };
    const baselineDiff: HistoricalDiff = {
      ...revisionDiff,
      revisionId: 'baseline-after-clear',
      toRevisionId: 'baseline-after-clear'
    };
    const loadPage = vi.fn().mockResolvedValueOnce(firstPage).mockResolvedValueOnce(baselinePage);
    const loadDiff = vi.fn().mockResolvedValueOnce(revisionDiff).mockResolvedValueOnce(baselineDiff);
    const { session, deps } = setup({ loadPage, loadDiff });
    await session.enter('notepad-pane-1');

    await session.clearHistory();

    expect(deps.clearNoteHistory).toHaveBeenCalledWith('note-1');
    expect(session.state).toMatchObject({
      phase: 'open',
      selectedRevisionId: 'baseline-after-clear',
      selectedDiff: baselineDiff,
      records: [{ revisionId: 'baseline-after-clear' }]
    });
  });

  it('keeps an older loaded revision pinned while changing its name', async () => {
    const olderRevision: HistoryRevisionRecord = {
      ...(firstPage.records[0] as HistoryRevisionRecord),
      recordId: 'revision-older',
      revisionId: 'revision-older',
      timelineOrdinal: 0
    };
    const { session, deps } = setup({
      loadPage: vi.fn().mockResolvedValue({
        records: [...firstPage.records, olderRevision],
        nextCursor: 'revision-older'
      }),
      loadDiff: vi.fn().mockImplementation(async (_noteId, revisionId) => ({
        ...revisionDiff,
        revisionId,
        toRevisionId: revisionId
      }))
    });
    await session.enter('notepad-pane-1');
    await session.selectRevision('revision-older');

    await session.nameRevision('revision-older', 'Milestone');

    expect(session.state).toMatchObject({
      phase: 'open',
      selectedRevisionId: 'revision-older',
      records: [
        { revisionId: 'revision-1' },
        { revisionId: 'revision-older', revisionLabel: 'Milestone' }
      ]
    });
    expect(deps.loadPage).toHaveBeenCalledTimes(1);
  });

  it('drains a refresh queued during a revision name write', async () => {
    let finishName!: () => void;
    const nameRevision = vi.fn(
      () => new Promise<void>((resolve) => (finishName = resolve))
    );
    const loadPage = vi.fn().mockResolvedValue(firstPage);
    const { session } = setup({ nameRevision, loadPage });
    await session.enter('notepad-pane-1');

    const naming = session.nameRevision('revision-1', 'Milestone');
    await session.refresh();
    expect(loadPage).toHaveBeenCalledTimes(1);

    finishName();
    await naming;

    expect(loadPage).toHaveBeenCalledTimes(2);
    expect(session.state).toMatchObject({ phase: 'open', selectedRevisionId: 'revision-1' });
  });

  it('reports a committed clear honestly when only the new baseline refresh fails', async () => {
    const loadPage = vi.fn().mockResolvedValueOnce(firstPage).mockRejectedValueOnce(new Error('offline'));
    const { session } = setup({ loadPage });
    await session.enter('notepad-pane-1');

    await session.clearHistory();

    expect(session.state).toMatchObject({
      phase: 'historyUnavailable',
      error: 'Note history was cleared, but the new Baseline Revision could not be displayed: offline'
    });
    expect('records' in session.state).toBe(false);
  });

  it('leaves the workspace active and reports a clear error when saving fails', async () => {
    const restoreWorkspace = vi.fn();
    const loadPage = vi.fn();
    const { session } = setup({
      flushWorkspace: vi.fn().mockRejectedValue(new Error('disk full')),
      restoreWorkspace,
      loadPage
    });

    await session.enter('notepad-pane-1');

    expect(session.state).toEqual({
      phase: 'inactive',
      entryError: 'History Mode could not open because the latest changes were not saved: disk full'
    });
    expect(loadPage).not.toHaveBeenCalled();
    expect(restoreWorkspace).toHaveBeenCalledWith(workspace);
  });

  it('contains failed-entry recovery errors and still attempts focus restoration', async () => {
    const restoreWorkspace = vi.fn().mockRejectedValue(new Error('pane unavailable'));
    const restoreEditorState = vi.fn().mockRejectedValue(new Error('editor unavailable'));
    const restoreFocus = vi.fn();
    const { session } = setup({
      flushWorkspace: vi.fn().mockRejectedValue(new Error('disk full')),
      restoreWorkspace,
      restoreEditorState,
      restoreFocus
    });

    await expect(session.enter('notepad-pane-1')).resolves.toBeUndefined();

    expect(restoreWorkspace).toHaveBeenCalledWith(workspace);
    expect(restoreEditorState).toHaveBeenCalledWith(workspace);
    expect(restoreFocus).toHaveBeenCalledWith(workspace);
    expect(session.state).toEqual({
      phase: 'inactive',
      entryError: 'History Mode could not open because the latest changes were not saved: disk full'
    });
  });

  it('restores the captured workspace and focus on exit', async () => {
    const phases: string[] = [];
    let session!: HistoryModeSession;
    const restoreWorkspace = vi.fn(() => {
      phases.push(session.state.phase);
    });
    const restoreEditorState = vi.fn(() => {
      phases.push(session.state.phase);
    });
    const restoreFocus = vi.fn(() => {
      phases.push(session.state.phase);
    });
    ({ session } = setup({ restoreWorkspace, restoreEditorState, restoreFocus }));
    await session.enter('notepad-pane-1');

    await session.exit();

    expect(restoreWorkspace).toHaveBeenCalledWith(workspace);
    expect(restoreEditorState).toHaveBeenCalledWith(workspace);
    expect(restoreFocus).toHaveBeenCalledWith(workspace);
    expect(phases).toEqual(['exiting', 'restoring', 'restoring']);
    expect(session.state).toEqual({ phase: 'inactive', entryError: null });
  });

  it('still restores focus and reports an editor-state restore failure precisely', async () => {
    const restoreEditorState = vi.fn().mockRejectedValue(new Error('editor unavailable'));
    const restoreFocus = vi.fn();
    const { session } = setup({ restoreEditorState, restoreFocus });
    await session.enter('notepad-pane-1');

    await session.exit();

    expect(restoreFocus).toHaveBeenCalledWith(workspace);
    expect(session.state).toEqual({
      phase: 'inactive',
      entryError: 'The workspace was restored, but the editor state could not be restored: editor unavailable'
    });
  });

  it('keeps the entry editor snapshot unchanged while history refreshes', async () => {
    const renamedTarget = {
      ...target,
      noteTitle: 'Renamed note',
      notePath: '/vault/Renamed note.md'
    };
    const readTarget = vi
      .fn()
      .mockReturnValueOnce(target)
      .mockReturnValueOnce(target)
      .mockReturnValue(renamedTarget);
    const { session } = setup({ readTarget });
    await session.enter('notepad-pane-1');

    await session.refresh();
    await session.nameRevision('revision-1', 'Milestone');
    await session.synchronizeAfterLifecycleChange();

    expect(session.state).toMatchObject({
      phase: 'open',
      target: renamedTarget,
      workspace
    });
  });

  it('retries unavailable history without recapturing or replacing the original focus', async () => {
    const captureWorkspace = vi.fn(() => workspace);
    const flushWorkspace = vi.fn().mockResolvedValue(undefined);
    const loadPage = vi
      .fn()
      .mockResolvedValueOnce(firstPage)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(firstPage);
    const { session } = setup({ captureWorkspace, flushWorkspace, loadPage });
    await session.enter('notepad-pane-1');
    await session.refresh();
    expect(session.state.phase).toBe('historyUnavailable');
    await session.retry();

    expect(captureWorkspace).toHaveBeenCalledTimes(1);
    expect(flushWorkspace).toHaveBeenCalledTimes(1);
    expect(session.state).toMatchObject({ phase: 'open', workspace });
  });

  it('transitions the target explicitly after normal external synchronization', async () => {
    const renamedTarget = {
      ...target,
      noteTitle: 'Renamed note',
      notePath: '/vault/Renamed note.md'
    };
    const readTarget = vi
      .fn()
      .mockReturnValueOnce(target)
      .mockReturnValueOnce(target)
      .mockReturnValueOnce(renamedTarget);
    const loadPage = vi.fn().mockResolvedValue(firstPage);
    const { session } = setup({ readTarget, loadPage });
    await session.enter('notepad-pane-1');

    await session.synchronizeAfterLifecycleChange();

    expect(session.state).toMatchObject({
      phase: 'open',
      target: renamedTarget
    });
    expect(loadPage).toHaveBeenCalledTimes(2);
  });

  it('refreshes record headers while keeping the selected revision body pinned', async () => {
    const newestPage: HistoryModePage = {
      records: [
        {
          kind: 'revision',
          recordId: 'revision-2',
          revisionId: 'revision-2',
          source: 'externalEdit',
          occurredAtMillis: 20,
          timelineOrdinal: 2,
          timeKind: 'observed',
          modifiedAtMillis: null,
          editingSessionId: 'revision-2',
          revisionLabel: null,
          lineCount: 2,
          characterCount: 20
        },
        ...firstPage.records
      ],
      nextCursor: null
    };
    const loadPage = vi
      .fn()
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce(newestPage);
    const { session } = setup({ loadPage });
    await session.enter('notepad-pane-1');

    await session.refresh();

    expect(session.state).toMatchObject({
      phase: 'open',
      selectedRevisionId: 'revision-1',
      selectedDiff: revisionDiff
    });
  });

  it('runs a refresh requested while a revision selection is still loading', async () => {
    let resolveSelection!: (revision: HistoricalDiff) => void;
    const selection = new Promise<HistoricalDiff>((resolve) => {
      resolveSelection = resolve;
    });
    const secondRevision: HistoricalDiff = {
      revisionId: 'revision-2',
      comparison: 'parent',
      fromRevisionId: null,
      toRevisionId: 'revision-2',
      bodyLines: [],
      propertiesLines: [],
      missingAssets: []
    };
    const selectablePage: HistoryModePage = {
      records: [
        ...firstPage.records,
        {
          kind: 'revision',
          recordId: 'revision-2',
          revisionId: 'revision-2',
          source: 'editor',
          occurredAtMillis: 5,
          timelineOrdinal: 0,
          timeKind: 'committed',
          modifiedAtMillis: null,
          editingSessionId: 'revision-2',
          revisionLabel: null,
          lineCount: 1,
          characterCount: 10
        }
      ],
      nextCursor: null
    };
    const loadPage = vi.fn().mockResolvedValue(selectablePage);
    const loadDiff = vi
      .fn()
      .mockResolvedValueOnce(revisionDiff)
      .mockReturnValueOnce(selection);
    const { session } = setup({ loadPage, loadDiff });
    await session.enter('notepad-pane-1');

    const selecting = session.selectRevision('revision-2');
    await session.refresh();
    expect(loadPage).toHaveBeenCalledTimes(1);

    resolveSelection(secondRevision);
    await selecting;

    expect(loadPage).toHaveBeenCalledTimes(2);
    expect(session.state).toMatchObject({
      phase: 'open',
      selectedRevisionId: 'revision-2',
      selectedDiff: secondRevision
    });
  });

  it('switches between parent and current comparisons without changing the pinned revision', async () => {
    const currentDiff: HistoricalDiff = {
      ...revisionDiff,
      comparison: 'current',
      fromRevisionId: 'revision-1',
      toRevisionId: 'revision-3'
    };
    const loadDiff = vi
      .fn()
      .mockResolvedValueOnce(revisionDiff)
      .mockResolvedValueOnce(currentDiff);
    const { session } = setup({ loadDiff });
    await session.enter('notepad-pane-1');

    await session.setComparison('current');

    expect(loadDiff).toHaveBeenLastCalledWith('note-1', 'revision-1', 'current');
    expect(session.state).toMatchObject({
      phase: 'open',
      selectedRevisionId: 'revision-1',
      selectedComparison: 'current',
      selectedDiff: currentDiff
    });
  });

  it('does not substitute an adjacent revision when the selected diff fails integrity checks', async () => {
    const loadDiff = vi
      .fn()
      .mockResolvedValueOnce(revisionDiff)
      .mockRejectedValueOnce(new Error('selected revision hash mismatch'));
    const { session } = setup({ loadDiff });
    await session.enter('notepad-pane-1');

    await session.setComparison('current');

    expect(session.state).toMatchObject({
      phase: 'open',
      selectedRevisionId: 'revision-1',
      selectedComparison: 'current',
      selectedDiff: null,
      error: 'That revision diff could not be opened: selected revision hash mismatch'
    });
  });

  it('keeps the selected revision pinned while refreshing its current comparison', async () => {
    const currentDiff: HistoricalDiff = {
      ...revisionDiff,
      comparison: 'current',
      fromRevisionId: 'revision-1',
      toRevisionId: 'revision-2'
    };
    const refreshedCurrentDiff: HistoricalDiff = {
      ...currentDiff,
      toRevisionId: 'revision-3'
    };
    const newestPage: HistoryModePage = {
      records: [
        {
          ...(firstPage.records[0] as HistoryRevisionRecord),
          recordId: 'revision-3',
          revisionId: 'revision-3',
          timelineOrdinal: 3
        },
        ...firstPage.records
      ],
      nextCursor: null
    };
    const loadPage = vi
      .fn()
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce(newestPage);
    const loadDiff = vi
      .fn()
      .mockResolvedValueOnce(revisionDiff)
      .mockResolvedValueOnce(currentDiff)
      .mockResolvedValueOnce(refreshedCurrentDiff);
    const { session } = setup({ loadPage, loadDiff });
    await session.enter('notepad-pane-1');
    await session.setComparison('current');

    await session.refresh();

    expect(session.state).toMatchObject({
      phase: 'open',
      selectedRevisionId: 'revision-1',
      selectedComparison: 'current',
      selectedDiff: refreshedCurrentDiff
    });
  });
});
