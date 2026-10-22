import { browser, $, $$, expect } from '@wdio/globals';

// Recorded with the repository's WDIO session loop, then split into isolated
// scenarios with stable selectors and relative URLs for fresh replay.
async function reset() {
  await browser.setWindowSize(1440, 1000);
  await browser.url('/__gneauxghts_e2e_reset');
  await browser.execute(() => { localStorage.clear(); sessionStorage.clear(); });
  await browser.url('/');
  await expect($('[data-testid="note-title"]')).toHaveValue('Alpha note');
}
const search = () => $('[data-testid="note-search-input"]');
const editedRows = () => $$('button[aria-label^="Open last edited note:"]');
async function expectSplit() {
  await expect($$('[data-testid="workspace-pane"]')).toBeElementsArrayOfSize(2);
  await expect($('[data-testid="workspace-pane"]:first-child [data-testid="note-title"]')).toHaveValue('Alpha note');
  await expect($('[data-testid="workspace-pane"]:last-child [data-testid="note-title"]')).toHaveValue('Beta note');
  await search().click();
  await expect($$('button[aria-label$="in split pane"]')).toBeElementsArrayOfSize(0);
}

describe('discovery navigation', () => {
  beforeEach(reset);

  it('browses saved edit order and opens a Last edited note beside the source', async () => {
    await search().click();
    await $('button=Last edited').click();
    await expect(editedRows()).toBeElementsArrayOfSize(2);
    await expect(editedRows()[0]).toHaveAttribute('aria-label', 'Open last edited note: Alpha note.md');
    await $('button[aria-label="Open Beta note.md in split pane"]').click();
    await expectSplit();
  });

  it('opens a query match beside the source and preserves its query', async () => {
    await search().setValue('Beta');
    await expect($('button[aria-label="Open search result: Beta note.md"]')).toBeDisplayed();
    await $('button[aria-label="Open Beta note.md in split pane"]').click();
    await expectSplit();
    await expect(search()).toHaveValue('Beta');
  });

  it('opens a Related note beside the source', async () => {
    await $('button[aria-label="Related notes"]').click();
    await expect($('button[aria-label="Open related note: Beta note"]')).toBeDisplayed();
    await $('button[aria-label="Open Beta note in split pane"]').click();
    await expectSplit();
  });

  it('keeps Last edited ordering after opening and refreshes after a saved edit', async () => {
    await search().click();
    await $('button=Last edited').click();
    await $('button[aria-label="Open last edited note: Beta note.md"]').click();
    await expect($('[data-testid="note-title"]')).toHaveValue('Beta note');
    await search().click();
    await expect(editedRows()).toBeElementsArrayOfSize(2);
    await expect(editedRows()[0]).toHaveAttribute('aria-label', 'Open last edited note: Alpha note.md');
    await browser.keys('Escape');
    await $('[data-testid="note-title"]').setValue('Beta edited');
    // Titles become authored changes on blur, matching the normal edit flow.
    await $('[data-testid="note-editor"] .cm-content').click();
    await browser.waitUntil(() => browser.execute(() => window.__GNEAUXGHTS_E2E__.snapshot().notes.some(note => note.title === 'Beta edited')));
    await search().click();
    await expect(editedRows()[0]).toHaveAttribute('aria-label', 'Open last edited note: Beta edited.md');
  });

  it('supports keyboard selection in Last edited', async () => {
    await search().click();
    await $('button=Last edited').click();
    await expect(editedRows()).toBeElementsArrayOfSize(2);
    await search().click();
    await browser.keys('ArrowDown');
    await browser.keys('Enter');
    await expect($('[data-testid="note-title"]')).toHaveValue('Beta note');
  });

  it('hides split actions in short inset windows', async () => {
    await browser.setWindowSize(1000, 500);
    await search().click();
    await $('button=Last edited').click();
    await expect(editedRows()).toBeElementsArrayOfSize(2);
    await expect($$('button[aria-label$="in split pane"]')).toBeElementsArrayOfSize(0);
  });

  it('supports explicit split navigation in compact windows', async () => {
    await browser.setWindowSize(390, 844);
    await search().click();
    await $('button=Last edited').click();
    await $('button[aria-label="Open Beta note.md in split pane"]').click();
    await expect($$('[data-testid="workspace-pane"]')).toBeElementsArrayOfSize(2);
    // Compact titles mount in the global navigation slot, outside pane DOM.
    await expect($('.mobile-workspace-title-slot [data-testid="note-title"]')).toHaveValue('Beta note');
    await expect($('[data-testid="workspace-pane"]:first-child')).toHaveAttribute('data-pane-collapsed', 'true');
  });
});
