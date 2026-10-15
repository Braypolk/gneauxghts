import { browser, expect, $ } from '@wdio/globals';
import { resetBrowserWorkspace } from '../../support/browserWorkspace';
import { waitForWorkspaceAnimationSettled } from '../../support/workspaceAnimation';
import { chatHistoryFixture } from '../../support/chatHistoryFixture';

async function installChatFixture(fixture: ReturnType<typeof chatHistoryFixture>) {
  await browser.execute(fixture => {
    const native = window.__TAURI_INTERNALS__ as {invoke: (cmd: string, args?: unknown) => Promise<unknown>};
    const original = native.invoke;
    native.invoke = async (cmd, args) => {
      if (cmd === 'chat_list_conversations') return [fixture];
      if (cmd === 'chat_get_conversation') return fixture;
      if (cmd === 'chat_prepare_note_save') {
        (window as typeof window & {capturedNoteSelection?: unknown}).capturedNoteSelection = args;
        throw new Error('Selection captured by test');
      }
      return original(cmd, args);
    };
  }, fixture);
}

async function capturedSelection() {
  return browser.execute(() => (window as typeof window & {
    capturedNoteSelection?: {selection: {text: string; markdown: string; occurrence: number}}
  }).capturedNoteSelection?.selection);
}

describe('chat text selection', () => {
  beforeEach(async () => {
    await resetBrowserWorkspace();
    await browser.execute(() => window.__GNEAUXGHTS_E2E__!.seedChatControls());
    await installChatFixture(chatHistoryFixture(2));
  });

  it('submits only authored paragraph text when the highlight includes three displayed source-note links', async () => {
    const paragraph = 'The **grocery** note links out to online recipes. Other food-related notes are shopping lists rather than full recipes.';
    const fixture = chatHistoryFixture(2);
    const answer = fixture.messages[1];
    answer.content = `Earlier text.\n\n${paragraph} [Source 1](passage:one) [Source 2](passage:two) [Source 3](passage:three)\n\nLater **grocery**.`;
    (answer as unknown as {sources: unknown[]}).sources = ['one', 'two', 'three'].map(id => ({
      kind: 'passage', noteId: 'grocery', notePath: 'grocery.md', title: 'grocery', excerpt: 'Recipe links.',
      passage: {id, noteId: 'grocery', contentHash: 'fixture', location: 'body', start: 0, end: 13, excerpt: 'Recipe links.', revisions: []}
    }));
    await installChatFixture(fixture);
    await browser.execute(() => document.querySelector<HTMLElement>('button[aria-label="Open thought partner"]')!.click());
    const message = await $('[data-chat-message-id="motion-1"]');
    await message.waitForDisplayed();
    await waitForWorkspaceAnimationSettled();
    expect(await message.$$('button[data-chat-note-citation-id]')).toHaveLength(6);
    await browser.execute(() => {
      const root = document.querySelector<HTMLElement>('[data-chat-message-id="motion-1"]')!;
      const range = document.createRange(); range.selectNodeContents(root.querySelectorAll('.gn-markdown-html p')[1]);
      const selection = getSelection()!; selection.removeAllRanges(); selection.addRange(range);
      root.dispatchEvent(new PointerEvent('pointerup', {bubbles: true}));
    });
    await message.$('button=Save to note').click();
    const captured = await capturedSelection();
    expect(captured).toMatchObject({text: paragraph.replaceAll('**', ''), occurrence: 0});
    expect(captured?.markdown.trim()).toBe(paragraph);
    await browser.execute(() => {
      const root = document.querySelector<HTMLElement>('[data-chat-message-id="motion-1"]')!;
      const range = document.createRange(); range.selectNodeContents(root.querySelectorAll('strong')[1]);
      const selection = getSelection()!; selection.removeAllRanges(); selection.addRange(range);
      root.dispatchEvent(new PointerEvent('pointerup', {bubbles: true}));
    });
    await message.$('button=Save to note').click();
    expect(await capturedSelection()).toEqual({text: 'grocery', markdown: '**grocery**', occurrence: 1});
  });

  it('serializes literal highlights, escaped list text and a partial cross-cell selection', async () => {
    const fixture = chatHistoryFixture(2);
    fixture.messages[1].content = '==**literal**==\n\n1\\. literal with \\*stars\\* and &amp;amp;.\n\n| First | Second |\n| --- | --- |\n| One | Two |';
    await installChatFixture(fixture);
    await browser.execute(() => document.querySelector<HTMLElement>('button[aria-label="Open thought partner"]')!.click());
    const message = await $('[data-chat-message-id="motion-1"]');
    await message.waitForDisplayed();
    await waitForWorkspaceAnimationSettled();
    for (const kind of ['highlight', 'literal', 'cells']) {
      await browser.execute(kind => {
        const root = document.querySelector<HTMLElement>('[data-chat-message-id="motion-1"]')!;
        const range = document.createRange();
        if (kind === 'cells') {
          const cells = root.querySelectorAll('th');
          range.setStart(cells[0].firstChild!, 0);
          range.setEnd(cells[1].firstChild!, cells[1].textContent!.length);
        } else range.selectNodeContents(kind === 'highlight' ? root.querySelector('mark')! : root.querySelectorAll('p')[1]);
        const selection = getSelection()!; selection.removeAllRanges(); selection.addRange(range);
        root.dispatchEvent(new PointerEvent('pointerup', {bubbles: true}));
      }, kind);
      await message.$('button=Save to note').click();
      const selected = await capturedSelection();
      if (kind === 'highlight') expect(selected).toEqual({text: '**literal**', markdown: '==**literal**==', occurrence: 0});
      if (kind === 'literal') {
        expect(selected?.text).toBe('1. literal with *stars* and &amp;.');
        expect(selected?.markdown.trim()).toBe('1\\. literal with \\*stars\\* and \\&amp;.');
      }
      if (kind === 'cells') expect(selected).toEqual({text: 'First Second', markdown: 'First Second ', occurrence: 0});
    }
  });

  for (const split of [true, false]) {
    it(`keeps the editor formatting popup hidden when selecting chat text ${split ? 'beside a note' : 'in the same pane'}`, async () => {
      const editor = await $('[data-testid="note-editor"] .cm-content');
      await browser.execute((element: HTMLElement) => {
        element.focus();
        const range = document.createRange();
        range.selectNodeContents(element);
        const selection = window.getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);
      }, editor);
      await $('[aria-label="Text formatting"]').waitForDisplayed();

      if (split) {
        await browser.execute(() => document.querySelector<HTMLElement>('button[aria-label="Open split pane options"]')!
          .dispatchEvent(new PointerEvent('pointerenter')));
        await $('button[aria-label="Split with thought partner"]').click();
      } else {
        await browser.execute(() => document.querySelector<HTMLElement>('button[aria-label="Open thought partner"]')!.click());
      }
      await $('[data-chat-message-id="motion-1"]').waitForDisplayed();
      await waitForWorkspaceAnimationSettled();
      await expect($('[aria-label="Text formatting"]')).not.toBeDisplayed();
      await $('[data-chat-message-id="motion-1"] .gn-markdown-html p').scrollIntoView({ block: 'start' });
      const point = await browser.execute(() => {
        const paragraph = document.querySelector('[data-chat-message-id="motion-1"] .gn-markdown-html p')!;
        const text = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT).nextNode()!;
        const range = document.createRange();
        range.setStart(text, 0);
        range.setEnd(text, 4);
        const rect = range.getBoundingClientRect();
        return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
      });
      await browser.action('pointer').move(point).down().up().pause(50).down().up().perform();
      expect(await browser.execute(() => {
        const selection = window.getSelection();
        return !!selection?.toString().trim() && !!selection.anchorNode &&
          document.querySelector('[role="log"]')!.contains(selection.anchorNode);
      })).toBe(true);
      await expect($('[aria-label="Text formatting"]')).not.toBeDisplayed();
      await expect($('[data-chat-message-id="motion-1"] .chat-selection-action')).toBeDisplayed();
    });
  }
});
