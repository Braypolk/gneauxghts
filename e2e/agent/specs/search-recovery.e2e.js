import { browser, $, $$, expect } from '@wdio/globals';

// Recorded with the repository WDIO session loop and isolated for fresh replay.
describe('search failure recovery', () => {
  beforeEach(async () => {
    await browser.setWindowSize(1440, 1000);
    await browser.url('/__gneauxghts_e2e_reset');
    await browser.execute(() => { localStorage.clear(); sessionStorage.clear(); });
    await browser.url('/');
    await expect($('[data-testid="note-title"]')).toHaveValue('Alpha note');
    await $('[data-testid="note-search-input"]').setValue('Beta');
    await expect($('button[aria-label="Open search result: Beta note.md"]')).toBeDisplayed();
  });

  afterEach(async () => {
    await browser.execute(() => {
      delete window.__GNEAUXGHTS_E2E_COMMANDS__.search_notes_hybrid;
      delete window.__searchPanelBeforeModeChange;
    });
  });

  it('keeps the popup shell mounted while exchanging Search and Related', async () => {
    await browser.execute(() => {
      window.__searchPanelBeforeModeChange = document.querySelector('.search-results-panel');
    });
    await $('button[aria-label="Related notes"]').click();
    await expect($('[role="dialog"][aria-label="Related notes"]')).toBeDisplayed();
    expect(await browser.execute(() =>
      window.__searchPanelBeforeModeChange === document.querySelector('.search-results-panel'))).toBe(true);
    await $('button[aria-label="Search notes"]').click();
    await $('[data-testid="note-search-input"]').setValue('Beta');
    await expect($('button[aria-label="Open search result: Beta note.md"]')).toBeDisplayed();
    expect(await browser.execute(() =>
      window.__searchPanelBeforeModeChange === document.querySelector('.search-results-panel'))).toBe(true);
  });

  it('retains available matches when refreshing the same query fails', async () => {
    await browser.execute(() => {
      window.__GNEAUXGHTS_E2E_COMMANDS__.search_notes_hybrid = () => {
        throw new Error('Search temporarily offline');
      };
      // Appending whitespace reruns the same normalized query without clearing
      // the input first, as WebDriver setValue would do.
      const input = document.querySelector('[data-testid="note-search-input"]');
      input.value = 'Beta ';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect($('.search-results-panel')).toHaveText(expect.stringContaining('Could not search notes. Try again.'));
    await expect($('button[aria-label="Open search result: Beta note.md"]')).toBeDisplayed();
    await expect($('.search-results-panel')).not.toHaveText(expect.stringContaining('No matches'));
    await expect($('button=Retry')).toBeDisplayed();
  });

  it('clears incompatible matches for a failed new query and recovers through Retry', async () => {
    await browser.execute(() => {
      window.__GNEAUXGHTS_E2E_COMMANDS__.search_notes_hybrid = () => {
        throw new Error('Search temporarily offline');
      };
    });
    await $('[data-testid="note-search-input"]').setValue('Alpha');
    await expect($('.search-results-panel')).toHaveText(expect.stringContaining('Could not search notes. Try again.'));
    await expect($$('button[aria-label^="Open search result:"]')).toBeElementsArrayOfSize(0);
    await expect($('.search-results-panel')).not.toHaveText(expect.stringContaining('No matches'));
    await browser.execute(() => { delete window.__GNEAUXGHTS_E2E_COMMANDS__.search_notes_hybrid; });
    await $('button=Retry').click();
    await expect($('button[aria-label="Open search result: Alpha note.md"]')).toBeDisplayed();
    await expect($('.search-results-panel')).not.toHaveText(expect.stringContaining('Could not search notes'));
  });
});
