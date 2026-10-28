import { browser, $, $$, expect } from '@wdio/globals';

const body = () => browser.execute(() => window.__GNEAUXGHTS_NATIVE_E2E__.readEditorState().editor.markdown);
const listLines = () => $$('.cm-gn-list-line-ol, .cm-gn-list-line-ul, .cm-gn-task-line');
const depths = () => browser.execute(() => [...document.querySelectorAll('.cm-line')]
  .map(line => Number(line.style.getPropertyValue('--gn-depth'))));

async function replaceBody(source) {
  await browser.execute(value => {
    const content = document.querySelector('[data-testid="note-editor"] .cm-content');
    content.focus();
    const bridge = window.__GNEAUXGHTS_NATIVE_E2E__;
    bridge.setEditorSelection(0, bridge.readEditorState().editor.markdown.length);
    const data = new DataTransfer();
    data.setData('text/plain', value);
    content.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, source);
}

async function selectText(text, select = false) {
  await browser.execute(({ text, select }) => {
    const bridge = window.__GNEAUXGHTS_NATIVE_E2E__;
    const pos = bridge.readEditorState().editor.markdown.indexOf(text);
    if (pos < 0) throw new Error(`Missing editor text: ${text}`);
    bridge.setEditorSelection(select ? pos : pos + text.length, pos + text.length);
  }, { text, select });
}

async function turnInto(text, label) {
  await selectText(text, true);
  await $('button[aria-label="Turn into block type"]').click();
  await $(`.selection-item-label=${label}`).click();
}

describe('mixed list indentation', () => {
  beforeEach(async () => {
    await browser.url('/__gneauxghts_e2e_reset');
    await browser.execute(() => { localStorage.clear(); sessionStorage.clear(); });
    await browser.url('/');
    await expect($('[data-testid="note-title"]')).toHaveValue('Alpha note');
  });

  it('changes styles at the current level and preserves subtrees and later lettered siblings', async () => {
    await replaceBody('1. Parent\n   1. Child\n      1. Grandchild\n         - Leaf\n      2. Second\n   b. Sibling\n2. Next');
    await turnInto('Child', 'Letter List');
    expect(await body()).toBe('1. Parent\n   a. Child\n      1. Grandchild\n         - Leaf\n      2. Second\n   b. Sibling\n2. Next');
    await turnInto('Child', 'Bullet List');
    expect(await body()).toBe('1. Parent\n   - Child\n     1. Grandchild\n        - Leaf\n     2. Second\n   b. Sibling\n2. Next');
    await expect(listLines()).toBeElementsArrayOfSize(7);
    expect(await depths()).toEqual([0, 1, 2, 3, 2, 1, 0]);
    const padding = await browser.execute(() => [...document.querySelectorAll('.cm-line')]
      .map(line => parseFloat(getComputedStyle(line).paddingLeft)));
    expect(padding[1]).toBe(padding[5]);
    expect(padding[2]).toBe(padding[4]);
    expect(padding[2] - padding[1]).toBeCloseTo(padding[3] - padding[2], 1);
  });

  it('continues a numbered child beneath letters and changes exactly one level per Tab or Shift+Tab', async () => {
    await replaceBody('a. Parent\n   1. Child');
    await selectText('Child');
    await browser.keys('Enter');
    await browser.keys('Second');
    expect(await body()).toBe('a. Parent\n   1. Child\n   2. Second');
    await browser.keys('Tab');
    expect(await body()).toBe('a. Parent\n   1. Child\n      2. Second');
    expect(await depths()).toEqual([0, 1, 2]);
    await browser.keys(['Shift', 'Tab', '\uE000']);
    expect(await body()).toBe('a. Parent\n   1. Child\n   2. Second');
    await browser.keys(['Shift', 'Tab', '\uE000']);
    expect(await body()).toBe('a. Parent\n   1. Child\n2. Second');
    expect(await depths()).toEqual([0, 1, 0]);
    await browser.keys('Tab');
    expect(await body()).toBe('a. Parent\n   1. Child\n   2. Second');
    await expect(listLines()).toBeElementsArrayOfSize(3);
    expect(await depths()).toEqual([0, 1, 1]);
  });
});
