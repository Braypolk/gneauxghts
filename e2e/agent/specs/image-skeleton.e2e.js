import { browser, $, expect } from '@wdio/globals';

// Exported from the image-skeleton agent session, then cleaned for replay.
// Hold asset admission until the skeleton and following text are measured.
describe('image loading skeleton', () => {
  it('keeps text still through authored-size and cached natural-size loads', async () => {
    await browser.url('/');
    await expect($('[data-testid="note-title"]')).toHaveValue('Alpha note');
    await browser.execute(() => {
      const url = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect width="400" height="200" fill="#a4bfe8"/></svg>');
      let release;
      const pending = new Promise(resolve => { release = resolve; });
      window.__imageSkeleton = { url, release: () => { window.__GNEAUXGHTS_E2E_COMMANDS__.read_image_asset_fingerprint = () => url; release(url); } };
      Object.assign(window.__GNEAUXGHTS_E2E_COMMANDS__, {
        read_image_asset_fingerprint: () => pending,
        resolve_image_asset_url: () => url
      });
      const content = document.querySelector('[data-testid="note-editor"] .cm-content');
      content.focus();
      const bridge = window.__GNEAUXGHTS_NATIVE_E2E__;
      bridge.setEditorSelection(0, bridge.readEditorState().editor.markdown.length);
      const data = new DataTransfer(); data.setData('text/plain', 'Before\n\n![Landscape|240x120](shape.svg)\n\nAfter');
      content.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    });
    await expect($('.gn-image-embed')).toHaveAttribute('data-loading', 'true');
    await expect($('.gn-image-embed')).toHaveAttribute('aria-busy', 'true');
    await browser.execute(() => {
     const box = document.querySelector('.gn-image-embed').getBoundingClientRect();
     const below = [...document.querySelectorAll('.cm-line')].find(line => line.textContent === 'After');
     window.__imageSkeleton.before = { width: box.width, height: box.height, after: below.getBoundingClientRect().top };
    });
    const skeleton = await browser.execute(() => {
      const frame = document.querySelector('.gn-image-embed');
      const box = frame.getBoundingClientRect();
      return { width: box.width, height: box.height, background: getComputedStyle(frame, '::before').backgroundColor };
    });
    expect(skeleton.width).toBe(240);
    expect(skeleton.height).toBe(120);
    expect(skeleton.background).not.toBe('rgba(0, 0, 0, 0)');

    {
        await browser.execute(() => window.__imageSkeleton.release());
        await expect($('.gn-image-embed')).toHaveAttribute('data-loading', 'false');
        await expect($('.gn-image-embed')).toHaveAttribute('aria-busy', 'false');
        await expect($('.gn-image-embed img')).toBeDisplayed();
        const layout = await browser.execute(() => {
         const box = document.querySelector('.gn-image-embed').getBoundingClientRect();
         const below = [...document.querySelectorAll('.cm-line')].find(line => line.textContent === 'After');
         return { before: window.__imageSkeleton.before, width: box.width, height: box.height, after: below.getBoundingClientRect().top };
        });
        expect(layout.width).toBe(layout.before.width);
        expect(layout.height).toBe(layout.before.height);
        expect(layout.after).toBe(layout.before.after);
    }
    await browser.execute(async () => {
     const replace = markdown => {
      const content = document.querySelector('[data-testid="note-editor"] .cm-content');
      content.focus();
      const bridge = window.__GNEAUXGHTS_NATIVE_E2E__;
      bridge.setEditorSelection(0, bridge.readEditorState().editor.markdown.length);
      const data = new DataTransfer(); data.setData('text/plain', markdown);
      content.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
     };
     replace('Before\n\nAfter');
     await new Promise(resolve => setTimeout(resolve, 25));
     const url = window.__imageSkeleton.url;
     let release;
     const pending = new Promise(resolve => { release = resolve; });
     window.__GNEAUXGHTS_E2E_COMMANDS__.read_image_asset_fingerprint = () => pending;
     window.__imageSkeleton.release = () => { window.__GNEAUXGHTS_E2E_COMMANDS__.read_image_asset_fingerprint = () => url; release(url); };
     replace('Before\n\n![[shape.svg]]\n\nAfter');
    });
    await expect($('.gn-image-embed')).toHaveAttribute('data-loading', 'true');
    await browser.waitUntil(async () => browser.execute(() => {
     const box = document.querySelector('.gn-image-embed').getBoundingClientRect();
     return box.width === 400 && box.height === 200;
    }));
    await browser.execute(() => {
     const box = document.querySelector('.gn-image-embed').getBoundingClientRect();
     const below = [...document.querySelectorAll('.cm-line')].find(line => line.textContent === 'After');
     window.__imageSkeleton.before = { width: box.width, height: box.height, after: below.getBoundingClientRect().top };
    });
    {
        await browser.execute(() => window.__imageSkeleton.release());
        await expect($('.gn-image-embed')).toHaveAttribute('data-loading', 'false');
        await expect($('.gn-image-embed')).toHaveAttribute('aria-busy', 'false');
        await expect($('.gn-image-embed img')).toBeDisplayed();
        const layout = await browser.execute(() => {
         const box = document.querySelector('.gn-image-embed').getBoundingClientRect();
         const below = [...document.querySelectorAll('.cm-line')].find(line => line.textContent === 'After');
         return { before: window.__imageSkeleton.before, width: box.width, height: box.height, after: below.getBoundingClientRect().top };
        });
        expect(layout.width).toBe(layout.before.width);
        expect(layout.height).toBe(layout.before.height);
        expect(layout.after).toBe(layout.before.after);
    }
  });
});
