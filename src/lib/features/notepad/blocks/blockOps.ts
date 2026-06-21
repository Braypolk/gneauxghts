import {
  type Block,
  type BlockKind,
  type BlockMapEntry,
  segmentMarkdown,
  toBlockMap
} from './segmentMarkdown';

// Structured operations against addressable blocks — the new shape of an AI
// change. A `ChangeProposal` replaces the opaque whole-file `newMarkdown` as the
// primary model; full-file output survives only as `fullFileFallback`, which we
// immediately decompose into ReplaceBlock ops via `deriveReplaceOps`.
//
// This is the TS half of the model. A matching Rust enum/struct lives in
// `src-tauri/src/ai/block_ops.rs` and serializes into the existing opaque
// `proposed_changes_json` column (schema-versioned, no destructive migration).

export const CHANGE_PROPOSAL_SCHEMA_VERSION = 2 as const;

export type OpStatus = 'pending' | 'accepted' | 'rejected';

interface BlockOpBase {
  opId: string;
  status: OpStatus;
  /** Model self-reported confidence in [0, 1]; absent for derived ops. */
  confidence?: number;
}

export interface ReplaceBlockOp extends BlockOpBase {
  kind: 'replaceBlock';
  blockId: string;
  anchorHash: string;
  originalText: string;
  newText: string;
}

export interface InsertAfterOp extends BlockOpBase {
  kind: 'insertAfter';
  blockId: string;
  anchorHash: string;
  newText: string;
}

export interface InsertBeforeOp extends BlockOpBase {
  kind: 'insertBefore';
  blockId: string;
  anchorHash: string;
  newText: string;
}

export interface DeleteBlockOp extends BlockOpBase {
  kind: 'deleteBlock';
  blockId: string;
  anchorHash: string;
  originalText: string;
}

export interface UpdateMetaOp extends BlockOpBase {
  kind: 'updateMeta';
  field: string;
  newValue: string;
}

export interface RenameHeadingOp extends BlockOpBase {
  kind: 'renameHeading';
  blockId: string;
  anchorHash: string;
  newText: string;
}

export type BlockOp =
  | ReplaceBlockOp
  | InsertAfterOp
  | InsertBeforeOp
  | DeleteBlockOp
  | UpdateMetaOp
  | RenameHeadingOp;

export interface ChangeProposal {
  schemaVersion: typeof CHANGE_PROPOSAL_SCHEMA_VERSION;
  /** = ai_jobs.id, agent-neutral thread id. */
  threadId: number;
  filePath: string;
  /** Whole-file blake3 hash captured at generation time (the existing gate). */
  baseContentHash: string;
  /** Ordered block ids + hashes captured at generation time. */
  baseBlockMap: BlockMapEntry[];
  operations: BlockOp[];
  /** Optional proposed full markdown, used only if ops cannot apply. */
  fullFileFallback?: string;
  summary: string;
}

/** Ops that address a specific block by id. UpdateMeta is the exception. */
const BLOCK_TARGETED_KINDS: BlockOp['kind'][] = [
  'replaceBlock',
  'insertAfter',
  'insertBefore',
  'deleteBlock',
  'renameHeading'
];

function isBlockTargeted(
  op: BlockOp
): op is ReplaceBlockOp | InsertAfterOp | InsertBeforeOp | DeleteBlockOp | RenameHeadingOp {
  return BLOCK_TARGETED_KINDS.includes(op.kind);
}

export interface ValidationError {
  opId: string;
  reason: string;
}

/**
 * Validate operations against the block map they were generated against:
 *  - every block-targeted op references a real `blockId`,
 *  - its `anchorHash` matches the map entry (op was computed against this text),
 *  - no two ops target the same block (no overlapping edits),
 *  - the op kind is permitted (caller passes the allow-list for the job mode).
 *
 * Returns the list of problems (empty ⇒ valid) so the caller can decide whether
 * to reject the whole proposal or fall back to full-file derivation.
 */
export function validateOperations(
  operations: BlockOp[],
  baseBlockMap: BlockMapEntry[],
  permittedKinds: ReadonlyArray<BlockOp['kind']> = [
    'replaceBlock',
    'insertAfter',
    'insertBefore',
    'deleteBlock',
    'updateMeta',
    'renameHeading'
  ]
): ValidationError[] {
  const errors: ValidationError[] = [];
  const byId = new Map(baseBlockMap.map((entry) => [entry.blockId, entry]));
  const touched = new Set<string>();

  for (const op of operations) {
    if (!permittedKinds.includes(op.kind)) {
      errors.push({ opId: op.opId, reason: `Operation kind not permitted: ${op.kind}` });
      continue;
    }
    if (op.kind === 'updateMeta') {
      if (op.field.trim() === '') {
        errors.push({ opId: op.opId, reason: 'updateMeta requires a field name' });
      }
      continue;
    }
    if (!isBlockTargeted(op)) {
      continue;
    }
    const entry = byId.get(op.blockId);
    if (!entry) {
      errors.push({ opId: op.opId, reason: `Unknown blockId: ${op.blockId}` });
      continue;
    }
    if (entry.anchorHash !== op.anchorHash) {
      errors.push({
        opId: op.opId,
        reason: `anchorHash mismatch for block ${op.blockId} (proposal computed against a different revision)`
      });
    }
    // InsertAfter/InsertBefore add a sibling rather than mutating the target, so
    // multiple inserts around the same block are allowed; only mutations of the
    // SAME block conflict.
    if (op.kind === 'replaceBlock' || op.kind === 'deleteBlock' || op.kind === 'renameHeading') {
      if (touched.has(op.blockId)) {
        errors.push({ opId: op.opId, reason: `Overlapping operations on block ${op.blockId}` });
      }
      touched.add(op.blockId);
    }
  }
  return errors;
}

export interface ApplyResult {
  /** New document text after applying accepted, non-stale ops. */
  text: string;
  /** opIds skipped because the live block no longer matches `anchorHash`. */
  staleOpIds: string[];
  /** opIds that were applied. */
  appliedOpIds: string[];
}

/**
 * Apply the accepted ops as minimal text edits against the live document.
 *
 * - Re-segments `liveDoc` and remaps each op to a live block by `anchorHash`
 *   (content-stable across reorder/insert), falling back to `blockId`.
 * - Skips (marks stale) any op whose target block's live `anchorHash` no longer
 *   matches — a single stale block does NOT fail the whole proposal.
 * - Builds edits from the live offsets and applies them right-to-left so earlier
 *   offsets stay valid. This is a minimal targeted edit, never a whole-doc
 *   rewrite.
 *
 * `acceptedOpIds` selects the subset to apply (accept none = empty, accept all =
 * every op id). `updateMeta` ops are returned in `appliedOpIds` but applying
 * frontmatter/title changes to the body text is the caller's concern (title is
 * persisted separately), so they produce no body edit here.
 */
export function applyOperations(
  liveDoc: string,
  operations: BlockOp[],
  acceptedOpIds: ReadonlySet<string>
): ApplyResult {
  const liveBlocks = segmentMarkdown(liveDoc);
  const byAnchor = new Map<string, Block>();
  const byId = new Map<string, Block>();
  for (const block of liveBlocks) {
    if (!byAnchor.has(block.anchorHash)) {
      byAnchor.set(block.anchorHash, block);
    }
    byId.set(block.blockId, block);
  }

  const staleOpIds: string[] = [];
  const appliedOpIds: string[] = [];
  const edits: { from: number; to: number; insert: string }[] = [];

  for (const op of operations) {
    if (!acceptedOpIds.has(op.opId)) {
      continue;
    }
    if (op.kind === 'updateMeta') {
      appliedOpIds.push(op.opId);
      continue;
    }
    if (!isBlockTargeted(op)) {
      continue;
    }

    const target = byAnchor.get(op.anchorHash) ?? byId.get(op.blockId);
    // Stale if we cannot find a live block whose content matches what the op was
    // computed against. `blockId` fallback only counts if its anchor still holds.
    if (!target || target.anchorHash !== op.anchorHash) {
      staleOpIds.push(op.opId);
      continue;
    }

    switch (op.kind) {
      case 'replaceBlock':
      case 'renameHeading':
        edits.push({ from: target.from, to: target.to, insert: op.newText });
        break;
      case 'deleteBlock': {
        // Remove the block plus its trailing blank-line separator if present, so
        // we don't leave a double blank line behind.
        const to = swallowTrailingBlankLine(liveDoc, target.to);
        edits.push({ from: target.from, to, insert: '' });
        break;
      }
      case 'insertAfter':
        edits.push({ from: target.to, to: target.to, insert: `\n\n${op.newText}` });
        break;
      case 'insertBefore':
        edits.push({ from: target.from, to: target.from, insert: `${op.newText}\n\n` });
        break;
    }
    appliedOpIds.push(op.opId);
  }

  // Apply right-to-left so each edit's offsets remain valid.
  edits.sort((a, b) => b.from - a.from);
  let text = liveDoc;
  for (const edit of edits) {
    text = text.slice(0, edit.from) + edit.insert + text.slice(edit.to);
  }

  return { text, staleOpIds, appliedOpIds };
}

function swallowTrailingBlankLine(doc: string, to: number): number {
  let end = to;
  // Consume up to one trailing newline + following blank line.
  if (doc[end] === '\n') {
    end += 1;
    if (doc[end] === '\n') {
      end += 1;
    }
  }
  return end;
}

let opCounter = 0;
function nextOpId(prefix: string): string {
  opCounter += 1;
  return `${prefix}_${opCounter}`;
}

/**
 * Full-file fallback decomposition: given the base document and a proposed full
 * rewrite, derive `ReplaceBlock` ops so a weak model that returns a whole file
 * still yields block-level review. Blocks present in base but absent (by
 * normalized text) from the proposal become DeleteBlock; brand-new proposed
 * blocks become InsertAfter the preceding matched block (or document start).
 *
 * This is intentionally a coarse, position-aligned diff: it pairs base and
 * proposed blocks by order and emits a ReplaceBlock when the text differs. It is
 * the safety net, not the primary path, so simplicity beats minimality here.
 */
export function deriveReplaceOps(baseDoc: string, proposedDoc: string): BlockOp[] {
  const baseBlocks = segmentMarkdown(baseDoc);
  const proposedBlocks = segmentMarkdown(proposedDoc);
  const ops: BlockOp[] = [];

  const max = Math.max(baseBlocks.length, proposedBlocks.length);
  let lastMatchedBaseId: { blockId: string; anchorHash: string } | null = null;

  for (let i = 0; i < max; i++) {
    const base = baseBlocks[i];
    const proposed = proposedBlocks[i];

    if (base && proposed) {
      if (base.text !== proposed.text) {
        ops.push({
          kind: 'replaceBlock',
          opId: nextOpId('derived'),
          status: 'pending',
          blockId: base.blockId,
          anchorHash: base.anchorHash,
          originalText: base.text,
          newText: proposed.text
        });
      }
      lastMatchedBaseId = { blockId: base.blockId, anchorHash: base.anchorHash };
    } else if (base && !proposed) {
      ops.push({
        kind: 'deleteBlock',
        opId: nextOpId('derived'),
        status: 'pending',
        blockId: base.blockId,
        anchorHash: base.anchorHash,
        originalText: base.text
      });
    } else if (!base && proposed && lastMatchedBaseId) {
      ops.push({
        kind: 'insertAfter',
        opId: nextOpId('derived'),
        status: 'pending',
        blockId: lastMatchedBaseId.blockId,
        anchorHash: lastMatchedBaseId.anchorHash,
        newText: proposed.text
      });
    } else if (!base && proposed && baseBlocks.length > 0) {
      // New content but no matched anchor yet → anchor to the first base block.
      ops.push({
        kind: 'insertBefore',
        opId: nextOpId('derived'),
        status: 'pending',
        blockId: baseBlocks[0].blockId,
        anchorHash: baseBlocks[0].anchorHash,
        newText: proposed.text
      });
    }
  }
  return ops;
}

/**
 * Build a `ChangeProposal` from a base document, capturing the base block map so
 * apply can re-segment and remap later.
 */
export function buildChangeProposal(args: {
  threadId: number;
  filePath: string;
  baseContentHash: string;
  baseDoc: string;
  operations: BlockOp[];
  summary: string;
  fullFileFallback?: string;
}): ChangeProposal {
  return {
    schemaVersion: CHANGE_PROPOSAL_SCHEMA_VERSION,
    threadId: args.threadId,
    filePath: args.filePath,
    baseContentHash: args.baseContentHash,
    baseBlockMap: toBlockMap(segmentMarkdown(args.baseDoc)),
    operations: args.operations,
    summary: args.summary,
    fullFileFallback: args.fullFileFallback
  };
}

export function permittedKindsForMode(deleteAllowed: boolean): BlockOp['kind'][] {
  const base: BlockOp['kind'][] = [
    'replaceBlock',
    'insertAfter',
    'insertBefore',
    'updateMeta',
    'renameHeading'
  ];
  return deleteAllowed ? [...base, 'deleteBlock'] : base;
}

export type { BlockKind };
