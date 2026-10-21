import { browser, expect, $ } from '@wdio/globals';
import { resetBrowserWorkspace } from '../../support/browserWorkspace';
import { waitForWorkspaceAnimationSettled } from '../../support/workspaceAnimation';

describe('compact split control continuity', () => {
  afterEach(async () => {
    await browser.sendCommand('Emulation.clearDeviceMetricsOverride', {});
  });

  for (const width of [320, 420, 480, 638]) {
    it(`keeps button sizes and spacing stable and moves the tab selector with split at ${width}px`, async () => {
      await resetBrowserWorkspace();
      await browser.sendCommand('Emulation.setDeviceMetricsOverride', { width, height: 950, deviceScaleFactor: 1, mobile: false });
      await waitForWorkspaceAnimationSettled();
      const measureActions = () => browser.execute(() => {
        const pane = document.querySelector('[data-testid="workspace-pane"]:not([data-pane-collapsed])')!;
        const buttons = [...pane.querySelectorAll<HTMLElement>('.pane-header-right button')].filter(button => button.checkVisibility());
        const nav = document.querySelector('button[aria-label="Switch tab"]')!.getBoundingClientRect();
        const options = pane.querySelector('button[aria-label="Note options"]')!.getBoundingClientRect();
        return {
          fits: options.right <= nav.left && buttons.every(button => button.getBoundingClientRect().left >= nav.right),
          sizes: [pane.querySelector('button[aria-label="Note options"]')!, ...buttons].map(button => {
            const rect = button.getBoundingClientRect();
            return [rect.width, rect.height];
          }),
          gaps: buttons.slice(1).map((button, index) => button.getBoundingClientRect().left - buttons[index].getBoundingClientRect().right)
        };
      });
      const solo = await measureActions();
      expect(solo.fits).toBe(true);
      const sample = (action: 'open' | 'exchange' | 'close') => browser.execute((action: string) => new Promise<{
        x: number;
        moving: boolean;
        animated: boolean;
      }[]>((done) => {
        const nav = document.querySelector<HTMLElement>('.app-navigation-header--compact')!;
        const frames: Array<{
          x: number;
          moving: boolean;
          animated: boolean;
        }> = [];
        const read = () => frames.push({ x: nav.querySelector('button')!.getBoundingClientRect().left,
          moving: !!document.querySelector('[data-pane-motion]'), animated: nav.getAnimations().some(animation => animation.playState === 'running') });
        read();
        document.querySelector<HTMLButtonElement>(action === 'close'
          ? '[data-testid="workspace-pane"]:not([data-pane-collapsed]) button[aria-label="Close pane"]'
          : action === 'exchange' ? '.pane-rail' : 'button[aria-label="Split pane"]')!.click();
        const until = performance.now() + 650;
        const next = () => {
          read();
          if (performance.now() < until)
            requestAnimationFrame(next);
          else
            done(frames);
        };
        requestAnimationFrame(next);
      }), action);
      const opening = await sample('open');
      await $('#pane-command-current').waitForDisplayed();
      await waitForWorkspaceAnimationSettled();
      expect(await measureActions()).toEqual(solo);
      const exchange = await sample('exchange');
      await waitForWorkspaceAnimationSettled();
      expect(await measureActions()).toEqual(solo);
      const closing = await sample('close');
      await waitForWorkspaceAnimationSettled();
      expect(await measureActions()).toEqual(solo);
      expect(Math.abs(opening.at(-1)!.x - opening[0].x)).toBeLessThan(1);
      for (const frames of [exchange, closing]) {
        // The selector must travel with the reveal rather than jump 48px as
        // soon as collapsed-pane membership changes (or when close retires it).
        expect(frames.some(frame => frame.moving && frame.animated)).toBe(true);
        expect(Math.abs(frames[1].x - frames[0].x)).toBeLessThan(2);
        const min = Math.min(frames[0].x, frames.at(-1)!.x), max = Math.max(frames[0].x, frames.at(-1)!.x);
        expect(max - min).toBeGreaterThan(40);
        const middle = frames.filter(frame => frame.x > min + 1 && frame.x < max - 1);
        expect(middle.length).toBeGreaterThan(3);
      }
    });
  }
});
