import { browser, $, expect } from '@wdio/globals';
import { writeFileSync } from 'node:fs';

// Opt-in native A/B/A experiment in the authorized foreground lane.
describe('native synchronous paragraph parsing', function () {
  const rows: unknown[] = [];
  before(async function () {
    if (!process.env.MARKDOWN_SYNCHRONOUS_NATIVE_OUTPUT) this.skip();
    await $('[data-testid="note-editor"][aria-busy="false"]').waitForExist({ timeout: 30_000 });
    await browser.setTimeout({ script: 600_000 });
    const result = await browser.executeAsync(async (done: (value: any) => void) => {
      try {
        await window.__TAURI_INTERNALS__!.invoke('plugin:window|show', { label: 'main' });
        await window.__TAURI_INTERNALS__!.invoke('plugin:window|set_focus', { label: 'main' });
        const path = '/src/lib/e2e/markdownSynchronousParagraphHarness.ts';
        const h = await import(/* @vite-ignore */ path);
        done(await h.verifySynchronousParagraph());
      } catch (error) { done({ measurementFailure: `${String(error)}\n${(error as Error).stack}` }); }
    });
    expect(result.measurementFailure).toBeUndefined();
    rows.push({ correctness: result });
    writeFileSync(process.env.MARKDOWN_SYNCHRONOUS_NATIVE_OUTPUT!, JSON.stringify(rows, null, 2));
  });
  afterEach(function () {
    // Focus rejection happens after the async work finishes. Other failures
    // may leave pending work; stop this app invocation before another case.
    if (this.currentTest?.err && !String(this.currentTest.err).includes('Native measurement lost focus')) this.currentTest.parent!.bail(true);
  });
  for (const panes of [1, 2]) for (const [round, enabled] of [false, true, false].entries()) for (const stage of ['giant', 'rapid200', 'rapid80'] as const) {
    it(`round ${round} measures ${enabled ? 'ASCII guard' : 'baseline'} in ${panes} panes ${stage}`, async function () {
      this.timeout(600_000);
      if (panes === 2 && await browser.execute(() => document.querySelectorAll('[data-testid="note-editor"] .cm-editor').length) === 1) {
        await browser.execute(() => document.querySelector<HTMLElement>('button[aria-label="Open split pane options"]')!.dispatchEvent(new PointerEvent('pointerenter')));
        await $('button[aria-label="Split with current location"]').waitForExist();
        await browser.execute(() => document.querySelector<HTMLElement>('button[aria-label="Split with current location"]')!.click());
        await browser.waitUntil(() => browser.execute(() => document.querySelectorAll('[data-testid="note-editor"][aria-busy="false"]').length === 2));
        await browser.waitUntil(() => browser.execute(() => !document.querySelector('[data-pane-motion]')));
      }
      const result = await browser.executeAsync(async (enabled: boolean, panes: number, stage: 'giant' | 'rapid200' | 'rapid80', done: (value: any) => void) => {
        try {
          const path = '/src/lib/e2e/markdownSynchronousParagraphHarness.ts';
          const h = await import(/* @vite-ignore */ path);
          done(await h.measureSynchronousParagraph(enabled, panes, true, stage));
        } catch (error) { done({ measurementFailure: `${String(error)}\n${(error as Error).stack}` }); }
      }, enabled, panes, stage);
      expect(result.measurementFailure).toBeUndefined();
      expect(result.verified).toEqual({ panes, quoteMarkers: 100_000, strongEmphasis: 50_000 });
      rows.push(result);
      writeFileSync(process.env.MARKDOWN_SYNCHRONOUS_NATIVE_OUTPUT!, JSON.stringify(rows, null, 2));
    });
  }
});
