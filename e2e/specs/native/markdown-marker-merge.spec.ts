import { browser, expect, $ } from '@wdio/globals';
import { writeFileSync } from 'node:fs';

// Real WebKit and production app panes, with native temporary-vault persistence.
// Requires explicit foreground opt-in: timings include real animation frames.
describe('giant quote marker merge in native WebKit', () => {
  const rows: unknown[] = [];
  before(async () => {
    await $('[data-testid="note-editor"][aria-busy="false"]').waitForExist({ timeout: 30_000 });
    await browser.setTimeout({ script: 180_000 });
    const error = await browser.executeAsync((done: (error: string | null) => void) => {
      const invoke = window.__TAURI_INTERNALS__!.invoke;
      invoke('plugin:window|show', { label: 'main' })
        .then(() => invoke('plugin:window|set_focus', { label: 'main' }))
        .then(() => done(null), error => done(String(error)));
    });
    expect(error).toBeNull();
    await browser.waitUntil(() => browser.execute(() => document.hasFocus() && document.visibilityState === 'visible'), {
      timeout: 5_000, timeoutMsg: 'Native quote measurements require a visible, focused test window'
    });
  });
  for (const panes of [1, 2]) it(`edits and formats 50000 quote lines in ${panes} panes`, async function () {
    this.timeout(180_000);
    if (panes === 2) {
      await browser.execute(() => document.querySelector<HTMLElement>('button[aria-label="Open split pane options"]')!.dispatchEvent(new PointerEvent('pointerenter')));
      await $('button[aria-label="Split with current location"]').waitForExist();
      await browser.execute(() => document.querySelector<HTMLElement>('button[aria-label="Split with current location"]')!.click());
      await browser.waitUntil(() => browser.execute(() => document.querySelectorAll('[data-testid="note-editor"][aria-busy="false"]').length === 2));
      await browser.waitUntil(() => browser.execute(() => !document.querySelector('[data-pane-motion]')));
    }
    const result = await browser.executeAsync(async (panes: number, done: (result: any) => void) => {
      try {
        const path = '/src/lib/e2e/markdownFullAppHarness.ts';
        const harness = await import(/* @vite-ignore */ path);
        const environment = await harness.prepareFullAppMarkdown('quote', 50_000, panes);
        if (!document.hasFocus() || document.visibilityState !== 'visible') throw new Error('Native quote measurement lost focus');
        const measurements = await harness.measureFullAppMarkdown('document', 15);
        if (!document.hasFocus() || document.visibilityState !== 'visible') throw new Error('Native quote measurement lost focus');
        const verified = await harness.verifyFullAppGiantQuote(50_000);
        done({ environment, measurements, verified });
      } catch (error) { done({ error: `${String(error)}\n${(error as Error).stack}` }); }
    }, panes);
    expect(result.error).toBeUndefined();
    expect(result.verified).toEqual({ panes, quoteMarkers: 100_000, strongEmphasis: 50_000 });
    rows.push({ panes, ...result });
    if (process.env.MARKDOWN_NATIVE_OUTPUT) writeFileSync(process.env.MARKDOWN_NATIVE_OUTPUT, JSON.stringify({
      description: 'Native macOS WebKit, visible and focused; production app, temporary vault, five warmups and ten recorded edits; no latency threshold.',
      rows
    }, null, 2) + '\n');
  });
});
