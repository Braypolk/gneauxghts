import { browser, $, expect } from '@wdio/globals';

// Exported from app-audit's WDIO session, then reduced to isolated scenarios.
// Logical key events avoid the host keyboard layout remapping Cmd+B to Cmd+T.
async function shortcut(key, modifiers = { metaKey: true }) {
  await browser.execute((key, modifiers) => {
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {
      key, code: key.length === 1 ? `Key${key.toUpperCase()}` : key,
      ...modifiers, bubbles: true, cancelable: true
    }));
  }, key, modifiers);
}
const content = () => $('[data-testid="note-editor"] .cm-content');
async function startBlank() {
  await $('button[aria-label="New Idea. Start a blank note in this pane."]').click();
  await expect($('[data-testid="note-title"]')).toHaveValue('');
  await expect(content()).toBeFocused();
}

describe('capture and formatting', () => {
  beforeEach(async () => {
    await browser.setWindowSize(1440, 1000);
    await browser.url('/__gneauxghts_e2e_reset');
    await browser.execute(() => { localStorage.clear(); sessionStorage.clear(); });
    await browser.url('/');
    await expect($('[data-testid="note-title"]')).toHaveValue('Alpha note');
    await startBlank();
  });

  it('starts bold text at an empty caret, toggles it, and restores it with Undo', async () => {
    await shortcut('b');
    await expect(content()).toHaveText('****');
    await expect($('.cm-gn-hr-line')).not.toExist();
    await browser.keys('idea');
    await expect(content()).toHaveText('**idea**');
    await shortcut('b');
    await expect(content()).toHaveText('idea');
    await shortcut('z');
    await expect(content()).toHaveText('**idea**');
    await browser.waitUntil(() => browser.execute(() =>
      window.__GNEAUXGHTS_E2E__.snapshot().notes.some(note => note.markdown === '**idea**')));
    const source = await browser.execute(() => window.__GNEAUXGHTS_E2E__.snapshot().notes.find(note => note.noteId === 'note-alpha'));
    expect(source.title).toBe('Alpha note');
  });

  it('moves an unterminated final line without joining text and undoes exactly', async () => {
    await browser.keys('first\nlast');
    await shortcut('ArrowUp', { altKey: true });
    await expect(content()).toHaveText('last\nfirst');
    await shortcut('z');
    await expect(content()).toHaveText('first\nlast');
  });

  it('keeps the last block-menu row reachable in a short window', async () => {
    await browser.setWindowSize(1100, 650);
    await browser.keys('first\nlast');
    await browser.execute(() => {
      const editor = document.querySelector('.cm-content');
      const range = document.createRange();
      range.selectNodeContents(editor);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    });
    await $('button[aria-label="Turn into block type"]').click();
    const body = await $('.selection-menu-body');
    await expect(body).toBeDisplayed();
    const point = await browser.execute(element => {
      const rect = element.getBoundingClientRect();
      return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
    }, body);
    await browser.action('pointer').move(point).perform();
    await browser.action('wheel').scroll({ ...point, deltaY: 2000, deltaX: 0 }).perform();
    await browser.waitUntil(() => browser.execute(element =>
      element.scrollTop >= element.scrollHeight - element.clientHeight - 1, body));
    const geometry = await browser.execute(element => {
      const rows = element.querySelectorAll('.selection-item');
      const row = rows[rows.length - 1];
      const rect = row.getBoundingClientRect();
      const panel = element.closest('.selection-panel').getBoundingClientRect();
      return { label: row.textContent.trim(), top: rect.top, bottom: rect.bottom,
        panelTop: panel.top, panelBottom: panel.bottom, viewportHeight: innerHeight,
        x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
    }, body);
    expect(geometry.label).toBe('Code');
    expect(geometry.top).toBeGreaterThanOrEqual(geometry.panelTop);
    expect(geometry.bottom).toBeLessThanOrEqual(geometry.panelBottom);
    expect(geometry.panelTop).toBeGreaterThanOrEqual(16);
    expect(geometry.panelBottom).toBeLessThanOrEqual(geometry.viewportHeight - 16);
    await browser.action('pointer').move({ x: geometry.x, y: geometry.y }).down().up().perform();
    await expect(body).not.toExist();
    await expect(content()).toHaveText(expect.stringContaining('```'));
  });
});
