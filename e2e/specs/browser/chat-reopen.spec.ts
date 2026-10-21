import { browser, expect, $ } from '@wdio/globals';
import { resetBrowserWorkspace } from '../../support/browserWorkspace';
import { openBrowserPiPane, readPiFixture, seedPiHistory, selectPiConversation } from '../../support/browserPi';

describe('opening the most recently viewed chat', () => {
  beforeEach(resetBrowserWorkspace);

  it('restores the last selected conversation after closing its pane and keeps New chat empty', async () => {
    await seedPiHistory('Previously opened chat', 2);
    await seedPiHistory('Newer chat', 2);
    await openBrowserPiPane();
    await selectPiConversation('Previously opened chat');
    const before = await readPiFixture();
    await browser.waitUntil(() => browser.execute(() => window.__GNEAUXGHTS_E2E__!.invocations.some(item =>
      item.command === 'set_last_chat_location' && typeof item.args.conversationId === 'string')));
    await $('[data-pane-kind="chat"] button[aria-label="Close pane"]').click();
    await $('[data-pane-kind="chat"]').waitForExist({ reverse: true });

    await openBrowserPiPane();
    await expect($('input[aria-label="Conversation title"]')).toHaveValue('Previously opened chat');
    await expect($('[data-testid="pi-assistant-message"]')).toBeExisting();
    expect(await readPiFixture()).toEqual(before);

    await $('button[aria-label="Conversations"]').click();
    await $('button[data-new-conversation]').click();
    await expect($('input[aria-label="Conversation title"]')).toHaveValue('');
    await expect($('[data-testid="pi-assistant-message"]')).not.toBeExisting();
    expect(await readPiFixture()).toEqual(before);
  });
});
