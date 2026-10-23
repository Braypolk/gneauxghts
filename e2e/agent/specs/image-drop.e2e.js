import { browser, $, $$, expect } from '@wdio/globals';

// Exported from image-drop, then reviewed to retain only the regression journeys.
const markdown = () => browser.execute(() => window.__GNEAUXGHTS_NATIVE_E2E__.readEditorState().editor.markdown);
async function dropImages(count = 1) {
  return browser.execute(count => {
    const content = document.querySelector('[data-testid="note-editor"] .cm-content');
    const blank = [...content.querySelectorAll('.cm-line')].find(line => !line.textContent.trim());
    const rect = blank.getBoundingClientRect();
    const data = new DataTransfer();
    for (let i = 0; i < count; i++) data.items.add(new File([
      '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="blue"/></svg>'
    ], `dropped-${i}.svg`, { type: 'image/svg+xml' }));
    data.setData('text/plain', 'do not insert the drag payload as text');
    const init = { dataTransfer: data, clientX: rect.left + 3, clientY: rect.top + rect.height / 2, bubbles: true, cancelable: true };
    const over = new DragEvent('dragover', init);
    content.dispatchEvent(over);
    const drop = new DragEvent('drop', init);
    content.dispatchEvent(drop);
    return { over: over.defaultPrevented, drop: drop.defaultPrevented,
      markdown: window.__GNEAUXGHTS_NATIVE_E2E__.readEditorState().editor.markdown };
  }, count);
}
describe('image file drops', () => {
  beforeEach(async () => {
    await browser.url('/');
    await expect($('[data-testid="note-title"]')).toHaveValue('Alpha note');
    await browser.execute(() => {
      const content = document.querySelector('[data-testid="note-editor"] .cm-content');
      content.focus();
      const bridge = window.__GNEAUXGHTS_NATIVE_E2E__;
      bridge.setEditorSelection(0, bridge.readEditorState().editor.markdown.length);
      const text = new DataTransfer(); text.setData('text/plain', 'Before\n\nAfter');
      content.dispatchEvent(new ClipboardEvent('paste', { clipboardData: text, bubbles: true, cancelable: true }));
      // A file drop inserts at its pointer, even while another authored range is selected.
      bridge.setEditorSelection(8, 13);
    });
  });
  it('imports multiple files at the pointer and undoes the entire import', async () => {
    await browser.execute(() => window.__GNEAUXGHTS_E2E__.configureImageSave(0, 400));
    expect(await dropImages(2)).toEqual({ over: true, drop: true, markdown: 'Before\n\nAfter' });
    await expect($('.gn-image-upload-placeholder')).toExist();
    await browser.waitUntil(async () => (await $$('.gn-image-embed img')).length === 2);
    expect(await markdown()).toMatch(/^Before\n!\[\[[^\]]+\]\]\n\n!\[\[[^\]]+\]\]\nAfter$/);
    expect(await browser.execute(() => window.__GNEAUXGHTS_E2E__.invocations.filter(call => call.command === 'store_pasted_image').length)).toBe(2);
    await browser.keys(['Meta', 'z', '\uE000']);
    await browser.waitUntil(async () => await markdown() === 'Before\n\nAfter');
  });
  it('retains the original text after failure and retries only the failed file', async () => {
    await browser.execute(() => window.__GNEAUXGHTS_E2E__.configureImageSave(1));
    await dropImages(2);
    await expect($('.gn-image-upload-placeholder').$('button=Retry')).toBeDisplayed();
    expect(await markdown()).toBe('Before\n\nAfter');
    await expect($('[aria-label="Text formatting"]')).not.toExist();
    expect(await browser.execute(() => {
      const selection = window.__GNEAUXGHTS_NATIVE_E2E__.readEditorState().editor.selection;
      return selection.anchor === selection.head;
    })).toBe(true);
    await $('.gn-image-upload-placeholder').$('button=Retry').click();
    await browser.waitUntil(async () => (await $$('.gn-image-embed img')).length === 2);
    expect(await browser.execute(() => window.__GNEAUXGHTS_E2E__.invocations.filter(call => call.command === 'store_pasted_image').length)).toBe(3);
    expect(await markdown()).toMatch(/^Before\n!\[\[[^\]]+\]\]\n\n!\[\[[^\]]+\]\]\nAfter$/);
  });
  it('discards an unfinished drop when navigating to another note', async () => {
    await browser.execute(() => window.__GNEAUXGHTS_E2E__.configureImageSave(0, 1000));
    await dropImages();
    await expect($('.gn-image-upload-placeholder')).toExist();
    const search = await $('[data-testid="note-search-input"]');
    await search.click(); await search.setValue('Beta note');
    await $('button[aria-label="Open search result: Beta note.md"]').click();
    await expect($('[data-testid="note-title"]')).toHaveValue('Beta note');
    await browser.pause(1100); // Complete the controlled save after retiring its originating view.
    expect(await markdown()).not.toContain('![[');
    expect(await $('.gn-image-upload-placeholder').isExisting()).toBe(false);
  });
  it('preserves CodeMirror text drag/drop behavior', async () => {
    await browser.execute(() => {
      const content = document.querySelector('[data-testid="note-editor"] .cm-content');
      const blank = [...content.querySelectorAll('.cm-line')].find(line => !line.textContent.trim());
      const rect = blank.getBoundingClientRect(); const data = new DataTransfer(); data.setData('text/plain', 'Dragged text');
      content.dispatchEvent(new DragEvent('drop', { dataTransfer: data, clientX: rect.left + 3,
        clientY: rect.top + rect.height / 2, bubbles: true, cancelable: true }));
    });
    await browser.waitUntil(async () => await markdown() === 'Before\nDragged text\nAfter');
    expect(await browser.execute(() => window.__GNEAUXGHTS_E2E__.invocations.filter(call => call.command === 'store_pasted_image').length)).toBe(0);
  });
});
