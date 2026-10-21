import { $, browser, expect } from '@wdio/globals';
import { navigateAppTab } from '../../support/appNavigation';
import { resetBrowserWorkspace } from '../../support/browserWorkspace';
import { openBrowserPiPane, readPiFixture } from '../../support/browserPi';

const access = () => $('[data-settings-anchor="chat-write-access"] select');
const creation = () => $('[data-settings-anchor="chat-write-create"] input');
const review = () => $('[data-settings-anchor="chat-write-review"] input');
async function settings() {
  await navigateAppTab('Settings');
  await $('[data-settings-section="ai"]').click();
  await access().waitForDisplayed();
}
async function save() {
  await $('button=Save editing defaults').click();
  await $('p=Editing defaults saved in this vault.').waitForDisplayed();
}
async function send(text: string) {
  // Returning from Settings can retain the editor as the active pane. Activate
  // chat through its visible surface before typing into the shared input dock.
  await $('[data-testid="pi-chat-panel"]').click();
  const composer = await $('textarea[aria-label="Message"]');
  await composer.waitForClickable();
  await composer.setValue(text);
  await $('[data-testid="pi-send"]').click();
  await $('[data-testid="pi-assistant-message"][data-streaming="false"]').waitForExist();
}

describe('vault write defaults in Settings', () => {
  beforeEach(resetBrowserWorkspace);

  it('configures permissions without a chat and shares them with the chat menu', async () => {
    await navigateAppTab('Settings');
    await $('input[aria-label="Search settings"]').setValue('write permissions');
    await $('[data-settings-result="write-access"]').click();
    await browser.waitUntil(async () => browser.execute(() =>
      document.activeElement?.getAttribute('data-settings-anchor') === 'chat-write-access'));
    expect(await access().getValue()).toBe('off');
    expect(await review().isSelected()).toBe(true);
    expect(await creation().isSelected()).toBe(false);
    expect(await creation().isEnabled()).toBe(false);
    await access().selectByAttribute('value', 'always');
    expect(await creation().isSelected()).toBe(false);
    await creation().click();
    await review().click();
    await save();
    expect(await readPiFixture()).toHaveLength(0);
    await navigateAppTab('Gneauxght');
    await openBrowserPiPane();
    await send('Use the configured defaults');
    await $('[aria-label="Vault access"]').click();
    await expect($('[role="menuitemradio"]*=Always allow edits')).toHaveAttribute('aria-checked', 'true');
    await expect($('[role="menuitemcheckbox"]*=Review before applying edits')).toHaveAttribute('aria-checked', 'false');
    await expect($('[role="menuitemcheckbox"]*=Allow creating new notes')).toHaveAttribute('aria-checked', 'true');
    await $('[role="menuitemradio"]*=Allow edits in this chat').click();
    await settings();
    expect(await access().getValue()).toBe('off');
    expect(await review().isSelected()).toBe(false);
    await review().click();
    await save();
    await navigateAppTab('Gneauxght');
    await $('[aria-label="Vault access"]').click();
    await expect($('[role="menuitemradio"]*=Allow edits in this chat')).toHaveAttribute('aria-checked', 'true');
    await expect($('[role="menuitemcheckbox"]*=Review before applying edits')).toHaveAttribute('aria-checked', 'true');
    await expect($('[role="menuitemcheckbox"]*=Allow creating new notes')).toHaveAttribute('aria-checked', 'true');
    await $('[aria-label="Vault access"]').click();
    await $('button[aria-label="Conversations"]').click();
    await $('button[data-new-conversation]').click();
    await send('A new chat needs its own permission');
    await $('[aria-label="Vault access"]').click();
    await expect($('[role="menuitemradio"]*=Editing off')).toHaveAttribute('aria-checked', 'true');
  });

  it('retains unsaved choices and reports a failed save', async () => {
    await settings();
    await browser.execute(() => {
      const native = window.__TAURI_INTERNALS__!;
      const original = native.invoke;
      native.invoke = async <T>(command: string, args: Record<string, unknown>): Promise<T> => {
        if (command === 'pi_chat_set_write_defaults') throw new Error('Fixture save failure');
        return original<T>(command, args);
      };
    });
    await access().selectByAttribute('value', 'always');
    await $('button=Save editing defaults').click();
    await $('[data-settings-anchor="chat-write-defaults"] [role="alert"]').waitForDisplayed();
    expect(await access().getValue()).toBe('always');
    await expect($('p=Editing defaults saved in this vault.')).not.toBeExisting();
    await navigateAppTab('Gneauxght');
    await settings();
    expect(await access().getValue()).toBe('off');
  });
});
