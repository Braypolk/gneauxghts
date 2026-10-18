import { navigateAppTab } from '../../support/appNavigation';
import { browser, expect, $ } from '@wdio/globals';
import { resetBrowserWorkspace } from '../../support/browserWorkspace';
import { openBrowserPiPane, readPiFixture, seedPiHistory, selectPiConversation } from '../../support/browserPi';

describe('ordinary Pi chat mounted controls', () => {
  beforeEach(resetBrowserWorkspace);

  it('paints Stop in the dock while Pi is running and returns to Send after cancelling', async () => {
    await openBrowserPiPane();
    await browser.executeAsync((done: () => void) => { void window.__GNEAUXGHTS_E2E__!.holdNextPiResponse().then(done); });
    const composer = await $('textarea[aria-label="Message"]');
    await composer.setValue('Wait for Stop');
    await $('[data-testid="pi-send"]').click();
    await $('[data-testid="pi-activity"]').waitForDisplayed();
    await expect($('[data-testid="pi-stop"]')).toBeEnabled();
    // Assert the painted glyph, since the dock intentionally hides the underlying button.
    await expect($('.dock-chat-toggle .dock-send-icon rect')).toBeExisting();
    await expect($('[data-testid="pi-send"]')).not.toBeExisting();
    await composer.setValue('Keep this follow-up draft');
    await expect($('[aria-label="Queue message"]')).toBeDisplayed();
    expect(await browser.execute(() => document.querySelectorAll('.chat-send-button').length)).toBe(1);
    await $('[data-testid="pi-stop"]').click();
    await $('[data-testid="pi-activity"]').waitForExist({ reverse: true });
    await expect($('.dock-chat-toggle .dock-send-icon rect')).not.toBeExisting();
    await expect($('[data-testid="pi-send"]')).toBeEnabled();
    await expect(composer).toHaveValue('Keep this follow-up draft');
  });

  it('submits once through Pi, streams reasoning, and reopens the same immutable history', async () => {
    await openBrowserPiPane();
    const composer = await $('textarea[aria-label="Message"]');
    await $('button[aria-label="Reasoning effort"]').waitForDisplayed();
    const capabilityReads = await browser.execute(() => window.__GNEAUXGHTS_E2E__!.invocations.filter(item => item.command === 'chat_get_model_capabilities').length);
    await composer.setValue('Explain this note');
    await $('[data-testid="pi-send"]').click();
    await $('[data-testid="pi-assistant-message"][data-streaming="false"]').waitForExist();
    await expect(composer).toHaveValue('');
    const conversations = await readPiFixture();
    expect(conversations).toHaveLength(1);
    expect(conversations[0].messages.filter(message => message.role === 'user')).toEqual([{ role: 'user', content: 'Explain this note' }]);
    expect(await browser.execute(() => window.__GNEAUXGHTS_E2E__!.invocations.filter(item => item.command === 'chat_get_model_capabilities').length)).toBe(capabilityReads);
    await $('[data-testid="pi-reasoning"] [data-slot="trace-collapsible-trigger"]').click();
    await expect($('[data-testid="pi-reasoning"] pre')).toHaveText('Fixture reasoning.');
    await $('button[aria-label="Conversations"]').click();
    await $('button[role="menuitem"]').click();
    await selectPiConversation(conversations[0].title);
    await expect($('[data-testid="pi-assistant-message"]')).toHaveText(expect.stringContaining('Fixture ordinary answer.'));
    expect((await readPiFixture())[0].messages).toEqual(conversations[0].messages);
  });

  it('uses the original composer controls, keeps drafts, and leaves note references to chat text', async () => {
    await openBrowserPiPane();
    const composer = await $('textarea[aria-label="Message"]');
    await composer.setValue('Keep this thought');
    await expect(composer).toHaveAttribute('rows', '1');
    await expect($('.chat-composer-toolbar .chat-send-button')).toBeExisting();
    await expect($('button[aria-label="Attach notes"]')).not.toBeExisting();
    await expect($('[aria-label="Attached notes"]')).not.toBeExisting();
    await $('button[aria-label="Vault access"]').click();
    await $('[role="menuitemradio"]=No notes').click();
    await expect($('button[aria-label="Vault access"]')).toHaveText('No notes');
    await $('button[aria-label="AI model"]').click();
    await $('[role="menu"][aria-label="Server models"] [role="menuitem"]').click();
    await $('button[aria-label="Reasoning effort"]').click();
    await $('[role="menu"][aria-label="Reasoning effort choices"]').$('button=Off').click();
    await expect($('button[aria-label="Reasoning effort"]')).toHaveText(expect.stringContaining('Off'));
    await expect(composer).toHaveValue('Keep this thought');
    expect(await readPiFixture()).toHaveLength(0);
  });

  it('forgets the selected chat, hides it from history, and unForgets the same messages', async () => {
    await seedPiHistory('Forget test chat', 2);
    await openBrowserPiPane(); await selectPiConversation('Forget test chat');
    const before = await readPiFixture();
    const forget = await $('button[aria-label^="Forget this chat"]');
    await forget.waitForEnabled(); await forget.click();
    await $('#forget-confirm-popover button[title="Forget this chat"]').click();
    const restore = await $('button[aria-label="Restore the last forgotten chat"]');
    await restore.waitForDisplayed();
    await expect($('input[aria-label="Conversation title"]')).toHaveValue('');
    expect(await readPiFixture()).toEqual([]);
    await $('button[aria-label="Conversations"]').click();
    await expect($('[role="menuitem"]*=Forget test chat')).not.toBeExisting();
    await $('button[aria-label="Conversations"]').click();
    await restore.click();
    await expect($('input[aria-label="Conversation title"]')).toHaveValue('Forget test chat');
    expect(await readPiFixture()).toEqual(before);
    await forget.waitForEnabled();
    await browser.saveScreenshot('/private/tmp/pi-cleanup-composer.png');
  });

  it('discovers and configures local model capabilities through mounted Settings controls', async () => {
    await navigateAppTab('Settings');
    await $('[data-settings-section="ai"]').click();
    const provider = await $('[data-settings-anchor="chat-provider"] select');
    await provider.waitForExist(); await provider.selectByAttribute('value', 'local');
    const configure = await $('button[aria-label="Configure fixture-local"]');
    await configure.waitForDisplayed(); await configure.click();
    const vision = await $('button[aria-label="Vision capability"]');
    await vision.waitForDisplayed(); await vision.click();
    await $('button=Save changes').click();
    await browser.waitUntil(async () => browser.execute(() => window.__GNEAUXGHTS_E2E__!.invocations.some(item => item.command === 'chat_set_local_model_capabilities')));
    const calls = await browser.execute(() => window.__GNEAUXGHTS_E2E__!.invocations.filter(item => item.command === 'chat_set_local_model_capabilities'));
    expect(calls[0].args).toMatchObject({ model: 'fixture-local', capabilities: { images: true, tools: true, audio: false, video: false } });
  });
});
