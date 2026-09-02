import {
  createInactiveHistoryModeState,
  transitionHistoryMode,
  type HistoricalRevision,
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
  loadPage: (
    noteId: string,
    cursor: string | null
  ) => Promise<HistoryModePage>;
  loadRevision: (
    noteId: string,
    revisionId: string
  ) => Promise<HistoricalRevision>;
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
    return this.state.phase !== 'inactive';
  }

  #dispatch(event: Parameters<typeof transitionHistoryMode>[1]) {
    this.state = transitionHistoryMode(this.state, event);
  }

  enter = async (paneId: string): Promise<void> => {
    if (this.state.phase !== 'inactive') return;
    const workspace = this.#deps.captureWorkspace(paneId);
    const initialTarget = this.#deps.readTarget(paneId);
    if (!initialTarget) {
      this.state = {
        phase: 'inactive',
        entryError: 'History Mode is available after this note has been saved.'
      };
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
      return;
    }

    try {
      const page = await this.#deps.loadPage(target.noteId, null);
      const newestRevision = page.records.find(
        (record) => record.kind === 'revision'
      );
      const selectedRevision = newestRevision
        ? await this.#deps.loadRevision(target.noteId, newestRevision.revisionId)
        : null;
      this.#dispatch({ type: 'entryLoaded', requestId, target, page, selectedRevision });
      if (page.records.length === 0) {
        this.#dispatch({
          type: 'noteUnavailable',
          error: 'No retained history is available for this note.'
        });
      }
    } catch (error) {
      this.#dispatch({
        type: 'entryFailed',
        requestId,
        error: `History Mode is unavailable: ${errorMessage(error)}`
      });
      await this.#deps.restoreWorkspace(workspace);
    }
  };

  selectRevision = async (revisionId: string): Promise<void> => {
    if (
      this.state.phase !== 'open' ||
      this.state.request !== null ||
      this.state.selectedRevisionId === revisionId
    ) {
      return;
    }
    const requestId = this.#nextRequestId++;
    const noteId = this.state.target.noteId;
    this.#dispatch({ type: 'selectionStarted', requestId, revisionId });
    try {
      const revision = await this.#deps.loadRevision(noteId, revisionId);
      this.#dispatch({ type: 'selectionLoaded', requestId, revision });
    } catch (error) {
      this.#dispatch({
        type: 'selectionFailed',
        requestId,
        error: `That revision could not be opened: ${errorMessage(error)}`
      });
    }
    await this.#runPendingRefresh();
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
      const page = await this.#deps.loadPage(noteId, null);
      if (page.records.length === 0) {
        this.#dispatch({
          type: 'noteUnavailable',
          error: 'This note no longer has readable history.'
        });
        return;
      }
      this.#dispatch({ type: 'refreshLoaded', requestId, page });
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
      const paneId = this.state.workspace.activePaneId;
      this.state = createInactiveHistoryModeState();
      await this.enter(paneId);
      return;
    }
    await this.refresh();
  };

  exit = async (): Promise<void> => {
    if (this.state.phase === 'inactive' || this.state.phase === 'exiting') return;
    const workspace = this.state.workspace;
    this.#refreshPending = false;
    this.#dispatch({ type: 'exitStarted' });
    this.#dispatch({ type: 'exitCompleted' });
    await this.#deps.restoreWorkspace(workspace);
  };

  dismissEntryError = () => {
    this.#dispatch({ type: 'dismissEntryError' });
  };
}
