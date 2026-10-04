import { describe, expect, it, vi } from 'vitest';
import type { DurableProposalReviewRequest } from '$lib/features/proposals/types';
import { fakeApi } from '$lib/features/chat/chatTestSupport';
import type { ChatAgentProposal } from '$lib/features/chat/types';
import { createEmptySessionSnapshot } from '$lib/features/notepad/session/session';
import { createNoteDraftState } from '$lib/features/notepad/state/noteStore';
import {
  NotepadChatCoordinator,
  type NotepadChatCoordinatorDeps
} from './notepadChatCoordinator.svelte';

function proposal(): ChatAgentProposal {
  return {
    id: 'proposal-1',
    runId: 'run-1',
    conversationId: 'conversation-1',
    assistantMessageId: 'message-1',
    kind: 'update',
    noteId: 'note-1',
    suggestedPath: '/vault/Plan.md',
    title: 'Plan',
    baseHash: 'hash-1',
    payload: {},
    preview: {
      reviewId: 'review-1',
      notePath: '/vault/Plan.md',
      title: 'Plan',
      baseContentHash: 'hash-1',
      baseEditorMarkdown: 'Before',
      proposedEditorMarkdown: 'After',
      hunks: []
    },
    status: 'pending',
    createdAtMillis: 1,
    updatedAtMillis: 1
  };
}

describe('NotepadChatCoordinator chat surface registry', () => {
  it('uses passive display on arrival and navigation only for explicit review', async () => {
    const pending = proposal();
    const fake = fakeApi();
    fake.api.listPendingProposals.mockResolvedValue([pending]);
    const loadDurableProposalIfOpen = vi.fn(async () => true);
    const loadDurableProposal = vi.fn(async () => true);
    const coordinator = new NotepadChatCoordinator(
      ['chat'],
      {
        api: fake.api,
        getProposalOrchestration: () => ({
          loadDurableProposalIfOpen,
          loadDurableProposal
        })
      } as unknown as NotepadChatCoordinatorDeps<'chat'>
    );

    await coordinator.showAgentProposalIfOpen('chat', pending);

    expect(loadDurableProposalIfOpen).toHaveBeenCalledOnce();
    expect(loadDurableProposal).not.toHaveBeenCalled();

    await coordinator.reviewAgentProposal('chat', pending);

    expect(loadDurableProposal).toHaveBeenCalledOnce();

    loadDurableProposalIfOpen.mockClear();
    const controller = coordinator.getController(
      'chat'
    );
    await controller.initialize('conversation-1');
    loadDurableProposalIfOpen.mockClear();
    const openedDocument = createNoteDraftState({
      ...createEmptySessionSnapshot(),
      currentNoteId: 'note-1',
      currentNotePath: '/vault/Plan.md',
      title: 'Plan',
      bodyMarkdown: 'Before'
    });

    await coordinator.showPendingProposalsForDocument(
      openedDocument
    );

    expect(loadDurableProposalIfOpen).toHaveBeenCalledOnce();
  });

  it('focuses registered pane surfaces and releases them when unmounted', () => {
    const coordinator = new NotepadChatCoordinator(
      [],
      {} as NotepadChatCoordinatorDeps<'chat'>
    );
    const focusComposer = vi.fn(() => true);

    expect(coordinator.focusComposer('chat')).toBe(false);

    coordinator.setSurfaceHandle('chat', { focusComposer });
    expect(coordinator.focusComposer('chat')).toBe(true);
    expect(focusComposer).toHaveBeenCalledTimes(1);

    coordinator.setSurfaceHandle('chat', null);
    expect(coordinator.focusComposer('chat')).toBe(false);
  });
});

it.each(['commit', 'dismiss'] as const)('settles a retained review through the durable API after chat teardown (%s)', async action => {
  const pending = proposal();
  const fake = fakeApi();
  fake.api.listPendingProposals.mockResolvedValue([pending]);
  fake.api.dismissAgentProposal.mockResolvedValue({ ...pending, status: 'dismissed' });
  const loadDurableProposal = vi.fn<(request: DurableProposalReviewRequest) => Promise<boolean>>(async () => true);
  const coordinator = new NotepadChatCoordinator(['chat'], {
    api: fake.api,
    getProposalOrchestration: () => ({ loadDurableProposal })
  } as unknown as NotepadChatCoordinatorDeps<'chat'>);
  await coordinator.reviewAgentProposal('chat', pending);
  const request = loadDurableProposal.mock.calls[0][0];
  coordinator.dispose();
  if (action === 'commit') {
    await expect(request.commit('Reviewed text')).resolves.toMatchObject({ status: 'committed' });
    expect(fake.api.commitAgentProposal).toHaveBeenCalledExactlyOnceWith(pending.id, 'Reviewed text');
  } else {
    await expect(request.dismiss()).resolves.toBeUndefined();
    expect(fake.api.dismissAgentProposal).toHaveBeenCalledExactlyOnceWith(pending.id);
  }
});
