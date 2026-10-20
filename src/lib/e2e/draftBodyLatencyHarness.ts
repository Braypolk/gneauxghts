// Opt-in full-app diagnosis. Shared unchanged by baseline and candidate.
import { EditorView } from '@codemirror/view';
import { ChangeSet, type EditorSelection } from '@codemirror/state';
import { ensureSyntaxTree } from '@codemirror/language';
import { settleEditorPresentation } from '../features/notepad/editor/editorPresentation';

export type DraftLatencyKind = 'multiline500k' | 'multiline2m' | 'fence2m' | 'quote';
const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
function views() {
  return [...document.querySelectorAll<HTMLElement>('[data-testid="note-editor"] .cm-editor')]
    .map(element => EditorView.findFromDOM(element)!);
}
function summary(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  return { median: sorted[Math.floor(sorted.length / 2)], p95: sorted[Math.ceil(sorted.length * .95) - 1], max: sorted.at(-1), samples };
}
function fixture(kind: DraftLatencyKind) {
  if (kind === 'quote') return '> > quoted **bold** text\n'.repeat(50_000) + '\noutside';
  const line = 'Ordinary prose with **bold** and a [link](https://example.com).\n\n';
  const size = kind === 'multiline500k' ? 500_000 : 2_000_000;
  const code = 'const value = 123; // ordinary code\n';
  if (kind === 'fence2m') return '```\n' + code.repeat(Math.ceil(size / code.length)) + '```\n\noutside';
  return line.repeat(Math.ceil(size / line.length));
}
function assertFocus() {
  if (!document.hasFocus() || document.visibilityState !== 'visible') throw new Error('Draft latency measurement lost focus');
}
let source: EditorView;
let editors: EditorView[];
let beforeBody = '';
let insertAt = 0;
let siblingState: { view: EditorView; selection: EditorSelection; top: number }[] = [];
let focusLost = false;
const markBlur = () => { focusLost = true; };
const nativeSamples: { keyToFrame: number; keyToTwoFrames: number; inputToFrame: number | null }[] = [];
let pending: Promise<void> | null = null;
let failure: string | null = null;
let keyCount = 0;
let keydown: ((event: KeyboardEvent) => void) | null = null;
let beforeinput: (() => void) | null = null;

export async function prepare(kind: DraftLatencyKind, panes: number, sourceIndex: number) {
  editors = views();
  if (editors.length !== panes) throw new Error(`Expected ${panes} panes, got ${editors.length}`);
  const native = window.__TAURI_INTERNALS__ as { invoke(command: string, args: object): Promise<unknown> };
  await native.invoke('plugin:window|show', { label: 'main' });
  await native.invoke('plugin:window|set_focus', { label: 'main' });
  const body = fixture(kind);
  editors[0].dispatch({ changes: { from: 0, to: editors[0].state.doc.length, insert: body } });
  for (const [index, view] of editors.entries()) {
    if (view.state.doc.toString() !== body) throw new Error('Fixture panes differ');
    if (!ensureSyntaxTree(view.state, view.state.doc.length, 60_000)) throw new Error('Fixture parse incomplete');
    const line = view.state.doc.line(Math.floor(view.state.doc.lines * (index ? .75 : .25)));
    view.dispatch({ selection: { anchor: line.from + 8, head: line.from + 3 }, effects: EditorView.scrollIntoView(line.from, { y: 'start' }) });
    if (!await settleEditorPresentation(view, () => true)) throw new Error('Presentation failed');
  }
  source = editors[sourceIndex];
  insertAt = source.state.doc.lineAt(source.viewport.from).from + (kind === 'quote' ? 7 : 9);
  source.dispatch({ selection: { anchor: insertAt }, effects: EditorView.scrollIntoView(insertAt, { y: 'center' }) });
  source.focus();
  await sleep(1800); await frame(); await frame();
  assertFocus();
  beforeBody = source.state.doc.toString();
  siblingState = editors.filter(view => view !== source).map(view => ({ view, selection: view.state.selection, top: view.scrollDOM.scrollTop }));
  return { userAgent: navigator.userAgent, width: innerWidth, height: innerHeight, characters: body.length,
    panes: editors.map(view => ({ width: view.dom.clientWidth, height: view.dom.clientHeight, font: getComputedStyle(view.contentDOM).font })), sourceIndex };
}
function verify(count: number) {
  assertFocus();
  if (focusLost) throw new Error('Draft latency measurement lost focus during input');
  const expected = beforeBody.slice(0, insertAt) + 'x'.repeat(count) + beforeBody.slice(insertAt);
  for (const view of editors) if (view.state.doc.toString() !== expected) throw new Error('Lost/reordered typing or sibling divergence');
  const changes = ChangeSet.of({ from: insertAt, insert: 'x'.repeat(count) }, beforeBody.length);
  for (const sibling of siblingState) {
    if (!sibling.view.state.selection.eq(sibling.selection.map(changes)) || Math.abs(sibling.view.scrollDOM.scrollTop - sibling.top) > 1) throw new Error('Typing moved sibling selection or scroll');
  }
  return { exactText: true, panes: editors.length, siblingSelectionAndScroll: true };
}
export function armNative() {
  assertFocus(); focusLost = false; failure = null; keyCount = 0; nativeSamples.length = 0;
  window.addEventListener('blur', markBlur);
  let inputAt: number | null = null;
  beforeinput = () => { inputAt = performance.now(); };
  keydown = event => {
    if (event.key !== 'x') return;
    if (pending) { failure = 'Native sender did not await rendered update'; return; }
    const start = performance.now(); inputAt = null;
    const target = beforeBody.length + ++keyCount;
    pending = (async () => {
      const deadline = start + 15_000;
      do {
        await frame();
        if (performance.now() > deadline) throw new Error('Native character did not reach model/DOM');
      } while (source.state.doc.length !== target || editors.some(view => view.state.doc.length !== target) || !source.contentDOM.textContent?.includes('x'.repeat(keyCount)));
      const first = performance.now();
      // Confirm the edited cursor has laid-out geometry in the visible pane.
      if (!source.coordsAtPos(insertAt + keyCount)) throw new Error('Edited cursor has no geometry');
      await frame();
      nativeSamples.push({ keyToFrame: first - start, keyToTwoFrames: performance.now() - start, inputToFrame: inputAt === null ? null : first - inputAt });
    })().catch(error => { failure = String(error); }).finally(() => { pending = null; });
  };
  source.contentDOM.addEventListener('keydown', keydown, true);
  source.contentDOM.addEventListener('beforeinput', beforeinput, true);
}
export function typeCharacter() {
  assertFocus();
  // The embedded WebDriver's printable keys only emit synthetic keydown; they
  // do not insert into contenteditable. WebKit insertText exercises its native
  // DOM editing/input events and CodeMirror's production DOM observer instead.
  source.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', code: 'KeyX', bubbles: true, cancelable: true }));
  if (!document.execCommand('insertText', false, 'x')) throw new Error('WebKit insertText failed');
}
export async function waitNative() {
  if (pending) await pending;
  if (failure) throw new Error(failure);
  return nativeSamples.length;
}
export function finishNative() {
  if (keydown) source.contentDOM.removeEventListener('keydown', keydown, true);
  if (beforeinput) source.contentDOM.removeEventListener('beforeinput', beforeinput, true);
  window.removeEventListener('blur', markBlur);
  if (failure) throw new Error(failure);
  if (nativeSamples.length !== 25) throw new Error(`Expected 25 native keys, got ${nativeSamples.length}`);
  const retained = nativeSamples.slice(5);
  return { count: 25, warmups: 5, keydownToFrame: summary(retained.map(row => row.keyToFrame)),
    keydownToTwoFrames: summary(retained.map(row => row.keyToTwoFrames)),
    beforeinputToFrame: summary(retained.flatMap(row => row.inputToFrame === null ? [] : [row.inputToFrame])), verified: verify(25) };
}
export async function queuedTyping(interval = 80) {
  // This phase is programmatic application dispatch, not native OS input.
  beforeBody = source.state.doc.toString();
  insertAt = source.state.selection.main.head;
  siblingState = editors.filter(view => view !== source).map(view => ({ view, selection: view.state.selection, top: view.scrollDOM.scrollTop }));
  assertFocus(); focusLost = false; window.addEventListener('blur', markBlur);
  const count = 35, dispatch: number[] = [], lateness: number[] = [], nextFrame: number[] = [];
  const start = performance.now() + 100;
  try {
    await Promise.all(Array.from({ length: count }, (_, i) => new Promise<void>((resolve, reject) => {
      const target = start + i * interval;
      setTimeout(() => {
        try {
          const before = performance.now();
          source.dispatch({ changes: { from: insertAt + i, insert: 'x' }, selection: { anchor: insertAt + i + 1 } });
          const after = performance.now();
          requestAnimationFrame(() => {
            if (i >= 5) { dispatch.push(after - before); lateness.push(before - target); nextFrame.push(performance.now() - target); }
            resolve();
          });
        } catch (error) { reject(error); }
      }, Math.max(0, target - performance.now()));
    })));
    await frame(); await frame();
    const verified = verify(count);
    return { interval, count, warmups: 5, dispatch: summary(dispatch), inputLateness: summary(lateness), intendedInputToFrame: summary(nextFrame), verified };
  } finally { window.removeEventListener('blur', markBlur); }
}
