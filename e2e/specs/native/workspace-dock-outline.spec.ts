import { browser, expect, $ } from '@wdio/globals';
import { waitForWorkspaceAnimationSettled } from '../../support/workspaceAnimation';
import { clockProgress, containerMorphDuration as dockMorphDuration } from '../../../src/lib/ui/morphing-containers/motion';
import { invokeNative } from '../../support/liveNative';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('native dock outline', () => {
  const artifacts = mkdtempSync(join(tmpdir(), 'gneauxghts-native-related-'));
  before(async () => {
    const source = await invokeNative<{ noteId: string }>('save_note', {
      title: 'Native dock transition fixture', currentPath: null,
      markdown: Array.from({ length: 30 }, (_, index) => `Native note paragraph ${index + 1}: keeping the reading surface steady.`).join('\n\n')
    });
    await invokeNative('save_note', { title: 'Native related neighbor', currentPath: null,
      markdown: 'Related notes and search should share a smooth transition without shifting the reading surface.' });
    await invokeNative('mark_note_opened', { noteId: source.noteId });
    await browser.refresh();
    await browser.waitUntil(async () => (await $('[data-testid="note-title"]').getValue()) === 'Native dock transition fixture');
  });
  it('keeps the material aligned in WebKit during search/chat exchange and editor return', async () => {
    await $('[data-testid="note-editor"] .cm-content').waitForExist({ timeout: 30_000 });
    const scale = await browser.execute(() => devicePixelRatio);
    await browser.setWindowRect(60, 80, 1440 * scale, 900 * scale);
    const focusError = await browser.executeAsync((done: (error: string | null) => void) => {
      const native = window as typeof window & { __TAURI_INTERNALS__: { invoke: (cmd: string, args: object) => Promise<unknown> } };
      native.__TAURI_INTERNALS__.invoke('plugin:window|show', { label: 'main' })
        .then(() => native.__TAURI_INTERNALS__.invoke('plugin:window|set_focus', { label: 'main' }))
        .then(() => done(null)).catch(error => done(String(error)));
    });
    expect(focusError).toBeNull();
    try {
      await browser.waitUntil(() => browser.execute(() => document.hasFocus() && document.visibilityState === 'visible'),
        { timeout: 10_000, timeoutMsg: 'Native dock paint requires an unlocked desktop and visible, focused test window' });
    } catch (error) {
      await browser.saveScreenshot(join(artifacts, 'focus-failure.png'));
      throw error;
    }
    await waitForWorkspaceAnimationSettled();
    await browser.execute(() => document.querySelector<HTMLElement>('button[aria-label="Open thought partner"]')!.click());
    await $('[data-input-dock-mode] textarea').waitForExist();
    await waitForWorkspaceAnimationSettled();
    const nativeSendOpacity = () => browser.execute(() => Number(getComputedStyle(
      document.querySelector('.workspace-input-dock .chat-send-button')!
    ).opacity));
    expect(await nativeSendOpacity()).toBe(0);
    // Sample committed frames inside WebKit so driver round trips cannot skip
    // the middle of a normal-speed transition.
    const captureTransition = async (selector: string) => {
      const result = await browser.executeAsync((selector: string, duration: number, done: (result: { samples: number[][]; failure?: string }) => void) => {
        const dock = document.querySelector('.workspace-input-dock')!;
        const samples: number[][] = [], started = performance.now();
        const watchdog = setTimeout(() => done({ samples, failure: `Frame sampling stalled: visibility=${document.visibilityState}, focus=${document.hasFocus()}` }), 2500);
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
              Number(getComputedStyle(dock.querySelector('[data-container-surface="search"]')!).opacity) +
              Number(dock.querySelector('.dock-chat-layer') ? getComputedStyle(dock.querySelector('.dock-chat-layer')!).opacity : 0),
              dock.hasAttribute('data-dock-text-reveal') ? 1 : 0]);
            if (performance.now() - started < duration) requestAnimationFrame(sample);
            else { clearTimeout(watchdog); done({ samples }); }
          } catch (error) { clearTimeout(watchdog); done({ samples, failure: String(error) }); }
        }, 0);
        requestAnimationFrame(sample);
      }, selector, dockMorphDuration + 320);
      expect(result.failure).toBeUndefined();
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
    const iconAlignment = await browser.execute(() => {
      const dock = document.querySelector('.workspace-input-dock')!;
      const body = dock.querySelector(':scope > .dock-body')!.getBoundingClientRect();
      const search = dock.querySelector('[data-container-shell="search"]')!.getBoundingClientRect();
      const related = dock.querySelector('[data-container-shell="related"]')!.getBoundingClientRect();
      const glyph = dock.querySelector('.dock-related-toggle')!.getBoundingClientRect();
      const gap = parseFloat(getComputedStyle(dock).getPropertyValue('--dock-gap'));
      return [Math.abs(search.left - body.left), Math.abs(related.left - body.right - gap), Math.abs(related.left - glyph.left)];
    });
    expect(Math.max(...iconAlignment)).toBeLessThanOrEqual(1);
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
  it('matches Chat/Search pinch pacing and keeps the Related popup steady in visible WebKit', async () => {
    type Frame = {
      time: number; clock: { started: number; duration: number; easing: string } | null;
      body: number[]; icons: Record<string, number[]>; blur: number; glyph: number | null;
      popup: number[] | null; retained: boolean; focused: boolean; visible: boolean; editor: number[] | null;
    };
    const capture = async (selector: string, reverse = false) => {
      // Prepare the actual native window before sampling; never simulate focus
      // or reacquire it during a measured transition.
      await invokeNative('plugin:window|show', { label: 'main' });
      await invokeNative('plugin:window|set_focus', { label: 'main' });
      await browser.waitUntil(() => browser.execute(() => document.hasFocus() && document.visibilityState === 'visible'));
      expect(await invokeNative<boolean>('plugin:window|is_focused', { label: 'main' })).toBe(true);
      const result = await browser.executeAsync((selector: string, reverse: boolean, done: (result: { frames: Frame[]; failure?: string }) => void) => {
        const dock = document.querySelector<HTMLElement>('.workspace-input-dock')!;
        const initialPanel = dock.querySelector('.search-results-panel');
        const frames: Frame[] = [], started = performance.now();
        let finished = false, reversed = false, frameId = 0;
        const finish = (failure?: string) => {
          if (finished) return;
          finished = true; clearTimeout(watchdog); cancelAnimationFrame(frameId); done({ frames, failure });
        };
        const watchdog = setTimeout(() => finish(`Native frame sampling stalled: ${document.visibilityState}, focus=${document.hasFocus()}`), 2500);
        const read = (time: number) => {
          const body = dock.querySelector(':scope > .dock-body')!.getBoundingClientRect();
          const panel = dock.querySelector('.search-results-panel');
          const rect = panel?.getBoundingClientRect();
          const line = document.querySelector('[data-pane-kind="editor"] .cm-line')?.getBoundingClientRect();
          const toggle = dock.querySelector('.dock-related-toggle');
          const icon = toggle?.querySelector('svg');
          const icons = Object.fromEntries(Array.from(dock.querySelectorAll<HTMLElement>('[data-container-toggle]')).map(button => {
            const bounds = button.getBoundingClientRect();
            return [button.dataset.containerToggle!, [bounds.left, bounds.width]];
          }));
          frames.push({ time, clock: dock.hasAttribute('data-dock-motion') ? {
            started: Number(dock.dataset.dockStartedAt), duration: Number(dock.dataset.dockDuration), easing: dock.dataset.dockEasing!
          } : null, body: [body.left, body.width, body.height], icons,
          blur: Number(dock.querySelector('feGaussianBlur')!.getAttribute('stdDeviation')),
          glyph: toggle && icon ? Number(getComputedStyle(toggle).opacity) * Number(getComputedStyle(icon).opacity) : null,
          popup: rect && panel ? [rect.width, rect.bottom, parseFloat(getComputedStyle(panel).clipPath.match(/[-\d.]+/)?.[0] ?? '0')] : null,
          retained: !initialPanel || initialPanel.isConnected && initialPanel === panel,
          focused: document.hasFocus(), visible: document.visibilityState === 'visible', editor: line ? [line.left, line.width] : null });
        };
        const action = () => {
          if (selector === 'editor') document.querySelector<HTMLElement>('[data-pane-kind="editor"] .cm-content')!.focus();
          else document.querySelector<HTMLElement>(selector)!.click();
        };
        try { read(started); action(); }
        catch (error) { finish(String(error)); return; }
        const sample = (time: number) => setTimeout(() => {
          try {
            read(time);
            if (reverse && !reversed && time - started >= 120) {
              reversed = true; dock.querySelector<HTMLElement>('[data-container-toggle="search"]')!.click();
            }
            if (time - started < 850) frameId = requestAnimationFrame(sample); else finish();
          } catch (error) { finish(String(error)); }
        }, 0);
        frameId = requestAnimationFrame(sample);
      }, selector, reverse);
      expect(result.failure).toBeUndefined();
      expect(result.frames.length).toBeGreaterThan(15);
      // WebKit can drop document focus while an outgoing input becomes inert.
      // Check actual OS focus separately from that content-focus handoff.
      const nativeFocused = await invokeNative<boolean>('plugin:window|is_focused', { label: 'main' });
      if (!nativeFocused || result.frames.some(frame => !frame.visible)) {
        writeFileSync(join(artifacts, 'interrupted-frames.json'), JSON.stringify(result.frames));
        throw new Error('Native window lost visibility/focus during sampling; paint measurements are invalid');
      }
      await waitForWorkspaceAnimationSettled();
      return result.frames;
    };
    const metrics = (frames: Frame[]) => {
      const gaps = frames.slice(1).flatMap((frame, index) => frame.clock || frames[index].clock ? [frame.time - frames[index].time] : []).sort((a, b) => a - b);
      return { frames: gaps.length, p95: gaps[Math.floor(gaps.length * .95)], maxGap: Math.max(...gaps) };
    };
    const expectPinch = (frames: Frame[]) => {
      const moving = frames.filter(frame => frame.clock);
      expect(moving.length).toBeGreaterThan(5);
      expect(moving.every(frame => frame.clock!.duration === dockMorphDuration && frame.clock!.easing === 'pinch')).toBe(true);
      expect(Math.max(...moving.map(frame => frame.blur))).toBeGreaterThan(2);
      const origin = frames[0], end = frames.at(-1)!;
      for (const column of [0, 1]) {
        const errors = moving.map(frame => Math.abs(frame.body[column] - (origin.body[column] +
          (end.body[column] - origin.body[column]) * clockProgress((frame.time - frame.clock!.started) / frame.clock!.duration))));
        expect(Math.max(...errors)).toBeLessThanOrEqual(1);
      }
    };
    const expectStablePopup = (frames: Frame[]) => {
      const panels = frames.flatMap(frame => frame.popup ? [frame.popup] : []);
      expect(panels.length).toBeGreaterThan(10);
      for (const column of [0, 1]) expect(Math.max(...panels.map(panel => panel[column])) - Math.min(...panels.map(panel => panel[column]))).toBeLessThanOrEqual(1);
      const lines = frames.flatMap(frame => frame.editor ? [frame.editor] : []);
      for (const column of [0, 1]) expect(Math.max(...lines.map(line => line[column])) - Math.min(...lines.map(line => line[column]))).toBeLessThanOrEqual(1);
    };
    const comparisons: { width: number; baseline: ReturnType<typeof metrics>[]; related: ReturnType<typeof metrics>[] }[] = [];
    for (const width of [1440, 417]) {
      const scale = await browser.execute(() => devicePixelRatio);
      await browser.setWindowRect(60, 80, width * scale, 900 * scale);
      await invokeNative('plugin:window|show', { label: 'main' });
      await invokeNative('plugin:window|set_focus', { label: 'main' });
      await browser.waitUntil(() => browser.execute(() => document.hasFocus() && document.visibilityState === 'visible'));
      await waitForWorkspaceAnimationSettled();
      await browser.execute(() => document.querySelector<HTMLElement>('button[aria-label="Open thought partner"]')!.click());
      await $('[data-input-dock-mode] textarea').waitForExist();
      await waitForWorkspaceAnimationSettled();
      const baseline: Frame[][] = [];
      for (const label of ['Expand search', 'Expand chat input']) {
        const frames = await capture(`button[aria-label="${label}"]`);
        expectPinch(frames); baseline.push(frames);
      }
      await browser.execute(() => document.querySelector<HTMLElement>('[data-pane-kind="chat"] button[aria-label="Open previous location"]')!.click());
      await $('[data-pane-kind="editor"] .cm-content').waitForExist();
      await waitForWorkspaceAnimationSettled();
      const related = await capture('[data-container-toggle="related"]');
      expectPinch(related); expectStablePopup(related);
      expect(Math.min(...related.map(frame => frame.glyph ?? 0))).toBeGreaterThanOrEqual(.99);
      expect(related.some(frame => frame.clock && frame.popup && frame.popup[2] < 90)).toBe(true);
      const dismissed = await capture('editor');
      expectPinch(dismissed); expectStablePopup(dismissed);
      const repeated: Frame[][] = [];
      for (let attempt = 0; attempt < 2; attempt++) {
        const frames = await capture('[data-container-toggle="related"]');
        expectPinch(frames); expectStablePopup(frames); repeated.push(frames);
        await capture('editor');
      }
      await browser.execute(() => document.querySelector<HTMLInputElement>('[data-testid="note-search-input"]')!.focus());
      await waitForWorkspaceAnimationSettled();
      for (const selector of ['related', 'search']) {
        const frames = await capture(`[data-container-toggle="${selector}"]`);
        expectPinch(frames); expectStablePopup(frames);
        expect(frames.every(frame => frame.retained)).toBe(true);
        if (width === 417) expect(Math.max(...frames.map(frame => frame.body[2])) - Math.min(...frames.map(frame => frame.body[2]))).toBeGreaterThan(25);
      }
      const reversal = await capture('[data-container-toggle="related"]', true);
      expectStablePopup(reversal);
      expect(reversal.every(frame => frame.retained && (frame.glyph ?? 0) >= .99)).toBe(true);
      const baselineMetrics = baseline.map(metrics), relatedMetrics = [related, ...repeated].map(metrics);
      comparisons.push({ width, baseline: baselineMetrics, related: relatedMetrics });
      writeFileSync(join(artifacts, `${width}-frames.json`), JSON.stringify({ baseline, related, repeated, dismissed, reversal }));
      console.log('NATIVE_RELATED_MOTION', JSON.stringify({ width, actualWidth: await browser.execute(() => innerWidth), baseline: baselineMetrics, related: relatedMetrics, artifacts }));
      // Capture paint separately so screenshot work cannot distort frame pacing.
      await browser.executeAsync((done: () => void) => {
        document.querySelector<HTMLElement>('[data-container-toggle="related"]')!.click();
        setTimeout(done, 150);
      });
      await browser.saveScreenshot(join(artifacts, `${width}-pinch.png`));
      await waitForWorkspaceAnimationSettled();
      await browser.saveScreenshot(join(artifacts, `${width}-related.png`));
      await browser.execute(() => document.querySelector<HTMLElement>('[data-pane-kind="editor"] .cm-content')!.focus());
      await waitForWorkspaceAnimationSettled();
    }
    for (const comparison of comparisons) for (const related of comparison.related) {
      expect(related.p95).toBeLessThanOrEqual(Math.max(32, ...comparison.baseline.map(metric => metric.p95 * 1.5)));
      expect(related.maxGap).toBeLessThanOrEqual(Math.max(50, ...comparison.baseline.map(metric => metric.maxGap * 2)));
    }
  });

});
