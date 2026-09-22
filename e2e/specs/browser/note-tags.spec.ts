import { browser, expect, $, $$ } from '@wdio/globals';

async function toggleTags() {
  await $('button[aria-label="Note options"]').click();
  const item = await $('[role="menuitem"]*=tags');
  await item.click();
}

describe('optional inline note tags', () => {
  beforeEach(async () => {
    await browser.url('/');
    await browser.execute(() => localStorage.removeItem('gneauxghts.tags-visible'));
    await browser.refresh();
    await $('[data-testid="note-title"]').waitForDisplayed({ timeout: 30_000 });
    await $('span=Loading editor').waitForExist({ reverse: true });
  });

  it('reveals tags without saving, edits through autosave, and keeps the body intact', async () => {
    const row = () => $('[data-testid="note-tags"]');
    const saves = () => browser.execute(() => window.__GNEAUXGHTS_E2E__!.invocations.filter((entry) => entry.command === 'save_note'));
    const before = await $('[data-testid="note-editor"] .cm-content').getText();
    const saveCount = (await saves()).length;
    expect(await row().isExisting()).toBe(false);
    await toggleTags();
    await row().waitForDisplayed();
    expect((await saves()).length).toBe(saveCount);
    const input = await $('input[aria-label="Add tag"]');
    await input.waitForClickable();
    await input.setValue('Renovation');
    await browser.keys('Enter');
    await $('button[aria-label="Edit tag renovation"]').waitForExist();
    await browser.waitUntil(async () => (await saves()).length > saveCount);
    expect((await saves()).at(-1)?.args.tagEdit).toEqual({ previous: [], tags: ['renovation'] });
    expect(await $('[data-testid="note-editor"] .cm-content').getText()).toBe(before);
    const chipLocation = await $('button[aria-label="Edit tag renovation"]').getLocation();
    await $('button[aria-label="Edit tag renovation"]').click();
    await browser.waitUntil(async () => browser.execute(() => {
      const input = document.querySelector<HTMLInputElement>('input[aria-label="Rename tag renovation"]');
      return input && document.activeElement === input && input.selectionStart === 0 && input.selectionEnd === input.value.length;
    }));
    const rename = await $('input[aria-label="Rename tag renovation"]');
    const renameLocation = await rename.getLocation();
    expect(Math.abs(renameLocation.y - chipLocation.y)).toBeLessThan(6);
    expect(Math.abs(renameLocation.x - chipLocation.x)).toBeLessThan(35);
    expect(await $('input[aria-label="Add tag"]').getValue()).toBe('');
    await browser.keys('budget');
    await browser.keys('Enter');
    await $('button[aria-label="Edit tag budget"]').waitForExist();
    await browser.waitUntil(async () => JSON.stringify((await saves()).at(-1)?.args.tagEdit).includes('budget'));
    await browser.saveScreenshot('/tmp/gneauxghts-note-tags.png');
    await toggleTags();
    await row().waitForExist({ reverse: true });
    await toggleTags();
    await $('button[aria-label="Edit tag budget"]').waitForExist();
    await $('button[aria-label="Remove tag budget"]').waitForClickable();
    await $('button[aria-label="Remove tag budget"]').click();
    await $('button[aria-label="Edit tag budget"]').waitForExist({ reverse: true });
    await browser.waitUntil(async () => JSON.stringify((await saves()).at(-1)?.args.tagEdit) === JSON.stringify({ previous: ['budget'], tags: [] }));
    expect(await $('[data-testid="note-editor"] .cm-content').getText()).toBe(before);
  });
  it('fits the revealed row inside a narrow note pane', async () => {
    const original = await browser.getWindowSize();
    try {
      await browser.setWindowSize(390, 844);
      await toggleTags();
      const input = await $('input[aria-label="Add tag"]');
      await input.waitForClickable();
      await input.setValue('renovation');
      await browser.keys('Enter');
      await $('button[aria-label="Edit tag renovation"]').waitForExist();
      const geometry = await browser.execute(() => {
        const row = document.querySelector<HTMLElement>('[data-testid="note-tags"]')!;
        const shell = document.querySelector<HTMLElement>('[data-testid="workspace-pane"]')!;
        const line = document.querySelector<HTMLElement>('[data-testid="note-editor"] .cm-line')!;
        return { row: row.getBoundingClientRect().toJSON(), pane: shell.getBoundingClientRect().toJSON(), line: line.getBoundingClientRect().toJSON(), overflow: row.scrollWidth > row.clientWidth };
      });
      expect(geometry.overflow).toBe(false);
      expect(geometry.row.left).toBeGreaterThanOrEqual(geometry.pane.left);
      expect(geometry.row.right).toBeLessThanOrEqual(geometry.pane.right + 1);
      expect(geometry.line.top).toBeGreaterThanOrEqual(geometry.row.bottom);
      await browser.saveScreenshot('/tmp/gneauxghts-note-tags-mobile.png');
    } finally {
      await browser.setWindowSize(original.width, original.height);
    }
  });

  it('scrolls tags with the note and shares visibility across panes, notes, and reloads', async () => {
    await toggleTags();
    const before = await $('[data-testid="note-tags"]').getLocation('y');
    await browser.execute(() => {
      document.querySelector<HTMLElement>('[data-testid="note-editor"] .cm-scroller')!.scrollTop = 400;
    });
    await browser.waitUntil(async () => (await $('[data-testid="note-tags"]').getLocation('y')) < before - 300);
    await browser.execute(() => {
      document.querySelector<HTMLElement>('[data-testid="note-editor"] .cm-scroller')!.scrollTop = 0;
    });
    await $('button[aria-label="Open split pane options"]').moveTo();
    await $('button[aria-label="Split with current location"]').waitForClickable();
    await $('button[aria-label="Split with current location"]').click();
    await browser.waitUntil(async () => (await $$('[data-testid="note-tags"]').length) === 2);
    await toggleTags();
    await browser.waitUntil(async () => (await $$('[data-testid="note-tags"]').length) === 0);
    await toggleTags();
    await browser.waitUntil(async () => (await $$('[data-testid="note-tags"]').length) === 2);
    await browser.refresh();
    await $('[data-testid="note-tags"]').waitForDisplayed();
    const search = await $('[data-testid="note-search-input"]');
    await search.setValue('Beta note');
    const result = await $('button[aria-label="Open search result: Beta note.md"]');
    await result.waitForClickable();
    await result.click();
    await browser.waitUntil(async () => (await $('[data-testid="note-title"]').getValue()) === 'Beta note');
    await $('[data-testid="note-tags"]').waitForDisplayed();
  });

  it('sends both tag aliases from All notes search with the open note tags', async () => {
    await toggleTags();
    await $('input[aria-label="Add tag"]').setValue('renovation');
    await browser.keys('Enter');
    await $('button[aria-label="Edit tag renovation"]').waitForExist();
    const search = await $('[data-testid="note-search-input"]');
    for (const query of ['#renovation', 'tag:renovation']) {
      await search.setValue(query);
      const result = await $('button[aria-label="Open search result: Alpha note.md"]');
      await result.waitForDisplayed();
      await browser.waitUntil(async () => browser.execute((expected) => {
        const invocation = window.__GNEAUXGHTS_E2E__!.invocations.filter((entry) => entry.command === 'search_notes_hybrid').at(-1);
        return invocation?.args.query === expected && JSON.stringify(invocation.args.currentTags) === '["renovation"]';
      }, query));
    }
  });

});
