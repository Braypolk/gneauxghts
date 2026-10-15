import type {
  CommitNoteReviewResult,
  ProposalPreview
} from '$lib/types/proposals';
import type { NoteDraftState } from '$lib/features/notepad/state/noteStore';

export interface ProposalReviewSessionSnapshot {
  proposalId: string | null;
  notePath: string | null;
  title: string | null;
  totalHunks: number;
  unresolvedHunks: number;
  isApplying: boolean;
  isConflicted: boolean;
  error: string | null;
  creation?: boolean;
  changeLocation?: (path: string) => Promise<void>;
}

export interface ProposalWorkingState {
  markdown: string;
  title: string;
  path: string;
  requestedPath?: string;
  decisions: import('./reviewExtension').ReviewHunkState[];
}

export interface DurableProposalReviewRequest {
  draftVersion?: number;
  kind?: 'update' | 'create';
  changeLocation?: (path: string) => Promise<void>;
  refresh?: () => Promise<DurableProposalReviewRequest | null>;
  working?: ProposalWorkingState;
  checkpoint?: (working: ProposalWorkingState) => Promise<void>;
  proposalId: string;
  noteId: string | null;
  preview: ProposalPreview;
  commit: (markdown: string) => Promise<CommitNoteReviewResult>;
  dismiss: () => Promise<void>;
}

export interface ProposalReviewRuntime {
  request: DurableProposalReviewRequest;
  document: NoteDraftState;
}
