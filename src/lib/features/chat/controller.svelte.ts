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
  ChatModelCapabilities,
  ChatProvider,
  VaultAccess,
  ChatSettings
} from './types';
import type { CommitNoteReviewResult } from '$lib/types/proposals';
import type { ForgottenNoteRetentionPreference } from '$lib/appSettings.svelte';
import type { ForgottenNoteSummary } from '$lib/types/forgottenNotes';
import { configuredChatModel } from './chatConfiguration';

export interface ChatControllerState {
  settings: ChatSettings | null;
  conversations: ChatConversationSummary[];
  conversationDraft: {
    revision: number;
    title: string;
    provider: ChatProvider;
    model: string;
    vaultAccess: VaultAccess;
  };
  grants: ChatNoteGrant[];
  policies: ChatNotePolicy[];
  conversation: ChatConversation | null;
  isInitializing: boolean;
  isLoadingConversation: boolean;
  isSending: boolean;
  error: string | null;
  activity: string | null;
  proposals: ChatAgentProposal[];
  modelCapabilities: ChatModelCapabilities | null;
}

const initialState: ChatControllerState = {
  settings: null,
  conversations: [],
  conversationDraft: {
    revision: 0,
    title: '',
    provider: 'openai',
    model: '',
    vaultAccess: 'approved'
  },
  grants: [],
  policies: [],
  conversation: null,
  isInitializing: false,
  isLoadingConversation: false,
  isSending: false,
  error: null,
  activity: null,
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
  renameConversation(title: string): Promise<boolean>;
  archiveConversation(
    conversationId?: string,
    retentionDays?: ForgottenNoteRetentionPreference
  ): Promise<ForgottenNoteSummary | null>;
  openConversation(conversationId: string): Promise<ChatConversation | null>;
  send(
    content: string,
    attachments?: ChatAttachmentInput[],
    forceWebSearch?: boolean,
    activeNote?: ChatActiveNoteSnapshot | null
  ): Promise<boolean>;
  cancel(): Promise<void>;
  retry(messageId: string): Promise<void>;
  setVaultAccess(vaultAccess: VaultAccess): Promise<void>;
  setProvider(provider: ChatProvider, model: string): Promise<void>;
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
  if (!previous) return upsertMessage(messages, message);
  return upsertMessage(messages, {
    ...message,
    citations: message.citations.length > 0 ? message.citations : previous.citations,
    linkTarget: message.linkTarget ?? previous.linkTarget
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
    model: summary.model
  };
  return [compact, ...list.filter((item) => item.id !== compact.id)].sort(
    (a, b) => b.updatedAtMillis - a.updatedAtMillis
  );
}

function draftConfiguration(
  settings: ChatSettings | null
): Pick<
  ChatControllerState['conversationDraft'],
  'provider' | 'model' | 'vaultAccess'
> {
  const provider = settings?.provider ?? 'openai';
  return {
    provider,
    model: configuredChatModel(settings, provider),
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
  isInitializing = $state(initialState.isInitializing);
  isLoadingConversation = $state(initialState.isLoadingConversation);
  isSending = $state(initialState.isSending);
  error = $state<string | null>(initialState.error);
  activity = $state<string | null>(initialState.activity);
  proposals = $state<ChatAgentProposal[]>(initialState.proposals);
  modelCapabilities = $state<ChatModelCapabilities | null>(initialState.modelCapabilities);

  #api: ChatApi;
  #options: ChatControllerOptions;
  #subscribers = new Set<Subscriber<ChatControllerState>>();
  #unlisteners: Array<() => void> = [];
  #initializeSequence = 0;
  #disposed = false;
  #listenersReady = false;
  #modelCapabilities = new Map<string, ChatModelCapabilities>();

  constructor(api: ChatApi = chatApi, options: ChatControllerOptions = {}) {
    this.#api = api;
    this.#options = options;
  }

  getSnapshot(): ChatControllerState {
    return {
      settings: this.settings,
      conversations: this.conversations,
      conversationDraft: this.conversationDraft,
      grants: this.grants,
      policies: this.policies,
      conversation: this.conversation,
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
    if (this.#disposed || this.#subscribers.size === 0) return;
    const snapshot = this.getSnapshot();
    for (const run of this.#subscribers) {
      run(snapshot);
    }
  }

  #patch(partial: Partial<ChatControllerState>) {
    if (this.#disposed) return;
    if (partial.settings !== undefined) this.settings = partial.settings;
    if (partial.conversations !== undefined) this.conversations = partial.conversations;
    if (partial.conversationDraft !== undefined) {
      this.conversationDraft = partial.conversationDraft;
    }
    if (partial.grants !== undefined) this.grants = partial.grants;
    if (partial.policies !== undefined) this.policies = partial.policies;
    if (partial.conversation !== undefined) this.conversation = partial.conversation;
    if (partial.isInitializing !== undefined) this.isInitializing = partial.isInitializing;
    if (partial.isLoadingConversation !== undefined) {
      this.isLoadingConversation = partial.isLoadingConversation;
    }
    if (partial.isSending !== undefined) this.isSending = partial.isSending;
    if (partial.error !== undefined) this.error = partial.error;
    if (partial.activity !== undefined) this.activity = partial.activity;
    if (partial.proposals !== undefined) this.proposals = partial.proposals;
    if (partial.modelCapabilities !== undefined) {
      this.modelCapabilities = partial.modelCapabilities;
    }
    this.#notify();
  }

  #updateConversation(updater: (conversation: ChatConversation) => ChatConversation) {
    if (this.#disposed || !this.conversation) return;
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
    if (cached) return cached;
    const capabilities =
      await this.#api.getModelCapabilities(provider, model);
    this.#modelCapabilities.set(key, capabilities);
    return capabilities;
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
        this.#patch({ modelCapabilities });
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
        this.#updateConversation((conversation) => ({
          ...conversation,
          ...(event.conversation ?? {}),
          activeRequestId: event.requestId,
          messages: upsertTerminalMessage(conversation.messages, event.message)
        }));
        this.#patch({ isSending: true, error: null });
      }),
    'chat://text-delta': (event) =>
      this.#ifCurrent(event, () => {
        this.#updateConversation((conversation) => {
          const messages = conversation.messages.map((message) =>
            message.id === event.messageId
              ? {
                  ...message,
                  content: message.content + event.delta,
                  status: 'streaming' as const,
                  updatedAtMillis: Date.now()
                }
              : message
          );
          return { ...conversation, activeRequestId: event.requestId, messages };
        });
      }),
    'chat://source': (event) =>
      this.#ifCurrent(event, () => {
        this.#updateConversation((conversation) => ({
          ...conversation,
          messages: conversation.messages.map((message) =>
            message.id === event.messageId
              ? {
                  ...message,
                  citations: [
                    ...message.citations.filter((citation) => citation.id !== event.citation.id),
                    event.citation
                  ]
                }
              : message
          )
        }));
      }),
    'chat://completed': (event) =>
      this.#ifCurrent(event, () => {
        this.#updateConversation((conversation) => ({
          ...conversation,
          ...(event.conversation ?? {}),
          activeRequestId: null,
          messages: upsertTerminalMessage(conversation.messages, event.message)
        }));
        this.#patch({ isSending: false, activity: null });
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
      if (this.#disposed) return;
      this.conversations = mergeSummary(this.conversations, event.conversation);
      if (this.conversation?.id === event.conversationId) {
        this.conversation = { ...this.conversation, ...event.conversation };
      }
      this.#notify();
    },
    'chat://cancelled': (event) =>
      this.#ifCurrent(event, () => {
        this.#updateConversation((conversation) => ({
          ...conversation,
          activeRequestId: null,
          messages: upsertTerminalMessage(conversation.messages, event.message)
        }));
        this.#patch({ isSending: false, activity: null });
      }),
    'chat://failed': (event) =>
      this.#ifCurrent(event, () => {
        this.#updateConversation((conversation) => ({
          ...conversation,
          activeRequestId: null,
          messages: upsertTerminalMessage(conversation.messages, event.message)
        }));
        this.#patch({ isSending: false, error: event.error, activity: null });
      }),
    'chat://activity': (event) =>
      this.#ifCurrent(event, () => {
        this.#patch({ activity: event.status });
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
        if (this.#disposed) off();
        else this.#unlisteners.push(off);
      }
    } catch (error) {
      this.#listenersReady = false;
      throw error;
    }
  }

  async refreshList() {
    try {
      const conversations = await this.#api.listConversations(false);
      this.#patch({ conversations, error: null });
    } catch (error) {
      this.#patch({ error: errorText(error, 'Unable to load conversations.') });
    }
  }

  async openConversation(conversationId: string) {
    this.#patch({ isLoadingConversation: true, error: null });
    try {
      const conversation = await this.#api.getConversation(conversationId);
      const [proposals, modelCapabilities] = await Promise.all([
        this.#api.listPendingProposals(conversationId),
        this.#getModelCapabilities(conversation.provider, conversation.model)
      ]);
      this.#patch({
        conversation,
        proposals,
        modelCapabilities,
        isSending: Boolean(conversation.activeRequestId),
        activity: null
      });
      for (const proposal of proposals) {
        void this.#options.onProposalAvailable?.(proposal);
      }
      return conversation;
    } catch (error) {
      this.#patch({ error: errorText(error, 'Unable to open this conversation.') });
      return null;
    } finally {
      this.#patch({ isLoadingConversation: false });
    }
  }

  async createConversation(
    input: { title?: string; vaultAccess?: VaultAccess } = {}
  ) {
    if (!this.settings) {
      this.#patch({
        error: 'Chat settings are still loading. Try again in a moment.'
      });
      return null;
    }
    this.#patch({ isLoadingConversation: true, error: null });
    try {
      const title = input.title?.trim() || this.conversationDraft.title.trim() || undefined;
      const conversation = await this.#api.createConversation({
        ...input,
        title,
        vaultAccess:
          input.vaultAccess ?? this.conversationDraft.vaultAccess,
        provider: this.conversationDraft.provider,
        model: this.conversationDraft.model
      });
      const modelCapabilities = await this.#getModelCapabilities(
        conversation.provider,
        conversation.model
      );
      this.#patch({
        conversation,
        conversations: mergeSummary(this.conversations, conversation),
        modelCapabilities,
        isSending: false
      });
      return conversation;
    } catch (error) {
      this.#patch({ error: errorText(error, 'Unable to start a conversation.') });
      return null;
    } finally {
      this.#patch({ isLoadingConversation: false });
    }
  }

  startNewConversation(input: { title?: string } = {}) {
    const revision = this.conversationDraft.revision + 1;
    const configuration = draftConfiguration(this.settings);
    const cachedCapabilities = this.#modelCapabilities.get(
      this.#modelKey(configuration.provider, configuration.model)
    ) ?? null;
    this.#patch({
      conversation: null,
      conversationDraft: {
        revision,
        title: input.title?.trim() ?? '',
        ...configuration
      },
      proposals: [],
      modelCapabilities: cachedCapabilities,
      isSending: false,
      activity: null,
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

  async renameConversation(title: string) {
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
    if (!conversationId || this.isSending) return null;

    this.#patch({ isLoadingConversation: true, error: null });
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

      this.#patch({
        conversations,
        conversationDraft,
        ...(archivedCurrentConversation
          ? {
              conversation: null,
              proposals: [],
              modelCapabilities: null,
              isSending: false,
              activity: null
            }
          : {})
      });

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
      this.#patch({ error: errorText(error, 'Unable to forget this conversation.') });
      return null;
    } finally {
      this.#patch({ isLoadingConversation: false });
    }
  }

  async initialize(conversationId?: string | null) {
    const sequence = ++this.#initializeSequence;
    this.#patch({ isInitializing: true, error: null });
    try {
      await this.#ensureListeners();
      const [settings, conversations, grants, policies] = await Promise.all([
        this.#api.getSettings(),
        this.#api.listConversations(false),
        this.#api.listGrants(),
        this.#api.listNotePolicies()
      ]);
      if (this.#disposed || sequence !== this.#initializeSequence) return;
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
    } catch (error) {
      this.#patch({ error: errorText(error, 'Chat is unavailable right now.') });
    } finally {
      if (sequence === this.#initializeSequence) this.#patch({ isInitializing: false });
    }
  }

  async send(
    content: string,
    attachments: ChatAttachmentInput[] = [],
    forceWebSearch = false,
    activeNote?: ChatActiveNoteSnapshot | null
  ) {
    const trimmed = content.trim();
    if ((!trimmed && attachments.length === 0) || this.isSending || !this.conversation) {
      return false;
    }
    this.#patch({ isSending: true, error: null, activity: 'Starting' });
    try {
      const receipt = await this.#api.sendMessage({
        conversationId: this.conversation.id,
        content: trimmed,
        attachments,
        forceWebSearch,
        activeNote
      });
      this.#updateConversation((conversation) => ({
        ...conversation,
        activeRequestId: receipt.requestId,
        messages: receipt.assistantMessage
          ? upsertMessage(
              upsertMessage(conversation.messages, receipt.userMessage),
              receipt.assistantMessage
            )
          : upsertMessage(conversation.messages, receipt.userMessage)
      }));
      return true;
    } catch (error) {
      this.#patch({ isSending: false, error: errorText(error, 'Unable to send this message.') });
      return false;
    }
  }

  async cancel() {
    const requestId = this.conversation?.activeRequestId;
    if (!requestId) return;
    try {
      await this.#api.cancelRequest(requestId);
    } catch (error) {
      this.#patch({ error: errorText(error, 'Unable to stop the response.') });
    }
  }

  async retry(messageId: string) {
    if (this.isSending) return;
    this.#patch({ isSending: true, error: null });
    try {
      const receipt = await this.#api.retryMessage(messageId);
      this.#updateConversation((conversation) => ({
        ...conversation,
        activeRequestId: receipt.requestId,
        messages: receipt.assistantMessage
          ? upsertMessage(conversation.messages, receipt.assistantMessage)
          : conversation.messages
      }));
    } catch (error) {
      this.#patch({ isSending: false, error: errorText(error, 'Unable to retry this response.') });
    }
  }

  async setVaultAccess(vaultAccess: VaultAccess) {
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
      this.#updateConversation((current) => ({ ...current, ...summary }));
    } catch (error) {
      this.#patch({ error: errorText(error, 'Unable to change vault access.') });
    }
  }

  async setProvider(provider: ChatProvider, model: string) {
    const conversation = this.conversation;
    if (!conversation) {
      if (
        this.conversationDraft.provider === provider &&
        this.conversationDraft.model === model
      ) {
        return;
      }
      this.#patch({
        conversationDraft: {
          ...this.conversationDraft,
          provider,
          model
        },
        modelCapabilities:
          this.#modelCapabilities.get(
            this.#modelKey(provider, model)
          ) ?? null
      });
      await this.#loadDraftModelCapabilities(
        this.conversationDraft.revision,
        provider,
        model
      );
      return;
    }
    if (
      conversation.provider === provider &&
      conversation.model === model
    ) return;
    try {
      const summary = await this.#api.setConversationProvider(conversation.id, provider, model);
      const modelCapabilities =
        await this.#getModelCapabilities(provider, model);
      this.#updateConversation((current) => ({ ...current, ...summary }));
      this.#patch({ modelCapabilities });
    } catch (error) {
      this.#patch({ error: errorText(error, 'Unable to change the chat model.') });
    }
  }

  async keepProposal(proposalId: string, markdown?: string) {
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
        error: null
      });
      this.#options.onProposalResolved?.(proposalId);
      return result;
    } catch (error) {
      this.#patch({ error: errorText(error, 'Unable to keep this proposal.') });
      throw error;
    }
  }

  async dismissProposal(proposalId: string) {
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
    this.#disposed = true;
    this.#initializeSequence += 1;
    this.#unlisteners.splice(0).forEach((off) => off());
    this.#subscribers.clear();
  }

  createExcerpt(messageId: string, text: string) {
    return this.#api.createExcerpt(messageId, text);
  }

  rememberExcerpt(excerptId: string) {
    return this.#api.rememberExcerpt(excerptId);
  }

  async remember(messageId: string, text: string) {
    const excerpt = await this.#api.createExcerpt(messageId, text);
    return this.#api.rememberExcerpt(excerpt.id);
  }

  unremember(excerptId: string) {
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
