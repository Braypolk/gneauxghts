import { navigateAppTab } from '../../support/appNavigation';
import { browser, expect, $ } from '@wdio/globals';
import { resetBrowserWorkspace, openHistoryShortcut } from '../../support/browserWorkspace';
import { waitForWorkspaceAnimationSettled } from '../../support/workspaceAnimation';

async function viewport(width: number, height: number) {
  await browser.sendCommand('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
}
async function replaceBody(text: string) {
  const content = await $('[data-testid="note-editor"] .cm-content');
  await content.click();
  await browser.keys(['Meta', 'a']);
  await browser.execute((value: string) => document.execCommand('insertText', false, value), text);
}
async function expectInViewport(selector: string) {
  await browser.waitUntil(async () => browser.execute((selector) => {
    const panel = document.querySelector<HTMLElement>(selector);
    if (!panel?.checkVisibility()) return false;
    const r = panel.getBoundingClientRect();
    return r.width > 0 && r.left >= 0 && r.top >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1;
  }, selector), { timeoutMsg: `Expected ${selector} inside the viewport` });
}
async function splitChat(seed = true) {
  await browser.execute(() => document.querySelector<HTMLElement>('button[aria-label="Open split pane options"]')!.dispatchEvent(new PointerEvent('pointerenter')));
  await $('button[aria-label="Split with thought partner"]').click();
  await $('[data-notepad-command-bar] textarea').waitForEnabled();
  await waitForWorkspaceAnimationSettled();
}

describe('responsive layout interactions', () => {
  beforeEach(async () => {
    await browser.sendCommand('Emulation.clearDeviceMetricsOverride', {});
    await resetBrowserWorkspace();
  });
  afterEach(async () => { await browser.sendCommand('Emulation.clearDeviceMetricsOverride', {}); });

  it('toggles Related below phone navigation', async () => {
    await viewport(390, 844);
    await $('button[aria-label="Related notes"]').click();
    await $('button[aria-label="Search notes"]').click();
    await expect($('button[aria-label="Related notes"]')).toHaveAttribute('aria-expanded', 'false');
    expect(new URL(await browser.getUrl()).pathname).toBe('/');
  });

  it('keeps medium split titles and pin clear of header actions', async () => {
    await $('[data-testid="note-title"]').setValue('A long note title to test the pin and action spacing');
    await $('[data-testid="note-editor"] .cm-content').click();
    await viewport(900, 560); await splitChat();
    const overlap = await browser.execute(() => {
      const intersects = (a: DOMRect, b: DOMRect) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
      return [...document.querySelectorAll('.pane-header')].some(header => {
        const title = header.querySelector('input')!.getBoundingClientRect();
        const actions = [...header.querySelectorAll('button')].filter(button => !button.closest('.pane-header-title'));
        const pin = header.querySelector('.pane-header-title button')?.getBoundingClientRect();
        return actions.some(action => intersects(title, action.getBoundingClientRect()) || (!!pin && intersects(pin, action.getBoundingClientRect())));
      });
    });
    expect(overlap).toBe(false);
    await $('button[aria-label="Pin note"]').click();
    await expect($('button[aria-label="Unpin note"]')).toHaveAttribute('aria-pressed', 'true');
    await $('button[aria-label="Note options"]').click();
    await $('*[role="menuitem"][aria-label="Open note history"]').waitForDisplayed();
    await browser.keys('Escape');
  });

  for (const [width, height] of [[640, 560], [844, 390]]) {
  }

  it('fits calendar contents in a medium split and a 320px task dialog', async () => {
    await viewport(900, 560); await splitChat();
    const date = await browser.execute(() => new Intl.DateTimeFormat(undefined, { year: 'numeric', month: '2-digit', day: '2-digit', calendar: 'gregory', numberingSystem: 'latn' }).format(new Date(2026, 8, 24)));
    await replaceBody(`Meeting ${date}\nTail`);
    await $('button[aria-label^="Edit date:"]').click();
    await expectInViewport('dialog.date-time-picker');
    const assertCalendar = async () => {
      expect(await browser.execute(() => {
        const dialog = document.querySelector<HTMLElement>('dialog.date-time-picker')!;
        return dialog.scrollWidth <= dialog.clientWidth + 1;
      })).toBe(true);
      const day = await $('dialog tbody tr:first-child td:last-child [data-bits-day]');
      await day.scrollIntoView(); await day.click();
      await $('button=Apply').scrollIntoView(); await $('button=Apply').click();
      await $('dialog.date-time-picker').waitForExist({ reverse: true });
    };
    await assertCalendar();
    await replaceBody('- [ ] Narrow calendar task');
    await viewport(320, 560);
    // Media-query admission follows the driver resize; wait for the compact nav.
    await $('button[aria-label="Switch tab"]').waitForDisplayed();
    await navigateAppTab('List');
    await $('button[aria-label="Add due date: Narrow calendar task"]').click();
    await expectInViewport('dialog.date-time-picker'); await assertCalendar();
    await $('button[aria-label^="Edit due date:"]').waitForDisplayed();
  });

  it('scrolls the last blank-pane choice above the dock in a short window', async () => {
    await viewport(640, 560);
    await $('button[aria-label="Open split pane options"]').click();
    const choice = await $('#pane-command-thought-partner');
    await choice.waitForExist(); await choice.scrollIntoView();
    await choice.click();
    await $('[data-pane-kind="chat"]').waitForExist();
  });

  for (const split of [false, true]) {
    it(`reaches selection formatting and final block actions ${split ? 'in a medium split' : 'at 320px'}`, async () => {
      await viewport(split ? 900 : 320, 560);
      if (split) await splitChat();
      await replaceBody('Selected text for formatting');
      const content = await $('[data-testid="note-editor"] .cm-content');
      await browser.execute((element: HTMLElement) => {
        element.focus();
        const range = document.createRange(); range.selectNodeContents(element);
        const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
      }, content);
      await $('button[aria-label="Turn into block type"]').waitForDisplayed();
      await expectInViewport('.selection-panel');
      expect(await browser.execute(() => {
        const panel = document.querySelector<HTMLElement>('.selection-panel')!;
        return panel.scrollWidth <= panel.clientWidth + 1;
      })).toBe(true);
      await $('button[aria-label="Turn into block type"]').click();
      const code = await $('.selection-menu-body').$('li=Code');
      await code.scrollIntoView(); await code.click();
      await browser.waitUntil(async () => (await content.getText()).includes('```'));
    });
  }

  it('places a failed-save notice below measured phone chrome', async () => {
    await viewport(390, 844);
    await browser.execute(() => window.__GNEAUXGHTS_E2E__!.holdSave(true));
    try {
      await replaceBody('Keep this failed local edit');
      await browser.waitUntil(async () => browser.execute(() => window.__GNEAUXGHTS_E2E__!.invocations.some(call => call.command === 'save_note')));
      await browser.execute(() => window.__GNEAUXGHTS_E2E__!.releaseSave());
      await $('.notepad-editor-shell [role="alert"]').waitForDisplayed();
      expect(await browser.execute(() => {
        const notice = document.querySelector('.notepad-editor-shell [role="alert"]')!.getBoundingClientRect();
        const header = document.querySelector('.pane-header')!.getBoundingClientRect();
        return notice.top >= header.bottom && notice.right <= innerWidth && notice.left >= 0;
      })).toBe(true);
      expect(await $('[data-testid="note-editor"] .cm-content').getText()).toContain('Keep this failed local edit');
    } finally { await browser.execute(() => window.__GNEAUXGHTS_E2E__!.releaseSave()); }
  });

  it('keeps slash and wikilink menus usable at 320px', async () => {
    await viewport(320, 560);
    await replaceBody('/');
    await $('.slash-panel').waitForDisplayed(); await expectInViewport('.slash-panel');
    await browser.keys('Escape');
    await browser.execute(() => {
      window.__GNEAUXGHTS_E2E_COMMANDS__!.autocomplete_note_links = () => [{ kind: 'note', value: 'Beta note', label: 'Beta note', detail: 'Beta note.md' }];
    });
    await replaceBody('');
    await browser.keys(['[', '[', 'B', 'e', 't', 'a']);
    await $('[data-wikilink-suggestion-active="true"]').waitForDisplayed();
    await expectInViewport('[data-wikilink-suggestion-active="true"]');
    await $('[data-wikilink-suggestion-active="true"]').click();
    expect(await $('[data-testid="note-editor"] .cm-content').getText()).toContain('Beta');
  });

  it('keeps nested task text readable and its date actions reachable on a phone', async () => {
    await viewport(390, 844);
    await replaceBody('- [ ] Parent task\n            - [ ] A deeply nested task with a longer description');
    await navigateAppTab('List');
    const nested = await $('button[aria-label^="Add due date: A deeply nested"]');
    await nested.waitForDisplayed();
    const width = await browser.execute(() => {
      const row = [...document.querySelectorAll<HTMLElement>('.task-row')].find(row => row.textContent?.includes('deeply nested'))!;
      return row.querySelector('.task-content > span')!.getBoundingClientRect().width;
    });
    expect(width).toBeGreaterThan(150);
    await nested.click(); await expectInViewport('dialog.date-time-picker');
    await $('button=Tomorrow').click();
    await $('button=Apply').scrollIntoView(); await $('button=Apply').click();
    await $('dialog.date-time-picker').waitForExist({ reverse: true });
    await $('button[aria-label^="Edit due date:"]').waitForDisplayed();
    await $('[aria-label="Search tasks"]').setValue('deeply');
    await $('button[aria-label="Enable match case"]').click();
    await expect($('button[aria-label="Disable match case"]')).toHaveAttribute('aria-pressed', 'true');
  });

  it('scrolls a short map reader to its source and editor actions', async () => {
    await viewport(640, 560); await navigateAppTab('Map');
    await $('[data-node-id="note-beta"] .dot-body').waitForDisplayed();
    await $('[data-node-id="note-beta"] .dot-body').click();
    const open = await $('button=Open in editor');
    const reader = await $('.reader');
    await browser.waitUntil(async () => browser.execute(() => !document.getAnimations().some(animation =>
      (animation.playState === 'running' || animation.pending) && animation.effect?.getTiming().iterations !== Infinity)));
    await browser.action('wheel').scroll({ origin: reader, deltaY: 400, deltaX: 0 }).perform();
    await browser.waitUntil(async () => browser.execute(() => document.querySelector('.reader')!.scrollTop > 0));
    await expect($('.reader h2')).toHaveText('beta');
    await open.click();
    await expect($('[data-testid="note-title"]')).toHaveValue('Beta note');
  });

  it('scrolls local model configuration controls in a short landscape window', async () => {
    await viewport(844, 390); await navigateAppTab('Settings');
    await $('[data-settings-section="ai"]').click();
    const provider = await $('[data-settings-anchor="chat-provider"] select');
    await provider.waitForExist(); await provider.scrollIntoView(); await provider.selectByAttribute('value', 'local');
    const configure = await $('button[aria-label="Configure fixture-local"]');
    await configure.scrollIntoView(); await configure.click();
    await expectInViewport('dialog[aria-labelledby="local-model-editor-title"]');
    const save = await $('dialog[aria-labelledby="local-model-editor-title"]').$('button=Save changes');
    await save.scrollIntoView(); await save.click();
    await $('dialog[aria-labelledby="local-model-editor-title"]').waitForExist({ reverse: true });
    const calls = await browser.execute(() => window.__GNEAUXGHTS_E2E__!.invocations.filter(call => call.command === 'chat_set_local_model_capabilities'));
    expect(calls).toHaveLength(1);
  });

  it('wraps a long Named Revision and retains History Mode controls on a phone', async () => {
    await viewport(390, 844); await openHistoryShortcut();
    await $('[data-revision-id="note-alpha-revision-35"]').waitForDisplayed();
    await $('section[aria-label="Selected version"]').$('button=Rename').click();
    await $('input[aria-label="Revision name"]').setValue('LongRevisionName'.repeat(15));
    await $('section[aria-label="Named Revision"]').$('button=Add name').scrollIntoView();
    await $('section[aria-label="Named Revision"]').$('button=Add name').click();
    const fits = await browser.execute(() => {
      const main = document.querySelector<HTMLElement>('[aria-label="Historical revision"]')!;
      return main.scrollWidth <= main.clientWidth + 1;
    });
    expect(fits).toBe(true);
    await $('button[aria-label="Back to workspace"]').click();
    await $('[data-testid="note-editor"][aria-busy="false"]').waitForExist();
  });
});
