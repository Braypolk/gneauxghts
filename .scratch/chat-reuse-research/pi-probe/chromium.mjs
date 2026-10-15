import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const built = await build({
  absWorkingDir: fileURLToPath(new URL('.', import.meta.url)),
  entryPoints: ['entry.mjs'],
  platform: 'browser',
  format: 'iife',
  globalName: 'Pi',
  bundle: true,
  write: false,
});
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
  headless: true,
});
try {
  const page = await browser.newPage();
  await page.addScriptTag({ content: built.outputFiles[0].text });
  const result = await page.evaluate(async () => {
    const {
      Harness, MemoryStorage, createRegistry, createModels,
      fauxProvider, fauxAssistantMessage, BACKGROUND_CONTEXT: context,
    } = Pi;
    const faux = fauxProvider();
    const models = createModels();
    models.setProvider(faux.provider);
    faux.setResponses([fauxAssistantMessage('Browser answer.')]);
    const harness = await Harness.open(new MemoryStorage(), {
      models, registry: createRegistry(),
    }, context);
    try {
      const root = await harness.root(context, {
        agent: { model: { provider: 'faux', modelId: 'faux-1' } },
      });
      const outcome = await (await root.submit({
        type: 'input', content: 'test browser',
      }, context)).wait(context);
      const entries = await root.entries({}, 10, undefined, context);
      return {
        userAgent: navigator.userAgent,
        status: outcome.status,
        kinds: entries.items.map(entry => entry.kind),
        process: typeof process,
        Buffer: typeof Buffer,
        withResolvers: typeof Promise.withResolvers,
        structuredClone: typeof structuredClone,
      };
    } finally {
      await harness.close(context);
    }
  });
  assert.equal(result.status, 'done');
  assert.equal(result.process, 'undefined');
  assert.equal(result.Buffer, 'undefined');
  assert.ok(result.kinds.includes('pi.assistant'));
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
