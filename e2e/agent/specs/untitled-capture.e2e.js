import { browser, $, expect } from '@wdio/globals';

// Reviewed export from blank-note-title: mounted editor, synthetic Pi, memory-only
// IPC. Rust persistence tests independently cover the canonical capture filename.
const title = () => $('[data-testid="note-title"]');
const generate = () => $('button[aria-label="Generate title"]');
const newIdea = () => $('button[aria-label="New Idea. Start a blank note in this pane."]');
const body = 'Collect rainwater for the tomatoes while we travel next summer.\n\nKeep the full body.';
const fallback = 'Collect rainwater for the tomatoes while we travel';
const savedNote = () => browser.execute(() => window.__GNEAUXGHTS_E2E__.snapshot().notes.find(note => note.noteId === 'note-created-1'));

async function capture(markdown = body) {
  await newIdea().click();
  await expect(title()).toHaveValue('');
  await expect($('[data-testid="note-editor"]')).toHaveAttribute('aria-busy', 'false');
  await expect($('.cm-content')).toBeFocused();
  await $('.cm-content').setValue(markdown);
  await browser.waitUntil(async () => Boolean(await savedNote()));
  await expect(title()).toHaveValue('');
  await expect(generate()).toBeEnabled();
}

describe('Untitled captures', () => {
  beforeEach(async () => {
    await browser.url('/__gneauxghts_e2e_reset');
    await browser.execute(() => { localStorage.clear(); sessionStorage.clear(); });
    await browser.setViewport({ width: 1440, height: 1000, devicePixelRatio: 1 });
    await browser.url('/');
    await expect(title()).toHaveValue('Alpha note');
  });

  it('keeps autosaved content visibly untitled, names on application navigation and reopens the same note', async () => {
    await capture();
    expect((await savedNote()).path).toBe('/e2e/Untitled Note note-created-1.md');
    expect(await browser.execute(() => document.body.innerText)).not.toContain('Untitled Note note-created-1');
    await $('role/link[name="Settings"]').click();
    const named = await savedNote();
    expect(named.title).toBe(fallback);
    expect(named.path).toBe(`/e2e/${fallback}.md`);
    expect(named.markdown).toBe(body);
    await $('a=Gneauxght').click();
    await expect(title()).toHaveValue(fallback);
    expect((await savedNote()).noteId).toBe('note-created-1');
  });

  it('uses the latest body when leaving for a new note and preserves both notes', async () => {
    await capture('Old content for this capture');
    await $('.cm-content').setValue(body);
    await browser.waitUntil(async () => (await savedNote())?.markdown === body);
    await expect(title()).toHaveValue('');
    await newIdea().click();
    await expect(title()).toHaveValue('');
    expect((await savedNote()).title).toBe(fallback);
    expect((await savedNote()).markdown).toBe(body);
    await expect(generate()).toBeDisabled();
  });

  it('commits a focused typed title before keyboard navigation', async () => {
    await capture();
    await title().setValue('My garden notes');
    await expect(title()).toBeFocused();
    await browser.keys(['Meta', ',']);
    await browser.keys('NULL');
    await browser.waitUntil(async () => (await browser.getUrl()).endsWith('/settings'));
    expect((await savedNote()).title).toBe('My garden notes');
    expect((await savedNote()).markdown).toBe(body);
  });

  for (const destination of ['new-note', 'settings']) it(`preserves typing while autosave delays ${destination} navigation`, async () => {
    await capture();
    const updated = 'The latest body remains intact while saving.';
    await browser.execute(() => window.__GNEAUXGHTS_E2E__.holdSave());
    await $('.cm-content').setValue(updated);
    await browser.waitUntil(async () => browser.execute(value => window.__GNEAUXGHTS_E2E__.invocations.some(call =>
      call.command === 'save_note' && call.args.markdown === value), updated));
    if (destination === 'new-note') await newIdea().click();
    else {
      await browser.keys(['Meta', ',']);
      await browser.keys('NULL');
    }
    await title().setValue('My title typed while saving');
    await expect(title()).toBeFocused();
    await browser.execute(() => window.__GNEAUXGHTS_E2E__.releaseSave());
    if (destination === 'new-note') await expect(generate()).toBeDisabled();
    else await browser.waitUntil(async () => (await browser.getUrl()).endsWith('/settings'));
    expect((await savedNote()).title).toBe('My title typed while saving');
    expect((await savedNote()).markdown).toBe(updated);
  });

  it('preserves typing while the departure fallback itself is saving', async () => {
    await capture();
    await browser.execute(() => window.__GNEAUXGHTS_E2E__.holdSave());
    await newIdea().click();
    await browser.waitUntil(async () => browser.execute(value => window.__GNEAUXGHTS_E2E__.invocations.some(call =>
      call.command === 'save_note' && call.args.title === value), fallback));
    await title().setValue('A later typed title wins');
    await browser.execute(() => window.__GNEAUXGHTS_E2E__.releaseSave());
    await expect(generate()).toBeDisabled();
    expect((await savedNote()).title).toBe('A later typed title wins');
    expect((await savedNote()).markdown).toBe(body);
  });

  it('restores fallback naming when a title is typed and cleared during departure saving', async () => {
    await capture();
    await browser.execute(() => window.__GNEAUXGHTS_E2E__.holdSave());
    await newIdea().click();
    await browser.waitUntil(async () => browser.execute(value => window.__GNEAUXGHTS_E2E__.invocations.some(call =>
      call.command === 'save_note' && call.args.title === value), fallback));
    await title().setValue('Temporary title');
    await browser.keys(['Meta', 'a']);
    await browser.keys('NULL');
    await browser.keys('Backspace');
    await expect(title()).toHaveValue('');
    await browser.execute(() => window.__GNEAUXGHTS_E2E__.releaseSave());
    await expect(generate()).toBeDisabled();
    const named = await savedNote();
    expect(named.title).toBe(fallback);
    expect(named.path).toBe(`/e2e/${fallback}.md`);
    expect(named.markdown).toBe(body);
  });

  it('keeps generation running when an unchanged capture finishes autosaving', async () => {
    await newIdea().click();
    await browser.execute(() => window.__GNEAUXGHTS_E2E__.holdSave());
    await $('.cm-content').setValue(body);
    await browser.waitUntil(async () => browser.execute(value => window.__GNEAUXGHTS_E2E__.invocations.some(call => call.command === 'save_note' && call.args.markdown === value), body));
    await browser.execute(async () => window.__GNEAUXGHTS_E2E__.holdNextPiResponse());
    await generate().click();
    await expect(generate()).toHaveAttribute('aria-busy', 'true');
    await browser.execute(() => window.__GNEAUXGHTS_E2E__.releaseSave());
    await browser.waitUntil(async () => Boolean(await savedNote()));
    await expect(generate()).toHaveAttribute('aria-busy', 'true');
    await browser.execute(async () => window.__GNEAUXGHTS_E2E__.releaseHeldPiResponse('Rainwater Garden Plan'));
    await expect(title()).toHaveValue('Rainwater Garden Plan');
    await browser.waitUntil(async () => (await savedNote())?.title === 'Rainwater Garden Plan');
    expect((await savedNote()).markdown).toBe(body);
  });

  for (const mode of ['typed', 'generated']) it(`retains the ${mode} title after departure at compact width`, async () => {
    await browser.setViewport({ width: 390, height: 844, devicePixelRatio: 1 });
    await capture('Plan a small kitchen herb garden near the window.');
    if (mode === 'typed') {
      await title().setValue('Kitchen Herb Garden');
      await $('.cm-content').click();
    } else {
      await browser.execute(async () => window.__GNEAUXGHTS_E2E__.setNextPiResponse('Kitchen Herb Garden'));
      await generate().click();
    }
    await expect(title()).toHaveValue('Kitchen Herb Garden');
    await browser.waitUntil(async () => (await savedNote())?.title === 'Kitchen Herb Garden');
    await newIdea().click();
    expect((await savedNote()).title).toBe('Kitchen Herb Garden');
    expect((await savedNote()).markdown).toBe('Plan a small kitchen herb garden near the window.');
    expect(await browser.execute(async () => window.__GNEAUXGHTS_E2E__.readPiChat())).toEqual([]);
  });
});
