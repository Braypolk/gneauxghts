import { browser, $, expect } from '@wdio/globals';

// Exported from the chat-activity session, then isolated for fresh fixture replay.
const history = () => $('button[aria-label="Conversations"]');
const historyDot = status => history().$(`[data-chat-activity${status ? `="${status}"` : ''}]`);
const switcher = () => $('button[aria-label="Open thought partner in this pane"]');
const switcherDot = status => switcher().$(`[data-chat-activity${status ? `="${status}"` : ''}]`);
const rowDot = status => $(`.conversation-row [data-chat-activity${status ? `="${status}"` : ''}]`);
const conversation = () => $('.conversation-title');

async function holdAndSend(text) {
  await browser.execute(async () => { await window.__GNEAUXGHTS_E2E__.holdNextPiResponse(); });
  await $('textarea[aria-label="Message"]').setValue(text);
  await $('[data-testid="pi-send"]').click();
  await expect(historyDot('running')).toBeDisplayed();
  // Ensure the provider has entered its held response before releasing or stopping.
  await expect($('[data-testid="pi-activity"]')).toHaveText('Waiting for model…');
}
async function finish(text) {
  await browser.execute(async text => { await window.__GNEAUXGHTS_E2E__.releaseHeldPiResponse(text); }, text);
}
async function leaveConversation() {
  await history().click();
  await $('[data-new-conversation]').click();
}

describe('Background chat activity dots', () => {
  beforeEach(async () => {
    await browser.sendCommand('Emulation.clearDeviceMetricsOverride', {});
    await browser.sendCommand('Emulation.setEmulatedMedia', { features: [] });
    await browser.setWindowSize(1440, 1000);
    await browser.url('/__gneauxghts_e2e_reset');
    await browser.execute(() => { localStorage.clear(); sessionStorage.clear(); });
    await browser.url('/');
    await $('[data-testid="note-editor"][aria-busy="false"]').waitForExist();
    await switcher().click();
    await $('textarea[aria-label="Message"]').waitForEnabled();
  });

  it('shows background progress and unread completion on the note switcher, then clears after opening', async () => {
    await holdAndSend('Background indicator check');
    await $('button[aria-label="Open previous location in this pane"]').click();
    await expect(switcherDot('running')).toBeDisplayed();
    await finish('Background response finished.');
    await expect(switcherDot('unread')).toBeDisplayed();
    await switcher().click();
    await expect($('[data-testid="pi-assistant-message"]')).toHaveText(expect.stringContaining('Background response finished.'));
    await expect(historyDot()).not.toBeExisting();
    await history().click();
    await expect(rowDot()).not.toBeExisting();
  });

  it('shows running and unread rows in history and reads results viewed in the foreground', async () => {
    await holdAndSend('History indicator check');
    await leaveConversation();
    await history().click();
    await expect(rowDot('running')).toBeDisplayed();
    await finish('Finished while reading a different chat.');
    await expect(historyDot('unread')).toBeDisplayed();
    await expect(rowDot('unread')).toBeDisplayed();
    await conversation().click();
    await expect(historyDot()).not.toBeExisting();
    await holdAndSend('Watching this response');
    await finish('Already reading this answer.');
    await $('[data-testid="pi-stop"]').waitForExist({ reverse: true });
    await expect(historyDot()).not.toBeExisting();
  });

  it('keeps mobile dark-theme dots visible and respects reduced motion and Stop', async () => {
    await holdAndSend('Compact background check');
    await leaveConversation();
    await browser.sendCommand('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await browser.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await browser.execute(() => document.documentElement.classList.add('dark'));
    await finish('Compact unread answer.');
    await expect(historyDot('unread')).toBeDisplayed();
    await history().click();
    await expect(rowDot('unread')).toBeDisplayed();
    expect((await $('.pi-conversation-picker').getSize()).width).toBeLessThanOrEqual(390);
    await conversation().click();
    await expect(historyDot()).not.toBeExisting();
    await holdAndSend('Reduced motion check');
    expect(await browser.execute(() => getComputedStyle(document.querySelector('button[aria-label="Conversations"] [data-chat-activity="running"]')).animationName)).toBe('none');
    await $('[data-testid="pi-stop"]').click();
    await expect(historyDot()).not.toBeExisting();
  });

  // Reproduced in remaining-review: retained panes remain mounted under History Mode.
  it('keeps a reply unread while History Mode covers an expanded chat', async () => {
    await $('button[aria-label="Open previous location in this pane"]').click();
    await browser.execute(() => document.querySelector('button[aria-label="Open split pane options"]')
      .dispatchEvent(new PointerEvent('pointerenter')));
    await $('button[aria-label="Split with thought partner"]').click();
    await $('textarea[aria-label="Message"]').waitForEnabled();
    await holdAndSend('Complete behind History Mode');
    await $('button[aria-label="Note options"]').click();
    await $('[role="menuitem"][aria-label="Open note history"]').click();
    await $('[data-testid="history-mode"]').waitForDisplayed();
    await finish('Unread until the workspace is visible.');
    await $('[data-testid="pi-stop"]').waitForExist({ reverse: true });
    // The retained chat is intentionally hidden, so check existence rather than display.
    await expect(historyDot('unread')).toExist();
    await $('button[aria-label="Back to workspace"]').click();
    await $('[data-testid="history-mode"]').waitForExist({ reverse: true });
    await expect($('[data-testid="pi-assistant-message"]')).toHaveText(expect.stringContaining('Unread until the workspace is visible.'));
    await expect(historyDot()).not.toBeExisting();
  });
});
