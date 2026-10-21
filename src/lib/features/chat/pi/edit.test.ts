import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Harness, MemoryStorage, createRegistry, type TaskId } from '@earendil-works/pi-durable';
import { createModels } from '@earendil-works/pi-ai';
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { editExtension } from './edit';
import { EditReviewDoc, bindPublicationDocumentOwner, decideEditReview, publicationExtension, type PublicationResult } from './publication';
import { render } from 'svelte/server';
import { activityTranscript, toolFailed, toolStatus, type ToolActivity } from '../ui/piActivity';
import PiActivityGroup from '../ui/PiActivityGroup.svelte';
import { DocumentPublicationBlocked } from '#lib/features/notepad/document/documentPublicationAdmission.js';
import { ChatDoc, initializeChatDocuments, type PiChat } from './runtime';
import { createPiConversationView } from '../ui/piConversationView';
import { fixtureSettings } from '../ui/piViewTestSupport';
import { createPiDiagnostics } from './diagnostics';
import ChatPanel from '../ChatPanel.svelte';

const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }));
const harnesses: Harness[] = [];
const closers: Array<() => Promise<void>> = [];
beforeEach(() => native.invoke.mockReset());
afterEach(async () => {
  for (const harness of harnesses.splice(0)) await harness.close(context);
  for (const close of closers.splice(0)) await close();
});

async function fixture({ review = true, original = 'Alpha\n', dirty = false, create = false } = {}) {
  let canonical = original;
  let prepared: { markdown: string } | undefined;
  let result: PublicationResult | undefined;
  const adoption = vi.fn();
  const target = { noteId: 'note-1', path: '/vault/Note.md' };
  native.invoke.mockImplementation(async (command: string, args: Record<string, unknown> = {}) => {
    if (command === 'pi_chat_read_mutation_base') {
      expect(args).toEqual({ authorityId: 'authority', noteId: 'note-1', expectedReadSourceId: 'source-1' });
      return { markdown: canonical, source: { title: 'A note' } };
    }
    if (command === 'pi_chat_read_note') {
      expect(args).toEqual({ authorityId: 'authority', noteId: 'note-1' });
      expect(result?.status).toBe('committed');
      return { markdown: canonical, citation: '[Note: A note](gneauxghts-source:post-edit-source)', source: { sourceId: 'post-edit-source', noteId: 'note-1', title: 'A note', readState: { kind: 'observed', contentHash: 'post-edit-hash', observedAtMillis: 1 } } };
    }
    if (command === 'pi_chat_prepare_mutation') {
      const mutation = args.mutation as { markdown: string };
      if (prepared) expect(mutation.markdown).toBe(prepared.markdown);
      prepared = mutation;
      return { intentId: 'intent', payloadHash: 'hash', reviewRequired: review, target, ...(create ? { creation: { destination: 'Note.md', markdown: mutation.markdown } } : {}) };
    }
    if (command === 'pi_chat_approve_mutation') expect(args).toEqual({ authorityId: 'authority', intentId: 'intent', payloadHash: 'hash' });
    if (command === 'pi_chat_reconcile_mutation') return result ?? { status: 'unpublished' };
    if (command === 'pi_chat_bind_editor_owner') return 'owner';
    if (command === 'pi_chat_admit_editor_publication') return 'admission';
    if (command === 'pi_chat_publish_mutation') {
      if (canonical !== original) return result = { status: 'blocked', code: 'changed_base', message: 'The note changed.' };
      canonical = prepared!.markdown;
      return result = { status: 'committed', receiptId: 'receipt', ...target, markdown: canonical };
    }
  });
  const owner = await bindPublicationDocumentOwner({
    async withAgentPublication(_target, effect) {
      if (dirty) throw new DocumentPublicationBlocked('Save or discard the open note before applying this edit.');
      return effect({ retainUntilSettled() {}, async captureCanonical() {}, async adopt(value) { adoption(value); return 'adopted'; } });
    }, releaseSettledAgentPublication() {}
  });
  closers.push(owner.close);
  const registry = createRegistry(); registry.install(publicationExtension()); registry.install(editExtension(async () => 'authority'));
  const faux = fauxProvider(); const models = createModels(); models.setProvider(faux.provider);
  const storage = new MemoryStorage(); storage.close = async () => {};
  async function open() {
    const harness = await Harness.open(storage, { registry, models, conversationCreated: initializeChatDocuments, settings: { retry: { enabled: false }, compaction: { enabled: false } } }, context);
    harnesses.push(harness); return harness;
  }
  const harness = await open();
  const conversation = await harness.createConversation({ ownership: { kind: 'ownerless' }, agent: { model: { provider: 'faux', modelId: 'faux-1' } }, init: async (tx, id) => { (await tx.doc(ChatDoc, id)).authorityId = 'authority'; } }, context);
  const reviews = async (source = harness) => Object.values((await source.snapshot(EditReviewDoc, conversation.id, context))?.items ?? {});
  const pending = async (source = harness) => {
    await vi.waitFor(async () => expect(await reviews(source)).toHaveLength(1));
    return (await reviews(source))[0];
  };
  let modelResult = '';
  async function submitArguments(args: unknown) {
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall(create ? 'create_note' : 'edit_note', args as Parameters<typeof fauxToolCall>[1], { id: 'edit' }), { stopReason: 'toolUse' }),
      request => { modelResult = JSON.stringify(request); return fauxAssistantMessage('Edit result received.'); }
    ]);
    return conversation.submit({ type: 'input', content: 'Change Alpha to Beta in the note.' }, context);
  }
  const submit = (edits = [{ oldText: 'Alpha', newText: 'Beta' }]) => submitArguments({ noteId: 'note-1', expectedReadSourceId: 'source-1', edits });
  const presenter = (source = harness) => createPiConversationView({
    open: async () => ({ harness: source, storage, models, diagnostics: createPiDiagnostics(), listConversations: async () => ({ items: [] }), authorityForConversation: async () => ({ authorityId: 'authority', revision: 1, retired: false, read: { mode: 'fullVault', attachedNoteIds: [] }, write: { grant: { duration: 'off' }, reviewBeforeApplying: true } }) } as unknown as PiChat),
    settings: async () => fixtureSettings, observeAuthority: async () => () => {}
  });
  return { harness, conversation, storage, open, presenter, submitArguments, submit, pending, reviews, adoption, canonical: () => canonical, externalChange: () => { canonical += 'New human text\n'; }, modelResult: () => modelResult };
}

it.each([false, true])('replays the same prepared request after restart before the child handoff (create=%s)', async create => {
  const f = await fixture({ create, original: create ? '' : 'Alpha\n' });
  const prepared = Promise.withResolvers<void>(), acknowledged = Promise.withResolvers<void>();
  const handler = native.invoke.getMockImplementation()!;
  native.invoke.mockImplementation(async (command, args) => {
    const result = await handler(command, args);
    if (command === 'pi_chat_prepare_mutation') { prepared.resolve(); await acknowledged.promise; }
    return result;
  });
  try {
    await (create ? f.submitArguments({ title: 'A note', markdown: 'Beta\n' }) : f.submit());
    await prepared.promise;
    const tool = (await f.storage.scanTasks({ conversationId: f.conversation.id, kind: 'pi.tool' }, 100, undefined, context)).items[0];
    // Creation is already durable in Pi's execution checkpoint; only the
    // computed edit needs a separate memo before native preparation.
    expect(tool.memos?.candidate !== undefined).toBe(!create);
    if (create) expect(tool.state).toMatchObject({ checkpoint: { arguments: { title: 'A note', markdown: 'Beta\n' } } });
    expect(await f.reviews()).toEqual([]);
    const closing = f.harness.close(context);
    await new Promise<void>(resolve => setImmediate(resolve));
    acknowledged.resolve(); await closing;
    const reopened = await f.open(); reopened.resume();
    const review = await f.pending(reopened);
    expect(review.kind).toBe(create ? 'create' : 'edit');
    const requests = native.invoke.mock.calls.filter(([command]) => command === 'pi_chat_prepare_mutation');
    expect(requests).toHaveLength(2);
    expect(requests[1][1]).toEqual(requests[0][1]);
    expect(native.invoke.mock.calls.filter(([command]) => command === 'pi_chat_read_mutation_base')).toHaveLength(create ? 0 : 1);
    await decideEditReview(reopened, f.conversation.id, review.taskId, 'approved');
    await vi.waitFor(() => expect(f.modelResult()).toContain('receipt'));
    expect(f.canonical()).toBe('Beta\n');
    expect(native.invoke.mock.calls.filter(([command]) => command === 'pi_chat_publish_mutation')).toHaveLength(1);
  } finally { acknowledged.resolve(); }
});

it.each([{ repairWarning: false, create: false }, { repairWarning: true, create: false }, { repairWarning: false, create: true }, { repairWarning: true, create: true }])('shows a confirmed publication when Stop follows native commit, including after reopening: %j', async ({ repairWarning, create }) => {
  const f = await fixture({ create }), binding = f.presenter();
  const published = Promise.withResolvers<void>(), acknowledged = Promise.withResolvers<void>();
  const handler = native.invoke.getMockImplementation()!;
  native.invoke.mockImplementation(async (command, args) => {
    const result = await handler(command, args);
    if (command === 'pi_chat_publish_mutation') {
      published.resolve(); await acknowledged.promise;
    }
    return repairWarning && result?.status === 'committed'
      ? { ...result, commitWarning: { message: 'Task projection requires repair.', issues: [{ stage: 'taskProjectionUpsert', message: 'Projection unavailable.' }] } }
      : result;
  });
  try {
    await binding.initialize(String(f.conversation.id));
    expect(binding.getSnapshot().conversation?.id).toBe(f.conversation.id);
    await (create ? f.submitArguments({ title: 'A note', markdown: 'Beta\n' }) : f.submit()); const review = await f.pending();
    await decideEditReview(f.harness, f.conversation.id, review.taskId, 'approved');
    await published.promise;
    const stopping = binding.stop();
    await new Promise<void>(resolve => setImmediate(resolve));
    acknowledged.resolve(); await stopping;
    const assertApplied = async (view: typeof binding) => {
      await vi.waitFor(() => {
        const body = render(ChatPanel, { props: { binding: view, autoInitialize: false } }).body;
        expect(body).toContain(create ? 'Note created before the response stopped.' : 'Edit applied before the response stopped.');
        if (repairWarning) expect(body).toContain(`${create ? 'Note created.' : 'Edit saved.'} Task projection requires repair.`);
        expect(body).not.toContain('1 failed');
      });
    };
    await assertApplied(binding);
    binding.dispose(); await f.harness.close(context);
    const restarted = await f.open(), reopened = f.presenter(restarted);
    try { await reopened.initialize(String(f.conversation.id)); await assertApplied(reopened); }
    finally { reopened.dispose(); }
    expect(f.canonical()).toBe('Beta\n');
    expect(native.invoke.mock.calls.filter(([command]) => command === 'pi_chat_publish_mutation')).toHaveLength(1);
    expect(f.modelResult()).toBe('');
    expect((await restarted.getTask(review.taskId as TaskId, context))?.state.outcome).toMatchObject({ status: 'completed', result: { status: 'committed' } });
  } finally { acknowledged.resolve(); binding.dispose(); }
});

it('preserves a committed repair warning in the model result and visible chat history', async () => {
  const f = await fixture({ review: false });
  const warning = { message: 'Task projection requires repair.', issues: [{ stage: 'taskProjectionUpsert', message: 'Projection unavailable.' }] };
  const handler = native.invoke.getMockImplementation()!;
  native.invoke.mockImplementation(async (command, args) => {
    const result = await handler(command, args);
    return command === 'pi_chat_publish_mutation' ? { ...result, commitWarning: warning } : result;
  });
  await (await f.submit()).wait(context);
  expect(f.canonical()).toBe('Beta\n');
  expect(f.modelResult()).toContain(warning.message);
  const activity = activityTranscript((await f.conversation.context(context)).entries, {}).find(item => item.kind === 'activity')!;
  if (activity.kind !== 'activity') throw new Error('Expected tool activity.');
  const body = render(PiActivityGroup, { props: { group: activity } }).body;
  expect(body).toContain('data-testid="pi-edit-warning"');
  expect(body).toContain(warning.message);
  expect(body).not.toContain('1 failed');
  expect(native.invoke.mock.calls.filter(([command]) => command === 'pi_chat_publish_mutation')).toHaveLength(1);
});

it('does not restore edit feedback from a selection replaced during retained-result loading', async () => {
  const f = await fixture({ review: false });
  await (await f.submit()).wait(context);
  const binding = f.presenter(), started = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const scan = f.storage.scanTasks.bind(f.storage);
  vi.spyOn(f.storage, 'scanTasks').mockImplementationOnce(async (...args) => {
    const page = await scan(...args); started.resolve(); await release.promise; return page;
  });
  try {
    const selecting = binding.initialize(String(f.conversation.id));
    await started.promise; await binding.startNew(); release.resolve(); await selecting;
    expect(binding.getSnapshot().conversation).toBeNull();
    expect(binding.getSnapshot().editOutcomes).toEqual({});
    expect(binding.getSnapshot().entries).toEqual([]);
  } finally { release.resolve(); binding.dispose(); }
});

async function expectNeutralEditActivity(f: Awaited<ReturnType<typeof fixture>>, status: string) {
  const entries = (await f.conversation.context(context)).entries;
  const activity = activityTranscript(entries, {}).find(item => item.kind === 'activity');
  if (activity?.kind !== 'activity') throw new Error('Expected edit activity.');
  const tool = activity.items.find((item): item is ToolActivity => item.kind === 'tool' && item.name === 'edit_note')!;
  expect(toolStatus(tool)).toBe(status);
  expect(toolFailed(tool)).toBe(false);
  const body = render(PiActivityGroup, { props: { group: activity } }).body;
  expect(body).toContain(status);
  expect(body).not.toMatch(/class="activity-failure/);
  expect(body).not.toContain('>Failed</span>');
  expect(body).not.toContain('data-testid="pi-edit-applied"');
  expect(body).not.toContain('data-status="error"');
}

describe('Pi model note editing', () => {
  it('stages the public edit diff, waits for exact approval, and publishes one native receipt', async () => {
    const f = await fixture(); const submission = await f.submit(); const review = await f.pending();
    if (review.kind !== 'edit') throw new Error('Expected an edit review.');
    expect(review.patch).toContain('-Alpha'); expect(review.patch).toContain('+Beta');
    const task = await f.harness.getTask(review.taskId as TaskId, context);
    expect(task!.input).toMatchObject({ review: { payloadHash: 'hash' } });
    expect(JSON.stringify(task!.input)).not.toContain('patch');
    expect(JSON.stringify(task!.state.checkpoint)).not.toContain('patch');
    expect(f.canonical()).toBe('Alpha\n');
    expect(native.invoke.mock.calls.some(([command]) => command === 'pi_chat_publish_mutation')).toBe(false);
    expect(native.invoke.mock.calls.some(([command]) => command === 'pi_chat_read_note')).toBe(false);
    await decideEditReview(f.harness, f.conversation.id, review.taskId, 'approved');
    expect((await submission.wait(context)).status).toBe('done');
    expect(f.canonical()).toBe('Beta\n'); expect(f.adoption).toHaveBeenCalledOnce();
    expect(f.modelResult()).toContain('receipt'); expect(await f.reviews()).toHaveLength(0);
    const tool = (await f.conversation.context(context)).entries.flatMap(entry => entry.model ?? []).find(message => message.role === 'toolResult' && message.toolName === 'edit_note');
    if (tool?.role !== 'toolResult') throw new Error('Expected an edit tool result.');
    const value = JSON.parse(tool.content.filter(block => block.type === 'text').map(block => block.text).join(''));
    expect(value).toMatchObject({ status: 'committed', receiptId: 'receipt', read: { markdown: 'Beta\n', citation: '[Note: A note](gneauxghts-source:post-edit-source)', source: { sourceId: 'post-edit-source' } } });
    expect(value.read.source).not.toHaveProperty('readState');
    expect(tool.details).toMatchObject({ source: { sourceId: 'post-edit-source', readState: { contentHash: 'post-edit-hash' } } });
    expect(JSON.stringify(await f.harness.getTask(review.taskId as TaskId, context))).not.toContain('patch');
  });
  it('preserves the proven commit if the post-edit canonical read becomes unavailable', async () => {
    const f = await fixture({ review: false });
    const handler = native.invoke.getMockImplementation()!;
    native.invoke.mockImplementation((command, args) => {
      if (command === 'pi_chat_read_note') throw { code: 'unavailable_note', message: 'Note access was revoked.' };
      return handler(command, args);
    });
    await (await f.submit()).wait(context);
    expect(f.canonical()).toBe('Beta\n');
    const tool = (await f.conversation.context(context)).entries.flatMap(entry => entry.model ?? []).find(message => message.role === 'toolResult' && message.toolName === 'edit_note');
    if (tool?.role !== 'toolResult') throw new Error('Expected an edit tool result.');
    expect(tool.isError).toBe(false);
    const value = JSON.parse(tool.content.filter(block => block.type === 'text').map(block => block.text).join(''));
    expect(value).toMatchObject({ status: 'committed', receiptId: 'receipt', readError: expect.stringContaining('updated note could not be read') });
    expect(value.read).toBeUndefined();
    expect(native.invoke.mock.calls.filter(([command]) => command === 'pi_chat_publish_mutation')).toHaveLength(1);
  });
  it('discards a reviewed edit without native publication', async () => {
    const f = await fixture(); const submission = await f.submit(); const review = await f.pending();
    await decideEditReview(f.harness, f.conversation.id, review.taskId, 'rejected'); await submission.wait(context);
    expect(f.canonical()).toBe('Alpha\n'); expect(f.modelResult()).toContain('review_rejected');
    expect(native.invoke.mock.calls.some(([command]) => command === 'pi_chat_publish_mutation')).toBe(false);
    await expectNeutralEditActivity(f, 'Rejected');
  });
  it('stops pending review, rejects later approval, and never publishes', async () => {
    const f = await fixture(); await f.submit(); const review = await f.pending();
    await f.conversation.abort(context, { background: true });
    expect(await f.reviews()).toHaveLength(0);
    await expect(decideEditReview(f.harness, f.conversation.id, review.taskId, 'approved')).rejects.toThrow('no longer');
    expect(f.canonical()).toBe('Alpha\n');
    expect(native.invoke.mock.calls.some(([command]) => command === 'pi_chat_publish_mutation')).toBe(false);
    await expectNeutralEditActivity(f, 'Stopped');
  });
  it('recovers the same pending review after Harness close/reopen without recomputing the edit', async () => {
    const f = await fixture(); await f.submit(); const review = await f.pending();
    await f.harness.close(context);
    const restarted = await f.open(); restarted.resume();
    expect(await f.pending(restarted)).toEqual(review);
    await decideEditReview(restarted, f.conversation.id, review.taskId, 'approved');
    await restarted.waitForTask(review.taskId as TaskId, context);
    await vi.waitFor(() => expect(f.modelResult()).toContain('receipt'));
    expect(f.modelResult()).toContain('[Note: A note](gneauxghts-source:post-edit-source)');
    expect(f.canonical()).toBe('Beta\n');
    expect(native.invoke.mock.calls.filter(([command]) => command === 'pi_chat_read_mutation_base')).toHaveLength(1);
    expect(native.invoke.mock.calls.filter(([command]) => command === 'pi_chat_publish_mutation')).toHaveLength(1);
  });
  it('reconciles a native commit whose Pi result was interrupted by Harness close', async () => {
    const f = await fixture({ review: false });
    const acknowledged = Promise.withResolvers<void>();
    const published = Promise.withResolvers<void>();
    const handler = native.invoke.getMockImplementation()!;
    native.invoke.mockImplementation(async (command, args) => {
      const result = await handler(command, args);
      if (command === 'pi_chat_publish_mutation') { published.resolve(); await acknowledged.promise; }
      return result;
    });
    await f.submit(); await published.promise;
    expect(f.canonical()).toBe('Beta\n');
    const closing = f.harness.close(context);
    await new Promise<void>(resolve => setImmediate(resolve));
    acknowledged.resolve(); await closing;
    const restarted = await f.open(); restarted.resume();
    await vi.waitFor(() => expect(f.modelResult()).toContain('receipt'));
    expect(f.modelResult()).toContain('[Note: A note](gneauxghts-source:post-edit-source)');
    expect(native.invoke.mock.calls.filter(([command]) => command === 'pi_chat_publish_mutation')).toHaveLength(1);
    expect(native.invoke.mock.calls.filter(([command]) => command === 'pi_chat_read_mutation_base')).toHaveLength(1);
    expect(f.canonical()).toBe('Beta\n');
  });
  it('honors explicit direct-write mode, preserving BOM and CRLF through upstream editing', async () => {
    const f = await fixture({ review: false, original: '\ufeffAlpha\r\n' }); await (await f.submit()).wait(context);
    expect(f.canonical()).toBe('\ufeffBeta\r\n'); expect(await f.reviews()).toHaveLength(0);
    expect(native.invoke.mock.calls.some(([command]) => command === 'pi_chat_approve_mutation')).toBe(false);
  });
  it.each([
    { edits: JSON.stringify([{ oldText: 'Alpha', newText: 'Beta' }]) },
    { edits: { oldText: 'Alpha', newText: 'Beta' } },
    { oldText: 'Alpha', newText: 'Beta' }
  ])('uses Pi argument repair for %j', async shape => {
    const f = await fixture({ review: false });
    await (await f.submitArguments({ noteId: 'note-1', expectedReadSourceId: 'source-1', ...shape })).wait(context);
    expect(f.canonical()).toBe('Beta\n'); expect(f.modelResult()).toContain('receipt');
  });

  it('keeps receipt-adoption conflicts visible after the effect has started', async () => {
    const f = await fixture({ review: false });
    f.adoption.mockImplementation(() => { throw new DocumentPublicationBlocked('Receipt adoption was interrupted.'); });
    await (await f.submit()).wait(context);
    expect(f.canonical()).toBe('Beta\n'); // A neutral pre-publication block would be incorrect here.
    const activity = activityTranscript((await f.conversation.context(context)).entries, {}).find(item => item.kind === 'activity')!;
    if (activity.kind !== 'activity') throw new Error('Expected tool activity.');
    const tool = activity.items.find((item): item is ToolActivity => item.kind === 'tool')!;
    expect(toolStatus(tool)).toBe('Failed');
    expect(toolFailed(tool)).toBe(true);
    expect(render(PiActivityGroup, { props: { group: activity } }).body).toContain('1 failed');
  });
  it.each([
    { expectedReadSourceId: 'source-1' },
    { noteId: 'note-1' },
    { noteId: '', expectedReadSourceId: 'source-1' },
    { noteId: 42, expectedReadSourceId: 'source-1' },
    { noteId: 'note-1', expectedReadSourceId: 'source-1', path: '/other.md' }
  ])('rejects invalid domain arguments after preparation: %j', async identifiers => {
    const f = await fixture({ review: false });
    await (await f.submitArguments({ ...identifiers, edits: { oldText: 'Alpha', newText: 'Beta' } })).wait(context);
    expect(f.canonical()).toBe('Alpha\n');
    expect(native.invoke.mock.calls.some(([command]) => command === 'pi_chat_read_mutation_base' || command === 'pi_chat_prepare_mutation')).toBe(false);
  });
  it('rejects ambiguous replacements before native prepare', async () => {
    const f = await fixture({ original: 'Alpha\nAlpha\n' }); await (await f.submit()).wait(context);
    expect(f.canonical()).toBe('Alpha\nAlpha\n'); expect(f.modelResult()).toContain('occurrences');
    expect(native.invoke.mock.calls.some(([command]) => command === 'pi_chat_prepare_mutation')).toBe(false);
  });
  it('preserves a newer canonical note after review', async () => {
    const f = await fixture(); const submission = await f.submit(); const review = await f.pending();
    f.externalChange(); await decideEditReview(f.harness, f.conversation.id, review.taskId, 'approved'); await submission.wait(context);
    expect(f.canonical()).toBe('Alpha\nNew human text\n'); expect(f.modelResult()).toContain('changed_base'); expect(f.adoption).not.toHaveBeenCalled();
    await expectNeutralEditActivity(f, 'Note changed');
  });
  it.each(['pi_chat_read_mutation_base', 'pi_chat_prepare_mutation'])('shows a note change before review neutrally when %s blocks the edit', async command => {
    const f = await fixture();
    const handler = native.invoke.getMockImplementation()!;
    native.invoke.mockImplementation((name, args) => {
      if (name === command) throw { code: 'changed_base', message: 'The note changed. Read it again before editing.' };
      return handler(name, args);
    });
    await (await f.submit()).wait(context);
    expect(f.modelResult()).toContain('changed_base');
    expect(f.canonical()).toBe('Alpha\n');
    expect(await f.reviews()).toHaveLength(0);
    expect(native.invoke.mock.calls.some(([name]) => name === 'pi_chat_publish_mutation')).toBe(false);
    await expectNeutralEditActivity(f, 'Note changed');
  });
  it('does not publish when the open editor is dirty', async () => {
    const f = await fixture({ review: false, dirty: true }); await (await f.submit()).wait(context);
    expect(f.canonical()).toBe('Alpha\n');
    expect(native.invoke.mock.calls.some(([command]) => command === 'pi_chat_publish_mutation')).toBe(false);
    await expectNeutralEditActivity(f, 'Editor busy');
  });
  it('cleans review when retirement prevents native rejection', async () => {
    const f = await fixture(); await f.submit(); const review = await f.pending();
    const handler = native.invoke.getMockImplementation()!;
    native.invoke.mockImplementation(async (command, args) => {
      if (command === 'pi_chat_reject_mutation') throw { code: 'retired_authority', message: 'Access retired.' };
      return handler(command, args);
    });
    await f.conversation.abort(context, { background: true });
    expect(await f.reviews()).toHaveLength(0);
    expect((await f.harness.getTask(review.taskId as TaskId, context))?.state.outcome?.status).toBe('aborted');
    expect(f.canonical()).toBe('Alpha\n');
  });
  it.each(['approved', 'rejected'] as const)('removes review and returns native failures for %s decisions', async decision => {
    const f = await fixture(); const submission = await f.submit(); const review = await f.pending();
    const handler = native.invoke.getMockImplementation()!;
    native.invoke.mockImplementation(async (command, args) => {
      if (command === 'pi_chat_approve_mutation' || command === 'pi_chat_reject_mutation') throw { message: 'Native review failed.' };
      return handler(command, args);
    });
    await decideEditReview(f.harness, f.conversation.id, review.taskId, decision); await submission.wait(context);
    expect(await f.reviews()).toHaveLength(0); expect(f.modelResult()).toContain('Native review failed.'); expect(f.canonical()).toBe('Alpha\n');
  });
  it('returns native denied authority as a tool error without starting review', async () => {
    const f = await fixture(); const handler = native.invoke.getMockImplementation()!;
    native.invoke.mockImplementation(async (command, args) => {
      if (command === 'pi_chat_prepare_mutation') throw { code: 'write_off', message: 'Enable note editing first.' };
      return handler(command, args);
    });
    await (await f.submit()).wait(context);
    expect(f.modelResult()).toContain('Enable note editing'); expect(await f.reviews()).toHaveLength(0); expect(f.canonical()).toBe('Alpha\n');
    await expectNeutralEditActivity(f, 'Editing disabled');
  });

  it.each(['approved', 'rejected'] as const)('preserves access changes during %s review decisions', async decision => {
    const f = await fixture(); const submission = await f.submit(); const review = await f.pending();
    const handler = native.invoke.getMockImplementation()!;
    native.invoke.mockImplementation(async (command, args) => {
      if (command === 'pi_chat_approve_mutation' || command === 'pi_chat_reject_mutation') throw { code: 'retired_authority', message: 'Access retired.' };
      return handler(command, args);
    });
    await decideEditReview(f.harness, f.conversation.id, review.taskId, decision); await submission.wait(context);
    expect(await f.reviews()).toHaveLength(0);
    expect(f.canonical()).toBe('Alpha\n');
    expect(f.modelResult()).toContain('retired_authority');
    await expectNeutralEditActivity(f, 'Access ended');
  });

  it.each([
    ['pi_chat_admit_editor_publication', 'scope_denied', 'Permission needed'],
    ['pi_chat_publish_mutation', 'write_off', 'Editing disabled'],
    ['pi_chat_publish_mutation', 'uncertain_publication', 'Failed']
  ])('preserves %s code %s through the publication task', async (command, code, status) => {
    const f = await fixture({ review: false }); const handler = native.invoke.getMockImplementation()!;
    native.invoke.mockImplementation(async (name, args) => {
      if (name === command) throw { code, message: 'Native publication outcome.' };
      return handler(name, args);
    });
    await (await f.submit()).wait(context);
    expect(f.canonical()).toBe('Alpha\n');
    expect(f.modelResult()).toContain(code);
    if (status !== 'Failed') await expectNeutralEditActivity(f, status);
    else {
      const activity = activityTranscript((await f.conversation.context(context)).entries, {}).find(item => item.kind === 'activity')!;
      if (activity.kind !== 'activity') throw new Error('Expected tool activity.');
      expect(toolFailed(activity.items.find((item): item is ToolActivity => item.kind === 'tool')!)).toBe(true);
      expect(render(PiActivityGroup, { props: { group: activity } }).body).toContain('1 failed');
    }
  });
});


describe('create_note through the shared Pi publication flow', () => {
  it.each([{}, { folder: null }, { folder: '.' }, { folder: 'Projects' }])('reviews creation once and returns a read-backed citation with optional folder %j', async optional => {
    const f = await fixture({ create: true, original: '' });
    const run = await f.submitArguments({ title: 'A note', markdown: '# Plan\n', ...optional });
    const review = await f.pending();
    expect(review).toMatchObject({ kind: 'create', destination: 'Note.md', markdown: '# Plan\n' });
    expect(review).not.toHaveProperty('patch');
    expect(review).not.toHaveProperty('creation');
    expect(f.canonical()).toBe('');
    expect(native.invoke.mock.calls.some(([cmd]) => cmd === 'pi_chat_read_mutation_base')).toBe(false);
    await decideEditReview(f.harness, f.conversation.id, review.taskId, 'approved');
    await run.wait(context);
    expect(f.canonical()).toBe('# Plan\n');
    expect(f.modelResult()).toContain('gneauxghts-source:post-edit-source');
    expect(native.invoke.mock.calls.filter(([cmd]) => cmd === 'pi_chat_publish_mutation')).toHaveLength(1);
    const prepare = native.invoke.mock.calls.find(([cmd]) => cmd === 'pi_chat_prepare_mutation')!;
    expect(prepare[1].mutation).toEqual({ operation: 'create', title: 'A note', markdown: '# Plan\n', folder: optional.folder ?? '.' });
    expect(prepare[1].requestId).toMatch(/^pi-create:/);
  });
  it.each(['rejected', 'stopped'] as const)('does not create when the review is %s', async decision => {
    const f = await fixture({ create: true, original: '' });
    const run = await f.submitArguments({ title: 'A note', markdown: 'Content' });
    const pending = await f.pending();
    if (decision === 'rejected') await decideEditReview(f.harness, f.conversation.id, pending.taskId, 'rejected');
    else await f.conversation.abort(context, { background: true });
    await run.wait(context);
    expect(f.canonical()).toBe('');
    expect(native.invoke.mock.calls.some(([cmd]) => cmd === 'pi_chat_publish_mutation')).toBe(false);
    expect(await f.reviews()).toEqual([]);
  });
  it('reopens the same review and creates once after restarting Pi', async () => {
    const f = await fixture({ create: true, original: '' });
    await f.submitArguments({ title: 'A note', markdown: 'Once' });
    const pending = await f.pending();
    await f.harness.close(context);
    const reopened = await f.open(); reopened.resume();
    expect(await f.pending(reopened)).toEqual(pending);
    await decideEditReview(reopened, f.conversation.id, pending.taskId, 'approved');
    await vi.waitFor(() => expect(f.canonical()).toBe('Once'));
    await vi.waitFor(async () => expect(await f.reviews(reopened)).toEqual([]));
    expect(native.invoke.mock.calls.filter(([cmd]) => cmd === 'pi_chat_prepare_mutation')).toHaveLength(1);
    expect(native.invoke.mock.calls.filter(([cmd]) => cmd === 'pi_chat_publish_mutation')).toHaveLength(1);
  });
  it('retains creation success when independent read access is denied', async () => {
    const f = await fixture({ create: true, original: '', review: false });
    const handler = native.invoke.getMockImplementation()!;
    native.invoke.mockImplementation((cmd, args) => {
      if (cmd === 'pi_chat_read_note') throw { code: 'unavailable_note', message: 'Not attached.' };
      return handler(cmd, args);
    });
    await (await f.submitArguments({ title: 'A note', markdown: 'Once' })).wait(context);
    expect(f.canonical()).toBe('Once');
    expect(f.modelResult()).toContain('created note could not be read');
    expect(f.modelResult()).not.toContain('gneauxghts-source:');
    expect(native.invoke.mock.calls.filter(([cmd]) => cmd === 'pi_chat_publish_mutation')).toHaveLength(1);
  });
});
