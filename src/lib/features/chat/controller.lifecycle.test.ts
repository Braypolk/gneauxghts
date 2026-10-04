import { describe, expect, it, vi } from 'vitest';
import { createChatController } from './controller.svelte';
import { fakeApi, message, conversation } from './chatTestSupport';
import type { ChatSendReceipt, ChatConversation } from './types';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe('chat listener ownership', () => {
  it('joins concurrent acquisition and releases every subscription exactly once', async () => {
    const fake = fakeApi();
    const attachment = deferred<() => void>();
    fake.api.on.mockReturnValue(attachment.promise);
    const controller = createChatController(fake.api);
    const first = controller.initialize();
    const second = controller.initialize();
    expect(fake.api.on).toHaveBeenCalledTimes(11);
    const unlisten = vi.fn();
    attachment.resolve(unlisten);
    await Promise.all([first, second]);
    expect(fake.api.getSettings).toHaveBeenCalledOnce();
    controller.dispose();
    controller.dispose();
    expect(unlisten).toHaveBeenCalledTimes(11);
  });

  it('releases partial attachments at failure and late attachments after failure before retry', async () => {
    const fake = fakeApi();
    const late = deferred<() => void>();
    const release = vi.fn();
    fake.api.on.mockRejectedValueOnce(new Error('offline')).mockReturnValueOnce(late.promise).mockResolvedValue(release);
    const controller = createChatController(fake.api);
    await controller.initialize();
    expect(controller.getSnapshot().error).toContain('offline');
    expect(release).toHaveBeenCalledTimes(9);
    await controller.initialize();
    expect(fake.api.on).toHaveBeenCalledTimes(22);
    const lateRelease = vi.fn();
    late.resolve(lateRelease);
    await vi.waitFor(() => expect(lateRelease).toHaveBeenCalledOnce());
    expect(controller.getSnapshot().isInitialized).toBe(true);
    controller.dispose();
    expect(release).toHaveBeenCalledTimes(20);
  });

  it('cleans subscriptions acquired after disposal and does not load chat data', async () => {
    const fake = fakeApi();
    const late = deferred<() => void>();
    fake.api.on.mockReturnValueOnce(late.promise);
    const controller = createChatController(fake.api);
    const initializing = controller.initialize();
    await vi.waitFor(() => expect(fake.handlers.size).toBe(10));
    controller.dispose();
    expect(fake.handlers.size).toBe(0);
    const release = vi.fn(); late.resolve(release);
    await initializing;
    expect(release).toHaveBeenCalledOnce();
    expect(fake.api.getSettings).not.toHaveBeenCalled();
  });
});

describe('chat receipt admission', () => {
  it.each([['send', 'streaming'], ['send', 'completed'], ['retry', 'streaming'], ['retry', 'completed']] as const)('keeps %s %s events received before the receipt', async (operation, status) => {
    const fake = fakeApi();
    const receipt = deferred<ChatSendReceipt>();
    fake.api.sendMessage.mockReturnValue(receipt.promise);
    fake.api.retryMessage.mockReturnValue(receipt.promise);
    const controller = createChatController(fake.api);
    await controller.initialize('conversation-1');
    const sending = operation === 'send' ? controller.send({ content: 'Hello' }) : controller.retry('message-1');
    await vi.waitFor(() => expect(operation === 'send' ? fake.api.sendMessage : fake.api.retryMessage).toHaveBeenCalledOnce());
    const identity = { requestId: 'request-1', conversationId: 'conversation-1', messageId: 'message-1' };
    fake.emit('chat://started', { ...identity, message: message() });
    fake.emit('chat://text-delta', { ...identity, delta: 'Live answer' });
    if (status === 'completed') fake.emit('chat://completed', { ...identity, message: message({ status, content: 'Final answer', parts: [{ id: 'text', type: 'text', text: 'Final answer' }] }) });
    receipt.resolve({ requestId: 'request-1', conversationId: 'conversation-1', userMessage: message({ id: 'user-1', role: 'user', content: 'Hello', status: 'completed' }), assistantMessage: message() });
    await sending;
    const snapshot = controller.getSnapshot();
    const assistant = snapshot.conversation?.messages.find(item => item.id === 'message-1');
    expect(assistant?.content).toBe(status === 'completed' ? 'Final answer' : 'Live answer');
    expect(assistant?.status).toBe(status);
    expect(snapshot.conversation?.activeRequestId).toBe(status === 'completed' ? null : 'request-1');
    expect(snapshot.isSending).toBe(status === 'streaming');
    expect(snapshot.conversation?.messages.filter(item => item.id === 'user-1')).toHaveLength(operation === 'send' ? 1 : 0);
    controller.dispose();
  });
});


describe('chat selection and submission admission', () => {
  it.each(['open', 'branch', 'create'] as const)('a new draft supersedes a pending %s', async (operation) => {
    const fake = fakeApi();
    const controller = createChatController(fake.api);
    await controller.initialize('conversation-1');
    const pending = deferred<ChatConversation>();
    let running: Promise<unknown>;
    if (operation === 'open') {
      fake.api.getConversation.mockReturnValueOnce(pending.promise);
      running = controller.openConversation('late');
    } else if (operation === 'branch') {
      fake.api.branchFromMessage.mockReturnValueOnce(pending.promise);
      running = controller.branchFromMessage('message-1');
    } else {
      controller.startNewConversation();
      fake.api.createConversation.mockReturnValueOnce(pending.promise);
      running = controller.send({ content: 'old draft' });
    }
    controller.startNewConversation({ title: 'Newest draft' });
    pending.resolve(conversation({ id: 'late' }));
    await running;
    expect(controller.getSnapshot()).toMatchObject({
      conversation: null, isLoadingConversation: false, isSending: false,
      conversationDraft: { title: 'Newest draft' }
    });
    expect(fake.api.sendMessage).not.toHaveBeenCalled();
  });

  it('does not redirect first send when a subscriber navigates during draft promotion', async () => {
    const fake = fakeApi();
    const controller = createChatController(fake.api);
    await controller.initialize('conversation-1');
    controller.startNewConversation();
    let redirected = false;
    controller.subscribe(snapshot => {
      if (snapshot.draftPromotion && !redirected) {
        redirected = true;
        controller.startNewConversation({ title: 'Different draft' });
      }
    });
    await expect(controller.send({ content: 'For the original draft' })).resolves.toEqual({ status: 'obsolete' });
    expect(fake.api.sendMessage).not.toHaveBeenCalled();
    expect(controller.getSnapshot().conversationDraft.title).toBe('Different draft');
  });

  it('keeps the admitted completion identity through synchronous subscriber navigation', async () => {
    const fake = fakeApi();
    const completed = vi.fn();
    const controller = createChatController(fake.api, { onAssistantCompleted: completed });
    await controller.initialize('conversation-1');
    controller.subscribe(snapshot => {
      if (snapshot.conversation?.messages.some(item => item.status === 'completed')) controller.startNewConversation();
    });
    const event = {
      conversationId: 'conversation-1', requestId: 'request-1', messageId: 'message-1',
      message: message({ status: 'completed', content: 'Done' })
    };
    fake.emit('chat://completed', event);
    fake.emit('chat://completed', event);
    expect(completed).toHaveBeenCalledOnce();
    expect(completed).toHaveBeenCalledWith({ conversation: expect.objectContaining({ id: 'conversation-1' }), message: event.message });
    expect(controller.getSnapshot().conversation).toBeNull();
  });

  it('joins first-message ownership and retains the created conversation after send failure', async () => {
    const fake = fakeApi();
    const controller = createChatController(fake.api);
    await controller.initialize('conversation-1');
    controller.startNewConversation();
    const pending = deferred<ChatConversation>();
    fake.api.createConversation.mockReturnValueOnce(pending.promise);
    fake.api.sendMessage.mockRejectedValueOnce(new Error('offline'));
    const first = controller.send({ content: 'Keep this text' });
    await expect(controller.send({ content: 'duplicate' })).resolves.toEqual({ status: 'failed' });
    pending.resolve(conversation({ id: 'created' }));
    await expect(first).resolves.toEqual({ status: 'failed' });
    expect(fake.api.createConversation).toHaveBeenCalledOnce();
    expect(fake.api.sendMessage).toHaveBeenCalledOnce();
    expect(controller.getSnapshot()).toMatchObject({
      conversation: { id: 'created' }, draftPromotion: { conversationId: 'created' },
      error: 'offline', isSending: false
    });
  });
});


it('ignores an older terminal replay after a later request completes', async () => {
  const fake = fakeApi();
  const completed = vi.fn();
  const controller = createChatController(fake.api, { onAssistantCompleted: completed });
  await controller.initialize('conversation-1');
  const first = { conversationId: 'conversation-1', requestId: 'request-1', messageId: 'first',
    message: message({ id: 'first', status: 'completed', content: 'First' }) };
  const second = { conversationId: 'conversation-1', requestId: 'request-2', messageId: 'second',
    message: message({ id: 'second', requestId: 'request-2', status: 'completed', content: 'Second' }) };
  fake.emit('chat://completed', first);
  fake.emit('chat://completed', second);
  const snapshot = controller.getSnapshot();
  fake.emit('chat://completed', first);
  fake.emit('chat://text-delta', { conversationId: first.conversationId, requestId: first.requestId, messageId: first.messageId, delta: 'stale' });
  expect(controller.getSnapshot().isSending).toBe(false);
  expect(completed).toHaveBeenCalledTimes(2);
  expect(controller.getSnapshot().conversation).toBe(snapshot.conversation);
});


it('admits a retry using the same message ID with fresh request provenance', async () => {
  const fake = fakeApi();
  const controller = createChatController(fake.api);
  await controller.initialize('conversation-1');
  const original = { conversationId: 'conversation-1', requestId: 'request-1', messageId: 'message-1' };
  fake.emit('chat://completed', { ...original, message: message({ status: 'completed', content: 'Old answer' }) });
  const retry = { ...original, requestId: 'request-2' };
  fake.emit('chat://started', { ...retry, message: message({ requestId: retry.requestId }) });
  fake.emit('chat://text-delta', { ...retry, delta: 'New answer' });
  expect(controller.getSnapshot().isSending).toBe(true);
  fake.emit('chat://completed', { ...retry, message: message({ requestId: retry.requestId, status: 'completed', content: 'New answer' }) });
  expect(controller.getSnapshot().conversation?.messages[0]).toMatchObject({ requestId: retry.requestId, content: 'New answer', status: 'completed' });
  expect(controller.getSnapshot().isSending).toBe(false);
});
