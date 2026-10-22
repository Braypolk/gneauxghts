import { browser, $, $$, expect } from '@wdio/globals';

// Curated from the named table-boundary WDIO session.
const source = '| Name | Value |\n| --- | --- |\n| One | 1 |';
const body = () => browser.execute(() => window.__GNEAUXGHTS_NATIVE_E2E__.readEditorState().editor.markdown);

async function paste(text, replace = false) {
  await browser.execute(({ text, replace }) => {
    const content = document.querySelector('[data-testid="note-editor"] .cm-content');
    const bridge = window.__GNEAUXGHTS_NATIVE_E2E__;
    content.focus();
    if (replace) bridge.setEditorSelection(0, bridge.readEditorState().editor.markdown.length);
    const data = new DataTransfer(); data.setData('text/plain', text);
    content.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, { text, replace });
}

async function clickBelowTable() {
  const coords = await browser.execute(() => {
    const line = document.querySelector('[data-testid="note-editor"] .cm-line:last-child');
    const rect = line.getBoundingClientRect();
    return { x: Math.round(rect.left + 3), y: Math.round((rect.top + rect.bottom) / 2) };
  });
  await browser.action('pointer').move(coords).down().up().perform();
}

async function lineTop(text) {
  return browser.execute(text => [...document.querySelectorAll('[data-testid="note-editor"] .cm-line')]
    .find(line => line.textContent === text).getBoundingClientRect().top, text);
}

describe('paragraphs below rendered tables', () => {
  beforeEach(async () => {
    await browser.url('/__gneauxghts_e2e_reset');
    await browser.execute(() => { localStorage.clear(); sessionStorage.clear(); });
    await browser.url('/');
    await expect($('[data-testid="note-title"]')).toHaveValue('Alpha note');
  });

  it('keeps continuous typing outside the table when clicking the next empty line', async () => {
    for (const ending of ['\n', '\n\n']) {
      await paste(source + ending, true);
      await clickBelowTable();
      const before = await lineTop('');
      await browser.keys('h');
      expect(Math.abs(await lineTop('h') - before)).toBeLessThan(1);
      await browser.keys('ello world');
      expect(Math.abs(await lineTop('hello world') - before)).toBeLessThan(1);
      expect(await body()).toBe(source + '\n\nhello world');
      await expect($$('.gn-table tbody tr')).toBeElementsArrayOfSize(1);
      await expect($('.cm-line=hello world')).toBeDisplayed();
      await expect($('[data-testid="note-editor"] .cm-content')).toBeFocused();
      await browser.keys('Enter');
      await browser.keys('next line');
      expect(await body()).toBe(source + '\n\nhello world\nnext line');
    }
  });

  it('keeps following prose in place when typing into a blank line below a table', async () => {
    await paste(source + '\n\n\nAfter', true);
    const before = { blank: await lineTop(''), after: await lineTop('After') };
    const coords = await browser.execute(() => {
      const rect = document.querySelector('[data-testid="note-editor"] .cm-line').getBoundingClientRect();
      return { x: Math.round(rect.left + 3), y: Math.round((rect.top + rect.bottom) / 2) };
    });
    await browser.action('pointer').move(coords).down().up().perform();
    await browser.keys('test');
    expect(await body()).toBe(source + '\n\ntest\nAfter');
    expect(Math.abs(await lineTop('test') - before.blank)).toBeLessThan(1);
    expect(Math.abs(await lineTop('After') - before.after)).toBeLessThan(1);
  });

  it('places the caret on the visible paragraph when leaving a cell or source mode', async () => {
    await paste(source + '\n\nAfter', true);
    await $('.gn-table-cell-preview[data-row="1"][data-column="0"]').click();
    await browser.keys('Escape');
    await browser.keys('before ');
    expect(await body()).toBe(source + '\n\nbefore After');
    await $('button=Source').click();
    await $('button=Done editing table source').click();
    await browser.keys('more ');
    expect(await body()).toBe(source + '\n\nmore before After');
  });

  it('keeps pasted prose outside the table and undoes the paragraph boundary with it', async () => {
    await paste(source + '\n', true);
    await clickBelowTable();
    await paste('pasted paragraph');
    expect(await body()).toBe(source + '\n\npasted paragraph');
    await expect($('.cm-line=pasted paragraph')).toBeDisplayed();
    await expect($$('.gn-table tbody tr')).toBeElementsArrayOfSize(1);
    await browser.keys(['Meta', 'z', '\uE000']);
    expect(await body()).toBe(source + '\n');
    await browser.keys(['Meta', 'Shift', 'z', '\uE000']);
    expect(await body()).toBe(source + '\n\npasted paragraph');
  });
});
