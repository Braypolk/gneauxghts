import { browser, $, expect } from '@wdio/globals';

// Exported from retire-ai-titles; the native capture regression covers filename
// derivation and proves that saving does not contact the AI provider.
describe('Retired automatic AI titles', () => {
  it('keeps Chat settings available without the retired title preference', async () => {
    await browser.url('/settings');
    await $('button=AI & Chat').click();
    await expect($('button=Save defaults')).toBeDisplayed();
    await expect($('input[aria-label="Automatic note titles"]')).not.toExist();
    await expect($('[data-settings-anchor="note-titles"]')).not.toExist();
  });
});
