import { browser, expect, $, $$ } from '@wdio/globals';

async function ready(width = 1440) {
  await browser.setWindowSize(width, 1000);
  await browser.url('/');
  await $('[data-testid="note-editor"] .cm-content').waitForDisplayed({ timeout: 30_000 });
  await browser.pause(400);
}

describe('animation interruptions and controls', () => {
  it('keeps faded-out Related and split controls out of keyboard focus', async () => {
    await ready();
    const result = await browser.execute(() => {
      const panel = document.querySelector<HTMLElement>('#related-drawer-panel')!;
      panel.querySelector<HTMLButtonElement>('button:not(:disabled)')!.focus();
      const relatedFocused = panel.contains(document.activeElement);
      document.querySelector<HTMLElement>('[data-testid="note-editor"] .cm-content')!.focus();
      const hiddenSplit = document.querySelector<HTMLButtonElement>('.split-pane-option--current')!;
      hiddenSplit.focus();
      return { relatedFocused, splitFocused: document.activeElement === hiddenSplit };
    });
    expect(result).toEqual({ relatedFocused: false, splitFocused: false });
    await $('button[aria-label="Expand related notes"]').click();
    const close = await $('button[aria-label="Close related panel"]');
    await close.waitForClickable();
    await close.click();
    await expect($('button[aria-label="Expand related notes"]')).toBeFocused();
  });

  it('waits for a retargeted pane collapse before unmounting the editor', async () => {
    await ready();
    await $('button[aria-label="Open split pane options"]').click();
    await $('#pane-command-current').waitForExist();
    await browser.execute(() => document.querySelector<HTMLElement>('#pane-command-current')!.click());
    await browser.waitUntil(async () => browser.execute(() => !document.querySelector('[data-pane-motion]')));
    const result = await browser.executeAsync((done: (result: { toggled: boolean; widths: number[]; settled: boolean }) => void) => {
      const pane = document.querySelector<HTMLElement>('[aria-label="Pane 2"]')!;
      const startWidth = pane.getBoundingClientRect().width;
      const start = performance.now();
      let toggled = false;
      const widths: number[] = [];
      pane.querySelector<HTMLElement>('button[aria-label="Close pane"]')!.click();
      const sample = () => {
        if (!pane.isConnected || performance.now() - start > 3000) {
          done({ toggled, widths, settled: !pane.isConnected && !document.querySelector('[data-pane-motion]') });
          return;
        }
        const width = pane.getBoundingClientRect().width;
        if (toggled) widths.push(width);
        else if (width > 1 && width < startWidth * 0.7) {
          toggled = true;
          document.querySelector<HTMLElement>('button[aria-label="Expand related notes"]')!.click();
        }
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    expect(result.toggled).toBe(true);
    expect(result.settled).toBe(true);
    expect(result.widths.length).toBeGreaterThan(3);
    expect(result.widths.at(-1)).toBeLessThanOrEqual(1);
    expect(await $$('[data-testid="workspace-pane"]')).toHaveLength(1);
  });

  it('retargets pane entrance when Related changes without snapping to the endpoint', async () => {
    await ready();
    const result = await browser.executeAsync((done: (result: { before: number; after: number; moving: boolean }) => void) => {
      const start = performance.now();
      document.querySelector<HTMLElement>('button[aria-label="Open split pane options"]')!.click();
      const interrupt = () => {
        if (performance.now() - start > 3000) { done({ before: 0, after: 0, moving: false }); return; }
        const pane = document.querySelector<HTMLElement>('[aria-label="Pane 2"]');
        const animation = pane?.getAnimations().find(animation =>
          animation.playState === 'running' && Number(animation.currentTime) >= 55);
        if (!pane || !animation) { requestAnimationFrame(interrupt); return; }
        const before = pane.getBoundingClientRect().width;
        document.querySelector<HTMLElement>('button[aria-label="Expand related notes"]')!.click();
        requestAnimationFrame(() => done({ before, after: pane.getBoundingClientRect().width,
          moving: !!document.querySelector('[data-pane-motion]') }));
      };
      requestAnimationFrame(interrupt);
    });
    expect(result.moving).toBe(true);
    expect(Math.abs(result.after - result.before)).toBeLessThan(35);
    await browser.waitUntil(async () => browser.execute(() => !document.querySelector('[data-pane-motion]')));
  });

  for (const width of [1280, 2400]) {
    it(`renders the same Related width it reserves at ${width}px`, async () => {
      await ready(width);
      await $('button[aria-label="Expand related notes"]').click();
      await browser.pause(400);
      const result = await browser.execute(() => {
        const drawer = document.querySelector<HTMLElement>('.related-drawer')!;
        const card = document.querySelector<HTMLElement>('.notepad-workspace-card')!;
        return { width: drawer.getBoundingClientRect().width,
          expected: Math.round(Math.max(288, Math.min(window.innerWidth * 0.24, 352))),
          gap: card.getBoundingClientRect().left - drawer.getBoundingClientRect().right };
      });
      expect(result.width).toBe(result.expected);
      expect(Math.abs(result.gap - 8)).toBeLessThanOrEqual(1);
    });
  }

  it('keeps the forget fill aligned with frame-driven progress', async () => {
    await ready();
    const result = await browser.executeAsync((done: (result: { progress: number; displayed: number }) => void) => {
      const button = document.querySelector<HTMLElement>('button[aria-label^="Forget this note."]')!;
      button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
      setTimeout(() => {
        const progress = Number(button.style.getPropertyValue('--forget-progress'));
        const fill = button.querySelector<HTMLElement>('[style*="scaleX"]')!;
        const displayed = new DOMMatrix(getComputedStyle(fill).transform).a;
        button.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
        done({ progress, displayed });
      }, 500);
    });
    expect(result.progress).toBeGreaterThan(0.2);
    expect(Math.abs(result.displayed - result.progress)).toBeLessThan(0.025);
    expect(await browser.execute(() => window.__GNEAUXGHTS_E2E__!.invocations
      .filter(entry => entry.command === 'forget_note').length)).toBe(0);
  });

  it('settles search, disclosures and loading indicators under the reduced-motion CSS policy', async () => {
    await ready();
    const result = await browser.execute(() => {
      // Activate the actual reduced-motion rules without changing the user's OS preference.
      const activate = (rules: CSSRuleList) => {
        for (const rule of rules) {
          if (rule instanceof CSSMediaRule && rule.conditionText.includes('prefers-reduced-motion: reduce')) {
            rule.media.mediaText = 'all';
          }
          if ('cssRules' in rule) activate((rule as CSSGroupingRule).cssRules);
        }
      };
      for (const sheet of document.styleSheets) activate(sheet.cssRules);
      const input = document.querySelector<HTMLInputElement>('[data-testid="note-search-input"]')!;
      input.focus();
      const spinner = document.createElement('span');
      spinner.className = 'animate-spin';
      document.body.append(spinner);
      const elements = [...document.querySelectorAll<HTMLElement>(
        '.shared-search-bar-shell, .shared-search-mode-label, .split-pane-option')];
      const durations = elements.map(element => getComputedStyle(element).transitionDuration);
      const animation = getComputedStyle(spinner).animationName;
      spinner.remove();
      return { durations, animation };
    });
    expect(result.durations.every(duration => duration.split(',').every(value => parseFloat(value) === 0))).toBe(true);
    expect(result.animation).toBe('none');
  });

  it('keeps search labels collapsed when the expanded toolbar is narrow', async () => {
    await ready();
    await browser.execute(() => {
      const shell = document.querySelector<HTMLElement>('.shared-search-bar-shell')!;
      shell.style.maxWidth = '400px';
    });
    await $('[data-testid="note-search-input"]').setValue('Alpha');
    await browser.pause(400);
    const result = await browser.execute(() => {
      const shell = document.querySelector<HTMLElement>('.shared-search-bar-shell')!;
      return { expanded: shell.dataset.searchExpanded, width: shell.getBoundingClientRect().width,
        labels: [...shell.querySelectorAll<HTMLElement>('.shared-search-mode-label')].map(element => {
          const style = getComputedStyle(element);
          return { maxWidth: style.maxWidth, opacity: style.opacity };
        }) };
    });
    expect(result.expanded).toBe('true');
    expect(result.width).toBeLessThanOrEqual(400);
    expect(result.labels.length).toBeGreaterThan(0);
    expect(result.labels.every(label => label.maxWidth === '0px' && label.opacity === '0')).toBe(true);
  });
});
