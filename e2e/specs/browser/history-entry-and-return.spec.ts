import { browser, expect, $, $$ } from '@wdio/globals';
import { resetBrowserWorkspace, openHistoryShortcut, editorText, setEditorSelection, readEditorSelection } from '../../support/browserWorkspace';

describe('History entry, layout and workspace return', () => {
  beforeEach(resetBrowserWorkspace);

  it('opens history with Cmd+Shift+H only from an editor pane', async () => {
    await $('[data-testid="note-editor"] .cm-content').click();
    // Dispatch logical keys: the host keyboard layout remaps WebDriver's H to D.
    const showHistory = () => browser.execute(() => {
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'H', code: 'KeyH', metaKey: true, shiftKey: true,
        bubbles: true, cancelable: true
      }));
    });
    await showHistory();
    await $('[data-testid="historical-revision-diff"]').waitForExist();
    await browser.keys('Escape');
    await $('[data-testid="history-mode"]').waitForExist({ reverse: true });

    await browser.execute(() => {
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', {
        key: 't', code: 'KeyT', metaKey: true, bubbles: true, cancelable: true
      }));
    });
    await $('[data-testid="workspace-pane"][data-pane-kind="chat"]').waitForExist();
    await showHistory();
    expect(await $('[data-testid="history-mode"]').isExisting()).toBe(false);
  });

  it('returns keyboard focus to Note options after opening history from its menu', async () => {
    await $('button[aria-label="Note options"]').click();
    await $('[role="menuitem"][aria-label="Open note history"]').click();
    await $('[data-testid="historical-revision-diff"]').waitForExist();
    await browser.keys('Escape');
    await $('[data-testid="history-mode"]').waitForExist({ reverse: true });
    await browser.waitUntil(async () => browser.execute(() =>
      document.activeElement === document.querySelector('button[aria-label="Note options"]')
    ));
  });

  for (const layout of [
    { name: 'desktop with Related collapsed', width: 1280, expandRelated: false },
    { name: 'desktop with Related expanded', width: 1280, expandRelated: true },
    { name: 'mobile', width: 390, expandRelated: false }
  ]) {
    it(`keeps the editor frame width in history on ${layout.name}`, async () => {
      const originalSize = await browser.getWindowSize();
      try {
        await browser.setWindowSize(layout.width, 844);
        if (layout.expandRelated) {
          await $('button[aria-label="Related notes"]').click();
          await $('button[aria-label="Search notes"]').waitForClickable();
        }
        const card = await $('[data-testid="workspace-card"]');
        await browser.waitUntil(async () => browser.execute(
          (element: HTMLElement) => element.getAnimations().length === 0, card
        ));
        const before = await card.getSize();
        const position = await card.getLocation();

        await openHistoryShortcut();
        const history = await $('[data-testid="history-mode"]');
        await $('[data-testid="historical-revision-diff"]').waitForExist();
        expect((await history.getSize()).width).toBeCloseTo(before.width, 0);
        expect((await history.getLocation()).x).toBeCloseTo(position.x, 0);
        expect((await card.getSize()).width).toBeCloseTo(before.width, 0);

        expect(await $('button[aria-label="Related notes"]').isExisting()).toBe(false);

        await $('button[aria-label="Back to workspace"]').click();
        await history.waitForExist({ reverse: true });
        const relatedToggle = await $('button[aria-label="Related notes"]');
        await relatedToggle.waitForExist();
        expect(await relatedToggle.getAttribute('aria-expanded')).toBe('false');
        expect((await card.getSize()).width).toBeCloseTo(before.width, 0);
        expect((await card.getLocation()).x).toBeCloseTo(position.x, 0);
      } finally {
        await browser.setWindowSize(originalSize.width, originalSize.height);
      }
    });
  }

  it('restores collapsed, ranged, and reversed editor selections after refreshed history', async () => {
    const expectedMarkdown = await browser.execute(() =>
      window.__GNEAUXGHTS_E2E__?.snapshot().notes.find(
        (note) => note.noteId === 'note-alpha'
      )?.markdown
    );

    const roundTrip = async (
      anchor: number,
      head: number,
      { refresh = false, scroll = false } = {}
    ) => {
      const expectedSelection = await setEditorSelection(anchor, head);
      const scroller = await $('[data-testid="note-editor"] .cm-scroller');
      if (scroll) {
        await browser.execute((element: HTMLElement) => {
          element.scrollTop = Math.max(320, element.scrollHeight * 0.6);
          element.dispatchEvent(new Event('scroll'));
        }, scroller);
      }
      const expectedScroll = await browser.execute(
        (element: HTMLElement) => element.scrollTop,
        scroller
      );

      await openHistoryShortcut();
      const history = await $('[data-testid="history-mode"]');
      await history.waitForExist();
      await $('[data-testid="historical-revision-diff"]').waitForExist({ timeout: 20_000 });

      if (refresh) {
        const callsBefore = await browser.execute(() =>
          (window.__GNEAUXGHTS_E2E__?.invocations ?? []).filter(
            (entry) => entry.command === 'get_note_history_page'
          ).length
        );
        await browser.execute(() => {
          window.__GNEAUXGHTS_E2E__?.delayNextHistoryPage();
          window.dispatchEvent(new Event('focus'));
        });
        const loadMore = await $('button=Load older history');
        await browser.waitUntil(async () => !(await loadMore.isEnabled()), {
          interval: 10,
          timeoutMsg: 'Expected History Mode refresh to become active'
        });
        await browser.waitUntil(async () => {
          const callsAfter = await browser.execute(() =>
            (window.__GNEAUXGHTS_E2E__?.invocations ?? []).filter(
              (entry) => entry.command === 'get_note_history_page'
            ).length
          );
          return callsAfter > callsBefore;
        });
        await loadMore.waitForEnabled({
          timeoutMsg: 'Expected History Mode refresh to complete before exit'
        });
      }

      await $('button[aria-label="Back to workspace"]').click();
      await history.waitForExist({ reverse: true });
      try {
        await browser.waitUntil(
          async () => {
            const restored = await readEditorSelection();
            return (
              restored?.anchor === expectedSelection.anchor &&
              restored.head === expectedSelection.head
            );
          },
          { timeoutMsg: 'Expected exact editor selection direction to be restored' }
        );
      } catch (error) {
        throw new Error(
          `Expected exact editor selection ${JSON.stringify(expectedSelection)}; received ${JSON.stringify(await readEditorSelection())}`,
          { cause: error }
        );
      }
      const restoredScroll = await browser.execute(
        (element: HTMLElement) => element.scrollTop,
        scroller
      );
      expect(Math.abs(restoredScroll - expectedScroll)).toBeLessThanOrEqual(2);
      const restoredMarkdown = await browser.execute(() =>
        window.__GNEAUXGHTS_E2E__?.snapshot().notes.find(
          (note) => note.noteId === 'note-alpha'
        )?.markdown
      );
      expect(restoredMarkdown).toBe(expectedMarkdown);
    };

    await roundTrip(6, 6);
    await roundTrip(2, 12);
    await roundTrip(14, 4, { refresh: true, scroll: true });
  });

  it('confirms a complete Version Restore and isolates ordinary editor undo', async () => {
    await openHistoryShortcut();
    const history = await $('[data-testid="history-mode"]');
    await history.waitForExist();
    await $('[data-revision-id="note-alpha-revision-34"]').click();
    await browser.waitUntil(async () =>
      (await $('[data-testid="historical-revision-diff"]').getText()).includes(
        'Historical revision 34'
      )
    );

    await $('button=Restore this version…').click();
    const preview = await $('[aria-label="Restore version preview"]');
    await preview.waitForExist();
    expect(await preview.getText()).toContain('Historical revision 34 of Alpha note');
    expect(await preview.getText()).toContain('Restore version');
    expect(await preview.$$('textarea')).toHaveLength(0);
    const previewToggle = await $('button=Restore this version…');
    expect(await previewToggle.getAttribute('aria-expanded')).toBe('true');
    await previewToggle.click();
    await preview.waitForExist({ reverse: true });
    expect(await previewToggle.getAttribute('aria-expanded')).toBe('false');
    await previewToggle.click();
    await preview.waitForExist();
    await preview.$('button=Restore version').click();
    await browser.waitUntil(async () => (await history.getText()).includes('Restored version'));

    await $('button[aria-label="Back to workspace"]').click();
    await history.waitForExist({ reverse: true });
    const restoredText = await editorText();
    expect(restoredText).toContain('Historical revision 34 of Alpha note');
    const editor = await $('[data-testid="note-editor"] .cm-content');
    await editor.click();
    const focusedRestoredText = await editorText();
    await browser.keys(['Meta', 'z']);
    expect(await editorText()).toBe(focusedRestoredText);

    const restoreInvocation = await browser.execute(() =>
      window.__GNEAUXGHTS_E2E__?.invocations.find(
        (entry) => entry.command === 'restore_note_revision'
      )
    );
    expect(restoreInvocation?.args).toMatchObject({
      noteId: 'note-alpha',
      revisionId: 'note-alpha-revision-34',
      confirmed: true
    });
  });
});
