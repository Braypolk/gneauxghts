import { browser, expect, $ } from '@wdio/globals';

async function expectReady(title: string, body: string) {
  await browser.waitUntil(async () =>
    (await $('[data-testid="note-title"]').getValue()) === title
  );
  const content = await $('[data-testid="note-editor"] .cm-content');
  await content.waitForDisplayed();
  expect(await content.getText()).toContain(body);
  await $('span=Loading editor').waitForExist({ reverse: true });
  expect(await content.getAttribute('contenteditable')).toBe('true');
  await $('[data-testid="note-tags"]').waitForExist();
  expect(await $('[data-testid="note-tags"] input[aria-label="Add tag"]').isExisting()).toBe(true);
}

async function shortcut(key: string) {
  await browser.execute((key: string) => {
    window.dispatchEvent(new KeyboardEvent('keydown', {
      key, metaKey: true, bubbles: true, cancelable: true
    }));
  }, key);
}

describe('editor readiness', () => {
  it('stays ready across repeated note navigation and app focus refreshes', async () => {
    await browser.url('/');
    await browser.execute(() => localStorage.setItem('gneauxghts.tags-visible', 'true'));
    await browser.refresh();
    await $('[data-testid="note-title"]').waitForDisplayed({ timeout: 30_000 });
    await expectReady('Alpha note', 'Alpha line 1');
    const search = await $('[data-testid="note-search-input"]');
    await search.click();
    await $('button[aria-label="Search all notes"]').click();
    await search.setValue('Beta note');
    const result = await $('button[aria-label="Open search result: Beta note.md"]');
    await result.waitForExist();
    await browser.execute((element: HTMLElement) => element.click(), result);
    await expectReady('Beta note', 'Beta body is independent from Alpha.');

    for (let attempt = 0; attempt < 12; attempt += 1) {
      await browser.execute(() => {
        window.dispatchEvent(new Event('blur'));
        window.dispatchEvent(new Event('focus'));
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await shortcut('l');
      await expectReady(
        attempt % 2 === 0 ? 'Alpha note' : 'Beta note',
        attempt % 2 === 0 ? 'Alpha line 1' : 'Beta body is independent from Alpha.'
      );
    }

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await shortcut('t');
      await $('[data-pane-kind="chat"]').waitForExist();
      await shortcut('l');
      await expectReady('Beta note', 'Beta body is independent from Alpha.');
    }
  });
});
