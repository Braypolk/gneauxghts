import { browser, expect, $ } from '@wdio/globals';
import { waitForWorkspaceAnimationSettled } from '../../support/workspaceAnimation';
import { dockMorphDuration } from '../../../src/lib/features/notepad/ui/workspaceDockMachine';

describe('native dock outline', () => {
  it('keeps the material aligned in WebKit during search/chat exchange and editor return', async () => {
    await $('[data-testid="note-editor"] .cm-content').waitForExist({ timeout: 30_000 });
    const scale = await browser.execute(() => devicePixelRatio);
    await browser.setWindowRect(60, 80, 1440 * scale, 900 * scale);
    await waitForWorkspaceAnimationSettled();
    const focusError = await browser.executeAsync((done: (error: string | null) => void) => {
      const native = window as typeof window & { __TAURI_INTERNALS__: { invoke: (cmd: string, args: object) => Promise<unknown> } };
      native.__TAURI_INTERNALS__.invoke('plugin:window|show', { label: 'main' })
        .then(() => native.__TAURI_INTERNALS__.invoke('plugin:window|set_focus', { label: 'main' }))
        .then(() => {
          document.querySelector<HTMLElement>('button[aria-label="Open thought partner"]')!.click();
          done(null);
        }).catch(error => done(String(error)));
    });
    expect(focusError).toBeNull();
    await $('[data-input-dock-mode] textarea').waitForExist();
    await waitForWorkspaceAnimationSettled();
    const nativeSendOpacity = () => browser.execute(() => Number(getComputedStyle(
      document.querySelector('.workspace-input-dock .chat-send-button')!
    ).opacity));
    expect(await nativeSendOpacity()).toBe(0);
    // Sample committed frames inside WebKit so driver round trips cannot skip
    // the middle of a normal-speed transition.
    const captureTransition = async (selector: string) => {
      const result = await browser.executeAsync((selector: string, duration: number, done: (result: { samples: number[][]; error?: string }) => void) => {
        const dock = document.querySelector('.workspace-input-dock')!;
        const samples: number[][] = [], started = performance.now();
        const watchdog = setTimeout(() => done({ samples, error: `Frame sampling stalled: visibility=${document.visibilityState}, focus=${document.hasFocus()}` }), 2500);
        document.querySelector<HTMLElement>(selector)!.click();
        const sample = () => setTimeout(() => {
          try {
            const body = dock.querySelector(':scope > .dock-body')!.getBoundingClientRect();
            const material = dock.querySelector('.dock-material-body')!.getBoundingClientRect();
            const send = dock.querySelector('.chat-send-button');
            samples.push([body.left - material.left, body.top - material.top,
              body.width - material.width, body.height - material.height,
              send ? Number(getComputedStyle(send).opacity) : 0,
              dock.hasAttribute('data-dock-motion') ? 1 : 0,
              Number(getComputedStyle(dock.querySelector('.shared-search-input-layer')!).opacity) +
              Number(getComputedStyle(dock.querySelector('.dock-chat-layer')!).opacity),
              dock.hasAttribute('data-dock-text-reveal') ? 1 : 0]);
            if (performance.now() - started < duration) requestAnimationFrame(sample);
            else { clearTimeout(watchdog); done({ samples }); }
          } catch (error) { clearTimeout(watchdog); done({ samples, error: String(error) }); }
        }, 0);
        requestAnimationFrame(sample);
      }, selector, dockMorphDuration + 320);
      expect(result.error).toBeUndefined();
      const samples = result.samples;
      expect(samples.length).toBeGreaterThan(10);
      expect(Math.max(...samples.flatMap(frame => frame.slice(0, 4).map(Math.abs)))).toBeLessThanOrEqual(1);
      expect(samples.every(frame => frame[4] === 0)).toBe(true);
      expect(samples.some(frame => frame[5] === 1 && frame[6] === 0)).toBe(true);
      expect(samples.some(frame => frame[5] === 1 && frame[7] === 1 && frame[6] > 0 && frame[6] < 1)).toBe(true);
      expect(samples.some(frame => frame[5] === 0 && frame[6] > 0 && frame[6] < 1)).toBe(true);
      await waitForWorkspaceAnimationSettled();
    };
    for (const label of ['Expand search', 'Expand chat input']) {
      await captureTransition(`button[aria-label="${label}"]`);
      expect(await nativeSendOpacity()).toBe(0);
    }
    await captureTransition('[data-pane-kind="chat"] button[aria-label="Open previous location"]');
    const absorbed = await browser.execute(() => {
      const dock = document.querySelector('.workspace-input-dock')!;
      const body = dock.querySelector(':scope > .dock-body')!.getBoundingClientRect();
      const left = dock.querySelector('.dock-material-search')!.getBoundingClientRect();
      const right = dock.querySelector('.dock-material-chat')!.getBoundingClientRect();
      return [Math.max(0, body.left - left.left), Math.max(0, right.right - body.right)];
    });
    expect(Math.max(...absorbed)).toBeLessThanOrEqual(1);
    for (const expand of [true, false]) {
      const offsets = await browser.executeAsync((expand: boolean, duration: number, done: (offsets: number[]) => void) => {
        const dock = document.querySelector('.workspace-input-dock')!, input = dock.querySelector<HTMLInputElement>('input')!;
        const offsets: number[] = [], started = performance.now();
        if (expand) input.focus({ preventScroll: true });
        else input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        const sample = () => setTimeout(() => {
          const glyph = dock.querySelector('.dock-search-toggle > svg')!.getBoundingClientRect();
          const inputGlyph = dock.querySelector('.shared-search-input-layer > svg')!.getBoundingClientRect();
          offsets.push(Math.abs(glyph.left + glyph.width / 2 - inputGlyph.left - inputGlyph.width / 2));
          if (performance.now() - started < duration) requestAnimationFrame(sample);
          else done(offsets);
        }, 0);
        requestAnimationFrame(sample);
      }, expand, Math.max(800, dockMorphDuration + 200));
      expect(Math.max(...offsets)).toBeLessThanOrEqual(1);
      await waitForWorkspaceAnimationSettled();
    }
  });
});
