import { browser, expect, $ } from '@wdio/globals';
import { resetBrowserWorkspace } from '../../support/browserWorkspace';
import { openBrowserPiPane, seedPiHistory, selectPiConversation } from '../../support/browserPi';
import { waitForWorkspaceAnimationSettled } from '../../support/workspaceAnimation';

const logSelector = '[role="log"]';

async function sampleScroll(duration: number) {
  return browser.execute((duration: number) => new Promise<{
    tops: number[];
    heights: number[];
    gaps: number[];
  }>((done) => {
    const log = document.querySelector<HTMLElement>('[role="log"]')!;
    const tops: number[] = [], heights: number[] = [], gaps: number[] = [];
    const start = performance.now();
    const frame = () => {
      tops.push(log.scrollTop);
      heights.push(log.scrollHeight);
      gaps.push(log.scrollHeight - log.clientHeight - log.scrollTop);
      if (performance.now() - start < duration)
        requestAnimationFrame(frame);
      else
        done({ tops, heights, gaps });
    };
    requestAnimationFrame(frame);
  }), duration);
}

describe('streaming chat viewport', () => {
  beforeEach(async () => {
    await resetBrowserWorkspace();
    await seedPiHistory('Streaming scroll fixture', 6);
    await openBrowserPiPane();
    await selectPiConversation('Streaming scroll fixture');
    await waitForWorkspaceAnimationSettled();
  });

  afterEach(async () => {
    await browser.execute(() => (window as Window & { __restoreChatHtml?: () => void }).__restoreChatHtml?.());
    if (await $('[data-testid="pi-stop"]').isExisting()) await $('[data-testid="pi-stop"]').click();
    await browser.sendCommand('Emulation.setEmulatedMedia', { features: [] });
  });

  it('survives scroll clamping while a long streamed markdown block is replaced', async () => {
    await $('button[aria-label="Conversations"]').click();
    await $('[role="menuitem"]=New conversation').click();
    await browser.execute(() => new Promise<void>((done) => {
      void window.__GNEAUXGHTS_E2E__!.setNextPiResponse('## A growing section\n\nA paragraph of streamed text to keep the response growing.\n\n'.repeat(100)).then(done);
    }));
    await $('textarea[aria-label="Message"]').setValue('Explain this in detail');
    await $('[data-testid="pi-send"]').click();
    await browser.waitUntil(() => browser.execute(() => {
      const log = document.querySelector<HTMLElement>('[role="log"]')!;
      return log.scrollHeight > log.clientHeight + 500;
    }));
    await browser.execute(() => {
      const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML')!;
      const host = window as Window & { __restoreChatHtml?: () => void; __chatHtmlClamps?: number };
      host.__chatHtmlClamps = 0;
      host.__restoreChatHtml = () => { Object.defineProperty(Element.prototype, 'innerHTML', descriptor); };
      Object.defineProperty(Element.prototype, 'innerHTML', { ...descriptor, set(value: string) {
        const element = this as Element;
        const log = element.closest<HTMLElement>('[role="log"]');
        if (log && element.matches('.gn-markdown-html') && element.closest('[data-streaming="true"]')) {
          const before = log.scrollTop;
          descriptor.set!.call(element, '');
          // Force the intermediate layout that WebKit can observe during replacement.
          if (log.scrollTop < before) host.__chatHtmlClamps!++;
        }
        descriptor.set!.call(element, value);
      } });
    });
    const following = await sampleScroll(700);
    expect(await browser.execute(() => (window as Window & { __chatHtmlClamps?: number }).__chatHtmlClamps)).toBeGreaterThan(0);
    expect(following.gaps.at(-1)!).toBeLessThan(160);
    expect(following.tops.every((top, index) => index === 0 || top >= following.tops[index - 1] - 1)).toBe(true);
    await browser.execute(() => { document.querySelector<HTMLElement>('[role="log"]')!.scrollTop = 300; });
    const reading = await sampleScroll(700);
    expect(Math.max(...reading.tops) - Math.min(...reading.tops)).toBeLessThanOrEqual(1);
    expect(reading.tops.at(-1)!).toBeGreaterThan(250);
    await browser.execute(() => {
      const log = document.querySelector<HTMLElement>('[role="log"]')!;
      log.scrollTop = log.scrollHeight;
    });
    await $('[data-testid="pi-stop"]').waitForExist({ reverse: true, timeout: 25_000 });
    expect((await sampleScroll(500)).gaps.at(-1)!).toBeLessThanOrEqual(2);
  });

  it('holds a reading position during streaming and follows again after returning to the bottom', async () => {
    await browser.execute(() => new Promise<void>((done) => {
      void window.__GNEAUXGHTS_E2E__!.setNextPiResponse('A paragraph arriving from the model.\n\n'.repeat(120)).then(done);
    }));
    await $('textarea[aria-label="Message"]').setValue('Stream a long answer');
    await $('[data-testid="pi-send"]').click();
    await $('[data-testid="pi-assistant-message"][data-streaming="true"]').waitForExist();
    const following = await sampleScroll(700);
    expect(following.heights.at(-1)! - following.heights[0]).toBeGreaterThan(30);
    // New paragraphs arrive in discrete height jumps; check that the animation
    // repeatedly catches up, rather than sampling just after one was inserted.
    expect(Math.min(...following.gaps.slice(-10))).toBeLessThan(80);
    expect(following.tops.every((top, index) => index === 0 || top >= following.tops[index - 1] - 1)).toBe(true);

    // Wait for enough streamed text to read within it, independent of block grouping.
    await browser.waitUntil(() => browser.execute(startHeight => {
      const log = document.querySelector<HTMLElement>('[role="log"]')!;
      return log.scrollHeight > startHeight + log.clientHeight + 200;
    }, following.heights[0]));

    // A real wheel gesture must cancel following even before the next token.
    const log = await $(logSelector);
    const location = await log.getLocation();
    await browser.action('wheel').scroll({ x: location.x + 100, y: location.y + 150, deltaY: -300, deltaX: 0, duration: 100 }).perform();
    const reading = await sampleScroll(900);
    expect(reading.heights.at(-1)! - reading.heights[0]).toBeGreaterThan(30);
    expect(Math.max(...reading.tops) - Math.min(...reading.tops)).toBeLessThanOrEqual(1);

    await browser.execute(() => {
      const log = document.querySelector<HTMLElement>('[role="log"]')!;
      log.scrollTop = log.scrollHeight;
    });
    const resumed = await sampleScroll(900);
    expect(resumed.tops.at(-1)! - resumed.tops[0]).toBeGreaterThan(30);
    expect(Math.min(...resumed.gaps.slice(-10))).toBeLessThan(80);
    expect(resumed.tops.every((top, index) => index === 0 || top >= resumed.tops[index - 1] - 1)).toBe(true);
    await $('[data-testid="pi-stop"]').waitForExist({ reverse: true, timeout: 25_000 });
    const completed = await sampleScroll(500);
    expect(completed.gaps.at(-1)!).toBeLessThanOrEqual(2);
  });

  it('smoothly follows rendered height changes without a new message update', async () => {
    await browser.execute(() => {
      const log = document.querySelector<HTMLElement>('[role="log"]')!;
      log.scrollTop = log.scrollHeight;
    });
    await sampleScroll(100);
    // Simulate delayed layout (e.g. an image resolving) through the mounted lane.
    await browser.execute(() => {
      const lane = document.querySelector<HTMLElement>('[role="log"] > .chat-content-lane')!;
      lane.style.paddingBottom = '240px';
    });
    const resized = await sampleScroll(800);
    expect(resized.gaps.at(-1)!).toBeLessThanOrEqual(2);
    expect(resized.tops.filter(top => top > resized.tops[0] + 2 && top < resized.tops.at(-1)! - 2).length).toBeGreaterThan(2);
  });

  it('keeps reading still after rendered growth and follows immediately with reduced motion', async () => {
    await browser.sendCommand('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
    });
    await browser.execute(() => {
      const log = document.querySelector<HTMLElement>('[role="log"]')!;
      log.scrollTop = log.scrollHeight;
    });
    await sampleScroll(100);
    await browser.execute(() => {
      document.querySelector<HTMLElement>('[role="log"] > .chat-content-lane')!.style.paddingBottom = '240px';
    });
    expect((await sampleScroll(100)).gaps.at(-1)!).toBeLessThanOrEqual(2);
    // Even a small upward move cancels following.
    const top = await browser.execute(() => {
      const log = document.querySelector<HTMLElement>('[role="log"]')!;
      log.scrollTop -= 20;
      return log.scrollTop;
    });
    await sampleScroll(100);
    await browser.execute(() => {
      document.querySelector<HTMLElement>('[role="log"] > .chat-content-lane')!.style.paddingBottom = '480px';
    });
    const reading = await sampleScroll(300);
    expect(reading.tops.every(value => Math.abs(value - top) <= 1)).toBe(true);
    const nearBottom = await browser.execute(() => {
      const log = document.querySelector<HTMLElement>('[role="log"]')!;
      log.scrollTop = log.scrollHeight - log.clientHeight - 20;
      return log.scrollTop;
    });
    await sampleScroll(100);
    await browser.execute(() => {
      document.querySelector<HTMLElement>('[role="log"] > .chat-content-lane')!.style.paddingBottom = '720px';
    });
    expect((await sampleScroll(300)).tops.every(value => Math.abs(value - nearBottom) <= 1)).toBe(true);
  });

  it('retains the visible message while paging conversation history', async () => {
    await seedPiHistory('Paged scroll fixture', 120);
    await selectPiConversation('Paged scroll fixture');
    await $('button=Load earlier messages').waitForExist();
    const before = await browser.execute(() => {
      const log = document.querySelector<HTMLElement>('[role="log"]')!;
      log.scrollTop = 300;
      const anchor = log.querySelector<HTMLElement>('[data-testid="pi-user-message"]')!;
      anchor.dataset.scrollAnchor = 'true';
      return anchor.getBoundingClientRect().top;
    });
    await sampleScroll(100);
    // Pi's live window can already include paged entries. Exercise every page
    // without WebDriver revealing the button and changing the reading position.
    for (let page = 0; page < 3 && await $('button=Load earlier messages').isExisting(); page++) {
      await browser.execute(() => {
        const button = [...document.querySelectorAll<HTMLButtonElement>('[role="log"] button')].find(item => item.textContent === 'Load earlier messages');
        button!.click();
      });
      await sampleScroll(100);
    }
    await $('button=Load earlier messages').waitForExist({ reverse: true });
    const after = await browser.execute(() => {
      const log = document.querySelector<HTMLElement>('[role="log"]')!;
      return log.querySelector<HTMLElement>('[data-scroll-anchor="true"]')!.getBoundingClientRect().top;
    });
    expect(Math.abs(after - before)).toBeLessThanOrEqual(1);
  });
});
