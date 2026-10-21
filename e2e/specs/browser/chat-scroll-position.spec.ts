import { browser, expect, $ } from '@wdio/globals';
import { resetBrowserWorkspace } from '../../support/browserWorkspace';
import { waitForWorkspaceAnimationSettled } from '../../support/workspaceAnimation';
import { seedPiHistory, openBrowserPiPane, selectPiConversation } from '../../support/browserPi';

async function waitForChat(title: string) {
  await browser.waitUntil(async () =>
    (await $('input[aria-label="Conversation title"]').getValue()) === title);
  await waitForWorkspaceAnimationSettled();
  // Include the correction frame after batched message rendering.
  await browser.execute(() => new Promise<void>((done) => {
    requestAnimationFrame(() => requestAnimationFrame(() => done()));
  }));
}

async function openConversation(title: string) {
  await $('button[aria-label="Conversations"]').click();
  await $(`[role="menuitem"]*=${title}`).click();
  await waitForChat(title);
}

async function scrollTo(position: number) {
  const result = await browser.execute(top => {
    const log = document.querySelector<HTMLElement>('[role="log"]')!;
    log.scrollTop = top;
    log.dispatchEvent(new Event('scroll'));
    return log.scrollTop;
  }, position);
  return result;
}

async function scrollTop() {
  return browser.execute(() => document.querySelector<HTMLElement>('[role="log"]')!.scrollTop);
}

describe('chat scroll position retention', () => {
  beforeEach(async () => {
    await resetBrowserWorkspace();
    await seedPiHistory('First reading chat', 40);
    await seedPiHistory('Second reading chat', 40);
    await openBrowserPiPane();
    await selectPiConversation('First reading chat');
    await waitForChat('First reading chat');
  });

  it('restores each conversation independently after loading its history again', async () => {
    for (const firstTop of [350, 0]) {
      const firstPosition = await scrollTo(firstTop);
      await openConversation('Second reading chat');
      const secondPosition = await scrollTo(1200);
      await openConversation('First reading chat');
      expect(Math.abs(await scrollTop() - firstPosition)).toBeLessThanOrEqual(1);
      await openConversation('Second reading chat');
      expect(Math.abs(await scrollTop() - secondPosition)).toBeLessThanOrEqual(1);
      await openConversation('First reading chat');
    }
  });

  it('restores the reading position after the chat surface is replaced with a note', async () => {
    const position = await scrollTo(600);
    await $('[data-pane-kind="chat"] button[aria-label="Open previous location"]').click();
    await $('[role="log"]').waitForExist({ reverse: true });
    await waitForWorkspaceAnimationSettled();
    await $('[data-testid="workspace-pane"]:last-child button[aria-label="Open thought partner"]').click();
    await waitForChat('First reading chat');
    expect(Math.abs(await scrollTop() - position)).toBeLessThanOrEqual(1);
  });

  it('opens unseen conversations at the latest message and restores following at the bottom', async () => {
    await openConversation('Second reading chat');
    const bottomGap = () => browser.execute(() => {
      const log = document.querySelector<HTMLElement>('[role="log"]')!;
      return log.scrollHeight - log.clientHeight - log.scrollTop;
    });
    expect(await bottomGap()).toBeLessThanOrEqual(1);
    await openConversation('First reading chat');
    await scrollTo(350);
    await openConversation('Second reading chat');
    expect(await bottomGap()).toBeLessThanOrEqual(1);
  });
});
