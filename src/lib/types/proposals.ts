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

export interface CommitNoteReviewResult {
  status: 'committed' | 'conflict';
  applied: AppliedNoteChange | null;
  noteId: string | null;
  message: string | null;
  commitWarning?: CommittedMutationWarning | null;
}
import type { CommittedMutationWarning } from '$lib/contracts/committedMutation';
