import { browser, $, expect } from '@wdio/globals';
import { invokeNative } from '../../support/liveNative';

type NativeTestWindow = typeof window & {
  __GNEAUXGHTS_NATIVE_E2E__: {
    readEditorState(): { editor: { markdown: string; selection: { anchor: number; head: number } } };
    setEditorSelection(anchor: number, head: number): boolean;
  };
};

const editor = '[data-testid="note-editor"]';
const firstText = Array.from({ length: 80 }, (_, index) =>
  `Line ${index}: A long paragraph with [[Second cursor note]] and **formatted content**.`
).join('\n\n');
const secondText = 'Second cursor content';

async function ready(title: string) {
  await browser.waitUntil(() => browser.execute(expected =>
    document.querySelector<HTMLInputElement>('[data-testid="note-title"]')?.value === expected &&
    document.querySelector('[data-testid="note-editor"]')?.getAttribute('aria-busy') === 'false', title));
}
async function state() {
  return browser.execute(() => (window as NativeTestWindow).__GNEAUXGHTS_NATIVE_E2E__.readEditorState().editor);
}
async function previous() {
  await browser.execute(() => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'l', code: 'KeyL', metaKey: true, bubbles: true, cancelable: true
  })));
}
async function typeAtCursor(text: string) {
  // WDIO's embedded key actions dispatch keydown without native contenteditable
  // insertion. execCommand exercises WebKit's editing path without refocusing.
  const inserted = await browser.execute(value => document.execCommand('insertText', false, value), text);
  expect(inserted).toBe(true);
}

describe('native previous-note typing focus', () => {
  before(async () => {
    await $(editor).waitForExist({ timeout: 30_000 });
    const first = await invokeNative<{ noteId: string }>('save_note', {
      title: 'First cursor note', markdown: firstText, currentPath: null
    });
    const second = await invokeNative<{ noteId: string }>('save_note', {
      title: 'Second cursor note', markdown: secondText, currentPath: null
    });
    await invokeNative('mark_note_opened', { noteId: second.noteId });
    await invokeNative('mark_note_opened', { noteId: first.noteId });
    await browser.refresh();
    await ready('First cursor note');
    await invokeNative('plugin:window|show', { label: 'main' });
    await invokeNative('plugin:window|set_focus', { label: 'main' });
    await browser.waitUntil(() => browser.execute(() => document.hasFocus()));
  });

  it('types at each saved cursor after Cmd+L and the previous-note button without clicking the note', async () => {
    await browser.execute(() => (window as NativeTestWindow).__GNEAUXGHTS_NATIVE_E2E__.setEditorSelection(6, 6));
    await previous();
    await ready('Second cursor note');
    await browser.execute(() => (window as NativeTestWindow).__GNEAUXGHTS_NATIVE_E2E__.setEditorSelection(3, 3));
    await previous();
    await ready('First cursor note');
    expect((await state()).selection).toEqual({ anchor: 6, head: 6 });
    await typeAtCursor('X');
    await browser.waitUntil(async () => (await state()).markdown === firstText.slice(0, 6) + 'X' + firstText.slice(6));
    await $('button[aria-label="Open previous location in this pane"]').click();
    await ready('Second cursor note');
    expect((await state()).selection).toEqual({ anchor: 3, head: 3 });
    await typeAtCursor('Y');
    await browser.waitUntil(async () => (await state()).markdown === secondText.slice(0, 3) + 'Y' + secondText.slice(3));
    await previous();
    await ready('First cursor note');
    expect((await state()).selection).toEqual({ anchor: 7, head: 7 });
    await typeAtCursor('Z');
    await browser.waitUntil(async () => (await state()).markdown === firstText.slice(0, 6) + 'XZ' + firstText.slice(6));
  });
});
