import { describe, expect, it } from 'vitest';
import type { ChatProposalDraft } from '$lib/features/chat/types';
import type { CommitNoteReviewResult, ReviewHunkState } from '$lib/types/proposals';
import { assertSharedKeepDraft, assertSharedMountedReview, assertSharedPublication, expectedSharedEditorMarkdown, expectedSharedKeepDraft, type SharedKeepPlan } from './sharedKeepProof';

const hunk = (id: string, status: ReviewHunkState['status']): ReviewHunkState => ({ id, status, baseFrom: 0, baseTo: 0, proposedFrom: 0, proposedTo: 4, oldText: '', newText: 'Body', from: 0, to: 4 });
const draft = (): ChatProposalDraft => ({ version: 7, markdown: 'Body\n', title: 'Saved', path: '/vault/Saved.md', decisions: [hunk('pending', 'pending'), hunk('modified', 'modified'), hunk('kept', 'kept'), hunk('undone', 'undone')] });
const plan = (): SharedKeepPlan => ({ proposalId: 'proposal', reviewId: 'review', expectedNoteId: 'stable', reviewedDraft: draft(), expectedKeepDraft: expectedSharedKeepDraft(draft(), 'review'), expectedEditorMarkdown: 'Body\n', expectedDraftSha256: '', expectedEditorSha256: '' });
const receipt = (): Extract<CommitNoteReviewResult, { status: 'committed' }> => ({ status: 'committed', noteId: 'stable', committedMarkdown: 'Body\n', message: null, applied: { kind: 'updateNote', path: '/vault/Saved.md', previousPath: null } });
const canonical = () => ({ noteId: 'stable', path: '/vault/Saved.md', title: 'Saved', markdown: 'Body\n' });

describe('independent shared normal Keep proof', () => {
  it('predicts all resolution states and exactly one changed checkpoint without mutating the acknowledged input', () => {
    const before = draft(), snapshot = structuredClone(before);
    const expected = expectedSharedKeepDraft(before, 'review');
    expect(expected.version).toBe(8);
    expect(expected.decisions.map(value => value.status)).toEqual(['kept', 'kept', 'kept', 'undone']);
    expect(before).toEqual(snapshot);
    expect(expectedSharedKeepDraft(expected, 'review')).toEqual(expected);
  });
  it.each(['version', 'markdown', 'title', 'path', 'decisions'] as const)('rejects a settled checkpoint with wrong %s', field => {
    const expected = plan().expectedKeepDraft, actual = structuredClone(expected);
    if (field === 'version') actual.version++;
    else if (field === 'decisions') actual.decisions[0].status = 'pending';
    else actual[field] += 'wrong';
    expect(() => assertSharedKeepDraft(expected, actual)).toThrow('predicted full draft');
  });
  it('binds the connected mounted body/title and all decisions to the exact review identity', () => {
    const before = draft(), mounted = { connected: true, markdown: before.markdown, title: before.title, projection: { reviewId: 'review', hunks: before.decisions } };
    expect(() => assertSharedMountedReview(before, 'review', mounted)).not.toThrow();
    for (const wrong of [{ connected: false }, { projection: null }, { projection: { ...mounted.projection, reviewId: 'foreign' } }, { markdown: 'wrong' }, { title: 'wrong' }, { projection: { ...mounted.projection, hunks: [] } }]) {
      expect(() => assertSharedMountedReview(before, 'review', { ...mounted, ...wrong })).toThrow();
    }
  });
  it('applies only the native body normalization and matching filename title-heading contract', () => {
    const body = (markdown: string) => expectedSharedEditorMarkdown({ markdown, path: '/vault/Saved.md' });
    expect(body('Body\n\n')).toBe('Body\n\n');
    expect(body('# Saved\r\n\r\nBody\r\n')).toBe('Body');
    expect(body('# Other\n\nBody\n')).toBe('# Other\n\nBody\n');
    expect(body('\\[\\[Origin|Open in chat\\]\\]')).toBe('[[Origin|Open in chat]]');
    expect(() => body('---\nid: invented\n---\nBody')).toThrow('frontmatter');
  });
  it('requires exact receipt bytes, target and stable identity plus independent canonical read-back', () => {
    expect(() => assertSharedPublication(plan(), receipt(), canonical())).not.toThrow();
    for (const wrong of [{ committedMarkdown: 'prefix Body\n suffix' }, { noteId: 'other' }, { applied: { ...receipt().applied!, path: '/vault/Other.md' } }]) {
      expect(() => assertSharedPublication(plan(), { ...receipt(), ...wrong }, canonical())).toThrow();
    }
    for (const wrong of [{ noteId: 'other' }, { title: 'Other' }, { path: '/vault/Other.md' }, { markdown: 'Body' }]) {
      expect(() => assertSharedPublication(plan(), receipt(), { ...canonical(), ...wrong })).toThrow();
    }
  });
});
