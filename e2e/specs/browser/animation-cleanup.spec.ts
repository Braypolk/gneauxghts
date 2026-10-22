import { browser, expect, $, $$ } from '@wdio/globals';
import { waitForWorkspaceAnimationSettled } from '../../support/workspaceAnimation';
import { navigateAppTab } from '../../support/appNavigation';
import { resetBrowserWorkspace } from '../../support/browserWorkspace';

async function ready(width = 1440) {
  await browser.setWindowSize(width, 1000);
  await browser.url('/');
  await $('[data-testid="note-editor"] .cm-content').waitForDisplayed({ timeout: 30_000 });
  await waitForWorkspaceAnimationSettled();
}

describe('animation interruptions and controls', () => {
  for (const width of [1440, 640]) {
    it(`retires pane-motion waits when Settings replaces the workspace at ${width}px`, async () => {
      await resetBrowserWorkspace();
      await browser.setWindowSize(width, 1000);
      await waitForWorkspaceAnimationSettled();
      await browser.execute(() => document.querySelector<HTMLElement>('button[aria-label="Open split pane options"]')!
        .dispatchEvent(new PointerEvent('pointerenter')));
      await $('button[aria-label="Split with current location"]').waitForClickable();
      try {
        const result = await browser.execute(() => new Promise<{
          started: boolean; warnings: number; cancelled: boolean; settingsFocused: boolean; error?: string;
        }>(done => {
          const shell = document.querySelector<HTMLElement>('.notepad-shell')!;
          const warn = console.warn;
          let warnings = 0, started = false, finished = false;
          let animations: Animation[] = [];
          console.warn = (...args) => {
            if (args.some(value => typeof value === 'string' && value.includes('derived_inert'))) warnings++;
            warn(...args);
          };
          const finish = (error?: string) => {
            if (finished) return;
            finished = true; clearTimeout(deadline); observer.disconnect();
            shell.removeEventListener('workspace-pane-layout-ready', leave);
            console.warn = warn;
            done({ started, warnings, cancelled: animations.length > 0 && animations.every(animation => animation.playState === 'idle'),
              settingsFocused: document.activeElement?.matches('[data-settings-section]') ?? false, ...(error ? { error } : {}) });
          };
          const leave = () => {
            started = shell.hasAttribute('data-pane-motion');
            animations = shell.getAnimations({ subtree: true }).filter(animation => animation.effect?.getTiming().iterations !== Infinity);
            // Request real route navigation as soon as pane effects start.
            // Keep the motion clock real so teardown owns cancellation.
            document.querySelector<HTMLAnchorElement>('a[aria-label="Settings"]')!.click();
          };
          const observer = new MutationObserver(() => {
            if (shell.isConnected) return;
            observer.disconnect();
            const settings = document.querySelector<HTMLButtonElement>('[data-settings-section]');
            settings?.focus();
            // Let released motion waiters and their focus continuations finish.
            requestAnimationFrame(() => requestAnimationFrame(() => finish()));
          });
          const deadline = setTimeout(() => finish('Workspace did not unmount during pane motion'), 5000);
          observer.observe(document.body, { subtree: true, childList: true });
          shell.addEventListener('workspace-pane-layout-ready', leave, { once: true });
          document.querySelector<HTMLElement>('button[aria-label="Split with current location"]')!.click();
        }));
        expect(result.error).toBeUndefined();
        expect(result.started).toBe(true);
        expect(result.cancelled).toBe(true);
        expect(result.warnings).toBe(0);
        expect(result.settingsFocused).toBe(true);
        await navigateAppTab('Gneauxght');
        await browser.$$('[data-testid="workspace-pane"]:not([data-pane-collapsed]) [data-testid="note-editor"] .cm-content')[0].waitForDisplayed();
        await waitForWorkspaceAnimationSettled();
        await $('[data-testid="note-search-input"]').setValue('Alpha');
        await expect($('[data-testid="note-search-input"]')).toBeFocused();
      } finally {
        await resetBrowserWorkspace();
      }
    });
  }

  it('unmounts closed Related results and keeps hidden split controls out of keyboard focus', async () => {
    await ready();
    await expect($('[role="dialog"][aria-label="Related notes"]')).not.toExist();
    expect(await browser.execute(() => {
      const hiddenSplit = document.querySelector<HTMLButtonElement>('.split-pane-option--current')!;
      hiddenSplit.focus(); return document.activeElement === hiddenSplit;
    })).toBe(false);
    await $('button[aria-label="Related notes"]').click();
    await $('[role="dialog"][aria-label="Related notes"]').waitForDisplayed();
    await browser.keys('Escape');
    await expect($('button[aria-label="Related notes"]')).toHaveAttribute('aria-expanded', 'false');
  });

  it('waits for a pane collapse with Related opening before unmounting the editor', async () => {
    await ready();
    await $('button[aria-label="Open split pane options"]').click();
    await $('#pane-command-current').waitForExist();
    await browser.execute(() => document.querySelector<HTMLElement>('#pane-command-current')!.click());
    await browser.waitUntil(async () => browser.execute(() => !document.querySelector('[data-pane-motion]')));
    const result = await browser.execute(() => new Promise<{
      toggled: boolean;
      widths: number[];
      settled: boolean;
      completedWhileMounted: boolean;
      error?: string;
    }>((done) => {
      const pane = document.querySelector<HTMLElement>('[aria-label="Pane 2"]')!;
      const startWidth = pane.getBoundingClientRect().width;
      let toggled = false;
      let watchingCompletion = false, completedWhileMounted = false;
      const widths: number[] = [];
      let frameId = 0;
      let finished = false;
      const finish = (error?: string) => {
        if (finished)
          return;
        finished = true;
        clearTimeout(deadline);
        cancelAnimationFrame(frameId);
        done({ toggled, widths, completedWhileMounted, settled: !pane.isConnected && !document.querySelector('[data-pane-motion]'),
          ...(error ? { error } : {}) });
      };
      const deadline = setTimeout(() => finish('Pane collapse did not settle'), 3000);
      pane.querySelector<HTMLElement>('button[aria-label="Close pane"]')!.click();
      const sample = () => {
        if (finished)
          return;
        if (!pane.isConnected) {
          if (!document.querySelector('[data-pane-motion]'))
            finish();
          else
            frameId = requestAnimationFrame(sample);
          return;
        }
        if (!watchingCompletion) {
          const motion = pane.getAnimations().find(animation => animation.playState === 'running');
          if (motion) {
            watchingCompletion = true;
            // The last rAF sample can precede the final animation frame. Check
            // actual completion before removal instead of that sample's width.
            void motion.finished.then(() => { completedWhileMounted = pane.isConnected; }, () => {});
          }
        }
        const width = pane.getBoundingClientRect().width;
        if (toggled)
          widths.push(width);
        else if (width > 1 && width < startWidth * 0.7) {
          toggled = true;
          document.querySelector<HTMLElement>('button[aria-label="Related notes"]')!.click();
        }
        frameId = requestAnimationFrame(sample);
      };
      frameId = requestAnimationFrame(sample);
    }));
    if (result.error) throw new Error(result.error);
    expect(result.toggled).toBe(true);
    expect(result.settled).toBe(true);
    expect(result.widths.length).toBeGreaterThan(3);
    expect(result.completedWhileMounted).toBe(true);
    expect(await $$('[data-testid="workspace-pane"]')).toHaveLength(1);
  });

  it('leaves pane entrance animation untouched when Related opens', async () => {
    await ready();
    await browser.execute(() => document.querySelector<HTMLElement>('button[aria-label="Open split pane options"]')!.dispatchEvent(new PointerEvent('pointerenter')));
    await $('button[aria-label="Split with current location"]').waitForClickable();
    const sameAnimation = await browser.execute(() => new Promise<boolean>((done) => {
      document.querySelector<HTMLElement>('button[aria-label="Split with current location"]')!.click();
      const started = performance.now();
      const sample = () => {
        const pane = document.querySelector<HTMLElement>('[aria-label="Pane 2"]');
        const animation = pane?.getAnimations().find(a => a.playState === 'running');
        if (!animation || !pane) {
          if (performance.now() - started > 3000)
            done(false);
          else
            requestAnimationFrame(sample);
          return;
        }
        document.querySelector<HTMLElement>('button[aria-label="Related notes"]')!.click();
        requestAnimationFrame(() => done(pane.getAnimations().includes(animation)));
      };
      requestAnimationFrame(sample);
    }));
    expect(sameAnimation).toBe(true);
    await waitForWorkspaceAnimationSettled();
  });

  it('keeps the forget fill aligned with frame-driven progress', async () => {
    await ready();
    const result = await browser.execute(() => new Promise<{
      progress: number;
      displayed: number;
    }>((done) => {
      const button = document.querySelector<HTMLElement>('button[aria-label^="Forget this note."]')!;
      button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
      setTimeout(() => {
        const progress = Number(button.style.getPropertyValue('--forget-progress'));
        const fill = button.querySelector<HTMLElement>('[style*="scaleX"]')!;
        const displayed = new DOMMatrix(getComputedStyle(fill).transform).a;
        button.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
        done({ progress, displayed });
      }, 500);
    }));
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
      // The dock owns the projected width and updates its inline projection
      // styles. Constrain its layout through CSS, as a narrow host would.
      const style = document.createElement('style');
      style.textContent = '.workspace-input-dock { max-width: 400px !important; }';
      document.head.append(style);
    });
    await $('[data-testid="note-search-input"]').setValue('Alpha');
    await waitForWorkspaceAnimationSettled();
    const result = await browser.execute(() => {
      const shell = document.querySelector<HTMLElement>('.shared-search-bar-shell')!;
      return { expanded: shell.dataset.searchExpanded, width: shell.getBoundingClientRect().width,
        labels: [...shell.querySelectorAll<HTMLElement>('.shared-search-mode-label')].map(element => {
          const style = getComputedStyle(element);
          return { display: style.display };
        }) };
    });
    expect(result.expanded).toBe('true');
    expect(result.width).toBeLessThanOrEqual(400);
    expect(result.labels.length).toBeGreaterThan(0);
    expect(result.labels.every(label => label.display === 'none')).toBe(true);
  });
});
