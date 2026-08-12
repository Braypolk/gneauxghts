import type {
  AgentEvent,
  ChatAgentEventEnvelope,
  ChatPart
} from './types';

export interface AgentEventState {
  parts: ChatPart[];
  runId: string | null;
  sequence: number;
}

export function initialAgentEventState(text = ''): AgentEventState {
  return {
    parts: [{ id: 'text', type: 'text', text }],
    runId: null,
    sequence: 0
  };
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
      return parts;
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
  }
}

export function reduceAgentEvent(
  state: AgentEventState,
  envelope: ChatAgentEventEnvelope,
  options: { applyText?: boolean } = {}
): AgentEventState {
  const sameRun = state.runId === envelope.runId;
  if (sameRun && envelope.sequence <= state.sequence) return state;
  const base = sameRun || state.runId === null
    ? state.parts
    : state.parts.filter((part) => part.type === 'text');
  const event = !options.applyText && envelope.event.type === 'textDelta'
    ? null
    : envelope.event;
  return {
    parts: event ? applyEvent(base, event) : base,
    runId: envelope.runId,
    sequence: envelope.sequence
  };
}

export function replayAgentEvents(
  text: string,
  events: ChatAgentEventEnvelope[]
): AgentEventState {
  return events.reduce(
    (state, event) => reduceAgentEvent(state, event),
    initialAgentEventState(text)
  );
}

export function replaceTextPart(parts: ChatPart[], text: string): ChatPart[] {
  return parts.map((part) => part.type === 'text' ? { ...part, text } : part);
}
