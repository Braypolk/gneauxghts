import { browser, $, expect } from '@wdio/globals';

// Exported from a real `wdio session` journey, then given stable selectors and
// a relative URL so the same regression runs with an isolated port in CI.
describe('agent verification fixture', () => {
  it('retains the chosen theme through settings navigation and a full reload', async () => {
    await browser.url('/');
    await expect($('[data-testid="note-title"]')).toHaveValue('Alpha note');
    await $('role/link[name="Settings"]').click();
    await expect($('input[aria-label="Search settings"]')).toBeDisplayed();
    await expect(browser).toHaveUrl(expect.stringContaining('/settings'));
    // The native radio is visually hidden; click its visible label.
    await $('label:has(input[name="theme-preference"][value="dark"])').click();
    await expect($('html')).toHaveAttribute('data-theme', 'dark');
    await $('role/link[name="Gneauxght"]').click();
    await expect($('[data-testid="note-title"]')).toHaveValue('Alpha note');
    await browser.refresh();
    await expect($('[data-testid="note-title"]')).toHaveValue('Alpha note');
    await expect($('html')).toHaveAttribute('data-theme', 'dark');
  });
});
