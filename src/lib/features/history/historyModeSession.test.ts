import { describe, expect, it, vi } from 'vitest';
import { HistoryModeSession } from './historyModeSession.svelte';
import type {
  HistoricalRevision,
  HistoryModePage,
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
  focusTarget: 'editor'
};
const firstPage: HistoryModePage = {
  records: [
    {
      kind: 'revision',
      recordId: 'revision-1',
      revisionId: 'revision-1',
      source: 'editor',
      occurredAtMillis: 10,
      timeKind: 'committed',
      modifiedAtMillis: null
    }
  ],
  nextCursor: null
};
const revision: HistoricalRevision = {
  revisionId: 'revision-1',
  body: 'saved body',
  unmanagedFrontmatter: null
};

function setup(overrides: Partial<ConstructorParameters<typeof HistoryModeSession>[0]> = {}) {
  const deps: ConstructorParameters<typeof HistoryModeSession>[0] = {
    flushWorkspace: vi.fn().mockResolvedValue(undefined),
    captureWorkspace: vi.fn(() => workspace),
    readTarget: vi.fn(() => target),
    restoreWorkspace: vi.fn(),
    restoreFocus: vi.fn(),
    loadPage: vi.fn().mockResolvedValue(firstPage),
    loadRevision: vi.fn().mockResolvedValue(revision),
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
      selectedRevision: revision
    });
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

  it('restores the captured workspace and focus on exit', async () => {
    const phases: string[] = [];
    let session!: HistoryModeSession;
    const restoreWorkspace = vi.fn(() => {
      phases.push(session.state.phase);
    });
    const restoreFocus = vi.fn(() => {
      phases.push(session.state.phase);
    });
    ({ session } = setup({ restoreWorkspace, restoreFocus }));
    await session.enter('notepad-pane-1');

    await session.exit();

    expect(restoreWorkspace).toHaveBeenCalledWith(workspace);
    expect(restoreFocus).toHaveBeenCalledWith(workspace);
    expect(phases).toEqual(['exiting', 'restoring']);
    expect(session.state).toEqual({ phase: 'inactive', entryError: null });
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
          timeKind: 'observed',
          modifiedAtMillis: null
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
      selectedRevision: revision
    });
  });

  it('runs a refresh requested while a revision selection is still loading', async () => {
    let resolveSelection!: (revision: HistoricalRevision) => void;
    const selection = new Promise<HistoricalRevision>((resolve) => {
      resolveSelection = resolve;
    });
    const secondRevision: HistoricalRevision = {
      revisionId: 'revision-2',
      body: 'older body',
      unmanagedFrontmatter: null
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
          timeKind: 'committed',
          modifiedAtMillis: null
        }
      ],
      nextCursor: null
    };
    const loadPage = vi.fn().mockResolvedValue(selectablePage);
    const loadRevision = vi
      .fn()
      .mockResolvedValueOnce(revision)
      .mockReturnValueOnce(selection);
    const { session } = setup({ loadPage, loadRevision });
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
      selectedRevision: secondRevision
    });
  });
});
