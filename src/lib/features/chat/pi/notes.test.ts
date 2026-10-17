import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Harness, MemoryStorage, createRegistry, type ToolExecutionApi } from '@earendil-works/pi-durable';
import { createModels } from '@earendil-works/pi-ai';
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { notesExtension, type NoteRead } from './notes';
import type { ReadPolicy } from './authority';

const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }));
const harnesses: Harness[] = [];
beforeEach(() => { native.invoke.mockReset(); });
afterEach(async () => { await Promise.all(harnesses.splice(0).map(harness => harness.close(context))); });
const read: NoteRead = { markdown: 'Canonical saved text', source: {
  sourceId: 'native-source-id', noteId: 'note-1', title: 'Saved note',
  readState: { kind: 'observed', contentHash: 'authored-content-hash', observedAtMillis: 123 }
} };

async function setup(policy?: ReadPolicy) {
  const registry = createRegistry();
  const resolver = vi.fn(async (_api: ToolExecutionApi) => 'host-native-authority');
  const extension = notesExtension(resolver, async () => policy);
  registry.install(extension);
  const models = createModels(); const faux = fauxProvider(); models.setProvider(faux.provider);
  const storage = new MemoryStorage();
  const harness = await Harness.open(storage, { registry, models, settings: { retry: { enabled: false }, compaction: { enabled: false } } }, context);
  harnesses.push(harness);
  const conversation = await harness.createConversation({ ownership: { kind: 'ownerless' }, agent: { model: { provider: 'faux', modelId: 'faux-1' } } }, context);
  return { harness, storage, conversation, faux, extension, resolver };
}

describe('Pi canonical note tools', () => {
  it('passes an optional exact quote to native admission and preserves the issued location in Pi history', async () => {
    const { conversation, faux } = await setup();
    native.invoke.mockResolvedValue({ ...read, source: { ...read.source, location: { quote: 'Canonical saved text' } } });
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall('read_note', { noteId: 'note-1', quote: 'Canonical saved text' }, { id: 'passage' }), { stopReason: 'toolUse' }),
      request => { expect(JSON.stringify(request)).toContain('[[cite:native-source-id]]'); return fauxAssistantMessage('A passage citation'); }
    ]);
    expect((await (await conversation.submit({ type: 'input', content: 'Cite the passage' }, context)).wait(context)).status).toBe('done');
    expect(native.invoke).toHaveBeenCalledWith('pi_chat_read_note', { authorityId: 'host-native-authority', noteId: 'note-1', quote: 'Canonical saved text' });
    expect(JSON.stringify((await conversation.context(context)).entries)).toContain('"location":{"quote":"Canonical saved text"}');
  });
  it('offers explicit attachment identities without injecting saved or unsaved note content', async () => {
    const { conversation, faux } = await setup({ mode: 'attachedNotesOnly', attachedNoteIds: ['note-1'] });
    native.invoke.mockResolvedValue(read);
    faux.setResponses([
      request => {
        const prompt = JSON.stringify(request);
        expect(prompt).toContain('attachedNotesOnly');
        expect(prompt).toContain('note-1');
        expect(prompt).not.toContain('Canonical saved text');
        return fauxAssistantMessage(fauxToolCall('read_note', { noteId: 'note-1' }, { id: 'attached' }), { stopReason: 'toolUse' });
      },
      fauxAssistantMessage('Attached note summary [[cite:native-source-id]]')
    ]);
    expect((await (await conversation.submit({ type: 'input', content: 'Summarize the attached note' }, context)).wait(context)).status).toBe('done');
    expect(native.invoke).toHaveBeenCalledWith('pi_chat_read_note', { authorityId: 'host-native-authority', noteId: 'note-1' });
  });

  it('executes real Pi search/read tasks and retains native source metadata in normal history', async () => {
    const { harness, conversation, faux, extension, resolver } = await setup();
    native.invoke.mockImplementation(async command => command === 'pi_chat_search_notes'
      ? { items: [{ noteId: 'note-1', title: 'Saved note', preview: 'discovery preview' }], nextCursor: null } : read);
    let searchHistory = ''; let readHistory = '';
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall('search_notes', { query: 'saved' }, { id: 'search' }), { stopReason: 'toolUse' }),
      request => { searchHistory = JSON.stringify(request); return fauxAssistantMessage(fauxToolCall('read_note', { noteId: 'note-1' }, { id: 'read' }), { stopReason: 'toolUse' }); },
      request => { readHistory = JSON.stringify(request); return fauxAssistantMessage('Answer [[cite:native-source-id]]'); }
    ]);
    expect((await (await conversation.submit({ type: 'input', content: 'Find the saved note' }, context)).wait(context)).status).toBe('done');
    expect(extension.tools?.map(tool => tool.name)).toEqual(['search_notes', 'read_note']);
    expect(native.invoke.mock.calls).toEqual([
      ['pi_chat_search_notes', { authorityId: 'host-native-authority', query: 'saved' }],
      ['pi_chat_read_note', { authorityId: 'host-native-authority', noteId: 'note-1' }]
    ]);
    expect(resolver).toHaveBeenCalledTimes(2);
    expect(searchHistory).toContain('discovery preview');
    expect(searchHistory).not.toContain('native-source-id');
    expect(readHistory).toContain('Canonical saved text');
    expect(readHistory).toContain('[[cite:native-source-id]]');
    const view = await conversation.context(context);
    expect(JSON.stringify(view.entries)).toContain('native-source-id');
    expect((await harness.inspect(context)).tasks).toHaveLength(0);
  });

  it('Pi rejects model grant/authority fields before invoking native tools', async () => {
    const { conversation, faux } = await setup();
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall('read_note', { noteId: 'note-1', authorityId: 'invented', grants: ['other-note'], approved: true }, { id: 'bad' }), { stopReason: 'toolUse' }),
      fauxAssistantMessage('Invalid selector handled')
    ]);
    await (await conversation.submit({ type: 'input', content: 'Try invalid arguments' }, context)).wait(context);
    expect(native.invoke).not.toHaveBeenCalled();
  });

  it('native denial is an ordinary Pi tool error and never supplies a citation token', async () => {
    const { conversation, faux } = await setup();
    native.invoke.mockRejectedValue({ code: 'retired_authority', message: 'This conversation was retired. Start a new conversation.' });
    let afterFailure = '';
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall('read_note', { noteId: 'note-1' }, { id: 'denied' }), { stopReason: 'toolUse' }),
      request => { afterFailure = JSON.stringify(request); return fauxAssistantMessage('Access is unavailable'); }
    ]);
    await (await conversation.submit({ type: 'input', content: 'Read after restriction' }, context)).wait(context);
    expect(afterFailure).not.toContain('[[cite:native-source-id]]');
    expect(afterFailure).toContain('retired');
  });
});
