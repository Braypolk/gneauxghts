import { browser, $ } from '@wdio/globals';
import { mkdirSync } from 'node:fs';
import { resetBrowserWorkspace } from '../../../e2e/support/browserWorkspace';
import { waitForWorkspaceAnimationSettled } from '../../../e2e/support/workspaceAnimation';

describe('compact header blur evidence', () => {
  it('captures header sampling with the shared overflow clip', async () => {
    const output = '.scratch/responsive-screens/evidence/rail-close';
    mkdirSync(output, { recursive: true });
    await resetBrowserWorkspace();
    await browser.execute(() => document.querySelector<HTMLElement>('button[aria-label="Open split pane options"]')!.dispatchEvent(new PointerEvent('pointerenter')));
    await $('button[aria-label="Split with current location"]').click();
    await waitForWorkspaceAnimationSettled();
    await browser.sendCommand('Emulation.setDeviceMetricsOverride', { width: 640, height: 844, deviceScaleFactor: 1, mobile: false });
    await browser.executeAsync((done: () => void) => requestAnimationFrame(() => requestAnimationFrame(() => done())));
    await waitForWorkspaceAnimationSettled();
    await browser.execute(() => {
      for (const scroller of document.querySelectorAll<HTMLElement>('.cm-scroller')) scroller.scrollTop = 250;
      (document.activeElement as HTMLElement)?.blur();
    });
    await browser.saveScreenshot(`${output}/blur-overflow.png`);
    await browser.sendCommand('Emulation.clearDeviceMetricsOverride', {});
  });
});
