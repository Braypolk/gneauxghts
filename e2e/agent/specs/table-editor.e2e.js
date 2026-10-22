import { browser, $, expect } from '@wdio/globals';

const source = '| Name | Value |\n| --- | ---: |\n| **One** | 1 |\n| Two | 2 |\n\nAfter';
const preview = (row, column) => $(`.gn-table-cell-preview[data-row="${row}"][data-column="${column}"]`);
const cell = label => $(`.gn-table-cell-input[aria-label="${label}"]`);
const body = () => browser.execute(() => window.__GNEAUXGHTS_NATIVE_E2E__.readEditorState().editor.markdown);

async function replaceBody(markdown) {
  await browser.execute(value => {
    const content = document.querySelector('[data-testid="note-editor"] .cm-content');
    content.focus();
    const bridge = window.__GNEAUXGHTS_NATIVE_E2E__;
    bridge.setEditorSelection(0, bridge.readEditorState().editor.markdown.length);
    const data = new DataTransfer(); data.setData('text/plain', value);
    content.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, markdown);
}

describe('editable Markdown tables', () => {
  beforeEach(async () => {
    await browser.url('/');
    await browser.execute(() => localStorage.clear());
    await browser.refresh();
    await expect($('[data-testid="note-title"]')).toHaveValue('Alpha note');
  });

  it('inserts from slash and edits cells with normal typing and row-major Tab navigation', async () => {
    await replaceBody('/table');
    await expect($('.slash-panel')).toBeDisplayed();
    await $('.slash-item-label=Table').click();
    await expect(cell('Header, column 1')).toBeFocused();
    await browser.keys('Project name');
    await expect(cell('Header, column 1')).toHaveValue('Project name');
    expect(await body()).toContain('| Project name | Column 2 |');
    await preview(1, 1).click();
    await browser.keys('Tab');
    await expect(cell('Row 3, column 1')).toBeFocused();
    await browser.keys('new row');
    expect(await body()).toContain('| new row |  |');
    await browser.keys(['Meta', 'z', '\uE000']);
    await expect(cell('Row 3, column 1')).toHaveValue('');
    await browser.keys(['Meta', 'Shift', 'z', '\uE000']);
    await expect(cell('Row 3, column 1')).toHaveValue('new row');
    await browser.keys('Tab');
    await expect(cell('Row 3, column 2')).toBeFocused();
    await browser.keys(['Shift', 'Tab', '\uE000']);
    await expect(cell('Row 3, column 1')).toBeFocused();
    await browser.keys('Escape');
    await expect($('[data-testid="note-editor"] .cm-content')).toBeFocused();
  });

  it('adds and removes rows/columns, aligns a column, and retains editable Markdown source', async () => {
    await replaceBody(source);
    await expect($('.gn-table')).toBeDisplayed();
    await expect(preview(1, 0).$('strong')).toHaveText('One');
    await preview(1, 0).click();
    await browser.keys(['Meta', 'a', '\uE000']);
    await browser.keys('hello world');
    await expect(cell('Row 2, column 1')).toHaveValue('hello world');
    expect(await body()).toContain('| hello world | 1 |');
    await $('button[aria-label="Add column after selected cell"]').click();
    await expect(cell('Row 2, column 2')).toBeFocused();
    await $('select[aria-label="Column alignment"]').selectByAttribute('value', 'center');
    expect(await body()).toContain('| --- | :---: | ---: |');
    await $('button[aria-label="Remove selected column"]').click();
    await expect(cell('Row 2, column 2')).toBeFocused();
    await $('button[aria-label="Add row below selected cell"]').click();
    await expect(cell('Row 3, column 2')).toBeFocused();
    await $('button[aria-label="Remove selected row"]').click();
    expect(await body()).toContain('| hello world | 1 |\n| Two | 2 |');
    await $('button=Source').click();
    await expect($('.gn-table')).not.toExist();
    await expect($('button=Done editing table source')).toBeDisplayed();
    await $('button=Done editing table source').click();
    await expect($('.gn-table')).toBeDisplayed();
    expect(await body()).toContain('| hello world | 1 |');
  });

  it('cancels stale composition after replacement and ignores retired input events', async () => {
    await replaceBody(source);
    await preview(1, 0).click();
    await browser.execute(async () => {
      const path = '/src/lib/e2e/tableEditingHarness.ts';
      const harness = await import(path);
      harness.verifyTableCompositionRetirement();
    });
    expect(await body()).toBe('unrelated replacement');
    await expect($('.gn-table')).not.toExist();
  });
});
