import { browser, $, expect } from '@wdio/globals';

// Exported from the WDIO session loop and isolated for fresh replay.
describe('Related Select All', () => {
  it('ignores Select All throughout Related and restores normal editing after dismissal', async () => {
    await browser.url('/__gneauxghts_e2e_reset');
    await browser.execute(() => { localStorage.clear(); sessionStorage.clear(); });
    await browser.url('/');
    await expect($('[data-testid="note-title"]')).toHaveValue('Alpha note');
    const primary = await browser.execute(() => /Mac|iPhone|iPad|iPod/.test(navigator.platform) ? 'Meta' : 'Control');
    const popup = $('[role="dialog"][aria-label="Related notes"]');
    await $('button[aria-label="Related notes"]').click();
    await expect($('button[aria-label="Related to Alpha note"]')).toBeFocused();
    await expect($('button[aria-label="Open related note: Beta note"]')).toBeDisplayed();
    await browser.execute(() => getSelection().removeAllRanges());

    for (const selector of [
      'button[aria-label="Related to Alpha note"]',
      'button[aria-label="Open related note: Beta note"]',
      'button[aria-label="Open Beta note in split pane"]',
      '[role="dialog"] .search-results-heading button',
      'button[aria-label="Search notes"]'
    ]) {
      const control = $(selector);
      await control.execute(element => element.focus());
      await expect(popup).toBeDisplayed();
      await browser.keys([primary, 'a', '\uE000']);
      expect(await browser.execute(() => getSelection().toString())).toBe('');
      await expect(control).toBeFocused();
      // Assert both bindings are consumed regardless of the host's native shortcut.
      for (const modifier of ['metaKey', 'ctrlKey']) {
        expect(await browser.execute(modifier => {
          const event = new KeyboardEvent('keydown', {
            key: 'a', code: 'KeyA', [modifier]: true, bubbles: true, cancelable: true
          });
          document.activeElement.dispatchEvent(event);
          return event.defaultPrevented;
        }, modifier)).toBe(true);
      }
    }

    // Doing nothing also preserves an existing selection.
    await browser.execute(() => {
      const range = document.createRange();
      range.selectNodeContents(document.querySelector('.related-results .search-result-item'));
      getSelection().addRange(range);
    });
    const selected = await browser.execute(() => getSelection().toString());
    expect(selected.length).toBeGreaterThan(0);
    await browser.keys([primary, 'a', '\uE000']);
    expect(await browser.execute(() => getSelection().toString())).toBe(selected);

    await browser.keys('Escape');
    await expect(popup).not.toExist();
    await $('.cm-content').click();
    await browser.keys([primary, 'a', '\uE000']);
    expect(await browser.execute(() => getSelection().toString())).toContain('Alpha line 1');
    await expect($('[data-testid="note-title"]')).toHaveValue('Alpha note');
  });
});
