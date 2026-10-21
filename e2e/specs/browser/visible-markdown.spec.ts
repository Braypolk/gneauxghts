import { browser, expect } from '@wdio/globals';

describe('visible Markdown in mounted editors', () => {
  for (const name of ['fence-scroll', 'nested-quote-scroll', 'conceal-and-atomic', 'split-panes', 'syntax-changing-edits', 'parser-publication']) {
    it(name, async () => {
      await browser.setTimeout({ script: 120_000 });
      await browser.url('/__gneauxghts_e2e_reset');
      const result = await browser.execute((name: string) => new Promise<string | null>((done, reject) => {
        void (async () => {
          try {
            const path = '/src/lib/e2e/markdownFormattingHarness.ts';
            const harness = await import(/* @vite-ignore */ path);
            await harness.verifyMarkdownCase(name);
            done(null);
          }
          catch (error) {
            done(`${String(error)}\n${(error as Error).stack}`);
          }
        })().catch(reject);
      }), name);
      expect(result).toBeNull();
    });
  }
});
