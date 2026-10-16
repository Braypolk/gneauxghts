import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage, ChatProposalDraft } from '$lib/features/chat/types';
import { assertIosPublicationConfig, assertIosPublicationRestore, assertIosPublicationReceipt, runIosPublicationFaultJourney, assertIosCommandCrashRestored, assertIosPreparedPublication, runIosCommandCrashJourney, maybeRunIosPublicationFaultProbe,
  type IosPublicationConfig, type IosPublicationState } from './iosPublicationFaultProbe';
import { expectedSharedKeepDraft } from './sharedKeepProof';

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), settings: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('$lib/features/chat/api', () => ({ chatApi: { getSettings: mocks.settings } }));

const config: IosPublicationConfig = { gate: 'owned-ios-publication-fault-control', boundary: 'after-publication', scope: 'synthetic-scope-1234' };
const draft: ChatProposalDraft = { version: 7, markdown: 'Exact reviewed bytes.', title: 'Reviewed', path: '/synthetic/Reviewed.md',
  decisions: [{ id: 'create', baseFrom: 0, baseTo: 0, proposedFrom: 0, proposedTo: 4, oldText: '', newText: 'seed', from: 0, to: 21, status: 'modified' }] };
const source = { id: 'pi-assistant-2', status: 'completed', content: 'Synthetic proposal staged for human review.' } as ChatMessage;
const state: IosPublicationState = { ...config, firstLaunchId: 'first-launch', conversationId: 'pi-1', proposalId: 'pi-review-2', reviewId: 'native-review', reviewedDraft: draft,
  acceptedDraft: expectedSharedKeepDraft(draft, 'native-review'), expectedEditorMarkdown: draft.markdown, sourceMessageId: source.id, sourceContent: source.content };
const receipt = { status: 'committed', noteId: 'native-note', message: null, committedMarkdown: draft.markdown, applied: { kind: 'createNote', path: draft.path, previousPath: null } } as const;
const canonical = { noteId: 'native-note', path: draft.path, title: draft.title, markdown: draft.markdown };

describe('actual publication startup lane and fixture admission', () => {
  const gates = { fixture: true, interactiveGate: true, expandedGate: true, iosTarget: true, iosPublicationFaultGate: true, fixtureBaseUrl: 'http://127.0.0.1:1446' };
  const fetchControl = vi.fn();
  beforeEach(() => { vi.clearAllMocks(); fetchControl.mockReset(); vi.stubGlobal('fetch', fetchControl); mocks.settings.mockResolvedValue({ localBaseUrl: 'http://localhost:1234/v1' }); });
  afterEach(() => vi.unstubAllGlobals());
  it('skips shared iOS before endpoint validation or publication control discovery', async () => {
    mocks.invoke.mockResolvedValue({ ...gates, iosPublicationFaultGate: false, fixtureBaseUrl: null });
    await expect(maybeRunIosPublicationFaultProbe()).resolves.toBeUndefined();
    expect(fetchControl).not.toHaveBeenCalled(); expect(mocks.settings).not.toHaveBeenCalled();
  });
  it('skips desktop before contacting the iOS-only publication lane', async () => {
    mocks.invoke.mockResolvedValue({ ...gates, iosTarget: false, fixtureBaseUrl: null });
    await expect(maybeRunIosPublicationFaultProbe()).resolves.toBeUndefined();
    expect(fetchControl).not.toHaveBeenCalled();
  });
  it('rejects missing native admission rather than inferring an optional lane from failed discovery', async () => {
    mocks.invoke.mockResolvedValue({ ...gates, iosPublicationFaultGate: undefined });
    await expect(maybeRunIosPublicationFaultProbe()).rejects.toThrow(/native target and lane admission/);
    expect(fetchControl).not.toHaveBeenCalled();
  });
  it.each([null, 'http://localhost:1234/v1', 'http://127.0.0.1:8080'])('fails closed for configured publication with invalid fixture %s', async fixtureBaseUrl => {
    mocks.invoke.mockResolvedValue({ ...gates, fixtureBaseUrl });
    await expect(maybeRunIosPublicationFaultProbe()).rejects.toThrow(/fixture/);
    expect(fetchControl).not.toHaveBeenCalled(); expect(mocks.settings).not.toHaveBeenCalled();
  });
  it.each(['unavailable', 'rejected', 'foreign'] as const)('fails closed when configured publication control is %s', async mode => {
    mocks.invoke.mockResolvedValue(gates);
    if (mode === 'unavailable') fetchControl.mockRejectedValue(new Error('Owned publication control unavailable'));
    else fetchControl.mockResolvedValue({ ok: mode !== 'rejected', json: async () => ({ ...config, gate: 'foreign-control' }) });
    await expect(maybeRunIosPublicationFaultProbe()).rejects.toThrow(mode === 'unavailable' ? /unavailable/ : mode === 'rejected' ? /rejected request/ : /Unrecognized/);
    expect(fetchControl).toHaveBeenCalledWith('http://127.0.0.1:1447/pi-ios-publication/config', expect.anything());
    expect(mocks.settings).not.toHaveBeenCalled();
  });
});

describe('minimum actual iOS publication boundary contract', () => {
  it('accepts only the three existing native publication boundaries and a generated scope', () => {
    for (const boundary of ['after-intent', 'after-publication', 'after-receipt'] as const) expect(() => assertIosPublicationConfig({ ...config, boundary })).not.toThrow();
    expect(() => assertIosPublicationConfig({ ...config, boundary: 'unknown' } as unknown as IosPublicationConfig)).toThrow();
    expect(() => assertIosPublicationConfig({ ...config, scope: '../private' })).toThrow();
  });
  it('requires the exact accepted version and every review field, plus the original assistant source', () => {
    expect(() => assertIosPublicationRestore(state, structuredClone(state.acceptedDraft), source, config)).not.toThrow();
    for (const changed of [{ ...state.acceptedDraft, version: 99 }, { ...state.acceptedDraft, markdown: 'other' },
      { ...state.acceptedDraft, title: 'other' }, { ...state.acceptedDraft, path: '/other.md' }, { ...state.acceptedDraft, decisions: [] }])
      expect(() => assertIosPublicationRestore(state, changed, source, config)).toThrow(/exact accepted/);
    expect(() => assertIosPublicationRestore(state, state.acceptedDraft, { ...source, content: 'other' }, config)).toThrow(/assistant source/);
    expect(() => assertIosPublicationRestore(state, state.acceptedDraft, source, { ...config, scope: 'another-scope' })).toThrow(/scope or boundary/);
  });
  it('requires one exact canonical receipt and independently read editor bytes/identity/location', () => {
    expect(() => assertIosPublicationReceipt(state, receipt, { ...receipt }, canonical)).not.toThrow();
    expect(() => assertIosPublicationReceipt(state, receipt, { ...receipt, noteId: 'another' }, canonical)).toThrow(/Duplicate/);
    expect(() => assertIosPublicationReceipt(state, receipt, receipt, { ...canonical, markdown: 'other' })).toThrow(/editor bytes/);
    expect(() => assertIosPublicationReceipt(state, receipt, receipt, { ...canonical, path: '/other.md' })).toThrow(/identity\/title\/location/);
  });
  it('persists the predicted accepted review before arming the native fault and requires driver acknowledgement before first Keep', async () => {
    const order: string[] = [], crash = new Error('simulated owned native process exit'); let checkpoint: unknown;
    const api = { prototypeState: async () => undefined,
      prototypeCheckpoint: async (value: unknown) => { order.push('checkpoint'); checkpoint = value; },
      prototypeFault: async () => { order.push('arm'); } } as unknown as Parameters<typeof runIosPublicationFaultJourney>[0]['api'];
    await expect(runIosPublicationFaultJourney({ api, config, launchId: 'first-launch',
      createAndEdit: async () => ({ conversationId: state.conversationId, proposalId: state.proposalId, reviewId: state.reviewId, draft, source }),
      waitCrashCommand: async () => { order.push('challenge'); return { nonce: 'fresh-owned-nonce-1234', issuedAt: 1 }; },
      acknowledgeCrash: async () => { order.push('ack'); return {}; },
      clickKeep: async () => { order.push('normal-Keep'); throw crash; }, readCanonical: vi.fn(), emit: async () => {},
    })).rejects.toBe(crash);
    expect(order).toEqual(['checkpoint', 'arm', 'challenge', 'ack', 'normal-Keep']);
    expect(JSON.parse((checkpoint as { iosPublicationFaultStateJson: string }).iosPublicationFaultStateJson).acceptedDraft).toEqual(state.acceptedDraft);
  });
  it('recovery does not create or send another turn and explicitly joins the accepted version twice', async () => {
    const commit = vi.fn().mockResolvedValue(receipt), createAndEdit = vi.fn();
    const api = { prototypeState: async () => ({ iosPublicationFaultStateJson: JSON.stringify(state) }),
      getProposalDraft: async () => state.acceptedDraft, getConversation: async () => ({ messages: [source] }),
      commitAgentProposal: commit, listPendingProposals: async () => [] } as unknown as Parameters<typeof runIosPublicationFaultJourney>[0]['api'];
    const output = await runIosPublicationFaultJourney({ api, config, launchId: 'relaunch', createAndEdit,
      clickKeep: vi.fn(), waitCrashCommand: vi.fn(), acknowledgeCrash: vi.fn(), readCanonical: async () => canonical, emit: async () => {} });
    expect(output.status).toBe('passed'); expect(createAndEdit).not.toHaveBeenCalled();
    expect(commit.mock.calls).toEqual([[state.proposalId, state.acceptedDraft.markdown, state.acceptedDraft.version], [state.proposalId, state.acceptedDraft.markdown, state.acceptedDraft.version]]);
  });
  it('command/transport recovery refuses implicit prepared outcomes, wrong inputs and lost partial identity', () => {
    const commandConfig = { ...config, boundary: 'transport-completed' } as const;
    const commandState = { boundary: commandConfig.boundary, scope: config.scope, firstLaunchId: 'first-launch', conversationId: 'pi-1',
      userContent: `PI_CRASH_TERMINAL PI_E2E_CRASH_${config.scope}`, assistantMessageId: 'pi-assistant-1', partial: `Synthetic terminal partial PI_E2E_CRASH_${config.scope}.` };
    const conversation = { messages: [{ role: 'user', content: commandState.userContent }, { role: 'assistant', id: commandState.assistantMessageId, status: 'error', content: commandState.partial }] } as Awaited<ReturnType<Parameters<typeof runIosPublicationFaultJourney>[0]['api']['getConversation']>>;
    expect(assertIosCommandCrashRestored(commandState, conversation, [], commandConfig).id).toBe(commandState.assistantMessageId);
    expect(() => assertIosCommandCrashRestored(commandState, conversation, [{}], commandConfig)).toThrow(/durable proposal/);
    expect(() => assertIosCommandCrashRestored(commandState, { ...conversation, messages: [{ ...conversation.messages[0], content: 'different' }, conversation.messages[1]] }, [], commandConfig)).toThrow(/admitted input/);
    expect(() => assertIosCommandCrashRestored(commandState, { ...conversation, messages: [conversation.messages[0], { ...conversation.messages[1], id: 'other' }] }, [], commandConfig)).toThrow(/exact partial/);
    expect(() => assertIosCommandCrashRestored(commandState, { ...conversation, messages: [conversation.messages[0], { ...conversation.messages[1], status: 'completed' }] }, [], commandConfig)).toThrow(/retryable/);
  });
  it('retired prepared tool publication requires independently predicted full accepted version and canonical bytes', () => {
    const plan = { proposalId: state.proposalId, reviewId: state.reviewId, reviewedDraft: draft, acceptedDraft: state.acceptedDraft, expectedEditorMarkdown: draft.markdown, capturedAt: 10 };
    expect(() => assertIosPreparedPublication(plan, state.acceptedDraft, receipt, receipt, canonical)).not.toThrow();
    expect(() => assertIosPreparedPublication(plan, { ...state.acceptedDraft, decisions: [] }, receipt, receipt, canonical)).toThrow(/independently predicted/);
    expect(() => assertIosPreparedPublication(plan, state.acceptedDraft, receipt, receipt, { ...canonical, markdown: 'different bytes' })).toThrow(/predicted editor bytes/);
    expect(() => assertIosPreparedPublication(plan, state.acceptedDraft, receipt, receipt, { ...canonical, title: 'Wrong title' })).toThrow(/identity\/title\/location/);
  });
  it('records actual visible/durable terminal partial before releasing its native completion crash boundary', async () => {
    const events: string[] = [], saved: unknown[] = [], commandConfig = { ...config, boundary: 'transport-completed' } as const;
    const partial = { id: 'pi-assistant-1', status: 'streaming', content: `Synthetic terminal partial PI_E2E_CRASH_${config.scope}.` } as ChatMessage;
    const api = { prototypeState: async () => undefined, prototypeCheckpoint: async (value: unknown) => { saved.push(value); events.push('checkpoint'); } } as unknown as Parameters<typeof runIosCommandCrashJourney>[0]['api'];
    const crash = new Error('native EOF crash');
    await expect(runIosCommandCrashJourney({ api, config: commandConfig, launchId: 'first-launch', createConversation: async () => 'pi-1',
      waitCrashCommand: async () => ({ nonce: 'fresh-owned-nonce-1234', issuedAt: 1 }), acknowledgeCrash: async () => { events.push('ack'); return {}; },
      send: async () => { events.push('normal-Send'); }, waitPartial: async () => { events.push('partial-visible-durable'); return partial; },
      emit: async value => { events.push(String(value.phase)); }, retry: vi.fn(), keepPrepared: vi.fn(), awaitCrash: async () => { throw crash; },
    })).rejects.toBe(crash);
    expect(events).toEqual(['checkpoint', 'ready-to-crash', 'ack', 'crash-command-acknowledged', 'normal-Send', 'partial-visible-durable', 'checkpoint', 'partial-ready']);
    const retained = JSON.parse((saved.at(-1) as { iosCommandCrashStateJson: string }).iosCommandCrashStateJson);
    expect(retained.assistantMessageId).toBe(partial.id); expect(retained.partial).toBe(partial.content);
  });
});
