import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), state: vi.fn(), list: vi.fn(), checkpoint: vi.fn(), open: vi.fn(), create: vi.fn(), get: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@codemirror/view', () => ({ EditorView: {} }));
vi.mock('$lib/features/chat/api', () => ({ chatApi: { prototypeState: mocks.state, listConversations: mocks.list, prototypeCheckpoint: mocks.checkpoint, createConversation: mocks.create, getConversation: mocks.get } }));
vi.mock('./probeReview', () => ({ acknowledgedProbeDraft: vi.fn(), acquireProbeReview: vi.fn() }));
vi.mock('$lib/features/proposals/reviewExtension', () => ({ reviewProjection: {} }));
vi.mock('./probeChatFocus', () => ({ openVisibleProbeChat: mocks.open }));

import { iosTranscriptDomReceipt, runIosTranscriptProbe } from './iosTranscriptProbe';

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

  it('never replaces the actual failure when DOM diagnostics are unavailable', async () => {
    mocks.state.mockRejectedValue(new Error('Actual snapshot failure'));
    vi.stubGlobal('document', { querySelector: () => ({}), querySelectorAll: () => { throw new Error('Diagnostic DOM unavailable'); } });
    expect(await runIosTranscriptProbe()).toMatchObject({ status: 'failed', error: 'Error: Actual snapshot failure',
      receipts: { failedDom: { captureError: 'Error: Diagnostic DOM unavailable' } } });
  });
});
