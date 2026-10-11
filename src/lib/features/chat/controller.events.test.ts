import { describe, expect, it, vi } from 'vitest';
import { createChatController } from './controller.svelte';
import { message, conversation, fakeApi } from './chatTestSupport';

describe('chat controller events', () => {
  it('replaces structured drafts by attempt/sequence, rejects late events and settles only final content', async () => {
    const fake = fakeApi();
    const controller = createChatController(fake.api);
    await controller.initialize('conversation-1');
    const streaming = message();
    const identity = { requestId: 'request-1', conversationId: 'conversation-1', messageId: streaming.id };
    fake.emit('chat://started', { ...identity, message: streaming });
    fake.emit('chat://answer-draft', { ...identity, attempt: 1, sequence: 1, content: '**First** [S1]' });
    expect(controller.getSnapshot().conversation?.messages[0].answerDraft?.text).toBe('**First** [S1]');
    expect(controller.getSnapshot().conversation?.messages[0].content).toBe('');
    expect(controller.getSnapshot().conversation?.messages[0].citations).toEqual([]);
    fake.emit('chat://answer-draft', { ...identity, attempt: 2, sequence: 2, content: '' });
    fake.emit('chat://answer-draft', { ...identity, attempt: 1, sequence: 3, content: 'Late old attempt' });
    fake.emit('chat://answer-draft', { ...identity, attempt: 2, sequence: 4, content: 'Replacement' });
    fake.emit('chat://answer-draft', { ...identity, attempt: 2, sequence: 3, content: 'Out of order' });
    fake.emit('chat://answer-draft', { ...identity, requestId: 'wrong-request', attempt: 3, sequence: 9, content: 'Wrong run' });
    fake.emit('chat://answer-draft', { ...identity, conversationId: 'wrong-conversation', attempt: 3, sequence: 10, content: 'Wrong chat' });
    expect(controller.getSnapshot().conversation?.messages[0].answerDraft?.text).toBe('Replacement');
    fake.emit('chat://completed', { ...identity, message: message({ content: '**Final**', status: 'completed' }) });
    fake.emit('chat://answer-draft', { ...identity, attempt: 3, sequence: 5, content: 'Late after final' });
    expect(controller.getSnapshot().conversation?.messages[0].answerDraft).toBeUndefined();
    expect(controller.getSnapshot().conversation?.messages[0].content).toBe('**Final**');
    controller.dispose();
  });

  it.each(['chat://cancelled', 'chat://failed'] as const)('clears a structured draft on %s and ignores late completion', async (channel) => {
    const fake = fakeApi();
    const controller = createChatController(fake.api);
    await controller.initialize('conversation-1');
    const streaming = message();
    const identity = { requestId: 'request-1', conversationId: 'conversation-1', messageId: streaming.id };
    fake.emit('chat://started', { ...identity, message: streaming });
    fake.emit('chat://answer-draft', { ...identity, attempt: 1, sequence: 1, content: 'Unvalidated' });
    expect(controller.getSnapshot().conversation?.messages[0].answerDraft?.text).toBe('Unvalidated');
    const terminal = message({ content: '', status: channel === 'chat://failed' ? 'error' : 'cancelled' });
    if (channel === 'chat://failed') fake.emit(channel, { ...identity, message: terminal, error: 'Rejected', retryable: true });
    else fake.emit(channel, { ...identity, message: terminal });
    fake.emit('chat://completed', { ...identity, message: message({ content: 'Too late', status: 'completed' }) });
    expect(controller.getSnapshot().conversation?.messages[0].answerDraft).toBeUndefined();
    expect(controller.getSnapshot().conversation?.messages[0].content).toBe('');
    expect(controller.getSnapshot().conversation?.messages[0].citations).toEqual([]);
    controller.dispose();
  });

  it('reconciles streaming deltas, citations, and completion', async () => {
    const fake = fakeApi();
    const onAssistantCompleted = vi.fn();
    const controller = createChatController(fake.api, { onAssistantCompleted });
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
    fake.emit('chat://agent-event', {
      requestId: 'request-1',
      conversationId: 'conversation-1',
      messageId: streamingMessage.id,
      runId: 'run-1',
      sequence: 2,
      createdAtMillis: 2,
      event: {
        type: 'toolCallUpdated',
        callId: 'call-1',
        name: 'search_notes',
        title: 'Search notes',
        status: 'running'
      }
    });
    fake.emit('chat://agent-event', {
      requestId: 'request-1',
      conversationId: 'conversation-1',
      messageId: streamingMessage.id,
      runId: 'run-1',
      sequence: 3,
      createdAtMillis: 3,
      event: {
        type: 'planUpdated',
        entries: [{ id: 'step-1', text: 'Inspect notes', status: 'inProgress' }]
      }
    });
    fake.emit('chat://agent-event', {
      requestId: 'request-1',
      conversationId: 'conversation-1',
      messageId: streamingMessage.id,
      runId: 'run-1',
      sequence: 4,
      createdAtMillis: 4,
      event: {
        type: 'usageUpdated',
        callIndex: 1,
        aggregate: {
          inputTokens: 8,
          outputTokens: 5,
          totalTokens: 13,
          cachedInputTokens: 2,
          cacheCreationInputTokens: 0,
          toolUsePromptTokens: 0,
          reasoningTokens: 1
        }
      }
    });
    fake.emit('chat://agent-event', {
      requestId: 'request-1',
      conversationId: 'conversation-1',
      messageId: streamingMessage.id,
      runId: 'run-1',
      sequence: 5,
      createdAtMillis: 5,
      event: { type: 'modelTurnRetried', turn: 2 }
    });
    fake.emit('chat://source', {
      requestId: 'request-1', conversationId: 'conversation-1', messageId: streamingMessage.id,
      citation: { id: 'source-1', kind: 'web', label: 'Source', url: 'https://example.com', excerpt: null }
    });

    expect(controller.getSnapshot().conversation?.messages[0].content).toBe('Hello');
    expect(controller.getSnapshot().conversation?.title).toBe('Login redirect bug');
    expect(controller.getSnapshot().conversations[0].title).toBe('Login redirect bug');
    expect(controller.getSnapshot().conversation?.messages[0].citations).toHaveLength(1);
    expect(controller.getSnapshot().conversation?.messages[0].parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'tool', status: 'running' }),
        expect.objectContaining({ type: 'plan' }),
        expect.objectContaining({ type: 'usage' }),
        expect.objectContaining({ type: 'status', turn: 2 }),
        expect.objectContaining({ type: 'sources' })
      ])
    );
    expect(controller.getSnapshot().isSending).toBe(true);

    fake.emit('chat://completed', {
      requestId: 'request-1', conversationId: 'conversation-1', messageId: streamingMessage.id,
      message: message({ content: 'Hello there', status: 'completed' })
    });

    expect(onAssistantCompleted).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.objectContaining({ content: 'Hello there', status: 'completed' }),
        conversation: expect.objectContaining({ id: 'conversation-1' })
      })
    );
    expect(controller.getSnapshot().conversation?.messages[0].content).toBe('Hello there');
    expect(controller.getSnapshot().conversation?.messages[0].parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'tool' }),
        expect.objectContaining({ type: 'plan' }),
        expect.objectContaining({ type: 'usage' }),
        expect.objectContaining({ type: 'status' }),
        expect.objectContaining({ type: 'sources' }),
        expect.objectContaining({ type: 'checkpoint' })
      ])
    );
    expect(controller.getSnapshot().conversation?.activeRequestId).toBeNull();
    expect(controller.getSnapshot().isSending).toBe(false);
  });

  it('accepts a correlated resumed run with a sequence gap and rejects the retired run', async () => {
    const fake = fakeApi();
    const controller = createChatController(fake.api);
    await controller.initialize('conversation-1');
    const streamingMessage = message();
    fake.emit('chat://started', {
      requestId: 'request-1', conversationId: 'conversation-1',
      messageId: streamingMessage.id, message: streamingMessage
    });
    fake.emit('chat://agent-event', {
      requestId: 'request-1', conversationId: 'conversation-1',
      messageId: streamingMessage.id, runId: 'run-a', sequence: 2,
      createdAtMillis: 10,
      event: { type: 'planUpdated', entries: [{ id: 'old', text: 'Old', status: 'inProgress' }] }
    });
    fake.emit('chat://agent-event', {
      requestId: 'request-1', conversationId: 'conversation-1',
      messageId: streamingMessage.id, runId: 'run-b', sequence: 3,
      createdAtMillis: 20,
      event: { type: 'planUpdated', entries: [{ id: 'new', text: 'Resumed', status: 'completed' }] }
    });
    fake.emit('chat://agent-event', {
      requestId: 'request-1', conversationId: 'conversation-1',
      messageId: streamingMessage.id, runId: 'run-a', sequence: 4,
      createdAtMillis: 30,
      event: { type: 'modelTurnRetried', turn: 4 }
    });

    const restored = controller.getSnapshot().conversation?.messages[0];
    expect(restored?.agentRunId).toBe('run-b');
    expect(restored?.parts.find((part) => part.type === 'plan')).toMatchObject({
      entries: [expect.objectContaining({ id: 'new' })]
    });
    expect(restored?.parts.find((part) => part.type === 'status')).toBeUndefined();
  });

  it('decides only the active correlated permission and preserves its live resolution at terminal', async () => {
    const fake = fakeApi();
    const controller = createChatController(fake.api);
    await controller.initialize('conversation-1');
    const streamingMessage = message();
    fake.emit('chat://started', {
      requestId: 'request-1', conversationId: 'conversation-1',
      messageId: streamingMessage.id, message: streamingMessage
    });
    const permission = {
      permissionId: 'permission-1', requestId: 'request-1',
      conversationId: 'conversation-1', messageId: 'message-1', runId: 'run-1',
      toolCallId: 'call-1', toolName: 'fake_side_effect',
      title: 'Run fake side effect', kind: 'processExecution' as const,
      scope: 'command:echo'
    };
    fake.emit('chat://agent-event', {
      schemaVersion: 2, requestId: 'request-1', conversationId: 'conversation-1',
      messageId: 'message-1', runId: 'run-1', sequence: 1, createdAtMillis: 1,
      event: { type: 'permissionRequested', request: permission }
    });

    await expect(controller.decidePermission(
      { ...permission, toolCallId: 'wrong-call' }, 'allowOnce'
    )).resolves.toBe(false);
    expect(fake.api.decidePermission).not.toHaveBeenCalled();
    controller.clearError();
    await expect(controller.decidePermission(permission, 'allowOnce')).resolves.toBe(true);
    expect(fake.api.decidePermission).toHaveBeenCalledWith(permission, 'allowOnce');

    fake.emit('chat://agent-event', {
      schemaVersion: 2, requestId: 'request-1', conversationId: 'conversation-1',
      messageId: 'message-1', runId: 'run-1', sequence: 2, createdAtMillis: 2,
      event: {
        type: 'permissionResolved', permissionId: 'permission-1', resolution: 'allowedOnce'
      }
    });
    fake.emit('chat://completed', {
      requestId: 'request-1', conversationId: 'conversation-1', messageId: 'message-1',
      message: message({ content: 'Done', status: 'completed' })
    });
    expect(controller.getSnapshot().conversation?.messages[0].parts)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: 'permission', status: 'resolved', resolution: 'allowedOnce'
        })
      ]));
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

  it('cancels an active run when disposal would orphan a permission waiter', async () => {
    const fake = fakeApi();
    const controller = createChatController(fake.api);
    await controller.initialize('conversation-1');
    const streamingMessage = message();
    fake.emit('chat://started', {
      requestId: 'request-1', conversationId: 'conversation-1',
      messageId: streamingMessage.id, message: streamingMessage
    });
    fake.emit('chat://agent-event', {
      schemaVersion: 2, requestId: 'request-1', conversationId: 'conversation-1',
      messageId: 'message-1', runId: 'run-1', sequence: 1, createdAtMillis: 1,
      event: {
        type: 'permissionRequested',
        request: {
          permissionId: 'permission-1', requestId: 'request-1',
          conversationId: 'conversation-1', messageId: 'message-1', runId: 'run-1',
          toolCallId: 'call-1', toolName: 'fake', title: 'Fake',
          kind: 'fileMutation', scope: 'file:test'
        }
      }
    });
    controller.dispose();
    await Promise.resolve();
    expect(fake.api.cancelRequest).toHaveBeenCalledWith('request-1');
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
    await expect(controller.send({ content: 'after dispose' })).resolves.toEqual({ status: 'failed' });
    expect(fake.api.getConversation).not.toHaveBeenCalled();
    expect(fake.api.sendMessage).not.toHaveBeenCalled();
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

});
