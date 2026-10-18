const { build } = require('esbuild');
const { chromium } = require('playwright-core');
const http = require('node:http');
const fs = require('node:fs');
(async () => {
  const bundle = await build({ entryPoints: [__dirname + '/probe.js'], bundle: true, platform: 'browser', format: 'iife', write: false });
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', req.url === '/probe.js' ? 'text/javascript' : 'text/html');
    res.end(req.url === '/probe.js' ? bundle.outputFiles[0].contents : '<script src="/probe.js"></script>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/Users/bray.polkinghorne/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing', headless: true });
    const page = await browser.newPage();
    page.on('pageerror', e => console.error('pageerror:', e.message));
    await page.goto('http://127.0.0.1:' + server.address().port + (process.argv.includes('--static') ? '?static' : ''));
    await page.waitForFunction(() => window.probe);
    const paused = await page.evaluate(() => probe.start('approve'));
    await page.reload();
    const restored = await page.evaluate(() => probe.state('approve'));
    const approved = await page.evaluate(() => probe.resume('approve', true));
    await page.evaluate(() => probe.start('reject'));
    await page.reload();
    const rejected = await page.evaluate(() => probe.resume('reject', false));
    const effects = await page.evaluate(() => Number(localStorage.getItem('effects')));
    const result = { package: '@langchain/langgraph@1.5.0', browserBundleBytes: bundle.outputFiles[0].contents.length,
      mode: process.argv.includes('--static') ? 'static breakpoint + state update' : 'dynamic interrupt()',
      paused: paused.__interrupt__?.[0]?.value ?? paused.draft, restoredInterrupt: restored.tasks?.[0]?.interrupts?.[0]?.value ?? restored.next,
      approved, rejected, effects, limits: 'Chromium + toy localStorage saver, no model/network/native storage or iOS test' };
    console.log(JSON.stringify(result, null, 2));
    if (!result.paused || !result.restoredInterrupt || approved.receipt !== 'human edited draft' || rejected.receipt !== 'rejected' || effects !== 1) throw new Error('Acceptance failed');
  } finally { await browser?.close(); server.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
