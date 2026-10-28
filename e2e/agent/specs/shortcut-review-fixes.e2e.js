// Reviewed export from shortcut-review-fixes; each case starts with disposable fixture state.
import { browser, $, $$, expect } from '@wdio/globals';

describe('Keyboard shortcut review regressions', () => {
  it('keeps dock shortcuts inactive in History and the image viewer, then restores them', async () => {
    await browser.url('/__gneauxghts_e2e_reset');
    await browser.execute(() => { localStorage.clear(); sessionStorage.clear(); });
    await browser.url('/');
    await $('[data-testid="note-title"]').waitForDisplayed({ timeout: 30_000 });
    await expect($('[data-testid="note-title"]')).toHaveValue('Alpha note');
    const press = async (type, key, code, modifiers = {}) => browser.execute((type, key, code, modifiers) => {
      (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent(type, { key, code, bubbles: true, cancelable: true, ...modifiers }));
    }, type, key, code, modifiers);
    const forgetCalls = () => browser.execute(() => window.__GNEAUXGHTS_E2E__.invocations.filter(call => call.command === 'forget_note').length);
    const delay = async () => browser.execute(() => new Promise(resolve => setTimeout(resolve, 700)));
    const searchLabel = await $('[data-testid="note-search-input"]').getAttribute('aria-label');
    await press('keydown', 'H', 'KeyH', { metaKey: true, shiftKey: true });
    await $('[data-testid="history-mode"]').waitForDisplayed();
    await press('keydown', 'f', 'KeyF', { metaKey: true });
    await press('keydown', 'Backspace', 'Backspace', { metaKey: true, shiftKey: true });
    await delay();
    expect(await forgetCalls()).toBe(0);
    await expect($('[data-testid="note-search-input"]')).toHaveAttribute('aria-label', searchLabel);
    await expect($('#forget-confirm-popover')).not.toExist();
    await press('keyup', 'Backspace', 'Backspace', { metaKey: true, shiftKey: true });
    await press('keydown', 'Escape', 'Escape');
    await expect($('[data-testid="history-mode"]')).not.toExist();
    await press('keydown', 'f', 'KeyF', { metaKey: true });
    await expect($('[data-testid="note-search-input"]')).toHaveAttribute('aria-label', expect.stringContaining('Searching only the current note'));
    await browser.execute(() => {
      window.__GNEAUXGHTS_E2E__.seedImageAsset('review.png');
      const content = document.querySelector('[data-testid="note-editor"] .cm-content'); content.focus();
      const bridge = window.__GNEAUXGHTS_NATIVE_E2E__;
      bridge.setEditorSelection(0, bridge.readEditorState().editor.markdown.length);
      const clipboardData = new DataTransfer(); clipboardData.setData('text/plain', 'Before\n\n![[review.png|200]]\n\nAfter');
      content.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
      bridge.setEditorSelection(0, 0);
    });
    await $('button[aria-label="Zoom image"]').click();
    await $('dialog.gn-image-viewer').waitForDisplayed();
    const labelBeforeViewerSearch = await $('[data-testid="note-search-input"]').getAttribute('aria-label');
    await press('keydown', 'F', 'KeyF', { metaKey: true, shiftKey: true });
    await press('keydown', 'Backspace', 'Backspace', { metaKey: true, shiftKey: true });
    await delay();
    expect(await forgetCalls()).toBe(0);
    await expect($('[data-testid="note-search-input"]')).toHaveAttribute('aria-label', labelBeforeViewerSearch);
    await expect($('#forget-confirm-popover')).not.toExist();
    await press('keyup', 'Backspace', 'Backspace', { metaKey: true, shiftKey: true });
    await press('keydown', 'Escape', 'Escape');
    await expect($('dialog.gn-image-viewer')).not.toExist();
    await press('keydown', 'Backspace', 'Backspace', { metaKey: true, shiftKey: true });
    await press('keyup', 'Backspace', 'Backspace', { metaKey: true, shiftKey: true });
    await expect($('#forget-confirm-popover')).toBeDisplayed();
    await $('#forget-confirm-popover').$('button=Cancel').click();
    await expect($('#forget-confirm-popover')).not.toExist();
    expect(await forgetCalls()).toBe(0);
  });

  it('cancels Forget holds when modifiers or the active workspace change', async () => {
    await browser.url('/__gneauxghts_e2e_reset');
    await browser.execute(() => { localStorage.clear(); sessionStorage.clear(); });
    await browser.url('/');
    await $('[data-testid="note-title"]').waitForDisplayed({ timeout: 30_000 });
    await expect($('[data-testid="note-title"]')).toHaveValue('Alpha note');
    const send = async (type, key, code, modifiers) => browser.execute((type, key, code, modifiers) => {
      document.activeElement.dispatchEvent(new KeyboardEvent(type, { key, code, bubbles: true, cancelable: true, ...modifiers }));
    }, type, key, code, modifiers);
    const original = { metaKey: true, shiftKey: true };
    const button = $('button[aria-label^="Forget this note."]');
    const stopped = () => expect(button).not.toHaveAttribute('class', expect.stringContaining('forget-hold-animation'));
    for (const change of [
      { type: 'keydown', key: 'Alt', code: 'AltLeft', modifiers: { ...original, altKey: true } },
      { type: 'keydown', key: 'Control', code: 'ControlLeft', modifiers: { ...original, ctrlKey: true } },
      { type: 'keyup', key: 'Shift', code: 'ShiftLeft', modifiers: { metaKey: true } },
      { type: 'keyup', key: 'Meta', code: 'MetaLeft', modifiers: { shiftKey: true } }
    ]) {
      await browser.execute((original, change) => {
        document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', code: 'Backspace', bubbles: true, cancelable: true, ...original }));
        const { type, key, code, modifiers } = change;
        document.activeElement.dispatchEvent(new KeyboardEvent(type, { key, code, bubbles: true, cancelable: true, ...modifiers }));
      }, original, change);
      await stopped();
      await browser.execute(() => new Promise(resolve => setTimeout(resolve, 700)));
      await expect($('#forget-confirm-popover')).not.toExist();
      expect(await browser.execute(() => window.__GNEAUXGHTS_E2E__.invocations.filter(call => call.command === 'forget_note'))).toEqual([]);
      await send('keyup', 'Backspace', 'Backspace', original);
    }
    await browser.execute((modifiers) => {
      for (const { key, code } of [{ key: 'Backspace', code: 'Backspace' }, { key: 'H', code: 'KeyH' }]) {
        document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key, code, bubbles: true, cancelable: true, ...modifiers }));
      }
    }, original);
    await $('[data-testid="history-mode"]').waitForDisplayed();
    await stopped();
    await browser.execute(() => new Promise(resolve => setTimeout(resolve, 700)));
    expect(await browser.execute(() => window.__GNEAUXGHTS_E2E__.invocations.filter(call => call.command === 'forget_note'))).toEqual([]);
    await send('keyup', 'Backspace', 'Backspace', original);
    await send('keydown', 'Escape', 'Escape', {});
    await expect($('[data-testid="history-mode"]')).not.toExist();
  });

  it('remaps Transpose Characters and warns about global search conflicts', async () => {
    await browser.url('/__gneauxghts_e2e_reset');
    await browser.execute(() => { localStorage.clear(); sessionStorage.clear(); });
    await browser.url('/settings');
    await $('button=Keyboard shortcuts').waitForDisplayed({ timeout: 30_000 });
    await $('button=Keyboard shortcuts').click();
    await $('input[aria-label="Filter shortcuts"]').setValue('Transpose Characters');
    await expect($$('tr[data-shortcut-id="editorTransposeChars"]')).toBeElementsArrayOfSize(1);
    await expect($('tr[data-shortcut-id="editorTransposeChars"]')).toHaveText(expect.stringContaining('Default'));
    await $('tr[data-shortcut-id="editorTransposeChars"] .binding-button').click();
    await browser.execute(() => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'q', code: 'KeyQ', ctrlKey: true, bubbles: true, cancelable: true
    })));
    await $('button=Save').click();
    await browser.refresh();
    await $('button=Keyboard shortcuts').click();
    await $('input[aria-label="Filter shortcuts"]').setValue('Transpose Characters');
    await expect($('tr[data-shortcut-id="editorTransposeChars"]')).toHaveText(expect.stringContaining('User'));
    await expect($('tr[data-shortcut-id="editorTransposeChars"] .binding-button')).toHaveAttribute('aria-label', 'Change Transpose Characters shortcut, Ctrl + Q');
    await $('input[aria-label="Filter shortcuts"]').setValue('Bold');
    await $('tr[data-shortcut-id="editorBold"] .binding-button').click();
    await browser.execute(() => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'f', code: 'KeyF', metaKey: true, bubbles: true, cancelable: true
    })));
    await expect($('[role="dialog"]')).toHaveText(expect.stringContaining('Search Current Note'));
    await $('button=Cancel').click();
    await browser.url('/');
    await $('[data-testid="note-title"]').waitForDisplayed({ timeout: 30_000 });
    await expect($('[data-testid="note-title"]')).toHaveValue('Alpha note');
    await browser.execute(() => {
      const content = document.querySelector('[data-testid="note-editor"] .cm-content'); content.focus();
      const bridge = window.__GNEAUXGHTS_NATIVE_E2E__;
      bridge.setEditorSelection(0, bridge.readEditorState().editor.markdown.length);
      const clipboardData = new DataTransfer(); clipboardData.setData('text/plain', 'ab');
      content.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
      bridge.setEditorSelection(1, 1);
    });
    const body = () => browser.execute(() => window.__GNEAUXGHTS_NATIVE_E2E__.readEditorState().editor.markdown);
    const press = async (key, code, modifiers) => browser.execute((key, code, modifiers) => {
      document.querySelector('.cm-content').dispatchEvent(new KeyboardEvent('keydown', { key, code, bubbles: true, cancelable: true, ...modifiers }));
    }, key, code, modifiers);
    await press('t', 'KeyT', { ctrlKey: true });
    expect(await body()).toBe('ab');
    await press('Q', 'KeyQ', { ctrlKey: true, shiftKey: true });
    expect(await body()).toBe('ab');
    await press('q', 'KeyQ', { ctrlKey: true });
    await browser.waitUntil(async () => await body() === 'ba');
  });

  it('persists an explicit Windows assignment that equals a macOS default', async () => {
    const init = await browser.scriptAddPreloadScript({
      functionDeclaration: "() => { Object.defineProperty(navigator, 'platform', { configurable: true, value: 'Win32' }); }"
    });
    try {
      await browser.url('/__gneauxghts_e2e_reset');
      await browser.execute(() => { localStorage.clear(); sessionStorage.clear(); });
      await browser.url('/settings');
      await $('button=Keyboard shortcuts').click();
      await $('input[aria-label="Filter shortcuts"]').setValue('Transpose Characters');
      await expect($('tr[data-shortcut-id="editorTransposeChars"] .binding-button')).toHaveText('Unassigned');
      await $('tr[data-shortcut-id="editorTransposeChars"] .binding-button').click();
      await browser.execute(() => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {
        key: 't', code: 'KeyT', ctrlKey: true, bubbles: true, cancelable: true
      })));
      await $('button=Save').click();
      await expect($('tr[data-shortcut-id="editorTransposeChars"]')).toHaveText(expect.stringContaining('User'));
      await browser.refresh();
      await $('button=Keyboard shortcuts').click();
      await $('input[aria-label="Filter shortcuts"]').setValue('Transpose Characters');
      await expect($('tr[data-shortcut-id="editorTransposeChars"] .binding-button')).toHaveAttribute('aria-label', 'Change Transpose Characters shortcut, Ctrl + T');
      await browser.url('/');
      await $('[data-testid="note-title"]').waitForDisplayed({ timeout: 30_000 });
      await expect($('[data-testid="note-title"]')).toHaveValue('Alpha note');
      await browser.execute(() => {
        const content = document.querySelector('.cm-content'); content.focus();
        const bridge = window.__GNEAUXGHTS_NATIVE_E2E__;
        bridge.setEditorSelection(0, bridge.readEditorState().editor.markdown.length);
        const clipboardData = new DataTransfer(); clipboardData.setData('text/plain', 'ab');
        content.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
        bridge.setEditorSelection(1, 1);
        content.dispatchEvent(new KeyboardEvent('keydown', { key: 't', code: 'KeyT', ctrlKey: true, bubbles: true, cancelable: true }));
      });
      await browser.waitUntil(async () => await browser.execute(() => window.__GNEAUXGHTS_NATIVE_E2E__.readEditorState().editor.markdown) === 'ba');
      await browser.url('/settings');
      await $('button=Keyboard shortcuts').click();
      await $('input[aria-label="Filter shortcuts"]').setValue('Transpose Characters');
      await $('button[aria-label="Reset Transpose Characters to default"]').click();
      await expect($('tr[data-shortcut-id="editorTransposeChars"] .binding-button')).toHaveText('Unassigned');
      await expect($('tr[data-shortcut-id="editorTransposeChars"]')).toHaveText(expect.stringContaining('Default'));
      await browser.refresh();
      await $('button=Keyboard shortcuts').click();
      await $('input[aria-label="Filter shortcuts"]').setValue('Transpose Characters');
      await expect($('tr[data-shortcut-id="editorTransposeChars"] .binding-button')).toHaveText('Unassigned');
    } finally {
      await browser.scriptRemovePreloadScript({ script: init.script });
      await browser.execute(() => { delete navigator.platform; });
    }
  });

});
