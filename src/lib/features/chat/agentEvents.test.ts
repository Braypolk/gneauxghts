import { describe, expect, it } from 'vitest';
import {
  initialAgentEventState,
  materializeDurableChatParts,
  reduceAgentEvent,
  replayAgentEvents
} from './agentEvents';
import type { ChatAgentEventEnvelope } from './types';

function envelope(
  sequence: number,
  event: ChatAgentEventEnvelope['event'],
  overrides: Partial<ChatAgentEventEnvelope> = {}
): ChatAgentEventEnvelope {
  return {
    schemaVersion: 2,
    requestId: 'request',
    conversationId: 'conversation',
    messageId: 'message',
    runId: 'run',
    sequence,
    createdAtMillis: sequence,
    event,
    ...overrides
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

  it('rejects wrong-target, unsupported, duplicate, and stale-run events', () => {
    const current = reduceAgentEvent(
      initialAgentEventState('answer'),
      envelope(1, { type: 'reasoningUpdated', status: 'running' })
    );
    expect(reduceAgentEvent(current, envelope(2, { type: 'textDelta', delta: 'wrong' }, {
      messageId: 'other-message'
    }))).toBe(current);
    expect(reduceAgentEvent(current, envelope(2, { type: 'textDelta', delta: 'future' }, {
      schemaVersion: 99
    }))).toBe(current);

    const handoff = reduceAgentEvent(current, envelope(1, {
      type: 'reasoningUpdated', status: 'running'
    }, {
      requestId: 'request-2',
      runId: 'run-2',
      createdAtMillis: 10
    }));
    expect(handoff.runId).toBe('run-2');
    expect(handoff.retiredRunIds).toEqual(['run']);
    expect(reduceAgentEvent(handoff, envelope(2, {
      type: 'toolCallUpdated', callId: 'late', name: 'read_note', title: 'Read note', status: 'success'
    }, {
      createdAtMillis: 11
    }))).toBe(handoff);
  });

  it('requires a newer sequence-one event for a legitimate run handoff', () => {
    const current = reduceAgentEvent(
      initialAgentEventState(),
      envelope(3, { type: 'planUpdated', entries: [] }, { createdAtMillis: 30 })
    );
    expect(reduceAgentEvent(current, envelope(4, { type: 'reasoningUpdated', status: 'running' }, {
      runId: 'run-2', createdAtMillis: 40
    }))).toBe(current);
    expect(reduceAgentEvent(current, envelope(1, { type: 'reasoningUpdated', status: 'running' }, {
      runId: 'run-2', requestId: 'request-2', createdAtMillis: 20
    }))).toBe(current);
  });

  it('replays a newer run whose first durable event follows an omitted text sequence', () => {
    const runA = envelope(2, {
      type: 'planUpdated',
      entries: [{ id: 'old', text: 'Old run', status: 'inProgress' }]
    }, { runId: 'run-a', createdAtMillis: 10 });
    const lateRunA = envelope(4, {
      type: 'modelTurnRetried', turn: 4
    }, { runId: 'run-a', createdAtMillis: 30 });
    const runB = envelope(3, {
      type: 'planUpdated',
      entries: [{ id: 'new', text: 'Resumed run', status: 'completed' }]
    }, {
      requestId: 'request-b', runId: 'run-b', createdAtMillis: 20
    });

    const replayed = replayAgentEvents('answer', [lateRunA, runB, runA], {
      conversationId: 'conversation', messageId: 'message'
    });
    expect(replayed.runId).toBe('run-b');
    expect(replayed.retiredRunIds).toContain('run-a');
    expect(replayed.parts.find((part) => part.type === 'plan')).toMatchObject({
      entries: [expect.objectContaining({ id: 'new' })]
    });
    expect(replayed.parts.find((part) => part.type === 'status')).toBeUndefined();

    const lateLiveEvent = reduceAgentEvent(replayed, lateRunA, {
      allowObservedRunHandoff: true
    });
    expect(lateLiveEvent).toBe(replayed);
  });

  it('replays canonical text without duplicating stored deltas and matches live reduction', () => {
    const events = [
      envelope(3, { type: 'modelTurnRetried', turn: 2 }, { createdAtMillis: 2 }),
      envelope(1, { type: 'textDelta', delta: 'Answer' }, { createdAtMillis: 3 }),
      envelope(2, {
        type: 'toolCallUpdated', callId: 'call', name: 'search_notes', title: 'Search notes', status: 'success'
      }, { createdAtMillis: 1 })
    ];
    const replayed = replayAgentEvents('Answer', events);
    const live = [...events]
      .sort((left, right) => left.sequence - right.sequence)
      .reduce(
        (state, event) => reduceAgentEvent(state, event, { applyText: false }),
        initialAgentEventState('Answer')
      );
    expect(replayed).toEqual(live);
    expect(replayed.parts.find((part) => part.type === 'text')).toMatchObject({ text: 'Answer' });
    expect(replayed.parts.find((part) => part.type === 'status')).toMatchObject({
      turn: 2,
      label: 'Model turn 2 retried'
    });
  });

  it('anchors replay to the durable message target before accepting the first event', () => {
    const wrong = envelope(1, { type: 'modelTurnRetried', turn: 99 }, {
      messageId: 'other-message',
      createdAtMillis: 1
    });
    const correct = envelope(1, { type: 'modelTurnRetried', turn: 2 }, {
      createdAtMillis: 2
    });

    const replayed = replayAgentEvents('answer', [wrong, correct], {
      conversationId: 'conversation',
      messageId: 'message'
    });

    expect(replayed.parts.find((part) => part.type === 'status')).toMatchObject({ turn: 2 });
    expect(replayed.messageId).toBe('message');
  });

  it('materializes durable evidence and checkpoint affordance without duplicating them', () => {
    const citation = {
      id: 'web:example', kind: 'web' as const, label: 'Example',
      url: 'https://example.com', excerpt: null
    };
    const once = materializeDurableChatParts(initialAgentEventState('old').parts, {
      text: 'canonical', citations: [citation], checkpoint: true
    });
    const twice = materializeDurableChatParts(once, {
      text: 'canonical', citations: [citation], checkpoint: true
    });
    expect(twice).toEqual(once);
    expect(twice.filter((part) => part.type === 'sources')).toHaveLength(1);
    expect(twice.filter((part) => part.type === 'checkpoint')).toHaveLength(1);
  });
});
