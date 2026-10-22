import { browser, $, expect } from '@wdio/globals';

const snapshot = () => browser.execute(async () => {
  // Let CodeMirror finish the scroll request queued by its history command.
  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
  const editor = window.__GNEAUXGHTS_NATIVE_E2E__.readEditorState().editor;
  return { ...editor, scrollTop: document.querySelector('.cm-scroller').scrollTop };
});

describe('task date history viewport', () => {
  for (const oldCursor of ['before', 'after']) {
    it(`keeps undo/redo on the task when the previous cursor was ${oldCursor} it`, async () => {
      await browser.url('/');
      await expect($('[data-testid="note-title"]')).toHaveValue('Alpha note');
      const taskEnd = await browser.execute(oldCursor => {
        const content = document.querySelector('.cm-content');
        const bridge = window.__GNEAUXGHTS_NATIVE_E2E__;
        content.focus();
        bridge.setEditorSelection(0, bridge.readEditorState().editor.markdown.length);
        const lines = Array.from({ length: 100 }, (_, i) => `Context line ${i + 1}`);
        lines[40] = '- [ ] A task that nearly fills the available text line';
        const markdown = lines.join('\n');
        const data = new DataTransfer();
        data.setData('text/plain', markdown);
        content.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
        const cursor = oldCursor === 'before' ? 0 : markdown.length;
        bridge.setEditorSelection(cursor, cursor);
        // The end-of-line case from the original wrapping regression.
        content.style.width = '440px';
        content.style.maxWidth = '440px';
        return markdown.indexOf('\nContext line 42');
      }, oldCursor);
      await browser.execute(async () => {
        await new Promise(requestAnimationFrame);
        document.querySelector('.cm-scroller').scrollTop = 1100;
      });
      const plus = $('.cm-gn-date-add');
      await expect(plus).toExist();
      await plus.moveTo();
      const before = await snapshot();
      await plus.click();
      await $('input[aria-label="Date or shortcut"]').setValue('2026-10-23');
      await $('dialog.date-time-picker button[type="submit"]').click();
      await expect($('dialog.date-time-picker')).not.toExist();
      const dated = await snapshot();
      expect(dated.markdown).toBe(before.markdown.slice(0, taskEnd) + ' due @due(2026-10-23)' + before.markdown.slice(taskEnd));
      for (let cycle = 0; cycle < 3; cycle++) {
        await browser.keys(['Meta', 'z', '\uE000']);
        const undone = await snapshot();
        expect(undone.markdown).toBe(before.markdown);
        expect(undone.selection).toEqual({ anchor: taskEnd, head: taskEnd });
        expect(Math.abs(undone.scrollTop - before.scrollTop)).toBeLessThanOrEqual(1);
        await browser.keys(['Meta', 'Shift', 'z', '\uE000']);
        const redone = await snapshot();
        expect(redone.markdown).toBe(dated.markdown);
        const datedEnd = dated.markdown.indexOf('\nContext line 42');
        expect(redone.selection).toEqual({ anchor: datedEnd, head: datedEnd });
        expect(Math.abs(redone.scrollTop - before.scrollTop)).toBeLessThanOrEqual(1);
      }
    });
  }
});
