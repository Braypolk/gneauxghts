import { browser, $, expect } from '@wdio/globals';

// Refined from the block-handle-gap WDIO verification session.
async function expectHandleSpacing(selector) {
  // Resizing schedules CodeMirror height-map measurements. Keep hovering the
  // requested line until that map and the visible indicator agree.
  await browser.waitUntil(() => browser.execute(selector => {
    const line = document.querySelector('[data-testid="note-editor"] ' + selector);
    const rect = line.getBoundingClientRect();
    line.dispatchEvent(new MouseEvent('mousemove', {
      bubbles: true, clientX: rect.left + 100, clientY: rect.top + rect.height / 2
    }));
    const indicator = document.querySelector('.notepad-block-extent-indicator');
    return indicator.dataset.show === 'true'
      && Math.abs(indicator.getBoundingClientRect().top - rect.top) <= 1;
  }, selector));
  await $('.notepad-block-handle[data-show="true"]').waitForExist();
  const gap = await browser.execute(() => {
    const handle = document.querySelector('.notepad-block-handle').getBoundingClientRect();
    const indicator = document.querySelector('.notepad-block-extent-indicator').getBoundingClientRect();
    return indicator.left - handle.right;
  });
  expect(gap).toBeGreaterThanOrEqual(4);
  expect(gap).toBeLessThanOrEqual(6);
}

describe('block handle and extent indicator spacing', () => {
  it('keeps a small gap beside headings and paragraphs across editor widths', async () => {
    await browser.url('/__gneauxghts_e2e_reset');
    await browser.execute(() => { localStorage.clear(); sessionStorage.clear(); });
    await browser.url('/');
    await expect($('[data-testid="note-title"]')).toHaveValue('Alpha note');
    await browser.execute(() => {
      const content = document.querySelector('[data-testid="note-editor"] .cm-content');
      const bridge = window.__GNEAUXGHTS_NATIVE_E2E__;
      content.focus();
      bridge.setEditorSelection(0, bridge.readEditorState().editor.markdown.length);
      const data = new DataTransfer();
      data.setData('text/plain', '# Bugs\n\nNeed to ensure enough space.');
      content.dispatchEvent(new ClipboardEvent('paste', {
        clipboardData: data, bubbles: true, cancelable: true
      }));
      const end = bridge.readEditorState().editor.markdown.length;
      bridge.setEditorSelection(end, end);
    });
    await $('.cm-gn-line-h1').waitForExist();
    for (const width of [1440, 500, 390]) {
      await browser.setViewport({ width, height: 900, devicePixelRatio: 1 });
      await expectHandleSpacing('.cm-gn-line-h1');
      await expectHandleSpacing('.cm-line:last-child');
    }
  });
});
