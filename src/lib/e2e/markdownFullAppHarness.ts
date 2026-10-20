import { EditorView } from '@codemirror/view';
import { ensureSyntaxTree } from '@codemirror/language';
import { markdownBenchmarkFixture, type MarkdownBenchmarkKind } from '../features/notepad/markdown/markdownBenchmarkFixtures';
import { settleEditorPresentation } from '../features/notepad/editor/editorPresentation';

const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
function views() {
  return [...document.querySelectorAll<HTMLElement>('[data-testid="note-editor"] .cm-editor')].map(element => {
    const view = EditorView.findFromDOM(element);
    if (!view) throw new Error('Production EditorView missing');
    return view;
  });
}

export async function prepareFullAppMarkdown(kind: MarkdownBenchmarkKind, lines: number, panes: number) {
  const editors = views();
  if (editors.length !== panes) throw new Error(`Expected ${panes} real panes, got ${editors.length}`);
  const markdown = markdownBenchmarkFixture(kind, lines);
  editors[0].dispatch({ changes: { from: 0, to: editors[0].state.doc.length, insert: markdown }, selection: { anchor: markdown.length - 1 } });
  for (const [index, view] of editors.entries()) {
    if (view.state.doc.toString() !== markdown) throw new Error('Production panes do not share the fixture');
    if (!ensureSyntaxTree(view.state, markdown.length, 60_000)) throw new Error('Full-app fixture parse incomplete');
    view.dispatch({ effects: EditorView.scrollIntoView(view.state.doc.line(Math.floor(lines * (index ? 0.75 : 0.25))).from, { y: 'start' }) });
    if (!await settleEditorPresentation(view, () => true)) throw new Error('Full-app presentation failed');
  }
  await frame(); await frame();
  // Allow production draft/persistence debounce from fixture setup to settle.
  await new Promise(resolve => setTimeout(resolve, 1200));
  return { userAgent: navigator.userAgent, width: innerWidth, height: innerHeight,
    panes: editors.map(view => ({ width: view.dom.clientWidth, height: view.dom.clientHeight,
      font: getComputedStyle(view.contentDOM).font, visibleLines: view.visibleRanges.reduce((n, r) => n + view.state.doc.lineAt(r.to).number - view.state.doc.lineAt(r.from).number + 1, 0) })) };
}

export async function measureFullAppMarkdown(operation: 'selection' | 'document', count = 25) {
  const editors = views();
  const dispatchSamplesMs = [], frameSamplesMs = [];
  for (let i = 0; i < count; i++) {
    const view = editors[0];
    const start = performance.now();
    if (operation === 'selection') view.dispatch({ selection: { anchor: view.viewport.from + 4 + i % 2 } });
    else view.dispatch({ changes: { from: view.viewport.from + 5, to: view.viewport.from + 6, insert: i % 2 ? 'x' : 'y' } });
    const dispatched = performance.now();
    for (const view of editors) view.coordsAtPos(view.viewport.from);
    await frame(); await frame();
    if (i >= 5) { dispatchSamplesMs.push(dispatched - start); frameSamplesMs.push(performance.now() - start); }
  }
  for (const view of editors) if (!view.state.doc.eq(editors[0].state.doc)) throw new Error('Benchmark edit failed sibling synchronization');
  dispatchSamplesMs.sort((a, b) => a - b); frameSamplesMs.sort((a, b) => a - b);
  const median = (samples: number[]) => samples[Math.floor(samples.length / 2)];
  const p95 = (samples: number[]) => samples[Math.ceil(samples.length * 0.95) - 1];
  return { operation, dispatchMedianMs: median(dispatchSamplesMs), dispatchP95Ms: p95(dispatchSamplesMs),
    twoFrameMedianMs: median(frameSamplesMs), twoFrameP95Ms: p95(frameSamplesMs), dispatchSamplesMs, frameSamplesMs };
}

export async function verifyFullAppRemount() {
  await prepareFullAppMarkdown('mixed', 10_000, 1);
  const original = views()[0];
  const top = original.scrollDOM.scrollTop;
  document.querySelector<HTMLElement>('button[aria-label="Open thought partner in this pane"]')!.click();
  const deadline = performance.now() + 20_000;
  while (!document.querySelector('button[aria-label="Open previous location"]')) {
    if (performance.now() > deadline) throw new Error('Chat did not mount');
    await frame();
  }
  const originalIdle = window.requestIdleCallback;
  const originalCancel = window.cancelIdleCallback;
  window.requestIdleCallback = callback => window.setTimeout(() => callback({ didTimeout: true, timeRemaining: () => 0 }), 700);
  window.cancelIdleCallback = handle => window.clearTimeout(handle);
  const samples: { top: number; headings: { text: string; top: number }[] }[] = [];
  try {
    document.querySelector<HTMLElement>('button[aria-label="Open previous location"]')!.click();
    const started = performance.now();
    while (performance.now() - started < 1500 || samples.length === 0) {
      if (performance.now() > deadline) throw new Error('Remounted editor never became ready');
      const shell = document.querySelector<HTMLElement>('[data-testid="note-editor"][aria-busy="false"]');
      const scroller = shell?.querySelector<HTMLElement>('.cm-scroller');
      if (scroller && getComputedStyle(scroller).visibility === 'visible') {
        const bounds = scroller.getBoundingClientRect();
        const headings = [...scroller.querySelectorAll<HTMLElement>('.cm-line')].filter(line => {
          const rect = line.getBoundingClientRect();
          return line.textContent?.includes('Heading') && rect.bottom > bounds.top && rect.top < bounds.bottom;
        });
        if (!headings.length || headings.some(line => !line.classList.contains('cm-gn-line-h2'))) throw new Error('Ready remount exposed unformatted headings');
        samples.push({ top: scroller.scrollTop, headings: headings.map(line => ({ text: line.textContent!, top: line.getBoundingClientRect().top })) });
      }
      await frame();
    }
    if (views()[0] === original) throw new Error('Expected actual pane remount');
    if (Math.abs(samples[0].top - top) > 2) throw new Error(`Reading position changed ${top} -> ${samples[0].top}`);
    const anchor = samples[0].headings[1] ?? samples[0].headings[0];
    if (samples.some(sample => {
      const heading = sample.headings.find(heading => heading.text === anchor.text);
      return !heading || Math.abs(heading.top - anchor.top) > 2;
    })) throw new Error('Ready remount layout shifted after background parser publication');
    return { frames: samples.length, originalScrollTop: top, firstReadyScrollTop: samples[0].top };
  } finally {
    window.requestIdleCallback = originalIdle;
    window.cancelIdleCallback = originalCancel;
  }
}

// Runs after timing: validate every quote/emphasis span in the full native app,
// then change syntax from either pane while preserving the sibling viewport.
export async function verifyFullAppGiantQuote(lines: number) {
  const editors = views();
  function checkTrees(expectedEmphasis: number) {
    const body = editors[0].state.doc.toString();
    for (const view of editors) {
      if (view.state.doc.toString() !== body) throw new Error('Giant quote sibling text diverged');
      const tree = ensureSyntaxTree(view.state, view.state.doc.length, 60_000);
      if (!tree) throw new Error('Giant quote tree incomplete');
      let quotes = 0, emphasis = 0;
      tree.iterate({ enter(node) {
        if (node.name === 'QuoteMark') {
          if (body.slice(node.from, node.to) !== '>') throw new Error('Misplaced quote marker');
          quotes++;
        } else if (node.name === 'StrongEmphasis') {
          if (body.slice(node.from, node.from + 2) !== '**' || body.slice(node.to - 2, node.to) !== '**') {
            throw new Error('Misplaced emphasis markers');
          }
          emphasis++;
        }
      } });
      if (quotes !== 2 * lines || emphasis !== expectedEmphasis) {
        throw new Error(`Giant quote counts: ${quotes} markers, ${emphasis} emphasis`);
      }
    }
  }
  checkTrees(lines);
  const source = editors[editors.length - 1];
  const sibling = editors.length > 1 ? editors[0] : null;
  const selection = sibling?.state.selection.toJSON();
  const scrollTop = sibling?.scrollDOM.scrollTop;
  const line = source.state.doc.lineAt(source.viewport.from);
  const index = line.text.indexOf('**bold**');
  if (index < 0) throw new Error('Expected bold text in giant quote viewport');
  const from = line.from + index;
  for (const insert of ['  ', '**']) {
    source.dispatch({ changes: [
      { from, to: from + 2, insert },
      { from: from + 6, to: from + 8, insert }
    ] });
    checkTrees(insert === '**' ? lines : lines - 1);
    function checkSibling() {
      if (sibling && (JSON.stringify(sibling.state.selection.toJSON()) !== JSON.stringify(selection) ||
        Math.abs(sibling.scrollDOM.scrollTop - scrollTop!) > 1)) {
        throw new Error('Giant quote syntax edit moved the sibling selection or viewport');
      }
    }
    checkSibling();
    await frame(); await frame();
    checkSibling();
  }
  return { panes: editors.length, quoteMarkers: lines * 2, strongEmphasis: lines };
}
