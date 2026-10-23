import { browser, $, expect } from '@wdio/globals';

// Exported from unified-write-1458; fixture-only UI and saved policy verification.
describe('unified existing-note write permission', () => {
  it('shares editing and filename access in Chat and Settings and retains saved scope', async () => {
    await browser.url('/__gneauxghts_e2e_reset');
    await browser.execute(() => { localStorage.clear(); sessionStorage.clear(); });
    await browser.url('/');
    await expect($('[data-testid="note-title"]')).toHaveValue('Alpha note');
    await $('role/button[name="Open thought partner in this pane"]').click();
    await $('button[aria-label="Vault access"]').click();
    await $('button=Allow edits in this chat').click();
    await $('button[aria-label="Vault access"]').click();
    await expect($('button=Allow renaming notes')).not.toExist();
    await expect($('[aria-label="Vault access choices"]')).toHaveText(expect.stringContaining('content, properties and filenames'));
    await expect($('button=Allow creating new notes')).toHaveAttribute('aria-checked', 'false');
    await $('button[aria-label="Vault access"]').click();
    await $('role/link[name="Settings"]').click();
    await $('[data-settings-section="ai"]').click();
    await expect($('[data-settings-anchor="chat-write-defaults"]')).toHaveText(expect.stringContaining('content, properties and filenames'));
    await expect($('[data-settings-anchor="chat-write-rename"]')).not.toExist();
    await $('[data-settings-anchor="chat-write-access"] select').selectByAttribute('value', 'always');
    await $('textarea[aria-label="Allowed write folders"]').setValue('Projects');
    await $('button=Save editing defaults').click();
    await expect($('[data-settings-anchor="chat-write-defaults"] [role="status"]')).toHaveText('Editing defaults saved in this vault.');
    const write = await browser.execute(() => window.__TAURI_INTERNALS__.invoke('pi_chat_get_write_defaults'));
    expect(write.grant).toMatchObject({ duration: 'always', operations: ['update'], scope: { folders: ['Projects'] } });
    // The browser IPC fixture is memory-only; navigate to remount the form.
    // Native authority tests separately verify persistence across store reopen.
    await $('role/link[name="Gneauxght"]').click();
    await $('role/link[name="Settings"]').click();
    await $('[data-settings-section="ai"]').click();
    await expect($('[data-settings-anchor="chat-write-access"] select')).toHaveValue('always');
    await expect($('textarea[aria-label="Allowed write folders"]')).toHaveValue('Projects');
    await expect($('[data-settings-anchor="chat-write-rename"]')).not.toExist();
  });
});
