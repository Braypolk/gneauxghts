import { browser, $, expect } from '@wdio/globals';

// Exported from the search-audit session and isolated for fresh replay.
describe('image search text refinement', () => {
  afterEach(async () => {
    await browser.execute(() => {
      window.__refinementMedia?.forEach(resolve => resolve([]));
      delete window.__refinementMedia;
      delete window.__refinementImage;
      delete window.__GNEAUXGHTS_E2E_COMMANDS__.search_media;
    });
  });

  it('retains results when deleting only the text, but retires them on Clear', async () => {
    await browser.url('/__gneauxghts_e2e_reset');
    await browser.execute(() => { localStorage.clear(); sessionStorage.clear(); });
    await browser.url('/');
    await expect($('[data-testid="note-title"]')).toHaveValue('Alpha note');
    await $('[data-testid="note-search-input"]').click();
    await browser.execute(() => {
      window.__refinementImage = {
        kind: 'image', noteId: 'beta', notePath: '/e2e/beta.md', noteTitle: 'Beta note',
        noteHash: 'note-proof', assetName: 'idea.png', assetHash: 'asset-proof',
        sourceStart: 0, sourceEnd: 10, score: 1
      };
      window.__GNEAUXGHTS_E2E_COMMANDS__.search_media = () => [window.__refinementImage];
      const data = new DataTransfer();
      data.items.add(new File([
        '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'
      ], 'query.svg', { type: 'image/svg+xml' }));
      document.querySelector('[data-testid="note-search-input"]').dispatchEvent(
        new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true })
      );
    });
    await expect($('button[aria-label="Open idea.png in Beta note"]')).toBeDisplayed();
    await $('[data-testid="note-search-input"]').setValue('refine');
    await expect($('.search-results-panel')).toHaveAttribute('aria-busy', 'false');
    await browser.execute(() => {
      window.__refinementMedia = [];
      window.__GNEAUXGHTS_E2E_COMMANDS__.search_media = () => new Promise(resolve => window.__refinementMedia.push(resolve));
      const input = document.querySelector('[data-testid="note-search-input"]');
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await browser.waitUntil(() => browser.execute(() => window.__refinementMedia.length > 0));
    await expect($('img[alt="Search query"]')).toBeDisplayed();
    await expect($('button[aria-label="Open idea.png in Beta note"]')).toBeDisplayed();
    await expect($('.search-results-content')).toHaveAttribute('inert');
    await expect($('.search-results-panel')).toHaveAttribute('aria-busy', 'true');
    await browser.execute(() => window.__refinementMedia[0]([{ ...window.__refinementImage, assetName: 'replacement.png' }]));
    await expect($('button[aria-label="Open replacement.png in Beta note"]')).toBeDisplayed();
    await expect($('.search-results-panel')).toHaveAttribute('aria-busy', 'false');
    await expect($('.search-results-content')).not.toHaveAttribute('inert');
    await browser.execute(() => {
      const input = document.querySelector('[data-testid="note-search-input"]');
      input.value = 'again';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await browser.waitUntil(() => browser.execute(() => window.__refinementMedia.length === 2));
    await $('button[aria-label="Clear search"]').click();
    await expect($('img[alt="Search query"]')).not.toExist();
    await expect($('.search-results-content')).not.toHaveAttribute('inert');
    await browser.execute(() => window.__refinementMedia[1]([window.__refinementImage]));
    await expect($('[data-testid="note-search-input"]')).toHaveValue('');
    await expect($('.image-search-result')).not.toExist();
    await expect($('.search-results-panel')).toHaveAttribute('aria-busy', 'false');
  });
});
