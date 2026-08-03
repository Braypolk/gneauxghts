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
  editor: EditorCapabilityAdapter;
  hunkSnapshot: ReviewHunkState[];
  workingMarkdown: string;
}
