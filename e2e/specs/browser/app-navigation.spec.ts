import { browser, expect, $, $$ } from '@wdio/globals';
import { resetBrowserWorkspace, waitForNote } from '../../support/browserWorkspace';
import { navigateAppTab, openAppNavigation, clickPaneAction } from '../../support/appNavigation';
import { waitForWorkspaceAnimationSettled } from '../../support/workspaceAnimation';

const trigger = 'button[aria-label="Switch tab"]';
const menu = '[role="menu"][aria-label="Tabs"]';

async function point(selector: string) {
  return browser.execute(selector => {
    const rect = document.querySelector(selector)!.getBoundingClientRect();
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
  }, selector);
}

describe('compact app navigation', () => {
  beforeEach(async () => {
    await browser.sendCommand('Emulation.clearDeviceMetricsOverride', {});
    await browser.sendCommand('Emulation.setDeviceMetricsOverride', { width: 638, height: 950, deviceScaleFactor: 1, mobile: false });
    await resetBrowserWorkspace();
  });
  afterEach(async () => {
    await browser.releaseActions();
    await browser.sendCommand('Emulation.clearDeviceMetricsOverride', {});
  });

  it('retains desktop tabs and pane controls whenever the note is inset', async () => {
    for (const [width, height] of [[1440, 950], [868, 950], [640, 950], [844, 390]]) {
      await browser.sendCommand('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      await waitForWorkspaceAnimationSettled();
      await expect($(trigger)).not.toExist();
      await expect($('button[aria-label="Split pane"]')).not.toExist();
      await expect($$('.app-navigation-header nav a')).toBeElementsArrayOfSize(3);
      await expect($('.app-navigation-header > div a[aria-label="Settings"]')).toBeDisplayed();
      const layout = await browser.execute(() => {
        const header = document.querySelector('.pane-header')!;
        const title = header.querySelector('input')!.getBoundingClientRect();
        const pin = header.querySelector('button[aria-label="Pin note"]')!.getBoundingClientRect();
        const options = header.querySelector('button[aria-label="Note options"]')!.getBoundingClientRect();
        const card = document.querySelector('[data-testid="workspace-card"]')!.getBoundingClientRect();
        const nav = document.querySelector('.app-navigation-header')!.getBoundingClientRect();
        return { inset: card.left > 0, navAbove: nav.bottom <= card.top + 1,
          optionsLeft: options.right < title.left, pinLeft: pin.right <= title.left,
          pinNear: title.left - pin.right <= 5,
          titleCentered: Math.abs((title.left + title.right) / 2 - (card.left + card.right) / 2) < 1 };
      });
      expect(layout).toEqual({ inset: true, navAbove: true, optionsLeft: true, pinLeft: true, pinNear: true, titleCentered: true });
    }
    await navigateAppTab('Settings');
    await $('input[aria-label="Search settings"]').waitForDisplayed();
    await navigateAppTab('Gneauxght');
    await $('[data-testid="note-title"]').waitForDisplayed();
  });

  it('closes the compact menu when resizing back to the desktop header', async () => {
    await openAppNavigation();
    await browser.sendCommand('Emulation.setDeviceMetricsOverride', { width: 640, height: 950, deviceScaleFactor: 1, mobile: false });
    await expect($(trigger)).not.toExist();
    await expect($(menu)).not.toExist();
    await expect($('.app-navigation-header nav')).toBeDisplayed();
    await navigateAppTab('List');
    await expect(browser).toHaveUrl(expect.stringMatching(/\/list$/));
  });

  it('keeps the mobile title in the stoplight row and desktop chrome unchanged', async () => {
    const measure = async (height: number) => {
      await browser.execute(height => document.querySelector<HTMLElement>('.app-shell')!.style.setProperty('--native-window-controls-height', `${height}px`), height);
      await browser.waitUntil(async () => browser.execute(() => !document.querySelector('[data-window-resizing]')));
      await waitForWorkspaceAnimationSettled();
      return browser.execute(() => {
        const rect = (selector: string) => {
          const { left, top, right, bottom } = document.querySelector(selector)!.getBoundingClientRect();
          return { left, top, right, bottom };
        };
        return {
          nav: rect('.app-navigation-header'), header: rect('.pane-header'),
          card: rect('[data-testid="workspace-card"]'), shell: rect('.app-shell'),
          title: rect('[data-testid="note-title"]'),
          scroller: rect('.cm-scroller'),
          backdrop: getComputedStyle(document.querySelector('.pane-header')!, '::before').backdropFilter,
          dragHeight: document.querySelector('.compact-window-drag-region')!.getBoundingClientRect().height,
          viewportHeight: innerHeight, overflow: document.documentElement.scrollWidth - innerWidth
        };
      });
    };
    for (const width of [638, 320, 640, 1440]) {
      await browser.sendCommand('Emulation.setDeviceMetricsOverride', { width, height: 950, deviceScaleFactor: 1, mobile: false });
      // Let media queries and the resize observer apply before taking a baseline.
      await browser.execute(() => new Promise<void>((done) => {
        requestAnimationFrame(() => requestAnimationFrame(() => done()));
      }));
      const baseline = await measure(0);
      const native = await measure(32);
      const offset = 0;
      for (const key of ['nav', 'header', 'title'] as const) {
        expect(native[key].left).toBe(baseline[key].left);
        expect({ width, surface: key, right: native[key].right }).toEqual({ width, surface: key, right: baseline[key].right });
        expect(native[key].top - baseline[key].top).toBe(offset);
      }
      expect(native.dragHeight).toBe(width < 640 ? 44 : 0);
      expect(native.shell.bottom).toBe(native.viewportHeight);
      expect(native.overflow).toBeLessThanOrEqual(1);
      if (width < 640) {
        expect(native.card.left).toBe(0);
        expect(native.card.right).toBe(width);
        expect(native.nav.top).toBe(44);
        expect(native.header.top).toBe(0);
        expect(native.scroller.top).toBe(0);
        expect(native.backdrop).toContain('blur(');
        expect(native.title.bottom).toBeLessThanOrEqual(native.nav.top);
      }
    }
    await browser.sendCommand('Emulation.setDeviceMetricsOverride', { width: 320, height: 950, deviceScaleFactor: 1, mobile: false });
    await $(trigger).waitForDisplayed();
    await navigateAppTab('Settings');
    await expect($('input[aria-label="Search settings"]')).toBeDisplayed();
    expect(await browser.execute(() => document.querySelector('.app-navigation-header')!.getBoundingClientRect().top)).toBe(32);
  });

  it('opens all tabs and Settings from one button and reflects the selected tab', async () => {
    expect(await $$('.app-navigation-header button')).toHaveLength(1);
    await openAppNavigation();
    expect(await $$(menu + ' a').map(item => item.getAttribute('aria-label'))).toEqual(['Map', 'Gneauxght', 'List', 'Settings']);
    await $('a[aria-label="Settings"]').click();
    await $('input[aria-label="Search settings"]').waitForDisplayed();
    await expect($(trigger)).toHaveAttribute('title', 'Settings — switch tab');
    await expect($(trigger)).toHaveText('Settings');
    await navigateAppTab('Gneauxght');
    await $('[data-testid="note-title"]').waitForDisplayed();
    await expect($(trigger)).toHaveAttribute('title', 'Gneauxght — switch tab');
    await expect($(trigger)).toHaveText('Gneauxght');
  });

  it('supports keyboard selection, Escape, and outside dismissal', async () => {
    await $(trigger).click();
    await browser.keys('Escape');
    await expect($(trigger)).toBeFocused();
    await expect($(trigger)).toHaveAttribute('aria-expanded', 'false');
    await browser.keys('ArrowDown');
    await $(menu).waitForDisplayed();
    await $('a[aria-label="Map"]').waitUntil(async () => await $('a[aria-label="Map"]').isFocused());
    await browser.keys('End');
    await expect($('a[aria-label="Settings"]')).toBeFocused();
    await browser.keys('Enter');
    await $('input[aria-label="Search settings"]').waitForDisplayed();
    await openAppNavigation();
    await browser.action('pointer').move(await point('input[aria-label="Search settings"]')).down().up().perform();
    await expect($(trigger)).toHaveAttribute('aria-expanded', 'false');
  });

  it('selects on mouse release after holding and dragging from the tab button', async () => {
    await browser.action('pointer', { id: 'tab-mouse' }).move(await point(trigger)).down().pause(350).perform(true);
    await $(menu).waitForDisplayed();
    await browser.action('pointer', { id: 'tab-mouse' }).move(await point('a[aria-label="List"]')).perform(true);
    expect(new URL(await browser.getUrl()).pathname).toBe('/');
    await browser.action('pointer', { id: 'tab-mouse' }).up().perform();
    await expect(browser).toHaveUrl(expect.stringMatching(/\/list$/));
  });

  it('selects on touch release after holding and sliding, and cancels outside the menu', async () => {
    await browser.sendCommand('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
    await openAppNavigation();
    const target = await point('a[aria-label="Settings"]');
    await $(trigger).click();
    const start = await point(trigger);
    const touch = (target: { x: number; y: number }) => browser.performActions([{ type: 'pointer', id: 'tab-touch', parameters: { pointerType: 'touch' }, actions: [
      { type: 'pointerMove', duration: 0, origin: 'viewport', ...start },
      { type: 'pointerDown', button: 0 }, { type: 'pause', duration: 350 },
      { type: 'pointerMove', duration: 200, origin: 'viewport', ...target }, { type: 'pointerUp', button: 0 }
    ] }]);
    await touch(target);
    await $('input[aria-label="Search settings"]').waitForDisplayed();
    await browser.releaseActions();
    await touch({ x: 10, y: 400 });
    expect(new URL(await browser.getUrl()).pathname).toBe('/settings');
    await expect($(trigger)).toHaveAttribute('aria-expanded', 'false');
  });

  for (const width of [638, 480, 479, 390, 320]) {
    it(`keeps chat, previous location and split usable at ${width}px`, async () => {
      await browser.sendCommand('Emulation.setDeviceMetricsOverride', { width, height: 950, deviceScaleFactor: 1, mobile: false });
      await waitForWorkspaceAnimationSettled();
      await expect($('[data-pane-kind="editor"] button[aria-label="Open thought partner"]')).toBeDisplayed();
      await expect($('[data-pane-kind="editor"] button[aria-label="Open previous location"]')).toBeDisplayed();
      await expect($('[data-pane-kind="editor"] button[aria-label="Split pane"]')).toBeDisplayed();
      const spacing = await browser.execute(() => {
        const group = document.querySelector('.compact-pane-switch')!;
        const divider = group.querySelector('.compact-pane-divider')!;
        const style = getComputedStyle(divider);
        return { gap: getComputedStyle(group).gap, visible: divider.checkVisibility(),
          width: divider.getBoundingClientRect().width, left: style.marginLeft, right: style.marginRight };
      });
      expect(spacing).toEqual({ gap: '4px', visible: true, width: 1, left: '4px', right: '4px' });
        await $('button[aria-label="Pin note"]').click();
      await expect($('button[aria-label="Unpin note"]')).toHaveAttribute('aria-pressed', 'true');
      await $('button[aria-label="Note options"]').click();
      await $('[role="menuitem"][aria-label="Open note history"]').waitForDisplayed();
      await browser.keys('Escape');
      await clickPaneAction('Open thought partner');
      await $('[data-notepad-command-bar] textarea').waitForEnabled();
      await waitForWorkspaceAnimationSettled();
      await expect($('[data-pane-kind="chat"] button[aria-label="Open previous location"]')).toBeDisplayed();
      for (const chatWidth of [1440, width]) {
        await browser.sendCommand('Emulation.setDeviceMetricsOverride', { width: chatWidth, height: 950, deviceScaleFactor: 1, mobile: false });
        await waitForWorkspaceAnimationSettled();
        const sides = await browser.execute(() => {
          const header = document.querySelector('[data-pane-kind="chat"] .pane-header')!;
          const history = header.querySelector('button[aria-label="Conversations"]')!;
          const center = document.querySelector('button[aria-label="Switch tab"]')?.getBoundingClientRect()
            ?? header.querySelector('input')!.getBoundingClientRect();
          const right = [...header.querySelectorAll('.pane-header-right button')].filter(button => button.checkVisibility());
          return { historyLeft: !!history.closest('.pane-header-left') && history.getBoundingClientRect().right <= center.left,
            actionsRight: right.length > 0 && right.every(button => button.getBoundingClientRect().left >= center.right) };
        });
        expect(sides).toEqual({ historyLeft: true, actionsRight: true });
      }
      await clickPaneAction('Open previous location');
      await waitForNote('Alpha note');
      await waitForWorkspaceAnimationSettled();
      await clickPaneAction('Split pane');
      await $('#pane-command-current').waitForDisplayed();
      await $('#pane-command-current').click();
      await waitForWorkspaceAnimationSettled();
      await expect($$('[data-testid="workspace-pane"]')).toBeElementsArrayOfSize(2);
    });
  }

  it('keeps split actions reachable on one row in a 320px window', async () => {
    await browser.sendCommand('Emulation.setDeviceMetricsOverride', { width: 1440, height: 950, deviceScaleFactor: 1, mobile: false });
    await waitForWorkspaceAnimationSettled();
    await browser.execute(() => document.querySelector<HTMLElement>('button[aria-label="Open split pane options"]')!.dispatchEvent(new PointerEvent('pointerenter')));
    await $('button[aria-label="Split with current location"]').click();
    await waitForWorkspaceAnimationSettled();
    await browser.sendCommand('Emulation.setDeviceMetricsOverride', { width: 320, height: 844, deviceScaleFactor: 1, mobile: false });
    await waitForWorkspaceAnimationSettled();
    for (let side = 0; side < 2; side++) {
      const layout = await browser.execute(() => {
        const header = document.querySelector('[data-testid="workspace-pane"]:not([data-pane-collapsed]) .pane-header')!;
        const title = document.querySelector('.mobile-workspace-title-slot input')!.getBoundingClientRect();
        const rects = [...header.querySelectorAll('button')].filter(el => el.checkVisibility()).map(el => el.getBoundingClientRect());
        const nav = document.querySelector('button[aria-label="Switch tab"]')!.getBoundingClientRect();
        return { fits: rects.every(r => (r.right <= nav.left || r.left >= nav.right) && r.left >= 0 && r.right <= innerWidth),
          right: [...header.querySelectorAll('.pane-header-right button')].filter(el => el.checkVisibility()).every(el => el.getBoundingClientRect().left >= nav.right), titleWidth: title.width,
          centers: [...rects, nav].map(r => r.top + r.height / 2) };
      });
      expect(layout.fits).toBe(true);
      expect(layout.right).toBe(true);
      expect(layout.titleWidth).toBeGreaterThan(20);
      expect(Math.max(...layout.centers) - Math.min(...layout.centers)).toBeLessThanOrEqual(2);
      if (side === 0) {
        await $('.pane-rail').click();
        await waitForWorkspaceAnimationSettled();
      }
    }
    const expanded = '[data-testid="workspace-pane"]:not([data-pane-collapsed])';
    await expect($(expanded + ' button[aria-label="Open thought partner"]')).toBeDisplayed();
    await expect($(expanded + ' button[aria-label="Open previous location"]')).toBeDisplayed();
    await $(expanded + ' button[aria-label="Close pane"]').click();
    await waitForWorkspaceAnimationSettled();
    await expect($$('[data-testid="workspace-pane"]')).toBeElementsArrayOfSize(1);
  });

  it('centers the pin and title across the window and limits growth before the stoplights', async () => {
    const titleInput = await $('[data-testid="note-title"]');
    const longTitle = 'A longer note title that should have room above the navigation controls';
    await titleInput.setValue(longTitle);
    await $('[data-testid="note-editor"] .cm-content').click();
    await browser.execute(() => document.querySelector<HTMLElement>('.app-shell')!.style.setProperty('--native-window-controls-width', '84px'));
    for (const width of [639, 638, 390, 320]) {
      await browser.sendCommand('Emulation.setDeviceMetricsOverride', { width, height: 950, deviceScaleFactor: 1, mobile: false });
      await waitForWorkspaceAnimationSettled();
      const layout = await browser.execute(() => {
        const header = document.querySelector('.pane-header')!;
        const title = document.querySelector('.mobile-workspace-title-slot input')!.getBoundingClientRect();
        const rects = [document.querySelector('button[aria-label="Switch tab"]')!,
          ...[...header.querySelectorAll('button')].filter(button => button.checkVisibility())].map(el => el.getBoundingClientRect());
        const options = header.querySelector('button[aria-label="Note options"]')!.getBoundingClientRect();
        const pin = document.querySelector('.mobile-workspace-title-slot button[aria-label="Pin note"]')!.getBoundingClientRect();
        const right = [...header.querySelectorAll('.pane-header-right button')].filter(el => el.checkVisibility());
        return { centered: Math.abs((rects[0].left + rects[0].right) / 2 - innerWidth / 2) <= 1,
          optionsLeft: options.right <= rects[0].left,
          pinNextToTitle: pin.right <= title.left && title.left - pin.right <= 5,
          titleAbove: title.bottom <= rects[0].top && pin.bottom <= rects[0].top,
          titleWidth: title.width, titleLeft: pin.left, titleRight: title.right,
          titleCenter: (pin.left + title.right) / 2,
          titleMask: getComputedStyle(document.querySelector('.mobile-workspace-title-slot input')!).maskImage,
          titleAlign: getComputedStyle(document.querySelector('.mobile-workspace-title-slot input')!).textAlign,
          titleScroll: document.querySelector<HTMLInputElement>('.mobile-workspace-title-slot input')!.scrollLeft,
          pinMask: getComputedStyle(document.querySelector('.mobile-workspace-title-slot .pane-header-pin')!).maskImage,
          controlsRight: right.every(el => el.getBoundingClientRect().left >= rects[0].right), centers: rects.map(r => r.top + r.height / 2), overlaps: rects.some((a, i) => rects.slice(i + 1).some(b =>
          a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top)), overflow: document.documentElement.scrollWidth - innerWidth };
      });
      expect(Math.max(...layout.centers) - Math.min(...layout.centers)).toBeLessThanOrEqual(2);
      expect(layout.centered).toBe(true);
      expect(layout.titleAbove).toBe(true);
      expect(layout.titleWidth).toBeCloseTo(width - 228, 0);
      expect(layout.titleLeft).toBeGreaterThanOrEqual(96);
      expect(layout.titleRight).toBeLessThanOrEqual(width - 96);
      expect(layout.titleCenter).toBeCloseTo(width / 2, 0);
      expect(layout.titleMask).toContain('linear-gradient');
      expect(layout.titleMask).toMatch(/^linear-gradient\(to right, rgb\(0, 0, 0\)/);
      expect(layout.titleAlign).toBe('left');
      expect(layout.titleScroll).toBe(0);
      expect(layout.pinMask).toBe('none');
      expect(layout.controlsRight).toBe(true);
      expect(layout.optionsLeft).toBe(true);
      expect(layout.pinNextToTitle).toBe(true);
      expect(layout.overlaps).toBe(false);
      expect(layout.overflow).toBeLessThanOrEqual(1);
      await titleInput.setValue('Note');
      expect(await browser.execute(() => getComputedStyle(document.querySelector('.mobile-workspace-title-slot input')!).maskImage)).toBe('none');
      await $('[data-testid="note-editor"] .cm-content').click();
      const shortTitle = await browser.execute(() => {
        const title = document.querySelector('.mobile-workspace-title-slot input')!.getBoundingClientRect();
        const pin = document.querySelector('.mobile-workspace-title-slot .pane-header-pin')!.getBoundingClientRect();
        return { center: (pin.left + title.right) / 2, left: pin.left, right: title.right,
          mask: getComputedStyle(document.querySelector('.mobile-workspace-title-slot input')!).maskImage };
      });
      expect(shortTitle.center).toBeCloseTo(width / 2, 0);
      expect(shortTitle.left).toBeGreaterThan(layout.titleLeft);
      expect(shortTitle.right).toBeLessThan(layout.titleRight);
      expect(shortTitle.mask).toBe('none');
      await titleInput.setValue(longTitle);
      expect(await browser.execute(() => getComputedStyle(document.querySelector('.mobile-workspace-title-slot input')!).maskImage)).toBe('none');
      await browser.keys('End');
      await $('[data-testid="note-editor"] .cm-content').click();
    }
    await browser.sendCommand('Emulation.setDeviceMetricsOverride', { width: 640, height: 950, deviceScaleFactor: 1, mobile: false });
    await waitForWorkspaceAnimationSettled();
    await browser.waitUntil(async () => browser.execute((original: HTMLElement) =>
      original === document.querySelector('[data-testid="note-title"]') && !!original.closest('.pane-header'), titleInput),
    { timeoutMsg: 'Retained title did not return to the desktop pane header' });
    expect(await $$('.mobile-workspace-title-slot input')).toHaveLength(0);
    for (const width of [640, 1440]) {
      await browser.sendCommand('Emulation.setDeviceMetricsOverride', { width, height: 950, deviceScaleFactor: 1, mobile: false });
      await waitForWorkspaceAnimationSettled();
      await titleInput.click();
      await browser.keys('End');
      expect(await browser.execute(() => getComputedStyle(document.querySelector('[data-testid="note-title"]')!).maskImage)).toBe('none');
      await $('[data-testid="note-editor"] .cm-content').click();
      const title = await browser.execute(() => {
        const input = document.querySelector<HTMLInputElement>('[data-testid="note-title"]')!;
        return { mask: getComputedStyle(input).maskImage, align: getComputedStyle(input).textAlign, scroll: input.scrollLeft, value: input.value };
      });
      expect(title.mask).toMatch(/^linear-gradient\(to right, rgb\(0, 0, 0\)/);
      expect(title.align).toBe('left');
      expect(title.scroll).toBe(0);
      expect(title.value).toBe(longTitle);
    }
  });
});
