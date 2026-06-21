import type { ReviewChange, ReviewUpdateChange } from '$lib/features/inbox/reviewChanges';
import {
  type BlockOp,
  type ChangeProposal,
  buildChangeProposal,
  deriveReplaceOps
} from '$lib/features/notepad/blocks/blockOps';
import { segmentMarkdown } from '$lib/features/notepad/blocks/segmentMarkdown';

// UI-only bridge from the CURRENT whole-file `ReviewChange` shape to the
// structured `ChangeProposal` / `BlockOp` model.
//
// IMPORTANT — this changes NOTHING about persistence or the approval path. The
// backend still produces and applies whole-file `AiChange.updateNote` blobs
// (schema v1). This adapter exists so the inbox UI can render op-level
// before/after pairs TODAY by deriving block ops from the old/new markdown,
// ahead of the Rust side emitting real `ChangeProposal`s (Phase B). When the
// backend starts persisting v2 `ChangeProposal`s, the inbox can consume them
// directly and this derivation becomes the fallback path only.
//
// The threadId is a UI placeholder (-1) because the whole-file path does not
// carry one; do not persist proposals built here.
const UI_PLACEHOLDER_THREAD_ID = -1;

export interface BlockOpView {
  op: BlockOp;
  /** Old text for the op's target block (empty for pure inserts). */
  before: string;
  /** New text the op introduces (empty for deletes). */
  after: string;
}

/**
 * Build a UI `ChangeProposal` for an `updateNote` review change by diffing the
 * current and proposed markdown into block ops. The base block map is captured
 * from the CURRENT markdown so op targets line up with what the user sees.
 */
export function buildUiProposalFromUpdate(change: ReviewUpdateChange): ChangeProposal {
  const operations = deriveReplaceOps(change.currentMarkdown, change.proposedMarkdown);
  return buildChangeProposal({
    threadId: UI_PLACEHOLDER_THREAD_ID,
    filePath: change.path,
    baseContentHash: change.baseContentHash,
    baseDoc: change.currentMarkdown,
    operations,
    summary: change.titleChanged
      ? `Update "${change.currentTitle}" → "${change.proposedTitle}"`
      : `Update "${change.currentTitle}"`,
    fullFileFallback: change.proposedMarkdown
  });
}

/** Same as above but tolerant of the union; non-update changes yield `null`. */
export function buildUiProposal(change: ReviewChange): ChangeProposal | null {
  return change.kind === 'updateNote' ? buildUiProposalFromUpdate(change) : null;
}

/**
 * Pair each derived op with its before/after text so the UI can show op-level
 * cards. Resolves `before` from the base markdown's blocks by `blockId`; ops
 * carry their own `newText`/`originalText`, used as the authoritative source.
 */
export function toBlockOpViews(proposal: ChangeProposal, baseDoc: string): BlockOpView[] {
  const baseById = new Map(segmentMarkdown(baseDoc).map((block) => [block.blockId, block.text]));
  return proposal.operations.map((op) => {
    switch (op.kind) {
      case 'replaceBlock':
        return { op, before: op.originalText, after: op.newText };
      case 'renameHeading':
        return { op, before: baseById.get(op.blockId) ?? '', after: op.newText };
      case 'deleteBlock':
        return { op, before: op.originalText, after: '' };
      case 'insertAfter':
      case 'insertBefore':
        return { op, before: '', after: op.newText };
      case 'updateMeta':
        return { op, before: '', after: op.newValue };
    }
  });
}

/**
 * Convenience for the inbox: derive op-level before/after pairs straight from a
 * review change. Returns `[]` for non-update changes (create/delete render
 * whole-content, not diffs).
 */
export function reviewChangeToBlockOpViews(change: ReviewChange): BlockOpView[] {
  const proposal = buildUiProposal(change);
  if (!proposal || change.kind !== 'updateNote') {
    return [];
  }
  return toBlockOpViews(proposal, change.currentMarkdown);
}
