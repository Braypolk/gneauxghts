import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), state: vi.fn(), list: vi.fn(), checkpoint: vi.fn(), open: vi.fn(), create: vi.fn(), get: vi.fn(), pending: vi.fn(), draft: vi.fn(), editor: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@codemirror/view', () => ({ EditorView: { findFromDOM: mocks.editor } }));
vi.mock('$lib/features/chat/api', () => ({ chatApi: { prototypeState: mocks.state, listConversations: mocks.list, prototypeCheckpoint: mocks.checkpoint, createConversation: mocks.create, getConversation: mocks.get, listPendingProposals: mocks.pending, getProposalDraft: mocks.draft } }));
vi.mock('./probeReview', () => ({ acknowledgedProbeDraft: vi.fn(), acquireProbeReview: vi.fn() }));
vi.mock('$lib/features/proposals/reviewExtension', () => ({ reviewProjection: {} }));
vi.mock('./probeChatFocus', () => ({ openVisibleProbeChat: mocks.open }));

import { acknowledgedIosTranscriptPending, iosTranscriptDomReceipt, runIosTranscriptProbe } from './iosTranscriptProbe';
import { acknowledgedProbeDraft, acquireProbeReview } from './probeReview';
import type { ChatProposalDraft } from '$lib/features/chat/types';

function control(label = 'Expand retained chat') {
  return { tagName: 'BUTTON', textContent: '', getAttribute: (name: string) => name === 'aria-label' ? label : null,
    closest: () => null, getClientRects: () => [{}], disabled: false } as unknown as HTMLButtonElement;
}

describe('iOS transcript probe snapshot admission', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal('location', { href: 'http://tauri.localhost/?piTranscriptTest=1' });
    vi.stubGlobal('document', { querySelector: () => ({}), querySelectorAll: () => [], activeElement: null });
    vi.stubGlobal('getComputedStyle', () => ({ visibility: 'visible', display: 'block' }));
    mocks.list.mockResolvedValue([]);
    mocks.invoke.mockImplementation(async command => {
      if (command === 'pi_probe_config') return { fixture: true, interactiveGate: true, expandedGate: true };
      if (command === 'save_note') throw new Error('Observed fresh source setup boundary');
      if (command === 'get_vault_info') return { runningPath: '/retained/vault' };
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it.each([undefined, {}])('begins normal fresh setup when no transcript checkpoint exists (%j)', async snapshot => {
    mocks.state.mockResolvedValue(snapshot);
    const result = await runIosTranscriptProbe();
    expect(result).toMatchObject({ status: 'failed', error: 'Error: Observed fresh source setup boundary' });
    expect(mocks.list).toHaveBeenCalledOnce();
    expect(mocks.invoke).toHaveBeenCalledWith('save_note', {
      title: 'Pi transcript orchard', markdown: 'The synthetic orchard has seven pear trees.', currentPath: null,
    });
    expect(mocks.checkpoint).not.toHaveBeenCalled();
  });

  it('still refuses fresh setup when generated storage already contains a conversation', async () => {
    mocks.state.mockResolvedValue(undefined);
    mocks.list.mockResolvedValue([{ id: 'retained-conversation' }]);
    expect(await runIosTranscriptProbe()).toMatchObject({ status: 'failed', error: 'Error: Fresh generated simulator container required' });
    expect(mocks.invoke.mock.calls.map(([command]) => command)).not.toContain('save_note');
    expect(mocks.checkpoint).not.toHaveBeenCalled();
  });

  it.each(['{', JSON.stringify({ phase: 'unexpected' })])('rejects malformed or unexpected retained checkpoint without reseeding (%s)', async transcriptStateJson => {
    mocks.state.mockResolvedValue({ transcriptStateJson });
    const result = await runIosTranscriptProbe();
    expect(result?.status).toBe('failed');
    expect(result?.error).toMatch(/SyntaxError|Unexpected persisted probe phase/);
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.invoke.mock.calls.map(([command]) => command)).not.toContain('save_note');
    expect(mocks.checkpoint).not.toHaveBeenCalled();
  });

  it('requires actual sandbox relocation for a retained relocated checkpoint', async () => {
    mocks.state.mockResolvedValue({ transcriptStateJson: JSON.stringify({ phase: 'relocated', oldVault: '/retained/vault' }) });
    expect(await runIosTranscriptProbe()).toMatchObject({ status: 'failed', error: 'Error: Simulator sandbox did not actually relocate' });
    expect(mocks.invoke).toHaveBeenCalledWith('get_vault_info');
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.invoke.mock.calls.map(([command]) => command)).not.toContain('save_note');
    expect(mocks.checkpoint).not.toHaveBeenCalled();
  });

  it('retains the selected normal control and exact failed operation without fabricating progress', async () => {
    mocks.state.mockResolvedValue(undefined);
    mocks.create.mockResolvedValueOnce({ id: 'local' }).mockResolvedValueOnce({ id: 'openai' });
    mocks.invoke.mockImplementation(async command => command === 'pi_probe_config' ? { fixture: true, interactiveGate: true, expandedGate: true }
      : command === 'save_note' ? { noteId: 'source', path: '/generated/Source.md' } : undefined);
    const rail = control();
    mocks.open.mockImplementation(async wait => {
      await wait(() => ({ kind: 'rail', node: rail }), 'visible normal chat expansion control');
      throw new Error('iOS transcript deadline: visible non-inert normal chat panel');
    });
    const result = await runIosTranscriptProbe();
    expect(result).toMatchObject({ status: 'failed', error: 'Error: iOS transcript deadline: visible non-inert normal chat panel', checks: [] });
    expect(result?.receipts.trace).toMatchObject([
      { step: 'select:begin', id: 'local' }, { step: 'open:begin' },
      { step: 'open:wait', label: 'visible normal chat expansion control' },
      { step: 'open:control', kind: 'rail', control: { label: 'Expand retained chat', rectangles: 1, inert: false } },
    ]);
    expect(result?.receipts.failedDom).toMatchObject({ panes: [], chats: [], controls: [] });
    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.checkpoint).not.toHaveBeenCalled();
    expect(mocks.invoke).toHaveBeenLastCalledWith('pi_ui_report', { report: result });
  });

  it('bounds failure DOM evidence and exposes inert or hidden retained surfaces without activating them', () => {
    const click = vi.fn(), focus = vi.fn(), button = Object.assign(control('Expand ' + 'x'.repeat(200)), { click, focus });
    const pane = Object.assign(control(), { dataset: { paneId: 'retained-pane', paneKind: 'chat' },
      hasAttribute: () => true, querySelector: () => ({ hasAttribute: () => true, getAttribute: () => 'true' }) });
    const chat = Object.assign(control('Thought partner chat'), { closest: () => pane });
    vi.stubGlobal('document', { activeElement: button, querySelectorAll: (selector: string) => Array.from({ length: 30 }, () =>
      selector === '[data-testid="workspace-pane"]' ? pane : selector === '[aria-label="Thought partner chat"]' ? chat
        : selector === 'button' ? button : { ...control(), value: 't'.repeat(200) }) });
    const receipt = iosTranscriptDomReceipt();
    expect(receipt.panes).toHaveLength(8);
    expect(receipt.chats).toHaveLength(8);
    expect(receipt.titles).toHaveLength(8);
    expect(receipt.composers).toHaveLength(8);
    expect(receipt.controls).toHaveLength(24);
    expect(receipt.controls?.[0].label).toHaveLength(160);
    expect(receipt.titles?.[0].title).toHaveLength(160);
    expect(receipt.panes?.[0]).toMatchObject({ collapsed: true, frameInert: true, frameAriaHidden: 'true' });
    expect(receipt.chats?.[0]).toMatchObject({ paneId: 'retained-pane', hidden: true, inert: true, ariaHidden: true });
    expect(click).not.toHaveBeenCalled(); expect(focus).not.toHaveBeenCalled();
  });

  it('settles the exact automatic Save mount before attempting normal chat review controls', async () => {
    const draft = { version: 1, title: 'Saved Pi answer', markdown: 'Faithful answer with Origin', path: '/vault/Saved.md', decisions: [] };
    const proposal = { id: 'saved', preview: { reviewId: 'exact-save-review' } };
    const messages: { id: string; status: string; content: string; citations: { label: string }[] }[] = [];
    let conflictVisible = false, conflictKind = 'edited', saved = false;
    let title = draft.title, reviewId = 'foreign-review';
    const notePane = { querySelector: () => null };
    const mobileTitle = { get value() { return title; } };
    const view = { state: { doc: { toString: () => draft.markdown }, field: () => ({ reviewId }) },
      dom: { isConnected: true, closest: () => notePane } };
    mocks.editor.mockReturnValue(view);
    mocks.state.mockResolvedValue(undefined);
    mocks.create.mockResolvedValueOnce({ id: 'local' }).mockResolvedValueOnce({ id: 'openai' });
    mocks.get.mockImplementation(async () => ({ title: 'Local chat', messages: [...messages], projectionConflict: conflictKind }));
    mocks.pending.mockImplementation(async () => saved ? [proposal] : []);
    mocks.draft.mockResolvedValue(draft);
    mocks.invoke.mockImplementation(async (command, args) => {
      if (command === 'pi_probe_config') return { fixture: true, interactiveGate: true, expandedGate: true };
      if (command === 'save_note') return { noteId: 'source', path: '/vault/Source.md' };
      if (command === 'pi_ui_report' && args.report.phase === 'awaiting-external-edit') conflictVisible = true;
      if (command === 'pi_ui_report' && args.report.phase === 'awaiting-external-delete') { conflictVisible = true; conflictKind = 'missing'; }
    });
    const makeButton = (label: string, click = () => {}) => Object.assign(control(label), { click });
    const buttons = [makeButton('Conversations'), makeButton('Send message', () => messages.push({ id: `answer-${messages.length}`, status: 'completed', content: 'Faithful answer', citations: [{ label: 'Orchard' }] })),
      makeButton('Keep edited copy as a note', () => { conflictVisible = false; }), makeButton('Save to note', () => { saved = true; })];
    const restore = makeButton('Restore transcript from chat', () => { conflictVisible = false; });
    const answer = { querySelectorAll: () => [buttons[3]] };
    vi.stubGlobal('InputEvent', class {});
    vi.stubGlobal('document', { activeElement: null,
      querySelector: (selector: string) => selector === '[aria-label="Chat title"]' ? { value: 'Local chat' }
        : selector === 'textarea[aria-label="Message"]' ? { disabled: false, focus() {}, dispatchEvent() {} }
          : selector.startsWith('[data-chat-message-id=') ? answer : {},
      querySelectorAll: (selector: string) => selector === 'button' ? [...buttons, ...(conflictVisible ? [restore] : [])]
        : selector === '[role="menuitem"]' ? [Object.assign(makeButton('Local chat'), { textContent: 'Local chat' })]
          : selector === '[data-testid="note-editor"] .cm-editor' ? [{}]
            : selector === '[data-testid="workspace-pane"][data-pane-kind="editor"]' ? [notePane]
              : selector === '.mobile-workspace-title-slot [data-testid="note-title"]' ? [mobileTitle] : [],
    });
    vi.mocked(acquireProbeReview).mockImplementationOnce(async input => {
      expect(input.waitForAutomaticMount).toBe(true);
      expect(input.editor()).toBeUndefined(); // Same bytes/title cannot admit a foreign projection.
      reviewId = 'exact-save-review'; title = 'Foreign title';
      expect(input.editor()).toBeUndefined();
      title = draft.title; expect(input.editor()).toBe(view);
      throw new Error('Observed exact automatic Save settlement');
    });
    const result = await runIosTranscriptProbe();
    expect(result).toMatchObject({ status: 'failed', error: 'Error: Observed exact automatic Save settlement',
      checks: ['watcher-driven external edit/delete and normal Convert/Restore buttons'] });
    expect(acquireProbeReview).toHaveBeenCalledOnce();
    expect(mocks.open).toHaveBeenCalledTimes(2); // Conversation selection and Save; no racing review header.
    expect(mocks.checkpoint).not.toHaveBeenCalled();
  });

  it('never replaces the actual failure when DOM diagnostics are unavailable', async () => {
    mocks.state.mockRejectedValue(new Error('Actual snapshot failure'));
    vi.stubGlobal('document', { querySelector: () => ({}), querySelectorAll: () => { throw new Error('Diagnostic DOM unavailable'); } });
    expect(await runIosTranscriptProbe()).toMatchObject({ status: 'failed', error: 'Error: Actual snapshot failure',
      receipts: { failedDom: { captureError: 'Error: Diagnostic DOM unavailable' } } });
  });
});

describe('iOS transcript mounted pending acknowledgement', () => {
  const decisions = [{ id: 'creation', from: 0, to: 12, status: 'pending', originalText: '', proposedText: 'Pending body' }] as unknown as ChatProposalDraft['decisions'];
  const draft: ChatProposalDraft = { version: 4, title: 'Pending title', markdown: 'Pending body', path: '/vault/Pending.md', decisions };
  let mounted: boolean, body: string, title: string, reviewId: string, durable: ChatProposalDraft;
  let view: { state: { doc: { toString(): string }; field(): { reviewId: string; hunks: ChatProposalDraft['decisions'] } }; dom: { isConnected: boolean; closest(): unknown } };
  let chatOpen: ReturnType<typeof vi.fn>;
  beforeEach(async () => {
    vi.resetAllMocks(); vi.useFakeTimers();
    const actual = await vi.importActual<typeof import('./probeReview')>('./probeReview');
    vi.mocked(acquireProbeReview).mockImplementation(actual.acquireProbeReview);
    vi.mocked(acknowledgedProbeDraft).mockImplementation(actual.acknowledgedProbeDraft);
    mounted = false; body = draft.markdown; title = draft.title; reviewId = 'exact-review'; durable = structuredClone(draft);
    const titleInput = { get value() { return title; } };
    const pane = { querySelector: () => titleInput };
    view = { state: { doc: { toString: () => body }, field: () => ({ reviewId, hunks: decisions }) },
      dom: { get isConnected() { return mounted; }, closest: () => pane } };
    mocks.editor.mockReturnValue(view);
    mocks.pending.mockResolvedValue([{ id: 'pending', preview: { reviewId: 'exact-review' } }]);
    mocks.draft.mockImplementation(async () => structuredClone(durable));
    chatOpen = vi.fn(() => { mounted = false; });
    mocks.open.mockImplementation(chatOpen);
    const reviewButton = { disabled: false, textContent: 'Review in editor', getAttribute: () => null, click: () => { mounted = true; } };
    const card = { querySelectorAll: () => [reviewButton] };
    vi.stubGlobal('document', {
      querySelector: (selector: string) => selector.startsWith('section[data-proposal-id=') ? card : {},
      querySelectorAll: (selector: string) => selector === '[data-testid="note-editor"] .cm-editor' && mounted ? [{}] : [],
    });
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('acknowledges exact mounted fields before compact chat navigation destroys the editor', async () => {
    const pending = acknowledgedIosTranscriptPending('pending', 'conversation');
    await vi.advanceTimersByTimeAsync(1000);
    expect(await pending).toEqual(draft);
    expect(mocks.pending).toHaveBeenCalledWith('conversation');
    expect(chatOpen).toHaveBeenCalledOnce();
    expect(view.dom.isConnected).toBe(true);
    // This is the compact lifecycle that caused the native deadline: the next
    // normal chat navigation removes the editor, after its independent proof.
    await mocks.open();
    expect(view.dom.isConnected).toBe(false);
  });

  it.each(['review', 'body', 'title', 'disconnected'])('rejects a foreign or disconnected mounted %s', async mismatch => {
    mounted = true;
    if (mismatch === 'review') reviewId = 'foreign-review';
    if (mismatch === 'body') body = 'Foreign body';
    if (mismatch === 'title') title = 'Foreign title';
    if (mismatch === 'disconnected') Object.defineProperty(view.dom, 'isConnected', { value: false });
    const failure = acknowledgedIosTranscriptPending('pending', 'conversation').then(() => undefined, error => error);
    await vi.advanceTimersByTimeAsync(46000);
    expect(await failure).toEqual(expect.objectContaining({ message: expect.stringMatching(/deadline: retained CodeMirror proposal review/) }));
  });

  it.each(['markdown', 'title', 'path', 'decisions'] as const)('requires the durable acknowledgement to match mounted %s', async field => {
    mounted = true;
    let reads = 0;
    mocks.draft.mockImplementation(async () => {
      reads++;
      if (reads === 1) return structuredClone(draft);
      return { ...structuredClone(draft), [field]: field === 'decisions' ? [] : 'Foreign value' };
    });
    const failure = acknowledgedIosTranscriptPending('pending', 'conversation').then(() => undefined, error => error);
    await vi.advanceTimersByTimeAsync(46000);
    expect(await failure).toEqual(expect.objectContaining({ message: expect.stringMatching(/deadline: acknowledged mounted review checkpoint/) }));
    expect(chatOpen).not.toHaveBeenCalled();
  });
});
