import { browser, expect, $ } from '@wdio/globals';
import { resetBrowserWorkspace } from '../../support/browserWorkspace';
import { openBrowserPiPane, selectPiConversation } from '../../support/browserPi';

describe('Pi note source navigation', () => {
  beforeEach(resetBrowserWorkspace);

  it('opens and selects the cited passage in the note instead of revision history', async () => {
    await browser.execute(() => new Promise<string | null>((done) => {
      void window.__GNEAUXGHTS_E2E__!.seedPiChat({ title: 'Note sources', count: 2, revisionSource: true }).then(() => done(null), error => done(String(error)));
    })).then(error => { expect(error).toBe(null); });
    await openBrowserPiPane();
    await selectPiConversation('Note sources');
    const citation = await $('[data-pi-source]');
    await citation.waitForClickable();
    expect(await citation.getText()).toContain('Beta note');
    const before = await browser.execute(() => window.__GNEAUXGHTS_E2E__!.snapshot());
    await citation.click();
    await $('[data-testid="note-editor"] .cm-content').waitForDisplayed();
    await browser.waitUntil(async () => (await browser.execute(() => window.__GNEAUXGHTS_E2E__!.snapshot().activeNoteId)) === 'note-beta');
    await browser.waitUntil(async () => (await browser.execute(() => window.getSelection()?.toString())) === 'Beta body is independent from Alpha.');
    expect(await $('[data-testid="history-mode"]').isExisting()).toBe(false);
    const after = await browser.execute(() => window.__GNEAUXGHTS_E2E__!.snapshot());
    expect(after.invocations.some(entry => entry.command === 'pi_chat_open_source')).toBe(true);
    expect(after.invocations.some(entry => entry.command === 'get_note_history_context')).toBe(false);
    expect(after.notes).toEqual(before.notes);
  });
});
