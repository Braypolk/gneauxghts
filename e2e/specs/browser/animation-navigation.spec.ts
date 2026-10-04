import { browser, expect, $ } from '@wdio/globals';
import { resetBrowserWorkspace, openRecentNote, waitForNote } from '../../support/browserWorkspace';

async function ready() {
  await resetBrowserWorkspace();
}

describe('navigation motion ownership', () => {
  it('reveals a task destination outside the mounted editor viewport after route navigation', async () => {
    await ready();
    const target = 'Offscreen task destination canary';
    const markdown = Array.from({ length: 350 }, (_, i) => `Paragraph ${i} fills the long note.`).join('\n\n') + `\n\n- [ ] ${target}`;
    await browser.executeAsync(async (body: string, done: (error: string | null) => void) => {
      try {
        await window.__TAURI_INTERNALS__.invoke('save_note', { currentPath: '/e2e/alpha.md', title: 'Alpha note', markdown: body });
        done(null);
      } catch (error) { done(String(error)); }
    }, markdown).then(error => expect(error).toBeNull());
    await openRecentNote('Beta note');
    await openRecentNote('Alpha note');
    expect(await browser.execute((text: string) => document.querySelector('[data-testid="note-editor"] .cm-content')!.textContent!.includes(text), target)).toBe(false);
    await $('a[href="/list"]').click();
    const task = await $(`button[aria-label="Open task: ${target}"]`);
    await task.waitForClickable();
    await task.click();
    await waitForNote('Alpha note');
    await browser.waitUntil(async () => browser.execute((text: string) => {
      const root = document.querySelector<HTMLElement>('[data-testid="note-editor"]')!;
      const scroller = root.querySelector<HTMLElement>('.cm-scroller')!;
      const line = [...root.querySelectorAll<HTMLElement>('.cm-line')].find(line => line.textContent?.includes(text));
      if (!line) return false;
      const viewport = scroller.getBoundingClientRect();
      const destination = line.getBoundingClientRect();
      return scroller.scrollTop > 0 && destination.top >= viewport.top && destination.bottom <= viewport.bottom;
    }, target), { timeoutMsg: 'Expected the unmounted task destination to become visible in the editor viewport' });
    expect(await browser.execute(() => window.__GNEAUXGHTS_E2E__!.snapshot().notes.find(note => note.noteId === 'note-alpha')!.markdown)).toBe(markdown);
  });

});
