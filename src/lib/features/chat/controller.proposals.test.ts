import { describe, expect, it, vi } from 'vitest';
import { createChatController } from './controller.svelte';
import type { ChatApi } from './api';
import type { ChatAgentProposal, ChatConversation, ChatEventMap, ChatMessage, ChatSettings } from './types';
import { settings, message, conversation, proposal, forgottenChat, fakeApi } from './chatTestSupport';

describe('chat controller proposals', () => {
  it('reloads unresolved proposals without opening their notes when a conversation opens', async () => {
    const fake = fakeApi();
    vi.mocked(fake.api.listPendingProposals).mockResolvedValue([proposal()]);
    const onProposalAvailable = vi.fn();
    const controller = createChatController(fake.api, {
      onProposalAvailable
    });

    await controller.initialize('conversation-1');

    expect(fake.api.listPendingProposals).toHaveBeenCalledWith('conversation-1');
    expect(controller.getSnapshot().proposals).toEqual([proposal()]);
    expect(onProposalAvailable).toHaveBeenCalledWith(proposal());
  });

  it('queues proposal events for explicit review', async () => {
    const fake = fakeApi();
    const onProposalAvailable = vi.fn();
    const controller = createChatController(fake.api, {
      onProposalAvailable
    });
    await controller.initialize('conversation-1');

    fake.emit('chat://proposal', proposal());

    expect(controller.getSnapshot().proposals).toEqual([proposal()]);
    expect(onProposalAvailable).toHaveBeenCalledWith(proposal());
  });

  it('replaces a superseded target from an earlier run in the visible proposal queue', async () => {
    const fake = fakeApi();
    const controller = createChatController(fake.api);
    await controller.initialize('conversation-1');

    fake.emit('chat://proposal', proposal({ id: 'proposal-old' }));
    fake.emit(
      'chat://proposal',
      proposal({
        id: 'proposal-new',
        runId: 'run-2',
        preview: { proposedEditorMarkdown: '# Project plan\n\nLatest' }
      })
    );

    expect(controller.getSnapshot().proposals).toEqual([
      proposal({
        id: 'proposal-new',
        runId: 'run-2',
        preview: { proposedEditorMarkdown: '# Project plan\n\nLatest' }
      })
    ]);
  });

  it('commits edited proposal Markdown and removes the resolved item', async () => {
    const fake = fakeApi();
    vi.mocked(fake.api.listPendingProposals).mockResolvedValue([proposal()]);
    const onProposalResolved = vi.fn();
    const controller = createChatController(fake.api, { onProposalResolved });
    await controller.initialize('conversation-1');

    await controller.keepProposal('proposal-1', '# Project plan\n\nEdited');

    expect(fake.api.commitAgentProposal).toHaveBeenCalledWith(
      'proposal-1',
      '# Project plan\n\nEdited'
    );
    expect(controller.getSnapshot().proposals).toEqual([]);
    expect(onProposalResolved).toHaveBeenCalledWith('proposal-1');
  });

  it('surfaces a committed proposal history warning without replaying the write', async () => {
    const fake = fakeApi();
    vi.mocked(fake.api.listPendingProposals).mockResolvedValue([proposal()]);
    vi.mocked(fake.api.commitAgentProposal).mockResolvedValue({
      status: 'committed',
      committedMarkdown: '# Edited',
      applied: {
        kind: 'updateNote',
        path: '/vault/Project plan.md',
        previousPath: '/vault/Project plan.md'
      },
      noteId: 'note-1',
      message: null,
      commitWarning: {
        message: 'History finalization is pending.',
        issues: [{ stage: 'historyFinalization', message: 'store unavailable' }]
      }
    });
    const controller = createChatController(fake.api);
    await controller.initialize('conversation-1');

    await controller.keepProposal('proposal-1');

    expect(fake.api.commitAgentProposal).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().proposals).toEqual([]);
    expect(controller.getSnapshot().error).toBe('History finalization is pending.');
  });

  it('removes a resolved proposal mirrored from another chat pane', async () => {
    const fake = fakeApi();
    vi.mocked(fake.api.listPendingProposals).mockResolvedValue([proposal()]);
    const controller = createChatController(fake.api);
    await controller.initialize('conversation-1');

    controller.removeResolvedProposal('proposal-1');

    expect(controller.getSnapshot().proposals).toEqual([]);
    expect(fake.api.commitAgentProposal).not.toHaveBeenCalled();
  });

  it('dismisses a proposal without writing it', async () => {
    const fake = fakeApi();
    fake.api.dismissAgentProposal.mockResolvedValue(proposal({ status: 'dismissed' }));
    vi.mocked(fake.api.listPendingProposals).mockResolvedValue([proposal()]);
    const controller = createChatController(fake.api);
    await controller.initialize('conversation-1');

    await controller.dismissProposal('proposal-1');

    expect(fake.api.dismissAgentProposal).toHaveBeenCalledWith('proposal-1');
    expect(fake.api.commitAgentProposal).not.toHaveBeenCalled();
    expect(controller.getSnapshot().proposals).toEqual([]);
  });

  it('keeps a conflicted proposal queued for review', async () => {
    const fake = fakeApi();
    vi.mocked(fake.api.listPendingProposals).mockResolvedValue([proposal()]);
    vi.mocked(fake.api.commitAgentProposal).mockResolvedValue({
      status: 'conflict',
      committedMarkdown: null,
      applied: null,
      noteId: null,
      message: 'Note changed on disk.'
    });
    const controller = createChatController(fake.api);
    await controller.initialize('conversation-1');

    await controller.keepProposal('proposal-1', '# Edited');

    expect(controller.getSnapshot().proposals).toEqual([
      proposal({ status: 'conflict' })
    ]);
    expect(controller.getSnapshot().error).toBe('Note changed on disk.');
  });


});
