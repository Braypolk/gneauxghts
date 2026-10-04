import { describe, expect, it, vi } from 'vitest';
import { createChatController } from './controller.svelte';
import type { ChatConversation } from './types';
import { message, conversation, fakeApi } from './chatTestSupport';

describe('chat controller configuration', () => {
  it('does not create a conversation before backend settings establish the draft model', async () => {
    const fake = fakeApi();
    const controller = createChatController(fake.api);

    expect(controller.getSnapshot().isInitialized).toBe(false);
    expect(controller.getSnapshot().conversationDraft.model).toBe('');
    await expect(controller.send({ content: 'First message' })).resolves.toEqual({ status: 'failed' });

    expect(fake.api.createConversation).not.toHaveBeenCalled();
    expect(controller.getSnapshot().error).toBe(
      'Chat settings are still loading. Try again in a moment.'
    );
  });

  it('keeps provider and vault choices on a draft and uses them at creation', async () => {
    const fake = fakeApi();
    const controller = createChatController(fake.api);
    await controller.initialize('conversation-1');
    controller.startNewConversation();

    await controller.setProvider('local', 'local-model');
    await controller.setVaultAccess('full');

    expect(controller.getSnapshot().conversation).toBeNull();
    expect(controller.getSnapshot().conversationDraft).toMatchObject({
      provider: 'local',
      model: 'local-model',
      vaultAccess: 'full'
    });

    fake.api.sendMessage.mockResolvedValueOnce({ requestId: 'request-1', conversationId: 'conversation-1', userMessage: message({ id: 'user-1', role: 'user', status: 'completed' }), assistantMessage: message() });
    await expect(controller.send({ content: 'First message' })).resolves.toMatchObject({ status: 'sent' });

    expect(fake.api.createConversation).toHaveBeenCalledWith({
      title: undefined,
      vaultAccess: 'full',
      provider: 'local',
      model: 'local-model',
      reasoningEffort: 'medium'
    });
  });

  it('does not apply a local model lookup to a newer draft', async () => {
    const fake = fakeApi();
    const controller = createChatController(fake.api);
    await controller.initialize('conversation-1');
    let resolve!: (value: Awaited<ReturnType<typeof fake.api.getModelCapabilities>>) => void;
    fake.api.getModelCapabilities.mockReturnValueOnce(new Promise(done => { resolve = done; }));
    const changing = controller.setProvider('local', 'old-model');
    controller.startNewConversation();
    resolve({ images: false, audio: false, video: false, files: false, tools: true, acceptedMimeTypes: [] });
    await changing;
    expect(fake.api.setConversationProvider).not.toHaveBeenCalled();
    expect(controller.getSnapshot().conversationDraft.model).toBe('test-model');
  });

  it('persists and revokes approved note grants through controller state', async () => {
    const fake = fakeApi();
    const controller = createChatController(fake.api);
    await controller.initialize('conversation-1');

    await controller.grantNote('note-1');
    expect(controller.getSnapshot().grants).toEqual([
      expect.objectContaining({ noteId: 'note-1', noteTitle: 'Ideas' })
    ]);

    await controller.revokeNote('note-1');
    expect(controller.getSnapshot().grants).toEqual([]);
    expect(fake.api.revokeNote).toHaveBeenCalledWith('note-1');
  });

  it('adds and removes stable-ID exclusions in controller policy state', async () => {
    const fake = fakeApi();
    const controller = createChatController(fake.api);
    await controller.initialize('conversation-1');

    await controller.setNoteExcluded('note-private', 'Private', true);
    expect(controller.getSnapshot().policies).toEqual([
      expect.objectContaining({
        noteId: 'note-private',
        disposition: 'excluded'
      })
    ]);

    await controller.setNoteExcluded('note-private', 'Private', false);
    expect(controller.getSnapshot().policies).toEqual([]);
    expect(fake.api.setNoteExcluded).toHaveBeenLastCalledWith(
      'note-private',
      'Private',
      false
    );
  });

  it('switches provider and model without replacing conversation history', async () => {
    const fake = fakeApi();
    vi.mocked(fake.api.getConversation).mockResolvedValue(
      conversation({ messages: [message({ content: 'Existing', status: 'completed' })] })
    );
    const controller = createChatController(fake.api);
    await controller.initialize('conversation-1');

    await controller.setProvider('local', 'qwen3-8b');

    expect(fake.api.setConversationProvider).toHaveBeenCalledWith(
      'conversation-1',
      'local',
      'qwen3-8b',
      'medium'
    );
    expect(controller.getSnapshot().conversation).toMatchObject({
      provider: 'local',
      model: 'qwen3-8b'
    });
    expect(controller.getSnapshot().conversation?.messages[0].content).toBe('Existing');
  });

  it('does not merge a delayed model update into a newly opened conversation', async () => {
    const fake = fakeApi();
    let resolveUpdate!: (value: ChatConversation) => void;
    const delayedUpdate = new Promise<ChatConversation>((resolve) => {
      resolveUpdate = resolve;
    });
    vi.mocked(fake.api.setConversationProvider).mockImplementation(async () => {
      const updated = await delayedUpdate;
      const { messages, activeRequestId, projectionPath, excerptMessageIds, ...summary } = updated;
      return summary;
    });
    vi.mocked(fake.api.getConversation).mockImplementation(async (id) =>
      conversation({ id, title: id })
    );
    const controller = createChatController(fake.api);
    await controller.initialize('conversation-1');

    const update = controller.setProvider('openai', 'gpt-5.6-terra');
    await controller.openConversation('conversation-2');
    resolveUpdate(conversation({ provider: 'openai', model: 'gpt-5.6-terra' }));
    await update;

    expect(controller.getSnapshot().conversation).toMatchObject({
      id: 'conversation-2',
      model: 'test-model'
    });
  });

  it('persists reasoning independently from the selected conversation model', async () => {
    const fake = fakeApi();
    const controller = createChatController(fake.api);
    await controller.initialize('conversation-1');

    await controller.setReasoningEffort('high');

    expect(fake.api.setConversationProvider).toHaveBeenCalledWith(
      'conversation-1', 'openai', 'test-model', 'high'
    );
    expect(controller.getSnapshot().conversation?.reasoningEffort).toBe('high');
  });

  it('uses a local models saved reasoning effort when selecting it', async () => {
    const fake = fakeApi();
    vi.mocked(fake.api.getModelCapabilities).mockResolvedValue({
      images: false,
      audio: false,
      video: false,
      files: true,
      acceptedMimeTypes: ['text/plain'],
      tools: true,
      defaultReasoningEffort: 'xhigh',
    });
    const controller = createChatController(fake.api);
    await controller.initialize('conversation-1');

    await controller.setProvider('local', 'qwen/qwen3.8-27b');

    expect(fake.api.setConversationProvider).toHaveBeenCalledWith(
      'conversation-1',
      'local',
      'qwen/qwen3.8-27b',
      'xhigh'
    );
    expect(controller.getSnapshot().conversation?.reasoningEffort).toBe('xhigh');
  });


});
