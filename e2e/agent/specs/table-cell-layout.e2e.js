import { browser, $, expect } from '@wdio/globals';

const source = '| ID | Details | Status |\n| --- | --- | --- |\n| 1 | A longer description that naturally gives this column more space | Ready |\n| 2 | Short | Pending |\n\nAfter';
const preview = (row, column) => $(`.gn-table-cell-preview[data-row="${row}"][data-column="${column}"]`);

async function replaceBody(markdown) {
  await browser.execute(value => {
    const content = document.querySelector('[data-testid="note-editor"] .cm-content');
    content.focus();
    const bridge = window.__GNEAUXGHTS_NATIVE_E2E__;
    bridge.setEditorSelection(0, bridge.readEditorState().editor.markdown.length);
    const data = new DataTransfer(); data.setData('text/plain', value);
    content.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, markdown);
  await expect($('.gn-table')).toBeDisplayed();
  await browser.execute(() => document.fonts.ready.then(() => undefined));
}

function geometry() {
  return browser.execute(() => {
    const table = document.querySelector('.gn-table table');
    return {
      widths: [...table.rows[0].cells].map(cell => cell.getBoundingClientRect().width),
      height: table.getBoundingClientRect().height
    };
  });
}

describe('table cell layout', () => {
  beforeEach(async () => {
    await browser.url('/');
    await browser.execute(() => localStorage.clear());
    await browser.refresh();
    await expect($('[data-testid="note-title"]')).toHaveValue('Alpha note');
  });

  for (const width of [1440, 520]) {
    it(`preserves column widths and row heights while activating cells at window width ${width}`, async () => {
      await browser.setWindowSize(width, 900);
      await replaceBody(source);
      const baseline = await geometry();
      // Short cells, the longest cell, and headers each used to contribute a
      // different intrinsic input width to automatic table layout.
      for (const [row, column] of [[0, 0], [0, 1], [1, 0], [1, 1], [1, 2], [2, 1]]) {
        await preview(row, column).click();
        await expect($('.gn-table-cell-input:not([hidden])')).toBeFocused();
        expect(await geometry()).toEqual(baseline);
        const overlay = await browser.execute(() => {
          const input = document.activeElement;
          const cell = input.closest('td, th').getBoundingClientRect();
          const editor = input.getBoundingClientRect();
          return { cellWidth: cell.width, editorWidth: editor.width, leftDifference: Math.abs(cell.left - editor.left) };
        });
        expect(overlay.editorWidth).toBeLessThanOrEqual(overlay.cellWidth);
        expect(overlay.editorWidth).toBeGreaterThan(overlay.cellWidth - 2);
        expect(overlay.leftDifference).toBeLessThanOrEqual(1);
        await browser.keys('Escape');
        expect(await geometry()).toEqual(baseline);
      }
      expect(await browser.execute(() => window.__GNEAUXGHTS_NATIVE_E2E__.readEditorState().editor.markdown)).toBe(source);
    });
  }
});
