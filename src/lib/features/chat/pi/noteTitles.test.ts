import { afterEach, describe, expect, it } from 'vitest';
import { Harness, MemoryStorage, ProviderDoc, createRegistry } from '@earendil-works/pi-durable';
import { createModels, type TranscriptContext } from '@earendil-works/pi-ai';
import { fauxAssistantMessage, fauxProvider } from '@earendil-works/pi-ai/providers/faux';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createNoteTitleJobs, parseGeneratedNoteTitle } from './noteTitles';

let harness: Harness | undefined;
afterEach(async () => { await harness?.close(context); harness = undefined; });

async function setup() {
  const jobs = createNoteTitleJobs();
  const registry = createRegistry(); registry.install(jobs.extension);
  const models = createModels();
  const faux = fauxProvider({ provider: 'local', models: [{ id: 'fixture' }] });
  models.setProvider(faux.provider);
  const storage = new MemoryStorage();
  harness = await Harness.open(storage, { registry, models }, context);
  const conversation = await harness.createConversation({ ownership: { kind: 'ownerless' } }, context);
  const provider = await harness.snapshot(ProviderDoc, conversation.id, context);
  return { faux, storage, conversation, run: (markdown: string, signal = new AbortController().signal) => jobs.run(harness!, conversation.id, provider!.sessionId, { provider: 'local', modelId: 'fixture' }, markdown, signal) };
}

it('generates from bounded current content without tools, a transcript or durable note excerpts', async () => {
  const { faux, storage, conversation, run } = await setup();
  let request: TranscriptContext | undefined;
  faux.setResponses([(input) => { request = input; return fauxAssistantMessage('Garden Irrigation Plan'); }]);
  const source = '🌻'.repeat(12_001);
  expect(await run(source)).toBe('Garden Irrigation Plan');
  expect(request?.messages.map(message => message.role)).toEqual(['system', 'user']);
  expect(request?.messages[1].content).toBe('🌻'.repeat(12_000));
  expect(request).not.toHaveProperty('tools');
  expect((await conversation.entries({}, 20, undefined, context)).items).toEqual([]);
  const tasks = await storage.scanTasks({ conversationId: conversation.id }, 20, undefined, context);
  expect(JSON.stringify(tasks)).not.toContain('🌻');
});

it('can retry an invalid response and cancels an active generation through Pi', async () => {
  const { faux, run } = await setup();
  faux.setResponses([fauxAssistantMessage('A title\nAnd an explanation'), fauxAssistantMessage('Garden Irrigation Plan')]);
  await expect(run('Garden watering tasks')).rejects.toThrow('short title');
  expect(await run('Garden watering tasks')).toBe('Garden Irrigation Plan');
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  faux.setResponses([async (_input, options) => {
    started();
    await new Promise<void>(resolve => options!.signal!.addEventListener('abort', () => resolve(), { once: true }));
    return fauxAssistantMessage('Late title', { stopReason: 'aborted' });
  }]);
  const abort = new AbortController();
  const pending = run('Changed content', abort.signal);
  const rejected = expect(pending).rejects.toThrow();
  await ready; abort.abort(); await rejected;
});

describe('generated title admission', () => {
  it('cleans common wrapping and rejects empty, multiline, unsafe or oversized results', () => {
    expect(parseGeneratedNoteTitle('  # “Garden Irrigation Plan”  ')).toBe('Garden Irrigation Plan');
    for (const value of ['', 'Title\nExplanation', 'Title/Path', 'x'.repeat(101), 'word '.repeat(15), 'Title\u0000']) {
      expect(() => parseGeneratedNoteTitle(value)).toThrow('short title');
    }
  });
});
