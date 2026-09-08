import { browser, $, expect } from '@wdio/globals';

describe('Note Timeline release rendering', () => {
  it('measures a 1 MiB diff through History Mode and a browser paint', async () => {
    await browser.url('/');
    await $('[data-testid="note-title"]').waitForDisplayed({ timeout: 30_000 });
    await $('span=Loading editor').waitForExist({ reverse: true });
    await browser.execute(() => window.__GNEAUXGHTS_E2E__?.seedLargeHistory());
    const elapsed = await browser.executeAsync((done: (value: number) => void) => {
      const started = performance.now();
      const observer = new MutationObserver(() => {
        if (!document.querySelector('[data-testid="historical-revision-diff"] [data-diff-kind]')) return;
        observer.disconnect();
        requestAnimationFrame(() => requestAnimationFrame(() => done(performance.now() - started)));
      });
      observer.observe(document.body, { subtree: true, childList: true });
      document.querySelector<HTMLButtonElement>('button[aria-label="Open note history"]')!.click();
    });
    console.log('RELEASE_RENDER_METRIC', JSON.stringify({
      name: 'history_entry_1mb_diff_to_paint', elapsed_ms: elapsed, budget_ms: 250,
      backend: 'deterministic fixture; excludes Rust and IPC transport'
    }));
    expect(await $('[data-testid="historical-revision-diff"]').isDisplayed()).toBe(true);
    expect(elapsed).toBeLessThan(250);
    await $('button=Show all unchanged lines').click();
    await browser.waitUntil(async () => browser.execute(() =>
      document.querySelectorAll('[data-testid="historical-revision-diff"] [data-diff-kind]').length === 16_384
    ));
    await $('button[aria-label="Compare selected revision with current note"]').click();
    await $('button=Show all unchanged lines').waitForDisplayed();
    expect(await browser.execute(() =>
      document.querySelectorAll('[data-testid="historical-revision-diff"] [data-diff-kind]').length
    )).toBe(7);
  });
});
