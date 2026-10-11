import { browser, $ } from '@wdio/globals';
import { mkdirSync } from 'node:fs';
import { resetBrowserWorkspace, openRecentNote } from '../../../e2e/support/browserWorkspace';
import { waitForWorkspaceAnimationSettled } from '../../../e2e/support/workspaceAnimation';

describe('rail close visual evidence', () => {
  it('captures both hides at midpoint and near completion', async () => {
    const output = '.scratch/responsive-screens/evidence/rail-close';
    mkdirSync(output, { recursive: true });
    for (const width of [390, 640]) for (const side of ['left', 'right']) for (const phase of [0.5, 0.95]) {
      await browser.sendCommand('Emulation.clearDeviceMetricsOverride', {});
      await resetBrowserWorkspace();
      await browser.waitUntil(async () => browser.execute(() => document.activeElement?.matches('.cm-content')));
      await openRecentNote('Beta note');
      await browser.execute(() => document.querySelector<HTMLElement>('button[aria-label="Open split pane options"]')!.dispatchEvent(new PointerEvent('pointerenter')));
      await $('button[aria-label="Split with previous location"]').click();
      await waitForWorkspaceAnimationSettled();
      await browser.sendCommand('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: false });
      await browser.executeAsync((done: () => void) => requestAnimationFrame(() => requestAnimationFrame(() => done())));
      await browser.waitUntil(async () => browser.execute(() => !document.querySelector('[data-window-resizing]')));
      await waitForWorkspaceAnimationSettled();
      if (side === 'left') {
        await $('.pane-rail').click(); await waitForWorkspaceAnimationSettled();
      }
      await browser.execute(() => {
        for (const scroller of document.querySelectorAll<HTMLElement>('.cm-scroller')) scroller.scrollTop = 250;
      });
      await browser.executeAsync((phase: number, done: () => void) => {
        const pane = document.querySelector<HTMLElement>('[data-pane-compact]:not([data-pane-collapsed])')!;
        pane.querySelector<HTMLButtonElement>('button[aria-label="Close pane"]')!.click();
        const sample = () => setTimeout(() => {
          if (!pane.getAnimations().length) requestAnimationFrame(sample);
          else {
            // Seek immediately, leaving cleanup's deadline well beyond capture.
            for (const animation of document.getAnimations()) {
              if (animation.effect?.getTiming().iterations === Infinity) continue;
              animation.pause();
              animation.currentTime = Number(animation.effect?.getTiming().duration) * phase;
            }
            requestAnimationFrame(() => done());
          }
        }, 0);
        requestAnimationFrame(sample);
      }, phase);
      await browser.saveScreenshot(`${output}/${width}-${side}-${phase}.png`);
      await browser.execute(() => { for (const animation of document.getAnimations()) if (animation.playState === 'paused') animation.play(); });
      await waitForWorkspaceAnimationSettled();
    }
    await browser.sendCommand('Emulation.clearDeviceMetricsOverride', {});
  });
});
