import { describe, expect, it, vi } from 'vitest';
import { createChatController } from './controller';
import type { ChatApi } from './api';
import type { ChatConversation, ChatEventMap, ChatMessage, ChatSettings } from './types';

const settings: ChatSettings = {
  provider: 'openai',
  model: 'test-model',
  serviceTier: 'standard',
  defaultMode: 'auto',
  defaultVaultAccess: 'limited',
  atlasVisibility: 'hidden'
};

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'message-1',
    conversationId: 'conversation-1',
    role: 'assistant',
    content: '',
    status: 'streaming',
    createdAtMillis: 1,
    updatedAtMillis: 1,
    requestId: 'request-1',
    errorMessage: null,
    citations: [],
    linkTarget: 'Chats/Test/Part 001#^msg_message-1',
    ...overrides
  };
}

function conversation(overrides: Partial<ChatConversation> = {}): ChatConversation {
  return {
    id: 'conversation-1',
    title: 'Test conversation',
    status: 'active',
    mode: 'auto',
    vaultAccess: 'limited',
    createdAtMillis: 1,
    updatedAtMillis: 1,
    messageCount: 0,
    lastMessagePreview: null,
    messages: [],
    activeRequestId: null,
    projectionPath: null,
    excerptMessageIds: {},
    ...overrides
  };
}

function fakeApi() {
  const handlers = new Map<keyof ChatEventMap, (payload: never) => void>();
  const api = {
    getSettings: vi.fn(async () => settings),
    setSettings: vi.fn(async () => settings),
    getKeyStatus: vi.fn(),
    setApiKey: vi.fn(),
    createConversation: vi.fn(async () => conversation()),
    listConversations: vi.fn(async () => [conversation()]),
    getConversation: vi.fn(async () => conversation()),
    renameConversation: vi.fn(),
    archiveConversation: vi.fn(),
    setConversationPreferences: vi.fn(async (_id, mode, vaultAccess) => conversation({ mode, vaultAccess })),
    sendMessage: vi.fn(),
    cancelRequest: vi.fn(),
    retryMessage: vi.fn(),
    createExcerpt: vi.fn(),
    rememberExcerpt: vi.fn(),
    unrememberExcerpt: vi.fn(),
    listGrants: vi.fn(async () => []),
    grantNote: vi.fn(async (noteId) => ({ noteId, notePath: 'Ideas.md', noteTitle: 'Ideas', grantedAtMillis: 2 })),
    revokeNote: vi.fn(async () => undefined),
    resolveProjectionConflict: vi.fn(),
    on: vi.fn(async (event: keyof ChatEventMap, handler: (payload: never) => void) => {
      handlers.set(event, handler);
      return () => handlers.delete(event);
    })
  } as unknown as ChatApi;
  return {
    api,
    emit<K extends keyof ChatEventMap>(event: K, payload: ChatEventMap[K]) {
      handlers.get(event)?.(payload as never);
    },
    handlers
  };
}

describe('createChatController', () => {
  it('loads settings, conversations, and the requested conversation', async () => {
    const fake = fakeApi();
    const controller = createChatController(fake.api);

    await controller.initialize('conversation-1');

    expect(fake.api.getConversation).toHaveBeenCalledWith('conversation-1');
    expect(controller.getSnapshot().settings).toEqual(settings);
    expect(controller.getSnapshot().conversation?.id).toBe('conversation-1');
    expect(fake.handlers.size).toBe(7);
  });

  it('reconciles streaming deltas, citations, and completion', async () => {
    const fake = fakeApi();
    const controller = createChatController(fake.api);
    await controller.initialize('conversation-1');
    const streamingMessage = message();

    fake.emit('chat://started', {
      requestId: 'request-1', conversationId: 'conversation-1', messageId: streamingMessage.id, message: streamingMessage
    });
    fake.emit('chat://text-delta', {
      requestId: 'request-1', conversationId: 'conversation-1', messageId: streamingMessage.id, delta: 'Hello'
    });
    fake.emit('chat://source', {
      requestId: 'request-1', conversationId: 'conversation-1', messageId: streamingMessage.id,
      citation: { id: 'source-1', kind: 'web', label: 'Source', url: 'https://example.com', excerpt: null }
    });

    expect(controller.getSnapshot().conversation?.messages[0].content).toBe('Hello');
    expect(controller.getSnapshot().conversation?.messages[0].citations).toHaveLength(1);
    expect(controller.getSnapshot().isSending).toBe(true);

    fake.emit('chat://completed', {
      requestId: 'request-1', conversationId: 'conversation-1', messageId: streamingMessage.id,
      message: message({ content: 'Hello there', status: 'completed' })
    });

    expect(controller.getSnapshot().conversation?.messages[0].content).toBe('Hello there');
    expect(controller.getSnapshot().conversation?.activeRequestId).toBeNull();
    expect(controller.getSnapshot().isSending).toBe(false);
  });

  it('notifies onAssistantCompleted for finished assistant messages', async () => {
    const fake = fakeApi();
    const onAssistantCompleted = vi.fn();
    const controller = createChatController(fake.api, { onAssistantCompleted });
    await controller.initialize('conversation-1');

    fake.emit('chat://completed', {
      requestId: 'request-1',
      conversationId: 'conversation-1',
      messageId: 'message-1',
      message: message({ content: 'Done', status: 'completed' })
    });

    expect(onAssistantCompleted).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.objectContaining({ content: 'Done', status: 'completed' }),
        conversation: expect.objectContaining({ id: 'conversation-1' })
      })
    );
  });

  it('ignores stream events belonging to a different conversation', async () => {
    const fake = fakeApi();
    const controller = createChatController(fake.api);
    await controller.initialize('conversation-1');

    fake.emit('chat://started', {
      requestId: 'request-2', conversationId: 'conversation-2', messageId: 'message-2',
      message: message({ id: 'message-2', conversationId: 'conversation-2' })
    });

    expect(controller.getSnapshot().conversation?.messages).toEqual([]);
    expect(controller.getSnapshot().isSending).toBe(false);
  });

  it('disposes all stream listeners', async () => {
    const fake = fakeApi();
    const controller = createChatController(fake.api);
    await controller.initialize();
    controller.dispose();
    expect(fake.handlers.size).toBe(0);
  });

  it('persists and revokes limited note grants through controller state', async () => {
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
});
