import { browser, expect, $, $$ } from '@wdio/globals';
import { resetBrowserWorkspace, openRecentNote } from '../../support/browserWorkspace';

describe('editor geometry and Markdown fidelity', () => {
  beforeEach(resetBrowserWorkspace);

  it('keeps the move block handle beside text when Related opens and closes', async () => {
    await browser.setWindowSize(1280, 844);
    const card = await $('[data-testid="workspace-card"]');
    const hoverLine = () => browser.execute(() => {
      const line = document.querySelector<HTMLElement>('[data-testid="note-editor"] .cm-line')!;
      const rect = line.getBoundingClientRect();
      line.dispatchEvent(new MouseEvent('mousemove', {
        bubbles: true, clientX: rect.left + 120, clientY: rect.top + 8
      }));
    });
    const geometry = () => browser.execute(() => {
      const line = document.querySelector<HTMLElement>('[data-testid="note-editor"] .cm-line')!;
      const range = document.createRange();
      range.selectNodeContents(line);
      const text = range.getBoundingClientRect();
      const handle = document.querySelector<HTMLElement>('.notepad-block-handle')!.getBoundingClientRect();
      return { gap: text.left - handle.right, centerDelta: handle.top + handle.height / 2 - (text.top + text.height / 2) };
    });
    const settle = async () => {
      await browser.waitUntil(async () => browser.execute(
        (element: HTMLElement) => element.getAnimations().length === 0, card
      ));
      await hoverLine();
      await $('.notepad-block-handle[data-show="true"]').waitForExist();
      await browser.pause(100);
    };
    await settle();
    const baseline = await geometry();
    expect(baseline.gap).toBeGreaterThanOrEqual(4);
    for (const label of ['Related notes', 'Search notes', 'Related notes']) {
      await $(`button[aria-label="${label}"]`).click();
      await settle();
      const current = await geometry();
      expect(current.gap).toBeGreaterThanOrEqual(4);
      expect(Math.abs(current.gap - baseline.gap)).toBeLessThanOrEqual(2);
      expect(Math.abs(current.centerDelta)).toBeLessThanOrEqual(3);
    }
  });

  it('keeps Markdown fidelity stable in the real editor DOM', async () => {
    await openRecentNote('Beta note');

    const taskCheckbox = await $('.cm-gn-task-checkbox input');
    await taskCheckbox.waitForExist();
    expect(await $('.cm-gn-task-line .cm-gn-list-mark-ul').isExisting()).toBe(
      false
    );

    const tableLayout = await browser.execute(() => {
      const rows = [...document.querySelectorAll<HTMLElement>('[data-testid="note-editor"] .cm-line')]
        .filter(row => row.textContent?.startsWith('|'));
      return {
        text: rows.map(row => row.textContent),
        wraps: rows.map(row => getComputedStyle(row).whiteSpace),
        overflows: rows.map(row => row.scrollWidth > row.clientWidth + 1),
        decoratedRows: document.querySelectorAll('.gn-markdown-table-line').length
      };
    });
    expect(tableLayout.text).toHaveLength(3);
    expect(tableLayout.text.slice(0, 2)).toEqual(['| Column A | Column B |', '| --- | --- |']);
    expect(tableLayout.wraps).toEqual(['pre-wrap', 'pre-wrap', 'pre-wrap']);
    expect(tableLayout.overflows).toEqual([false, false, false]);
    expect(tableLayout.decoratedRows).toBe(0);

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
    const wrappedLine = editorLines[(await editorLines.length) - 1];
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
