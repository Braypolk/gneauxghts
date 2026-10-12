import { navigateAppTab } from '../../support/appNavigation';
import { browser, expect, $, $$ } from '@wdio/globals';
import { resetBrowserWorkspace } from '../../support/browserWorkspace';

describe('History storage maintenance and recovery', () => {
  beforeEach(resetBrowserWorkspace);

  it('confirms vault clear and permanent purge while reporting reclaimable storage', async () => {
    await navigateAppTab('Settings');
    await $('[aria-label="Settings categories"]').waitForExist();
    const historyCategory = await $('[aria-label="Settings categories"] button[data-settings-section="history"]');
    await historyCategory.waitForExist();
    await browser.execute((element: HTMLElement) => element.click(), historyCategory);
    await browser.waitUntil(async () => (await $('body').getText()).includes('16 KB allocated'));
    expect(await $('body').getText()).toContain('512 bytes reclaimable');

    await $('button=Clear vault history').click();
    await $('button=Confirm clear vault history').click();
    await browser.waitUntil(async () => (await $('body').getText()).includes('12 KB reclaimable'));

    await $('button=Forgotten Items').click();
    await browser.waitUntil(async () => (await $('body').getText()).includes('Forgotten draft'));
    const permanentDeleteButtons = await $$('button=Permanently delete');
    expect(permanentDeleteButtons).toHaveLength(2);
    await permanentDeleteButtons[1]!.click();
    const confirmation = await $('[role="alertdialog"]');
    await confirmation.waitForExist();
    expect(await confirmation.getText()).toContain('complete Note Timeline');
    expect(await confirmation.getText()).toContain('cannot be undone');
    await $('button=Confirm permanent deletion').click();
    await browser.waitUntil(async () => !(await $('*=Forgotten draft').isExisting()));

    const commands = await browser.execute(() =>
      window.__GNEAUXGHTS_E2E__?.invocations.map((entry) => entry.command) ?? []
    );
    expect(commands).toContain('clear_vault_history');
    expect(commands).toContain('delete_forgotten_notes');
  });

  it('inspects and safely recovers an externally deleted note', async () => {
    await navigateAppTab('Settings');
    await $('[aria-label="Settings categories"]').waitForExist();
    await $('button=Forgotten Items').click();
    await browser.waitUntil(async () =>
      (await $('body').getText()).includes('Missing outline')
    );

    const timeline = await $('summary=Retained timeline · 2 loaded records');
    await timeline.click();
    const body = await $('body').getText();
    expect(body).not.toContain('Before external deletion');
    expect(body).toContain('Missing event');

    await $('button=Load older history').click();
    await browser.waitUntil(async () =>
      (await $('body').getText()).includes('Before external deletion')
    );

    await $('button=Recover').click();
    await browser.waitUntil(async () =>
      (await $('body').getText()).includes(
        'Recovered Missing Note to /e2e/Missing outline Recovered Note.md.'
      )
    );
    expect(
      await $('//article[.//p[normalize-space()="Missing outline"]]').isExisting()
    ).toBe(false);

    const snapshot = await browser.execute(() =>
      window.__GNEAUXGHTS_E2E__?.snapshot()
    );
    expect(snapshot?.notes.find((note) => note.noteId === 'note-missing')?.path).toBe(
      '/e2e/Missing outline Recovered Note.md'
    );
    expect(snapshot?.notes.find((note) => note.noteId === 'note-alpha')?.path).toBe(
      '/e2e/alpha.md'
    );
    const commands = snapshot?.invocations.map((entry) => entry.command) ?? [];
    expect(commands).toContain('list_missing_notes');
    expect(commands).toContain('get_missing_note_history_page');
    expect(commands).toContain('recover_missing_note');
  });
});
