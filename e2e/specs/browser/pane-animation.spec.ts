import { browser, expect, $ } from '@wdio/globals';
import { expectContinuousMotion, expectStableEntrance, samplePaneMotion } from '../../support/paneMotion';

async function ready(width = 1440) {
  await browser.setWindowSize(width, 1000);
  await browser.url('/');
  await $('[data-testid="note-editor"] .cm-content').waitForDisplayed({ timeout: 30_000 });
  await browser.pause(400);
}

async function chooseCurrent() {
  await $('#pane-command-current').waitForExist();
  await browser.execute(() => document.querySelector<HTMLElement>('#pane-command-current')!.click());
  await $('[data-pane-command="split"]').waitForExist({ reverse: true });
}

describe('coordinated pane layout motion', () => {
  for (const action of ['open', 'open-current', 'open-chat'] as const) {
    it(`keeps the new pane layout stable during ${action}`, async () => {
      await ready();
      const opening = await samplePaneMotion(action);
      expectContinuousMotion(opening);
      expectStableEntrance(opening);
    });
  }

  it('keeps the active border attached when focus changes during entrance', async () => {
    await ready();
    const result = await browser.executeAsync((done: (result: { activated: boolean; errors: number[]; active?: string }) => void) => {
      const start = performance.now();
      let activated = false;
      const errors: number[] = [];
      const sample = () => {
        const border = document.querySelector<HTMLElement>('[data-pane-border]');
        if (border && activated) {
          const pane = document.querySelector<HTMLElement>(`[data-pane-id="${border.dataset.paneBorder}"]`)!;
          const actual = border.getBoundingClientRect();
          const expected = pane.getBoundingClientRect();
          errors.push(Math.max(Math.abs(actual.left - expected.left), Math.abs(actual.width - expected.width)));
        }
        if (!activated && document.querySelector('[data-pane-motion]') && performance.now() - start > 60) {
          activated = true;
          document.querySelector<HTMLElement>('[data-testid="workspace-pane"]')!
            .dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        }
        if (performance.now() - start < 500) requestAnimationFrame(sample);
        else done({ activated, errors, active: document.querySelector<HTMLElement>('[data-pane-border]')?.dataset.paneBorder });
      };
      requestAnimationFrame(sample);
      document.querySelector<HTMLElement>('button[aria-label="Open split pane options"]')!.click();
    });
    expect(result.activated).toBe(true);
    expect(result.errors.length).toBeGreaterThan(3);
    expect(Math.max(...result.errors)).toBeLessThanOrEqual(1);
    expect(result.active).toBe(await $('[data-testid="workspace-pane"]').getAttribute('data-pane-id'));
  });

  for (const width of [900, 1440, 2400]) {
    for (const side of ['left', 'right'] as const) {
      it(`animates opening and closing ${side} at ${width}px without reversing width`, async () => {
        await ready(width);
        const opening = await samplePaneMotion('open');
        expectContinuousMotion(opening);
        expectStableEntrance(opening);
        expect(opening.frames.at(-1)!.panes).toHaveLength(2);
        await chooseCurrent();
        const closing = await samplePaneMotion(`close-${side}`);
        expectContinuousMotion(closing);
        expect(closing.frames.at(-1)!.panes).toHaveLength(1);
        expect(await browser.execute(() => document.querySelector('[data-testid="workspace-pane"]')!
          .contains(document.activeElement))).toBe(true);
      });
    }
  }

  it('coordinates an expanded Related panel and a chat pane', async () => {
    await ready();
    await $('button[aria-label="Expand related notes"]').click();
    await browser.pause(400);
    expectContinuousMotion(await samplePaneMotion('open-chat'));
    await $('[data-pane-kind="chat"]').waitForExist();
    expectContinuousMotion(await samplePaneMotion('close-right'));
    await $('button[aria-label="Collapse related notes"]').click();
    await browser.pause(400);
    await expect($('button[aria-label="Expand related notes"]')).toBeDisplayed();
  });

  it('skips motion and animation waiting with reduced motion', async () => {
    await ready();
    await browser.execute(() => {
      const original = window.matchMedia.bind(window);
      window.matchMedia = query => {
        const media = original(query);
        if (query === '(prefers-reduced-motion: reduce)') {
          Object.defineProperty(media, 'matches', { value: true });
        }
        return media;
      };
    });
    const opening = await samplePaneMotion('open');
    expect(opening.frames.every(frame => !frame.moving)).toBe(true);
    await chooseCurrent();
    const closing = await samplePaneMotion('close-right');
    expect(closing.frames.every(frame => !frame.moving && frame.panes.length === 1)).toBe(true);
  });

  it('settles resize and close during entrance without stale animation work', async () => {
    await ready();
    await browser.executeAsync(done => {
      document.querySelector<HTMLElement>('button[aria-label="Open split pane options"]')!.click();
      const closeOnFirstMotion = () => {
        const pane = document.querySelector<HTMLElement>('[aria-label="Pane 2"]');
        if (!pane || !document.querySelector('[data-pane-motion]')) {
          requestAnimationFrame(closeOnFirstMotion);
          return;
        }
        pane.querySelector<HTMLElement>('button[aria-label="Close pane"]')!.click();
        done();
      };
      requestAnimationFrame(closeOnFirstMotion);
    });
    await browser.waitUntil(async () => browser.execute(() =>
      document.querySelectorAll('[data-testid="workspace-pane"]').length === 1 &&
      !document.querySelector('[data-pane-motion]')));
    await browser.execute(() => document.querySelector<HTMLElement>('button[aria-label="Open split pane options"]')!.click());
    await browser.setWindowSize(1000, 850);
    await browser.waitUntil(async () => browser.execute(() => !document.querySelector('[data-pane-motion]')));
    await chooseCurrent();
    expectContinuousMotion(await samplePaneMotion('close-right'));
    expect(await browser.execute(() => document.querySelector('.notepad-shell')!.getAnimations({ subtree: true })
      .filter(animation => animation.playState === 'running').length)).toBe(0);
  });
});
