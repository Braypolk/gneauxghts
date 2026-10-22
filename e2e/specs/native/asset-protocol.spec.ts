import { browser, $, expect } from '@wdio/globals';
import { mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { EditorView as CmView } from '@codemirror/view';

const svg = (width: number) => `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="24"><rect width="100%" height="100%" fill="blue"/></svg>`;

async function resolve(fileName: string) {
  return browser.execute((fileName) => window.__TAURI_INTERNALS__!.invoke<string>('resolve_image_asset_url', { fileName }), fileName);
}

async function imageWidth(url: string) {
  return browser.execute((url) => new Promise<number>((done) => {
    const image = new Image();
    image.onload = () => done(image.naturalWidth);
    image.onerror = () => done(0);
    image.src = url;
  }), url);
}

async function renderAsset(name: string) {
  return browser.execute(async (name: string) => {
    const module = '/node_modules/@codemirror/view/dist/index.js';
    const { EditorView } = await import(/* @vite-ignore */ module);
    const view: CmView | null = EditorView.findFromDOM(document.querySelector('[data-testid="note-editor"] .cm-editor'));
    if (!view) throw new Error('Production editor is missing');
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: '' } });
    // Let the old pane-local widget release its image before remounting.
    await new Promise(resolve => setTimeout(resolve, 25));
    view.dispatch({ changes: { from: 0, insert: `Asset refresh\n\n![[${name}]]\n` }, selection: { anchor: 0 } });
    const deadline = performance.now() + 20_000;
    while (performance.now() < deadline) {
      const image = view.dom.querySelector<HTMLImageElement>('.gn-image-embed img');
      if (image?.complete && image.naturalWidth) return { src: image.src, width: image.naturalWidth };
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error('Editor asset did not load');
  }, name);
}

describe('native asset protocol scope and refresh', () => {
  let assets: string;
  before(async () => {
    await $('[data-testid="note-editor"][aria-busy="false"]').waitForExist({ timeout: 30_000 });
    const root = process.env.GNEAUXGHTS_NATIVE_E2E_FIXTURE;
    if (!root) throw new Error('Disposable native fixture is required');
    assets = join(root, 'documents/vault/assets');
    mkdirSync(join(assets, 'photos'), { recursive: true });
  });

  it('loads encoded contained filenames, denies unadmitted files and versions replacements', async () => {
    const name = 'photos/été #100%.svg';
    writeFileSync(join(assets, name), svg(101));
    writeFileSync(join(assets, 'unadmitted.svg'), svg(102));
    const first = await resolve(name);
    expect(first.startsWith('asset:') || first.startsWith('http://asset.localhost/')).toBe(true);
    expect(await imageWidth(first)).toBe(101);
    const forbidden = await browser.execute(async (path: string) => {
      const module = '/node_modules/@tauri-apps/api/core.js';
      const { convertFileSrc } = await import(/* @vite-ignore */ module);
      return convertFileSrc(path);
    }, join(assets, 'unadmitted.svg'));
    expect(await imageWidth(forbidden)).toBe(0);
    expect(await imageWidth(await resolve('unadmitted.svg'))).toBe(102);
    writeFileSync(join(assets, name), svg(1003));
    const replacement = await resolve(name);
    expect(replacement).not.toBe(first);
    expect(await imageWidth(replacement)).toBe(1003);
  });

  it('rejects traversal, absolute paths, missing assets and symlink escapes', async () => {
    const outside = join(assets, '../../outside.svg');
    writeFileSync(outside, svg(103));
    symlinkSync(outside, join(assets, 'escape.svg'));
    for (const name of ['../outside.svg', outside, 'photos\\outside.svg', 'absent.svg', 'escape.svg']) {
      const denied = await browser.execute(async (fileName: string) => {
        try { await window.__TAURI_INTERNALS__!.invoke('resolve_image_asset_url', { fileName }); return false; }
        catch { return true; }
      }, name);
      expect(denied).toBe(true);
    }
  });

  it('invalidates the document URL cache when a mounted asset is replaced', async () => {
    writeFileSync(join(assets, 'refresh.svg'), svg(104));
    const first = await renderAsset('refresh.svg');
    expect(first.width).toBe(104);
    writeFileSync(join(assets, 'refresh.svg'), svg(205));
    const next = await renderAsset('refresh.svg');
    expect(next.src).not.toBe(first.src);
    expect(next.width).toBe(205);
  });
});
