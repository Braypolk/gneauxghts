import type { Readable, Subscriber, Unsubscriber } from 'svelte/store';
import { chatApi, type ChatApi } from './api';
import type {
  ChatConversation,
  ChatConversationSummary,
  ChatEventMap,
  ChatExcerpt,
  ChatMessage,
  ChatNoteGrant,
  ChatNotePolicy,
  ChatAgentProposal,
  ChatActiveNoteSnapshot,
  ChatAttachmentInput,
  ChatContextSelectionInput,
  ChatContextSuggestionResponse,
  ChatModelCapabilities,
  ChatProvider,
  ChatReasoningEffort,
  VaultAccess,
  ChatSettings,
  AgentPermissionDecision,
  AgentPermissionIdentity,
  LocalModel
} from './types';
import type { CommitNoteReviewResult } from '$lib/types/proposals';
import type { ForgottenNoteRetentionPreference } from '$lib/appSettings.svelte';
import type { ForgottenNoteSummary } from '$lib/types/forgottenNotes';
import { configuredChatModel, normalizeChatReasoningEffort } from './chatConfiguration';
import {
  materializeDurableChatParts,
  reduceAgentEvent,
  replaceTextPart,
  settlePendingPermissions
} from './agentEvents';
import {
  createChatControllerMachineState,
  isChatRequestBusy,
  isChatSelectionBusy,
  transitionChatControllerMachine,
  type ChatControllerMachineEvent,
  type ChatControllerMachineState
} from './machines/controllerMachine';

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
}

const initialState: Omit<
  ChatControllerState,
  | 'isInitialized'
  | 'isInitializing'
  | 'isLoadingConversation'
  | 'isSending'
  | 'activity'
> = {
  settings: null,
  conversations: [],
  conversationDraft: {
    revision: 0,
    title: '',
    provider: 'openai',
    model: '',
    reasoningEffort: 'medium',
    vaultAccess: 'approved'
  },
  grants: [],
  policies: [],
  conversation: null,
  error: null,
  proposals: [],
  modelCapabilities: null
};

export interface ChatController extends Readable<ChatControllerState> {
  getSnapshot(): ChatControllerState;
  initialize(conversationId?: string | null): Promise<void>;
  dispose(): void;
  refreshList(): Promise<void>;
  createConversation(input?: {
    title?: string;
    vaultAccess?: VaultAccess;
  }): Promise<ChatConversation | null>;
  startNewConversation(input?: { title?: string }): void;
  setConversationDraftTitle(title: string): void;
  getComposerDraft(slot: string): Promise<string>;
  setComposerDraft(slot: string, body: string): Promise<void>;
  renameConversation(title: string): Promise<boolean>;
  archiveConversation(
    conversationId?: string,
    retentionDays?: ForgottenNoteRetentionPreference
  ): Promise<ForgottenNoteSummary | null>;
  openConversation(conversationId: string): Promise<ChatConversation | null>;
  branchFromMessage(messageId: string): Promise<ChatConversation | null>;
  send(
    content: string,
    attachments?: ChatAttachmentInput[],
    forceWebSearch?: boolean,
    activeNote?: ChatActiveNoteSnapshot | null,
    selectedContext?: ChatContextSelectionInput[]
  ): Promise<boolean>;
  suggestContext(input: {
    query: string;
    vaultAccess: VaultAccess;
    excludeNoteId?: string | null;
    limit?: number;
  }): Promise<ChatContextSuggestionResponse>;
  cancel(): Promise<void>;
  decidePermission(
    identity: AgentPermissionIdentity,
    decision: AgentPermissionDecision
  ): Promise<boolean>;
  retry(messageId: string): Promise<void>;
  setVaultAccess(vaultAccess: VaultAccess): Promise<void>;
  setProvider(provider: ChatProvider, model: string): Promise<void>;
  setReasoningEffort(reasoningEffort: ChatReasoningEffort): Promise<void>;
  listOpenAiModels(): Promise<LocalModel[]>;
  listLocalModels(): Promise<LocalModel[]>;
  keepProposal(
    proposalId: string,
    markdown?: string
  ): Promise<CommitNoteReviewResult>;
  dismissProposal(proposalId: string): Promise<void>;
  removeResolvedProposal(proposalId: string): void;
  setNoteExcluded(noteId: string, title: string, excluded: boolean): Promise<void>;
  grantNote(noteId: string): Promise<void>;
  revokeNote(noteId: string): Promise<void>;
  createExcerpt(messageId: string, text: string): Promise<ChatExcerpt>;
  rememberExcerpt(excerptId: string): Promise<ChatExcerpt>;
  remember(messageId: string, text: string): Promise<ChatExcerpt>;
  unremember(excerptId: string): Promise<ChatExcerpt>;
  clearError(): void;
}

function errorText(error: unknown, fallback: string): string {
  if (typeof error === 'string' && error.trim()) return error;
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}

function upsertMessage(messages: ChatMessage[], message: ChatMessage): ChatMessage[] {
  const index = messages.findIndex((candidate) => candidate.id === message.id);
  if (index < 0) return [...messages, message].sort((a, b) => a.createdAtMillis - b.createdAtMillis);
  const next = messages.slice();
  next[index] = message;
  return next;
}

function upsertTerminalMessage(messages: ChatMessage[], message: ChatMessage): ChatMessage[] {
  const previous = messages.find((candidate) => candidate.id === message.id);
  if (!previous) {
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
    parts: settlePendingPermissions(
      materializeDurableChatParts(previous.parts, {
        text: message.content,
        citations,
        checkpoint: message.role === 'assistant' && message.status === 'completed'
      })
    ),
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
  return [compact, ...list.filter((item) => item.id !== compact.id)].sort(
    (a, b) => b.updatedAtMillis - a.updatedAtMillis
  );
}

function draftConfiguration(
  settings: ChatSettings | null
): Pick<
  ChatControllerState['conversationDraft'],
  'provider' | 'model' | 'reasoningEffort' | 'vaultAccess'
> {
  const provider = settings?.provider ?? 'openai';
  return {
    provider,
    model: configuredChatModel(settings, provider),
    reasoningEffort: settings?.reasoningEffort ?? 'medium',
    vaultAccess: settings?.defaultVaultAccess ?? 'approved'
  };
}

export interface ChatControllerOptions {
  /**
   * Fired after a successful assistant completion for the open conversation.
   * Used to lift structured note proposals into the review session.
   */
  onAssistantCompleted?: (info: {
    conversation: ChatConversation;
    message: ChatMessage;
  }) => void | Promise<void>;
  /** Announces a durable proposal available for passive editor display. */
  onProposalAvailable?: (
    proposal: ChatAgentProposal
  ) => void | Promise<void>;
  onProposalResolved?: (proposalId: string) => void;
}

/**
 * Rune-backed chat controller. Public surface keeps `subscribe` / `getSnapshot`
 * so ChatPanel and Notepad stay compatible while state lives in `$state`.
 */
export class ChatControllerStore implements ChatController {
  settings = $state<ChatSettings | null>(initialState.settings);
  conversations = $state<ChatConversationSummary[]>(initialState.conversations);
  conversationDraft = $state(initialState.conversationDraft);
  grants = $state<ChatNoteGrant[]>(initialState.grants);
  policies = $state<ChatNotePolicy[]>(initialState.policies);
  conversation = $state<ChatConversation | null>(initialState.conversation);
  error = $state<string | null>(initialState.error);
  proposals = $state<ChatAgentProposal[]>(initialState.proposals);
  modelCapabilities = $state<ChatModelCapabilities | null>(initialState.modelCapabilities);
  machine = $state<ChatControllerMachineState>(
    createChatControllerMachineState()
  );

  #api: ChatApi;
  #options: ChatControllerOptions;
  #subscribers = new Set<Subscriber<ChatControllerState>>();
  #unlisteners: Array<() => void> = [];
  #initializeSequence = 0;
  #selectionOperationSequence = 0;
  #requestOperationSequence = 0;
  #modelConfigurationSequence = 0;
  #listenersReady = false;
  #modelCapabilities = new Map<string, ChatModelCapabilities>();

  constructor(api: ChatApi = chatApi, options: ChatControllerOptions = {}) {
    this.#api = api;
    this.#options = options;
  }

  get isInitializing() {
    return this.machine.lifecycle.kind === 'initializing';
  }

  get isInitialized() {
    return this.machine.lifecycle.kind === 'ready';
  }

  get isLoadingConversation() {
    return isChatSelectionBusy(this.machine);
  }

  get isSending() {
    return isChatRequestBusy(this.machine);
  }

  get activity() {
    return 'activity' in this.machine.request
      ? this.machine.request.activity
      : null;
  }

  #isDisposed() {
    return this.machine.lifecycle.kind === 'disposed';
  }

  #isInitializationCurrent(sequence: number) {
    return (
      this.machine.lifecycle.kind === 'initializing' &&
      this.machine.lifecycle.sequence === sequence
    );
  }

  #dispatch(event: ChatControllerMachineEvent) {
    const previous = this.machine;
    this.machine = transitionChatControllerMachine(previous, event);
    return this.machine !== previous;
  }

  getSnapshot(): ChatControllerState {
    return {
      settings: this.settings,
      conversations: this.conversations,
      conversationDraft: this.conversationDraft,
      grants: this.grants,
      policies: this.policies,
      conversation: this.conversation,
      isInitialized: this.isInitialized,
      isInitializing: this.isInitializing,
      isLoadingConversation: this.isLoadingConversation,
      isSending: this.isSending,
      error: this.error,
      activity: this.activity,
      proposals: this.proposals,
      modelCapabilities: this.modelCapabilities
    };
  }

  subscribe(run: Subscriber<ChatControllerState>): Unsubscriber {
    run(this.getSnapshot());
    this.#subscribers.add(run);
    return () => {
      this.#subscribers.delete(run);
    };
  }

  #notify() {
    if (this.#isDisposed() || this.#subscribers.size === 0) return;
    const snapshot = this.getSnapshot();
    for (const run of this.#subscribers) {
      run(snapshot);
    }
  }

  #patch(partial: Partial<ChatControllerState>) {
    if (this.#isDisposed()) return;
    if (partial.settings !== undefined) this.settings = partial.settings;
    if (partial.conversations !== undefined) this.conversations = partial.conversations;
    if (partial.conversationDraft !== undefined) {
      this.conversationDraft = partial.conversationDraft;
    }
    if (partial.grants !== undefined) this.grants = partial.grants;
    if (partial.policies !== undefined) this.policies = partial.policies;
    if (partial.conversation !== undefined) this.conversation = partial.conversation;
    if (partial.error !== undefined) this.error = partial.error;
    if (partial.proposals !== undefined) this.proposals = partial.proposals;
    if (partial.modelCapabilities !== undefined) {
      this.modelCapabilities = partial.modelCapabilities;
    }
    this.#notify();
  }

  #updateConversation(updater: (conversation: ChatConversation) => ChatConversation) {
    if (this.#isDisposed() || !this.conversation) return;
    const conversation = updater(this.conversation);
    this.conversation = conversation;
    this.conversations = mergeSummary(this.conversations, conversation);
    this.#notify();
  }

  #ifCurrent<T extends { conversationId: string }>(event: T, apply: () => void) {
    if (this.conversation?.id === event.conversationId) apply();
  }

  #modelKey(provider: ChatProvider, model: string) {
    return `${provider}:${model}`;
  }

  async #getModelCapabilities(
    provider: ChatProvider,
    model: string
  ) {
    const key = this.#modelKey(provider, model);
    const cached = this.#modelCapabilities.get(key);
    // Local profiles are editable in Settings, so refresh them instead of
    // allowing a controller-lived cache to hide a newly saved configuration.
    if (cached && provider !== 'local') return cached;
    const capabilities =
      await this.#api.getModelCapabilities(provider, model);
    this.#modelCapabilities.set(key, capabilities);
    return capabilities;
  }

  #reasoningEffortForModel(
    provider: ChatProvider,
    model: string,
    fallback: ChatReasoningEffort,
    capabilities: ChatModelCapabilities | null
  ) {
    const configured =
      provider === 'local'
        ? capabilities?.defaultReasoningEffort ?? fallback
        : fallback;
    return normalizeChatReasoningEffort(provider, model, configured);
  }

  async #loadDraftModelCapabilities(
    revision: number,
    provider: ChatProvider,
    model: string
  ) {
    if (!model) {
      if (
        !this.conversation &&
        this.conversationDraft.revision === revision
      ) {
        this.#patch({ modelCapabilities: null });
      }
      return;
    }
    try {
      const modelCapabilities =
        await this.#getModelCapabilities(provider, model);
      if (
        !this.conversation &&
        this.conversationDraft.revision === revision &&
        this.conversationDraft.provider === provider &&
        this.conversationDraft.model === model
      ) {
        const reasoningEffort = this.#reasoningEffortForModel(
          provider,
          model,
          this.conversationDraft.reasoningEffort,
          modelCapabilities
        );
        this.#patch({
          modelCapabilities,
          conversationDraft: {
            ...this.conversationDraft,
            reasoningEffort
          }
        });
      }
    } catch (error) {
      if (
        !this.conversation &&
        this.conversationDraft.revision === revision
      ) {
        this.#patch({
          modelCapabilities: null,
          error: errorText(
            error,
            'Unable to load attachment capabilities for this model.'
          )
        });
      }
    }
  }

  #eventHandlers: { [K in keyof ChatEventMap]: (event: ChatEventMap[K]) => void } = {
    'chat://started': (event) =>
      this.#ifCurrent(event, () => {
        if (
          !this.#dispatch({
            type: 'started',
            conversationId: event.conversationId,
            requestId: event.requestId,
            messageId: event.messageId
          })
        ) {
          return;
        }
        this.#updateConversation((conversation) => ({
          ...conversation,
          ...(event.conversation ?? {}),
          activeRequestId: event.requestId,
          messages: upsertTerminalMessage(conversation.messages, event.message)
        }));
        this.#patch({ error: null });
      }),
    'chat://text-delta': (event) =>
      this.#ifCurrent(event, () => {
        if (
          !this.#dispatch({
            type: 'started',
            conversationId: event.conversationId,
            requestId: event.requestId,
            messageId: event.messageId
          })
        ) {
          return;
        }
        this.#updateConversation((conversation) => {
          const messages = conversation.messages.map((message) => {
            if (message.id !== event.messageId) return message;
            const content = message.content + event.delta;
            return {
              ...message,
              content,
              parts: replaceTextPart(message.parts, content),
              status: 'streaming' as const,
              updatedAtMillis: Date.now()
            };
          });
          return { ...conversation, activeRequestId: event.requestId, messages };
        });
      }),
    'chat://source': (event) =>
      this.#ifCurrent(event, () => {
        if (
          !this.#dispatch({
            type: 'started',
            conversationId: event.conversationId,
            requestId: event.requestId,
            messageId: event.messageId
          })
        ) {
          return;
        }
        this.#updateConversation((conversation) => ({
          ...conversation,
          messages: conversation.messages.map((message) => {
            if (message.id !== event.messageId) return message;
            const citations = [
              ...message.citations.filter((citation) => citation.id !== event.citation.id),
              event.citation
            ];
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
        }));
      }),
    'chat://completed': (event) =>
      this.#ifCurrent(event, () => {
        const wasIdle = this.machine.request.kind === 'idle';
        const accepted = this.#dispatch({
          type: 'terminal',
          conversationId: event.conversationId,
          requestId: event.requestId
        });
        if (!wasIdle && !accepted) return;
        this.#updateConversation((conversation) => ({
          ...conversation,
          ...(event.conversation ?? {}),
          activeRequestId: null,
          messages: upsertTerminalMessage(conversation.messages, event.message)
        }));
        const conversation = this.conversation;
        if (
          conversation &&
          event.message.role === 'assistant' &&
          event.message.status === 'completed'
        ) {
          void this.#options.onAssistantCompleted?.({
            conversation,
            message: event.message
          });
        }
      }),
    'chat://title-updated': (event) => {
      if (this.#isDisposed()) return;
      this.conversations = mergeSummary(this.conversations, event.conversation);
      if (this.conversation?.id === event.conversationId) {
        this.conversation = { ...this.conversation, ...event.conversation };
      }
      this.#notify();
    },
    'chat://cancelled': (event) =>
      this.#ifCurrent(event, () => {
        const wasIdle = this.machine.request.kind === 'idle';
        const accepted = this.#dispatch({
          type: 'terminal',
          conversationId: event.conversationId,
          requestId: event.requestId
        });
        if (!wasIdle && !accepted) return;
        this.#updateConversation((conversation) => ({
          ...conversation,
          activeRequestId: null,
          messages: upsertTerminalMessage(conversation.messages, event.message)
        }));
      }),
    'chat://failed': (event) =>
      this.#ifCurrent(event, () => {
        const wasIdle = this.machine.request.kind === 'idle';
        const accepted = this.#dispatch({
          type: 'terminal',
          conversationId: event.conversationId,
          requestId: event.requestId
        });
        if (!wasIdle && !accepted) return;
        this.#updateConversation((conversation) => ({
          ...conversation,
          activeRequestId: null,
          messages: upsertTerminalMessage(conversation.messages, event.message)
        }));
        this.#patch({ error: event.error });
      }),
    'chat://activity': (event) =>
      this.#ifCurrent(event, () => {
        if (
          this.#dispatch({
            type: 'activity',
            conversationId: event.conversationId,
            requestId: event.requestId,
            messageId: event.messageId,
            activity: event.status
          })
        ) {
          this.#notify();
        }
      }),
    'chat://agent-event': (event) =>
      this.#ifCurrent(event, () => {
        if (
          !this.#dispatch({
            type: 'started',
            conversationId: event.conversationId,
            requestId: event.requestId,
            messageId: event.messageId
          })
        ) {
          return;
        }
        this.#updateConversation((conversation) => ({
          ...conversation,
          activeRequestId: event.requestId,
          messages: conversation.messages.map((message) => {
            if (message.id !== event.messageId) return message;
            const next = reduceAgentEvent(
              {
                parts: message.parts,
                requestId: message.requestId,
                conversationId: message.conversationId,
                messageId: message.id,
                runId: message.agentRunId,
                sequence: message.agentSequence,
                createdAtMillis: message.agentEventCreatedAtMillis,
                retiredRunIds: message.agentRetiredRunIds
              },
              event,
              {
                applyText: false,
                // The controller machine has already correlated this event to
                // the active request, so a newer run may safely resume a
                // message even if earlier envelopes were missed.
                allowObservedRunHandoff: message.agentRunId !== null
                  && message.agentRunId !== event.runId
              }
            );
            return {
              ...message,
              parts: next.parts,
              requestId: next.requestId,
              agentRunId: next.runId,
              agentSequence: next.sequence,
              agentEventCreatedAtMillis: next.createdAtMillis,
              agentRetiredRunIds: next.retiredRunIds
            };
          })
        }));
      }),
    'chat://proposal': (event) =>
      this.#ifCurrent(event, () => {
        this.#patch({
          proposals: [
            ...this.proposals.filter(
              (item) =>
                item.id !== event.id &&
                !(
                  item.kind === event.kind &&
                  (item.noteId ?? item.suggestedPath) ===
                    (event.noteId ?? event.suggestedPath)
                )
            ),
            event
          ]
        });
        void this.#options.onProposalAvailable?.(event);
      }),
    'chat://projection-conflict': (event) =>
      this.#ifCurrent(event, () => {
        void this.openConversation(event.conversationId);
      })
  };

  async #ensureListeners() {
    if (this.#listenersReady) return;
    this.#listenersReady = true;
    try {
      for (const event of Object.keys(this.#eventHandlers) as Array<keyof ChatEventMap>) {
        const off = await this.#api.on(event, this.#eventHandlers[event] as never);
        if (this.#isDisposed()) off();
        else this.#unlisteners.push(off);
      }
    } catch (error) {
      this.#listenersReady = false;
      throw error;
    }
  }

  async refreshList() {
    if (this.#isDisposed()) return;
    try {
      const conversations = await this.#api.listConversations(false);
      this.#patch({ conversations, error: null });
    } catch (error) {
      this.#patch({ error: errorText(error, 'Unable to load conversations.') });
    }
  }

  async openConversation(conversationId: string) {
    const operationId = ++this.#selectionOperationSequence;
    if (!this.#dispatch({
      type: 'startLoading',
      conversationId,
      operationId
    })) return null;
    this.#patch({ error: null });
    try {
      const conversation = await this.#api.getConversation(conversationId);
      const [proposals, modelCapabilities] = await Promise.all([
        this.#api.listPendingProposals(conversationId),
        this.#getModelCapabilities(conversation.provider, conversation.model)
      ]);
      if (
        !this.#dispatch({
          type: 'opened',
          conversationId,
          operationId
        })
      ) {
        return null;
      }
      this.#dispatch({
        type: 'restore',
        conversationId,
        requestId: conversation.activeRequestId
      });
      this.#patch({
        conversation,
        proposals,
        modelCapabilities,
        error: null
      });
      for (const proposal of proposals) {
        void this.#options.onProposalAvailable?.(proposal);
      }
      return conversation;
    } catch (error) {
      if (
        this.#dispatch({
          type: 'failed',
          operationId
        })
      ) {
        this.#patch({
          error: errorText(
            error,
            'Unable to open this conversation.'
          )
        });
      }
      return null;
    }
  }

  async branchFromMessage(messageId: string) {
    if (this.#isDisposed() || this.isSending) return null;
    this.#patch({ error: null });
    try {
      const conversation = await this.#api.branchFromMessage(messageId);
      const modelCapabilities = await this.#getModelCapabilities(
        conversation.provider,
        conversation.model
      );
      this.#dispatch({ type: 'reset' });
      this.#patch({
        conversation,
        conversations: mergeSummary(this.conversations, conversation),
        proposals: [],
        modelCapabilities,
        error: null
      });
      return conversation;
    } catch (error) {
      this.#patch({ error: errorText(error, 'Unable to create checkpoint branch.') });
      return null;
    }
  }

  async createConversation(
    input: { title?: string; vaultAccess?: VaultAccess } = {}
  ) {
    if (this.#isDisposed()) return null;
    if (!this.settings) {
      this.#patch({
        error: 'Chat settings are still loading. Try again in a moment.'
      });
      return null;
    }
    const operationId = ++this.#selectionOperationSequence;
    this.#dispatch({
      type: 'startCreating',
      operationId
    });
    this.#patch({ error: null });
    try {
      const title = input.title?.trim() || this.conversationDraft.title.trim() || undefined;
      const conversation = await this.#api.createConversation({
        ...input,
        title,
        vaultAccess:
          input.vaultAccess ?? this.conversationDraft.vaultAccess,
        provider: this.conversationDraft.provider,
        model: this.conversationDraft.model,
        reasoningEffort: this.conversationDraft.reasoningEffort
      });
      const modelCapabilities = await this.#getModelCapabilities(
        conversation.provider,
        conversation.model
      );
      if (
        !this.#dispatch({
          type: 'created',
          operationId
        })
      ) {
        return null;
      }
      this.#dispatch({ type: 'reset' });
      this.#patch({
        conversation,
        conversations: mergeSummary(this.conversations, conversation),
        modelCapabilities,
        error: null
      });
      return conversation;
    } catch (error) {
      if (
        this.#dispatch({
          type: 'failed',
          operationId
        })
      ) {
        this.#patch({
          error: errorText(
            error,
            'Unable to start a conversation.'
          )
        });
      }
      return null;
    }
  }

  startNewConversation(input: { title?: string } = {}) {
    const revision = this.conversationDraft.revision + 1;
    const configuration = draftConfiguration(this.settings);
    const cachedCapabilities = configuration.provider === 'local'
      ? null
      : this.#modelCapabilities.get(
          this.#modelKey(configuration.provider, configuration.model)
        ) ?? null;
    this.#dispatch({ type: 'reset' });
    this.#patch({
      conversation: null,
      conversationDraft: {
        revision,
        title: input.title?.trim() ?? '',
        ...configuration
      },
      proposals: [],
      modelCapabilities: cachedCapabilities,
      error: null
    });
    void this.#loadDraftModelCapabilities(
      revision,
      configuration.provider,
      configuration.model
    );
  }

  setConversationDraftTitle(title: string) {
    if (this.conversation) return;
    const nextTitle = title.trim();
    if (this.conversationDraft.title === nextTitle) return;
    this.#patch({
      conversationDraft: {
        ...this.conversationDraft,
        title: nextTitle
      }
    });
  }

  /** Unsent composer text for a slot; empty when nothing was left behind. */
  getComposerDraft(slot: string) {
    return this.#api.getComposerDraft(slot);
  }

  setComposerDraft(slot: string, body: string) {
    return this.#api.setComposerDraft(slot, body);
  }

  async renameConversation(title: string) {
    if (this.#isDisposed()) return false;
    const conversationId = this.conversation?.id;
    const nextTitle = title.trim();
    if (!conversationId || !nextTitle) return false;
    if (this.conversation?.title === nextTitle) return true;

    try {
      const summary = await this.#api.renameConversation(conversationId, nextTitle);
      this.conversations = mergeSummary(this.conversations, summary);
      if (this.conversation?.id === conversationId) {
        this.conversation = { ...this.conversation, ...summary };
      }
      this.error = null;
      this.#notify();
      return true;
    } catch (error) {
      this.#patch({ error: errorText(error, 'Unable to rename this conversation.') });
      return false;
    }
  }

  async archiveConversation(
    conversationId = this.conversation?.id,
    retentionDays: ForgottenNoteRetentionPreference = 7
  ) {
    if (this.#isDisposed()) return null;
    if (!conversationId || this.isSending) return null;

    const operationId = ++this.#selectionOperationSequence;
    this.#dispatch({
      type: 'startArchiving',
      conversationId,
      operationId
    });
    this.#patch({ error: null });
    try {
      const forgottenItem = await this.#api.archiveConversation(
        conversationId,
        true,
        retentionDays
      );
      const conversations = this.conversations.filter(
        (conversation) => conversation.id !== conversationId
      );
      const archivedCurrentConversation = this.conversation?.id === conversationId;
      const conversationDraft = archivedCurrentConversation
        ? {
            revision: this.conversationDraft.revision + 1,
            title: '',
            ...draftConfiguration(this.settings)
          }
        : this.conversationDraft;

      if (
        !this.#dispatch({
          type: 'archived',
          operationId
        })
      ) {
        return forgottenItem;
      }

      this.#patch({
        conversations,
        conversationDraft,
        ...(archivedCurrentConversation
          ? {
              conversation: null,
              proposals: [],
              modelCapabilities: null
            }
          : {})
      });
      if (archivedCurrentConversation) {
        this.#dispatch({ type: 'reset' });
      }

      if (archivedCurrentConversation && conversations[0]) {
        await this.openConversation(conversations[0].id);
      } else if (archivedCurrentConversation) {
        await this.#loadDraftModelCapabilities(
          conversationDraft.revision,
          conversationDraft.provider,
          conversationDraft.model
        );
      }
      return forgottenItem;
    } catch (error) {
      if (
        this.#dispatch({
          type: 'failed',
          operationId
        })
      ) {
        this.#patch({
          error: errorText(
            error,
            'Unable to forget this conversation.'
          )
        });
      }
      return null;
    }
  }

  async initialize(conversationId?: string | null) {
    const sequence = ++this.#initializeSequence;
    if (!this.#dispatch({ type: 'initialize', sequence })) return;
    this.#patch({ error: null });
    try {
      await this.#ensureListeners();
      const [settings, conversations, grants, policies] = await Promise.all([
        this.#api.getSettings(),
        this.#api.listConversations(false),
        this.#api.listGrants(),
        this.#api.listNotePolicies()
      ]);
      if (!this.#isInitializationCurrent(sequence)) return;
      this.#patch({ settings, conversations, grants, policies });
      const targetId = conversationId ?? conversations[0]?.id ?? null;
      if (targetId) {
        await this.openConversation(targetId);
      } else {
        const configuration = draftConfiguration(settings);
        const revision = this.conversationDraft.revision;
        this.#patch({
          conversationDraft: {
            ...this.conversationDraft,
            ...configuration
          }
        });
        await this.#loadDraftModelCapabilities(
          revision,
          configuration.provider,
          configuration.model
        );
      }
      if (this.#dispatch({ type: 'initialized', sequence })) {
        this.#notify();
      }
    } catch (error) {
      const message = errorText(
        error,
        'Chat is unavailable right now.'
      );
      const accepted = this.#dispatch({
        type: 'initializationFailed',
        sequence
      });
      if (accepted) {
        this.#patch({ error: message });
      }
    }
  }

  async send(
    content: string,
    attachments: ChatAttachmentInput[] = [],
    forceWebSearch = false,
    activeNote?: ChatActiveNoteSnapshot | null,
    selectedContext: ChatContextSelectionInput[] = []
  ) {
    const trimmed = content.trim();
    if ((!trimmed && attachments.length === 0) || this.isSending || !this.conversation) {
      return false;
    }
    const conversationId = this.conversation.id;
    const operationId = ++this.#requestOperationSequence;
    if (!this.#dispatch({
      type: 'submit',
      conversationId,
      operationId,
      activity: 'Starting'
    })) return false;
    this.#patch({ error: null });
    try {
      const receipt = await this.#api.sendMessage({
        conversationId,
        content: trimmed,
        attachments,
        forceWebSearch,
        activeNote,
        selectedContext
      });
      this.#dispatch({
        type: 'accepted',
        conversationId,
        requestId: receipt.requestId,
        messageId: receipt.assistantMessage?.id ?? null,
        operationId
      });
      if (this.conversation?.id === conversationId) {
        this.#updateConversation((conversation) => ({
          ...conversation,
          activeRequestId: receipt.requestId,
          messages: receipt.assistantMessage
            ? upsertMessage(
                upsertMessage(
                  conversation.messages,
                  receipt.userMessage
                ),
                receipt.assistantMessage
              )
            : upsertMessage(
                conversation.messages,
                receipt.userMessage
              )
        }));
      }
      return true;
    } catch (error) {
      if (
        this.#dispatch({
          type: 'submissionFailed',
          conversationId,
          operationId
        })
      ) {
        this.#patch({
          error: errorText(
            error,
            'Unable to send this message.'
          )
        });
      }
      return false;
    }
  }

  suggestContext(input: {
    query: string;
    vaultAccess: VaultAccess;
    excludeNoteId?: string | null;
    limit?: number;
  }) {
    if (this.#isDisposed()) {
      return Promise.reject(new Error('Chat controller is disposed.'));
    }
    return this.#api.suggestContext({
      ...input,
      conversationId: this.conversation?.id ?? null
    });
  }

  async cancel() {
    const request = this.machine.request;
    if (request.kind !== 'streaming') return;
    if (!this.#dispatch({
      type: 'cancel',
      conversationId: request.conversationId,
      requestId: request.requestId
    })) return;
    this.#notify();
    try {
      await this.#api.cancelRequest(request.requestId);
    } catch (error) {
      this.#dispatch({
        type: 'cancelFailed',
        conversationId: request.conversationId,
        requestId: request.requestId
      });
      this.#patch({ error: errorText(error, 'Unable to stop the response.') });
    }
  }

  async decidePermission(
    identity: AgentPermissionIdentity,
    decision: AgentPermissionDecision
  ) {
    if (this.#isDisposed()) return false;
    const request = this.machine.request;
    const conversation = this.conversation;
    const message = conversation?.messages.find(
      (candidate) => candidate.id === identity.messageId
    );
    const permission = message?.parts.find(
      (part) =>
        part.type === 'permission' &&
        part.request.permissionId === identity.permissionId
    );
    if (
      request.kind !== 'streaming' ||
      request.requestId !== identity.requestId ||
      request.conversationId !== identity.conversationId ||
      conversation?.id !== identity.conversationId ||
      conversation.activeRequestId !== identity.requestId ||
      message?.requestId !== identity.requestId ||
      message.agentRunId !== identity.runId ||
      !permission ||
      permission.type !== 'permission' ||
      permission.status !== 'pending' ||
      permission.request.toolCallId !== identity.toolCallId
    ) {
      this.#patch({ error: 'That permission request is no longer active.' });
      return false;
    }
    try {
      await this.#api.decidePermission(identity, decision);
      return true;
    } catch (error) {
      this.#patch({
        error: errorText(error, 'Unable to decide this permission request.')
      });
      return false;
    }
  }

  async retry(messageId: string) {
    if (this.#isDisposed()) return;
    const conversationId = this.conversation?.id;
    if (this.isSending || !conversationId) return;
    const operationId = ++this.#requestOperationSequence;
    if (!this.#dispatch({
      type: 'submit',
      conversationId,
      operationId
    })) return;
    this.#patch({ error: null });
    try {
      const receipt = await this.#api.retryMessage(messageId);
      this.#dispatch({
        type: 'accepted',
        conversationId,
        requestId: receipt.requestId,
        messageId: receipt.assistantMessage?.id ?? null,
        operationId
      });
      if (this.conversation?.id === conversationId) {
        this.#updateConversation((conversation) => ({
          ...conversation,
          activeRequestId: receipt.requestId,
          messages: receipt.assistantMessage
            ? upsertMessage(
                conversation.messages,
                receipt.assistantMessage
              )
            : conversation.messages
        }));
      }
    } catch (error) {
      if (
        this.#dispatch({
          type: 'submissionFailed',
          conversationId,
          operationId
        })
      ) {
        this.#patch({
          error: errorText(
            error,
            'Unable to retry this response.'
          )
        });
      }
    }
  }

  async setVaultAccess(vaultAccess: VaultAccess) {
    if (this.#isDisposed()) return;
    const conversation = this.conversation;
    if (!conversation) {
      if (this.conversationDraft.vaultAccess !== vaultAccess) {
        this.#patch({
          conversationDraft: {
            ...this.conversationDraft,
            vaultAccess
          }
        });
      }
      return;
    }
    if (conversation.vaultAccess === vaultAccess) {
      return;
    }
    try {
      const summary = await this.#api.setConversationVaultAccess(conversation.id, vaultAccess);
      if (this.conversation?.id === conversation.id) {
        this.#updateConversation((current) => ({ ...current, ...summary }));
      }
    } catch (error) {
      if (this.conversation?.id === conversation.id) {
        this.#patch({ error: errorText(error, 'Unable to change vault access.') });
      }
    }
  }

  async setProvider(provider: ChatProvider, model: string) {
    if (this.#isDisposed()) return;
    if (this.isSending) {
      this.#patch({ error: 'Wait for the current response to finish before changing models.' });
      return;
    }
    const operationId = ++this.#modelConfigurationSequence;
    const conversation = this.conversation;
    const currentEffort = conversation?.reasoningEffort ?? this.conversationDraft.reasoningEffort;
    let modelCapabilities = provider === 'local'
      ? null
      : this.#modelCapabilities.get(this.#modelKey(provider, model)) ?? null;
    if (provider === 'local') {
      try {
        modelCapabilities = await this.#getModelCapabilities(provider, model);
      } catch {
        // Preserve model switching; capability loading below reports failures.
      }
    }
    if (
      operationId !== this.#modelConfigurationSequence ||
      (conversation ? this.conversation?.id !== conversation.id : this.conversation !== null)
    ) return;
    const reasoningEffort = this.#reasoningEffortForModel(
      provider,
      model,
      currentEffort,
      modelCapabilities
    );
    if (!conversation) {
      if (
        this.conversationDraft.provider === provider &&
        this.conversationDraft.model === model &&
        this.conversationDraft.reasoningEffort === reasoningEffort
      ) {
        return;
      }
      this.#patch({
        conversationDraft: {
          ...this.conversationDraft,
          provider,
          model,
          reasoningEffort
        },
        modelCapabilities
      });
      if (!modelCapabilities) {
        await this.#loadDraftModelCapabilities(
          this.conversationDraft.revision,
          provider,
          model
        );
      }
      return;
    }
    if (
      conversation.provider === provider &&
      conversation.model === model &&
      conversation.reasoningEffort === reasoningEffort
    ) return;
    try {
      const summary = await this.#api.setConversationProvider(
        conversation.id,
        provider,
        model,
        reasoningEffort
      );
      if (
        operationId !== this.#modelConfigurationSequence ||
        this.conversation?.id !== conversation.id
      ) return;
      this.#updateConversation((current) => ({ ...current, ...summary }));
      try {
        modelCapabilities ??= await this.#getModelCapabilities(provider, model);
        if (
          operationId === this.#modelConfigurationSequence &&
          this.conversation?.id === conversation.id &&
          this.conversation.provider === provider &&
          this.conversation.model === model
        ) {
          this.#patch({ modelCapabilities });
        }
      } catch (error) {
        if (
          operationId === this.#modelConfigurationSequence &&
          this.conversation?.id === conversation.id
        ) {
          this.#patch({
            modelCapabilities: null,
            error: errorText(
              error,
              'The model changed, but its attachment capabilities could not be loaded.'
            )
          });
        }
      }
    } catch (error) {
      if (
        operationId === this.#modelConfigurationSequence &&
        this.conversation?.id === conversation.id
      ) {
        this.#patch({ error: errorText(error, 'Unable to change the chat model.') });
      }
    }
  }

  async setReasoningEffort(reasoningEffort: ChatReasoningEffort) {
    if (this.#isDisposed()) return;
    if (this.isSending) {
      this.#patch({ error: 'Wait for the current response to finish before changing reasoning.' });
      return;
    }
    const operationId = ++this.#modelConfigurationSequence;
    const conversation = this.conversation;
    const provider = conversation?.provider ?? this.conversationDraft.provider;
    const model = conversation?.model ?? this.conversationDraft.model;
    const normalized = normalizeChatReasoningEffort(provider, model, reasoningEffort);
    if (!conversation) {
      if (this.conversationDraft.reasoningEffort === normalized) return;
      this.#patch({
        conversationDraft: {
          ...this.conversationDraft,
          reasoningEffort: normalized
        }
      });
      return;
    }
    if (conversation.reasoningEffort === normalized) return;
    try {
      const summary = await this.#api.setConversationProvider(
        conversation.id,
        provider,
        model,
        normalized
      );
      if (
        operationId === this.#modelConfigurationSequence &&
        this.conversation?.id === conversation.id
      ) {
        this.#updateConversation((current) => ({ ...current, ...summary }));
      }
    } catch (error) {
      if (
        operationId === this.#modelConfigurationSequence &&
        this.conversation?.id === conversation.id
      ) {
        this.#patch({ error: errorText(error, 'Unable to change reasoning effort.') });
      }
    }
  }

  async listOpenAiModels(): Promise<LocalModel[]> {
    if (this.#isDisposed()) return [];
    return this.#api.listOpenAiModels();
  }

  async listLocalModels(): Promise<LocalModel[]> {
    if (this.#isDisposed()) return [];
    const baseUrl = this.settings?.localBaseUrl.trim();
    if (!baseUrl) {
      throw new Error('Configure a local model endpoint in Settings first.');
    }
    return this.#api.listLocalModels(baseUrl);
  }

  async keepProposal(proposalId: string, markdown?: string) {
    if (this.#isDisposed()) {
      throw new Error('Chat controller is disposed.');
    }
    try {
      const result = await this.#api.commitAgentProposal(proposalId, markdown);
      if (result.status === 'conflict') {
        this.#patch({
          error: result.message ?? 'The note changed before this proposal was kept.',
          proposals: this.proposals.map((item) =>
            item.id === proposalId ? { ...item, status: 'conflict' } : item
          )
        });
        return result;
      }
      this.#patch({
        proposals: this.proposals.filter((item) => item.id !== proposalId),
        error: result.commitWarning?.message ?? null
      });
      if (result.commitWarning) {
        console.warn('Proposal was committed with incomplete projections:', result.commitWarning);
      }
      this.#options.onProposalResolved?.(proposalId);
      return result;
    } catch (error) {
      this.#patch({ error: errorText(error, 'Unable to keep this proposal.') });
      throw error;
    }
  }

  async dismissProposal(proposalId: string) {
    if (this.#isDisposed()) {
      throw new Error('Chat controller is disposed.');
    }
    try {
      await this.#api.dismissAgentProposal(proposalId);
      this.#patch({
        proposals: this.proposals.filter((item) => item.id !== proposalId),
        error: null
      });
      this.#options.onProposalResolved?.(proposalId);
    } catch (error) {
      this.#patch({ error: errorText(error, 'Unable to dismiss this proposal.') });
      throw error;
    }
  }

  removeResolvedProposal(proposalId: string) {
    if (!this.proposals.some((proposal) => proposal.id === proposalId)) return;
    this.#patch({
      proposals: this.proposals.filter((proposal) => proposal.id !== proposalId),
      error: null
    });
  }

  async grantNote(noteId: string) {
    if (this.#isDisposed()) return;
    try {
      const grant = await this.#api.grantNote(noteId);
      this.#patch({
        grants: [...this.grants.filter((item) => item.noteId !== noteId), grant],
        policies: [
          ...this.policies.filter((item) => item.noteId !== noteId),
          {
            noteId,
            notePath: grant.notePath,
            title: grant.noteTitle,
            disposition: 'approved',
            updatedAtMillis: grant.grantedAtMillis
          }
        ],
        error: null
      });
    } catch (error) {
      const message = errorText(error, 'Unable to allow access to this note.');
      this.#patch({ error: message });
      throw new Error(message);
    }
  }

  async revokeNote(noteId: string) {
    if (this.#isDisposed()) return;
    try {
      await this.#api.revokeNote(noteId);
      this.#patch({
        grants: this.grants.filter((item) => item.noteId !== noteId),
        policies: this.policies.filter(
          (item) => item.noteId !== noteId || item.disposition !== 'approved'
        ),
        error: null
      });
    } catch (error) {
      const message = errorText(error, 'Unable to remove access to this note.');
      this.#patch({ error: message });
      throw new Error(message);
    }
  }

  async setNoteExcluded(noteId: string, title: string, excluded: boolean) {
    if (this.#isDisposed()) return;
    try {
      await this.#api.setNoteExcluded(noteId, title, excluded);
      this.#patch({
        grants: excluded
          ? this.grants.filter((item) => item.noteId !== noteId)
          : this.grants,
        policies: excluded
          ? [
              ...this.policies.filter((item) => item.noteId !== noteId),
              {
                noteId,
                notePath: null,
                title,
                disposition: 'excluded',
                updatedAtMillis: Date.now()
              }
            ]
          : this.policies.filter(
              (item) => item.noteId !== noteId || item.disposition !== 'excluded'
            ),
        error: null
      });
    } catch (error) {
      this.#patch({ error: errorText(error, 'Unable to change the note exclusion.') });
      throw error;
    }
  }

  dispose() {
    const request = this.machine.request;
    const hasPendingPermission = this.conversation?.messages.some((message) =>
      message.parts.some((part) => part.type === 'permission' && part.status === 'pending')
    ) ?? false;
    if (
      hasPendingPermission &&
      (request.kind === 'streaming' || request.kind === 'cancelling')
    ) {
      void this.#api.cancelRequest(request.requestId).catch(() => undefined);
    }
    this.#dispatch({ type: 'dispose' });
    this.#unlisteners.splice(0).forEach((off) => off());
    this.#subscribers.clear();
  }

  createExcerpt(messageId: string, text: string) {
    if (this.#isDisposed()) {
      return Promise.reject(new Error('Chat controller is disposed.'));
    }
    return this.#api.createExcerpt(messageId, text);
  }

  rememberExcerpt(excerptId: string) {
    if (this.#isDisposed()) {
      return Promise.reject(new Error('Chat controller is disposed.'));
    }
    return this.#api.rememberExcerpt(excerptId);
  }

  async remember(messageId: string, text: string) {
    if (this.#isDisposed()) {
      throw new Error('Chat controller is disposed.');
    }
    const excerpt = await this.#api.createExcerpt(messageId, text);
    return this.#api.rememberExcerpt(excerpt.id);
  }

  unremember(excerptId: string) {
    if (this.#isDisposed()) {
      return Promise.reject(new Error('Chat controller is disposed.'));
    }
    return this.#api.unrememberExcerpt(excerptId);
  }

  clearError() {
    this.#patch({ error: null });
  }
}

export function createChatController(
  api: ChatApi = chatApi,
  options: ChatControllerOptions = {}
): ChatController {
  return new ChatControllerStore(api, options);
}
