import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InteractiveFailureJourney } from './interactiveFailures';
import { EditorView } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { documentReviewField, reviewProjection, setDocumentReview } from '$lib/features/proposals/reviewExtension';
import type { ChatProposalDraft } from '$lib/features/chat/types';
import type { SharedKeepPlan } from './sharedKeepProof';
import { createMarkdownLanguage } from '$lib/features/notepad/markdown/markdownLanguage';

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), conversation: vi.fn(), failures: vi.fn(), state: vi.fn(), pending: vi.fn(), draft: vi.fn(), commit: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('$lib/features/chat/api', () => ({ chatApi: {
  prototypeState: async () => mocks.state() ?? ({ interactiveStateJson: JSON.stringify({ a: 'a', savedId: 'saved', savedNoteId: 'note' }) }),
  getConversation: mocks.conversation,
  listPendingProposals: mocks.pending, getProposalDraft: mocks.draft, commitAgentProposal: mocks.commit,
} }));
vi.mock('./nativeProvider', () => ({ nativeTransportStats: {} }));
vi.mock('./interactiveFailures', () => ({ runInteractiveFailures: mocks.failures }));
import { openSharedSavedOrigin, runInteractiveProbe } from './interactiveProbe';

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
  return { state, rail, field, composer, send, foreignField, foreignComposer, foreignSend, messages, pane };
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

describe('normal saved Open note restores compact Keep editor before origin navigation', () => {
  beforeEach(() => { vi.resetAllMocks(); vi.useFakeTimers(); });
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); });

  function savedOriginWorkspace(fault?: 'inert' | 'identity' | 'path' | 'body' | 'title' | 'mountedBody' | 'noop' | 'wrongAnchor' | 'wrongScroll' | 'pendingOpen' | 'stuckOpen' | 'wrongConversation' | 'wrongPaneKind', retainedSplit = false, twoPanes = false) {
    const workspace = compactWorkspace();
    const expected = { noteId: 'saved-note', path: '/vault/Saved.md', title: 'Saved', markdown: 'Final appended answer.\n\n[[Chats/Pi/a/Origin#^msg_answer|Open in chat]]' };
    const state = { mounted: false, originOpened: false, navigationSettled: false };
    const title = { value: expected.title };
    const pane = { querySelector: () => title };
    const editorRoot = { getAttribute: () => 'false' };
    const visible = { isConnected: true, getClientRects: () => [1], closest: (selector: string) => selector === '[data-testid="workspace-pane"]' ? pane : selector === '[data-testid="note-editor"]' ? editorRoot : null };
    const normalScroll = vi.fn();
    class MessageElement {
      isConnected = true;
      constructor(readonly id: string, readonly owner = workspace.pane) {}
      getAttribute(name: string) { return name === 'data-chat-message-id' ? this.id : null; }
      getClientRects() { return [1]; }
      closest(selector: string) { return selector === '[data-testid="workspace-pane"]' ? this.owner : null; }
      querySelectorAll() { return [open]; }
      scrollIntoView(options?: boolean | ScrollIntoViewOptions) { normalScroll(this.id, options); }
    }
    vi.stubGlobal('Element', MessageElement);
    const card = new MessageElement('answer');
    const wrongCard = new MessageElement('other-answer');
    const destinationTitle = { ...title, value: fault === 'wrongConversation' ? 'Other conversation' : 'Pi interactive A',
      closest: () => null, getClientRects: () => [1] };
    const destinationPane = { ...workspace.pane, dataset: { paneId: 'origin-editor', paneKind: fault === 'wrongPaneKind' ? 'editor' : 'chat' },
      querySelector: (selector: string) => selector === '[aria-label="Chat title"]' ? destinationTitle : null };
    const destinationCard = new MessageElement('answer', destinationPane);
    const keyboard = vi.fn(() => {
      if ((fault === 'pendingOpen' || fault === 'stuckOpen') && !state.navigationSettled) return;
      if (fault === 'noop') return;
      state.mounted = false; state.originOpened = true;
      (fault === 'wrongAnchor' ? wrongCard : twoPanes ? destinationCard : card).scrollIntoView({ behavior: 'auto', block: fault === 'wrongScroll' ? 'nearest' : 'center' });
    });
    const view = { dom: visible, state: EditorState.create({
      doc: fault === 'mountedBody' ? 'Wrong note with Open in chat' : expected.markdown,
      extensions: [createMarkdownLanguage()],
    }),
      dispatch: vi.fn((transaction: { selection: { anchor: number } }) => { view.state = view.state.update(transaction).state; }),
      focus: vi.fn(), contentDOM: { dispatchEvent: keyboard } };
    vi.spyOn(EditorView, 'findFromDOM').mockReturnValue(view as unknown as EditorView);
    let openBusy = 'false';
    const open = { ...visible, disabled: false, getAttribute: (name: string) => name === 'aria-label' ? 'Open note' : name === 'aria-busy' ? openBusy : null,
      closest: () => fault === 'inert' ? {} : null,
      click: vi.fn(() => {
        expect(state.mounted).toBe(false); state.mounted = true;
        // Controlled pending normal Open note: an already matching retained
        // editor is observable before navigation restores its saved cursor.
        if (fault === 'pendingOpen' || fault === 'stuckOpen') {
          openBusy = 'true'; open.disabled = true;
          if (fault === 'pendingOpen') setTimeout(() => {
            view.state = view.state.update({ selection: { anchor: 0 } }).state; state.navigationSettled = true;
            openBusy = 'false'; open.disabled = false;
          }, 120);
        }
      }) };
    const foreignOpen = { ...open, click: vi.fn() };
    const picker = { disabled: false, textContent: 'Conversations', getAttribute: () => null, click: vi.fn() };
    const item = { textContent: 'Pi interactive A', click: vi.fn() };
    Object.assign(workspace.pane, { querySelectorAll: (selector: string) => selector === 'button' ? [picker] : [item] });
    const queryAll = document.querySelectorAll.bind(document);
    Object.assign(document, {
      querySelector: (selector: string) => selector === '[data-chat-message-id="answer"]' ? state.mounted && !retainedSplit ? undefined : card : {},
      querySelectorAll: (selector: string) => selector === '[data-testid="note-editor"] .cm-editor' ? state.mounted ? [view.dom] : []
        : selector === '[data-testid="workspace-pane"][data-pane-kind="chat"]' && twoPanes && state.originOpened ? [workspace.pane, destinationPane]
        : selector === 'button' ? [foreignOpen] : queryAll(selector),
    });
    vi.stubGlobal('KeyboardEvent', class { constructor(readonly type: string, readonly options: unknown) {} });
    vi.stubGlobal('navigator', { platform: 'MacIntel', vendor: 'Apple Computer, Inc.', userAgent: 'Mozilla/5.0 (Macintosh) Safari/605.1.15', maxTouchPoints: 0 });
    mocks.conversation.mockResolvedValue({ title: 'Pi interactive A', messages: [{ id: 'answer', savedNote: { noteId: fault === 'identity' ? 'foreign-note' : expected.noteId, path: fault === 'path' ? '/vault/Other.md' : expected.path } }] });
    mocks.invoke.mockResolvedValue({ ...expected, ...(fault === 'body' ? { markdown: 'Wrong canonical body' } : fault === 'title' ? { title: 'Wrong title' } : {}) });
    return { expected, state, open, foreignOpen, view, keyboard, card, destinationCard, destinationPane, normalScroll, originalScroll: MessageElement.prototype.scrollIntoView };
  }

  async function navigate(expected: Parameters<typeof openSharedSavedOrigin>[2]) {
    const pending = openSharedSavedOrigin('a', 'answer', expected);
    // Attach a rejection handler before advancing fake deadlines.
    const outcome = pending.then(value => ({ value }), error => ({ error: String(error) }));
    await vi.runAllTimersAsync();
    return outcome;
  }

  it('reopens the exact saved message target after compact Keep unmounted its editor, then follows its origin by keyboard', async () => {
    const workspace = savedOriginWorkspace();
    expect(document.querySelectorAll('[data-testid="note-editor"] .cm-editor')).toHaveLength(0);
    expect(await navigate(workspace.expected)).toEqual({ value: { noteId: 'saved-note', path: '/vault/Saved.md', title: 'Saved', conversationId: 'a', messageId: 'answer', anchorScroll: { behavior: 'auto', block: 'center' }, keyboardPlatform: { platform: 'MacIntel', appleMobile: false, metaKey: true, ctrlKey: false } } });
    expect(workspace.open.click).toHaveBeenCalledOnce();
    expect(workspace.foreignOpen.click).not.toHaveBeenCalled();
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith('read_note', { noteId: 'saved-note', path: '/vault/Saved.md' });
    expect(workspace.view.dispatch).toHaveBeenCalledWith({ selection: { anchor: workspace.expected.markdown.indexOf('[[Chats/Pi/') + 4 }, scrollIntoView: true });
    expect(workspace.view.focus).toHaveBeenCalledOnce();
    expect(workspace.keyboard).toHaveBeenCalledOnce();
    expect(workspace.state.originOpened).toBe(true);
    expect(workspace.normalScroll).toHaveBeenCalledExactlyOnceWith('answer', { behavior: 'auto', block: 'center' });
    expect(Element.prototype.scrollIntoView).toBe(workspace.originalScroll);
  });

  it('rejects an inert exact-message Open note without borrowing a foreign control', async () => {
    const workspace = savedOriginWorkspace('inert');
    expect(await navigate(workspace.expected)).toEqual({ error: 'Error: Interactive UI deadline: visible originating message Open note control' });
    expect(workspace.open.click).not.toHaveBeenCalled();
    expect(workspace.foreignOpen.click).not.toHaveBeenCalled();
    expect(workspace.keyboard).not.toHaveBeenCalled();
  });

  it.each(['identity', 'path'] as const)('rejects a saved-action %s mismatch before opening', async fault => {
    const workspace = savedOriginWorkspace(fault);
    expect(await navigate(workspace.expected)).toEqual({ error: 'Error: Originating message Open note target differs from exact saved Note Identity/path' });
    expect(workspace.open.click).not.toHaveBeenCalled();
    expect(workspace.keyboard).not.toHaveBeenCalled();
  });

  it.each(['body', 'title'] as const)('rejects wrong canonical %s after Open note and before origin navigation', async fault => {
    const workspace = savedOriginWorkspace(fault);
    expect(await navigate(workspace.expected)).toEqual({ error: 'Error: Opened saved canonical identity, body, title or path differs from exact final append' });
    expect(workspace.open.click).toHaveBeenCalledOnce();
    expect(workspace.keyboard).not.toHaveBeenCalled();
  });

  it('does not accept an unrelated mounted note merely because its body contains Open in chat', async () => {
    const workspace = savedOriginWorkspace('mountedBody');
    expect(await navigate(workspace.expected)).toEqual({ error: 'Error: Interactive UI deadline: exact saved target mounted by normal Open note' });
    expect(workspace.open.click).toHaveBeenCalledOnce();
    expect(workspace.keyboard).not.toHaveBeenCalled();
  });

  it('observes normal origin navigation even when a desktop split retains the chat and message card', async () => {
    const workspace = savedOriginWorkspace(undefined, true);
    expect(await navigate(workspace.expected)).toMatchObject({ value: { messageId: 'answer', anchorScroll: { behavior: 'auto', block: 'center' } } });
    expect(workspace.keyboard).toHaveBeenCalledOnce();
    expect(Element.prototype.scrollIntoView).toBe(workspace.originalScroll);
  });

  it.each(['noop', 'wrongAnchor', 'wrongScroll'] as const)('rejects %s keydown despite an already visible origin chat and card', async fault => {
    const workspace = savedOriginWorkspace(fault, true);
    expect(await navigate(workspace.expected)).toEqual({ error: 'Error: Interactive UI deadline: Open in chat scrolls to exact originating message' });
    expect(workspace.keyboard).toHaveBeenCalledOnce();
    expect(Element.prototype.scrollIntoView).toBe(workspace.originalScroll);
    if (fault === 'wrongAnchor') expect(workspace.normalScroll).toHaveBeenCalledExactlyOnceWith('other-answer', { behavior: 'auto', block: 'center' });
  });

  it('verifies the exact newly scrolled destination when a first pane retains the same conversation and message', async () => {
    const workspace = savedOriginWorkspace(undefined, true, true);
    expect(await navigate(workspace.expected)).toMatchObject({ value: { messageId: 'answer', anchorScroll: { behavior: 'auto', block: 'center' } } });
    expect(document.querySelector('[data-chat-message-id="answer"]')).toBe(workspace.card);
    expect(workspace.destinationCard).not.toBe(workspace.card);
    expect(workspace.destinationCard.closest('[data-testid="workspace-pane"]')).toBe(workspace.destinationPane);
    expect(workspace.keyboard).toHaveBeenCalledOnce();
    expect(workspace.normalScroll).toHaveBeenCalledExactlyOnceWith('answer', { behavior: 'auto', block: 'center' });
  });

  it.each(['wrongConversation', 'wrongPaneKind'] as const)('rejects an exact message scroll in a %s destination despite an already visible correct chat', async fault => {
    const workspace = savedOriginWorkspace(fault, true, true);
    expect(await navigate(workspace.expected)).toEqual({ error: 'Error: Interactive UI deadline: Open in chat scrolls to exact originating message' });
    expect(workspace.keyboard).toHaveBeenCalledOnce();
    expect(Element.prototype.scrollIntoView).toBe(workspace.originalScroll);
  });

  it('waits for a pending normal Open note before selecting an already matching retained editor and sending one Mod-Enter', async () => {
    const workspace = savedOriginWorkspace('pendingOpen', true);
    const pending = openSharedSavedOrigin('a', 'answer', workspace.expected);
    await vi.advanceTimersByTimeAsync(119);
    expect(workspace.open.click).toHaveBeenCalledOnce();
    expect(workspace.open.disabled).toBe(true);
    expect(workspace.view.state.doc.toString()).toBe(workspace.expected.markdown);
    expect(workspace.view.dispatch).not.toHaveBeenCalled();
    expect(workspace.keyboard).not.toHaveBeenCalled();
    await vi.runAllTimersAsync();
    expect(await pending).toMatchObject({ messageId: 'answer', anchorScroll: { behavior: 'auto', block: 'center' } });
    expect(workspace.state.navigationSettled).toBe(true);
    expect(workspace.view.state.selection.main.head).toBe(workspace.expected.markdown.indexOf('[[Chats/Pi/') + 4);
    expect(workspace.view.dispatch).toHaveBeenCalledOnce();
    expect(workspace.keyboard).toHaveBeenCalledOnce();
    expect(workspace.open.click).toHaveBeenCalledOnce();
  });

  it('times out an unfinished Open note without selecting the retained editor or retrying navigation', async () => {
    const workspace = savedOriginWorkspace('stuckOpen', true);
    expect(await navigate(workspace.expected)).toEqual({ error: 'Error: Interactive UI deadline: originating message Open note operation completed' });
    expect(workspace.open.click).toHaveBeenCalledOnce();
    expect(workspace.view.dispatch).not.toHaveBeenCalled();
    expect(workspace.keyboard).not.toHaveBeenCalled();
  });

  const keyboardPlatforms = [
    { label: 'iPhone Mobile Safari', nav: { platform: 'iPhone', vendor: 'Apple Computer, Inc.', userAgent: 'Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1', maxTouchPoints: 5 }, appleMobile: true, metaKey: true },
    { label: 'iPad Mobile Safari', nav: { platform: 'iPad', vendor: 'Apple Computer, Inc.', userAgent: 'Mozilla/5.0 (iPad) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1', maxTouchPoints: 5 }, appleMobile: true, metaKey: true },
    { label: 'Apple tablet touch detection without Mobile UA', nav: { platform: 'iPad', vendor: 'Apple Computer, Inc.', userAgent: 'Mozilla/5.0 AppleWebKit/605.1.15 Safari/605.1.15', maxTouchPoints: 5 }, appleMobile: true, metaKey: true },
    { label: 'Mac desktop', nav: { platform: 'MacIntel', vendor: 'Google Inc.', userAgent: 'Mozilla/5.0 Chrome/140.0', maxTouchPoints: 0 }, appleMobile: false, metaKey: true },
    { label: 'Linux desktop', nav: { platform: 'Linux x86_64', vendor: 'Google Inc.', userAgent: 'Mozilla/5.0 Chrome/140.0', maxTouchPoints: 0 }, appleMobile: false, metaKey: false },
    { label: 'Windows desktop', nav: { platform: 'Win32', vendor: 'Google Inc.', userAgent: 'Mozilla/5.0 Chrome/140.0', maxTouchPoints: 0 }, appleMobile: false, metaKey: false },
  ];

  it.each(keyboardPlatforms)('uses the installed CodeMirror Mod platform rule through normal origin navigation: $label', async ({ nav, appleMobile, metaKey }) => {
    const workspace = savedOriginWorkspace(undefined, true);
    vi.stubGlobal('navigator', nav);
    expect(await navigate(workspace.expected)).toMatchObject({ value: { keyboardPlatform: { platform: nav.platform, appleMobile, metaKey, ctrlKey: !metaKey } } });
    expect(workspace.keyboard).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ type: 'keydown', options: expect.objectContaining({ key: 'Enter', code: 'Enter', metaKey, ctrlKey: !metaKey }) }));
    expect(Element.prototype.scrollIntoView).toBe(workspace.originalScroll);
  });

  it('still rejects a no-op Apple mobile keydown when the exact origin chat/card already exists', async () => {
    const workspace = savedOriginWorkspace('noop', true);
    vi.stubGlobal('navigator', keyboardPlatforms[0].nav);
    expect(await navigate(workspace.expected)).toEqual({ error: 'Error: Interactive UI deadline: Open in chat scrolls to exact originating message' });
    expect(workspace.keyboard).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ options: expect.objectContaining({ metaKey: true, ctrlKey: false }) }));
    expect(Element.prototype.scrollIntoView).toBe(workspace.originalScroll);
  });
});

/** Drive the actual relaunch caller through its normal Keep control. End after
 * read-back rather than fabricating the remaining unrelated Retry/Save journey. */
describe('interactive relaunch consumes independent normal Keep proof', () => {
  beforeEach(() => { vi.resetAllMocks(); vi.useRealTimers(); vi.stubGlobal('window', {}); vi.stubGlobal('location', { href: 'http://tauri.localhost/?piInteractiveTest=relaunch' }); });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  function keepWorkspace(corruption?: 'version' | 'decisions' | 'markdown' | 'title' | 'path', mountingCheckpoint = false) {
    const workspace = compactWorkspace();
    const before: ChatProposalDraft = { version: 4, markdown: 'Actual retained review body.', title: 'Reviewed title', path: '/vault/Reviewed title.md',
      decisions: [{ id: 'hunk', status: 'modified', from: 0, to: 28, baseFrom: 0, baseTo: 0, proposedFrom: 0, proposedTo: 28, oldText: '', newText: 'Initial body' }] };
    const mounted = structuredClone(before);
    if (mountingCheckpoint) {
      before.version = 1; before.decisions = [];
      mounted.version = 2; mounted.decisions[0].status = 'pending';
    }
    const expectedKeepVersion = mounted.version + 1;
    let durable = structuredClone(mounted), clicked = false, readBack = false, reads = 0;
    const published: Array<{ receipts: { publicationPlans?: { kept?: SharedKeepPlan }; kept?: unknown }; error?: string }> = [];
    const editorPane = { querySelector: () => ({ value: before.title }) };
    const state = EditorState.create({ doc: mounted.markdown, extensions: [documentReviewField] }).update({ effects: setDocumentReview.of({ reviewId: 'exact-review', hunks: mounted.decisions }) }).state;
    const view = { dom: { isConnected: true, closest: () => editorPane }, state: { doc: state.doc, field: (field: unknown) => field === reviewProjection ? state.field(documentReviewField) : undefined } };
    vi.spyOn(EditorView, 'findFromDOM').mockReturnValue(view as unknown as EditorView);
    const picker = { disabled: false, textContent: 'Conversations', getAttribute: () => null, click: vi.fn() };
    const item = { textContent: 'Pi interactive A', click: vi.fn() };
    Object.assign(workspace.pane, { querySelectorAll: (selector: string) => selector === 'button' ? [picker] : [item] });
    const keep = { disabled: false, textContent: 'Keep All', getAttribute: () => null, click: vi.fn(() => {
      const plan = published.at(-1)?.receipts.publicationPlans?.kept;
      expect(plan).toMatchObject({ proposalId: 'keep', reviewId: 'exact-review', reviewedDraft: mounted, expectedKeepDraft: { version: expectedKeepVersion, decisions: [{ status: 'kept' }] } });
      clicked = true;
      durable = { ...structuredClone(mounted), version: corruption === 'version' ? 19 : expectedKeepVersion,
        decisions: mounted.decisions.map(hunk => ({ ...hunk, status: corruption === 'decisions' ? 'modified' : 'kept' })) };
    }) };
    const queryAll = document.querySelectorAll.bind(document);
    Object.assign(document, {
      querySelector: (selector: string) => selector.includes('data-proposal-strip') ? { querySelectorAll: () => [keep] } : {},
      querySelectorAll: (selector: string) => selector === '[data-testid="note-editor"] .cm-editor' ? [view.dom] : queryAll(selector),
    });
    mocks.state.mockReturnValue({ interactiveStateJson: JSON.stringify({ a: 'a', keepId: 'keep', discardId: 'discard', interruptedId: 'interrupted', editedBody: before.markdown, editedTitle: before.title }) });
    mocks.conversation.mockResolvedValue({ title: 'Pi interactive A', model: 'pi-native-fixture-b', messages: [{ id: 'interrupted', status: 'error', content: 'Acknowledged partial fixture text.' }] });
    mocks.pending.mockImplementation(async () => {
      if (readBack) throw new Error('Observed end of normal Keep proof');
      return clicked ? [] : [{ id: 'keep', noteId: null, preview: { reviewId: 'exact-review' } }];
    });
    mocks.draft.mockImplementation(async () => {
      reads++;
      // The relaunch caller reads its staged snapshot after acquiring the view;
      // the next normal mount acknowledgement has seeded hunk decisions.
      const value = structuredClone(mountingCheckpoint && reads <= 2 ? before : durable);
      if (reads === 2 && (corruption === 'markdown' || corruption === 'title' || corruption === 'path')) value[corruption] += ' changed';
      return value;
    });
    const receipt = { status: 'committed', noteId: 'stable', applied: { kind: 'createNote', path: before.path, previousPath: null }, committedMarkdown: before.markdown, message: null };
    mocks.commit.mockResolvedValue(receipt);
    mocks.invoke.mockImplementation(async (command, payload) => {
      if (command === 'pi_probe_config') return { fixture: true, interactiveGate: true };
      if (command === 'pi_ui_report') published.push(structuredClone(payload.report));
      if (command === 'read_note') { readBack = true; return { noteId: 'stable', path: before.path, title: before.title, markdown: before.markdown }; }
    });
    return { keep, published, before, mounted, receipt };
  }

  it('records the full pre-click prediction and uses its version/body for duplicate Keep and canonical read-back', async () => {
    const workspace = keepWorkspace();
    const report = await runInteractiveProbe();
    expect(workspace.keep.click).toHaveBeenCalledOnce();
    expect(mocks.commit).toHaveBeenCalledExactlyOnceWith('keep', workspace.before.markdown, 5);
    expect(mocks.invoke).toHaveBeenCalledWith('read_note', { noteId: 'stable', path: workspace.before.path });
    expect(report).toMatchObject({ receipts: { kept: workspace.receipt } });
    expect(report?.error).toBe('Error: Observed end of normal Keep proof');
  });

  it.each(['version', 'decisions'] as const)('rejects wrong normal Keep %s before any duplicate commit', async corruption => {
    const workspace = keepWorkspace(corruption);
    expect(await runInteractiveProbe()).toMatchObject({ status: 'failed', error: 'Error: Normal shared Keep checkpoint differs from independently predicted full draft' });
    expect(workspace.keep.click).toHaveBeenCalledOnce();
    expect(workspace.published.some(report => report.receipts.publicationPlans?.kept)).toBe(true);
    expect(mocks.commit).not.toHaveBeenCalled();
    expect(mocks.invoke.mock.calls.some(([command]) => command === 'read_note')).toBe(false);
  });

  it('allows an initial v1 draft without decisions to mount/acknowledge pending hunks at v2 and predicts Keep v3', async () => {
    const workspace = keepWorkspace(undefined, true);
    const report = await runInteractiveProbe();
    expect(workspace.before).toMatchObject({ version: 1, decisions: [] });
    expect(workspace.keep.click).toHaveBeenCalledOnce();
    expect(mocks.commit).toHaveBeenCalledExactlyOnceWith('keep', workspace.before.markdown, 3);
    expect(report).toMatchObject({ receipts: { publicationPlans: { kept: { reviewedDraft: workspace.mounted, expectedKeepDraft: { version: 3 } } }, kept: workspace.receipt } });
    expect(report?.error).toBe('Error: Observed end of normal Keep proof');
  });

  it.each(['version', 'decisions'] as const)('still rejects wrong post-Keep %s after mount acknowledgement advances the staged snapshot', async corruption => {
    const workspace = keepWorkspace(corruption, true);
    expect(await runInteractiveProbe()).toMatchObject({ status: 'failed', error: 'Error: Normal shared Keep checkpoint differs from independently predicted full draft' });
    expect(workspace.keep.click).toHaveBeenCalledOnce();
    expect(mocks.commit).not.toHaveBeenCalled();
  });

  it.each(['markdown', 'title', 'path'] as const)('retains caller-authored %s comparison before clicking Keep', async corruption => {
    const workspace = keepWorkspace(corruption, true);
    const report = await runInteractiveProbe();
    expect(report?.status).toBe('failed');
    // Relaunch already checks its persisted title; body/path are checked by the
    // common proveKeep callback against the mounted acknowledgement.
    expect(report?.error).toBe(corruption === 'title' ? 'Error: Relaunch lost reviewed edits' : 'Error: Mounted shared review changed caller-authored body, title or path');
    expect(workspace.keep.click).not.toHaveBeenCalled();
    expect(mocks.commit).not.toHaveBeenCalled();
  });
});
