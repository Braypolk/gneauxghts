import { browser, expect, $, $$ } from '@wdio/globals';
import { resetBrowserWorkspace, waitForNote, openRecentNote, editorText } from '../../support/browserWorkspace';

describe('workspace document lifetime', () => {
  beforeEach(resetBrowserWorkspace);

  it('keeps Forget confirmation open until the user cancels or confirms', async () => {
    const forget = await $('button[aria-label^="Forget this note."]');
    const dialog = await $('#forget-confirm-popover');
    const forgetCalls = () => browser.execute(() =>
      window.__GNEAUXGHTS_E2E__!.invocations.filter((entry) => entry.command === 'forget_note')
    );
    const originalText = await editorText();

    await forget.click();
    await dialog.waitForDisplayed();
    await expect(dialog.$('button=Cancel')).toBeFocused();
    expect(await forgetCalls()).toHaveLength(0);
    await dialog.$('button=Cancel').click();
    await dialog.waitForExist({ reverse: true });
    await expect(forget).toBeFocused();
    expect(await editorText()).toBe(originalText);
    expect(await forgetCalls()).toHaveLength(0);

    await forget.click();
    await dialog.waitForDisplayed();
    await dialog.$('button=Forget').click();
    await dialog.waitForExist({ reverse: true });
    await browser.waitUntil(async () => (await forgetCalls()).length === 1);
    expect((await forgetCalls())[0].args.currentPath).toBe('/e2e/alpha.md');
  });

  it('holds Forget to skip confirmation', async () => {
    const forget = await $('button[aria-label^="Forget this note."]');
    await browser.action('pointer')
      .move({ origin: forget })
      .down()
      .pause(1500)
      .up()
      .perform();
    await browser.waitUntil(async () => browser.execute(() =>
      window.__GNEAUXGHTS_E2E__!.invocations.some((entry) => entry.command === 'forget_note')
    ));
    expect(await $('#forget-confirm-popover').isExisting()).toBe(false);
    expect(await browser.execute(() =>
      window.__GNEAUXGHTS_E2E__!.invocations.filter((entry) => entry.command === 'forget_note').length
    )).toBe(1);
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
    let before = 0;
    await browser.waitUntil(async () => {
      await browser.execute((element: HTMLElement) => {
        element.scrollTop = Math.max(400, element.scrollHeight * 0.65);
        element.dispatchEvent(new Event('scroll'));
      }, scroller);
      // Initial cursor restoration can still settle after the editor mounts.
      // Start the lifecycle check only once our scroll position survives it.
      await browser.pause(100);
      before = await browser.execute((element: HTMLElement) => element.scrollTop, scroller);
      return before > 0;
    }, { timeoutMsg: 'Expected the long note editor scroll position to settle' });
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
