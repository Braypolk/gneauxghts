import { describe, expect, it, vi } from 'vitest';
import { createChatController } from './controller.svelte';
import type { ChatApi } from './api';
import type { ChatAgentProposal, ChatConversation, ChatEventMap, ChatMessage, ChatSettings } from './types';
import { settings, message, conversation, proposal, forgottenChat, fakeApi } from './chatTestSupport';

describe('chat controller conversations', () => {
  it('loads settings, conversations, and the requested conversation', async () => {
    const fake = fakeApi();
    const controller = createChatController(fake.api);

    await controller.initialize('conversation-1');

    expect(fake.api.getConversation).toHaveBeenCalledWith('conversation-1');
    expect(controller.getSnapshot().settings).toEqual(settings);
    expect(controller.getSnapshot().isInitialized).toBe(true);
    expect(controller.getSnapshot().conversation?.id).toBe('conversation-1');
    expect(fake.handlers.size).toBe(12);
  });

  it('opens a durable checkpoint branch as the active conversation', async () => {
    const fake = fakeApi();
    const controller = createChatController(fake.api);
    await controller.initialize('conversation-1');

    const branch = await controller.branchFromMessage('assistant-1');

    expect(fake.api.branchFromMessage).toHaveBeenCalledWith('assistant-1');
    expect(branch?.id).toBe('chat-branch');
    expect(controller.getSnapshot().conversation?.id).toBe('chat-branch');
    expect(controller.getSnapshot().conversations[0]?.id).toBe('chat-branch');
  });

  it('applies a background conversation title without changing response state', async () => {
    const fake = fakeApi();
    const controller = createChatController(fake.api);
    await controller.initialize('conversation-1');

    fake.emit('chat://title-updated', {
      conversationId: 'conversation-1',
      conversation: {
        ...controller.getSnapshot().conversations[0],
        title: 'Refined conversation title'
      }
    });

    expect(controller.getSnapshot().conversation?.title).toBe('Refined conversation title');
    expect(controller.getSnapshot().conversations[0].title).toBe('Refined conversation title');
    expect(controller.getSnapshot().isSending).toBe(false);
  });

  it('starts repeated new-chat drafts without creating persisted conversations', async () => {
    const fake = fakeApi();
    const controller = createChatController(fake.api);
    await controller.initialize('conversation-1');

    controller.startNewConversation();
    controller.startNewConversation({ title: 'A local draft title' });

    expect(fake.api.createConversation).not.toHaveBeenCalled();
    expect(controller.getSnapshot().conversation).toBeNull();
    expect(controller.getSnapshot().conversationDraft).toEqual({
      revision: 2,
      title: 'A local draft title',
      provider: 'openai',
      model: 'test-model',
      reasoningEffort: 'medium',
      vaultAccess: 'approved'
    });
    expect(controller.getSnapshot().modelCapabilities).toEqual({
      images: true,
      audio: false,
      video: false,
      files: true,
      acceptedMimeTypes: [
        'image/png',
        'text/plain',
        'application/pdf'
      ],
      tools: true,
    });
  });

  it('uses the local draft title when the first message creates the conversation', async () => {
    const fake = fakeApi();
    const controller = createChatController(fake.api);
    await controller.initialize('conversation-1');
    controller.startNewConversation({ title: 'Draft title' });

    fake.api.sendMessage.mockResolvedValueOnce({ requestId: 'request-1', conversationId: 'conversation-1', userMessage: message({ id: 'user-1', role: 'user', status: 'completed' }), assistantMessage: message() });
    await expect(controller.send({ content: 'First message' })).resolves.toMatchObject({ status: 'sent' });

    expect(fake.api.createConversation).toHaveBeenCalledWith({
      title: 'Draft title',
      vaultAccess: 'approved',
      provider: 'openai',
      model: 'test-model',
      reasoningEffort: 'medium'
    });
  });

  it('renames the current conversation and refreshes its summary', async () => {
    const fake = fakeApi();
    const renamed = {
      ...conversation(),
      title: 'A title I chose',
      updatedAtMillis: 2
    };
    vi.mocked(fake.api.renameConversation).mockResolvedValue(renamed);
    const controller = createChatController(fake.api);
    await controller.initialize('conversation-1');

    await expect(controller.renameConversation('  A title I chose  ')).resolves.toBe(true);

    expect(fake.api.renameConversation).toHaveBeenCalledWith(
      'conversation-1',
      'A title I chose'
    );
    expect(controller.getSnapshot().conversation?.title).toBe('A title I chose');
    expect(controller.getSnapshot().conversations[0].title).toBe('A title I chose');
  });

  it('forgets the current conversation and opens the next active conversation', async () => {
    const fake = fakeApi();
    const nextConversation = conversation({
      id: 'conversation-2',
      title: 'Next conversation'
    });
    vi.mocked(fake.api.listConversations)
      .mockResolvedValueOnce([conversation(), nextConversation]);
    vi.mocked(fake.api.getConversation).mockImplementation(async (id) =>
      id === nextConversation.id ? nextConversation : conversation()
    );
    const controller = createChatController(fake.api);
    await controller.initialize('conversation-1');

    await expect(controller.archiveConversation()).resolves.toEqual(forgottenChat);

    expect(fake.api.archiveConversation).toHaveBeenCalledWith('conversation-1', true, 7);
    expect(controller.getSnapshot().conversations).toMatchObject([{ id: nextConversation.id, title: nextConversation.title }]);
    expect(controller.getSnapshot().conversation?.id).toBe('conversation-2');
  });

  it('leaves a blank chat pane after forgetting the last conversation', async () => {
    const fake = fakeApi();
    const controller = createChatController(fake.api);
    await controller.initialize('conversation-1');

    await expect(controller.archiveConversation()).resolves.toEqual(forgottenChat);

    expect(controller.getSnapshot().conversations).toEqual([]);
    expect(controller.getSnapshot().conversation).toBeNull();
    expect(controller.getSnapshot().proposals).toEqual([]);
  });

  it('forwards a one-message forced web search', async () => {
    const fake = fakeApi();
    vi.mocked(fake.api.sendMessage).mockResolvedValue({
      requestId: 'request-1',
      conversationId: 'conversation-1',
      userMessage: message({ id: 'user-1', role: 'user', content: 'Latest news', status: 'completed' }),
      assistantMessage: message()
    });
    const controller = createChatController(fake.api);
    await controller.initialize('conversation-1');

    await expect(controller.send({ content: 'Latest news', forceWebSearch: true })).resolves.toMatchObject({ status: 'sent' });
    expect(fake.api.sendMessage).toHaveBeenCalledWith({
      conversationId: 'conversation-1',
      content: 'Latest news',
      attachments: [],
      forceWebSearch: true,
      activeNote: undefined,
      selectedContext: []
    });
  });

  it('keeps the newest conversation when open results arrive out of order', async () => {
    const fake = fakeApi();
    const controller = createChatController(fake.api);
    await controller.initialize('conversation-1');

    let resolveSlow!: (value: ChatConversation) => void;
    const slow = new Promise<ChatConversation>((resolve) => {
      resolveSlow = resolve;
    });
    vi.mocked(fake.api.getConversation).mockImplementation(async (id) => {
      if (id === 'conversation-slow') return slow;
      return conversation({ id, title: 'Newest' });
    });

    const slowOpen = controller.openConversation('conversation-slow');
    const fastOpen = controller.openConversation('conversation-fast');
    await fastOpen;
    resolveSlow(
      conversation({ id: 'conversation-slow', title: 'Stale' })
    );
    await slowOpen;

    expect(controller.getSnapshot().conversation?.id).toBe(
      'conversation-fast'
    );
  });

  it('forwards the flushed active-note snapshot with the next message', async () => {
    const fake = fakeApi();
    vi.mocked(fake.api.sendMessage).mockResolvedValue({
      requestId: 'request-1',
      conversationId: 'conversation-1',
      userMessage: message({ id: 'user-1', role: 'user', content: 'Update this', status: 'completed' }),
      assistantMessage: message()
    });
    const controller = createChatController(fake.api);
    await controller.initialize('conversation-1');
    const activeNote = {
      noteId: 'note-1',
      title: 'Project plan',
      path: '/vault/Project plan.md',
      body: '# Project plan',
      bodyHash: 'hash-1',
      selection: 'Project plan'
    };

    await controller.send({ content: 'Update this', activeNote });

    expect(fake.api.sendMessage).toHaveBeenCalledWith({
      conversationId: 'conversation-1',
      content: 'Update this',
      attachments: [],
      forceWebSearch: false,
      activeNote,
      selectedContext: []
    });
  });
});
