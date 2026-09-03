import {
  createInactiveHistoryModeState,
  transitionHistoryMode,
  type HistoricalDiff,
  type HistoryDiffComparison,
  type HistoryModeDiagnostics,
  type HistoryModePage,
  type HistoryModeState,
  type HistoryModeTarget,
  type HistoryRestoreCommit,
  type HistoryRestorePreview,
  type HistoryWorkspaceSnapshot
} from './historyModeMachine';
import type { NoteSession } from '$lib/features/notepad/model/types';

export interface HistoryModeSessionDeps {
  flushWorkspace: () => Promise<void>;
  captureWorkspace: (paneId: string) => HistoryWorkspaceSnapshot;
  readTarget: (paneId: string) => HistoryModeTarget | null;
  restoreWorkspace: (snapshot: HistoryWorkspaceSnapshot) => void | Promise<void>;
  restoreEditorState: (snapshot: HistoryWorkspaceSnapshot) => void | Promise<void>;
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
  loadRestorePreview: (
    noteId: string,
    revisionId: string
  ) => Promise<HistoryRestorePreview>;
  restoreRevision: (
    noteId: string,
    revisionId: string,
    expectedCurrentAuthoredContentHash: string
  ) => Promise<HistoryRestoreCommit>;
  adoptRestoredRevision: (restored: NoteSession) => Promise<void>;
  nameRevision: (noteId: string, revisionId: string, label: string) => Promise<void>;
  removeRevisionName: (noteId: string, revisionId: string) => Promise<void>;
  clearNoteHistory: (noteId: string) => Promise<void>;
  loadDiagnostics: (noteId: string) => Promise<HistoryModeDiagnostics>;
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

  #restoreAfterFailedEntry = async (workspace: HistoryWorkspaceSnapshot) => {
    const restoreSteps = [
      this.#deps.restoreWorkspace,
      this.#deps.restoreEditorState,
      this.#deps.restoreFocus
    ];
    for (const restore of restoreSteps) {
      try {
        await restore(workspace);
      } catch {
        // Preserve the actionable entry error while attempting every recovery step.
      }
    }
  };

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
      await this.#restoreAfterFailedEntry(workspace);
      return;
    }

    const target = this.#deps.readTarget(paneId);
    if (!target) {
      this.#dispatch({
        type: 'entryFailed',
        requestId,
        error: 'History Mode could not identify the saved note.'
      });
      await this.#restoreAfterFailedEntry(workspace);
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
      const diagnosticsPromise = this.#deps.loadDiagnostics(target.noteId).catch(() => null);
      const page = await this.#deps.loadPage(target.noteId, null);
      const newestRevision = page.records.find(
        (record) => record.kind === 'revision'
      );
      const selectedDiff = newestRevision
        ? await this.#deps.loadDiff(target.noteId, newestRevision.revisionId, 'parent')
        : null;
      const diagnostics = await diagnosticsPromise;
      this.#dispatch({
        type: 'entryLoaded',
        requestId,
        target,
        page,
        selectedDiff,
        diagnostics
      });
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
        await this.#restoreAfterFailedEntry(workspace);
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

  previewRestore = async (): Promise<void> => {
    if (
      this.state.phase !== 'open' ||
      this.state.request !== null ||
      this.state.selectedRevisionId === null
    ) {
      return;
    }
    const requestId = this.#nextRequestId++;
    const noteId = this.state.target.noteId;
    const revisionId = this.state.selectedRevisionId;
    this.#dispatch({ type: 'restorePreviewStarted', requestId });
    try {
      const preview = await this.#deps.loadRestorePreview(noteId, revisionId);
      this.#dispatch({ type: 'restorePreviewLoaded', requestId, preview });
    } catch (error) {
      this.#dispatch({
        type: 'restoreFailed',
        requestId,
        error: `Version Restore preview could not be created: ${errorMessage(error)}`
      });
    }
    await this.#runPendingRefresh();
  };

  cancelRestore = (): void => {
    this.#dispatch({ type: 'restoreCancelled' });
  };

  confirmRestore = async (): Promise<void> => {
    if (
      this.state.phase !== 'open' ||
      this.state.request !== null ||
      !this.state.restorePreview
    ) {
      return;
    }
    const requestId = this.#nextRequestId++;
    const noteId = this.state.target.noteId;
    const preview = this.state.restorePreview;
    this.#dispatch({ type: 'restoreCommitStarted', requestId });
    let restored: HistoryRestoreCommit;
    try {
      restored = await this.#deps.restoreRevision(
        noteId,
        preview.revisionId,
        preview.currentAuthoredContentHash
      );
    } catch (error) {
      this.#dispatch({
        type: 'restoreFailed',
        requestId,
        error: `Version Restore was not committed: ${errorMessage(error)}`
      });
      await this.#runPendingRefresh();
      return;
    }

    try {
      await this.#deps.adoptRestoredRevision(restored.session);
    } catch (error) {
      this.#dispatch({
        type: 'historyUnavailable',
        error: `Version Restore committed, but the workspace could not adopt it: ${errorMessage(error)}`
      });
      return;
    }

    try {
      const diagnosticsPromise = this.#deps.loadDiagnostics(noteId).catch(() => null);
      const page = await this.#deps.loadPage(noteId, null);
      const restoredRevision = page.records.find(
        (record) =>
          record.kind === 'revision' && record.revisionId === restored.revisionId
      );
      if (!restoredRevision || restoredRevision.kind !== 'revision') {
        throw new Error('The new Version Restore revision is unavailable.');
      }
      const selectedDiff = await this.#deps.loadDiff(
        noteId,
        restoredRevision.revisionId,
        'parent'
      );
      const diagnostics = await diagnosticsPromise;
      this.#dispatch({
        type: 'restoreCommitted',
        requestId,
        page,
        selectedDiff,
        diagnostics
      });
    } catch (error) {
      this.#dispatch({
        type: 'historyUnavailable',
        error: `Version Restore committed, but its new revision could not be displayed: ${errorMessage(error)}`
      });
    }
    await this.#runPendingRefresh();
  };

  #refreshAfterRevisionNameChange = async (
    revisionId: string,
    label: string | null,
    action: (noteId: string, revisionId: string) => Promise<void>
  ): Promise<void> => {
    if (this.state.phase !== 'open' || this.state.request !== null) return;
    const requestId = this.#nextRequestId++;
    const noteId = this.state.target.noteId;
    this.#dispatch({ type: 'refreshStarted', requestId });
    try {
      try {
        await action(noteId, revisionId);
        this.#dispatch({ type: 'revisionNameChanged', requestId, revisionId, label });
      } catch (error) {
        this.#dispatch({
          type: 'pageFailed',
          requestId,
          error: `That revision name could not be saved: ${errorMessage(error)}`
        });
      }
    } finally {
      await this.#runPendingRefresh();
    }
  };

  nameRevision = async (revisionId: string, label: string): Promise<void> => {
    await this.#refreshAfterRevisionNameChange(revisionId, label.trim(), (noteId, selectedRevisionId) =>
      this.#deps.nameRevision(noteId, selectedRevisionId, label)
    );
  };

  removeRevisionName = async (revisionId: string): Promise<void> => {
    await this.#refreshAfterRevisionNameChange(
      revisionId,
      null,
      this.#deps.removeRevisionName
    );
  };

  clearHistory = async (): Promise<void> => {
    if (this.state.phase !== 'open' || this.state.request !== null) return;
    const requestId = this.#nextRequestId++;
    const noteId = this.state.target.noteId;
    this.#dispatch({ type: 'refreshStarted', requestId });
    try {
      try {
        await this.#deps.clearNoteHistory(noteId);
      } catch (error) {
        this.#dispatch({
          type: 'pageFailed',
          requestId,
          error: `Note history could not be cleared: ${errorMessage(error)}`
        });
        return;
      }
      try {
        const diagnosticsPromise = this.#deps.loadDiagnostics(noteId).catch(() => null);
        const page = await this.#deps.loadPage(noteId, null);
        const baseline = page.records.find((record) => record.kind === 'revision');
        if (!baseline || baseline.kind !== 'revision') {
          throw new Error('The new Baseline Revision is unavailable.');
        }
        const selectedDiff = await this.#deps.loadDiff(noteId, baseline.revisionId, 'parent');
        const diagnostics = await diagnosticsPromise;
        this.#dispatch({ type: 'historyReplaced', requestId, page, selectedDiff, diagnostics });
      } catch (error) {
        this.#dispatch({
          type: 'historyUnavailable',
          error: `Note history was cleared, but the new Baseline Revision could not be displayed: ${errorMessage(error)}`
        });
      }
    } finally {
      await this.#runPendingRefresh();
    }
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
    let editorRestoreError: unknown = null;
    try {
      await this.#deps.restoreEditorState(workspace);
    } catch (error) {
      editorRestoreError = error;
    }
    try {
      await this.#deps.restoreFocus(workspace);
    } catch (error) {
      this.#dispatch({
        type: 'exitCompleted',
        error: `The workspace was restored, but focus could not be restored: ${errorMessage(error)}`
      });
      return;
    }
    if (editorRestoreError) {
      this.#dispatch({
        type: 'exitCompleted',
        error: `The workspace was restored, but the editor state could not be restored: ${errorMessage(editorRestoreError)}`
      });
      return;
    }
    this.#dispatch({ type: 'exitCompleted' });
  };

  dismissEntryError = () => {
    this.#dispatch({ type: 'dismissEntryError' });
  };
}
