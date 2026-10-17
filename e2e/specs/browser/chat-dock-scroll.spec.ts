import { browser, expect, $ } from '@wdio/globals';
import { resetBrowserWorkspace } from '../../support/browserWorkspace';
import { waitForWorkspaceAnimationSettled } from '../../support/workspaceAnimation';
import { seedPiHistory, openBrowserPiPane, selectPiConversation } from '../../support/browserPi';
import { dockMorphDuration } from '../../../src/lib/features/notepad/ui/workspaceDockMachine';

describe('chat reading position across input modes', () => {
  beforeEach(async () => {
    await resetBrowserWorkspace();
    await seedPiHistory('Dock reading fixture', 10);
    await openBrowserPiPane();
    await selectPiConversation('Dock reading fixture');
    await $('[data-testid="pi-assistant-message"]:last-child').waitForExist();
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
              const message = log.querySelector<HTMLElement>('[data-testid="pi-assistant-message"]:last-child')!;
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
