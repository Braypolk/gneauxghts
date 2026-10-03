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
    await $('[data-testid="note-editor"][aria-busy="false"]').waitForExist();
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

  it('keeps the cursor at text height and position beside the add due date control', async () => {
    const content = await $('[data-testid="note-editor"] .cm-content');
    for (const completed of [false, true]) {
      for (const wrapped of [false, true]) {
        const value = `- [${completed ? 'x' : ' '}] ${wrapped ? 'Wrapped task text. '.repeat(16) : ''}Task ending`;
        await browser.execute((element: HTMLElement, value: string) => {
          document.querySelector<HTMLElement>('.gn-editor-root')!.style.setProperty('--gn-editor-font-size', '1rem');
          element.focus();
          document.execCommand('selectAll');
          const clipboardData = new DataTransfer();
          clipboardData.setData('text/plain', value);
          element.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
        }, content, value);
        await browser.waitUntil(() => browser.execute((element: HTMLElement, value: string) =>
          element.textContent === `${value}+`, content, value), { timeout: 2_000, timeoutMsg: 'Task fixture was not inserted' });
        await $('.cm-gn-date-add').waitForExist();

        // Use the actual text boundary, excluding CodeMirror's widget buffers
        // and the noneditable due-date button after the authored task text.
        await browser.execute((element: HTMLElement) => {
          const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
          while (walker.nextNode()) {
            const node = walker.currentNode;
            if (!node.textContent?.endsWith('Task ending')) continue;
            window.getSelection()!.collapse(node, node.textContent.length);
            return;
          }
          throw new Error('Task ending missing');
        }, content);
        await browser.executeAsync((done: () => void) => requestAnimationFrame(() => requestAnimationFrame(() => done())));
        const cursor = await $('[data-testid="note-editor"] .cm-cursor-primary');
        await cursor.waitForExist();
        const editor = await $('[data-testid="note-editor"] .cm-editor');
        const geometry = () => browser.execute((element: HTMLElement) => {
          const walker = document.createTreeWalker(element.querySelector('.cm-content')!, NodeFilter.SHOW_TEXT);
          let node: Node | null = null;
          while (walker.nextNode()) {
            if (walker.currentNode.textContent?.endsWith('Task ending')) {
              node = walker.currentNode;
              break;
            }
          }
          if (!node) throw new Error('Task ending missing');
          const range = document.createRange();
          range.setStart(node, node.textContent!.length - 1);
          range.setEnd(node, node.textContent!.length);
          const text = range.getBoundingClientRect();
          const cursor = element.querySelector('.cm-cursor-primary')!.getBoundingClientRect();
          return { height: Math.abs(cursor.height - text.height), top: Math.abs(cursor.top - text.top), left: Math.abs(cursor.left - text.right) };
        }, editor);
        await browser.waitUntil(async () => {
          const rect = await geometry();
          return rect.height <= 1 && rect.top < 2 && rect.left < 2;
        }, { timeout: 2_000, timeoutMsg: 'Task-ending cursor did not match the authored text' });
        let rect = await geometry();
        expect(rect.height).toBeLessThanOrEqual(1);
        expect(rect.top).toBeLessThan(2);
        expect(rect.left).toBeLessThan(2);
        if (browser.isChromium) {
          await browser.keys('z');
        } else {
          // The embedded WebKit driver emits key events without inserting text.
          await browser.execute(() => document.execCommand('insertText', false, 'z'));
        }
        await browser.waitUntil(async () => (await content.getText()).includes('Task endingz'));
        await browser.keys('ArrowLeft');
        await browser.keys('ArrowRight');
        await browser.keys('Backspace');
        await browser.waitUntil(async () => (await content.getText()).includes('Task ending') && !(await content.getText()).includes('Task endingz'));
        await browser.executeAsync((done: () => void) => requestAnimationFrame(() => requestAnimationFrame(() => done())));
        await browser.waitUntil(async () => {
          const rect = await geometry();
          return rect.height <= 1 && rect.top < 2 && rect.left < 2;
        }, { timeout: 2_000, timeoutMsg: 'Task-ending cursor changed after typing and navigation' });
        rect = await geometry();
        expect(rect.height).toBeLessThanOrEqual(1);
        expect(rect.top).toBeLessThan(2);
        expect(rect.left).toBeLessThan(2);
      }
    }
  });

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

  it('places clicked cursors on the target line after multiple code blocks', async () => {
    const content = await $('[data-testid="note-editor"] .cm-content');
    await browser.execute((element: HTMLElement) => {
      element.focus();
      document.execCommand('selectAll');
      const clipboardData = new DataTransfer();
      clipboardData.setData('text/plain', [
        'Click geometry fixture',
        ...Array.from({ length: 5 }, (_, block) =>
          `\`\`\`js\nconst block${block} = 0;\nconst target${block} = 1;\nconst end${block} = 2;\n\`\`\`\n\nParagraph after block ${block}.`)
      ].join('\n\n'));
      element.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
    }, content);
    await $('.cm-gn-code-block-line').waitForExist();

    for (let block = 0; block < 5; block++) {
      // Leave the target block inactive so its fences are concealed on click.
      await browser.execute((element: HTMLElement) => {
        const line = element.querySelector('.cm-line')!;
        window.getSelection()!.collapse(line.firstChild!, 1);
      }, content);
      for (const text of [`const target${block}`, `Paragraph after block ${block}`]) {
        await browser.execute((text: string) => {
          const line = [...document.querySelectorAll<HTMLElement>('.cm-line')]
            .find(line => line.textContent?.includes(text))!;
          line.scrollIntoView({ block: 'center' });
        }, text);
        await browser.executeAsync((done: () => void) => requestAnimationFrame(() => requestAnimationFrame(() => done())));
        const point = await browser.execute((text: string) => {
          const line = [...document.querySelectorAll<HTMLElement>('.cm-line')]
            .find(line => line.textContent?.includes(text))!;
          const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
          while (walker.nextNode()) {
            const node = walker.currentNode;
            if (!node.textContent?.length) continue;
            const range = document.createRange();
            range.setStart(node, 0);
            range.setEnd(node, 1);
            const rect = range.getBoundingClientRect();
            if (rect.height) return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
          }
          throw new Error(`Missing rendered text: ${text}`);
        }, text);
        if (browser.isChromium) {
          await browser.action('pointer').move(point).down().up().perform();
        } else {
          // The embedded native driver emits mouse detail=0, which CodeMirror
          // treats as a triple click. Deliver a single click through its real
          // mouse handler, retaining rendered coordinates and hit testing.
          await browser.execute((point: { x: number; y: number }) => {
            const target = document.elementFromPoint(point.x, point.y)!;
            const init = { bubbles: true, cancelable: true, clientX: point.x, clientY: point.y, button: 0, detail: 1 };
            target.dispatchEvent(new MouseEvent('mousedown', { ...init, buttons: 1 }));
            target.dispatchEvent(new MouseEvent('mouseup', init));
          }, point);
        }
        await browser.waitUntil(() => browser.execute((text: string) => {
          const selection = window.getSelection()!;
          const anchor = selection.anchorNode;
          const line = (anchor instanceof Element ? anchor : anchor?.parentElement)?.closest('.cm-line');
          return selection.isCollapsed && Boolean(line?.textContent?.includes(text));
        }, text), { timeout: 2_000, timeoutMsg: `Click missed ${text}` });
        await browser.waitUntil(() => browser.execute(() => {
          const selection = window.getSelection()!;
          const range = document.createRange();
          range.setStart(selection.anchorNode!, selection.anchorOffset);
          range.collapse(true);
          const textRect = range.getBoundingClientRect();
          const cursor = document.querySelector('.cm-cursor-primary')!.getBoundingClientRect();
          return Math.abs(cursor.top - textRect.top) < 2;
        }), { timeout: 2_000, timeoutMsg: `Cursor missed the clicked row in ${text}` });
      }
    }
  });
});
