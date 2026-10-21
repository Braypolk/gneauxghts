import { browser, expect, $ } from '@wdio/globals';

// Native WebKit rendering/lifecycle checks. This suite never requests OS focus
// and does not claim foreground paint or native selection painting coverage.
describe('visible Markdown in native WebKit', () => {
  before(async () => {
    await $('[data-testid="note-editor"][aria-busy="false"]').waitForExist({ timeout: 30_000 });
    await browser.setTimeout({ script: 120_000 });
  });
  for (const name of ['fence-scroll', 'nested-quote-scroll', 'conceal-and-atomic', 'split-panes', 'syntax-changing-edits', 'parser-publication']) {
    it(name, async function () {
      this.timeout(150_000);
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
  it('keeps the actual app remount formatted and stable with delayed idle parsing', async () => {
    const result = await browser.execute(() => new Promise<any>((done, reject) => {
      void (async () => {
        try {
          const path = '/src/lib/e2e/markdownFullAppHarness.ts';
          const harness = await import(/* @vite-ignore */ path);
          done(await harness.verifyFullAppRemount());
        }
        catch (error) {
          done({ error: `${String(error)}\n${(error as Error).stack}` });
        }
      })().catch(reject);
    }));
    expect(result.error).toBeUndefined();
    expect(result.frames).toBeGreaterThan(0);
  });
});
