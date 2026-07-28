import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.fn();
const listenMock = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('@tauri-apps/api/event', () => ({ listen: listenMock }));

describe('TauriChatApi', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    listenMock.mockReset();
  });

  it('defaults automatic web access for settings from older vaults', async () => {
    invokeMock.mockResolvedValue({
      provider: 'openai', model: 'test-model', serviceTier: 'standard',
      defaultAccess: 'approved', atlasVisibility: 'hidden'
    });
    const { TauriChatApi } = await import('./api');
    const settings = await new TauriChatApi().getSettings();

    expect(settings.webAccess).toBe('auto');
  });

  it('normalizes legacy Ollama settings to the local provider', async () => {
    invokeMock.mockResolvedValue({
      provider: 'ollama',
      model: 'qwen3:8b',
      openaiModel: 'gpt-5.6-terra',
      defaultAccess: 'approved',
      atlasVisibility: 'hidden'
    });
    const { TauriChatApi } = await import('./api');

    const settings = await new TauriChatApi().getSettings();

    expect(settings).toMatchObject({
      provider: 'local',
      localModel: 'qwen3:8b',
      localBaseUrl: 'http://localhost:1234/v1'
    });
  });

  it('persists web access without a legacy mode setting', async () => {
    const settings = {
      provider: 'openai' as const,
      model: 'test-model',
      openaiModel: 'test-model',
      localModel: '',
      localBaseUrl: 'http://localhost:1234/v1',
      serviceTier: 'standard' as const,
      webAccess: 'off' as const,
      defaultVaultAccess: 'approved' as const,
      atlasVisibility: 'hidden' as const
    };
    invokeMock.mockResolvedValue({
      ...settings,
      defaultAccess: settings.defaultVaultAccess
    });
    const { TauriChatApi } = await import('./api');

    await new TauriChatApi().setSettings(settings);

    expect(invokeMock).toHaveBeenCalledWith('chat_set_settings', {
      settings: {
        provider: 'openai',
        model: 'test-model',
        openaiModel: 'test-model',
        localModel: '',
        localBaseUrl: 'http://localhost:1234/v1',
        serviceTier: 'standard',
        webAccess: 'off',
        defaultAccess: 'approved',
        atlasVisibility: 'hidden'
      }
    });
  });

  it('adapts vault access changes to the Rust IPC contract', async () => {
    invokeMock.mockResolvedValue({
      id: 'chat-1', title: 'Test', access: 'full', status: 'active',
      createdAtMillis: 1, updatedAtMillis: 2, messageCount: 0, detached: false, messages: [], excerpts: []
    });
    const { TauriChatApi } = await import('./api');
    const api = new TauriChatApi();

    const summary = await api.setConversationVaultAccess('chat-1', 'full');

    expect(invokeMock).toHaveBeenCalledWith('chat_update_conversation_policy', {
      conversationId: 'chat-1', access: 'full'
    });
    expect(summary.vaultAccess).toBe('full');
  });

  it('resolves a projection owner with one direct IPC lookup', async () => {
    invokeMock.mockResolvedValue('chat-1');
    const { TauriChatApi } = await import('./api');

    const owner = await new TauriChatApi().findConversationByProjectionPath(
      'Chats/2026-07-28-chat/Part 001.md'
    );

    expect(invokeMock).toHaveBeenCalledWith(
      'chat_find_conversation_by_projection_path',
      { notePath: 'Chats/2026-07-28-chat/Part 001.md' }
    );
    expect(owner).toBe('chat-1');
  });

  it('passes the forgotten-note retention window when archiving a conversation', async () => {
    invokeMock.mockResolvedValueOnce({
      forgottenPath: '/vault/.forgotten/2026-07-28-chat',
      originalPath: '/vault/Chats/2026-07-28-chat',
      title: 'Test',
      fileName: '2026-07-28-chat',
      forgottenAtMillis: 1,
      purgeAfterDays: 30,
      purgeAtMillis: 2,
      kind: 'chat',
      conversationId: 'chat-1'
    });
    const { TauriChatApi } = await import('./api');

    const forgottenItem = await new TauriChatApi().archiveConversation('chat-1', true, 30);

    expect(invokeMock).toHaveBeenNthCalledWith(1, 'chat_archive_conversation', {
      conversationId: 'chat-1',
      archived: true,
      retentionDays: 30
    });
    expect(forgottenItem).toMatchObject({
      kind: 'chat',
      conversationId: 'chat-1'
    });
  });

  it('wraps create and send payloads and returns optimistic messages', async () => {
    invokeMock
      .mockResolvedValueOnce({
        id: 'chat-1', title: 'New conversation', access: 'approved', status: 'active',
        createdAtMillis: 1, updatedAtMillis: 1, messageCount: 0, detached: false, messages: [], excerpts: []
      })
      .mockResolvedValueOnce({ requestId: 'request-1', conversationId: 'chat-1', userMessageId: 'user-1', assistantMessageId: 'assistant-1' });
    const { TauriChatApi } = await import('./api');
    const api = new TauriChatApi();

    await api.createConversation({ vaultAccess: 'approved' });
    const receipt = await api.sendMessage({ conversationId: 'chat-1', content: 'Hello', forceWebSearch: true });

    expect(invokeMock).toHaveBeenNthCalledWith(1, 'chat_create_conversation', {
      request: { title: undefined, access: 'approved' }
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'chat_send_message', {
      request: {
        conversationId: 'chat-1',
        content: 'Hello',
        attachments: [],
        forceWebSearch: true,
        activeNote: null
      }
    });
    expect(receipt.userMessage.content).toBe('Hello');
    expect(receipt.assistantMessage?.status).toBe('streaming');
  });

  it('sends attachment bytes and keeps them on the optimistic user message', async () => {
    invokeMock.mockResolvedValue({
      requestId: 'request-1',
      conversationId: 'chat-1',
      userMessageId: 'user-1',
      assistantMessageId: 'assistant-1'
    });
    const attachment = {
      kind: 'image' as const,
      name: 'shot.png',
      mimeType: 'image/png',
      sizeBytes: 4,
      dataBase64: 'iVBORw=='
    };
    const { TauriChatApi } = await import('./api');

    const receipt = await new TauriChatApi().sendMessage({
      conversationId: 'chat-1',
      content: 'What is this?',
      attachments: [attachment]
    });

    expect(invokeMock).toHaveBeenCalledWith('chat_send_message', {
      request: {
        conversationId: 'chat-1',
        content: 'What is this?',
        attachments: [attachment],
        forceWebSearch: undefined,
        activeNote: null
      }
    });
    expect(receipt.userMessage.attachments).toEqual([
      expect.objectContaining(attachment)
    ]);
  });

  it('normalizes raw completion events for the shared controller', async () => {
    let listener: ((event: { payload: unknown }) => void) | undefined;
    listenMock.mockImplementation(async (_name, handler) => {
      listener = handler;
      return () => undefined;
    });
    const { TauriChatApi } = await import('./api');
    const api = new TauriChatApi();
    const completed = vi.fn();
    await api.on('chat://completed', completed);

    listener?.({ payload: { requestId: 'request-1', conversationId: 'chat-1', messageId: 'assistant-1', content: 'Done' } });

    expect(completed).toHaveBeenCalledWith(expect.objectContaining({
      requestId: 'request-1',
      message: expect.objectContaining({ content: 'Done', status: 'completed' })
    }));
  });

  it('normalizes background title updates for the shared controller', async () => {
    let listener: ((event: { payload: unknown }) => void) | undefined;
    listenMock.mockImplementation(async (_name, handler) => {
      listener = handler;
      return () => undefined;
    });
    const { TauriChatApi } = await import('./api');
    const titleUpdated = vi.fn();
    await new TauriChatApi().on('chat://title-updated', titleUpdated);

    listener?.({
      payload: {
        conversationId: 'chat-1',
        conversation: {
          id: 'chat-1',
          title: 'Refined conversation title',
          access: 'approved',
          status: 'active',
          createdAtMillis: 1,
          updatedAtMillis: 2,
          messageCount: 2,
          detached: false,
          provider: 'openai',
          model: 'gpt-5.6-terra'
        }
      }
    });

    expect(titleUpdated).toHaveBeenCalledWith({
      conversationId: 'chat-1',
      conversation: expect.objectContaining({
        id: 'chat-1',
        title: 'Refined conversation title',
        vaultAccess: 'approved'
      })
    });
  });

  it('stores and removes provider keys without requesting the key back', async () => {
    invokeMock.mockResolvedValueOnce({ configured: true }).mockResolvedValueOnce({ configured: false });
    const { TauriChatApi } = await import('./api');
    const api = new TauriChatApi();

    await expect(api.setApiKey('openai', 'sk-test')).resolves.toMatchObject({ configured: true });
    await expect(api.setApiKey('openai', '')).resolves.toMatchObject({ configured: false });

    expect(invokeMock).toHaveBeenNthCalledWith(1, 'chat_set_api_key', { apiKey: 'sk-test' });
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'chat_set_api_key', { apiKey: '' });
  });

  it('creates excerpts from rendered Markdown selections', async () => {
    const rawConversation = {
      id: 'chat-1', title: 'Markdown', access: 'approved', status: 'active',
      createdAtMillis: 1, updatedAtMillis: 1, messageCount: 1, detached: false,
      messages: [{
        id: 'assistant-1', conversationId: 'chat-1', ordinal: 1, role: 'assistant', status: 'complete',
        content: 'This is **bold** and [linked text](https://example.com).', part: 1,
        createdAtMillis: 1, sources: []
      }], excerpts: []
    };
    invokeMock
      .mockResolvedValueOnce(rawConversation)
      .mockResolvedValueOnce(rawConversation)
      .mockResolvedValueOnce({
        id: 'excerpt-1', conversationId: 'chat-1', messageId: 'assistant-1',
        startOffset: 0, endOffset: 0, quote: 'bold and linked text',
        anchor: 'excerpt_excerpt-1', remembered: false
      });
    const { TauriChatApi } = await import('./api');
    const api = new TauriChatApi();

    await api.getConversation('chat-1');
    const excerpt = await api.createExcerpt('assistant-1', 'bold and linked text');

    expect(invokeMock).toHaveBeenNthCalledWith(3, 'chat_create_excerpt', {
      conversationId: 'chat-1',
      messageId: 'assistant-1',
      startOffset: null,
      endOffset: null,
      selectedText: 'bold and linked text'
    });
    expect(excerpt.text).toBe('bold and linked text');
  });

  it('switches the next run to a local model through the conversation command', async () => {
    invokeMock.mockResolvedValue({
      id: 'chat-1', title: 'Test', access: 'full', status: 'active',
      provider: 'local', model: 'qwen3-8b',
      createdAtMillis: 1, updatedAtMillis: 2, messageCount: 0, detached: false
    });
    const { TauriChatApi } = await import('./api');

    const summary = await new TauriChatApi().setConversationProvider(
      'chat-1',
      'local',
      'qwen3-8b'
    );

    expect(invokeMock).toHaveBeenCalledWith('chat_update_conversation_provider', {
      conversationId: 'chat-1',
      request: { provider: 'local', model: 'qwen3-8b' }
    });
    expect(summary).toMatchObject({ provider: 'local', model: 'qwen3-8b' });
  });

  it('uses the OpenAI-compatible local model discovery command', async () => {
    invokeMock.mockResolvedValue([{ id: 'qwen3-8b', ownedBy: 'lmstudio' }]);
    const { TauriChatApi } = await import('./api');

    await expect(
      new TauriChatApi().listLocalModels('http://localhost:1234/v1')
    ).resolves.toEqual([{ id: 'qwen3-8b', ownedBy: 'lmstudio' }]);
    expect(invokeMock).toHaveBeenCalledWith('chat_list_local_models', {
      baseUrl: 'http://localhost:1234/v1'
    });
  });

  it('passes durable proposal resolution through typed commands', async () => {
    invokeMock.mockResolvedValue({});
    const { TauriChatApi } = await import('./api');
    const api = new TauriChatApi();

    await api.commitAgentProposal('proposal-1', '# Edited');
    await api.dismissAgentProposal('proposal-2');

    expect(invokeMock).toHaveBeenNthCalledWith(1, 'commit_agent_proposal', {
      proposalId: 'proposal-1',
      markdown: '# Edited'
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'dismiss_agent_proposal', {
      proposalId: 'proposal-2'
    });
  });

  it('sends the complete active-note snapshot to the backend', async () => {
    invokeMock.mockResolvedValue({
      requestId: 'request-1',
      conversationId: 'chat-1',
      userMessageId: 'user-1',
      assistantMessageId: 'assistant-1'
    });
    const activeNote = {
      noteId: 'note-1',
      title: 'Plan',
      path: '/vault/Plan.md',
      body: '# Plan',
      bodyHash: 'hash-1',
      selection: 'Plan'
    };
    const { TauriChatApi } = await import('./api');

    await new TauriChatApi().sendMessage({
      conversationId: 'chat-1',
      content: 'Add this',
      activeNote
    });

    expect(invokeMock).toHaveBeenCalledWith('chat_send_message', {
      request: {
        conversationId: 'chat-1',
        content: 'Add this',
        attachments: [],
        forceWebSearch: undefined,
        activeNote
      }
    });
  });

  it('updates stable-ID note exclusions through the policy command', async () => {
    invokeMock.mockResolvedValue(undefined);
    const { TauriChatApi } = await import('./api');

    await new TauriChatApi().setNoteExcluded('note-1', 'Private', true);

    expect(invokeMock).toHaveBeenCalledWith('chat_set_note_excluded', {
      noteId: 'note-1',
      title: 'Private',
      excluded: true
    });
  });

  it('loads exclusions and searches ordinary notes for the settings picker', async () => {
    invokeMock
      .mockResolvedValueOnce([
        {
          noteId: 'note-private',
          notePath: 'Private.md',
          title: 'Private',
          disposition: 'excluded',
          updatedAtMillis: 1
        }
      ])
      .mockResolvedValueOnce([
        {
          noteId: 'note-plan',
          notePath: 'Projects/Plan.md',
          title: 'Plan'
        }
      ]);
    const { TauriChatApi } = await import('./api');
    const api = new TauriChatApi();

    await expect(api.listNotePolicies()).resolves.toHaveLength(1);
    await expect(api.searchNotesForPolicy('plan', 12)).resolves.toEqual([
      {
        noteId: 'note-plan',
        notePath: 'Projects/Plan.md',
        title: 'Plan'
      }
    ]);
    expect(invokeMock).toHaveBeenNthCalledWith(1, 'chat_list_note_policies');
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'chat_search_notes', {
      query: 'plan',
      limit: 12
    });
  });

  it('loads unresolved proposals for a reopened conversation', async () => {
    invokeMock.mockResolvedValue([{ id: 'proposal-1', status: 'pending' }]);
    const { TauriChatApi } = await import('./api');

    await expect(new TauriChatApi().listPendingProposals('chat-1')).resolves.toEqual([
      { id: 'proposal-1', status: 'pending' }
    ]);
    expect(invokeMock).toHaveBeenCalledWith('chat_list_pending_proposals', {
      conversationId: 'chat-1'
    });
  });

  it('forwards compact activity events without exposing provider payloads', async () => {
    let listener: ((event: { payload: unknown }) => void) | undefined;
    listenMock.mockImplementation(async (_name, handler) => {
      listener = handler;
      return () => undefined;
    });
    const { TauriChatApi } = await import('./api');
    const activity = vi.fn();
    await new TauriChatApi().on('chat://activity', activity);
    const payload = {
      requestId: 'request-1',
      conversationId: 'chat-1',
      messageId: 'assistant-1',
      runId: 'run-1',
      status: 'Reading note'
    };

    listener?.({ payload });

    expect(activity).toHaveBeenCalledWith(payload);
  });
});
