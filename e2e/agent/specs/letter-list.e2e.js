import { browser, $, $$, expect } from '@wdio/globals';

const content = () => $('[data-testid="note-editor"] .cm-content');
const body = () => browser.execute(() => window.__GNEAUXGHTS_NATIVE_E2E__.readEditorState().editor.markdown);

describe('letter lists', () => {
  it('creates from slash, continues letters and exits an empty item', async () => {
    await browser.url('/__gneauxghts_e2e_reset');
    await browser.execute(() => { localStorage.clear(); sessionStorage.clear(); });
    await browser.url('/');
    await expect($('[data-testid="note-title"]')).toHaveValue('Alpha note');
    await $('button[aria-label="New Idea. Start a blank note in this pane."]').click();
    await content().addValue('/letter');
    await expect($('.slash-panel')).toBeDisplayed();
    await $('.slash-item-label=Letter List').click();
    await expect(content()).toHaveText('a.');
    expect(await body()).toBe('a. ');
    await browser.keys('First');
    await browser.keys('Enter');
    await browser.keys('Second');
    await browser.keys('Enter');
    await browser.keys('Third');
    await expect($$('.cm-gn-list-line-ol')).toBeElementsArrayOfSize(3);
    await expect(content()).toHaveText('a. First\nb. Second\nc. Third');
    expect(await body()).toBe('a. First\nb. Second\nc. Third');
    await browser.keys('Enter');
    await browser.keys('Enter');
    expect(await body()).toBe('a. First\nb. Second\nc. Third\n');
  });
});
