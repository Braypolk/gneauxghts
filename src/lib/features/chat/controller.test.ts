import { describe, expect, it, vi } from 'vitest';
import { createChatController } from './controller.svelte';
import type { ChatApi } from './api';
import type {
  ChatAgentProposal,
  ChatConversation,
  ChatEventMap,
  ChatMessage,
  ChatSettings
} from './types';

const settings: ChatSettings = {
  provider: 'openai',
  model: 'test-model',
  openaiModel: 'test-model',
  localModel: '',
  localBaseUrl: 'http://localhost:1234/v1',
  serviceTier: 'standard',
  webAccess: 'auto',
  defaultVaultAccess: 'approved',
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
    attachments: [],
    linkTarget: 'Chats/Test/Part 001#^msg_message-1',
    ...overrides
  };
}

function conversation(overrides: Partial<ChatConversation> = {}): ChatConversation {
  return {
    id: 'conversation-1',
    title: 'Test conversation',
    status: 'active',
    vaultAccess: 'approved',
    createdAtMillis: 1,
    updatedAtMillis: 1,
    messageCount: 0,
    lastMessagePreview: null,
    provider: 'openai',
    model: 'test-model',
    messages: [],
    activeRequestId: null,
    projectionPath: null,
    excerptMessageIds: {},
    ...overrides
  };
}

const forgottenChat = {
  forgottenPath: '/vault/.forgotten/2026-07-28-chat',
  originalPath: '/vault/Chats/2026-07-28-chat',
  title: 'Test conversation',
  fileName: '2026-07-28-chat',
  forgottenAtMillis: 1,
  purgeAfterDays: 7 as const,
  purgeAtMillis: 2,
  kind: 'chat' as const,
  conversationId: 'conversation-1'
};

function proposal(overrides: Partial<ChatAgentProposal> = {}): ChatAgentProposal {
  return {
    id: 'proposal-1',
    runId: 'run-1',
    conversationId: 'conversation-1',
    assistantMessageId: 'message-1',
    kind: 'update',
    noteId: 'note-1',
    suggestedPath: null,
    title: 'Project plan',
    baseHash: 'hash-1',
    payload: {},
    preview: { proposedEditorMarkdown: '# Project plan\n\nNext' },
    status: 'pending',
    createdAtMillis: 1,
    updatedAtMillis: 1,
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
    archiveConversation: vi.fn(async () => forgottenChat),
    setConversationVaultAccess: vi.fn(async (_id, vaultAccess) => {
      const { messages, activeRequestId, projectionPath, excerptMessageIds, ...summary } =
        conversation({ vaultAccess });
      return summary;
    }),
    setConversationProvider: vi.fn(async (_id, provider, model) => {
      const { messages, activeRequestId, projectionPath, excerptMessageIds, ...summary } =
        conversation({ provider, model });
      return summary;
    }),
    listLocalModels: vi.fn(async () => []),
    getModelCapabilities: vi.fn(async () => ({
      images: true,
      files: true,
      acceptedMimeTypes: ['image/png', 'text/plain', 'application/pdf']
    })),
    sendMessage: vi.fn(),
    cancelRequest: vi.fn(),
    retryMessage: vi.fn(),
    createExcerpt: vi.fn(),
    rememberExcerpt: vi.fn(),
    unrememberExcerpt: vi.fn(),
    listGrants: vi.fn(async () => []),
    listNotePolicies: vi.fn(async () => []),
    grantNote: vi.fn(async (noteId) => ({ noteId, notePath: 'Ideas.md', noteTitle: 'Ideas', grantedAtMillis: 2 })),
    revokeNote: vi.fn(async () => undefined),
    setNoteExcluded: vi.fn(async () => undefined),
    listPendingProposals: vi.fn(async () => []),
    commitAgentProposal: vi.fn(async () => ({
      status: 'committed' as const,
      applied: { kind: 'updateNote', path: '/vault/Plan.md', previousPath: '/vault/Plan.md' },
      message: null
    })),
    dismissAgentProposal: vi.fn(),
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
  it('does not create a conversation before backend settings establish the draft model', async () => {
    const fake = fakeApi();
    const controller = createChatController(fake.api);

    expect(controller.getSnapshot().conversationDraft.model).toBe('');
    await expect(controller.createConversation()).resolves.toBeNull();

    expect(fake.api.createConversation).not.toHaveBeenCalled();
    expect(controller.getSnapshot().error).toBe(
      'Chat settings are still loading. Try again in a moment.'
    );
  });

  it('loads settings, conversations, and the requested conversation', async () => {
    const fake = fakeApi();
    const controller = createChatController(fake.api);

    await controller.initialize('conversation-1');

    expect(fake.api.getConversation).toHaveBeenCalledWith('conversation-1');
    expect(controller.getSnapshot().settings).toEqual(settings);
    expect(controller.getSnapshot().conversation?.id).toBe('conversation-1');
    expect(fake.handlers.size).toBe(10);
  });

  it('reconciles streaming deltas, citations, and completion', async () => {
    const fake = fakeApi();
    const controller = createChatController(fake.api);
    await controller.initialize('conversation-1');
    const streamingMessage = message();
    const {
      messages: _messages,
      activeRequestId: _activeRequestId,
      projectionPath: _projectionPath,
      excerptMessageIds: _excerptMessageIds,
      ...generatedSummary
    } = conversation({ title: 'Login redirect bug', messageCount: 2 });

    fake.emit('chat://started', {
      requestId: 'request-1', conversationId: 'conversation-1', messageId: streamingMessage.id,
      conversation: generatedSummary, message: streamingMessage
    });
    fake.emit('chat://text-delta', {
      requestId: 'request-1', conversationId: 'conversation-1', messageId: streamingMessage.id, delta: 'Hello'
    });
    fake.emit('chat://source', {
      requestId: 'request-1', conversationId: 'conversation-1', messageId: streamingMessage.id,
      citation: { id: 'source-1', kind: 'web', label: 'Source', url: 'https://example.com', excerpt: null }
    });

    expect(controller.getSnapshot().conversation?.messages[0].content).toBe('Hello');
    expect(controller.getSnapshot().conversation?.title).toBe('Login redirect bug');
    expect(controller.getSnapshot().conversations[0].title).toBe('Login redirect bug');
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
      vaultAccess: 'approved'
    });
    expect(controller.getSnapshot().modelCapabilities).toEqual({
      images: true,
      files: true,
      acceptedMimeTypes: [
        'image/png',
        'text/plain',
        'application/pdf'
      ]
    });
  });

  it('uses the local draft title when the first message creates the conversation', async () => {
    const fake = fakeApi();
    const controller = createChatController(fake.api);
    await controller.initialize('conversation-1');
    controller.startNewConversation({ title: 'Draft title' });

    await controller.createConversation();

    expect(fake.api.createConversation).toHaveBeenCalledWith({
      title: 'Draft title',
      vaultAccess: 'approved',
      provider: 'openai',
      model: 'test-model'
    });
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

    await controller.createConversation();

    expect(fake.api.createConversation).toHaveBeenCalledWith({
      title: undefined,
      vaultAccess: 'full',
      provider: 'local',
      model: 'local-model'
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
    expect(controller.getSnapshot().conversations).toEqual([nextConversation]);
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

    await expect(controller.send('Latest news', [], true)).resolves.toBe(true);
    expect(fake.api.sendMessage).toHaveBeenCalledWith({
      conversationId: 'conversation-1',
      content: 'Latest news',
      attachments: [],
      forceWebSearch: true
    });
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

  it('ignores a stale terminal event from an older request in the current conversation', async () => {
    const fake = fakeApi();
    const controller = createChatController(fake.api);
    await controller.initialize('conversation-1');

    fake.emit('chat://started', {
      requestId: 'request-new',
      conversationId: 'conversation-1',
      messageId: 'message-new',
      message: message({
        id: 'message-new',
        requestId: 'request-new'
      })
    });
    fake.emit('chat://completed', {
      requestId: 'request-old',
      conversationId: 'conversation-1',
      messageId: 'message-old',
      message: message({
        id: 'message-old',
        requestId: 'request-old',
        status: 'completed'
      })
    });

    expect(controller.getSnapshot().conversation?.activeRequestId).toBe(
      'request-new'
    );
    expect(controller.getSnapshot().isSending).toBe(true);
    expect(
      controller
        .getSnapshot()
        .conversation?.messages.some(
          (candidate) => candidate.id === 'message-old'
        )
    ).toBe(false);
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

  it('disposes all stream listeners', async () => {
    const fake = fakeApi();
    const controller = createChatController(fake.api);
    await controller.initialize();
    controller.dispose();
    expect(fake.handlers.size).toBe(0);
  });

  it('does not invoke chat APIs after disposal', async () => {
    const fake = fakeApi();
    const controller = createChatController(fake.api);
    await controller.initialize('conversation-1');
    vi.mocked(fake.api.getConversation).mockClear();
    vi.mocked(fake.api.sendMessage).mockClear();

    controller.dispose();

    await expect(
      controller.openConversation('conversation-2')
    ).resolves.toBeNull();
    await expect(controller.send('after dispose')).resolves.toBe(false);
    expect(fake.api.getConversation).not.toHaveBeenCalled();
    expect(fake.api.sendMessage).not.toHaveBeenCalled();
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
      'qwen3-8b'
    );
    expect(controller.getSnapshot().conversation).toMatchObject({
      provider: 'local',
      model: 'qwen3-8b'
    });
    expect(controller.getSnapshot().conversation?.messages[0].content).toBe('Existing');
  });

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

  it('tracks compact activity and clears it when cancelled', async () => {
    const fake = fakeApi();
    const controller = createChatController(fake.api);
    await controller.initialize('conversation-1');
    fake.emit('chat://activity', {
      requestId: 'request-1',
      conversationId: 'conversation-1',
      messageId: 'message-1',
      runId: 'run-1',
      status: 'Searching notes'
    });
    expect(controller.getSnapshot().activity).toBe('Searching notes');

    fake.emit('chat://cancelled', {
      requestId: 'request-1',
      conversationId: 'conversation-1',
      messageId: 'message-1',
      message: message({ status: 'cancelled', content: 'Partial' })
    });
    expect(controller.getSnapshot().activity).toBeNull();
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
      applied: null,
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

    await controller.send('Update this', [], false, activeNote);

    expect(fake.api.sendMessage).toHaveBeenCalledWith({
      conversationId: 'conversation-1',
      content: 'Update this',
      attachments: [],
      forceWebSearch: false,
      activeNote
    });
  });
});
