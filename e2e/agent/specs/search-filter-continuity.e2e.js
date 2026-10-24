import { browser, $, expect } from '@wdio/globals';

const beta = 'button[aria-label="Open search result: beta.md"]';
const freshResult = {
  noteId: 'note-beta', notePath: '/e2e/beta.md', fileName: 'beta.md',
  sectionLabel: 'Body', excerpt: 'Updated filtered match', highlightRanges: [],
  matchText: '', reasonLabels: [], lexicalScore: null, semanticScore: null,
  startLine: null, endLine: null
};

// Exported from the WDIO session loop and isolated for fresh replay.
describe('search filter continuity', () => {
  beforeEach(async () => {
    await browser.setViewport({ width: 1440, height: 1000, devicePixelRatio: 1 });
    await browser.url('/__gneauxghts_e2e_reset');
    await browser.execute(() => { localStorage.clear(); sessionStorage.clear(); });
    await browser.url('/');
    await expect($('[data-testid="note-title"]')).toHaveValue('Alpha note');
    await $('[data-testid="note-search-input"]').setValue('Beta');
    await expect($(beta)).toBeDisplayed();
    await settlePopup();
  });

  afterEach(async () => {
    await browser.execute(() => {
      window.__continuityNotes?.forEach(request => request.resolve([]));
      window.__continuityMedia?.forEach(request => request.resolve([]));
      delete window.__continuityNotes;
      delete window.__continuityMedia;
      delete window.__continuityRow;
      delete window.__GNEAUXGHTS_E2E_COMMANDS__.search_notes_hybrid;
      delete window.__GNEAUXGHTS_E2E_COMMANDS__.search_media;
    });
  });

  async function settlePopup() {
    await browser.execute(async () => {
      await Promise.all(document.querySelector('.workspace-input-dock').getAnimations({ subtree: true })
        .filter(a => Number.isFinite(a.effect.getComputedTiming().endTime))
        .map(a => a.finished.catch(() => {})));
    });
  }

  async function holdRetrieval() {
    await browser.execute(() => {
      window.__continuityNotes = [];
      window.__continuityMedia = [];
      window.__GNEAUXGHTS_E2E_COMMANDS__.search_notes_hybrid = () => new Promise((resolve, reject) => {
        window.__continuityNotes.push({ resolve, reject });
      });
      window.__GNEAUXGHTS_E2E_COMMANDS__.search_media = () => new Promise((resolve, reject) => {
        window.__continuityMedia.push({ resolve, reject });
      });
    });
  }

  for (const width of [1440, 390]) {
    it(`retains the list until both channels finish, then restores selection at ${width}px`, async () => {
      await browser.setViewport({ width, height: 1000, devicePixelRatio: 1 });
      await settlePopup();
      const height = (await $('.search-results-panel').getSize()).height;
      const filter = $('[data-search-edited-window="7d"]');
      const position = await filter.getLocation();
      await holdRetrieval();
      await browser.execute(() => { window.__continuityRow = document.querySelector('[data-search-result-row]'); });
      if (width === 390) await $(beta).execute(el => el.focus());
      await filter.click();
      await expect($(beta)).toBeDisplayed();
      await expect($('[data-search-retained="true"]')).toHaveAttribute('inert');
      await expect($('.search-loading-shapes')).not.toExist();

      // WebDriver pointer dispatch bypasses its element-click guard to
      // prove inert results cannot navigate, even when visibly under the mouse.
      const point = await $(beta).execute(el => {
        const rect = el.getBoundingClientRect();
        return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
      });
      await browser.performActions([{ type: 'pointer', id: 'mouse', parameters: { pointerType: 'mouse' }, actions: [
        { type: 'pointerMove', duration: 0, ...point }, { type: 'pointerDown', button: 0 }, { type: 'pointerUp', button: 0 }
      ] }]);
      await browser.releaseActions();
      await $('[data-testid="note-search-input"]').click();
      await browser.keys(['ArrowDown', 'Enter']);
      await expect($('[data-testid="note-title"]')).toHaveValue('Alpha note');
      await expect($('.search-results-panel')).toBeDisplayed();

      await browser.execute(async result => {
        window.__continuityNotes[0].resolve([result]);
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      }, freshResult);
      await expect($('.search-results-panel')).toHaveAttribute('aria-busy', 'true');
      await expect($(beta)).not.toHaveText(expect.stringContaining('Updated filtered match'));
      expect(await browser.execute(() => window.__continuityRow === document.querySelector('[data-search-result-row]'))).toBe(true);
      expect((await $('.search-results-panel').getSize()).height).toBe(height);
      expect(await filter.getLocation()).toEqual(position);

      await browser.execute(() => window.__continuityMedia[0].resolve([]));
      await expect($(beta)).toHaveText(expect.stringContaining('Updated filtered match'));
      await expect($('[data-search-retained="true"]')).not.toExist();
      await expect($('.search-results-panel')).toHaveAttribute('aria-busy', 'false');
      expect((await $('.search-results-panel').getSize()).height).toBe(height);
      await $(beta).click();
      await expect($('[data-testid="note-title"]')).toHaveValue('Beta note');
    });
  }

  it('keeps the preview through superseded requests and failure, then recovers with Retry', async () => {
    await holdRetrieval();
    await $('[data-search-edited-window="7d"]').click();
    await $('[data-search-edited-window="30d"]').click();
    await browser.execute(() => {
      window.__continuityNotes[0].resolve([]);
      window.__continuityMedia[0].resolve([]);
    });
    await expect($(beta)).toBeDisplayed();
    await expect($('.search-results-panel')).toHaveAttribute('aria-busy', 'true');
    await browser.execute(() => {
      window.__continuityNotes[1].reject(new Error('Unavailable'));
      window.__continuityMedia[1].resolve([]);
    });
    await expect($('.search-results-panel')).toHaveText(expect.stringContaining('Previous matches shown. Retry to update results.'));
    await expect($(beta)).toBeDisplayed();
    await expect($('[data-search-retained="true"]')).toHaveAttribute('inert');
    await browser.execute(() => {
      delete window.__GNEAUXGHTS_E2E_COMMANDS__.search_notes_hybrid;
      delete window.__GNEAUXGHTS_E2E_COMMANDS__.search_media;
    });
    await $('button=Retry').click();
    await expect($('[data-search-retained="true"]')).not.toExist();
    await expect($(beta)).toBeDisplayed();
    await expect($('button=Retry')).not.toExist();
  });

  it('retains the preview through a new query and ignores the older delivery', async () => {
    await holdRetrieval();
    await $('[data-search-edited-window="7d"]').click();
    await expect($(beta)).toBeDisplayed();
    await browser.execute(() => {
      delete window.__GNEAUXGHTS_E2E_COMMANDS__.search_notes_hybrid;
      delete window.__GNEAUXGHTS_E2E_COMMANDS__.search_media;
    });
    await browser.execute(() => {
      const input = document.querySelector('[data-testid="note-search-input"]');
      input.value = 'Alpha line 1';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect($(beta)).toBeDisplayed();
    await expect($('[data-search-retained="true"]')).toHaveAttribute('inert');
    await expect($('button[aria-label="Open search result: alpha.md"]')).toBeDisplayed();
    await browser.execute(result => {
      window.__continuityNotes[0].resolve([result]);
      window.__continuityMedia[0].resolve([]);
    }, freshResult);
    await expect($(beta)).not.toExist();
    await expect($('[data-search-retained="true"]')).not.toExist();
    await expect($('button[aria-label="Open search result: alpha.md"]')).toBeDisplayed();
  });

  it('clamps the fixed height to a short viewport and scrolls results beneath the filters', async () => {
    await browser.setViewport({ width: 390, height: 520, devicePixelRatio: 1 });
    await settlePopup();
    const before = await $('.search-results-panel').getSize();
    const position = await $('[data-search-edited-window="7d"]').getLocation();
    const geometry = await $('.search-results-panel').execute(el => {
      const rect = el.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, viewport: innerHeight };
    });
    expect(before.height).toBeLessThan(416);
    expect(geometry.top).toBeGreaterThanOrEqual(0);
    expect(geometry.bottom).toBeLessThan(geometry.viewport);
    await browser.execute(result => {
      window.__GNEAUXGHTS_E2E_COMMANDS__.search_notes_hybrid = () => Array.from({ length: 20 }, (_, index) => ({
        ...result, fileName: `beta-${index}.md`
      }));
    }, freshResult);
    await $('[data-search-edited-window="7d"]').click();
    await expect($('button[aria-label="Open search result: beta-0.md"]')).toBeDisplayed();
    const scrolled = await $('[data-search-retained="false"]').execute(el => {
      el.scrollTop = el.scrollHeight;
      return el.scrollTop > 0 && el.scrollHeight > el.clientHeight;
    });
    expect(scrolled).toBe(true);
    expect(await $('.search-results-panel').getSize()).toEqual(before);
    expect(await $('[data-search-edited-window="7d"]').getLocation()).toEqual(position);
  });
});
