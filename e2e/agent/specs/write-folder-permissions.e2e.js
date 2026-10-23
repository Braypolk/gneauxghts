import { browser, $, expect } from '@wdio/globals';
import { mkdir } from 'node:fs/promises';

// Promoted from the named rename-folders-1451 session. Native acceptance owns
// filesystem/folder admission; these cases exercise the mounted permission form.
const dialog = '[role="dialog"][aria-label="Write folder permissions"]';
const folders = 'textarea[aria-label="Allowed write folders"]';
const nativeError = 'That write folder is unavailable. Choose an existing visible folder.';

async function reset() {
  await browser.url('/__gneauxghts_e2e_reset');
  await browser.execute(() => { localStorage.clear(); sessionStorage.clear(); });
  await browser.url('/');
  await expect($('[data-testid="note-title"]')).toHaveValue('Alpha note');
}
async function openChat() {
  await reset();
  await $('button[aria-label="Open thought partner in this pane"]').click();
  await $('button[aria-label="Vault access"]').click();
  await $('button=Allow edits in this chat').click();
  await $('button[aria-label="Vault access"]').click();
}
async function readWrite() {
  return browser.execute(async () => {
    const { openBrowserPiChat } = await import('/src/lib/e2e/piBrowserFixture.ts');
    const runtime = await openBrowserPiChat();
    const id = (await runtime.listConversations()).items[0].id;
    return (await runtime.authorityForConversation(id)).write;
  });
}
async function expectDialogInViewport() {
  await expect($(dialog)).toBeDisplayed();
  const bounds = await browser.execute(selector => {
    const { left, top, right, bottom } = document.querySelector(selector).getBoundingClientRect();
    return { left, top, right, bottom, width: innerWidth, height: innerHeight };
  }, dialog);
  expect(bounds.left).toBeGreaterThanOrEqual(0);
  expect(bounds.top).toBeGreaterThanOrEqual(0);
  expect(bounds.right).toBeLessThanOrEqual(bounds.width);
  expect(bounds.bottom).toBeLessThanOrEqual(bounds.height);
}

describe('explicit write folder permissions', () => {
  it('saves only explicit folder edits and leaves cancellation and invalid input unpublished', async () => {
    await openChat();
    await expect($('button=Allow renaming notes')).not.toExist();
    expect((await readWrite()).grant.operations).toEqual(['update']);
    await $('button=Allowed write folders…').click();
    await expectDialogInViewport();
    await expect($(folders)).toHaveValue('.');
    await $(folders).setValue('.\nProjects');
    expect((await readWrite()).grant.scope.folders).toEqual(['.']);
    await $('button=Save folders').click();
    await expect($(dialog)).not.toExist();
    expect((await readWrite()).grant.scope.folders).toEqual(['.', 'Projects']);
    await $('button[aria-label="Vault access"]').click();
    await $('button=Allowed write folders…').click();
    await $(folders).setValue('Research');
    await $('button=Cancel').click();
    await $('button=Allowed write folders…').click();
    await expect($(folders)).toHaveValue('.\nProjects');
    await $(folders).setValue('../outside');
    await $('button=Save folders').click();
    await expect($(`${dialog} [role="alert"]`)).toHaveText(expect.stringContaining('visible relative folders'));
    expect((await readWrite()).grant.scope.folders).toEqual(['.', 'Projects']);
  });

  it('refuses stale drafts and preserves current operations and note scope after reopening', async () => {
    await openChat();
    await $('button=Allowed write folders…').click();
    await $(folders).setValue('Research');
    await browser.execute(async () => {
      const { openBrowserPiChat } = await import('/src/lib/e2e/piBrowserFixture.ts');
      const runtime = await openBrowserPiChat();
      const id = (await runtime.listConversations()).items[0].id;
      const authority = await runtime.authorityForConversation(id);
      await window.__TAURI_INTERNALS__.invoke('pi_chat_set_write_policy', {
        authorityId: authority.authorityId, expectedRevision: authority.revision,
        write: { grant: { duration: 'temporary', conversationId: id, operations: ['update', 'create'],
          scope: { noteIds: ['note-alpha'], folders: ['Projects'] } }, reviewBeforeApplying: true }
      });
    });
    await $('button=Save folders').click();
    await expect($(`${dialog} [role="alert"]`)).toHaveText('Chat access changed. Reopen Allowed write folders before saving.');
    expect((await readWrite()).grant.scope.folders).toEqual(['Projects']);
    await $('button=Cancel').click();
    await $('button=Allowed write folders…').click();
    await expect($(folders)).toHaveValue('Projects');
    await $(folders).setValue('Projects\nResearch');
    await $('button=Save folders').click();
    await expect($(dialog)).not.toExist();
    expect(await readWrite()).toMatchObject({ grant: { duration: 'temporary', operations: ['update', 'create'],
      scope: { noteIds: ['note-alpha'], folders: ['Projects', 'Research'] } } });
  });

  it('shows structured native refusal and keeps the folder form usable in a 390px viewport', async () => {
    await openChat();
    const restoreDevice = await browser.emulate('device', 'iPhone 12 Pro');
    try {
      await $('button=Allowed write folders…').click();
      await $(folders).setValue('Projects');
      await browser.execute(message => {
        window.__GNEAUXGHTS_E2E_COMMANDS__.pi_chat_set_write_policy = () => { throw { code: 'invalid_policy', message }; };
      }, nativeError);
      await $('button=Save folders').click();
      await expect($(`${dialog} [role="alert"]`)).toHaveText(nativeError);
      await expect($(folders)).toBeDisplayed();
      await expect($('button=Cancel')).toBeClickable();
      await expect($('button=Save folders')).toBeClickable();
      expect(await browser.execute(() => window.innerWidth)).toBe(390);
      await expectDialogInViewport();
      await mkdir('.wdio/screenshots', { recursive: true });
      await browser.saveScreenshot('.wdio/screenshots/write-folder-permissions-390.png');
      expect((await readWrite()).grant.scope.folders).toEqual(['.']);
      await browser.execute(() => { delete window.__GNEAUXGHTS_E2E_COMMANDS__.pi_chat_set_write_policy; });
      await $('button=Save folders').click();
      await expect($(dialog)).not.toExist();
      expect((await readWrite()).grant.scope.folders).toEqual(['Projects']);
    } finally {
      await browser.execute(() => { delete window.__GNEAUXGHTS_E2E_COMMANDS__.pi_chat_set_write_policy; });
      await restoreDevice();
    }
  });

  it('keeps Settings scopes and operations until Save and shows actionable native errors', async () => {
    await reset();
    await browser.execute(async () => {
      await window.__TAURI_INTERNALS__.invoke('pi_chat_set_write_defaults', {
        write: { grant: { duration: 'always', operations: ['update', 'create'], scope: { noteIds: ['note-alpha'], folders: ['Projects'] } }, reviewBeforeApplying: false }
      });
    });
    await $('role/link[name="Settings"]').click();
    await $('[data-settings-section="ai"]').click();
    await expect($(folders)).toHaveValue('Projects');
    await expect($('[data-settings-anchor="chat-write-rename"]')).not.toExist();
    await expect($('[data-settings-anchor="chat-write-defaults"]')).toHaveText(expect.stringContaining('content, properties and filenames'));
    await $(folders).setValue('Projects\nResearch');
    expect(await browser.execute(() => window.__TAURI_INTERNALS__.invoke('pi_chat_get_write_defaults'))).toMatchObject({ grant: { scope: { folders: ['Projects'] } } });
    await browser.execute(message => {
      window.__GNEAUXGHTS_E2E_COMMANDS__.pi_chat_set_write_defaults = () => { throw { code: 'invalid_policy', message }; };
    }, nativeError);
    try {
      await $('button=Save editing defaults').click();
      await expect($('[data-settings-anchor="chat-write-defaults"] [role="alert"]')).toHaveText(nativeError);
      await browser.execute(() => { delete window.__GNEAUXGHTS_E2E_COMMANDS__.pi_chat_set_write_defaults; });
      await $('button=Save editing defaults').click();
      await expect($('[data-settings-anchor="chat-write-defaults"] [role="status"]')).toHaveText('Editing defaults saved in this vault.');
      expect(await browser.execute(() => window.__TAURI_INTERNALS__.invoke('pi_chat_get_write_defaults'))).toEqual({ grant: { duration: 'always', operations: ['update', 'create'], scope: { noteIds: ['note-alpha'], folders: ['Projects', 'Research'] } }, reviewBeforeApplying: false });
    } finally {
      await browser.execute(() => { delete window.__GNEAUXGHTS_E2E_COMMANDS__.pi_chat_set_write_defaults; });
    }
  });
});
