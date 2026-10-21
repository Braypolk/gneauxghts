import { browser, expect, $ } from '@wdio/globals';
import { resetBrowserWorkspace } from '../../support/browserWorkspace';
import { openBrowserPiPane, selectPiConversation } from '../../support/browserPi';

describe('chat tool activity', () => {
  beforeEach(resetBrowserWorkspace);

  it('collapses tool rounds, exposes readable paired rows, and scrolls inside a bounded container', async () => {
    const seeded = await browser.execute(() => new Promise<string>((done) => {
      void window.__GNEAUXGHTS_E2E__!.seedPiChat({ title: 'Tool activity fixture', toolCalls: 24 }).then(done);
    }));
    expect(seeded).toBeTruthy();
    await openBrowserPiPane();
    await selectPiConversation('Tool activity fixture');
    const activity = await $('[data-testid="pi-tool-activity"]');
    await expect(activity).toHaveAttribute('data-state', 'closed');
    await expect(activity.$(':scope > [data-slot="trace-collapsible-trigger"]')).toHaveText(expect.stringContaining('Read notes'));
    await expect(activity.$(':scope > [data-slot="trace-collapsible-trigger"]')).toHaveText(expect.stringContaining('1 failed'));
    await expect($('[data-testid="pi-assistant-message"] .pi-assistant-body')).toHaveText('Your notes explore creative projects and useful everyday tools.');
    const scroll = await $('[data-testid="pi-tool-activity-scroll"]');
    await expect(scroll).not.toBeDisplayed();
    await activity.$(':scope > [data-slot="trace-collapsible-trigger"]').click();
    await expect(scroll).toBeDisplayed();
    const rows = await activity.$$('[data-testid="pi-tool-result"]');
    expect(rows.length).toBe(24);
    await expect(rows[0].$('[data-slot="trace-collapsible-trigger"]')).toHaveText('Read note\nProject ideas 1');
    const arrowGaps = await browser.execute(() => {
      const groups = document.querySelectorAll('[data-testid="pi-tool-activity"], [data-testid="pi-tool-result"]');
      return [...groups].map(group => {
        const trigger = group.querySelector(':scope > [data-slot="trace-collapsible-trigger"]')!;
        const line = trigger.querySelector('[data-slot="trace-line"]')!;
        const last = line.lastElementChild!;
        const label = last.querySelector('.tool-subject') ?? last;
        return trigger.lastElementChild!.getBoundingClientRect().left - label.getBoundingClientRect().right;
      });
    });
    expect(arrowGaps).toHaveLength(25);
    expect(arrowGaps.every(gap => gap >= 0 && gap <= 12)).toBe(true);
    await rows[0].$('[data-slot="trace-collapsible-trigger"]').click();
    await expect(rows[0].$('.tool-detail')).toHaveText(expect.stringContaining('Arguments'));
    await expect(rows[0].$('.tool-detail')).toHaveText(expect.stringContaining('Output'));
    const geometry = await browser.execute(() => {
      const inner = document.querySelector<HTMLElement>('[data-testid="pi-tool-activity-scroll"]')!;
      const outer = document.querySelector<HTMLElement>('[aria-label="Conversation messages"]')!;
      const outerTop = outer.scrollTop;
      inner.scrollTop = inner.scrollHeight;
      return { height: inner.clientHeight, content: inner.scrollHeight, innerTop: inner.scrollTop, outerTop, outerAfter: outer.scrollTop, viewport: window.innerHeight };
    });
    expect(geometry.content).toBeGreaterThan(geometry.height);
    expect(geometry.height).toBeLessThanOrEqual(Math.min(352, geometry.viewport * .45));
    expect(geometry.innerTop).toBeGreaterThan(0);
    expect(geometry.outerAfter).toBe(geometry.outerTop);
    await activity.$(':scope > [data-slot="trace-collapsible-trigger"]').click();
    await expect(scroll).not.toBeDisplayed();
    await browser.keys('Enter');
    await expect(scroll).toBeDisplayed();
    await expect(rows[0]).toHaveAttribute('data-state', 'open');
    await browser.saveScreenshot('/private/tmp/gneauxghts-tool-activity.png');
    // The same cap applies when the chat is in a narrow viewport.
    await browser.setWindowSize(480, 800);
    const mobile = await browser.execute(() => {
      const inner = document.querySelector<HTMLElement>('[data-testid="pi-tool-activity-scroll"]')!;
      return { height: inner.clientHeight, content: inner.scrollHeight, overflow: inner.scrollWidth - inner.clientWidth };
    });
    expect(mobile.content).toBeGreaterThan(mobile.height);
    expect(mobile.height).toBeLessThanOrEqual(352);
    expect(mobile.overflow).toBeLessThanOrEqual(1);
    await browser.setWindowSize(1440, 1000);
  });
});
