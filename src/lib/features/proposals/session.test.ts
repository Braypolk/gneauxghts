import { get } from 'svelte/store';
import { afterEach, describe, expect, it } from 'vitest';

import { buildReviewChanges } from '$lib/features/inbox/reviewChanges';
import type { AiChangePreview } from '$lib/types/ai';

import {
  activeProposalSession,
  clearProposalSession,
  getPendingProposalNotice,
  getReviewOverlayModel,
  getSelectedApprovedChangeCount,
  setAllProposalOps,
  toggleProposalChange,
  toggleProposalOp,
  type ProposalSession
} from './session';

const CURRENT = `# Title

First paragraph.

Second paragraph.

Third paragraph.
`;

function preview(newMarkdown: string): AiChangePreview {
  return {
    change: {
      kind: 'updateNote',
      path: '/notes/x.md',
      baseContentHash: 'abc123',
      newTitle: 'Title',
      newMarkdown
    },
    currentTitle: 'Title',
    currentMarkdown: CURRENT
  };
}

function seedSession(newMarkdown: string): ProposalSession {
  const reviewChanges = buildReviewChanges([preview(newMarkdown)]);
  const session: ProposalSession = {
    itemId: 1,
    kind: 'integrate',
    status: 'pendingApproval',
    title: 'Job',
    summary: '',
    sourcePath: '/notes/x.md',
    sourceTitle: 'Title',
    sourceMarkdown: CURRENT,
    reviewChanges,
    notePaths: ['/notes/x.md'],
    focusedPath: '/notes/x.md',
    createdAtMillis: 0,
    updatedAtMillis: 0
  };
  activeProposalSession.set(session);
  return session;
}

function updateChange() {
  const change = get(activeProposalSession)!.reviewChanges[0];
  if (change.kind !== 'updateNote') {
    throw new Error('expected updateNote');
  }
  return change;
}

afterEach(() => {
  clearProposalSession();
});

describe('toggleProposalOp', () => {
  it('rejects a single op, leaving others accepted', () => {
    seedSession(`# Title

First paragraph edited.

Second paragraph.

Third paragraph edited.
`);
    const change = updateChange();
    const [first] = change.ops;
    toggleProposalOp(change.id, first.opId, false);

    const after = updateChange();
    expect(after.acceptedOpIds).not.toContain(first.opId);
    expect(after.acceptedOpIds.length).toBe(change.ops.length - 1);
  });

  it('re-accepting an op re-selects the note', () => {
    seedSession(CURRENT.replace('First paragraph.', 'First paragraph edited.'));
    const change = updateChange();
    const [first] = change.ops;

    toggleProposalChange(change.id, false);
    expect(updateChange().selected).toBe(false);

    toggleProposalOp(change.id, first.opId, true);
    expect(updateChange().selected).toBe(true);
  });

  it('does not duplicate an op id when accepting twice', () => {
    seedSession(CURRENT.replace('First paragraph.', 'First paragraph edited.'));
    const change = updateChange();
    const [first] = change.ops;

    toggleProposalOp(change.id, first.opId, true);
    toggleProposalOp(change.id, first.opId, true);

    const after = updateChange();
    expect(after.acceptedOpIds.filter((id) => id === first.opId)).toHaveLength(1);
  });
});

describe('setAllProposalOps', () => {
  it('clears all accepted ops when rejecting', () => {
    seedSession(`# Title

First paragraph edited.

Second paragraph.

Third paragraph edited.
`);
    const change = updateChange();
    setAllProposalOps(change.id, false);
    expect(updateChange().acceptedOpIds).toEqual([]);
  });

  it('restores all ops when accepting', () => {
    seedSession(`# Title

First paragraph edited.

Second paragraph.

Third paragraph edited.
`);
    const change = updateChange();
    setAllProposalOps(change.id, false);
    setAllProposalOps(change.id, true);
    expect(updateChange().acceptedOpIds).toEqual(change.ops.map((op) => op.opId));
  });
});

describe('getSelectedApprovedChangeCount', () => {
  it('counts an op-subset update as one approved change', () => {
    seedSession(`# Title

First paragraph edited.

Second paragraph.

Third paragraph edited.
`);
    const change = updateChange();
    toggleProposalOp(change.id, change.ops[0].opId, false);
    expect(getSelectedApprovedChangeCount(get(activeProposalSession))).toBe(1);
  });

  it('counts a fully-rejected, title-unchanged update as zero', () => {
    seedSession(CURRENT.replace('First paragraph.', 'First paragraph edited.'));
    const change = updateChange();
    setAllProposalOps(change.id, false);
    expect(getSelectedApprovedChangeCount(get(activeProposalSession))).toBe(0);
  });
});

describe('getPendingProposalNotice', () => {
  it('reports a notice for a path the session touches', () => {
    const session = seedSession(CURRENT.replace('First paragraph.', 'First paragraph edited.'));
    const notice = getPendingProposalNotice(session, '/notes/x.md');
    expect(notice).toEqual({ itemId: 1, changeCount: 1 });
  });

  it('returns null for an untouched path', () => {
    const session = seedSession(CURRENT.replace('First paragraph.', 'First paragraph edited.'));
    expect(getPendingProposalNotice(session, '/notes/other.md')).toBeNull();
  });

  it('returns null for a null session or path', () => {
    expect(getPendingProposalNotice(null, '/notes/x.md')).toBeNull();
    const session = seedSession(CURRENT);
    expect(getPendingProposalNotice(session, null)).toBeNull();
  });
});

describe('getReviewOverlayModel', () => {
  it('builds a read-only overlay model for the open note', () => {
    const proposed = CURRENT.replace('First paragraph.', 'First paragraph edited.');
    const session = seedSession(proposed);
    const model = getReviewOverlayModel(session, '/notes/x.md');
    expect(model).not.toBeNull();
    expect(model?.itemId).toBe(1);
    expect(model?.changeId).toBe('updateNote:/notes/x.md');
    expect(model?.currentMarkdown).toBe(CURRENT);
    expect(model?.proposedMarkdown).toBe(proposed);
    expect(model?.titleChanged).toBe(false);
    expect(model?.opCounts.total).toBeGreaterThan(0);
    expect(model?.opCounts.accepted).toBe(model?.opCounts.total);
  });

  it('reflects op-level rejections in the accepted count', () => {
    const session = seedSession(`# Title

First paragraph edited.

Second paragraph.

Third paragraph edited.
`);
    const change = updateChange();
    toggleProposalOp(change.id, change.ops[0].opId, false);
    const model = getReviewOverlayModel(get(activeProposalSession), '/notes/x.md');
    expect(model?.opCounts.accepted).toBe(model!.opCounts.total - 1);
  });

  it('returns null for an untouched path or null session/path', () => {
    const session = seedSession(CURRENT.replace('First paragraph.', 'First paragraph edited.'));
    expect(getReviewOverlayModel(session, '/notes/other.md')).toBeNull();
    expect(getReviewOverlayModel(null, '/notes/x.md')).toBeNull();
    expect(getReviewOverlayModel(session, null)).toBeNull();
  });
});
