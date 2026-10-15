export interface AppliedNoteChange {
  kind: string;
  path: string | null;
  previousPath: string | null;
}

export interface ProposalPreviewHunk {
  id: string;
  baseFrom: number;
  baseTo: number;
  proposedFrom: number;
  proposedTo: number;
  oldText: string;
  newText: string;
}

export interface ProposalPreview {
  reviewId: string;
  notePath: string;
  title: string;
  baseContentHash: string;
  baseEditorMarkdown: string;
  proposedEditorMarkdown: string;
  hunks: ProposalPreviewHunk[];
}

export type CommitNoteReviewResult = {
  applied: AppliedNoteChange | null;
  noteId: string | null;
  message: string | null;
  commitWarning?: CommittedMutationWarning | null;
} & (
  /** Editor-visible text derived from the exact canonical publication. */
  | { status: 'committed'; committedMarkdown: string }
  | { status: 'conflict'; committedMarkdown: null }
);
import type { CommittedMutationWarning } from '$lib/contracts/committedMutation';

export type ReviewHunkStatus = 'pending' | 'kept' | 'undone' | 'modified';
export interface ReviewHunkState extends ProposalPreviewHunk {
  from: number;
  to: number;
  status: ReviewHunkStatus;
}
