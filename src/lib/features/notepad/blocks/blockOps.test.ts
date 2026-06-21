import { describe, expect, it } from 'vitest';

import {
  type BlockOp,
  type ReplaceBlockOp,
  applyOperations,
  buildChangeProposal,
  CHANGE_PROPOSAL_SCHEMA_VERSION,
  deriveReplaceOps,
  permittedKindsForMode,
  validateOperations
} from './blockOps';
import { segmentMarkdown, toBlockMap } from './segmentMarkdown';

const DOC = `# Title

First paragraph.

Second paragraph.

Third paragraph.
`;

function replaceOpForBlock(doc: string, index: number, newText: string): ReplaceBlockOp {
  const block = segmentMarkdown(doc)[index];
  return {
    kind: 'replaceBlock',
    opId: `op_${index}`,
    status: 'pending',
    blockId: block.blockId,
    anchorHash: block.anchorHash,
    originalText: block.text,
    newText
  };
}

describe('validateOperations', () => {
  it('accepts ops that reference real blocks with matching anchorHash', () => {
    const map = toBlockMap(segmentMarkdown(DOC));
    const op = replaceOpForBlock(DOC, 1, 'First paragraph, edited.');
    expect(validateOperations([op], map)).toEqual([]);
  });

  it('rejects an unknown blockId', () => {
    const map = toBlockMap(segmentMarkdown(DOC));
    const op = replaceOpForBlock(DOC, 1, 'x');
    op.blockId = 'b_deadbeef';
    const errors = validateOperations([op], map);
    expect(errors).toHaveLength(1);
    expect(errors[0].reason).toMatch(/Unknown blockId/);
  });

  it('rejects an anchorHash mismatch (stale revision)', () => {
    const map = toBlockMap(segmentMarkdown(DOC));
    const op = replaceOpForBlock(DOC, 1, 'x');
    op.anchorHash = 'ffffffff';
    const errors = validateOperations([op], map);
    expect(errors[0].reason).toMatch(/anchorHash mismatch/);
  });

  it('rejects two mutating ops on the same block (overlap)', () => {
    const map = toBlockMap(segmentMarkdown(DOC));
    const a = replaceOpForBlock(DOC, 1, 'A');
    const b = replaceOpForBlock(DOC, 1, 'B');
    b.opId = 'op_dup';
    const errors = validateOperations([a, b], map);
    expect(errors.some((e) => /Overlapping operations/.test(e.reason))).toBe(true);
  });

  it('rejects an op kind not permitted for the mode', () => {
    const map = toBlockMap(segmentMarkdown(DOC));
    const block = segmentMarkdown(DOC)[1];
    const del: BlockOp = {
      kind: 'deleteBlock',
      opId: 'op_del',
      status: 'pending',
      blockId: block.blockId,
      anchorHash: block.anchorHash,
      originalText: block.text
    };
    const errors = validateOperations([del], map, permittedKindsForMode(false));
    expect(errors[0].reason).toMatch(/not permitted/);
    // Allowed when delete is permitted.
    expect(validateOperations([del], map, permittedKindsForMode(true))).toEqual([]);
  });
});

describe('applyOperations — accept none / all / subset', () => {
  it('accept none returns the document unchanged', () => {
    const op = replaceOpForBlock(DOC, 1, 'changed');
    const result = applyOperations(DOC, [op], new Set());
    expect(result.text).toBe(DOC);
    expect(result.appliedOpIds).toEqual([]);
  });

  it('accept all applies every op as minimal edits', () => {
    const op1 = replaceOpForBlock(DOC, 1, 'First paragraph EDITED.');
    const op3 = replaceOpForBlock(DOC, 3, 'Third paragraph EDITED.');
    const result = applyOperations(DOC, [op1, op3], new Set([op1.opId, op3.opId]));
    expect(result.text).toContain('First paragraph EDITED.');
    expect(result.text).toContain('Third paragraph EDITED.');
    // Untouched block preserved exactly.
    expect(result.text).toContain('Second paragraph.');
    expect(result.appliedOpIds.sort()).toEqual([op1.opId, op3.opId].sort());
    expect(result.staleOpIds).toEqual([]);
  });

  it('accept subset applies only the selected op', () => {
    const op1 = replaceOpForBlock(DOC, 1, 'First paragraph EDITED.');
    const op3 = replaceOpForBlock(DOC, 3, 'Third paragraph EDITED.');
    const result = applyOperations(DOC, [op1, op3], new Set([op3.opId]));
    expect(result.text).toContain('First paragraph.'); // unchanged
    expect(result.text).toContain('Third paragraph EDITED.');
    expect(result.appliedOpIds).toEqual([op3.opId]);
  });

  it('does not whole-doc rewrite: only the targeted span changes', () => {
    const op = replaceOpForBlock(DOC, 1, 'First paragraph EDITED.');
    const result = applyOperations(DOC, [op], new Set([op.opId]));
    const expected = DOC.replace('First paragraph.', 'First paragraph EDITED.');
    expect(result.text).toBe(expected);
  });
});

describe('applyOperations — insert and delete', () => {
  it('inserts a new block after the target', () => {
    const block = segmentMarkdown(DOC)[1];
    const op: BlockOp = {
      kind: 'insertAfter',
      opId: 'op_ins',
      status: 'pending',
      blockId: block.blockId,
      anchorHash: block.anchorHash,
      newText: 'Inserted paragraph.'
    };
    const result = applyOperations(DOC, [op], new Set([op.opId]));
    expect(result.text).toContain('First paragraph.\n\nInserted paragraph.');
  });

  it('deletes a block and its trailing blank line', () => {
    const block = segmentMarkdown(DOC)[1];
    const op: BlockOp = {
      kind: 'deleteBlock',
      opId: 'op_del',
      status: 'pending',
      blockId: block.blockId,
      anchorHash: block.anchorHash,
      originalText: block.text
    };
    const result = applyOperations(DOC, [op], new Set([op.opId]));
    expect(result.text).not.toContain('First paragraph.');
    expect(result.text).toContain('Second paragraph.');
    // No leftover triple newline where the block was.
    expect(result.text).not.toMatch(/\n\n\n/);
  });
});

describe('applyOperations — per-op stale detection', () => {
  it('marks just the affected op stale when its block changed, applies the rest', () => {
    const op1 = replaceOpForBlock(DOC, 1, 'First paragraph EDITED.');
    const op3 = replaceOpForBlock(DOC, 3, 'Third paragraph EDITED.');
    // The user edited the FIRST paragraph after the proposal was generated.
    const liveDoc = DOC.replace('First paragraph.', 'First paragraph (user touched).');
    const result = applyOperations(liveDoc, [op1, op3], new Set([op1.opId, op3.opId]));

    expect(result.staleOpIds).toEqual([op1.opId]);
    expect(result.appliedOpIds).toEqual([op3.opId]);
    // The third paragraph edit still landed; the stale first block is untouched.
    expect(result.text).toContain('Third paragraph EDITED.');
    expect(result.text).toContain('First paragraph (user touched).');
  });

  it('remaps ops by content even when blocks were reordered', () => {
    const op3 = replaceOpForBlock(DOC, 3, 'Third paragraph EDITED.');
    // Reorder: move the third paragraph above the second. anchorHash still matches.
    const liveDoc = `# Title

First paragraph.

Third paragraph.

Second paragraph.
`;
    const result = applyOperations(liveDoc, [op3], new Set([op3.opId]));
    expect(result.staleOpIds).toEqual([]);
    expect(result.text).toContain('Third paragraph EDITED.');
  });
});

describe('deriveReplaceOps (full-file fallback)', () => {
  it('derives a ReplaceBlock for each changed block', () => {
    const proposed = DOC.replace('Second paragraph.', 'Second paragraph rewritten.');
    const ops = deriveReplaceOps(DOC, proposed);
    expect(ops).toHaveLength(1);
    expect(ops[0].kind).toBe('replaceBlock');
  });

  it('round-trips: applying derived ops reconstructs the proposed file', () => {
    const proposed = `# Title

First paragraph rewritten.

Second paragraph.

Third paragraph rewritten.
`;
    const ops = deriveReplaceOps(DOC, proposed);
    const acceptedIds = new Set(ops.map((op) => op.opId));
    const result = applyOperations(DOC, ops, acceptedIds);
    expect(result.text).toBe(proposed);
  });

  it('derives a DeleteBlock when the proposal drops a trailing block', () => {
    const proposed = `# Title

First paragraph.

Second paragraph.
`;
    const ops = deriveReplaceOps(DOC, proposed);
    expect(ops.some((op) => op.kind === 'deleteBlock')).toBe(true);
  });

  it('derives an InsertAfter when the proposal appends a block', () => {
    const proposed = `${DOC}\nFourth paragraph.\n`;
    const ops = deriveReplaceOps(DOC, proposed);
    expect(ops.some((op) => op.kind === 'insertAfter')).toBe(true);
  });
});

describe('buildChangeProposal', () => {
  it('captures the base block map and schema version', () => {
    const proposal = buildChangeProposal({
      threadId: 42,
      filePath: '/notes/x.md',
      baseContentHash: 'abc',
      baseDoc: DOC,
      operations: [],
      summary: 'noop'
    });
    expect(proposal.schemaVersion).toBe(CHANGE_PROPOSAL_SCHEMA_VERSION);
    expect(proposal.threadId).toBe(42);
    expect(proposal.baseBlockMap.length).toBe(segmentMarkdown(DOC).length);
  });
});
