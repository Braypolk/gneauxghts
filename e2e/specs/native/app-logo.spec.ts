import { browser, $, expect } from '@wdio/globals';
import { invokeNative } from '../../support/liveNative';

describe('native app logo', () => {
  it('applies both logos through AppKit and restores the saved choice independently of the interface theme', async () => {
    await $('a[href="/settings"]').waitForExist({ timeout: 30_000 });
    await browser.execute(() => localStorage.removeItem('gneauxghts.logo-preference'));
    await browser.refresh();
    await $('a[href="/settings"]').waitForExist({ timeout: 30_000 });
    await browser.execute(() => document.querySelector<HTMLAnchorElement>('a[href="/settings"]')!.click());
    await $('input[name="logo-preference"][value="auto"]').waitForExist({ timeout: 30_000 });
    const system = await invokeNative<'light' | 'dark'>('get_system_logo_theme');
    await expect($('input[name="logo-preference"][value="auto"]')).toBeChecked();
    await expect($('link[rel="icon"]')).toHaveAttribute('href', expect.stringContaining(`/logo-${system}.svg`));

    for (const theme of ['light', 'dark'] as const) {
      await browser.execute((theme: string) => {
        document.querySelector<HTMLInputElement>(`input[name="logo-preference"][value="${theme}"]`)!.click();
      }, theme);
      await expect($('link[rel="icon"]')).toHaveAttribute('href', expect.stringContaining(`/logo-${theme}.svg`));
      // Exercise the real adapter as well: its promise resolves only after
      // decoding the chosen artwork and updating AppKit on the main thread.
      await invokeNative('set_app_logo', { theme });
      await expect($('[data-settings-anchor="app-logo"] [role="alert"]')).not.toExist();
    }

    await browser.execute(() => localStorage.setItem('gneauxghts.theme-preference', 'light'));
    await browser.refresh();
    await expect($('html')).toHaveAttribute('data-theme', 'light');
    await expect($('input[name="logo-preference"][value="dark"]')).toBeChecked();
    await expect($('link[rel="icon"]')).toHaveAttribute('href', expect.stringContaining('/logo-dark.svg'));
    await browser.execute(() => document.querySelector<HTMLInputElement>('input[name="logo-preference"][value="auto"]')!.click());
    await expect($('link[rel="icon"]')).toHaveAttribute('href', expect.stringContaining(`/logo-${system}.svg`));
  });
});
