import { browser, expect, $ } from '@wdio/globals';
import { resetBrowserWorkspace } from '../../support/browserWorkspace';

interface FrameSample {
  loadingIndicatorVisible: boolean;
  raw: (string | null)[];
  headings: { text: string; top: number }[];
  scrollTop: number;
  visible: boolean;
}

async function samplePresentation(actionSelector: string) {
  const result = await browser.execute((selector: string) => new Promise<{
    samples: FrameSample[];
    error?: string;
  }>((done) => {
    const samples: FrameSample[] = [];
    const started = performance.now();
    let frame = 0;
    let finished = false;
    const finish = (error?: string) => {
      if (finished)
        return;
      finished = true;
      cancelAnimationFrame(frame);
      clearTimeout(deadline);
      done({ samples, ...(error ? { error } : {}) });
    };
    // Observe first reveal and the deliberately delayed700ms parser pass. This
    // is a bounded observation window, not an assertion of eventual convergence.
    const deadline = window.setTimeout(() => finish('Formatting observation did not receive animation frames within5s'), 5000);
    function sample() {
      try {
        const scroller = document.querySelector<HTMLElement>('[data-testid="note-editor"] .cm-scroller');
        if (scroller) {
          const rect = scroller.getBoundingClientRect();
          const headings = [...scroller.querySelectorAll<HTMLElement>('.cm-line')].filter(line => {
            const r = line.getBoundingClientRect();
            return line.textContent?.includes('Diagnostic heading') && r.bottom > rect.top && r.top < rect.bottom;
          });
          if (headings.length)
            samples.push({
              loadingIndicatorVisible: [...document.querySelectorAll<HTMLElement>('span')].some(span => span.textContent?.trim() === 'Loading editor' && getComputedStyle(span).visibility === 'visible'),
              raw: headings.filter(line => !line.classList.contains('cm-gn-line-h2')).map(line => line.textContent),
              headings: headings.map(line => ({ text: line.textContent!, top: line.getBoundingClientRect().top })),
              scrollTop: scroller.scrollTop,
              visible: getComputedStyle(scroller).visibility === 'visible'
            });
        }
        if (performance.now() - started < 1200)
          frame = requestAnimationFrame(sample);
        else
          finish();
      }
      catch (error) {
        finish(String(error));
      }
    }
    frame = requestAnimationFrame(sample);
    try {
      document.querySelector<HTMLButtonElement>(selector)!.click();
    }
    catch (error) {
      finish(String(error));
    }
  }), actionSelector);
  expect(result.error).toBeUndefined();
  return result.samples;
}

function expectFormattedAndStable(frames: FrameSample[]) {
  const visible = frames.filter(frame => frame.visible);
  expect(visible.length).toBeGreaterThan(0);
  expect(visible.some(frame => frame.raw.length > 0)).toBe(false);
  const anchor = visible[0].headings[1] ?? visible[0].headings[0];
  expect(anchor).toBeDefined();
  // Compare the reading position: CodeMirror may adjust scrollTop as it replaces
  // estimated heights elsewhere in a large document.
  for (const frame of visible) {
    const sameHeading = frame.headings.find(heading => heading.text === anchor.text);
    expect(sameHeading).toBeDefined();
    expect(Math.abs(sameHeading!.top - anchor.top)).toBeLessThanOrEqual(2);
  }
}

async function seedLongNoteAndOpenBeta(sections = 220) {
  await resetBrowserWorkspace();
  await $('[data-testid="note-editor"] .cm-content').waitForDisplayed({ timeout: 30_000 });
  const body = Array.from({ length: sections }, (_, i) => [
    `## Diagnostic heading ${i}`, '',
    `Paragraph ${i} with **bold text**, *italic text*, ~~struck text~~, and ***nested emphasis*** with a [link](https://example.com).`
  ].join('\n')).join('\n\n');
  await browser.execute((markdown: string) => new Promise<void>((done) => {
    const w = window as typeof window & {
      __TAURI_INTERNALS__: {
        invoke: (command: string, args: object) => Promise<unknown>;
      };
    };
    w.__TAURI_INTERNALS__.invoke('save_note', {
      title: 'Alpha note', markdown, currentPath: '/e2e/alpha.md'
    }).then(() => done());
  }), body);
  const search = await $('[data-testid="note-search-input"]');
  await search.click();
  await $('button[aria-label="Search all notes"]').click();
  await search.setValue('Beta note');
  await $('button[aria-label="Open search result: Beta note.md"]').waitForExist();
  await browser.keys('Enter');
  await browser.waitUntil(async () => (await $('[data-testid="note-title"]').getValue()) === 'Beta note');
  await $('[data-testid="note-editor"][aria-busy="false"]').waitForExist();
  return body;
}

async function prepareAlphaResult(position: { anchor: number; head: number; scrollTop?: number }) {
  await browser.execute((saved: typeof position) => {
    localStorage.setItem('gneauxghts:notepad-cursors:v1', JSON.stringify({
      'default::/e2e/alpha.md': { ...saved, updatedAtMillis: Date.now() }
    }));
  }, position);
  const search = await $('[data-testid="note-search-input"]');
  await search.click();
  await search.setValue('Alpha note');
  await $('button[aria-label="Open search result: Alpha note.md"]').waitForExist();
}

describe('note formatting on load', () => {
  afterEach(async () => {
    await browser.execute(() => {
      const restore = (window as typeof window & { __restoreFormattingIdle?: () => void }).__restoreFormattingIdle;
      restore?.();
    });
  });

  it('renders bold, italic and strike styles on actual text and nested syntax spans', async () => {
    await seedLongNoteAndOpenBeta(1);
    await prepareAlphaResult({ anchor: 0, head: 0, scrollTop: 0 });
    await $('button[aria-label="Open search result: Alpha note.md"]').click();
    await $('[data-testid="note-editor"][aria-busy="false"]').waitForExist();
    await $('.cm-gn-strikethrough').waitForDisplayed();
    const styles = await browser.execute(() => {
      const leaf = (selector: string) => {
        const mark = document.querySelector<HTMLElement>(selector)!;
        return [...mark.querySelectorAll<HTMLElement>('*')].find(element => element.childElementCount === 0) ?? mark;
      };
      const strong = leaf('.cm-gn-strong');
      const italic = leaf('.cm-gn-emphasis');
      const strike = leaf('.cm-gn-strikethrough');
      const nested = [...document.querySelectorAll<HTMLElement>('.cm-gn-strong, .cm-gn-emphasis')]
        .flatMap(mark => [mark, ...mark.querySelectorAll<HTMLElement>('*')])
        .find(element => element.childElementCount === 0 && element.textContent === 'nested emphasis')!;
      return {
        strong: { text: strong.textContent, weight: getComputedStyle(strong).fontWeight },
        italic: { text: italic.textContent, style: getComputedStyle(italic).fontStyle },
        strike: { text: strike.textContent, decoration: getComputedStyle(strike).textDecorationLine },
        nested: { text: nested.textContent, weight: getComputedStyle(nested).fontWeight, style: getComputedStyle(nested).fontStyle }
      };
    });
    expect(styles.strong).toEqual({ text: 'bold text', weight: '700' });
    expect(styles.italic).toEqual({ text: 'italic text', style: 'italic' });
    expect(styles.strike.text).toBe('struck text');
    expect(styles.strike.decoration).toContain('line-through');
    expect(styles.nested).toEqual({ text: 'nested emphasis', weight: '700', style: 'italic' });
  });
  it('shows a short note without flashing the loading indicator', async () => {
    await seedLongNoteAndOpenBeta(1);
    await prepareAlphaResult({ anchor: 0, head: 0, scrollTop: 0 });
    const frames = await samplePresentation('button[aria-label="Open search result: Alpha note.md"]');
    expectFormattedAndStable(frames);
    expect(frames.some(frame => frame.loadingIndicatorVisible)).toBe(false);
  });

  it('shows a formatted, stable viewport when restoring a deep cursor', async () => {
    const body = await seedLongNoteAndOpenBeta();
    const anchor = body.indexOf('Diagnostic heading 120');
    await prepareAlphaResult({ anchor, head: anchor });
    const frames = await samplePresentation('button[aria-label="Open search result: Alpha note.md"]');
    expectFormattedAndStable(frames);
    expect(frames.find(frame => frame.visible)!.headings.some(heading => heading.text.includes('Diagnostic heading 120'))).toBe(true);
  });

  it('restores saved scroll independently of the cursor, even with delayed background parsing', async () => {
    await seedLongNoteAndOpenBeta();
    await prepareAlphaResult({ anchor: 0, head: 0, scrollTop: 9600 });
    // Leave the real parser intact; delay only its idle scheduler, as on native
    // WebKit where background work can start substantially later.
    await browser.execute(() => {
      const originalRequest = window.requestIdleCallback;
      const originalCancel = window.cancelIdleCallback;
      (window as typeof window & { __restoreFormattingIdle?: () => void }).__restoreFormattingIdle = () => {
        window.requestIdleCallback = originalRequest;
        window.cancelIdleCallback = originalCancel;
        delete (window as typeof window & { __restoreFormattingIdle?: () => void }).__restoreFormattingIdle;
      };
      window.requestIdleCallback = callback => window.setTimeout(() => callback({
        didTimeout: true, timeRemaining: () => 0
      }), 700);
      window.cancelIdleCallback = handle => window.clearTimeout(handle);
    });
    const frames = await samplePresentation('button[aria-label="Open search result: Alpha note.md"]');
    expectFormattedAndStable(frames);
    expect(Math.abs(frames.find(frame => frame.visible)!.scrollTop - 9600)).toBeLessThanOrEqual(2);
  });

  it('keeps a remounted note formatted at its saved reading position', async () => {
    const body = await seedLongNoteAndOpenBeta();
    const anchor = body.indexOf('Diagnostic heading 120');
    await prepareAlphaResult({ anchor, head: anchor });
    await $('button[aria-label="Open search result: Alpha note.md"]').click();
    await $('[data-testid="note-editor"][aria-busy="false"]').waitForExist();
    await $('[data-testid="note-editor"] .cm-content').waitForDisplayed();
    await browser.execute(() => {
      document.querySelector<HTMLElement>('[data-testid="note-editor"] .cm-scroller')!.scrollTop = 9600;
    });
    const openChat = await $('button[aria-label="Open thought partner in this pane"]');
    await openChat.waitForClickable();
    await browser.execute((element: HTMLElement) => element.click(), openChat);
    await $('button[aria-label="Open previous location"]').waitForExist();
    const savedScrollTop = await browser.execute(() => {
      const stored = JSON.parse(localStorage.getItem('gneauxghts:notepad-cursors:v1')!) as
        Record<string, { scrollTop: number; updatedAtMillis: number }>;
      return Object.entries(stored).filter(([key]) => key.endsWith('::/e2e/alpha.md'))
        .sort((a, b) => b[1].updatedAtMillis - a[1].updatedAtMillis)[0][1].scrollTop;
    });
    expect(savedScrollTop).toBeGreaterThan(9000);
    const frames = await samplePresentation('button[aria-label="Open previous location"]');
    expectFormattedAndStable(frames);
    expect(Math.abs(frames.find(frame => frame.visible)!.scrollTop - savedScrollTop)).toBeLessThanOrEqual(2);
  });
});
