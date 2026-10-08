import { browser, expect, $ } from '@wdio/globals';

type LinkTestWindow = typeof window & {
  __GNEAUXGHTS_NATIVE_E2E__: {
    readEditorState(): {
      editor: {
        markdown: string;
        selection: { anchor: number; head: number };
        ownsWebviewFocus: boolean;
      } | null;
    };
    setEditorSelection(anchor: number, head: number): boolean;
  };
};

async function expectEditor(markdown: string, caret: number) {
  await browser.waitUntil(() => browser.execute((expected: string, caret: number) => {
    const editor = (window as LinkTestWindow).__GNEAUXGHTS_NATIVE_E2E__.readEditorState().editor;
    return editor?.markdown === expected && editor.selection.anchor === caret &&
      editor.selection.head === caret && editor.ownsWebviewFocus;
  }, markdown, caret), { timeoutMsg: 'Link editing did not preserve text and focus the expected field' });
}

describe('editor link shortcut', () => {
  it('starts in the appropriate field and tabs through the label, URL, and out of the link', async () => {
    await browser.url('/');
    const content = await $('[data-testid="note-editor"] .cm-content');
    await content.waitForDisplayed({ timeout: 30_000 });
    await $('[data-testid="note-editor"][aria-busy="false"]').waitForExist();

    for (const testCase of [
      { anchor: 2, head: 2, markdown: 'he[]()llo', caret: 3 },
      { anchor: 0, head: 5, markdown: '[hello]()', caret: 8 }
    ]) {
      await browser.execute((element: HTMLElement) => {
        element.focus();
        document.execCommand('selectAll');
        const clipboardData = new DataTransfer();
        clipboardData.setData('text/plain', 'hello');
        element.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
      }, content);
      await browser.waitUntil(() => browser.execute(() =>
        (window as LinkTestWindow).__GNEAUXGHTS_NATIVE_E2E__.readEditorState().editor?.markdown === 'hello'));
      expect(await browser.execute((anchor: number, head: number) =>
        (window as LinkTestWindow).__GNEAUXGHTS_NATIVE_E2E__.setEditorSelection(anchor, head),
      testCase.anchor, testCase.head)).toBe(true);

      // Chrome reserves Cmd/Ctrl+K for its address bar. Send the same event to
      // the editor's DOM handler, then use real typing to verify caret placement.
      expect(await browser.execute((element: HTMLElement) => {
        const mac = /Mac|iPhone|iPad|iPod/i.test(navigator.platform);
        return element.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'k', code: 'KeyK', metaKey: mac, ctrlKey: !mac,
          bubbles: true, cancelable: true
        }));
      }, content)).toBe(false);
      await expectEditor(testCase.markdown, testCase.caret);

      await browser.keys('x');
      let typed = `${testCase.markdown.slice(0, testCase.caret)}x${testCase.markdown.slice(testCase.caret)}`;
      await expectEditor(typed, testCase.caret + 1);

      if (testCase.anchor === testCase.head) {
        await browser.keys('Tab');
        const urlCaret = typed.lastIndexOf(')');
        await expectEditor(typed, urlCaret);
        await browser.keys(['Shift', 'Tab', '\uE000']);
        await expectEditor(typed, typed.lastIndexOf(']('));
        await browser.keys('Tab');
        await expectEditor(typed, urlCaret);
        const url = 'https://example.com/a_(b)';
        await browser.keys(url);
        typed = `${typed.slice(0, urlCaret)}${url}${typed.slice(urlCaret)}`;
        await expectEditor(typed, urlCaret + url.length);
        // Return to the label to check that Tab skips an existing destination
        // all the way to its closing delimiter, including nested parentheses.
        expect(await browser.execute((position: number) =>
          (window as LinkTestWindow).__GNEAUXGHTS_NATIVE_E2E__.setEditorSelection(position, position),
        testCase.caret)).toBe(true);
        await browser.keys('Tab');
        await expectEditor(typed, typed.lastIndexOf(')'));
      }

      await browser.keys(['Shift', 'Tab', '\uE000']);
      const labelEnd = typed.lastIndexOf('](');
      await expectEditor(typed, labelEnd);
      await browser.keys('z');
      typed = `${typed.slice(0, labelEnd)}z${typed.slice(labelEnd)}`;
      await expectEditor(typed, labelEnd + 1);
      await browser.keys('Tab');
      await expectEditor(typed, typed.lastIndexOf(')'));

      await browser.keys('Tab');
      const outside = typed.lastIndexOf(')') + 1;
      await expectEditor(typed, outside);
      await browser.keys('y');
      await expectEditor(`${typed.slice(0, outside)}y${typed.slice(outside)}`, outside + 1);
    }
  });
});
