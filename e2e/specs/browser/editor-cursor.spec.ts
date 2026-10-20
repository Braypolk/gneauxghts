import { browser, expect, $ } from '@wdio/globals';
import { waitForTwoAnimationFrames } from '../../support/animationFrames';

type CursorTestWindow = typeof window & {
  __GNEAUXGHTS_NATIVE_E2E__: {
    readEditorState(): { editor: { markdown: string; selection: { anchor: number; head: number }; ownsWebviewFocus: boolean } | null };
    setEditorSelection(anchor: number, head: number): boolean;
  };
};

async function insertFixture(markdown: string) {
  await browser.execute((markdown: string) => {
    const content = document.querySelector<HTMLElement>('[data-testid="note-editor"] .cm-content')!;
    content.focus();
    document.execCommand('selectAll');
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', markdown);
    content.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
  }, markdown);
  await browser.waitUntil(() => browser.execute((expected: string) =>
    (window as CursorTestWindow).__GNEAUXGHTS_NATIVE_E2E__.readEditorState().editor?.markdown === expected,
  markdown), { timeout: 2_000, timeoutMsg: 'Exact authored cursor fixture was not admitted' });
  await waitForTwoAnimationFrames();
}

async function placeCursor(anchor: number) {
  const actual = await browser.execute((anchor: number) => {
    const bridge = (window as CursorTestWindow).__GNEAUXGHTS_NATIVE_E2E__;
    const applied = bridge.setEditorSelection(anchor, anchor);
    const editor = bridge.readEditorState().editor;
    return { applied, selection: editor?.selection, ownsFocus: editor?.ownsWebviewFocus };
  }, anchor);
  expect(actual).toEqual({ applied: true, selection: { anchor, head: anchor }, ownsFocus: true });
}

// Serialized by WebDriver: all expected geometry comes from DOM Range, not the
// CodeMirror coordinates used by the production cursor renderer. Tokens map to
// authored positions even when Markdown syntax is hidden or widgets add text.
function wrappedRows(element: HTMLElement, markdown: string) {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const nodes: Node[] = [];
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node.textContent && !node.parentElement?.closest('[contenteditable="false"]')) nodes.push(node);
  }
  const rendered = nodes.map(node => node.textContent).join('');
  const words = [...rendered.matchAll(/Wrapped/g)];
  const authored = [...markdown.matchAll(/Wrapped/g)];
  if (words.length !== authored.length) throw new Error('Rendered and authored cursor fixtures differ');
  function point(offset: number): [Node, number] {
    for (const node of nodes) {
      const length = node.textContent!.length;
      if (offset < length) return [node, offset];
      offset -= length;
    }
    throw new Error('Rendered cursor character missing');
  }
  const rows: { anchor: number; top: number; height: number }[] = [];
  for (const [index, word] of words.entries()) {
    const range = document.createRange();
    range.setStart(...point(word.index! + 1));
    range.setEnd(...point(word.index! + 2));
    const rect = range.getBoundingClientRect();
    if (rect.height > 0 && !rows.some(row => Math.abs(row.top - rect.top) < 2)) {
      rows.push({ anchor: authored[index].index! + 1, top: rect.top, height: rect.height });
    }
  }
  return rows.slice(0, 3);
}

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
    if (browser.isChromium) {
      await $('[data-testid="note-editor"] .cm-content').click();
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
      const text = `${prefix}${'Wrapped text should keep a consistent cursor height. '.repeat(12)}${suffix}`;
      await insertFixture(text);
      const rows = await browser.execute(wrappedRows, content, text);
      expect(rows.length).toBeGreaterThanOrEqual(2);

      const heights: number[] = [];
      for (const row of rows) {
        await placeCursor(row.anchor);
        const cursor = await $('[data-testid="note-editor"] .cm-cursor-primary');
        await cursor.waitForExist({ timeout: 2_000 });
        await browser.waitUntil(async () => {
          const current = (await browser.execute(wrappedRows, content, text)).find(item => item.anchor === row.anchor);
          const top = await browser.execute((element: HTMLElement) => element.getBoundingClientRect().top, cursor);
          return current !== undefined && Math.abs(top - current.top) < 2;
        }, { timeout: 2_000, timeoutMsg: `Cursor did not reach authored position ${row.anchor}` });
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
        await browser.execute(() => document.querySelector<HTMLElement>('.gn-editor-root')!.style.setProperty('--gn-editor-font-size', '1rem'));
        await insertFixture(value);
        await $('.cm-gn-date-add').waitForExist();
        await placeCursor(value.length);
        await waitForTwoAnimationFrames();
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
        await waitForTwoAnimationFrames();
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

  it('preserves native range selection over code and plain table Markdown', async () => {
    const markdown = '```\nSelected code\n```\n\n| Column | Other |\n| --- | --- |\n| Value | Cell |';
    await insertFixture(markdown);
    await $('.cm-gn-code-block-line').waitForExist();
    expect(await browser.execute(() => document.querySelectorAll('.gn-markdown-table-line').length)).toBe(0);
    for (const [selector, text] of [['.cm-gn-code-block-line', 'Selected code'], ['.cm-line', 'Column']]) {
      const anchor = markdown.indexOf(text);
      await placeCursor(anchor);
      // Exercise keyboard handling and inspect WebKit/Chromium's resulting
      // native range; cursor geometry setup alone does not establish selection.
      if (browser.isChromium) {
        await browser.keys(['Shift', ...Array.from({ length: text.length }, () => 'ArrowRight'), '\uE000']);
      } else {
        // Embedded driver 1.3.0 dispatch_key_event omits modifier flags for
        // special keys. Deliver Shift+Right to the real CodeMirror handler;
        // assert WebKit's resulting native range rather than setting a range.
        await browser.execute((length: number) => {
          const target = document.activeElement!;
          for (let i = 0; i < length; i++) {
            const init = { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39,
              which: 39, shiftKey: true, bubbles: true, cancelable: true };
            target.dispatchEvent(new KeyboardEvent('keydown', init));
            target.dispatchEvent(new KeyboardEvent('keyup', init));
          }
        }, text.length);
      }
      await browser.waitUntil(() => browser.execute((expected: string, anchor: number) => {
        const editor = (window as CursorTestWindow).__GNEAUXGHTS_NATIVE_E2E__.readEditorState().editor;
        return window.getSelection()?.toString() === expected && editor?.ownsWebviewFocus === true &&
          editor.selection.anchor === anchor && editor.selection.head === anchor + expected.length;
      }, text, anchor), { timeout: 2_000, timeoutMsg: 'Native and editor range selection did not agree' }).catch(async error => {
        const actual = await browser.execute(() => ({
          nativeText: window.getSelection()?.toString(),
          editor: (window as CursorTestWindow).__GNEAUXGHTS_NATIVE_E2E__.readEditorState().editor,
          active: document.activeElement?.className,
          focused: document.hasFocus()
        }));
        throw new Error(`${String(error)}; expected ${JSON.stringify({ text, anchor })}; actual ${JSON.stringify(actual)}`);
      });
      const background = await browser.execute((selector: string, text: string) => {
        const line = [...document.querySelectorAll<HTMLElement>(selector)].find(line => line.textContent?.includes(text))!;
        return getComputedStyle(line, '::selection').backgroundColor;
      }, selector, text);
      expect(background).not.toBe('rgba(0, 0, 0, 0)');
      await $('[data-testid="note-editor"] .cm-cursor-primary').waitForExist({ reverse: true });
    }
    await browser.keys('ArrowRight');
    await $('[data-testid="note-editor"] .cm-cursor-primary').waitForDisplayed();
    await browser.execute(() => document.querySelector<HTMLInputElement>('[data-testid="note-title"]')!.focus());
    await $('[data-testid="note-editor"] .cm-cursor-primary').waitForDisplayed({ reverse: true });
  });

  it('places clicked cursors on the target line after multiple code blocks', async () => {
    const markdown = [
      'Click geometry fixture',
      ...Array.from({ length: 5 }, (_, block) =>
        `\`\`\`js\nconst block${block} = 0;\nconst target${block} = 1;\nconst end${block} = 2;\n\`\`\`\n\nParagraph after block ${block}.`)
    ].join('\n\n');
    await insertFixture(markdown);
    await $('.cm-gn-code-block-line').waitForExist();

    for (let block = 0; block < 5; block++) {
      // Leave the target block inactive so its fences are concealed on click.
      await placeCursor(1);
      for (const text of [`const target${block}`, `Paragraph after block ${block}`]) {
        await browser.execute((text: string) => {
          const line = [...document.querySelectorAll<HTMLElement>('.cm-line')]
            .find(line => line.textContent?.includes(text))!;
          line.scrollIntoView({ block: 'center' });
        }, text);
        await waitForTwoAnimationFrames();
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
          const editor = (window as CursorTestWindow).__GNEAUXGHTS_NATIVE_E2E__.readEditorState().editor;
          const modelLine = editor?.markdown.slice(0, editor.selection.head).split('\n').length;
          return selection.isCollapsed && Boolean(line?.textContent?.includes(text)) &&
            editor?.selection.anchor === editor?.selection.head &&
            Boolean(modelLine && editor?.markdown.split('\n')[modelLine - 1].includes(text));
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
