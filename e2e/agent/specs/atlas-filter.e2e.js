import { browser, $, $$, expect } from '@wdio/globals';

// Recorded in atlas-filter-fix, then isolated for fresh replay.
const input = () => $('input[aria-label="Search map notes"]');
const dots = () => $$('[data-node-id]');
const status = () => $('.search-status');
const panel = () => $$('.search-results-panel');
async function mapCoordinates() {
  return browser.execute(() => [...document.querySelectorAll('[data-node-id]')].map(node => {
    const dot = node.querySelector('.dot-body');
    return [node.getAttribute('data-node-id'), dot.getAttribute('cx'), dot.getAttribute('cy')];
  }));
}

describe('Atlas node filtering', () => {
  beforeEach(async () => {
    await browser.setWindowSize(1440, 1000);
    await browser.url('/__gneauxghts_e2e_reset');
    await browser.execute(() => { localStorage.clear(); sessionStorage.clear(); });
    await browser.url('/map');
    await expect(dots()).toBeElementsArrayOfSize(2);
  });

  it('filters nodes in place, restores them on clear, and preserves ordinary map opening', async () => {
    const before = await mapCoordinates();
    await input().setValue('Beta');
    await expect(dots()).toBeElementsArrayOfSize(1);
    await expect($('[data-node-id]')).toHaveAttribute('aria-label', 'Pin beta.md');
    const filtered = await mapCoordinates();
    expect(filtered).toEqual(before.filter(([id]) => id === filtered[0][0]));
    await expect(panel()).toBeElementsArrayOfSize(0);
    await browser.keys('Enter');
    await expect(browser).toHaveUrl(expect.stringContaining('/map'));
    await $('button[aria-label="Clear search"]').click();
    await expect(dots()).toBeElementsArrayOfSize(2);
    expect(await mapCoordinates()).toEqual(before);
    await input().setValue('no-such-word');
    await expect(dots()).toBeElementsArrayOfSize(0);
    await expect(status()).toHaveText('0 matching nodes');
    await input().setValue('Beta');
    await expect(dots()).toBeElementsArrayOfSize(1);
    await $('[aria-label="Pin beta.md"]').doubleClick();
    await expect($('[data-testid="note-title"]')).toHaveValue('Beta note');
  });

  it('keeps the filter and map controls reachable on a small viewport', async () => {
    await browser.setWindowSize(500, 700);
    await input().setValue('Beta');
    await expect(dots()).toBeElementsArrayOfSize(1);
    await expect(panel()).toBeElementsArrayOfSize(0);
    await expect(status()).toHaveText('1 matching node');
    await expect($('button[aria-label="Fit map to view"]')).toBeClickable();
    await expect($('button[aria-label="Clear search"]')).toBeClickable();
    const bounds = await input().getLocation();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
  });

  it('drops stale matches during loading and recovers through the map Retry control', async () => {
    await input().setValue('Beta');
    await expect(dots()).toBeElementsArrayOfSize(1);
    await browser.execute(() => {
      window.__GNEAUXGHTS_E2E_COMMANDS__.search_vault_atlas = () => new Promise((_resolve, reject) => {
        window.__rejectAtlasSearch = () => reject(new Error('Offline'));
      });
    });
    await input().setValue('regression');
    await expect(status()).toHaveText('Searching…');
    await expect(dots()).toBeElementsArrayOfSize(0);
    await browser.waitUntil(() => browser.execute(() => typeof window.__rejectAtlasSearch === 'function'));
    await browser.execute(() => window.__rejectAtlasSearch());
    await expect(status()).toHaveText(expect.stringContaining('Search unavailable'));
    await expect(panel()).toBeElementsArrayOfSize(0);
    await browser.execute(() => { delete window.__GNEAUXGHTS_E2E_COMMANDS__.search_vault_atlas; });
    await status().$('button=Retry').click();
    await expect(dots()).toBeElementsArrayOfSize(1);
    await expect($('[data-node-id]')).toHaveAttribute('aria-label', 'Pin alpha.md');
  });
});
