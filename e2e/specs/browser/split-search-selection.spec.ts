import { browser, expect, $ } from '@wdio/globals';
import { resetBrowserWorkspace } from '../../support/browserWorkspace';
import { openBrowserPiPane } from '../../support/browserPi';
import { waitForWorkspaceAnimationSettled } from '../../support/workspaceAnimation';

async function expectActiveNote(paneId: string, title: string) {
  await browser.waitUntil(() => browser.execute((paneId: string, noteId: string) => {
    const state = (window as any).__GNEAUXGHTS_NATIVE_E2E__.readEditorState();
    return state.activePaneId === paneId && state.paneKind === 'editor' && state.noteId === noteId;
  }, paneId, title === 'Beta note' ? 'note-beta' : 'note-alpha'));
}

async function viewport(width: number) {
  await browser.sendCommand('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false });
  await waitForWorkspaceAnimationSettled();
}

describe('search selections from a split chat', () => {
  beforeEach(async () => {
    await browser.sendCommand('Emulation.clearDeviceMetricsOverride', {});
    await resetBrowserWorkspace();
  });
  afterEach(async () => { await browser.sendCommand('Emulation.clearDeviceMetricsOverride', {}); });

  for (const width of [1440, 390]) {
    for (const source of ['Recent', 'Pinned']) {
      it(`opens a ${source} note in the active chat pane at ${width}px`, async () => {
        if (source === 'Pinned') await $('button[aria-label="Pin note"]').click();
        await openBrowserPiPane();
        const chatId = (await $('[data-pane-kind="chat"]').getAttribute('data-pane-id'))!;
        await viewport(width);
        await $('button[aria-label="Expand search"]').click();
        const title = source === 'Pinned' ? 'Alpha note' : 'Beta note';
        const label = source === 'Pinned' ? `Open pinned note: ${title}.md` : 'Open recent note: beta';
        await $(`button[aria-label="${label}"]`).waitForDisplayed();
        await waitForWorkspaceAnimationSettled();
        await $(`button[aria-label="${label}"]`).click();
        const destination = await $(`[data-pane-id="${chatId}"]`);
        await expect(destination).toHaveAttribute('data-pane-kind', 'editor');
        await expectActiveNote(chatId, title);
        await expect($('[data-testid="workspace-pane"]:first-child [data-testid="note-title"]')).toHaveValue('Alpha note');
      });
    }

    it(`opens Related in the active split editor at ${width}px`, async () => {
      await browser.execute(() => document.querySelector<HTMLElement>('button[aria-label="Open split pane options"]')!
        .dispatchEvent(new PointerEvent('pointerenter')));
      await $('button[aria-label="Split with current location"]').click();
      const paneId = (await $('[data-testid="workspace-pane"]:last-child').getAttribute('data-pane-id'))!;
      await viewport(width);
      await $('button[aria-label="Related notes"]').click();
      await $('button[aria-label="Open related note: Beta note"]').waitForDisplayed();
      await waitForWorkspaceAnimationSettled();
      await browser.keys('Enter');
      await expectActiveNote(paneId, 'Beta note');
      await expect($('[data-testid="workspace-pane"]:first-child [data-testid="note-title"]')).toHaveValue('Alpha note');
    });

    for (const title of ['Beta note', 'Alpha note']) {
      for (const selection of ['click', 'Enter']) {
        it(`opens ${title} in the active chat pane via ${selection} at ${width}px`, async () => {
          await openBrowserPiPane();
          await viewport(width);
          const chatId = (await $('[data-pane-kind="chat"]').getAttribute('data-pane-id'))!;
          const editorId = (await $('[data-pane-kind="editor"]').getAttribute('data-pane-id'))!;
          await $('textarea[aria-label="Message"]').setValue('Keep this chat draft');

          await $('button[aria-label="Expand search"]').click();
          const input = await $('[data-testid="note-search-input"]');
          await $('button[aria-label="Search all notes"]').click();
          await input.setValue(title);
          const result = await $(`button[aria-label="Open search result: ${title}.md"]`);
          await result.waitForDisplayed();
          await waitForWorkspaceAnimationSettled();
          if (selection === 'click') await result.click();
          else {
            await input.click();
            await browser.keys('Enter');
          }

          const destination = await $(`[data-pane-id="${chatId}"]`);
          await expect(destination).toHaveAttribute('data-pane-kind', 'editor');
          await expectActiveNote(chatId, title);
          await expect($(`[data-pane-id="${editorId}"] [data-testid="note-title"]`)).toHaveValue('Alpha note');
          await waitForWorkspaceAnimationSettled();
          await browser.waitUntil(() => browser.execute((id: string) =>
            document.activeElement?.closest('[data-pane-id]')?.getAttribute('data-pane-id') === id, chatId));

          // The chat remains available when returning to that pane's chat view.
          await destination.$('button[aria-label="Open thought partner"]').click();
          await expect($('textarea[aria-label="Message"]')).toHaveValue('Keep this chat draft');
        });
      }
    }
  }
});
