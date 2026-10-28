import { browser, $, $$, expect } from '@wdio/globals';

// Verified through the WDIO session loop, exported, then reduced for fresh replay.
describe('Recent Thought partner split', () => {
  it('shows the split action and restores the retained conversation beside the current note', async () => {
    await browser.setWindowSize(1440, 1000);
    await browser.url('/__gneauxghts_e2e_reset');
    await browser.url('/');
    await expect($('[data-testid="note-title"]')).toHaveValue('Alpha note');
    await $('button[aria-label="Open thought partner in this pane"]').click();
    await browser.execute(() => window.__GNEAUXGHTS_E2E__.seedPiChat({
      title: 'Split retained conversation', count: 2
    }));
    await $('button[aria-label="Conversations"]').click();
    await $('[role="menuitem"]=Split retained conversation').click();
    await expect($('input[aria-label="Conversation title"]')).toHaveValue('Split retained conversation');
    await $('button[aria-label="Open previous location in this pane"]').click();
    await expect($('[data-testid="note-title"]')).toHaveValue('Alpha note');
    await $('[data-testid="note-search-input"]').click();
    const split = await $('button[aria-label="Open Thought partner in split pane"]');
    await expect(split).toBeDisplayed();
    await split.click();
    await expect($$('[data-testid="workspace-pane"]')).toBeElementsArrayOfSize(2);
    await expect($('[data-pane-kind="editor"] [data-testid="note-title"]')).toHaveValue('Alpha note');
    await expect($('[data-pane-kind="chat"] input[aria-label="Conversation title"]')).toHaveValue('Split retained conversation');
    await expect($('textarea[aria-label="Message"]')).toBeFocused();
  });
});
