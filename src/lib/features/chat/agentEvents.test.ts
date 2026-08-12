import { describe, expect, it } from 'vitest';
import { initialAgentEventState, reduceAgentEvent } from './agentEvents';
import type { ChatAgentEventEnvelope } from './types';

function envelope(
  sequence: number,
  event: ChatAgentEventEnvelope['event']
): ChatAgentEventEnvelope {
  return {
    requestId: 'request',
    conversationId: 'conversation',
    messageId: 'message',
    runId: 'run',
    sequence,
    createdAtMillis: sequence,
    event
  };
}

describe('agent event reducer', () => {
  it('upserts tool lifecycle and ignores duplicate sequence numbers', () => {
    const running = reduceAgentEvent(
      initialAgentEventState('answer'),
      envelope(1, {
        type: 'toolCallUpdated',
        callId: 'call',
        name: 'search_notes',
        title: 'Search notes',
        status: 'running'
      })
    );
    const complete = reduceAgentEvent(
      running,
      envelope(2, {
        type: 'toolCallUpdated',
        callId: 'call',
        name: 'search_notes',
        title: 'Search notes',
        status: 'success'
      })
    );
    expect(complete.parts.filter((part) => part.type === 'tool')).toHaveLength(1);
    expect(complete.parts.find((part) => part.type === 'tool')).toMatchObject({
      status: 'success'
    });
    expect(reduceAgentEvent(complete, envelope(2, { type: 'textDelta', delta: 'late' })))
      .toBe(complete);
  });

  it('keeps provider-safe reasoning lifecycle separate from answer text', () => {
    const running = reduceAgentEvent(
      initialAgentEventState(''),
      envelope(1, { type: 'reasoningUpdated', status: 'running' })
    );
    const completed = reduceAgentEvent(
      running,
      envelope(2, {
        type: 'reasoningUpdated',
        status: 'completed',
        summary: 'Compared the available note evidence.'
      })
    );
    expect(completed.parts.find((part) => part.type === 'reasoning')).toEqual({
      id: 'reasoning',
      type: 'reasoning',
      status: 'completed',
      summary: 'Compared the available note evidence.'
    });
  });
});
