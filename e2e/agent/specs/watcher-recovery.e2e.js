import { browser, $, expect } from '@wdio/globals';

// Exported from watcher-recovery, then isolated for fresh fixture replay.
describe('Watcher recovery guidance', () => {
  it('shows fallback scanning at phone width and clears the startup warning on registration', async () => {
    await browser.url('/__gneauxghts_e2e_reset');
    await browser.execute(() => { localStorage.clear(); sessionStorage.clear(); });
    await browser.url('/settings');
    await $('[data-settings-section="vault"]').click();
    const health = () => $('[data-settings-anchor="watcher-health"]');
    await browser.execute(() => window.__GNEAUXGHTS_E2E__.emit('watcher-health-changed', {
      revision: 2, status: 'unavailable', reason: 'watchLimit', reconciliationRunning: true
    }));
    await expect(health()).toHaveText(expect.stringContaining('File watching retries automatically'));
    await expect(health()).toHaveText(expect.stringContaining('every 15 seconds when the vault is accessible'));
    await browser.sendCommand('Emulation.setDeviceMetricsOverride', {
      width: 390, height: 844, deviceScaleFactor: 1, mobile: true
    });
    await health().scrollIntoView();
    await expect(health()).toBeDisplayed();
    expect(await browser.execute(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await browser.execute(() => document.documentElement.classList.add('dark'));
    await expect(health()).toBeDisplayed();
    await browser.execute(() => window.__GNEAUXGHTS_E2E__.emit('watcher-health-changed', {
      revision: 3, status: 'watching', reason: null, reconciliationRunning: true
    }));
    await expect(health()).toHaveText(expect.stringContaining('Watching the Running Vault'));
    await expect(health()).not.toHaveText(expect.stringContaining('could not start'));
    await browser.sendCommand('Emulation.clearDeviceMetricsOverride', {});
  });
});
