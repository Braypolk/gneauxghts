import { browser, $, expect } from '@wdio/globals';

// Reviewed export from manual-note-title. Synthetic provider + memory-only IPC;
// canonical native transport and authority have separate contract coverage.
const title = () => $('[data-testid="note-title"]');
const generate = () => $('button[aria-label="Generate title"]');
async function clearTitle() {
  // clearValue alone does not dispatch input when it empties this controlled field.
  await title().setValue('x');
  await browser.keys('Backspace');
  await expect(generate()).toBeDisplayed();
}
async function respond(text) {
  await browser.execute(async value => window.__GNEAUXGHTS_E2E__.setNextPiResponse(value), text);
}

describe('Manual note titles', () => {
  beforeEach(async () => {
    await browser.url('/__gneauxghts_e2e_reset');
    await browser.execute(() => { localStorage.clear(); sessionStorage.clear(); });
    await browser.setViewport({ width: 1440, height: 1000, devicePixelRatio: 1 });
    await browser.url('/');
    await expect(title()).toHaveValue('Alpha note');
  });

  it('appears for an empty title and saves a generated title without changing the body or opening chat', async () => {
    await expect(generate()).not.toExist();
    const source = await browser.execute(() => window.__GNEAUXGHTS_E2E__.snapshot().notes.find(note => note.noteId === 'note-alpha').markdown);
    await clearTitle();
    await respond('Garden Irrigation Plan');
    await generate().click();
    await expect(title()).toHaveValue('Garden Irrigation Plan');
    await expect(generate()).not.toExist();
    await browser.waitUntil(async () => browser.execute(() => window.__GNEAUXGHTS_E2E__.snapshot().notes.some(note => note.noteId === 'note-alpha' && note.title === 'Garden Irrigation Plan')));
    const saved = await browser.execute(() => window.__GNEAUXGHTS_E2E__.snapshot().notes.find(note => note.noteId === 'note-alpha'));
    expect(saved.markdown).toBe(source);
    expect(await browser.execute(async () => window.__GNEAUXGHTS_E2E__.readPiChat())).toEqual([]);
  });

  it('reports invalid output and allows a successful retry', async () => {
    await clearTitle();
    await respond('Title\nUnwanted explanation');
    await generate().click();
    await expect($('[role="alert"]')).toHaveText('The model did not return a short title. Try again.');
    await expect(generate()).toBeEnabled();
    await expect(title()).toHaveValue('');
    await respond('Garden Irrigation Plan');
    await generate().click();
    await expect(title()).toHaveValue('Garden Irrigation Plan');
    await expect($('[role="alert"]')).not.toExist();
  });

  it('lets a typed title win over an in-flight request', async () => {
    await clearTitle();
    await browser.execute(async () => window.__GNEAUXGHTS_E2E__.holdNextPiResponse());
    await generate().click();
    await expect(generate()).toHaveAttribute('aria-busy', 'true');
    await title().setValue('My chosen title');
    await expect(generate()).not.toExist();
    await $('.cm-content').click();
    await expect(title()).toHaveValue('My chosen title');
    await browser.execute(async () => window.__GNEAUXGHTS_E2E__.releaseHeldPiResponse('A late generated title'));
    await expect(title()).toHaveValue('My chosen title');
    await browser.waitUntil(async () => browser.execute(() => window.__GNEAUXGHTS_E2E__.snapshot().notes.some(note => note.title === 'My chosen title')));
    expect(await browser.execute(async () => window.__GNEAUXGHTS_E2E__.readPiChat())).toEqual([]);
  });

  it('supports keyboard activation on mobile and disables generation for a new empty note', async () => {
    await browser.setViewport({ width: 390, height: 844, devicePixelRatio: 1 });
    await clearTitle();
    await respond('Garden Irrigation Plan');
    await browser.keys('Tab');
    await expect(generate()).toBeFocused();
    await browser.keys('Enter');
    await expect(title()).toHaveValue('Garden Irrigation Plan');
    await $('button[aria-label="New Idea. Start a blank note in this pane."]').click();
    await expect(title()).toHaveValue('');
    await expect(generate()).toBeDisplayed();
    await expect(generate()).toBeDisabled();
  });
});
