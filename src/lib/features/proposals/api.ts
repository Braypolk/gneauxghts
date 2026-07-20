import { invoke } from '@tauri-apps/api/core';
import type {
  CommitNoteReviewResult,
  ProposalPreview,
  ProposedTextEdit
} from '$lib/types/proposals';

export async function previewNoteChangeProposal(
  path: string,
  edits: ProposedTextEdit[]
): Promise<ProposalPreview> {
  return invoke<ProposalPreview>('preview_note_change_proposal', { path, edits });
}

export async function commitNoteReview(
  path: string,
  expectedBaseHash: string,
  markdown: string
): Promise<CommitNoteReviewResult> {
  return invoke<CommitNoteReviewResult>('commit_note_review', {
    path,
    expectedBaseHash,
    markdown
  });
}

/** Normalize Tauri invoke / unknown failures into a readable message. */
export function proposalErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'string' && error.trim()) return error;
  if (error instanceof Error && error.message.trim()) return error.message;
  if (error && typeof error === 'object') {
    const record = error as { message?: unknown; error?: unknown };
    if (typeof record.message === 'string' && record.message.trim()) {
      return record.message;
    }
    if (typeof record.error === 'string' && record.error.trim()) {
      return record.error;
    }
  }
  return fallback;
}
