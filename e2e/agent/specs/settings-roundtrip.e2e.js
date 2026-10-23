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

  it('loads History diagnostics only on demand and offers retry after failure', async () => {
    await browser.url('/__gneauxghts_e2e_reset');
    await browser.execute(() => { localStorage.clear(); sessionStorage.clear(); });
    await browser.url('/');
    await expect($('[data-testid="note-title"]')).toHaveValue('Alpha note');
    await browser.execute(() => {
      window.__historyCheckCount = 0;
      window.__GNEAUXGHTS_E2E_COMMANDS__.get_history_health = () => {
        window.__historyCheckCount++;
        return new Promise((_resolve, reject) => { window.__rejectHistoryCheck = reject; });
      };
    });
    try {
      await $('role/link[name="Settings"]').click();
      await expect($('input[aria-label="Search settings"]')).toBeDisplayed();
      expect(await browser.execute(() => window.__historyCheckCount)).toBe(0);
      await $('[data-settings-section="history"]').click();
      await expect($('p=Loading history health…')).toBeDisplayed();
      expect(await browser.execute(() => window.__historyCheckCount)).toBe(1);
      await browser.execute(() => window.__rejectHistoryCheck(new Error('History check temporarily offline')));
      await expect($('p=History health is unavailable.')).toBeDisplayed();
      await expect($('[role="alert"]')).toHaveText('History is unavailable right now.');
      await browser.execute(() => { delete window.__GNEAUXGHTS_E2E_COMMANDS__.get_history_health; });
      await $('button=Retry history check').click();
      await expect($('p=History is healthy')).toBeDisplayed();
      await expect($('[role="alert"]')).not.toExist();
    } finally {
      await browser.execute(() => {
        delete window.__GNEAUXGHTS_E2E_COMMANDS__.get_history_health;
        delete window.__historyCheckCount;
        delete window.__rejectHistoryCheck;
      });
    }
  });
});
