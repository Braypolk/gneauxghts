import { browser, expect, $ } from '@wdio/globals';
import { resetBrowserWorkspace, openHistoryShortcut } from '../../support/browserWorkspace';
import { clickPaneAction, navigateAppTab } from '../../support/appNavigation';
import type { ChatProposalDraft } from '../../../src/lib/features/chat/types';

type EditorWindow = typeof window & { __GNEAUXGHTS_NATIVE_E2E__: {
  readEditorState(): { editor: { markdown: string } };
  setEditorSelection(anchor: number, head: number): void;
} };
type Point = { x: number; y: number; id?: number };
async function viewport(width = 402, height = 874) {
  await browser.sendCommand('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true });
  await browser.sendCommand('Emulation.setTouchEmulationEnabled', { enabled: true });
}
async function insert(markdown: string) {
  await browser.execute(text => {
    const content = document.querySelector<HTMLElement>('.cm-content')!;
    content.focus(); document.execCommand('selectAll');
    const clipboardData = new DataTransfer(); clipboardData.setData('text/plain', text);
    content.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData }));
    (window as EditorWindow).__GNEAUXGHTS_NATIVE_E2E__.setEditorSelection(0, 0);
  }, markdown);
}
async function authoredText() {
  return browser.execute(() => (window as EditorWindow).__GNEAUXGHTS_NATIVE_E2E__.readEditorState().editor.markdown);
}
async function targetSize(selector: string, minimum = 44, painted = true) {
  await $(selector).waitForExist();
  if (painted) await $(selector).waitForDisplayed();
  const size = await browser.execute(selector => {
    const box = document.querySelector(selector)!.getBoundingClientRect();
    return { width: box.width, height: box.height };
  }, selector);
  expect(size.width).toBeGreaterThanOrEqual(minimum);
  expect(size.height).toBeGreaterThanOrEqual(minimum);
}
async function touch(type: string, points: Point[]) {
  await browser.sendCommand('Input.dispatchTouchEvent', { type, touchPoints: points });
}
async function swipe(from: Point, to: Point, cancel = false) {
  await touch('touchStart', [from]);
  for (let i = 1; i <= 4; i++) await touch('touchMove', [{ x: from.x + (to.x - from.x) * i / 4, y: from.y + (to.y - from.y) * i / 4 }]);
  await touch(cancel ? 'touchCancel' : 'touchEnd', []);
}
async function stageCenter() {
  return browser.execute(() => {
    const box = document.querySelector('.gn-image-viewer .stage')!.getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  });
}
async function transform() {
  return browser.execute(() => {
    const matrix = new DOMMatrix(getComputedStyle(document.querySelector('.gn-image-viewer img')!).transform);
    return { scale: matrix.a, x: matrix.e, y: matrix.f };
  });
}

describe('secondary touch controls and image gestures', () => {
  beforeEach(async () => {
    await resetBrowserWorkspace();
    await viewport();
  });
  afterEach(async () => {
    await browser.sendCommand('Emulation.setTouchEmulationEnabled', { enabled: false });
    await browser.sendCommand('Emulation.clearDeviceMetricsOverride', {});
  });

  it('discovers inline due dates without hover and uses the picker in portrait and landscape', async () => {
    await insert('- [ ] Ship it\nOther notes');
    for (const [width, height] of [[402, 874], [874, 402]]) {
      await viewport(width, height);
      const add = await $('button[aria-label="Add due date"]');
      await add.waitForExist();
      expect(await add.getCSSProperty('opacity')).toMatchObject({ value: 1 });
      await targetSize('button[aria-label="Add due date"]');
      await add.click();
      await $('dialog.date-time-picker').waitForDisplayed();
      await targetSize('[data-testid="date-picker-next-month"]');
      await targetSize('dialog.date-time-picker [data-bits-day]:not([data-outside-month])');
      await $('input[aria-label="Date or shortcut"]').setValue('2099-01-01');
      const apply = await $('dialog.date-time-picker button[type="submit"]');
      await apply.scrollIntoView(); await apply.click();
      await $('dialog.date-time-picker').waitForExist({ reverse: true });
      expect(await authoredText()).toContain('@due(2099-01-01)');
      await insert('- [ ] Ship it\nOther notes');
    }
  });

  it('sizes chat, attachments and message actions for touch while preserving small icons', async () => {
    await browser.execute(() => window.__GNEAUXGHTS_E2E__!.seedChatControls());
    await clickPaneAction('Open thought partner');
    await $('textarea[aria-label="Message"]').waitForEnabled();
    await $('textarea[aria-label="Message"]').setValue('Touch actions');
    for (const [width, height] of [[402, 874], [874, 402]]) {
      await viewport(width, height);
      for (const selector of ['button[aria-label="Add files or images"]', 'button[aria-label="AI model"]']) await targetSize(selector);
      // The dock paints a projection over the real, transparent submission target.
      await targetSize('button[aria-label="Send message"]', 44, false);
      const icon = await $('button[aria-label="Add files or images"] svg').getSize();
      expect(icon.width).toBe(16); expect(icon.height).toBe(16);
    }
    await browser.execute(() => {
      const files = new DataTransfer(); files.items.add(new File(['Attachment preview'], 'touch.txt', { type: 'text/plain' }));
      const input = document.querySelector<HTMLInputElement>('input[aria-label="Choose attachments"]')!;
      input.files = files.files; input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await targetSize('button[aria-label="Preview touch.txt"]');
    await targetSize('button[aria-label="Remove touch.txt"]');
    await $('button[aria-label="Preview touch.txt"]').click();
    await targetSize('button[aria-label="Close preview"]');
    await targetSize('a[aria-label="Download touch.txt"]');
    await $('button[aria-label="Close preview"]').click();
    await $('button[aria-label="Remove touch.txt"]').click();
    await expect($('[aria-label="Pending attachments"]')).not.toExist();
    await $('textarea[aria-label="Message"]').setValue('Touch actions');
    await $('button[aria-label="Send message"]').click();
    const response = '[data-chat-message-id="controls-assistant-1"]';
    await $(response).waitForDisplayed();
    for (const selector of [`${response} button[aria-label="Copy message as Markdown"]`, `${response} button[aria-label="Branch from here"]`, `${response} button[aria-label="Show context usage"]`]) await targetSize(selector);
    expect(await $(`${response} button[aria-label="Branch from here"]`).getCSSProperty('opacity')).toMatchObject({ value: 1 });
    await $(`${response} button[aria-label="Show context usage"]`).click();
    await $('.chat-context-details').waitForDisplayed();
  });

  it('keeps Related, History and Settings secondary targets usable with unchanged icon sizes', async () => {
    await $('button[aria-label="Expand related notes"]').click();
    await targetSize('button[aria-label="Close related panel"]');
    await $('button[aria-label="Close related panel"]').click();
    await openHistoryShortcut();
    await targetSize('button[aria-label="Rename revision"]');
    expect((await $('button[aria-label="Rename revision"] svg').getSize()).width).toBe(12);
    await browser.keys('Escape');
    await browser.execute(() => window.__GNEAUXGHTS_E2E__!.seedChatControls());
    await navigateAppTab('Settings');
    await $('[data-settings-section="ai"]').click();
    await $('[data-settings-anchor="chat-provider"] select').selectByAttribute('value', 'local');
    for (const [width, height] of [[402, 874], [874, 402]]) {
      await viewport(width, height);
      for (const label of ['Show API key', 'Refresh server models', 'Add a model manually']) {
        await $(`button[aria-label="${label}"]`).scrollIntoView();
        await targetSize(`button[aria-label="${label}"]`);
        expect((await $(`button[aria-label="${label}"] svg`).getSize()).width).toBe(16);
      }
      expect(await browser.execute(() => {
        const field = document.querySelector('#provider-api-key')!.getBoundingClientRect();
        const toggle = document.querySelector('button[aria-label="Show API key"]')!.getBoundingClientRect();
        return toggle.top >= field.top && toggle.bottom <= field.bottom && toggle.right <= field.right;
      })).toBe(true);
    }
    await $('button[aria-label="Show API key"]').scrollIntoView();
    const point = await browser.execute(() => {
      const rect = document.querySelector('button[aria-label="Show API key"]')!.getBoundingClientRect();
      return { x: rect.left + 4, y: rect.bottom - 4 };
    });
    await touch('touchStart', [point]); await touch('touchEnd', []);
    await expect($('#provider-api-key')).toHaveAttribute('type', 'text');
  });

  it('keeps mobile proposal actions above other controls and dismisses without writing', async () => {
    await expect($('button[aria-label="Expand related notes"]')).toBeDisplayed();
    await browser.execute(() => window.__GNEAUXGHTS_E2E__!.seedChatControls());
    await clickPaneAction('Open thought partner');
    await $('textarea[aria-label="Message"]').setValue('Review a proposal');
    await $('button[aria-label="Send message"]').click();
    await $('[data-chat-message-id="controls-assistant-1"]').waitForDisplayed();
    const originalNotes = await browser.execute(() => window.__GNEAUXGHTS_E2E__!.snapshot().notes);
    await browser.execute(() => {
      const proposal = {
        id: 'touch-proposal', runId: 'controls-run', conversationId: 'controls-chat',
        assistantMessageId: 'controls-assistant-1', kind: 'create', noteId: null,
        suggestedPath: '/e2e/touch-proposal.md', title: 'Touch proposal', baseHash: null,
        payload: { markdown: 'Review before writing.' }, preview: {},
        status: 'pending', createdAtMillis: 1, updatedAtMillis: 1
      };
      let pending = true;
      window.__GNEAUXGHTS_E2E_COMMANDS__!.chat_list_pending_proposals = () => pending ? [proposal] : [];
      window.__GNEAUXGHTS_E2E_COMMANDS__!.chat_get_proposal_draft = () => ({
        version: 0, markdown: proposal.payload.markdown, title: proposal.title,
        path: proposal.suggestedPath, decisions: []
      } satisfies ChatProposalDraft);
      window.__GNEAUXGHTS_E2E_COMMANDS__!.dismiss_agent_proposal = () => {
        pending = false;
        return { ...proposal, status: 'dismissed' };
      };
      window.__GNEAUXGHTS_E2E__!.emit('chat://proposal', proposal);
    });
    const region = await $('[aria-label="Pending note proposals"]');
    await region.waitForDisplayed();
    for (const label of ['Discard', 'Review in editor']) {
      const button = await region.$(`button=${label}`);
      const size = await button.getSize();
      expect(size.width).toBeGreaterThanOrEqual(44);
      expect(size.height).toBeGreaterThanOrEqual(44);
      expect(await browser.execute(label => {
        const region = document.querySelector('[aria-label="Pending note proposals"]')!;
        const button = Array.from(region.querySelectorAll('button')).find(b => b.textContent?.trim() === label)!;
        const box = button.getBoundingClientRect();
        return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)?.closest('button') === button;
      }, label)).toBe(true);
    }
    await expect($('button[aria-label="Expand related notes"]')).not.toExist();
    await region.$('button=Discard').click();
    await region.waitForExist({ reverse: true });
    expect(await browser.execute(() => window.__GNEAUXGHTS_E2E__!.snapshot().notes)).toEqual(originalNotes);
    expect(await browser.execute(() => window.__GNEAUXGHTS_E2E__!.invocations.filter(i => i.command === 'commit_agent_proposal'))).toHaveLength(0);
  });

  it('opens a styled update review with touch targets and undoes its highlighted hunk', async () => {
    await browser.execute(() => window.__GNEAUXGHTS_E2E__!.seedChatControls());
    await clickPaneAction('Open thought partner');
    await $('textarea[aria-label="Message"]').setValue('Review an update');
    await $('button[aria-label="Send message"]').click();
    await $('[data-chat-message-id="controls-assistant-1"]').waitForDisplayed();
    const originalNotes = await browser.execute(() => window.__GNEAUXGHTS_E2E__!.snapshot().notes);
    await browser.execute(() => {
      const note = window.__GNEAUXGHTS_E2E__!.snapshot().notes.find(n => n.noteId === 'note-alpha')!;
      const proposal = {
        id: 'touch-update', runId: 'controls-run', conversationId: 'controls-chat',
        assistantMessageId: 'controls-assistant-1', kind: 'update', noteId: note.noteId,
        suggestedPath: null, title: note.title, baseHash: 'fixture-hash', payload: {},
        preview: { reviewId: 'touch-review', notePath: note.path, title: note.title,
          baseContentHash: 'fixture-hash', baseEditorMarkdown: note.markdown,
          proposedEditorMarkdown: 'Reviewed replacement.', hunks: [{ id: 'hunk-1',
            baseFrom: 0, baseTo: note.markdown.length, proposedFrom: 0,
            proposedTo: 21, oldText: note.markdown, newText: 'Reviewed replacement.' }] },
        status: 'pending', createdAtMillis: 1, updatedAtMillis: 1
      };
      let pending = true;
      let draft: ChatProposalDraft = {
        version: 0, markdown: proposal.preview.proposedEditorMarkdown,
        title: note.title, path: note.path, decisions: []
      };
      const commands = window.__GNEAUXGHTS_E2E_COMMANDS__!;
      commands.chat_list_pending_proposals = () => pending ? [proposal] : [];
      commands.chat_get_proposal_draft = ({ proposalId }) => {
        if (proposalId !== proposal.id || !pending) throw new Error('Proposal is not pending');
        return draft;
      };
      commands.chat_checkpoint_proposal_draft = ({ proposalId, version, markdown, title, path, decisions }) => {
        if (proposalId !== proposal.id || !pending || version !== draft.version) throw new Error('Stale proposal draft');
        draft = { version: draft.version + 1, markdown: markdown as string,
          title: title as string, path: (path as string | undefined) ?? draft.path,
          decisions: decisions as ChatProposalDraft['decisions'] };
        return draft;
      };
      commands.dismiss_agent_proposal = () => {
        pending = false;
        return { ...proposal, status: 'dismissed' };
      };
      window.__GNEAUXGHTS_E2E__!.emit('chat://proposal', proposal);
    });
    await $('[aria-label="Pending note proposals"]').$('button=Review in editor').click();
    await $('.cm-editor[data-proposal-review="true"]').waitForDisplayed();
    await targetSize('.cm-gn-proposal-keep');
    await targetSize('.cm-gn-proposal-undo');
    expect((await $('.cm-gn-proposal-actions').getCSSProperty('display')).value).toBe('inline-flex');
    expect((await $('.cm-gn-proposal-removed-block').getCSSProperty('background-color')).value).not.toBe('rgba(0,0,0,0)');
    await $('.cm-gn-proposal-undo').click();
    await $('.cm-editor[data-proposal-review="true"]').waitForExist({ reverse: true });
    expect(await authoredText()).toBe(originalNotes.find(note => note.noteId === 'note-alpha')!.markdown);
    expect(await browser.execute(() => window.__GNEAUXGHTS_E2E__!.snapshot().notes)).toEqual(originalNotes);
    expect(await browser.execute(() => window.__GNEAUXGHTS_E2E__!.invocations.filter(i => i.command === 'commit_agent_proposal'))).toHaveLength(0);
  });

  it('pinches, pans, swipes only at fit, cancels safely and closes without changing the note', async () => {
    const markdown = '![[first.png|200]]\n\n![[second.png|200]]';
    await browser.execute(() => { window.__GNEAUXGHTS_E2E__!.seedImageAsset('first.png'); window.__GNEAUXGHTS_E2E__!.seedImageAsset('second.png'); });
    await insert(markdown);
    await browser.execute(() => { document.querySelector<HTMLElement>('.cm-content')!.blur(); document.querySelector('.cm-scroller')!.scrollTop = 0; });
    await $('.gn-image-embed img').click();
    await $('.gn-image-embed button[aria-label="Zoom image"]').click();
    await $('.gn-image-viewer img').waitForDisplayed();
    const point = await stageCenter();
    const fit = (await transform()).scale;
    await touch('touchStart', [point]); await touch('touchEnd', []);
    await expect($('.gn-image-viewer')).toExist();
    await touch('touchStart', [{ x: point.x - 40, y: point.y, id: 1 }, { x: point.x + 40, y: point.y, id: 2 }]);
    await touch('touchMove', [{ x: point.x - 110, y: point.y, id: 1 }, { x: point.x + 110, y: point.y, id: 2 }]);
    await touch('touchEnd', []);
    expect((await transform()).scale).toBeGreaterThan(fit * 2);
    await swipe(point, { x: point.x - 100, y: point.y });
    expect((await transform()).x).toBeLessThan(-50);
    await expect($('.gn-image-viewer header')).toHaveText(expect.stringContaining('first.png'));
    await $('button[aria-label="Fit image"]').click();
    await swipe({ x: point.x + 70, y: point.y }, { x: point.x - 70, y: point.y }, true);
    await expect($('.gn-image-viewer header')).toHaveText(expect.stringContaining('first.png'));
    await swipe({ x: point.x + 70, y: point.y }, { x: point.x - 70, y: point.y });
    await expect($('.gn-image-viewer header')).toHaveText(expect.stringContaining('second.png'));
    await $('.gn-image-viewer img').waitForDisplayed();
    await swipe({ x: point.x + 70, y: point.y }, { x: point.x - 70, y: point.y });
    await expect($('.gn-image-viewer header')).toHaveText(expect.stringContaining('2 / 2'));
    await swipe({ x: point.x - 70, y: point.y }, { x: point.x + 70, y: point.y });
    await expect($('.gn-image-viewer header')).toHaveText(expect.stringContaining('first.png'));
    await viewport(874, 402);
    for (const selector of ['button[aria-label="Close image viewer"]', 'button[aria-label="Next image"]']) await targetSize(selector);
    await $('button[aria-label="Close image viewer"]').click();
    await expect($('.gn-image-viewer')).not.toExist();
    await $('.gn-image-embed button[aria-label="Zoom image"]').click();
    await $('.gn-image-viewer img').waitForDisplayed();
    const backdrop = await browser.execute(() => {
      const rect = document.querySelector('.gn-image-viewer .stage')!.getBoundingClientRect();
      return { x: rect.left + 8, y: rect.top + 8 };
    });
    await touch('touchStart', [backdrop]); await touch('touchEnd', []);
    await expect($('.gn-image-viewer')).not.toExist();
    expect(await authoredText()).toBe(markdown);
  });

  it('keeps inline image tools touch sized and allows the note to scroll over an image', async () => {
    await browser.execute(() => window.__GNEAUXGHTS_E2E__!.seedImageAsset('scroll.png'));
    const markdown = `![[scroll.png|200]]\n\n${'Scrolling text\n\n'.repeat(50)}`;
    await insert(markdown);
    await browser.executeAsync(done => requestAnimationFrame(() => requestAnimationFrame(() => {
      document.querySelector<HTMLElement>('.cm-content')!.blur();
      document.querySelector('.cm-scroller')!.scrollTop = 0;
      done();
    })));
    await $('.gn-image-embed img').click();
    await targetSize('.gn-image-embed button[aria-label="Zoom image"]');
    await targetSize('.gn-image-embed button[aria-label="Increase image size"]');
    await targetSize('.gn-image-embed button[aria-label="Resize image se"]');
    const from = await browser.execute(() => {
      const rect = document.querySelector('.gn-image-embed img')!.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.bottom - 5 };
    });
    const before = await browser.execute(() => document.querySelector('.cm-scroller')!.scrollTop);
    await swipe(from, { x: from.x, y: from.y - 100 });
    await browser.waitUntil(() => browser.execute(before => document.querySelector('.cm-scroller')!.scrollTop > before, before));
    await expect($('.gn-image-viewer')).not.toExist();
    expect(await authoredText()).toBe(markdown);
  });
});
