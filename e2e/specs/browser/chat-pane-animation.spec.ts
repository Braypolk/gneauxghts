import { browser, expect, $ } from '@wdio/globals';
import { chatHistoryFixture } from '../../support/chatHistoryFixture';
import { samplePaneMotion } from '../../support/paneMotion';

async function ready() {
  await browser.setWindowSize(1440, 1000);
  await browser.url('/');
  await $('[data-testid="note-editor"] .cm-content').waitForDisplayed({ timeout: 30_000 });
  await browser.execute(fixture => {
    const native = window.__TAURI_INTERNALS__ as { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
    const original = native.invoke;
    native.invoke = async (cmd, args) => {
      if (cmd === 'chat_get_settings') return { provider: 'openai', model: 'fixture', defaultAccess: 'full' };
      if (cmd === 'chat_list_conversations') return [fixture];
      if (cmd === 'chat_get_conversation') return fixture;
      if (cmd === 'chat_get_composer_draft') return '';
      return original(cmd, args);
    };
  }, chatHistoryFixture());
  await browser.pause(400);
}

async function expectHistoryReady() {
  await browser.waitUntil(async () => browser.execute(() =>
    document.querySelectorAll('[data-chat-message-id]').length === 100 &&
    document.querySelector('[role="log"]')?.getAttribute('aria-busy') === 'false'));
  expect(await browser.execute(() => {
    const log = document.querySelector<HTMLElement>('[role="log"]')!;
    return log.scrollHeight - log.clientHeight - log.scrollTop;
  })).toBeLessThanOrEqual(2);
}

describe('restoring chat while splitting a pane', () => {
  it('creates chat directly without mounting another editor or rewriting unchanged insets', async () => {
    await ready();
    const result = await browser.executeAsync((done: (result: { editorsAdded: number; writes: string[]; sameEditor: boolean; chats: number }) => void) => {
      let editorsAdded = 0;
      const writes: string[] = [];
      const sourceEditor = document.querySelector('.cm-editor');
      const original = CSSStyleDeclaration.prototype.setProperty;
      CSSStyleDeclaration.prototype.setProperty = function(name, value, priority) {
        if (name === '--editor-overlay-inset') writes.push(value ?? '');
        return original.call(this, name, value, priority);
      };
      const observer = new MutationObserver(records => {
        for (const record of records) for (const node of record.addedNodes) {
          if (node instanceof Element) {
            editorsAdded += Number(node.matches('.cm-editor')) + node.querySelectorAll('.cm-editor').length;
          }
        }
      });
      observer.observe(document.querySelector('.notepad-shell')!, { childList: true, subtree: true });
      document.querySelector<HTMLElement>('button[aria-label="Open split pane options"]')!
        .dispatchEvent(new PointerEvent('pointerenter'));
      queueMicrotask(() => document.querySelector<HTMLElement>('button[aria-label="Split with thought partner"]')!.click());
      setTimeout(() => {
        observer.disconnect();
        CSSStyleDeclaration.prototype.setProperty = original;
        done({ editorsAdded, writes, sameEditor: document.querySelector('.cm-editor') === sourceEditor,
          chats: document.querySelectorAll('[data-pane-kind="chat"]').length });
      }, 700);
    });
    expect(result.chats).toBe(1);
    expect(result.editorsAdded).toBe(0);
    expect(result.sameEditor).toBe(true);
    expect(result.writes).toHaveLength(0);
    await expectHistoryReady();
  });

  it('yields between message batches and opens at the latest message', async () => {
    await ready();
    const result = await samplePaneMotion('open-chat');
    expect(result.frames.some(frame => frame.messages > 0 && frame.messages < 100 && frame.chatBusy)).toBe(true);
    await expectHistoryReady();
    console.log('CHAT_BROWSER_MOTION', JSON.stringify({ maxGap: result.maxGap }));
    await samplePaneMotion('close-right');
  });

  it('can close during history rendering and reopen without stale rendering work', async () => {
    await ready();
    await browser.executeAsync(done => {
      document.querySelector<HTMLElement>('button[aria-label="Open split pane options"]')!
        .dispatchEvent(new PointerEvent('pointerenter'));
      queueMicrotask(() => document.querySelector<HTMLElement>('button[aria-label="Split with thought partner"]')!.click());
      const closeWhenRendering = () => {
        const count = document.querySelectorAll('[data-chat-message-id]').length;
        if (count > 0 && count < 100) {
          document.querySelector<HTMLElement>('[data-pane-kind="chat"] button[aria-label="Close pane"]')!.click();
          done();
        } else requestAnimationFrame(closeWhenRendering);
      };
      requestAnimationFrame(closeWhenRendering);
    });
    await browser.waitUntil(async () => browser.execute(() =>
      document.querySelectorAll('[data-testid="workspace-pane"]').length === 1 && !document.querySelector('[data-pane-motion]')));
    await samplePaneMotion('open-chat');
    await expectHistoryReady();
    await samplePaneMotion('close-right');
  });
});
