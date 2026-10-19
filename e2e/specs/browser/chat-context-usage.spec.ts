import { browser, expect, $ } from '@wdio/globals';
import { resetBrowserWorkspace } from '../../support/browserWorkspace';
import { openBrowserPiPane, seedPiHistory, selectPiConversation } from '../../support/browserPi';

describe('chat context visibility', () => {
  beforeEach(resetBrowserWorkspace);

  it('shows context beside the model, opens details with hover or tap, and resets for a new chat', async () => {
    await seedPiHistory('Context usage', 4);
    await openBrowserPiPane();
    const usage = await $('[data-testid="pi-context-usage"]');
    await expect(usage).toBeDisplayed();
    await selectPiConversation('Context usage');
    await expect(usage).toHaveAttribute('aria-label', expect.stringContaining('% used'));
    await usage.moveTo();
    const tooltip = await $('[data-testid="pi-context-tooltip"]');
    await expect(tooltip).toBeDisplayed();
    await expect(tooltip).toHaveText(expect.stringContaining('tokens used'));
    await browser.keys('Escape');
    await expect(tooltip).not.toBeDisplayed();
    await usage.click();
    await expect(tooltip).toBeDisplayed();
    await browser.keys('Escape');
    // The same compact control fits the narrow dock and remains tappable.
    await browser.setWindowSize(600, 900);
    await expect(usage).toBeDisplayed();
    await usage.click();
    await expect(tooltip).toBeDisplayed();
    await browser.saveScreenshot('/private/tmp/gneauxghts-chat-context.png');
    await browser.keys('Escape');
    await $('button[aria-label="Conversations"]').click();
    await $('button[role="menuitem"]').click();
    await expect(usage).toHaveAttribute('aria-label', expect.stringContaining('after you send a message'));
  });
});
