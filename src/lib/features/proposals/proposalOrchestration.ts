import type { EditorCapabilityAdapter } from '$lib/features/notepad/editor/editorCapabilities';
import type { NoteDraftState } from '$lib/features/notepad/state/noteStore';
import { createProposalApplyController } from './applyController';
import {
  loadMultiFileFixture,
  type FixtureActiveNote
} from './fixtures';
import {
  enterProposalReviewView,
  exitProposalReviewView
} from './reviewDisplay';
import {
  assertCanKeepChange,
  reviewHoldStore,
  type ReviewHoldStore
} from './reviewHold.svelte';
import {
  proposalReviewSession,
  type ProposalReviewSession
} from './reviewSession.svelte';
import type { PendingProposalChange } from './types';

export interface ProposalOrchestrationDeps {
  getEditorPaneDocument: () => NoteDraftState | null;
  getEditorForDocument: (document: NoteDraftState) => EditorCapabilityAdapter | null;
  openNotePath: (notePath: string, options?: { noteId?: string | null }) => Promise<void>;
  ensureEditorPaneForReview: () => Promise<void>;
  /** Focus/activate the editor pane that will show the review. */
  activateEditorPane?: () => void | Promise<void>;
  replaceDocumentMarkdown: (
    document: NoteDraftState,
    markdown: string
  ) => void | Promise<void>;
  setDocumentTitle: (document: NoteDraftState, title: string) => void;
  refreshDocumentAfterKeep: (
    change: PendingProposalChange,
    result: import('$lib/types/proposals').ApplyNoteChangesResult
  ) => void | Promise<void>;
  session?: ProposalReviewSession;
  holds?: ReviewHoldStore;
}

export function createProposalOrchestration(deps: ProposalOrchestrationDeps) {
  const session = deps.session ?? proposalReviewSession;
  const holds = deps.holds ?? reviewHoldStore;

  const apply = createProposalApplyController(session, {
    assertCanKeep: (change) => {
      const document = deps.getEditorPaneDocument();
      return assertCanKeepChange(change, document, holds);
    },
    onKept: async (change, result) => {
      const document = deps.getEditorPaneDocument();
      if (document && holds.isHolding(document.key)) {
        holds.end(document.key);
        const editor = deps.getEditorForDocument(document);
        editor?.setProposalReviewExtensions(null);
      }
      await deps.refreshDocumentAfterKeep(change, result);
    },
    onUndone: async (change) => {
      const document = deps.getEditorPaneDocument();
      if (!document) return;
      const hold = holds.get(document.key);
      if (hold?.changeId === change.id) {
        await exitProposalReviewView({
          document,
          editor: deps.getEditorForDocument(document),
          holds,
          restoreDocumentMarkdown: (markdown) =>
            deps.replaceDocumentMarkdown(document, markdown),
          setTitle: (title) => deps.setDocumentTitle(document, title)
        });
      }
    },
    onUndoneAll: async () => {
      const document = deps.getEditorPaneDocument();
      if (!document || !holds.isHolding(document.key)) return;
      await exitProposalReviewView({
        document,
        editor: deps.getEditorForDocument(document),
        holds,
        restoreDocumentMarkdown: (markdown) =>
          deps.replaceDocumentMarkdown(document, markdown),
        setTitle: (title) => deps.setDocumentTitle(document, title)
      });
    }
  });

  async function showChange(change: PendingProposalChange) {
    try {
      await deps.ensureEditorPaneForReview();
      // Activate the editor BEFORE openNotePath — that command always uses the
      // active pane. Opening from chat would otherwise load into / convert the chat pane.
      await deps.activateEditorPane?.();

      const current = deps.getEditorPaneDocument();
      if (change.path && current?.currentNotePath !== change.path) {
        await deps.openNotePath(change.path);
        await deps.ensureEditorPaneForReview();
        await deps.activateEditorPane?.();
      }

      const document = deps.getEditorPaneDocument();
      if (!document) {
        session.setError('No editor pane available to show this change.');
        return;
      }

      session.setActiveChangeId(change.id);
      session.setError(null);

      // Exit previous hold on this document if switching changes.
      if (holds.isHolding(document.key)) {
        const previous = holds.get(document.key);
        if (previous && previous.changeId !== change.id) {
          await exitProposalReviewView({
            document,
            editor: deps.getEditorForDocument(document),
            holds,
            restoreDocumentMarkdown: (markdown) =>
              deps.replaceDocumentMarkdown(document, markdown),
            setTitle: (title) => deps.setDocumentTitle(document, title)
          });
        }
      }

      // Wait briefly for the pane editor to finish mounting after a split/kind flip.
      let editor = deps.getEditorForDocument(document);
      for (let attempt = 0; !editor && attempt < 5; attempt += 1) {
        await deps.ensureEditorPaneForReview();
        await deps.activateEditorPane?.();
        editor = deps.getEditorForDocument(document);
      }
      if (!editor) {
        session.setError('Editor is not ready for proposal review. Try focusing the note pane.');
        return;
      }

      await enterProposalReviewView({
        document,
        change,
        editor,
        holds,
        onKeep: (changeId) => void apply.keep(changeId),
        onUndo: (changeId) => void apply.undo(changeId),
        replaceDocumentMarkdown: (markdown) =>
          deps.replaceDocumentMarkdown(document, markdown),
        setTitle: (title) => deps.setDocumentTitle(document, title)
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to open proposal review.';
      session.setError(message);
      console.error('Proposal review showChange failed:', error);
    }
  }

  async function reviewNext() {
    const next = session.nextPending();
    if (!next) return;
    await showChange(next);
  }

  async function loadFixture() {
    try {
      await deps.ensureEditorPaneForReview();
      await deps.activateEditorPane?.();

      const document = deps.getEditorPaneDocument();
      if (!document?.currentNotePath) {
        session.setError('Open a saved note before loading a fixture proposal.');
        return;
      }
      const note: FixtureActiveNote = {
        path: document.currentNotePath,
        title: document.title,
        lastSavedMarkdown: document.lastSavedMarkdown
      };
      const ok = await loadMultiFileFixture(note);
      if (!ok) {
        session.setError('Unable to build fixture proposal for this note.');
        return;
      }
      const first = session.pendingChanges()[0];
      if (first) await showChange(first);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to load fixture proposal.';
      session.setError(message);
      console.error('Proposal fixture load failed:', error);
    }
  }

  function isReviewingDocument(document: NoteDraftState): boolean {
    return holds.isHolding(document.key);
  }

  return {
    session,
    holds,
    keep: apply.keep,
    keepAll: apply.keepAll,
    undo: apply.undo,
    undoAll: apply.undoAll,
    showChange,
    reviewNext,
    loadFixture,
    isReviewingDocument
  };
}

export type ProposalOrchestration = ReturnType<typeof createProposalOrchestration>;
