import { browser, expect, $ } from '@wdio/globals';
import { resetBrowserWorkspace } from '../../support/browserWorkspace';
import { waitForWorkspaceAnimationSettled } from '../../support/workspaceAnimation';
import { chatHistoryFixture } from '../../support/chatHistoryFixture';

describe('chat text selection', () => {
  beforeEach(async () => {
    await resetBrowserWorkspace();
    await browser.execute(fixture => {
      window.__GNEAUXGHTS_E2E__!.seedChatControls();
      const native = window.__TAURI_INTERNALS__ as { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      const original = native.invoke;
      native.invoke = async (cmd, args) => {
        if (cmd === 'chat_list_conversations') return [fixture];
        if (cmd === 'chat_get_conversation') return fixture;
        return original(cmd, args);
      };
    }, chatHistoryFixture(2));
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
