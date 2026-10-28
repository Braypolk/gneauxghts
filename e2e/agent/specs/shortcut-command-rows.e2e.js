import { browser, $, $$, expect } from '@wdio/globals';

// Recorded through the WDIO session loop and reduced to the independent workflow.
describe('one row per keyboard command', () => {
  it('groups alternatives while preserving editing, removal, reset and search', async () => {
    await browser.setWindowSize(1440, 1000);
    await browser.url('/__gneauxghts_e2e_reset');
    await browser.execute(() => { localStorage.clear(); sessionStorage.clear(); });
    await browser.url('/settings');
    await $('button=Keyboard shortcuts').click();
    const ids = await browser.execute(() => Array.from(document.querySelectorAll('tr[data-shortcut-id]'), row => row.dataset.shortcutId));
    expect(ids.length).toBeGreaterThan(60);
    expect(new Set(ids).size).toBe(ids.length);
    await $('input[aria-label="Filter shortcuts"]').setValue('Show Split Options');
    await expect($$('tr[data-shortcut-id="showSplitOptions"]')).toBeElementsArrayOfSize(1);
    await expect($$('tr[data-shortcut-id="showSplitOptions"] .binding-button')).toBeElementsArrayOfSize(2);
    await expect($('tr[data-shortcut-id="showSplitOptions"]')).toHaveText(expect.stringContaining('Default'));
    await $('button[aria-label="Change Show Split Options shortcut, Cmd + Shift"]').click();
    await browser.execute(() => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Shift', code: 'ShiftLeft', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true
    })));
    await $('button=Save').click();
    await expect($('button[aria-label="Change Show Split Options shortcut, Ctrl + Shift"]')).toBeDisplayed();
    await expect($$('tr[data-shortcut-id="showSplitOptions"]')).toBeElementsArrayOfSize(1);
    await expect($('tr[data-shortcut-id="showSplitOptions"]')).toHaveText(expect.stringContaining('User'));
    await $('button[aria-label="Remove Option from Show Split Options"]').click();
    await expect($$('tr[data-shortcut-id="showSplitOptions"] .binding-button')).toBeElementsArrayOfSize(1);
    await expect($('button[aria-label="Change Show Split Options shortcut, Ctrl + Shift"]')).toBeDisplayed();
    await $('button[aria-label="Remove Ctrl + Shift from Show Split Options"]').click();
    await expect($$('tr[data-shortcut-id="showSplitOptions"]')).toBeElementsArrayOfSize(1);
    await expect($('button[aria-label="Assign keybinding for Show Split Options"]')).toHaveText('Unassigned');
    await $('button[aria-label="Add keybinding for Show Split Options"]').click();
    await browser.execute(() => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Alt', code: 'AltLeft', altKey: true, bubbles: true, cancelable: true
    })));
    await $('button=Save').click();
    await expect($('button[aria-label="Change Show Split Options shortcut, Option"]')).toBeDisplayed();
    await expect($$('tr[data-shortcut-id="showSplitOptions"]')).toBeElementsArrayOfSize(1);
    await $('button[aria-label="Reset Show Split Options to default"]').click();
    await expect($$('tr[data-shortcut-id="showSplitOptions"] .binding-button')).toBeElementsArrayOfSize(2);
    await expect($('tr[data-shortcut-id="showSplitOptions"]')).toHaveText(expect.stringContaining('Default'));
    await $('input[aria-label="Filter shortcuts"]').setValue('cmd shift');
    await expect($$('tr[data-shortcut-id="showSplitOptions"]')).toBeElementsArrayOfSize(1);
    await expect($('button[aria-label="Change Show Split Options shortcut, Option"]')).toBeDisplayed();
    await expect($$('tr[data-shortcut-id="searchOpenInSplit"]')).toBeElementsArrayOfSize(1);
    await expect($('button[aria-label="Change Open Result in Split shortcut, Option + Enter"]')).toBeDisplayed();
    await $('input[aria-label="Filter shortcuts"]').setValue('Show Split Options');
  });
});
