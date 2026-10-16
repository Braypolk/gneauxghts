import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ invoke: vi.fn(), state: vi.fn(), list: vi.fn(), settings: vi.fn(), defaults: vi.fn(), capabilities: vi.fn(), checkpoint: vi.fn(), create: vi.fn(), get: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));
vi.mock('$lib/features/chat/api', () => ({ chatApi: { prototypeState: mocks.state, listConversations: mocks.list, getSettings: mocks.settings, setDefaults: mocks.defaults, setLocalModelCapabilities: mocks.capabilities, prototypeCheckpoint: mocks.checkpoint, createConversation: mocks.create, getConversation: mocks.get } }));
import { IOS_LIVE, assertIosLiveSettings, assertIosLivePublication, assertIosLiveReview, iosLiveEnabled, iosLiveUntil, runIosLiveProbe } from './iosLiveProbe';
import type { ChatProposalDraft } from '$lib/features/chat/types';
import type { CommitNoteReviewResult } from '$lib/types/proposals';
describe('explicit iOS live probe admission and deadlines', () => {
  beforeEach(() => {
    vi.resetAllMocks(); vi.stubGlobal('location', { href: 'http://tauri.localhost/?piIosLiveTest=1' });
    vi.stubGlobal('document', { querySelector: () => ({}) });
    mocks.invoke.mockResolvedValue({ fixture: false, interactiveGate: true }); mocks.list.mockResolvedValue([]);
    mocks.settings.mockResolvedValue({ provider: 'local', model: IOS_LIVE.model, localModel: IOS_LIVE.model, localBaseUrl: IOS_LIVE.endpoint, reasoningEffort: 'off' });
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
  it('requires the exact query and explicit diagnostic gate with synthetic transport disabled', () => {
    expect(iosLiveEnabled('http://tauri/?piIosLiveTest=1', { fixture: false, interactiveGate: true })).toBe(true);
    for (const [url, config] of [
      ['http://tauri/', { fixture: false, interactiveGate: true }], ['http://tauri/?piIosLiveTest=0', { fixture: false, interactiveGate: true }],
      ['http://tauri/?piIosLiveTest=1', { fixture: true, interactiveGate: true }], ['http://tauri/?piIosLiveTest=1', { fixture: false, interactiveGate: false }],
    ] as const) expect(iosLiveEnabled(url, config)).toBe(false);
  });
  it('never reads or mutates live evaluation state without both gates', async () => {
    mocks.invoke.mockResolvedValue({ fixture: true, interactiveGate: true });
    expect(await runIosLiveProbe()).toBeUndefined(); expect(mocks.state).not.toHaveBeenCalled(); expect(mocks.defaults).not.toHaveBeenCalled();
  });
  it('does not even query native configuration without the opt-in URL', async () => {
    vi.stubGlobal('location', { href: 'http://tauri/' }); expect(await runIosLiveProbe()).toBeUndefined(); expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it('refuses any retained conversation before synthetic seeding or configuration writes', async () => {
    mocks.list.mockResolvedValue([{ id: 'existing' }]); expect(await runIosLiveProbe()).toMatchObject({ status: 'failed', error: 'Error: Fresh generated simulator container required' });
    expect(mocks.defaults).not.toHaveBeenCalled(); expect(mocks.capabilities).not.toHaveBeenCalled();
  });
  it('writes and reads back only the exact approved local proxy/model configuration', async () => {
    mocks.invoke.mockImplementation(async command => { if (command === 'pi_probe_config') return { fixture: false, interactiveGate: true }; if (command === 'save_note') throw new Error('Observed synthetic source setup boundary'); });
    expect(await runIosLiveProbe()).toMatchObject({ status: 'failed', error: 'Error: Observed synthetic source setup boundary' });
    expect(mocks.defaults).toHaveBeenCalledWith(expect.objectContaining({ provider: 'local', model: IOS_LIVE.model, localBaseUrl: IOS_LIVE.endpoint, reasoningEffort: 'off', defaultVaultAccess: 'full', webAccess: 'off' }));
    expect(mocks.settings).toHaveBeenCalledTimes(2); expect(mocks.checkpoint).not.toHaveBeenCalled();
  });
  it('rejects a settings readback that would silently route to a hosted, fixture or different endpoint', () => {
    const good = { provider: 'local' as const, model: IOS_LIVE.model, localModel: IOS_LIVE.model, localBaseUrl: IOS_LIVE.endpoint, reasoningEffort: 'off' as const };
    expect(() => assertIosLiveSettings(good)).not.toThrow();
    for (const change of [{ provider: 'openai' as const }, { model: 'pi-native-fixture' }, { localModel: 'other' }, { localBaseUrl: IOS_LIVE.upstream }, { reasoningEffort: 'medium' as const }]) expect(() => assertIosLiveSettings({ ...good, ...change })).toThrow('configuration read-back');
  });
  it('bounds an individual stalled IPC predicate', async () => {
    vi.useFakeTimers(); const pending = expect(iosLiveUntil(() => new Promise(() => {}), 'stalled native read', 1000)).rejects.toThrow('iOS live deadline: stalled native read');
    await vi.advanceTimersByTimeAsync(1000); await pending;
  });
  it('preserves actual native failures instead of returning a fabricated successful answer', async () => {
    mocks.state.mockRejectedValue(new Error('Observed native snapshot failure'));
    expect(await runIosLiveProbe()).toMatchObject({ status: 'failed', error: 'Error: Observed native snapshot failure', checks: [] }); expect(mocks.defaults).not.toHaveBeenCalled();
  });
  it('selects through the normal mobile picker and exact portaled title before attempting live Send', async () => {
    const visible = { closest: () => null, getClientRects: () => [1] };
    const title = { ...visible, value: '', focus: vi.fn(() => { Object.assign(document, { activeElement: title }); }) };
    const composer = { ...visible, isConnected: true, disabled: false,
      closest: (selector: string) => selector === '.workspace-chat-slot' ? {} : null };
    const picker = { ...visible, disabled: false, getAttribute: () => 'Conversations', click: vi.fn() };
    const item = { textContent: 'Pi iOS live local', click: vi.fn(() => { title.value = 'Pi iOS live local'; }) };
    const pane = { ...visible, querySelector: () => null,
      querySelectorAll: (selector: string) => selector === 'button' ? [picker] : [item] };
    vi.stubGlobal('getComputedStyle', () => ({ visibility: 'visible' }));
    vi.stubGlobal('document', { activeElement: null, querySelector: () => pane,
      querySelectorAll: (selector: string) => selector.startsWith('[data-testid=') ? [pane]
        : selector.startsWith('.mobile-workspace-title-slot') ? [title]
          : selector === 'textarea[aria-label="Message"]' ? [composer] : [visible] });
    mocks.invoke.mockImplementation(async command => command === 'pi_probe_config' ? { fixture: false, interactiveGate: true }
      : command === 'save_note' ? { noteId: 'source', path: '/vault/Source.md' } : undefined);
    mocks.create.mockResolvedValue({ id: 'live' });
    mocks.get.mockResolvedValueOnce({ title: 'Pi iOS live local' }).mockRejectedValueOnce(new Error('Observed real Send boundary'));
    expect(await runIosLiveProbe()).toMatchObject({ status: 'failed', error: 'Error: Observed real Send boundary', checks: [] });
    expect(title.focus).toHaveBeenCalledOnce();
    expect(picker.click).toHaveBeenCalledOnce();
    expect(item.click).toHaveBeenCalledOnce();
    expect(mocks.get).toHaveBeenCalledTimes(2);
    expect(mocks.checkpoint).not.toHaveBeenCalled();
  });
});

describe('live Keep binds the exact independently acknowledged review', () => {
  const draft: ChatProposalDraft = { markdown: 'Original answer and source links.\n\nSynthetic iOS live review edit retained 12.', title: 'Pi iOS live saved answer', path: '/owned/vault/Pi iOS live saved answer.md', version: 4, decisions: [] };
  const receipt: CommitNoteReviewResult = { status: 'committed', noteId: 'stable-note', committedMarkdown: draft.markdown, applied: { kind: 'createNote', path: draft.path, previousPath: null }, message: null };
  const canonical = { noteId: receipt.noteId, path: draft.path, title: draft.title, markdown: draft.markdown };
  it('accepts the same exact editor-facing body, title, path and Note Identity', () => {
    expect(() => assertIosLivePublication(draft, receipt, canonical)).not.toThrow();
  });
  it('rejects wrong receipt bytes even if the edit marker remains and canonical agrees with that wrong receipt', () => {
    const wrongBody = 'Different answer with lost source links.\n\nSynthetic iOS live review edit retained 12.';
    expect(() => assertIosLivePublication(draft, { ...receipt, committedMarkdown: wrongBody }, { ...canonical, markdown: wrongBody })).toThrow('exact acknowledged review body');
  });
  it('rejects actual canonical content corruption even when the native receipt is correct', () => {
    expect(() => assertIosLivePublication(draft, receipt, { ...canonical, markdown: 'Missing answer.\n\nSynthetic iOS live review edit retained 12.' })).toThrow('Canonical live note body');
  });
  it.each([{ title: 'Wrong title' }, { path: '/owned/vault/Other.md' }, { noteId: 'foreign-note' }])('rejects a canonical projection with the wrong title, target or identity (%j)', change => {
    expect(() => assertIosLivePublication(draft, receipt, { ...canonical, ...change })).toThrow('identity, title or path');
  });
  it('rejects a receipt published to another path despite identical body and marker', () => {
    expect(() => assertIosLivePublication(draft, { ...receipt, applied: { ...receipt.applied!, path: '/owned/vault/Other.md' } }, canonical)).toThrow('receipt target');
  });
  it('rejects a matching-looking editor belonging to another review', () => {
    expect(() => assertIosLiveReview('expected-review', { reviewId: 'expected-review' })).not.toThrow();
    for (const projection of [undefined, null, { reviewId: 'foreign-review' }]) expect(() => assertIosLiveReview('expected-review', projection)).toThrow('review identity mismatch');
    expect(() => assertIosLiveReview('', { reviewId: '' })).toThrow('review identity mismatch');
  });
});
