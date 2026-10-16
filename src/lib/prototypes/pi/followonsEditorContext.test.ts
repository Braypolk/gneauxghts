import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorState, EditorSelection } from '@codemirror/state';
import { fauxAssistantMessage } from '@earendil-works/pi-ai/providers/faux';
import type { ConversationId, EntryRecord } from '@earendil-works/pi-durable';
import { collapseFollowonsEditorSelections, settleFollowonsEditorSelections } from './followonsEditorContext';
import { REQUEST_KIND, safeHistory, type RequestSnapshot } from './lifecycle';
import { EditorDocumentRuntime } from '$lib/features/notepad/editor/editorDocumentRuntime';
import { createRuntimePane } from '$lib/features/notepad/editor/testSupport';

// Node has no mounted browser DOM. Exercise the retained editor runtime's public
// pane seam and real CodeMirror transactions. The native probe separately finds
// and checks actual mounted EditorViews; no private view implementation is used.
const runtimes: EditorDocumentRuntime[] = [];
afterEach(() => { for (const runtime of runtimes.splice(0)) runtime.destroy(); vi.useRealTimers(); vi.unstubAllGlobals(); });
function editor(initial: EditorState) {
  const runtime = new EditorDocumentRuntime(initial.doc.toString());runtimes.push(runtime);
  const { view } = createRuntimePane(runtime, initial.doc.toString(), initial.selection.main.head, undefined, [EditorState.allowMultipleSelections.of(true)]);
  view.dispatch({ selection: initial.selection });
  const dispatch = vi.spyOn(view, 'dispatch');
  return { view, transactions: () => dispatch.mock.calls.length };
}

describe('source-free native follow-on fixture editor setup', () => {
  it('collapses inherited real CodeMirror selections without changing text, then retains source-free history under actual policy', () => {
    const doc = 'Synthetic dirty ordinary orchard edit remains selected';
    const value = editor(EditorState.create({ doc, selection: { anchor: 0, head: 45 } }));
    const history = () => {
      const selected = value.view.state.sliceDoc(value.view.state.selection.main.from, value.view.state.selection.main.to);
      const snapshot: RequestSnapshot = { version: 1, input: { conversationId: 'pi-1', content: 'PI_FOLLOWONS:WARMUP:run_0' },
        settings: { provider: 'local', model: 'm', reasoningEffort: 'off', serviceTier: 'standard', localBaseUrl: 'http://localhost:1234' },
        history: [], createdAtMillis: 1, retryOf: null, origin: null,
        evidence: { sessionId: 'e', context: [{ kind: 'adjacent_editor_hint', noteId: 'note', ...(selected ? { selection: selected } : {}) }], selectedNoteIds: [], grants: [] } };
      const entries = [
        { id: 1, conversationId: 1 as ConversationId, kind: REQUEST_KIND, data: snapshot, model: [{ role: 'user', content: snapshot.input.content, timestamp: 1 }] },
        { id: 2, conversationId: 1 as ConversationId, kind: 'pi.generation', model: [fauxAssistantMessage('Synthetic warmup background.')] }
      ] as unknown as EntryRecord[];
      return safeHistory(entries, new Set());
    };
    expect(history().map(message => message.role)).toEqual(['user']);
    expect(collapseFollowonsEditorSelections([value.view])).toEqual({ editorCount: 1, selectedBefore: 1, selectedAfter: 0 });
    expect(value.transactions()).toBe(1);expect(value.view.state.selection.main.head).toBe(45);
    expect(value.view.state.doc.toString()).toBe(doc);
    expect(history().map(message => message.role)).toEqual(['user', 'assistant']);
  });

  it('clears every selected range and leaves already collapsed editors untouched', () => {
    const multi = editor(EditorState.create({ doc: '0123456789', selection: EditorSelection.create([EditorSelection.range(0, 2), EditorSelection.range(4, 8)], 1), extensions: [EditorState.allowMultipleSelections.of(true)] }));
    const empty = editor(EditorState.create({ doc: 'unchanged', selection: { anchor: 3 } }));
    expect(collapseFollowonsEditorSelections([multi.view, empty.view])).toEqual({ editorCount: 2, selectedBefore: 1, selectedAfter: 0 });
    expect(multi.view.state.selection.ranges.every(range => range.empty)).toBe(true);
    expect(multi.view.state.selection.main.head).toBe(8);expect(empty.transactions()).toBe(0);
    expect(empty.view.state.doc.toString()).toBe('unchanged');
    expect(collapseFollowonsEditorSelections([])).toEqual({ editorCount: 0, selectedBefore: 0, selectedAfter: 0 });
  });

  it('fails closed if the owning editor does not acknowledge the selection transaction', () => {
    const state = EditorState.create({ doc: 'selected', selection: { anchor: 0, head: 8 } });
    expect(() => collapseFollowonsEditorSelections([{ state, dispatch: () => {} }])).toThrow('still have selected editor content');
  });

  it('verifies retained editor selection after two bounded yields when native frames stop', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const value = editor(EditorState.create({ doc: 'retained text', selection: { anchor: 0, head: 8 } }));
    let finished = false;
    const pending = settleFollowonsEditorSelections([value.view]).then(setup => { finished = true; return setup; });
    await vi.advanceTimersByTimeAsync(50);
    expect(finished).toBe(false);
    await vi.advanceTimersByTimeAsync(50);
    expect(await pending).toEqual({ editorCount: 1, selectedBefore: 1, selectedAfter: 0 });
    expect(value.view.state.selection.ranges.every(range => range.empty)).toBe(true);
    expect(value.view.state.doc.toString()).toBe('retained text');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('still rejects a selection reintroduced during the bounded yields', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const value = editor(EditorState.create({ doc: 'retained text' }));
    const pending = expect(settleFollowonsEditorSelections([value.view])).rejects.toThrow('Editor selection changed before source-free warmups');
    await vi.advanceTimersByTimeAsync(50);
    value.view.dispatch({ selection: { anchor: 0, head: 8 } });
    await vi.advanceTimersByTimeAsync(50);
    await pending;
  });
});
