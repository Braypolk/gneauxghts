import { browser, expect, $ } from '@wdio/globals';
import { resetBrowserWorkspace } from '../../support/browserWorkspace';

const options = (name: string) => $(`button[aria-label="Task group options: ${name}"]`);
const order = () => browser.execute(() => [...document.querySelectorAll<HTMLElement>('[data-task-note-id]')].map(group => group.dataset.taskNoteId));

async function fixture() {
  await browser.execute(() => {
    const groups = ['a', 'hidden', 'b', 'c'].map((id, index) => {
      const title = id === 'hidden' ? 'Other note' : `Visible ${id.toUpperCase()}`;
      const tasks = [0, 1].map(i => ({ noteId: id, notePath: `/e2e/${id}.md`, taskId: `${id}-${i}`, taskKey: `${id}-${i}`,
        noteTitle: title, fileName: `${id}.md`, text: `Task ${i} @due(2026-10-${12 - i})`, completed: false, depth: 0,
        hidden: false, noteHidden: false, noteCollapsed: false, sectionLabel: null, lineNumber: i + 1,
        createdAtMillis: index, updatedAtMillis: index }));
      return { noteId: id, notePath: `/e2e/${id}.md`, noteTitle: title, fileName: `${id}.md`, noteHidden: false,
        noteCollapsed: false, displayTasks: tasks, displayCount: 2, hiddenCount: 0, visibleCount: 2 };
    });
    window.__GNEAUXGHTS_E2E_COMMANDS__!.list_tasks = () => groups;
    window.__GNEAUXGHTS_E2E_COMMANDS__!.set_note_order = args => {
      const ids = args.noteIds as string[];
      groups.sort((a, b) => ids.indexOf(a.noteId) - ids.indexOf(b.noteId));
      return null;
    };
  });
  await $('a[aria-label="List"]').click();
  await options('Visible A').waitForDisplayed();
}

describe('touch and keyboard task group reorder', () => {
  beforeEach(async () => {
    await browser.sendCommand('Emulation.clearDeviceMetricsOverride', {});
    await resetBrowserWorkspace();
    await browser.sendCommand('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
    await browser.sendCommand('Emulation.setTouchEmulationEnabled', { enabled: true });
    await fixture();
  });
  afterEach(async () => {
    await browser.sendCommand('Emulation.setTouchEmulationEnabled', { enabled: false });
    await browser.sendCommand('Emulation.clearDeviceMetricsOverride', {});
  });

  it('moves visible neighbors with keyboard navigation, retains focus and persists the full loaded order', async () => {
    await $('[aria-label="Search tasks"]').setValue('Visible');
    await $('input[type="checkbox"]').click(); // Due-date sorting stays within each group.
    await options('Visible A').click();
    await expect($('[role="menuitem"]=Move up')).toHaveAttribute('data-disabled');
    await browser.keys('Escape');
    await options('Visible C').scrollIntoView({ block: 'center' });
    await options('Visible C').click();
    await expect($('[role="menuitem"]=Move down')).toHaveAttribute('data-disabled');
    await browser.keys('Home'); await browser.keys('Enter');
    await browser.waitUntil(async () => (await order()).join(',') === 'a,c,b');
    await expect(options('Visible C')).toBeFocused();
    const calls = await browser.execute(() => window.__GNEAUXGHTS_E2E__!.invocations.filter(entry => entry.command === 'set_note_order'));
    expect(calls.at(-1)?.args.noteIds).toEqual(['a', 'hidden', 'c', 'b']);
    await $('button[aria-label="Clear search"]').click();
    await browser.waitUntil(async () => (await order()).join(',') === 'a,hidden,c,b');
    await $('a[aria-label="Gneauxght"]').click(); await $('a[aria-label="List"]').click();
    await options('Visible C').waitForDisplayed();
    expect(await order()).toEqual(['a', 'hidden', 'c', 'b']);
  });

  it('supports a touch-sized menu and rolls back a rejected reorder without losing focus', async () => {
    await browser.execute(() => { window.__GNEAUXGHTS_E2E_COMMANDS__!.set_note_order = () => { throw new Error('Fixture order failure'); }; });
    const button = await options('Visible A');
    expect(await button.getSize('height')).toBeGreaterThanOrEqual(44);
    await button.click();
    await $('[role="menuitem"]=Move down').click();
    await $('[role="alert"]').waitForDisplayed();
    await expect($('[role="alert"]')).toHaveText('Unable to save note order.');
    expect(await order()).toEqual(['a', 'hidden', 'b', 'c']);
    await expect(button).toBeFocused();
  });
});
