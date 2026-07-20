import type { ProposalPreview } from '$lib/types/proposals';
import type { EditorCapabilityAdapter } from '$lib/features/notepad/editor/editorCapabilities';
import {
  createProposalReviewExtension,
  proposalTransaction,
  resolveReviewHunk,
  type ReviewHunkState
} from './reviewExtension';
import '$lib/features/proposals/review.css';

export function enterProposalReviewView(params: {
  preview: ProposalPreview;
  editor: EditorCapabilityAdapter | null;
  siblingEditors?: EditorCapabilityAdapter[];
  initialHunks?: ReviewHunkState[];
  alreadyApplied?: boolean;
  onKeep: (hunk: ReviewHunkState) => void;
  onUndo: (hunk: ReviewHunkState) => void;
  onStateChange?: (state: import('./reviewExtension').ProposalReviewState) => void;
}): void {
  const { preview, editor } = params;
  if (!editor?.isReady()) throw new Error('Editor is not ready for proposal review.');
  if (!params.alreadyApplied && editor.getDocumentText?.() !== preview.baseEditorMarkdown) {
    throw new Error('Note changed before the proposal could be applied. Save or recreate it.');
  }
  const changes = preview.hunks.map((hunk) => ({
    from: hunk.baseFrom,
    to: hunk.baseTo,
    insert: hunk.newText
  }));
  if (!params.alreadyApplied && !editor.applyChanges?.(changes, proposalTransaction.of(true))) {
    throw new Error('Could not apply proposal changes to the editor.');
  }
  for (const candidate of [editor, ...(params.siblingEditors ?? [])]) {
    if (!candidate?.isReady()) continue;
    const review = createProposalReviewExtension({
      reviewId: preview.reviewId,
      hunks: preview.hunks,
      initialHunks: params.initialHunks,
      onKeep: params.onKeep,
      onUndo: params.onUndo,
      onStateChange: params.onStateChange
    });
    if (!candidate.setProposalReviewExtensions(review.extension)) {
      throw new Error('Could not enable proposal review decorations.');
    }
    candidate.setProposalReviewStateReader?.(review.read);
  }
}

export function resolveProposalHunk(
  editor: EditorCapabilityAdapter | null,
  id: string,
  status: 'kept' | 'undone'
): void {
  editor?.dispatchEffects?.(resolveReviewHunk.of({ id, status }));
}

export function exitProposalReviewView(editor: EditorCapabilityAdapter | null): void {
  editor?.setProposalReviewExtensions(null);
  editor?.setProposalReviewStateReader?.(null);
}
