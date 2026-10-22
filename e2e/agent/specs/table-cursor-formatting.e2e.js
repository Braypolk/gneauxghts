import { browser, $, $$, expect } from '@wdio/globals';

// Curated from the named table-regressions WDIO session.
const body = () => browser.execute(() => window.__GNEAUXGHTS_NATIVE_E2E__.readEditorState().editor.markdown);
const cell = () => $('.gn-table-cell-input[aria-label="Row 2, column 1"]');
const simpleTable = '| Name | Value |\n| --- | --- |\n| Hello world | Another |\n\nAfter';
async function replaceBody(markdown) {
  await browser.execute(markdown => {
    const content = document.querySelector('[data-testid="note-editor"] .cm-content');
    const bridge = window.__GNEAUXGHTS_NATIVE_E2E__;
    content.focus(); bridge.setEditorSelection(0, bridge.readEditorState().editor.markdown.length);
    const data = new DataTransfer(); data.setData('text/plain', markdown);
    content.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, markdown);
}
async function reveal(label) {
  await browser.execute("return import('/src/lib/e2e/tableEditingHarness.ts').then(module => module.revealTableTestText(arguments[0]))", label);
  await browser.waitUntil(() => browser.execute(label => [...document.querySelectorAll('.cm-line')].some(line => line.textContent === label), label));
  await browser.execute(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(null)))));
}

describe('rendered table cursor and formatting', () => {
  beforeEach(async () => {
    await browser.setWindowSize(1440, 1000);
    await browser.url('/__gneauxghts_e2e_reset');
    await browser.execute(() => { localStorage.clear(); sessionStorage.clear(); });
    await browser.url('/');
    await expect($('[data-testid="note-title"]')).toHaveValue('Alpha note');
    await browser.execute(() => {
      window.__tableErrors = [];
      const capture = error => { if (String(error).includes('state_unsafe_mutation')) window.__tableErrors.push(String(error)); };
      window.addEventListener('error', event => capture(event.error ?? event.message));
      window.addEventListener('unhandledrejection', event => capture(event.reason));
    });
  });

  afterEach(async () => expect(await browser.execute(() => window.__tableErrors)).toEqual([]));

  it('maps clicks to exact lines and moves Up locally through multiple rendered tables', async () => {
    const parts = [];
    for (let section = 0; section < 4; section++) {
      parts.push(`Section ${section}`, '', '| Name | Value |', '| --- | --- |');
      for (let row = 0; row < 12; row++) parts.push(`| Cell ${section}-${row} | Value ${row} |`);
      parts.push('', ...Array.from({ length: 8 }, (_, index) => `Paragraph ${section}-${index}`), '');
    }
    await replaceBody(parts.join('\n'));
    await expect($$('.gn-table')[0]).toBeDisplayed();
    for (const label of ['Paragraph 0-4', 'Paragraph 1-4', 'Paragraph 2-4', 'Paragraph 3-4']) {
      await reveal(label);
      const coords = await browser.execute(label => {
        const line = [...document.querySelectorAll('.cm-line')].find(line => line.textContent === label);
        const rect = line.getBoundingClientRect();
        return { x: Math.round(rect.left + 35), y: Math.round((rect.top + rect.bottom) / 2) };
      }, label);
      await browser.action('pointer').move(coords).down().up().perform();
      const position = await browser.execute(label => {
        const editor = window.__GNEAUXGHTS_NATIVE_E2E__.readEditorState().editor;
        return { actual: editor.markdown.slice(0, editor.selection.head).split('\n').length,
          expected: editor.markdown.slice(0, editor.markdown.indexOf(label)).split('\n').length };
      }, label);
      expect(position.actual).toBe(position.expected);
    }
    await reveal('Paragraph 3-0');
    for (const line of [95, 80, 79, 78, 77]) {
      await browser.keys('ArrowUp');
      expect(await browser.execute(() => {
        const editor = window.__GNEAUXGHTS_NATIVE_E2E__.readEditorState().editor;
        return editor.markdown.slice(0, editor.selection.head).split('\n').length;
      })).toBe(line);
    }
  });

  it('formats rendered cell selections through the shared popup and preserves native focus and Undo', async () => {
    await replaceBody(simpleTable);
    await $('.gn-table-cell-preview[data-row="1"][data-column="0"]').click();
    await expect(cell()).toBeFocused();
    await expect($('button[aria-label="Bold"]')).toBeDisplayed();
    await expect($('button[aria-label="Turn into block type"]')).not.toExist();
    const anchor = await cell().getLocation();
    const popup = await $('[role="toolbar"][aria-label="Text formatting"]').getLocation();
    expect(Math.abs(popup.y - anchor.y)).toBeLessThan(120);
    await $('button[aria-label="Bold"]').click();
    await expect(cell()).toHaveValue('**Hello world**');
    await expect(cell()).toBeFocused();
    expect(await body()).toContain('| **Hello world** | Another |');
    await browser.keys(['Meta', 'z', '\uE000']);
    await expect(cell()).toHaveValue('Hello world');
    await browser.keys(['Meta', 'Shift', 'z', '\uE000']);
    await expect(cell()).toHaveValue('**Hello world**');
    await browser.keys(['Meta', 'a', '\uE000']);
    // Chrome's physical KeyB follows the host keyboard layout (for example,
    // Dvorak produces "t"). Send the intended logical shortcut to the live input.
    await browser.execute(() => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'b', code: 'KeyB', metaKey: true, bubbles: true, cancelable: true
    })));
    await expect(cell()).toHaveValue('Hello world');
    await browser.keys('Escape');
    await expect($('[role="toolbar"][aria-label="Text formatting"]')).not.toExist();
    await expect($('[data-testid="note-editor"] .cm-content')).toBeFocused();
  });

  it('ignores late input and composition events after structural cell replacement', async () => {
    await replaceBody(simpleTable);
    await $('.gn-table-cell-preview[data-row="1"][data-column="0"]').click();
    await browser.execute("return import('/src/lib/e2e/tableEditingHarness.ts').then(module => module.verifyRetiredTableCellAfterStructuralChange())");
    expect(await body()).toContain('| Hello world |  | Another |');
  });

  it('retires a native popup safely when switching source mode and leaving the pane', async () => {
    await replaceBody(simpleTable);
    await $('.gn-table-cell-preview[data-row="1"][data-column="0"]').click();
    await expect($('button[aria-label="Bold"]')).toBeDisplayed();
    await $('button[title="Edit table Markdown source"]').click();
    await expect($('.gn-table')).not.toExist();
    // Source selects the table Markdown and opens the ordinary block-capable menu.
    await expect($('button[aria-label="Turn into block type"]')).toBeDisplayed();
    await $('.gn-table-source-controls button').click();
    await expect($('.gn-table')).toBeDisplayed();
    await $('.gn-table-cell-preview[data-row="1"][data-column="0"]').click();
    await expect($('button[aria-label="Bold"]')).toBeDisplayed();
    await $('button[aria-label="Open thought partner in this pane"]').click();
    await expect($('[aria-label="Thought partner chat"]')).toBeDisplayed();
    await expect($('[role="toolbar"][aria-label="Text formatting"]')).not.toExist();
  });
});
