import { browser, $, expect } from '@wdio/globals';

async function settlePopup() {
  await browser.execute(async () => {
    await Promise.all(document.querySelector('.workspace-input-dock').getAnimations({ subtree: true })
      .filter(animation => Number.isFinite(animation.effect.getComputedTiming().endTime))
      .map(animation => animation.finished.catch(() => {})));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

async function expectFilledViewport() {
  const geometry = await browser.execute(() => {
    const panel = document.querySelector('.search-results-panel');
    const viewport = panel.querySelector('.search-results-content').firstElementChild;
    const style = getComputedStyle(panel);
    const bottom = panel.getBoundingClientRect().bottom - parseFloat(style.borderBottomWidth)
      - parseFloat(style.paddingBottom);
    return { gap: bottom - viewport.getBoundingClientRect().bottom,
      height: viewport.clientHeight, overflow: panel.scrollHeight - panel.clientHeight };
  });
  expect(Math.abs(geometry.gap)).toBeLessThanOrEqual(1);
  expect(geometry.height).toBeGreaterThan(100);
  expect(geometry.overflow).toBeLessThanOrEqual(1);
}

// Refined from the discovery-height WDIO session; each case owns its fixture state.
describe('discovery list height', () => {
  beforeEach(async () => {
    await browser.setViewport({ width: 1440, height: 900, devicePixelRatio: 1 });
    await browser.url('/__gneauxghts_e2e_reset');
    await browser.execute(() => { localStorage.clear(); sessionStorage.clear(); });
    await browser.url('/');
    await expect($('[data-testid="note-title"]')).toHaveValue('Alpha note');
  });

  afterEach(async () => {
    await browser.execute(() => {
      delete window.__GNEAUXGHTS_E2E_COMMANDS__.list_recent_focus;
      delete window.__GNEAUXGHTS_E2E_COMMANDS__.list_last_edited_notes;
    });
  });

  it('fills the panel with a single recent or last-edited section', async () => {
    await $('[data-testid="note-search-input"]').click();
    for (const mode of ['recent', 'edited']) {
      await $(`[data-browse-mode="${mode}"]`).click();
      const label = mode === 'recent' ? 'Open recent note: beta' : 'Open last edited note: alpha.md';
      await expect($(`button[aria-label="${label}"]`)).toExist();
      for (const [width, height] of [[1440, 900], [390, 650], [844, 390]]) {
        await browser.setViewport({ width, height, devicePixelRatio: 1 });
        await settlePopup();
        await expectFilledViewport();
        const gap = await browser.execute(() => {
          const viewport = document.querySelector('.search-results-content').firstElementChild;
          const list = viewport.querySelector('section').lastElementChild;
          return viewport.getBoundingClientRect().bottom - list.getBoundingClientRect().bottom;
        });
        expect(Math.abs(gap)).toBeLessThanOrEqual(1);
      }
    }
  });

  it('uses the full height for pinned columns and keeps stacked long lists reachable', async () => {
    await browser.execute(() => {
      const items = Array.from({ length: 18 }, (_, index) => ({
        noteId: `layout-${index}`, notePath: `/e2e/layout-${index}.md`,
        fileName: `Layout note ${index + 1}.md`, sectionLabel: 'Title', excerpt: '',
        highlightRanges: [], matchText: '', reasonLabels: [], lexicalScore: null,
        semanticScore: null, startLine: null, endLine: null
      }));
      window.__GNEAUXGHTS_E2E_COMMANDS__.list_recent_focus = () => ({
        pinnedNotes: items, recentNotes: [], lastChat: null
      });
      window.__GNEAUXGHTS_E2E_COMMANDS__.list_last_edited_notes = () => items;
    });
    await $('[data-testid="note-search-input"]').click();
    await $('[data-browse-mode="edited"]').click();
    await expect($('button[aria-label="Open last edited note: Layout note 18.md"]')).toExist();
    for (const [width, height] of [[1440, 900], [900, 900], [390, 650], [844, 390]]) {
      await browser.setViewport({ width, height, devicePixelRatio: 1 });
      await settlePopup();
      await expectFilledViewport();
      const measurements = await browser.execute(() => {
        const viewport = document.querySelector('.search-results-content').firstElementChild;
        const sections = [...viewport.querySelectorAll('section')];
        const columns = getComputedStyle(viewport).flexDirection === 'row';
        const scrollers = columns ? sections.map(section => section.lastElementChild) : [viewport];
        return scrollers.map(scroller => {
          scroller.scrollTop = scroller.scrollHeight;
          const rows = scroller.querySelectorAll('button.search-result-item');
          const lastRect = rows[rows.length - 1].getBoundingClientRect();
          const rect = scroller.getBoundingClientRect();
          return { height: scroller.clientHeight, scrolled: scroller.scrollTop,
            lastTop: lastRect.top - rect.top, lastBottom: lastRect.bottom - rect.top,
            bottomGap: viewport.getBoundingClientRect().bottom - rect.bottom };
        });
      });
      for (const measurement of measurements) {
        expect(measurement.height).toBeGreaterThan(100);
        expect(measurement.scrolled).toBeGreaterThan(0);
        expect(measurement.lastTop).toBeGreaterThanOrEqual(0);
        expect(measurement.lastBottom).toBeLessThanOrEqual(measurement.height + 1);
        expect(Math.abs(measurement.bottomGap)).toBeLessThanOrEqual(1);
      }
      await expect($('[data-browse-mode="edited"]')).toBeDisplayed();
    }
    // Keyboard selection must reveal the same last row through the real scroll path.
    await $('[data-browse-mode="edited"]').click();
    await $('[data-testid="note-search-input"]').click();
    await browser.keys(Array.from({ length: 35 }, () => 'ArrowDown'));
    await expect($('button[aria-label="Open last edited note: Layout note 18.md"]'))
      .toHaveAttribute('data-search-result-active', 'true');
    await browser.waitUntil(() => browser.execute(() => {
      const row = document.querySelector('button[aria-label="Open last edited note: Layout note 18.md"]');
      const viewport = document.querySelector('.search-results-content').firstElementChild;
      const rect = row.getBoundingClientRect(), port = viewport.getBoundingClientRect();
      return rect.top >= port.top - 1 && rect.bottom <= port.bottom + 1;
    }));
  });
});
