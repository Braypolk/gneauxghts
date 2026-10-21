import { browser, expect, $ } from '@wdio/globals';
import { resetBrowserWorkspace } from '../../support/browserWorkspace';
import { waitForWorkspaceAnimationSettled } from '../../support/workspaceAnimation';

async function openChat() {
  await browser.execute(() => {
    document.querySelector<HTMLElement>('button[aria-label="Open split pane options"]')!
      .dispatchEvent(new PointerEvent('pointerenter'));
  });
  await $('button[aria-label="Split with thought partner"]').click();
  await $('[data-notepad-command-bar] textarea').waitForEnabled();
  await waitForWorkspaceAnimationSettled();
}

async function capturePanelReveal(query?: string) {
  return browser.execute((query: string | null) => new Promise<number[][]>((done) => {
    const input = document.querySelector<HTMLInputElement>('[data-testid="note-search-input"]')!;
    const frames: number[][] = [], started = performance.now();
    input.focus({ preventScroll: true });
    if (query !== null) {
      input.value = query;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    const sample = () => {
      const panel = document.querySelector('.search-results-panel');
      const text = panel?.querySelector('.search-result-item span.font-semibold');
      if (panel && text) {
        const rect = panel.getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents(text);
        const textRect = range.getBoundingClientRect();
        const clip = getComputedStyle(panel).clipPath;
        frames.push([parseFloat(clip.match(/inset\((?:calc\()?([-\d.]+)/)?.[1] ?? '0'),
          rect.width, rect.bottom, textRect.left, textRect.top, textRect.width, textRect.height,
          input.closest('.shared-search-bar-shell')!.getBoundingClientRect().width]);
      }
      if (performance.now() - started < 1100)
        requestAnimationFrame(sample);
      else
        done(frames);
    };
    requestAnimationFrame(sample);
  }), query ?? null);
}

function expectStationaryReveal(frames: number[][]) {
  expect(frames.length).toBeGreaterThan(5);
  expect(frames.some(([clip]) => clip > 1 && clip < 99)).toBe(true);
  expect(frames.at(-1)![0]).toBe(0);
  // Only the visible top edge changes; layout, text and the panel base stay fixed.
  for (const column of [1, 2, 3, 4, 5, 6]) {
    expect(Math.max(...frames.map(frame => frame[column])) - Math.min(...frames.map(frame => frame[column]))).toBeLessThanOrEqual(1);
  }
  expect(Math.abs(frames.at(-1)![1] - frames.at(-1)![7])).toBeLessThanOrEqual(1);
}

describe('search result layout', () => {
  beforeEach(resetBrowserWorkspace);

  it('uses the same stationary reveal and collapse when switching between chat and search', async () => {
    await openChat();
    for (const opening of [true, false]) {
      const result = await browser.execute((opening: boolean) => new Promise<{
        frames: number[][];
        removed: boolean;
      }>((done) => {
        const frames: number[][] = [], started = performance.now();
        let panel = document.querySelector<HTMLElement>('.search-results-panel');
        const sample = () => {
          panel ??= document.querySelector<HTMLElement>('.search-results-panel');
          if (panel?.isConnected) {
            const text = panel.querySelector('.search-result-item span.font-semibold')!;
            const rect = panel.getBoundingClientRect(), range = document.createRange();
            range.selectNodeContents(text);
            const textRect = range.getBoundingClientRect();
            let alpha = 1;
            for (let element: HTMLElement | null = panel; element; element = element.parentElement) {
              alpha *= Number(getComputedStyle(element).opacity);
            }
            frames.push([performance.now() - started,
              parseFloat(getComputedStyle(panel).clipPath.match(/inset\((?:calc\()?([-\d.]+)/)?.[1] ?? '0'),
              alpha, rect.width, rect.bottom, textRect.left, textRect.top, textRect.width, textRect.height]);
          }
          if (performance.now() - started < 1100)
            requestAnimationFrame(sample);
          else
            done({ frames, removed: !panel?.isConnected });
        };
        sample();
        document.querySelector<HTMLElement>(`button[aria-label="${opening ? 'Expand search' : 'Expand chat input'}"]`)!.click();
      }), opening);
      const visible = result.frames.filter(frame => frame[1] < 98);
      expect(visible.length).toBeGreaterThan(5);
      expect(visible.every(frame => frame[2] === 1)).toBe(true);
      expect(visible.some(frame => frame[1] > 10 && frame[1] < 90)).toBe(true);
      for (const column of [3, 4, 5, 6, 7, 8]) {
        expect(Math.max(...visible.map(frame => frame[column])) - Math.min(...visible.map(frame => frame[column]))).toBeLessThanOrEqual(1);
      }
      if (opening) {
        expect(result.frames.at(-1)![1]).toBe(0);
        const revealStart = visible[0][0];
        const revealEnd = visible.find(frame => frame[1] === 0)![0];
        expect(revealEnd - revealStart).toBeGreaterThan(290);
        expect(revealEnd - revealStart).toBeLessThan(410);
      }
      else {
        expect(result.frames.at(-1)![1]).toBeGreaterThan(95);
        expect(result.frames.at(-1)![0]).toBeGreaterThan(240);
        expect(result.frames.at(-1)![0]).toBeLessThan(340);
        expect(result.removed).toBe(true);
      }
      await waitForWorkspaceAnimationSettled();
    }
  });

  it('reveals upward from the existing base at final width while the search bar expands', async () => {
    for (const width of [1440, 500]) {
      await browser.setWindowSize(width, 900);
      // Let responsive layout and ResizeObservers commit before capturing motion.
      await browser.execute(() => new Promise<void>((done) => {
        requestAnimationFrame(() => requestAnimationFrame(() => done()));
      }));
      await waitForWorkspaceAnimationSettled();
      const frames = await capturePanelReveal();
      expectStationaryReveal(frames);
      if (width === 1440) {
        expect(Math.max(...frames.map(frame => frame[7])) - Math.min(...frames.map(frame => frame[7]))).toBeGreaterThan(40);
      }
      await browser.execute(() => document.querySelector<HTMLInputElement>('[data-testid="note-search-input"]')!
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
      await waitForWorkspaceAnimationSettled();
    }
  });

  it('reveals arriving results without moving or rewrapping their text', async () => {
    await browser.execute(() => {
      const note = window.__GNEAUXGHTS_E2E__!.snapshot().notes[0];
      Object.assign(window.__GNEAUXGHTS_E2E_COMMANDS__!, {
        search_notes_hybrid: async () => {
          await new Promise(resolve => setTimeout(resolve, 100));
          return [{
            noteId: note.noteId, notePath: note.path, fileName: 'Astrophotography',
            sectionLabel: 'Image processing', excerpt: 'Stack exposures to reduce noise and recover faint details across the sky.',
            matchText: 'Stack exposures to reduce noise.', highlightRanges: [],
            reasonLabels: ['semantic'], lexicalScore: null, semanticScore: 0.9,
            startLine: 1, endLine: 1, blockAnchor: null
          }];
        },
        search_media: () => []
      });
    });
    await $('[data-testid="note-search-input"]').click();
    await $('button[aria-label="Search all notes"]').click();
    await waitForWorkspaceAnimationSettled();
    expectStationaryReveal(await capturePanelReveal('exposures'));
  });

  it('collapses back to its base on close without moving the text or resizing with the bar', async () => {
    for (const width of [1440, 500]) {
      await browser.setWindowSize(width, 900);
      await $('[data-testid="note-search-input"]').click();
      await waitForWorkspaceAnimationSettled();
      const result = await browser.execute(() => new Promise<{
        frames: number[][];
        removed: boolean;
        inert: boolean;
      }>((done) => {
        const input = document.querySelector<HTMLInputElement>('[data-testid="note-search-input"]')!;
        const panel = document.querySelector<HTMLElement>('.search-results-panel')!;
        const text = panel.querySelector('.search-result-item span.font-semibold')!;
        const frames: number[][] = [], started = performance.now();
        let inert = false;
        const samplePanel = () => {
          if (!panel.isConnected)
            return;
          const rect = panel.getBoundingClientRect(), range = document.createRange();
          range.selectNodeContents(text);
          const textRect = range.getBoundingClientRect();
          frames.push([parseFloat(getComputedStyle(panel).clipPath.match(/inset\((?:calc\()?([-\d.]+)/)?.[1] ?? '0'),
            rect.width, rect.bottom, textRect.left, textRect.top, textRect.width, textRect.height]);
          inert ||= panel.inert;
        };
        samplePanel();
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        const sample = () => {
          samplePanel();
          if (performance.now() - started < 750)
            requestAnimationFrame(sample);
          else
            done({ frames, removed: !panel.isConnected, inert });
        };
        requestAnimationFrame(sample);
      }));
      expect(result.frames.length).toBeGreaterThan(5);
      expect(result.frames.some(([clip]) => clip > 1 && clip < 99)).toBe(true);
      expect(result.frames.at(-1)![0]).toBeGreaterThan(95);
      for (const column of [1, 2, 3, 4, 5, 6]) {
        expect(Math.max(...result.frames.map(frame => frame[column])) - Math.min(...result.frames.map(frame => frame[column]))).toBeLessThanOrEqual(1);
      }
      expect(result.removed).toBe(true);
      expect(result.inert).toBe(true);
      await waitForWorkspaceAnimationSettled();
    }
  });

  it('shows the complete panel immediately with reduced motion', async () => {
    try {
      await browser.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
      const clip = await browser.execute(() => new Promise<string>((done) => {
        document.querySelector<HTMLInputElement>('[data-testid="note-search-input"]')!.focus({ preventScroll: true });
        requestAnimationFrame(() => requestAnimationFrame(() => done(getComputedStyle(document.querySelector('.search-results-panel')!).clipPath)));
      }));
      expect(clip).toBe('none');
      const removed = await browser.execute(() => new Promise<boolean>((done) => {
        document.querySelector<HTMLInputElement>('[data-testid="note-search-input"]')!
          .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        requestAnimationFrame(() => requestAnimationFrame(() => done(!document.querySelector('.search-results-panel'))));
      }));
      expect(removed).toBe(true);
    } finally {
      await browser.sendCommand('Emulation.setEmulatedMedia', { features: [] });
    }
  });

  it('reverses a partial collapse without duplicating the panel or snapping the reveal', async () => {
    for (const chat of [false, true]) {
      if (chat) {
        await openChat();
        await $('button[aria-label="Expand search"]').click();
      } else await $('[data-testid="note-search-input"]').click();
      await waitForWorkspaceAnimationSettled();
      const result = await browser.execute((chat: boolean) => new Promise<{
        frames: number[][];
        reused: boolean;
      }>((done) => {
        const input = document.querySelector<HTMLInputElement>('[data-testid="note-search-input"]')!;
        const panel = document.querySelector('.search-results-panel')!;
        const frames: number[][] = [], started = performance.now();
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        setTimeout(() => {
          if (chat)
            document.querySelector<HTMLElement>('button[aria-label="Expand search"]')!.click();
          else
            input.focus({ preventScroll: true });
        }, 200);
        const sample = () => {
          const current = document.querySelector('.search-results-panel');
          const rect = current?.getBoundingClientRect();
          frames.push([performance.now() - started,
            current ? parseFloat(getComputedStyle(current).clipPath.match(/inset\((?:calc\()?([-\d.]+)/)?.[1] ?? '0') : 100,
            document.querySelectorAll('.search-results-panel').length, rect?.left ?? 0, rect?.bottom ?? 0]);
          if (performance.now() - started < 1000)
            requestAnimationFrame(sample);
          else
            done({ frames, reused: panel === document.querySelector('.search-results-panel') });
        };
        requestAnimationFrame(sample);
      }), chat);
      expect(result.frames.some(([, clip]) => clip > 10 && clip < 99)).toBe(true);
      expect(result.frames.every(([, , count]) => count === 1)).toBe(true);
      for (let index = 1; index < result.frames.length; index++) {
        const [time, clip] = result.frames[index], [previousTime, previousClip] = result.frames[index - 1];
        expect(Math.abs(clip - previousClip) / (time - previousTime)).toBeLessThan(2);
      }
      expect(result.frames.at(-1)![1]).toBe(0);
      expect(result.reused).toBe(true);
      for (const column of [3, 4]) {
        expect(Math.max(...result.frames.map(frame => frame[column])) - Math.min(...result.frames.map(frame => frame[column]))).toBeLessThanOrEqual(1);
      }
    }
  });

  it('keeps long section labels and titles inside their result without overlapping', async () => {
    const section = 'Code #astrophotography #image processing #siril #lightroom';
    const title = 'Astrophotography';
    await browser.execute(({ title, section }) => {
      const note = window.__GNEAUXGHTS_E2E__!.snapshot().notes[0];
      Object.assign(window.__GNEAUXGHTS_E2E_COMMANDS__!, {
        search_notes_hybrid: () => [{
          noteId: note.noteId, notePath: note.path, fileName: title,
          sectionLabel: section, excerpt: 'Stack exposures to reduce noise.',
          matchText: 'Stack exposures to reduce noise.', highlightRanges: [],
          reasonLabels: ['semantic'], lexicalScore: null, semanticScore: 0.9,
          startLine: 1, endLine: 1, blockAnchor: null
        }],
        search_media: () => []
      });
    }, { title, section });
    const input = await $('[data-testid="note-search-input"]');
    await input.click();
    await $('button[aria-label="Search all notes"]').click();
    await input.setValue('exposures');
    const result = await $(`button[aria-label="Open search result: ${title}"]`);
    await result.waitForDisplayed();
    for (const width of [1440, 500]) {
      await browser.setWindowSize(width, 900);
      await browser.waitUntil(() => browser.execute((title) => {
        const result = Array.from(document.querySelectorAll<HTMLButtonElement>('button.search-result-item'))
          .find(item => item.getAttribute('aria-label') === `Open search result: ${title}`)!;
        const spans = Array.from(result.querySelectorAll('span'));
        const titleEl = spans.find(span => span.textContent?.trim() === title)!;
        const sectionEl = spans.find(span => span.textContent?.trim().startsWith('Code #'))!;
        const titleRect = titleEl.getBoundingClientRect();
        const sectionRect = sectionEl.getBoundingClientRect();
        const resultRect = result.getBoundingClientRect();
        const separate = titleRect.right <= sectionRect.left || sectionRect.right <= titleRect.left
          || titleRect.bottom <= sectionRect.top || sectionRect.bottom <= titleRect.top;
        return separate && titleRect.width > 80 && titleRect.left >= resultRect.left
          && titleRect.right <= resultRect.right + 1 && sectionRect.left >= resultRect.left
          && sectionRect.right <= resultRect.right + 1 && result.scrollWidth <= result.clientWidth + 1;
      }, title), { timeout: 1500, timeoutMsg: 'Title and section must be readable, separate and contained' });
    }
    expect(await result.getText()).toContain('SEMANTIC');
    await browser.saveScreenshot('/private/tmp/gemma-search-result-layout.png');
  });
});
