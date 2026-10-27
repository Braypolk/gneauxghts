import { browser, $, expect } from '@wdio/globals';

// Exported from modal-touch-fixes, then isolated for fresh fixture replay.
const dialogSelector = 'dialog[aria-labelledby="local-model-editor-title"]';
const dialog = () => $(dialogSelector);
const configure = () => $('button[aria-label="Configure fixture-local"]');
const capability = name => $(`button[aria-label="${name} capability"]`);
const mapButton = label => $(`button[aria-label="${label}"]`);

async function touchViewport(width, height = 844) {
  await browser.sendCommand('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: 1, mobile: true
  });
  await browser.sendCommand('Emulation.setTouchEmulationEnabled', { enabled: true });
  await browser.waitUntil(() => browser.execute(
    expectedWidth => innerWidth === expectedWidth && matchMedia('(any-pointer: coarse)').matches,
    width
  ));
}

async function openModelSettings() {
  await browser.url('/settings');
  await $('[data-settings-section="ai"]').click();
  await $('[data-settings-anchor="chat-provider"] select').selectByAttribute('value', 'local');
  await configure().scrollIntoView();
}

async function openEditor() {
  await configure().click();
  await dialog().waitForDisplayed();
  await dialog().$('button=Save changes').waitForEnabled();
}

async function expectFocusInside() {
  expect(await browser.execute(
    selector => document.querySelector(selector)?.contains(document.activeElement), dialogSelector
  )).toBe(true);
}

async function expectTouchTarget(control) {
  const size = await control.getSize();
  expect(size.width).toBeGreaterThanOrEqual(44);
  expect(size.height).toBeGreaterThanOrEqual(44);
}

describe('Model dialog focus and secondary touch controls', () => {
  beforeEach(async () => {
    await browser.sendCommand('Emulation.clearDeviceMetricsOverride', {});
    await browser.sendCommand('Emulation.setTouchEmulationEnabled', { enabled: false });
    await browser.setWindowSize(1440, 1000);
    await browser.url('/__gneauxghts_e2e_reset');
    await browser.execute(() => { localStorage.clear(); sessionStorage.clear(); });
    await browser.url('/settings');
  });

  it('contains focus and restores Configure after every dismissal path', async () => {
    await touchViewport(390);
    await openModelSettings();
    for (const method of ['Escape', 'Cancel', 'close', 'backdrop', 'save']) {
      await openEditor();
      expect(await browser.execute(selector => document.querySelector(selector).matches(':modal'), dialogSelector)).toBe(true);
      await expect(dialog().$('button[aria-label="Close model editor"]')).toBeFocused();
      await browser.keys(['Shift', 'Tab']);
      await expect(dialog().$('button=Save changes')).toBeFocused();
      for (let index = 0; index < 9; index++) {
        await browser.keys('Tab');
        await expectFocusInside();
      }
      await browser.execute(() => document.querySelector('input[aria-label="Search settings"]').focus());
      await expectFocusInside();
      if (method === 'Escape') await browser.keys('Escape');
      else if (method === 'close') await dialog().$('button[aria-label="Close model editor"]').click();
      else if (method === 'backdrop') await browser.action('pointer').move({ x: 8, y: 8 }).down().up().perform();
      else await dialog().$(`button=${method === 'save' ? 'Save changes' : 'Cancel'}`).click();
      await dialog().waitForExist({ reverse: true });
      await expect(configure()).toBeFocused();
    }
    expect(await browser.execute(() => window.__GNEAUXGHTS_E2E__.invocations.filter(
      call => call.command === 'chat_set_local_model_capabilities'
    ).length)).toBe(1);
  });

  // Reproduced in remaining-review with the newer WebKit API unavailable.
  it('wraps keyboard focus without Element.checkVisibility', async () => {
    await openModelSettings();
    await openEditor();
    await browser.execute(() => {
      Object.defineProperty(Element.prototype, 'checkVisibility', { value: undefined, configurable: true });
      window.__modelEditorErrors = [];
      window.addEventListener('error', event => window.__modelEditorErrors.push(event.message));
    });
    await browser.keys(['Shift', 'Tab']);
    await expect(dialog().$('button=Save changes')).toBeFocused();
    await browser.keys('Tab');
    await expect(dialog().$('button[aria-label="Close model editor"]')).toBeFocused();
    expect(await browser.execute(() => window.__modelEditorErrors)).toEqual([]);
    await browser.keys('Escape');
    await expect(configure()).toBeFocused();
  });

  for (const width of [390, 320]) {
    it(`expands model controls and switch hit areas at ${width}px`, async () => {
      await touchViewport(width);
      await openModelSettings();
      await expectTouchTarget(configure());
      await openEditor();
      for (const name of ['Tools', 'Vision', 'Audio', 'Video']) {
        const control = capability(name);
        await expectTouchTarget(control);
        expect(await control.$('span[aria-hidden="true"]').getSize('height')).toBe(24);
        const before = await control.getAttribute('aria-checked');
        await control.scrollIntoView();
        // Activate above the visible 24px track, within the 44px button.
        await browser.action('pointer').move({ origin: control, x: 0, y: -18 }).down().up().perform();
        await expect(control).toHaveAttribute('aria-checked', before === 'true' ? 'false' : 'true');
        await browser.action('pointer').move({ origin: control, x: 0, y: -18 }).down().up().perform();
        await expect(control).toHaveAttribute('aria-checked', before);
      }
      for (const label of ['Cancel', 'Save changes']) await expectTouchTarget(dialog().$(`button=${label}`));
      await expectTouchTarget(dialog().$('button[aria-label="Close model editor"]'));
      expect(await browser.execute(selector => {
        const card = document.querySelector(selector).firstElementChild;
        return card.scrollWidth <= card.clientWidth;
      }, dialogSelector)).toBe(true);
      await dialog().$('button=Cancel').click();
      await expect(configure()).toBeFocused();
    });

    it(`keeps Map arrows and Auto usable with 44px targets at ${width}px`, async () => {
      await touchViewport(width);
      await browser.url('/map');
      await mapButton('Fit map to view').click();
      await $('[data-node-id="note-beta"]').click();
      await $('.reader h2').waitForDisplayed();
      for (const label of ['Previous Atlas note', 'Next Atlas note', 'Use automatic connection strength']) {
        await expectTouchTarget(mapButton(label));
      }
      await $('#atlas-connection-strength').click();
      await mapButton('Use automatic connection strength').waitForEnabled();
      await mapButton('Use automatic connection strength').click();
      await expect(mapButton('Use automatic connection strength')).toBeDisabled();
      await $('input[aria-label="Search map notes"]').setValue('note');
      await expect($('.search-status')).toHaveText('2 matching nodes');
      const title = await $('.reader h2').getText();
      await mapButton('Next Atlas note').click();
      await browser.waitUntil(async () => await $('.reader h2').getText() !== title);
      await mapButton('Previous Atlas note').click();
      await expect($('.reader h2')).toHaveText(title);
    });
  }

  it('scrolls a short portrait dialog and saves its capabilities', async () => {
    await touchViewport(320, 560);
    await openModelSettings();
    await openEditor();
    await capability('Video').scrollIntoView();
    await capability('Video').click();
    await expect(capability('Video')).toHaveAttribute('aria-checked', 'true');
    await dialog().$('button=Save changes').scrollIntoView();
    await dialog().$('button=Save changes').click();
    await dialog().waitForExist({ reverse: true });
    await expect(configure()).toBeFocused();
    await openEditor();
    await expect(capability('Video')).toHaveAttribute('aria-checked', 'true');
    await browser.keys('Escape');
  });

  it('retains compact fine-pointer controls', async () => {
    expect(await browser.execute(() => matchMedia('(any-pointer: coarse)').matches)).toBe(false);
    await openModelSettings();
    expect(await configure().getSize()).toEqual({ width: 36, height: 36 });
    await openEditor();
    expect(await capability('Tools').getSize()).toEqual({ width: 44, height: 24 });
    expect(await dialog().$('button[aria-label="Close model editor"]').getSize()).toEqual({ width: 32, height: 32 });
    await browser.keys('Escape');
    await browser.url('/map');
    await mapButton('Fit map to view').click();
    await $('[data-node-id="note-beta"]').click();
    expect(await mapButton('Next Atlas note').getSize('height')).toBe(30);
  });
});
