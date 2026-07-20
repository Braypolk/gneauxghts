import type { NoteChange } from '$lib/types/proposals';
import type { NoteDiffModel } from './diffModel';

export type ProposalChangeStatus = 'pending' | 'kept' | 'undone';

export interface PendingProposalChange {
  id: string;
  change: NoteChange;
  status: ProposalChangeStatus;
  /** Base markdown used for diffs (disk/base at proposal time). */
  baseMarkdown: string;
  diff: NoteDiffModel;
  title: string;
  path: string | null;
  error: string | null;
}

export interface ProposalReviewSessionSnapshot {
  source: string;
  changes: PendingProposalChange[];
  activeChangeId: string | null;
  isApplying: boolean;
  isConflicted: boolean;
  error: string | null;
  reviewHunks: { total: number; unresolved: number } | null;
}

export interface ProposalReviewActions {
  onOpenChange: (change: PendingProposalChange) => void | Promise<void>;
  onKeep: (changeId: string) => void | Promise<void>;
  onUndo: (changeId: string) => void | Promise<void>;
  onKeepAll: () => void | Promise<void>;
  onUndoAll: () => void | Promise<void>;
  onReview: () => void | Promise<void>;
}
