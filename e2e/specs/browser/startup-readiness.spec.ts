import { browser, expect, $ } from '@wdio/globals';

describe('workspace while save history admission waits', () => {
  beforeEach(async () => {
    await browser.url('/');
    await $('[data-testid="note-title"]').waitForDisplayed({ timeout: 30_000 });
    await browser.waitUntil(async () => (await $('[data-testid="note-title"]').getValue()) === 'Alpha note');
    await $('[data-testid="note-editor"] .cm-content').waitForDisplayed();
  });

  it('keeps typing editable and drains newer text after the authoritative save', async () => {
    await browser.execute(() => window.__GNEAUXGHTS_E2E__!.holdSave());
    const editor = await $('[data-testid="note-editor"] .cm-content');
    await editor.click();
    await browser.keys(' first pending edit');
    await browser.waitUntil(async () => browser.execute(() => window.__GNEAUXGHTS_E2E__!.invocations.some(r => r.command === 'get_history_readiness')));
    expect(await browser.execute(() => document.body.innerText)).toContain('checking this note’s history');
    await browser.keys(' newer pending edit');
    expect(await editor.getText()).toContain('newer pending edit');
    const calls = await browser.execute(() => window.__GNEAUXGHTS_E2E__!.invocations.map(r => r.command));
    expect(calls.indexOf('save_note')).toBeLessThan(calls.indexOf('get_history_readiness'));
    await browser.execute(() => window.__GNEAUXGHTS_E2E__!.releaseSave());
    await browser.waitUntil(async () => browser.execute(() => window.__GNEAUXGHTS_E2E__!.snapshot().notes.find(n => n.noteId === 'note-alpha')!.markdown.includes('newer pending edit')));
    expect(await editor.getText()).toContain('first pending edit');
    expect(await editor.getText()).toContain('newer pending edit');
  });

  it('retains edited text when admission fails', async () => {
    await browser.execute(() => window.__GNEAUXGHTS_E2E__!.holdSave(true));
    const editor = await $('[data-testid="note-editor"] .cm-content');
    await editor.click();
    await browser.keys(' keep failed edit');
    await browser.waitUntil(async () => browser.execute(() => window.__GNEAUXGHTS_E2E__!.invocations.some(r => r.command === 'get_history_readiness')));
    await browser.execute(() => window.__GNEAUXGHTS_E2E__!.releaseSave());
    await browser.waitUntil(async () => browser.execute(() => document.body.innerText.includes('History is unavailable')));
    expect(await editor.getText()).toContain('keep failed edit');
    expect(await browser.execute(() => window.__GNEAUXGHTS_E2E__!.snapshot().notes.find(n => n.noteId === 'note-alpha')!.markdown)).not.toContain('keep failed edit');
  });
});
