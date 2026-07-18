import { get, writable, type Readable } from 'svelte/store';
import { chatApi, type ChatApi } from './api';
import type {
  ChatConversation,
  ChatConversationSummary,
  ChatEventMap,
  ChatExcerpt,
  ChatMessage,
  ChatMode,
  ChatNoteGrant,
  VaultAccess, ChatSettings
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
  createConversation(input?: { title?: string; mode?: ChatMode; vaultAccess?: VaultAccess }): Promise<ChatConversation | null>;
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

export function createChatController(
  api: ChatApi = chatApi,
  options: ChatControllerOptions = {}
): ChatController {
  const store = writable<ChatControllerState>(initialState);
  const unlisteners: Array<() => void> = [];
  let initializeSequence = 0;
  let disposed = false;
  let listenersReady = false;

  const patch = (partial: Partial<ChatControllerState>) => {
    if (!disposed) store.update((state) => ({ ...state, ...partial }));
  };

  const updateConversation = (updater: (conversation: ChatConversation) => ChatConversation) => {
    if (disposed) return;
    store.update((state) => {
      if (!state.conversation) return state;
      const conversation = updater(state.conversation);
      return {
        ...state,
        conversation,
        conversations: mergeSummary(state.conversations, conversation)
      };
    });
  };

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
    return [compact, ...list.filter((item) => item.id !== compact.id)]
      .sort((a, b) => b.updatedAtMillis - a.updatedAtMillis);
  }

  function ifCurrent<T extends { conversationId: string }>(event: T, apply: () => void) {
    if (get(store).conversation?.id === event.conversationId) apply();
  }

  const eventHandlers: { [K in keyof ChatEventMap]: (event: ChatEventMap[K]) => void } = {
    'chat://started': (event) => ifCurrent(event, () => {
      updateConversation((conversation) => ({
        ...conversation,
        activeRequestId: event.requestId,
        messages: upsertTerminalMessage(conversation.messages, event.message)
      }));
      patch({ isSending: true, error: null });
    }),
    'chat://text-delta': (event) => ifCurrent(event, () => {
      updateConversation((conversation) => {
        const messages = conversation.messages.map((message) => message.id === event.messageId
          ? { ...message, content: message.content + event.delta, status: 'streaming' as const, updatedAtMillis: Date.now() }
          : message);
        return { ...conversation, activeRequestId: event.requestId, messages };
      });
    }),
    'chat://source': (event) => ifCurrent(event, () => {
      updateConversation((conversation) => ({
        ...conversation,
        messages: conversation.messages.map((message) => message.id === event.messageId
          ? { ...message, citations: [...message.citations.filter((citation) => citation.id !== event.citation.id), event.citation] }
          : message)
      }));
    }),
    'chat://completed': (event) => ifCurrent(event, () => {
      updateConversation((conversation) => ({
        ...conversation,
        ...(event.conversation ?? {}),
        activeRequestId: null,
        messages: upsertTerminalMessage(conversation.messages, event.message)
      }));
      patch({ isSending: false });
      const conversation = get(store).conversation;
      if (
        conversation &&
        event.message.role === 'assistant' &&
        event.message.status === 'completed'
      ) {
        void options.onAssistantCompleted?.({
          conversation,
          message: event.message
        });
      }
    }),
    'chat://cancelled': (event) => ifCurrent(event, () => {
      updateConversation((conversation) => ({
        ...conversation,
        activeRequestId: null,
        messages: upsertTerminalMessage(conversation.messages, event.message)
      }));
      patch({ isSending: false });
    }),
    'chat://failed': (event) => ifCurrent(event, () => {
      updateConversation((conversation) => ({
        ...conversation,
        activeRequestId: null,
        messages: upsertTerminalMessage(conversation.messages, event.message)
      }));
      patch({ isSending: false, error: event.error });
    }),
    'chat://projection-conflict': (event) => ifCurrent(event, () => {
      void openConversation(event.conversationId);
    })
  };

  async function ensureListeners() {
    if (listenersReady) return;
    listenersReady = true;
    try {
      for (const event of Object.keys(eventHandlers) as Array<keyof ChatEventMap>) {
        const off = await api.on(event, eventHandlers[event] as never);
        if (disposed) off(); else unlisteners.push(off);
      }
    } catch (error) {
      listenersReady = false;
      throw error;
    }
  }

  async function refreshList() {
    try {
      const conversations = await api.listConversations(false);
      patch({ conversations, error: null });
    } catch (error) {
      patch({ error: errorText(error, 'Unable to load conversations.') });
    }
  }

  async function openConversation(conversationId: string) {
    patch({ isLoadingConversation: true, error: null });
    try {
      const conversation = await api.getConversation(conversationId);
      patch({ conversation, isSending: Boolean(conversation.activeRequestId) });
      return conversation;
    } catch (error) {
      patch({ error: errorText(error, 'Unable to open this conversation.') });
      return null;
    } finally {
      patch({ isLoadingConversation: false });
    }
  }

  async function createConversation(input: { title?: string; mode?: ChatMode; vaultAccess?: VaultAccess } = {}) {
    patch({ isLoadingConversation: true, error: null });
    try {
      const conversation = await api.createConversation(input);
      patch({
        conversation,
        conversations: mergeSummary(get(store).conversations, conversation),
        isSending: false
      });
      return conversation;
    } catch (error) {
      patch({ error: errorText(error, 'Unable to start a conversation.') });
      return null;
    } finally {
      patch({ isLoadingConversation: false });
    }
  }

  async function initialize(conversationId?: string | null) {
    const sequence = ++initializeSequence;
    patch({ isInitializing: true, error: null });
    try {
      await ensureListeners();
      const [settings, conversations, grants] = await Promise.all([
        api.getSettings(),
        api.listConversations(false),
        api.listGrants()
      ]);
      if (disposed || sequence !== initializeSequence) return;
      patch({ settings, conversations, grants });
      const targetId = conversationId ?? conversations[0]?.id ?? null;
      if (targetId) await openConversation(targetId);
    } catch (error) {
      patch({ error: errorText(error, 'Chat is unavailable right now.') });
    } finally {
      if (sequence === initializeSequence) patch({ isInitializing: false });
    }
  }

  async function send(content: string, useWebSearch = false) {
    const trimmed = content.trim();
    const state = get(store);
    if (!trimmed || state.isSending || !state.conversation) return false;
    patch({ isSending: true, error: null });
    try {
      const receipt = await api.sendMessage({
        conversationId: state.conversation.id,
        content: trimmed,
        useWebSearch
      });
      updateConversation((conversation) => ({
        ...conversation,
        activeRequestId: receipt.requestId,
        messages: receipt.assistantMessage
          ? upsertMessage(upsertMessage(conversation.messages, receipt.userMessage), receipt.assistantMessage)
          : upsertMessage(conversation.messages, receipt.userMessage)
      }));
      return true;
    } catch (error) {
      patch({ isSending: false, error: errorText(error, 'Unable to send this message.') });
      return false;
    }
  }

  async function cancel() {
    const requestId = get(store).conversation?.activeRequestId;
    if (!requestId) return;
    try {
      await api.cancelRequest(requestId);
    } catch (error) {
      patch({ error: errorText(error, 'Unable to stop the response.') });
    }
  }

  async function retry(messageId: string) {
    if (get(store).isSending) return;
    patch({ isSending: true, error: null });
    try {
      const receipt = await api.retryMessage(messageId);
      updateConversation((conversation) => ({
        ...conversation,
        activeRequestId: receipt.requestId,
        messages: receipt.assistantMessage
          ? upsertMessage(conversation.messages, receipt.assistantMessage)
          : conversation.messages
      }));
    } catch (error) {
      patch({ isSending: false, error: errorText(error, 'Unable to retry this response.') });
    }
  }

  async function setPreferences(mode: ChatMode, vaultAccess: VaultAccess) {
    const conversation = get(store).conversation;
    if (!conversation || (conversation.mode === mode && conversation.vaultAccess === vaultAccess)) return;
    try {
      const summary = await api.setConversationPreferences(conversation.id, mode, vaultAccess);
      updateConversation((current) => ({ ...current, ...summary }));
    } catch (error) {
      patch({ error: errorText(error, 'Unable to change chat preferences.') });
    }
  }

  async function grantNote(noteId: string) {
    try {
      const grant = await api.grantNote(noteId);
      patch({
        grants: [...get(store).grants.filter((item) => item.noteId !== noteId), grant],
        error: null
      });
    } catch (error) {
      const message = errorText(error, 'Unable to allow access to this note.');
      patch({ error: message });
      throw new Error(message);
    }
  }

  async function revokeNote(noteId: string) {
    try {
      await api.revokeNote(noteId);
      patch({ grants: get(store).grants.filter((item) => item.noteId !== noteId), error: null });
    } catch (error) {
      const message = errorText(error, 'Unable to remove access to this note.');
      patch({ error: message });
      throw new Error(message);
    }
  }

  return {
    subscribe: store.subscribe,
    getSnapshot: () => get(store),
    initialize,
    dispose() {
      disposed = true;
      initializeSequence += 1;
      unlisteners.splice(0).forEach((off) => off());
    },
    refreshList,
    createConversation,
    openConversation,
    send,
    cancel,
    retry,
    setPreferences,
    grantNote,
    revokeNote,
    createExcerpt: (messageId, text) => api.createExcerpt(messageId, text),
    rememberExcerpt: (excerptId) => api.rememberExcerpt(excerptId),
    async remember(messageId, text) {
      const excerpt = await api.createExcerpt(messageId, text);
      return api.rememberExcerpt(excerpt.id);
    },
    unremember: (excerptId) => api.unrememberExcerpt(excerptId),
    clearError: () => patch({ error: null })
  };
}
