import type {
  CommitNoteReviewResult,
  ProposalPreview
} from '$lib/types/proposals';
import type { NoteDraftState } from '$lib/features/notepad/state/noteStore';
import type { EditorCapabilityAdapter } from '$lib/features/notepad/editor/editorCapabilities';
import type { ReviewHunkState } from './reviewExtension';

export interface ProposalReviewSessionSnapshot {
  proposalId: string | null;
  notePath: string | null;
  title: string | null;
  totalHunks: number;
  unresolvedHunks: number;
  isApplying: boolean;
  isConflicted: boolean;
  error: string | null;
}

export interface DurableProposalReviewRequest {
  proposalId: string;
  noteId: string | null;
  preview: ProposalPreview;
  commit: (markdown: string) => Promise<CommitNoteReviewResult>;
  dismiss: () => Promise<void>;
}

export interface ProposalReviewRuntime {
  request: DurableProposalReviewRequest;
  document: NoteDraftState;
  /**
   * Cache of the editor currently presenting this review. A pane adapter is
   * pane-scoped, so this must be cleared whenever that pane rebinds to another
   * document; otherwise the review would read and write the wrong note.
   */
  editor: EditorCapabilityAdapter | null;
  hunkSnapshot: ReviewHunkState[];
  workingMarkdown: string;
  /**
   * Working copy captured when the review's document was navigated away from.
   * Authoritative over `workingMarkdown` on restore, so a later write from an
   * unrelated document cannot become the restored text.
   */
  suspendedMarkdown: string | null;
}
