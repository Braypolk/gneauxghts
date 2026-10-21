import { browser, $ } from '@wdio/globals';
import { writeFileSync } from 'node:fs';
import { resetBrowserWorkspace } from '../../support/browserWorkspace';

describe('paragraph work placement diagnostic', () => {
  for (const panes of [1, 2]) it(`observes ${panes} panes`, async function () {
    if (!process.env.MARKDOWN_PARAGRAPH_OUTPUT) this.skip();
    this.timeout(600_000);
    await browser.setTimeout({ script: 600_000 });
    await resetBrowserWorkspace();
    if (panes === 2) {
      await browser.execute(() => document.querySelector<HTMLElement>('button[aria-label="Open split pane options"]')!.dispatchEvent(new PointerEvent('pointerenter')));
      await $('button[aria-label="Split with current location"]').waitForExist();
      await browser.execute(() => document.querySelector<HTMLElement>('button[aria-label="Split with current location"]')!.click());
      await browser.waitUntil(() => browser.execute(() => document.querySelectorAll('[data-testid="note-editor"][aria-busy="false"]').length === 2));
      await browser.waitUntil(() => browser.execute(() => !document.querySelector('[data-pane-motion]')));
    }
    const result = await browser.execute((panes: number) => new Promise<any>((done, reject) => {
      void (async () => {
        try {
          const harnessPath = '/src/lib/e2e/markdownFullAppHarness.ts';
          const harness = await import(/* @vite-ignore */ harnessPath);
          const environment = await harness.prepareFullAppMarkdown('quote', 50000, panes);
          const probePath = '/src/lib/e2e/markdownParagraphProbe.ts';
          const probe = await import(/* @vite-ignore */ probePath);
          done({ environment, ...await probe.inspectParagraphWork() });
        }
        catch (error) {
          done({ error: String(error), stack: (error as Error).stack });
        }
      })().catch(reject);
    }), panes);
    if (result.error) throw new Error(JSON.stringify(result));
    writeFileSync(`${process.env.MARKDOWN_PARAGRAPH_OUTPUT}-${panes}.json`, JSON.stringify(result, null, 2) + '\n');
  });
});
