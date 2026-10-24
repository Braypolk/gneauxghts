import { browser, $, expect } from '@wdio/globals';

describe('app logo preference', () => {
  it('follows the system by default and persists manual choices independently of the interface theme', async () => {
    await browser.emulate('colorScheme', 'dark');
    await browser.url('/__gneauxghts_e2e_reset');
    await browser.execute(() => {
      localStorage.clear();
      localStorage.setItem('gneauxghts.theme-preference', 'light');
    });
    await browser.url('/settings');
    const favicon = () => $('link[rel="icon"]');
    await expect($('input[name="logo-preference"][value="auto"]')).toBeChecked();
    await expect($('html')).toHaveAttribute('data-theme', 'light');
    await expect(favicon()).toHaveAttribute('href', expect.stringContaining('/logo-dark.svg'));
    await browser.emulate('colorScheme', 'light');
    await expect(favicon()).toHaveAttribute('href', expect.stringContaining('/logo-light.svg'));
    await browser.emulate('colorScheme', 'dark');
    await expect(favicon()).toHaveAttribute('href', expect.stringContaining('/logo-dark.svg'));

    await $('[data-settings-anchor="app-logo"] label[title="Always use the light logo."]').click();
    await expect(favicon()).toHaveAttribute('href', expect.stringContaining('/logo-light.svg'));
    await browser.refresh();
    await expect($('input[name="logo-preference"][value="light"]')).toBeChecked();
    await expect(favicon()).toHaveAttribute('href', expect.stringContaining('/logo-light.svg'));
    await $('[data-settings-anchor="app-logo"] label[title="Always use the dark logo."]').click();
    await expect(favicon()).toHaveAttribute('href', expect.stringContaining('/logo-dark.svg'));
    await browser.setViewport({ width: 390, height: 844, devicePixelRatio: 1 });
    await expect($('[data-settings-anchor="app-logo"]')).toBeDisplayed();
    await $('[data-settings-anchor="app-logo"] label[title="Follow your system appearance."]').click();
    await browser.emulate('colorScheme', 'light');
    await expect(favicon()).toHaveAttribute('href', expect.stringContaining('/logo-light.svg'));
    expect(await browser.execute(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
