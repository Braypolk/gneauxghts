import { describe, expect, it } from 'vitest';

import type { ReviewUpdateChange } from '$lib/features/inbox/reviewChanges';
import { applyOperations, deriveReplaceOps } from '$lib/features/notepad/blocks/blockOps';

import {
  buildUiProposal,
  buildUiProposalFromUpdate,
  reviewChangeToBlockOpViews,
  toBlockOpViews
} from './proposalAdapter';

const CURRENT = `# Title

First paragraph.

Second paragraph.

Third paragraph.
`;

function updateChange(proposedMarkdown: string, overrides: Partial<ReviewUpdateChange> = {}): ReviewUpdateChange {
  const currentMarkdown = overrides.currentMarkdown ?? CURRENT;
  const ops = deriveReplaceOps(currentMarkdown, proposedMarkdown);
  return {
    id: 'updateNote:/notes/x.md',
    kind: 'updateNote',
    path: '/notes/x.md',
    baseContentHash: 'abc123',
    currentTitle: 'Title',
    currentMarkdown: CURRENT,
    proposedTitle: 'Title',
    proposedMarkdown,
    titleChanged: false,
    selected: true,
    ops,
    acceptedOpIds: ops.map((op) => op.opId),
    ...overrides
  };
}

describe('buildUiProposalFromUpdate', () => {
  it('derives replace ops for changed blocks and captures the base map', () => {
    const proposed = CURRENT.replace('Second paragraph.', 'Second paragraph rewritten.');
    const proposal = buildUiProposalFromUpdate(updateChange(proposed));

    expect(proposal.schemaVersion).toBe(2);
    expect(proposal.filePath).toBe('/notes/x.md');
    expect(proposal.baseContentHash).toBe('abc123');
    expect(proposal.fullFileFallback).toBe(proposed);
    expect(proposal.operations).toHaveLength(1);
    expect(proposal.operations[0].kind).toBe('replaceBlock');
  });

  it('produces a proposal whose ops reconstruct the proposed file', () => {
    const proposed = `# Title

First paragraph rewritten.

Second paragraph.

Third paragraph rewritten.
`;
    const proposal = buildUiProposalFromUpdate(updateChange(proposed));
    const acceptedIds = new Set(proposal.operations.map((op) => op.opId));
    const result = applyOperations(CURRENT, proposal.operations, acceptedIds);
    expect(result.text).toBe(proposed);
  });

  it('uses the placeholder thread id (not persisted)', () => {
    const proposal = buildUiProposalFromUpdate(updateChange(CURRENT));
    expect(proposal.threadId).toBe(-1);
  });

  it('summarizes a title change when titleChanged is set', () => {
    const proposal = buildUiProposalFromUpdate(
      updateChange(CURRENT, { titleChanged: true, proposedTitle: 'New Title' })
    );
    expect(proposal.summary).toContain('New Title');
  });
});

describe('buildUiProposal', () => {
  it('returns null for non-update changes', () => {
    const create = {
      id: 'createNote:0:Note',
      kind: 'createNote' as const,
      change: { kind: 'createNote' as const, suggestedTitle: 'Note', markdown: '# Note' },
      selected: true
    };
    expect(buildUiProposal(create)).toBeNull();
  });
});

describe('toBlockOpViews', () => {
  it('pairs replace ops with before/after text', () => {
    const proposed = CURRENT.replace('First paragraph.', 'First paragraph edited.');
    const proposal = buildUiProposalFromUpdate(updateChange(proposed));
    const views = toBlockOpViews(proposal, CURRENT);
    const replace = views.find((view) => view.op.kind === 'replaceBlock');
    expect(replace?.before).toBe('First paragraph.');
    expect(replace?.after).toBe('First paragraph edited.');
  });

  it('marks a delete op with empty after', () => {
    const proposed = `# Title

First paragraph.

Second paragraph.
`;
    const proposal = buildUiProposalFromUpdate(updateChange(proposed));
    const views = toBlockOpViews(proposal, CURRENT);
    const del = views.find((view) => view.op.kind === 'deleteBlock');
    expect(del).toBeTruthy();
    expect(del?.after).toBe('');
    expect(del?.before).toContain('Third paragraph.');
  });

  it('marks an insert op with empty before', () => {
    const proposed = `${CURRENT}\nFourth paragraph.\n`;
    const proposal = buildUiProposalFromUpdate(updateChange(proposed));
    const views = toBlockOpViews(proposal, CURRENT);
    const insert = views.find(
      (view) => view.op.kind === 'insertAfter' || view.op.kind === 'insertBefore'
    );
    expect(insert).toBeTruthy();
    expect(insert?.before).toBe('');
    expect(insert?.after).toContain('Fourth paragraph.');
  });
});

describe('reviewChangeToBlockOpViews', () => {
  it('returns op views for an update change', () => {
    const proposed = CURRENT.replace('Second paragraph.', 'Second paragraph rewritten.');
    const views = reviewChangeToBlockOpViews(updateChange(proposed));
    expect(views.length).toBeGreaterThan(0);
  });

  it('returns [] for a delete change', () => {
    const del = {
      id: 'deleteNote:/notes/x.md',
      kind: 'deleteNote' as const,
      change: { kind: 'deleteNote' as const, path: '/notes/x.md', baseContentHash: 'abc' },
      title: 'X',
      selected: true
    };
    expect(reviewChangeToBlockOpViews(del)).toEqual([]);
  });
});
