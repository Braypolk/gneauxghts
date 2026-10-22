import { browser, $, expect } from '@wdio/globals';

async function replaceBody(markdown) {
  await browser.execute(value => {
    const content = document.querySelector('[data-testid="note-editor"] .cm-content');
    content.focus();
    const bridge = window.__GNEAUXGHTS_NATIVE_E2E__;
    bridge.setEditorSelection(0, bridge.readEditorState().editor.markdown.length);
    const data = new DataTransfer(); data.setData('text/plain', value);
    content.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, markdown);
}

async function body() {
  return browser.execute(() => window.__GNEAUXGHTS_NATIVE_E2E__.readEditorState().editor.markdown);
}

async function openPicker() {
  await expect($('.slash-panel')).toBeDisplayed();
  await $('.slash-item-label=Image from file…').click();
  await browser.waitUntil(() => browser.execute(() => !!document.querySelector('input[data-image-file-picker]')));
}

async function selectFile() {
  await browser.execute(() => {
    const input = document.querySelector('input[data-image-file-picker]');
    const data = new DataTransfer();
    data.items.add(new File([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='), c => c.charCodeAt(0))], 'diagram.png', { type: 'image/png' }));
    input.files = data.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

describe('slash image file picker', () => {
  beforeEach(async () => {
    await browser.url('/');
    await browser.execute(() => localStorage.clear());
    await browser.refresh();
    await expect($('[data-testid="note-title"]')).toHaveValue('Alpha note');
    await browser.execute(() => {
      // Headless Chrome immediately cancels OS dialogs. Keep the real file input
      // open for a FileList change, while exercising the actual picker/import path.
      const click = HTMLInputElement.prototype.click;
      window.__restoreImagePickerClick = () => { HTMLInputElement.prototype.click = click; };
      HTMLInputElement.prototype.click = function () { if (this.type !== 'file') click.call(this); };
    });
  });

  afterEach(async () => {
    await browser.execute(() => { window.__restoreImagePickerClick?.(); delete window.__restoreImagePickerClick; });
  });

  it('opens a platform file input, imports through image storage, and undoes as one edit', async () => {
    await replaceBody('Before\n\n/image');
    await openPicker();
    expect(await body()).toBe('Before\n\n/image');
    expect(await $('input[data-image-file-picker]').getAttribute('accept')).toContain('.png');
    await selectFile();
    await expect($('.gn-image-embed img')).toBeDisplayed();
    expect(await body()).toMatch(/^Before\n\n!\[\[.+\.png\]\]$/);
    const count = await browser.execute(() => window.__GNEAUXGHTS_E2E__.invocations.filter(entry => entry.command === 'store_pasted_image').length);
    expect(count).toBe(1);
    expect(await $('input[data-image-file-picker]').isExisting()).toBe(false);
    await browser.keys(['Meta', 'z', '\uE000']);
    await browser.waitUntil(async () => (await body()) === 'Before\n\n/image');
    await browser.keys('ArrowLeft');
    await browser.keys('ArrowRight');
    await openPicker();
    await selectFile();
    await expect($('.gn-image-embed img')).toBeDisplayed();
    expect(await browser.execute(() => window.__GNEAUXGHTS_E2E__.invocations.filter(entry => entry.command === 'store_pasted_image').length)).toBe(2);
  });

  it('cancel preserves the slash command and makes no storage request', async () => {
    await replaceBody('/image');
    await openPicker();
    await browser.execute(() => document.querySelector('input[data-image-file-picker]').dispatchEvent(new Event('cancel')));
    expect(await body()).toBe('/image');
    expect(await $('input[data-image-file-picker]').isExisting()).toBe(false);
    expect(await $('.gn-image-upload-placeholder').isExisting()).toBe(false);
    expect(await browser.execute(() => window.__GNEAUXGHTS_E2E__.invocations.filter(entry => entry.command === 'store_pasted_image').length)).toBe(0);
  });

  it('retains the command after a save failure and retries the canonical import', async () => {
    await browser.execute(() => window.__GNEAUXGHTS_E2E__.configureImageSave(1));
    await replaceBody('/image');
    await openPicker();
    await selectFile();
    await expect($('.gn-image-upload-placeholder')).toHaveText(expect.stringContaining('Image save failed.'));
    expect(await body()).toBe('/image');
    await $('.gn-image-upload-placeholder').$('button=Retry').click();
    await expect($('.gn-image-embed img')).toBeDisplayed();
    expect(await body()).toMatch(/^!\[\[.+\.png\]\]$/);
    expect(await browser.execute(() => window.__GNEAUXGHTS_E2E__.invocations.filter(entry => entry.command === 'store_pasted_image').length)).toBe(2);
  });
});
