import { browser, expect, $ } from '@wdio/globals';
import { resetBrowserWorkspace } from '../../support/browserWorkspace';
import { openBrowserPiPane, readPiFixture, seedPiHistory, selectPiConversation } from '../../support/browserPi';

const menu = () => $('[role="menu"][aria-label="Conversations"]');

describe('forgetting chats from the conversation list', () => {
  beforeEach(resetBrowserWorkspace);

  it('forgets consecutive unopened chats while keeping the list, scroll position and current draft', async () => {
    await browser.executeAsync((done: (error: string | null) => void) => {
      void (async () => {
        for (let index = 0; index < 18; index++) await window.__GNEAUXGHTS_E2E__!.seedPiChat({ title: `Cleanup ${index}`, count: 1 });
      })().then(() => done(null), cause => done(String(cause)));
    });
    await seedPiHistory('Keep open', 1);
    await openBrowserPiPane(); await selectPiConversation('Keep open');
    const composer = await $('textarea[aria-label="Message"]');
    await composer.setValue('Keep my draft');
    await $('button[aria-label="Conversations"]').click();
    await browser.execute(() => { document.querySelector<HTMLElement>('[role="menu"][aria-label="Conversations"]')!.scrollTop = 220; });
    for (const title of ['Cleanup 10', 'Cleanup 9']) {
      const forget = await $(`button[aria-label="Forget ${title}"]`);
      await forget.scrollIntoView({ block: 'nearest' });
      await forget.parentElement().moveTo();
      const top = await menu().getProperty('scrollTop');
      await forget.click();
      await $(`button[aria-label="Confirm forget ${title}"]`).click();
      await expect(forget).not.toBeExisting();
      await expect(menu()).toBeDisplayed();
      expect(Math.abs(Number(await menu().getProperty('scrollTop')) - Number(top))).toBeLessThan(2);
      await expect($('input[aria-label="Conversation title"]')).toHaveValue('Keep open');
      await expect(composer).toHaveValue('Keep my draft');
    }
    expect((await readPiFixture()).some(row => row.title === 'Cleanup 10' || row.title === 'Cleanup 9')).toBe(false);
    await menu().$('button=Undo').click();
    await expect($('button[aria-label="Forget Cleanup 9"]')).toBeExisting();
    await expect($('input[aria-label="Conversation title"]')).toHaveValue('Keep open');
    await expect(composer).toHaveValue('Keep my draft');
    await $('button[aria-label="Forget Cleanup 9"]').parentElement().moveTo();
    await browser.saveScreenshot('/private/tmp/chat-forget-list-desktop.png');
  });

  it('confirms and cancels on a narrow screen and can forget the selected chat without closing the list', async () => {
    await seedPiHistory('Selected cleanup', 2);
    await openBrowserPiPane(); await selectPiConversation('Selected cleanup');
    await browser.setWindowSize(430, 900);
    try {
      await $('button[aria-label="Conversations"]').click();
      const placement = await browser.execute(() => ({
        menuTop: document.querySelector('[role="menu"][aria-label="Conversations"]')!.getBoundingClientRect().top,
        headerBottom: document.querySelector('[data-testid="pi-chat-panel"] .pane-header')!.getBoundingClientRect().bottom
      }));
      expect(placement.menuTop).toBeGreaterThanOrEqual(placement.headerBottom - 1);
      await $('button[aria-label="Forget Selected cleanup"]').click();
      await menu().$('button=Cancel').click();
      await expect($('button[aria-label="Forget Selected cleanup"]')).toBeFocused();
      expect(await readPiFixture()).toHaveLength(1);
      await $('button[aria-label="Forget Selected cleanup"]').click();
      await $('button[aria-label="Confirm forget Selected cleanup"]').click();
      await expect(menu()).toBeDisplayed();
      await expect($('input[aria-label="Conversation title"]')).toHaveValue('');
      expect(await readPiFixture()).toEqual([]);
      await menu().$('button=Undo').click();
      await expect($('button[aria-label="Forget Selected cleanup"]')).toBeExisting();
      await expect($('input[aria-label="Conversation title"]')).toHaveValue('');
      expect(await readPiFixture()).toHaveLength(1);
      await browser.saveScreenshot('/private/tmp/chat-forget-list-mobile.png');
    } finally { await browser.setWindowSize(1440, 1000); }
  });
});
