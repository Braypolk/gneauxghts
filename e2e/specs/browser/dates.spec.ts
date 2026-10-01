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

async function pickerGeometry(anchorSelector: string) {
  return browser.execute((selector: string) => {
    const panel = document.querySelector<HTMLDialogElement>('dialog.date-time-picker')!;
    const anchor = document.querySelector<HTMLElement>(selector);
    const rect = panel.getBoundingClientRect();
    const reference = anchor?.getBoundingClientRect() ?? window.getSelection()!.getRangeAt(0).getBoundingClientRect();
    return {
      left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
      anchorTop: reference.top, anchorBottom: reference.bottom,
      viewportWidth: innerWidth, viewportHeight: innerHeight,
      modal: panel.matches(':modal'),
      background: getComputedStyle(document.querySelector('.date-time-picker-root')!).backgroundColor,
      focused: panel.contains(document.activeElement) || !!document.activeElement?.closest('.cm-editor')
    };
  }, anchorSelector);
}

async function expectAnchoredPicker(anchorSelector: string) {
  await $('dialog.date-time-picker').waitForDisplayed();
  await browser.waitUntil(async () => (await pickerGeometry(anchorSelector)).focused);
  const geometry = await pickerGeometry(anchorSelector);
  expect(geometry.modal).toBe(false);
  expect(geometry.background).toBe('rgba(0, 0, 0, 0)');
  expect(geometry.left).toBeGreaterThanOrEqual(15);
  expect(geometry.right).toBeLessThanOrEqual(geometry.viewportWidth - 15);
  expect(geometry.top).toBeGreaterThanOrEqual(15);
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewportHeight - 15);
  expect(Math.min(Math.abs(geometry.top - geometry.anchorBottom - 10), Math.abs(geometry.anchorTop - geometry.bottom - 10))).toBeLessThanOrEqual(1);
}

describe('date commands and chip pickers', () => {
  afterEach(async () => { if (await $('dialog.date-time-picker').isExisting()) { await browser.keys('Escape'); await $('dialog.date-time-picker').waitForExist({ reverse: true }); } });
  before(async () => {
    await browser.url('/');
    await $('[data-testid="note-editor"] .cm-content').waitForDisplayed({ timeout: 30_000 });
  });

  it('inserts fixed date/time text and edits its chip by typing and selecting', async () => {
    await editorText('Meeting /now');
    await $('.slash-panel').waitForDisplayed();
    await browser.keys('Enter');
    await $('.slash-panel').waitForExist({ reverse: true });
    await browser.keys(['Enter', 'x']);
    const chip = await $('button[aria-label^="Edit date and time:"]');
    await chip.waitForDisplayed();
    const chipStyle = await browser.execute((element: HTMLElement) => ({
      fontSize: getComputedStyle(element).fontSize,
      lineFontSize: getComputedStyle(element.closest('.cm-line')!).fontSize,
      background: getComputedStyle(element).backgroundColor,
      border: getComputedStyle(element).borderWidth
    }), chip);
    expect(chipStyle.fontSize).toBe(chipStyle.lineFontSize);
    expect(chipStyle.background).toBe('rgba(0, 0, 0, 0)');
    expect(chipStyle.border).toBe('0px');
    await chip.click();
    await expectAnchoredPicker('button[aria-label^="Edit date and time:"]');
    const beforeCancel = await savedMarkdown();
    expect(await $('[aria-label="Date or shortcut"]').isExisting()).toBe(false);
    await $('[aria-label="Time"]').setValue('00:01');
    await browser.action('pointer').move({ x: 5, y: 5 }).down().up().perform();
    await $('dialog.date-time-picker').waitForExist({ reverse: true });
    expect(await savedMarkdown()).toBe(beforeCancel);
    await $('.cm-line:last-child').click();
    await chip.waitForDisplayed();
    await chip.click();
    await expectAnchoredPicker('button[aria-label^="Edit date and time:"]');
    const expected = await browser.execute(() => {
      const day = document.querySelector<HTMLButtonElement>('dialog [data-bits-day]:not([data-outside-month]):not([data-selected])')!;
      const date = day.getAttribute('data-value')!;
      day.click();
      return new Intl.DateTimeFormat(undefined, { year: 'numeric', month: '2-digit', day: '2-digit', calendar: 'gregory', numberingSystem: 'latn', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
    });
    await $('[aria-label="Time"]').setValue('14:30');
    await $('button=Apply').click();
    await $('dialog.date-time-picker').waitForExist({ reverse: true });
    await waitForSaved(expected);
    expect(await savedMarkdown()).not.toContain('@due(');
  });

  it('selects a date in the note for direct typing and preserves neighboring dates and undo', async () => {
    const dates = await browser.execute(() => [24, 30].map((day) => new Intl.DateTimeFormat(undefined, { year: 'numeric', month: '2-digit', day: '2-digit', calendar: 'gregory', numberingSystem: 'latn' }).format(new Date(2026, 8, day))));
    const original = `Email sent ${dates[0]} and ${dates[1]}\nOther notes`;
    await editorText(original);
    await waitForSaved(original);
    const chip = await $('button[aria-label^="Edit date:"]');
    await chip.click();
    await $('dialog.date-time-picker').waitForDisplayed();
    expect(await $('[aria-label="Date or shortcut"]').isExisting()).toBe(false);
    expect(await browser.execute(() => window.getSelection()!.toString())).toBe(dates[0]);
    expect(await browser.execute(() => document.activeElement?.classList.contains('cm-content'))).toBe(true);
    await $('.selection-panel').waitForExist({ reverse: true });
    await browser.keys(Array.from(dates[1]));
    await $('dialog.date-time-picker').waitForExist({ reverse: true });
    await waitForSaved(`Email sent ${dates[1]} and ${dates[1]}\nOther notes`);
    await browser.keys(['Meta', 'z']);
    await waitForSaved(original);
  });

  it('navigates with month/year dropdowns and applies a leap-day choice', async () => {
    const originalDate = await browser.execute(() => new Intl.DateTimeFormat(undefined, { year: 'numeric', month: '2-digit', day: '2-digit', calendar: 'gregory', numberingSystem: 'latn' }).format(new Date(2026, 8, 24)));
    const original = `Meeting ${originalDate}\nOther notes`;
    await editorText(original);
    await waitForSaved(original);
    await $('button[aria-label^="Edit date:"]').click();
    await $('dialog.date-time-picker').waitForDisplayed();
    await $('[aria-label="Calendar month"]').selectByAttribute('value', '2');
    await $('[aria-label="Calendar year"]').selectByAttribute('value', '2028');
    await $('[data-testid="date-picker-next-month"]').click();
    expect(await $('[aria-label="Calendar month"]').getValue()).toBe('3');
    await $('[data-testid="date-picker-previous-month"]').click();
    expect(await $('[aria-label="Calendar month"]').getValue()).toBe('2');
    expect(await savedMarkdown()).toBe(original);
    await $('dialog [data-bits-day][data-value="2028-02-29"]').click();
    await $('button=Apply').click();
    await $('dialog.date-time-picker').waitForExist({ reverse: true });
    const chosen = await browser.execute(() => new Intl.DateTimeFormat(undefined, { year: 'numeric', month: '2-digit', day: '2-digit', calendar: 'gregory', numberingSystem: 'latn' }).format(new Date(2028, 1, 29)));
    await waitForSaved(`Meeting ${chosen}\nOther notes`);
  });

  it('dismisses on the same click that places the caret or focuses another input', async () => {
    const time = await browser.execute(() => new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', numberingSystem: 'latn' }).format(new Date(2026, 8, 30, 9, 30)));
    await editorText(`Target line\nMeeting ${time}\nTail`);
    await waitForSaved('Target line');
    const chip = await $('button[aria-label^="Edit time:"]');
    await chip.waitForDisplayed();
    await chip.click();
    await $('dialog.date-time-picker').waitForDisplayed();
    await $('[aria-label="Time"]').setValue('00:01');
    await $('.cm-line').click();
    await $('dialog.date-time-picker').waitForExist({ reverse: true });
    await browser.keys('!');
    await waitForSaved(`Target line!\nMeeting ${time}\nTail`);

    await chip.click();
    await $('dialog.date-time-picker').waitForDisplayed();
    const title = await $('[data-testid="note-title"]');
    await title.click();
    await $('dialog.date-time-picker').waitForExist({ reverse: true });
    expect(await browser.execute((element: HTMLElement) => document.activeElement === element, title)).toBe(true);
  });

  it('flips a time picker above a low anchor and follows editor scrolling', async () => {
    const windowSize = await browser.getWindowSize();
    try {
      await browser.setWindowSize(1000, 700);
      await editorText(`${'A line of notes\n'.repeat(35)}Reminder /time`);
      await $('.slash-panel').waitForDisplayed();
      await browser.keys('Enter');
      await browser.keys(['Enter', 'x']);
      const selector = 'button[aria-label^="Edit time:"]';
      const chip = await $(selector);
      await chip.waitForDisplayed();
      await chip.scrollIntoView({ block: 'center' });
      await chip.click();
      await expectAnchoredPicker(selector);
      await browser.execute((anchorSelector: string) => {
        const scroller = document.querySelector<HTMLElement>('.cm-scroller')!;
        const anchor = document.querySelector(anchorSelector);
        const bar = document.querySelector('.notepad-command-bar-content')!;
        const bottom = Math.min(scroller.getBoundingClientRect().bottom, bar.getBoundingClientRect().top) - 30;
        const reference = anchor?.getBoundingClientRect() ?? window.getSelection()!.getRangeAt(0).getBoundingClientRect();
        scroller.scrollTop += reference.bottom - bottom;
      }, selector);
      await browser.waitUntil(async () => {
        const geometry = await pickerGeometry(selector);
        return geometry.top < geometry.anchorTop && Math.abs(geometry.anchorTop - geometry.bottom - 10) <= 1;
      });
      const before = await pickerGeometry(selector);
      expect(before.top).toBeLessThan(before.anchorTop);
      await browser.execute(() => { document.querySelector('.cm-scroller')!.scrollTop += 50; });
      await browser.waitUntil(async () => {
        const after = await pickerGeometry(selector);
        return Math.abs(after.top - before.top) > 20 && Math.min(Math.abs(after.anchorTop - after.bottom - 10), Math.abs(after.top - after.anchorBottom - 10)) <= 1;
      });
      await expectAnchoredPicker(selector);
      await browser.keys('Escape');
      await $('dialog.date-time-picker').waitForExist({ reverse: true });
    } finally { await browser.setWindowSize(windowSize.width, windowSize.height); }
  });

  it('keeps slash text on cancel, applies a shortcut, reopens a due chip and removes it', async () => {
    await editorText('- [ ] Proposal /due');
    await $('.slash-panel').waitForDisplayed();
    await browser.keys('Enter');
    await $('dialog.date-time-picker').waitForDisplayed();
    expect((await browser.execute(() => document.querySelector('dialog.date-time-picker')!.getBoundingClientRect().left))).toBeGreaterThan(15);
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
