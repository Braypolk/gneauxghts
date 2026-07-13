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

  it('adapts shared conversation preferences to the Rust IPC contract', async () => {
    invokeMock.mockResolvedValue({
      id: 'chat-1', title: 'Test', mode: 'challenge', access: 'full', status: 'active',
      createdAtMillis: 1, updatedAtMillis: 2, messageCount: 0, detached: false, messages: [], excerpts: []
    });
    const { TauriChatApi } = await import('./api');
    const api = new TauriChatApi();

    const summary = await api.setConversationPreferences('chat-1', 'challenge', 'full');

    expect(invokeMock).toHaveBeenCalledWith('chat_update_conversation_policy', {
      conversationId: 'chat-1', mode: 'challenge', access: 'full'
    });
    expect(summary.vaultAccess).toBe('full');
  });

  it('wraps create and send payloads and returns optimistic messages', async () => {
    invokeMock
      .mockResolvedValueOnce({
        id: 'chat-1', title: 'New conversation', mode: 'auto', access: 'limited', status: 'active',
        createdAtMillis: 1, updatedAtMillis: 1, messageCount: 0, detached: false, messages: [], excerpts: []
      })
      .mockResolvedValueOnce({ requestId: 'request-1', conversationId: 'chat-1', userMessageId: 'user-1', assistantMessageId: 'assistant-1' });
    const { TauriChatApi } = await import('./api');
    const api = new TauriChatApi();

    await api.createConversation({ mode: 'auto', vaultAccess: 'limited' });
    const receipt = await api.sendMessage({ conversationId: 'chat-1', content: 'Hello' });

    expect(invokeMock).toHaveBeenNthCalledWith(1, 'chat_create_conversation', {
      request: { title: undefined, mode: 'auto', access: 'limited' }
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'chat_send_message', {
      request: { conversationId: 'chat-1', content: 'Hello', useWebSearch: undefined }
    });
    expect(receipt.userMessage.content).toBe('Hello');
    expect(receipt.assistantMessage?.status).toBe('streaming');
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

  it('stores and removes provider keys without requesting the key back', async () => {
    invokeMock.mockResolvedValueOnce({ configured: true }).mockResolvedValueOnce({ configured: false });
    const { TauriChatApi } = await import('./api');
    const api = new TauriChatApi();

    await expect(api.setApiKey('openai', 'sk-test')).resolves.toMatchObject({ configured: true });
    await expect(api.setApiKey('openai', '')).resolves.toMatchObject({ configured: false });

    expect(invokeMock).toHaveBeenNthCalledWith(1, 'chat_set_api_key', { apiKey: 'sk-test' });
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'chat_set_api_key', { apiKey: '' });
  });
});
