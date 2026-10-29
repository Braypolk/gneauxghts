import { browser, $, expect } from '@wdio/globals';

const details = '1/4 cup olive oil, juice of 2 limes, 2 tbsp orange juice, 1–2 chipotle peppers, 4 garlic cloves, 1 tsp oregano, salt and pepper';
const source = `| ID | Details | Status |\n| --- | --- | --- |\n| 1 | ${details} | Ready |\n| 2 | Short | Pending |\n\nAfter`;
const preview = (row, column) => $(`.gn-table-cell-preview[data-row="${row}"][data-column="${column}"]`);
const editor = () => $('.gn-table-cell-input:not([hidden])');

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

async function expectWrappedEditor() {
  const layout = await browser.execute(() => {
    const input = document.activeElement;
    return {
      tag: input.tagName,
      height: input.clientHeight,
      scrollHeight: input.scrollHeight,
      width: input.clientWidth,
      scrollWidth: input.scrollWidth,
      scrollTop: input.scrollTop,
      scrollLeft: input.scrollLeft,
      lineHeight: parseFloat(getComputedStyle(input).lineHeight)
    };
  });
  expect(layout.tag).toBe('TEXTAREA');
  expect(layout.height).toBeGreaterThan(layout.lineHeight * 2);
  expect(layout.scrollHeight).toBeLessThanOrEqual(layout.height + 1);
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.width + 1);
  expect(layout.scrollTop).toBe(0);
  expect(layout.scrollLeft).toBe(0);
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
        await expect(editor()).toBeFocused();
        expect(await geometry()).toEqual(baseline);
        if (row === 1 && column === 1) await expectWrappedEditor();
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

    it(`wraps and grows a cell while typing at window width ${width}`, async () => {
      await browser.setWindowSize(width, 900);
      await replaceBody(source);
      const baseline = await geometry();
      await preview(1, 1).click();
      await browser.keys('ArrowRight');
      // Native cursor movement must stay within the wrapped cell.
      const end = await browser.execute(() => document.activeElement.selectionStart);
      await browser.keys('ArrowUp');
      expect(await browser.execute(() => document.activeElement.selectionStart)).toBeLessThan(end);
      await browser.keys(['Meta', 'a', '\uE000']);
      const longer = `${details} ${'extra seasoning '.repeat(30)}${'x'.repeat(120)}`;
      await browser.keys(longer);
      await expect(editor()).toHaveValue(longer);
      await expectWrappedEditor();
      expect((await geometry()).height).toBeGreaterThan(baseline.height);
      expect(await browser.execute(() => window.__GNEAUXGHTS_NATIVE_E2E__.readEditorState().editor.markdown)).toContain(`| 1 | ${longer} | Ready |`);

      await browser.keys(['Meta', 'a', '\uE000']);
      await browser.keys(details);
      await expectWrappedEditor();
      expect(await geometry()).toEqual(baseline);
      await browser.keys('Escape');
      expect(await geometry()).toEqual(baseline);
      expect(await browser.execute(() => window.__GNEAUXGHTS_NATIVE_E2E__.readEditorState().editor.markdown)).toBe(source);
    });
  }
});
