import { browser, $, expect } from '@wdio/globals';
import { mkdir } from 'node:fs/promises';

// Exported from watcher-health, then isolated for fresh fixture replay.
const health = () => $('[data-settings-anchor="watcher-health"]');
async function emitHealth(status, reason, reconciliationRunning, revision = 2) {
  await browser.execute(value => window.__GNEAUXGHTS_E2E__.emit('watcher-health-changed', value),
    { revision, status, reason, reconciliationRunning });
}
async function openVault() {
  await $('[data-settings-section="vault"]').click();
  await health().scrollIntoView();
}

describe('Watcher health in Vault Settings', () => {
  beforeEach(async () => {
    await browser.sendCommand('Emulation.clearDeviceMetricsOverride', {});
    await browser.setWindowSize(1440, 1000);
    await browser.url('/__gneauxghts_e2e_reset');
    await browser.execute(() => { localStorage.clear(); sessionStorage.clear(); });
    await browser.url('/settings');
    await $('[data-settings-section="vault"]').waitForDisplayed();
  });

  it('shows a callback warning, rejects stale activity and retains it across route navigation', async () => {
    await openVault();
    await expect(health()).toHaveText(expect.stringContaining('Watching the Running Vault'));
    await emitHealth('degraded', 'watchLimit', true);
    await expect(health()).toHaveText(expect.stringContaining('Periodic scans remain active'));
    await expect(health()).toHaveText(expect.stringContaining('file-watch limit was reached'));
    await $('a[href="/"]').click();
    await $('[data-testid="note-editor"][aria-busy="false"]').waitForExist();
    await emitHealth('watching', null, true, 1);
    await $('a[href="/settings"]').click();
    await openVault();
    await expect(health()).toHaveText(expect.stringContaining('File watching reported an error'));
    await expect(health()).toHaveText(expect.stringContaining('warning stays visible until restart'));
    await expect(health().$('button')).not.toBeExisting();
  });

  it('shows a preexisting startup failure without claiming periodic scanning, including at phone width', async () => {
    await emitHealth('unavailable', 'permissionDenied', false);
    await openVault();
    await expect(health()).toHaveText(expect.stringContaining('File watching could not start'));
    await expect(health()).toHaveText(expect.stringContaining('Periodic scans are not running'));
    await expect(health()).toHaveText(expect.stringContaining('Check that Gneauxghts can access the Running Vault'));
    await browser.sendCommand('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await health().scrollIntoView();
    await expect(health()).toBeDisplayed();
    expect(await browser.execute(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await mkdir('.wdio/watcher-health', { recursive: true });
    await browser.saveScreenshot('.wdio/watcher-health/phone-light.png');
    await browser.execute(() => { document.documentElement.classList.add('dark'); });
    await expect(health()).toBeDisplayed();
    await browser.saveScreenshot('.wdio/watcher-health/phone-dark.png');
    await expect(health().$('button')).not.toBeExisting();
  });
});
