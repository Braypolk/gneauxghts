import { browser, expect, $ } from '@wdio/globals';
import { invokeNative } from '../../support/liveNative';
import { waitForWorkspaceAnimationSettled } from '../../support/workspaceAnimation';

// Use CodeMirror's public DOM lookup on the mounted editor, including its real
// wrapping geometry and deferred measurement. A synthetic focus flag misses the
// WebKit selection API's implicit focus transfer.
async function focusWrappedCursor(transferToSearch = true) {
  return browser.execute((transferToSearch: boolean) => new Promise<{
    wrap: number;
    error?: string;
  }>((done, reject) => {
    void (async () => {
      try {
        const moduleUrl = '/node_modules/@codemirror/view/dist/index.js';
        const { EditorView } = await import(/* @vite-ignore */ moduleUrl);
        const view = EditorView.findFromDOM(document.querySelector('.cm-content'));
        if (!view)
          throw new Error('Mounted editor is required');
        let wrap = 0;
        const line = view.state.doc.line(1);
        for (let pos = line.from + 1; pos < line.to; pos++) {
          const before = view.coordsAtPos(pos, -1), after = view.coordsAtPos(pos, 1);
          if (before && after && before.bottom <= after.top) {
            wrap = pos;
            break;
          }
        }
        if (!wrap)
          throw new Error('Fixture must have a soft-wrapped cursor boundary');
        view.focus();
        const selection = view.state.selection.constructor;
        view.dispatch({ selection: selection.create([selection.cursor(wrap, 1)]) });
        // Transfer focus before the queued cursor-association measure runs, as
        // happens when opening the narrow dock after clicking a wrapped line.
        if (transferToSearch)
          document.querySelector<HTMLInputElement>('[data-testid="note-search-input"]')!.focus();
        done({ wrap });
      }
      catch (error) {
        done({ wrap: 0, error: String(error) });
      }
    })().catch(reject);
  }), transferToSearch);
}

describe('native search focus at wrapped cursor boundaries', () => {
  before(async () => {
    await invokeNative('plugin:window|show', { label: 'main' });
    await invokeNative('plugin:window|set_focus', { label: 'main' });
    await $('[data-testid="note-editor"] .cm-content').waitForDisplayed({ timeout: 30_000 });
    const note = await invokeNative<{ noteId: string }>('save_note', {
      title: 'Wrapped cursor search focus', currentPath: null,
      markdown: 'A long paragraph with enough words to wrap across several visual lines in a narrow editor. '.repeat(8)
    });
    await invokeNative('mark_note_opened', { noteId: note.noteId });
    await browser.refresh();
    await browser.waitUntil(async () => (await $('[data-testid="note-title"]').getValue()) === 'Wrapped cursor search focus');
    const scale = await browser.execute(() => devicePixelRatio);
    await browser.setWindowRect(60, 80, 417 * scale, 800 * scale);
    await invokeNative('plugin:window|show', { label: 'main' });
    await invokeNative('plugin:window|set_focus', { label: 'main' });
    await browser.waitUntil(async () => browser.execute(() => document.hasFocus() && innerWidth < 450));
    await waitForWorkspaceAnimationSettled();
  });

  it('keeps search focused when deferred wrapped-cursor measurement runs after leaving the editor', async () => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const result = await focusWrappedCursor();
      expect(result.error).toBeUndefined();
      expect(result.wrap).toBeGreaterThan(0);
      await waitForWorkspaceAnimationSettled();
      await expect($('.notepad-search-bar')).toHaveAttribute('data-search-open', 'true');
      expect(await browser.execute(() => document.activeElement === document.querySelector('[data-testid="note-search-input"]'))).toBe(true);
      await $('[data-testid="note-search-input"]').setValue('paragraph');
      await expect($('[data-testid="note-search-input"]')).toHaveValue('paragraph');
      await $('button[aria-label="Clear search"]').click();
      await $('[data-testid="note-editor"] .cm-content').click();
      await waitForWorkspaceAnimationSettled();
    }
  });
  it('preserves the wrapped cursor and typing position while the editor owns focus', async () => {
    const result = await focusWrappedCursor(false);
    expect(result.error).toBeUndefined();
    expect(result.wrap).toBeGreaterThan(0);
    await waitForWorkspaceAnimationSettled();
    const before = await $('[data-testid="note-editor"] .cm-content').getText();
    expect(await browser.execute(() => document.execCommand('insertText', false, 'x'))).toBe(true);
    const expected = before.slice(0, result.wrap) + 'x' + before.slice(result.wrap);
    await browser.waitUntil(async () =>
      (await $('[data-testid="note-editor"] .cm-content').getText()).trimEnd() === expected.trimEnd()
    );
    expect(await browser.execute(() => document.activeElement?.classList.contains('cm-content'))).toBe(true);
  });
});
