import { browser, $, $$, expect } from '@wdio/globals';

// Verified through the repository WDIO session loop and exported for fresh replay.
describe('Option opens notes in split screen', () => {
  for (const source of ['search', 'recent', 'edited', 'pinned', 'related', 'related-row']) {
    for (const gesture of ['click', 'Enter']) {
      it(`opens ${source} with Option-${gesture}`, async () => {
        await browser.setWindowSize(1440, 1000);
        await browser.url('/__gneauxghts_e2e_reset');
        await browser.execute(() => { localStorage.clear(); sessionStorage.clear(); });
        await browser.url('/');
        await expect($('[data-testid="note-title"]')).toHaveValue('Alpha note');
        let title = 'Beta note';
        let target;
        if (source.startsWith('related')) {
          await $('button[aria-label="Related notes"]').click();
          target = $('button[aria-label="Open related note: Beta note"]');
          await expect(target).toBeDisplayed();
          if (source === 'related-row') await browser.execute(element => element.focus(), await target);
        } else {
          if (source === 'pinned') {
            await $('button[aria-label="Pin note"]').click();
            title = 'Alpha note';
          }
          await $('[data-testid="note-search-input"]').click();
          if (source === 'search') {
            await $('[data-testid="note-search-input"]').setValue('Beta');
            target = $('button[aria-label="Open search result: Beta note.md"]');
          } else if (source === 'edited') {
            await $('button=Last edited').click();
            target = $('button[aria-label="Open last edited note: Beta note.md"]');
            await expect(target).toBeDisplayed();
            await $('[data-testid="note-search-input"]').click();
            await browser.keys('ArrowDown');
          } else if (source === 'pinned') {
            target = $('button[aria-label="Open pinned note: Alpha note.md"]');
          } else target = $('button[aria-label="Open recent note: beta"]');
          await expect(target).toBeDisplayed();
        }
        if (gesture === 'click') {
          // Keep Option held through the pointer-down and pointer-up ticks.
          await browser.actions([
            browser.action('key').down('\uE00A').pause(0).pause(0).up('\uE00A'),
            browser.action('pointer').move({ origin: await target }).down({ button: 0 }).up({ button: 0 })
          ]);
        } else {
          await browser.action('key').down('\uE00A').down('\uE007').up('\uE007').up('\uE00A').perform();
        }
        await expect($$('[data-testid="workspace-pane"]')).toBeElementsArrayOfSize(2);
        await expect($('[data-testid="workspace-pane"]:first-child [data-testid="note-title"]')).toHaveValue('Alpha note');
        await expect($('[data-testid="workspace-pane"]:last-child [data-testid="note-title"]')).toHaveValue(title);
      });
    }
  }
});
