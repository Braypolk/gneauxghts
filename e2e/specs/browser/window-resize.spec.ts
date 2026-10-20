import { browser, expect, $ } from '@wdio/globals';
import { waitForWorkspaceAnimationSettled } from '../../support/workspaceAnimation';

interface ResizeFrame {
  viewport: number;
  left: number;
  width: number;
}

declare global {
  interface Window {
    __workspaceResizeSamples: Promise<{ frames: ResizeFrame[]; error?: string }>;
    __cancelWorkspaceResizeSamples?: () => void;
  }
}

async function resizeAndSample(width: number) {
  await browser.execute(() => {
    window.__cancelWorkspaceResizeSamples?.();
    window.__workspaceResizeSamples = new Promise(resolve => {
      const frames: ResizeFrame[] = [];
      let frameId = 0;
      let finished = false;
      let observedResize = false;
      let stableSince: number | null = null;
      const finish = (error?: string) => {
        if (finished) return;
        finished = true;
        clearTimeout(deadline);
        cancelAnimationFrame(frameId);
        window.removeEventListener('resize', onResize);
        delete window.__cancelWorkspaceResizeSamples;
        resolve({ frames, ...(error ? { error } : {}) });
      };
      const deadline = setTimeout(() => finish('Resize event or stable layout frames were not observed'), 5000);
      const sample = () => {
        if (finished) return;
        const card = document.querySelector('[data-testid="workspace-card"]');
        if (!card) { finish('Workspace card disappeared during resize'); return; }
        const rect = card.getBoundingClientRect();
        const frame = { viewport: window.innerWidth, left: rect.left, width: rect.width };
        const previous = frames.at(-1);
        frames.push(frame);
        const stable = previous?.viewport === frame.viewport &&
          Math.abs(previous.left - frame.left) <= 0.1 && Math.abs(previous.width - frame.width) <= 0.1 &&
          !document.querySelector('[data-pane-motion]') &&
          !card.getAnimations({ subtree: true }).some(animation =>
            (animation.playState === 'running' || animation.pending) &&
            animation.effect?.getTiming().iterations !== Infinity);
        stableSince = stable ? stableSince ?? performance.now() : null;
        if (frames.length > 3 && stableSince !== null && performance.now() - stableSince >= 100) finish();
        else frameId = requestAnimationFrame(sample);
      };
      const onResize = () => {
        if (observedResize) return;
        observedResize = true;
        frameId = requestAnimationFrame(sample);
      };
      window.__cancelWorkspaceResizeSamples = () => finish('Resize sampling cancelled');
      window.addEventListener('resize', onResize);
    });
  });
  let result: { frames: ResizeFrame[]; error?: string };
  try {
    await browser.setWindowSize(width, 1000);
    result = await browser.executeAsync((done: (result: { frames: ResizeFrame[]; error?: string }) => void) => {
      void window.__workspaceResizeSamples.then(done);
    });
  } finally {
    await browser.execute(() => window.__cancelWorkspaceResizeSamples?.());
  }
  if (result.error) throw new Error(result.error);
  const frames = result.frames;
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
      if (expanded) await $('button[aria-label="Related notes"]').click();
      await waitForWorkspaceAnimationSettled();
      await resizeAndSample(900);
      await resizeAndSample(1440);
    });
  }
});
