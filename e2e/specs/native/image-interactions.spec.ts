import { browser, expect, $ } from '@wdio/globals';
async function state() { return browser.execute(() => (window as any).__GNEAUXGHTS_NATIVE_E2E__.readEditorState() as { noteId: string; editor: { markdown: string; selection: { anchor: number; head: number }; ownsWebviewFocus: boolean } }); }
async function key(key: string, meta = false) {
  await browser.execute((key, meta) => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key, metaKey: meta, bubbles: true, cancelable: true })), key, meta);
}
async function invoke(command: string, args: Record<string, unknown>) {
  const result = await browser.executeAsync((command, args, done) => {
    (window as any).__TAURI_INTERNALS__.invoke(command, args).then((value: unknown) => done({ value }), (error: unknown) => done({ error: String(error) }));
  }, command, args) as { value?: any; error?: string };
  if (result.error) throw new Error(result.error); return result.value;
}
describe('native image interaction lifecycle', () => {
  before(async () => {
    await browser.switchToWindow('main');
    await $('[data-testid="note-editor"] .cm-content').waitForDisplayed({ timeout: 30_000 });
    await $('span=Loading editor').waitForExist({ reverse: true });
  });
  it('imports a WebKit clipboard file, resizes, opens the viewer, and persists on reopen', async () => {
    const title = await $('[data-testid="note-title"]'); await title.setValue('Native image journey');
    const content = await $('[data-testid="note-editor"] .cm-content');
    await browser.execute((element: HTMLElement) => {
      element.focus();
      const bridge = (window as any).__GNEAUXGHTS_NATIVE_E2E__;
      bridge.setEditorSelection(0, bridge.readEditorState().editor.markdown.length);
      const data = new DataTransfer();
      data.items.add(new File(['<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="700"><rect width="1000" height="700" fill="blue"/></svg>'], 'native.svg', { type: 'image/svg+xml' }));
      element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    }, content);
    await $('.gn-image-embed img').waitForDisplayed();
    await $('.gn-image-embed button[aria-label="Zoom image"]').click();
    await $('dialog.gn-image-viewer img').waitForDisplayed(); await key('Escape');
    await $('dialog.gn-image-viewer').waitForExist({ reverse: true });
    await $('.gn-image-embed[data-selected="true"]').waitForExist();
    await key('-');
    await browser.waitUntil(async () => /\|\d+\]\]/.test((await state()).editor.markdown));
    const markdown = (await state()).editor.markdown;
    const asset = markdown.match(/!\[\[([^|]+)\|/)![1];
    expect((await invoke('read_image_asset_data_url', { fileName: asset })).startsWith('data:image/svg+xml;base64,')).toBe(true);
    const point = await browser.execute(() => {
      const box = document.querySelector('.gn-image-resize-se')!.getBoundingClientRect();
      return { x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2) };
    });
    await browser.action('pointer').move(point).down().move({ x: point.x + 60, y: point.y + 40 }).perform(true);
    await key('Escape'); await browser.action('pointer').up().perform();
    expect((await state()).editor.markdown).toBe(markdown);
    const noteId = (await state()).noteId;
    await browser.waitUntil(async () => (await invoke('read_note', { noteId, path: null })).markdown === markdown, { timeout: 20_000 });
    await browser.reloadSession(); await browser.switchToWindow('main');
    await $('.gn-image-embed img').waitForDisplayed({ timeout: 30_000 });
    expect((await state()).editor.markdown).toBe(markdown);
    await $('.gn-image-embed button[aria-label="Zoom image"]').click();
    await $('dialog.gn-image-viewer').waitForDisplayed(); await key('Escape');
    await $('dialog.gn-image-viewer').waitForExist({ reverse: true });
    await key('x', true);
    await browser.waitUntil(async () => !(await state()).editor.markdown.includes('![['));
    await key('z', true);
    await browser.waitUntil(async () => (await state()).editor.markdown === markdown);
    expect((await invoke('read_image_asset_data_url', { fileName: asset })).startsWith('data:')).toBe(true);
  });
});
