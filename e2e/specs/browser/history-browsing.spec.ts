import { browser, expect, $, $$ } from '@wdio/globals';
import { resetBrowserWorkspace, openHistoryShortcut, waitForNote } from '../../support/browserWorkspace';

describe('History browsing and labels', () => {
  beforeEach(resetBrowserWorkspace);

  it('compares authored revisions, properties, empty versions and missing assets', async () => {
    await openHistoryShortcut();
    const history = await $('[data-testid="history-mode"]');
    await history.waitForExist();
    await $('[data-testid="historical-revision-diff"]').waitForExist({ timeout: 20_000 });
    const changedRevision = await $('[data-revision-id="note-alpha-revision-33"]');
    await changedRevision.click();
    const revisionDiff = await $('[data-testid="historical-revision-diff"]');
    await browser.waitUntil(async () => (await revisionDiff.getText()).includes('Inserted'));
    expect(await revisionDiff.getText()).toContain('Changes in this version');
    await $('button=Current note').click();
    await browser.waitUntil(async () => (await revisionDiff.getText()).includes('Changes since this version'));
    expect(await revisionDiff.getText()).toContain('Alpha line 1');
    await $('button=Previous version').click();
    await browser.waitUntil(async () =>
      (await revisionDiff.getText()).includes('Changes in this version')
    );
    expect(await revisionDiff.getText()).toContain('Removed');
    expect(await revisionDiff.getText()).toContain('*old formatting*');
    expect(await revisionDiff.getText()).toContain('**new formatting**');
    const properties = await revisionDiff.$('details');
    expect(await properties.getAttribute('open')).toBeNull();
    await properties.$('summary').click();
    expect(await properties.getText()).toContain('project: atlas');
    expect(await properties.getText()).toContain('project: zeus');

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

  });

  it('names, renames, duplicates, removes and cancels revision labels with keyboard focus', async () => {
    await openHistoryShortcut();
    const history = await $('[data-testid="history-mode"]');
    await history.waitForExist();
    await $('[data-testid="historical-revision-diff"]').waitForExist({ timeout: 20_000 });
    const changedRevision = await $('[data-revision-id="note-alpha-revision-33"]');
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

  });

  it('opens paged read-only history, clears it and returns to exact editor state without surviving restart', async () => {
    const paneCountBefore = await $$('[data-testid="workspace-pane"]').length;
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

    await openHistoryShortcut();
    const history = await $('[data-testid="history-mode"]');
    await history.waitForExist();
    expect((await history.getText()).toUpperCase()).toContain('READ ONLY');
    await $('[data-testid="historical-revision-diff"]').waitForExist({ timeout: 20_000 });
    expect(await history.getText()).toContain('Current version');
    expect(await history.getText()).toContain('Changes in this version');
    const initialHistoryDiff = await browser.execute(() =>
      window.__GNEAUXGHTS_E2E__?.invocations.findLast(
        (entry) => entry.command === 'get_note_history_diff'
      )
    );
    expect(initialHistoryDiff?.args.comparison).toBe('parent');
    expect(await $$('[data-testid="workspace-pane"]')).toHaveLength(paneCountBefore);
    expect(await $('[data-testid="note-editor"] .cm-content').getAttribute('contenteditable')).toBe(
      'true'
    );
    // The editor stays mounted but the actual browser must reject workspace focus.
    expect(await browser.execute((element: HTMLElement) => {
      element.focus();
      return document.activeElement === element;
    }, await $('[data-testid="note-editor"] .cm-content'))).toBe(false);

    const loadOlder = await $('button=Load older history');
    await loadOlder.waitForClickable();
    await loadOlder.click();
    await loadOlder.waitForExist({ reverse: true });
    expect(await history.getText()).toContain('Created');

    await $('[aria-label="History tools"] summary').click();
    const clearHistory = await (await $('[aria-label="Note timeline"]')).$('button=Clear note history');
    await clearHistory.click();
    const clearCalls = () => browser.execute(() => window.__GNEAUXGHTS_E2E__!.invocations.filter(item => item.command === 'clear_note_history'));
    expect(await clearCalls()).toHaveLength(0);
    await $('button=Cancel').click();
    expect(await clearCalls()).toHaveLength(0);
    await clearHistory.click();
    const confirmClear = await $('button=Confirm clear note history');
    await confirmClear.waitForClickable();
    await confirmClear.click();
    await $('[data-revision-id="note-alpha-baseline-after-clear"]').waitForExist();
    expect(await history.getText()).not.toContain('Renamed Alpha old.md to alpha.md');
    expect(await history.getText()).toContain('Current version');
    expect(await history.getText()).toContain('Changes from the beginning');
    expect((await clearCalls()).map(call => call.args)).toEqual([{ noteId: 'note-alpha', confirmed: true }]);

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
});
