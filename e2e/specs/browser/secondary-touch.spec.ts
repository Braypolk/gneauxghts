import { browser, expect, $ } from '@wdio/globals';
import { resetBrowserWorkspace, openHistoryShortcut } from '../../support/browserWorkspace';
import { clickPaneAction, navigateAppTab } from '../../support/appNavigation';

type EditorWindow = typeof window & { __GNEAUXGHTS_NATIVE_E2E__: {
  readEditorState(): { editor: { markdown: string } };
  setEditorSelection(anchor: number, head: number): void;
} };
type Point = { x: number; y: number; id?: number };
async function viewport(width = 402, height = 874) {
  await browser.sendCommand('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true });
  await browser.sendCommand('Emulation.setTouchEmulationEnabled', { enabled: true });
}
async function insert(markdown: string) {
  await browser.execute(text => {
    const content = document.querySelector<HTMLElement>('.cm-content')!;
    content.focus(); document.execCommand('selectAll');
    const clipboardData = new DataTransfer(); clipboardData.setData('text/plain', text);
    content.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData }));
    (window as EditorWindow).__GNEAUXGHTS_NATIVE_E2E__.setEditorSelection(0, 0);
  }, markdown);
}
async function authoredText() {
  return browser.execute(() => (window as EditorWindow).__GNEAUXGHTS_NATIVE_E2E__.readEditorState().editor.markdown);
}
async function targetSize(selector: string, minimum = 44, painted = true) {
  // Sample the first control, matching the geometry query below (e.g. calendar days).
  await browser.$$(selector)[0].waitForExist();
  if (painted) await browser.$$(selector)[0].waitForDisplayed();
  const size = await browser.execute(selector => {
    const box = document.querySelector(selector)!.getBoundingClientRect();
    return { width: box.width, height: box.height };
  }, selector);
  expect(size.width).toBeGreaterThanOrEqual(minimum);
  expect(size.height).toBeGreaterThanOrEqual(minimum);
}
async function touch(type: string, points: Point[]) {
  await browser.sendCommand('Input.dispatchTouchEvent', { type, touchPoints: points });
}
async function swipe(from: Point, to: Point, cancel = false) {
  await touch('touchStart', [from]);
  for (let i = 1; i <= 4; i++) await touch('touchMove', [{ x: from.x + (to.x - from.x) * i / 4, y: from.y + (to.y - from.y) * i / 4 }]);
  await touch(cancel ? 'touchCancel' : 'touchEnd', []);
}
async function stageCenter() {
  return browser.execute(() => {
    const box = document.querySelector('.gn-image-viewer .stage')!.getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  });
}
async function transform() {
  return browser.execute(() => {
    const matrix = new DOMMatrix(getComputedStyle(document.querySelector('.gn-image-viewer img')!).transform);
    return { scale: matrix.a, x: matrix.e, y: matrix.f };
  });
}

describe('secondary touch controls and image gestures', () => {
  beforeEach(async () => {
    await resetBrowserWorkspace();
    await viewport();
  });
  afterEach(async () => {
    await browser.sendCommand('Emulation.setTouchEmulationEnabled', { enabled: false });
    await browser.sendCommand('Emulation.clearDeviceMetricsOverride', {});
  });

  it('discovers inline due dates without hover and uses the picker in portrait and landscape', async () => {
    await insert('- [ ] Ship it\nOther notes');
    for (const [width, height] of [[402, 874], [874, 402]]) {
      await viewport(width, height);
      const add = await $('button[aria-label="Add due date"]');
      await add.waitForExist();
      expect(await add.getCSSProperty('opacity')).toMatchObject({ value: 1 });
      await targetSize('button[aria-label="Add due date"]');
      await add.click();
      await $('dialog.date-time-picker').waitForDisplayed();
      await targetSize('[data-testid="date-picker-next-month"]');
      await targetSize('dialog.date-time-picker [data-bits-day]:not([data-outside-month])');
      await $('input[aria-label="Date or shortcut"]').setValue('2099-01-01');
      const apply = await $('dialog.date-time-picker button[type="submit"]');
      await apply.scrollIntoView(); await apply.click();
      await $('dialog.date-time-picker').waitForExist({ reverse: true });
      expect(await authoredText()).toContain('@due(2099-01-01)');
      await insert('- [ ] Ship it\nOther notes');
    }
  });

  it('keeps Related, History and Settings secondary targets usable with unchanged icon sizes', async () => {
    await $('button[aria-label="Related notes"]').click();
    await targetSize('button[aria-label="Search notes"]');
    await $('button[aria-label="Search notes"]').click();
    await openHistoryShortcut();
    await targetSize('button[aria-label="Rename revision"]');
    expect((await browser.$$('button[aria-label="Rename revision"] svg')[0].getSize()).width).toBe(12);
    await browser.keys('Escape');
    await navigateAppTab('Settings');
    await $('[data-settings-section="ai"]').click();
    await $('[data-settings-anchor="chat-provider"] select').selectByAttribute('value', 'local');
    for (const [width, height] of [[402, 874], [874, 402]]) {
      await viewport(width, height);
      for (const label of ['Show API key', 'Refresh server models', 'Add a model manually']) {
        await $(`button[aria-label="${label}"]`).scrollIntoView();
        await targetSize(`button[aria-label="${label}"]`);
        expect((await $(`button[aria-label="${label}"] svg`).getSize()).width).toBe(16);
      }
      expect(await browser.execute(() => {
        const field = document.querySelector('#provider-api-key')!.getBoundingClientRect();
        const toggle = document.querySelector('button[aria-label="Show API key"]')!.getBoundingClientRect();
        return toggle.top >= field.top && toggle.bottom <= field.bottom && toggle.right <= field.right;
      })).toBe(true);
    }
    await $('button[aria-label="Show API key"]').scrollIntoView();
    const point = await browser.execute(() => {
      const rect = document.querySelector('button[aria-label="Show API key"]')!.getBoundingClientRect();
      return { x: rect.left + 4, y: rect.bottom - 4 };
    });
    await touch('touchStart', [point]); await touch('touchEnd', []);
    await expect($('#provider-api-key')).toHaveAttribute('type', 'text');
  });

  it('pinches, pans, swipes only at fit, cancels safely and closes without changing the note', async () => {
    const markdown = '![[first.png|200]]\n\n![[second.png|200]]';
    await browser.execute(() => { window.__GNEAUXGHTS_E2E__!.seedImageAsset('first.png'); window.__GNEAUXGHTS_E2E__!.seedImageAsset('second.png'); });
    await insert(markdown);
    await browser.execute(() => { document.querySelector<HTMLElement>('.cm-content')!.blur(); document.querySelector('.cm-scroller')!.scrollTop = 0; });
    await browser.$$('.gn-image-embed img')[0].click();
    await browser.$$('.gn-image-embed button[aria-label="Zoom image"]')[0].click();
    await $('.gn-image-viewer img').waitForDisplayed();
    const point = await stageCenter();
    const fit = (await transform()).scale;
    await touch('touchStart', [point]); await touch('touchEnd', []);
    await expect($('.gn-image-viewer')).toExist();
    await touch('touchStart', [{ x: point.x - 40, y: point.y, id: 1 }, { x: point.x + 40, y: point.y, id: 2 }]);
    await touch('touchMove', [{ x: point.x - 110, y: point.y, id: 1 }, { x: point.x + 110, y: point.y, id: 2 }]);
    await touch('touchEnd', []);
    expect((await transform()).scale).toBeGreaterThan(fit * 2);
    await swipe(point, { x: point.x - 100, y: point.y });
    expect((await transform()).x).toBeLessThan(-50);
    await expect($('.gn-image-viewer header')).toHaveText(expect.stringContaining('first.png'));
    await $('button[aria-label="Fit image"]').click();
    await swipe({ x: point.x + 70, y: point.y }, { x: point.x - 70, y: point.y }, true);
    await expect($('.gn-image-viewer header')).toHaveText(expect.stringContaining('first.png'));
    await swipe({ x: point.x + 70, y: point.y }, { x: point.x - 70, y: point.y });
    await expect($('.gn-image-viewer header')).toHaveText(expect.stringContaining('second.png'));
    await $('.gn-image-viewer img').waitForDisplayed();
    await swipe({ x: point.x + 70, y: point.y }, { x: point.x - 70, y: point.y });
    await expect($('.gn-image-viewer header')).toHaveText(expect.stringContaining('2 / 2'));
    await swipe({ x: point.x - 70, y: point.y }, { x: point.x + 70, y: point.y });
    await expect($('.gn-image-viewer header')).toHaveText(expect.stringContaining('first.png'));
    await viewport(874, 402);
    for (const selector of ['button[aria-label="Close image viewer"]', 'button[aria-label="Next image"]']) await targetSize(selector);
    await $('button[aria-label="Close image viewer"]').click();
    await expect($('.gn-image-viewer')).not.toExist();
    await browser.$$('.gn-image-embed button[aria-label="Zoom image"]')[0].click();
    await $('.gn-image-viewer img').waitForDisplayed();
    const backdrop = await browser.execute(() => {
      const rect = document.querySelector('.gn-image-viewer .stage')!.getBoundingClientRect();
      return { x: rect.left + 8, y: rect.top + 8 };
    });
    await touch('touchStart', [backdrop]); await touch('touchEnd', []);
    await expect($('.gn-image-viewer')).not.toExist();
    expect(await authoredText()).toBe(markdown);
  });

  it('keeps inline image tools touch sized and allows the note to scroll over an image', async () => {
    await browser.execute(() => window.__GNEAUXGHTS_E2E__!.seedImageAsset('scroll.png'));
    const markdown = `![[scroll.png|200]]\n\n${'Scrolling text\n\n'.repeat(50)}`;
    await insert(markdown);
    await browser.execute(() => new Promise<void>((done) => {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        document.querySelector<HTMLElement>('.cm-content')!.blur();
        document.querySelector('.cm-scroller')!.scrollTop = 0;
        done();
      }));
    }));
    await browser.$$('.gn-image-embed img')[0].click();
    await targetSize('.gn-image-embed button[aria-label="Zoom image"]');
    await targetSize('.gn-image-embed button[aria-label="Increase image size"]');
    await targetSize('.gn-image-embed button[aria-label="Resize image se"]');
    const from = await browser.execute(() => {
      const rect = document.querySelector('.gn-image-embed img')!.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.bottom - 5 };
    });
    const before = await browser.execute(() => document.querySelector('.cm-scroller')!.scrollTop);
    await swipe(from, { x: from.x, y: from.y - 100 });
    await browser.waitUntil(() => browser.execute(before => document.querySelector('.cm-scroller')!.scrollTop > before, before));
    await expect($('.gn-image-viewer')).not.toExist();
    expect(await authoredText()).toBe(markdown);
  });
});
