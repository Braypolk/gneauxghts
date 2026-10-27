import { browser, $, expect } from '@wdio/globals';

const markdown = 'beacon '.repeat(30) + 'tail\n**beacon beacon beacon**\n`beacon beacon beacon`\nTail';

// Text nodes split when decorations appear. Compare character geometry instead
// of span widths so the assertion follows the text across those DOM changes.
function characterGeometry() {
  return [...document.querySelectorAll('[data-testid="note-editor"] .cm-line')].slice(0, 3).map(line => {
    const origin = line.getBoundingClientRect();
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    const characters = [];
    let node;
    while ((node = walker.nextNode())) {
      for (let index = 0; index < node.length; index++) {
        const range = document.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + 1);
        const rect = range.getBoundingClientRect();
        characters.push([rect.left - origin.left, rect.top - origin.top, rect.width, rect.height]);
      }
    }
    return { text: line.textContent, height: origin.height, characters };
  });
}

async function expectUnchangedGeometry(before) {
  const after = await browser.execute(characterGeometry);
  expect(after).toHaveLength(before.length);
  for (const [index, line] of after.entries()) {
    expect(line.text).toBe(before[index].text);
    expect(Math.abs(line.height - before[index].height)).toBeLessThanOrEqual(0.5);
    expect(line.characters).toHaveLength(before[index].characters.length);
    const maxDelta = Math.max(...line.characters.flatMap((character, offset) =>
      character.map((value, dimension) => Math.abs(value - before[index].characters[offset][dimension]))));
    // Allow subpixel text rounding; a padded match moves subsequent text by 2px.
    expect(maxDelta).toBeLessThanOrEqual(0.5);
  }
}

// Refined from the highlight-width WDIO verification session.
describe('editor search highlight geometry', () => {
  beforeEach(async () => {
    await browser.setViewport({ width: 1440, height: 900, devicePixelRatio: 1 });
    await browser.url('/__gneauxghts_e2e_reset');
    await browser.execute(() => { localStorage.clear(); sessionStorage.clear(); });
    await browser.url('/');
    await expect($('[data-testid="note-title"]')).toHaveValue('Alpha note');
    await browser.execute(markdown => {
      const content = document.querySelector('[data-testid="note-editor"] .cm-content');
      content.focus();
      document.execCommand('selectAll');
      document.execCommand('insertText', false, markdown);
    }, markdown);
    await browser.waitUntil(() => browser.execute(markdown =>
      window.__GNEAUXGHTS_E2E__.snapshot().notes.some(note => note.markdown === markdown), markdown));
    await $('[data-testid="note-search-input"]').click();
    await $('button[aria-label="Search this note only"]').click();
  });

  for (const width of [1440, 500]) {
    it(`keeps plain, bold, and inline-code text in place at ${width}px`, async () => {
      await browser.setViewport({ width, height: 900, devicePixelRatio: 1 });
      for (const dark of [false, true]) {
        await browser.execute(async dark => {
          document.documentElement.classList.toggle('dark', dark);
          await Promise.all(document.querySelector('.workspace-input-dock').getAnimations({ subtree: true })
            .filter(animation => Number.isFinite(animation.effect.getComputedTiming().endTime))
            .map(animation => animation.finished.catch(() => {})));
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        }, dark);
        const before = await browser.execute(characterGeometry);
        expect(before).toHaveLength(3);
        await $('[data-testid="note-search-input"]').setValue('beacon');
        await browser.waitUntil(() => browser.execute(() => document.querySelectorAll('.cm-searchMatch').length === 36));
        await expectUnchangedGeometry(before);
        // Highlights update immediately; result navigation waits for retrieval.
        await browser.waitUntil(() => browser.execute(() =>
          document.querySelector('.search-results-panel')?.getAttribute('aria-busy') === 'false'
          && document.querySelector('.search-result-item') !== null));
        await expect($('[data-testid="note-search-input"]')).toBeFocused();
        await browser.keys('Enter');
        await expect($('.cm-searchMatch-selected')).toExist();
        await expectUnchangedGeometry(before);
        await browser.keys('Enter');
        await expectUnchangedGeometry(before);
        await $('button[aria-label="Clear search"]').click();
        await browser.waitUntil(() => browser.execute(() => !document.querySelector('.cm-searchMatch')));
        await expectUnchangedGeometry(before);
      }
    });
  }
});
