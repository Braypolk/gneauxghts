import type { Readable, Subscriber, Unsubscriber } from 'svelte/store';
import { chatApi, type ChatApi } from './api';
import type {
  ChatConversation,
  ChatConversationSummary,
  ChatEventMap,
  ChatExcerpt,
  ChatMessage,
  ChatMode,
  ChatNoteGrant,
  VaultAccess,
  ChatSettings
} from './types';

export interface ChatControllerState {
  settings: ChatSettings | null;
  conversations: ChatConversationSummary[];
  grants: ChatNoteGrant[];
  conversation: ChatConversation | null;
  isInitializing: boolean;
  isLoadingConversation: boolean;
  isSending: boolean;
  error: string | null;
}

const initialState: ChatControllerState = {
  settings: null,
  conversations: [],
  grants: [],
  conversation: null,
  isInitializing: false,
  isLoadingConversation: false,
  isSending: false,
  error: null
};

export interface ChatController extends Readable<ChatControllerState> {
  getSnapshot(): ChatControllerState;
  initialize(conversationId?: string | null): Promise<void>;
  dispose(): void;
  refreshList(): Promise<void>;
  createConversation(input?: {
    title?: string;
    mode?: ChatMode;
    vaultAccess?: VaultAccess;
  }): Promise<ChatConversation | null>;
  openConversation(conversationId: string): Promise<ChatConversation | null>;
  send(content: string, useWebSearch?: boolean): Promise<boolean>;
  cancel(): Promise<void>;
  retry(messageId: string): Promise<void>;
  setPreferences(mode: ChatMode, vaultAccess: VaultAccess): Promise<void>;
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
    mode: summary.mode,
    vaultAccess: summary.vaultAccess,
    createdAtMillis: summary.createdAtMillis,
    updatedAtMillis: summary.updatedAtMillis,
    messageCount: summary.messageCount,
    lastMessagePreview: summary.lastMessagePreview
  };
  return [compact, ...list.filter((item) => item.id !== compact.id)].sort(
    (a, b) => b.updatedAtMillis - a.updatedAtMillis
  );
}

export interface ChatControllerOptions {
  /**
   * Fired after a successful assistant completion for the open conversation.
   * Used by make-mode to lift structured note proposals into the review session.
   */
  onAssistantCompleted?: (info: {
    conversation: ChatConversation;
    message: ChatMessage;
  }) => void | Promise<void>;
}

/**
 * Rune-backed chat controller. Public surface keeps `subscribe` / `getSnapshot`
 * so ChatPanel and Notepad stay compatible while state lives in `$state`.
 */
export class ChatControllerStore implements ChatController {
  settings = $state<ChatSettings | null>(initialState.settings);
  conversations = $state<ChatConversationSummary[]>(initialState.conversations);
  grants = $state<ChatNoteGrant[]>(initialState.grants);
  conversation = $state<ChatConversation | null>(initialState.conversation);
  isInitializing = $state(initialState.isInitializing);
  isLoadingConversation = $state(initialState.isLoadingConversation);
  isSending = $state(initialState.isSending);
  error = $state<string | null>(initialState.error);

  #api: ChatApi;
  #options: ChatControllerOptions;
  #subscribers = new Set<Subscriber<ChatControllerState>>();
  #unlisteners: Array<() => void> = [];
  #initializeSequence = 0;
  #disposed = false;
  #listenersReady = false;

  constructor(api: ChatApi = chatApi, options: ChatControllerOptions = {}) {
    this.#api = api;
    this.#options = options;
  }

  getSnapshot(): ChatControllerState {
    return {
      settings: this.settings,
      conversations: this.conversations,
      grants: this.grants,
      conversation: this.conversation,
      isInitializing: this.isInitializing,
      isLoadingConversation: this.isLoadingConversation,
      isSending: this.isSending,
      error: this.error
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
    if (partial.grants !== undefined) this.grants = partial.grants;
    if (partial.conversation !== undefined) this.conversation = partial.conversation;
    if (partial.isInitializing !== undefined) this.isInitializing = partial.isInitializing;
    if (partial.isLoadingConversation !== undefined) {
      this.isLoadingConversation = partial.isLoadingConversation;
    }
    if (partial.isSending !== undefined) this.isSending = partial.isSending;
    if (partial.error !== undefined) this.error = partial.error;
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

  #eventHandlers: { [K in keyof ChatEventMap]: (event: ChatEventMap[K]) => void } = {
    'chat://started': (event) =>
      this.#ifCurrent(event, () => {
        this.#updateConversation((conversation) => ({
          ...conversation,
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
        this.#patch({ isSending: false });
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
    'chat://cancelled': (event) =>
      this.#ifCurrent(event, () => {
        this.#updateConversation((conversation) => ({
          ...conversation,
          activeRequestId: null,
          messages: upsertTerminalMessage(conversation.messages, event.message)
        }));
        this.#patch({ isSending: false });
      }),
    'chat://failed': (event) =>
      this.#ifCurrent(event, () => {
        this.#updateConversation((conversation) => ({
          ...conversation,
          activeRequestId: null,
          messages: upsertTerminalMessage(conversation.messages, event.message)
        }));
        this.#patch({ isSending: false, error: event.error });
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
      this.#patch({ conversation, isSending: Boolean(conversation.activeRequestId) });
      return conversation;
    } catch (error) {
      this.#patch({ error: errorText(error, 'Unable to open this conversation.') });
      return null;
    } finally {
      this.#patch({ isLoadingConversation: false });
    }
  }

  async createConversation(
    input: { title?: string; mode?: ChatMode; vaultAccess?: VaultAccess } = {}
  ) {
    this.#patch({ isLoadingConversation: true, error: null });
    try {
      const conversation = await this.#api.createConversation(input);
      this.#patch({
        conversation,
        conversations: mergeSummary(this.conversations, conversation),
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

  async initialize(conversationId?: string | null) {
    const sequence = ++this.#initializeSequence;
    this.#patch({ isInitializing: true, error: null });
    try {
      await this.#ensureListeners();
      const [settings, conversations, grants] = await Promise.all([
        this.#api.getSettings(),
        this.#api.listConversations(false),
        this.#api.listGrants()
      ]);
      if (this.#disposed || sequence !== this.#initializeSequence) return;
      this.#patch({ settings, conversations, grants });
      const targetId = conversationId ?? conversations[0]?.id ?? null;
      if (targetId) await this.openConversation(targetId);
    } catch (error) {
      this.#patch({ error: errorText(error, 'Chat is unavailable right now.') });
    } finally {
      if (sequence === this.#initializeSequence) this.#patch({ isInitializing: false });
    }
  }

  async send(content: string, useWebSearch = false) {
    const trimmed = content.trim();
    if (!trimmed || this.isSending || !this.conversation) return false;
    this.#patch({ isSending: true, error: null });
    try {
      const receipt = await this.#api.sendMessage({
        conversationId: this.conversation.id,
        content: trimmed,
        useWebSearch
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

  async setPreferences(mode: ChatMode, vaultAccess: VaultAccess) {
    const conversation = this.conversation;
    if (!conversation || (conversation.mode === mode && conversation.vaultAccess === vaultAccess)) {
      return;
    }
    try {
      const summary = await this.#api.setConversationPreferences(conversation.id, mode, vaultAccess);
      this.#updateConversation((current) => ({ ...current, ...summary }));
    } catch (error) {
      this.#patch({ error: errorText(error, 'Unable to change chat preferences.') });
    }
  }

  async grantNote(noteId: string) {
    try {
      const grant = await this.#api.grantNote(noteId);
      this.#patch({
        grants: [...this.grants.filter((item) => item.noteId !== noteId), grant],
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
        error: null
      });
    } catch (error) {
      const message = errorText(error, 'Unable to remove access to this note.');
      this.#patch({ error: message });
      throw new Error(message);
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
