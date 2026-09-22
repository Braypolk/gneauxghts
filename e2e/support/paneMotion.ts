import { browser, expect } from '@wdio/globals';

interface MotionFrame {
  time: number;
  focused: boolean;
  visible: boolean;
  moving: boolean;
  card: number;
  messages: number;
  chatBusy: boolean;
  border: { id: string; left: number; width: number; opacity: number } | null;
  panes: { id: string; left: number; width: number; opacity: number; sameEditor: boolean }[];
}
interface MotionResult { before: MotionFrame; frames: MotionFrame[]; maxGap: number }

export type PaneMotionAction = 'open' | 'close-left' | 'close-right' | 'open-chat';

/** Real workspace operation, sampled in the renderer with no per-frame IPC. */
export async function samplePaneMotion(action: PaneMotionAction): Promise<MotionResult> {
  return browser.executeAsync((action: PaneMotionAction, done: (result: MotionResult) => void) => {
    const paneSelector = '[data-testid="workspace-pane"]';
    const originalEditors = new Map([...document.querySelectorAll<HTMLElement>(paneSelector)].map(pane => [
      pane.dataset.paneId!, pane.querySelector('.cm-editor')
    ]));
    const read = () => ({
      time: performance.now(),
      focused: document.hasFocus(),
      visible: document.visibilityState === 'visible',
      moving: !!document.querySelector('[data-pane-motion]'),
      messages: document.querySelectorAll('[data-chat-message-id]').length,
      chatBusy: document.querySelector('[role="log"]')?.getAttribute('aria-busy') === 'true',
      border: (() => {
        const border = document.querySelector<HTMLElement>('[data-pane-border]');
        if (!border || getComputedStyle(border).display === 'none') return null;
        const rect = border.getBoundingClientRect();
        return { id: border.dataset.paneBorder!, left: rect.left, width: rect.width,
          opacity: Number(getComputedStyle(border).opacity) };
      })(),
      card: document.querySelector('[data-testid="workspace-card"]')!.getBoundingClientRect().width,
      panes: [...document.querySelectorAll<HTMLElement>(paneSelector)].map(pane => ({
        id: pane.dataset.paneId!, left: pane.getBoundingClientRect().left, width: pane.getBoundingClientRect().width,
        opacity: Number(getComputedStyle(pane).opacity),
        sameEditor: !originalEditors.has(pane.dataset.paneId!) ||
          originalEditors.get(pane.dataset.paneId!) === pane.querySelector('.cm-editor')
      }))
    });
    const before = read();
    const frames: ReturnType<typeof read>[] = [];
    const gaps: number[] = [];
    let last = performance.now();
    const sample = () => {
      const frame = read();
      gaps.push(frame.time - last);
      last = frame.time;
      frames.push(frame);
      if (frame.time - before.time < 700) requestAnimationFrame(sample);
      else done({ before, frames, maxGap: Math.max(...gaps) });
    };
    requestAnimationFrame(sample);
    if (action === 'open' || action === 'open-chat') {
      // Use the real split command. Quick choices are enabled by pointer entry.
      const button = document.querySelector<HTMLElement>('button[aria-label="Open split pane options"]')!;
      if (action === 'open-chat') {
        button.dispatchEvent(new PointerEvent('pointerenter'));
        queueMicrotask(() => document.querySelector<HTMLElement>('button[aria-label="Split with thought partner"]')!.click());
      } else button.click();
    } else {
      const panes = [...document.querySelectorAll<HTMLElement>(paneSelector)];
      panes[action === 'close-left' ? 0 : panes.length - 1]
        .querySelector<HTMLElement>('button[aria-label="Close pane"]')!.click();
    }
  }, action);
}

export function expectContinuousMotion(result: Awaited<ReturnType<typeof samplePaneMotion>>) {
  const end = result.frames.at(-1)!;
  expect(end.moving).toBe(false);
  const ids = new Set([...result.before.panes, ...end.panes].map(pane => pane.id));
  const all = [result.before, ...result.frames];
  for (const frame of all) {
    const border = frame.border;
    if (!border || border.opacity < 0.02) continue;
    const pane = frame.panes.find(pane => pane.id === border.id)!;
    expect(Math.abs(border.left - pane.left)).toBeLessThanOrEqual(2);
    expect(Math.abs(border.width - pane.width)).toBeLessThanOrEqual(2);
  }
  for (const id of ids) {
    const width = (frame: typeof end) => frame.panes.find(pane => pane.id === id)?.width ?? 0;
    const startWidth = width(result.before);
    const finalWidth = width(end);
    const direction = Math.sign(finalWidth - startWidth);
    const widths = all.map(width);
    if (Math.abs(finalWidth - startWidth) > 5) {
      expect(widths.filter(value => value > Math.min(startWidth, finalWidth) + 1 &&
        value < Math.max(startWidth, finalWidth) - 1).length).toBeGreaterThan(1);
    }
    for (let i = 1; i < widths.length; i++) {
      expect((widths[i] - widths[i - 1]) * direction).toBeGreaterThanOrEqual(-1);
    }
    if (end.panes.some(pane => pane.id === id)) {
      expect(all.every(frame => frame.panes.find(pane => pane.id === id)?.sameEditor !== false)).toBe(true);
    }
  }
  for (const frame of result.frames.filter(frame => frame.time > end.time - 100)) {
    expect(Math.abs(frame.card - end.card)).toBeLessThanOrEqual(1);
  }
}
