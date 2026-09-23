import { browser, expect, $ } from '@wdio/globals';

interface ResizeFrame {
  viewport: number;
  left: number;
  width: number;
}

declare global {
  interface Window {
    __workspaceResizeSamples: Promise<ResizeFrame[]>;
  }
}

async function resizeAndSample(width: number) {
  await browser.execute(() => {
    window.__workspaceResizeSamples = new Promise(resolve => {
      window.addEventListener('resize', () => {
        const frames: ResizeFrame[] = [];
        const start = performance.now();
        const sample = () => {
          const rect = document.querySelector('[data-testid="workspace-card"]')!
            .getBoundingClientRect();
          frames.push({ viewport: window.innerWidth, left: rect.left, width: rect.width });
          if (performance.now() - start < 500) requestAnimationFrame(sample);
          else resolve(frames);
        };
        requestAnimationFrame(sample);
      }, { once: true });
    });
  });
  await browser.setWindowSize(width, 1000);
  const frames = await browser.executeAsync((done: (frames: ResizeFrame[]) => void) => {
    void window.__workspaceResizeSamples.then(done);
  });
  const final = frames.at(-1)!;
  const settledViewport = frames.filter(frame => frame.viewport === final.viewport);
  expect(settledViewport.length).toBeGreaterThan(3);
  // Once the window reaches its new size, the card must not keep drifting.
  expect(Math.max(...settledViewport.map(frame => Math.abs(frame.width - final.width))))
    .toBeLessThanOrEqual(1);
  expect(Math.max(...settledViewport.map(frame => Math.abs(frame.left - final.left))))
    .toBeLessThanOrEqual(1);
}

describe('window resize layout', () => {
  for (const expanded of [false, true]) {
    it(`tracks abrupt resizing with Related ${expanded ? 'expanded' : 'collapsed'}`, async () => {
      await browser.setWindowSize(1440, 1000);
      await browser.url('/');
      await $('[data-testid="note-editor"] .cm-content').waitForDisplayed({ timeout: 30_000 });
      if (expanded) await $('button[aria-label="Expand related notes"]').click();
      await browser.pause(400);
      await resizeAndSample(900);
      await resizeAndSample(1440);
    });
  }
});
