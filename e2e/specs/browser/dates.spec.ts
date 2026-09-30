import { browser, expect, $ } from '@wdio/globals';

async function editorText(value: string) {
  const content = await $('[data-testid="note-editor"] .cm-content');
  await content.waitForDisplayed();
  await content.click();
  await browser.execute((element: HTMLElement, text: string) => {
    element.focus(); document.execCommand('selectAll'); document.execCommand('insertText', false, text);
  }, content, value);
}
async function savedMarkdown() {
  return browser.execute(() => {
    const snapshot = window.__GNEAUXGHTS_E2E__!.snapshot();
    return snapshot.notes.find((note) => note.noteId === snapshot.activeNoteId)!.markdown;
  });
}
async function waitForSaved(text: string) { await browser.waitUntil(async () => (await savedMarkdown()).includes(text)); }

describe('date commands and chip pickers', () => {
  afterEach(async () => { if (await $('dialog.date-time-picker').isExisting()) { await browser.keys('Escape'); await $('dialog.date-time-picker').waitForExist({ reverse: true }); } });
  before(async () => { await browser.url('/'); await $('[data-testid="note-editor"] .cm-content').waitForDisplayed(); });

  it('inserts fixed date/time text and edits its chip by typing and selecting', async () => {
    await editorText('Meeting /now');
    await $('.slash-panel').waitForDisplayed();
    await browser.keys('Enter');
    await $('.slash-panel').waitForExist({ reverse: true });
    await browser.keys(['Enter', 'x']);
    const chip = await $('button[aria-label^="Edit date and time:"]');
    await chip.waitForDisplayed();
    await chip.click();
    await $('dialog.date-time-picker').waitForDisplayed();
    await $('[aria-label="Date or shortcut"]').setValue('2026-10-02');
    await $('[aria-label="Time"]').setValue('14:30');
    await $('button=Apply').click();
    await $('dialog.date-time-picker').waitForExist({ reverse: true });
    const expected = await browser.execute(() => new Intl.DateTimeFormat(undefined, { year: 'numeric', month: '2-digit', day: '2-digit', calendar: 'gregory', numberingSystem: 'latn' }).format(new Date(2026, 9, 2)));
    await waitForSaved(expected);
    expect(await savedMarkdown()).not.toContain('@due(');
  });

  it('keeps slash text on cancel, applies a shortcut, reopens a due chip and removes it', async () => {
    await editorText('- [ ] Proposal /due');
    await $('.slash-panel').waitForDisplayed();
    await browser.keys('Enter');
    await $('dialog.date-time-picker').waitForDisplayed();
    await browser.keys('Escape');
    await $('dialog.date-time-picker').waitForExist({ reverse: true });
    await waitForSaved('/due');
    const addDate = await $('button[aria-label="Add due date"]');
    await addDate.moveTo();
    await addDate.click();
    await $('dialog.date-time-picker').waitForDisplayed();
    await $('[aria-label="Date or shortcut"]').setValue('Friday');
    await $('p*=Selected:').waitForDisplayed();
    await $('[data-testid="date-picker-next-month"]').click();
    const day = await $('dialog [data-bits-day]:not([data-outside-month])');
    await day.click();
    await $('button=Apply').click();
    await waitForSaved('@due(');
    await browser.keys(['Enter', 'x']);
    const chip = await $('button[aria-label^="Edit due date:"]');
    await chip.waitForDisplayed();
    await chip.click();
    await $('button=Remove due date').click();
    await $('dialog.date-time-picker').waitForExist({ reverse: true });
    await browser.waitUntil(async () => !(await savedMarkdown()).includes('@due('));
    await browser.keys(['Meta', 'z']);
    await waitForSaved('@due(');
  });

  it('composes task-list deadline and completion filters and edits dates through the picker', async () => {
    await editorText('- [ ] Late @due(2000-01-01)\n- [x] Done @due(2000-01-01)\n- [ ] Undated');
    await waitForSaved('Undated');
    await $('a[href="/list"]').click();
    await $('[aria-label="Due date filter"]').waitForDisplayed();
    await $('[aria-label="Due date filter"]').selectByAttribute('value', 'overdue');
    await expect($('.task-row')).toHaveText(expect.stringContaining('Late'));
    expect(await browser.$$('.task-row')).toHaveLength(1);
    await $('button[aria-label="Edit due date: 2000-01-01"]').click();
    await $('[aria-label="Date or shortcut"]').setValue('2099-01-01');
    await $('button=Apply').click();
    await $('dialog.date-time-picker').waitForExist({ reverse: true });
    await $('[aria-label="Due date filter"]').selectByAttribute('value', 'upcoming');
    await expect($('.task-row')).toHaveText(expect.stringContaining('Late'));
    await $('[aria-label="Due date filter"]').selectByAttribute('value', 'undated');
    await expect($('.task-row')).toHaveText(expect.stringContaining('Undated'));
  });
  it('preserves inline surroundings and block commands, dismisses slash text and excludes code/URLs', async () => {
    await $('a[href="/"]').click();
    await editorText('Before /date after');
    await browser.keys(Array.from({ length: 6 }, () => 'ArrowLeft'));
    await $('.slash-panel').waitForDisplayed();
    await browser.keys('Enter');
    await waitForSaved(' after');
    await browser.waitUntil(async () => !(await savedMarkdown()).includes('/date'));
    expect(await savedMarkdown()).toMatch(/^Before .+ after$/);
    await editorText('/heading 1');
    await $('.slash-panel').waitForDisplayed();
    await browser.keys('Enter');
    await waitForSaved('# ');
    await editorText('- [ ] Captured /today');
    await $('.slash-panel').waitForDisplayed();
    await browser.keys('Enter');
    await browser.waitUntil(async () => !(await savedMarkdown()).includes('/today'));
    expect(await savedMarkdown()).not.toContain('@due(');
    await editorText('Keep /date');
    await $('.slash-panel').waitForDisplayed();
    await browser.keys('Escape');
    await browser.keys('x');
    await $('.slash-panel').waitForExist({ reverse: true });
    await waitForSaved('/datex');
    await editorText('```text\n/date');
    await $('.slash-panel').waitForExist({ reverse: true });
    await editorText('https://example.com/date');
    await $('.slash-panel').waitForExist({ reverse: true });
  });

});
