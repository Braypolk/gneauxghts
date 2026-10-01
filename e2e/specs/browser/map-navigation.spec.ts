import { browser, expect, $ } from '@wdio/globals';

async function mapPoints() {
  return browser.execute(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('.atlas-surface canvas')!;
    const rect = canvas.getBoundingClientRect();
    // The two fixture nodes are at (-200, 0) and (200, 0), with a fitted view.
    const scale = Math.min(2 ** 0.05, rect.width / 620, rect.height / 220);
    const centerX = rect.left + rect.width / 2;
    const y = Math.round(rect.top + rect.height / 2);
    return {
      alpha: { x: Math.round(centerX - 200 * scale), y },
      beta: { x: Math.round(centerX + 200 * scale), y },
      empty: { x: Math.round(centerX), y: y - 100 }
    };
  });
}

async function clickPoint(point: { x: number; y: number }, count = 1) {
  const actions: Array<Record<string, unknown>> = [
    { type: 'pointerMove', duration: 0, origin: 'viewport', ...point }
  ];
  for (let index = 0; index < count; index++) {
    actions.push({ type: 'pointerDown', button: 0 }, { type: 'pointerUp', button: 0 });
    if (index + 1 < count) actions.push({ type: 'pause', duration: 50 });
  }
  await browser.performActions([{ type: 'pointer', id: 'map-pointer', parameters: { pointerType: 'mouse' }, actions }]);
  await browser.releaseActions();
}

describe('map note navigation', () => {
  beforeEach(async () => {
    await browser.setWindowSize(1440, 1000);
    await browser.url('/map');
    await $('.atlas-surface canvas').waitForDisplayed({ timeout: 30_000 });
    await browser.waitUntil(async () => browser.execute(() =>
      document.querySelector('.atlas-surface canvas')?.parentElement?.classList.contains('opacity-100')
    ));
  });

  it('opens the double-clicked note when another note is selected', async () => {
    const points = await mapPoints();
    await clickPoint(points.alpha);
    await $('[aria-label="Selected note: Alpha note"]').waitForDisplayed();
    await clickPoint(points.beta, 2);
    await $('[data-testid="note-title"]').waitForDisplayed();
    await expect($('[data-testid="note-title"]')).toHaveValue('Beta note');
  });

  it('does not open the selected note when empty map space is double-clicked', async () => {
    const points = await mapPoints();
    await clickPoint(points.alpha);
    await $('[aria-label="Selected note: Alpha note"]').waitForDisplayed();
    await clickPoint(points.empty, 2);
    await expect(browser).toHaveUrl(expect.stringContaining('/map'));
    await expect($('.atlas-surface canvas')).toBeDisplayed();
  });

  it('still opens the selected note with Enter', async () => {
    const points = await mapPoints();
    await clickPoint(points.beta);
    await $('[aria-label="Selected note: Beta note"]').waitForDisplayed();
    await browser.keys('Enter');
    await $('[data-testid="note-title"]').waitForDisplayed();
    await expect($('[data-testid="note-title"]')).toHaveValue('Beta note');
  });
});
