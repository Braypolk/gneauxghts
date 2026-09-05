import { browser, $, expect } from '@wdio/globals';

declare global {
  interface Window {
    __TAURI_INTERNALS__: { invoke<T>(command: string, args: Record<string, unknown>): Promise<T> };
  }
}

async function invoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  const result = await browser.executeAsync((command, args, done: (result: { value?: T; error?: string }) => void) => {
    void window.__TAURI_INTERNALS__.invoke<T>(command, args).then(
      value => done({ value }), error => done({ error: JSON.stringify(error) })
    );
  }, command, args);
  if (result.error) throw new Error(result.error);
  return result.value as T;
}

async function interaction(action: 'entry' | 'page' | 'diff', revisionId = '') {
  // WebKit throttles animation frames for an occluded window. Focus before
  // starting the clock; a paint budget requires an actually visible test app.
  await invoke('plugin:window|show', { label: 'main' });
  await invoke('plugin:window|set_focus', { label: 'main' });
  const result = await browser.executeAsync((action, revisionId, done: (value: { elapsed?: number; error?: string }) => void) => {
    let stage = 'mutation';
    const timeout = setTimeout(() => done({ error: `${action} stalled at ${stage}; visibility=${document.visibilityState}; history=${!!document.querySelector('[data-testid=history-mode]')}; rows=${document.querySelectorAll('[data-diff-kind]').length}: ${document.body.innerText.slice(-600)}` }), 15_000);
    const before = document.querySelector('aside[aria-label="Note timeline"]')?.textContent;
    const button = action === 'entry'
      ? document.querySelector<HTMLButtonElement>('button[aria-label="Open note history"]')
      : action === 'page'
        ? [...document.querySelectorAll<HTMLButtonElement>('aside button')].find(b => b.textContent?.trim() === 'Load older history')
        : document.querySelector<HTMLButtonElement>(`[data-revision-id="${revisionId}"]`);
    if (!button || button.disabled) {
      clearTimeout(timeout);
      done({ error: `Missing enabled ${action} action` });
      return;
    }
    const started = performance.now();
    const observer = new MutationObserver(() => {
      const ready = action === 'page'
        ? document.querySelector('aside[aria-label="Note timeline"]')?.textContent !== before && !button.disabled
        : !!document.querySelector('[data-testid="history-mode"] [data-testid="historical-revision-diff"] [data-diff-kind]') &&
          (action === 'entry' || (button.getAttribute('aria-pressed') === 'true' && !button.disabled));
      if (!ready) return;
      observer.disconnect();
      stage = 'paint';
      requestAnimationFrame(() => requestAnimationFrame(() => {
        clearTimeout(timeout);
        done({ elapsed: performance.now() - started });
      }));
    });
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
    button.click();
  }, action, revisionId);
  if (result.error) throw new Error(result.error);
  return result.elapsed!;
}

function report(name: string, samples: number[]) {
  const ordered = [...samples].sort((a, b) => a - b);
  const p95 = ordered[Math.ceil(ordered.length * .95) - 1];
  console.log('RELEASE_NATIVE_METRIC', JSON.stringify({ name, samples: ordered.length,
    p50_ms: ordered[Math.floor(ordered.length / 2)], p95_ms: p95, max_ms: ordered.at(-1),
    budget_ms: 250, passed: p95 < 250, raw_ms: samples,
    scope: 'optimized native Rust + IPC + production frontend + two animation frames' }));
  return p95;
}

describe('Optimized native Note Timeline at retained vault scale', () => {
  before(async () => { await browser.switchToWindow('main'); });
  it('measures paging and historical diff interactions through IPC and paint', async () => {
    await browser.setTimeout({ script: 180_000 });
    await $('a[aria-label="Gneauxght"]').waitForExist({ timeout: 120_000 });
    // Mandatory cold attestation settles before measuring ordinary warm interactions.
    await invoke('get_note_history_page', { noteId: 'release-seed-0', cursor: null, limit: 30 });
    const results: number[] = [];
    for (const label of ['64k_at_100000', '1mb_at_100129']) {
      let noteId = 'release-seed-0';
      let title = 'Seed 0';
      if (label.startsWith('1mb')) {
        title = 'Native large scale';
        let path: string | null = null;
        for (let revision = 0; revision <= 128; revision++) {
          const body = (`Revision ${String(revision).padStart(8, '0')}\n` +
            'A repeatable Markdown line with enough text to exercise the production codec.\n'.repeat(14_000)).slice(0, 1024 * 1024);
          const saved: { noteId: string; path: string; commitWarning: unknown } = await invoke('save_note', { title, markdown: body, currentPath: path });
          expect(saved.commitWarning).toBeFalsy();
          path = saved.path;
          noteId = saved.noteId;
        }
      }
      await invoke('mark_note_opened', { noteId: noteId });
      await browser.refresh();
      await browser.waitUntil(async () => (await $('[data-testid="note-title"]').getValue()) === title, { timeout: 30_000 });
      const entries: number[] = [];
      const pages: number[] = [];
      const diffs: number[] = [];
      for (let sample = 0; sample < 5; sample++) {
        console.log('RELEASE_NATIVE_PROGRESS', label, sample, 'entry');
        entries.push(await interaction('entry'));
        console.log('RELEASE_NATIVE_SAMPLE', label, 'entry', entries.at(-1));
        console.log('RELEASE_NATIVE_PROGRESS', label, sample, 'page');
        pages.push(await interaction('page'));
        console.log('RELEASE_NATIVE_SAMPLE', label, 'page', pages.at(-1));
        await browser.execute(() => {
          document.querySelector<HTMLButtonElement>('button[aria-label="Expand Editing Session"]')?.click();
        });
        const revisionId = await browser.execute(() =>
          [...document.querySelectorAll<HTMLElement>('[data-revision-id]')]
            .find(b => b.getAttribute('aria-pressed') !== 'true')!.dataset.revisionId!
        );
        console.log('RELEASE_NATIVE_PROGRESS', label, sample, 'diff');
        diffs.push(await interaction('diff', revisionId));
        console.log('RELEASE_NATIVE_SAMPLE', label, 'diff', diffs.at(-1));
        await $('button[aria-label="Back to workspace"]').click();
        await $('[data-testid="history-mode"]').waitForExist({ reverse: true });
        await browser.executeAsync((done: () => void) => {
          requestAnimationFrame(() => requestAnimationFrame(() => done()));
        });
      }
      results.push(...[report(`entry_${label}`, entries), report(`page_30_${label}`, pages), report(`diff_${label}`, diffs)]);
    }
    for (const p95 of results) expect(p95).toBeLessThan(250);
  });
});
