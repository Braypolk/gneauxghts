import { browser, expect, $ } from '@wdio/globals';

describe('native Tauri lifecycle', () => {
  it('boots the real application through the embedded macOS driver', async () => {
    const shell = await $('.notepad-area-shell');
    await shell.waitForDisplayed({ timeout: 20_000 });
    expect(await browser.getTitle()).toContain('Gneauxghts');
  });

  it('restores stable geometry across an actual application restart', async () => {
    const target = { x: 140, y: 120, width: 980, height: 700 };
    await browser.setWindowRect(target.x, target.y, target.width, target.height);
    await browser.pause(150);
    const saved = await browser.getWindowRect();

    await browser.reloadSession();
    const initial = await browser.getWindowRect();
    const shell = await $('.notepad-area-shell');
    await shell.waitForDisplayed({ timeout: 20_000 });
    await browser.pause(350);
    const settled = await browser.getWindowRect();

    expect(Math.abs(initial.width - saved.width)).toBeLessThanOrEqual(2);
    expect(Math.abs(initial.height - saved.height)).toBeLessThanOrEqual(2);
    expect(Math.abs(initial.x - saved.x)).toBeLessThanOrEqual(2);
    expect(Math.abs(initial.y - saved.y)).toBeLessThanOrEqual(2);
    expect(Math.abs(settled.width - initial.width)).toBeLessThanOrEqual(2);
    expect(Math.abs(settled.height - initial.height)).toBeLessThanOrEqual(2);
    expect(Math.abs(settled.x - initial.x)).toBeLessThanOrEqual(2);
    expect(Math.abs(settled.y - initial.y)).toBeLessThanOrEqual(2);
  });

  it('exposes the debug-only Tauri automation bridge', async () => {
    await browser.waitUntil(async () => {
      return browser.execute(() => 'wdioTauri' in window);
    }, { timeout: 10_000, timeoutMsg: 'Expected @wdio/tauri-plugin to initialize' });
  });
});
