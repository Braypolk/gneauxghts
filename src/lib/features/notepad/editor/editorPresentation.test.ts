import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { markdown } from '@codemirror/lang-markdown';
import { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { settleEditorPresentation } from './editorPresentation';

// Browser regressions cover real CodeMirror geometry. Here only geometry and
// frame delivery are controlled to detect avoidable readiness waits reliably.
function measuredEditor() {
  let state = EditorState.create({ doc: '## Heading\n\nFormatted text', extensions: [markdown()] });
  return {
    get state() { return state; },
    viewport: { from: 0, to: state.doc.length },
    scrollDOM: { scrollTop: 0, scrollHeight: 1500, clientHeight: 500 },
    requestMeasure() {},
    coordsAtPos() { return null; },
    dispatch(spec: Parameters<EditorState['update']>[0]) { state = state.update(spec).state; }
  } as unknown as EditorView;
}

describe('editor presentation latency', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      setTimeout(() => callback(performance.now()), 16));
    vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('presents an already formatted, measured note after the first frame', async () => {
    let presented = false;
    void settleEditorPresentation(measuredEditor(), () => true)
      .then(result => { presented = result; });
    await vi.advanceTimersByTimeAsync(16);
    expect(presented).toBe(true);
  });

  it('restores a stable saved scroll without waiting extra frames', async () => {
    const view = measuredEditor();
    let presented = false;
    void settleEditorPresentation(view, () => true, { scrollTop: 800 })
      .then(result => { presented = result; });
    await vi.advanceTimersByTimeAsync(16);
    expect(presented).toBe(true);
    expect(view.scrollDOM.scrollTop).toBe(800);
  });

  it('does not present a note canceled during the first frame', async () => {
    let current = true;
    const pending = settleEditorPresentation(measuredEditor(), () => current);
    current = false;
    await vi.advanceTimersByTimeAsync(16);
    expect(await pending).toBe(false);
  });

  it('finishes measurement when native frame callbacks are suspended', async () => {
    vi.stubGlobal('requestAnimationFrame', () => 1);
    const pending = settleEditorPresentation(measuredEditor(), () => true);
    await vi.advanceTimersByTimeAsync(50);
    expect(await pending).toBe(true);
  });
});
