import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Harness, MemoryStorage, createRegistry, type TaskId } from '@earendil-works/pi-durable';
import { createModels } from '@earendil-works/pi-ai';
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { render } from 'svelte/server';
import { renameExtension } from './rename';
import { EditReviewDoc, bindPublicationDocumentOwner, decideEditReview, publicationExtension, type PublicationResult } from './publication';
import { activityTranscript } from '../ui/piActivity';
import PiActivityGroup from '../ui/PiActivityGroup.svelte';

const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }));
const harnesses: Harness[] = [];
const closers: Array<() => Promise<void>> = [];
beforeEach(() => native.invoke.mockReset());
afterEach(async () => {
  for (const harness of harnesses.splice(0)) await harness.close(context);
  for (const close of closers.splice(0)) await close();
});

const args = { noteId: 'note-1', expectedReadSourceId: 'source-1', title: 'New title' };
const target = { noteId: 'note-1', path: '/vault/Projects/Old.md', destinationPath: '/vault/Projects/New title.md' };

async function fixture() {
  const markdown = '---\nproject: Alpha\n---\n\nUnchanged body\n';
  let result: PublicationResult | undefined;
  const adoption = vi.fn();
  native.invoke.mockImplementation(async (command: string, input: Record<string, unknown> = {}) => {
    if (command === 'pi_chat_prepare_mutation') {
      expect(input.mutation).toEqual({ operation: 'rename', ...args });
      return { operation: 'rename', intentId: 'intent', payloadHash: 'rename-hash', reviewRequired: true, target,
        rename: { sourcePath: 'Projects/Old.md', destinationPath: 'Projects/New title.md' } };
    }
    if (command === 'pi_chat_approve_mutation') expect(input).toEqual({ authorityId: 'authority', intentId: 'intent', payloadHash: 'rename-hash' });
    if (command === 'pi_chat_reconcile_mutation') return result ?? { status: 'unpublished' };
    if (command === 'pi_chat_bind_editor_owner') return 'owner';
    if (command === 'pi_chat_admit_editor_publication') { expect(input.target).toEqual(target); return 'admission'; }
    if (command === 'pi_chat_publish_mutation') return result = { status: 'committed', receiptId: 'receipt', noteId: 'note-1', path: target.destinationPath, markdown };
    if (command === 'pi_chat_read_note') {
      expect(result?.status).toBe('committed');
      expect(input).toEqual({ authorityId: 'authority', noteId: 'note-1' });
      return { markdown, citation: '[Note: New title](gneauxghts-source:renamed-source)', source: { sourceId: 'renamed-source', noteId: 'note-1', title: 'New title', readState: { kind: 'observed', contentHash: 'same-content', observedAtMillis: 1 } } };
    }
  });
  const owner = await bindPublicationDocumentOwner({
    async withAgentPublication(actual, effect) {
      expect(actual).toEqual(target);
      return effect({ assertMutationReady() {}, retainUntilSettled() {}, async captureCanonical() {}, async adopt(value) { adoption(value); return 'adopted'; } });
    }, async withAgentPublicationReconciliation(actual, effect) {
      expect(actual).toEqual(target);
      return effect({ assertMutationReady() {}, retainUntilSettled() {}, async captureCanonical() {}, async adopt(value) { adoption(value); return 'adopted'; } });
    }, releaseSettledAgentPublication() {}
  });
  closers.push(owner.close);
  const registry = createRegistry(); registry.install(publicationExtension()); registry.install(renameExtension(async () => 'authority'));
  const faux = fauxProvider(), models = createModels(); models.setProvider(faux.provider);
  const storage = new MemoryStorage(); storage.close = async () => {};
  async function open() {
    const harness = await Harness.open(storage, { registry, models, settings: { retry: { enabled: false }, compaction: { enabled: false } } }, context);
    harnesses.push(harness); return harness;
  }
  const harness = await open();
  const conversation = await harness.createConversation({ ownership: { kind: 'ownerless' }, agent: { model: { provider: 'faux', modelId: 'faux-1' } } }, context);
  let modelRequest = '';
  async function submit(input: unknown = args) {
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall('rename_note', input as Parameters<typeof fauxToolCall>[1], { id: 'rename' }), { stopReason: 'toolUse' }),
      request => { modelRequest = JSON.stringify(request); return fauxAssistantMessage('Rename result received.'); }
    ]);
    return conversation.submit({ type: 'input', content: 'Rename the note to New title.' }, context);
  }
  const reviews = async (source = harness) => Object.values((await source.snapshot(EditReviewDoc, conversation.id, context))?.items ?? {});
  async function pending(source = harness) {
    await vi.waitFor(async () => expect(await reviews(source)).toHaveLength(1));
    return (await reviews(source))[0];
  }
  return { harness, conversation, storage, open, submit, pending, reviews, adoption, markdown, modelRequest: () => modelRequest };
}

it('reviews both exact paths, delegates to the publication child and returns a new canonical citation', async () => {
  const f = await fixture(), submitted = await f.submit(), review = await f.pending();
  expect(review).toEqual({ taskId: expect.any(Number), title: 'New title', decision: 'pending', kind: 'rename', sourcePath: 'Projects/Old.md', destinationPath: 'Projects/New title.md' });
  const child = await f.harness.getTask(review.taskId as TaskId, context);
  expect(child?.input).toEqual({ effect: 'rename', authorityId: 'authority', intentId: 'intent', target, review: { payloadHash: 'rename-hash' } });
  expect(native.invoke.mock.calls.some(([command]) => command === 'pi_chat_publish_mutation')).toBe(false);
  await decideEditReview(f.harness, f.conversation.id, review.taskId, 'approved');
  expect((await submitted.wait(context)).status).toBe('done');
  expect(f.adoption).toHaveBeenCalledWith({ status: 'committed', receiptId: 'receipt', noteId: 'note-1', path: target.destinationPath, markdown: f.markdown });
  expect(f.modelRequest()).toContain('renamed-source');
  expect(f.modelRequest()).toContain('Unchanged body');
  expect(await f.reviews()).toEqual([]);
  expect(native.invoke.mock.calls.filter(([command]) => command === 'pi_chat_publish_mutation')).toHaveLength(1);
  expect(native.invoke.mock.calls.some(([command]) => command === 'pi_chat_read_mutation_base')).toBe(false);
});

it('reuses durable validated arguments and the stable request across reopening before child creation', async () => {
  const f = await fixture(), prepared = Promise.withResolvers<void>(), acknowledged = Promise.withResolvers<void>();
  const handler = native.invoke.getMockImplementation()!;
  native.invoke.mockImplementation(async (command, input) => {
    const result = await handler(command, input);
    if (command === 'pi_chat_prepare_mutation') { prepared.resolve(); await acknowledged.promise; }
    return result;
  });
  try {
    await f.submit(); await prepared.promise;
    const tool = (await f.storage.scanTasks({ conversationId: f.conversation.id, kind: 'pi.tool' }, 100, undefined, context)).items[0];
    expect(tool.state).toMatchObject({ checkpoint: { arguments: args } });
    expect(tool.memos?.candidate).toBeUndefined();
    const closing = f.harness.close(context);
    await new Promise<void>(resolve => setImmediate(resolve));
    acknowledged.resolve(); await closing;
    const reopened = await f.open(); reopened.resume();
    const review = await f.pending(reopened);
    const requests = native.invoke.mock.calls.filter(([command]) => command === 'pi_chat_prepare_mutation');
    expect(requests).toHaveLength(2); expect(requests[1][1]).toEqual(requests[0][1]);
    await decideEditReview(reopened, f.conversation.id, review.taskId, 'approved');
    await vi.waitFor(() => expect(f.modelRequest()).toContain('receipt'));
    expect(native.invoke.mock.calls.filter(([command]) => command === 'pi_chat_publish_mutation')).toHaveLength(1);
  } finally { acknowledged.resolve(); }
});

it('preserves pending rename review after reopening without preparing a second intent', async () => {
  const f = await fixture(); await f.submit(); const before = await f.pending();
  await f.harness.close(context); const reopened = await f.open(); reopened.resume();
  const review = await f.pending(reopened); expect(review).toEqual(before);
  await decideEditReview(reopened, f.conversation.id, review.taskId, 'rejected');
  await vi.waitFor(() => expect(f.modelRequest()).toContain('review_rejected'));
  expect(native.invoke.mock.calls.filter(([command]) => command === 'pi_chat_prepare_mutation')).toHaveLength(1);
  expect(native.invoke.mock.calls.some(([command]) => command === 'pi_chat_publish_mutation')).toBe(false);
});

it.each(['operation_denied', 'target_exists', 'changed_base'])('retains native %s refusal without claiming a rename', async code => {
  const f = await fixture();
  native.invoke.mockImplementation(async command => { if (command === 'pi_chat_prepare_mutation') throw { code, message: 'Native rename refused.' }; });
  await (await f.submit()).wait(context);
  expect(f.modelRequest()).toContain(code);
  expect(await f.reviews()).toEqual([]);
  expect(f.adoption).not.toHaveBeenCalled();
  expect(native.invoke.mock.calls.some(([command]) => command === 'pi_chat_publish_mutation')).toBe(false);
});

it('preserves a committed rename if the fresh canonical read is denied', async () => {
  const f = await fixture(), handler = native.invoke.getMockImplementation()!;
  native.invoke.mockImplementation((command, input) => {
    if (command === 'pi_chat_read_note') throw { code: 'unavailable_note', message: 'Read access ended.' };
    return handler(command, input);
  });
  const submitted = await f.submit(), review = await f.pending();
  await decideEditReview(f.harness, f.conversation.id, review.taskId, 'approved');
  await submitted.wait(context);
  expect(f.modelRequest()).toContain('rename committed');
  expect(f.modelRequest()).toContain('renamed note could not be read');
  expect(f.modelRequest()).toContain('receipt');
  expect(native.invoke.mock.calls.filter(([command]) => command === 'pi_chat_publish_mutation')).toHaveLength(1);
});

it('rejects arbitrary path arguments before native preparation', async () => {
  const f = await fixture();
  await (await f.submit({ ...args, path: '/vault/Elsewhere.md' })).wait(context);
  expect(native.invoke.mock.calls.some(([command]) => command === 'pi_chat_prepare_mutation')).toBe(false);
  expect(f.adoption).not.toHaveBeenCalled();
});

it('shows committed rename warnings with the correct action wording', async () => {
  const f = await fixture(), handler = native.invoke.getMockImplementation()!;
  native.invoke.mockImplementation(async (command, input) => {
    const result = await handler(command, input);
    return command === 'pi_chat_publish_mutation' ? { ...result, commitWarning: { message: 'Search projection requires repair.', issues: [] } } : result;
  });
  const submitted = await f.submit(), review = await f.pending();
  await decideEditReview(f.harness, f.conversation.id, review.taskId, 'approved');
  await submitted.wait(context);
  const activity = activityTranscript((await f.conversation.context(context)).entries, {}).find(item => item.kind === 'activity')!;
  if (activity.kind !== 'activity') throw new Error('Expected rename activity.');
  const body = render(PiActivityGroup, { props: { group: activity } }).body;
  expect(body).toContain('Note renamed. Search projection requires repair.');
  expect(body).not.toContain('failed');
});

it('returns committed truth and an editor-adoption warning without repeating the rename', async () => {
  const f = await fixture();
  f.adoption.mockImplementation(() => { throw new Error('Editor refresh is temporarily unavailable.'); });
  const submitted = await f.submit(), review = await f.pending();
  await decideEditReview(f.harness, f.conversation.id, review.taskId, 'approved');
  expect((await submitted.wait(context)).status).toBe('done');
  expect(f.modelRequest()).toContain('committed');
  expect(f.modelRequest()).toContain('editorAdoption');
  expect(f.modelRequest()).toContain('Editor refresh is temporarily unavailable.');
  const tool = (await f.conversation.context(context)).entries.flatMap(entry => entry.model ?? []).find(message => message.role === 'toolResult');
  expect(tool).toBeDefined();
  expect(tool).toMatchObject({ isError: false });
  expect(native.invoke.mock.calls.filter(([command]) => command === 'pi_chat_publish_mutation')).toHaveLength(1);
});
