import { browser, $ } from '@wdio/globals';

/** Reset durable client state before reloading the in-memory backend and app. */
export async function resetBrowserWorkspace() {
  // The inert public document establishes the app origin without mounting owners
  // which could write old cursor/settings values back after storage is cleared.
  await browser.setWindowSize(1440, 1000);
  await browser.url('/__gneauxghts_e2e_reset');
  await browser.execute(() => {
    if (document.title !== 'E2E storage reset') throw new Error('Expected inert E2E reset document');
    localStorage.clear(); sessionStorage.clear();
  });
  await browser.url('/');
  await waitForNote('Alpha note');
}

export async function openHistoryShortcut() {
  await browser.execute(() => {
    (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', {
      key: 'H', code: 'KeyH', metaKey: true, shiftKey: true, bubbles: true, cancelable: true
    }));
  });
}

export async function waitForNote(title: string) {
  const input = await $('[data-testid="note-title"]');
  try {
    // Cold Vite module loading can exceed the ordinary interaction timeout.
    await input.waitForDisplayed({ timeout: 30_000 });
  } catch (error) {
    const pageText = await browser.execute(() => document.body.innerText);
    throw new Error(`Note editor did not render. Page text: ${pageText}`, {
      cause: error
    });
  }
  await browser.waitUntil(async () => (await input.getValue()) === title, {
    timeoutMsg: `Expected active note title to become ${title}`
  });
  await $('[data-testid="note-editor"][aria-busy="false"]').waitForExist();
}

export async function openRecentNote(title: string) {
  const search = await $('[data-testid="note-search-input"]');
  await search.click();
  const allNotes = await $('button[aria-label="Search all notes"]');
  await allNotes.waitForExist();
  await browser.execute((element: HTMLElement) => element.click(), allNotes);
  await search.setValue(title);
  const result = await $(`button[aria-label="Open search result: ${title}.md"]`);
  await result.waitForExist();
  await browser.execute((element: HTMLElement) => element.click(), result);
  await waitForNote(title);
}

export async function editorText() {
  const editor = await $('[data-testid="note-editor"] .cm-content');
  await editor.waitForDisplayed();
  return editor.getText();
}

export async function setEditorSelection(anchor: number, head: number) {
  const content = await $('[data-testid="note-editor"] .cm-content');
  await content.click();
  await browser.keys(['Meta', 'a', '\uE000']);
  await browser.keys('ArrowLeft');
  if (anchor > 0) await browser.keys(Array.from({ length: anchor }, () => 'ArrowRight'));
  const distance = head - anchor;
  if (distance > 0) {
    await browser.keys([
      'Shift',
      ...Array.from({ length: distance }, () => 'ArrowRight'),
      '\uE000'
    ]);
  } else if (distance < 0) {
    await browser.keys([
      'Shift',
      ...Array.from({ length: -distance }, () => 'ArrowLeft'),
      '\uE000'
    ]);
  }
  await browser.pause(60);
  return { anchor, head };
}

export async function readEditorSelection() {
  const content = await $('[data-testid="note-editor"] .cm-content');
  return browser.execute((element: HTMLElement) => {
    const selection = window.getSelection();
    if (
      !selection?.anchorNode ||
      !selection.focusNode ||
      !element.contains(selection.anchorNode) ||
      !element.contains(selection.focusNode)
    ) {
      return null;
    }
    return {
      anchor: selection.anchorOffset,
      head: selection.focusOffset
    };
  }, content);
}
