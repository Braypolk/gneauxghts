import type { EditorCapabilityAdapter } from '$lib/features/notepad/editor/editorCapabilities';
import type { NoteDraftState } from '$lib/features/notepad/state/noteStore';
import { enterProposalReviewView, exitProposalReviewView, resolveProposalHunk } from './reviewDisplay';
import { proposalTransaction, type ReviewHunkState } from './reviewExtension';
import { proposalReviewSession, type ProposalReviewSession } from './reviewSession.svelte';
import type {
  DurableProposalReviewRequest,
  ProposalReviewRuntime
} from './types';
import type { ProposalReviewIdentity } from './proposalReviewMachine';
import {
  getDocumentPath,
  updateDocumentMarkdown
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
  getEditorsForDocument?: (document: NoteDraftState) => EditorCapabilityAdapter[];
  ensureEditorPaneForReview: (document?: NoteDraftState) => Promise<void>;
  openNoteForReview?: (
    noteId: string | null,
    path: string
  ) => Promise<NoteDraftState | null>;
  activateEditorPane?: (document?: NoteDraftState) => void | Promise<void>;
  scheduleAutosave?: (document: NoteDraftState) => void;
  acknowledgeDocumentCommit: (commit: {
    document: NoteDraftState;
    path: string;
    markdown: string;
  }) => void | Promise<void>;
  reloadReviewFromDisk?: (path: string) => Promise<void>;
  reopenReviewEditor?: (document: NoteDraftState) => Promise<EditorCapabilityAdapter | null>;
  session?: ProposalReviewSession;
}

export type { DurableProposalReviewRequest } from './types';

export function createProposalOrchestration(deps: ProposalOrchestrationDeps) {
  const session = deps.session ?? proposalReviewSession;
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
    return currentReview() === review;
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

  function closeReview(review: ProposalReviewRuntime) {
    for (const editor of editors(review)) exitProposalReviewView(editor);
    session.dispatchWorkflow({
      type: 'completionSucceeded',
      reviewId: review.request.preview.reviewId
    });
  }

  function releaseReplacedReview(review: ProposalReviewRuntime) {
    for (const editor of editors(review)) {
      exitProposalReviewView(editor);
      if (editor.getDocumentText?.() !== review.request.preview.baseEditorMarkdown) {
        editor.replaceDocument(review.request.preview.baseEditorMarkdown, { focus: false });
      }
    }
    updateDocumentMarkdown(
      review.document,
      review.request.preview.baseEditorMarkdown
    );
  }

  /**
   * Resolves the editor presenting the review's own document. A pane adapter
   * outlives the document it was bound to, so the cached `review.editor` is
   * only trusted while a pane still displays that document. Everything that
   * reads or writes review text must go through here.
   */
  function reviewEditor(
    review: ProposalReviewRuntime
  ): EditorCapabilityAdapter | null {
    const editor = deps.getEditorForDocument(review.document);
    if (editor?.isReady()) {
      review.editor = editor;
      return editor;
    }
    review.editor = null;
    return null;
  }

  function editors(review: ProposalReviewRuntime) {
    const forDocument = deps
      .getEditorsForDocument?.(review.document)
      .filter((editor) => editor.isReady());
    if (forDocument) return forDocument;
    const editor = reviewEditor(review);
    return editor ? [editor] : [];
  }

  function cloneHunks(hunks: readonly ReviewHunkState[]) {
    return hunks.map((hunk) => ({ ...hunk }));
  }

  function hunks(review: ProposalReviewRuntime): ReviewHunkState[] {
    const state = editors(review)
      .map((editor) => editor.readProposalReviewState?.())
      .find((candidate) => candidate?.reviewId === review.request.preview.reviewId);
    return state?.hunks ?? review.hunkSnapshot;
  }

  function captureReview(editor: EditorCapabilityAdapter | null, review: ProposalReviewRuntime) {
    const state = editor?.readProposalReviewState?.();
    if (state?.reviewId === review.request.preview.reviewId) {
      review.hunkSnapshot = cloneHunks(state.hunks);
    }
    review.workingMarkdown = editor?.getDocumentText?.() ?? review.workingMarkdown;
  }

  function installReviewInEditor(review: ProposalReviewRuntime, editor: EditorCapabilityAdapter) {
    // A pane can be recreated from the saved disk snapshot after the last
    // review pane was closed. Restore the review's working copy *before*
    // adding decorations; its mapped ranges only make sense in this document.
    // Remove a previous review field first. A full-document runtime sync is a
    // view reset, not a user edit; leaving the field installed would map that
    // reset across every hunk and make the whole note look proposed.
    exitProposalReviewView(editor);
    if (editor.getDocumentText?.() !== review.workingMarkdown) {
      if (!editor.replaceDocument(review.workingMarkdown, { focus: false })) {
        throw new Error('Could not restore the proposed review text.');
      }
    }
    const initialHunks = cloneHunks(review.hunkSnapshot);
    enterProposalReviewView({
      preview: review.request.preview,
      editor,
      initialHunks,
      alreadyApplied: true,
      onKeep: keepHunk,
      onUndo: undoHunk,
      onStateChange: (state) => {
        // Compartment reconfiguration can deliver a final update from an old
        // extension. Only the extension currently installed in this editor is
        // allowed to refresh the suspended review snapshot.
        if (!reviewIsCurrent(review) || state.reviewId !== review.request.preview.reviewId) return;
        const live = editor.readProposalReviewState?.();
        if (live?.reviewId !== review.request.preview.reviewId) return;
        // The pane hosting this adapter may have rebound to another note since
        // the extension was installed. Only the editor still presenting this
        // review's document may refresh its working copy.
        if (reviewEditor(review) !== editor) return;
        review.hunkSnapshot = cloneHunks(state.hunks);
        review.workingMarkdown = editor.getDocumentText?.() ?? review.workingMarkdown;
        session.notifyReviewRuntimeChanged();
        void finishIfResolved();
      }
    });
  }

  function editorHasReviewInstalled(
    review: ProposalReviewRuntime,
    editor: EditorCapabilityAdapter
  ) {
    return (
      editor.readProposalReviewState?.()?.reviewId ===
      review.request.preview.reviewId
    );
  }

  function unresolved() {
    const review = currentReview();
    return review ? hunks(review).filter((hunk) => hunk.status === 'pending' || hunk.status === 'modified').length : 0;
  }

  function syncReviewRuntime() {
    const review = currentReview();
    if (!review) return;
    review.hunkSnapshot = cloneHunks(hunks(review));
    review.workingMarkdown =
      reviewEditor(review)?.getDocumentText?.() ??
      review.workingMarkdown;
    session.notifyReviewRuntimeChanged();
  }

  async function finishIfResolved() {
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
        closeReview(review);
        deps.scheduleAutosave?.(review.document);
        return;
      }
      // The captured working copy remains authoritative if the editor remounts
      // while the final hunk resolves.
      const markdown =
        reviewEditor(review)?.getDocumentText?.() ?? review.workingMarkdown;
      const result = await review.request.commit(markdown);
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
        markdown
      });
      closeReview(review);
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

  function keepHunk(hunk: ReviewHunkState) {
    const review = currentReview();
    if (!review || reviewIsResolving(review)) return;
    cancelDiscardConfirmation(review);
    for (const editor of editors(review)) resolveProposalHunk(editor, hunk.id, 'kept');
    syncReviewRuntime();
    void finishIfResolved();
  }

  function undoHunk(hunk: ReviewHunkState) {
    const review = currentReview();
    if (!review || reviewIsResolving(review)) return;
    const editor = reviewEditor(review);
    if (!editor) {
      setReviewError(review, 'Open the proposed note to restore this text.');
      return;
    }
    cancelDiscardConfirmation(review);
    // A modified hunk reaches this path only through its explicit Restore Original control.
    const current = (editor.getDocumentText?.() ?? '').slice(hunk.from, hunk.to);
    if (hunk.status === 'pending' && current !== hunk.newText) {
      setReviewError(
        review,
        'This proposed hunk changed; choose Keep Current or Restore Original.'
      );
      return;
    }
    if (!editor.applyChanges?.(
      { from: hunk.from, to: hunk.to, insert: hunk.oldText },
      proposalTransaction.of(true)
    )) {
      setReviewError(review, 'Could not restore the original text.');
      return;
    }
    for (const editor of editors(review)) resolveProposalHunk(editor, hunk.id, 'undone');
    syncReviewRuntime();
    void finishIfResolved();
  }

  async function start(
    request: DurableProposalReviewRequest,
    document: NoteDraftState,
    editor: EditorCapabilityAdapter
  ) {
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
    const review: ProposalReviewRuntime = {
      request,
      document,
      editor,
      hunkSnapshot: [],
      workingMarkdown: document.working.markdown,
      suspendedMarkdown: null
    };
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
      enterProposalReviewView({
        preview,
        editor,
        siblingEditors: editors(review).filter((candidate) => candidate !== editor),
        onKeep: keepHunk,
        onUndo: undoHunk,
        onStateChange: (state) => {
          if (reviewIsCurrent(review) && state.reviewId === review.request.preview.reviewId) {
            review.hunkSnapshot = cloneHunks(state.hunks);
            // Only the editor still bound to this review's document may refresh
            // its working copy; a rebound pane now holds a different note.
            if (reviewEditor(review) === editor) {
              review.workingMarkdown =
                editor.getDocumentText?.() ?? review.workingMarkdown;
            }
            session.notifyReviewRuntimeChanged();
          }
          void finishIfResolved();
        }
      });
      review.hunkSnapshot = cloneHunks(hunks(review));
      review.workingMarkdown = editor.getDocumentText?.() ?? review.workingMarkdown;
      session.dispatchWorkflow({
        type: 'openSucceeded',
        identity
      });
      return true;
    } catch (error) {
      releaseReplacedReview(review);
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

  function beginOpening(request: DurableProposalReviewRequest) {
    const current = currentReview();
    const identity = identityFor(request);
    if (
      !session.dispatchWorkflow({
        type: 'openRequested',
        identity
      })
    ) {
      return false;
    }
    if (current) releaseReplacedReview(current);
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
    const current = currentReview();
    if (current?.request.proposalId === request.proposalId) {
      await deps.activateEditorPane?.(current.document);
      await reviewNext();
      return true;
    }
    if (!beginOpening(request)) return false;

    try {
      let document = deps.getEditorPaneDocument(request.preview.notePath);
      await deps.ensureEditorPaneForReview(document ?? undefined);
      if (!document) {
        document =
          (await deps.openNoteForReview?.(
            request.noteId,
            request.preview.notePath
          )) ?? deps.getEditorPaneDocument(request.preview.notePath);
      }
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
      await deps.activateEditorPane?.(document);
      const editor = deps.getEditorForDocument(document);
      if (!editor) {
        failOpening(
          request,
          'Editor is not ready for proposal review.'
        );
        return false;
      }
      const started = await start(request, document, editor);
      if (started) await reviewNext();
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
    if (!beginOpening(request)) return false;

    // Passive display is intentionally limited to an editor that already
    // exists. It must not ensure, open, activate, or focus a pane.
    return start(request, document, editor);
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
    if (!review) return;
    for (const hunk of hunks(review)) {
      if (hunk.status === 'pending' || hunk.status === 'modified') keepHunk(hunk);
    }
  }

  function undoAll() {
    const review = currentReview();
    if (!review || reviewIsResolving(review)) return;
    const editor = reviewEditor(review);
    if (!editor) {
      setReviewError(review, 'Open the proposed note to restore this text.');
      return;
    }
    cancelDiscardConfirmation(review);
    const pending = hunks(review).filter((hunk) => hunk.status === 'pending').sort((a, b) => b.from - a.from);
    const changes = pending.map((hunk) => ({ from: hunk.from, to: hunk.to, insert: hunk.oldText }));
    if (changes.length && !editor.applyChanges?.(changes, proposalTransaction.of(true))) {
      setReviewError(review, 'Could not restore the remaining proposed text.');
      return;
    }
    for (const hunk of pending) {
      for (const editor of editors(review)) resolveProposalHunk(editor, hunk.id, 'undone');
    }
    syncReviewRuntime();
    void finishIfResolved();
  }

  async function liveReviewEditor(review: ProposalReviewRuntime) {
    await deps.activateEditorPane?.(review.document);
    if (!reviewIsCurrent(review)) return null;

    let editor = deps.getEditorForDocument(review.document);
    if (!editor?.isReady()) {
      editor = await deps.reopenReviewEditor?.(review.document) ?? null;
    }
    if (!editor?.isReady() || !reviewIsCurrent(review)) {
      setReviewError(review, 'The editor could not be opened for review.');
      return null;
    }

    if (editor !== review.editor) {
      // A suspended review has no live editor to capture from; its snapshot is
      // already authoritative and must win over any later working-copy write.
      if (review.suspendedMarkdown !== null) {
        review.workingMarkdown = review.suspendedMarkdown;
      } else {
        captureReview(review.editor, review);
      }
      review.editor = editor;
    }
    if (!editorHasReviewInstalled(review, editor)) {
      installReviewInEditor(review, editor);
    }
    review.suspendedMarkdown = null;
    return editor;
  }

  async function reviewNext() {
    const review = currentReview();
    if (!review) return;
    cancelDiscardConfirmation(review);
    try {
      const editor = await liveReviewEditor(review);
      if (!editor || !reviewIsCurrent(review)) return;

      const next = hunks(review).find((hunk) => hunk.status === 'pending' || hunk.status === 'modified');
      if (next && !editor.focusProposalHunk?.(next.id)) {
        setReviewError(review, 'The next change could not be focused in the editor.');
      }
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

  return {
    session,
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
      if (!review || unresolved() > 0) return;
      void finishIfResolved();
    },
    copyCurrent: async () => {
      const review = currentReview();
      const markdown = review
        ? reviewEditor(review)?.getDocumentText?.() ?? review.workingMarkdown
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
      if (!review) return;
      session.dispatchWorkflow({
        type: 'discardRequested',
        reviewId: review.request.preview.reviewId,
        confirmationMessage:
          'Reloading discards the current proposed and edited text. Select Reload Disk again to confirm.'
      });
      if (
        session.workflow.kind !== 'dismissing' ||
        session.workflow.reason !== 'reload'
      ) {
        return;
      }
      try {
        await review.request.dismiss();
        await deps.reloadReviewFromDisk?.(review.request.preview.notePath);
        closeReview(review);
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
    attachEditor: (document: NoteDraftState, editor: EditorCapabilityAdapter) => {
      const review = currentReview();
      if (!review || review.document.key !== document.key || !editor.isReady()) return;
      review.editor = editor;
      if (!editorHasReviewInstalled(review, editor)) {
        installReviewInEditor(review, editor);
      }
      // A live editor now owns the working copy again.
      review.suspendedMarkdown = null;
    },
    suspendDocument: (document: NoteDraftState, editor: EditorCapabilityAdapter | null) => {
      const review = currentReview();
      if (!review || review.document.key !== document.key) return;
      captureReview(editor, review);
      // The document state is also retained so an ordinary open path mounts
      // the same working copy even before its review extension is attached.
      updateDocumentMarkdown(
        document,
        review.workingMarkdown
      );
      exitProposalReviewView(editor);
      // Snapshot the text that belongs to *this* document before releasing the
      // editor, so restore cannot resurrect a value written from another note.
      review.suspendedMarkdown = review.workingMarkdown;
      // The adapter is pane-scoped and that pane is about to present a
      // different document. Holding it would let review reads and writes land
      // on the wrong note.
      review.editor = null;
      session.notifyReviewRuntimeChanged();
    },
    restoreDocument: (document: NoteDraftState) => {
      const review = currentReview();
      if (
        !review ||
        review.request.preview.notePath !== getDocumentPath(document)
      ) return false;
      review.document = document;
      const restored = review.suspendedMarkdown ?? review.workingMarkdown;
      review.workingMarkdown = restored;
      updateDocumentMarkdown(document, restored);
      return true;
    },
    isReviewingDocument: session.isReviewingDocument
  };
}

export type ProposalOrchestration = ReturnType<typeof createProposalOrchestration>;
