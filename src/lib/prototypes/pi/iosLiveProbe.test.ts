import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import ChatMarkdown from '$lib/features/chat/ui/ChatMarkdown.svelte';
import { message as chatMessage } from '$lib/features/chat/chatTestSupport';
import type { EditorView } from '@codemirror/view';
import { createEmptySessionSnapshot } from '$lib/features/notepad/session/session';
import { createNoteDraftState } from '$lib/features/notepad/state/noteStore';
import { updateDocumentMarkdown } from '$lib/features/notepad/document/documentState';
import { documentRegistry } from '$lib/features/notepad/document/documentRegistry';
import { createReviewEditorForTest } from '$lib/features/proposals/proposalEditorTestSupport';
import { createProposalOrchestration } from '$lib/features/proposals/proposalOrchestration';
import { createProposalReviewSession } from '$lib/features/proposals/reviewSession.svelte';
import { acknowledgeDraft, acceptKeep, draftOf, type ReviewRecord } from './reviewState';
const mocks = vi.hoisted(() => ({ invoke: vi.fn(), state: vi.fn(), list: vi.fn(), settings: vi.fn(), defaults: vi.fn(), capabilities: vi.fn(), checkpoint: vi.fn(), create: vi.fn(), get: vi.fn(), pending: vi.fn(), draft: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));
vi.mock('$lib/features/chat/api', () => ({ chatApi: { prototypeState: mocks.state, listConversations: mocks.list, getSettings: mocks.settings, setDefaults: mocks.defaults, setLocalModelCapabilities: mocks.capabilities, prototypeCheckpoint: mocks.checkpoint, createConversation: mocks.create, getConversation: mocks.get, listPendingProposals: mocks.pending, getProposalDraft: mocks.draft } }));
import { IOS_LIVE, assertIosLiveSettings, assertIosLivePublication, assertIosLiveReview, assertIosLiveKeepDraft, expectedIosLiveKeepDraft, iosLiveEnabled, iosLiveUntil, keepIosLiveReview, openIosLiveSource, runIosLiveProbe } from './iosLiveProbe';
import type { ChatCitation, ChatProposalDraft } from '$lib/features/chat/types';
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

describe('live source navigation through the rendered admitted inline citation', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
  function sourceSurface() {
    const citation = (id: string, noteId: string): Extract<ChatCitation, { kind: 'note' }> => ({
      id, noteId, kind: 'note', label: 'Pi live synthetic orchard', notePath: `/vault/${noteId}.md`, sectionLabel: null, startLine: null, excerpt: 'thirteen cobalt pears',
      passage: { id: `${id}-passage`, noteId, contentHash: 'hash', location: 'body', start: 0, end: 20, excerpt: 'thirteen cobalt pears', revisions: [] },
    });
    const foreign = citation('foreign-source', 'foreign-note'), admitted = citation('admitted-source', 'expected-note');
    const message = chatMessage({ id: 'exact-live-answer', citations: [foreign, admitted],
      content: '[Other](passage:foreign-source-passage) [Orchard](passage:admitted-source-passage)',
      parts: [{ id: 'read', type: 'tool', callId: 'read', name: 'read_note', title: 'Read note evidence', status: 'success', readSources: [admitted] }] });
    const markup = render(ChatMarkdown, { props: { source: message.content, citations: message.citations } }).body;
    let opened = false;
    const visible = { closest: () => null, getClientRects: () => [1] };
    const controls = [...markup.matchAll(/<button\b[^>]*data-chat-note-citation-id="([^"]+)"[^>]*>/g)].map(match => ({
      ...visible, disabled: false, getAttribute: (name: string) => name === 'data-chat-note-citation-id' ? match[1] : null,
      click: vi.fn(() => { opened = match[1] === admitted.id; }),
    }));
    expect(controls).toHaveLength(4); // Link labels and their ordinary numbered source buttons.
    expect(markup).not.toContain('data-slot="inline-citation"');
    const activity = { disabled: false, getAttribute: () => 'true', click: vi.fn() };
    const read = { disabled: false, textContent: admitted.label, getAttribute: () => `Open ${admitted.label}, read passage` };
    const card = { textContent: 'Read note evidence', querySelectorAll: (selector: string) => selector === 'button[aria-label^="Activity,"]' ? [activity]
      : selector === '[aria-label="Notes and passages read"] button' ? [read]
        : selector === 'button[data-chat-note-citation-id]' ? controls : [] };
    const querySelector = vi.fn((selector: string) => selector === '[data-chat-message-id="exact-live-answer"]' ? card : null);
    vi.stubGlobal('getComputedStyle', () => ({ visibility: 'visible' }));
    vi.stubGlobal('document', { querySelector, querySelectorAll: (selector: string) => selector === '[aria-label="Thought partner chat"]' ? [visible]
      : !opened ? [] : selector === '[data-testid="note-title"]' ? [{ value: admitted.label }]
        : selector === '[data-testid="note-editor"] .cm-content' ? [{ textContent: 'thirteen cobalt pears' }] : [] });
    return { message, controls, querySelector,
      foreignControls: controls.filter(control => control.getAttribute('data-chat-note-citation-id') === foreign.id),
      expectedControls: controls.filter(control => control.getAttribute('data-chat-note-citation-id') === admitted.id) };
  }
  it('clicks the expected Note Identity in the exact message instead of an earlier same-label foreign source', async () => {
    vi.useFakeTimers(); const { message, foreignControls, expectedControls, querySelector } = sourceSurface();
    const result = expect(openIosLiveSource(message, 'expected-note')).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(45001); await result;
    for (const control of foreignControls) expect(control.click).not.toHaveBeenCalled();
    expect(expectedControls[0].click).toHaveBeenCalledOnce();
    expect(expectedControls[1].click).not.toHaveBeenCalled();
    expect(querySelector.mock.calls.every(([selector]) => selector === '[data-chat-message-id="exact-live-answer"]')).toBe(true);
  });
  it.each(['disabled', 'hidden', 'inert', 'unadmitted'] as const)('does not navigate through a %s citation control', async state => {
    vi.useFakeTimers(); const { message, controls, expectedControls } = sourceSurface();
    for (const control of expectedControls) {
      if (state === 'disabled') control.disabled = true;
      if (state === 'hidden') control.getClientRects = () => [];
      if (state === 'inert') control.closest = () => ({} as never);
      if (state === 'unadmitted') control.getAttribute = () => 'unadmitted-source';
    }
    const result = expect(openIosLiveSource(message, 'expected-note')).rejects.toThrow('iOS live deadline: normal source citation');
    await vi.advanceTimersByTimeAsync(45001); await result;
    for (const control of controls) expect(control.click).not.toHaveBeenCalled();
  });
});

describe('live Keep binds the exact independently acknowledged review', () => {
  const draft: ChatProposalDraft = { markdown: 'Original answer and source links.\n\nSynthetic iOS live review edit retained 12.', title: 'Pi iOS live saved answer', path: '/owned/vault/Pi iOS live saved answer.md', version: 4, decisions: [] };
  const receipt: CommitNoteReviewResult = { status: 'committed', noteId: 'stable-note', committedMarkdown: draft.markdown, applied: { kind: 'createNote', path: draft.path, previousPath: null }, message: null };
  const canonical = { noteId: receipt.noteId, path: draft.path, title: draft.title, markdown: draft.markdown };
  afterEach(() => vi.unstubAllGlobals());
  function reviewToChat(onOpen = () => {}) {
    const state = { connected: true, chat: false };
    const visible = { closest: () => null, getClientRects: () => [1] };
    const title = { value: draft.title };
    const pane = { querySelector: () => title };
    const view = { state: { doc: { toString: () => draft.markdown }, field: () => ({ reviewId: 'exact-review', hunks: draft.decisions }) },
      dom: { get isConnected() { return state.connected; }, closest: () => state.connected ? pane : null } } as unknown as EditorView;
    const open = { ...visible, disabled: false, getAttribute: () => 'Open thought partner',
      click: vi.fn(() => { state.connected = false; state.chat = true; onOpen(); }) };
    const keep = { ...visible, disabled: false, textContent: 'Keep All', getAttribute: () => null, click: vi.fn() };
    const strip = { querySelectorAll: () => [keep] };
    vi.stubGlobal('getComputedStyle', () => ({ visibility: 'visible' }));
    vi.stubGlobal('document', {
      querySelector: (selector: string) => selector === '[data-proposal-strip="active"][data-proposal-id="exact-proposal"]' && state.chat ? strip : null,
      querySelectorAll: (selector: string) => selector === '[aria-label="Thought partner chat"]' ? state.chat ? [visible] : [] : selector === 'button' ? [open] : [],
    });
    mocks.pending.mockResolvedValue([{ id: 'exact-proposal', preview: { reviewId: 'exact-review' } }]);
    mocks.draft.mockResolvedValue(draft);
    return { view, state, title, open, keep, input: { view, proposalId: 'exact-proposal', conversationId: 'exact-conversation', reviewId: 'exact-review', reviewedDraft: draft, expectedKeepDraft: expectedIosLiveKeepDraft(draft, 'exact-review') } };
  }
  it('keeps the exact acknowledged review when normal chat navigation tears down its editor before showing Keep', async () => {
    const fixture = reviewToChat();
    await expect(keepIosLiveReview(fixture.input)).resolves.toBeUndefined();
    expect(fixture.state.connected).toBe(false);
    expect(fixture.open.click).toHaveBeenCalledOnce();
    expect(fixture.keep.click).toHaveBeenCalledOnce();
    expect(mocks.pending).toHaveBeenLastCalledWith('exact-conversation');
    expect(mocks.draft).toHaveBeenLastCalledWith('exact-proposal');
  });
  it.each(['body', 'title', 'review', 'detached'] as const)('refuses a changed mounted %s before leaving the review editor', async changed => {
    const fixture = reviewToChat();
    if (changed === 'body') vi.spyOn(fixture.view.state.doc, 'toString').mockReturnValue('Changed body');
    if (changed === 'title') fixture.title.value = 'Changed title';
    if (changed === 'review') vi.spyOn(fixture.view.state, 'field').mockReturnValue({ reviewId: 'foreign-review' } as never);
    if (changed === 'detached') fixture.state.connected = false;
    await expect(keepIosLiveReview(fixture.input)).rejects.toThrow(changed === 'review' ? 'Mounted live review identity mismatch' : 'Live working review changed before Keep');
    expect(fixture.open.click).not.toHaveBeenCalled();
    expect(fixture.keep.click).not.toHaveBeenCalled();
  });
  it.each([{ markdown: 'Changed body' }, { title: 'Changed title' }, { path: '/vault/Foreign.md' }, { version: 99 }, { decisions: [{ index: 0, decision: 'keep' }] }])('refuses changed acknowledged fields after normal chat navigation (%j)', async changed => {
    const fixture = reviewToChat(() => mocks.draft.mockResolvedValue({ ...draft, ...changed }));
    await expect(keepIosLiveReview(fixture.input)).rejects.toThrow('Acknowledged live review changed before normal Keep');
    expect(fixture.state.connected).toBe(false);
    expect(fixture.keep.click).not.toHaveBeenCalled();
  });
  it('refuses a different pending review identity after normal chat navigation', async () => {
    const fixture = reviewToChat(() => mocks.pending.mockResolvedValue([{ id: 'exact-proposal', preview: { reviewId: 'foreign-review' } }]));
    await expect(keepIosLiveReview(fixture.input)).rejects.toThrow('Mounted live review identity mismatch');
    expect(fixture.keep.click).not.toHaveBeenCalled();
  });
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

describe('independently planned normal Keep decision checkpoint', () => {
  it.each(['pending', 'modified'] as const)('matches actual orchestration, checkpoint and acknowledged version for %s decisions', async status => {
    const path = '/vault/Plan.md', reviewId = 'real-keep-review';
    const hunk = { id: 'hunk', baseFrom: 0, baseTo: 6, proposedFrom: 0, proposedTo: 5, oldText: 'Before', newText: 'After' };
    const initial: ChatProposalDraft = { version: 3, markdown: 'After', title: 'Plan', path, decisions: [{ ...hunk, from: 0, to: 5, status }] };
    const record: ReviewRecord = { proposalJson: JSON.stringify({ id: 'proposal', kind: 'update', status: 'pending', payload: {}, preview: { notePath: path } }),
      draftJson: JSON.stringify(initial), decision: 'pending', acceptedJson: '', receiptJson: '', receiptVersion: 0, fault: '' };
    const document = createNoteDraftState({ ...createEmptySessionSnapshot(), title: 'Plan', bodyMarkdown: 'Before', currentNoteId: 'note', currentNotePath: path,
      lastSavedNoteId: 'note', lastSavedTitle: 'Plan', lastSavedMarkdown: 'Before', lastSavedPath: path });
    const editor = createReviewEditorForTest(document), session = createProposalReviewSession();
    const committedVersions: number[] = [];
    const orchestration = createProposalOrchestration({ getEditorPaneDocument: () => document, getEditorForDocument: () => editor.adapter,
      presentReviewDocument: async () => document, onReviewMarkdownChange: updateDocumentMarkdown,
      finishReviewDocument: async () => {}, acknowledgeDocumentCommit: async () => {}, reloadReviewDocument: async () => {}, session });
    try {
      await orchestration.loadDurableProposal({ proposalId: 'proposal', noteId: 'note', kind: 'update',
        preview: { reviewId, notePath: path, title: 'Plan', baseContentHash: 'base', baseEditorMarkdown: 'Before', proposedEditorMarkdown: 'After', hunks: [hunk] },
        working: { markdown: initial.markdown, title: initial.title, path, decisions: initial.decisions },
        checkpoint: async working => { acknowledgeDraft(record, { ...draftOf(record), markdown: working.markdown, title: working.title, path: working.path, decisions: working.decisions }); },
        commit: async markdown => {
          const acknowledged = draftOf(record); committedVersions.push(acknowledged.version);
          acceptKeep(record, 'proposal', acknowledged.version, markdown, 'full');
          return { status: 'committed', noteId: 'note', committedMarkdown: markdown, applied: { kind: 'updateNote', path, previousPath: path }, message: null };
        }, dismiss: async () => {} });
      await orchestration.flushCheckpoint();
      expect(draftOf(record)).toEqual(initial);
      const expected = expectedIosLiveKeepDraft(initial, reviewId);
      expect(expected.version).toBe(4);
      expect(initial.decisions[0].status).toBe(status); // Prediction never writes to the mounted review.
      await orchestration.keepAll();
      expect(draftOf(record)).toEqual(expected);
      expect(committedVersions).toEqual([4]);
      expect(JSON.parse(record.acceptedJson)).toMatchObject({ version: 4, title: initial.title, path, markdown: initial.markdown });
    } finally { orchestration.dispose(); documentRegistry.dispose(document.handle); }
  });
  it('preserves already resolved choices and avoids a version increment for an unchanged checkpoint', () => {
    const decisions = [{ id: 'kept', status: 'kept' }, { id: 'undone', status: 'undone' }] as ChatProposalDraft['decisions'];
    const initial: ChatProposalDraft = { version: 3, title: 'Plan', path: '/vault/Plan.md', markdown: 'Retained body', decisions };
    const expected = expectedIosLiveKeepDraft(initial, 'review');
    expect(expected).toEqual(initial);
    const record: ReviewRecord = { proposalJson: JSON.stringify({ status: 'pending', payload: {} }), draftJson: JSON.stringify(initial), decision: 'pending', acceptedJson: '', receiptJson: '', receiptVersion: 0, fault: '' };
    expect(acknowledgeDraft(record, expected).version).toBe(3);
  });
  it.each([{ version: 99 }, { markdown: 'Wrong body' }, { title: 'Wrong title' }, { path: '/vault/Wrong.md' }, { decisions: [] }])('rejects an arbitrary resulting Keep draft (%j)', changed => {
    const initial: ChatProposalDraft = { version: 3, title: 'Plan', path: '/vault/Plan.md', markdown: 'Body', decisions: [{ id: 'pending', status: 'pending' }] as ChatProposalDraft['decisions'] };
    const expected = expectedIosLiveKeepDraft(initial, 'review');
    expect(() => assertIosLiveKeepDraft(expected, { ...expected, ...changed })).toThrow('independently planned draft');
  });
});
