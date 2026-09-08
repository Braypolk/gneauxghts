import { browser, expect, $ } from '@wdio/globals';

async function waitForNote(title: string) {
  const input = await $('[data-testid="note-title"]');
  try {
    // Cold Vite module loading can exceed the ordinary interaction timeout.
    await input.waitForDisplayed({ timeout: 30_000 });
  } catch (error) {
    const pageText = await browser.execute(() => document.body.innerText);
    throw new Error(`Note editor did not render. Page text: ${pageText}`, {
      cause: error
    });
  }
  await browser.waitUntil(async () => (await input.getValue()) === title, {
    timeoutMsg: `Expected active note title to become ${title}`
  });
  await $('span=Loading editor').waitForExist({ reverse: true });
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

async function setEditorSelection(anchor: number, head: number) {
  const content = await $('[data-testid="note-editor"] .cm-content');
  await content.click();
  await browser.keys(['Meta', 'a', '\uE000']);
  await browser.keys('ArrowLeft');
  if (anchor > 0) await browser.keys(Array.from({ length: anchor }, () => 'ArrowRight'));
  const distance = head - anchor;
  if (distance > 0) {
    await browser.keys([
      'Shift',
      ...Array.from({ length: distance }, () => 'ArrowRight'),
      '\uE000'
    ]);
  } else if (distance < 0) {
    await browser.keys([
      'Shift',
      ...Array.from({ length: -distance }, () => 'ArrowLeft'),
      '\uE000'
    ]);
  }
  await browser.pause(60);
  return { anchor, head };
}

async function readEditorSelection() {
  const content = await $('[data-testid="note-editor"] .cm-content');
  return browser.execute((element: HTMLElement) => {
    const selection = window.getSelection();
    if (
      !selection?.anchorNode ||
      !selection.focusNode ||
      !element.contains(selection.anchorNode) ||
      !element.contains(selection.focusNode)
    ) {
      return null;
    }
    return {
      anchor: selection.anchorOffset,
      head: selection.focusOffset
    };
  }, content);
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

  it('returns keyboard focus to the history toolbar control', async () => {
    const open = await $('button[aria-label="Open note history"]');
    await browser.execute((element: HTMLElement) => { element.focus(); element.click(); }, open);
    await $('[data-testid="historical-revision-diff"]').waitForExist();
    await browser.keys('Escape');
    await $('[data-testid="history-mode"]').waitForExist({ reverse: true });
    await browser.waitUntil(async () => browser.execute(() =>
      document.activeElement === document.querySelector('button[aria-label="Open note history"]')
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
          await $('button[aria-label="Expand related notes"]').click();
          await $('button[aria-label="Close related panel"]').waitForClickable();
        }
        const card = await $('[data-testid="workspace-card"]');
        await browser.waitUntil(async () => browser.execute(
          (element: HTMLElement) => element.getAnimations().length === 0, card
        ));
        const before = await card.getSize();
        const position = await card.getLocation();

        const openHistory = await $('button[aria-label="Open note history"]');
        // Match the existing history journeys: mobile shell chrome can overlap
        // this toolbar in the browser harness, independently of history layout.
        await browser.execute((element: HTMLElement) => element.click(), openHistory);
        const history = await $('[data-testid="history-mode"]');
        await $('[data-testid="historical-revision-diff"]').waitForExist();
        expect((await history.getSize()).width).toBeCloseTo(before.width, 0);
        expect((await history.getLocation()).x).toBeCloseTo(position.x, 0);
        expect((await card.getSize()).width).toBeCloseTo(before.width, 0);

        await $('button[aria-label="Back to workspace"]').click();
        await history.waitForExist({ reverse: true });
        expect((await card.getSize()).width).toBeCloseTo(before.width, 0);
        expect((await card.getLocation()).x).toBeCloseTo(position.x, 0);
      } finally {
        await browser.setWindowSize(originalSize.width, originalSize.height);
      }
    });
  }

  it('opens Revision Citations at exact evidence and leaves chat workspace context intact', async () => {
    await browser.execute(() => window.__GNEAUXGHTS_E2E__?.seedRevisionChat());
    const openChat = await $('button[aria-label="Open thought partner in this pane"]');
    await browser.execute((element: HTMLElement) => element.click(), openChat);
    const picker = await $('button[aria-label="Conversations"]');
    await picker.waitForClickable();
    await picker.click();
    await $('[role="menuitem"]').click();
    const citation = await $('[data-chat-note-citation-id="revision:note-beta:note-beta-revision-2"]');
    await citation.waitForClickable();
    const before = await browser.execute(() => window.__GNEAUXGHTS_E2E__?.snapshot());
    expect(await $('[data-testid="workspace-pane"][data-pane-kind="chat"]').getText()).not.toContain('removed confidential prose');
    await citation.click();
    const history = await $('[data-testid="history-mode"]');
    await history.waitForExist();
    expect(await history.getText()).toContain('removed confidential prose');
    const requests = await browser.execute(() => window.__GNEAUXGHTS_E2E__?.snapshot().invocations ?? []);
    expect(requests.some(entry => entry.command === 'get_note_history_diff' && entry.args.noteId === 'note-beta' && entry.args.revisionId === 'note-beta-revision-2')).toBe(true);
    expect(requests.filter(entry => entry.command === 'get_note_history_page' && entry.args.noteId === 'note-beta').length).toBe(0);
    expect(requests.filter(entry => entry.command === 'get_note_history_context' && entry.args.noteId === 'note-beta').length).toBe(1);
    expect(await $$('[data-revision-id]').length).toBeLessThanOrEqual(31);
    const originalIds = await $$('[data-revision-id]').map(row => row.getAttribute('data-revision-id'));
    await $('button=Load newer history').click();
    await browser.waitUntil(async () => !(await $('[data-revision-id="note-beta-revision-2"]').isExisting()));
    expect(await $$('[data-revision-id]').length).toBeLessThanOrEqual(31);
    await $('button=Load older history').click();
    await $('[data-revision-id="note-beta-revision-2"]').waitForExist();
    expect(await $$('[data-revision-id]').map(row => row.getAttribute('data-revision-id'))).toEqual(originalIds);
    const exit = await $('button[aria-label="Back to workspace"]');
    await exit.click();
    await history.waitForExist({ reverse: true });
    expect(await $('[data-testid="workspace-pane"][data-pane-kind="chat"]').isExisting()).toBe(true);
    const after = await browser.execute(() => window.__GNEAUXGHTS_E2E__?.snapshot());
    expect(after?.activeNoteId).toBe(before?.activeNoteId);
    expect(after?.notes).toEqual(before?.notes);
    expect(await citation.isExisting()).toBe(true);
    expect(await $('[data-testid="workspace-pane"][data-pane-kind="chat"]').getText()).not.toContain('removed confidential prose');
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

  it('opens paged read-only history and returns to the exact editor state without surviving restart', async () => {
    const panesBefore = await $$('[data-testid="workspace-pane"]');
    const scroller = await $('[data-testid="note-editor"] .cm-scroller');
    const content = await $('[data-testid="note-editor"] .cm-content');
    await browser.execute((element: HTMLElement) => {
      element.scrollTop = Math.max(300, element.scrollHeight * 0.55);
      element.dispatchEvent(new Event('scroll'));
    }, scroller);
    await content.click();
    await browser.keys(['Meta', 'a']);
    const scrollBefore = await browser.execute(
      (element: HTMLElement) => element.scrollTop,
      scroller
    );

    const openHistory = await $('button[aria-label="Open note history"]');
    await browser.execute((element: HTMLElement) => element.click(), openHistory);
    const history = await $('[data-testid="history-mode"]');
    await history.waitForExist();
    expect((await history.getText()).toUpperCase()).toContain('READ ONLY');
    await $('[data-testid="historical-revision-diff"]').waitForExist({ timeout: 20_000 });
    expect(await history.getText()).toContain('Alpha line 1');
    expect(await $$('[data-testid="workspace-pane"]')).toHaveLength(panesBefore.length);
    expect(await $('[data-testid="note-editor"] .cm-content').getAttribute('contenteditable')).toBe(
      'true'
    );

    const changedRevision = await $('[data-revision-id="note-alpha-revision-33"]');
    await changedRevision.click();
    const revisionDiff = await $('[data-testid="historical-revision-diff"]');
    await browser.waitUntil(async () => (await revisionDiff.getText()).includes('Inserted'));
    expect(await revisionDiff.getText()).toContain('Removed');
    expect(await revisionDiff.getText()).toContain('*old formatting*');
    expect(await revisionDiff.getText()).toContain('**new formatting**');
    const properties = await revisionDiff.$('details');
    expect(await properties.getAttribute('open')).toBeNull();
    await properties.$('summary').click();
    expect(await properties.getText()).toContain('project: atlas');
    expect(await properties.getText()).toContain('project: zeus');

    await changedRevision.doubleClick();
    const revisionName = await $('input[aria-label="Revision name"]');
    await revisionName.setValue('Release candidate');
    await $('button=Add name').click();
    await browser.waitUntil(async () => (await history.getText()).includes('Release candidate'));
    await $('[data-revision-id="note-alpha-revision-33"]').click({ button: 'right' });
    const renamedRevision = await $('input[aria-label="Revision name"]');
    await renamedRevision.setValue('Milestone');
    await $('button=Save name').click();
    await browser.waitUntil(async () => (await history.getText()).includes('Milestone'));

    const duplicateRevision = await $('[data-revision-id="note-alpha-revision-32"]');
    await duplicateRevision.doubleClick();
    await $('input[aria-label="Revision name"]').setValue('Milestone');
    await $('button=Add name').click();
    await browser.waitUntil(async () => (await $('[aria-label="Note timeline"]').getText()).match(/Milestone/gu)?.length === 2);
    await $('[data-revision-id="note-alpha-revision-32"]').click({ button: 'right' });
    await $('button=Remove name').click();
    await browser.waitUntil(async () => (await $('[aria-label="Note timeline"]').getText()).match(/Milestone/gu)?.length === 1);

    const renameTrigger = await $('[data-revision-id="note-alpha-revision-32"]');
    await renameTrigger.click();
    await browser.keys('F2');
    const cancelledName = await $('input[aria-label="Revision name"]');
    await cancelledName.setValue('Unsaved name');
    await browser.keys('Escape');
    await cancelledName.waitForExist({ reverse: true });
    expect(await history.isExisting()).toBe(true);
    expect(await history.getText()).not.toContain('Unsaved name');
    expect(await browser.execute((element: HTMLElement) => document.activeElement === element,
      await $('[data-revision-id="note-alpha-revision-32"]'))).toBe(true);
    expect(await $('[aria-label="Historical revision"] [aria-label="History tools"]').isExisting()).toBe(false);
    expect(await $('[aria-label="Note timeline"] [aria-label="History tools"]').isExisting()).toBe(true);

    expect(await history.getText()).toContain('Renamed Alpha old.md to alpha.md');
    expect(await $$('[data-revision-id="note-alpha-title-only-rename"]')).toHaveLength(0);

    const emptyRevision = await $('[data-revision-id="note-alpha-revision-30"]');
    await emptyRevision.click();
    await browser.waitUntil(async () =>
      (await revisionDiff.getText()).includes('Deleted to create an empty note.')
    );
    const authoredBody = await revisionDiff.$('[aria-label="Authored body changes"]');
    expect(await authoredBody.$$('[data-diff-kind="removed"]')).toHaveLength(1);
    expect(await authoredBody.$$('[data-diff-kind="added"]')).toHaveLength(0);

    const olderRevision = await $('[data-revision-id="note-alpha-revision-34"]');
    await olderRevision.click();
    await browser.waitUntil(async () =>
      (await $('[data-testid="historical-revision-diff"]').getText()).includes(
        'Historical revision 34'
      )
    );
    expect(await history.getText()).toContain('missing-diagram.png');
    const currentComparison = await $(
      'button[aria-label="Compare selected revision with current note"]'
    );
    expect(await currentComparison.isExisting()).toBe(false);
    const parentComparison = await $(
      'button[aria-label="Compare selected revision with previous revision"]'
    );
    expect(await parentComparison.isExisting()).toBe(false);

    const loadOlder = await $('button=Load older history');
    await loadOlder.waitForClickable();
    await loadOlder.click();
    await browser.waitUntil(async () => !(await $('button=Load older history').isExisting()));
    expect(await history.getText()).toContain('Created');

    await $('[aria-label="History tools"] summary').click();
    const clearHistory = await (await $('[aria-label="Note timeline"]')).$('button=Clear note history');
    await clearHistory.click();
    const confirmClear = await $('button=Confirm clear note history');
    await confirmClear.waitForClickable();
    await confirmClear.click();
    await browser.waitUntil(async () => !(await $('button=Load older history').isExisting()));
    expect(await history.getText()).not.toContain('Renamed Alpha old.md to alpha.md');
    expect(await history.getText()).toContain('Alpha line 1');

    const back = await $('button[aria-label="Back to workspace"]');
    await back.click();
    await history.waitForExist({ reverse: true });
    const restoredScroller = await $('[data-testid="note-editor"] .cm-scroller');
    const restoredScroll = await browser.execute(
      (element: HTMLElement) => element.scrollTop,
      restoredScroller
    );
    expect(Math.abs(restoredScroll - scrollBefore)).toBeLessThanOrEqual(2);
    expect(
      await browser.execute(() =>
        document.activeElement?.classList.contains('cm-content') ?? false
      )
    ).toBe(true);

    await browser.refresh();
    await waitForNote('Alpha note');
    expect(await $('[data-testid="history-mode"]').isExisting()).toBe(false);
  });

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

      const openHistory = await $('button[aria-label="Open note history"]');
      await browser.execute((element: HTMLElement) => element.click(), openHistory);
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
    const openHistory = await $('button[aria-label="Open note history"]');
    await browser.execute((element: HTMLElement) => element.click(), openHistory);
    const history = await $('[data-testid="history-mode"]');
    await history.waitForExist();
    await $('[data-revision-id="note-alpha-revision-34"]').click();
    await browser.waitUntil(async () =>
      (await $('[data-testid="historical-revision-diff"]').getText()).includes(
        'Historical revision 34'
      )
    );

    await $('button=Preview complete replacement').click();
    const preview = await $('[aria-label="Complete replacement preview"]');
    await preview.waitForExist();
    expect(await preview.getText()).toContain('Historical revision 34 of Alpha note');
    expect(await preview.getText()).toContain('Confirm Version Restore');
    expect(await preview.$$('textarea')).toHaveLength(0);
    const previewToggle = await $('button=Preview complete replacement');
    expect(await previewToggle.getAttribute('aria-expanded')).toBe('true');
    await previewToggle.click();
    await preview.waitForExist({ reverse: true });
    expect(await previewToggle.getAttribute('aria-expanded')).toBe('false');
    await previewToggle.click();
    await preview.waitForExist();
    await preview.$('button=Confirm Version Restore').click();
    await browser.waitUntil(async () => (await history.getText()).includes('Version restore'));

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

  it('pins notes above recents and reveals search shortcuts on modifier hold', async () => {
    const pinCurrent = await $('button[aria-label="Pin note"]');
    await pinCurrent.waitForClickable();
    const title = await $('[data-testid="note-title"]');
    const titleGeometry = await browser.execute(() => {
      const pin = document.querySelector<HTMLElement>('button[aria-label="Pin note"]')!;
      const field = document.querySelector<HTMLElement>('[data-testid="note-title"]')!;
      const text = document.querySelector<HTMLElement>('[data-testid="note-title-measure"]')!;
      const pinRect = pin.getBoundingClientRect();
      const fieldRect = field.getBoundingClientRect();
      const textRect = text.getBoundingClientRect();
      return {
        pinRight: pinRect.right,
        fieldLeft: fieldRect.left,
        fieldWidth: fieldRect.width,
        textLeft: textRect.left,
        textWidth: textRect.width
      };
    });
    expect(titleGeometry.pinRight).toBeLessThanOrEqual(titleGeometry.textLeft);
    expect(titleGeometry.textLeft - titleGeometry.pinRight).toBeLessThan(12);
    expect(Math.abs(titleGeometry.fieldWidth - titleGeometry.textWidth)).toBeLessThan(4);
    await browser.execute(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'p',
          code: 'KeyP',
          metaKey: true,
          bubbles: true,
          cancelable: true
        })
      );
    });
    await $('button[aria-label="Unpin note"]').waitForExist();

    const search = await $('[data-testid="note-search-input"]');
    await search.click();
    await $('button[aria-label="Open pinned note: Alpha note.md"]').waitForExist();
    expect(await $('//*[normalize-space()="Pinned"]')).toExist();
    expect(await $('//*[normalize-space()="Recent Tasks"]')).not.toExist();

    const currentScope = await $('button[aria-label="Search this note only"]');
    await browser.execute(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Meta', metaKey: true }));
    });
    await browser.pause(240);
    expect(await currentScope.getText()).toContain('Cmd + F');

    await browser.execute(() => {
      window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Meta' }));
    });
    await browser.waitUntil(async () => (await currentScope.getText()).includes('This note'));
  });

  it('confirms vault clear and permanent purge while reporting reclaimable storage', async () => {
    const openSettings = await $('a[aria-label="Settings"]');
    await browser.execute((element: HTMLElement) => element.click(), openSettings);
    await $('[aria-label="Settings categories"]').waitForExist();
    const historyCategory = await $('[aria-label="Settings categories"] button:nth-of-type(5)');
    await historyCategory.waitForExist();
    await browser.execute((element: HTMLElement) => element.click(), historyCategory);
    await browser.waitUntil(async () => (await $('body').getText()).includes('16 KB allocated'));
    expect(await $('body').getText()).toContain('512 bytes reclaimable');

    await $('button=Clear vault history').click();
    await $('button=Confirm clear vault history').click();
    await browser.waitUntil(async () => (await $('body').getText()).includes('12 KB reclaimable'));

    await $('button=Forgotten Items').click();
    await browser.waitUntil(async () => (await $('body').getText()).includes('Forgotten draft'));
    const permanentDeleteButtons = await $$('button=Permanently delete');
    expect(permanentDeleteButtons).toHaveLength(2);
    await permanentDeleteButtons[1]!.click();
    const confirmation = await $('[role="alertdialog"]');
    await confirmation.waitForExist();
    expect(await confirmation.getText()).toContain('complete Note Timeline');
    expect(await confirmation.getText()).toContain('cannot be undone');
    await $('button=Confirm permanent deletion').click();
    await browser.waitUntil(async () => !(await $('*=Forgotten draft').isExisting()));

    const commands = await browser.execute(() =>
      window.__GNEAUXGHTS_E2E__?.invocations.map((entry) => entry.command) ?? []
    );
    expect(commands).toContain('clear_vault_history');
    expect(commands).toContain('delete_forgotten_notes');
  });

  it('inspects and safely recovers an externally deleted note', async () => {
    const openSettings = await $('a[aria-label="Settings"]');
    await browser.execute((element: HTMLElement) => element.click(), openSettings);
    await $('[aria-label="Settings categories"]').waitForExist();
    await $('button=Forgotten Items').click();
    await browser.waitUntil(async () =>
      (await $('body').getText()).includes('Missing outline')
    );

    const timeline = await $('summary=Retained timeline · 2 loaded records');
    await timeline.click();
    const body = await $('body').getText();
    expect(body).not.toContain('Before external deletion');
    expect(body).toContain('Missing event');

    await $('button=Load older history').click();
    await browser.waitUntil(async () =>
      (await $('body').getText()).includes('Before external deletion')
    );

    await $('button=Recover').click();
    await browser.waitUntil(async () =>
      (await $('body').getText()).includes(
        'Recovered Missing Note to /e2e/Missing outline Recovered Note.md.'
      )
    );
    expect(
      await $('//article[.//p[normalize-space()="Missing outline"]]').isExisting()
    ).toBe(false);

    const snapshot = await browser.execute(() =>
      window.__GNEAUXGHTS_E2E__?.snapshot()
    );
    expect(snapshot?.notes.find((note) => note.noteId === 'note-missing')?.path).toBe(
      '/e2e/Missing outline Recovered Note.md'
    );
    expect(snapshot?.notes.find((note) => note.noteId === 'note-alpha')?.path).toBe(
      '/e2e/alpha.md'
    );
    const commands = snapshot?.invocations.map((entry) => entry.command) ?? [];
    expect(commands).toContain('list_missing_notes');
    expect(commands).toContain('get_missing_note_history_page');
    expect(commands).toContain('recover_missing_note');
  });

  it('keeps Markdown fidelity stable in the real editor DOM', async () => {
    await openRecentNote('Beta note');

    const taskCheckbox = await $('.cm-gn-task-checkbox input');
    await taskCheckbox.waitForExist();
    expect(await $('.cm-gn-task-line .cm-gn-list-mark-ul').isExisting()).toBe(
      false
    );

    const tableRows = await $$('.gn-markdown-table-line');
    expect(tableRows).toHaveLength(3);
    const tableLayout = await browser.execute(() => {
      const rows = [
        ...document.querySelectorAll<HTMLElement>(
          '.gn-markdown-table-line'
        )
      ];
      rows[0]!.scrollLeft = 72;
      rows[0]!.dispatchEvent(new Event('scroll', { bubbles: false }));
      return {
        widths: rows.map((row) => ({
          client: row.clientWidth,
          scroll: row.scrollWidth
        })),
        scrollLefts: rows.map((row) => row.scrollLeft),
        groups: rows.map((row) => row.dataset.gnTableGroup)
      };
    });
    expect(new Set(tableLayout.groups)).toEqual(new Set(['0']));
    expect(tableLayout.widths.some((width) => width.scroll > width.client)).toBe(
      true
    );
    expect(new Set(tableLayout.scrollLefts).size).toBe(1);

    const content = await $('[data-testid="note-editor"] .cm-content');
    await content.click();
    await browser.keys(['Meta', 'a']);
    await browser.waitUntil(
      async () =>
        (await $('.cm-gn-highlight.cm-gn-selection-overlap').isExisting()) &&
        (await browser.execute(() =>
          (window.getSelection()?.toString().length ?? 0) > 0
        )),
      {
        timeoutMsg:
          'Expected multiline selection to own the semantic highlight layer'
      }
    );
    const selectionGeometry = await browser.execute(() => {
      const selection = window.getSelection();
      const content = document.querySelector<HTMLElement>(
        '[data-testid="note-editor"] .cm-content'
      )!;
      const rects = selection?.rangeCount
        ? [...selection.getRangeAt(0).getClientRects()].filter(
            (rect) => rect.width > 1 && rect.height > 1
          )
        : [];
      const last = rects.at(-1);
      return {
        rectCount: rects.length,
        trailingGap: last
          ? content.getBoundingClientRect().right - last.right
          : 0,
        syntheticRectCount: document.querySelectorAll(
          '.cm-selectionBackground'
        ).length
      };
    });
    expect(selectionGeometry.rectCount).toBeGreaterThan(1);
    expect(selectionGeometry.trailingGap).toBeGreaterThan(40);
    expect(selectionGeometry.syntheticRectCount).toBe(0);

    await browser.keys(['Meta', 'ArrowLeft']);
    const editorLines = await $$('[data-testid="note-editor"] .cm-line');
    const wrappedLine = editorLines.at(-1)!;
    await browser.execute((line: HTMLElement) => {
      line.scrollIntoView({ block: 'center' });
    }, wrappedLine);
    await browser.pause(100);
    await browser.execute((line: HTMLElement) => {
      const rect = line.getBoundingClientRect();
      const root = line.closest<HTMLElement>('.gn-editor-root')!;
      root.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: rect.left + Math.min(120, rect.width / 2),
          clientY: Math.max(rect.top + 8, 8)
        })
      );
    }, wrappedLine);
    const extent = await $('.notepad-block-extent-indicator[data-show="true"]');
    await extent.waitForExist();
    const extentGeometry = await browser.execute(() => {
      const lines = [
        ...document.querySelectorAll<HTMLElement>(
          '[data-testid="note-editor"] .cm-line'
        )
      ];
      const indicator = document.querySelector<HTMLElement>(
        '.notepad-block-extent-indicator[data-show="true"]'
      )!;
      const wrapped = lines.at(-1)!.getBoundingClientRect();
      const visual = indicator.getBoundingClientRect();
      return {
        expectedHeight: wrapped.height,
        actualHeight: visual.height,
        pointerEvents: getComputedStyle(indicator).pointerEvents,
        position: getComputedStyle(indicator).position
      };
    });
    expect(
      Math.abs(extentGeometry.actualHeight - extentGeometry.expectedHeight)
    ).toBeLessThanOrEqual(2);
    expect(extentGeometry.pointerEvents).toBe('none');
    expect(extentGeometry.position).toBe('fixed');
  });
});
