import type { EditorCapabilityAdapter } from '$lib/features/notepad/editor/editorCapabilities';
import type { NoteDraftState } from '$lib/features/notepad/state/noteStore';
import type {
  CommitNoteReviewResult,
  ProposalPreview
} from '$lib/types/proposals';
import { commitNoteReview, proposalErrorMessage } from './api';
import { enterProposalReviewView, exitProposalReviewView, resolveProposalHunk } from './reviewDisplay';
import { proposalTransaction, type ReviewHunkState } from './reviewExtension';
import { reviewHoldStore, type ReviewHoldStore } from './reviewHold.svelte';
import { proposalReviewSession, type ProposalReviewSession } from './reviewSession.svelte';

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
  cancelPendingAutosave?: (document: NoteDraftState) => void;
  scheduleAutosave?: (document: NoteDraftState) => void;
  flushBeforePreview?: (document: NoteDraftState) => Promise<void>;
  refreshDocumentAfterKeep: (path: string) => void | Promise<void>;
  reloadReviewFromDisk?: (path: string) => Promise<void>;
  reopenReviewEditor?: (document: NoteDraftState) => Promise<EditorCapabilityAdapter | null>;
  session?: ProposalReviewSession;
  holds?: ReviewHoldStore;
}

export interface DurableProposalReviewRequest {
  proposalId: string;
  noteId: string | null;
  preview: ProposalPreview;
  commit: (markdown: string) => Promise<CommitNoteReviewResult>;
  dismiss: () => Promise<void>;
}

type ActiveReview = {
  preview: ProposalPreview;
  durable: DurableProposalReviewRequest | null;
  document: NoteDraftState;
  editor: EditorCapabilityAdapter;
  committing: boolean;
  conflicted: boolean;
  reloadConfirming: boolean;
  hunkSnapshot: ReviewHunkState[];
  workingMarkdown: string;
};

export function createProposalOrchestration(deps: ProposalOrchestrationDeps) {
  const session = deps.session ?? proposalReviewSession;
  const holds = deps.holds ?? reviewHoldStore;
  let active: ActiveReview | null = null;
  let durableLoadQueue: Promise<void> = Promise.resolve();

  function closeReview(review: ActiveReview) {
    for (const editor of editors(review)) exitProposalReviewView(editor);
    holds.end(review.document.key);
    if (active === review) active = null;
    session.clear();
  }

  function replaceActiveReview(review: ActiveReview) {
    for (const editor of editors(review)) {
      exitProposalReviewView(editor);
      if (editor.getDocumentText?.() !== review.preview.baseEditorMarkdown) {
        editor.replaceDocument(review.preview.baseEditorMarkdown, { focus: false });
      }
    }
    if (review.document.bodyMarkdown !== review.preview.baseEditorMarkdown) {
      review.document.bodyMarkdown = review.preview.baseEditorMarkdown;
      review.document.operationRevision += 1;
    }
    holds.end(review.document.key);
    if (active === review) active = null;
    session.clear();
  }

  function editors(review: ActiveReview) {
    return deps.getEditorsForDocument?.(review.document).filter((editor) => editor.isReady()) ?? [review.editor];
  }

  function cloneHunks(hunks: readonly ReviewHunkState[]) {
    return hunks.map((hunk) => ({ ...hunk }));
  }

  function hunks(review: ActiveReview): ReviewHunkState[] {
    const state = editors(review)
      .map((editor) => editor.readProposalReviewState?.())
      .find((candidate) => candidate?.reviewId === review.preview.reviewId);
    return state?.hunks ?? review.hunkSnapshot;
  }

  function captureReview(editor: EditorCapabilityAdapter | null, review: ActiveReview) {
    const state = editor?.readProposalReviewState?.();
    if (state?.reviewId === review.preview.reviewId) {
      review.hunkSnapshot = cloneHunks(state.hunks);
    }
    review.workingMarkdown = editor?.getDocumentText?.() ?? review.workingMarkdown;
  }

  function installReviewInEditor(review: ActiveReview, editor: EditorCapabilityAdapter) {
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
      preview: review.preview,
      editor,
      initialHunks,
      alreadyApplied: true,
      onKeep: keepHunk,
      onUndo: undoHunk,
      onStateChange: (state) => {
        // Compartment reconfiguration can deliver a final update from an old
        // extension. Only the extension currently installed in this editor is
        // allowed to refresh the suspended review snapshot.
        if (active !== review || state.reviewId !== review.preview.reviewId) return;
        const live = editor.readProposalReviewState?.();
        if (live?.reviewId !== review.preview.reviewId) return;
        review.hunkSnapshot = cloneHunks(state.hunks);
        review.workingMarkdown = editor.getDocumentText?.() ?? review.workingMarkdown;
        syncHunkSummary();
        void finishIfResolved();
      }
    });
  }

  function unresolved() {
    return active ? hunks(active).filter((hunk) => hunk.status === 'pending' || hunk.status === 'modified').length : 0;
  }

  function syncHunkSummary() {
    if (!active) return;
    session.setReviewHunks(active.preview.hunks.length, unresolved());
  }

  async function finishIfResolved() {
    if (!active || unresolved() > 0 || active.committing) return;
    const review = active;
    const kept = hunks(review).some((hunk) => hunk.status === 'kept');
    if (!kept) {
      review.committing = true;
      session.setApplying(true);
      try {
        await review.durable?.dismiss();
        closeReview(review);
        deps.scheduleAutosave?.(review.document);
      } catch (error) {
        session.setError(proposalErrorMessage(error, 'Unable to dismiss this proposal.'));
      } finally {
        if (active === review) review.committing = false;
        session.setApplying(false);
      }
      return;
    }
    review.committing = true;
    session.setApplying(true);
    try {
      // The editor can be remounted while Keep All resolves its final hunk.
      // `workingMarkdown` is continuously captured from the live review and
      // remains authoritative when that narrow teardown race occurs.
      const markdown = review.editor.getDocumentText?.() ?? review.workingMarkdown;
      const result = review.durable
        ? await review.durable.commit(markdown)
        : await commitNoteReview(
            review.preview.notePath,
            review.preview.baseContentHash,
            markdown
          );
      if (result.status === 'conflict') {
        review.conflicted = true;
        session.setConflicted(true);
        session.setError(result.message ?? 'Note changed on disk.');
        return;
      }
      closeReview(review);
      await deps.refreshDocumentAfterKeep(result.applied?.path ?? review.preview.notePath);
    } catch (error) {
      session.setError(proposalErrorMessage(error, 'Unable to commit reviewed note.'));
    } finally {
      if (active) active.committing = false;
      session.setApplying(false);
    }
  }

  function keepHunk(hunk: ReviewHunkState) {
    if (!active || active.committing) return;
    for (const editor of editors(active)) resolveProposalHunk(editor, hunk.id, 'kept');
    syncHunkSummary();
    void finishIfResolved();
  }

  function undoHunk(hunk: ReviewHunkState) {
    if (!active || active.committing) return;
    // A modified hunk reaches this path only through its explicit Restore Original control.
    const current = (active.editor.getDocumentText?.() ?? '').slice(hunk.from, hunk.to);
    if (hunk.status === 'pending' && current !== hunk.newText) {
      session.setError('This proposed hunk changed; choose Keep Current or Restore Original.');
      return;
    }
    if (!active.editor.applyChanges?.(
      { from: hunk.from, to: hunk.to, insert: hunk.oldText },
      proposalTransaction.of(true)
    )) {
      session.setError('Could not restore the original text.');
      return;
    }
    for (const editor of editors(active)) resolveProposalHunk(editor, hunk.id, 'undone');
    syncHunkSummary();
    void finishIfResolved();
  }

  async function start(
    preview: ProposalPreview,
    document: NoteDraftState,
    editor: EditorCapabilityAdapter,
    durable: DurableProposalReviewRequest | null = null
  ) {
    if (active) {
      session.setError('Resolve the current proposed change first.');
      return false;
    }
    if (document.bodyMarkdown !== document.lastSavedMarkdown) {
      session.setError('Save current edits before reviewing a proposal.');
      return false;
    }
    holds.begin(document);
    try {
      active = {
        preview,
        durable,
        document,
        editor,
        committing: false,
        conflicted: false,
        reloadConfirming: false,
        hunkSnapshot: [],
        workingMarkdown: document.bodyMarkdown
      };
      enterProposalReviewView({
        preview,
        editor,
        siblingEditors: editors(active).filter((candidate) => candidate !== editor),
        onKeep: keepHunk,
        onUndo: undoHunk,
        onStateChange: (state) => {
          if (active && state.reviewId === active.preview.reviewId) {
            active.hunkSnapshot = cloneHunks(state.hunks);
            active.workingMarkdown = active.editor.getDocumentText?.() ?? active.workingMarkdown;
          }
          syncHunkSummary();
          void finishIfResolved();
        }
      });
      active.hunkSnapshot = cloneHunks(hunks(active));
      active.workingMarkdown = active.editor.getDocumentText?.() ?? active.workingMarkdown;
      session.load(
        [{
          kind: 'updateNote',
          path: preview.notePath,
          baseContentHash: preview.baseContentHash,
          newTitle: preview.title,
          newMarkdown: preview.proposedEditorMarkdown
        }],
        { [preview.notePath]: preview.baseEditorMarkdown },
        durable ? `chat:${durable.proposalId}` : 'chat'
      );
      syncHunkSummary();
      return true;
    } catch (error) {
      active = null;
      holds.end(document.key);
      session.setError(proposalErrorMessage(error, 'Unable to open proposal review.'));
      return false;
    }
  }

  async function loadDurableProposalNow(
    request: DurableProposalReviewRequest
  ): Promise<boolean> {
    if (active?.durable?.proposalId === request.proposalId) {
      await deps.activateEditorPane?.(active.document);
      await reviewNext();
      return true;
    }
    if (active) {
      if (active.preview.notePath !== request.preview.notePath) {
        session.setError('Resolve the current proposed change before reviewing another note.');
        return false;
      }
      replaceActiveReview(active);
    }

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
      if (!document?.currentNotePath || document.currentNotePath !== request.preview.notePath) {
        session.setError('The target note could not be opened for proposal review.');
        return false;
      }
      await deps.activateEditorPane?.(document);
      const editor = deps.getEditorForDocument(document);
      if (!editor) {
        session.setError('Editor is not ready for proposal review.');
        return false;
      }
      const started = await start(request.preview, document, editor, request);
      if (started) await reviewNext();
      return started;
    } catch (error) {
      session.setError(proposalErrorMessage(error, 'Could not open the proposal in the editor.'));
      return false;
    }
  }

  function loadDurableProposal(
    request: DurableProposalReviewRequest
  ): Promise<boolean> {
    const task = durableLoadQueue.then(
      () => loadDurableProposalNow(request),
      () => loadDurableProposalNow(request)
    );
    durableLoadQueue = task.then(
      () => undefined,
      () => undefined
    );
    return task;
  }

  function keepAll() {
    if (!active) return;
    for (const hunk of hunks(active)) {
      if (hunk.status === 'pending' || hunk.status === 'modified') keepHunk(hunk);
    }
  }

  function undoAll() {
    if (!active) return;
    const pending = hunks(active).filter((hunk) => hunk.status === 'pending').sort((a, b) => b.from - a.from);
    const changes = pending.map((hunk) => ({ from: hunk.from, to: hunk.to, insert: hunk.oldText }));
    if (changes.length && !active.editor.applyChanges?.(changes, proposalTransaction.of(true))) {
      session.setError('Could not restore the remaining proposed text.');
      return;
    }
    for (const hunk of pending) {
      for (const editor of editors(active)) resolveProposalHunk(editor, hunk.id, 'undone');
    }
    syncHunkSummary();
    void finishIfResolved();
  }

  async function liveReviewEditor(review: ActiveReview) {
    await deps.activateEditorPane?.(review.document);
    if (active !== review) return null;

    let editor = deps.getEditorForDocument(review.document);
    if (!editor?.isReady()) {
      editor = await deps.reopenReviewEditor?.(review.document) ?? null;
    }
    if (!editor?.isReady() || active !== review) {
      session.setError('The editor could not be opened for review.');
      return null;
    }

    const editorReview = editor.readProposalReviewState?.();
    if (editor !== review.editor || editorReview?.reviewId !== review.preview.reviewId) {
      captureReview(review.editor, review);
      review.editor = editor;
      installReviewInEditor(review, editor);
    }
    return editor;
  }

  async function reviewNext() {
    const review = active;
    if (!review) return;
    try {
      const editor = await liveReviewEditor(review);
      if (!editor || active !== review) return;

      const next = hunks(review).find((hunk) => hunk.status === 'pending' || hunk.status === 'modified');
      if (next && !editor.focusProposalHunk?.(next.id)) {
        session.setError('The next change could not be focused in the editor.');
      }
    } catch (error) {
      session.setError(proposalErrorMessage(error, 'The editor could not be opened for review.'));
    }
  }

  return {
    session,
    holds,
    loadDurableProposal,
    keep: (_changeId?: string) => keepAll(),
    keepAll,
    undo: (_changeId?: string) => undoAll(),
    undoAll,
    showChange: async (_change?: unknown) => reviewNext(),
    reviewNext,
    markConflict: (path: string) => {
      if (active?.preview.notePath === path) {
        active.conflicted = true;
        session.setConflicted(true);
        session.setError('Note changed on disk. Copy your working text or reload the note.');
      }
    },
    retryCommit: () => {
      if (!active || unresolved() > 0) return;
      active.conflicted = false;
      session.setConflicted(false);
      session.setError(null);
      void finishIfResolved();
    },
    copyCurrent: async () => {
      const markdown = active?.editor.getDocumentText?.();
      if (markdown == null) return;
      try {
        await navigator.clipboard.writeText(markdown);
        session.setError('Current editor text copied.');
      } catch {
        session.setError('Unable to copy current editor text.');
      }
    },
    reloadDisk: async () => {
      if (!active) return;
      if (!active.reloadConfirming) {
        active.reloadConfirming = true;
        session.setError('Reloading discards the current proposed and edited text. Select Reload Disk again to confirm.');
        return;
      }
      const review = active;
      try {
        await review.durable?.dismiss();
        await deps.reloadReviewFromDisk?.(review.preview.notePath);
        closeReview(review);
      } catch (error) {
        session.setError(proposalErrorMessage(error, 'Unable to reload the note from disk.'));
      }
    },
    isReviewingPath: (path: string) => active?.preview.notePath === path,
    isReviewingProposal: (proposalId: string) =>
      active?.durable?.proposalId === proposalId,
    get activeProposalId() {
      return active?.durable?.proposalId ?? null;
    },
    attachEditor: (document: NoteDraftState, editor: EditorCapabilityAdapter) => {
      if (!active || active.document.key !== document.key || !editor.isReady()) return;
      active.editor = editor;
      installReviewInEditor(active, editor);
    },
    suspendDocument: (document: NoteDraftState, editor: EditorCapabilityAdapter | null) => {
      if (!active || active.document.key !== document.key) return;
      captureReview(editor, active);
      // The document state is also retained so an ordinary open path mounts
      // the same working copy even before its review extension is attached.
      document.bodyMarkdown = active.workingMarkdown;
      exitProposalReviewView(editor);
      syncHunkSummary();
    },
    restoreDocument: (document: NoteDraftState) => {
      if (!active || active.preview.notePath !== document.currentNotePath) return false;
      active.document = document;
      if (document.bodyMarkdown !== active.workingMarkdown) {
        document.bodyMarkdown = active.workingMarkdown;
        document.operationRevision += 1;
      }
      return true;
    },
    isReviewingDocument: (document: NoteDraftState) => holds.isHolding(document.key)
  };
}

export type ProposalOrchestration = ReturnType<typeof createProposalOrchestration>;
