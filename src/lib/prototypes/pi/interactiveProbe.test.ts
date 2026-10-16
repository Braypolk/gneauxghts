import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InteractiveFailureJourney } from './interactiveFailures';

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), conversation: vi.fn(), failures: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('$lib/features/chat/api', () => ({ chatApi: {
  prototypeState: async () => ({ interactiveStateJson: JSON.stringify({ a: 'a', savedId: 'saved', savedNoteId: 'note' }) }),
  getConversation: mocks.conversation,
} }));
vi.mock('./nativeProvider', () => ({ nativeTransportStats: {} }));
vi.mock('./interactiveFailures', () => ({ runInteractiveFailures: mocks.failures }));
import { runInteractiveProbe } from './interactiveProbe';

/** The compact pane keeps its title/composer in an inert frame until the normal
 * rail activates it. The title then moves to the shared mobile header, and its
 * focus moves the same retained composer into the shared input dock. */
function compactWorkspace() {
  const state = { collapsed: false, docked: true, railDisabled: false, railHidden: false, railInert: false,
    composerDisabled: false, composerHidden: false, composerInert: false,
    sendDisabled: false, sendHidden: false, sendInert: false, foreignChatVisible: false, title: 'Pi interactive A' };
  const messages: Array<{ id: string; status: string }> = [];
  const field = {
    get value() { return state.title; },
    closest: () => state.collapsed ? {} : null,
    getClientRects: () => state.collapsed ? [] : [1],
    focus: vi.fn(() => { Object.assign(document, { activeElement: field }); state.docked = true; }),
  };
  const send = {
    get disabled() { return state.sendDisabled; },
    closest: () => state.sendInert ? {} : null,
    getClientRects: () => state.sendHidden || !state.docked ? [] : [1],
    click: vi.fn(() => messages.push({ id: 'refinement', status: 'completed' })),
  };
  const surface = { querySelector: () => send };
  const dock = { dataset: { inputDockMode: 'chat' }, querySelector: () => null };
  const slot = { closest: () => dock };
  const composer = {
    get disabled() { return state.composerDisabled; },
    isConnected: true, value: '',
    closest: (selector: string) => selector === '.chat-composer-surface' ? surface
      : selector === '.workspace-chat-slot' ? state.docked ? slot : null
      : selector === '[data-testid="workspace-pane"]' ? state.docked ? null : pane
      : selector === '[data-input-dock-mode]' ? state.docked ? dock : null
      : state.collapsed || !state.docked || state.composerInert ? {} : null,
    getClientRects: () => !state.collapsed && state.docked && !state.composerHidden ? [1] : [],
    focus: vi.fn(), dispatchEvent: vi.fn(),
  };
  const pane = {
    dataset: { paneId: 'pane-2', paneKind: 'chat' },
    querySelector: (selector: string) => selector === '[aria-label="Chat title"]' ? state.collapsed ? field : null
      : selector === 'textarea[aria-label="Message"]' ? state.docked ? null : composer
      : selector === '[data-pane-frame][inert]' && state.collapsed ? {} : null,
    // The workspace card itself stays visible; only its retained frame is inert.
    closest: () => null, getClientRects: () => [1], hasAttribute: () => state.collapsed,
  };
  const foreignSend = { click: vi.fn() };
  const foreignComposer = {
    disabled: false, isConnected: true,
    closest: (selector: string) => selector === '.workspace-chat-slot' ? null
      : selector === '[data-testid="workspace-pane"]' ? foreignPane
      : selector === '.chat-composer-surface' ? { querySelector: () => foreignSend } : null,
    getClientRects: () => [1], focus: vi.fn(), dispatchEvent: vi.fn(),
  };
  const foreignField = { value: 'Pi interactive B', closest: () => null, getClientRects: () => [1], focus: vi.fn() };
  const foreignPane = { dataset: { paneId: 'foreign', paneKind: 'chat' }, closest: () => null, getClientRects: () => [1],
    querySelector: (selector: string) => selector === '[aria-label="Chat title"]' ? foreignField : foreignComposer,
    hasAttribute: () => false };
  const rail = {
    get disabled() { return state.railDisabled; },
    getAttribute: () => 'Expand Pi interactive A',
    closest: () => state.railInert ? {} : null,
    getClientRects: () => state.collapsed && !state.railHidden ? [1] : [],
    click: vi.fn(() => { state.collapsed = false; }),
  };
  const panel = { closest: () => state.collapsed ? {} : null, getClientRects: () => [1] };
  const editorPane = { dataset: { paneId: 'pane-1', paneKind: 'editor' }, hasAttribute: () => false, querySelector: () => null };
  vi.stubGlobal('document', {
    activeElement: null, body: { innerText: 'Review editor and retained chat' },
    querySelector: () => editorPane,
    querySelectorAll: (selector: string) => {
      if (selector.includes('[data-pane-collapsed]')) return [rail];
      if (selector === '[aria-label="Thought partner chat"]') return state.foreignChatVisible ? [foreignPane, panel] : [panel];
      if (selector.startsWith('.mobile-workspace-title-slot')) return state.collapsed ? [] : [field];
      if (selector.includes('[data-pane-kind="chat"]')) return [foreignPane, pane];
      if (selector === '[data-testid="workspace-pane"]') return [editorPane, pane, foreignPane];
      if (selector === 'textarea[aria-label="Message"]') return [foreignComposer, composer];
      if (selector === 'button') return [rail];
      return [];
    },
  });
  vi.stubGlobal('getComputedStyle', () => ({ visibility: 'visible' }));
  vi.stubGlobal('InputEvent', class { constructor(..._args: unknown[]) {} });
  mocks.conversation.mockImplementation(async () => ({ title: 'Pi interactive A', messages: [...messages] }));
  mocks.failures.mockImplementation(async (journey: InteractiveFailureJourney) => {
    // Reproduce currentReview/editReview activating the review editor first.
    state.collapsed = true; state.docked = false;
    await journey.startSend('a', 'PI_UI:REFINE:pending-proposal');
  });
  return { state, rail, field, composer, send, foreignField, foreignComposer, foreignSend, messages };
}

async function run() {
  const pending = runInteractiveProbe();
  await vi.runAllTimersAsync();
  return pending;
}

describe('interactive refinement Send after compact review editing', () => {
  beforeEach(() => {
    vi.clearAllMocks(); vi.useFakeTimers();
    vi.stubGlobal('window', {});
    vi.stubGlobal('location', { href: 'http://tauri.localhost/?piInteractiveTest=failures' });
    mocks.invoke.mockImplementation(async command => command === 'pi_probe_config' ? { fixture: true, interactiveGate: true } : undefined);
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('expands the normal chat rail before acquiring its title, retained composer and Send', async () => {
    const workspace = compactWorkspace();
    const report = await run();
    expect(report?.error).toBeUndefined();
    expect(report).toMatchObject({ status: 'passed' });
    expect(workspace.rail.click).toHaveBeenCalledOnce();
    expect(workspace.field.focus).toHaveBeenCalledOnce();
    expect(workspace.composer.value).toBe('PI_UI:REFINE:pending-proposal');
    expect(workspace.send.click).toHaveBeenCalledOnce();
    expect(workspace.messages).toEqual([{ id: 'refinement', status: 'completed' }]);
    expect(workspace.foreignField.focus).not.toHaveBeenCalled();
    expect(workspace.foreignComposer.dispatchEvent).not.toHaveBeenCalled();
    expect(workspace.foreignSend.click).not.toHaveBeenCalled();
  });

  it.each(['railDisabled', 'railHidden', 'railInert'] as const)('rejects an unusable normal rail (%s)', async flag => {
    const workspace = compactWorkspace(); workspace.state[flag] = true;
    expect(await run()).toMatchObject({ status: 'failed', error: 'Error: Interactive UI deadline: visible normal chat expansion control' });
    expect(workspace.rail.click).not.toHaveBeenCalled();
    expect(workspace.send.click).not.toHaveBeenCalled();
    expect(workspace.foreignSend.click).not.toHaveBeenCalled();
  });

  it.each(['composerDisabled', 'composerHidden', 'composerInert'] as const)('rejects an unusable requested composer (%s)', async flag => {
    const workspace = compactWorkspace(); workspace.state[flag] = true;
    expect(await run()).toMatchObject({ status: 'failed', error: 'Error: Interactive UI deadline: requested chat composer moves into visible normal dock' });
    expect(workspace.composer.dispatchEvent).not.toHaveBeenCalled();
    expect(workspace.send.click).not.toHaveBeenCalled();
    expect(workspace.foreignSend.click).not.toHaveBeenCalled();
  });

  it.each(['sendDisabled', 'sendHidden', 'sendInert'] as const)('rejects an unusable same-composer Send control (%s)', async flag => {
    const workspace = compactWorkspace(); workspace.state[flag] = true;
    expect(await run()).toMatchObject({ status: 'failed', error: 'Error: Interactive UI deadline: requested composer Send message' });
    expect(workspace.send.click).not.toHaveBeenCalled();
    expect(workspace.foreignSend.click).not.toHaveBeenCalled();
    expect(workspace.messages).toEqual([]);
  });

  it('does not borrow a foreign visible chat while the requested pane remains collapsed', async () => {
    const workspace = compactWorkspace(); workspace.state.foreignChatVisible = true;
    expect(await run()).toMatchObject({ status: 'failed', error: 'Error: Interactive UI deadline: requested conversation mounted in normal chat pane' });
    expect(workspace.foreignField.focus).not.toHaveBeenCalled();
    expect(workspace.foreignComposer.dispatchEvent).not.toHaveBeenCalled();
    expect(workspace.foreignSend.click).not.toHaveBeenCalled();
    expect(workspace.send.click).not.toHaveBeenCalled();
  });

  it('still requires the exact requested title after normal rail expansion', async () => {
    const workspace = compactWorkspace(); workspace.state.title = 'Pi interactive B';
    expect(await run()).toMatchObject({ status: 'failed', error: 'Error: Interactive UI deadline: requested conversation mounted in normal chat pane' });
    expect(workspace.rail.click).toHaveBeenCalledOnce();
    expect(workspace.field.focus).not.toHaveBeenCalled();
    expect(workspace.send.click).not.toHaveBeenCalled();
    expect(workspace.foreignSend.click).not.toHaveBeenCalled();
  });
});
