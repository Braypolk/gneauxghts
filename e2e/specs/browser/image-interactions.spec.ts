import { browser, expect, $, $$ } from '@wdio/globals';
import { waitForTwoAnimationFrames } from '../../support/animationFrames';
import { resetBrowserWorkspace } from '../../support/browserWorkspace';
async function insertMarkdown(markdown: string) {
  const content = await $('[data-testid="note-editor"] .cm-content');
  await browser.execute((element: HTMLElement, value: string) => {
    element.focus(); const bridge = (window as any).__GNEAUXGHTS_NATIVE_E2E__; bridge.setEditorSelection(0, bridge.readEditorState().editor.markdown.length);
    const data = new DataTransfer(); data.setData('text/plain', value);
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, content, markdown);
}
async function body() {
  return browser.execute(() => {
    const snapshot = window.__GNEAUXGHTS_E2E__!.snapshot();
    return snapshot.notes.find(note => note.noteId === snapshot.activeNoteId)!.markdown;
  });
}
async function pasteSearchImage() {
  const input = await $('[data-testid="note-search-input"]');
  await browser.execute((input: HTMLElement) => {
    const files = new DataTransfer();
    files.items.add(new File([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='), c => c.charCodeAt(0))], 'query.png', { type: 'image/png' }));
    input.dispatchEvent(new ClipboardEvent('paste', { clipboardData: files, bubbles: true, cancelable: true }));
  }, input);
}
async function selectImage() {
  await $('.gn-image-embed button[aria-label="Zoom image"]').click();
  await $('dialog.gn-image-viewer').waitForDisplayed();
  await browser.keys('Escape');
  await $('dialog.gn-image-viewer').waitForExist({ reverse: true });
  await $('.gn-image-embed[data-selected="true"]').waitForExist();
}
describe('image interactions', () => {
  beforeEach(async () => {
    await resetBrowserWorkspace();
    await browser.execute(() => { window.__GNEAUXGHTS_E2E__!.seedImageAsset('a b.png'); window.__GNEAUXGHTS_E2E__!.seedImageAsset('second.png'); });
  });
  afterEach(async () => {
    await browser.execute(() => {
      (window as any).__restoreImageClipboard?.();
      delete (window as any).__imageNodes;
    });
  });
  it('selects on the first body click for deletion and opens only on a subsequent click', async () => {
    const markdown = 'Before\n\n![[second.png|200]]\n\n![Other|200](a%20b.png)\n\nAfter';
    await insertMarkdown(markdown);
    const first = $('.gn-image-embed[data-file-name="second.png"] img');
    const other = $('.gn-image-embed[data-file-name="a%20b.png"] img');
    await first.waitForDisplayed();
    await first.click();
    await $('.gn-image-embed[data-file-name="second.png"][data-selected="true"]').waitForExist();
    expect(await $('dialog.gn-image-viewer').isExisting()).toBe(false);
    expect(await browser.execute(() => (window as any).__GNEAUXGHTS_NATIVE_E2E__.readEditorState().editor.ownsWebviewFocus)).toBe(true);
    await browser.keys('Delete');
    await browser.waitUntil(async () => !(await body()).includes('![[second.png'));
    expect(await other.isDisplayed()).toBe(true);
    await browser.keys(['Meta', 'z', '\uE000']);
    await browser.waitUntil(async () => (await body()) === markdown);
    await browser.execute(() => (window as any).__GNEAUXGHTS_NATIVE_E2E__.setEditorSelection(0, 0));
    await first.click();
    await $('.gn-image-embed[data-file-name="second.png"][data-selected="true"]').waitForExist();
    expect(await $('dialog.gn-image-viewer').isExisting()).toBe(false);
    await first.click();
    await $('dialog.gn-image-viewer').waitForDisplayed();
    expect(await $('dialog header').getText()).toContain('second.png');
    await browser.keys('Escape');
    await $('dialog.gn-image-viewer').waitForExist({ reverse: true });
    await other.click();
    await $('.gn-image-embed[data-file-name="a%20b.png"][data-selected="true"]').waitForExist();
    expect(await $('dialog.gn-image-viewer').isExisting()).toBe(false);
    await other.click();
    await $('dialog.gn-image-viewer').waitForDisplayed();
    expect(await $('dialog header').getText()).toContain('a%20b.png');
    await browser.keys('Escape');
    await $('dialog.gn-image-viewer').waitForExist({ reverse: true });
    expect(await body()).toBe(markdown);
  });
  it('selects, sizes with controls and shortcuts, reveals source, deletes and undoes a Markdown embed', async () => {
    const markdown = 'Before\n\n![Citrus|200](a%20b.png "Title")\n\nAfter';
    await insertMarkdown(markdown);
    await $('.gn-image-embed img').waitForDisplayed();
    await $('.gn-image-embed img').click();
    expect(await $('.selection-panel').isExisting()).toBe(false);
    const controlsLeft = await $('.gn-image-toolbar').getLocation('x');
    await $('.gn-image-embed button[aria-label="Increase image size"]').click();
    await browser.waitUntil(async () => (await body()) === markdown.replace('|200', '|250'));
    await $('.gn-image-embed button[aria-label="Increase image size"]').click();
    await browser.waitUntil(async () => (await body()) === markdown.replace('|200', '|300'));
    expect(await $('.gn-image-toolbar').getLocation('x')).toBe(controlsLeft);
    await browser.keys(['Meta', 'z', '\uE000']);
    await browser.waitUntil(async () => (await body()) === markdown.replace('|200', '|250'));
    await $('.gn-image-embed button[aria-label="Decrease image size"]').click();
    await browser.waitUntil(async () => (await body()) === markdown);
    expect(await $('.gn-image-embed[data-selected="true"]').isExisting()).toBe(true);
    expect(await $('dialog.gn-image-viewer').isExisting()).toBe(false);
    await browser.keys('=');
    await browser.waitUntil(async () => (await body()).includes('Citrus|250'));
    await browser.keys('Enter');
    await browser.waitUntil(async () => (await $('[data-testid="note-editor"] .cm-content').getText()).includes('![Citrus|250]'));
    expect(await $('.gn-image-embed img').isDisplayed()).toBe(true);
    const alignment = await browser.execute(() => {
      const line = [...document.querySelectorAll<HTMLElement>('.cm-line')].find(element => element.textContent?.includes('Citrus'))!;
      return { source: line.getBoundingClientRect().left + parseFloat(getComputedStyle(line).paddingLeft),
        preview: document.querySelector('.gn-image-embed')!.getBoundingClientRect().left };
    });
    expect(Math.abs(alignment.source - alignment.preview)).toBeLessThan(1);
    await browser.execute(() => { const bridge = (window as any).__GNEAUXGHTS_NATIVE_E2E__; bridge.setEditorSelection(bridge.readEditorState().editor.markdown.length, bridge.readEditorState().editor.markdown.length); });
    await selectImage();
    await browser.keys('Backspace');
    await browser.waitUntil(async () => !(await body()).includes('![Citrus'));
    await browser.keys(['Meta', 'z', '\uE000']);
    await browser.waitUntil(async () => (await body()).includes('![Citrus|250](a%20b.png "Title")'));
  });
  it('browses images beyond the viewport, zooms and pans without editing the note', async () => {
    const markdown = `Before\n\n![First|200](a%20b.png)\n\n${'paragraph\n\n'.repeat(80)}![[second.png]]`;
    await insertMarkdown(markdown);
    await browser.execute(() => { (window as any).__GNEAUXGHTS_NATIVE_E2E__.setEditorSelection(0, 0); document.querySelector<HTMLElement>('.cm-scroller')!.scrollTop = 0; });
    await waitForTwoAnimationFrames();
    await $('.gn-image-embed img').waitForDisplayed();
    await $('.gn-image-embed button[aria-label="Zoom image"]').click();
    await $('dialog.gn-image-viewer img').waitForDisplayed();
    await browser.keys('ArrowRight');
    await browser.waitUntil(async () => (await $('dialog header').getText()).includes('second.png'));
    await $('dialog.gn-image-viewer img').waitForDisplayed();
    await browser.keys(['=', '=']);
    const before = await $('dialog img').getAttribute('style');
    const point = await browser.execute(() => { const box = document.querySelector('.stage')!.getBoundingClientRect(); return { x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2) }; });
    await browser.action('pointer').move(point).down().move({ x: point.x + 60, y: point.y + 45 }).up().perform();
    expect(await $('dialog img').getAttribute('style')).not.toBe(before);
    await browser.keys('Escape');
    await $('dialog.gn-image-viewer').waitForExist({ reverse: true });
    await $('.gn-image-embed[data-selected="true"]').waitForExist();
    await browser.waitUntil(async () => (await body()) === markdown);
  });
  it('commits one proportional drag and cancels an unfinished drag', async () => {
    await insertMarkdown('Before\n\n![[second.png|200]]\n\nAfter');
    await $('.gn-image-embed img').waitForDisplayed(); await selectImage();
    const point = await browser.execute(() => { const box = document.querySelector('.gn-image-resize-se')!.getBoundingClientRect(); return { x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2) }; });
    await browser.action('pointer').move(point).down().move({ x: point.x + 80, y: point.y + 50 }).up().perform();
    await browser.waitUntil(async () => !(await body()).includes('|200'));
    const resized = await body();
    const next = await browser.execute(() => { const box = document.querySelector('.gn-image-resize-se')!.getBoundingClientRect(); return { x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2) }; });
    await browser.action('pointer').move(next).down().move({ x: next.x + 80, y: next.y + 50 }).perform(true);
    await browser.keys('Escape'); await browser.action('pointer').up().perform();
    expect(await body()).toBe(resized);
    expect(await $('dialog.gn-image-viewer').isExisting()).toBe(false);
    await browser.keys(['Meta', 'z', '\uE000']);
    await browser.waitUntil(async () => (await body()).includes('|200'));
  });
  it('retains selected text after failed paste and retries only failed files', async () => {
    await insertMarkdown('Keep this text');
    await browser.execute(() => window.__GNEAUXGHTS_E2E__!.configureImageSave(1));
    await browser.execute((element: HTMLElement) => {
      element.focus(); const bridge = (window as any).__GNEAUXGHTS_NATIVE_E2E__; bridge.setEditorSelection(0, bridge.readEditorState().editor.markdown.length);
      const data = new DataTransfer();
      for (const name of ['one.svg', 'two.svg']) data.items.add(new File(['<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="blue"/></svg>'], name, { type: 'image/svg+xml' }));
      element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    }, await $('[data-testid="note-editor"] .cm-content'));
    await $('.gn-image-upload-placeholder').$('button=Retry').waitForDisplayed();
    expect(await $('[data-testid="note-editor"] .cm-content').getText()).toContain('Keep this text');
    await $('.gn-image-upload-placeholder').$('button=Retry').click();
    await $('.gn-image-upload-placeholder').waitForExist({ reverse: true });
    await browser.waitUntil(async () => ((await body()).match(/!\[\[/g)?.length ?? 0) === 2);
    expect(await browser.execute(() => window.__GNEAUXGHTS_E2E__!.invocations.filter(call => call.command === 'store_pasted_image').length)).toBe(3);
  });
  it('keeps both pane widgets mounted while sharing a resize and undo', async () => {
    await insertMarkdown('Before\n\n![[second.png|200]]\n\nAfter');
    await $('.gn-image-embed img').waitForDisplayed();
    await $('button[aria-label="Open split pane options"]').click();
    await $('#pane-command-current').waitForExist(); await $('#pane-command-current').click();
    await browser.waitUntil(() => browser.execute(() => document.querySelectorAll('.gn-image-embed img').length === 2));
    await browser.execute(() => { (window as any).__imageNodes = [...document.querySelectorAll('.gn-image-embed')]; });
    await selectImage(); await browser.keys('=');
    await browser.waitUntil(() => browser.execute(() => [...document.querySelectorAll<HTMLElement>('.gn-image-embed')].every(el => el.style.width === '250px')));
    expect(await browser.execute(() => (window as any).__imageNodes.every((el: HTMLElement, index: number) => el === document.querySelectorAll('.gn-image-embed')[index] && el.isConnected))).toBe(true);
    await (await $$('.gn-image-embed button[aria-label="Zoom image"]'))[1].click();
    await $('dialog.gn-image-viewer').waitForDisplayed(); await browser.keys('Escape');
    await $('dialog.gn-image-viewer').waitForExist({ reverse: true });
    await browser.keys(['Meta', 'z', '\uE000']);
    await browser.waitUntil(() => browser.execute(() => [...document.querySelectorAll<HTMLElement>('.gn-image-embed')].every(el => el.style.width === '200px')));
  });
  it('targets width with Tab and keeps viewer and reset actions out of ordinary typing', async () => {
    await insertMarkdown('Before\n\n![Citrus](a%20b.png "Title")\n\nAfter');
    await $('.gn-image-embed img').waitForDisplayed(); await selectImage();
    await browser.keys('Tab'); await browser.keys('250');
    await browser.waitUntil(async () => (await body()).includes('![Citrus|250](a%20b.png "Title")'));
    expect(await $('.gn-image-embed img').isDisplayed()).toBe(true);
    await browser.execute(() => { const bridge = (window as any).__GNEAUXGHTS_NATIVE_E2E__; const length = bridge.readEditorState().editor.markdown.length; bridge.setEditorSelection(length, length); });
    await selectImage(); await browser.keys(' ');
    await $('dialog.gn-image-viewer').waitForDisplayed(); await browser.keys('Escape');
    await $('dialog.gn-image-viewer').waitForExist({ reverse: true }); await browser.keys('0');
    await browser.waitUntil(async () => (await body()).includes('![Citrus](a%20b.png "Title")'));
  });
  it('does not publish a delayed paste into a different note', async () => {
    await insertMarkdown('Keep this text');
    await browser.execute(() => window.__GNEAUXGHTS_E2E__!.configureImageSave(0, 1000));
    await browser.execute((element: HTMLElement) => {
      const data = new DataTransfer(); data.items.add(new File(['<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"/>'], 'late.svg', { type: 'image/svg+xml' }));
      element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    }, await $('[data-testid="note-editor"] .cm-content'));
    await $('.gn-image-upload-placeholder').waitForExist();
    const search = await $('[data-testid="note-search-input"]'); await search.click();
    await $('button[aria-label="Search all notes"]').click(); await search.setValue('Beta note');
    const result = await $('button[aria-label="Open search result: Beta note.md"]'); await result.waitForExist(); await result.click();
    await browser.waitUntil(async () => (await $('[data-testid="note-title"]').getValue()) === 'Beta note');
    await browser.waitUntil(() => browser.execute(() => window.__GNEAUXGHTS_E2E__!.invocations.some(call => call.command === 'store_pasted_image')));
    await browser.pause(1100);
    expect(await $('[data-testid="note-editor"] .cm-content').getText()).not.toContain('![[Pasted image');
    expect(await $('.gn-image-upload-placeholder').isExisting()).toBe(false);
  });

  it('preserves reference targets for Tab entry, shifted plus, burst undo, and reset', async () => {
    await insertMarkdown('Before\n\n![photo][]\n\n[photo]: second.png');
    await $('.gn-image-embed img').waitForDisplayed(); await selectImage();
    await browser.keys('Tab'); await browser.keys(['1', '0', '0']);
    await browser.waitUntil(async () => (await body()).includes('![photo|100][photo]'));
    await browser.execute(() => { const bridge = (window as any).__GNEAUXGHTS_NATIVE_E2E__; bridge.setEditorSelection(0, 0); });
    await selectImage(); await browser.keys(['Shift', '=', '\uE000']);
    await browser.keys('=');
    await browser.waitUntil(async () => (await body()).includes('photo|200'));
    await browser.keys(['Meta', 'z', '\uE000']);
    await browser.waitUntil(async () => (await body()).includes('photo|100'));
    await browser.keys('0');
    await browser.waitUntil(async () => (await body()).includes('![photo][photo]'));
    expect(await $('.gn-image-embed img').isDisplayed()).toBe(true);
  });
  it('renders inline, list, quote, table and narrow-pane images without changing authored widths', async () => {
    const layouts = [
      'Inline ![one|120](second.png) prose', '- ![two|120](second.png)',
      '> ![three|120](second.png)', '| Photo |\n| --- |\n| ![four](second.png) |', '![[second.png|2000]]'
    ];
    for (const [index, layout] of layouts.entries()) {
      const markdown = `Before\n\n${layout}\n\nAfter`;
      await insertMarkdown(markdown); await $('.gn-image-embed img').waitForDisplayed();
      const geometry = await browser.execute(() => {
        const box = document.querySelector('.gn-image-embed')!.getBoundingClientRect();
        return { width: box.width, height: box.height, pane: document.querySelector('.cm-content')!.clientWidth };
      });
      if (index < 3) expect(geometry.width).toBeCloseTo(120, 0);
      expect(geometry.height).toBeGreaterThan(0);
      expect(geometry.width).toBeLessThanOrEqual(geometry.pane + 1);
      await browser.waitUntil(async () => (await body()) === markdown);
    }
  });
  it('retries a missing asset and copies or cuts exact authored Markdown', async () => {
    const markdown = 'Before\n\n![Missing|120](missing.png "Preserved title")\n\nAfter';
    await insertMarkdown(markdown);
    await $('.gn-image-status').$('button=Retry').waitForDisplayed();
    await browser.execute(() => window.__GNEAUXGHTS_E2E__!.seedImageAsset('missing.png'));
    await $('.gn-image-status').$('button=Retry').click(); await $('.gn-image-embed img').waitForDisplayed();
    await selectImage();
    await browser.execute(() => {
      (window as any).__imageCopies = [];
      const original = DataTransfer.prototype.setData;
      const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator.clipboard, 'writeText');
      (window as any).__restoreImageClipboard = () => {
        DataTransfer.prototype.setData = original;
        if (clipboardDescriptor) Object.defineProperty(navigator.clipboard, 'writeText', clipboardDescriptor);
        else delete (navigator.clipboard as any).writeText;
        delete (window as any).__imageCopies;
        delete (window as any).__restoreImageClipboard;
      };
      DataTransfer.prototype.setData = function(type, value) { if (type === 'text/plain') (window as any).__imageCopies.push(value); original.call(this, type, value); };
      Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: async (value: string) => { (window as any).__imageCopies.push(value); } });
    });
    try {
      await browser.keys(['Meta', 'c', '\uE000']);
      expect(await browser.execute(() => (window as any).__imageCopies[0])).toBe('![Missing|120](missing.png "Preserved title")');
      await browser.keys(['Meta', 'x', '\uE000']);
      await browser.waitUntil(async () => !(await body()).includes('![Missing'));
      await browser.keys(['Meta', 'z', '\uE000']);
      await browser.waitUntil(async () => (await body()) === markdown);
      expect(await $('.gn-image-embed img').isDisplayed()).toBe(true);
    } finally {
      await browser.execute(() => (window as any).__restoreImageClipboard?.());
    }
  });

  it('uses a temporary search image and opens the exact current viewer occurrence', async () => {
    const markdown = 'Before\n\n![[second.png|200]]\n\nAfter';
    await insertMarkdown(markdown);
    await browser.waitUntil(async () => (await body()) === markdown);
    await browser.execute(async (markdown) => {
      const native = window.__TAURI_INTERNALS__ as { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      const snapshot = window.__GNEAUXGHTS_E2E__!.snapshot();
      const note = snapshot.notes.find(note => note.noteId === snapshot.activeNoteId)!;
      const from = markdown.indexOf('![[second.png|200]]');
      Object.assign(window.__GNEAUXGHTS_E2E_COMMANDS__!, {
        search_media: () => [{ kind: 'image', noteId: note.noteId, notePath: note.path, noteTitle: note.title,
          noteHash: 'fixture', assetName: 'second.png', assetHash: 'fixture', sourceStart: from,
          sourceEnd: from + '![[second.png|200]]'.length, score: 0.8 }],
        read_image_search_thumbnail: () => native.invoke('read_image_asset_data_url', { fileName: 'second.png' }),
        validate_image_search_result: (args: { currentMarkdown: string }) => args.currentMarkdown === markdown
      });
    }, markdown);
    const input = await $('[data-testid="note-search-input"]');
    await input.click();
    await $('button[aria-label="Search all notes"]').click();
    await pasteSearchImage();
    const hit = await $('button[aria-label="Open second.png in Alpha note"]');
    await hit.waitForDisplayed();
    await $('.image-search-result img').waitForDisplayed();
    const previewIsInsideBar = () => browser.execute(() => {
      const preview = document.querySelector('img[alt="Search query"]');
      const bar = document.querySelector('[data-testid="note-search-input"]')?.closest('.shared-search-bar-shell');
      if (!preview || !bar || !bar.contains(preview) || preview.closest('.search-results-panel')) return false;
      const image = preview.getBoundingClientRect();
      const shell = bar.getBoundingClientRect();
      const magnifier = bar.querySelector('svg');
      if (!magnifier) return false;
      const icon = magnifier.getBoundingClientRect();
      const field = bar.querySelector('input')!.getBoundingClientRect();
      // The dock retains the hidden inner magnifier's measurable bounds for motion.
      const iconHidden = getComputedStyle(magnifier).visibility === 'hidden';
      return (iconHidden || icon.width === 0 || icon.right <= image.left) && field.left >= image.right
        && field.width > 100 && image.left >= shell.left && image.right <= shell.right
        && image.top >= shell.top && image.bottom <= shell.bottom;
    });
    expect(await previewIsInsideBar()).toBe(true);
    await browser.saveScreenshot('/private/tmp/gemma-image-query-inline-desktop.png');
    await browser.setWindowSize(420, 900);
    await waitForTwoAnimationFrames();
    expect(await previewIsInsideBar()).toBe(true);
    await browser.saveScreenshot('/private/tmp/gemma-image-query-inline-mobile.png');
    await browser.setWindowSize(1440, 1000);
    await waitForTwoAnimationFrames();
    const queryPreviewUrl = await $('img[alt="Search query"]').getAttribute('src');
    await input.setValue('proxy server and offline mode');
    await browser.waitUntil(() => browser.execute(() => window.__GNEAUXGHTS_E2E__!.invocations.some(entry =>
      entry.command === 'search_media' && entry.args.query === 'proxy server and offline mode' && typeof entry.args.imageBase64 === 'string'
    )));
    await hit.waitForDisplayed();
    expect(await $('img[alt="Search query"]').getAttribute('src')).toBe(queryPreviewUrl);
    const clear = await $('button[aria-label="Clear search"]');
    expect(await clear.isExisting()).toBe(true);
    await clear.click();
    await hit.waitForExist({ reverse: true });
    expect(await $('img[alt="Search query"]').isExisting()).toBe(false);
    expect(await input.getValue()).toBe('');
    expect(await browser.execute(() => document.activeElement?.getAttribute('data-testid'))).toBe('note-search-input');
    await input.click();
    expect(await hit.isExisting()).toBe(false);
    await pasteSearchImage();
    await hit.waitForDisplayed();
    await input.setValue('network settings');
    await browser.waitUntil(() => browser.execute(() => window.__GNEAUXGHTS_E2E__!.invocations.some(entry =>
      entry.command === 'search_media' && entry.args.query === 'network settings' && typeof entry.args.imageBase64 === 'string'
    )));
    await hit.waitForDisplayed();
    await browser.keys('Escape');
    await hit.waitForExist({ reverse: true });
    expect(await $('img[alt="Search query"]').isExisting()).toBe(false);
    expect(await input.getValue()).toBe('');
    await pasteSearchImage();
    await hit.waitForDisplayed();
    await input.click();
    await browser.keys('ArrowDown');
    await browser.keys('Enter');
    await $('dialog.gn-image-viewer').waitForDisplayed();
    expect(await $('dialog header').getText()).toContain('second.png');
    expect(await body()).toBe(markdown);
    const calls = await browser.execute(() => window.__GNEAUXGHTS_E2E__!.invocations);
    expect(calls.some(entry => entry.command === 'search_media' && typeof entry.args.imageBase64 === 'string')).toBe(true);
    expect(calls.some(entry => entry.command === 'validate_image_search_result')).toBe(true);
    expect(calls.filter(entry => entry.command === 'store_pasted_image')).toHaveLength(0);
    await browser.keys('Escape');
  });

});
