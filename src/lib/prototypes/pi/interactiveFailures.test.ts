import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorView } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { documentReviewField, reviewProjection, setDocumentReview } from '$lib/features/proposals/reviewExtension';
import { message, proposal } from '$lib/features/chat/chatTestSupport';
import type { ChatProposalDraft } from '$lib/features/chat/types';
import { observeFailureStaleSource, runInteractiveFailures, type InteractiveFailureJourney } from './interactiveFailures';
import type { ChatApi } from '$lib/features/chat/api';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

function compactFailureWorkspace(existingChat = false) {
  const state = { chat: existingChat, picker: false, activeEditor: true, connected: true, paneConnected: true,
    titleConnected: true, titleAvailable: true, ambiguousTitle: false, reviewId: 'review-first',
    splitDisabled: false, splitHidden: false, splitInert: false, ownerStrip: false, replacement: false,
    changeBody: false, changeTitle: false, changeDecisions: false };
  const before: ChatProposalDraft = { version: 2, markdown: 'Synthetic review body', title: 'Synthetic review', path: '/vault/Synthetic review.md',
    decisions: [{ id: 'hunk', status: 'pending', baseFrom: 0, baseTo: 0, proposedFrom: 0, proposedTo: 21, oldText: '', newText: 'Synthetic review body', from: 0, to: 21 }] };
  const title = { get isConnected() { return state.titleConnected; }, get value() { return state.changeTitle ? 'Wrong title' : before.title; },
    closest: () => null, getClientRects: () => [1] };
  const pane = { get isConnected() { return state.paneConnected; }, dataset: { paneKind: 'editor' },
    querySelector: () => !state.activeEditor && state.titleAvailable ? title : null };
  const foreignPane = { querySelector: () => null };
  const dom = { get isConnected() { return state.connected; }, closest: (selector: string) => selector === '[data-testid="workspace-pane"]' ? pane
    : state.activeEditor ? null : {}, getClientRects: () => state.activeEditor ? [1] : [] };
  const projected = EditorState.create({ doc: before.markdown, extensions: [documentReviewField] }).update({
    effects: setDocumentReview.of({ reviewId: 'review-first', hunks: before.decisions }) }).state.field(documentReviewField)!;
  const editor = { dom, state: { doc: { toString: () => state.changeBody ? 'Wrong body' : before.markdown },
    field: (field: unknown) => field === reviewProjection ? { ...projected, reviewId: state.reviewId,
      hunks: state.changeDecisions ? [] : projected.hunks } : undefined } } as unknown as EditorView;
  const chatPane = { dataset: { paneKind: 'chat' } };
  const split = { get disabled() { return state.splitDisabled; }, getAttribute: () => 'Split pane', textContent: '',
    closest: () => state.splitInert ? {} : null, getClientRects: () => state.splitHidden ? [] : [1], focus: vi.fn(),
    click: vi.fn(() => { state.picker = true; }) };
  const option = { disabled: false, closest: () => null, getClientRects: () => [1], focus: vi.fn(),
    click: vi.fn(() => { state.chat = true; state.activeEditor = false; }) };
  const strip = { closest: () => null, getClientRects: () => [1] };
  vi.stubGlobal('getComputedStyle', () => ({ visibility: 'visible' }));
  vi.stubGlobal('document', {
    querySelector: (selector: string) => selector === '[aria-label="Thought partner chat"]' ? state.chat ? chatPane : null
      : selector.includes('data-proposal-strip') && state.ownerStrip ? strip : null,
    querySelectorAll: (selector: string) => selector === 'button' ? [split]
      : selector.includes('data-pane-command') ? state.picker ? [option] : []
      : selector.startsWith('.mobile-workspace-title-slot') ? state.activeEditor && state.titleAvailable ? [title] : []
      : selector.includes('data-pane-kind="editor"') ? state.ambiguousTitle ? [pane, foreignPane] : [pane]
      : selector === '[data-testid="workspace-pane"]' ? state.chat ? [pane, chatPane] : [pane] : [],
  });
  const fault = vi.fn(async () => { throw new Error('Reached exact checkpoint fault boundary'); });
  const selectConversation = vi.fn(async () => {
    // The initial chat selection precedes newProposal/currentReview. Later
    // selection must retain the exact editor rather than replace a solo pane.
    if (selectConversation.mock.calls.length === 1) return;
    if (!state.chat || state.replacement) state.connected = false;
    state.activeEditor = false; state.ownerStrip = true;
  });
  const journey = { api: { getProposalDraft: vi.fn(async () => structuredClone(before)), prototypeFault: fault }, conversationId: 'A', selectConversation,
    newProposal: vi.fn().mockResolvedValueOnce(proposal({ id: 'first', preview: { reviewId: 'review-first' } }))
      .mockResolvedValueOnce(proposal({ id: 'second', preview: { reviewId: 'review-second' } })), currentReview: vi.fn(async () => editor),
  } as unknown as InteractiveFailureJourney;
  return { state, before, journey, split, option, fault, selectConversation };
}

async function failure(workspace: ReturnType<typeof compactFailureWorkspace>) {
  const result = runInteractiveFailures(workspace.journey).catch(error => error.message);
  await vi.runAllTimersAsync();
  return result;
}

describe('actual compact failure acceptance setup', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('captures the exact portaled title, creates a normal retained split and reads its returned local title before fault injection', async () => {
    const workspace = compactFailureWorkspace();
    expect(await failure(workspace)).toBe('Reached exact checkpoint fault boundary');
    expect(workspace.split.click).toHaveBeenCalledOnce();
    expect(workspace.option.click).toHaveBeenCalledOnce();
    expect(workspace.selectConversation).toHaveBeenCalledTimes(2);
    expect(workspace.journey.currentReview).toHaveBeenCalledExactlyOnceWith('first', 'review-first');
    expect(workspace.fault).toHaveBeenCalledExactlyOnceWith('first', 'checkpoint');
    expect(workspace.state.connected).toBe(true);
  });

  it('keeps an existing genuine editor/chat split through owner selection', async () => {
    const workspace = compactFailureWorkspace(true);
    expect(await failure(workspace)).toBe('Reached exact checkpoint fault boundary');
    expect(workspace.split.click).not.toHaveBeenCalled();
    expect(workspace.option.click).not.toHaveBeenCalled();
    expect(workspace.state.connected).toBe(true);
  });

  it.each(['connected', 'paneConnected', 'titleConnected', 'titleAvailable'] as const)('rejects missing mounted ownership (%s) before any split or checkpoint fault', async flag => {
    const workspace = compactFailureWorkspace(); workspace.state[flag] = false;
    expect(await failure(workspace)).toMatch(/identity or connection differs|no corresponding title/);
    expect(workspace.split.click).not.toHaveBeenCalled();
    expect(workspace.fault).not.toHaveBeenCalled();
  });

  it('rejects an equal-text mobile title with ambiguous pane ownership', async () => {
    const workspace = compactFailureWorkspace(); workspace.state.ambiguousTitle = true;
    expect(await failure(workspace)).toBe('Mounted review has no corresponding title input');
    expect(workspace.fault).not.toHaveBeenCalled();
  });

  it('rejects a foreign review with matching title and body', async () => {
    const workspace = compactFailureWorkspace(); workspace.state.reviewId = 'foreign';
    expect(await failure(workspace)).toBe('Mounted failure review identity or connection differs');
    expect(workspace.fault).not.toHaveBeenCalled();
  });

  it('rejects an inert initial editor even if the mobile title is visible', async () => {
    const workspace = compactFailureWorkspace(); workspace.state.activeEditor = false;
    expect(await failure(workspace)).toBe('Failure review editor and title must be visible before capture');
    expect(workspace.fault).not.toHaveBeenCalled();
  });

  it.each(['splitDisabled', 'splitHidden', 'splitInert'] as const)('refuses unusable normal split controls (%s)', async flag => {
    const workspace = compactFailureWorkspace(); workspace.state[flag] = true;
    expect(await failure(workspace)).toContain('visible normal split control');
    expect(workspace.option.click).not.toHaveBeenCalled();
    expect(workspace.fault).not.toHaveBeenCalled();
  });

  it('rejects owner selection that detaches the retained editor', async () => {
    const workspace = compactFailureWorkspace(); workspace.state.replacement = true;
    expect(await failure(workspace)).toBe('Mounted failure review identity or connection differs');
    expect(workspace.fault).not.toHaveBeenCalled();
  });

  it.each(['changeBody', 'changeTitle', 'changeDecisions'] as const)('rejects owner selection that changes acknowledged review fields (%s)', async flag => {
    const workspace = compactFailureWorkspace();
    const select = workspace.journey.selectConversation;
    workspace.journey.selectConversation = async id => { await select(id); if (workspace.selectConversation.mock.calls.length > 1) workspace.state[flag] = true; };
    expect(await failure(workspace)).toMatch(/replaced the working editor|changed the exact acknowledged review/);
    expect(workspace.fault).not.toHaveBeenCalled();
  });
});

function staleCallerWorkspace() {
  const state = { error: '', connected: true, replacement: false, missingEditor: false, ambiguousComposer: false,
    titleAvailable: true, title: 'Retained authored title', paneId: 'editor-1', change: '' };
  let editorState = EditorState.create({ doc: 'Retained authored body' });
  const editorTitle = { isConnected: true, get value() { return state.title; } };
  const editorPane = { isConnected: true, get dataset() { return { paneKind: 'editor', paneId: state.paneId }; },
    querySelector: () => state.titleAvailable ? editorTitle : null };
  const editor = { get state() { return editorState; }, dom: { get isConnected() { return state.connected; }, closest: () => editorPane } } as unknown as EditorView;
  const editorNode = {} as HTMLElement;
  vi.spyOn(EditorView, 'findFromDOM').mockImplementation(() => state.replacement ? { ...editor } as EditorView : editor);
  const footer = { isConnected: true, closest: () => null, getClientRects: () => [1],
    querySelectorAll: () => state.error ? [{ isConnected: true, closest: () => null, getClientRects: () => [1], querySelector: () => ({ textContent: state.error }) }] : [] };
  const slot = {};
  const composer = { isConnected: true, disabled: false, getClientRects: () => [1],
    closest: (selector: string) => selector === '.chat-composer-footer' ? footer : selector === '.workspace-chat-slot' ? slot : null };
  const chatTitle = { value: 'Chat A', closest: () => null, getClientRects: () => [1],
    focus: vi.fn(() => { Object.assign(document, { activeElement: chatTitle }); }) };
  const control = { isConnected: true, disabled: false, dataset: { chatNoteCitationId: 'issued-source' }, closest: () => null, getClientRects: () => [1],
    click: vi.fn(() => {
      state.error = 'Unable to open the referenced note.';
      if (state.change === 'identity') state.replacement = true;
      if (state.change === 'membership') state.missingEditor = true;
      if (state.change === 'connection') state.connected = false;
      if (state.change === 'title') state.title += ' changed';
      if (state.change === 'pane') state.paneId = 'foreign-editor';
      if (state.change === 'markdown') editorState = editorState.update({ changes: { from: 0, to: editorState.doc.length, insert: 'Opened stale note' } }).state;
      if (state.change === 'selection') editorState = editorState.update({ selection: { anchor: 4 } }).state;
    }) };
  const card = { isConnected: true, closest: (selector: string) => selector === '[data-testid="workspace-pane"]' ? pane : null,
    getClientRects: () => [1], querySelectorAll: () => [control] };
  const pane = { isConnected: true, dataset: { paneKind: 'chat' }, closest: () => null, getClientRects: () => [1],
    querySelector: (selector: string) => selector === '[data-chat-message-id="cited"]' ? card : null };
  vi.stubGlobal('getComputedStyle', () => ({ visibility: 'visible' }));
  vi.stubGlobal('document', { activeElement: null, querySelector: () => card,
    querySelectorAll: (selector: string) => selector === '[data-testid="note-editor"] .cm-editor' ? state.missingEditor ? [] : [editorNode]
      : selector === 'textarea[aria-label="Message"]' ? state.ambiguousComposer ? [composer, { ...composer }] : [composer]
      : selector === '.mobile-workspace-title-slot [aria-label="Chat title"]' ? [chatTitle]
      : selector === '[data-testid="workspace-pane"][data-pane-kind="chat"]' ? [pane]
      : selector === '[data-testid="workspace-pane"][data-pane-kind="editor"]' ? [editorPane] : [] });
  const cited = message({ id: 'cited', conversationId: 'A', citations: [{ id: 'issued-source', kind: 'note', noteId: 'orchard', notePath: '/vault/Orchard.md', label: 'Orchard', sectionLabel: null, startLine: null, excerpt: null,
    passage: { id: 'issued-passage', noteId: 'orchard', contentHash: 'hash', location: 'body', start: 0, end: 4, excerpt: 'Body', revisions: [] } }] });
  const getConversation = vi.fn(async () => ({ messages: [{ ...cited, citations: [] }] }));
  return { state, control, chatTitle, getConversation,
    input: { api: { getConversation } as unknown as ChatApi, conversationId: 'A', cited, noteId: 'orchard', change: vi.fn(async () => {}) } };
}

describe('actual failure-phase stale-source binding', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('uses the exact message owner and normal title focus to bind its portaled composer, current API and retained editor snapshot', async () => {
    const fixture = staleCallerWorkspace();
    const result = await observeFailureStaleSource(fixture.input);
    expect(fixture.chatTitle.focus).toHaveBeenCalledOnce();
    expect(fixture.control.click).toHaveBeenCalledOnce();
    expect(fixture.getConversation).toHaveBeenCalledExactlyOnceWith('A');
    expect(result).toMatchObject({ citationId: 'issued-source', apiWithheld: true,
      workingBefore: [{ paneId: 'editor-1', title: 'Retained authored title', markdown: 'Retained authored body', selection: { ranges: [{ anchor: 0, head: 0 }], main: 0 }, review: null }] });
    expect(result.workingAfter).toEqual(result.workingBefore);
  });

  it.each(['identity', 'membership', 'connection', 'title', 'pane', 'markdown', 'selection'])('rejects real caller snapshot corruption (%s) despite exact normal refusal', async change => {
    const fixture = staleCallerWorkspace(); fixture.state.change = change;
    await expect(observeFailureStaleSource(fixture.input)).rejects.toThrow(/replaced retained editor|changed retained editor/);
  });

  it('does not borrow a foreign mobile title for an unmounted retained editor title', async () => {
    const fixture = staleCallerWorkspace(); fixture.state.titleAvailable = false;
    await expect(observeFailureStaleSource(fixture.input)).rejects.toThrow('lost retained editor pane/title ownership');
    expect(fixture.control.click).not.toHaveBeenCalled();
  });

  it('refuses ambiguous portaled composers before canonical mutation or citation click', async () => {
    const fixture = staleCallerWorkspace(); fixture.state.ambiguousComposer = true;
    await expect(observeFailureStaleSource(fixture.input)).rejects.toThrow('unambiguous retained composer');
    expect(fixture.input.change).not.toHaveBeenCalled();
    expect(fixture.control.click).not.toHaveBeenCalled();
  });

  it('refuses a caller whose admitted passage belongs to a different note', async () => {
    const fixture = staleCallerWorkspace(); fixture.input.noteId = 'foreign-note';
    await expect(observeFailureStaleSource(fixture.input)).rejects.toThrow('no exact admitted note passage');
    expect(fixture.control.click).not.toHaveBeenCalled();
  });
});
