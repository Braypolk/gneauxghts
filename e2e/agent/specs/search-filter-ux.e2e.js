import { browser, $, expect } from '@wdio/globals';

// Recorded with the repository WDIO session loop, then isolated for fresh replay.
describe('search filter interactions', () => {
  beforeEach(async () => {
    await browser.setViewport({ width: 1440, height: 1000, devicePixelRatio: 1 });
    await browser.url('/__gneauxghts_e2e_reset');
    await browser.execute(() => { localStorage.clear(); sessionStorage.clear(); });
    await browser.url('/');
    await expect($('[data-testid="note-title"]')).toHaveValue('Alpha note');
    await browser.execute(() => {
      window.__filterUxErrors = [];
      window.addEventListener('error', event => window.__filterUxErrors.push(event.message));
    });
    await $('[data-testid="note-search-input"]').setValue('Beta');
    await expect($('button[aria-label="Open search result: beta.md"]')).toBeDisplayed();
    await settlePopup();
  });

  afterEach(async () => {
    expect(await browser.execute(() => window.__filterUxErrors)).toEqual([]);
    await browser.execute(() => {
      window.__resolveFilter?.([]);
      delete window.__resolveFilter;
      delete window.__filterPanel;
      delete window.__GNEAUXGHTS_E2E_COMMANDS__.search_notes_hybrid;
    });
  });

  it('keeps search open when a keyboard-activated Retry control is removed', async () => {
    await browser.execute(() => {
      window.__GNEAUXGHTS_E2E_COMMANDS__.search_notes_hybrid = () => { throw new Error('Temporarily offline'); };
    });
    await $('[data-search-edited-window="7d"]').click();
    await expect($('button=Retry')).toBeDisplayed();
    await browser.execute(() => { delete window.__GNEAUXGHTS_E2E_COMMANDS__.search_notes_hybrid; });
    await $('button=Retry').execute(el => el.focus());
    await browser.keys('Enter');
    await expect($('button[aria-label="Open search result: beta.md"]')).toBeDisplayed();
    await expect($('[data-testid="note-search-input"]')).toBeFocused();
    await expect($('.search-results-panel')).toBeDisplayed();
  });

  async function settlePopup() {
    await browser.execute(async () => {
      const dock = document.querySelector('.workspace-input-dock');
      await Promise.all(dock.getAnimations({ subtree: true })
        .filter(animation => Number.isFinite(animation.effect.getComputedTiming().endTime))
        .map(animation => animation.finished.catch(() => {})));
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
  }

  for (const width of [1440, 390]) {
    it(`keeps padding clicks inside the popup and accepts button-edge clicks at ${width}px`, async () => {
      await browser.setViewport({ width, height: 1000, devicePixelRatio: 1 });
      await settlePopup();
      const panel = $('.search-results-panel');
      const { height } = await panel.getSize();
      // Top padding, away from the rounded corners and interactive children.
      await panel.click({ x: 0, y: Math.round(-height / 2 + 4) });
      await expect(panel).toBeDisplayed();
      await expect($('[data-testid="note-search-input"]')).toBeFocused();
      await expect($('[data-testid="note-title"]')).toHaveValue('Alpha note');

      const targets = await browser.execute(() => [...document.querySelectorAll('.search-retrieval-cue')]
        .map(el => { const rect = el.getBoundingClientRect(); return { width: rect.width, height: rect.height }; }));
      expect(targets).toHaveLength(6);
      expect(targets.every(rect => rect.height >= 36 && rect.width >= 44)).toBe(true);
      const notes = $('[data-search-result-type="notes"]');
      const size = await notes.getSize();
      await notes.click({ x: 0, y: Math.floor(size.height / 2) - 3 });
      await expect(notes).toHaveAttribute('aria-pressed', 'true');
      await expect($('button[aria-label="Open search result: beta.md"]')).toBeDisplayed();
      await expect($('[data-testid="note-search-input"]')).toBeFocused();
      await $('[data-testid="note-title"]').click();
      await expect(panel).not.toBeDisplayed();
    });

    it(`holds filter positions through a delayed refresh and empty results at ${width}px`, async () => {
      await browser.setViewport({ width, height: 1000, devicePixelRatio: 1 });
      await settlePopup();
      const filter = $('[data-search-edited-window="7d"]');
      const before = await filter.getLocation();
      await browser.execute(() => {
        window.__filterPanel = document.querySelector('.search-results-panel');
        window.__GNEAUXGHTS_E2E_COMMANDS__.search_notes_hybrid = () => new Promise(resolve => {
          window.__resolveFilter = resolve;
        });
      });
      await filter.click();
      await expect($('.search-results-panel')).toHaveAttribute('aria-busy', 'true');
      await expect($('button[aria-label="Open search result: beta.md"]')).toBeDisplayed();
      await expect($('[data-search-retained="true"]')).toHaveAttribute('inert');
      await expect($('.search-loading-shapes')).not.toExist();
      const loading = await filter.getLocation();
      expect(Math.abs(loading.y - before.y)).toBeLessThanOrEqual(1);
      expect(loading.x).toBe(before.x);
      expect(await browser.execute(() => window.__filterPanel === document.querySelector('.search-results-panel'))).toBe(true);
      await browser.execute(() => window.__resolveFilter([]));
      await expect($('.search-results-panel')).toHaveText(expect.stringContaining('No matches with these filters'));
      await expect($('.search-results-panel')).toHaveAttribute('aria-busy', 'false');
      await expect($('.search-loading-shapes')).not.toExist();
      const empty = await filter.getLocation();
      expect(Math.abs(empty.y - before.y)).toBeLessThanOrEqual(1);
      await expect(filter).toHaveAttribute('aria-pressed', 'true');
      await expect($('[data-testid="note-search-input"]')).toHaveValue('Beta');

      await browser.saveScreenshot(`.wdio/search-filter-ux-${width}.png`);
      await browser.execute(() => { delete window.__GNEAUXGHTS_E2E_COMMANDS__.search_notes_hybrid; });
      await $('[data-search-result-type="images"]').click();
      await expect($('.search-results-panel')).toHaveText(expect.stringContaining('No matches with these filters'));
      // The fixed shell also stays put when a different query has no results.
      const retained = (await $('.search-results-panel').getSize()).height;
      await $('[data-testid="note-search-input"]').setValue('unmatched query');
      await expect($('.search-results-panel')).toHaveText(expect.stringContaining('No matches with these filters'));
      expect((await $('.search-results-panel').getSize()).height).toBe(retained);
    });
  }

  it('preserves keyboard activation and Escape, and dismisses when focus tabs outside', async () => {
    const notes = $('[data-search-result-type="notes"]');
    await notes.execute(el => el.focus());
    await browser.keys('Space');
    await expect(notes).toHaveAttribute('aria-pressed', 'true');
    await expect(notes).toBeFocused();
    await browser.keys('Escape');
    await expect($('[data-testid="note-search-input"]')).toHaveValue('');
    await expect($('[data-testid="note-search-input"]')).toBeFocused();
    await expect($('[data-browse-mode="recent"]')).toBeDisplayed();
    await $('[data-testid="note-search-input"]').setValue('Beta');
    await $('[data-search-result-type="images"]').click();
    await expect($('.search-results-panel')).toHaveText(expect.stringContaining('No matches with these filters'));
    await $('[data-search-edited-window="30d"]').execute(el => el.focus());
    await browser.keys('Tab');
    await expect($('.search-results-panel')).not.toBeDisplayed();
  });
});
