import { browser, $, expect } from '@wdio/globals';

// Reviewed export from the backlinks-toggle WDIO session.
describe('Related / Backlinks', () => {
  it('switches views with pointer and keyboard, opens an incoming note and explains empty backlinks', async () => {
    await browser.url('/__gneauxghts_e2e_reset');
    await browser.execute(() => { localStorage.clear(); sessionStorage.clear(); });
    await browser.url('/');
    await expect($('[data-testid="note-title"]')).toHaveValue('Alpha note');
    await browser.execute(async () => {
      await window.__TAURI_INTERNALS__.invoke('save_note', {
        currentPath: '/e2e/beta.md', title: 'Beta note',
        markdown: 'Beta introduction.\n\nSee [[Alpha note#Ideas|the current note]].'
      });
    });

    await $('button[aria-label="Related notes"]').click();
    await expect($('[data-related-view="related"]')).toHaveAttribute('aria-pressed', 'true');
    await expect($('button[aria-label="Open related note: Beta note"]')).toBeDisplayed();
    await $('[data-related-view="backlinks"]').click();
    await expect($('[role="dialog"][aria-label="Backlinks"]')).toBeDisplayed();
    await expect($('[data-related-view="backlinks"]')).toHaveAttribute('aria-pressed', 'true');
    await expect($('button[aria-label="Open backlink: Beta note"]')).toBeDisplayed();
    await expect($('.related-results')).toHaveText(expect.stringContaining('See [[Alpha note#Ideas|the current note]].'));

    await $('[data-related-view="backlinks"]').execute(element => element.focus());
    await browser.keys('ArrowLeft');
    await expect($('[data-related-view="related"]')).toBeFocused();
    await expect($('button[aria-label="Open related note: Beta note"]')).toBeDisplayed();
    await browser.keys('ArrowRight');
    await expect($('[data-related-view="backlinks"]')).toBeFocused();
    await expect($('button[aria-label="Open backlink: Beta note"]')).toBeDisplayed();

    try {
      await browser.sendCommand('Emulation.setDeviceMetricsOverride', {
        width: 390, height: 844, deviceScaleFactor: 1, mobile: false
      });
      await expect($('[data-related-view="backlinks"]')).toBeDisplayed();
      await expect($('button[aria-label="Open backlink: Beta note"]')).toBeDisplayed();
      expect(await browser.execute(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

      await $('button[aria-label="Open backlink: Beta note"]').click();
      await expect($('[data-testid="note-title"]')).toHaveValue('Beta note');
      await expect($('[role="dialog"][aria-label="Backlinks"]')).not.toExist();
      await $('button[aria-label="Related notes"]').click();
      await expect($('.related-results')).toHaveText(expect.stringContaining('No notes link to this note yet.'));
      await expect($('[data-related-view="backlinks"]')).toHaveAttribute('aria-pressed', 'true');
      await $('[role="dialog"][aria-label="Backlinks"]').$('button=Refresh').click();
      await expect($('.related-results')).toHaveText(expect.stringContaining('No notes link to this note yet.'));
      await browser.keys('Escape');
      await expect($('[role="dialog"][aria-label="Backlinks"]')).not.toExist();
    } finally {
      await browser.sendCommand('Emulation.clearDeviceMetricsOverride', {});
    }
  });
});
