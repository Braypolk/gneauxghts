import { browser, $, expect } from '@wdio/globals';

// Recorded with the repository WDIO session loop, then isolated for fresh replay.
const title = () => $('[data-testid="note-title"]');
const editor = () => $('[data-testid="note-editor"] .cm-content');
const recovery = () => $('[data-testid="draft-recovery"]');
const storedCopies = () => browser.execute(() => JSON.parse(localStorage.getItem('gneauxghts.e2e.draft-backups') ?? '[]').flatMap(([, item]) => item.draft ? [item.draft] : []));

async function reset() {
  await browser.setWindowSize(1440, 1000);
  await browser.url('/__gneauxghts_e2e_reset');
  await browser.execute(() => { localStorage.clear(); sessionStorage.clear(); });
  await browser.url('/');
  await expect(title()).toHaveValue('Alpha note');
}

function backupPayload() {
  return { id: 'dd7d8ca9-6a19-4e45-9377-bb32019aa3fd', version: 1, title: 'Recovered compact idea', markdown: 'A private interrupted thought',
    tags: [], tagsError: null, sourceNoteId: null, sourcePath: null, updatedAtMillis: 0 };
}

describe('recoverable quick capture', () => {
  beforeEach(reset);

  it('retries backup failure, reloads interrupted work, and restores unfinished edits into the original note without creating a duplicate', async () => {
    const original = await browser.execute(() => window.__GNEAUXGHTS_E2E__.snapshot().notes.find(note => note.noteId === 'note-alpha'));
    await browser.execute(() => {
      window.__GNEAUXGHTS_E2E_COMMANDS__.save_note = () => { throw new Error('History preparation blocked'); };
      window.__GNEAUXGHTS_E2E_COMMANDS__.save_draft_backup = () => { throw new Error('Recovery storage temporarily unavailable'); };
    });
    await editor().click(); await browser.keys('Recovered idea after interruption');
    await expect(recovery()).toHaveText(expect.stringContaining('Recovery backup could not be saved'));
    await browser.execute(() => { delete window.__GNEAUXGHTS_E2E_COMMANDS__.save_draft_backup; });
    await $('button=Retry backup').click();
    await browser.waitUntil(async () => (await storedCopies()).some(draft => draft.markdown.includes('Recovered idea after interruption')));
    await browser.url('/');
    await expect(title()).toHaveValue('Alpha note');
    await expect(recovery()).toBeDisplayed(); await recovery().$('summary').click();
    await $('button=Recover work').click();
    await expect(editor()).toHaveText(expect.stringContaining('Recovered idea after interruption'));
    await browser.waitUntil(() => browser.execute(() => window.__GNEAUXGHTS_E2E__.snapshot().notes.find(note => note.noteId === 'note-alpha').markdown.includes('Recovered idea after interruption')));
    const notes = await browser.execute(() => window.__GNEAUXGHTS_E2E__.snapshot().notes);
    expect(notes.find(note => note.noteId === 'note-alpha').noteId).toBe(original.noteId);
    expect(notes.find(note => note.noteId === 'note-alpha').markdown).toContain('Recovered idea after interruption');
    expect(notes).toHaveLength(2);
    expect(notes.some(note => note.noteId.startsWith('note-created-'))).toBe(false);
  });

  it('retains the focused title value before its normal blur commit', async () => {
    await title().setValue('A title still being typed');
    await expect(title()).toBeFocused();
    await browser.waitUntil(async () => (await storedCopies()).some(draft => draft.title === 'A title still being typed'));
    await browser.url('/');
    await expect(title()).toHaveValue('Alpha note');
    await expect(recovery()).toBeDisplayed(); await recovery().$('summary').click();
    await expect(recovery()).toHaveText(expect.stringContaining('A title still being typed'));
    await $('button=Recover work').click(); await expect(title()).toHaveValue('A title still being typed');
    await browser.waitUntil(() => browser.execute(() => window.__GNEAUXGHTS_E2E__.snapshot().notes.find(note => note.noteId === 'note-alpha').title === 'A title still being typed'));
    expect(await browser.execute(() => window.__GNEAUXGHTS_E2E__.snapshot().notes.length)).toBe(2);
  });

  it('keeps the recovery disclosure and writing targets reachable at a 390-pixel viewport', async () => {
    const restoreDevice = await browser.emulate('device', 'iPhone 13');
    try {
      await browser.execute(async draft => { await window.__TAURI_INTERNALS__.invoke('save_draft_backup', { draft }); }, backupPayload());
      await browser.url('/'); await expect(recovery()).toBeDisplayed(); await recovery().$('summary').click();
      await expect($('button=Recover work')).toBeClickable();
      const bounds = await browser.execute(() => {
        const banner = document.querySelector('[data-testid="draft-recovery"]').getBoundingClientRect();
        const title = document.querySelector('[data-testid="note-title"]').getBoundingClientRect();
        const tab = document.querySelector('button[aria-label="Switch tab"]').getBoundingClientRect();
        return { width: innerWidth, left: banner.left, right: banner.right, top: banner.top, bottom: banner.bottom,
          titleTop: title.top, titleBottom: title.bottom, tabBottom: tab.bottom };
      });
      expect(bounds.width).toBe(390); expect(bounds.left).toBeGreaterThanOrEqual(0); expect(bounds.right).toBeLessThanOrEqual(390);
      expect(bounds.top).toBeGreaterThanOrEqual(bounds.titleBottom); expect(bounds.top).toBeGreaterThanOrEqual(bounds.tabBottom);
      await expect(title()).toBeClickable();
    } finally { await restoreDevice(); }
  });


});
