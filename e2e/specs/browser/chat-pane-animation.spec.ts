import { browser, expect, $ } from '@wdio/globals';
import { seedPiHistory, selectPiConversation } from '../../support/browserPi';
import { samplePaneMotion } from '../../support/paneMotion';
import { resetBrowserWorkspace } from '../../support/browserWorkspace';

async function ready() {
  await resetBrowserWorkspace();
  await seedPiHistory('Populated motion fixture', 40);
  await $('button[aria-label="Open split pane options"]').waitForClickable();
}


async function expectHistoryReady() {
  await browser.waitUntil(async () => browser.execute(() =>
    document.querySelectorAll('[data-testid="pi-user-message"], [data-testid="pi-assistant-message"]').length === 40));
  expect(await browser.execute(() => {
    const log = document.querySelector<HTMLElement>('[role="log"]')!;
    return log.scrollHeight - log.clientHeight - log.scrollTop;
  })).toBeLessThanOrEqual(2);
}

describe('restoring chat while splitting a pane', () => {
  afterEach(async () => {
    await browser.execute(() => {
      (window as any).__stopChatInstrumentation?.();
    });
  });
  it('creates chat directly without mounting another editor or rewriting unchanged insets', async () => {
    await ready();
    const result = await browser.execute(() => new Promise<{
      editorsAdded: number;
      writes: string[];
      sameEditor: boolean;
      chats: number;
      error?: string;
    }>((done) => {
      let editorsAdded = 0;
      const writes: string[] = [];
      const sourceEditor = document.querySelector('.cm-editor');
      const original = CSSStyleDeclaration.prototype.setProperty;
      let finished = false;
      let frame = 0;
      let timeout: ReturnType<typeof setTimeout>;
      let settledFrames = 0;
      const observer = new MutationObserver(records => {
        for (const record of records)
          for (const node of record.addedNodes) {
            if (node instanceof Element)
              editorsAdded += Number(node.matches('.cm-editor')) + node.querySelectorAll('.cm-editor').length;
          }
      });
      const finish = (error?: string) => {
        if (finished)
          return;
        finished = true;
        clearTimeout(timeout);
        cancelAnimationFrame(frame);
        observer.disconnect();
        CSSStyleDeclaration.prototype.setProperty = original;
        delete (window as any).__stopChatInstrumentation;
        done({ editorsAdded, writes, sameEditor: document.querySelector('.cm-editor') === sourceEditor,
          chats: document.querySelectorAll('[data-pane-kind="chat"]').length, ...(error ? { error } : {}) });
      };
      (window as any).__stopChatInstrumentation = () => finish('Instrumentation cancelled before settling');
      timeout = setTimeout(() => finish('Chat split did not settle before instrumentation deadline'), 5000);
      try {
        CSSStyleDeclaration.prototype.setProperty = function (name, value, priority) {
          if (name === '--editor-overlay-inset')
            writes.push(value ?? '');
          return original.call(this, name, value, priority);
        };
        observer.observe(document.querySelector('.notepad-shell')!, { childList: true, subtree: true });
        document.querySelector<HTMLElement>('button[aria-label="Open split pane options"]')!
          .dispatchEvent(new PointerEvent('pointerenter'));
        queueMicrotask(() => {
          try {
            document.querySelector<HTMLElement>('button[aria-label="Split with thought partner"]')!.click();
          }
          catch (error) {
            finish(String(error));
          }
        });
        const sample = () => {
          if (finished)
            return;
          try {
            const settled = document.querySelectorAll('[data-pane-kind="chat"]').length === 1 &&
              !document.querySelector('[data-pane-motion]');
            settledFrames = settled ? settledFrames + 1 : 0;
            if (settledFrames >= 2)
              finish();
            else
              frame = requestAnimationFrame(sample);
          }
          catch (error) {
            finish(String(error));
          }
        };
        frame = requestAnimationFrame(sample);
      }
      catch (error) {
        finish(String(error));
      }
    }));
    expect(result.error).toBeUndefined();
    expect(result.chats).toBe(1);
    expect(result.editorsAdded).toBe(0);
    expect(result.sameEditor).toBe(true);
    expect(result.writes).toHaveLength(0);
    await selectPiConversation('Populated motion fixture');
    await expectHistoryReady();
  });

  it('opens populated Pi history at the latest message after the split settles', async () => {
    await ready();
    const result = await samplePaneMotion('open-chat');
    expect(result.frames.length).toBeGreaterThan(1);
    await selectPiConversation('Populated motion fixture');
    await expectHistoryReady();
    console.log('CHAT_BROWSER_MOTION', JSON.stringify({ maxGap: result.maxGap }));
    await samplePaneMotion('close-right');
  });

  it('can interrupt chat opening and reopen the retained Pi history', async () => {
    await ready();
    const interruption = await browser.execute(() => new Promise<string | null>((done) => {
      document.querySelector<HTMLElement>('button[aria-label="Open split pane options"]')!
        .dispatchEvent(new PointerEvent('pointerenter'));
      queueMicrotask(() => document.querySelector<HTMLElement>('button[aria-label="Split with thought partner"]')!.click());
      let frameId = 0;
      let finished = false;
      const finish = (error: string | null) => {
        if (finished)
          return;
        finished = true;
        clearTimeout(deadline);
        cancelAnimationFrame(frameId);
        done(error);
      };
      const deadline = setTimeout(() => finish('Required history interruption frame was not observed'), 5000);
      const closeWhenRendering = () => {
        if (finished)
          return;
        if (document.querySelector('[data-testid="pi-chat-panel"]')) {
          document.querySelector<HTMLElement>('[data-pane-kind="chat"] button[aria-label="Close pane"]')!.click();
          finish(null);
        }
        else
          frameId = requestAnimationFrame(closeWhenRendering);
      };
      frameId = requestAnimationFrame(closeWhenRendering);
    }));
    expect(interruption).toBeNull();
    await browser.waitUntil(async () => browser.execute(() =>
      document.querySelectorAll('[data-testid="workspace-pane"]').length === 1 && !document.querySelector('[data-pane-motion]')));
    await samplePaneMotion('open-chat');
    await selectPiConversation('Populated motion fixture');
    await expectHistoryReady();
    await samplePaneMotion('close-right');
  });
});
