import { browser, $, expect } from '@wdio/globals';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import type { EditorView as CmView } from '@codemirror/view';

// Generated lossless raster fixtures: no network, user files or decoder shortcuts.
function png(width: number, height: number, seed: number) {
  const crc = (bytes: Buffer) => {
    let value = 0xffffffff;
    for (const byte of bytes) {
      value ^= byte;
      for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
    }
    return (value ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const length = Buffer.alloc(4), checksum = Buffer.alloc(4);
    length.writeUInt32BE(data.length); checksum.writeUInt32BE(crc(body));
    return Buffer.concat([length, body, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const pixels = Buffer.alloc((width * 3 + 1) * height);
  for (let row = 0; row < height; row++) for (let x = 1; x <= width * 3; x++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    pixels[row * (width * 3 + 1) + x] = seed >>> 24;
  }
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels, { level: 0 })), chunk('IEND', Buffer.alloc(0))]);
}

describe('native image delivery', () => {
  const rows: unknown[] = [];
  before(async () => {
    if (process.env.IMAGE_LOADING_OUTPUT && process.env.GNEAUXGHTS_E2E_FOREGROUND !== '1') {
      throw new Error('Performance measurements require explicitly authorized foreground presentation');
    }
    await $('[data-testid="note-editor"][aria-busy="false"]').waitForExist({ timeout: 30_000 });
    await browser.setTimeout({ script: 90_000 });
  });
  for (const scenario of ['large', 'many', 'large-note'] as const) it(`loads ${scenario} raster assets through production editor resources`, async function () {
    this.timeout(180_000);
    const root = process.env.GNEAUXGHTS_NATIVE_E2E_FIXTURE;
    if (!root) throw new Error('Disposable native fixture is required');
    const directory = join(root, 'documents/vault/assets');
    mkdirSync(directory, { recursive: true });
    const count = scenario === 'many' ? 16 : 1;
    const width = scenario === 'many' ? 512 : 4096;
    const height = scenario === 'many' ? 512 : 2048;
    const trials = process.env.IMAGE_LOADING_OUTPUT ? 5 : 1;
    for (let trial = 0; trial < trials; trial++) {
      // Unique names avoid warmed browser/loader entries. OS file caches remain warm.
      const names = Array.from({ length: count }, (_, i) => `delivery-${scenario}-${trial}-${i}.png`);
      const seedOffset = scenario === 'large-note' ? 10_000 : scenario === 'many' ? 1000 : 0;
      const images = names.map((_, i) => png(width, height, seedOffset + 17 + trial * count + i));
      // Distinct pixels also keep baseline data URLs unique, avoiding decoded-cache bias.
      names.forEach((name, i) => writeFileSync(join(directory, name), images[i]));
      if (process.env.IMAGE_LOADING_OUTPUT) {
        await browser.execute(async () => {
          await window.__TAURI_INTERNALS__!.invoke('plugin:window|set_focus', { label: 'main' });
        });
        await browser.waitUntil(() => browser.execute(() => document.hasFocus()), { timeout: 10_000 });
      }
      const result = await browser.execute(async (names: string[], largeNote: boolean) => {
        const module = '/node_modules/@codemirror/view/dist/index.js';
        const { EditorView } = await import(/* @vite-ignore */ module);
        const view: CmView | null = EditorView.findFromDOM(document.querySelector('[data-testid="note-editor"] .cm-editor'));
        if (!view) throw new Error('Production editor is missing');
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'Image measurement\n\n' } });
        await new Promise(resolve => setTimeout(resolve, 200));
        let last = performance.now(), maxTimerGapMs = 0;
        const timer = setInterval(() => { const now = performance.now(); maxTimerGapMs = Math.max(maxTimerGapMs, now - last); last = now; }, 16);
        const start = performance.now();
        try {
          const tail = largeNote ? ('\n\n' + 'A large note retains ordinary paragraphs alongside its asset. '.repeat(4)).repeat(4000) : '';
          const markdown = `Image measurement\n\n${names.map(name => `![[${name}|48]]`).join(' ')}\n\nEnd${tail}`;
          view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: markdown }, selection: { anchor: 0 } });
          const dispatchMs = performance.now() - start;
          while (true) {
            const images = [...view.dom.querySelectorAll<HTMLImageElement>('.gn-image-embed img')];
            if (images.length === names.length && images.every(image => image.complete && image.naturalWidth > 0)) break;
            if (performance.now() - start > 60_000) throw new Error(`Images did not load: ${images.length}/${names.length}`);
            await new Promise(resolve => setTimeout(resolve, 10));
          }
          const loadedMs = performance.now() - start;
          await new Promise(resolve => setTimeout(resolve, 32));
          return { dispatchMs, loadedMs, maxTimerGapMs, markdownCharacters: markdown.length, focused: document.hasFocus(),
            sources: [...view.dom.querySelectorAll<HTMLImageElement>('.gn-image-embed img')].map(image => ({
              scheme: new URL(image.src).protocol, urlCharacters: image.src.length, width: image.naturalWidth, height: image.naturalHeight
            })), userAgent: navigator.userAgent, viewport: [innerWidth, innerHeight] };
        } finally { clearInterval(timer); }
      }, names, scenario === 'large-note');
      expect(result.sources).toHaveLength(count);
      expect(result.sources.every(image => process.env.IMAGE_LOADING_BASELINE === '1'
        ? image.scheme === 'data:' : image.scheme === 'asset:' || image.scheme === 'http:')).toBe(true);
      if (process.env.IMAGE_LOADING_OUTPUT) expect(result.focused).toBe(true);
      expect(result.sources.every(image => image.width === width)).toBe(true);
      rows.push({ scenario, trial, assetCount: count, assetBytes: images[0].length, ...result });
      console.log('IMAGE_DELIVERY_MEASUREMENT', JSON.stringify({ scenario, trial, loadedMs: result.loadedMs,
        maxTimerGapMs: result.maxTimerGapMs, imageSourceCharacters: result.sources.reduce((n, image) => n + image.urlCharacters, 0) }));
      if (process.env.IMAGE_LOADING_OUTPUT) writeFileSync(process.env.IMAGE_LOADING_OUTPUT, JSON.stringify({
        description: 'Native foreground macOS WebKit; real production editor and disposable vault. Five fresh-name loads per scenario, warm OS cache. Timer observations are not physical paint/input latency. PNG generation and filesystem writes are outside timing.', rows
      }, null, 2) + '\n');
    }
  });
});
