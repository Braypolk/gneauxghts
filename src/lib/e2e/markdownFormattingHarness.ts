import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { ensureSyntaxTree, forceParsing, syntaxTree, syntaxTreeAvailable } from '@codemirror/language';
import { cursorCharRight } from '@codemirror/commands';
import { createMarkdownExtensions } from '../features/notepad/markdown/markdownExtensions';
import { markdownBenchmarkFixture, markdownBenchmarkKinds, markdownBenchmarkSizes } from '../features/notepad/markdown/markdownBenchmarkFixtures';
import { EditorDocumentRuntime } from '../features/notepad/editor/editorDocumentRuntime';
import type { EditorController } from '../features/notepad/editor/types';
import { settleEditorPresentation } from '../features/notepad/editor/editorPresentation';
import '../features/notepad/editor/editorTypography.css';

const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

function mount(doc: string, panes: number, parse = true, styled = false) {
  const host = document.createElement('div');
  host.style.cssText = 'display:flex;gap:16px;position:fixed;inset:0;background:white;color:black;';
  if (styled) {
    host.className = 'notepad-editor-shell';
    host.style.setProperty('--foreground', '#111');
    host.style.setProperty('--background', '#fff');
    host.style.setProperty('--muted', '#ddd');
    host.style.setProperty('--border', '#ccc');
    host.style.setProperty('--accent', '#468');
  }
  document.body.appendChild(host);
  const runtime = new EditorDocumentRuntime(doc);
  const controllers: EditorController[] = [];
  for (let pane = 0; pane < panes; pane++) {
    const parent = document.createElement('div');
    parent.style.cssText = 'width:600px;height:800px;';
    if (styled) parent.className = 'gn-editor-root';
    host.appendChild(parent);
    let state = EditorState.create({ doc, selection: { anchor: doc.length - 1 }, extensions: [
      createMarkdownExtensions(), EditorView.lineWrapping,
      EditorView.theme({ '&': { height: '800px', fontSize: '16px' }, '.cm-scroller': { overflow: 'auto', lineHeight: '20px' } })
    ] });
    if (parse) {
      if (!ensureSyntaxTree(state, doc.length, 60_000)) throw new Error('Incomplete mounted fixture parse');
      state = state.update({}).state;
    }
    let controller: EditorController;
    const view = new EditorView({ state, parent, dispatchTransactions(transactions) {
      runtime.dispatchFromPane(controller, transactions);
    } });
    controller = { view, runtime, sharedResources: null, paneKey: Symbol(), onBodyChange() {} };
    controllers.push(controller);
    runtime.attachController(controller);
  }
  return { controllers, runtime, destroy() {
    for (const controller of controllers) {
      runtime.detachController(controller);
      controller.view.destroy();
    }
    runtime.destroy();
    host.remove();
  } };
}

export async function measureMountedMarkdown(filter: { lines: number; kind: string; panes: number }) {
  const rows = [];
  for (const lines of markdownBenchmarkSizes) for (const kind of markdownBenchmarkKinds) for (const panes of [1, 2]) {
    if (lines !== filter.lines || kind !== filter.kind || panes !== filter.panes) continue;
    const fixture = mount(markdownBenchmarkFixture(kind, lines), panes);
    const views = fixture.controllers.map(controller => controller.view);
    for (const [pane, view] of views.entries()) {
      view.dispatch({ effects: EditorView.scrollIntoView(view.state.doc.line(Math.floor(lines * (pane ? 0.75 : 0.25))).from, { y: 'start' }) });
    }
    await frame(); await frame();
    for (const operation of ['selection', 'document'] as const) {
      const dispatchMs = [], frameMs = [];
      for (let i = 0; i < 25; i++) {
        const start = performance.now();
        const view = views[0];
        if (operation === 'selection') view.dispatch({ selection: { anchor: view.viewport.from + 4 + i % 2 } });
        else view.dispatch({ changes: { from: view.viewport.from + 5, to: view.viewport.from + 6, insert: i % 2 ? 'x' : 'y' } });
        const dispatched = performance.now();
        for (const view of views) view.coordsAtPos(view.viewport.from);
        await frame(); await frame();
        if (i >= 5) { dispatchMs.push(dispatched - start); frameMs.push(performance.now() - start); }
      }
      dispatchMs.sort((a, b) => a - b); frameMs.sort((a, b) => a - b);
      rows.push({ kind, lines, panes, operation, dispatchMedianMs: dispatchMs[10], dispatchP95Ms: dispatchMs[18],
        twoFrameMedianMs: frameMs[10], twoFrameP95Ms: frameMs[18],
        visibleLines: views.map(view => view.visibleRanges.reduce((total, range) => total + view.state.doc.lineAt(range.to).number - view.state.doc.lineAt(range.from).number + 1, 0)),
        dispatchSamplesMs: dispatchMs, frameSamplesMs: frameMs });
    }
    fixture.destroy();
  }
  return { userAgent: navigator.userAgent, width: innerWidth, height: innerHeight, warmups: 5, samples: 20,
    description: 'Mounted Markdown EditorViews, 600x800 each, real shared document runtime; dispatch plus forced layout and two frames; no application shell or native IPC.', rows };
}

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function settle(view: EditorView) {
  check(await settleEditorPresentation(view, () => true), 'Editor failed presentation readiness');
  await frame(); await frame();
}

async function scrollToLine(view: EditorView, number: number) {
  view.dispatch({ effects: EditorView.scrollIntoView(view.state.doc.line(number).from, { y: 'start' }) });
  await settle(view);
}

export async function verifyMarkdownCase(name: string) {
  await import('../features/notepad/editor/editor.css');
  await import('../features/notepad/markdown/inlineFormatting.css');
  if (name === 'fence-scroll' || name === 'nested-quote-scroll') {
    const fence = name === 'fence-scroll';
    const fixture = mount(markdownBenchmarkFixture(fence ? 'fence' : 'quote', 10_000), 1, true, true);
    try {
      const view = fixture.controllers[0].view;
      await settle(view);
      if (fence) check(view.dom.querySelector('.cm-gn-code-block-line-start'), 'Opening fence chrome missing');
      await scrollToLine(view, 5000);
      check(view.viewport.from > 0, 'Scroll did not expose a new window');
      const port = view.scrollDOM.getBoundingClientRect();
      const lines = [...view.dom.querySelectorAll('.cm-line')].filter(line => {
        const rect = line.getBoundingClientRect();
        return rect.bottom > port.top && rect.top < port.bottom;
      });
      check(lines.length > 10 && lines.length < 200, 'Expected virtualized lines');
      check(lines.every(line => line.classList.contains(fence ? 'cm-gn-code-block-line' : 'cm-gn-quote-line')), 'Missing enclosing block styling');
      if (fence) {
        check(!view.dom.querySelector('.cm-gn-code-block-line-start,.cm-gn-code-block-line-end'), 'False block boundary inside viewport');
        await scrollToLine(view, 10_001);
        check(view.dom.querySelector('.cm-gn-code-block-line-end'), 'Closing fence chrome missing');
        view.dispatch({ selection: { anchor: view.state.doc.line(5000).from + 3 } });
        await scrollToLine(view, 1);
        check(view.dom.querySelector('.cm-gn-code-fence')?.textContent?.includes('```'), 'Offscreen caret failed to reveal its enclosing fence');
      } else {
        check(view.dom.querySelector('.cm-gn-quote-content'), 'Enclosing quote content missing');
        check(getComputedStyle(view.dom.querySelector('.cm-gn-quote-content')!).fontStyle === 'italic', 'Quote appearance changed');
        const before = view.contentDOM.textContent;
        view.dispatch({ selection: { anchor: view.viewport.from + 8, head: view.viewport.from + 18 } });
        await settle(view);
        check(view.dom.querySelector('.cm-gn-quote-content'), 'Selection removed quote styling');
        check(view.contentDOM.textContent !== before, 'Selection did not reveal emphasis markers');
      }
    } finally { fixture.destroy(); }
    return;
  }
  if (name === 'conceal-and-atomic') {
    const doc = '# Heading\n\n**bold** ==highlight== [label](https://example.com)\n\n- parent\n  - child [[Target|alias]]\n\noutside';
    const fixture = mount(doc, 1, true, true);
    try {
      const view = fixture.controllers[0].view;
      await settle(view);
      check(!view.contentDOM.textContent!.includes('#'), 'Inactive heading is raw');
      check(view.dom.querySelector('.cm-gn-link-styled'), 'Inactive link widget missing');
      const bold = doc.indexOf('bold');
      view.dispatch({ selection: { anchor: bold, head: bold + 2 } });
      await settle(view);
      check(view.contentDOM.textContent!.includes('**bold**'), 'Selected bold markers remain hidden');
      const highlight = doc.indexOf('highlight');
      view.dispatch({ selection: { anchor: highlight, head: highlight + 3 } });
      check(view.dom.querySelector('.cm-gn-highlight.cm-gn-selection-overlap'), 'Selection fill contract lost');
      const label = doc.indexOf('label');
      view.dispatch({ selection: { anchor: label } });
      check(!view.dom.querySelector('.cm-gn-link-styled'), 'Active link failed to reveal');
      view.dispatch({ selection: { anchor: 3 } });
      check(view.contentDOM.textContent!.includes('# Heading'), 'Caret failed to reveal heading');
      const nestedLine = view.state.doc.line(6);
      view.dispatch({ selection: { anchor: nestedLine.from } });
      cursorCharRight(view);
      check(view.state.selection.main.head === nestedLine.from + 2, 'Cursor entered concealed indentation');
      const target = doc.indexOf('Target');
      view.dispatch({ selection: { anchor: 0 } });
      const motion = view.moveByChar(EditorSelection.cursor(target), true);
      check(motion.head === doc.indexOf('alias'), 'Cursor entered concealed wikilink target');
      view.dispatch({ selection: motion });
      await settle(view);
      check(view.contentDOM.textContent!.includes('Target|alias'), 'Atomic motion did not reveal wikilink');
    } finally { fixture.destroy(); }
    // Multiline links must retain their line breaks. Plugin-supplied replacing
    // decorations spanning them throw during mounted CodeMirror layout.
    const multiline = mount('[two\nlines](https://example.com)\n\noutside', 1, true, true);
    try {
      const view = multiline.controllers[0].view;
      await settle(view);
      check(view.dom.querySelector('.cm-gn-link-text'), 'Multiline link styling missing');
      check(!view.dom.querySelector('.cm-gn-link-styled'), 'Multiline link replaced line breaks');
    } finally { multiline.destroy(); }
    return;
  }
  if (name === 'split-panes') {
    const doc = Array.from({ length: 500 }, (_, i) => `## Heading ${i}\n\nParagraph **bold ${i}** with [[Target|alias]]\n`).join('\n');
    const fixture = mount(doc, 2, true, true);
    try {
      const [a, b] = fixture.controllers.map(controller => controller.view);
      a.dispatch({ selection: { anchor: 5 } });
      b.dispatch({ selection: { anchor: b.state.doc.line(1001).from + 5 } });
      await scrollToLine(a, 1); await scrollToLine(b, 1001);
      check(a.viewport.from !== b.viewport.from, 'Panes share a viewport');
      check(b.dom.querySelector('.cm-gn-header-mark'), 'Sibling heading must be active');
      const before = { dom: b.contentDOM.innerHTML, selection: b.state.selection.toJSON(), top: b.scrollDOM.scrollTop };
      a.dispatch({ selection: { anchor: 30 } });
      await settle(a); await settle(b);
      check(JSON.stringify(b.state.selection.toJSON()) === JSON.stringify(before.selection), 'Source selection leaked to sibling');
      check(b.contentDOM.innerHTML === before.dom, 'Source selection changed sibling formatting');
      check(Math.abs(b.scrollDOM.scrollTop - before.top) <= 1, 'Source selection moved sibling viewport');
      a.dispatch({ changes: { from: 5, to: 6, insert: 'Z' } });
      await settle(a); await settle(b);
      check(a.state.doc.eq(b.state.doc), 'Shared edit failed to reach sibling');
      check(JSON.stringify(b.state.selection.toJSON()) === JSON.stringify(before.selection), 'Edit stole sibling selection');
      check(b.contentDOM.innerHTML === before.dom, 'Offscreen edit changed sibling rendering');
      check(Math.abs(b.scrollDOM.scrollTop - before.top) <= 1, 'Shared edit moved sibling viewport');
      check(b.dom.querySelector('.cm-gn-header-mark'), 'Shared edit lost sibling-local active formatting');
      const oldHead = b.state.selection.main.head;
      a.dispatch({ changes: { from: 5, insert: 'X' } });
      await settle(a); await settle(b);
      check(b.state.selection.main.head === oldHead + 1 && b.state.selection.main.anchor === oldHead + 1, 'Sibling selection failed to map through a shared insertion');
      check(b.dom.querySelector('.cm-gn-header-mark'), 'Mapped sibling selection lost its active heading');
      check(Math.abs(b.scrollDOM.scrollTop - before.top) <= 1, 'Shared insertion moved sibling viewport');
    } finally { fixture.destroy(); }
    return;
  }
  if (name === 'syntax-changing-edits') {
    const doc = 'outside\n\n```\nplain\n```\n\n' + 'plain\n\n'.repeat(500) + '## Far heading\n\noutside';
    const fixture = mount(doc, 1, true, true);
    try {
      const view = fixture.controllers[0].view;
      const target = view.state.doc.lines - 2;
      await scrollToLine(view, target);
      check(view.dom.querySelector('.cm-gn-line-h2'), 'Initial distant heading missing');
      const close = doc.indexOf('```', doc.indexOf('```') + 3);
      view.dispatch({ changes: { from: close, to: close + 3 } });
      await settle(view);
      check(!view.dom.querySelector('.cm-gn-line-h2'), 'Distant heading survived removing closing fence');
      check(view.dom.querySelector('.cm-gn-code-block-line'), 'Distant code context missing');
      view.dispatch({ changes: { from: close, insert: '```' } });
      await settle(view);
      check(view.dom.querySelector('.cm-gn-line-h2'), 'Distant heading did not recover after inserting closing fence');
      view.dispatch({ changes: { from: 0, insert: '```\n' } });
      await settle(view);
      // The inserted opener changes interpretation of the following fences.
      check(!view.dom.querySelector('.cm-gn-line-h2'), 'Inserted opener failed to invalidate distant syntax');
    } finally { fixture.destroy(); }
    return;
  }
  if (name === 'parser-publication') {
    const doc = markdownBenchmarkFixture('mixed', 50_000);
    const fixture = mount(doc, 1, false, true);
    try {
      const view = fixture.controllers[0].view;
      check(syntaxTree(view.state).length < doc.length, 'Fixture unexpectedly parsed completely');
      const position = view.state.doc.line(30_009).from;
      view.dispatch({ effects: EditorView.scrollIntoView(position, { y: 'start' }) });
      const before = view.state.doc;
      await settle(view);
      check(syntaxTreeAvailable(view.state, view.viewport.to), 'Readiness preceded parser publication');
      check(view.state.doc === before, 'Parser publication changed Markdown');
      check(view.dom.querySelector('.cm-gn-line-h2'), 'Newly published headings missing');
      const heading = view.dom.querySelector<HTMLElement>('.cm-gn-line-h2')!;
      const top = heading.getBoundingClientRect().top;
      await frame(); await frame();
      check(Math.abs(heading.getBoundingClientRect().top - top) <= 1, 'Ready viewport layout did not settle');
      check(forceParsing(view, view.viewport.to, 20), 'Viewport parse was not retained');
    } finally { fixture.destroy(); }
    return;
  }
  throw new Error(`Unknown Markdown case: ${name}`);
}
