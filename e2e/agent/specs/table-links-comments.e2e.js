import { browser, $, expect } from '@wdio/globals';

// Curated from the table-link-support WDIO session. The external opener and
// note resolver are bounded fixtures; cell editing and note loading stay real.
const source = '| [Header](https://example.com/header) | %%Notes%% |\n| --- | --- |\n| before [**Example**](https://example.com) after | [[Beta note\\|Friendly]] %%private comment%% |\n\nAfter';
const preview = (row, column) => $(`.gn-table-cell-preview[data-row="${row}"][data-column="${column}"]`);
const link = () => preview(1, 0).$('.cm-gn-link-styled');
const editor = () => $('.gn-table-cell-input:not([hidden])');
const body = () => browser.execute(() => window.__GNEAUXGHTS_NATIVE_E2E__.readEditorState().editor.markdown);

async function replaceBody(markdown = source) {
  await browser.execute(value => {
    const content = document.querySelector('[data-testid="note-editor"] .cm-content');
    const bridge = window.__GNEAUXGHTS_NATIVE_E2E__;
    content.focus(); bridge.setEditorSelection(0, bridge.readEditorState().editor.markdown.length);
    const data = new DataTransfer(); data.setData('text/plain', value);
    content.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, markdown);
  await expect($('.gn-table')).toBeDisplayed();
}

async function clickRendered(selector, modifiers) {
  await browser.execute((selector, modifiers) => {
    document.querySelector(selector).dispatchEvent(new MouseEvent('click', { button: 0, bubbles: true, cancelable: true, ...modifiers }));
  }, selector, modifiers);
}
async function touchRendered(selector) {
  await browser.execute(selector => document.querySelector(selector).dispatchEvent(new PointerEvent('click', {
    pointerType: 'touch', button: 0, bubbles: true, cancelable: true
  })), selector);
}

describe('table links and comments', () => {
  beforeEach(async () => {
    await browser.setWindowSize(1440, 1000);
    await browser.url('/__gneauxghts_e2e_reset');
    await browser.execute(() => { localStorage.clear(); sessionStorage.clear(); });
    await browser.url('/');
    await expect($('[data-testid="note-title"]')).toHaveValue('Alpha note');
    await browser.execute(() => {
      window.__tableOpened = [];
      window.__tableResolved = [];
      const invoke = window.__TAURI_INTERNALS__.invoke;
      window.__TAURI_INTERNALS__.invoke = (command, args) => {
        if (command === 'plugin:opener|open_url') {
          window.__tableOpened.push(args.url); return Promise.resolve();
        }
        if (command === 'resolve_note_link' && args.rawTarget === 'Beta note|Friendly') {
          window.__tableResolved.push(args.rawTarget);
          return Promise.resolve({ noteId: 'note-beta', notePath: '/e2e/beta.md', sectionLabel: 'Note', matchText: '' });
        }
        return invoke(command, args);
      };
    });
    await replaceBody();
  });

  it('renders headers, formatted link labels, note aliases and muted comments without changing source', async () => {
    await expect(preview(0, 0).$('.cm-gn-link-styled')).toHaveText('Header');
    await expect(link().$('strong')).toHaveText('Example');
    await expect(preview(1, 1).$('.gn-wikilink')).toHaveText('[[Friendly]]');
    await expect(preview(1, 1).$('.cm-gn-comment')).toHaveText('private comment');
    expect((await preview(1, 1).$('.cm-gn-comment').getCSSProperty('font-style')).value).toBe('italic');
    await preview(1, 1).$('.cm-gn-comment').click();
    await expect(editor()).toHaveValue('[[Beta note\\|Friendly]] %%private comment%%');
    await expect(editor()).toBeFocused();
    await browser.keys('Escape');
    expect(await body()).toBe(source);
    expect(await browser.execute(() => window.__tableOpened)).toEqual([]);
    expect(await browser.execute(() => window.__tableResolved)).toEqual([]);
  });

  it('opens external links only on exact modifiers and keeps ordinary clicks editable', async () => {
    let opens = 0;
    for (const modifiers of [{ metaKey: true }, { ctrlKey: true }, { metaKey: true, shiftKey: true }, { ctrlKey: true, altKey: true }, { metaKey: true, ctrlKey: true }]) {
      await clickRendered('.gn-table-cell-preview[data-row="1"][data-column="0"] .cm-gn-link-styled strong', modifiers);
      if (Object.keys(modifiers).length === 1) opens++;
      expect(await browser.execute(() => window.__tableOpened)).toEqual(Array(opens).fill('https://example.com'));
      if (Object.keys(modifiers).length === 1) await expect(editor()).not.toExist();
      else await browser.keys('Escape');
    }
    await link().click();
    await expect(editor()).toBeFocused();
    await expect(editor()).toHaveValue('before [**Example**](https://example.com) after');
    expect(await body()).toBe(source);
  });

  it('offers touch Open and Edit, and edits only the selected link inside the cell with undo', async () => {
    await touchRendered('.gn-table-cell-preview[data-row="1"][data-column="0"] .cm-gn-link-styled');
    await expect($('[aria-label="External link actions"]')).toBeDisplayed();
    expect(await browser.execute(() => window.__tableOpened)).toEqual([]);
    await $('button=Open link').click();
    expect(await browser.execute(() => window.__tableOpened)).toEqual(['https://example.com']);
    await touchRendered('.gn-table-cell-preview[data-row="1"][data-column="0"] .cm-gn-link-styled');
    await $('button=Edit link').click();
    await expect(editor()).toBeFocused();
    expect(await browser.execute(() => {
      const input = document.activeElement;
      return input.value.slice(input.selectionStart, input.selectionEnd);
    })).toBe('[**Example**](https://example.com)');
    await browser.keys('updated');
    await expect(editor()).toHaveValue('before updated after');
    await browser.keys(['Meta', 'z', '\uE000']);
    await expect(editor()).toHaveValue('before [**Example**](https://example.com) after');
    await browser.keys('Escape');
    await expect(link()).toBeDisplayed();
    expect(await body()).toBe(source);
  });

  for (const gesture of ['modifier', 'touch']) {
    it(`opens an aliased note through normal navigation on ${gesture}`, async () => {
      await preview(1, 1).$('.gn-wikilink').click();
      await expect(editor()).toBeFocused();
      await expect(editor()).toHaveValue('[[Beta note\\|Friendly]] %%private comment%%');
      await browser.keys('Escape');
      if (gesture === 'modifier') await clickRendered('.gn-table .gn-wikilink', { ctrlKey: true });
      else await touchRendered('.gn-table .gn-wikilink');
      await expect($('[data-testid="note-title"]')).toHaveValue('Beta note');
      expect(await browser.execute(() => window.__tableResolved)).toEqual(['Beta note|Friendly']);
      expect(await body()).toContain('Beta body is independent from Alpha.');
    });
  }
});
