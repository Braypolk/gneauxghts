import { browser, expect, $ } from '@wdio/globals';

describe('Turn into menu scrolling', () => {
  for (const height of [650, 900]) {
    it(`reaches and selects the last block type by scrolling at ${height}px window height`, async () => {
      await browser.setWindowSize(1100, height);
      await browser.url('/');
      const content = await $('[data-testid="note-editor"] .cm-content');
      await content.waitForDisplayed({ timeout: 30_000 });
      await $('[data-testid="note-editor"][aria-busy="false"]').waitForExist();
      await content.click();
      const lineCount = height < 900 ? 6 : 10;
      await browser.execute((element: HTMLElement, lineCount: number) => {
        element.focus();
        document.execCommand('selectAll');
        const clipboardData = new DataTransfer();
        clipboardData.setData('text/plain', Array.from({ length: lineCount }, (_, index) =>
          `Menu scrolling fixture line ${index}`).join('\n'));
        element.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
      }, content, lineCount);
      await browser.waitUntil(async () => (await content.getText()).includes(`fixture line ${lineCount - 1}`));
      await browser.execute((element: HTMLElement) => {
        element.focus();
        const range = document.createRange();
        range.selectNodeContents(element);
        const selection = window.getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);
      }, content);
      const toggle = await $('button[aria-label="Turn into block type"]');
      await toggle.waitForDisplayed();
      await toggle.click();
      const body = await $('.selection-menu-body');
      await body.waitForDisplayed();
      await browser.executeAsync((done: () => void) => requestAnimationFrame(() => requestAnimationFrame(() => done())));
      // Keep the pointer over the scroll area, as it is during a trackpad gesture.
      const point = await browser.execute((element: HTMLElement) => {
        const body = element.getBoundingClientRect();
        const panel = element.closest('.selection-panel')!.getBoundingClientRect();
        return { x: Math.round(body.left + body.width / 2), y: Math.round((body.top + Math.min(body.bottom, panel.bottom)) / 2) };
      }, body);
      await browser.action('pointer').move(point).perform();
      await browser.executeAsync((done: () => void) => requestAnimationFrame(() => requestAnimationFrame(() => done())));
      await browser.action('wheel').scroll({ ...point, deltaY: 2000, deltaX: 0 }).perform();
      await browser.waitUntil(() => browser.execute((element: HTMLElement) =>
        element.scrollTop >= element.scrollHeight - element.clientHeight - 1, body));
      const geometry = await browser.execute((element: HTMLElement) => {
        const panel = element.closest('.selection-panel')!.getBoundingClientRect();
        const list = element.getBoundingClientRect();
        const items = element.querySelectorAll<HTMLElement>('.selection-item');
        const row = items[items.length - 1];
        const rect = row.getBoundingClientRect();
        return {
          label: row.textContent?.trim(),
          listBottom: list.bottom,
          panelBottom: panel.bottom,
          rowTop: rect.top,
          rowBottom: rect.bottom,
          listTop: list.top,
          hit: row.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2))
        };
      }, body);
      expect(geometry.label).toBe('Code');
      expect(geometry.listBottom).toBeLessThanOrEqual(geometry.panelBottom);
      expect(geometry.rowTop).toBeGreaterThanOrEqual(geometry.listTop);
      expect(geometry.rowBottom).toBeLessThanOrEqual(geometry.panelBottom);
      expect(geometry.hit).toBe(true);
      // Click without WebDriver's implicit scrollIntoView masking the defect.
      const lastPoint = await browser.execute((element: HTMLElement) => {
        const items = element.querySelectorAll<HTMLElement>('.selection-item');
        const rect = items[items.length - 1].getBoundingClientRect();
        return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
      }, body);
      await browser.action('pointer').move(lastPoint).down().up().perform();
      await body.waitForExist({ reverse: true });
      await browser.waitUntil(async () => (await content.getText()).includes('```'));
    });
  }
});
