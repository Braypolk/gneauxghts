import { browser, $, $$, expect } from '@wdio/globals';

// Recorded with the repository WDIO session loop, then isolated for fresh replay.
// Native retrieval tests separately prove file-time/modality admission before ranking.
describe('optional retrieval cues', () => {
  beforeEach(async () => {
    await browser.setViewport({ width: 1440, height: 1000, devicePixelRatio: 1 });
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
      delete window.__GNEAUXGHTS_E2E_COMMANDS__.search_media;
    });
  });

  async function lastCommand(command) {
    return browser.execute(name => window.__GNEAUXGHTS_E2E__.snapshot()
      .invocations.filter(item => item.command === name).at(-1), command);
  }

  it('offers reversible type and time cues while keeping result channels independent', async () => {
    await browser.execute(() => {
      window.__GNEAUXGHTS_E2E_COMMANDS__.search_media = () => [{
        kind: 'image', noteId: 'beta', notePath: '/vault/Beta note.md', noteTitle: 'Beta note',
        noteHash: 'note-proof', assetName: 'idea.png', assetHash: 'asset-proof',
        sourceStart: 0, sourceEnd: 10, score: 1
      }];
    });
    const mediaCallsBefore = await browser.execute(() => window.__GNEAUXGHTS_E2E__.snapshot()
      .invocations.filter(item => item.command === 'search_media').length);
    await $('[data-search-result-type="notes"]').click();
    await expect($('[data-search-result-type="notes"]')).toHaveAttribute('aria-pressed', 'true');
    await expect($('button[aria-label="Open search result: Beta note.md"]')).toBeDisplayed();
    expect(await browser.execute(() => window.__GNEAUXGHTS_E2E__.snapshot()
      .invocations.filter(item => item.command === 'search_media').length)).toBe(mediaCallsBefore);
    await $('[data-search-edited-window="7d"]').click();
    await expect($('[data-search-edited-window="7d"]')).toHaveAttribute('aria-pressed', 'true');
    const notes = await lastCommand('search_notes_hybrid');
    expect(notes.args.modifiedSinceMillis).toBeGreaterThan(Date.now() - 8 * 86400000);
    expect(notes.args.modifiedSinceMillis).toBeLessThan(Date.now() - 6 * 86400000);

    await $('[data-search-result-type="images"]').click();
    await expect($('button[aria-label="Open idea.png in Beta note"]')).toBeDisplayed();
    await expect($$('button[aria-label^="Open search result:"]')).toBeElementsArrayOfSize(0);
    const media = await lastCommand('search_media');
    expect(media.args).toMatchObject({ includePassages: false, modifiedSinceMillis: notes.args.modifiedSinceMillis });
    await $('[data-search-result-type="all"]').click();
    await expect($('button[aria-label="Open idea.png in Beta note"]')).toBeDisplayed();
    await expect($('button[aria-label="Open search result: Beta note.md"]')).toBeDisplayed();
  });

  it('preserves a time cue through failure and Retry, then resets to any time', async () => {
    await browser.execute(() => {
      window.__GNEAUXGHTS_E2E_COMMANDS__.search_notes_hybrid = () => {
        throw new Error('Temporarily unavailable');
      };
    });
    await $('[data-search-edited-window="30d"]').click();
    await expect($('.search-results-panel')).toHaveText(expect.stringContaining('Could not search notes. Try again.'));
    await expect($('[data-search-edited-window="30d"]')).toHaveAttribute('aria-pressed', 'true');
    await expect($$('button[aria-label^="Open search result:"]')).toBeElementsArrayOfSize(0);
    const failed = await lastCommand('search_notes_hybrid');
    await browser.execute(() => { delete window.__GNEAUXGHTS_E2E_COMMANDS__.search_notes_hybrid; });
    await $('button=Retry').click();
    await expect($('button[aria-label="Open search result: Beta note.md"]')).toBeDisplayed();
    const retried = await lastCommand('search_notes_hybrid');
    expect(retried.args.modifiedSinceMillis).toBe(failed.args.modifiedSinceMillis);
    await $('[data-search-edited-window="any"]').click();
    await expect($('[data-search-edited-window="any"]')).toHaveAttribute('aria-pressed', 'true');
    expect((await lastCommand('search_notes_hybrid')).args).not.toHaveProperty('modifiedSinceMillis');
    await $('button[aria-label="Search this note only"]').click();
    await expect($('.search-results-panel')).toHaveText(expect.stringContaining('No matches in this note.'));
    await expect($$('[data-search-result-type]')).toBeElementsArrayOfSize(0);
  });

  it('fits a 390px viewport and preserves Escape, Recent and Last edited', async () => {
    await browser.execute(() => {
      window.__qualityResizeErrors = [];
      window.addEventListener('error', event => {
        if (event.message.includes('ResizeObserver')) window.__qualityResizeErrors.push(event.message);
      });
    });
    await browser.setViewport({ width: 390, height: 844, devicePixelRatio: 1 });
    await expect($('[data-search-edited-window="30d"]')).toBeDisplayed();
    await browser.waitUntil(() => browser.execute(() => {
      const panel = document.querySelector('.search-results-panel').getBoundingClientRect();
      return panel.left >= 0 && panel.right <= innerWidth;
    }));
    const layout = await browser.execute(() => {
      const panel = document.querySelector('.search-results-panel').getBoundingClientRect();
      const cues = [...document.querySelectorAll('.search-retrieval-cue')].map(el => el.getBoundingClientRect());
      const edited = [...document.querySelectorAll('[data-search-edited-window]')].map(el => Math.round(el.getBoundingClientRect().top));
      return { width: innerWidth, height: innerHeight, left: panel.left, right: panel.right,
        top: panel.top, bottom: panel.bottom, edited,
        cues: cues.map(rect => ({ left: rect.left, right: rect.right })) };
    });
    expect(layout.width).toBe(390);
    expect(layout.left).toBeGreaterThanOrEqual(0);
    expect(layout.right).toBeLessThanOrEqual(layout.width);
    expect(layout.top).toBeGreaterThanOrEqual(0);
    expect(layout.bottom).toBeLessThanOrEqual(layout.height);
    expect(new Set(layout.edited).size).toBe(1);
    expect(layout.cues.every(rect => rect.left >= layout.left && rect.right <= layout.right)).toBe(true);
    await browser.execute(async () => {
      const dock = document.querySelector('.workspace-input-dock');
      await Promise.all(dock.getAnimations({ subtree: true })
        .filter(animation => Number.isFinite(animation.effect.getComputedTiming().endTime))
        .map(animation => animation.finished.catch(() => {})));
      // Let the last content measurement publish after the CSS transition ends.
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    expect(await browser.execute(() => window.__qualityResizeErrors)).toEqual([]);
    await browser.saveScreenshot('.wdio/retrieval-cues-compact.png');
    await $('[data-search-result-type="notes"]').execute(el => el.focus());
    await browser.keys('Escape');
    await expect($('[data-testid="note-search-input"]')).toHaveValue('');
    await expect($('[data-testid="note-search-input"]')).toBeFocused();
    await expect($('button[data-browse-mode="recent"]')).toBeDisplayed();
    await $('button[data-browse-mode="edited"]').click();
    await expect($('button[aria-label="Open last edited note: Beta note.md"]')).toBeDisplayed();
    await $('[data-testid="note-search-input"]').click();
    await browser.keys('Escape');
    await expect($('.search-results-panel')).not.toBeDisplayed();
  });
});
