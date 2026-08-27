import type {
  AgentEvent,
  ChatAgentEventEnvelope,
  ChatCitation,
  ChatPart
} from './types';

export interface AgentEventState {
  parts: ChatPart[];
  requestId: string | null;
  conversationId: string | null;
  messageId: string | null;
  runId: string | null;
  sequence: number;
  createdAtMillis: number;
  retiredRunIds: string[];
}

export function initialAgentEventState(
  text = '',
  target: { conversationId?: string; messageId?: string } = {}
): AgentEventState {
  return {
    parts: [{ id: 'text', type: 'text', text }],
    requestId: null,
    conversationId: target.conversationId ?? null,
    messageId: target.messageId ?? null,
    runId: null,
    sequence: 0,
    createdAtMillis: 0,
    retiredRunIds: []
  };
}

export function materializeDurableChatParts(
  parts: ChatPart[],
  options: {
    text: string;
    citations?: ChatCitation[];
    checkpoint?: boolean;
  }
): ChatPart[] {
  const runtimeParts = parts
    .filter((part) => part.type !== 'sources' && part.type !== 'checkpoint')
    .map((part) => part.type === 'text' ? { ...part, text: options.text } : part);
  const withText = runtimeParts.some((part) => part.type === 'text')
    ? runtimeParts
    : [{ id: 'text' as const, type: 'text' as const, text: options.text }, ...runtimeParts];
  const citations = options.citations ?? [];
  return [
    ...withText,
    ...(citations.length > 0
      ? [{ id: 'sources' as const, type: 'sources' as const, citations }]
      : []),
    ...(options.checkpoint
      ? [{ id: 'checkpoint' as const, type: 'checkpoint' as const, label: 'Branch from here' }]
      : [])
  ];
}

function applyEvent(parts: ChatPart[], event: AgentEvent): ChatPart[] {
  switch (event.type) {
    case 'textDelta':
      return parts.map((part) =>
        part.type === 'text' ? { ...part, text: part.text + event.delta } : part
      );
    case 'toolCallUpdated': {
      const tool = {
        id: `tool:${event.callId}`,
        type: 'tool' as const,
        callId: event.callId,
        name: event.name,
        title: event.title,
        status: event.status
      };
      const index = parts.findIndex((part) => part.id === tool.id);
      if (index < 0) return [...parts, tool];
      const next = parts.slice();
      next[index] = tool;
      return next;
    }
    case 'planUpdated': {
      const plan = { id: 'plan' as const, type: 'plan' as const, entries: event.entries };
      const index = parts.findIndex((part) => part.id === plan.id);
      if (index < 0) return [...parts, plan];
      const next = parts.slice();
      next[index] = plan;
      return next;
    }
    case 'usageUpdated': {
      const usage = {
        id: 'usage' as const,
        type: 'usage' as const,
        callIndex: event.callIndex,
        usage: event.aggregate
      };
      const index = parts.findIndex((part) => part.id === usage.id);
      if (index < 0) return [...parts, usage];
      const next = parts.slice();
      next[index] = usage;
      return next;
    }
    case 'modelTurnRetried':
      return upsertPart(parts, {
        id: 'retry',
        type: 'status',
        status: 'retrying',
        turn: event.turn,
        label: `Model turn ${event.turn} retried`
      });
    case 'reasoningUpdated': {
      const reasoning = {
        id: 'reasoning' as const,
        type: 'reasoning' as const,
        status: event.status,
        ...(event.summary ? { summary: event.summary } : {})
      };
      const index = parts.findIndex((part) => part.id === reasoning.id);
      if (index < 0) return [...parts, reasoning];
      const next = parts.slice();
      next[index] = reasoning;
      return next;
    }
    case 'permissionRequested':
      return upsertPart(parts, {
        id: `permission:${event.request.permissionId}`,
        type: 'permission',
        request: event.request,
        status: 'pending'
      });
    case 'permissionResolved': {
      const id = `permission:${event.permissionId}`;
      const index = parts.findIndex((part) => part.id === id && part.type === 'permission');
      if (index < 0) return parts;
      const part = parts[index];
      if (part.type !== 'permission') return parts;
      const next = parts.slice();
      next[index] = {
        ...part,
        status: 'resolved',
        resolution: event.resolution
      };
      return next;
    }
  }
}

export function settlePendingPermissions(parts: ChatPart[]): ChatPart[] {
  return parts.map((part) => part.type === 'permission' && part.status === 'pending'
    ? { ...part, status: 'resolved' as const, resolution: 'cancelled' as const }
    : part);
}

function upsertPart(parts: ChatPart[], part: ChatPart): ChatPart[] {
  const index = parts.findIndex((candidate) => candidate.id === part.id);
  if (index < 0) return [...parts, part];
  const next = parts.slice();
  next[index] = part;
  return next;
}

function hasSupportedSchema(envelope: ChatAgentEventEnvelope): boolean {
  return envelope.schemaVersion === undefined || envelope.schemaVersion === 2;
}

function targetsCurrentMessage(
  state: AgentEventState,
  envelope: ChatAgentEventEnvelope
): boolean {
  return (!state.conversationId || state.conversationId === envelope.conversationId)
    && (!state.messageId || state.messageId === envelope.messageId);
}

function isRunHandoff(
  state: AgentEventState,
  envelope: ChatAgentEventEnvelope,
  allowObservedRunHandoff: boolean
): boolean {
  return state.runId !== null
    && state.runId !== envelope.runId
    && (
      allowObservedRunHandoff
      || (envelope.sequence === 1 && envelope.createdAtMillis > state.createdAtMillis)
    )
    && !state.retiredRunIds.includes(envelope.runId);
}

export function reduceAgentEvent(
  state: AgentEventState,
  envelope: ChatAgentEventEnvelope,
  options: { applyText?: boolean; allowObservedRunHandoff?: boolean } = {}
): AgentEventState {
  if (!hasSupportedSchema(envelope) || !targetsCurrentMessage(state, envelope)) return state;
  if (
    envelope.event.type === 'permissionRequested' &&
    (
      envelope.event.request.requestId !== envelope.requestId ||
      envelope.event.request.conversationId !== envelope.conversationId ||
      envelope.event.request.messageId !== envelope.messageId ||
      envelope.event.request.runId !== envelope.runId
    )
  ) return state;
  const sameRun = state.runId === envelope.runId;
  if (sameRun) {
    if (state.requestId && state.requestId !== envelope.requestId) return state;
    if (envelope.sequence <= state.sequence) return state;
  } else if (
    state.runId !== null
    && !isRunHandoff(state, envelope, options.allowObservedRunHandoff === true)
  ) {
    return state;
  }
  const handoff = state.runId !== null && !sameRun;
  const base = handoff
    ? state.parts.filter((part) =>
        part.type === 'text' || part.type === 'sources' || part.type === 'checkpoint'
      )
    : state.parts;
  const event = !options.applyText && envelope.event.type === 'textDelta'
    ? null
    : envelope.event;
  return {
    parts: event ? applyEvent(base, event) : base,
    requestId: envelope.requestId,
    conversationId: envelope.conversationId,
    messageId: envelope.messageId,
    runId: envelope.runId,
    sequence: envelope.sequence,
    createdAtMillis: sameRun
      ? Math.max(state.createdAtMillis, envelope.createdAtMillis)
      : envelope.createdAtMillis,
    retiredRunIds: handoff && state.runId
      ? [...state.retiredRunIds, state.runId]
      : state.retiredRunIds
  };
}

export function replayAgentEvents(
  text: string,
  events: ChatAgentEventEnvelope[],
  target: { conversationId?: string; messageId?: string } = {}
): AgentEventState {
  const byRun = new Map<string, ChatAgentEventEnvelope[]>();
  for (const event of events) {
    // Permission waiters and run grants are intentionally ephemeral. Even if a
    // stale row exists from a development build, reopening must not recreate it.
    if (event.event.type === 'permissionRequested' || event.event.type === 'permissionResolved') {
      continue;
    }
    const run = byRun.get(event.runId) ?? [];
    run.push(event);
    byRun.set(event.runId, run);
  }
  const orderedRuns = [...byRun.values()]
    .sort((left, right) =>
      Math.min(...left.map((event) => event.createdAtMillis))
        - Math.min(...right.map((event) => event.createdAtMillis))
      || left[0].runId.localeCompare(right[0].runId)
    )
    .map((run) => run.sort((left, right) =>
      left.sequence - right.sequence
        || left.createdAtMillis - right.createdAtMillis
    ));
  return orderedRuns.reduce((state, run) =>
    run.reduce((runState, event, index) => reduceAgentEvent(runState, event, {
      applyText: false,
      allowObservedRunHandoff: index === 0
    }), state), initialAgentEventState(text, target));
}

export function replaceTextPart(parts: ChatPart[], text: string): ChatPart[] {
  return parts.map((part) => part.type === 'text' ? { ...part, text } : part);
}
