import { browser, expect, $ } from '@wdio/globals';
import { resetBrowserWorkspace } from '../../support/browserWorkspace';
import { waitForWorkspaceAnimationSettled } from '../../support/workspaceAnimation';

type SearchCapture = { before: number; frames: number[][] };
type CaptureWindow = typeof window & { __searchMotionCapture?: Promise<SearchCapture> };

describe('mobile control presentation during transitions', () => {
  beforeEach(async () => {
    await resetBrowserWorkspace();
    await browser.setWindowSize(393, 852);
    await browser.execute(() => window.__GNEAUXGHTS_E2E__!.seedChatControls());
  });
  afterEach(async () => {
    await browser.sendCommand('Emulation.setTouchEmulationEnabled', { enabled: false });
    await browser.sendCommand('Emulation.clearDeviceMetricsOverride', {});
  });

  for (const [split, touch] of [[false, false], [true, false], [false, true], [true, true]]) {
    it(`retains the outgoing two-row search layout from a ${split ? 'split' : 'solo'} note with ${touch ? 'touch' : 'mouse'} input`, async () => {
      if (touch) {
        await browser.sendCommand('Emulation.setDeviceMetricsOverride', { width: 393, height: 852, deviceScaleFactor: 1, mobile: true });
        await browser.sendCommand('Emulation.setTouchEmulationEnabled', { enabled: true });
      }
      if (split) {
        await $('button[aria-label="Split pane"]').click();
        await $('#pane-command-current').click();
        await waitForWorkspaceAnimationSettled();
      }
      await $('[data-testid="note-search-input"]').click();
      await waitForWorkspaceAnimationSettled();
      await browser.execute(() => {
        const shell = document.querySelector<HTMLElement>('.notepad-search-bar')!;
        const layer = shell.querySelector<HTMLElement>('.shared-search-input-layer')!;
        const input = shell.querySelector('input')!;
        const controls = shell.querySelector('.shared-search-controls')!;
        const read = () => [Number(getComputedStyle(layer).opacity),
          controls.getBoundingClientRect().top - input.getBoundingClientRect().top];
        const before = read()[1], frames: number[][] = [], deadline = performance.now() + 3000;
        (window as CaptureWindow).__searchMotionCapture = new Promise(resolve => {
          let started = 0;
          const sample = (time: number) => {
            if (!started && document.querySelector('[data-dock-motion]')) started = time;
            frames.push(read());
            if (time < deadline && (!started || time - started < 850)) requestAnimationFrame(sample);
            else resolve({ before, frames });
          };
          requestAnimationFrame(sample);
        });
      });
      await $('[data-pane-kind="editor"]:not([data-pane-collapsed]) button[aria-label="Open thought partner"]').click();
      const result = await browser.executeAsync((done: (result: SearchCapture) => void) => {
        (window as CaptureWindow).__searchMotionCapture!.then(result => {
          delete (window as CaptureWindow).__searchMotionCapture;
          done(result);
        });
      });
      expect(result.before).toBeGreaterThan(20);
      const fading = result.frames.filter(([opacity]) => opacity > .01 && opacity < .99);
      expect(fading.length).toBeGreaterThan(1);
      expect(fading.every(([, offset]) => Math.abs(offset - result.before) <= 1)).toBe(true);
      await waitForWorkspaceAnimationSettled();
      await expect($('textarea[aria-label="Message"]')).toBeDisplayed();
    });
  }

  it('restores the expanded Related panel after visiting chat without resetting its scope', async () => {
    await $('button[aria-label="Expand related notes"]').click();
    await expect($('button[aria-label="Collapse related notes"]')).toHaveAttribute('aria-expanded', 'true');
    await $('[data-pane-kind="editor"] button[aria-label="Open thought partner"]').click();
    await waitForWorkspaceAnimationSettled();
    await expect($('.related-bottom-sheet')).not.toExist();
    await $('[data-pane-kind="chat"] button[aria-label="Open previous location"]').click();
    await waitForWorkspaceAnimationSettled();
    await expect($('button[aria-label="Collapse related notes"]')).toHaveAttribute('aria-expanded', 'true');
    await expect($('#related-drawer-panel')).toHaveAttribute('aria-hidden', 'false');
    await expect($('button[aria-label="Show related notes for this note"]')).toHaveElementClass('bg-foreground');
  });

  it('opens and closes model choices without moving the composer or changing its draft', async () => {
    await $('[data-pane-kind="editor"] button[aria-label="Open thought partner"]').click();
    await waitForWorkspaceAnimationSettled();
    const composer = $('textarea[aria-label="Message"]');
    await composer.setValue('Keep this unfinished thought');
    const geometry = () => browser.execute(() =>
      ['.dock-body', '.dock-chat-toggle', '.chat-composer-input'].map(selector => {
        const box = document.querySelector(selector)!.getBoundingClientRect();
        return [box.left, box.top, box.width, box.height];
      }));
    const before = await geometry();
    await $('button[aria-label="AI model"]').click();
    await $('[aria-label="AI provider picker"]').$('button=Server').click();
    expect(await geometry()).toEqual(before);
    await browser.keys('Escape');
    expect(await geometry()).toEqual(before);
    await expect(composer).toHaveValue('Keep this unfinished thought');
    await expect($('button[aria-label="AI model"]')).toHaveText('5.6 Sol');
  });
});
