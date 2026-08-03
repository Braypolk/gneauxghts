import { describe, expect, it } from 'vitest';
import {
  createChatControllerMachineState,
  transitionChatControllerMachine
} from './controllerMachine';

describe('chat controller machine', () => {
  it('rejects stale initialization completion', () => {
    const first = transitionChatControllerMachine(
      createChatControllerMachineState(),
      { type: 'initialize', sequence: 1 }
    );
    const second = transitionChatControllerMachine(first, {
      type: 'initialize',
      sequence: 2
    });

    expect(
      transitionChatControllerMachine(second, {
        type: 'initialized',
        sequence: 1
      })
    ).toBe(second);
  });

  it('returns selection to idle after a failed open', () => {
    const loadingFirst = transitionChatControllerMachine(
      createChatControllerMachineState(),
      {
        type: 'startLoading',
        conversationId: 'chat-1',
        operationId: 1
      }
    );
    const open = transitionChatControllerMachine(loadingFirst, {
      type: 'opened',
      conversationId: 'chat-1',
      operationId: 1
    });
    const loadingSecond = transitionChatControllerMachine(open, {
      type: 'startLoading',
      conversationId: 'chat-2',
      operationId: 2
    });

    expect(
      transitionChatControllerMachine(loadingSecond, {
        type: 'failed',
        operationId: 2
      }).selection
    ).toEqual(open.selection);
  });

  it('makes disposal terminal across every parallel region', () => {
    const active = transitionChatControllerMachine(
      transitionChatControllerMachine(
        createChatControllerMachineState(),
        {
          type: 'submit',
          conversationId: 'chat-1',
          operationId: 1
        }
      ),
      {
        type: 'startLoading',
        conversationId: 'chat-2',
        operationId: 2
      }
    );
    const disposed = transitionChatControllerMachine(active, {
      type: 'dispose'
    });

    expect(disposed).toEqual({
      lifecycle: { kind: 'disposed' },
      selection: { kind: 'idle' },
      request: { kind: 'idle' }
    });
    expect(
      transitionChatControllerMachine(disposed, {
        type: 'submit',
        conversationId: 'chat-1',
        operationId: 3
      })
    ).toBe(disposed);
  });

  it('correlates terminal events and ignores a late stream event', () => {
    const submitting = transitionChatControllerMachine(
      createChatControllerMachineState(),
      {
        type: 'submit',
        conversationId: 'chat-1',
        operationId: 1
      }
    );
    const streaming = transitionChatControllerMachine(submitting, {
      type: 'accepted',
      conversationId: 'chat-1',
      requestId: 'request-1',
      operationId: 1
    });

    expect(
      transitionChatControllerMachine(streaming, {
        type: 'terminal',
        conversationId: 'chat-1',
        requestId: 'request-old'
      })
    ).toBe(streaming);

    const terminal = transitionChatControllerMachine(streaming, {
      type: 'terminal',
      conversationId: 'chat-1',
      requestId: 'request-1'
    });
    expect(
      transitionChatControllerMachine(terminal, {
        type: 'started',
        conversationId: 'chat-1',
        requestId: 'request-1',
        messageId: 'message-1'
      })
    ).toBe(terminal);
  });
});
