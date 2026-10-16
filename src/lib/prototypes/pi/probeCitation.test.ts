import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { observeStaleProbeCitation } from './probeCitation';
import { renderChatMarkdown } from '$lib/features/chat/ui/chatMarkdown';
import type { ChatCitation } from '$lib/features/chat/types';

const until = async <V>(read: () => V | Promise<V>, label: string): Promise<NonNullable<V>> => {
  for (let poll = 0; poll < 3; poll++) { const value = await read(); if (value) return value as NonNullable<V>; }
  throw new Error(`deadline: ${label}`);
};

function workspace() {
  const state = { connected: true, hidden: false, inert: false, disabled: false, issued: true, messageVisible: true,
    foreignPane: false, marker: false, markerVisible: true, errorVisible: true, error: '', preexisting: false,
    noOp: false, withheld: true, paneVisible: true, footerVisible: true, replaceMessage: false, oldConnected: true };
  let working = { paneId: 'editor-1', editorIdentity: 'retained', membership: ['editor-1'], markdown: 'Retained authored body', title: 'Retained title', selection: { anchor: 4, head: 8 } };
  const control = { get isConnected() { return state.connected; }, get disabled() { return state.disabled; },
    get dataset() { return { chatNoteCitationId: state.issued ? 'issued-source' : 'foreign-source' }; },
    closest: () => state.hidden || state.inert ? {} : null, getClientRects: () => state.hidden ? [] : [1],
    click: vi.fn(() => { if (!state.noOp) state.error = 'Unable to open the referenced note.'; }) };
  const oldControl = { ...control, get isConnected() { return state.oldConnected; }, click: vi.fn() };
  const marker = { textContent: '[citation unavailable]', isConnected: true, closest: () => null,
    getClientRects: () => state.markerVisible ? [1] : [] };
  const message = { isConnected: true, closest: (selector: string) => selector === '[data-testid="workspace-pane"]' ? state.foreignPane ? {} : pane : null,
    getClientRects: () => state.messageVisible ? [1] : [],
    querySelectorAll: (selector: string) => selector === 'button[data-chat-note-citation-id]' ? state.marker ? [] : [control]
      : selector === 'span[data-chat-selection-ignore]' && state.marker ? [marker] : [] };
  const oldMessage = { ...message, querySelectorAll: () => [oldControl] };
  const pane = { isConnected: true, dataset: { paneKind: 'chat' }, closest: () => null,
    getClientRects: () => state.paneVisible ? [1] : [],
    querySelector: vi.fn((selector: string) => selector === '[data-chat-message-id="answer-42"]' ? state.replaceMessage ? oldMessage : message : null) };
  const alert = { isConnected: true, closest: () => null, getClientRects: () => state.errorVisible ? [1] : [],
    querySelector: () => ({ textContent: state.error }) };
  const footer = { isConnected: true, closest: () => null, getClientRects: () => state.footerVisible ? [1] : [],
    querySelectorAll: () => state.error ? [alert] : [] };
  const input = { messageId: 'answer-42', citationIds: ['issued-source'], pane: pane as unknown as HTMLElement,
    errorRoot: footer as unknown as HTMLElement, until, change: vi.fn(async () => {}),
    unavailable: vi.fn(async () => state.withheld), working: vi.fn(() => structuredClone(working)) };
  return { state, input, control, oldControl, pane, footer, setWorking: (change: Partial<typeof working>) => { working = { ...working, ...change }; } };
}

describe('stale citation fixture refusal proof', () => {
  beforeEach(() => { vi.stubGlobal('getComputedStyle', () => ({ visibility: 'visible' })); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('accepts the exact native-string fallback only with current API withholding and unchanged retained editor evidence', async () => {
    const fixture = workspace();
    const result = await observeStaleProbeCitation(fixture.input);
    expect(result).toMatchObject({ mode: 'navigation-error', citationId: 'issued-source', message: 'Unable to open the referenced note.', apiWithheld: true });
    expect(result.workingAfter).toEqual(result.workingBefore);
    expect(fixture.control.click).toHaveBeenCalledOnce();
    expect(fixture.input.unavailable).toHaveBeenCalledOnce();
  });

  it('reacquires the exact connected message after native editing replaces its DOM', async () => {
    const fixture = workspace(); fixture.state.replaceMessage = true;
    fixture.input.change.mockImplementation(async () => { fixture.state.oldConnected = false; fixture.state.replaceMessage = false; });
    await observeStaleProbeCitation(fixture.input);
    expect(fixture.oldControl.click).not.toHaveBeenCalled();
    expect(fixture.control.click).toHaveBeenCalledOnce();
    expect(fixture.pane.querySelector.mock.calls.every(([selector]) => selector === '[data-chat-message-id="answer-42"]')).toBe(true);
  });

  it.each(['connected', 'messageVisible', 'paneVisible', 'footerVisible'] as const)('rejects disconnected or invisible normal ownership (%s)', async flag => {
    const fixture = workspace(); fixture.state[flag] = false;
    await expect(observeStaleProbeCitation(fixture.input)).rejects.toThrow(/visible normal chat|visible exact source/);
    expect(fixture.control.click).not.toHaveBeenCalled();
  });

  it.each(['hidden', 'inert', 'disabled', 'foreignPane'] as const)('does not click an unusable or foreign source control (%s)', async flag => {
    const fixture = workspace(); fixture.state[flag] = true;
    await expect(observeStaleProbeCitation(fixture.input)).rejects.toThrow('visible exact source');
    expect(fixture.control.click).not.toHaveBeenCalled();
  });

  it('rejects a visible source with an unissued citation identity', async () => {
    const fixture = workspace(); fixture.state.issued = false;
    await expect(observeStaleProbeCitation(fixture.input)).rejects.toThrow('visible exact source');
    expect(fixture.control.click).not.toHaveBeenCalled();
  });

  it('does not accept a preexisting exact fallback alert after a no-op citation click', async () => {
    const fixture = workspace(); fixture.state.error = 'Unable to open the referenced note.'; fixture.state.noOp = true;
    await expect(observeStaleProbeCitation(fixture.input)).rejects.toThrow('new normal stale-source refusal');
    expect(fixture.control.click).toHaveBeenCalledOnce();
  });

  it('does not borrow a matching error from a foreign pane or global alert', async () => {
    const fixture = workspace(); fixture.state.noOp = true;
    vi.stubGlobal('document', { querySelectorAll: () => [{ textContent: 'Unable to open the referenced note.' }] });
    await expect(observeStaleProbeCitation(fixture.input)).rejects.toThrow('new normal stale-source refusal');
  });

  it('rejects hidden action errors and unrelated new errors containing stale-source keywords', async () => {
    for (const text of ['Unable to open the referenced note.', 'Checkpoint changed; refresh the model settings']) {
      const fixture = workspace();
      fixture.control.click.mockImplementation(() => { fixture.state.error = text; fixture.state.errorVisible = text !== 'Unable to open the referenced note.'; });
      await expect(observeStaleProbeCitation(fixture.input)).rejects.toThrow('new normal stale-source refusal');
    }
  });

  it('rejects the generic fallback if the current API still authorizes the stale passage', async () => {
    const fixture = workspace(); fixture.state.withheld = false;
    await expect(observeStaleProbeCitation(fixture.input)).rejects.toThrow('exact stale passage withheld');
  });

  it.each(['paneId', 'editorIdentity', 'membership', 'markdown', 'title', 'selection'] as const)('rejects navigation that changes retained editor %s despite refusal and API withholding', async field => {
    const fixture = workspace();
    fixture.control.click.mockImplementation(() => {
      fixture.state.error = 'Unable to open the referenced note.';
      const changed = field === 'selection' ? { anchor: 0, head: 0 } : field === 'membership' ? ['replacement'] : 'replacement';
      fixture.setWorking({ [field]: changed });
    });
    await expect(observeStaleProbeCitation(fixture.input)).rejects.toThrow('changed retained editor');
  });

  it('recognizes the actual renderer unavailable marker only with API withholding and unchanged editor proof', async () => {
    const html = renderChatMarkdown('Evidence. [Source 1](passage:issued-passage)', []);
    expect(html).toContain('<span data-chat-selection-ignore>[citation unavailable]</span>');
    expect(html).not.toContain('data-chat-note-citation-id');
    const fixture = workspace(); fixture.state.marker = true;
    expect(await observeStaleProbeCitation(fixture.input)).toMatchObject({ mode: 'withheld-source', citationId: null, message: '[citation unavailable]', apiWithheld: true });
    expect(fixture.control.click).not.toHaveBeenCalled();
    fixture.state.withheld = false;
    await expect(observeStaleProbeCitation(fixture.input)).rejects.toThrow('exact stale passage withheld');
    fixture.state.markerVisible = false;
    await expect(observeStaleProbeCitation(fixture.input)).rejects.toThrow('visible exact source');
  });

  it('matches the actual visible Markdown source button identity rather than the hidden evidence badge', () => {
    const citation: ChatCitation = { id: 'issued-source', kind: 'note', label: 'Orchard', noteId: 'orchard', notePath: '/vault/Orchard.md', sectionLabel: null, startLine: null, excerpt: null,
      passage: { id: 'issued-passage', noteId: 'orchard', contentHash: 'hash', location: 'body', start: 0, end: 4, excerpt: 'Body', revisions: [] } };
    const html = renderChatMarkdown('Evidence. [Source 1](passage:issued-passage)', [citation]);
    expect(html).toContain('data-chat-note-citation-id="issued-source"');
    expect(html).not.toContain('data-slot="inline-citation"');
  });
});
