import { browser, expect, $ } from '@wdio/globals';
import { resetBrowserWorkspace } from '../../support/browserWorkspace';
import { navigateAppTab, clickPaneAction } from '../../support/appNavigation';

describe('iPhone viewport geometry', () => {
  beforeEach(async () => {
    await resetBrowserWorkspace();
    await browser.sendCommand('Emulation.setDeviceMetricsOverride', { width: 874, height: 402, deviceScaleFactor: 1, mobile: true });
    await browser.sendCommand('Emulation.setTouchEmulationEnabled', { enabled: true });
  });
  afterEach(async () => {
    await browser.execute(() => {
      const testWindow = window as typeof window & { __originalVisualViewport?: VisualViewport | null };
      if ('__originalVisualViewport' in testWindow) {
        Object.defineProperty(window, 'visualViewport', { configurable: true, value: testWindow.__originalVisualViewport });
        delete testWindow.__originalVisualViewport;
      }
      document.documentElement.style.removeProperty('--app-safe-area-left');
      document.documentElement.style.removeProperty('--app-safe-area-right');
    });
    await browser.sendCommand('Emulation.setTouchEmulationEnabled', { enabled: false });
    await browser.sendCommand('Emulation.clearDeviceMetricsOverride', {});
  });

  it('keeps route content clear of cutouts on either landscape edge', async () => {
    for (const [left, right] of [[0, 62], [62, 0]]) {
      await browser.execute(({ left, right }) => {
        document.documentElement.style.setProperty('--app-safe-area-left', `${left}px`);
        document.documentElement.style.setProperty('--app-safe-area-right', `${right}px`);
      }, { left, right });
      for (const route of ['Settings', 'List', 'Map', 'Gneauxght'] as const) {
        await navigateAppTab(route);
        const path = { Settings: '/settings', List: '/list', Map: '/map', Gneauxght: '/' }[route];
        await browser.waitUntil(async () => new URL(await browser.getUrl()).pathname === path);
        await browser.waitUntil(async () => await $('button[aria-label="Switch tab"]').getText() === route);
        const bounds = await browser.execute(() => {
          const shell = document.querySelector('.app-shell')!;
          const style = getComputedStyle(shell);
          const rect = shell.getBoundingClientRect();
          return { left: rect.left + parseFloat(style.paddingLeft), right: rect.right - parseFloat(style.paddingRight) };
        });
        expect(bounds.left).toBeGreaterThanOrEqual(left);
        expect(bounds.right).toBeLessThanOrEqual(874 - right);
        const content = await browser.execute(() => {
          const element = document.querySelector('.notepad-workspace-card') ?? document.querySelector('main');
          const rect = element!.getBoundingClientRect();
          return { left: rect.left, right: rect.right };
        });
        expect(content.left).toBeGreaterThanOrEqual(left);
        expect(content.right).toBeLessThanOrEqual(874 - right);
      }
    }
  });

  it('keeps image viewer controls clear of landscape cutouts', async () => {
    await browser.execute(() => {
      document.documentElement.style.setProperty('--app-safe-area-left', '62px');
      document.documentElement.style.setProperty('--app-safe-area-right', '62px');
      window.__GNEAUXGHTS_E2E__!.seedImageAsset('landscape.png');
      const content = document.querySelector<HTMLElement>('.cm-content')!;
      content.focus();
      document.execCommand('selectAll');
      const data = new DataTransfer();
      data.setData('text/plain', '![[landscape.png|200]]');
      content.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    });
    await $('.gn-image-embed button[aria-label="Zoom image"]').click();
    await $('dialog.gn-image-viewer').waitForDisplayed();
    const controls = await browser.execute(() => Array.from(document.querySelectorAll('.gn-image-viewer button')).map(button => {
      const rect = button.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
    }));
    for (const rect of controls) {
      expect(rect.left).toBeGreaterThanOrEqual(62);
      expect(rect.right).toBeLessThanOrEqual(812);
      expect(rect.top).toBeGreaterThanOrEqual(0);
      expect(rect.bottom).toBeLessThanOrEqual(402);
    }
    await $('button[aria-label="Close image viewer"]').click();
    await clickPaneAction('Open thought partner');
    await $('textarea[aria-label="Message"]').waitForEnabled();
  });

  it('keeps navigation, editor controls and the composer inside the landscape keyboard viewport', async () => {
    await browser.execute(() => {
      (window as typeof window & { __originalVisualViewport?: VisualViewport | null }).__originalVisualViewport = window.visualViewport;
      const viewport = Object.assign(new EventTarget(), { width: 874, height: 126, offsetTop: 0, scale: 1 });
      Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
      window.dispatchEvent(new Event('resize'));
    });
    await browser.waitUntil(async () => await $('.app-shell').getAttribute('data-keyboard-open') === 'true');
    await browser.waitUntil(async () => await browser.execute(() => document.querySelector('.notepad-editor-shell')?.getAttribute('style')?.includes('--editor-overlay-inset')));
    // CodeMirror measures after the viewport CSS and dock observers settle.
    await browser.waitUntil(() => browser.execute(() => {
      const line = document.querySelector('.cm-line')!.getBoundingClientRect();
      const nav = document.querySelector('.app-navigation-header')!.getBoundingClientRect();
      const dock = document.querySelector('[data-notepad-command-bar]')!.getBoundingClientRect();
      return line.top >= nav.bottom && line.bottom <= dock.top;
    }), { timeoutMsg: 'Editor line did not settle inside the keyboard viewport' });
    const layout = await browser.execute(() => {
      const nav = document.querySelector('.app-navigation-header')!.getBoundingClientRect();
      const dock = document.querySelector('[data-notepad-command-bar]')!.getBoundingClientRect();
      const line = document.querySelector('.cm-line')!.getBoundingClientRect();
      return { navBottom: nav.bottom, dockTop: dock.top, dockBottom: dock.bottom, lineTop: line.top, lineBottom: line.bottom };
    });
    expect(layout.dockBottom).toBeLessThanOrEqual(127);
    expect(layout.navBottom).toBeLessThanOrEqual(layout.dockTop);
    expect(layout.lineTop).toBeGreaterThanOrEqual(layout.navBottom);
    expect(layout.lineBottom).toBeLessThanOrEqual(layout.dockTop);
    await browser.execute(() => {
      const bridge = (window as typeof window & { __GNEAUXGHTS_NATIVE_E2E__: { readEditorState(): { editor: { markdown: string } }; setEditorSelection(anchor: number, head: number): void } }).__GNEAUXGHTS_NATIVE_E2E__;
      const end = bridge.readEditorState().editor.markdown.length;
      bridge.setEditorSelection(end, end);
    });
    await browser.keys('x');
    await browser.waitUntil(async () => await browser.execute(() => {
      const cursor = document.querySelector('.cm-cursor-primary')!.getBoundingClientRect();
      const dock = document.querySelector('[data-notepad-command-bar]')!.getBoundingClientRect();
      return cursor.top >= 44 && cursor.bottom <= dock.top;
    }), { timeoutMsg: 'Typing at the end of a note should stay above the keyboard dock' });
    await browser.execute(() => {
      Object.assign(window.visualViewport!, { height: 402 });
      window.dispatchEvent(new Event('resize'));
    });
    await browser.waitUntil(async () => await $('.app-shell').getAttribute('data-keyboard-open') === 'false');
    await browser.execute(() => {
      Object.assign(window.visualViewport!, { height: 126 });
      window.dispatchEvent(new Event('resize'));
    });
    await browser.waitUntil(async () => await browser.execute(() => {
      const cursor = document.querySelector('.cm-cursor-primary')!.getBoundingClientRect();
      const dock = document.querySelector('[data-notepad-command-bar]')!.getBoundingClientRect();
      return cursor.top >= 44 && cursor.bottom <= dock.top;
    }), { timeoutMsg: 'Keyboard reopening should keep the existing caret visible' });
    await clickPaneAction('Open thought partner');
    await $('textarea[aria-label="Message"]').waitForDisplayed();
    const composer = await browser.execute(() => {
      const input = document.querySelector('textarea[aria-label="Message"]')!.getBoundingClientRect();
      const nav = document.querySelector('.app-navigation-header')!.getBoundingClientRect();
      return { top: input.top, bottom: input.bottom, navBottom: nav.bottom };
    });
    expect(composer.top).toBeGreaterThanOrEqual(composer.navBottom);
    expect(composer.bottom).toBeLessThanOrEqual(127);

  });
});
