import { browser, $, expect } from '@wdio/globals';
import { resetBrowserWorkspace } from '../../support/browserWorkspace';
import { waitForWorkspaceAnimationSettled } from '../../support/workspaceAnimation';

describe('background saving through mounted owners', () => {
  beforeEach(async () => { await resetBrowserWorkspace(); });
  afterEach(async () => {
    await browser.execute(() => {
      delete (document as unknown as { visibilityState?: string }).visibilityState;
      document.dispatchEvent(new Event('visibilitychange'));
    });
  });

  for (const signal of ['hidden', 'pagehide', 'native']) {
    it(`saves the latest note on ${signal} before its debounce timer`, async () => {
      const saved = await browser.executeAsync((signal: string, done: (result: { markdown: unknown; calls: number }) => void) => {
        const original = window.setTimeout;
        const deferred: number[] = [];
        // Freeze only the save debounce; lifecycle flush must dispatch anyway.
        window.setTimeout = ((callback: TimerHandler, delay?: number, ...args: unknown[]) => {
          const id = original(callback, delay === 1000 ? 60_000 : delay, ...args);
          if (delay === 1000) deferred.push(id);
          return id;
        }) as typeof window.setTimeout;
        const bridge = window.__GNEAUXGHTS_E2E__!;
        const before = bridge.invocations.length;
        const editor = document.querySelector<HTMLElement>('[data-testid="note-editor"] .cm-content')!;
        editor.focus(); document.execCommand('selectAll'); document.execCommand('insertText', false, 'Latest text before background');
        if (signal === 'hidden') {
          Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
          document.dispatchEvent(new Event('visibilitychange'));
        } else if (signal === 'pagehide') window.dispatchEvent(new Event('pagehide'));
        else bridge.emit('app://backgrounding', null);
        window.setTimeout = original;
        original(() => {
          deferred.forEach(id => clearTimeout(id));
          const calls = bridge.invocations.slice(before).filter(call => call.command === 'save_note');
          done({ markdown: calls.at(-1)?.args.markdown, calls: calls.length });
        }, 100);
      }, signal);
      expect(saved).toEqual({ markdown: 'Latest text before background', calls: 1 });
      expect(await $('[data-testid="note-editor"] .cm-content').getText()).toBe('Latest text before background');
    });
  }

  it('persists unsent chat text on background without sending or creating a conversation', async () => {
    await browser.execute(() => {
      window.__GNEAUXGHTS_E2E__!.seedChatControls();
      document.querySelector<HTMLElement>('button[aria-label="Open split pane options"]')!.dispatchEvent(new PointerEvent('pointerenter'));
    });
    await $('button[aria-label="Split with thought partner"]').click();
    await $('[data-notepad-command-bar] textarea').waitForEnabled();
    await waitForWorkspaceAnimationSettled();
    const result = await browser.executeAsync((done: (result: { bodies: unknown[]; sends: number }) => void) => {
      const original = window.setTimeout;
      const deferred: number[] = [];
      window.setTimeout = ((callback: TimerHandler, delay?: number, ...args: unknown[]) => {
        const id = original(callback, delay === 400 ? 60_000 : delay, ...args);
        if (delay === 400) deferred.push(id);
        return id;
      }) as typeof window.setTimeout;
      const bridge = window.__GNEAUXGHTS_E2E__!;
      const before = bridge.invocations.length;
      const input = document.querySelector<HTMLTextAreaElement>('[data-notepad-command-bar] textarea')!;
      input.value = 'Unsent thought before locking'; input.dispatchEvent(new Event('input', { bubbles: true }));
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
      window.setTimeout = original;
      original(() => {
        deferred.forEach(id => clearTimeout(id));
        const calls = bridge.invocations.slice(before);
        done({ bodies: calls.filter(call => call.command === 'chat_set_composer_draft').map(call => call.args.body),
          sends: calls.filter(call => ['chat_send_message', 'chat_create_conversation'].includes(call.command)).length });
      }, 100);
    });
    expect(result.bodies).toContain('Unsent thought before locking');
    expect(result.sends).toBe(0);
    await expect($('[data-notepad-command-bar] textarea')).toHaveValue('Unsent thought before locking');
  });
});
