import type { EditorCapabilityAdapter } from '$lib/features/notepad/editor/editorCapabilities';
import type { NoteDraftState } from '$lib/features/notepad/state/noteStore';
import {
  createProposalReviewExtension,
  reviewStateFromChange,
  type ProposalReviewEditorState
} from './reviewExtension';
import type { PendingProposalChange } from './types';
import type { ReviewHoldStore } from './reviewHold.svelte';
import '$lib/features/proposals/review.css';

export interface EnterProposalReviewParams {
  document: NoteDraftState;
  change: PendingProposalChange;
  editor: EditorCapabilityAdapter | null;
  holds: ReviewHoldStore;
  onKeep: (changeId: string) => void;
  onUndo: (changeId: string) => void;
  replaceDocumentMarkdown: (markdown: string) => void | Promise<void>;
  setTitle?: (title: string) => void;
}

export async function enterProposalReviewView(
  params: EnterProposalReviewParams
): Promise<void> {
  const { document, change, editor, holds, onKeep, onUndo, replaceDocumentMarkdown, setTitle } =
    params;

  if (!editor?.isReady()) {
    throw new Error('Editor is not ready for proposal review.');
  }

  holds.begin(document, change);

  try {
    if (change.change.kind === 'updateNote') {
      setTitle?.(change.change.newTitle);
    } else if (change.change.kind === 'createNote') {
      setTitle?.(change.title);
    }

    const review = reviewStateFromChange(change);
    // Install decorations before replacing so the plugin rebuilds on doc change.
    const ok = editor.setProposalReviewExtensions(
      createProposalReviewExtension({
        review,
        onKeep,
        onUndo
      })
    );
    if (!ok) {
      throw new Error(
        'Could not enable proposal review decorations. Remount the note pane and try again.'
      );
    }

    await replaceDocumentMarkdown(change.diff.unifiedText);
  } catch (error) {
    await exitProposalReviewView({
      document,
      editor,
      holds,
      restoreDocumentMarkdown: replaceDocumentMarkdown,
      setTitle
    });
    throw error;
  }
}

export async function exitProposalReviewView(params: {
  document: NoteDraftState;
  editor: EditorCapabilityAdapter | null;
  holds: ReviewHoldStore;
  restoreDocumentMarkdown: (markdown: string) => void | Promise<void>;
  setTitle?: (title: string) => void;
}): Promise<void> {
  const hold = params.holds.end(params.document.key);
  params.editor?.setProposalReviewExtensions(null);
  if (hold) {
    params.setTitle?.(hold.title);
    await params.restoreDocumentMarkdown(hold.bodyMarkdown);
  }
}

export type { ProposalReviewEditorState };
