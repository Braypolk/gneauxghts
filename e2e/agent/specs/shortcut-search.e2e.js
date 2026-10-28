import { browser, $, $$, expect } from '@wdio/globals'

describe('keyboard shortcut search', () => {
    it('matches modifier combinations, aliases and exact custom bindings', async () => {
        await browser.setWindowSize(1440, 1000);
        await browser.url('/__gneauxghts_e2e_reset');
        await browser.execute(() => { localStorage.clear(); sessionStorage.clear(); });
        await browser.url('/settings');
        await $('button=Keyboard shortcuts').click();
        const visibleRows = async () => {
          const ids = [];
          for (const row of await $$('tbody tr[data-shortcut-id]')) ids.push(await row.getAttribute('data-shortcut-id'));
          return ids;
        };
        const allIds = await visibleRows();
        expect(new Set(allIds).size).toBe(allIds.length);
        const expected = [];
        for (const row of await $$('tbody tr[data-shortcut-id]')) {
          const labels = [];
          for (const button of await row.$$('button.binding-button')) labels.push(await button.getAttribute('aria-label'));
          if (labels.some(label => {
            const keys = label.split(', ').at(-1).split(' + ');
            return keys.includes('Cmd') && keys.includes('Shift');
          })) expected.push(await row.getAttribute('data-shortcut-id'));
        }
        expect(expected.length).toBeGreaterThan(3);
        for (const query of ['cmd+shift', 'cmd shift', 'shift command', '⌘⇧', 'meta + shift']) {
          await $('input[aria-label="Filter shortcuts"]').setValue(query);
          await browser.waitUntil(async () => JSON.stringify(await visibleRows()) === JSON.stringify(expected), { timeoutMsg: `Expected both modifiers for ${query}` });
          await expect($('button[aria-label="Change Open Result in Split shortcut, Cmd + Shift + Enter"]')).toBeDisplayed();
          await expect($('button[aria-label="Change Open Result in Split shortcut, Option + Enter"]')).toBeDisplayed();
        }
        await $('input[aria-label="Filter shortcuts"]').setValue('option enter');
        await expect($('button[aria-label="Change Open Result in Split shortcut, Option + Enter"]')).toBeDisplayed();
        await $('input[aria-label="Filter shortcuts"]').setValue('open split');
        await expect($$('tr[data-shortcut-id="searchOpenInSplit"]')).toBeElementsArrayOfSize(1);
        await expect($$('tr[data-shortcut-id="searchOpenInSplit"] .binding-button')).toBeElementsArrayOfSize(2);
        await $('input[aria-label="Filter shortcuts"]').setValue('"cmd shift enter"');
        await expect($$('tbody tr[data-shortcut-id]')).toBeElementsArrayOfSize(1);
        await $('button[aria-label="Change Open Result in Split shortcut, Cmd + Shift + Enter"]').click();
        await browser.execute(() => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Enter', code: 'Enter', metaKey: true, ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true
        })));
        await $('button=Save').click();
        await expect($$('tbody tr[data-shortcut-id]')).toBeElementsArrayOfSize(0);
        await expect($('td=No shortcuts match your search.')).toBeDisplayed();
        await $('input[aria-label="Filter shortcuts"]').setValue('cmd shift');
        await expect($('button[aria-label="Change Open Result in Split shortcut, Cmd + Ctrl + Shift + Enter"]')).toBeDisplayed();
        await $('input[aria-label="Filter shortcuts"]').setValue('"ctrl cmd shift enter"');
        await expect($$('tbody tr[data-shortcut-id]')).toBeElementsArrayOfSize(1);
        await expect($('tbody tr[data-shortcut-id]')).toHaveText(expect.stringContaining('User'));
        await browser.refresh();
        await $('button=Keyboard shortcuts').click();
        await $('input[aria-label="Filter shortcuts"]').setValue('"ctrl cmd shift enter"');
        await expect($('button[aria-label="Change Open Result in Split shortcut, Cmd + Ctrl + Shift + Enter"]')).toBeDisplayed();
        await $('button[title="Reset command to default"]').click();
        await expect($$('tbody tr[data-shortcut-id]')).toBeElementsArrayOfSize(0);
        await $('input[aria-label="Filter shortcuts"]').setValue('cmd+shift');
        await browser.waitUntil(async () => JSON.stringify(await visibleRows()) === JSON.stringify(expected));
    })
})
