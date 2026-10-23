import { Harness, MemoryStorage, createRegistry, type ConversationId, type Registry, type Conversation } from '@earendil-works/pi-durable';
import { createModels } from '@earendil-works/pi-ai';
import { fauxProvider } from '@earendil-works/pi-ai/providers/faux';
import { ChatDoc, PI_CONTEXT, initializeChatDocuments, type PiChat, type PiChatSettings } from '../pi/runtime';
import type { AuthoritySnapshot } from '../pi/authority';
import { createPiConversationView } from './piConversationView';
import { createPiDiagnostics } from '../pi/diagnostics';

export const fixtureSettings: PiChatSettings = { provider: 'local', model: 'fixture', localModel: 'fixture', openaiModel: '', localBaseUrl: '', reasoningEffort: 'off', serviceTier: 'standard', defaultAccess: 'full' };
export async function piViewFixture(options: { registry?: Registry; tokensPerSecond?: number } = {}) {
  const faux = fauxProvider({ provider: 'local', models: [{ id: 'fixture' }], tokensPerSecond: options.tokensPerSecond, tokenSize: { min: 1, max: 1 } });
  const models = Object.assign(createModels(), { registerModel: async () => faux.getModel() });
  models.setProvider(faux.provider);
  const storage = new MemoryStorage(); storage.close = async () => {};
  const diagnostics = createPiDiagnostics();
  const open = async () => {
    const harness = await Harness.open(storage, { registry: options.registry ?? createRegistry(), models, conversationCreated: initializeChatDocuments, onReport: diagnostics.report, settings: { retry: { enabled: false }, compaction: { enabled: false }, progress: { partialIntervalMs: 0, outputIntervalMs: 0 } } }, PI_CONTEXT);
    void harness.closed.then(diagnostics.end);
    return harness;
  };
  const harness = await open();
  const authorities = new Map<ConversationId, AuthoritySnapshot>();
  const runtime: Omit<PiChat, 'storage' | 'models'> & { storage: MemoryStorage; models: typeof models } = {
    harness, storage, models, diagnostics,
    async createConversation(input = {}): Promise<Conversation> {
      const conversation = await runtime.harness.createConversation({ ownership: { kind: 'ownerless' }, agent: { model: { provider: 'local', modelId: 'fixture' } }, init: async (tx, id) => {
        const doc = await tx.doc(ChatDoc, id); doc.title = input.firstMessage ?? input.title ?? 'Conversation'; doc.authorityId = `authority-${id}`;
      } }, PI_CONTEXT);
      authorities.set(conversation.id, { authorityId: `authority-${conversation.id}`, revision: 1, read: input.read ?? { mode: 'fullVault', attachedNoteIds: [] }, write: { grant: { duration: 'off' }, reviewBeforeApplying: true }, retired: false });
      return conversation;
    },
    async bindConversation(conversation) { return authorities.get(conversation.id)!; },
    async authorityForConversation(id) { return authorities.get(id); },
    async listConversations(limit = 50, cursor) {
      const page = await storage.scanConversations({}, limit, cursor, PI_CONTEXT);
      const items = [];
      for (const record of page.items) { const doc = await runtime.harness.snapshot(ChatDoc, record.id, PI_CONTEXT); if (doc && !doc.forgotten) items.push({ id: record.id, ...doc }); }
      return { items, next: page.next };
    },
    async retireConversation(id) { const authority = authorities.get(id)!; authority.retired = true; await (await runtime.harness.conversation(id, PI_CONTEXT))!.abort(PI_CONTEXT, { background: true }); },
    async generateNoteTitle() { throw new Error('Title generation is outside the chat view fixture.'); },
    async close() { diagnostics.beginClose(); try { await runtime.harness.close(PI_CONTEXT); } finally { diagnostics.dispose(); } }
  };
  const binding = createPiConversationView({ open: async () => runtime as unknown as PiChat, settings: async () => fixtureSettings, observeAuthority: async () => () => {},
    changeRead: async (id, _revision, read) => {
      const authority = [...authorities.values()].find(value => value.authorityId === id)!;
      const restriction = authority.read.mode === 'fullVault' && read.mode === 'attachedNotesOnly' || authority.read.mode === 'attachedNotesOnly' && authority.read.attachedNoteIds.some(note => !read.attachedNoteIds.includes(note));
      authority.retired = restriction; if (!restriction) authority.read = read; return { ...authority };
    }
  });
  return { runtime, harness, storage, binding, faux, authorities, open, async close() { binding.dispose(); await runtime.close(); } };
}
