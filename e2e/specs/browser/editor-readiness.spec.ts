import { browser, expect, $ } from '@wdio/globals';
import { resetBrowserWorkspace, waitForNote } from '../../support/browserWorkspace';
import { waitForTwoAnimationFrames } from '../../support/animationFrames';

declare global {
  interface Window {
    __pendingNoteOpen?: { entered: boolean; release: () => void; cleanup: () => void };
  }
}

async function expectReady(title: string, body: string) {
  await browser.waitUntil(async () =>
    (await $('[data-testid="note-title"]').getValue()) === title
  );
  const content = await $('[data-testid="note-editor"] .cm-content');
  await content.waitForDisplayed();
  expect(await content.getText()).toContain(body);
  await $('[data-testid="note-editor"][aria-busy="false"]').waitForExist();
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
    await browser.keys('Enter');
    await expectReady('Beta note', 'Beta body is independent from Alpha.');
    expect(await search.getValue()).toBe('Beta note');

    await search.click();
    await $('button[aria-label="Search this note only"]').click();
    await search.setValue('independent');
    await $('button[aria-label^="Open search result:"]').waitForExist();
    await browser.keys('Enter');
    expect(await search.getValue()).toBe('independent');
    expect(await $('[data-testid="note-editor"] .cm-content').isFocused()).toBe(true);

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

  it('keeps a newer search interaction when an older note open completes', async () => {
    await resetBrowserWorkspace();
    const search = await $('[data-testid="note-search-input"]');
    await search.click();
    await $('button[aria-label="Search all notes"]').click();
    await search.setValue('Beta note');
    await $('button[aria-label="Open search result: Beta note.md"]').waitForExist();
    await browser.execute(() => {
      const ipc = window.__TAURI_INTERNALS__;
      const original = ipc.invoke;
      const gate: NonNullable<Window['__pendingNoteOpen']> = { entered: false, release: () => {}, cleanup: () => {} };
      window.__pendingNoteOpen = gate;
      ipc.invoke = <T>(command: string, args: Record<string, unknown>) => {
        if (command === 'open_note') return new Promise<T>((resolve, reject) => {
          gate.entered = true;
          gate.release = () => {
            gate.release = () => {};
            original<T>(command, args).then(resolve, reject);
          };
        });
        return original<T>(command, args);
      };
      gate.cleanup = () => {
        gate.release();
        ipc.invoke = original;
        delete window.__pendingNoteOpen;
      };
    });
    try {
      await browser.keys('Enter');
      await browser.waitUntil(() => browser.execute(() => window.__pendingNoteOpen!.entered));
      await search.click();
      await search.setValue('Alpha note');
      await $('button[aria-label="Open search result: Alpha note.md"]').waitForExist();
      await expect(search).toBeFocused();
      await browser.execute(() => window.__pendingNoteOpen!.release());
      await waitForNote('Beta note');
      await waitForTwoAnimationFrames();
      await expect(search).toBeFocused();
      await expect($('button[aria-label="Open search result: Alpha note.md"]')).toBeDisplayed();
    } finally {
      await browser.execute(() => window.__pendingNoteOpen?.cleanup());
    }
  });
});
