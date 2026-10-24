import { browser, $, expect } from '@wdio/globals';

const beta = 'button[aria-label="Open search result: beta.md"]';
const alpha = 'button[aria-label="Open search result: alpha.md"]';
const result = {
  noteId: 'note-alpha', notePath: '/e2e/alpha.md', fileName: 'alpha.md',
  sectionLabel: 'Body', excerpt: 'Final Alpha result', highlightRanges: [],
  matchText: '', reasonLabels: [], lexicalScore: null, semanticScore: null,
  startLine: null, endLine: null
};

async function replaceQuery(query) {
  // Model replacing selected text in one input event. setValue first emits a
  // separate clear, which intentionally returns the app to idle browsing.
  await browser.execute(query => {
    const input = document.querySelector('[data-testid="note-search-input"]');
    input.value = query;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, query);
}

async function holdRetrieval() {
  await browser.execute(() => {
    window.__quietNotes = [];
    window.__quietMedia = [];
    window.__GNEAUXGHTS_E2E_COMMANDS__.search_notes_hybrid = () => new Promise(resolve => window.__quietNotes.push(resolve));
    window.__GNEAUXGHTS_E2E_COMMANDS__.search_media = () => new Promise(resolve => window.__quietMedia.push(resolve));
  });
}

async function startBeta() {
  await $('[data-testid="note-search-input"]').setValue('Beta');
  await expect($(beta)).toBeDisplayed();
  await browser.execute(async () => {
    await Promise.all(document.querySelector('.workspace-input-dock').getAnimations({ subtree: true })
      .filter(a => Number.isFinite(a.effect.getComputedTiming().endTime)).map(a => a.finished.catch(() => {})));
  });
}

// Exported from the WDIO session loop and isolated for fresh replay.
describe('steady search result presentation', () => {
  beforeEach(async () => {
    await browser.setViewport({ width: 1440, height: 650, devicePixelRatio: 1 });
    await browser.url('/__gneauxghts_e2e_reset');
    await browser.execute(() => { localStorage.clear(); sessionStorage.clear(); });
    await browser.url('/');
    await expect($('[data-testid="note-title"]')).toHaveValue('Alpha note');
  });

  afterEach(async () => {
    await browser.execute(() => {
      delete window.__quietFrames;
      window.__quietNotes?.forEach(resolve => resolve([]));
      window.__quietMedia?.forEach(resolve => resolve([]));
      delete window.__quietNotes;
      delete window.__quietMedia;
      delete window.__quietRow;
      delete window.__GNEAUXGHTS_E2E_COMMANDS__.search_notes_hybrid;
      delete window.__GNEAUXGHTS_E2E_COMMANDS__.search_media;
    });
    await browser.emulate('media', { prefersReducedMotion: 'no-preference' });
  });

  for (const { width, motion } of [
    { width: 1440, motion: 'no-preference' },
    { width: 390, motion: 'no-preference' },
    { width: 390, motion: 'reduce' }
  ]) {
    it(`holds one list through burst typing and partial delivery at ${width}px (${motion})`, async () => {
      await browser.setViewport({ width, height: 650, devicePixelRatio: 1 });
      await browser.emulate('media', { prefersReducedMotion: motion });
      await startBeta();
      const height = (await $('.search-results-panel').getSize()).height;
      const samples = await browser.execute(async result => {
        const input = document.querySelector('[data-testid="note-search-input"]');
        window.__quietNotes = [];
        window.__quietMedia = [];
        window.__quietRow = document.querySelector('.search-result-item');
        window.__quietFrames = [];
        const record = () => {
          if (!window.__quietFrames) return;
          window.__quietFrames.push({
            query: document.querySelector('.search-results-content').dataset.searchPresentationQuery,
            rows: document.querySelectorAll('.search-result-item').length,
            skeleton: !!document.querySelector('.search-loading-shapes, [data-search-skeleton-split]')
          });
          requestAnimationFrame(record);
        };
        requestAnimationFrame(record);
        window.__GNEAUXGHTS_E2E_COMMANDS__.search_notes_hybrid = ({ query }) => query === 'Alpha'
          ? new Promise(resolve => window.__quietNotes.push(resolve)) : Promise.resolve([{ ...result, excerpt: query }]);
        window.__GNEAUXGHTS_E2E_COMMANDS__.search_media = ({ query }) => query === 'Alpha'
          ? new Promise(resolve => window.__quietMedia.push(resolve)) : Promise.resolve([]);
        const sample = () => ({
          query: document.querySelector('.search-results-content').dataset.searchPresentationQuery,
          sameRow: window.__quietRow === document.querySelector('.search-result-item'),
          oldLabel: document.querySelector('.search-result-item').getAttribute('aria-label')
        });
        const samples = [];
        // Early searches finish at the store's 120 ms admission debounce, but
        // these edits arrive before the 250 ms presentation quiet period.
        for (const query of ['A', 'Al', 'Alpha']) {
          input.value = query;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          await new Promise(resolve => setTimeout(resolve, 170));
          samples.push(sample());
        }
        window.__quietNotes[0]([result]);
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        samples.push(sample());
        return samples;
      }, result);
      expect(samples).toEqual(Array.from({ length: 4 }, () => ({
        query: 'Beta', sameRow: true, oldLabel: 'Open search result: beta.md'
      })));
      await expect($('.search-results-content')).toHaveAttribute('inert');
      await browser.keys(['ArrowDown', 'Enter']);
      await expect($('[data-testid="note-title"]')).toHaveValue('Alpha note');
      await browser.execute(() => window.__quietMedia[0]([]));
      await expect($(alpha)).toHaveText(expect.stringContaining('Final Alpha result'));
      await expect($('.search-results-content')).not.toHaveAttribute('inert');
      await expect($('.search-results-panel')).toHaveAttribute('aria-busy', 'false');
      expect((await $('.search-results-panel').getSize()).height).toBe(height);
      const frames = await browser.execute(() => {
        const frames = window.__quietFrames;
        delete window.__quietFrames;
        return frames;
      });
      expect(frames.length).toBeGreaterThan(0);
      expect(frames.every(frame => ['Beta', 'Alpha'].includes(frame.query) && frame.rows > 0 && !frame.skeleton)).toBe(true);
      await $(alpha).click();
      await expect($('.search-results-panel')).not.toBeDisplayed();
    });
  }

  it('keeps idle pinned content visible until the first complete search is ready', async () => {
    await $('button[aria-label="Pin note"]').click();
    await $('[data-testid="note-search-input"]').click();
    const pinned = $('button[aria-label="Open pinned note: alpha.md"]');
    await expect(pinned).toBeDisplayed();
    await holdRetrieval();
    await replaceQuery('Alpha');
    await browser.waitUntil(() => browser.execute(() => window.__quietNotes.length > 0));
    await browser.execute(result => window.__quietNotes[0]([result]), result);
    await expect(pinned).toBeDisplayed();
    await expect($('.search-results-content')).toHaveAttribute('inert');
    await expect($('.search-result-skeleton')).not.toExist();
    await browser.execute(() => window.__quietMedia[0]([]));
    await expect($(alpha)).toBeDisplayed();
    await expect(pinned).not.toExist();
    await expect($('.search-results-content')).not.toHaveAttribute('inert');
  });

  it('retires the preview and timer on scope changes, clear and dismissal', async () => {
    await startBeta();
    await holdRetrieval();
    await replaceQuery('Alpha');
    await browser.waitUntil(() => browser.execute(() => window.__quietNotes.length > 0));
    await $('button[aria-label="Search this note only"]').click();
    await expect($('.search-results-content')).not.toHaveAttribute('inert');
    await expect($('.search-results-content')).toHaveAttribute('data-search-presentation-query', 'Alpha');
    await browser.execute(result => {
      window.__quietNotes.forEach(resolve => resolve([result]));
      window.__quietMedia.forEach(resolve => resolve([]));
    }, result);
    await browser.keys('Escape');
    await expect($('[data-testid="note-search-input"]')).toHaveValue('');
    await expect($('[data-browse-mode="recent"]')).toBeDisplayed();
    await replaceQuery('regression');
    await $('[data-testid="note-title"]').click();
    await expect($('.search-results-panel')).not.toBeDisplayed();
    await browser.execute(async () => { await new Promise(resolve => setTimeout(resolve, 350)); });
    await expect($('.search-results-panel')).not.toBeDisplayed();
  });

  it('admits usable new note results when the image channel fails', async () => {
    await startBeta();
    await browser.execute(result => {
      window.__GNEAUXGHTS_E2E_COMMANDS__.search_notes_hybrid = () => [result];
      window.__GNEAUXGHTS_E2E_COMMANDS__.search_media = () => { throw new Error('Image search unavailable'); };
    }, result);
    await replaceQuery('Alpha');
    await expect($(alpha)).toBeDisplayed();
    await expect($(beta)).not.toExist();
    await expect($('.search-results-panel')).toHaveText(expect.stringContaining('Showing available matches.'));
    await expect($('.search-results-content')).not.toHaveAttribute('inert');
    await expect($('.search-result-skeleton')).not.toExist();
    await holdRetrieval();
    await $('button=Retry').click();
    await expect($(alpha)).toBeDisplayed();
    await browser.execute(result => {
      window.__quietNotes[0]([result]);
      window.__quietMedia[0]([]);
    }, result);
    await expect($('.search-results-panel')).toHaveAttribute('aria-busy', 'false');
  });
});
