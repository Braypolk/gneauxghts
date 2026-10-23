import { invoke } from './nativeInvoke';
import { listen } from '@tauri-apps/api/event';
import { AgentDoc, Harness, ProviderDoc, createRegistry, defineDoc, type Conversation, type ConversationId, type Cursor, type HarnessOptions, type ModelRef } from '@earendil-works/pi-durable';
import { SqliteStorage } from '@earendil-works/pi-durable/storage/sqlite';
import { BACKGROUND_CONTEXT, type Context } from '@earendil-works/chord/context';
import { openNativeSqlite } from './nativeSqlite';
import { createNativeModels, type ChatProvider, type NativeBinding } from './nativeProvider';
import { bindAuthority, readAuthority, retireAuthority, type AuthoritySnapshot, type ReadPolicy } from './authority';
import { notesExtension } from './notes';
import { admitProviderMessage } from './citations';
import { EditReviewDoc, publicationExtension } from './publication';
import { editExtension } from './edit';
import { renameExtension } from './rename';
import { createNoteTitleJobs } from './noteTitles';
import { createPiDiagnostics, type PiDiagnostics } from './diagnostics';

export const PI_CONTEXT = BACKGROUND_CONTEXT;
// Internal title scopes never appear as human chats.
export const ChatDoc = defineDoc({ kind: 'gneauxghts.chat', version: 1, scope: 'conversation', history: 'latest', fork: 'initial',
  initial: () => ({ title: '', authorityId: '', createdAtMillis: Date.now(), retired: false as boolean, forgotten: false as boolean, purpose: 'chat' as 'chat' | 'noteTitles' }) });
export const initializeChatDocuments: NonNullable<HarnessOptions['conversationCreated']> = async (tx, conversation) => {
  await tx.doc(ChatDoc, conversation.id);
  await tx.doc(EditReviewDoc, conversation.id);
};
export type PiChatSettings = {
  provider: ChatProvider; model: string; openaiModel: string; localModel: string; localBaseUrl: string;
  reasoningEffort: string; serviceTier: 'standard' | 'flex'; defaultAccess: 'full' | 'none';
};
export const readPiChatSettings = () => invoke<PiChatSettings>('chat_get_settings');
export const defaultReadPolicy = (settings: PiChatSettings): ReadPolicy => ({
  mode: settings.defaultAccess === 'full' ? 'fullVault' : 'attachedNotesOnly', attachedNoteIds: []
});
export type NewPiConversation = { title?: string; firstMessage?: string; provider?: ChatProvider; model?: string; read?: ReadPolicy };
export type PiConversationSummary = { id: ConversationId; title: string; createdAtMillis: number; authorityId: string; retired: boolean; forgotten?: boolean; purpose?: 'chat' | 'noteTitles'; model?: ModelRef };
export type PiChat = {
  harness: Harness; storage: SqliteStorage; models: ReturnType<typeof createNativeModels>;
  diagnostics: PiDiagnostics;
  createConversation(options?: NewPiConversation): Promise<Conversation>;
  bindConversation(conversation: Conversation, read?: ReadPolicy): Promise<AuthoritySnapshot>;
  authorityForConversation(id: ConversationId): Promise<AuthoritySnapshot | undefined>;
  listConversations(limit?: number, cursor?: Cursor, context?: Context): Promise<{ items: PiConversationSummary[]; next?: Cursor }>;
  retireConversation(id: ConversationId): Promise<void>;
  generateNoteTitle(markdown: string, noteId: string | null, signal: AbortSignal): Promise<string>;
  close(): Promise<void>;
};
let current: Promise<PiChat> | undefined;

/** One Running Vault lifetime. Pi owns all scheduling and durable chat progression. */
export function openPiChat(): Promise<PiChat> {
  if (import.meta.env.DEV && import.meta.env.VITE_E2E_BROWSER === 'true') {
    return import('#lib/e2e/piBrowserFixture.js').then(({ openBrowserPiChat }) => openBrowserPiChat());
  }
  return current ??= compose().catch(error => { current = undefined; throw error; });
}

async function compose(): Promise<PiChat> {
  const storage = await SqliteStorage.open(await openNativeSqlite());
  const bindings = new Map<string, NativeBinding>();
  const models = createNativeModels(bindings, admitProviderMessage);
  const registry = createRegistry();
  const diagnostics = createPiDiagnostics();
  const noteTitles = createNoteTitleJobs();
  registry.install(noteTitles.extension);
  registry.install(publicationExtension());
  registry.install(editExtension(async (api, context) => (await api.snapshot(ChatDoc, api.conversationId, context))?.authorityId ?? ''));
  registry.install(renameExtension(async (api, context) => (await api.snapshot(ChatDoc, api.conversationId, context))?.authorityId ?? ''));
  registry.install(notesExtension(
    async (api, context) => (await api.snapshot(ChatDoc, api.conversationId, context))?.authorityId ?? '',
    async (input, context) => {
      const doc = await input.read.snapshot(ChatDoc, input.conversationId, context);
      return doc?.authorityId ? (await readAuthority(doc.authorityId)).read : undefined;
    }
  ));
  let harness: Harness;
  try {
    harness = await Harness.open(storage, { registry, models,
      conversationCreated: initializeChatDocuments,
      onReport: diagnostics.report
    }, PI_CONTEXT);
  } catch (error) { diagnostics.dispose(); await storage.close(PI_CONTEXT).catch(() => {}); throw error; }
  let closing: Promise<void> | undefined;
  const unlisten: Array<() => void> = [];
  const authorityForConversation = async (id: ConversationId) => {
    const doc = await harness.snapshot(ChatDoc, id, PI_CONTEXT);
    return doc?.authorityId ? readAuthority(doc.authorityId) : undefined;
  };
  const installBinding = async (binding: NativeBinding) => {
    // Native checks the persisted tuple; the map routes and never grants permission.
    await invoke('pi_chat_validate_authority', binding);
    bindings.set(binding.providerSessionId, binding);
  };
  const bindConversation = async (conversation: Conversation, read?: ReadPolicy) => {
    const provider = await harness.snapshot(ProviderDoc, conversation.id, PI_CONTEXT);
    const doc = await harness.snapshot(ChatDoc, conversation.id, PI_CONTEXT);
    if (!provider || !doc) throw new Error('Unknown application conversation');
    if (doc.purpose === 'noteTitles') throw new Error('Application title jobs are not chat conversations.');
    const binding = { conversationId: conversation.id, providerSessionId: provider.sessionId };
    const authority = doc.authorityId ? await readAuthority(doc.authorityId)
      : await bindAuthority(binding, read ?? defaultReadPolicy(await readPiChatSettings()));
    if (authority.retired) throw new Error('This conversation has retired access. Start a new conversation.');
    await installBinding({ ...binding, authorityId: authority.authorityId });
    if (doc.authorityId !== authority.authorityId) await harness.commit(async tx => {
      (await tx.doc(ChatDoc, conversation.id)).authorityId = authority.authorityId;
    }, PI_CONTEXT);
    return authority;
  };
  const chat: PiChat = {
    harness, storage, models, diagnostics, bindConversation, authorityForConversation,
    async createConversation(options = {}) {
      const settings = await readPiChatSettings();
      const provider = options.provider ?? settings.provider;
      const model = options.model ?? (provider === 'local' ? settings.localModel : settings.openaiModel);
      if (!model.trim()) throw new Error('Choose a model in Settings before starting chat.');
      await models.registerModel(provider, model);
      const title = (options.title ?? options.firstMessage ?? 'New conversation').trim().slice(0, 120) || 'New conversation';
      const conversation = await harness.createConversation({ ownership: { kind: 'ownerless' },
        agent: { model: { provider, modelId: model } },
        init: async (tx, id) => { (await tx.doc(ChatDoc, id)).title = title; }
      }, PI_CONTEXT);
      await bindConversation(conversation, options.read ?? defaultReadPolicy(settings));
      return conversation;
    },
    async listConversations(limit = 50, cursor, context = PI_CONTEXT) {
      const page = await storage.scanConversations({ order: 'descending' }, limit, cursor, context);
      const items: PiConversationSummary[] = [];
      for (const record of page.items) {
        const doc = await harness.snapshot(ChatDoc, record.id, context);
        if (!doc || doc.forgotten || doc.purpose === 'noteTitles') continue;
        const agent = await harness.snapshot(AgentDoc, record.id, context);
        items.push({ id: record.id, ...doc, ...(agent?.model ? { model: agent.model } : {}) });
      }
      return { items, ...(page.next ? { next: page.next } : {}) };
    },
    async retireConversation(id) {
      const authority = await authorityForConversation(id);
      if (authority && !authority.retired) await retireAuthority(authority.authorityId, authority.revision);
      const conversation = await harness.conversation(id, PI_CONTEXT);
      if (conversation) await conversation.abort(PI_CONTEXT, { background: true });
      await harness.commit(async tx => { (await tx.doc(ChatDoc, id)).retired = true; }, PI_CONTEXT);
    },
    async generateNoteTitle(markdown, noteId, signal) {
      signal.throwIfAborted();
      if (!markdown.trim()) throw new Error('Add note content before generating a title.');
      const settings = await readPiChatSettings();
      const provider = settings.provider;
      const model = provider === 'local' ? settings.localModel : settings.openaiModel;
      if (!model.trim()) throw new Error('Choose a model in Settings before generating a title.');
      await models.registerModel(provider, model);
      signal.throwIfAborted();
      // This scope has no transcript or tool runs. The attachment enforces native
      // exclusions/revocation; it never reads the saved note in place of the draft.
      const conversation = await harness.createConversation({ ownership: { kind: 'ownerless' },
        init: async (tx, id) => { (await tx.doc(ChatDoc, id)).purpose = 'noteTitles'; }
      }, PI_CONTEXT);
      const providerDoc = await harness.snapshot(ProviderDoc, conversation.id, PI_CONTEXT);
      if (!providerDoc) throw new Error('Title generation is unavailable.');
      try {
        const binding = { conversationId: conversation.id, providerSessionId: providerDoc.sessionId };
        const authority = await bindAuthority(binding, { mode: 'attachedNotesOnly', attachedNoteIds: noteId ? [noteId] : [] });
        await harness.commit(async tx => { (await tx.doc(ChatDoc, conversation.id)).authorityId = authority.authorityId; }, PI_CONTEXT);
        await installBinding({ ...binding, authorityId: authority.authorityId });
        return await noteTitles.run(harness, conversation.id, providerDoc.sessionId, { provider, modelId: model }, markdown, signal);
      } finally {
        try { await chat.retireConversation(conversation.id); }
        finally { bindings.delete(providerDoc.sessionId); }
      }
    },
    close() {
      return closing ??= (async () => {
        diagnostics.beginClose();
        unlisten.splice(0).forEach(stop => stop());
        try { await harness.close(PI_CONTEXT); } finally { diagnostics.dispose(); bindings.clear(); if (current) current = undefined; }
      })();
    }
  };
  try {
    // Read metadata and model configuration only, never copy historical messages into another store.
    let cursor: Cursor | undefined;
    const denied: Conversation[] = [];
    const registeredModels = new Set<string>();
    do {
      const page = await storage.scanConversations({}, 128, cursor, PI_CONTEXT);
      for (const record of page.items) {
        const conversation = await harness.conversation(record.id, PI_CONTEXT);
        const doc = await harness.snapshot(ChatDoc, record.id, PI_CONTEXT);
        // Internal title scopes do not bind as human chat sessions.
        if (doc?.purpose === 'noteTitles') continue;
        if (!conversation || !doc?.authorityId) continue;
        const authority = await readAuthority(doc.authorityId).catch(() => undefined);
        if (!authority || authority.retired) { denied.push(conversation); continue; }
        const provider = await harness.snapshot(ProviderDoc, conversation.id, PI_CONTEXT);
        if (!provider) throw new Error('Pi provider identity is unavailable');
        await installBinding({ conversationId: conversation.id, providerSessionId: provider.sessionId, authorityId: authority.authorityId });
        const agent = await harness.snapshot(AgentDoc, record.id, PI_CONTEXT);
        if (agent?.model && (agent.model.provider === 'local' || agent.model.provider === 'openai')) {
          const key = JSON.stringify([agent.model.provider, agent.model.modelId]);
          if (!registeredModels.has(key)) {
            await models.registerModel(agent.model.provider, agent.model.modelId);
            registeredModels.add(key);
          }
        }
      }
      cursor = page.next;
    } while (cursor);
    unlisten.push(await listen<{ token: string }>('pi-chat-quiesce', async event => {
      await chat.close(); await invoke('pi_chat_quiesced', { token: event.payload.token });
    }));
    unlisten.push(await listen<{ retiredAuthorityIds: string[] }>('pi-chat-authority-changed', async event => {
      for (const binding of bindings.values()) if ('authorityId' in binding && event.payload.retiredAuthorityIds.includes(binding.authorityId)) {
        await chat.retireConversation(binding.conversationId as ConversationId);
      }
    }));
    // All mappings are installed before any operation that enables scheduling.
    for (const conversation of denied) await conversation.abort(PI_CONTEXT, { background: true });
    harness.resume();
    void harness.closed.then(end => { diagnostics.end(end); bindings.clear(); unlisten.splice(0).forEach(stop => stop()); current = undefined; });
    return chat;
  } catch (error) { await chat.close().catch(() => {}); throw error; }
}
