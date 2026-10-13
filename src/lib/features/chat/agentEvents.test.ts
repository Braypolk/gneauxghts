import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  initialAgentEventState,
  materializeDurableChatParts,
  reduceAgentEvent,
  replayAgentEvents,
  settleAgentActivity,
  settlePendingPermissions
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
  it('marks successful parent compaction without losing selected note titles during live updates or replay', () => {
    const events = [
      envelope(1, { type: 'contextUpdated', compacted: false, selectedNoteTitles: ['Project plan'] }),
      envelope(2, { type: 'contextMeasured', details: { worker: true, mode: 'compaction', phase: 'completed' } }),
      envelope(3, { type: 'contextMeasured', details: { worker: false, mode: 'compaction', phase: 'failed' } }),
      envelope(4, { type: 'contextMeasured', details: { worker: false, mode: 'compaction', phase: 'completed' } })
    ];
    let live = initialAgentEventState('');
    for (const event of events.slice(0, 3)) live = reduceAgentEvent(live, event);
    expect(live.parts.find((part) => part.type === 'context')).toMatchObject({ compacted: false });
    live = reduceAgentEvent(live, events[3]);
    for (const state of [live, replayAgentEvents('', events)]) {
      expect(state.parts.find((part) => part.type === 'context')).toMatchObject({ compacted: true, selectedNoteTitles: ['Project plan'] });
    }
  });
  it('keeps separate calls and failure details from the Rust wire contract during live updates and replay', () => {
    const fixture = JSON.parse(readFileSync(new URL('../../../../src-tauri/test-fixtures/contracts/agent-events.json', import.meta.url).pathname, 'utf8'));
    const events: ChatAgentEventEnvelope[] = fixture.cases
      .filter((entry: { wire: ChatAgentEventEnvelope['event'] }) => entry.wire.type === 'toolCallUpdated')
      .map((entry: { wire: ChatAgentEventEnvelope['event'] }, index: number) => envelope(index + 1, entry.wire));
    let live = initialAgentEventState('Answer');
    for (const event of events) live = reduceAgentEvent(live, event);
    const replay = replayAgentEvents('Answer', events);
    for (const state of [live, replay]) {
      const tools = state.parts.filter((part) => part.type === 'tool');
      expect(tools).toHaveLength(2);
      expect(tools[0]).toMatchObject({ callId: 'read-call', status: 'success', outputSummary: 'Read 2 passages', durationMillis: 25 });
      expect(tools[1]).toMatchObject({ callId: 'research-call', status: 'error', stepIndex: 1, durationMillis: 47572 });
      expect(tools[1].outputSummary).toContain('shared evidence allowance is exhausted');
    }
  });
  it('uses the latest parent input as context occupancy instead of accumulated run spending', () => {
    const usage = { inputTokens: 8000, outputTokens: 400, totalTokens: 8400, cachedInputTokens: 0, cacheCreationInputTokens: 0, toolUsePromptTokens: 0, reasoningTokens: 0 };
    const state = replayAgentEvents('', [
      envelope(1, { type: 'stepUpdated', index: 0, status: 'completed', usage }),
      envelope(2, { type: 'stepUpdated', index: 1, status: 'completed', usage: { ...usage, inputTokens: 9500 } }),
      envelope(3, { type: 'usageUpdated', callIndex: 1, aggregate: { ...usage, inputTokens: 17500, totalTokens: 18300 } })
    ]);
    expect(state.parts.find((part) => part.type === 'contextUsage')).toMatchObject({ inputTokens: 9500, capacityTokens: null });
    expect(state.parts.find((part) => part.type === 'usage')).toMatchObject({ usage: { totalTokens: 18300 } });
    const unknown = reduceAgentEvent(state, envelope(4, { type: 'stepUpdated', index: 2, status: 'completed' }));
    expect(unknown.parts.some((part) => part.type === 'contextUsage')).toBe(false);
  });

  it('uses reported parent capacity while ignoring worker measurements and text estimates', () => {
    const state = reduceAgentEvent(initialAgentEventState(), envelope(1, {
      type: 'contextMeasured', details: { phase: 'usage', worker: false, loadedContextTokens: 32000, reportedUsage: { inputTokens: 8000 } }
    }));
    expect(state.parts.find((part) => part.type === 'contextUsage')).toMatchObject({ inputTokens: 8000, capacityTokens: 32000 });
    const worker = reduceAgentEvent(state, envelope(2, {
      type: 'contextMeasured', details: { phase: 'usage', worker: true, loadedContextTokens: 64000, reportedUsage: { inputTokens: 1000 } }
    }));
    expect(worker.parts).toEqual(state.parts);
    const estimate = reduceAgentEvent(worker, envelope(3, {
      type: 'contextMeasured', details: { phase: 'request', worker: false, loadedContextTokens: 32000, estimatedInputTokens: 9000 }
    }));
    expect(estimate.parts).toEqual(state.parts);
  });

  it('retains context diagnostics without displaying them as answer content', () => {
    const before = initialAgentEventState('Answer');
    const after = reduceAgentEvent(before, envelope(1, {
      type: 'contextMeasured', details: { inputBytes: 10000, mode: 'measurement_only' }
    }));
    expect(after.parts).toEqual(before.parts);
    expect(after.sequence).toBe(1);
  });
  it('keeps research outcome diagnostics out of answer content', () => {
    const before = initialAgentEventState('Answer');
    const after = reduceAgentEvent(before, envelope(1, {
      type: 'researchCompleted', details: { stage: 'selection', reason: 'unread_selection', readPassages: 4 }
    }));
    expect(after.parts).toEqual(before.parts);
    expect(after.sequence).toBe(1);
  });
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

  it('keeps model steps internal while projecting tool detail, context, proposals, and guards', () => {
    const events: ChatAgentEventEnvelope[] = [
      envelope(1, { type: 'stepUpdated', index: 1, status: 'running' }),
      envelope(2, {
        type: 'toolCallUpdated', callId: 'call', name: 'read_note',
        title: 'Read note', status: 'success', stepIndex: 1,
        inputSummary: 'Project plan', outputSummary: 'Read 24 lines', durationMillis: 12
      }),
      envelope(3, {
        type: 'contextUpdated', compacted: true, selectedNoteTitles: ['Project plan']
      }),
      envelope(4, {
        type: 'proposalLinked', proposalId: 'proposal-1',
        title: 'Project plan', kind: 'update'
      }),
      envelope(5, {
        type: 'runGuardTriggered', reason: 'toolBudgetExceeded',
        message: 'The agent stopped after reaching its tool limit.'
      })
    ];
    const state = replayAgentEvents('', events);

    expect(state.parts.some((part) => part.id.startsWith('step:'))).toBe(false);
    expect(state.parts.find((part) => part.type === 'tool')).toMatchObject({
      inputSummary: 'Project plan', outputSummary: 'Read 24 lines', durationMillis: 12
    });
    expect(state.parts.find((part) => part.type === 'context')).toMatchObject({
      compacted: true, selectedNoteTitles: ['Project plan']
    });
    expect(state.parts.find((part) => part.type === 'proposalRef')).toMatchObject({
      proposalId: 'proposal-1'
    });
    expect(state.parts.find((part) => part.id === 'run-guard')).toMatchObject({
      reason: 'toolBudgetExceeded'
    });
  });

  it('settles a running tool when its message reaches a terminal state', () => {
    const settled = settleAgentActivity([
      { id: 'text', type: 'text', text: 'Done' },
      {
        id: 'tool:read', type: 'tool', callId: 'read', name: 'read_note',
        title: 'Read note', status: 'running'
      }
    ], 'completed');

    expect(settled.find((part) => part.type === 'tool')).toMatchObject({
      status: 'success'
    });
  });

  it('rejects wrong-target, unsupported, duplicate, and stale-run events', () => {
    const current = reduceAgentEvent(
      initialAgentEventState('answer'),
      envelope(1, { type: 'stepUpdated', index: 0, status: 'running' })
    );
    expect(reduceAgentEvent(current, envelope(2, { type: 'textDelta', delta: 'wrong' }, {
      messageId: 'other-message'
    }))).toBe(current);
    expect(reduceAgentEvent(current, envelope(2, { type: 'textDelta', delta: 'future' }, {
      schemaVersion: 99
    }))).toBe(current);

    const handoff = reduceAgentEvent(current, envelope(1, {
      type: 'stepUpdated', index: 0, status: 'running'
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
    expect(reduceAgentEvent(current, envelope(4, { type: 'stepUpdated', index: 1, status: 'running' }, {
      runId: 'run-2', createdAtMillis: 40
    }))).toBe(current);
    expect(reduceAgentEvent(current, envelope(1, { type: 'stepUpdated', index: 0, status: 'running' }, {
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

  it('projects a live permission pending to resolved and never replays it after reopen', () => {
    const request = {
      permissionId: 'permission-1', requestId: 'request',
      conversationId: 'conversation', messageId: 'message', runId: 'run',
      toolCallId: 'call-1', toolName: 'fake_side_effect',
      title: 'Run fake side effect', kind: 'processExecution' as const,
      scope: 'command:echo'
    };
    const pendingEvent = envelope(1, { type: 'permissionRequested', request });
    const pending = reduceAgentEvent(initialAgentEventState(), pendingEvent);
    expect(pending.parts.find((part) => part.type === 'permission')).toMatchObject({
      status: 'pending', request
    });
    const resolvedEvent = envelope(2, {
      type: 'permissionResolved', permissionId: 'permission-1', resolution: 'allowedOnce'
    });
    const resolved = reduceAgentEvent(pending, resolvedEvent);
    expect(resolved.parts.find((part) => part.type === 'permission')).toMatchObject({
      status: 'resolved', resolution: 'allowedOnce'
    });
    expect(replayAgentEvents('', [pendingEvent, resolvedEvent]).parts).toEqual([
      { id: 'text', type: 'text', text: '' }
    ]);
    expect(settlePendingPermissions(pending.parts).find((part) => part.type === 'permission'))
      .toMatchObject({ status: 'resolved', resolution: 'cancelled' });
  });

  it('rejects a permission request for another message target', () => {
    const state = initialAgentEventState('', {
      conversationId: 'conversation', messageId: 'message'
    });
    const wrong = envelope(1, {
      type: 'permissionRequested',
      request: {
        permissionId: 'permission-1', requestId: 'request',
        conversationId: 'other', messageId: 'other', runId: 'run',
        toolCallId: 'call-1', toolName: 'fake', title: 'Fake',
        kind: 'fileMutation', scope: 'file:test'
      }
    }, { conversationId: 'other', messageId: 'other' });
    expect(reduceAgentEvent(state, wrong)).toBe(state);

    const mismatchedPayload = envelope(1, {
      type: 'permissionRequested',
      request: {
        permissionId: 'permission-2', requestId: 'different-request',
        conversationId: 'conversation', messageId: 'message', runId: 'run',
        toolCallId: 'call-2', toolName: 'fake', title: 'Fake',
        kind: 'fileMutation', scope: 'file:test'
      }
    });
    expect(reduceAgentEvent(state, mismatchedPayload)).toBe(state);
  });
});
