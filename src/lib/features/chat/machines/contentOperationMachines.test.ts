import { conversation } from '../chatTestSupport';
import { describe, expect, it } from 'vitest';
import {
  createChatControllerMachineState,
  transitionChatControllerMachine
} from './controllerMachine';

describe('chat controller machine', () => {
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
      type: 'selectionLoaded', conversation: conversation({ id: 'chat-1' }),
      proposals: [], capabilities: null, operationId: 1
    });
    const loadingSecond = transitionChatControllerMachine(open, {
      type: 'startLoading',
      conversationId: 'chat-2',
      operationId: 2
    });

    expect(
      transitionChatControllerMachine(loadingSecond, {
        type: 'selectionFailed', operationId: 2, error: 'Unavailable'
      }).selection
    ).toEqual(open.selection);
  });
});
