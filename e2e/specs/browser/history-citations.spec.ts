import { browser, expect, $, $$ } from '@wdio/globals';
import { resetBrowserWorkspace } from '../../support/browserWorkspace';

describe('History revision citations', () => {
  beforeEach(resetBrowserWorkspace);

  it('opens Revision Citations at exact evidence and leaves chat workspace context intact', async () => {
    await browser.execute(() => window.__GNEAUXGHTS_E2E__?.seedRevisionChat());
    const openChat = await $('button[aria-label="Open thought partner in this pane"]');
    await browser.execute((element: HTMLElement) => element.click(), openChat);
    const picker = await $('button[aria-label="Conversations"]');
    await picker.waitForClickable();
    await picker.click();
    await $('[role="menuitem"]').click();
    const citation = await $('[data-chat-note-citation-id="revision:note-beta:note-beta-revision-2"]');
    await citation.waitForClickable();
    expect(await $('button[aria-label="Source-first preview"]').isExisting()).toBe(false);
    const requestsBeforeEvidence = await browser.execute(() => window.__GNEAUXGHTS_E2E__?.snapshot().invocations ?? []);
    await $('button*=Show evidence').click();
    const evidence = await $('section[aria-label="Evidence from Beta note"]');
    await evidence.waitForDisplayed();
    expect(await evidence.getText()).toContain('Beta body is independent from Alpha.');
    expect(await evidence.getText()).toContain('Retained revision · not current status');
    const requestsAfterEvidence = await browser.execute(() => window.__GNEAUXGHTS_E2E__?.snapshot().invocations ?? []);
    expect(requestsAfterEvidence.filter(entry => entry.command === 'chat_send_message').length)
      .toBe(requestsBeforeEvidence.filter(entry => entry.command === 'chat_send_message').length);
    await $('button*=Hide evidence').click();
    await evidence.waitForDisplayed({ reverse: true });
    const before = await browser.execute(() => window.__GNEAUXGHTS_E2E__?.snapshot());
    expect(await $('[data-testid="workspace-pane"][data-pane-kind="chat"]').getText()).not.toContain('removed confidential prose');
    await citation.click();
    const history = await $('[data-testid="history-mode"]');
    await history.waitForExist();
    expect(await history.getText()).toContain('removed confidential prose');
    const requests = await browser.execute(() => window.__GNEAUXGHTS_E2E__?.snapshot().invocations ?? []);
    expect(requests.some(entry => entry.command === 'get_note_history_diff' && entry.args.noteId === 'note-beta' && entry.args.revisionId === 'note-beta-revision-2')).toBe(true);
    expect(requests.filter(entry => entry.command === 'get_note_history_page' && entry.args.noteId === 'note-beta').length).toBe(0);
    expect(requests.filter(entry => entry.command === 'get_note_history_context' && entry.args.noteId === 'note-beta').length).toBe(1);
    expect(await $$('[data-revision-id]').length).toBeLessThanOrEqual(31);
    const originalIds = await $$('[data-revision-id]').map(row => row.getAttribute('data-revision-id'));
    await $('button=Load newer history').click();
    await browser.waitUntil(async () => !(await $('[data-revision-id="note-beta-revision-2"]').isExisting()));
    expect(await $$('[data-revision-id]').length).toBeLessThanOrEqual(31);
    await $('button=Load older history').click();
    await $('[data-revision-id="note-beta-revision-2"]').waitForExist();
    expect(await $$('[data-revision-id]').map(row => row.getAttribute('data-revision-id'))).toEqual(originalIds);
    const exit = await $('button[aria-label="Back to workspace"]');
    await exit.click();
    await history.waitForExist({ reverse: true });
    expect(await $('[data-testid="workspace-pane"][data-pane-kind="chat"]').isExisting()).toBe(true);
    const after = await browser.execute(() => window.__GNEAUXGHTS_E2E__?.snapshot());
    expect(after?.activeNoteId).toBe(before?.activeNoteId);
    expect(after?.notes).toEqual(before?.notes);
    expect(await citation.isExisting()).toBe(true);
    expect(await $('[data-testid="workspace-pane"][data-pane-kind="chat"]').getText()).not.toContain('removed confidential prose');
  });
});
