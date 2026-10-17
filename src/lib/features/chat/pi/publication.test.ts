import { afterEach, describe, expect, it, vi } from 'vitest';
import { Harness, MemoryStorage, createRegistry } from '@earendil-works/pi-durable';
import { createModels } from '@earendil-works/pi-ai';
import { fauxProvider } from '@earendil-works/pi-ai/providers/faux';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import type { invoke } from '@tauri-apps/api/core';
import { bindPublicationDocumentOwner, mountPublicationDocumentOwner, publishPreparedMutation, publicationExtension, PublicationTask, type PublicationResult } from './publication';
import { createDocumentEditingService } from '$lib/features/notepad/document/documentEditingService';
import { adoptCommittedDocument, createNoteDraftState, createNotepadState } from '$lib/features/notepad/state/noteStore';
import { getDocumentMarkdown, updateDocumentMarkdown } from '$lib/features/notepad/document/documentState';
import { documentRegistry } from '$lib/features/notepad/document/documentRegistry';
import type { NoteSession } from '$lib/features/notepad/model/types';

const original: NoteSession = { noteId: 'note-1', path: '/vault/Note.md', title: 'Note', markdown: 'Original', tags: [] };
const target = { noteId: original.noteId, path: original.path! };
const intent = { authorityId: 'authority-1', intentId: 'intent-1', target };
const committed: PublicationResult = { status: 'committed', receiptId: 'receipt-1', noteId: 'note-1', path: target.path, markdown: 'Published' };
const hostNative = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: hostNative.invoke }));
const harnesses: Harness[] = [];
const closers: Array<() => Promise<void>> = [];
function fixture() {
  let canonical = { ...original };
  const document = createNoteDraftState();
  const state = createNotepadState(document, '/vault');
  adoptCommittedDocument(state, document, original);
  const runtime = documentRegistry.ensure(document.handle);
  const root = runtime.ensureResources({ assetRootPath: null, storePastedImage: vi.fn() }).runtime;
  root.ensureMarkdown(original.markdown);
  const read = vi.fn(async () => canonical);
  const service = createDocumentEditingService({ state, isApplyingProgrammaticUpdate: () => false,
    isTitleEditing: () => false,
    resetPaneCommandAfterBodyInput: vi.fn(), clearRecentlyForgotten: vi.fn(), clearSelectedRelatedText: vi.fn(),
    scheduleAutosave: vi.fn(), scheduleSearch: vi.fn(), scheduleRelated: vi.fn(),
    readPublicationSession: read });
  let outcome: PublicationResult | undefined;
  const native = vi.fn(async (command: string): Promise<unknown> => {
    if (command === 'pi_chat_bind_editor_owner') return 'owner-1';
    if (command === 'pi_chat_admit_editor_publication') return 'admission-1';
    if (command === 'pi_chat_reconcile_mutation') return outcome ?? { status: 'unpublished' };
    if (command === 'pi_chat_publish_mutation') { canonical = { ...original, markdown: 'Published' }; return outcome = committed; }
  });
  const bind = async () => { const owner = await bindPublicationDocumentOwner(service, native as typeof invoke); closers.push(owner.close); return owner; };
  return { document, root, service, native, read, bind, setOutcome(value: PublicationResult) { outcome = value; }, publishCanonical() { canonical = { ...original, markdown: 'Published' }; } };
}
afterEach(async () => {
  await Promise.all(harnesses.splice(0).map(harness => harness.close(context)));
  for (const close of closers.splice(0)) await close();
  for (const runtime of [...documentRegistry.values()]) documentRegistry.dispose(runtime.documentHandle);
});

describe('publication task execution seam', () => {
  it('registers only a durable task and exposes no mutation model tool', () => {
    const extension = publicationExtension();
    expect(extension.tools).toBeUndefined();
    expect(extension.tasks?.map(task => task.definition.name)).toEqual(['gneauxghts.chat.publication']);
  });
  it('settles waiting and later publication attempts on bind failure, then supports a fresh successful owner', async () => {
    const f = fixture();
    const waiting = expect(publishPreparedMutation(intent)).rejects.toThrow('Native owner unavailable');
    f.native.mockRejectedValueOnce(new Error('Native owner unavailable'));
    await expect(f.bind()).rejects.toThrow('Native owner unavailable');
    await waiting;
    await expect(publishPreparedMutation(intent)).rejects.toThrow('Native owner unavailable');
    expect(f.native.mock.calls).toHaveLength(1);
    await f.bind();
    await expect(publishPreparedMutation(intent)).resolves.toEqual(committed);
  });
  it('rejects a duplicate mounted workspace without replacing the live owner', async () => {
    const f = fixture(); await f.bind();
    await expect(f.bind()).rejects.toThrow('already bound');
    expect(f.native.mock.calls.filter(([command]) => command === 'pi_chat_bind_editor_owner')).toHaveLength(1);
    await expect(publishPreparedMutation(intent)).resolves.toEqual(committed);
  });
  it('serializes same-turn workspace withdrawal, disposal and replacement mounting', async () => {
    const retired = fixture(), mounted = fixture();
    const first = mountPublicationDocumentOwner(retired.service, retired.native as typeof invoke);
    closers.push(first.close);
    await first.ready;
    const dispose = vi.fn();
    const closing = first.close(dispose);
    // Match Svelte cleanup/remount ordering: no Promise microtask between them.
    const second = mountPublicationDocumentOwner(mounted.service, mounted.native as typeof invoke);
    closers.push(second.close);
    await second.previousOwnerSettled;
    expect(dispose).toHaveBeenCalledOnce();
    await second.ready; await closing;
    await expect(publishPreparedMutation(intent)).resolves.toEqual(committed);
    expect(getDocumentMarkdown(mounted.document)).toBe('Published');
    expect(getDocumentMarkdown(retired.document)).toBe('Original');
  });
  it('withdraws a workspace with its initial native bind pending before admitting its replacement', async () => {
    const retired = fixture(), mounted = fixture(), binding = Promise.withResolvers<string>();
    retired.native.mockImplementationOnce(() => binding.promise);
    const first = mountPublicationDocumentOwner(retired.service, retired.native as typeof invoke);
    closers.push(first.close);
    await Promise.resolve();
    const closing = first.close();
    const second = mountPublicationDocumentOwner(mounted.service, mounted.native as typeof invoke);
    closers.push(second.close);
    await Promise.resolve(); await Promise.resolve();
    expect(mounted.native).not.toHaveBeenCalled();
    binding.resolve('owner-1');
    await closing; await second.ready;
    await expect(publishPreparedMutation(intent)).resolves.toEqual(committed);
    expect(getDocumentMarkdown(mounted.document)).toBe('Published');
  });
  it('allows ordinary workspace cleanup after its own publication binding fails', async () => {
    const retired = fixture();
    retired.native.mockRejectedValueOnce(new Error('Native owner unavailable'));
    const first = mountPublicationDocumentOwner(retired.service, retired.native as typeof invoke);
    closers.push(first.close);
    await expect(first.ready).rejects.toThrow('Native owner unavailable');
    const dispose = vi.fn();
    await first.close(dispose);
    expect(dispose).toHaveBeenCalledOnce();
    const mounted = fixture(), second = mountPublicationDocumentOwner(mounted.service, mounted.native as typeof invoke);
    closers.push(second.close);
    await second.ready;
    await expect(publishPreparedMutation(intent)).resolves.toEqual(committed);
  });
  it('hands publication to a remounted workspace only after the retired native owner settles', async () => {
    const retired = fixture(), owner = await retired.bind();
    const settlement = Promise.withResolvers<void>(), normal = retired.native.getMockImplementation()!;
    retired.native.mockImplementation(command => command === 'pi_chat_close_editor_owner' ? settlement.promise : normal(command));
    const closing = owner.close();
    const mounted = fixture();
    let rebound = false;
    const rebinding = mounted.bind().then(value => { rebound = true; return value; });
    await Promise.resolve(); await Promise.resolve();
    expect(rebound).toBe(false);
    expect(mounted.native).not.toHaveBeenCalled();
    settlement.resolve();
    await closing; await rebinding;
    await expect(publishPreparedMutation(intent)).resolves.toEqual(committed);
    expect(getDocumentMarkdown(mounted.document)).toBe('Published');
    expect(getDocumentMarkdown(retired.document)).toBe('Original');
  });
  it('does not hand ownership over when the retired native owner cannot confirm settlement', async () => {
    const retired = fixture(), owner = await retired.bind();
    const settlement = Promise.withResolvers<void>(), normal = retired.native.getMockImplementation()!;
    let failClose = true;
    retired.native.mockImplementation(command => command === 'pi_chat_close_editor_owner' && failClose ? settlement.promise : normal(command));
    const closing = expect(owner.close()).rejects.toThrow('Native settlement unavailable');
    const mounted = fixture();
    const rebinding = expect(mounted.bind()).rejects.toThrow('Native settlement unavailable');
    settlement.reject(new Error('Native settlement unavailable'));
    await closing; await rebinding;
    await expect(mounted.bind()).rejects.toThrow('did not finish closing');
    expect(mounted.native).not.toHaveBeenCalled();
    failClose = false;
    await owner.close();
    await mounted.bind();
    await expect(publishPreparedMutation(intent)).resolves.toEqual(committed);
  });
  it('reconciles an already committed fact before acquiring editor or making another effect', async () => {
    const f = fixture(); f.setOutcome(committed); await f.bind();
    await expect(publishPreparedMutation(intent)).resolves.toEqual(committed);
    expect(f.native.mock.calls.map(([command]) => command)).toEqual(['pi_chat_bind_editor_owner', 'pi_chat_reconcile_mutation']);
    expect(getDocumentMarkdown(f.document)).toBe('Original');
  });
  it('rejects a dirty owner before native effect admission', async () => {
    const f = fixture(); await f.bind(); updateDocumentMarkdown(f.document, 'Human draft');
    await expect(publishPreparedMutation(intent)).rejects.toThrow();
    expect(f.native.mock.calls.some(([command]) => command === 'pi_chat_admit_editor_publication')).toBe(false);
    expect(getDocumentMarkdown(f.document)).toBe('Human draft');
  });
  it('holds the actual owner while native publication is pending and adopts exact canonical readback', async () => {
    const f = fixture(); const pending = Promise.withResolvers<PublicationResult>(); await f.bind();
    f.native.mockImplementation(async command => {
      if (command === 'pi_chat_reconcile_mutation') return { status: 'unpublished' };
      if (command === 'pi_chat_admit_editor_publication') return 'admission-1';
      if (command === 'pi_chat_publish_mutation') return pending.promise;
    });
    const publishing = publishPreparedMutation(intent);
    await vi.waitFor(() => expect(f.native).toHaveBeenCalledWith('pi_chat_publish_mutation', { authorityId: 'authority-1', intentId: 'intent-1' }));
    expect(f.service.isAgentPublicationActive()).toBe(true);
    expect(() => updateDocumentMarkdown(f.document, 'Concurrent edit')).toThrow();
    f.publishCanonical(); pending.resolve(committed);
    await expect(publishing).resolves.toEqual(committed);
    expect(getDocumentMarkdown(f.document)).toBe('Published');expect(f.root.markdown).toBe('Published');
    expect(f.service.isAgentPublicationActive()).toBe(false);
  });
  it('joins effect settlement then recovers a lost acknowledgement without duplicate publication', async () => {
    const f = fixture(); await f.bind(); const normal = f.native.getMockImplementation()!;
    f.native.mockImplementation(async command => {
      if (command === 'pi_chat_publish_mutation') { f.publishCanonical(); f.setOutcome(committed); throw new Error('Lost acknowledgement'); }
      return normal(command);
    });
    await expect(publishPreparedMutation(intent)).resolves.toEqual(committed);
    await expect(publishPreparedMutation(intent)).resolves.toEqual(committed);
    expect(f.native.mock.calls.filter(([command]) => command === 'pi_chat_publish_mutation')).toHaveLength(1);
    expect(f.native.mock.calls.filter(([command]) => command === 'pi_chat_release_editor_publication')).toHaveLength(1);
    expect(getDocumentMarkdown(f.document)).toBe('Published');
  });
  it('captures canonical conflict before releasing an uncertain result into a stale editor baseline', async () => {
    const f = fixture(); await f.bind(); let reconciliations = 0;
    f.native.mockImplementation(async command => {
      if (command === 'pi_chat_reconcile_mutation') { if (++reconciliations > 1) throw new Error('Proof unavailable'); return { status: 'unpublished' }; }
      if (command === 'pi_chat_admit_editor_publication') return 'admission-1';
      if (command === 'pi_chat_publish_mutation') { f.publishCanonical(); throw new Error('Lost acknowledgement'); }
    });
    await expect(publishPreparedMutation(intent)).rejects.toThrow('Proof unavailable');
    expect(f.document.externalSync.kind).toBe('conflict');expect(getDocumentMarkdown(f.document)).toBe('Original');
    expect(f.service.isAgentPublicationActive()).toBe(false);
  });
  it('keeps editors frozen after failed settlement until native owner close acknowledges joining the effect', async () => {
    const f = fixture(); const owner = await f.bind(); const closing = Promise.withResolvers<void>(); const normal = f.native.getMockImplementation()!;
    f.native.mockImplementation(async command => {
      if (command === 'pi_chat_release_editor_publication') throw new Error('Join uncertain');
      if (command === 'pi_chat_close_editor_owner') return closing.promise;
      return normal(command);
    });
    await expect(publishPreparedMutation(intent)).rejects.toThrow('Join uncertain');
    expect(f.service.isAgentPublicationActive()).toBe(true);
    const closed = owner.close();await Promise.resolve();
    expect(() => documentRegistry.dispose(f.document.handle)).toThrow();
    closing.resolve();await closed;
    expect(f.service.isAgentPublicationActive()).toBe(false);
  });
  it('cancellation after admission but before invocation releases admission and makes no new effect', async () => {
    const f = fixture(); await f.bind(); const controller = new AbortController(); const normal = f.native.getMockImplementation()!;
    f.native.mockImplementation(async command => {
      if (command === 'pi_chat_admit_editor_publication') { controller.abort(new Error('Cancelled')); return 'admission-1'; }
      return normal(command);
    });
    await expect(publishPreparedMutation(intent, controller.signal)).rejects.toThrow('Cancelled');
    expect(f.native.mock.calls.some(([command]) => command === 'pi_chat_publish_mutation')).toBe(false);
    expect(f.native.mock.calls.some(([command]) => command === 'pi_chat_release_editor_publication')).toBe(true);
    expect(getDocumentMarkdown(f.document)).toBe('Original');
  });
  it('owner close joins frontend canonical adoption after the native effect has settled', async () => {
    const f = fixture(); const owner = await f.bind(); const observed = Promise.withResolvers<NoteSession>();
    f.read.mockImplementation(() => observed.promise);
    const publishing = publishPreparedMutation(intent);
    await vi.waitFor(() => expect(f.read).toHaveBeenCalled());
    let closed = false; const closing = owner.close().then(() => { closed = true; });
    await Promise.resolve(); await Promise.resolve();
    expect(closed).toBe(false); expect(f.service.isAgentPublicationActive()).toBe(true);
    observed.resolve({ ...original, markdown: 'Published' });
    await publishing; await closing;
    expect(closed).toBe(true); expect(f.service.isAgentPublicationActive()).toBe(false);
  });
  it('runs the production task through Pi and records the native receipt as its terminal outcome', async () => {
    const f = fixture(); await f.bind();
    const registry = createRegistry(); registry.install(publicationExtension());
    const models = createModels(); models.setProvider(fauxProvider().provider);
    const harness = await Harness.open(new MemoryStorage(), { registry, models }, context); harnesses.push(harness);
    const conversation = await harness.createConversation({ ownership: { kind: 'ownerless' } }, context);
    const taskId = await harness.commit(tx => tx.createTask(PublicationTask, intent, { ownership: { kind: 'conversation' }, conversationId: conversation.id }), context);
    const result = await harness.waitForTask(taskId, context);
    expect(result.state).toEqual({ status: 'terminal', outcome: { status: 'completed', result: { status: 'committed', receiptId: committed.receiptId } } });
    expect(getDocumentMarkdown(f.document)).toBe('Published');
    expect(f.native.mock.calls.filter(([command]) => command === 'pi_chat_publish_mutation')).toHaveLength(1);
  });
  it('Pi cancellation joins an already admitted native effect and retains its committed fact', async () => {
    const f = fixture(); await f.bind(); const pending = Promise.withResolvers<PublicationResult>(); const normal = f.native.getMockImplementation()!;
    f.native.mockImplementation(async command => command === 'pi_chat_publish_mutation' ? pending.promise : normal(command));
    hostNative.invoke.mockImplementation(f.native);
    const registry = createRegistry(); registry.install(publicationExtension());
    const models = createModels(); models.setProvider(fauxProvider().provider);
    const harness = await Harness.open(new MemoryStorage(), { registry, models }, context); harnesses.push(harness);
    const conversation = await harness.createConversation({ ownership: { kind: 'ownerless' } }, context);
    const taskId = await harness.commit(tx => tx.createTask(PublicationTask, intent, { ownership: { kind: 'conversation' }, conversationId: conversation.id }), context);
    const terminal = harness.waitForTask(taskId, context);
    await vi.waitFor(() => expect(f.native.mock.calls.some(([command]) => command === 'pi_chat_publish_mutation')).toBe(true));
    let joined = false; const aborting = harness.abortTask(taskId, context).then(() => { joined = true; });
    await Promise.resolve(); expect(joined).toBe(false); expect(f.service.isAgentPublicationActive()).toBe(true);
    f.publishCanonical(); f.setOutcome(committed); pending.resolve(committed);
    await aborting;
    const result = await terminal;
    expect(result.state).toEqual({ status: 'terminal', outcome: { status: 'completed', result: { status: 'committed', receiptId: committed.receiptId } } });
    expect(f.service.isAgentPublicationActive()).toBe(false);
    expect(f.native.mock.calls.filter(([command]) => command === 'pi_chat_publish_mutation')).toHaveLength(1);
  });

});
