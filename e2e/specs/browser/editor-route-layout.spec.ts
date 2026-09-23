import { browser, expect, $ } from '@wdio/globals';

interface CardFrame {
  left: number;
  width: number;
}

async function returnToEditor() {
  return browser.executeAsync((done: (frames: CardFrame[]) => void) => {
    const frames: CardFrame[] = [];
    let firstFrame: number | undefined;
    const started = performance.now();
    const sample = (now: number) => {
      const card = document.querySelector('[data-testid="workspace-card"]');
      if (card) {
        firstFrame ??= now;
        const rect = card.getBoundingClientRect();
        frames.push({ left: rect.left, width: rect.width });
      }
      if ((firstFrame !== undefined && now - firstFrame >= 500) || now - started > 5000) {
        done(frames);
      } else {
        requestAnimationFrame(sample);
      }
    };
    requestAnimationFrame(sample);
    document.querySelector<HTMLAnchorElement>('nav a[href="/"]')!.click();
  });
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
