import { browser, expect, $ } from '@wdio/globals';
import { navigateAppTab } from '../../support/appNavigation';
import { resetBrowserWorkspace, openHistoryShortcut } from '../../support/browserWorkspace';
import { waitForWorkspaceAnimationSettled } from '../../support/workspaceAnimation';

async function viewport(width: number) {
  await browser.sendCommand('Emulation.setDeviceMetricsOverride', { width, height: 950, deviceScaleFactor: 1, mobile: false });
  await browser.executeAsync(done => requestAnimationFrame(() => requestAnimationFrame(() => done())));
}

async function dimensions(selector: string) {
  return browser.execute(selector => {
    const { width, height } = document.querySelector(selector)!.getBoundingClientRect();
    return { width, height };
  }, selector);
}

describe('mobile control sizing', () => {
  beforeEach(async () => {
    await browser.sendCommand('Emulation.clearDeviceMetricsOverride', {});
    await resetBrowserWorkspace();
  });
  afterEach(async () => { await browser.sendCommand('Emulation.clearDeviceMetricsOverride', {}); });

  it('preserves editor and Related icon proportions while retaining explicit touch targets', async () => {
    await viewport(1280);
    await $('button[aria-label="Expand related notes"]').click();
    const close = 'button[aria-label="Close related panel"]';
    await $(close).waitForDisplayed();
    const desktop = await dimensions(close);
    for (const width of [639, 390, 320, 640, 1280]) {
      await viewport(width);
      await waitForWorkspaceAnimationSettled();
      expect(await dimensions(close)).toEqual(desktop);
    }
    await $(close).click();
    await viewport(390);
    await browser.execute(() => {
      const line = document.querySelector('[data-testid="note-editor"] .cm-line')!;
      const rect = line.getBoundingClientRect();
      line.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: rect.left + 60, clientY: rect.top + 8 }));
    });
    await $('.notepad-block-handle[data-show="true"]').waitForExist();
    const move = await dimensions('button[aria-label="Move block"]');
    expect(move.width).toBe(move.height);

    const primary = await dimensions('.notepad-command-action.mobile-touch-target');
    expect(primary.width).toBeGreaterThanOrEqual(44);
    expect(primary.height).toBeGreaterThanOrEqual(44);
    await $('[data-testid="note-search-input"]').setValue('Alpha');
    await $('button[aria-label="Clear search"]').waitForDisplayed();
    expect(await dimensions('button[aria-label="Clear search"]')).toEqual({ width: 40, height: 40 });
    await $('button[aria-label="Clear search"]').click();
    await expect($('[data-testid="note-search-input"]')).toHaveValue('');
  });

  it('preserves settings icons and keeps the API key toggle inside its field', async () => {
    await browser.execute(() => window.__GNEAUXGHTS_E2E__!.seedChatControls());
    await navigateAppTab('Settings');
    await $('[data-settings-section="ai"]').click();
    const toggle = 'button[aria-label="Show API key"]';
    await $(toggle).waitForExist();
    const provider = await $('[data-settings-anchor="chat-provider"] select');
    await provider.selectByAttribute('value', 'local');
    const selectors = [toggle, 'button[aria-label="Refresh server models"]', 'button[aria-label="Add a model manually"]'];
    await $(selectors[1]).waitForExist();
    await viewport(1280);
    const desktop = await Promise.all(selectors.map(dimensions));
    for (const width of [639, 390, 320, 640, 1280]) {
      await viewport(width);
      expect(await Promise.all(selectors.map(dimensions))).toEqual(desktop);
      expect(await browser.execute(() => {
        const field = document.querySelector('#provider-api-key')!.getBoundingClientRect();
        const toggle = document.querySelector('button[aria-label="Show API key"]')!.getBoundingClientRect();
        return toggle.left >= field.left && toggle.right <= field.right && toggle.top >= field.top && toggle.bottom <= field.bottom;
      })).toBe(true);
    }
    await viewport(390);
    await $(toggle).scrollIntoView();
    await $(toggle).click();
    await expect($('#provider-api-key')).toHaveAttribute('type', 'text');
  });

  it('keeps search scope and match icons round at smaller widths', async () => {
    for (const width of [639, 390, 320, 640, 868]) {
      await viewport(width);
      await waitForWorkspaceAnimationSettled();
      await $('[data-testid="note-search-input"]').click();
      for (const activeScope of ['Search all notes', 'Search this note only']) {
        await $(`button[aria-label="${activeScope}"]`).click();
        await waitForWorkspaceAnimationSettled();
        for (const label of ['Search all notes', 'Search this note only', 'Enable match case', 'Enable match whole word']) {
          const size = await dimensions(`button[aria-label="${label}"]`);
          expect(size.width).toBe(size.height);
          expect(size.height).toBe(width < 640 ? 40 : 32);
        }
      }
    }
  });

  it('preserves the History rename icon across the mobile breakpoint', async () => {
    await viewport(1280);
    await openHistoryShortcut();
    const rename = 'button[aria-label="Rename revision"]';
    await $(rename).waitForExist();
    const desktop = await dimensions(rename);
    for (const width of [639, 390, 320, 640, 1280]) {
      await viewport(width);
      expect(await dimensions(rename)).toEqual(desktop);
    }
  });
});
