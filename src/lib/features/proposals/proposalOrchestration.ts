import { checkpointProposalReview, awaitProposalCheckpoints } from './reviewCheckpoints';
import { observeProposalTitle } from './observeProposalTitle.svelte';
import type { EditorCapabilityAdapter } from '$lib/features/notepad/editor/editorCapabilities';
import type { NoteDraftState } from '$lib/features/notepad/state/noteStore';
import { documentRegistry } from '$lib/features/notepad/document/documentRegistry';
import { proposalReviewSession, type ProposalReviewSession } from './reviewSession.svelte';
import type {
  DurableProposalReviewRequest,
  ProposalReviewRuntime
} from './types';
import type { CommitNoteReviewResult } from '$lib/types/proposals';
import type { ProposalReviewIdentity } from './proposalReviewMachine';
import {
  documentHasCleanBuffer, getDocumentPath, updateDocumentTitle
} from '$lib/features/notepad/document/documentState';

function proposalErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'string' && error.trim()) return error;
  if (error instanceof Error && error.message.trim()) return error.message;
  if (error && typeof error === 'object') {
    const record = error as { message?: unknown; error?: unknown };
    if (typeof record.message === 'string' && record.message.trim()) {
      return record.message;
    }
    if (typeof record.error === 'string' && record.error.trim()) {
      return record.error;
    }
  }
  return fallback;
}

export interface ProposalOrchestrationDeps {
  getEditorPaneDocument: (path?: string | null) => NoteDraftState | null;
  getEditorForDocument: (document: NoteDraftState) => EditorCapabilityAdapter | null;
  onReviewMarkdownChange: (document: NoteDraftState, markdown: string) => void;
  finishReviewDocument: (document: NoteDraftState) => Promise<void>;
  presentReviewDocument: (target: {
    document: NoteDraftState | null;
    noteId: string | null;
    path: string;
    creation?: boolean;
  }) => Promise<NoteDraftState | null>;
  acknowledgeDocumentCommit: (commit: {
    document: NoteDraftState;
    path: string;
    markdown: string;
    submittedTitle?: string;
    committedMarkdown: string;
    commitWarning: NonNullable<CommitNoteReviewResult['commitWarning']> | null;
  }) => void | Promise<void>;
  reloadReviewDocument: (document: NoteDraftState) => Promise<void>;
  session?: ProposalReviewSession;
}

export type { DurableProposalReviewRequest } from './types';

export function createProposalOrchestration(deps: ProposalOrchestrationDeps) {
  const session = deps.session ?? proposalReviewSession;
  let disposed = false;
  let stopTitleObserver: (() => void) | null = null;
  let durableLoadQueue: Promise<void> = Promise.resolve();

  function identityFor(
    request: DurableProposalReviewRequest
  ): ProposalReviewIdentity {
    return {
      reviewId: request.preview.reviewId,
      proposalId: request.proposalId,
      notePath: request.preview.notePath
    };
  }

  function currentReview(): ProposalReviewRuntime | null {
    const state = session.workflow;
    return state.kind === 'idle' ? null : state.review;
  }

  function reviewIsCurrent(review: ProposalReviewRuntime) {
    return !disposed && currentReview() === review;
  }

  function reviewIsResolving(review: ProposalReviewRuntime) {
    const state = session.workflow;
    return (
      currentReview() === review &&
      (state.kind === 'committing' ||
        state.kind === 'dismissing')
    );
  }

  function setReviewError(
    review: ProposalReviewRuntime,
    error: string | null
  ) {
    session.dispatchWorkflow({
      type: 'errorSet',
      reviewId: review.request.preview.reviewId,
      error
    });
  }

  function cancelDiscardConfirmation(
    review: ProposalReviewRuntime
  ) {
    session.dispatchWorkflow({
      type: 'discardCancelled',
      reviewId: review.request.preview.reviewId
    });
  }

  function root(review: ProposalReviewRuntime) {
    const runtime = documentRegistry.get(review.document.handle)?.resources()?.runtime;
    if (!runtime) throw new Error('The proposal document runtime is unavailable.');
    return runtime;
  }

  function checkpoint(review: ProposalReviewRuntime, requestedPath?: string): Promise<void> {
    if (!review.request.checkpoint) return Promise.resolve();
    return checkpointProposalReview(review, {
      markdown: root(review).markdown,
      title: review.document.working.title,
      path: review.request.preview.notePath,
      requestedPath,
      decisions: hunks(review).map(hunk => ({ ...hunk }))
    });
  }
  function flushCheckpoint() {
    const review = currentReview();
    return review ? checkpoint(review) : Promise.resolve();
  }
  function restoreSavedBase(review: ProposalReviewRuntime) {
    root(review).replaceMarkdown(review.request.checkpoint
      ? review.document.savedBaseline?.content.markdown ?? ''
      : review.request.preview.baseEditorMarkdown);
    if (review.request.checkpoint) updateDocumentTitle(review.document,
      review.document.savedBaseline?.content.title ?? '');
  }
  function clearCreation(review: ProposalReviewRuntime) {
    if (review.request.kind !== 'create') return;
    root(review).replaceMarkdown('');
    updateDocumentTitle(review.document, '');
  }

  async function closeReview(review: ProposalReviewRuntime) {
    if (currentReview() !== review) return;
    stopTitleObserver?.();
    stopTitleObserver = null;
    root(review).endReview(review.request.preview.reviewId);
    session.dispatchWorkflow({
      type: 'completionSucceeded',
      reviewId: review.request.preview.reviewId
    });
    try {
      await deps.finishReviewDocument(review.document);
    } catch (error) {
      // The durable proposal is already resolved. Report the separate save
      // failure without offering to replay that completed durable action.
      session.dispatchWorkflow({
        type: 'errorSet', reviewId: null,
        error: `Review finished, but remaining edits in “${review.request.preview.title}” could not be saved. Your edits are still available in the note. ${proposalErrorMessage(error, 'Please try saving again.')}`
      });
    }
  }

  async function releaseReplacedReview(review: ProposalReviewRuntime) {
    stopTitleObserver?.();
    stopTitleObserver = null;
    const runtime = documentRegistry.get(review.document.handle)?.resources()?.runtime;
    if (runtime?.review?.reviewId === review.request.preview.reviewId) {
      restoreSavedBase(review);
      runtime.endReview(review.request.preview.reviewId);
    }
    await deps.finishReviewDocument(review.document);
  }

  function hunks(review: ProposalReviewRuntime) {
    const state = root(review).review;
    if (state?.reviewId !== review.request.preview.reviewId) {
      throw new Error('The proposal document review is unavailable.');
    }
    return state.hunks;
  }

  function unresolved() {
    const review = currentReview();
    return review ? hunks(review).filter((hunk) => hunk.status === 'pending' || hunk.status === 'modified').length : 0;
  }

  let resolutionCompletion: Promise<void> | null = null;
  let resolvingReview: ProposalReviewRuntime | null = null;
  function finishIfResolved(): Promise<void> {
    if (resolutionCompletion && currentReview() === resolvingReview) return resolutionCompletion;
    if (!currentReview() || unresolved() > 0) return Promise.resolve();
    resolvingReview = currentReview();
    const completion = finishResolution().finally(() => {
      if (resolutionCompletion === completion) resolutionCompletion = null;
    });
    resolutionCompletion = completion;
    return completion;
  }

  async function finishResolution() {
    const review = currentReview();
    if (!review || unresolved() > 0 || reviewIsResolving(review)) {
      return;
    }
    const resolution = hunks(review).some(
      (hunk) => hunk.status === 'kept'
    )
      ? 'commit'
      : 'dismiss';
    const resolutionReviewId = review.request.preview.reviewId;
    const started = session.dispatchWorkflow({
      type: 'resolutionRequested',
      reviewId: resolutionReviewId,
      resolution
    });
    if (!started) return;

    try {
      if (resolution === 'dismiss') {
        await dismissReview(review);
        return;
      }
      const markdown = root(review).markdown;
      const submittedTitle = review.document.working.title;
      const submittedDecisions = JSON.stringify(hunks(review));
      if (review.request.checkpoint) await checkpoint(review);
      const result = await review.request.commit(markdown);
      if (currentReview() !== review) return;
      if (result.status === 'conflict') {
        const refreshed = await review.request.refresh?.();
        if (currentReview() !== review) return;
        if (refreshed && refreshed.proposalId !== review.request.proposalId) {
          throw new Error('The refreshed review belongs to another proposal.');
        }
        if (refreshed && (refreshed.preview.baseContentHash !== review.request.preview.baseContentHash ||
          refreshed.preview.notePath !== review.request.preview.notePath)) {
          if (root(review).markdown !== markdown || review.document.working.title !== submittedTitle ||
            JSON.stringify(hunks(review)) !== submittedDecisions) {
            // A refreshed durable checkpoint cannot acknowledge later typing.
            // Retain the live owner and require explicit conflict recovery.
            session.dispatchWorkflow({type:'completionConflicted',reviewId:resolutionReviewId,
              error:`${result.message ?? 'Note changed on disk.'} Newer edits are retained in this review. Copy your working text or reload the note before reviewing the changed base.`});
            return;
          }
          const previousRequest = review.request;
          const previousWorking = { markdown: root(review).markdown, title: review.document.working.title,
            decisions: hunks(review).map(hunk => ({...hunk})) };
          stopTitleObserver?.();
          try {
            if (refreshed.kind === 'create') {
              root(review).endReview(previousRequest.preview.reviewId);
              root(review).replaceMarkdown('');
              updateDocumentTitle(review.document, refreshed.working?.title ?? refreshed.preview.title);
            } else await deps.reloadReviewDocument(review.document);
            // Keep the old hunk owner during the asynchronous disk read. Its
            // revision guard can reject without rolling back later typing.
            root(review).endReview(previousRequest.preview.reviewId);
            review.request = refreshed;
            root(review).beginReview(refreshed.preview, reviewCallbacks(review), refreshed.working);
            if (refreshed.working) updateDocumentTitle(review.document, refreshed.working.title);
          } catch (error) {
            review.request = previousRequest;
            if (root(review).review?.reviewId !== previousRequest.preview.reviewId) {
              root(review).replaceMarkdown(previousRequest.preview.baseEditorMarkdown);
              root(review).beginReview(previousRequest.preview, reviewCallbacks(review), previousWorking);
              updateDocumentTitle(review.document, previousWorking.title);
            }
            session.dispatchWorkflow({type:'completionConflicted',reviewId:resolutionReviewId,
              error:proposalErrorMessage(error,'Unable to reload the changed review target.')});
            return;
          } finally {
            bindCheckpointEffects(review);
          }
        }
        session.dispatchWorkflow({
          type: 'completionConflicted',
          // Settle the admitted operation before adopting its new preview ID.
          reviewId: resolutionReviewId,
          refreshedIdentity: identityFor(review.request),
          error: result.message ?? 'Note changed on disk.'
        });
        return;
      }
      await deps.acknowledgeDocumentCommit({
        document: review.document,
        path: result.applied?.path ?? review.request.preview.notePath,
        markdown,
        submittedTitle,
        committedMarkdown: result.committedMarkdown,
        commitWarning: result.commitWarning ?? null
      });
      await closeReview(review);
    } catch (error) {
      session.dispatchWorkflow({
        type: 'completionFailed',
        reviewId: review.request.preview.reviewId,
        error: proposalErrorMessage(
          error,
          resolution === 'commit'
            ? 'Unable to commit reviewed note.'
            : 'Unable to dismiss this proposal.'
        )
      });
    }
  }

  function keepHunk(reviewId: string, hunkId: string) {
    const review = currentReview();
    if (disposed || !review || review.request.preview.reviewId !== reviewId || reviewIsResolving(review)) return;
    cancelDiscardConfirmation(review);
    root(review).resolveReview(reviewId, [hunkId], 'kept');
    return finishIfResolved();
  }

  function undoHunk(reviewId: string, hunkId: string) {
    const review = currentReview();
    if (disposed || !review || review.request.preview.reviewId !== reviewId || reviewIsResolving(review)) return;
    const hunk = hunks(review).find((item) => item.id === hunkId);
    if (!hunk) return;
    cancelDiscardConfirmation(review);
    const runtime = root(review);
    if (hunk.status === 'pending' && runtime.markdown.slice(hunk.from, hunk.to) !== hunk.newText) {
      setReviewError(review, 'This proposed hunk changed; choose Keep Current or Restore Original.');
      return;
    }
    runtime.resolveReview(reviewId, [hunkId], 'undone', {
      from: hunk.from, to: hunk.to, insert: hunk.oldText
    });
    return finishIfResolved();
  }

  function reviewCallbacks(review: ProposalReviewRuntime) {
    return {
      onKeep: keepHunk,
      onUndo: undoHunk,
      onMarkdownChange: (markdown: string) => deps.onReviewMarkdownChange(review.document, markdown),
      onChange: () => {
        if (!reviewIsCurrent(review)) return;
        session.notifyReviewRuntimeChanged();
        if (session.workflow.kind === 'reviewing') void checkpoint(review).catch(error => setReviewError(review, proposalErrorMessage(error, 'Unable to save review draft.')));
        if (session.workflow.kind === 'reviewing') void finishIfResolved();
      }
    };
  }

  function bindCheckpointEffects(review: ProposalReviewRuntime) {
    stopTitleObserver?.();
    stopTitleObserver = null;
    if (!review.request.checkpoint) return;
    stopTitleObserver = observeProposalTitle(review.document, () => {
      if (reviewIsCurrent(review) && !reviewIsResolving(review)) void checkpoint(review).catch(error => setReviewError(review, proposalErrorMessage(error, 'Unable to save review draft.')));
    });
    if (review.request.kind === 'create') review.request.changeLocation = async path => {
      await checkpoint(review, path);
      session.notifyReviewRuntimeChanged();
    };
  }

  async function start(
    request: DurableProposalReviewRequest,
    document: NoteDraftState
  ) {
    if (disposed) return false;
    const preview = request.preview;
    const identity = identityFor(request);
    if (
      session.workflow.kind !== 'opening' ||
      session.workflow.identity.reviewId !== identity.reviewId
    ) {
      return false;
    }
    if (
      !documentHasCleanBuffer(document)
    ) {
      session.dispatchWorkflow({
        type: 'openFailed',
        identity,
        error: 'Save current edits before reviewing a proposal.'
      });
      return false;
    }
    const review: ProposalReviewRuntime = { request, document };
    if (
      !session.dispatchWorkflow({
        type: 'openPrepared',
        identity,
        review
      })
    ) {
      return false;
    }
    try {
      if (request.working && request.checkpoint) root(review).replaceMarkdown(preview.baseEditorMarkdown);
      if (request.working || request.kind === 'create') updateDocumentTitle(document, request.working?.title ?? preview.title);
      root(review).beginReview(preview, reviewCallbacks(review), request.working);
      session.dispatchWorkflow({ type: 'openSucceeded', identity, recovery: request.recovery });
      bindCheckpointEffects(review);
      return true;
    } catch (error) {
      await releaseReplacedReview(review);
      session.dispatchWorkflow({
        type: 'openFailed',
        identity,
        error: proposalErrorMessage(
          error,
          'Unable to open proposal review.'
        )
      });
      return false;
    }
  }

  async function beginOpening(request: DurableProposalReviewRequest) {
    if (disposed) return false;
    const current = currentReview();
    if (current && !current.request.checkpoint && (
      root(current).markdown !== current.request.preview.proposedEditorMarkdown ||
      hunks(current).some(hunk => hunk.status !== 'pending') ||
      session.workflow.kind === 'conflicted' || session.workflow.kind === 'confirmingDiscard'
    )) {
      setReviewError(current, 'Finish the current review before opening another proposal; it contains edits or review decisions.');
      return false;
    }
    if (current) {
      try { await checkpoint(current); }
      catch (error) {
        setReviewError(current, proposalErrorMessage(error, 'Unable to save review draft.'));
        return false;
      }
    }
    const identity = identityFor(request);
    if (
      !session.dispatchWorkflow({
        type: 'openRequested',
        identity
      })
    ) {
      return false;
    }
    if (current) await releaseReplacedReview(current);
    return true;
  }

  function failOpening(
    request: DurableProposalReviewRequest,
    error: string
  ) {
    session.dispatchWorkflow({
      type: 'openFailed',
      identity: identityFor(request),
      error
    });
  }

  async function loadDurableProposalNow(
    request: DurableProposalReviewRequest
  ): Promise<boolean> {
    if (disposed) return false;
    const current = currentReview();
    if (current?.request.proposalId === request.proposalId) {
      if (request.draftVersion !== undefined && request.draftVersion !== current.request.draftVersion) {
        const previous = current.request.working;
        if (root(current).markdown !== (previous?.markdown ?? current.request.preview.proposedEditorMarkdown) ||
          current.document.working.title !== (previous?.title ?? current.request.preview.title)) {
          setReviewError(current, 'This review has newer local edits. Save them before reopening the updated draft.');
          return false;
        }
        const document = current.document;
        const identity = identityFor(request);
        if (!session.dispatchWorkflow({ type: 'openRequested', identity })) return false;
        stopTitleObserver?.();
        root(current).endReview(current.request.preview.reviewId);
        root(current).replaceMarkdown(request.preview.baseEditorMarkdown);
        updateDocumentTitle(document, document.savedBaseline?.content.title ?? '');
        const started = await start(request, document);
        if (started) await reviewNext();
        return started;
      }
      await reviewNext();
      return true;
    }
    try {
      if (!await beginOpening(request)) return false;
      const document = await deps.presentReviewDocument({
        document: deps.getEditorPaneDocument(request.preview.notePath),
        noteId: request.noteId,
        path: request.preview.notePath, creation: request.kind === 'create'
      });
      if (
        !document ||
        (request.kind !== 'create' && getDocumentPath(document) !== request.preview.notePath)
      ) {
        failOpening(
          request,
          'The target note could not be opened for proposal review.'
        );
        return false;
      }
      const editor = deps.getEditorForDocument(document);
      if (!editor?.isReady()) {
        failOpening(
          request,
          'Editor is not ready for proposal review.'
        );
        return false;
      }
      const started = await start(request, document);
      const review = currentReview();
      if (started && review) focusNext(review, editor);
      return started;
    } catch (error) {
      failOpening(
        request,
        proposalErrorMessage(
          error,
          'Could not open the proposal in the editor.'
        )
      );
      return false;
    }
  }

  async function loadDurableProposalIfOpenNow(
    request: DurableProposalReviewRequest
  ): Promise<boolean> {
    if (disposed) return false;
    if (currentReview()?.request.proposalId === request.proposalId) {
      return true;
    }

    const document = deps.getEditorPaneDocument(
      request.preview.notePath
    );
    if (
      !document ||
      getDocumentPath(document) !== request.preview.notePath ||
      !documentHasCleanBuffer(document)
    ) {
      return false;
    }
    const editor = deps.getEditorForDocument(document);
    if (!editor?.isReady()) return false;
    if (!await beginOpening(request)) return false;

    // Passive display is intentionally limited to an editor that already
    // exists. It must not ensure, open, activate, or focus a pane.
    return start(request, document);
  }

  function enqueueDurableLoad(
    load: () => Promise<boolean>
  ): Promise<boolean> {
    const task = durableLoadQueue.then(load, load);
    durableLoadQueue = task.then(
      () => undefined,
      () => undefined
    );
    return task;
  }

  function loadDurableProposal(
    request: DurableProposalReviewRequest
  ): Promise<boolean> {
    return enqueueDurableLoad(
      () => loadDurableProposalNow(request)
    );
  }

  function loadDurableProposalIfOpen(
    request: DurableProposalReviewRequest
  ): Promise<boolean> {
    return enqueueDurableLoad(
      () => loadDurableProposalIfOpenNow(request)
    );
  }

  function keepAll() {
    const review = currentReview();
    if (disposed || !review || reviewIsResolving(review)) return;
    cancelDiscardConfirmation(review);
    const ids = hunks(review).filter((hunk) => hunk.status === 'pending' || hunk.status === 'modified').map((hunk) => hunk.id);
    root(review).resolveReview(review.request.preview.reviewId, ids, 'kept');
    return finishIfResolved();
  }

  async function dismissReview(review: ProposalReviewRuntime, restoreBase = Boolean(review.request.checkpoint)) {
    await awaitProposalCheckpoints(review);
    await review.request.dismiss();
    if (restoreBase) restoreSavedBase(review);
    clearCreation(review);
    await closeReview(review);
  }

  async function discard() {
    const review = currentReview();
    if (disposed || !review || reviewIsResolving(review)) return;
    if (!session.dispatchWorkflow({ type: 'resolutionRequested', reviewId: review.request.preview.reviewId, resolution: 'dismiss' })) return;
    try {
      await dismissReview(review, true);
    } catch (error) {
      session.dispatchWorkflow({ type: 'completionFailed', reviewId: review.request.preview.reviewId,
        error: proposalErrorMessage(error, 'Unable to discard this draft.') });
    }
  }

  function undoAll() {
    const review = currentReview();
    if (disposed || !review || reviewIsResolving(review)) return;
    if (review.request.kind === 'create') return discard();
    cancelDiscardConfirmation(review);
    const pending = hunks(review).filter((hunk) => hunk.status === 'pending');
    root(review).resolveReview(review.request.preview.reviewId, pending.map((hunk) => hunk.id), 'undone',
      pending.map((hunk) => ({ from: hunk.from, to: hunk.to, insert: hunk.oldText })));
    return finishIfResolved();
  }

  function focusNext(review: ProposalReviewRuntime, editor: EditorCapabilityAdapter) {
    const next = hunks(review).find(hunk => hunk.status === 'pending' || hunk.status === 'modified');
    if (next && !editor.focusSelection({ anchor: next.from, head: next.to })) {
      setReviewError(review, 'The next change could not be focused in the editor.');
    }
  }

  async function reviewNext() {
    const review = currentReview();
    if (disposed || !review) return;
    cancelDiscardConfirmation(review);
    try {
      const document = await deps.presentReviewDocument({
        document: review.document,
        noteId: review.request.noteId,
        path: review.request.preview.notePath, creation: review.request.kind === 'create'
      });
      if (!reviewIsCurrent(review)) return;
      const editor = document && deps.getEditorForDocument(document);
      if (!document || !editor?.isReady() || document.handle !== review.document.handle) {
        setReviewError(review, 'The editor could not be opened for review.');
        return;
      }
      focusNext(review, editor);
    } catch (error) {
      setReviewError(
        review,
        proposalErrorMessage(
          error,
          'The editor could not be opened for review.'
        )
      );
    }
  }

  // Route components may be recreated while the document review remains live.
  // Rebind only its effects; root text, history, hunk state and workflow persist.
  const retainedReview = currentReview();
  if (retainedReview) {
    root(retainedReview).bindReviewCallbacks(retainedReview.request.preview.reviewId, reviewCallbacks(retainedReview));
    bindCheckpointEffects(retainedReview);
  }

  return {
    session,
    dispose: () => {
      if (disposed) return;
      stopTitleObserver?.();
      stopTitleObserver = null;
      const review = currentReview();
      if (review?.request.checkpoint) void checkpoint(review).catch(error => {
        setReviewError(review, proposalErrorMessage(error, 'Unable to save review draft.'));
      });
      disposed = true;
      const state = session.workflow;
      if (state.kind === 'opening') session.dispatchWorkflow({
        type: 'openFailed', identity: state.identity, error: 'Opening the review was interrupted.'
      });
    },
    loadDurableProposal,
    loadDurableProposalIfOpen,
    flushCheckpoint,
    discard,
    keepAll,
    undoAll,
    reviewNext,
    markConflict: (path: string) => {
      const review = currentReview();
      if (review?.request.preview.notePath === path) {
        session.dispatchWorkflow({
          type: 'externalConflict',
          reviewId: review.request.preview.reviewId,
          error:
            'Note changed on disk. Copy your working text or reload the note.'
        });
      }
    },
    retryCommit: () => {
      const review = currentReview();
      if (disposed || !review || unresolved() > 0) return;
      return finishIfResolved();
    },
    copyCurrent: async () => {
      const review = currentReview();
      const markdown = review
        ? root(review).markdown
        : null;
      if (markdown == null) return;
      try {
        await navigator.clipboard.writeText(markdown);
        if (review) setReviewError(review, 'Current editor text copied.');
      } catch {
        if (review) setReviewError(review, 'Unable to copy current editor text.');
      }
    },
    reloadDisk: async () => {
      const review = currentReview();
      if (disposed || !review) return;
      const requested = session.dispatchWorkflow({
        type: 'discardRequested',
        reviewId: review.request.preview.reviewId,
        confirmationMessage:
          'Reloading discards the current proposed and edited text. Select Reload Disk again to confirm.'
      });
      if (
        !requested || session.workflow.kind !== 'dismissing' ||
        session.workflow.reason !== 'reload'
      ) {
        return;
      }
      try {
        await review.request.dismiss();
        if (currentReview() !== review) return;
        await deps.reloadReviewDocument(review.document);
        await closeReview(review);
      } catch (error) {
        session.dispatchWorkflow({
          type: 'completionFailed',
          reviewId: review.request.preview.reviewId,
          error: proposalErrorMessage(
            error,
            'Unable to reload the note from disk.'
          )
        });
      }
    },
    isReviewingPath: (path: string) =>
      currentReview()?.request.preview.notePath === path,
    isReviewingProposal: (proposalId: string) =>
      currentReview()?.request.proposalId === proposalId,
    get activeProposalId() {
      return currentReview()?.request.proposalId ?? null;
    },
    isReviewingDocument: session.isReviewingDocument
  };
}

export type ProposalOrchestration = ReturnType<typeof createProposalOrchestration>;
