import { browser, $, $$, expect } from '@wdio/globals';

// Recorded in the WDIO session, grouped into independent cases for fresh replay.
describe('exact shortcut modifiers', () => {
  for (const gesture of ['click', 'Enter']) {
    for (let mask = 0; mask < 16; mask++) {
      it(`matches only assigned search split modifiers on ${gesture}, mask ${mask}`, async () => {
        await browser.setWindowSize(1440, 1000);
        await browser.url('/__gneauxghts_e2e_reset');
        await browser.execute(() => { localStorage.clear(); sessionStorage.clear(); });
        await browser.url('/');
        await $('[data-testid="note-title"]').waitForDisplayed({ timeout: 30_000 });
        await expect($('[data-testid="note-title"]')).toHaveValue('Alpha note');
        await $('[data-testid="note-search-input"]').setValue('Beta');
        await $('button[aria-label="Open search result: beta.md"]').waitForDisplayed();
        const modifiers = { metaKey: !!(mask & 1), ctrlKey: !!(mask & 2), altKey: !!(mask & 4), shiftKey: !!(mask & 8) };
        await browser.execute((gesture, modifiers) => {
          const target = document.querySelector(gesture === 'click'
            ? 'button[aria-label="Open search result: beta.md"]' : '[data-testid="note-search-input"]');
          target.focus();
          target.dispatchEvent(gesture === 'click'
            ? new MouseEvent('click', { button: 0, bubbles: true, cancelable: true, ...modifiers })
            : new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true, ...modifiers }));
        }, gesture, modifiers);
        const split = mask === 4 || mask === 9;
        await expect($$('[data-testid="workspace-pane"]')).toBeElementsArrayOfSize(split ? 2 : 1);
        await expect($('[data-testid="workspace-pane"]:last-child [data-testid="note-title"]')).toHaveValue('Beta note');
        if (split) await expect($('[data-testid="workspace-pane"]:first-child [data-testid="note-title"]')).toHaveValue('Alpha note');
      });
    }
  }

  it('requires exact external-link modifiers and preserves unmodified touch actions', async () => {
    await browser.setWindowSize(1440, 1000);
    await browser.url('/__gneauxghts_e2e_reset');
    await browser.execute(() => { localStorage.clear(); sessionStorage.clear(); });
    await browser.url('/');
    await expect($('[data-testid="note-title"]')).toHaveValue('Alpha note');
    const markdown = '[Example](https://example.com)\n\nAfter';
    await browser.execute(markdown => {
      const content = document.querySelector('[data-testid="note-editor"] .cm-content');
      content.focus();
      const bridge = window.__GNEAUXGHTS_NATIVE_E2E__;
      bridge.setEditorSelection(0, bridge.readEditorState().editor.markdown.length);
      const clipboardData = new DataTransfer(); clipboardData.setData('text/plain', markdown);
      content.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
      bridge.setEditorSelection(markdown.length, markdown.length);
    }, markdown);
    await $('.cm-gn-link-styled').waitForDisplayed();
    // Intercept only the external opener so this regression never launches a URL.
    await browser.execute(() => {
      window.__exactModifierOpenedUrls = [];
      window.__exactModifierOriginalInvoke = window.__TAURI_INTERNALS__.invoke;
      window.__TAURI_INTERNALS__.invoke = (command, args) => {
        if (command === 'plugin:opener|open_url') {
          window.__exactModifierOpenedUrls.push(args.url);
          return Promise.resolve();
        }
        return window.__exactModifierOriginalInvoke(command, args);
      };
    });
    try {
      let opens = 0;
      for (let mask = 0; mask < 16; mask++) {
        await browser.execute(length => window.__GNEAUXGHTS_NATIVE_E2E__.setEditorSelection(length, length), markdown.length);
        await $('.cm-gn-link-styled').waitForDisplayed();
        const urls = await browser.execute(mask => {
          document.querySelector('.cm-gn-link-styled').dispatchEvent(new MouseEvent('click', {
            button: 0, bubbles: true, cancelable: true,
            metaKey: !!(mask & 1), ctrlKey: !!(mask & 2), altKey: !!(mask & 4), shiftKey: !!(mask & 8)
          }));
          return window.__exactModifierOpenedUrls;
        }, mask);
        if (mask === 1 || mask === 2) opens++;
        expect(urls).toEqual(Array(opens).fill('https://example.com'));
      }
      for (const pointerType of ['touch', 'pen']) {
        await browser.execute(length => window.__GNEAUXGHTS_NATIVE_E2E__.setEditorSelection(length, length), markdown.length);
        await $('.cm-gn-link-styled').waitForDisplayed();
        await browser.execute(pointerType => document.querySelector('.cm-gn-link-styled').dispatchEvent(new PointerEvent('click', {
          pointerType, button: 0, altKey: true, bubbles: true, cancelable: true
        })), pointerType);
        await expect($('[aria-label="External link actions"]')).not.toExist();
      }
      await browser.execute(length => window.__GNEAUXGHTS_NATIVE_E2E__.setEditorSelection(length, length), markdown.length);
      await $('.cm-gn-link-styled').waitForDisplayed();
      await browser.execute(() => document.querySelector('.cm-gn-link-styled').dispatchEvent(new PointerEvent('click', {
        pointerType: 'touch', button: 0, bubbles: true, cancelable: true
      })));
      await expect($('button=Open link')).toBeDisplayed();
      await expect($('button=Edit link')).toBeDisplayed();
      await browser.keys('Escape');
    } finally {
      await browser.execute(() => {
        window.__TAURI_INTERNALS__.invoke = window.__exactModifierOriginalInvoke;
        delete window.__exactModifierOriginalInvoke;
        delete window.__exactModifierOpenedUrls;
      });
    }
  });
});
