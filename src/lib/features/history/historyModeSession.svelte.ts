import {
  createInactiveHistoryModeState,
  transitionHistoryMode,
  type HistoricalDiff,
  type HistoryDiffComparison,
  type HistoryModePage,
  type HistoryModeState,
  type HistoryModeTarget,
  type HistoryWorkspaceSnapshot
} from './historyModeMachine';

export interface HistoryModeSessionDeps {
  flushWorkspace: () => Promise<void>;
  captureWorkspace: (paneId: string) => HistoryWorkspaceSnapshot;
  readTarget: (paneId: string) => HistoryModeTarget | null;
  restoreWorkspace: (snapshot: HistoryWorkspaceSnapshot) => void | Promise<void>;
  restoreFocus: (snapshot: HistoryWorkspaceSnapshot) => void | Promise<void>;
  loadPage: (
    noteId: string,
    cursor: string | null
  ) => Promise<HistoryModePage>;
  loadDiff: (
    noteId: string,
    revisionId: string,
    comparison: HistoryDiffComparison
  ) => Promise<HistoricalDiff>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class HistoryModeSession {
  state = $state<HistoryModeState>(createInactiveHistoryModeState());
  #deps: HistoryModeSessionDeps;
  #nextRequestId = 1;
  #refreshPending = false;

  constructor(deps: HistoryModeSessionDeps) {
    this.#deps = deps;
  }

  get isActive(): boolean {
    return this.state.phase !== 'inactive' && this.state.phase !== 'restoring';
  }

  #dispatch(event: Parameters<typeof transitionHistoryMode>[1]) {
    this.state = transitionHistoryMode(this.state, event);
  }

  enter = async (paneId: string): Promise<void> => {
    if (this.state.phase !== 'inactive') return;
    const workspace = this.#deps.captureWorkspace(paneId);
    const initialTarget = this.#deps.readTarget(paneId);
    if (!initialTarget) {
      this.#dispatch({
        type: 'entryRejected',
        error: 'History Mode is available after this note has been saved.'
      });
      return;
    }
    const requestId = this.#nextRequestId++;
    this.#dispatch({
      type: 'entryStarted',
      requestId,
      target: initialTarget,
      workspace
    });

    try {
      await this.#deps.flushWorkspace();
    } catch (error) {
      this.#dispatch({
        type: 'entryFailed',
        requestId,
        error: `History Mode could not open because the latest changes were not saved: ${errorMessage(error)}`
      });
      await this.#deps.restoreWorkspace(workspace);
      await this.#deps.restoreFocus(workspace);
      return;
    }

    const target = this.#deps.readTarget(paneId);
    if (!target) {
      this.#dispatch({
        type: 'entryFailed',
        requestId,
        error: 'History Mode could not identify the saved note.'
      });
      await this.#deps.restoreWorkspace(workspace);
      await this.#deps.restoreFocus(workspace);
      return;
    }

    await this.#loadEntry(requestId, target, 'entry', workspace);
  };

  #loadEntry = async (
    requestId: number,
    target: HistoryModeTarget,
    origin: 'entry' | 'retry',
    workspace: HistoryWorkspaceSnapshot
  ): Promise<void> => {
    try {
      const page = await this.#deps.loadPage(target.noteId, null);
      const newestRevision = page.records.find(
        (record) => record.kind === 'revision'
      );
      const selectedDiff = newestRevision
        ? await this.#deps.loadDiff(target.noteId, newestRevision.revisionId, 'parent')
        : null;
      this.#dispatch({ type: 'entryLoaded', requestId, target, page, selectedDiff });
      if (page.records.length === 0) {
        this.#dispatch({
          type: 'noteUnavailable',
          error: 'No retained history is available for this note.'
        });
      }
    } catch (error) {
      this.#dispatch({
        type: origin === 'entry' ? 'entryFailed' : 'retryFailed',
        requestId,
        error: `History Mode is unavailable: ${errorMessage(error)}`
      });
      if (origin === 'entry' && workspace) {
        await this.#deps.restoreWorkspace(workspace);
        await this.#deps.restoreFocus(workspace);
      }
    }
  };

  #loadSelectedDiff = async (
    revisionId: string,
    comparison: HistoryDiffComparison
  ): Promise<void> => {
    if (this.state.phase !== 'open') return;
    const requestId = this.#nextRequestId++;
    const noteId = this.state.target.noteId;
    this.#dispatch({ type: 'diffStarted', requestId, revisionId, comparison });
    try {
      const diff = await this.#deps.loadDiff(noteId, revisionId, comparison);
      this.#dispatch({ type: 'diffLoaded', requestId, diff });
    } catch (error) {
      this.#dispatch({
        type: 'diffFailed',
        requestId,
        error: `That revision diff could not be opened: ${errorMessage(error)}`
      });
    }
    await this.#runPendingRefresh();
  };

  selectRevision = async (revisionId: string): Promise<void> => {
    if (
      this.state.phase !== 'open' ||
      this.state.request !== null ||
      this.state.selectedRevisionId === revisionId
    ) {
      return;
    }
    await this.#loadSelectedDiff(revisionId, 'parent');
  };

  setComparison = async (comparison: HistoryDiffComparison): Promise<void> => {
    if (
      this.state.phase !== 'open' ||
      this.state.request !== null ||
      this.state.selectedRevisionId === null ||
      this.state.selectedComparison === comparison
    ) {
      return;
    }
    const revisionId = this.state.selectedRevisionId;
    await this.#loadSelectedDiff(revisionId, comparison);
  };

  loadMore = async (): Promise<void> => {
    if (
      this.state.phase !== 'open' ||
      this.state.request !== null ||
      this.state.nextCursor === null
    ) {
      return;
    }
    const requestId = this.#nextRequestId++;
    const { noteId } = this.state.target;
    const cursor = this.state.nextCursor;
    this.#dispatch({ type: 'pageStarted', requestId });
    try {
      const page = await this.#deps.loadPage(noteId, cursor);
      this.#dispatch({ type: 'pageLoaded', requestId, page });
    } catch (error) {
      this.#dispatch({
        type: 'pageFailed',
        requestId,
        error: `Older history could not be loaded: ${errorMessage(error)}`
      });
    }
    await this.#runPendingRefresh();
  };

  refresh = async (): Promise<void> => {
    if (this.state.phase !== 'open') return;
    if (this.state.request !== null) {
      this.#refreshPending = true;
      return;
    }
    const requestId = this.#nextRequestId++;
    const { noteId } = this.state.target;
    this.#dispatch({ type: 'refreshStarted', requestId });
    try {
      const pagePromise = this.#deps.loadPage(noteId, null);
      const diffPromise =
        this.state.selectedComparison === 'current' && this.state.selectedRevisionId
          ? this.#deps.loadDiff(noteId, this.state.selectedRevisionId, 'current')
          : null;
      const [page, selectedDiff] = await Promise.all([
        pagePromise,
        diffPromise ?? Promise.resolve(undefined)
      ]);
      if (page.records.length === 0) {
        this.#dispatch({
          type: 'noteUnavailable',
          error: 'This note no longer has readable history.'
        });
        return;
      }
      this.#dispatch({ type: 'refreshLoaded', requestId, page, selectedDiff });
    } catch (error) {
      this.#dispatch({
        type: 'historyUnavailable',
        error: `History became unavailable: ${errorMessage(error)}`
      });
    }
    await this.#runPendingRefresh();
  };

  #runPendingRefresh = async (): Promise<void> => {
    if (!this.#refreshPending) return;
    this.#refreshPending = false;
    await this.refresh();
  };

  retry = async (): Promise<void> => {
    if (
      this.state.phase === 'historyUnavailable' ||
      this.state.phase === 'noteUnavailable'
    ) {
      const target = this.#deps.readTarget(this.state.workspace.activePaneId);
      if (!target || target.noteId !== this.state.target.noteId) {
        this.#dispatch({
          type: 'noteUnavailable',
          error: 'This note is no longer available in the workspace.'
        });
        return;
      }
      const requestId = this.#nextRequestId++;
      const workspace = this.state.workspace;
      this.#dispatch({ type: 'retryStarted', requestId, target });
      await this.#loadEntry(requestId, target, 'retry', workspace);
      return;
    }
    await this.refresh();
  };

  synchronizeAfterLifecycleChange = async (): Promise<void> => {
    if (
      this.state.phase !== 'open' &&
      this.state.phase !== 'historyUnavailable' &&
      this.state.phase !== 'noteUnavailable'
    ) {
      return;
    }
    const target = this.#deps.readTarget(this.state.workspace.activePaneId);
    if (!target || target.noteId !== this.state.target.noteId) {
      this.#dispatch({
        type: 'noteUnavailable',
        error: 'This note changed lifecycle state while History Mode was open.'
      });
      return;
    }
    this.#dispatch({ type: 'lifecycleChanged', target });
    if (this.state.phase === 'open') await this.refresh();
  };

  exit = async (): Promise<void> => {
    if (
      this.state.phase === 'inactive' ||
      this.state.phase === 'exiting' ||
      this.state.phase === 'restoring'
    ) {
      return;
    }
    const workspace = this.state.workspace;
    this.#refreshPending = false;
    this.#dispatch({ type: 'exitStarted' });
    try {
      await this.#deps.restoreWorkspace(workspace);
    } catch (error) {
      this.#dispatch({
        type: 'exitRestoreFailed',
        error: `History Mode closed, but the workspace could not be restored: ${errorMessage(error)}`
      });
      return;
    }
    this.#dispatch({ type: 'workspaceRestored' });
    try {
      await this.#deps.restoreFocus(workspace);
      this.#dispatch({ type: 'exitCompleted' });
    } catch (error) {
      this.#dispatch({
        type: 'exitCompleted',
        error: `The workspace was restored, but focus could not be restored: ${errorMessage(error)}`
      });
    }
  };

  dismissEntryError = () => {
    this.#dispatch({ type: 'dismissEntryError' });
  };
}
