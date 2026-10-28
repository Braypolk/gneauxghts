import { browser, $, $$, expect } from '@wdio/globals';

// Verified through the WDIO session loop, exported, then reduced for fresh replay.
describe('keyboard shortcut assignments', () => {
  it('records alternatives, preserves them after reload, and dispatches the saved split binding', async () => {
    await browser.setWindowSize(1440, 1000);
    await browser.url('/__gneauxghts_e2e_reset');
    await browser.execute(() => { localStorage.clear(); sessionStorage.clear(); });
    await browser.url('/settings');
    await $('button=Keyboard shortcuts').click();
    await expect($$('table[aria-label="Keyboard shortcuts"] th')).toHaveText(['Command', 'Keybinding', 'Source']);
    await $('input[aria-label="Filter shortcuts"]').setValue('Open Result in Split');
    await expect($$('tr[data-shortcut-id="searchOpenInSplit"]')).toBeElementsArrayOfSize(1);
    await expect($$('tr[data-shortcut-id="searchOpenInSplit"] .binding-button')).toBeElementsArrayOfSize(2);
    await expect($('button[aria-label="Change Open Result in Split shortcut, Option + Enter"]')).toBeDisplayed();
    await expect($('button[aria-label="Change Open Result in Split shortcut, Cmd + Shift + Enter"]')).toBeDisplayed();
    const record = async (key, modifiers = {}) => browser.execute((key, modifiers) => {
      document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {
        key, code: key === 'Enter' ? 'Enter' : `Key${key.toUpperCase()}`, bubbles: true, cancelable: true, ...modifiers
      }));
    }, key, modifiers);
    await $('tbody tr:first-child button[title="Add keybinding"]').click();
    await record('1', { metaKey: true });
    await expect(browser).toHaveUrl(expect.stringContaining('/settings'));
    await expect($('[data-testid="shortcut-recording"] span[aria-label]')).toHaveAttribute('aria-label', 'Cmd + 1');
    await record('Enter', { ctrlKey: true });
    await expect($('[data-testid="shortcut-recording"] span[aria-label]')).toHaveAttribute('aria-label', 'Ctrl + Enter');
    await record('Enter');
    await expect($$('[data-testid="shortcut-recording"]')).toBeElementsArrayOfSize(0);
    await expect($$('tr[data-shortcut-id="searchOpenInSplit"]')).toBeElementsArrayOfSize(1);
    await expect($$('tr[data-shortcut-id="searchOpenInSplit"] .binding-button')).toBeElementsArrayOfSize(3);
    await expect($('tbody tr:last-child')).toHaveText(expect.stringContaining('User'));
    await browser.refresh();
    await $('button=Keyboard shortcuts').click();
    await $('input[aria-label="Filter shortcuts"]').setValue('Open Result in Split');
    await expect($$('tr[data-shortcut-id="searchOpenInSplit"]')).toBeElementsArrayOfSize(1);
    await expect($$('tr[data-shortcut-id="searchOpenInSplit"] .binding-button')).toBeElementsArrayOfSize(3);
    await $('button[aria-label="Remove Option + Enter from Open Result in Split"]').click();
    await expect($$('tr[data-shortcut-id="searchOpenInSplit"]')).toBeElementsArrayOfSize(1);
    await expect($$('tr[data-shortcut-id="searchOpenInSplit"] .binding-button')).toBeElementsArrayOfSize(2);
    await $('button[aria-label="Change Open Result in Split shortcut, Ctrl + Enter"]').click();
    await record('Enter', { ctrlKey: true, shiftKey: true });
    await browser.keys('Escape');
    await expect($('button[aria-label="Change Open Result in Split shortcut, Ctrl + Enter"]')).toBeDisplayed();
    await $('button[aria-label="Change Open Result in Split shortcut, Ctrl + Enter"]').click();
    await record('Enter', { ctrlKey: true, shiftKey: true });
    await $('button=Save').click();
    await expect($('button[aria-label="Change Open Result in Split shortcut, Ctrl + Shift + Enter"]')).toBeDisplayed();
    await browser.refresh();
    await $('button=Keyboard shortcuts').click();
    await $('input[aria-label="Filter shortcuts"]').setValue('Open Result in Split');
    await expect($('button[aria-label="Change Open Result in Split shortcut, Ctrl + Shift + Enter"]')).toBeDisplayed();
    await expect($$('tr[data-shortcut-id="searchOpenInSplit"]')).toBeElementsArrayOfSize(1);
    await expect($$('tr[data-shortcut-id="searchOpenInSplit"] .binding-button')).toBeElementsArrayOfSize(2);
    await browser.url('/');
    await expect($('[data-testid="note-title"]')).toHaveValue('Alpha note');
    await $('[data-testid="note-search-input"]').setValue('Beta');
    await expect($('button[aria-label="Open search result: beta.md"]')).toBeDisplayed();
    await record('Enter', { ctrlKey: true, shiftKey: true });
    await expect($$('[data-testid="workspace-pane"]')).toBeElementsArrayOfSize(2);
    await expect($('[data-testid="workspace-pane"]:first-child [data-testid="note-title"]')).toHaveValue('Alpha note');
    await expect($('[data-testid="workspace-pane"]:last-child [data-testid="note-title"]')).toHaveValue('Beta note');
    await browser.url('/__gneauxghts_e2e_reset');
    await browser.url('/');
    await expect($('[data-testid="note-title"]')).toHaveValue('Alpha note');
    await $('[data-testid="note-search-input"]').setValue('Beta');
    await expect($('button[aria-label="Open search result: beta.md"]')).toBeDisplayed();
    await record('Enter', { altKey: true });
    await expect($$('[data-testid="workspace-pane"]')).toBeElementsArrayOfSize(1);
    await expect($('[data-testid="note-title"]')).toHaveValue('Beta note');
    await browser.url('/settings');
    await $('button=Keyboard shortcuts').click();
    await $('input[aria-label="Filter shortcuts"]').setValue('Open Result in Split');
    await $('tbody tr:first-child button[title="Reset command to default"]').click();
    await expect($('button[aria-label="Change Open Result in Split shortcut, Option + Enter"]')).toBeDisplayed();
    await expect($('button[aria-label="Change Open Result in Split shortcut, Cmd + Shift + Enter"]')).toBeDisplayed();
  });
});
