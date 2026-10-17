import { Harness, MemoryStorage, createRegistry, type ConversationId } from '@earendil-works/pi-durable';
import { createModels } from '@earendil-works/pi-ai';
import { fauxAssistantMessage, fauxProvider } from '@earendil-works/pi-ai/providers/faux';
import { ChatDoc, PI_CONTEXT, type PiChat } from '$lib/features/chat/pi/runtime';
import type { AuthoritySnapshot, ReadPolicy } from '$lib/features/chat/pi/authority';
import { createPiDiagnostics } from '$lib/features/chat/pi/diagnostics';

let current: Promise<PiChat> | undefined;
const authorities = new Map<string, AuthoritySnapshot>();
let holdNextResponse = false;
export function holdNextBrowserPiResponse() { holdNextResponse = true; }

/** Browser presentation fixture: actual Pi scheduling/history, synthetic native authority and provider. */
export function openBrowserPiChat(): Promise<PiChat> {
  return current ??= compose();
}

async function compose(): Promise<PiChat> {
  const faux = fauxProvider({ provider: 'local', models: [{ id: 'fixture-local' }], tokensPerSecond: 300, tokenSize: { min: 1, max: 1 } });
  const response = async (_request: unknown, options?: { signal?: AbortSignal }) => {
    if (holdNextResponse) {
      holdNextResponse = false;
      if (!options?.signal?.aborted) await new Promise<void>(resolve => options?.signal?.addEventListener('abort', () => resolve(), { once: true }));
      return fauxAssistantMessage('Stopped fixture response.', { stopReason: 'aborted' });
    }
    return fauxAssistantMessage([{ type: 'thinking', thinking: 'Fixture reasoning.' }, { type: 'text', text: 'Fixture ordinary answer.' }]);
  };
  faux.setResponses(Array.from({ length: 100 }, () => response));
  const models = Object.assign(createModels(), { registerModel: async () => faux.getModel() });
  models.setProvider(faux.provider);
  const storage = new MemoryStorage();
  const diagnostics = createPiDiagnostics();
  const harness = await Harness.open(storage, { registry: createRegistry(), models, onReport: diagnostics.report,
    settings: { retry: { enabled: false }, compaction: { enabled: false }, progress: { partialIntervalMs: 0, outputIntervalMs: 0 } }
  }, PI_CONTEXT);
  void harness.closed.then(diagnostics.end);
  const runtime = {
    harness, storage, models, diagnostics,
    async createConversation(options: Parameters<PiChat['createConversation']>[0] = {}) {
      const conversation = await harness.createConversation({ ownership: { kind: 'ownerless' }, agent: { model: { provider: 'local', modelId: 'fixture-local' } }, init: async (tx, id) => {
        const doc = await tx.doc(ChatDoc, id);
        doc.title = options.title ?? options.firstMessage ?? 'Conversation'; doc.authorityId = `browser-authority-${id}`;
      } }, PI_CONTEXT);
      authorities.set(`browser-authority-${conversation.id}`, { authorityId: `browser-authority-${conversation.id}`, revision: 1,
        read: options.read ?? { mode: 'fullVault', attachedNoteIds: [] }, write: { grant: { duration: 'off' }, reviewBeforeApplying: true }, retired: false });
      return conversation;
    },
    async bindConversation(conversation: { id: ConversationId }) { return authorities.get(`browser-authority-${conversation.id}`)!; },
    async authorityForConversation(id: ConversationId) { return authorities.get(`browser-authority-${id}`); },
    async listConversations(limit = 50, cursor?: Parameters<PiChat['listConversations']>[1]) {
      const page = await storage.scanConversations({ order: 'descending' }, limit, cursor, PI_CONTEXT);
      const items = [];
      for (const record of page.items) { const doc = await harness.snapshot(ChatDoc, record.id, PI_CONTEXT); if (doc && !doc.forgotten) items.push({ id: record.id, ...doc }); }
      return { items, next: page.next };
    },
    async retireConversation(id: ConversationId) {
      const authority = authorities.get(`browser-authority-${id}`); if (authority) authority.retired = true;
      await (await harness.conversation(id, PI_CONTEXT))?.abort(PI_CONTEXT, { background: true });
    },
    async close() { diagnostics.beginClose(); try { await harness.close(PI_CONTEXT); } finally { diagnostics.dispose(); current = undefined; authorities.clear(); } }
  };
  return runtime as unknown as PiChat;
}

export function changeBrowserPiRead(authorityId: string, expectedRevision: number, read: ReadPolicy): AuthoritySnapshot {
  const authority = authorities.get(authorityId);
  if (!authority || authority.revision !== expectedRevision) throw new Error('Stale browser authority');
  const restricted = authority.read.mode === 'fullVault' && read.mode === 'attachedNotesOnly'
    || authority.read.attachedNoteIds.some(id => !read.attachedNoteIds.includes(id));
  Object.assign(authority, { revision: authority.revision + 1, retired: restricted, ...(restricted ? {} : { read }) });
  return structuredClone(authority);
}

export async function seedBrowserPiChat(options: { title?: string; count?: number; revisionSource?: boolean } = {}) {
  const runtime = await openBrowserPiChat();
  const conversation = await runtime.createConversation({ title: options.title ?? 'Populated motion fixture' });
  for (let index = 0; index < (options.count ?? 40); index++) {
    const message = index % 2 && options.revisionSource ? fauxAssistantMessage(`Retained source: [Note: Beta note · “Beta body is independent from Alpha.”](gneauxghts-source:${'a'.repeat(48)})`) : index % 2 ? fauxAssistantMessage(('## Example response\n\n' + 'Some example words that wrap within the conversation. '.repeat(20) + '\n\n- First item\n- Second item\n').repeat(3))
      : { role: 'user' as const, content: 'Could you explain this note?', timestamp: Date.now() };
    await conversation.submit({ type: 'write', entry: { kind: 'browser.fixture', model: [message] } }, PI_CONTEXT);
  }
  return String(conversation.id);
}

export async function readBrowserPiChat() {
  const runtime = await openBrowserPiChat(), page = await runtime.listConversations();
  return Promise.all(page.items.map(async summary => {
    const conversation = (await runtime.harness.conversation(summary.id, PI_CONTEXT))!;
    const entries = await conversation.entries({ order: 'ascending' }, 200, undefined, PI_CONTEXT);
    return { id: String(summary.id), title: summary.title, messages: entries.items.flatMap(entry => entry.model ?? []).map(message => ({ role: message.role,
      content: typeof message.content === 'string' ? message.content : message.content.filter(block => block.type === 'text').map(block => block.text).join('\n') })) };
  }));
}
