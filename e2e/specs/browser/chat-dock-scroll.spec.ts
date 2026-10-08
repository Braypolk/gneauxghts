import { browser, expect, $ } from '@wdio/globals';
import { resetBrowserWorkspace } from '../../support/browserWorkspace';
import { waitForWorkspaceAnimationSettled } from '../../support/workspaceAnimation';
import { chatHistoryFixture } from '../../support/chatHistoryFixture';
import { dockMorphDuration } from '../../../src/lib/features/notepad/ui/workspaceDockMachine';

describe('chat reading position across input modes', () => {
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
      document.querySelector<HTMLElement>('button[aria-label="Open split pane options"]')!
        .dispatchEvent(new PointerEvent('pointerenter'));
    }, chatHistoryFixture(10));
    await $('button[aria-label="Split with thought partner"]').click();
    await $('[data-chat-message-id="motion-9"]').waitForExist();
    await browser.waitUntil(async () => (await $('[role="log"]').getAttribute('aria-busy')) === 'false');
    await waitForWorkspaceAnimationSettled();
  });

  afterEach(async () => {
    await browser.sendCommand('Emulation.setEmulatedMedia', { features: [] });
  });

  for (const { reducedMotion, narrow, suffix } of [
    { reducedMotion: false, narrow: false, suffix: '' },
    { reducedMotion: true, narrow: false, suffix: ' with reduced motion' },
    { reducedMotion: false, narrow: true, suffix: ' in a narrow window' }
  ]) {
    it(`keeps messages still at the bottom and in history${suffix}`, async () => {
      if (narrow) {
        await browser.setWindowSize(600, 900);
        await waitForWorkspaceAnimationSettled();
      }
      if (reducedMotion) await browser.sendCommand('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
      });
      for (const draft of ['', 'First line\nSecond line\nThird line\nFourth line\nFifth line']) {
        await browser.execute(value => {
          const textarea = document.querySelector<HTMLTextAreaElement>('[data-notepad-command-bar] textarea')!;
          textarea.value = value;
          textarea.dispatchEvent(new Event('input', { bubbles: true }));
        }, draft);
        await browser.pause(150);
        for (const atBottom of [true, false]) {
          await browser.execute(bottom => {
            const log = document.querySelector<HTMLElement>('[role="log"]')!;
            log.scrollTop = bottom ? log.scrollHeight : (log.scrollHeight - log.clientHeight) / 2;
          }, atBottom);
          await browser.pause(100);
          for (const label of ['Expand search', 'Expand chat input', 'Expand search', 'Expand chat input']) {
            const positions = await browser.executeAsync((buttonLabel: string, duration: number,
              done: (result: { scroll: number[]; message: number[]; heights: number[] }) => void) => {
              const log = document.querySelector<HTMLElement>('[role="log"]')!;
              const message = log.querySelector<HTMLElement>('[data-chat-message-id="motion-9"]')!;
              const dock = document.querySelector('[data-input-dock-mode] > .dock-body')!;
              const scroll: number[] = [], messagePositions: number[] = [], heights: number[] = [];
              const read = () => {
                scroll.push(log.scrollTop);
                messagePositions.push(message.getBoundingClientRect().top);
                heights.push(dock.getBoundingClientRect().height);
              };
              read();
              document.querySelector<HTMLElement>(`button[aria-label="${buttonLabel}"]`)!.click();
              const started = performance.now();
              const frame = () => {
                read();
                if (performance.now() - started < duration) requestAnimationFrame(frame);
                else done({ scroll, message: messagePositions, heights });
              };
              requestAnimationFrame(frame);
            }, label, dockMorphDuration + 350);
            expect(Math.max(...positions.heights) - Math.min(...positions.heights)).toBeGreaterThan(20);
            expect(Math.max(...positions.scroll) - Math.min(...positions.scroll)).toBeLessThanOrEqual(1);
            expect(Math.max(...positions.message) - Math.min(...positions.message)).toBeLessThanOrEqual(1);
          }
        }
      }
    });
  }
});
