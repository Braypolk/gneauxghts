import { browser, expect, $ } from '@wdio/globals';
import { resetBrowserWorkspace } from '../../support/browserWorkspace';
import { openBrowserPiPane } from '../../support/browserPi';

describe('visible chat generation progress', () => {
  beforeEach(async () => { await resetBrowserWorkspace(); await openBrowserPiPane(); });

  it('shows thinking while reasoning streams, then paints the answer before completion', async () => {
    const answer = 'Your notes explore creative projects. '.repeat(40);
    await browser.execute((answer: string) => new Promise<void>((done) => {
      void window.__GNEAUXGHTS_E2E__!.setNextPiResponse(answer, 'Compare the themes across the notes. '.repeat(25)).then(done);
    }), answer);
    await $('textarea[aria-label="Message"]').setValue('Explain the themes');
    await $('[data-testid="pi-send"]').click();
    const reasoning = await $('[data-testid="pi-reasoning"][data-streaming="true"]');
    await expect(reasoning.$('[data-slot="trace-collapsible-trigger"]')).toHaveText('Thinking…');
    await expect($('[data-testid="pi-activity"]')).not.toBeExisting();
    await expect($('.pi-progress-spinner, .progress-spinner')).not.toBeExisting();
    await reasoning.$('[data-slot="trace-collapsible-trigger"]').click();
    const initial = await reasoning.$('pre').getText();
    await browser.waitUntil(async () => (await reasoning.$('pre').getText()).length > initial.length + 20);
    await expect($('[data-testid="pi-assistant-message"][data-streaming="true"]')).not.toBeExisting();
    const response = await $('[data-testid="pi-assistant-message"][data-streaming="true"]');
    await response.waitForDisplayed();
    expect((await response.getText()).length).toBeLessThan(answer.length);
    await expect($('[data-testid="pi-stop"]')).toBeEnabled();
    await expect($('[data-testid="pi-activity"]')).not.toBeExisting();
    await expect(reasoning.$('[data-slot="trace-collapsible-trigger"]')).toHaveText('Reasoning');
    await browser.saveScreenshot('/private/tmp/gneauxghts-thinking-to-answer.png');
    await $('[data-testid="pi-stop"]').waitForExist({ reverse: true, timeout: 15000 });
    await expect($('[data-testid="pi-assistant-message"][data-streaming="false"] .pi-assistant-body')).toHaveText(answer.trim());
  });

  it('shows waiting without claiming to be writing when the model has emitted no content', async () => {
    await browser.execute(() => new Promise<void>((done) => {
      void window.__GNEAUXGHTS_E2E__!.holdNextPiResponse().then(done);
    }));
    await $('textarea[aria-label="Message"]').setValue('Wait for the model');
    await $('[data-testid="pi-send"]').click();
    const activity = await $('[data-testid="pi-activity"]');
    await expect(activity).toHaveText(expect.stringContaining('Waiting for model…'));
    await expect($('.pi-progress-spinner, .progress-spinner')).not.toBeExisting();
    await expect($('[data-testid="pi-assistant-message"]')).not.toBeExisting();
    await $('[data-testid="pi-stop"]').click();
    await activity.waitForExist({ reverse: true });
  });

  it('bounds and scrolls expanded reasoning without any tool calls', async () => {
    await browser.execute(() => new Promise<void>((done) => {
      void window.__GNEAUXGHTS_E2E__!.setNextPiResponse('A concise answer.', 'A short thought.\n'.repeat(250)).then(done);
    }));
    await $('textarea[aria-label="Message"]').setValue('Reason without tools');
    await $('[data-testid="pi-send"]').click();
    const reasoning = await $('[data-testid="pi-reasoning"]');
    await reasoning.$('[data-slot="trace-collapsible-trigger"]').click();
    await browser.waitUntil(async () => (await reasoning.$('pre').getText()).length > 1800);
    async function geometry() {
      return browser.execute(() => {
        const reasoning = document.querySelector('[data-testid="pi-reasoning"]')!;
        const inner = reasoning.querySelector<HTMLElement>('[data-testid="pi-reasoning-scroll"]') ?? reasoning.querySelector<HTMLElement>('[data-slot="trace-collapsible-content"]')!;
        const outer = document.querySelector<HTMLElement>('[aria-label="Conversation messages"]')!;
        const outerTop = outer.scrollTop;
        inner.scrollTop = inner.scrollHeight;
        return { height: inner.clientHeight, content: inner.scrollHeight, innerTop: inner.scrollTop, outerTop, outerAfter: outer.scrollTop, overflow: inner.scrollWidth - inner.clientWidth, viewport: window.innerHeight };
      });
    }
    try {
      const desktop = await geometry();
      expect(desktop.height).toBeLessThanOrEqual(Math.ceil(Math.min(352, desktop.viewport * .45)));
      expect(desktop.content).toBeGreaterThan(desktop.height);
      expect(desktop.innerTop).toBeGreaterThan(0);
      expect(desktop.outerAfter).toBe(desktop.outerTop);
      await browser.saveScreenshot('/private/tmp/gneauxghts-bounded-reasoning.png');
      await browser.setWindowSize(480, 800);
      const narrow = await geometry();
      expect(narrow.height).toBeLessThanOrEqual(Math.ceil(Math.min(352, narrow.viewport * .45)));
      expect(narrow.overflow).toBeLessThanOrEqual(1);
      await reasoning.$('[data-slot="trace-collapsible-trigger"]').click();
      await expect(reasoning.$('pre')).not.toBeDisplayed();
    } finally {
      await $('[data-testid="pi-stop"]').click();
      await browser.setWindowSize(1440, 1000);
    }
  });

  it('keeps shimmer readable and disables status motion when reduced motion is requested', async () => {
    await browser.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
    try {
      await browser.execute(() => new Promise<void>((done) => {
        void window.__GNEAUXGHTS_E2E__!.holdNextPiResponse().then(done);
      }));
      await $('textarea[aria-label="Message"]').setValue('Check status motion');
      await $('[data-testid="pi-send"]').click();
      const status = await $('[data-testid="pi-activity"] .shimmer');
      await expect(status).toHaveText('Waiting for model…');
      const motion = () => browser.execute(() => {
        const style = getComputedStyle(document.querySelector('[data-testid="pi-activity"] .shimmer')!);
        return { animation: style.animationName, gradient: style.backgroundImage, fill: style.webkitTextFillColor };
      });
      const animated = await motion();
      expect(animated.animation).toBe('tw-shimmer');
      expect(animated.gradient).toContain('linear-gradient');
      await browser.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
      await browser.waitUntil(async () => (await motion()).animation === 'none');
      const reduced = await motion();
      expect(reduced.gradient).toBe('none');
      expect(reduced.fill).not.toBe('rgba(0, 0, 0, 0)');
      await $('[data-testid="pi-stop"]').click();
      await $('[data-testid="pi-activity"]').waitForExist({ reverse: true });
    } finally {
      await browser.sendCommand('Emulation.setEmulatedMedia', { features: [] });
    }
  });
});
