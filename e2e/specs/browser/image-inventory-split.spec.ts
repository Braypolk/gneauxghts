import { browser, expect, $, $$ } from '@wdio/globals';
import { resetBrowserWorkspace } from '../../support/browserWorkspace';
import { waitForWorkspaceAnimationSettled } from '../../support/workspaceAnimation';

it('updates complete image inventories from either mounted pane with distant references and independent viewports', async () => {
  await resetBrowserWorkspace();
  await browser.execute(() => {
    window.__GNEAUXGHTS_E2E__!.seedImageAsset('a.png');
    window.__GNEAUXGHTS_E2E__!.seedImageAsset('b.png');
  });
  const markdown = `Before\n\n![inline|100](a.png)\n\n${'Ordinary paragraph far from the definition.\n\n'.repeat(1100)}![ref|100][ref]\n\n![ref][]\n\n![ref]\n\n[ref]: a.png\n\n${'After\n\n'.repeat(100)}`;
  await browser.execute((value: string) => {
    const content = document.querySelector<HTMLElement>('[data-testid="note-editor"] .cm-content')!;
    content.focus();
    const bridge = (window as any).__GNEAUXGHTS_NATIVE_E2E__;
    bridge.setEditorSelection(0, bridge.readEditorState().editor.markdown.length);
    const data = new DataTransfer(); data.setData('text/plain', value);
    content.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, markdown);
  await browser.execute(() => new Promise<void>((done) => {
    const module = '/node_modules/@codemirror/view/dist/index.js';
    import(module).then(cm => {
      cm.EditorView.findFromDOM(document.querySelector('.cm-content')).dispatch({ selection: { anchor: 0 }, scrollIntoView: true });
      done();
    });
  }));
  await $('.gn-image-embed img').waitForDisplayed();
  await $('button[aria-label="Open split pane options"]').click();
  await $('#pane-command-current').waitForExist(); await $('#pane-command-current').click();
  await waitForWorkspaceAnimationSettled();
  await browser.waitUntil(() => browser.execute(() =>
    document.querySelectorAll('[data-testid="note-editor"] .cm-content').length === 2));

  const result = await browser.execute(() => new Promise<any>((done) => {
    const viewModule = '/node_modules/@codemirror/view/dist/index.js';
    const stateModule = '/src/lib/features/notepad/images/imageState.ts';
    const parserModule = '/src/lib/features/notepad/images/imageEmbedParser.ts';
    Promise.all([import(viewModule), import(stateModule), import(parserModule)]).then(async ([cm, model, parser]) => {
      const views = [...document.querySelectorAll('.cm-content')].map(element => cm.EditorView.findFromDOM(element));
      const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      views[0].dispatch({ selection: { anchor: 0 }, scrollIntoView: true });
      views[1].dispatch({ selection: { anchor: views[1].state.doc.toString().indexOf('![ref|') }, scrollIntoView: true });
      // Settle CodeMirror's measured image heights before capturing scroll.
      for (let i = 0; i < 8; i++)
        await frame();
      const reports = [];
      for (const source of [0, 1]) {
        const view = views[source], sibling = views[1 - source];
        const oldSelection = sibling.state.selection.main.head, oldScroll = sibling.scrollDOM.scrollTop;
        const from = view.state.doc.toString().lastIndexOf(': a.png') + 2;
        // Second edit restores the destination from the other pane.
        const position = source ? view.state.doc.toString().lastIndexOf(': b.png') + 2 : from;
        view.dispatch({ changes: { from: position, to: position + 1, insert: source ? 'a' : 'b' } });
        const synchronousScroll = sibling.scrollDOM.scrollTop;
        await frame();
        const body = view.state.doc.toString();
        reports.push({ source, oldSelection, selection: sibling.state.selection.main.head, oldScroll, synchronousScroll,
          consistent: views.every(view => JSON.stringify(view.state.field(model.imageState).images) === JSON.stringify(parser.parseImageEmbeds(body))),
          assets: views.map(view => view.state.field(model.imageState).images.map((image: any) => image.assetName)),
          distinctScroll: Math.abs(views[0].scrollDOM.scrollTop - views[1].scrollDOM.scrollTop) > 500 });
      }
      done({ reports, widgets: views.map(view => view.dom.querySelectorAll('.gn-image-embed').length) });
    }).catch(error => done({ error: String(error) }));
  }));
  expect(result.error).toBeUndefined();
  for (const report of result.reports) {
    expect(report.consistent).toBe(true);
    expect(report.selection).toBe(report.oldSelection);
    expect(report.synchronousScroll).toBe(report.oldScroll);
    expect(report.distinctScroll).toBe(true);
    expect(report.assets).toEqual([['a.png', ...Array(3).fill(report.source ? 'a.png' : 'b.png')], ['a.png', ...Array(3).fill(report.source ? 'a.png' : 'b.png')]]);
  }
  expect(result.widgets.every((count: number) => count > 0)).toBe(true);
  // The first viewport's viewer must include all three offscreen reference uses.
  const firstZoom = (await $$('.gn-image-embed button[aria-label="Zoom image"]'))[0];
  await firstZoom.click();
  await $('dialog.gn-image-viewer').waitForDisplayed();
  expect(await $('dialog .counter').getText()).toBe('1 / 4');
  await $('button[aria-label="Next image"]').click();
  expect(await $('dialog .counter').getText()).toBe('2 / 4');
  await browser.keys('Escape');
});
