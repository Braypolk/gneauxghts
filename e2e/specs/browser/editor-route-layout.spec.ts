import { browser, expect, $ } from '@wdio/globals';

interface CardFrame {
  left: number;
  width: number;
}

async function returnToEditor() {
  const result = await browser.executeAsync((done: (result: { frames: CardFrame[]; error?: string }) => void) => {
    const frames: CardFrame[] = [];
    let settledSince: number | null = null;
    let frameId = 0;
    let finished = false;
    const finish = (error?: string) => {
      if (finished) return;
      finished = true;
      clearTimeout(deadline);
      cancelAnimationFrame(frameId);
      done({ frames, ...(error ? { error } : {}) });
    };
    const deadline = setTimeout(() => finish('Editor route layout did not settle'), 5000);
    const sample = (now: number) => {
      if (finished) return;
      const card = document.querySelector('[data-testid="workspace-card"]');
      const editor = document.querySelector<HTMLElement>('[data-testid="note-editor"] .cm-content');
      if (card) {
        const rect = card.getBoundingClientRect();
        frames.push({ left: rect.left, width: rect.width });
      }
      const settled = !!card && !!editor && editor.getClientRects().length > 0 &&
        getComputedStyle(editor).visibility !== 'hidden' &&
        !document.querySelector('[data-pane-motion]') &&
        !card.getAnimations({ subtree: true }).some(animation =>
          (animation.playState === 'running' || animation.pending) &&
          animation.effect?.getTiming().iterations !== Infinity);
      settledSince = settled ? settledSince ?? now : null;
      if (frames.length > 3 && settledSince !== null && now - settledSince >= 100) finish();
      else frameId = requestAnimationFrame(sample);
    };
    frameId = requestAnimationFrame(sample);
    document.querySelector<HTMLAnchorElement>('nav a[href="/"]')!.click();
  });
  if (result.error) throw new Error(result.error);
  return result.frames;
}

describe('editor route layout', () => {
  for (const width of [868, 1440]) {
    it(`returns from Settings at its final width in a ${width}px window`, async () => {
      await browser.setWindowSize(width, 1000);
      await browser.url('/');
      await $('[data-testid="note-editor"] .cm-content').waitForDisplayed({ timeout: 30_000 });
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await $('a[aria-label="Settings"]').click();
        await $('input[aria-label="Search settings"]').waitForDisplayed();
        const frames = await returnToEditor();
        expect(frames.length).toBeGreaterThan(3);
        const final = frames.at(-1)!;
        expect(Math.max(...frames.map(frame => Math.abs(frame.width - final.width))))
          .toBeLessThanOrEqual(1);
        expect(Math.max(...frames.map(frame => Math.abs(frame.left - final.left))))
          .toBeLessThanOrEqual(1);
      }
    });
  }
});
