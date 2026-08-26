import { browser, expect, $ } from '@wdio/globals';

async function waitForNote(title: string) {
  const input = await $('[data-testid="note-title"]');
  await input.waitForDisplayed();
  await browser.waitUntil(async () => (await input.getValue()) === title, {
    timeoutMsg: `Expected active note title to become ${title}`
  });
}

async function openRecentNote(title: string) {
  const search = await $('[data-testid="note-search-input"]');
  await search.click();
  const allNotes = await $('button[aria-label="Search all notes"]');
  await allNotes.waitForExist();
  await browser.execute((element: HTMLElement) => element.click(), allNotes);
  await search.setValue(title);
  const result = await $(`button[aria-label="Open search result: ${title}.md"]`);
  await result.waitForExist();
  await browser.execute((element: HTMLElement) => element.click(), result);
  await waitForNote(title);
}

async function editorText() {
  const editor = await $('[data-testid="note-editor"] .cm-content');
  await editor.waitForDisplayed();
  return editor.getText();
}

describe('document and pane state-machine boundaries', () => {
  beforeEach(async () => {
    await browser.url('/');
    await waitForNote('Alpha note');
  });

  it('keeps note content isolated while switching repeatedly', async () => {
    const alphaText = await editorText();
    expect(alphaText).toContain('Alpha line 1');

    await openRecentNote('Beta note');
    const betaText = await editorText();
    expect(betaText).toContain('Beta body is independent from Alpha.');
    expect(betaText).not.toContain('Alpha line 1');

    await openRecentNote('Alpha note');
    expect(await editorText()).toBe(alphaText);

    await openRecentNote('Beta note');
    expect(await editorText()).toBe(betaText);
  });

  it('restores editor scroll after a note to chat to note lifecycle', async () => {
    const scroller = await $('[data-testid="note-editor"] .cm-scroller');
    await scroller.waitForDisplayed();
    await browser.execute((element: HTMLElement) => {
      element.scrollTop = Math.max(400, element.scrollHeight * 0.65);
      element.dispatchEvent(new Event('scroll'));
    }, scroller);
    await browser.pause(100);
    const before = await browser.execute((element: HTMLElement) => element.scrollTop, scroller);
    expect(before).toBeGreaterThan(0);
    const openChat = await $('button[aria-label="Open thought partner in this pane"]');
    await openChat.waitForClickable();
    await browser.execute((element: HTMLElement) => element.click(), openChat);
    const chatPane = await $('[data-testid="workspace-pane"][data-pane-kind="chat"]');
    await chatPane.waitForExist();

    const captured = await browser.execute(() => {
      const raw = window.localStorage.getItem('gneauxghts:notepad-cursors:v1');
      if (!raw) return 0;
      const entries = Object.values(JSON.parse(raw)) as Array<{ scrollTop?: number }>;
      return Math.max(0, ...entries.map((entry) => entry.scrollTop ?? 0));
    });
    expect(Math.abs(captured - before)).toBeLessThanOrEqual(2);

    const previous = await $('button[aria-label="Open previous location"]');
    await previous.waitForExist();
    await browser.execute((element: HTMLElement) => element.click(), previous);
    await waitForNote('Alpha note');

    const restoredScroller = await $('[data-testid="note-editor"] .cm-scroller');
    await browser.waitUntil(
      async () => {
        const restored = await browser.execute(
          (element: HTMLElement) => element.scrollTop,
          restoredScroller
        );
        return Math.abs(restored - before) <= 2;
      },
      { timeoutMsg: 'Expected the editor scroll position to be restored' }
    );
  });
});
