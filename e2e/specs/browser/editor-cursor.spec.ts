import { browser, expect, $ } from '@wdio/globals';

// Run this same journey with wdio.native.conf.ts to cover macOS WebKit.
describe('editor cursor geometry', () => {
  before(async () => {
    if (!browser.isChromium) {
      await browser.switchToWindow('main');
    } else {
      await browser.url('/');
      await browser.switchToWindow(await browser.getWindowHandle());
    }
    await $('[data-testid="note-editor"] .cm-content').waitForDisplayed({ timeout: 30_000 });
    await $('span=Loading editor').waitForExist({ reverse: true });
    if (!browser.isChromium) {
      await browser.executeAsync((done: (error: string | null) => void) => {
        const native = window as typeof window & {
          __TAURI_INTERNALS__: { invoke: (command: string, args: object) => Promise<void> };
        };
        native.__TAURI_INTERNALS__.invoke('plugin:window|show', { label: 'main' })
          .then(() => native.__TAURI_INTERNALS__.invoke('plugin:window|set_focus', { label: 'main' }))
          .then(() => done(null), error => done(String(error)));
      }).then(error => { if (error) throw new Error(error); });
    }
    await browser.waitUntil(() => browser.execute(() => document.hasFocus() && document.visibilityState === 'visible'), { timeout: 5_000, timeoutMsg: 'Cursor geometry requires a visible, focused test window' });
  });

  const cases = [
    { label: 'paragraph', prefix: '' },
    { label: 'unordered list', prefix: '- ' },
    { label: 'ordered list', prefix: '1. ' },
    { label: 'quote', prefix: '> ' },
    { label: 'heading 1', prefix: '# ' },
    { label: 'heading 3', prefix: '### ' },
    { label: 'task', prefix: '- [ ] ' },
    { label: 'code block', prefix: '```\n', suffix: '\n```' },
    { label: 'large paragraph', prefix: '', fontSize: '1.25rem' }
  ];
  for (const { label, prefix, suffix = '', fontSize = '1rem' } of cases) {
    it(`keeps the cursor at text height across wrapped ${label} lines`, async () => {
      const content = await $('[data-testid="note-editor"] .cm-content');
      await browser.execute((size: string) => document.querySelector<HTMLElement>('.gn-editor-root')!.style.setProperty('--gn-editor-font-size', size), fontSize);
      await content.click();
      await browser.execute((element: HTMLElement) => element.focus(), content);
      await browser.waitUntil(async () => (await $('[data-testid="note-editor"] .cm-editor').getAttribute('class'))?.includes('cm-focused'), { timeout: 2_000 });
      const text = `${prefix}${'Wrapped text should keep a consistent cursor height. '.repeat(12)}${suffix}`;
      await browser.execute((element: HTMLElement, value: string) => {
        element.focus();
        document.execCommand('selectAll');
        document.execCommand('insertText', false, value);
      }, content, text);
      await browser.waitUntil(async () => (await content.getText()).includes('Wrapped text'));
      await browser.executeAsync((done: () => void) => requestAnimationFrame(() => requestAnimationFrame(() => done())));

      // Choose a character on each rendered row, using real DOM text geometry
      // rather than guessing wrap offsets from font size or window width.
      // Sample inside a word: a caret exactly at a soft wrap may belong to
      // either visual row depending on its selection affinity.
      const rows = await browser.execute((element: HTMLElement) => {
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        const result: { offset: number; top: number; height: number }[] = [];
        let offset = 0;
        while (walker.nextNode()) {
          const node = walker.currentNode;
          for (let index = 0; index < (node.textContent?.length ?? 0); index++) {
            const range = document.createRange();
            if (node.textContent![index] !== 'W') continue;
            range.setStart(node, index + 1);
            range.setEnd(node, index + 2);
            const rect = range.getBoundingClientRect();
            if (node.textContent![index] === 'W' && rect.height > 0 &&
                !result.some(row => Math.abs(row.top - rect.top) < 2)) {
              result.push({ offset: offset + index + 1, top: rect.top, height: rect.height });
            }
          }
          offset += node.textContent?.length ?? 0;
        }
        return result.slice(0, 3);
      }, content);
      expect(rows.length).toBeGreaterThanOrEqual(2);

      const heights: number[] = [];
      for (const row of rows) {
        await browser.execute((element: HTMLElement, target: number) => {
          const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
          while (walker.nextNode()) {
            const node = walker.currentNode;
            const length = node.textContent?.length ?? 0;
            if (target < length) {
              window.getSelection()!.collapse(node, target);
              return;
            }
            target -= length;
          }
          throw new Error('Cursor target missing');
        }, content, row.offset);
        const cursor = await $('[data-testid="note-editor"] .cm-cursor-primary');
        await cursor.waitForExist({ timeout: 2_000 });
        await browser.waitUntil(async () => {
          return browser.execute((element: HTMLElement, target: number) => {
            const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
            while (walker.nextNode()) {
              const node = walker.currentNode;
              const length = node.textContent?.length ?? 0;
              if (target < length) {
                const range = document.createRange();
                range.setStart(node, target);
                range.setEnd(node, target + 1);
                const cursor = element.closest('.cm-editor')!.querySelector('.cm-cursor-primary')!;
                return Math.abs(cursor.getBoundingClientRect().top - range.getBoundingClientRect().top) < 2;
              }
              target -= length;
            }
            return false;
          }, content, row.offset);
        }, { timeout: 2_000, timeoutMsg: `Cursor did not reach row at ${row.top}` });
        const height = await browser.execute((element: HTMLElement) => element.getBoundingClientRect().height, cursor);
        heights.push(height);
        expect(await cursor.getCSSProperty('display')).toMatchObject({ value: 'block' });
        expect(Math.abs(height - row.height)).toBeLessThanOrEqual(1);
        expect(await browser.execute((element: HTMLElement) => getComputedStyle(element).caretColor, content))
          .toBe('rgba(0, 0, 0, 0)');
      }
      expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(1);
    });
  }

  it('preserves native range selection over code and table backgrounds', async () => {
    const content = await $('[data-testid="note-editor"] .cm-content');
    await content.click();
    await browser.execute((element: HTMLElement) => {
      element.focus();
      document.execCommand('selectAll');
      // Paste Markdown verbatim; native typing can apply macOS smart dashes.
      const clipboardData = new DataTransfer();
      clipboardData.setData('text/plain', '```\nSelected code\n```\n\n| Column | Other |\n| --- | --- |\n| Value | Cell |');
      element.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
    }, content);
    await browser.executeAsync((done: () => void) => requestAnimationFrame(() => requestAnimationFrame(() => done())));
    await $('.cm-gn-code-block-line').waitForExist();
    await $('.gn-markdown-table-line').waitForExist();
    for (const selector of ['.cm-gn-code-block-line', '.gn-markdown-table-line']) {
      const selection = await browser.execute((selector: string) => {
        const line = [...document.querySelectorAll<HTMLElement>(selector)]
          .find(element => element.textContent?.includes(selector.includes('code') ? 'Selected code' : 'Column'))!;
        const range = document.createRange();
        range.selectNodeContents(line);
        const selection = window.getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);
        return { text: selection.toString(), background: getComputedStyle(line, '::selection').backgroundColor };
      }, selector);
      expect(selection.text.length).toBeGreaterThan(0);
      expect(selection.background).not.toBe('rgba(0, 0, 0, 0)');
      await $('[data-testid="note-editor"] .cm-cursor-primary').waitForExist({ reverse: true });
    }
    await browser.keys('ArrowRight');
    await $('[data-testid="note-editor"] .cm-cursor-primary').waitForDisplayed();
    await browser.execute(() => document.querySelector<HTMLInputElement>('[data-testid="note-title"]')!.focus());
    await $('[data-testid="note-editor"] .cm-cursor-primary').waitForDisplayed({ reverse: true });
  });
});
