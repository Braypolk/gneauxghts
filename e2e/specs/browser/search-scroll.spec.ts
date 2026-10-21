import { browser, expect, $ } from '@wdio/globals';
import { resetBrowserWorkspace, openRecentNote } from '../../support/browserWorkspace';
import { waitForWorkspaceAnimationSettled } from '../../support/workspaceAnimation';

const destination = 'Scroll destination';
const markdown = [...Array.from({ length: 100 }, (_, i) => `Before ${i}`), destination,
  ...Array.from({ length: 100 }, (_, i) => `After ${i}`)].join('\n');

async function writeLongNote(text = markdown) {
  const content = await $('[data-testid="note-editor"] .cm-content');
  await browser.execute((element: HTMLElement, text: string) => {
    element.focus();
    document.execCommand('selectAll');
    document.execCommand('insertText', false, text);
  }, content, text);
  await browser.waitUntil(() => browser.execute((text: string) =>
    window.__GNEAUXGHTS_E2E__!.snapshot().notes.some(note => note.markdown === text), text));
}

async function geometry() {
  return browser.execute((text: string) => {
    const scroller = document.querySelector<HTMLElement>('[data-testid="note-editor"] .cm-scroller')!;
    const line = Array.from(scroller.querySelectorAll('.cm-line')).find(line => line.textContent === text);
    const range = document.createRange();
    if (line) range.selectNodeContents(line);
    const rect = line ? range.getBoundingClientRect() : null;
    const top = scroller.getBoundingClientRect().top + scroller.clientTop;
    return { scrollTop: scroller.scrollTop, height: scroller.clientHeight,
      top: rect ? (rect.top - top) / scroller.clientHeight : null,
      bottom: rect ? (rect.bottom - top) / scroller.clientHeight : null };
  }, destination);
}

async function positionDestination(fraction: number | 'above' | 'below') {
  // Render the destination through the public navigation path before positioning
  // the viewport. Tests then click the real search UI, including virtualized targets.
  await browser.execute(() => new Promise<void>((done) => {
    const modulePath = '/src/lib/features/notepad/navigation/navigation.ts';
    import(modulePath).then(module => {
      module.focusEditorAtDocumentLine(document.querySelector('[data-testid="note-editor"]'), 101);
      requestAnimationFrame(() => requestAnimationFrame(() => done()));
    });
  }));
  const measured = await geometry();
  await browser.execute((offset: number) => {
    const scroller = document.querySelector<HTMLElement>('[data-testid="note-editor"] .cm-scroller')!;
    scroller.scrollTop += offset;
    (window as any).__GNEAUXGHTS_NATIVE_E2E__.setEditorSelection(0, 0);
  }, (measured.top! - (fraction === 'above' ? -2 : fraction === 'below' ? 3 : fraction)) * measured.height);
  await browser.execute(() => new Promise<void>((done) => {
    requestAnimationFrame(() => requestAnimationFrame(() => done()));
  }));
  return geometry();
}

describe('search destination scrolling', () => {
  beforeEach(resetBrowserWorkspace);

  for (const scope of ['current note', 'all notes'] as const) {
    it(`moves ${scope} results only as far as the 20–60% band`, async () => {
      await writeLongNote();
      if (scope === 'all notes') {
        await browser.execute(() => {
          const state = window.__GNEAUXGHTS_E2E__!.snapshot();
          const note = state.notes.find(note => note.noteId === state.activeNoteId)!;
          Object.assign(window.__GNEAUXGHTS_E2E_COMMANDS__!, {
            search_notes_hybrid: () => [{ noteId: note.noteId, notePath: note.path, fileName: note.title,
              sectionLabel: 'Line 101', excerpt: 'Scroll destination', matchText: 'Scroll destination',
              highlightRanges: [], reasonLabels: ['keyword'], lexicalScore: 1, semanticScore: null,
              startLine: 101, endLine: 101, blockAnchor: null }],
            search_media: () => []
          });
        });
      }
      for (const fraction of [0.05, 0.85, 0.4, 'above', 'below'] as const) {
        const input = await $('[data-testid="note-search-input"]');
        await input.click();
        await $(`button[aria-label="Search ${scope === 'all notes' ? 'all notes' : 'this note only'}"]`).click();
        await input.setValue(destination);
        const result = await $('button.search-result-item');
        await result.waitForDisplayed();
        await waitForWorkspaceAnimationSettled();
        const before = await positionDestination(fraction);
        // Opening search may have lost focus while positioning; its result remains
        // clickable. Avoid WebDriver scrolling the page on the test's behalf.
        await $('button.search-result-item').waitForDisplayed();
        await browser.execute(() => document.querySelector<HTMLButtonElement>('button.search-result-item')!.click());
        await browser.waitUntil(async () => {
          const after = await geometry();
          return after.top !== null && after.bottom !== null && after.top >= 0.198 && after.bottom <= 0.602;
        }, { timeout: 3000, timeoutMsg: `Expected ${scope} destination in band from ${fraction}` });
        await waitForWorkspaceAnimationSettled();
        const after = await geometry();
        if (fraction === 0.4) expect(Math.abs(after.scrollTop - before.scrollTop)).toBeLessThanOrEqual(1);
        else if (fraction === 0.05 || fraction === 'above') expect(Math.abs(after.top! - 0.2)).toBeLessThanOrEqual(0.002);
        else expect(Math.abs(after.bottom! - 0.6)).toBeLessThanOrEqual(0.002);
      }
    });
  }

  it('reveals a result after opening another note', async () => {
    await writeLongNote();
    const target = await browser.execute(() => {
      const state = window.__GNEAUXGHTS_E2E__!.snapshot();
      return state.notes.find(note => note.noteId === state.activeNoteId)!;
    });
    await openRecentNote('Beta note');
    await browser.execute((note) => {
      Object.assign(window.__GNEAUXGHTS_E2E_COMMANDS__!, {
        search_notes_hybrid: () => [{ noteId: note.noteId, notePath: note.path, fileName: note.title,
          sectionLabel: 'Line 101', excerpt: 'Scroll destination', matchText: 'Scroll destination',
          highlightRanges: [], reasonLabels: ['keyword'], lexicalScore: 1, semanticScore: null,
          startLine: 101, endLine: 101, blockAnchor: null }],
        search_media: () => []
      });
    }, target);
    await $('[data-testid="note-search-input"]').setValue(destination);
    await $('button.search-result-item').waitForDisplayed();
    await waitForWorkspaceAnimationSettled();
    await browser.execute(() => document.querySelector<HTMLButtonElement>('button.search-result-item')!.click());
    await browser.waitUntil(() => browser.execute((id: string) =>
      (window as any).__GNEAUXGHTS_NATIVE_E2E__.readEditorState().noteId === id, target.noteId));
    await $('[data-testid="note-editor"][aria-busy="false"]').waitForExist();
    await browser.waitUntil(async () => {
      const after = await geometry();
      return after.top !== null && after.bottom !== null && after.top >= 0.198 && after.bottom <= 0.602;
    });
  });

  it('minimally reveals an unrendered match late in a long wrapped paragraph', async () => {
    await browser.setWindowSize(500, 900);
    const text = 'Before words '.repeat(1000) + destination + ' after words'.repeat(1000);
    await writeLongNote(text);
    const input = await $('[data-testid="note-search-input"]');
    await input.click();
    await $('button[aria-label="Search this note only"]').click();
    await input.setValue(destination);
    await $('button.search-result-item').waitForDisplayed();
    await waitForWorkspaceAnimationSettled();
    await browser.execute(() => {
      const scroller = document.querySelector<HTMLElement>('.cm-scroller')!;
      (window as any).__GNEAUXGHTS_NATIVE_E2E__.setEditorSelection(0, 0);
      scroller.scrollTop = 0;
    });
    await browser.execute(() => new Promise<void>((done) => {
      requestAnimationFrame(() => requestAnimationFrame(() => done()));
    }));
    expect(await browser.execute(() => document.querySelector<HTMLElement>('.cm-scroller')!.scrollTop)).toBe(0);
    await browser.execute(() => document.querySelector<HTMLButtonElement>('button.search-result-item')!.click());
    await browser.waitUntil(() => browser.execute(() => {
      const mark = document.querySelector('.cm-searchMatch-selected');
      const scroller = document.querySelector<HTMLElement>('.cm-scroller')!;
      if (!mark) return false;
      const rect = mark.getBoundingClientRect(), port = scroller.getBoundingClientRect();
      return Math.abs((rect.bottom - port.top - scroller.clientTop) / scroller.clientHeight - 0.6) < 0.002;
    }), { timeout: 3000, timeoutMsg: 'A far-below wrapped match should stop at 60%' });
  });

  it('clamps at the document start and leaves subsequent manual scrolling alone', async () => {
    await writeLongNote();
    const input = await $('[data-testid="note-search-input"]');
    await input.click();
    await $('button[aria-label="Search this note only"]').click();
    await input.setValue('Before 0');
    await $('button.search-result-item').waitForDisplayed();
    await waitForWorkspaceAnimationSettled();
    await browser.execute(() => document.querySelector<HTMLButtonElement>('button.search-result-item')!.click());
    await browser.waitUntil(() => browser.execute(() => document.querySelector<HTMLElement>('.cm-scroller')!.scrollTop === 0));
    await browser.execute(() => { document.querySelector<HTMLElement>('.cm-scroller')!.scrollTop = 200; });
    await browser.execute(() => new Promise<void>((done) => {
      requestAnimationFrame(() => requestAnimationFrame(() => done()));
    }));
    expect(await browser.execute(() => document.querySelector<HTMLElement>('.cm-scroller')!.scrollTop)).toBe(200);
  });

  it('lets a newer native cursor action supersede a queued app destination', async () => {
    await writeLongNote();
    const result = await browser.execute(() => new Promise<{
      expected: number;
      actual: number;
    }>((done) => {
      const viewModule = '/node_modules/@codemirror/view/dist/index.js';
      const scrollModule = '/src/lib/features/notepad/editor/editorScroll.ts';
      Promise.all([import(viewModule), import(scrollModule)]).then(async ([cm, scroll]) => {
        const view = cm.EditorView.findFromDOM(document.querySelector('.cm-content'));
        const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        // Use the ordinary native outcome as a control, including its chrome margins.
        view.dispatch({ selection: { anchor: 0 }, scrollIntoView: true });
        await frame();
        const expected = view.scrollDOM.scrollTop;
        view.dispatch({ selection: { anchor: view.state.doc.length }, scrollIntoView: true });
        await frame();
        view.dispatch({ effects: scroll.editorScrollEffect(view, view.state.doc.line(101).from) });
        view.dispatch({ selection: { anchor: 0 }, scrollIntoView: true });
        await frame();
        done({ expected, actual: view.scrollDOM.scrollTop });
      });
    }));
    expect(result.actual).toBe(result.expected);
  });
});
