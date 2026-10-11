import type { ChatConversation, ChatConversationSummary, ChatSettings, ChatNoteGrant, ChatNotePolicy, ChatAgentProposal, ChatModelCapabilities, ChatProvider, ChatReasoningEffort, VaultAccess, ChatMessage, ChatEventMap, ChatSendReceipt } from '../types';
import { configuredChatModel } from '../chatConfiguration';
import { materializeDurableChatParts, reduceAgentEvent, replaceTextPart, settlePendingPermissions } from '../agentEvents';
export interface ChatControllerState {
  settings: ChatSettings | null;
  conversations: ChatConversationSummary[];
  conversationDraft: {
    revision: number;
    title: string;
    provider: ChatProvider;
    model: string;
    reasoningEffort: ChatReasoningEffort;
    vaultAccess: VaultAccess;
  };
  grants: ChatNoteGrant[];
  policies: ChatNotePolicy[];
  conversation: ChatConversation | null;
  isInitialized: boolean;
  isInitializing: boolean;
  isLoadingConversation: boolean;
  isSending: boolean;
  error: string | null;
  activity: string | null;
  proposals: ChatAgentProposal[];
  modelCapabilities: ChatModelCapabilities | null;
  draftPromotion: {
    revision: number;
    conversationId: string;
  } | null;
  selectionRevision: number;
}
type LifecycleState = {
  kind: 'uninitialized';
} | {
  kind: 'initializing';
  sequence: number;
} | {
  kind: 'ready';
} | {
  kind: 'unavailable';
} | {
  kind: 'disposed';
};
type SelectionState = {
  kind: 'idle';
} | {
  kind: 'loading';
  conversationId: string;
  operationId: number;
} | {
  kind: 'creating' | 'branching';
  operationId: number;
} | {
  kind: 'archiving';
  conversationId: string;
  operationId: number;
};
type RequestState = {
  kind: 'idle';
  lastTerminalRequestId?: string;
} | {
  kind: 'submitting';
  conversationId: string;
  operationId: number;
  activity: string | null;
} | {
  kind: 'streaming' | 'cancelling';
  conversationId: string;
  requestId: string;
  messageId: string | null;
  activity: string | null;
};
type LifecycleEvent = {
  type: 'initialize';
  sequence: number;
} | {
  type: 'initialized';
  sequence: number;
} | {
  type: 'initializationFailed';
  sequence: number;
  error?: string;
} | {
  type: 'dispose';
};
type RequestEvent = {
  type: 'submit';
  conversationId: string;
  operationId: number;
  activity?: string | null;
} | {
  type: 'accepted';
  conversationId: string;
  requestId: string;
  messageId?: string | null;
  operationId: number;
} | {
  type: 'started';
  conversationId: string;
  requestId: string;
  messageId: string;
} | {
  type: 'activity';
  conversationId: string;
  requestId: string;
  messageId: string;
  activity: string;
} | {
  type: 'cancel';
  conversationId: string;
  requestId: string;
} | {
  type: 'cancelFailed';
  conversationId: string;
  requestId: string;
  error?: string;
} | {
  type: 'terminal';
  conversationId: string;
  requestId: string;
} | {
  type: 'submissionFailed';
  conversationId: string;
  operationId: number;
  error?: string;
} | {
  type: 'restore';
  conversationId: string;
  requestId: string | null;
} | {
  type: 'reset';
};
export interface ChatControllerMachineState extends Omit<ChatControllerState, 'isInitialized' | 'isInitializing' | 'isLoadingConversation' | 'isSending' | 'activity'> {
  lifecycle: LifecycleState;
  selection: SelectionState;
  request: RequestState;
  selectionRevision: number;
  configurationRevision: number;
  submissionOperation: number | null;
}
type Metadata = Partial<Pick<ChatControllerMachineState, 'settings' | 'conversations' | 'grants' | 'policies' | 'error'>>;
export type BackendChatEvent = {
  [K in keyof ChatEventMap]: {
    type: 'backend';
    channel: K;
    payload: ChatEventMap[K];
    now: number;
  };
}[keyof ChatEventMap];
export type ChatControllerMachineEvent = LifecycleEvent | RequestEvent | BackendChatEvent | {
  type: 'metadata';
  data: Metadata;
} | {
  type: 'proposalSettled';
  proposalId: string;
  conflict?: boolean;
  error?: string | null;
} | {
  type: 'startLoading';
  conversationId: string;
  operationId: number;
} | {
  type: 'startCreating' | 'startBranching';
  operationId: number;
} | {
  type: 'startArchiving';
  conversationId: string;
  operationId: number;
} | {
  type: 'selectionLoaded';
  operationId: number;
  conversation: ChatConversation;
  proposals: ChatAgentProposal[];
  capabilities: ChatModelCapabilities | null;
  draftRevision?: number;
} | {
  type: 'selectionFailed';
  operationId: number;
  error: string;
} | {
  type: 'archived';
  operationId: number;
  conversationId: string;
} | {
  type: 'draftStarted';
  title: string;
  capabilities: ChatModelCapabilities | null;
} | {
  type: 'draftChanged';
  changes: Partial<ChatControllerState['conversationDraft']>;
} | {
  type: 'configurationStarted';
} | {
  type: 'configurationReceived';
  revision: number;
  changes?: Partial<ChatConversationSummary>;
  capabilities?: ChatModelCapabilities | null;
  error?: string;
} | {
  type: 'draftCapabilities';
  revision: number;
  provider: ChatProvider;
  model: string;
  capabilities: ChatModelCapabilities | null;
  effort?: ChatReasoningEffort;
  error?: string;
} | {
  type: 'summaryReceived';
  summary: ChatConversationSummary;
} | {
  type: 'receipt';
  receipt: ChatSendReceipt;
  operationId: number;
  includeUser: boolean;
};
export function createChatControllerMachineState(): ChatControllerMachineState {
  return {
    lifecycle: { kind: 'uninitialized' },
    selection: { kind: 'idle' },
    request: { kind: 'idle' },
    selectionRevision: 0,
    configurationRevision: 0,
    submissionOperation: null,
    settings: null,
    conversations: [],
    grants: [],
    policies: [],
    conversation: null,
    conversationDraft: {
      revision: 0,
      title: '',
      ...draftConfiguration(null)
    },
    error: null,
    proposals: [],
    modelCapabilities: null,
    draftPromotion: null
  };
}
export function projectChatController(state: ChatControllerMachineState): ChatControllerState {
  return {
    settings: state.settings,
    conversations: state.conversations,
    conversationDraft: state.conversationDraft,
    grants: state.grants,
    policies: state.policies,
    conversation: state.conversation,
    error: state.error,
    proposals: state.proposals,
    modelCapabilities: state.modelCapabilities,
    draftPromotion: state.draftPromotion,
    selectionRevision: state.selectionRevision,
    isInitialized: state.lifecycle.kind === 'ready',
    isInitializing: state.lifecycle.kind === 'initializing',
    isLoadingConversation: isChatSelectionBusy(state),
    isSending: isChatRequestBusy(state),
    activity: 'activity' in state.request ? state.request.activity : null
  };
}
function selected(state: ChatControllerMachineState, conversation: ChatConversation): ChatControllerMachineState {
  const activeRequestId = state.request.kind === 'streaming' || state.request.kind === 'cancelling'
    ? state.request.conversationId === conversation.id ? state.request.requestId : null : null;
  const current = { ...conversation, activeRequestId };
  return {
    ...state,
    conversation: current,
    conversations: mergeSummary(state.conversations, current)
  };
}
export function transitionChatControllerMachine(state: ChatControllerMachineState, event: ChatControllerMachineEvent): ChatControllerMachineState {
  if (state.lifecycle.kind === 'disposed')
    return state;
  switch (event.type) {
    case 'dispose': return {
      ...state,
      lifecycle: { kind: 'disposed' },
      selection: { kind: 'idle' },
      request: { kind: 'idle' }
    };
    case 'initialize':
    case 'initialized':
    case 'initializationFailed': {
      const lifecycle = transitionLifecycle(state.lifecycle, event);
      return lifecycle === state.lifecycle ? state : {
        ...state,
        lifecycle,
        ...(event.type === 'initializationFailed' ? { error: event.error ?? state.error } : {})
      };
    }
    case 'proposalSettled':
      if (!state.proposals.some(proposal => proposal.id === event.proposalId))
        return state;
      return {
        ...state,
        error: event.error ?? null,
        proposals: event.conflict
          ? state.proposals.map(proposal => proposal.id === event.proposalId ? { ...proposal, status: 'conflict' } : proposal)
          : state.proposals.filter(proposal => proposal.id !== event.proposalId)
      };
    case 'metadata': return { ...state, ...event.data };
    case 'startLoading':
    case 'startCreating':
    case 'startBranching':
    case 'startArchiving': {
      const selection: SelectionState = event.type === 'startLoading'
        ? {
          kind: 'loading',
          conversationId: event.conversationId,
          operationId: event.operationId
        }
        : event.type === 'startArchiving'
          ? {
            kind: 'archiving',
            conversationId: event.conversationId,
            operationId: event.operationId
          }
          : {
            kind: event.type === 'startCreating' ? 'creating' : 'branching',
            operationId: event.operationId
          };
      return {
        ...state,
        selection,
        selectionRevision: state.selectionRevision + 1,
        configurationRevision: state.configurationRevision + 1,
        error: null
      };
    }
    case 'selectionLoaded': {
      if (state.selection.kind === 'idle' || state.selection.operationId !== event.operationId)
        return state;
      const request = transitionRequest(state.request, {
        type: 'restore',
        conversationId: event.conversation.id,
        requestId: event.conversation.activeRequestId
      });
      return selected({
        ...state,
        selection: { kind: 'idle' },
        request,
        submissionOperation: null,
        proposals: event.proposals,
        modelCapabilities: event.capabilities,
        error: null,
        draftPromotion: event.draftRevision === undefined ? null : { revision: event.draftRevision, conversationId: event.conversation.id }
      }, event.conversation);
    }
    case 'selectionFailed':
      return state.selection.kind !== 'idle' && state.selection.operationId === event.operationId
        ? {
          ...state,
          selection: { kind: 'idle' },
          error: event.error
        } : state;
    case 'archived': {
      if (state.selection.kind !== 'archiving' || state.selection.operationId !== event.operationId)
        return state;
      const next = {
        ...state,
        selection: { kind: 'idle' as const },
        conversations: state.conversations.filter(item => item.id !== event.conversationId)
      };
      return state.conversation?.id === event.conversationId
        ? transitionChatControllerMachine(next, {
          type: 'draftStarted',
          title: '',
          capabilities: null
        }) : next;
    }
    case 'draftStarted': return {
      ...state,
      selection: { kind: 'idle' },
      request: { kind: 'idle' },
      submissionOperation: null,
      selectionRevision: state.selectionRevision + 1,
      configurationRevision: state.configurationRevision + 1,
      conversation: null,
      conversationDraft: {
        revision: state.conversationDraft.revision + 1,
        title: event.title,
        ...draftConfiguration(state.settings)
      },
      proposals: [],
      modelCapabilities: event.capabilities,
      draftPromotion: null,
      error: null
    };
    case 'draftChanged': return state.conversation ? state : { ...state, conversationDraft: { ...state.conversationDraft, ...event.changes } };
    case 'configurationStarted': return { ...state, configurationRevision: state.configurationRevision + 1 };
    case 'configurationReceived': {
      if (event.revision !== state.configurationRevision || isChatRequestBusy(state))
        return state;
      const next = {
        ...state,
        ...(event.capabilities !== undefined ? { modelCapabilities: event.capabilities } : {}),
        error: event.error ?? null
      };
      return state.conversation && event.changes
        ? selected(next, { ...state.conversation, ...event.changes })
        : { ...next, conversationDraft: { ...state.conversationDraft, ...event.changes } };
    }
    case 'draftCapabilities':
      return state.conversation || state.conversationDraft.revision !== event.revision || state.conversationDraft.provider !== event.provider || state.conversationDraft.model !== event.model
        ? state : {
          ...state,
          modelCapabilities: event.capabilities,
          error: event.error ?? state.error,
          conversationDraft: {
            ...state.conversationDraft,
            reasoningEffort: event.effort ?? state.conversationDraft.reasoningEffort
          }
        };
    case 'summaryReceived': {
      const next = {
        ...state,
        conversations: mergeSummary(state.conversations, event.summary),
        error: null
      };
      return state.conversation?.id === event.summary.id ? selected(next, { ...state.conversation, ...event.summary }) : next;
    }
    case 'receipt': {
      if (state.submissionOperation !== event.operationId || state.conversation?.id !== event.receipt.conversationId)
        return state;
      const { receipt } = event;
      const request = transitionRequest(state.request, {
        type: 'accepted',
        conversationId: receipt.conversationId,
        requestId: receipt.requestId,
        messageId: receipt.assistantMessage?.id ?? null,
        operationId: event.operationId
      });
      const initial = state.request.kind === 'submitting' && request !== state.request;
      const placeholders = event.includeUser ? [receipt.userMessage, receipt.assistantMessage] : [receipt.assistantMessage];
      const messages = placeholders.reduce<ChatMessage[]>((messages, message) => message && (initial || !messages.some(item => item.id === message.id)) ? upsertMessage(messages, message) : messages, state.conversation.messages);
      return selected({ ...state, request }, { ...state.conversation, messages });
    }
    case 'backend': return reduceBackend(state, event);
    default: {
      if (event.type === 'submit' && (state.conversation?.id !== event.conversationId || isChatSelectionBusy(state)))
        return state;
      const request = transitionRequest(state.request, event);
      if (request === state.request)
        return state;
      const next = {
        ...state,
        request,
        ...('error' in event ? { error: event.error ?? state.error } : {}),
        ...(event.type === 'submit' ? { submissionOperation: event.operationId, error: null } : {})
      };
      return state.conversation ? selected(next, state.conversation) : next;
    }
  }
}
function reduceBackend(state: ChatControllerMachineState, event: BackendChatEvent): ChatControllerMachineState {
  if (event.channel === 'chat://title-updated')
    return transitionChatControllerMachine(state, { type: 'summaryReceived', summary: event.payload.conversation });
  if (event.payload.conversationId !== state.conversation?.id)
    return state;
  const conversation = state.conversation;
  if (event.channel === 'chat://projection-conflict')
    return state;
  if (event.channel === 'chat://proposal')
    return {
      ...state,
      proposals: [...state.proposals.filter(item => item.id !== event.payload.id && !(item.kind === event.payload.kind &&
        (item.noteId ?? item.suggestedPath) === (event.payload.noteId ?? event.payload.suggestedPath))), event.payload]
    };
  const payload = event.payload;
  const existing = conversation.messages.find(message => message.id === payload.messageId);
  if (existing?.requestId === payload.requestId &&
      (existing.status === 'completed' || existing.status === 'cancelled' || existing.status === 'error')) {
    return state;
  }
  const terminal = event.channel === 'chat://completed' || event.channel === 'chat://cancelled' || event.channel === 'chat://failed';
  const request = transitionRequest(state.request, terminal
    ? {
      type: 'terminal',
      conversationId: payload.conversationId,
      requestId: payload.requestId
    }
    : event.channel === 'chat://activity'
      ? {
        type: 'activity',
        conversationId: payload.conversationId,
        requestId: payload.requestId,
        messageId: payload.messageId,
        activity: event.payload.status
      }
      : {
        type: 'started',
        conversationId: payload.conversationId,
        requestId: payload.requestId,
        messageId: payload.messageId
      });
  if (request === state.request)
    return state;
  const next = { ...state, request };
  switch (event.channel) {
    case 'chat://started': return selected({ ...next, error: null }, {
      ...conversation,
      ...(event.payload.conversation ?? {}),
      messages: upsertTerminalMessage(conversation.messages, event.payload.message)
    });
    case 'chat://completed':
    case 'chat://cancelled':
    case 'chat://failed':
      return selected({ ...next, ...(event.channel === 'chat://failed' ? { error: event.payload.error } : {}) }, {
        ...conversation,
        ...(event.channel === 'chat://completed' ? event.payload.conversation ?? {} : {}),
        messages: upsertTerminalMessage(conversation.messages, event.payload.message)
      });
    case 'chat://activity': return selected(next, conversation);
    case 'chat://answer-draft': return selected(next, {
      ...conversation,
      messages: conversation.messages.map(message => {
        const { attempt, sequence, content } = event.payload;
        if (message.id !== event.payload.messageId || message.requestId !== event.payload.requestId ||
            attempt < 1 || sequence < 1 || !Number.isSafeInteger(attempt) || !Number.isSafeInteger(sequence) ||
            (message.answerDraft && (attempt < message.answerDraft.attempt || sequence <= message.answerDraft.sequence)))
          return message;
        return { ...message, answerDraft: { attempt, sequence, text: content }, status: 'streaming', updatedAtMillis: event.now };
      })
    });
    case 'chat://text-delta': return selected(next, {
      ...conversation,
      messages: conversation.messages.map(message => {
        if (message.id !== event.payload.messageId)
          return message;
        const content = message.content + event.payload.delta;
        return {
          ...message,
          content,
          parts: replaceTextPart(message.parts, content),
          status: 'streaming',
          updatedAtMillis: event.now
        };
      })
    });
    case 'chat://source': return selected(next, {
      ...conversation,
      messages: conversation.messages.map(message => {
        if (message.id !== event.payload.messageId)
          return message;
        const citations = [...message.citations.filter(citation => citation.id !== event.payload.citation.id), event.payload.citation];
        return {
          ...message,
          citations,
          parts: materializeDurableChatParts(message.parts, {
            text: message.content,
            citations,
            checkpoint: message.role === 'assistant' && message.status === 'completed'
          })
        };
      })
    });
    case 'chat://agent-event': return selected(next, {
      ...conversation,
      messages: conversation.messages.map(message => {
        if (message.id !== event.payload.messageId)
          return message;
        const reduced = reduceAgentEvent({
          parts: message.parts,
          requestId: message.requestId,
          conversationId: message.conversationId,
          messageId: message.id,
          runId: message.agentRunId,
          sequence: message.agentSequence,
          createdAtMillis: message.agentEventCreatedAtMillis,
          retiredRunIds: message.agentRetiredRunIds
        }, event.payload, {
          applyText: false,
          allowObservedRunHandoff: message.agentRunId !== null && message.agentRunId !== event.payload.runId
        });
        return {
          ...message,
          parts: reduced.parts,
          requestId: reduced.requestId,
          agentRunId: reduced.runId,
          agentSequence: reduced.sequence,
          agentEventCreatedAtMillis: reduced.createdAtMillis,
          agentRetiredRunIds: reduced.retiredRunIds
        };
      })
    });
  }
}
export function isChatSelectionBusy(state: ChatControllerMachineState) { return state.selection.kind !== 'idle'; }
export function isChatRequestBusy(state: ChatControllerMachineState) { return state.request.kind !== 'idle'; }
function upsertMessage(messages: ChatMessage[], message: ChatMessage): ChatMessage[] {
  const index = messages.findIndex((candidate) => candidate.id === message.id);
  if (index < 0)
    return [...messages, message].sort((a, b) => a.createdAtMillis - b.createdAtMillis);
  const next = messages.slice();
  next[index] = message;
  return next;
}
function upsertTerminalMessage(messages: ChatMessage[], message: ChatMessage): ChatMessage[] {
  const previous = messages.find((candidate) => candidate.id === message.id);
  if (!previous || previous.requestId !== message.requestId) {
    return upsertMessage(messages, {
      ...message,
      parts: materializeDurableChatParts(message.parts, {
        text: message.content,
        citations: message.citations,
        checkpoint: message.role === 'assistant' && message.status === 'completed'
      })
    });
  }
  const citations = message.citations.length > 0 ? message.citations : previous.citations;
  return upsertMessage(messages, {
    ...message,
    citations,
    linkTarget: message.linkTarget ?? previous.linkTarget,
    parts: settlePendingPermissions(materializeDurableChatParts(previous.parts, {
      text: message.content,
      citations,
      checkpoint: message.role === 'assistant' && message.status === 'completed'
    })),
    requestId: previous.requestId,
    agentRunId: previous.agentRunId,
    agentSequence: previous.agentSequence,
    agentEventCreatedAtMillis: previous.agentEventCreatedAtMillis,
    agentRetiredRunIds: previous.agentRetiredRunIds
  });
}
function mergeSummary(list: ChatConversationSummary[], summary: ChatConversationSummary) {
  const compact: ChatConversationSummary = {
    id: summary.id,
    title: summary.title,
    status: summary.status,
    vaultAccess: summary.vaultAccess,
    createdAtMillis: summary.createdAtMillis,
    updatedAtMillis: summary.updatedAtMillis,
    messageCount: summary.messageCount,
    lastMessagePreview: summary.lastMessagePreview,
    provider: summary.provider,
    model: summary.model,
    reasoningEffort: summary.reasoningEffort
  };
  return [compact, ...list.filter((item) => item.id !== compact.id)].sort((a, b) => b.updatedAtMillis - a.updatedAtMillis);
}
export function draftConfiguration(settings: ChatSettings | null): Pick<ChatControllerState['conversationDraft'], 'provider' | 'model' | 'reasoningEffort' | 'vaultAccess'> {
  const provider = settings?.provider ?? 'openai';
  return {
    provider,
    model: configuredChatModel(settings, provider),
    reasoningEffort: settings?.reasoningEffort ?? 'medium',
    vaultAccess: settings?.defaultVaultAccess ?? 'approved'
  };
}
function transitionLifecycle(state: LifecycleState, event: LifecycleEvent): LifecycleState {
  if (state.kind === 'disposed')
    return state;
  switch (event.type) {
    case 'initialize':
      return { kind: 'initializing', sequence: event.sequence };
    case 'initialized':
      return state.kind === 'initializing' && state.sequence === event.sequence
        ? { kind: 'ready' }
        : state;
    case 'initializationFailed':
      return state.kind === 'initializing' && state.sequence === event.sequence
        ? { kind: 'unavailable' }
        : state;
    case 'dispose':
      return { kind: 'disposed' };
    default:
      return assertNeverChatEvent(event);
  }
}
function transitionRequest(state: RequestState, event: RequestEvent): RequestState {
  switch (event.type) {
    case 'submit':
      return state.kind === 'idle'
        ? {
          kind: 'submitting',
          conversationId: event.conversationId,
          operationId: event.operationId,
          activity: event.activity ?? null
        }
        : state;
    case 'accepted':
      if (state.kind === 'submitting' &&
        state.conversationId === event.conversationId &&
        state.operationId === event.operationId) {
        return {
          kind: 'streaming',
          conversationId: event.conversationId,
          requestId: event.requestId,
          messageId: event.messageId ?? null,
          activity: state.activity
        };
      }
      return state.kind === 'streaming' &&
        state.conversationId === event.conversationId &&
        state.requestId === event.requestId
        ? {
          ...state,
          messageId: state.messageId ?? event.messageId ?? null
        }
        : state;
    case 'started':
      if (state.kind === 'idle' &&
        state.lastTerminalRequestId === event.requestId) {
        return state;
      }
      return state.kind === 'idle' ||
        (state.kind === 'submitting' &&
          state.conversationId === event.conversationId) ||
        ((state.kind === 'streaming' || state.kind === 'cancelling') &&
          state.conversationId === event.conversationId &&
          state.requestId === event.requestId)
        ? {
          kind: state.kind === 'cancelling' ? 'cancelling' : 'streaming',
          conversationId: event.conversationId,
          requestId: event.requestId,
          messageId: event.messageId,
          activity: 'activity' in state ? state.activity : null
        }
        : state;
    case 'activity':
      if (state.kind === 'idle') {
        return state.lastTerminalRequestId === event.requestId
          ? state
          : {
            kind: 'streaming',
            conversationId: event.conversationId,
            requestId: event.requestId,
            messageId: event.messageId,
            activity: event.activity
          };
      }
      return (state.kind === 'streaming' || state.kind === 'cancelling') &&
        state.conversationId === event.conversationId &&
        state.requestId === event.requestId
        ? { ...state, activity: event.activity }
        : state;
    case 'cancel':
      return state.kind === 'streaming' &&
        state.conversationId === event.conversationId &&
        state.requestId === event.requestId
        ? { ...state, kind: 'cancelling' }
        : state;
    case 'cancelFailed':
      return state.kind === 'cancelling' &&
        state.conversationId === event.conversationId &&
        state.requestId === event.requestId
        ? { ...state, kind: 'streaming' }
        : state;
    case 'terminal':
      if (state.kind === 'idle') {
        return state.lastTerminalRequestId === event.requestId
          ? state
          : { kind: 'idle', lastTerminalRequestId: event.requestId };
      }
      if (state.kind === 'submitting' &&
        state.conversationId === event.conversationId) {
        return { kind: 'idle', lastTerminalRequestId: event.requestId };
      }
      return (state.kind === 'streaming' || state.kind === 'cancelling') &&
        state.conversationId === event.conversationId &&
        state.requestId === event.requestId
        ? { kind: 'idle', lastTerminalRequestId: event.requestId }
        : state;
    case 'submissionFailed':
      return state.kind === 'submitting' &&
        state.conversationId === event.conversationId &&
        state.operationId === event.operationId
        ? { kind: 'idle' }
        : state;
    case 'restore':
      return event.requestId
        ? {
          kind: 'streaming',
          conversationId: event.conversationId,
          requestId: event.requestId,
          messageId: null,
          activity: null
        }
        : { kind: 'idle' };
    case 'reset':
      return { kind: 'idle' };
    default:
      return assertNeverChatEvent(event);
  }
}
function assertNeverChatEvent(value: never): never {
  throw new Error(`Unhandled chat machine event: ${String(value)}`);
}
