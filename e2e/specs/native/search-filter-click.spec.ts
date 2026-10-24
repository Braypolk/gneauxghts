import { browser, $, expect } from '@wdio/globals';
import { invokeNative } from '../../support/liveNative';
import { waitForWorkspaceAnimationSettled } from '../../support/workspaceAnimation';

// Embedded pointer actions dispatch DOM mouse events. They cover startup/focus
// coordination but do not exercise macOS text correction before native hit testing.
// The trusted-input reproduction is recorded in .scratch/archive/search-filter-native-correction-2026-10-23.md.
describe('native first search filter click', () => {
  before(async () => {
    await $('[data-testid="note-search-input"]').waitForDisplayed({ timeout: 30_000 });
    const note = await invokeNative<{ noteId: string }>('save_note', {
      title: 'Search filter fixture', currentPath: null,
      markdown: 'FilterFixtureToken belongs to this note.'
    });
    await invokeNative('mark_note_opened', { noteId: note.noteId });
  });

  for (const type of ['notes', 'images']) {
    it(`registers the first ${type} click after initial results settle`, async () => {
      await browser.refresh();
      await $('[data-testid="note-search-input"]').waitForDisplayed({ timeout: 30_000 });
      await waitForWorkspaceAnimationSettled();
      await $('[data-testid="note-search-input"]').setValue('FilterFixtureToken');
      await $('[data-search-result-type="notes"]').waitForDisplayed();
      await $('[data-search-result-row]').waitForDisplayed();
      await waitForWorkspaceAnimationSettled();
      // The reported first-use failure also occurred after waiting for results.
      await browser.pause(1000);
      expect(await $('.notepad-search-bar').getAttribute('data-search-open')).toBe('true');
      const point = await $(`[data-search-result-type="${type}"]`).execute(el => {
        const rect = el.getBoundingClientRect();
        return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
      });
      await browser.action('pointer').move(point).down().up().perform();
      await expect($('.notepad-search-bar')).toHaveAttribute('data-search-open', 'true');
      await expect($(`[data-search-result-type="${type}"]`)).toHaveAttribute('aria-pressed', 'true');
      await expect($('[data-testid="note-search-input"]')).toHaveValue('FilterFixtureToken');
      await expect($('[data-testid="note-search-input"]')).toBeFocused();
    });
  }
});
