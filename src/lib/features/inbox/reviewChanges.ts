import type { AiChange, AiChangePreview } from '$lib/types/ai';
import { applyOperations, deriveReplaceOps, type BlockOp } from '$lib/features/notepad/blocks/blockOps';

export interface ReviewUpdateChange {
  id: string;
  kind: 'updateNote';
  path: string;
  baseContentHash: string;
  currentTitle: string;
  currentMarkdown: string;
  proposedTitle: string;
  proposedMarkdown: string;
  titleChanged: boolean;
  selected: boolean;
  /**
   * Block-level ops decomposing currentMarkdown → proposedMarkdown, for op-level
   * review. Derived against currentMarkdown so op targets line up with the diff
   * the user sees and `applyOperations(currentMarkdown, ops, ...)` reproduces the
   * proposed body when all are accepted.
   */
  ops: BlockOp[];
  /** opIds the user has accepted. Defaults to all ops (whole-file accept). */
  acceptedOpIds: string[];
}

export interface ReviewCreateChange {
  id: string;
  kind: 'createNote';
  change: Extract<AiChange, { kind: 'createNote' }>;
  selected: boolean;
}

export interface ReviewDeleteChange {
  id: string;
  kind: 'deleteNote';
  change: Extract<AiChange, { kind: 'deleteNote' }>;
  title: string;
  selected: boolean;
}

export type ReviewChange = ReviewUpdateChange | ReviewCreateChange | ReviewDeleteChange;

export function buildReviewChanges(changePreviews: AiChangePreview[]): ReviewChange[] {
  return changePreviews.map((changePreview, index) => {
    const { change } = changePreview;
    if (change.kind === 'updateNote') {
      const currentTitle = changePreview.currentTitle ?? fallbackTitleFromPath(change.path);
      const currentMarkdown = changePreview.currentMarkdown ?? '';
      const proposedTitle = change.newTitle.trim() === '' ? currentTitle : change.newTitle;
      const ops = deriveReplaceOps(currentMarkdown, change.newMarkdown);
      return {
        id: `updateNote:${change.path}`,
        kind: 'updateNote',
        path: change.path,
        baseContentHash: change.baseContentHash,
        currentTitle,
        currentMarkdown,
        proposedTitle,
        proposedMarkdown: change.newMarkdown,
        titleChanged: proposedTitle !== currentTitle,
        selected: true,
        ops,
        acceptedOpIds: ops.map((op) => op.opId)
      } satisfies ReviewUpdateChange;
    }

    if (change.kind === 'createNote') {
      return {
        id: `createNote:${index}:${change.suggestedTitle}`,
        kind: 'createNote',
        change,
        selected: true
      } satisfies ReviewCreateChange;
    }

    return {
      id: `deleteNote:${change.path}`,
      kind: 'deleteNote',
      change,
      title: changePreview.currentTitle ?? fallbackTitleFromPath(change.path),
      selected: true
    } satisfies ReviewDeleteChange;
  });
}

export function buildApprovedChanges(reviewChanges: ReviewChange[]): AiChange[] {
  const approvedChanges: AiChange[] = [];
  for (const reviewChange of reviewChanges) {
    if (!reviewChange.selected) {
      continue;
    }

    if (reviewChange.kind === 'createNote' || reviewChange.kind === 'deleteNote') {
      approvedChanges.push(reviewChange.change);
      continue;
    }

    const newMarkdown = approvedMarkdownForUpdate(reviewChange);

    // Drop a no-op: nothing accepted changes the body AND the title is unchanged.
    if (newMarkdown === reviewChange.currentMarkdown && !reviewChange.titleChanged) {
      continue;
    }

    approvedChanges.push({
      kind: 'updateNote',
      path: reviewChange.path,
      baseContentHash: reviewChange.baseContentHash,
      newTitle: reviewChange.proposedTitle,
      newMarkdown
    });
  }
  return approvedChanges;
}

/**
 * The body to apply for an accepted updateNote, honoring per-op selection.
 *
 * - All ops accepted (the default whole-file accept) ⇒ the verbatim
 *   `proposedMarkdown`, byte-identical to the pre-op-level behavior.
 * - A strict subset accepted ⇒ apply only those ops to `currentMarkdown` via
 *   `applyOperations`, producing a partial merge of just the accepted blocks.
 * - No ops (title-only change or identical bodies) ⇒ `proposedMarkdown`.
 */
export function approvedMarkdownForUpdate(reviewChange: ReviewUpdateChange): string {
  const { ops, acceptedOpIds, currentMarkdown, proposedMarkdown } = reviewChange;
  if (ops.length === 0) {
    return proposedMarkdown;
  }
  const accepted = new Set(acceptedOpIds);
  if (accepted.size === ops.length) {
    return proposedMarkdown;
  }
  if (accepted.size === 0) {
    return currentMarkdown;
  }
  return applyOperations(currentMarkdown, ops, accepted).text;
}

export function isReviewUpdateOpAccepted(reviewChange: ReviewUpdateChange, opId: string) {
  return reviewChange.acceptedOpIds.includes(opId);
}

/** Count of accepted ops vs total, for UI summaries. */
export function reviewUpdateOpCounts(reviewChange: ReviewUpdateChange) {
  return { accepted: reviewChange.acceptedOpIds.length, total: reviewChange.ops.length };
}

export function isReviewChangeSelected(reviewChange: ReviewChange) {
  return reviewChange.selected;
}

export function getReviewChangePath(reviewChange: ReviewChange) {
  if (reviewChange.kind === 'updateNote') {
    return reviewChange.path;
  }
  if (reviewChange.kind === 'deleteNote') {
    return reviewChange.change.path;
  }
  return null;
}

export function reviewChangeTitle(reviewChange: ReviewChange) {
  if (reviewChange.kind === 'updateNote') {
    return reviewChange.proposedTitle || reviewChange.currentTitle || 'Updated note';
  }
  if (reviewChange.kind === 'createNote') {
    return reviewChange.change.suggestedTitle || 'New note';
  }
  return reviewChange.title || 'Deleted note';
}

function fallbackTitleFromPath(path: string) {
  return path.split('/').pop()?.replace(/\.md$/i, '') ?? 'Note';
}
