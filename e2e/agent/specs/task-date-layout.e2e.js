import { browser, $, $$, expect } from '@wdio/globals';

// Measure the final authored character separately from CodeMirror's date widget.
async function measureTasks(...widths) {
  const content = document.querySelector('[data-testid="note-editor"] .cm-content');
  const layouts = [];
  for (const width of widths) {
    if (width === null) {
      content.style.removeProperty('width');
      content.style.removeProperty('max-width');
    } else {
      content.style.width = `${width}px`;
      content.style.maxWidth = `${width}px`;
    }
    await new Promise(requestAnimationFrame);
    for (const button of document.querySelectorAll('.cm-gn-date-add')) {
      const line = button.closest('.cm-line');
      const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
      let lastText;
      while (walker.nextNode()) {
        if (!button.contains(walker.currentNode) && walker.currentNode.textContent.trim()) {
          lastText = walker.currentNode;
        }
      }
      const range = document.createRange();
      range.setStart(lastText, lastText.length - 1);
      range.setEnd(lastText, lastText.length);
      const text = range.getBoundingClientRect();
      const action = button.getBoundingClientRect();
      const height = line.getBoundingClientRect().height;
      button.style.display = 'none';
      const heightWithoutButton = line.getBoundingClientRect().height;
      button.style.removeProperty('display');
      layouts.push({ width, height, heightWithoutButton,
        gap: action.left - text.right,
        expectedGap: Number.parseFloat(getComputedStyle(button).marginLeft),
        alongsideLastText: action.top <= text.bottom && action.bottom >= text.top,
        actionWidth: action.width, actionHeight: action.height,
        coarse: matchMedia('(any-pointer: coarse)').matches,
        labelVisible: getComputedStyle(button.querySelector('.cm-gn-date-add-label')).display !== 'none' });
    }
  }
  return layouts;
}

function expectInlineLayout(layout) {
  expect(layout.height).toBe(layout.heightWithoutButton);
  expect(layout.gap).toBeCloseTo(layout.expectedGap, 1);
  expect(layout.alongsideLastText).toBe(true);
}

describe('task due-date affordance layout', () => {
  it('floats after short and wrapped task text without adding line space', async () => {
    await browser.url('/');
    await expect($('[data-testid="note-title"]')).toHaveValue('Alpha note');
    await browser.execute(() => {
      const content = document.querySelector('[data-testid="note-editor"] .cm-content');
      const bridge = window.__GNEAUXGHTS_NATIVE_E2E__;
      content.focus();
      bridge.setEditorSelection(0, bridge.readEditorState().editor.markdown.length);
      const data = new DataTransfer();
      data.setData('text/plain', '- [ ] Short task\n- [ ] A task that nearly fills the available text line\n\nAfter');
      content.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
      const end = bridge.readEditorState().editor.markdown.length;
      bridge.setEditorSelection(end, end);
    });
    await expect($$('.cm-gn-date-add')).toBeElementsArrayOfSize(2);
    // 440px reproduced a one-line task followed by an orphaned plus.
    const layouts = await browser.execute(measureTasks, 240, 320, 440, 460, 600);
    layouts.forEach(expectInlineLayout);
    await browser.execute(measureTasks, 440);
    const button = $$('.cm-gn-date-add')[1];
    await button.moveTo();
    await button.click();
    await expect($('dialog.date-time-picker[open]')).toBeDisplayed();
    await browser.keys('Escape');
    await expect($('dialog.date-time-picker[open]')).not.toExist();

    const restoreDevice = await browser.emulate('device', 'iPhone 15');
    try {
      const touchLayouts = await browser.execute(measureTasks, null);
      for (const layout of touchLayouts) {
        expectInlineLayout(layout);
        expect(layout.coarse).toBe(true);
        expect(layout.actionWidth).toBeGreaterThanOrEqual(44);
        expect(layout.actionHeight).toBeGreaterThanOrEqual(44);
        expect(layout.labelVisible).toBe(true);
      }
    } finally {
      await restoreDevice();
    }
  });
});
