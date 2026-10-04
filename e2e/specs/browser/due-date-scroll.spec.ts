import { browser, expect, $ } from '@wdio/globals';

async function editorText(value: string) {
  const content = await $('[data-testid="note-editor"] .cm-content');
  await content.waitForDisplayed();
  await content.click();
  await browser.execute((element: HTMLElement, text: string) => {
    element.focus(); document.execCommand('selectAll'); document.execCommand('insertText', false, text);
  }, content, value);
}
async function savedMarkdown() {
  return browser.execute(() => {
    if (!window.__GNEAUXGHTS_E2E__) return (window as any).__GNEAUXGHTS_NATIVE_E2E__.readEditorState().editor.markdown as string;
    const snapshot = window.__GNEAUXGHTS_E2E__!.snapshot();
    return snapshot.notes.find((note) => note.noteId === snapshot.activeNoteId)!.markdown;
  });
}
async function waitForSaved(text: string) { await browser.waitUntil(async () => (await savedMarkdown()).includes(text)); }

// Run this same journey with wdio.native.conf.ts to cover macOS WebKit.
describe('due-date scroll restoration', () => {
  before(async () => {
    if (browser.isChromium) await browser.url('/');
    else await browser.switchToWindow('main');
    await $('[data-testid="note-editor"] .cm-content').waitForDisplayed({ timeout: 30_000 });
  });

  it('keeps the scrolled task in view when applying and removing a due date with the caret above it', async () => {
    await editorText(`${'Earlier notes\n'.repeat(60)}- [ ] Scrolled task\n${'Later notes\n'.repeat(60)}`);
    await waitForSaved('Scrolled task');
    await browser.execute(() => {
      (window as any).__GNEAUXGHTS_NATIVE_E2E__.setEditorSelection(0, 0);
      document.querySelector<HTMLElement>('.cm-scroller')!.scrollTop = 60 * 24;
    });
    const add = await $('button[aria-label="Add due date"]');
    await add.waitForExist();
    await add.scrollIntoView({ block: 'center' });
    await add.moveTo();
    const scrollPosition = () => browser.execute(() => document.querySelector<HTMLElement>('.cm-scroller')!.scrollTop);
    const before = await scrollPosition();
    expect(before).toBeGreaterThan(500);
    await add.click();
    await $('[aria-label="Date or shortcut"]').setValue('2099-01-01');
    await $('button=Apply').click();
    await $('dialog.date-time-picker').waitForExist({ reverse: true });
    await waitForSaved('Scrolled task due @due(2099-01-01)');
    expect(Math.abs((await scrollPosition()) - before)).toBeLessThanOrEqual(2);
    expect(await browser.execute(() => document.activeElement?.classList.contains('cm-content'))).toBe(true);

    await $('button[aria-label="Edit due date: 2099-01-01"]').click();
    await $('button=Remove due date').click();
    await $('dialog.date-time-picker').waitForExist({ reverse: true });
    await browser.waitUntil(async () => !(await savedMarkdown()).includes('@due('));
    expect(Math.abs((await scrollPosition()) - before)).toBeLessThanOrEqual(2);
  });

});
