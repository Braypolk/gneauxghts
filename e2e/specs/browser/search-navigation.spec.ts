import { browser, expect, $ } from '@wdio/globals';
import { resetBrowserWorkspace, waitForNote } from '../../support/browserWorkspace';
import { waitForWorkspaceAnimationSettled } from '../../support/workspaceAnimation';

const text = 'First beacon and another beacon\nLast beacon';
const positions = [text.indexOf('beacon'), text.indexOf('beacon', text.indexOf('beacon') + 1), text.lastIndexOf('beacon')];

async function openCurrentSearch(markdown = text) {
  const content = await $('[data-testid="note-editor"] .cm-content');
  await browser.execute((element: HTMLElement, text: string) => {
    element.focus();
    document.execCommand('selectAll');
    document.execCommand('insertText', false, text);
  }, content, markdown);
  await browser.waitUntil(() => browser.execute((text: string) =>
    window.__GNEAUXGHTS_E2E__!.snapshot().notes.some(note => note.markdown === text), markdown));
  const input = await $('[data-testid="note-search-input"]');
  await input.click();
  await $('button[aria-label="Search this note only"]').click();
  await input.setValue('beacon');
  await $('button.search-result-item').waitForDisplayed();
  await waitForWorkspaceAnimationSettled();
}

async function expectPreview(position: number) {
  await browser.waitUntil(() => browser.execute((position: number) => {
    const state = (window as any).__GNEAUXGHTS_NATIVE_E2E__.readEditorState();
    return state.editor?.selection.anchor === position && state.editor?.selection.head === position + 6;
  }, position));
  expect(await $('[data-testid="note-search-input"]').isFocused()).toBe(true);
  await expect($('.search-results-panel')).toBeDisplayed();
}

describe('current-note search previews', () => {
  beforeEach(resetBrowserWorkspace);

  it('keeps search focused while Enter cycles through every occurrence and Shift+Enter reverses', async () => {
    await openCurrentSearch();
    for (const position of [...positions, positions[0]]) {
      await browser.keys('Enter');
      await expectPreview(position);
    }
    for (const position of [positions[2], positions[1], positions[0], positions[2]]) {
      await browser.keys(['Shift', 'Enter', '\uE000']);
      await expectPreview(position);
    }
    // Clicking a row remains a committed destination.
    await browser.execute(() => document.querySelector<HTMLButtonElement>('button.search-result-item')!.click());
    await browser.waitUntil(() => browser.execute(() => document.activeElement?.classList.contains('cm-content') === true));
    await expect($('.search-results-panel')).not.toBeDisplayed();
  });

  it('uses yellow for the current match and neutral secondary highlights for the others in both themes', async () => {
    await openCurrentSearch();
    await browser.keys('Enter');
    await expectPreview(positions[0]);
    for (const dark of [false, true]) {
      const colors = await browser.execute((dark: boolean) => {
        document.documentElement.classList.toggle('dark', dark);
        const selected = document.querySelector<HTMLElement>('.cm-searchMatch-selected')!;
        const secondary = document.querySelector<HTMLElement>('.cm-searchMatch:not(.cm-searchMatch-selected)')!;
        // Sample computed colors through canvas so any CSS color space is comparable.
        const context = document.createElement('canvas').getContext('2d')!;
        const sample = (element: HTMLElement) => {
          context.clearRect(0, 0, 1, 1);
          context.fillStyle = getComputedStyle(element).backgroundColor;
          context.fillRect(0, 0, 1, 1);
          return Array.from(context.getImageData(0, 0, 1, 1).data);
        };
        return { current: sample(selected), secondary: sample(secondary) };
      }, dark);
      expect(colors.current[3]).toBeGreaterThan(colors.secondary[3]);
      expect(colors.current[0] - colors.current[2]).toBeGreaterThan(60);
      expect(Math.max(...colors.secondary.slice(0, 3)) - Math.min(...colors.secondary.slice(0, 3))).toBeLessThan(25);
    }
  });

  it('previews and minimally scrolls distant matches with hover and arrow keys, then continues with Enter', async () => {
    const lines = Array.from({ length: 250 }, (_, i) => `Filler ${i}`);
    lines[50] = 'First beacon and another beacon';
    lines[200] = 'Last beacon';
    const markdown = lines.join('\n');
    const first = markdown.indexOf('beacon'), second = markdown.indexOf('beacon', first + 1), last = markdown.lastIndexOf('beacon');
    await openCurrentSearch(markdown);
    const expectInBand = async (position: number) => {
      await expectPreview(position);
      await browser.waitUntil(() => browser.execute(() => {
        const mark = document.querySelector('.cm-searchMatch-selected');
        const scroller = document.querySelector<HTMLElement>('[data-testid="note-editor"] .cm-scroller')!;
        if (!mark) return false;
        const rect = mark.getBoundingClientRect(), top = scroller.getBoundingClientRect().top + scroller.clientTop;
        return (rect.top - top) / scroller.clientHeight >= 0.198 && (rect.bottom - top) / scroller.clientHeight <= 0.602;
      }));
    };
    await $('button[aria-label="Open search result: Line 51"]').moveTo();
    await expectInBand(first);
    await browser.keys('Enter');
    await expectInBand(second);
    await browser.keys('ArrowDown');
    await expectInBand(last);
    await browser.keys('ArrowUp');
    await expectInBand(first);
    await $('button[aria-label="Open search result: Line 201"]').moveTo();
    await expectInBand(last);
    await browser.keys('Enter');
    await expectInBand(first);
  });

  it('still commits a result with Enter in all-notes search', async () => {
    await openCurrentSearch();
    await $('button[aria-label="Search all notes"]').click();
    await $('[data-testid="note-search-input"]').setValue('Beta note');
    await $('button[aria-label="Open search result: Beta note.md"]').waitForDisplayed();
    await waitForWorkspaceAnimationSettled();
    await $('[data-testid="note-search-input"]').click();
    await browser.keys('Enter');
    await waitForNote('Beta note');
    await expect($('.search-results-panel')).not.toBeDisplayed();
  });
});
