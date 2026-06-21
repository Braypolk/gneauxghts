import { describe, expect, it } from 'vitest';

import type { AiChangePreview } from '$lib/types/ai';
import {
  approvedMarkdownForUpdate,
  buildApprovedChanges,
  buildReviewChanges,
  reviewUpdateOpCounts,
  type ReviewUpdateChange
} from './reviewChanges';

const CURRENT = `# Title

First paragraph.

Second paragraph.

Third paragraph.
`;

function updatePreview(newMarkdown: string, newTitle = 'Title'): AiChangePreview {
  return {
    change: {
      kind: 'updateNote',
      path: '/notes/x.md',
      baseContentHash: 'abc123',
      newTitle,
      newMarkdown
    },
    currentTitle: 'Title',
    currentMarkdown: CURRENT
  };
}

function updateChange(newMarkdown: string): ReviewUpdateChange {
  const [reviewChange] = buildReviewChanges([updatePreview(newMarkdown)]);
  if (reviewChange.kind !== 'updateNote') {
    throw new Error('expected updateNote review change');
  }
  return reviewChange;
}

describe('buildReviewChanges (updateNote ops)', () => {
  it('derives ops and accepts all by default', () => {
    const proposed = CURRENT.replace('Second paragraph.', 'Second paragraph rewritten.');
    const change = updateChange(proposed);
    expect(change.ops.length).toBeGreaterThan(0);
    expect(change.acceptedOpIds).toEqual(change.ops.map((op) => op.opId));
    expect(reviewUpdateOpCounts(change)).toEqual({
      accepted: change.ops.length,
      total: change.ops.length
    });
  });
});

describe('approvedMarkdownForUpdate', () => {
  it('returns the verbatim proposed body when all ops are accepted', () => {
    const proposed = CURRENT.replace('First paragraph.', 'First paragraph edited.');
    const change = updateChange(proposed);
    expect(approvedMarkdownForUpdate(change)).toBe(proposed);
  });

  it('returns the current body when no ops are accepted', () => {
    const proposed = CURRENT.replace('First paragraph.', 'First paragraph edited.');
    const change = { ...updateChange(proposed), acceptedOpIds: [] };
    expect(approvedMarkdownForUpdate(change)).toBe(CURRENT);
  });

  it('applies only the accepted subset of ops to the current body', () => {
    const proposed = `# Title

First paragraph edited.

Second paragraph.

Third paragraph edited.
`;
    const change = updateChange(proposed);
    expect(change.ops.length).toBe(2);

    // Accept only the op that edits the first paragraph.
    const firstOp = change.ops.find((op) => 'originalText' in op && op.originalText.includes('First'));
    expect(firstOp).toBeTruthy();
    const partial = { ...change, acceptedOpIds: [firstOp!.opId] };

    const result = approvedMarkdownForUpdate(partial);
    expect(result).toContain('First paragraph edited.');
    expect(result).toContain('Third paragraph.');
    expect(result).not.toContain('Third paragraph edited.');
  });

  it('returns the proposed body when there are no ops (title-only)', () => {
    const change = { ...updateChange(CURRENT), ops: [], acceptedOpIds: [] };
    expect(approvedMarkdownForUpdate(change)).toBe(CURRENT);
  });
});

describe('buildApprovedChanges (op-aware)', () => {
  it('emits the verbatim proposed markdown when all ops accepted', () => {
    const proposed = CURRENT.replace('Second paragraph.', 'Second paragraph rewritten.');
    const changes = buildApprovedChanges([updateChange(proposed)]);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      kind: 'updateNote',
      path: '/notes/x.md',
      baseContentHash: 'abc123',
      newMarkdown: proposed
    });
  });

  it('emits a partial merge when only a subset of ops accepted', () => {
    const proposed = `# Title

First paragraph edited.

Second paragraph.

Third paragraph edited.
`;
    const change = updateChange(proposed);
    const firstOp = change.ops.find((op) => 'originalText' in op && op.originalText.includes('First'));
    const partial = { ...change, acceptedOpIds: [firstOp!.opId] };

    const changes = buildApprovedChanges([partial]);
    expect(changes).toHaveLength(1);
    const [emitted] = changes;
    expect(emitted.kind).toBe('updateNote');
    if (emitted.kind === 'updateNote') {
      expect(emitted.newMarkdown).toContain('First paragraph edited.');
      expect(emitted.newMarkdown).not.toContain('Third paragraph edited.');
    }
  });

  it('drops the change entirely when no ops accepted and the title is unchanged', () => {
    const proposed = CURRENT.replace('First paragraph.', 'First paragraph edited.');
    const change = { ...updateChange(proposed), acceptedOpIds: [] };
    expect(buildApprovedChanges([change])).toEqual([]);
  });

  it('still emits a title-only change when no ops accepted but the title changed', () => {
    const proposed = CURRENT.replace('First paragraph.', 'First paragraph edited.');
    const change: ReviewUpdateChange = {
      ...updateChange(proposed),
      acceptedOpIds: [],
      proposedTitle: 'Renamed',
      titleChanged: true
    };
    const changes = buildApprovedChanges([change]);
    expect(changes).toHaveLength(1);
    if (changes[0].kind === 'updateNote') {
      expect(changes[0].newTitle).toBe('Renamed');
      expect(changes[0].newMarkdown).toBe(CURRENT);
    }
  });

  it('omits a change that is not selected', () => {
    const proposed = CURRENT.replace('First paragraph.', 'First paragraph edited.');
    const change = { ...updateChange(proposed), selected: false };
    expect(buildApprovedChanges([change])).toEqual([]);
  });
});
