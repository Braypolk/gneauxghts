import { browser, expect, $ } from '@wdio/globals';

async function waitForNote(title: string) {
  const input = await $('[data-testid="note-title"]');
  try {
    await input.waitForDisplayed();
  } catch (error) {
    const pageText = await browser.execute(() => document.body.innerText);
    throw new Error(`Note editor did not render. Page text: ${pageText}`, {
      cause: error
    });
  }
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

async function setEditorSelection(anchor: number, head: number) {
  const content = await $('[data-testid="note-editor"] .cm-content');
  const selection = await browser.execute(
    (element: HTMLElement, requestedAnchor: number, requestedHead: number) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let textNode = walker.nextNode();
      while (textNode && (textNode.textContent?.length ?? 0) < 16) {
        textNode = walker.nextNode();
      }
      if (!textNode) throw new Error('Editor has no selectable text node');
      const length = textNode.textContent?.length ?? 0;
      const boundedAnchor = Math.max(0, Math.min(requestedAnchor, length));
      const boundedHead = Math.max(0, Math.min(requestedHead, length));
      const domSelection = window.getSelection();
      if (!domSelection) throw new Error('Browser selection is unavailable');
      element.focus();
      domSelection.setBaseAndExtent(
        textNode,
        boundedAnchor,
        textNode,
        boundedHead
      );
      document.dispatchEvent(new Event('selectionchange'));
      return { anchor: boundedAnchor, head: boundedHead };
    },
    content,
    anchor,
    head
  );
  await browser.pause(60);
  return selection;
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

    const editingSession = await $('[data-testid="editing-session-note-alpha-revision-31"]');
    await editingSession.waitForExist();
    const expandSession = await editingSession.$('button[aria-label="Expand Editing Session"]');
    await expandSession.click();
    await editingSession.$('button[aria-label="Collapse Editing Session"]').waitForExist();
    expect(await editingSession.$$('[data-revision-id]')).toHaveLength(5);
    const changedRevision = await editingSession.$('[data-revision-id="note-alpha-revision-33"]');
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

    const revisionName = await $('input[aria-label="Revision name"]');
    await revisionName.setValue('Release candidate');
    await $('button=Add name').click();
    await browser.waitUntil(async () => (await history.getText()).includes('Release candidate'));
    const renamedRevision = await $('input[aria-label="Revision name"]');
    await renamedRevision.setValue('Milestone');
    await $('button=Save name').click();
    await browser.waitUntil(async () => (await history.getText()).includes('Milestone'));

    const duplicateRevision = await editingSession.$('[data-revision-id="note-alpha-revision-32"]');
    await duplicateRevision.click();
    await $('input[aria-label="Revision name"]').setValue('Milestone');
    await $('button=Add name').click();
    await browser.waitUntil(async () => (await history.getText()).match(/Milestone/gu)?.length === 2);
    await $('button=Remove name').click();
    await browser.waitUntil(async () => (await history.getText()).match(/Milestone/gu)?.length === 1);

    expect(await history.getText()).toContain('Renamed Alpha old.md to alpha.md');
    expect(await $$('[data-revision-id="note-alpha-title-only-rename"]')).toHaveLength(0);

    const emptySession = await $('[data-testid="editing-session-note-alpha-revision-30"]');
    await emptySession.$('button[aria-label="Expand Editing Session"]').click();
    const emptyRevision = await emptySession.$('[data-revision-id="note-alpha-revision-30"]');
    await emptyRevision.click();
    await browser.waitUntil(async () =>
      (await revisionDiff.getText()).includes('Deleted to create an empty note.')
    );
    const authoredBody = await revisionDiff.$('[aria-label="Authored body changes"]');
    expect(await authoredBody.$$('[data-diff-kind="removed"]')).toHaveLength(1);
    expect(await authoredBody.$$('[data-diff-kind="added"]')).toHaveLength(0);

    const olderRevision = await editingSession.$('[data-revision-id="note-alpha-revision-34"]');
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
    await currentComparison.waitForClickable();
    await currentComparison.click();
    await browser.waitUntil(async () =>
      (await currentComparison.getAttribute('aria-pressed')) === 'true' &&
      (await currentComparison.isEnabled())
    );
    expect(await history.getText()).toContain('Alpha line 1');
    const parentComparison = await $(
      'button[aria-label="Compare selected revision with previous revision"]'
    );
    await parentComparison.waitForClickable();
    await parentComparison.click();
    await browser.waitUntil(async () =>
      (await parentComparison.getAttribute('aria-pressed')) === 'true' &&
      (await parentComparison.isEnabled())
    );

    const loadOlder = await $('button=Load older history');
    await loadOlder.waitForClickable();
    await loadOlder.click();
    await browser.waitUntil(async () => !(await $('button=Load older history').isExisting()));
    expect(await history.getText()).toContain('Created');

    const clearHistory = await (await $('main')).$('button=Clear note history');
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
    const expectedMarkdown = await editorText();

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
      const restoredScroll = await browser.execute(
        (element: HTMLElement) => element.scrollTop,
        scroller
      );
      expect(Math.abs(restoredScroll - expectedScroll)).toBeLessThanOrEqual(2);
      expect(await editorText()).toBe(expectedMarkdown);
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
    const editingSession = await $('[data-testid="editing-session-note-alpha-revision-31"]');
    await editingSession.$('button[aria-label="Expand Editing Session"]').click();
    await editingSession.$('[data-revision-id="note-alpha-revision-34"]').click();
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
