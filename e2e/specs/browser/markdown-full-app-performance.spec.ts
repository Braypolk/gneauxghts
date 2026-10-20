import { browser, $ } from '@wdio/globals';
import { writeFileSync } from 'node:fs';
import { resetBrowserWorkspace } from '../../support/browserWorkspace';
import { markdownBenchmarkKinds, markdownBenchmarkSizes } from '../../../src/lib/features/notepad/markdown/markdownBenchmarkFixtures';

describe('full-app Markdown measurements', () => {
  const rows: unknown[] = [];
  for (const lines of markdownBenchmarkSizes) for (const kind of markdownBenchmarkKinds) for (const panes of [1, 2]) {
    it(`records ${kind} ${lines} lines, ${panes} panes`, async function () {
      if (!process.env.MARKDOWN_FULL_APP_OUTPUT) this.skip();
      this.timeout(600_000);
      await browser.setTimeout({ script: 600_000 });
      await resetBrowserWorkspace();
      if (panes === 2) {
        await browser.execute(() => {
          document.querySelector<HTMLElement>('button[aria-label="Open split pane options"]')!.dispatchEvent(new PointerEvent('pointerenter'));
        });
        await $('button[aria-label="Split with current location"]').waitForExist();
        await browser.execute(() => document.querySelector<HTMLElement>('button[aria-label="Split with current location"]')!.click());
        await browser.waitUntil(() => browser.execute(() => document.querySelectorAll('[data-testid="note-editor"][aria-busy="false"]').length === 2));
        await browser.waitUntil(() => browser.execute(() => !document.querySelector('[data-pane-motion]')));
      }
      const result = await browser.executeAsync(async (fixture: { kind: typeof kind; lines: number; panes: number }, done: (result: any) => void) => {
        try {
          const path = '/src/lib/e2e/markdownFullAppHarness.ts';
          const harness = await import(/* @vite-ignore */ path);
          const environment = await harness.prepareFullAppMarkdown(fixture.kind, fixture.lines, fixture.panes);
          const measurements = [];
          for (const operation of ['selection', 'document']) measurements.push({ ...fixture, ...await harness.measureFullAppMarkdown(operation) });
          done({ environment, measurements });
        } catch (error) { done({ error: `${String(error)}\n${(error as Error).stack}` }); }
      }, { kind, lines, panes });
      if (result.error) throw new Error(result.error);
      rows.push({ environment: result.environment, ...result.measurements[0] }, { environment: result.environment, ...result.measurements[1] });
      writeFileSync(process.env.MARKDOWN_FULL_APP_OUTPUT!, JSON.stringify({ warmups: 5, samples: 20,
        description: 'Real Svelte app, production pane plugins/styling/runtime/callbacks, deterministic browser IPC; dispatch then forced layout and two RAF observations.', rows }, null, 2) + '\n');
    });
  }
});
