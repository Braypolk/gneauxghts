import { browser, expect, $ } from '@wdio/globals';
import { resetBrowserWorkspace } from '../../support/browserWorkspace';
import { waitForWorkspaceAnimationSettled } from '../../support/workspaceAnimation';
import { seedPiHistory, openBrowserPiPane, selectPiConversation } from '../../support/browserPi';
import { containerMorphDuration as dockMorphDuration } from '../../../src/lib/ui/morphing-containers/motion';

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
            const positions = await browser.execute((buttonLabel: string, duration: number) => new Promise<{
              scroll: number[];
              message: number[];
              heights: number[];
              frameHeights: number[];
            }>((done) => {
              const log = document.querySelector<HTMLElement>('[role="log"]')!;
              const message = log.querySelector<HTMLElement>('[data-testid="pi-assistant-message"]:last-child')!;
              const dock = document.querySelector('[data-input-dock-mode] > .dock-body')!;
              const dockFrame = document.querySelector('[data-notepad-command-bar]')!.parentElement!;
              const scroll: number[] = [], messagePositions: number[] = [], heights: number[] = [], frameHeights: number[] = [];
              const read = () => {
                scroll.push(log.scrollTop);
                messagePositions.push(message.getBoundingClientRect().top);
                heights.push(dock.getBoundingClientRect().height);
                frameHeights.push(dockFrame.getBoundingClientRect().height);
              };
              read();
              document.querySelector<HTMLElement>(`button[aria-label="${buttonLabel}"]`)!.click();
              const started = performance.now();
              const frame = () => {
                read();
                if (performance.now() - started < duration)
                  requestAnimationFrame(frame);
                else
                  done({ scroll, message: messagePositions, heights, frameHeights });
              };
              requestAnimationFrame(frame);
            }), label, dockMorphDuration + 350);
            expect(Math.max(...positions.heights) - Math.min(...positions.heights)).toBeGreaterThan(20);
            expect(Math.max(...positions.frameHeights) - Math.min(...positions.frameHeights)).toBeLessThanOrEqual(1);
            expect(Math.max(...positions.scroll) - Math.min(...positions.scroll)).toBeLessThanOrEqual(1);
            expect(Math.max(...positions.message) - Math.min(...positions.message)).toBeLessThanOrEqual(1);
          }
        }
      }
    });
  }

  it('lets pointer input reach chat through unused space above the collapsed bar', async () => {
    await $('button[aria-label="Expand search"]').click();
    await waitForWorkspaceAnimationSettled();
    await browser.execute(() => (document.activeElement as HTMLElement)?.blur());
    await waitForWorkspaceAnimationSettled();
    const hit = await browser.execute(() => {
      const bar = document.querySelector('[data-notepad-command-bar]')!;
      const frame = bar.parentElement!.getBoundingClientRect();
      const log = document.querySelector<HTMLElement>('[role="log"]')!;
      const unusedHeight = bar.getBoundingClientRect().top - frame.top;
      const target = document.elementFromPoint(log.getBoundingClientRect().left + 20, frame.top + unusedHeight / 2);
      return { unusedHeight, reachesChat: target !== null && log.contains(target) };
    });
    expect(hit.unusedHeight).toBeGreaterThan(20);
    expect(hit.reachesChat).toBe(true);
  });

  it('does not offer Related for solo chat or alter its scroll geometry', async () => {
    await $('[data-pane-kind="editor"] button[aria-label="Close pane"]').click();
    await waitForWorkspaceAnimationSettled();
    await expect($('button[aria-label="Related notes"]')).not.toExist();
    await browser.waitUntil(() => browser.execute(() => {
      const log = document.querySelector<HTMLElement>('[role="log"]')!;
      return log.scrollHeight - log.clientHeight - log.scrollTop <= 2;
    }));
  });
});
