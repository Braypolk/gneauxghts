import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import ChatPanel from '$lib/features/chat/ChatPanel.svelte';
import { createChatController } from '$lib/features/chat/controller.svelte';
import { conversation, fakeApi, proposal } from '$lib/features/chat/chatTestSupport';
import type { ProposalReviewSessionSnapshot } from '$lib/features/proposals/types';
import { prepareFailureReviewControls } from './interactiveFailureReview';

const until = async <T>(read: () => T | Promise<T>): Promise<NonNullable<T>> => {
  for (let poll = 0; poll < 3; poll++) { const value = await read(); if (value) return value as NonNullable<T>; }
  throw new Error('Owning review strip did not mount');
};
const working = () => ({ connected: true, markdown: 'Acknowledged synthetic review', title: 'Synthetic review' });

describe('checkpoint failure review owner setup', () => {
  it('mounts A’s exact controls through normal controller selection when only foreign B chat remains', async () => {
    const fake = fakeApi(), pending = proposal({ id: 'review-A', conversationId: 'A', kind: 'create' });
    const records = ['A', 'B'].map(id => conversation({ id, title: `Chat ${id}` }));
    fake.api.listConversations.mockResolvedValue(records);
    fake.api.getConversation.mockImplementation(async id => records.find(item => item.id === id)!);
    fake.api.listPendingProposals.mockImplementation(async id => id === 'A' ? [pending] : []);
    const controller = createChatController(fake.api);
    await controller.initialize('B');
    const snapshot: ProposalReviewSessionSnapshot = { proposalId: pending.id, notePath: '/vault/Synthetic review.md', title: 'Synthetic review',
      totalHunks: 1, unresolvedHunks: 1, isApplying: false, isConflicted: false, error: 'Synthetic review checkpoint persistence failure', creation: true };
    const body = () => render(ChatPanel, { props: { controller, autoInitialize: false, proposalSnapshot: snapshot } }).body;
    const strip = () => body().includes('data-proposal-id="review-A"') && body().includes('data-proposal-strip="active"');
    try {
      // This is the previous harness's actual failure: a mounted foreign chat
      // cannot project another conversation’s global review checkpoint error.
      expect(strip()).toBe(false);
      expect(body()).not.toContain('Synthetic review checkpoint persistence failure');
      const selectConversation = vi.fn(async (id: string) => { await controller.openConversation(id); });
      expect(await prepareFailureReviewControls({ conversationId: 'A', proposalId: pending.id,
        selectConversation, strip, working, until })).toEqual({ conversationId: 'A', proposalId: 'review-A', exactStripMountedBeforeFault: true });
      expect(selectConversation).toHaveBeenCalledExactlyOnceWith('A');
      expect(body()).toContain('Synthetic review checkpoint persistence failure');
    } finally { controller.dispose(); }
  });
  it('fails before fault setup when ordinary selection does not mount the owning controls', async () => {
    const selectConversation = vi.fn(async () => {});
    await expect(prepareFailureReviewControls({ conversationId: 'A', proposalId: 'review-A', selectConversation,
      strip: () => undefined, working, until })).rejects.toThrow('did not mount');
  });
  it('rejects owner selection that replaces or changes the mounted working editor', async () => {
    let changed = false;
    for (const result of [{ ...working(), connected: false }, { ...working(), markdown: 'Replacement' }, { ...working(), title: 'Replacement' }]) {
      changed = false;
      await expect(prepareFailureReviewControls({ conversationId: 'A', proposalId: 'review-A',
        selectConversation: async () => { changed = true; }, strip: () => true, until,
        working: () => changed ? result : working() })).rejects.toThrow('replaced the working editor');
    }
  });
});
