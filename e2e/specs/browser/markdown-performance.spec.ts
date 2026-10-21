import { browser } from '@wdio/globals';
import { writeFileSync } from 'node:fs';
import { markdownBenchmarkKinds, markdownBenchmarkSizes } from '../../../src/lib/features/notepad/markdown/markdownBenchmarkFixtures';

describe('mounted Markdown measurements', () => {
  const rows: unknown[] = [];
  for (const lines of markdownBenchmarkSizes) for (const kind of markdownBenchmarkKinds) for (const panes of [1, 2]) {
    it(`records ${kind} ${lines} lines, ${panes} panes`, async function () {
      if (!process.env.MARKDOWN_MOUNTED_BENCHMARK_OUTPUT) this.skip();
      this.timeout(600_000);
      await browser.setTimeout({ script: 600_000 });
      await browser.url('/__gneauxghts_e2e_reset');
      const loaded = await browser.execute(() => new Promise<string>((done) => {
        const path = '/src/lib/e2e/markdownFormattingHarness.ts';
        const deadline = setTimeout(() => done('import timed out'), 15000);
        import(/* @vite-ignore */ path).then(module => { clearTimeout(deadline); done(Object.keys(module).join(',')); }, error => { clearTimeout(deadline); done(String(error)); });
      }));
      if (!loaded.split(',').includes('measureMountedMarkdown')) throw new Error(loaded);
      const result = await browser.execute((filter: {
        lines: number;
        kind: string;
        panes: number;
      }) => new Promise<{
        rows?: unknown[];
        error?: string;
      }>((done, reject) => {
        void (async () => {
          try {
            const path = '/src/lib/e2e/markdownFormattingHarness.ts';
            const harness = await import(/* @vite-ignore */ path);
            done(await harness.measureMountedMarkdown(filter));
          }
          catch (error) {
            done({ error: `${String(error)}\n${(error as Error).stack}` });
          }
        })().catch(reject);
      }), { lines, kind, panes });
      if (result && typeof result === 'object' && 'error' in result) throw new Error(JSON.stringify(result));
      rows.push(...result.rows!);
      writeFileSync(process.env.MARKDOWN_MOUNTED_BENCHMARK_OUTPUT!, JSON.stringify({ ...result, rows }, null, 2) + '\n');
    });
  }
});
