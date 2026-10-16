import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import { createRawSnippet } from 'svelte';
import ChatPanel from '$lib/features/chat/ChatPanel.svelte';
import WorkspaceInputDock from '$lib/features/notepad/ui/WorkspaceInputDock.svelte';
import { createChatController } from '$lib/features/chat/controller.svelte';
import { fakeApi } from '$lib/features/chat/chatTestSupport';
import { focusProbeChatComposer, probeChatPane, probeComposerSend } from './probeChatSend';

const until = async <T>(read: () => T | Promise<T>): Promise<NonNullable<T>> => {
  for (let poll = 0; poll < 5; poll++) { const value = await read(); if (value) return value as NonNullable<T>; }
  throw new Error('Requested composer did not become visible');
};
function surface(shown: boolean) {
  const state = { shown, connected: true, docked: shown, expandAvailable: false };
  const expand = { disabled: false, closest: () => state.expandAvailable ? null : {}, getClientRects: () => state.expandAvailable ? [1] : [],
    click: vi.fn(() => { state.shown = true; state.expandAvailable = false; }) };
  const dock = { querySelector: vi.fn(() => expand) };
  const slot = { closest: () => dock };
  const send = { disabled: false, closest: () => state.shown ? null : {}, getClientRects: () => state.shown ? [1] : [] };
  const root = { querySelector: vi.fn(() => send) };
  const composer = { disabled: false,
    get isConnected() { return state.connected; },
    closest: (selector: string) => selector === '.chat-composer-surface' ? root : selector === '.workspace-chat-slot' ? state.docked ? slot : null : selector === '[data-testid="workspace-pane"]' ? state.docked ? null : {} : state.shown ? null : {},
    getClientRects: () => state.shown ? [1] : [] } as unknown as HTMLTextAreaElement;
  return { state, composer, send, root, expand, dock };
}
function panel(title: string, composer: HTMLTextAreaElement | null, focus: () => void) {
  const state = { localTitle: true, titleVisible: true };
  const field = { value: title, focus: vi.fn(() => { Object.assign(document, { activeElement: field }); focus(); }), closest: () => null, getClientRects: () => [1] };
  field.getClientRects = () => state.titleVisible ? [1] : [];
  const pane = { querySelector: vi.fn((selector: string) => selector === '[aria-label="Chat title"]' ? state.localTitle ? field : null : composer), closest: () => null, getClientRects: () => [1] } as unknown as HTMLElement;
  return { pane, field, state };
}
function install(panes: HTMLElement[], composers: HTMLTextAreaElement[], mobileTitles: unknown[] = []) {
  vi.stubGlobal('getComputedStyle', () => ({ visibility: 'visible' }));
  vi.stubGlobal('document', { querySelectorAll: (selector: string) => selector.startsWith('[data-testid=') ? panes : selector.startsWith('.mobile-workspace-title-slot') ? mobileTitles : composers });
}
afterEach(() => vi.unstubAllGlobals());

describe('normal send with two retained chat panes', () => {
  it('acquires the normal mobile title only for the pane whose title moved to the shared header', async () => {
    const a = surface(true), b = surface(false);
    const active = panel('A', null, () => {}), retained = panel('B', b.composer, () => {});
    active.state.localTitle = false; retained.state.titleVisible = false;
    install([retained.pane, active.pane], [a.composer, b.composer], [active.field]);
    expect(probeChatPane()).toBe(active.pane);
    expect(probeChatPane('A')).toBe(active.pane);
    expect(probeChatPane('B')).toBeUndefined();
    expect(await focusProbeChatComposer(active.pane, until)).toBe(a.composer);
    expect(active.field.focus).toHaveBeenCalledOnce();
    expect(retained.field.focus).not.toHaveBeenCalled();
  });
  it('waits for the exact pane title to mount instead of accepting its visible empty shell', async () => {
    const a = surface(true), requested = panel('A', a.composer, () => {});
    requested.state.localTitle = false;
    install([requested.pane], [a.composer]);
    expect(probeChatPane()).toBeUndefined();
    queueMicrotask(() => { requested.state.localTitle = true; });
    expect(await focusProbeChatComposer(requested.pane, until)).toBe(a.composer);
    expect(requested.field.focus).toHaveBeenCalledOnce();
  });
  it('rejects ambiguous mobile title ownership and hidden mobile titles', async () => {
    const a = surface(true), requested = panel('A', null, () => {}), shell = panel('pending', null, () => {});
    requested.state.localTitle = false; shell.state.localTitle = false;
    install([requested.pane, shell.pane], [a.composer], [requested.field]);
    expect(probeChatPane('A')).toBeUndefined();
    await expect(focusProbeChatComposer(requested.pane, until)).rejects.toThrow('did not become visible');
    expect(requested.field.focus).not.toHaveBeenCalled();
    install([requested.pane], [a.composer], [requested.field, shell.field]);
    expect(probeChatPane()).toBeUndefined();
    requested.state.titleVisible = false;
    install([requested.pane], [a.composer], [requested.field]);
    expect(probeChatPane()).toBeUndefined();
  });
  it('focuses the requested pane and waits for its exact hidden composer to enter the dock', async () => {
    const a = surface(false), b = surface(true);
    const left = panel('A', a.composer, () => queueMicrotask(() => { a.state.shown = true; a.state.docked = true; b.state.shown = false; }));
    const right = panel('B', null, () => {});
    install([left.pane, right.pane], [a.composer, b.composer]);
    const requested = probeChatPane('A')!;
    expect(requested).toBe(left.pane);
    const composer = await focusProbeChatComposer(requested, until);
    expect(composer).toBe(a.composer);
    expect(left.field.focus).toHaveBeenCalledOnce();
    expect(right.field.focus).not.toHaveBeenCalled();
    expect(probeComposerSend(composer)).toBe(a.send);
    expect(a.root.querySelector).toHaveBeenCalledWith('button[aria-label="Send message"]');
    expect(b.root.querySelector).not.toHaveBeenCalled();
  });
  it('does not accept another visible chat composer if requested pane activation fails', async () => {
    const a = surface(false), b = surface(true), left = panel('A', a.composer, () => {});
    install([left.pane], [a.composer, b.composer]);
    await expect(focusProbeChatComposer(left.pane, until)).rejects.toThrow('did not become visible');
  });
  it('acquires the already portaled unique composer of the active requested pane', async () => {
    const a = surface(true), left = panel('A', null, () => {});
    install([left.pane], [a.composer]);
    expect(await focusProbeChatComposer(left.pane, until)).toBe(a.composer);
  });
  it('expands the exact collapsed normal dock after the requested chat title receives focus', async () => {
    const a = surface(false);
    a.state.docked = true; a.state.expandAvailable = true;
    const left = panel('A', null, () => {});
    install([left.pane], [a.composer]);
    a.expand.click.mockImplementation(() => {
      expect(document.activeElement).toBe(left.field);
      a.state.shown = true; a.state.expandAvailable = false;
    });
    expect(await focusProbeChatComposer(left.pane, until)).toBe(a.composer);
    expect(a.expand.click).toHaveBeenCalledOnce();
    expect(a.dock.querySelector).toHaveBeenCalledWith('button[aria-label="Expand chat input"]');
  });
  it('cannot use another pane’s Expand control before the requested composer is relocated', async () => {
    const a = surface(false), b = surface(false);
    b.state.docked = true; b.state.expandAvailable = true;
    const left = panel('A', a.composer, () => {});
    install([left.pane], [a.composer, b.composer]);
    await expect(focusProbeChatComposer(left.pane, until)).rejects.toThrow('did not become visible');
    expect(b.expand.click).not.toHaveBeenCalled();
  });
  it('does not accept a collapsed surface when normal Expand fails to reveal it', async () => {
    const a = surface(false);
    a.state.docked = true; a.state.expandAvailable = true; a.expand.click.mockImplementation(() => {});
    const left = panel('A', null, () => {});
    install([left.pane], [a.composer]);
    await expect(focusProbeChatComposer(left.pane, until)).rejects.toThrow('did not become visible');
    expect(a.expand.click).toHaveBeenCalledOnce();
  });
  it('rejects ambiguous dock ownership and detached stale composers', async () => {
    const a = surface(true), b = surface(true), left = panel('A', null, () => {});
    install([left.pane], [a.composer, b.composer]);
    await expect(focusProbeChatComposer(left.pane, until)).rejects.toThrow('unambiguous retained composer');
    a.state.connected = false;
    const retained = panel('A', a.composer, () => {});
    await expect(focusProbeChatComposer(retained.pane, until)).rejects.toThrow('did not become visible');
  });
  it('requires the requested title and its enabled visible Send control', () => {
    const a = surface(false), b = surface(true);
    const left = panel('A', a.composer, () => {}), right = panel('B', null, () => {});
    install([left.pane, right.pane], [a.composer, b.composer]);
    expect(probeChatPane('B')).toBe(right.pane);
    expect(probeChatPane('missing')).toBeUndefined();
    expect(probeComposerSend(a.composer)).toBeUndefined();
    b.send.disabled = true;
    expect(probeComposerSend(b.composer)).toBeUndefined();
  });
  it('matches the retained ChatPanel hidden composer and same-surface Send contract', async () => {
    const controller = createChatController(fakeApi().api);
    await controller.initialize('conversation-1');
    try {
      const body = render(ChatPanel, { props: { controller, autoInitialize: false, composerDock: { slot: null, expanded: false, onExpand: () => {} } } }).body;
      expect(body).toContain('aria-label="Chat title"');
      expect(body).toMatch(/class="chat-composer-slot[^>]*\bhidden(?:\s|=|>)/);
      const surface = body.indexOf('class="chat-composer-surface');
      expect(surface).toBeGreaterThan(-1);
      expect(body.indexOf('aria-label="Message"')).toBeGreaterThan(surface);
      expect(body.indexOf('aria-label="Send message"')).toBeGreaterThan(body.indexOf('aria-label="Message"'));
    } finally { controller.dispose(); }
  });
  it('matches the real search-mode chat dock and its ordinary expansion control', () => {
    const body = render(WorkspaceInputDock, { props: { hasChat: true, mode: 'search',
      search: createRawSnippet(() => ({ render: () => '<span>Search</span>' })), onSearch: () => {}, onChat: () => {} } }).body;
    expect(body).toContain('data-input-dock-mode="search"');
    expect(body).toContain('class="workspace-chat-slot"');
    expect(body).toMatch(/aria-label="Expand chat input"[^>]*tabindex="0"/);
  });
});
