import { describe, expect, it, vi } from 'vitest';
import type { ChatApi } from '$lib/features/chat/api';
import { ChatControllerStore } from '$lib/features/chat/controller.svelte';
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
    const loadDurableProposalIfOpen = vi.fn(async () => true);
    const loadDurableProposal = vi.fn(async () => true);
    const coordinator = new NotepadChatCoordinator(
      ['chat'],
      {
        api: {
          listPendingProposals: vi.fn(async () => [pending])
        } as unknown as ChatApi,
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
    ) as ChatControllerStore;
    controller.proposals = [pending];
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
