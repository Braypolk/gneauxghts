import { browser, $, expect } from '@wdio/globals';

// Reviewed export of the related-close session. Sample the painted rectangle
// on every frame so a jump before the closing animation cannot hide.
const settleDock = async () => {
  await browser.waitUntil(async () => await $('.workspace-input-dock').getAttribute('data-dock-phase') === 'settled');
};
const sampleAction = async (action) => browser.execute(async action => {
  const panel = document.querySelector('.search-results-panel');
  const rows = [];
  const record = () => {
    if (!panel.isConnected) return;
    const rect = panel.getBoundingClientRect();
    const dock = document.querySelector('.workspace-input-dock').getBoundingClientRect();
    rows.push({ left: rect.left, width: rect.width, bottom: rect.bottom, centerError: rect.left + rect.width / 2 - dock.left - dock.width / 2 });
  };
  record();
  if (action === 'escape') {
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  } else {
    document.querySelector(action === 'related' ? 'button[aria-label="Related notes"]'
      : action === 'search' ? 'button[aria-label="Search notes"]' : '[data-related-view="backlinks"]').click();
  }
  const started = performance.now();
  await new Promise(resolve => {
    const sample = () => {
      record();
      if (performance.now() - started < 500) requestAnimationFrame(sample); else resolve();
    };
    requestAnimationFrame(sample);
  });
  return { rows, removed: !panel.isConnected, count: document.querySelectorAll('.search-results-panel').length };
}, action);
const verifyStationary = result => {
  expect(result.rows.length).toBeGreaterThan(4);
  for (const key of ['left', 'width', 'bottom']) {
    expect(Math.max(...result.rows.map(row => row[key])) - Math.min(...result.rows.map(row => row[key]))).toBeLessThanOrEqual(1);
  }
  expect(Math.max(...result.rows.map(row => Math.abs(row.centerError)))).toBeLessThanOrEqual(1);
};

describe('Shared discovery popup anchor', () => {
  for (const width of [1440, 390]) {
    it(`keeps Search, Related and Backlinks stationary while switching and closing at ${width}px`, async () => {
      await browser.url('/__gneauxghts_e2e_reset');
      await browser.execute(() => { localStorage.clear(); sessionStorage.clear(); });
      await browser.url('/');
      await expect($('[data-testid="note-title"]')).toHaveValue('Alpha note');
      try {
        await browser.sendCommand('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: false });
        await $('[data-testid="note-search-input"]').click();
        await expect($('.search-results-panel')).toBeDisplayed();
        await settleDock();
        const toRelated = await sampleAction('related');
        verifyStationary(toRelated);
        expect(toRelated.count).toBe(1);
        await expect($('[role="dialog"][aria-label="Related notes"]')).toBeDisplayed();
        const toSearch = await sampleAction('search');
        verifyStationary(toSearch);
        expect(toSearch.count).toBe(1);
        const searchClose = await sampleAction('escape');
        verifyStationary(searchClose);
        expect(searchClose.removed).toBe(true);
        await $('button[aria-label="Related notes"]').click();
        await settleDock();
        const relatedClose = await sampleAction('escape');
        verifyStationary(relatedClose);
        expect(relatedClose.removed).toBe(true);
        await $('button[aria-label="Related notes"]').click();
        await settleDock();
        verifyStationary(await sampleAction('backlinks'));
        await expect($('[role="dialog"][aria-label="Backlinks"]')).toBeDisplayed();
        const backlinksClose = await sampleAction('escape');
        verifyStationary(backlinksClose);
        expect(backlinksClose.removed).toBe(true);
      } finally {
        await browser.sendCommand('Emulation.clearDeviceMetricsOverride', {});
      }
    });
  }
});
