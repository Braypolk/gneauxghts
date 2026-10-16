import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorView } from '@codemirror/view';
import type { ChatMessage } from '$lib/features/chat/types';
import type { SuspensionOrdinary } from './supplementalSuspensionProbe';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('$lib/features/chat/api', () => ({ chatApi: {} }));
vi.mock('./nativeProvider', () => ({ nativeTransportStats: {} }));
import { openSource } from './interactiveProbe';

const expected: SuspensionOrdinary = { noteId: 'ordinary-note', path: '/synthetic/Ordinary.md', title: 'Ordinary',
  markdown: 'Authored ordinary scratch bytes after the previous orchard read.' };
const message = { id: 'fresh-read-message', citations: [{ kind: 'note', label: 'Orchard', noteId: expected.noteId }] } as ChatMessage;
function editor(markdown: string, title: string) {
  const titleField = { value: title };
  return { state: { doc: { toString: () => markdown } }, dom: {
    isConnected: true, closest: () => ({ querySelector: () => titleField })
  } } as unknown as EditorView;
}
function citation(onClick: () => void, options: { hidden?: boolean; disabled?: boolean } = {}) {
  return { textContent: 'Orchard', disabled: options.disabled ?? false,
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
    const row = { scrollIntoView: vi.fn(), querySelectorAll: vi.fn(() => [disabled, hidden, fresh]) };
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
    expect(row.querySelectorAll).toHaveBeenCalledExactlyOnceWith('button[data-slot="inline-citation"]');
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
    const row = { scrollIntoView: vi.fn(), querySelectorAll: () => [fresh] };
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
});
