import { browser, expect, $ } from '@wdio/globals';
import { resetBrowserWorkspace } from '../../support/browserWorkspace';

describe('pinned notes and search shortcuts', () => {
  beforeEach(resetBrowserWorkspace);

  it('pins notes above recents and switches search scope with keyboard shortcuts', async () => {
    const pinCurrent = await $('button[aria-label="Pin note"]');
    await pinCurrent.waitForClickable();
    const titleGeometry = await browser.execute(() => {
      const pin = document.querySelector<HTMLElement>('button[aria-label="Pin note"]')!;
      const field = document.querySelector<HTMLElement>('[data-testid="note-title"]')!;
      const text = document.querySelector<HTMLElement>('[data-testid="note-title-measure"]')!;
      const pinRect = pin.getBoundingClientRect();
      const fieldRect = field.getBoundingClientRect();
      const textRect = text.getBoundingClientRect();
      return {
        pinRight: pinRect.right,
        fieldLeft: fieldRect.left,
        fieldWidth: fieldRect.width,
        textLeft: textRect.left,
        textWidth: textRect.width
      };
    });
    expect(titleGeometry.pinRight).toBeLessThanOrEqual(titleGeometry.textLeft);
    expect(titleGeometry.textLeft - titleGeometry.pinRight).toBeLessThan(12);
    expect(Math.abs(titleGeometry.fieldWidth - titleGeometry.textWidth)).toBeLessThan(4);
    await browser.execute(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'p',
          code: 'KeyP',
          metaKey: true,
          bubbles: true,
          cancelable: true
        })
      );
    });
    await $('button[aria-label="Unpin note"]').waitForExist();

    const search = await $('[data-testid="note-search-input"]');
    await search.click();
    await $('button[aria-label="Open pinned note: Alpha note.md"]').waitForExist();
    expect(await $('//*[normalize-space()="Pinned"]')).toExist();
    expect(await $('//*[normalize-space()="Recent Tasks"]')).not.toExist();

    const currentScope = await $('button[aria-label="Search this note only"]');
    await browser.execute(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', metaKey: true, shiftKey: true, cancelable: true }));
    });
    await expect($('button[aria-label="Search all notes"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(search).toBeFocused();

    await browser.execute(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', metaKey: true, cancelable: true }));
    });
    await expect(currentScope).toHaveAttribute('aria-pressed', 'true');
    await expect(search).toBeFocused();
  });
});
