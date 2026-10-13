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
  getDocumentPath
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
  }) => Promise<NoteDraftState | null>;
  acknowledgeDocumentCommit: (commit: {
    document: NoteDraftState;
    path: string;
    markdown: string;
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

  async function closeReview(review: ProposalReviewRuntime) {
    if (currentReview() !== review) return;
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
    const runtime = documentRegistry.get(review.document.handle)?.resources()?.runtime;
    if (runtime?.review?.reviewId === review.request.preview.reviewId) {
      runtime.replaceMarkdown(review.request.preview.baseEditorMarkdown);
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
    const started = session.dispatchWorkflow({
      type: 'resolutionRequested',
      reviewId: review.request.preview.reviewId,
      resolution
    });
    if (!started) return;

    try {
      if (resolution === 'dismiss') {
        await review.request.dismiss();
        await closeReview(review);
        return;
      }
      const markdown = root(review).markdown;
      const result = await review.request.commit(markdown);
      if (currentReview() !== review) return;
      if (result.status === 'conflict') {
        session.dispatchWorkflow({
          type: 'completionConflicted',
          reviewId: review.request.preview.reviewId,
          error: result.message ?? 'Note changed on disk.'
        });
        return;
      }
      await deps.acknowledgeDocumentCommit({
        document: review.document,
        path: result.applied?.path ?? review.request.preview.notePath,
        markdown,
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
        if (session.workflow.kind === 'reviewing') void finishIfResolved();
      }
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
      document.working.markdown !==
      (document.savedBaseline?.content.markdown ?? '')
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
      root(review).beginReview(preview, reviewCallbacks(review));
      session.dispatchWorkflow({
        type: 'openSucceeded',
        identity
      });
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
    if (current && (
      root(current).markdown !== current.request.preview.proposedEditorMarkdown ||
      hunks(current).some(hunk => hunk.status !== 'pending') ||
      session.workflow.kind === 'conflicted' || session.workflow.kind === 'confirmingDiscard'
    )) {
      setReviewError(current, 'Finish the current review before opening another proposal; it contains edits or review decisions.');
      return false;
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
      await reviewNext();
      return true;
    }
    try {
      if (!await beginOpening(request)) return false;
      const document = await deps.presentReviewDocument({
        document: deps.getEditorPaneDocument(request.preview.notePath),
        noteId: request.noteId,
        path: request.preview.notePath
      });
      if (
        !document ||
        getDocumentPath(document) !== request.preview.notePath
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
      document.working.markdown !==
        (document.savedBaseline?.content.markdown ?? '')
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

  function undoAll() {
    const review = currentReview();
    if (disposed || !review || reviewIsResolving(review)) return;
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
        path: review.request.preview.notePath
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
  if (retainedReview) root(retainedReview).bindReviewCallbacks(
    retainedReview.request.preview.reviewId, reviewCallbacks(retainedReview)
  );

  return {
    session,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      const state = session.workflow;
      if (state.kind === 'opening') session.dispatchWorkflow({
        type: 'openFailed', identity: state.identity, error: 'Opening the review was interrupted.'
      });
    },
    loadDurableProposal,
    loadDurableProposalIfOpen,
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
