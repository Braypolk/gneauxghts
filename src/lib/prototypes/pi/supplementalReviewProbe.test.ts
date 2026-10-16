import { describe, expect, it, vi } from 'vitest';
import type { EditorView } from '@codemirror/view';
import type { ChatProposalDraft } from '$lib/features/chat/types';
import { assertSupplementalReviewDraft, assertSupplementalReviewMounted, reacquireSupplementalReviewCheckpoint, supplementalRefinementPrompt,
  verifySupplementalReviewRestored, type SupplementalReviewState } from './supplementalReviewProbe';

const draft: ChatProposalDraft = { version: 9, markdown: 'Latest human draft after refinement.', title: 'Latest title',
  path: '/synthetic/Chats/Pi/Latest title.md', decisions: [{ id: 'creation', baseFrom: 0, baseTo: 0,
    proposedFrom: 0, proposedTo: 10, oldText: '', newText: 'Initial draft', from: 0, to: 36, status: 'modified' }] };
const state: SupplementalReviewState = { proposalId: 'pi-review-17', conversationId: 'pi-4', reviewId: 'native-review',
  beforeRefinement: { ...draft, version: 6 }, refinedDraft: { ...draft, version: 7, decisions: [] }, retainedDraft: draft, checks: [] };
const mounted = () => ({ connected: true, markdown: draft.markdown, title: draft.title,
  projection: { reviewId: state.reviewId, hunks: structuredClone(draft.decisions) } });

describe('supplemental exact latest draft review proof', () => {
  it('waits for location acknowledgement and reacquires after compact chat navigation unmounts the old editor', async () => {
    const previousDraft = { ...draft, version: 8, path: '/synthetic/Latest title.md' };
    const oldMount = mounted();
    const openChat = async () => { oldMount.connected = false; };
    await openChat();
    expect(() => assertSupplementalReviewMounted(state, oldMount)).toThrow(/connection differs/);
    const events: string[] = [];
    let reads = 0;
    const api = { listPendingProposals: vi.fn(), getProposalDraft: vi.fn(async () => {
      reads++; events.push(reads === 1 ? 'old-location-read' : 'acknowledged-location-read');
      return reads === 1 ? previousDraft : structuredClone(draft);
    }) };
    const titleField = { value: draft.title };
    const fresh = { dom: { isConnected: true, closest: () => ({ querySelector: () => titleField }) },
      state: { doc: { toString: () => draft.markdown }, field: () => mounted().projection } } as unknown as EditorView;
    const openReview = vi.fn(async (id: string, reviewId?: string) => {
      events.push('normal-review-reacquired');
      expect(id).toBe(state.proposalId); expect(reviewId).toBe(state.reviewId);
      expect(reads).toBe(2);
      return fresh;
    });
    const until = async <T>(read: () => T | Promise<T>): Promise<NonNullable<T>> => {
      for (let attempt = 0; attempt < 3; attempt++) { const value = await read(); if (value) return value as NonNullable<T>; }
      throw new Error('Test predicate did not converge');
    };
    const result = await reacquireSupplementalReviewCheckpoint({ api, openReview, openChat, until,
      proposalId: state.proposalId, reviewId: state.reviewId, previousDraft, path: draft.path });
    expect(result.view).toBe(fresh); expect(result.draft).toEqual(draft);
    expect(events).toEqual(['old-location-read', 'acknowledged-location-read', 'normal-review-reacquired', 'acknowledged-location-read']);
    expect(oldMount.connected).toBe(false);
  });
  it('captures the entire acknowledged draft in the normal composer request', () => {
    const prompt = supplementalRefinementPrompt(state.proposalId, draft);
    expect(prompt.split('\n')[0]).toBe('PI_SUPPLEMENTAL_REVIEW:REFINE:pi-review-17');
    expect(JSON.parse(prompt.split('\nExpected latest acknowledged draft: ')[1])).toEqual(draft);
    expect(() => supplementalRefinementPrompt('legacy-proposal', draft)).toThrow(/durable Pi review identity/);
  });
  it('accepts only the complete acknowledged version, including precise hunk coordinates and choices', () => {
    expect(() => assertSupplementalReviewDraft(draft, structuredClone(draft))).not.toThrow();
    const changed: ChatProposalDraft[] = [ { ...draft, version: 10 }, { ...draft, markdown: 'Older body' },
      { ...draft, title: 'Older title' }, { ...draft, path: '/synthetic/Previous.md' }, { ...draft, decisions: [] },
      { ...draft, decisions: [{ ...draft.decisions[0], status: 'kept' }] },
      { ...draft, decisions: [{ ...draft.decisions[0], from: 1 }] } ];
    for (const actual of changed) expect(() => assertSupplementalReviewDraft(draft, actual)).toThrow(/exact acknowledged/);
  });
  it('requires mounted identity, text, title and every retained hunk even for byte-identical unrelated editors', () => {
    expect(() => assertSupplementalReviewMounted(state, mounted())).not.toThrow();
    for (const actual of [ { ...mounted(), connected: false }, { ...mounted(), markdown: 'stale' },
      { ...mounted(), title: 'stale' }, { ...mounted(), projection: null },
      { ...mounted(), projection: { reviewId: 'another-review', hunks: draft.decisions } },
      { ...mounted(), projection: { reviewId: state.reviewId, hunks: [] } } ])
      expect(() => assertSupplementalReviewMounted(state, actual)).toThrow(/Supplemental mounted/);
  });
  it('fails restart before opening any review when the durable checkpoint version changed', async () => {
    const openReview = vi.fn();
    const api = { listPendingProposals: vi.fn().mockResolvedValue([{ id: state.proposalId, preview: { reviewId: state.reviewId } }]),
      getProposalDraft: vi.fn().mockResolvedValue({ ...draft, version: draft.version + 1 }) };
    await expect(verifySupplementalReviewRestored({ api, state, openReview, openChat: vi.fn(),
      until: vi.fn() })).rejects.toThrow(/exact acknowledged/);
    expect(openReview).not.toHaveBeenCalled();
  });
  it.each([{ pending: [] }, { pending: [{ id: state.proposalId, preview: { reviewId: 'superseded-review' } }] }])('rejects implicit settlement or changed review identity after restart', async ({ pending }) => {
    const openReview = vi.fn(), getProposalDraft = vi.fn();
    await expect(verifySupplementalReviewRestored({ api: { listPendingProposals: vi.fn().mockResolvedValue(pending), getProposalDraft },
      state, openReview, openChat: vi.fn(), until: vi.fn() })).rejects.toThrow(/changed or settled/);
    expect(openReview).not.toHaveBeenCalled(); expect(getProposalDraft).not.toHaveBeenCalled();
  });
});
