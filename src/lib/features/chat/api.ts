import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type {
  ChatConversation,
  ChatConversationSummary,
  ChatEventMap,
  ChatExcerpt,
  ChatKeyStatus,
  ChatMessage,
  ChatMode,
  ChatNoteGrant,
  ChatSendReceipt,
  ChatSettings,
  ProjectionConflictResolution,
  VaultAccess
} from './types';

interface RawChatSettings {
  provider: string; model: string; defaultMode?: ChatMode; defaultAccess: VaultAccess;
  serviceTier?: ChatSettings['serviceTier'];
  atlasVisibility?: ChatSettings['atlasVisibility'];
}
interface RawSummary {
  id: string; title: string; mode: ChatMode; access: VaultAccess; status: string;
  createdAtMillis: number; updatedAtMillis: number; messageCount: number; detached: boolean;
}
interface RawSource {
  kind: string; noteId?: string | null; notePath?: string | null; title: string; excerpt: string;
  url?: string | null; anchor?: string | null;
}
interface RawMessage {
  id: string; conversationId: string; ordinal: number; role: string; status: string; content: string;
  error?: string | null; part: number; createdAtMillis: number; sources: RawSource[];
}
interface RawExcerpt {
  id: string; conversationId: string; messageId: string; startOffset: number; endOffset: number;
  quote: string; anchor: string; remembered: boolean;
}
interface RawConversation extends RawSummary {
  messages: RawMessage[]; excerpts: RawExcerpt[]; projectionPath?: string | null;
}
interface RawReceipt { requestId: string; conversationId: string; userMessageId: string; assistantMessageId: string }
interface RawStreamEvent {
  requestId: string; conversationId: string; messageId: string; delta?: string; content?: string;
  source?: RawSource; error?: string;
}
interface RawProjectionConflictEvent {
  conversationId: string; notePath: string; deleted: boolean;
}

function normalizeSettings(raw: RawChatSettings): ChatSettings {
  return {
    provider: raw.provider,
    model: raw.model,
    serviceTier: raw.serviceTier ?? 'standard',
    defaultMode: raw.defaultMode ?? 'auto',
    defaultVaultAccess: raw.defaultAccess,
    atlasVisibility: raw.atlasVisibility ?? 'hidden'
  };
}

function normalizeSummary(raw: RawSummary): ChatConversationSummary {
  return {
    id: raw.id,
    title: raw.title,
    status: raw.detached ? 'projectionConflict' : raw.status === 'archived' ? 'archived' : 'active',
    mode: raw.mode,
    vaultAccess: raw.access,
    createdAtMillis: raw.createdAtMillis,
    updatedAtMillis: raw.updatedAtMillis,
    messageCount: raw.messageCount,
    lastMessagePreview: null
  };
}

function normalizeSource(raw: RawSource, index = 0) {
  const id = `${raw.kind}:${raw.noteId ?? raw.url ?? raw.title}:${raw.anchor ?? index}`;
  if (raw.kind === 'web' && raw.url) {
    return { id, kind: 'web' as const, label: raw.title, url: raw.url, excerpt: raw.excerpt || null };
  }
  return {
    id,
    kind: 'note' as const,
    label: raw.title,
    noteId: raw.noteId ?? '',
    notePath: raw.notePath ?? '',
    sectionLabel: raw.anchor ?? null,
    startLine: null,
    excerpt: raw.excerpt || null
  };
}

function normalizeMessage(raw: RawMessage) {
  return {
    id: raw.id,
    conversationId: raw.conversationId,
    role: raw.role === 'user' ? 'user' as const : raw.role === 'system' ? 'system' as const : 'assistant' as const,
    content: raw.content,
    status: raw.status === 'complete' ? 'completed' as const : raw.status as ChatMessage['status'],
    createdAtMillis: raw.createdAtMillis,
    updatedAtMillis: raw.createdAtMillis,
    requestId: null,
    errorMessage: raw.error ?? null,
    citations: (raw.sources ?? []).map(normalizeSource),
    linkTarget: null
  };
}

function projectionLink(summary: RawSummary, part: number, anchor: string) {
  const date = new Date(summary.createdAtMillis).toISOString().slice(0, 10);
  const tail = summary.id.split('_').at(-1) ?? summary.id;
  const shortId = tail.length > 6 ? tail.slice(0, 6) : summary.id;
  return `Chats/${date}-${shortId}/Part ${String(part).padStart(3, '0')}#^${anchor}`;
}

function normalizeExcerpt(raw: RawExcerpt, linkTarget = `#^${raw.anchor}`): ChatExcerpt {
  return {
    id: raw.id,
    conversationId: raw.conversationId,
    messageId: raw.messageId,
    text: raw.quote,
    linkTarget,
    remembered: raw.remembered,
    createdAtMillis: 0
  };
}

export interface ChatApi {
  getSettings(): Promise<ChatSettings>;
  setSettings(settings: ChatSettings): Promise<ChatSettings>;
  getKeyStatus(provider?: string): Promise<ChatKeyStatus>;
  setApiKey(provider: string, apiKey: string): Promise<ChatKeyStatus>;
  createConversation(input?: { title?: string; mode?: ChatMode; vaultAccess?: VaultAccess }): Promise<ChatConversation>;
  listConversations(includeArchived?: boolean): Promise<ChatConversationSummary[]>;
  getConversation(conversationId: string): Promise<ChatConversation>;
  renameConversation(conversationId: string, title: string): Promise<ChatConversationSummary>;
  archiveConversation(conversationId: string, archived: boolean): Promise<ChatConversationSummary>;
  setConversationPreferences(conversationId: string, mode: ChatMode, vaultAccess: VaultAccess): Promise<ChatConversationSummary>;
  sendMessage(input: { conversationId: string; content: string; useWebSearch?: boolean }): Promise<ChatSendReceipt>;
  cancelRequest(requestId: string): Promise<void>;
  retryMessage(messageId: string): Promise<ChatSendReceipt>;
  createExcerpt(messageId: string, text: string): Promise<ChatExcerpt>;
  rememberExcerpt(excerptId: string): Promise<ChatExcerpt>;
  unrememberExcerpt(excerptId: string): Promise<ChatExcerpt>;
  listGrants(): Promise<ChatNoteGrant[]>;
  grantNote(noteId: string): Promise<ChatNoteGrant>;
  revokeNote(noteId: string): Promise<void>;
  resolveProjectionConflict(conversationId: string, resolution: ProjectionConflictResolution): Promise<ChatConversation>;
  on<K extends keyof ChatEventMap>(event: K, handler: (payload: ChatEventMap[K]) => void): Promise<UnlistenFn>;
}

export const CHAT_COMMANDS = {
  getSettings: 'chat_get_settings',
  setSettings: 'chat_set_settings',
  getKeyStatus: 'chat_get_key_status',
  setApiKey: 'chat_set_api_key',
  createConversation: 'chat_create_conversation',
  listConversations: 'chat_list_conversations',
  getConversation: 'chat_get_conversation',
  renameConversation: 'chat_rename_conversation',
  archiveConversation: 'chat_archive_conversation',
  setConversationPreferences: 'chat_update_conversation_policy',
  sendMessage: 'chat_send_message',
  cancelRequest: 'chat_cancel_request',
  retryMessage: 'chat_retry_message',
  createExcerpt: 'chat_create_excerpt',
  rememberExcerpt: 'chat_remember_excerpt',
  unrememberExcerpt: 'chat_unremember_excerpt',
  listGrants: 'chat_list_grants',
  grantNote: 'chat_grant_note',
  revokeNote: 'chat_revoke_note',
  resolveProjectionConflict: 'chat_resolve_projection_conflict'
} as const;

export class TauriChatApi implements ChatApi {
  #messageConversations = new Map<string, string>();
  #activeRequests = new Map<string, string>();
  #excerptLinks = new Map<string, string>();

  async getSettings() { return normalizeSettings(await invoke<RawChatSettings>(CHAT_COMMANDS.getSettings)); }
  async setSettings(settings: ChatSettings) {
    const raw = await invoke<RawChatSettings>(CHAT_COMMANDS.setSettings, {
      settings: {
        provider: settings.provider,
        model: settings.model,
        serviceTier: settings.serviceTier,
        defaultMode: settings.defaultMode,
        defaultAccess: settings.defaultVaultAccess,
        atlasVisibility: settings.atlasVisibility
      }
    });
    return normalizeSettings(raw);
  }
  async getKeyStatus(provider = 'openai') {
    const raw = await invoke<{ configured: boolean }>(CHAT_COMMANDS.getKeyStatus);
    return { provider, configured: raw.configured, displayHint: null };
  }
  async setApiKey(provider: string, apiKey: string) {
    const raw = await invoke<{ configured: boolean }>(CHAT_COMMANDS.setApiKey, { apiKey });
    return { provider, configured: raw.configured, displayHint: null };
  }
  createConversation(input: { title?: string; mode?: ChatMode; vaultAccess?: VaultAccess } = {}) {
    return invoke<RawConversation>(CHAT_COMMANDS.createConversation, {
      request: { title: input.title, mode: input.mode, access: input.vaultAccess }
    }).then((raw) => this.#normalizeConversation(raw));
  }
  async listConversations(includeArchived = false) {
    const items = (await invoke<RawSummary[]>(CHAT_COMMANDS.listConversations)).map(normalizeSummary);
    return includeArchived ? items : items.filter((item) => item.status !== 'archived');
  }
  getConversation(conversationId: string) {
    return invoke<RawConversation>(CHAT_COMMANDS.getConversation, { conversationId })
      .then((raw) => this.#normalizeConversation(raw));
  }
  async renameConversation(conversationId: string, title: string) {
    return normalizeSummary(await invoke<RawConversation>(CHAT_COMMANDS.renameConversation, { conversationId, title }));
  }
  async archiveConversation(conversationId: string, archived: boolean) {
    await invoke(CHAT_COMMANDS.archiveConversation, { conversationId, archived });
    return normalizeSummary(await invoke<RawConversation>(CHAT_COMMANDS.getConversation, { conversationId }));
  }
  async setConversationPreferences(conversationId: string, mode: ChatMode, vaultAccess: VaultAccess) {
    return normalizeSummary(await invoke<RawConversation>(CHAT_COMMANDS.setConversationPreferences, {
      conversationId, mode, access: vaultAccess
    }));
  }
  async sendMessage(input: { conversationId: string; content: string; useWebSearch?: boolean }) {
    const raw = await invoke<RawReceipt>(CHAT_COMMANDS.sendMessage, {
      request: { conversationId: input.conversationId, content: input.content, useWebSearch: input.useWebSearch }
    });
    this.#messageConversations.set(raw.userMessageId, raw.conversationId);
    this.#messageConversations.set(raw.assistantMessageId, raw.conversationId);
    this.#activeRequests.set(raw.requestId, raw.conversationId);
    const now = Date.now();
    return {
      requestId: raw.requestId,
      conversationId: raw.conversationId,
      userMessage: this.#placeholderMessage(raw.userMessageId, raw.conversationId, 'user', input.content, 'completed', now),
      assistantMessage: this.#placeholderMessage(raw.assistantMessageId, raw.conversationId, 'assistant', '', 'streaming', now + 1)
    };
  }
  async cancelRequest(requestId: string) { await invoke(CHAT_COMMANDS.cancelRequest, { requestId }); }
  async retryMessage(messageId: string) {
    const conversationId = this.#messageConversations.get(messageId);
    if (!conversationId) throw new Error('Reopen the conversation before retrying this message.');
    const raw = await invoke<RawReceipt>(CHAT_COMMANDS.retryMessage, { conversationId, messageId });
    this.#activeRequests.set(raw.requestId, raw.conversationId);
    const now = Date.now();
    const assistantMessage = this.#placeholderMessage(raw.assistantMessageId, raw.conversationId, 'assistant', '', 'streaming', now);
    this.#messageConversations.set(raw.assistantMessageId, raw.conversationId);
    return {
      requestId: raw.requestId,
      conversationId: raw.conversationId,
      userMessage: this.#placeholderMessage(raw.userMessageId, raw.conversationId, 'user', '', 'completed', now - 1),
      assistantMessage
    };
  }
  async createExcerpt(messageId: string, text: string) {
    const conversationId = this.#messageConversations.get(messageId);
    if (!conversationId) throw new Error('Reopen the conversation before linking this passage.');
    const conversation = await invoke<RawConversation>(CHAT_COMMANDS.getConversation, { conversationId });
    const content = conversation.messages.find((message) => message.id === messageId)?.content ?? '';
    const startOffset = content.indexOf(text);
    const raw = await invoke<RawExcerpt>(CHAT_COMMANDS.createExcerpt, {
      conversationId,
      messageId,
      startOffset: startOffset >= 0 ? startOffset : null,
      endOffset: startOffset >= 0 ? startOffset + text.length : null,
      selectedText: text
    });
    const part = conversation.messages.find((message) => message.id === messageId)?.part ?? 1;
    const linkTarget = projectionLink(conversation, part, raw.anchor);
    this.#excerptLinks.set(raw.id, linkTarget);
    return normalizeExcerpt(raw, linkTarget);
  }
  async rememberExcerpt(excerptId: string) {
    return normalizeExcerpt(await invoke<RawExcerpt>(CHAT_COMMANDS.rememberExcerpt, { excerptId }), this.#excerptLinks.get(excerptId));
  }
  async unrememberExcerpt(excerptId: string) {
    return normalizeExcerpt(await invoke<RawExcerpt>(CHAT_COMMANDS.unrememberExcerpt, { excerptId }), this.#excerptLinks.get(excerptId));
  }
  async listGrants() {
    const grants = await invoke<Array<{ noteId: string; notePath: string | null; title: string; grantedAtMillis: number }>>(CHAT_COMMANDS.listGrants);
    return grants.map((grant) => ({ noteId: grant.noteId, notePath: grant.notePath ?? '', noteTitle: grant.title, grantedAtMillis: grant.grantedAtMillis }));
  }
  async grantNote(noteId: string) {
    await invoke(CHAT_COMMANDS.grantNote, { noteId });
    const grant = (await this.listGrants()).find((item) => item.noteId === noteId);
    if (!grant) throw new Error('The note access grant could not be read back.');
    return grant;
  }
  async revokeNote(noteId: string) { await invoke(CHAT_COMMANDS.revokeNote, { noteId }); }
  async resolveProjectionConflict(conversationId: string, resolution: ProjectionConflictResolution) {
    const action = resolution === 'convertToNote' ? 'convert' : 'restore';
    await invoke<string | null>(CHAT_COMMANDS.resolveProjectionConflict, { conversationId, action });
    return this.getConversation(conversationId);
  }
  on<K extends keyof ChatEventMap>(event: K, handler: (payload: ChatEventMap[K]) => void) {
    return listen<RawStreamEvent | RawProjectionConflictEvent>(event, ({ payload }) => {
      if (event === 'chat://projection-conflict') {
        handler(payload as ChatEventMap[K]);
        return;
      }
      const stream = payload as RawStreamEvent;
      if (event === 'chat://started') {
        handler({ ...stream, message: this.#placeholderMessage(stream.messageId, stream.conversationId, 'assistant', '', 'streaming', Date.now()) } as ChatEventMap[K]);
      } else if (event === 'chat://text-delta') {
        handler({ ...stream, delta: stream.delta ?? '' } as ChatEventMap[K]);
      } else if (event === 'chat://source') {
        if (stream.source) handler({ ...stream, citation: normalizeSource(stream.source) } as ChatEventMap[K]);
      } else {
        this.#activeRequests.delete(stream.requestId);
        const status = event === 'chat://completed' ? 'completed' : event === 'chat://cancelled' ? 'cancelled' : 'error';
        const message = this.#placeholderMessage(stream.messageId, stream.conversationId, 'assistant', stream.content ?? '', status, Date.now());
        message.errorMessage = stream.error ?? null;
        if (event === 'chat://failed') {
          handler({ ...stream, message, error: stream.error ?? 'The response failed.', retryable: true } as ChatEventMap[K]);
        } else {
          handler({ ...stream, message } as ChatEventMap[K]);
        }
      }
    });
  }

  #normalizeConversation(raw: RawConversation): ChatConversation {
    const messages = raw.messages.map((message) => {
      this.#messageConversations.set(message.id, raw.id);
      return { ...normalizeMessage(message), linkTarget: projectionLink(raw, message.part, `msg_${message.id}`) };
    });
    for (const excerpt of raw.excerpts) {
      const part = raw.messages.find((message) => message.id === excerpt.messageId)?.part ?? 1;
      this.#excerptLinks.set(excerpt.id, projectionLink(raw, part, excerpt.anchor));
    }
    const excerptMessageIds = Object.fromEntries(
      raw.excerpts.map((excerpt) => [excerpt.anchor, excerpt.messageId])
    );
    return {
      ...normalizeSummary(raw),
      messages,
      activeRequestId: [...this.#activeRequests].find(([, id]) => id === raw.id)?.[0] ?? null,
      projectionPath: raw.projectionPath ?? null,
      excerptMessageIds
    };
  }

  #placeholderMessage(
    id: string,
    conversationId: string,
    role: 'user' | 'assistant',
    content: string,
    status: ChatMessage['status'],
    createdAtMillis: number
  ): ChatMessage {
    this.#messageConversations.set(id, conversationId);
    return {
      id, conversationId, role, content, status, createdAtMillis, updatedAtMillis: createdAtMillis,
      requestId: null, errorMessage: null, citations: [], linkTarget: null
    };
  }
}

export const chatApi = new TauriChatApi();
