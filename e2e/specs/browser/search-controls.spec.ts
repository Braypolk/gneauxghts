import { browser, expect, $ } from '@wdio/globals';
import { resetBrowserWorkspace } from '../../support/browserWorkspace';
import { waitForWorkspaceAnimationSettled } from '../../support/workspaceAnimation';

describe('search scope label animation', () => {
  beforeEach(resetBrowserWorkspace);

  it('keeps scope hit areas on their visible buttons when labels collapse', async () => {
    for (const expanded of [false, true, false]) {
      await browser.execute((expanded: boolean) => {
        const input = document.querySelector<HTMLInputElement>('[data-testid="note-search-input"]')!;
        if (expanded) input.focus({ preventScroll: true });
        else input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      }, expanded);
      await waitForWorkspaceAnimationSettled();
      const misses = await browser.execute(() => {
        const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('.notepad-search-bar .shared-search-mode-button'));
        const misses: string[] = [];
        for (const button of buttons) {
          const rect = button.getBoundingClientRect();
          for (const x of [rect.left + 4, rect.left + rect.width / 2, rect.right - 4]) {
            const target = document.elementFromPoint(x, rect.top + rect.height / 2)?.closest('button');
            if (target !== button) misses.push(`${button.ariaLabel} hit ${target?.ariaLabel ?? 'no button'}`);
          }
        }
        const last = buttons.at(-1)!.getBoundingClientRect();
        for (const offset of [4, 12, 24, 48]) {
          const target = document.elementFromPoint(last.right + offset, last.top + last.height / 2)?.closest('button');
          if (target && buttons.includes(target)) misses.push(`Scope hit ${offset}px beyond its button`);
        }
        return misses;
      });
      expect(misses).toEqual([]);
    }

    await $('button[aria-label="Search all notes"]').click();
    await expect($('button[aria-label="Search all notes"]')).toHaveAttribute('aria-pressed', 'true');
    await $('button[aria-label="Search this note only"]').click();
    await expect($('button[aria-label="Search this note only"]')).toHaveAttribute('aria-pressed', 'true');
  });

  it('keeps a phone query readable without an image-upload control', async () => {
    await browser.setWindowSize(393, 852);
    const input = $('[data-testid="note-search-input"]');
    await input.setValue('a recipe for dinner');
    await waitForWorkspaceAnimationSettled();
    const geometry = await browser.execute(() => {
      const shell = document.querySelector('.notepad-search-bar')!;
      const field = shell.querySelector('input[type="text"]')!.getBoundingClientRect();
      const controls = shell.querySelector('.shared-search-controls')!.getBoundingClientRect();
      return { width: field.width, right: controls.right, viewport: innerWidth, top: field.top, controlsTop: controls.top };
    });
    expect(geometry.width).toBeGreaterThan(120);
    expect(geometry.right).toBeLessThanOrEqual(geometry.viewport);
    expect(geometry.controlsTop).toBeGreaterThan(geometry.top);
    await expect($('button[aria-label="Search with an image"]')).not.toExist();
    await expect($('.notepad-search-bar input[type="file"]')).not.toExist();
    await $('button[aria-label="Clear search"]').click();
    await expect(input).toHaveValue('');
  });

  for (const query of ['', 'Alpha']) {
    it(`fades ${query ? 'populated' : 'idle'} editor search into chat without changing the outgoing scope-label widths`, async () => {
        if (query) await $('[data-testid="note-search-input"]').setValue(query);
      await waitForWorkspaceAnimationSettled();
      const result = await browser.executeAsync((done: (result: { widths: number[]; frames: number[][] }) => void) => {
        const shell = document.querySelector('.notepad-search-bar')!;
        const layer = shell.closest('[data-container-surface="search"]')!;
        const labels = Array.from(shell.querySelectorAll<HTMLElement>('.shared-search-mode-label'));
        const widths = labels.map(label => label.getBoundingClientRect().width);
        const frames: number[][] = [], started = performance.now();
        document.querySelector<HTMLElement>('[data-pane-kind="editor"] button[aria-label="Open thought partner"]')!.click();
        const sample = () => {
          for (const label of labels) {
            frames.push([label.getBoundingClientRect().width, Number(getComputedStyle(layer).opacity),
              Number(getComputedStyle(label.querySelector('.shared-search-mode-label-text')!).opacity)]);
          }
          if (performance.now() - started < 850) requestAnimationFrame(sample);
          else done({ widths, frames });
        };
        requestAnimationFrame(sample);
      });
      expect(result.frames.some(frame => frame[1] > 0 && frame[1] < 1)).toBe(true);
      for (let label = 0; label < 2; label++) {
        const visible = result.frames.filter((frame, index) => index % 2 === label && frame[1] > 0.001);
        expect(visible.length).toBeGreaterThan(1);
        expect(Math.max(...visible.map(frame => Math.abs(frame[0] - result.widths[label])))).toBeLessThanOrEqual(1);
        if (!query) expect(Math.max(...visible.map(frame => frame[2]))).toBe(0);
      }
      await waitForWorkspaceAnimationSettled();
      await expect($('[data-notepad-command-bar] textarea')).toBeDisplayed();
    });

    it(`returns from chat to ${query ? 'populated' : 'idle'} editor search without flashing or resizing the scope labels`, async () => {
        if (query) await $('[data-testid="note-search-input"]').setValue(query);
      await waitForWorkspaceAnimationSettled();
      await browser.execute(() => document.querySelector<HTMLElement>('[data-pane-kind="editor"] button[aria-label="Open thought partner"]')!.click());
      await $('[data-notepad-command-bar] textarea').waitForEnabled();
      await waitForWorkspaceAnimationSettled();
      const frames = await browser.executeAsync((done: (frames: number[][]) => void) => {
        const shell = document.querySelector('.notepad-search-bar')!;
        const labels = Array.from(shell.querySelectorAll<HTMLElement>('.shared-search-mode-label'));
        const frames: number[][] = [], started = performance.now();
        document.querySelector<HTMLElement>('[data-pane-kind="chat"] button[aria-label="Open previous location"]')!.click();
        const sample = () => {
          for (const label of labels) {
            const text = label.querySelector<HTMLElement>('.shared-search-mode-label-text')!;
            let opacity = 1;
            for (let element: HTMLElement | null = text; element; element = element.parentElement) {
              opacity *= Number(getComputedStyle(element).opacity);
            }
            const range = document.createRange();
            range.selectNodeContents(text);
            frames.push([label.getBoundingClientRect().width, opacity, range.getBoundingClientRect().width]);
          }
          if (performance.now() - started < 850) requestAnimationFrame(sample);
          else done(frames);
        };
        requestAnimationFrame(sample);
      });
      expect(frames.length).toBeGreaterThan(10);
      if (!query) {
        expect(Math.max(...frames.map(frame => frame[0]))).toBeLessThanOrEqual(1);
        expect(Math.max(...frames.map(frame => frame[1]))).toBe(0);
      } else {
        expect(frames.some(frame => frame[1] > 0 && frame[1] < 1)).toBe(true);
        expect(frames.slice(-2).map(frame => frame[1])).toEqual([1, 1]);
        for (let label = 0; label < 2; label++) {
          const widths = frames.filter((_, index) => index % 2 === label).map(frame => frame[0]);
          expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(1);
        }
      }
      await waitForWorkspaceAnimationSettled();
      await expect($('[data-testid="note-search-input"]')).toHaveValue(query);
    });
  }

  it('fades complete scope labels in and out without revealing clipped text', async () => {
    await waitForWorkspaceAnimationSettled();
    for (const expand of [true, false]) {
      const frames = await browser.executeAsync((expand: boolean, done: (frames: number[][]) => void) => {
        const shell = document.querySelector('.notepad-search-bar')!;
        const input = shell.querySelector<HTMLInputElement>('input')!;
        const labels = Array.from(shell.querySelectorAll<HTMLElement>('.shared-search-mode-label'));
        const frames: number[][] = [], started = performance.now();
        if (expand) input.focus({ preventScroll: true });
        else input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        const sample = () => {
          for (const label of labels) {
            const text = label.querySelector('.shared-search-mode-label-text')!;
            const range = document.createRange();
            range.selectNodeContents(text);
            const labelStyle = getComputedStyle(label), textStyle = getComputedStyle(text);
            frames.push([Number(labelStyle.opacity) * Number(textStyle.opacity),
              label.getBoundingClientRect().width, range.getBoundingClientRect().width,
              parseFloat(textStyle.fontSize), performance.now() - started,
              Number(getComputedStyle(shell.querySelector('.shared-search-match-options')!).opacity),
              labelStyle.overflowX === 'visible' ? 1 : 0,
              shell.getBoundingClientRect().width]);
          }
          if (performance.now() - started < 700) requestAnimationFrame(sample);
          else done(frames);
        };
        requestAnimationFrame(sample);
      }, expand);
      expect(frames.some(([opacity]) => opacity > 0 && opacity < 1)).toBe(true);
      const visible = frames.filter(([opacity]) => opacity > 0);
      expect(visible.length).toBeGreaterThan(4);
      expect(visible.every(([, width, textWidth, , , , unclipped]) => unclipped === 1 || width >= textWidth - 1)).toBe(true);
      for (let label = 0; label < 2; label++) {
        const fading = frames.filter((frame, index) => index % 2 === label && frame[0] > 0.001 && frame[0] < 0.999);
        expect(fading.at(-1)![4] - fading[0][4]).toBeGreaterThan(200);
      }
      expect(frames.some(frame => frame[5] > 0 && frame[5] < 1)).toBe(true);
      for (let index = 2; index < frames.length; index += 2) {
        const widthChange = frames[index][7] - frames[index - 2][7];
        expect(expand ? widthChange : -widthChange).toBeGreaterThanOrEqual(-1);
      }
      expect(new Set(visible.map(([, , , fontSize]) => fontSize)).size).toBe(1);
      expect(frames.slice(-2).map(([opacity]) => opacity)).toEqual(expand ? [1, 1] : [0, 0]);
      await waitForWorkspaceAnimationSettled();
    }
  });

  it('closes the current-note control along a direct path without drifting out and back', async () => {
    for (const width of [1440, 1200]) {
      await browser.setWindowSize(width, 1000);
      await browser.execute(() => document.querySelector<HTMLInputElement>('.notepad-search-bar input')!.focus({ preventScroll: true }));
      await waitForWorkspaceAnimationSettled();
      const positions = await browser.executeAsync((done: (positions: number[]) => void) => {
        const shell = document.querySelector('.notepad-search-bar')!;
        const input = shell.querySelector<HTMLInputElement>('input')!;
        const control = shell.querySelector('button[aria-label="Search this note only"]')!;
        const icon = control.querySelector('svg')!;
        const positions = [icon.getBoundingClientRect().left], started = performance.now();
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        const sample = () => {
          positions.push(icon.getBoundingClientRect().left);
          if (performance.now() - started < 700) requestAnimationFrame(sample);
          else done(positions);
        };
        requestAnimationFrame(sample);
      });
      const start = positions[0], end = positions.at(-1)!;
      const excursion = Math.max(...positions) - Math.min(...positions);
      expect(excursion).toBeLessThanOrEqual(Math.abs(end - start) + 1);
      await waitForWorkspaceAnimationSettled();
    }
  });

  it('reveals the labels immediately with reduced motion', async () => {
    try {
      await browser.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
      const result = await browser.executeAsync((done: (result: { opacity: number[]; moving: number }) => void) => {
        const shell = document.querySelector('.notepad-search-bar')!;
        shell.querySelector<HTMLInputElement>('input')!.focus({ preventScroll: true });
        requestAnimationFrame(() => requestAnimationFrame(() => done({
          opacity: Array.from(shell.querySelectorAll('.shared-search-mode-label-text')).map(text => Number(getComputedStyle(text).opacity)),
          moving: shell.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running' || animation.pending).length
        })));
      });
      expect(result.opacity).toEqual([1, 1]);
      expect(result.moving).toBe(0);
    } finally {
      await browser.sendCommand('Emulation.setEmulatedMedia', { features: [] });
    }
  });

  it('keeps fading from the current appearance when focus reverses mid-animation', async () => {
    await waitForWorkspaceAnimationSettled();
    const frames = await browser.executeAsync((done: (frames: number[][]) => void) => {
      const shell = document.querySelector('.notepad-search-bar')!;
      const input = shell.querySelector<HTMLInputElement>('input')!;
      const text = shell.querySelector('.shared-search-mode-label-text')!;
      const frames: number[][] = [], started = performance.now();
      input.focus({ preventScroll: true });
      setTimeout(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })), 280);
      setTimeout(() => input.focus({ preventScroll: true }), 400);
      const sample = () => {
        frames.push([performance.now() - started, Number(getComputedStyle(text).opacity)]);
        if (performance.now() - started < 1100) requestAnimationFrame(sample);
        else done(frames);
      };
      requestAnimationFrame(sample);
    });
    expect(frames.some(([time, opacity]) => time > 280 && time < 400 && opacity > 0 && opacity < 1)).toBe(true);
    for (let index = 1; index < frames.length; index++) {
      const [time, opacity] = frames[index], [previousTime, previousOpacity] = frames[index - 1];
      expect(Math.abs(opacity - previousOpacity) / (time - previousTime)).toBeLessThan(0.02);
    }
    expect(frames.at(-1)![1]).toBe(1);
  });
});
