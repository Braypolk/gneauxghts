import { browser, $, $$, expect } from '@wdio/globals';

// Exported from formatting-followup, then reduced to isolated regressions.
// Logical shortcuts avoid the host keyboard layout remapping Cmd+B to Cmd+T.
async function shortcut(key) {
  await browser.execute(key => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {
    key, code: `Key${key.toUpperCase()}`, metaKey: true, bubbles: true, cancelable: true
  })), key);
}
const source = () => browser.execute(() => window.__GNEAUXGHTS_NATIVE_E2E__.readEditorState().editor.markdown);
async function setSource(text, anchor = text.length, head = anchor) {
  await browser.execute(() => {
    const bridge = window.__GNEAUXGHTS_NATIVE_E2E__;
    document.querySelector('.cm-content').focus();
    bridge.setEditorSelection(0, bridge.readEditorState().editor.markdown.length);
  });
  await browser.keys('Backspace');
  if (text) await browser.execute(text => {
    const data = new DataTransfer(); data.setData('text/plain', text);
    document.querySelector('.cm-content').dispatchEvent(new ClipboardEvent('paste', {
      clipboardData: data, bubbles: true, cancelable: true
    }));
  }, text);
  await browser.execute((anchor, head) => window.__GNEAUXGHTS_NATIVE_E2E__.setEditorSelection(anchor, head), anchor, head);
}

describe('formatting mechanics', () => {
  beforeEach(async () => {
    await browser.emulate('media', { prefersReducedMotion: 'no-preference' });
    await browser.setWindowSize(1440, 1000);
    await browser.url('/__gneauxghts_e2e_reset');
    await browser.execute(() => { localStorage.clear(); sessionStorage.clear(); });
    await browser.url('/');
    await expect($('[data-testid="note-title"]')).toHaveValue('Alpha note');
  });

  it('uses one code span around literal backticks and toggles its source exactly', async () => {
    await setSource('a `tick` here', 0, 13);
    await $('button[aria-label="Code"]').click();
    await expect($('.cm-gn-code-inline')).toHaveText('``a `tick` here``');
    expect(await source()).toBe('``a `tick` here``');
    await $('button[aria-label="Code"]').click();
    expect(await source()).toBe('a `tick` here');
    await shortcut('z');
    expect(await source()).toBe('``a `tick` here``');
  });

  it('places pointer clicks at concealed bold edges inside the formatted text', async () => {
    for (const edge of ['start', 'end']) {
      await setSource('prefix\n\n**word**\n\nsuffix', 0);
      const point = await browser.execute(edge => {
        const rect = document.querySelector('.cm-gn-strong').getBoundingClientRect();
        return { x: Math.round(edge === 'start' ? rect.left + 1 : rect.right - 1),
          y: Math.round((rect.top + rect.bottom) / 2) };
      }, edge);
      await browser.action('pointer').move(point).down().up().perform();
      await browser.keys('X');
      expect(await source()).toBe(`prefix\n\n**${edge === 'start' ? 'Xword' : 'wordX'}**\n\nsuffix`);
      await shortcut('b');
      expect(await source()).toBe(`prefix\n\n${edge === 'start' ? 'Xword' : 'wordX'}\n\nsuffix`);
    }
  });

  it('blocks formatting from composition start and keeps the reduced-motion toolbar usable', async () => {
    await setSource('hello', 2);
    // Exercise CodeMirror's initial composition phase before a DOM text edit;
    // these events do not emulate an OS keyboard's complete IME session.
    await browser.execute(() => {
      const editor = document.querySelector('.cm-content');
      editor.dispatchEvent(new CompositionEvent('compositionstart', { data: 'に', bubbles: true }));
      editor.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'b', code: 'KeyB', metaKey: true, bubbles: true, cancelable: true
      }));
      editor.dispatchEvent(new CompositionEvent('compositionend', { data: 'に', bubbles: true }));
    });
    expect(await source()).toBe('hello');
    await browser.emulate('media', { prefersReducedMotion: 'reduce' });
    await browser.execute(() => window.__GNEAUXGHTS_NATIVE_E2E__.setEditorSelection(0, 5));
    await expect($('button[aria-label="Bold"]')).toBeDisplayed();
    expect(await browser.execute(() => ({
      reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
      transition: getComputedStyle(document.querySelector('button[aria-label="Bold"]')).transitionDuration
    }))).toEqual({ reduced: true, transition: '0s' });
    await $('button[aria-label="Bold"]').click();
    expect(await source()).toBe('**hello**');
  });

  it('continues and exits task lists once and leaves an empty strike pair ready to type', async () => {
    await setSource('- [ ] idea');
    await browser.keys('Enter');
    expect(await source()).toBe('- [ ] idea\n- [ ] ');
    await browser.keys('Enter');
    expect(await source()).toBe('- [ ] idea\n');
    await setSource('~~~~\nFollowing prose', 2);
    await expect($('.cm-gn-code-block-line')).not.toExist();
    await browser.keys('idea');
    expect(await source()).toBe('~~idea~~\nFollowing prose');
    await expect($('.cm-gn-strikethrough')).toHaveText('~~idea~~');
  });

  it('shares nested formatting and Undo between mounted panes', async () => {
    await setSource('word', 2);
    await $('button[aria-label="Open split pane options"]').click();
    await $('#pane-command-current').click();
    await browser.waitUntil(async () => (await $$('[data-testid="note-editor"] .cm-content')).length === 2);
    await browser.execute(() => window.__GNEAUXGHTS_NATIVE_E2E__.setEditorSelection(2, 2));
    await browser.waitUntil(() => browser.execute(() => document.activeElement.matches('.cm-content')));
    await shortcut('b');
    await shortcut('i');
    const panes = await $$('[data-testid="note-editor"] .cm-content');
    expect(await source()).toBe('**_word_**');
    await expect(panes[0].$('.cm-gn-strong')).toExist();
    await expect(panes[0].$('.cm-gn-emphasis')).toExist();
    await expect(panes[1].$('.cm-gn-strong')).toExist();
    await expect(panes[1].$('.cm-gn-emphasis')).toExist();
    await panes[0].click();
    await shortcut('z');
    expect(await source()).toBe('**word**');
    await expect(panes[0].$('.cm-gn-strong')).toExist();
    await expect(panes[1].$('.cm-gn-strong')).toExist();
    await expect(panes[0].$('.cm-gn-emphasis')).not.toExist();
    await expect(panes[1].$('.cm-gn-emphasis')).not.toExist();
    await shortcut('z');
    await expect(panes[0]).toHaveText('word');
    await expect(panes[1]).toHaveText('word');
  });
});
