import { browser, expect, $ } from '@wdio/globals';
import { resetBrowserWorkspace } from '../../support/browserWorkspace';
import { waitForWorkspaceAnimationSettled } from '../../support/workspaceAnimation';

async function setViewportWidth(width: number) {
  await browser.setWindowSize(width, 852);
  // Chrome's native window minimum can exceed the requested Mac/phone width.
  await browser.sendCommand('Emulation.setDeviceMetricsOverride', { width, height: 852, deviceScaleFactor: 1, mobile: false });
  expect(await browser.execute(() => innerWidth)).toBe(width);
  // Resize/media events arrive at rendering boundaries; the suppression marker
  // may not be set yet when the emulation command first returns.
  await browser.executeAsync((done: () => void) => requestAnimationFrame(() => requestAnimationFrame(() => done())));
  await browser.waitUntil(async () => browser.execute(() => !document.querySelector('[data-window-resizing]')));
}

type Frame = { height: number; controls: number[][]; optionsWidth: number; optionsLeft: number; bodyHeight: number; glyphInset: number; glyphOpacity: number; shellWidth: number; circle: number };

async function captureSearchMotion(open: boolean, reverse = false) {
  return browser.executeAsync((open: boolean, reverse: boolean, done: (frames: Frame[]) => void) => {
    const shell = document.querySelector<HTMLElement>('.notepad-search-bar')!;
    const input = shell.querySelector<HTMLInputElement>('input')!;
    const editor = document.querySelector<HTMLElement>('[data-testid="note-editor"] .cm-content')!;
    const controls = Array.from(shell.querySelectorAll('.shared-search-mode-button svg'));
    const read = (): Frame => ({
      height: shell.getBoundingClientRect().height,
      controls: controls.map(control => {
        const rect = control.getBoundingClientRect();
        return [rect.left - shell.getBoundingClientRect().right, rect.top];
      }),
      optionsWidth: shell.querySelector('.shared-search-match-options')!.getBoundingClientRect().width,
      optionsLeft: shell.querySelector('[title="Match case"] svg')!.getBoundingClientRect().left - shell.getBoundingClientRect().right,
      bodyHeight: document.querySelector('.dock-material-body')!.getBoundingClientRect().height,
      glyphInset: document.querySelector('.dock-search-toggle svg')!.getBoundingClientRect().left + 8 - shell.getBoundingClientRect().left,
      glyphOpacity: Number(getComputedStyle(document.querySelector('.dock-search-toggle')!).opacity),
      shellWidth: shell.getBoundingClientRect().width,
      circle: document.querySelector('.dock-search-toggle')!.getBoundingClientRect().width
    });
    const frames = [read()], started = performance.now();
    let reversed = false;
    const focus = (open: boolean) => (open ? input : editor).focus({ preventScroll: true });
    focus(open);
    const sample = () => {
      frames.push(read());
      if (reverse && !reversed && performance.now() - started >= 140) {
        reversed = true;
        focus(!open);
      }
      if (performance.now() - started < 800) requestAnimationFrame(sample);
      else done(frames);
    };
    requestAnimationFrame(sample);
  }, open, reverse);
}

function expectAnchoredControls(frames: Frame[]) {
  for (const frame of frames) {
    expect(frame.glyphInset).toBeGreaterThanOrEqual(8);
    expect(frame.glyphInset).toBeLessThanOrEqual(frame.shellWidth - 8);
  }
  for (let control = 0; control < 2; control++) {
    for (const axis of [0, 1]) {
      const values = frames.map(frame => frame.controls[control][axis]);
      expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(1);
    }
  }
  const circles = frames.map(frame => frame.circle);
  expect(Math.max(...circles) - Math.min(...circles)).toBeLessThanOrEqual(1);
}

describe('compact search row motion', () => {
  beforeEach(resetBrowserWorkspace);
  afterEach(async () => {
    await browser.sendCommand('Emulation.setEmulatedMedia', { features: [] });
    await browser.sendCommand('Emulation.clearDeviceMetricsOverride', {});
  });

  for (const width of [393, 417, 530]) {
    it(`anchors scope buttons on the right while smoothly unfolding and folding the ${width}px bar`, async () => {
      await setViewportWidth(width);
      await waitForWorkspaceAnimationSettled();
      for (const open of [true, false]) {
        const frames = await captureSearchMotion(open);
        expectAnchoredControls(frames);
        expect(frames[0].glyphOpacity).toBe(open ? 1 : 0);
        expect(frames.at(-1)!.glyphOpacity).toBe(open ? 0 : 1);
        if (open) {
          expect(frames.slice(1).every(frame => frame.glyphOpacity === 0)).toBe(true);
        } else {
          expect(frames.filter(frame => frame.glyphOpacity > 0.01 && frame.glyphOpacity < 0.99).length).toBeGreaterThan(4);
        }
        const initial = frames[0].height, final = frames.at(-1)!.height;
        expect(Math.abs(final - initial)).toBeGreaterThan(20);
        const intermediate = frames.filter(frame => frame.height > Math.min(initial, final) + 1 && frame.height < Math.max(initial, final) - 1);
        expect(intermediate.length).toBeGreaterThan(4);
        for (let index = 1; index < frames.length; index++) {
          expect((frames[index].height - frames[index - 1].height) * (open ? 1 : -1)).toBeGreaterThanOrEqual(-1);
          expect((frames[index].optionsLeft - frames[index - 1].optionsLeft) * (open ? -1 : 1)).toBeGreaterThanOrEqual(-1);
          expect((frames[index].glyphOpacity - frames[index - 1].glyphOpacity) * (open ? -1 : 1)).toBeGreaterThanOrEqual(-0.01);
        }
        expect(frames.some(frame => frame.optionsWidth > 1 && frame.optionsWidth < 60)).toBe(true);
        expect(frames.filter(frame => frame.bodyHeight > Math.min(initial, final) + 1 && frame.bodyHeight < Math.max(initial, final) - 1).length).toBeGreaterThan(4);
        expect(Math.abs(frames.at(-1)!.bodyHeight - final)).toBeLessThanOrEqual(1);
        await waitForWorkspaceAnimationSettled();
      }
    });
  }

  it('retains the wider single-row layout while revealing options toward the left', async () => {
    await setViewportWidth(680);
    await waitForWorkspaceAnimationSettled();
    for (const open of [true, false]) {
      const frames = await captureSearchMotion(open);
      expectAnchoredControls(frames);
      expect(frames.every(frame => frame.glyphOpacity === 1)).toBe(true);
      expect(Math.max(...frames.map(frame => frame.height)) - Math.min(...frames.map(frame => frame.height))).toBeLessThanOrEqual(1);
      expect(frames.some(frame => frame.optionsWidth > 1 && frame.optionsWidth < 50)).toBe(true);
    }
  });

  it('keeps populated current-note controls reachable and retains the query row on blur', async () => {
    await setViewportWidth(393);
    const input = $('[data-testid="note-search-input"]');
    await input.click();
    await $('button[aria-label="Search this note only"]').click();
    await input.setValue('Alpha');
    await waitForWorkspaceAnimationSettled();
    await $('button[aria-label="Next match"]').waitForExist();
    await $('button[aria-label="Enable match whole word"]').click();
    await expect($('button[aria-label="Disable match whole word"]')).toHaveAttribute('aria-pressed', 'true');
    const geometry = () => browser.execute(() => {
      const shell = document.querySelector('.notepad-search-bar')!.getBoundingClientRect();
      const field = document.querySelector('[data-testid="note-search-input"]')!.getBoundingClientRect();
      const scope = document.querySelector('button[aria-label="Search all notes"]')!.getBoundingClientRect();
      return { height: shell.height, width: field.width, scopeRight: scope.right, shellRight: shell.right };
    });
    const before = await geometry();
    expect(before.width).toBeGreaterThan(120);
    expect(before.scopeRight).toBeLessThanOrEqual(before.shellRight);
    await browser.execute(() => document.querySelector<HTMLElement>('[data-testid="note-editor"] .cm-content')!.focus());
    await waitForWorkspaceAnimationSettled();
    const after = await geometry();
    expect(after.height).toBe(before.height);
    expect(after.scopeRight).toBe(before.scopeRight);
    await expect(input).toHaveValue('Alpha');
  });

  it('settles the two-row layout immediately with reduced motion', async () => {
    await setViewportWidth(417);
    await browser.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await waitForWorkspaceAnimationSettled();
    const frames = await captureSearchMotion(true);
    expectAnchoredControls(frames);
    expect(frames[1].height - frames[0].height).toBeGreaterThan(20);
    expect(frames.slice(1).every(frame => Math.abs(frame.height - frames.at(-1)!.height) <= 1)).toBe(true);
    expect(frames.slice(1).every(frame => frame.glyphOpacity === 0)).toBe(true);
  });

  it('reverses an unfolding bar from its displayed height without moving the scope buttons', async () => {
    await setViewportWidth(417);
    await waitForWorkspaceAnimationSettled();
    const frames = await captureSearchMotion(true, true);
    expectAnchoredControls(frames);
    expect(Math.max(...frames.map(frame => frame.height)) - frames[0].height).toBeGreaterThan(10);
    expect(Math.abs(frames.at(-1)!.height - frames[0].height)).toBeLessThanOrEqual(1);
    expect(frames.at(-1)!.glyphOpacity).toBe(1);
    expect(frames.some(frame => frame.glyphOpacity > 0.01 && frame.glyphOpacity < 0.99)).toBe(true);
    for (let index = 1; index < frames.length; index++) {
      expect(Math.abs(frames[index].height - frames[index - 1].height)).toBeLessThan(20);
    }
    await expect($('.notepad-search-bar')).toHaveAttribute('data-search-open', 'false');
  });
});
