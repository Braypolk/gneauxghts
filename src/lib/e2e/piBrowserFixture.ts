import { Harness, MemoryStorage, ProviderDoc, createRegistry, type ConversationId } from '@earendil-works/pi-durable';
import { createModels } from '@earendil-works/pi-ai';
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { ChatDoc, PI_CONTEXT, initializeChatDocuments, type PiChat } from '#lib/features/chat/pi/runtime.js';
import type { AuthoritySnapshot, ReadPolicy, WritePolicy, WriteGrant, VaultWritePolicy } from '#lib/features/chat/pi/authority.js';
import { createPiDiagnostics } from '#lib/features/chat/pi/diagnostics.js';
import { createNoteTitleJobs } from '#lib/features/chat/pi/noteTitles.js';

let current: Promise<PiChat> | undefined;
const authorities = new Map<string, AuthoritySnapshot>();
const temporaryGrants = new Map<string, WriteGrant>();
let vaultGrant: WriteGrant = { duration: 'off' };
let reviewBeforeApplying = true;
let holdNextResponse = false;
export function holdNextBrowserPiResponse() { holdNextResponse = true; }
let releaseHeldResponse: ((text: string) => void) | undefined;
export function releaseHeldBrowserPiResponse(text: string) { releaseHeldResponse?.(text); }
let nextResponseText: string | undefined;
let nextResponseReasoning: string | undefined;
export function setNextBrowserPiResponse(text: string, reasoning?: string) { nextResponseText = text; nextResponseReasoning = reasoning; }

/** Browser presentation fixture: actual Pi scheduling/history, synthetic native authority and provider. */
export function openBrowserPiChat(): Promise<PiChat> {
  return current ??= compose();
}

async function compose(): Promise<PiChat> {
  const faux = fauxProvider({ provider: 'local', models: [{ id: 'fixture-local' }], tokensPerSecond: 300, tokenSize: { min: 1, max: 1 } });
  const response = async (_request: unknown, options?: { signal?: AbortSignal }) => {
    if (holdNextResponse) {
      holdNextResponse = false;
      const text = await new Promise<string | undefined>(resolve => {
        const abort = () => { releaseHeldResponse = undefined; resolve(undefined); };
        releaseHeldResponse = text => {
          releaseHeldResponse = undefined;
          options?.signal?.removeEventListener('abort', abort);
          resolve(text);
        };
        if (options?.signal?.aborted) abort();
        else options?.signal?.addEventListener('abort', abort, { once: true });
      });
      return text === undefined
        ? fauxAssistantMessage('Stopped fixture response.', { stopReason: 'aborted' })
        : fauxAssistantMessage(text);
    }
    const text = nextResponseText ?? 'Fixture ordinary answer.';
    const thinking = nextResponseReasoning ?? 'Fixture reasoning.';
    nextResponseText = undefined;
    nextResponseReasoning = undefined;
    return fauxAssistantMessage([{ type: 'thinking', thinking }, { type: 'text', text }]);
  };
  faux.setResponses(Array.from({ length: 100 }, () => response));
  const models = Object.assign(createModels(), { registerModel: async () => faux.getModel() });
  models.setProvider(faux.provider);
  const storage = new MemoryStorage();
  const diagnostics = createPiDiagnostics();
  const noteTitles = createNoteTitleJobs();
  const registry = createRegistry();
  registry.install(noteTitles.extension);
  const harness = await Harness.open(storage, { registry, models, onReport: diagnostics.report,
    conversationCreated: initializeChatDocuments,
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
        read: options.read ?? { mode: 'fullVault', attachedNoteIds: [] }, write: { grant: structuredClone(vaultGrant), reviewBeforeApplying }, retired: false });
      return conversation;
    },
    async bindConversation(conversation: { id: ConversationId }) { return authorities.get(`browser-authority-${conversation.id}`)!; },
    async authorityForConversation(id: ConversationId) { return authorities.get(`browser-authority-${id}`); },
    async listConversations(limit = 50, cursor?: Parameters<PiChat['listConversations']>[1]) {
      const page = await storage.scanConversations({ order: 'descending' }, limit, cursor, PI_CONTEXT);
      const items = [];
      for (const record of page.items) { const doc = await harness.snapshot(ChatDoc, record.id, PI_CONTEXT); if (doc && !doc.forgotten && doc.purpose !== 'noteTitles') items.push({ id: record.id, ...doc }); }
      return { items, next: page.next };
    },
    async retireConversation(id: ConversationId) {
      const authority = authorities.get(`browser-authority-${id}`); if (authority) authority.retired = true;
      await (await harness.conversation(id, PI_CONTEXT))?.abort(PI_CONTEXT, { background: true });
    },
    async generateNoteTitle(markdown: string, _noteId: string | null, signal: AbortSignal) {
      const conversation = await harness.createConversation({ ownership: { kind: 'ownerless' },
        init: async (tx, id) => { (await tx.doc(ChatDoc, id)).purpose = 'noteTitles'; }
      }, PI_CONTEXT);
      const provider = await harness.snapshot(ProviderDoc, conversation.id, PI_CONTEXT);
      return noteTitles.run(harness, conversation.id, provider!.sessionId, { provider: 'local', modelId: 'fixture-local' }, markdown, signal);
    },
    async close() { diagnostics.beginClose(); try { await harness.close(PI_CONTEXT); } finally { diagnostics.dispose(); current = undefined; authorities.clear(); temporaryGrants.clear(); vaultGrant = { duration: 'off' }; reviewBeforeApplying = true; } }
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

export function changeBrowserPiWrite(authorityId: string, expectedRevision: number, write: WritePolicy): AuthoritySnapshot {
  const authority = authorities.get(authorityId);
  if (!authority || authority.revision !== expectedRevision) throw new Error('Stale browser authority');
  vaultGrant = write.grant.duration === 'always' ? structuredClone(write.grant) : { duration: 'off' };
  temporaryGrants.set(authorityId, write.grant.duration === 'temporary' ? structuredClone(write.grant) : { duration: 'off' });
  reviewBeforeApplying = write.reviewBeforeApplying;
  refreshBrowserPiWrite();
  return structuredClone(authority);
}

function refreshBrowserPiWrite() {
  for (const item of authorities.values()) {
    item.revision++;
    item.write = { grant: structuredClone(vaultGrant.duration === 'always' ? vaultGrant : temporaryGrants.get(item.authorityId) ?? { duration: 'off' }), reviewBeforeApplying };
  }
}

export function browserPiWriteDefaults(): VaultWritePolicy {
  if (vaultGrant.duration === 'temporary') throw new Error('Invalid vault grant');
  return { grant: structuredClone(vaultGrant), reviewBeforeApplying };
}

export function changeBrowserPiWriteDefaults(write: VaultWritePolicy): VaultWritePolicy {
  const changed = JSON.stringify(browserPiWriteDefaults()) !== JSON.stringify(write);
  vaultGrant = structuredClone(write.grant);
  reviewBeforeApplying = write.reviewBeforeApplying;
  if (changed) refreshBrowserPiWrite();
  return browserPiWriteDefaults();
}

export async function seedBrowserPiChat(options: { title?: string; count?: number; revisionSource?: boolean; toolCalls?: number } = {}) {
  const runtime = await openBrowserPiChat();
  const conversation = await runtime.createConversation({ title: options.title ?? 'Populated motion fixture' });
  if (options.toolCalls) {
    await conversation.submit({ type: 'write', entry: { kind: 'browser.fixture', model: [{ role: 'user', content: 'Find the themes in my notes', timestamp: 1 }] } }, PI_CONTEXT);
    for (let index = 0; index < options.toolCalls; index++) {
      const id = `read-${index}`;
      await conversation.submit({ type: 'write', entry: { kind: 'browser.fixture', model: [fauxAssistantMessage(fauxToolCall('read_note', { noteId: `note-${index}` }, { id }), { stopReason: 'toolUse' })] } }, PI_CONTEXT);
      await conversation.submit({ type: 'write', entry: { kind: 'browser.fixture', model: [{ role: 'toolResult', toolName: 'read_note', toolCallId: id, content: [{ type: 'text', text: JSON.stringify({ markdown: 'An example project note.\n'.repeat(12) }) }], details: { source: { title: `Project ideas ${index + 1}` } }, durationMs: 120, isError: index === options.toolCalls - 1, timestamp: 2 }] } }, PI_CONTEXT);
    }
    await conversation.submit({ type: 'write', entry: { kind: 'browser.fixture', model: [fauxAssistantMessage('Your notes explore creative projects and useful everyday tools.')] } }, PI_CONTEXT);
    return String(conversation.id);
  }
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
