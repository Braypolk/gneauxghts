import { browser, $, $$, expect } from '@wdio/globals';

// Recorded and verified with the repository WDIO session loop, then isolated for replay.
describe('note discovery keyboard navigation', () => {
  beforeEach(async () => {
    await browser.setWindowSize(1440, 1000);
    await browser.url('/__gneauxghts_e2e_reset');
    await browser.execute(() => { localStorage.clear(); sessionStorage.clear(); });
    await browser.url('/');
    await expect($('[data-testid="note-title"]')).toHaveValue('Alpha note');
  });

  it('switches browse modes and opens a selected note in split screen with arrows and Enter', async () => {
    await $('[data-testid="note-search-input"]').click();
    await browser.keys('ArrowUp');
    await expect($('[data-browse-mode="recent"]')).toBeFocused();
    await browser.keys('ArrowRight');
    await expect($('[data-browse-mode="edited"]')).toBeFocused();
    await expect($('[data-browse-mode="edited"]')).toHaveAttribute('aria-pressed', 'true');
    await expect($$('button[aria-label^="Open last edited note:"]')).toBeElementsArrayOfSize(2);
    await browser.keys('ArrowLeft');
    await expect($('[data-browse-mode="recent"]')).toBeFocused();
    await expect($('[data-browse-mode="recent"]')).toHaveAttribute('aria-pressed', 'true');
    await browser.keys('ArrowRight');
    await expect($('[data-browse-mode="edited"]')).toBeFocused();
    await browser.keys('ArrowDown');
    await expect($('[data-testid="note-search-input"]')).toBeFocused();
    await expect($('button[aria-label="Open last edited note: Alpha note.md"]')).toHaveAttribute('data-search-result-active', 'true');
    await browser.keys('ArrowDown');
    await expect($('button[aria-label="Open last edited note: Beta note.md"]')).toHaveAttribute('data-search-result-active', 'true');
    await browser.keys('ArrowRight');
    await expect($('button[aria-label="Open Beta note.md in split pane"]')).toBeFocused();
    await browser.keys('ArrowLeft');
    await expect($('button[aria-label="Open last edited note: Beta note.md"]')).toBeFocused();
    await browser.keys('ArrowRight');
    await expect($('button[aria-label="Open Beta note.md in split pane"]')).toBeFocused();
    await browser.keys('Enter');
    await expect($$('[data-testid="workspace-pane"]')).toBeElementsArrayOfSize(2);
    await expect($('[data-testid="workspace-pane"]:first-child [data-testid="note-title"]')).toHaveValue('Alpha note');
    await expect($('[data-testid="workspace-pane"]:last-child [data-testid="note-title"]')).toHaveValue('Beta note');
  });

  it('preserves search cursor movement and restores input focus when Escape clears a query', async () => {
    await $('[data-testid="note-search-input"]').setValue('Beta');
    await expect($('button[aria-label="Open search result: Beta note.md"]')).toBeDisplayed();
    await browser.keys('ArrowRight');
    await expect($('[data-testid="note-search-input"]')).toBeFocused();
    await browser.keys('ArrowDown');
    await browser.keys('ArrowRight');
    await expect($('button[aria-label="Open Beta note.md in split pane"]')).toBeFocused();
    await browser.keys('ArrowLeft');
    await expect($('button[aria-label="Open search result: Beta note.md"]')).toBeFocused();
    await browser.keys('ArrowRight');
    await browser.keys('Escape');
    await expect($('[data-testid="note-search-input"]')).toBeFocused();
    await expect($('[data-testid="note-search-input"]')).toHaveValue('');
    await expect($('[data-browse-mode="recent"]')).toBeDisplayed();
    await browser.keys('ArrowUp');
    await expect($('[data-browse-mode="recent"]')).toBeFocused();
    await browser.keys('Escape');
    await expect($('[data-browse-mode="recent"]')).not.toBeDisplayed();
  });

  it('keeps split selection while moving between rows and reaches the mode switch above them', async () => {
    await $('[data-testid="note-search-input"]').click();
    await browser.keys('ArrowUp');
    await browser.keys('ArrowRight');
    await browser.keys('ArrowDown');
    await browser.keys('ArrowRight');
    await expect($('button[aria-label="Open Alpha note.md in split pane"]')).toBeFocused();
    await browser.keys('ArrowDown');
    await expect($('button[aria-label="Open Beta note.md in split pane"]')).toBeFocused();
    await browser.keys('ArrowUp');
    await expect($('button[aria-label="Open Alpha note.md in split pane"]')).toBeFocused();
    await browser.keys('ArrowUp');
    await expect($('[data-browse-mode="edited"]')).toBeFocused();
  });

  it('moves between Related note and split actions with Left and Right', async () => {
    await $('button[aria-label="Related notes"]').click();
    await expect($('button[aria-label="Open related note: Beta note"]')).toBeDisplayed();
    await browser.keys('ArrowRight');
    await expect($('button[aria-label="Open Beta note in split pane"]')).toBeFocused();
    await browser.keys('ArrowLeft');
    await expect($('button[aria-label="Open related note: Beta note"]')).toBeFocused();
    await browser.keys('ArrowRight');
    await browser.keys('Enter');
    await expect($$('[data-testid="workspace-pane"]')).toBeElementsArrayOfSize(2);
    await expect($('[data-testid="workspace-pane"]:first-child [data-testid="note-title"]')).toHaveValue('Alpha note');
    await expect($('[data-testid="workspace-pane"]:last-child [data-testid="note-title"]')).toHaveValue('Beta note');
  });

  it('keeps ordinary opening available when the window cannot split', async () => {
    await browser.setWindowSize(1000, 500);
    await $('[data-testid="note-search-input"]').click();
    await browser.keys('ArrowUp');
    await browser.keys('ArrowRight');
    await browser.keys('ArrowDown');
    await browser.keys('ArrowDown');
    await browser.keys('ArrowRight');
    await expect($$('[data-search-split-action]')).toBeElementsArrayOfSize(0);
    await expect($('[data-testid="note-search-input"]')).toBeFocused();
    await browser.keys('Enter');
    await expect($$('[data-testid="workspace-pane"]')).toBeElementsArrayOfSize(1);
    await expect($('[data-testid="note-title"]')).toHaveValue('Beta note');
    await browser.setWindowSize(1440, 1000);
  });
});
