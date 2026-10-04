import { browser, expect, $ } from '@wdio/globals';
import { resetBrowserWorkspace } from '../../support/browserWorkspace';

async function invocations(command: string) {
  return browser.execute(name => window.__GNEAUXGHTS_E2E__!.invocations.filter(item => item.command === name), command);
}
async function selectRevision(id: string) {
  const revision = await $(`[data-revision-id="${id}"]`);
  await revision.click();
  await expect(revision).toHaveAttribute('aria-pressed', 'true');
  await browser.waitUntil(async () => (await invocations('get_note_history_diff')).at(-1)?.args.revisionId === id);
  await $('button=Current note').waitForEnabled();
}
async function historyShortcut() {
  await browser.execute(() => {
    (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'H', code: 'KeyH', metaKey: true, shiftKey: true, bubbles: true, cancelable: true }));
  });
  await $('[data-testid="history-mode"]').waitForDisplayed();
  await $('[data-revision-id="note-alpha-revision-35"]').waitForExist();
}

describe('History Mode mounted controls', () => {
  beforeEach(async () => {
    await resetBrowserWorkspace();
    await historyShortcut();
  });



  it('routes comparison changes to the selected revision and keeps naming bound to its original row', async () => {
    await selectRevision('note-alpha-revision-34');
    await $('button=Current note').click();
    await browser.waitUntil(async () => (await invocations('get_note_history_diff')).at(-1)?.args.comparison === 'current');
    await $('button=Previous version').click();
    await browser.waitUntil(async () => (await invocations('get_note_history_diff')).at(-1)?.args.comparison === 'parent');
    await $('section[aria-label="Selected version"]').$('button=Rename').click();
    const name = await $('input[aria-label="Revision name"]'); await name.setValue('Original row label');
    await selectRevision('note-alpha-revision-33');
    await $('section[aria-label="Named Revision"]').$('button=Add name').click();
    await browser.waitUntil(async () => (await invocations('name_note_revision')).length === 1);
    const calls = await invocations('name_note_revision');
    expect(calls[0].args).toEqual({ noteId: 'note-alpha', revisionId: 'note-alpha-revision-34', label: 'Original row label' });
  });

  it('cancels restore without publishing and blocks Escape/exit while confirmed restore is pending', async () => {
    await selectRevision('note-alpha-revision-34');
    await $('button=Restore this version…').click();
    const preview = await $('[aria-label="Restore version preview"]'); await preview.waitForDisplayed();
    await preview.$('button=Cancel').click();
    await preview.waitForExist({ reverse: true });
    expect(await invocations('restore_note_revision')).toHaveLength(0);
    await $('button=Restore this version…').click(); await preview.waitForDisplayed();
    await browser.execute(() => window.__GNEAUXGHTS_E2E__!.holdHistoryRestore());
    try {
      await preview.$('button=Restore version').click();
      await browser.waitUntil(async () => (await invocations('restore_note_revision')).length === 1);
      await expect($('button[aria-label="Back to workspace"]')).toBeDisabled();
      await expect(preview.$('button=Cancel')).toBeDisabled();
      await browser.keys('Escape');
      await expect($('[data-testid="history-mode"]')).toBeDisplayed();
    } finally {
      await browser.execute(() => window.__GNEAUXGHTS_E2E__!.releaseHistoryRestore());
    }
    await $('button[aria-label="Back to workspace"]').waitForEnabled();
    expect(await invocations('restore_note_revision')).toHaveLength(1);
    await browser.keys('Escape');
    await $('[data-testid="history-mode"]').waitForExist({ reverse: true });
  });
});
