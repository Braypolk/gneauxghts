import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorView } from '@codemirror/view';
import { render } from 'svelte/server';
import { renderChatMarkdown } from '$lib/features/chat/ui/chatMarkdown';
import EvidenceSource from '$lib/features/chat/ui/EvidenceSource.svelte';
import Sources from '$lib/components/ai-elements/sources/sources.svelte';
import type { ChatCitation, ChatMessage } from '$lib/features/chat/types';
import type { SuspensionOrdinary } from './supplementalSuspensionProbe';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('$lib/features/chat/api', () => ({ chatApi: {} }));
vi.mock('./nativeProvider', () => ({ nativeTransportStats: {} }));
import { openSource } from './interactiveProbe';

const expected: SuspensionOrdinary = { noteId: 'ordinary-note', path: '/synthetic/Ordinary.md', title: 'Ordinary',
  markdown: 'Authored ordinary scratch bytes after the previous orchard read.' };
const admitted: Extract<ChatCitation, { kind: 'note' }> = { id: 'fresh-source', kind: 'note', label: 'Orchard', noteId: expected.noteId!,
  notePath: expected.path!, sectionLabel: null, startLine: null, excerpt: 'Actually read text',
  passage: { id: 'fresh-passage', noteId: expected.noteId!, contentHash: 'hash', location: 'body', start: 0, end: 18, excerpt: 'Actually read text', revisions: [] } };
const message = { id: 'fresh-read-message', citations: [admitted] } as ChatMessage;
function editor(markdown: string, title: string) {
  const titleField = { value: title };
  return { state: { doc: { toString: () => markdown } }, dom: {
    isConnected: true, closest: () => ({ querySelector: () => titleField })
  } } as unknown as EditorView;
}
function citation(onClick: () => void, options: { hidden?: boolean; disabled?: boolean; id?: string } = {}) {
  return { textContent: 'Orchard', isConnected: true, disabled: options.disabled ?? false,
    getAttribute: (name: string) => name === 'data-chat-note-citation-id' ? options.id ?? admitted.id : null,
    closest: () => options.hidden ? {} : null, getClientRects: () => [1], click: vi.fn(onClick) };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('normal current-source navigation from the exact message', () => {
  it('ignores an earlier same-labelled citation and acquires the exact edited body/title from the fresh message', async () => {
    const staleView = editor('The orchard still has its earlier bytes.', expected.title);
    const wrongTitleView = editor(expected.markdown, 'Another title');
    const exactView = editor(expected.markdown, expected.title);
    const editorNodes = [{ view: staleView }, { view: wrongTitleView }, { view: exactView }];
    const stale = citation(() => {}), hidden = citation(() => {}, { hidden: true }), disabled = citation(() => {}, { disabled: true });
    const fresh = citation(() => {});
    const oldRow = { querySelectorAll: vi.fn(() => [stale]) };
    const row = { isConnected: true, scrollIntoView: vi.fn(), querySelectorAll: vi.fn(() => [disabled, hidden, fresh]) };
    const querySelector = vi.fn((selector: string) => selector === '[data-chat-message-id="fresh-read-message"]' ? row : oldRow);
    // Keep a globally earlier same-labelled button: the former unscoped query
    // would click it and return the stale orchard editor immediately.
    const querySelectorAll = vi.fn((selector: string) => selector === 'button[data-slot="inline-citation"]'
      ? [stale, fresh] : selector === '[data-testid="note-editor"] .cm-editor' ? editorNodes : []);
    vi.stubGlobal('document', { querySelector, querySelectorAll });
    vi.stubGlobal('getComputedStyle', () => ({ visibility: 'visible' }));
    vi.spyOn(EditorView, 'findFromDOM').mockImplementation(node => (node as unknown as { view: EditorView }).view);

    expect(await openSource(message, expected)).toBe(exactView);
    expect(querySelector).toHaveBeenCalledWith('[data-chat-message-id="fresh-read-message"]');
    expect(row.scrollIntoView).toHaveBeenCalledExactlyOnceWith({ block: 'nearest' });
    expect(row.querySelectorAll).toHaveBeenCalledExactlyOnceWith('button[data-chat-note-citation-id]');
    expect(fresh.click).toHaveBeenCalledOnce();
    expect(stale.click).not.toHaveBeenCalled(); expect(hidden.click).not.toHaveBeenCalled(); expect(disabled.click).not.toHaveBeenCalled();
    expect(oldRow.querySelectorAll).not.toHaveBeenCalled();
    expect(querySelectorAll).not.toHaveBeenCalledWith('button[data-slot="inline-citation"]');
  });

  it('waits for exact source bytes and title after the normal click instead of accepting a retained stale editor', async () => {
    vi.useFakeTimers();
    const staleView = editor('Retained stale orchard bytes.', expected.title);
    const wrongTitleView = editor(expected.markdown, 'Wrong title');
    const exactView = editor(expected.markdown, expected.title);
    let currentViews = [staleView, wrongTitleView];
    const fresh = citation(() => { setTimeout(() => { currentViews = [staleView, wrongTitleView, exactView]; }, 60); });
    const row = { isConnected: true, scrollIntoView: vi.fn(), querySelectorAll: () => [fresh] };
    vi.stubGlobal('document', { querySelector: () => row, querySelectorAll: () => currentViews.map(view => ({ view })) });
    vi.stubGlobal('getComputedStyle', () => ({ visibility: 'visible' }));
    vi.spyOn(EditorView, 'findFromDOM').mockImplementation(node => (node as unknown as { view: EditorView }).view);

    let settled = false;
    const opening = openSource(message, expected).then(view => { settled = true; return view; });
    await vi.advanceTimersByTimeAsync(0);
    expect(fresh.click).toHaveBeenCalledOnce(); expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(60);
    expect(await opening).toBe(exactView);
  });

  it('uses the real Markdown citation markup while Sources is collapsed and rejects same-labelled wrong IDs', async () => {
    vi.useFakeTimers();
    const foreign = { ...admitted, id: 'wrong-source', noteId: 'another-note', passage: { ...admitted.passage!, id: 'wrong-passage', noteId: 'another-note' } };
    const marked = { ...message, citations: [admitted, foreign], content: '[Orchard](passage:wrong-passage) [Orchard](passage:fresh-passage)' };
    const markup = renderChatMarkdown(marked.content, marked.citations);
    const ids = [...markup.matchAll(/<button\b[^>]*data-chat-note-citation-id="([^"]+)"[^>]*>/g)].map(match => match[1]);
    expect(ids).toEqual([foreign.id, foreign.id, admitted.id, admitted.id]);
    expect(markup).not.toContain('data-slot="inline-citation"');
    expect(render(EvidenceSource, { props: { citation: admitted, index: 1 } }).body).toContain('data-slot="inline-citation"');
    const sourcesMarkup = render(Sources, { props: { count: 1 } }).body;
    expect(sourcesMarkup).toContain('Show evidence'); expect(sourcesMarkup).toContain('data-state="closed"');
    const controls = ids.map(id => citation(() => {}, { id }));
    const collapsed = citation(() => {}, { hidden: true });
    const row = { isConnected: true, scrollIntoView: vi.fn(), querySelectorAll: vi.fn((selector: string) =>
      selector === 'button[data-chat-note-citation-id]' ? controls : selector === 'button[data-slot="inline-citation"]' ? [collapsed] : []) };
    const exactView = editor(expected.markdown, expected.title);
    vi.stubGlobal('document', { querySelector: () => row, querySelectorAll: () => [{ view: exactView }] });
    vi.stubGlobal('getComputedStyle', () => ({ visibility: 'visible' }));
    vi.spyOn(EditorView, 'findFromDOM').mockImplementation(node => (node as unknown as { view: EditorView }).view);
    const opening = expect(openSource(marked, expected)).resolves.toBe(exactView);
    await vi.advanceTimersByTimeAsync(30001); await opening;
    expect(controls[2].click).toHaveBeenCalledOnce();
    for (const control of [controls[0], controls[1], controls[3], collapsed]) expect(control.click).not.toHaveBeenCalled();
  });

  it('reacquires the exact message row when rendering replaces a collapsed-source-only mount', async () => {
    vi.useFakeTimers();
    const collapsed = citation(() => {}, { hidden: true }), fresh = citation(() => {});
    const oldRow = { isConnected: true, scrollIntoView: vi.fn(), querySelectorAll: () => [collapsed] };
    const newRow = { isConnected: true, scrollIntoView: vi.fn(), querySelectorAll: () => [fresh] };
    let row = oldRow;
    setTimeout(() => { oldRow.isConnected = false; row = newRow; }, 60);
    const exactView = editor(expected.markdown, expected.title), querySelector = vi.fn(() => row);
    vi.stubGlobal('document', { querySelector, querySelectorAll: () => [{ view: exactView }] });
    vi.stubGlobal('getComputedStyle', () => ({ visibility: 'visible' }));
    vi.spyOn(EditorView, 'findFromDOM').mockImplementation(node => (node as unknown as { view: EditorView }).view);
    const opening = expect(openSource(message, expected)).resolves.toBe(exactView);
    await vi.advanceTimersByTimeAsync(30001); await opening;
    expect(querySelector.mock.calls.length).toBeGreaterThan(1);
    expect(fresh.click).toHaveBeenCalledOnce(); expect(collapsed.click).not.toHaveBeenCalled();
    expect(newRow.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
  });
});
