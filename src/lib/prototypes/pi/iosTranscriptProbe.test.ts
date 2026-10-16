import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), state: vi.fn(), list: vi.fn(), checkpoint: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@codemirror/view', () => ({ EditorView: {} }));
vi.mock('$lib/features/chat/api', () => ({ chatApi: { prototypeState: mocks.state, listConversations: mocks.list, prototypeCheckpoint: mocks.checkpoint } }));
vi.mock('./probeReview', () => ({ acknowledgedProbeDraft: vi.fn(), acquireProbeReview: vi.fn() }));
vi.mock('$lib/features/proposals/reviewExtension', () => ({ reviewProjection: {} }));
vi.mock('./probeChatFocus', () => ({ openVisibleProbeChat: vi.fn() }));

import { runIosTranscriptProbe } from './iosTranscriptProbe';

describe('iOS transcript probe snapshot admission', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal('location', { href: 'http://tauri.localhost/?piTranscriptTest=1' });
    vi.stubGlobal('document', { querySelector: () => ({}) });
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
});
