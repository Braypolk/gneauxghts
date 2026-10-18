import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Harness, MemoryStorage, createRegistry, type ToolExecutionApi } from '@earendil-works/pi-durable';
import { createModels } from '@earendil-works/pi-ai';
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { notesExtension, type NoteRead } from './notes';
import type { ReadPolicy } from './authority';
import { render } from 'svelte/server';
import { activityTranscript, toolFailed, toolStatus, type ToolActivity } from '../ui/piActivity';
import PiActivityGroup from '../ui/PiActivityGroup.svelte';

const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }));
const harnesses: Harness[] = [];
beforeEach(() => { native.invoke.mockReset(); });
afterEach(async () => { await Promise.all(harnesses.splice(0).map(harness => harness.close(context))); });
const read: NoteRead = { markdown: 'Canonical saved text', citation: '[Note: Saved note](gneauxghts-source:native-source-id)', source: {
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
      request => { expect(JSON.stringify(request)).toContain('[Note: Saved note](gneauxghts-source:native-source-id)'); return fauxAssistantMessage('A passage citation'); }
    ]);
    expect((await (await conversation.submit({ type: 'input', content: 'Cite the passage' }, context)).wait(context)).status).toBe('done');
    expect(native.invoke).toHaveBeenCalledWith('pi_chat_read_note', { authorityId: 'host-native-authority', noteId: 'note-1', quote: 'Canonical saved text' });
    expect(JSON.stringify((await conversation.context(context)).entries)).toContain('"location":{"quote":"Canonical saved text"}');
    const tool = (await conversation.context(context)).entries.flatMap(entry => entry.model ?? []).find(message => message.role === 'toolResult');
    if (tool?.role !== 'toolResult') throw new Error('Expected a read result.');
    const value = JSON.parse(tool.content.filter(block => block.type === 'text').map(block => block.text).join(''));
    expect(value).toEqual({ markdown: read.markdown, source: { sourceId: read.source.sourceId, noteId: read.source.noteId, title: read.source.title, location: { quote: read.markdown } }, citation: '[Note: Saved note](gneauxghts-source:native-source-id)' });
    expect(tool.details).toEqual({ kind: 'noteRead', source: { ...read.source, location: { quote: read.markdown } } });
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
      fauxAssistantMessage('Attached note summary [Note: Saved note](gneauxghts-source:native-source-id)')
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
      request => { readHistory = JSON.stringify(request); return fauxAssistantMessage('Answer [Note: Saved note](gneauxghts-source:native-source-id)'); }
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
    expect(readHistory).toContain('[Note: Saved note](gneauxghts-source:native-source-id)');
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
    const activity = activityTranscript((await conversation.context(context)).entries, {}).find(item => item.kind === 'activity')!;
    if (activity.kind !== 'activity') throw new Error('Expected tool activity.');
    const tool = activity.items.find((item): item is ToolActivity => item.kind === 'tool')!;
    expect(toolStatus(tool)).toBe('Needs correction');
    expect(toolFailed(tool)).toBe(false);
  });

  it.each([
    ['read_note', 'retired_authority', 'Access ended'],
    ['search_notes', 'stale_authority', 'Access changed'],
    ['read_note', 'unavailable_note', 'Note unavailable'],
    ['read_note', 'stale_read', 'Note changed'],
    ['read_note', 'invalid_citation_location', 'Needs correction'],
    ['search_notes', 'invalid_cursor', 'Needs correction'],
    ['search_notes', 'storage', 'Failed']
  ])('preserves native %s outcome %s for the model and retained activity', async (name, code, status) => {
    const { conversation, faux } = await setup();
    native.invoke.mockRejectedValue({ code, message: 'Native note access outcome.' });
    let afterFailure = '';
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall(name, name === 'read_note' ? { noteId: 'note-1' } : { query: 'saved' }, { id: 'denied' }), { stopReason: 'toolUse' }),
      request => { afterFailure = JSON.stringify(request); return fauxAssistantMessage('Access is unavailable'); }
    ]);
    await (await conversation.submit({ type: 'input', content: 'Read after restriction' }, context)).wait(context);
    expect(afterFailure).not.toContain('[Note: Saved note](gneauxghts-source:native-source-id)');
    expect(afterFailure).toContain(code);
    const entries = (await conversation.context(context)).entries;
    const activity = activityTranscript(entries, {}).find(item => item.kind === 'activity')!;
    if (activity.kind !== 'activity') throw new Error('Expected tool activity.');
    const tool = activity.items.find((item): item is ToolActivity => item.kind === 'tool')!;
    expect(tool.result?.isError).toBe(true); // The model must still handle the unsuccessful request.
    expect(toolStatus(tool)).toBe(status);
    expect(toolFailed(tool)).toBe(status === 'Failed');
    const body = render(PiActivityGroup, { props: { group: activity } }).body;
    expect(body).toContain(status);
    if (status !== 'Failed') { expect(body).not.toContain('failed'); expect(body).not.toContain('data-status="error"'); }
  });
});
