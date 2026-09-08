import { browser, $, expect } from '@wdio/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { invoke, interaction, report } from '../../support/timelineNativeMetrics';

const fixture = JSON.parse(readFileSync(join(process.env.GNEAUXGHTS_RELEASE_SCALE_RUN!, 'data/release-window-fixture.json'), 'utf8')) as {
  kind: string; notes: { title: string; noteId: string; bytes: number; windows: number }[];
};
if (fixture.kind !== 'gneauxghts-editing-window-v3') throw new Error('A distinct windowed fixture is required');

describe('Optimized native finalized Editing Window fixture', () => {
  before(async () => { await browser.switchToWindow('main'); });
  it('pages immutable windows and paints their net differences', async () => {
    await browser.setTimeout({ script: 180_000 });
    await $('a[aria-label="Gneauxght"]').waitForExist({ timeout: 120_000 });
    const results: number[] = [];
    for (const note of fixture.notes.filter(n => n.bytes === 1048576)) {
      const page = await invoke<{ records: { timeKind: string }[] }>('get_note_history_page', { noteId: note.noteId, cursor: null, limit: 30 });
      expect(page.records.every(r => r.timeKind === 'editingWindow')).toBe(true);
      await invoke('mark_note_opened', { noteId: note.noteId });
      await browser.refresh();
      await browser.waitUntil(async () => (await $('[data-testid="note-title"]').getValue()) === note.title, { timeout: 30_000 });
      const entries: number[] = []; const pages: number[] = []; const diffs: number[] = [];
      for (let sample = 0; sample < 5; sample++) {
        entries.push(await interaction('entry'));
        pages.push(await interaction('page'));
        expect(await browser.execute(() => document.querySelectorAll('[data-revision-id]').length)).toBe(41);
        const revision = await browser.execute(() => [...document.querySelectorAll<HTMLElement>('[data-revision-id]')].find(b => b.getAttribute('aria-pressed') !== 'true')!.dataset.revisionId!);
        diffs.push(await interaction('diff', revision));
        await $('button[aria-label="Back to workspace"]').click();
        await $('[data-testid="history-mode"]').waitForExist({ reverse: true });
      }
      results.push(report(`${note.title}_entry`, entries), report(`${note.title}_page30`, pages), report(`${note.title}_diff`, diffs));
    }
    for (const p95 of results) expect(p95).toBeLessThan(250);
  });
});
