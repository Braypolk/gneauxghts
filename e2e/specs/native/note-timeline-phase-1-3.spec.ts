import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { browser, expect, $, $$ } from '@wdio/globals';
import type { NoteSession } from '../../../src/lib/features/notepad/model/types';
import type {
  HistoricalRevision,
  HistoryModePage,
  HistoryRevisionRecord
} from '../../../src/lib/features/history/historyModeMachine';
import type { MissingNoteSummary } from '../../../src/lib/types/missingNotes';
import type { ForgottenNoteSummary } from '../../../src/lib/types/forgottenNotes';
import type { HistoryHealthReport } from '../../../src/lib/types/history';

interface NativeEditorState {
  activePaneId: string;
  paneIds: string[];
  paneKind: string;
  noteId: string | null;
  editor: {
    markdown: string;
    selection: { anchor: number; head: number };
    ownsWebviewFocus: boolean;
  } | null;
}

async function invokeNative<T>(
  command: string,
  args: Record<string, unknown> = {}
): Promise<T> {
  const outcome = await browser.executeAsync(
    (
      innerCommand: string,
      innerArgs: Record<string, unknown>,
      done: (result: { ok: true; value: unknown } | { ok: false; error: string }) => void
    ) => {
      const tauri = window as typeof window & {
        __TAURI_INTERNALS__?: {
          invoke: (command: string, args: Record<string, unknown>) => Promise<unknown>;
        };
      };
      if (!tauri.__TAURI_INTERNALS__) {
        done({ ok: false, error: 'Native Tauri internals are unavailable' });
        return;
      }
      void tauri.__TAURI_INTERNALS__.invoke(innerCommand, innerArgs).then(
        (value) => done({ ok: true, value }),
        (error) => done({ ok: false, error: String(error) })
      );
    },
    command,
    args
  );
  if (!outcome.ok) throw new Error(outcome.error);
  return outcome.value as T;
}

async function waitForNote(title: string) {
  const titleInput = await $('[data-testid="note-title"]');
  await titleInput.waitForDisplayed({ timeout: 20_000 });
  try {
    await browser.waitUntil(async () => (await titleInput.getValue()) === title, {
      timeout: 20_000,
      timeoutMsg: `Expected active note title to become ${title}`
    });
  } catch (error) {
    throw new Error(
      `Expected active note title to become ${title}; received ${await titleInput.getValue()}`,
      { cause: error }
    );
  }
}

async function showNote(note: NoteSession) {
  await invokeNative('mark_note_opened', { noteId: note.noteId });
  const home = await $('a[aria-label="Gneauxght"]');
  await home.waitForExist({ timeout: 20_000 });
  await browser.execute((element: HTMLElement) => element.click(), home);
  await browser.refresh();
  await waitForNote(note.title);
}

async function openSettings() {
  const settings = await $('a[aria-label="Settings"]');
  await settings.waitForExist();
  await browser.execute((element: HTMLElement) => element.click(), settings);
  await $('[aria-label="Settings categories"]').waitForExist({ timeout: 20_000 });
}

async function saveVersions(title: string, versions: string[]): Promise<NoteSession> {
  let note = await invokeNative<NoteSession>('save_note', {
    title,
    markdown: versions[0],
    currentPath: null
  });
  for (const markdown of versions.slice(1)) {
    note = await invokeNative<NoteSession>('save_note', {
      title,
      markdown,
      currentPath: note.path
    });
  }
  return note;
}

async function historyRecords(noteId: string) {
  const records: HistoryModePage['records'] = [];
  let cursor: string | null = null;
  do {
    const page = await invokeNative<HistoryModePage>('get_note_history_page', {
      noteId,
      cursor,
      limit: 30
    });
    records.push(...page.records);
    cursor = page.nextCursor;
  } while (cursor);
  return records;
}

async function readNativeEditorState(): Promise<NativeEditorState> {
  const state = await browser.execute(() => {
    const nativeWindow = window as typeof window & {
      __GNEAUXGHTS_NATIVE_E2E__?: {
        readEditorState: () => NativeEditorState;
        setEditorSelection: (anchor: number, head: number) => boolean;
      };
    };
    return nativeWindow.__GNEAUXGHTS_NATIVE_E2E__?.readEditorState() ?? null;
  });
  if (!state) throw new Error('Native editor state bridge is unavailable');
  return state;
}

async function readCapturedHistoryScrollTop() {
  return browser.execute(() => {
    const nativeWindow = window as typeof window & {
      __GNEAUXGHTS_NATIVE_E2E__?: {
        readCapturedHistoryScrollTop: () => number | null;
      };
    };
    return nativeWindow.__GNEAUXGHTS_NATIVE_E2E__?.readCapturedHistoryScrollTop() ?? null;
  });
}

async function editorText() {
  const editor = await $('[data-testid="note-editor"] .cm-content');
  await editor.waitForDisplayed();
  return editor.getText();
}

async function replaceEditorText(markdown: string) {
  const editor = await $('[data-testid="note-editor"] .cm-content');
  const inserted = await browser.execute(
    (element: HTMLElement, text: string) => {
      element.focus();
      document.execCommand('selectAll');
      return document.execCommand('insertText', false, text);
    },
    editor,
    markdown
  );
  if (!inserted) throw new Error('The native editor rejected the synthetic text input');
  await browser.waitUntil(async () => (await editorText()).includes(markdown.split('\n').at(-1)!));
}

async function openHistory() {
  const history = await $('[data-testid="history-mode"]');
  try {
    await browser.waitUntil(async () => {
      if (await history.isExisting()) return true;
      const open = await $('button[aria-label="Open note history"]');
      if ((await open.isExisting()) && (await open.isEnabled())) {
        await browser.execute((element: HTMLElement) => element.click(), open);
      }
      return history.isExisting();
    }, { timeout: 20_000, interval: 250 });
  } catch (error) {
    const open = await $('button[aria-label="Open note history"]');
    const entryError = await $('[data-testid="history-entry-error"]');
    throw new Error(
      `History Mode did not open. Button: ${JSON.stringify({
        exists: await open.isExisting(),
        enabled: (await open.isExisting()) ? await open.isEnabled() : null
      })}. Entry error: ${(await entryError.isExisting()) ? await entryError.getText() : 'none'}. Page text: ${await $('body').getText()}`,
      { cause: error }
    );
  }
  await $('[data-testid="historical-revision-diff"]').waitForExist({ timeout: 20_000 });
  return history;
}

async function loadAllHistory() {
  while (await $('button=Load older history').isExisting()) {
    const loadOlder = await $('button=Load older history');
    await loadOlder.waitForClickable();
    await loadOlder.click();
    await browser.waitUntil(async () => {
      const current = await $('button=Load older history');
      return !(await current.isExisting()) || (await current.isEnabled());
    });
  }
}

async function revealRevision(revisionId: string) {
  if (await $(`[data-revision-id="${revisionId}"]`).isExisting()) return;
  for (const expand of await $$('button[aria-label="Expand Editing Session"]')) {
    await expand.click();
    if (await $(`[data-revision-id="${revisionId}"]`).isExisting()) return;
  }
  throw new Error(`Revision ${revisionId} was not present in History Mode`);
}

describe('native Phase 1-3 Note Timeline integration', () => {
  before(async () => {
    await browser.switchToWindow('main');
  });

  it('captures real edits, pages deterministic history, restores a complete version, and preserves editor state', async () => {
    const baseBody = Array.from(
      { length: 80 },
      (_, index) => `Native journey base line ${index + 1}`
    ).join('\n');
    const versions = Array.from(
      { length: 35 },
      (_, index) => `${baseBody}\n\nSeeded native revision ${index + 1}`
    );
    const note = await saveVersions('Native timeline journey', versions);
    await showNote(note);

    const editedBody = `${versions.at(-1)}\n\nEdited through the native Svelte editor`;
    await replaceEditorText(editedBody);
    const scroller = await $('[data-testid="note-editor"] .cm-scroller');
    const editor = await $('[data-testid="note-editor"] .cm-content');
    await browser.execute((element: HTMLElement) => element.focus(), editor);
    const initialEditorState = await readNativeEditorState();
    const selectionAnchor = (initialEditorState.editor?.markdown.length ?? 12) - 2;
    const entryState = await browser.execute((
      element: HTMLElement,
      requestedAnchor: number,
      requestedHead: number
    ) => {
      const nativeWindow = window as typeof window & {
        __GNEAUXGHTS_NATIVE_E2E__?: {
          readEditorState: () => NativeEditorState;
          setEditorSelection: (anchor: number, head: number) => boolean;
        };
      };
      const bridge = nativeWindow.__GNEAUXGHTS_NATIVE_E2E__;
      if (!bridge?.setEditorSelection(requestedAnchor, requestedHead)) {
        throw new Error('Native editor selection bridge rejected the selection');
      }
      element.scrollTop = Math.max(240, element.scrollHeight * 0.55);
      element.dispatchEvent(new Event('scroll'));
      const editorState = bridge.readEditorState();
      const open = document.querySelector<HTMLButtonElement>(
        'button[aria-label="Open note history"]'
      );
      if (!open || open.disabled) throw new Error('History action was unavailable');
      open.click();
      return { editorState, scrollTop: element.scrollTop };
    }, scroller, selectionAnchor, selectionAnchor - 10);
    const editorStateBefore = entryState.editorState;
    const scrollBefore = entryState.scrollTop;
    expect(scrollBefore).toBeGreaterThan(0);
    expect(editorStateBefore.editor).not.toBeNull();
    expect(editorStateBefore.editor?.ownsWebviewFocus).toBe(true);

    const history = await openHistory();
    expect(await readCapturedHistoryScrollTop()).toBe(scrollBefore);
    const capturedAfterEdit = await invokeNative<NoteSession>('open_note', {
      noteId: note.noteId,
      path: null
    });
    expect(capturedAfterEdit.markdown).toContain('Edited through the native Svelte editor');
    const diff = await $('[data-testid="historical-revision-diff"]');
    expect(await diff.getText()).toContain('Edited through the native Svelte editor');
    expect(await diff.$$('[data-diff-kind="added"]')).not.toHaveLength(0);
    const latestPage = await invokeNative<HistoryModePage>('get_note_history_page', {
      noteId: note.noteId,
      cursor: null,
      limit: 1
    });
    const latestRevision = latestPage.records.find(
      (record): record is HistoryRevisionRecord => record.kind === 'revision'
    );
    expect(latestRevision).toBeDefined();
    const firstDiff = await invokeNative<unknown>('get_note_history_diff', {
      noteId: note.noteId,
      revisionId: latestRevision!.revisionId,
      comparison: 'parent'
    });
    const secondDiff = await invokeNative<unknown>('get_note_history_diff', {
      noteId: note.noteId,
      revisionId: latestRevision!.revisionId,
      comparison: 'parent'
    });
    expect(secondDiff).toEqual(firstDiff);
    expect(await $('button=Load older history').isExisting()).toBe(true);
    await loadAllHistory();

    await $('button[aria-label="Back to workspace"]').click();
    await history.waitForExist({ reverse: true });
    const restoredScroller = await $('[data-testid="note-editor"] .cm-scroller');
    try {
      await browser.waitUntil(async () => {
        const state = await readNativeEditorState();
        const scrollTop = await browser.execute(
          (element: HTMLElement) => element.scrollTop,
          restoredScroller
        );
        return state.editor?.ownsWebviewFocus === true &&
          state.editor.selection.anchor === editorStateBefore.editor?.selection.anchor &&
          state.editor.selection.head === editorStateBefore.editor?.selection.head &&
          Math.abs(scrollTop - scrollBefore) <= 2;
      }, { timeoutMsg: 'Expected exact logical editor selection, focus, and scroll to be restored' });
    } catch (error) {
      const state = await readNativeEditorState();
      const scrollTop = await browser.execute(
        (element: HTMLElement) => element.scrollTop,
        restoredScroller
      );
      const scrollMetrics = await browser.execute((element: HTMLElement) => ({
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
        scrollTop: element.scrollTop
      }), restoredScroller);
      throw new Error(
        `Expected restored editor summary ${JSON.stringify({
          activePaneId: editorStateBefore.activePaneId,
          paneIds: editorStateBefore.paneIds,
          paneKind: editorStateBefore.paneKind,
          noteId: editorStateBefore.noteId,
          selection: editorStateBefore.editor?.selection,
          ownsWebviewFocus: editorStateBefore.editor?.ownsWebviewFocus,
          markdownLength: editorStateBefore.editor?.markdown.length,
          scrollTop: scrollBefore
        })}; received ${JSON.stringify({
          activePaneId: state.activePaneId,
          paneIds: state.paneIds,
          paneKind: state.paneKind,
          noteId: state.noteId,
          selection: state.editor?.selection,
          ownsWebviewFocus: state.editor?.ownsWebviewFocus,
          markdownLength: state.editor?.markdown.length,
          scrollTop,
          scrollMetrics
        })}`,
        { cause: error }
      );
    }
    const editorStateAfter = await readNativeEditorState();
    expect(editorStateAfter.activePaneId).toBe(editorStateBefore.activePaneId);
    expect(editorStateAfter.paneIds).toEqual(editorStateBefore.paneIds);
    expect(editorStateAfter.paneKind).toBe(editorStateBefore.paneKind);
    expect(editorStateAfter.noteId).toBe(editorStateBefore.noteId);
    expect(editorStateAfter.editor?.markdown).toBe(editorStateBefore.editor?.markdown);
    expect(editorStateAfter.editor?.selection).toEqual(editorStateBefore.editor?.selection);
    const scrollAfter = await browser.execute(
      (element: HTMLElement) => element.scrollTop,
      restoredScroller
    );
    expect(Math.abs(scrollAfter - scrollBefore)).toBeLessThanOrEqual(2);
    expect(editorStateAfter.editor?.ownsWebviewFocus).toBe(true);
    const liveAfterHistory = await invokeNative<NoteSession>('open_note', {
      noteId: note.noteId,
      path: null
    });
    expect(liveAfterHistory.markdown).toBe(capturedAfterEdit.markdown);

    const records = await historyRecords(note.noteId);
    const oldestRevision = records
      .filter((record): record is HistoryRevisionRecord => record.kind === 'revision')
      .at(-1);
    expect(oldestRevision).toBeDefined();

    await openHistory();
    await loadAllHistory();
    await revealRevision(oldestRevision!.revisionId);
    await $(`[data-revision-id="${oldestRevision!.revisionId}"]`).click();
    await $('button=Preview complete replacement').click();
    const preview = await $('[aria-label="Complete replacement preview"]');
    await preview.waitForExist();
    expect(await preview.getText()).toContain('Native journey base line 1');
    await preview.$('button=Confirm Version Restore').click();
    await browser.waitUntil(async () =>
      (await $('[data-testid="history-mode"]').getText()).includes('Version restore')
    );
    await $('button[aria-label="Back to workspace"]').click();
    await $('[data-testid="history-mode"]').waitForExist({ reverse: true });
    const restored = await invokeNative<NoteSession>('open_note', {
      noteId: note.noteId,
      path: null
    });
    expect(restored.markdown).toBe(versions[0]);
    const recordsAfterRestore = await historyRecords(note.noteId);
    expect(
      recordsAfterRestore.find(
        (record): record is HistoryRevisionRecord => record.kind === 'revision'
      )?.source
    ).toBe('versionRestore');
  });

  it('discovers an external deletion, pages retained history, recovers safely, and keeps editing', async () => {
    await $('a[aria-label="Gneauxght"]').waitForExist({ timeout: 20_000 });
    const versions = Array.from(
      { length: 35 },
      (_, index) => `Missing Note native revision ${index + 1}\n\nRetained recovery content`
    );
    const note = await saveVersions('Native missing journey', versions);
    rmSync(note.path);
    await invokeNative('e2e_flush_vault_watcher_path', { path: note.path });

    await browser.waitUntil(async () => {
      const missing = await invokeNative<MissingNoteSummary[]>('list_missing_notes');
      return missing.some((candidate) => candidate.noteId === note.noteId);
    }, { timeout: 20_000, interval: 250, timeoutMsg: 'Expected the watcher to retain a Missing Note' });

    mkdirSync(note.path);
    await openSettings();
    await $('button=Forgotten Items').click();
    await browser.waitUntil(async () => (await $('body').getText()).includes(note.title));

    const missingCard = await $(`//article[.//p[normalize-space()="${note.title}"]]`);
    const timeline = await missingCard.$('details');
    await timeline.$('summary').click();
    expect(await timeline.getText()).toContain('30 loaded records');
    await timeline.$('button=Load older history').click();
    await browser.waitUntil(async () => !(await timeline.$('button=Load older history').isExisting()));
    expect(await timeline.getText()).toContain('Note creation revision');

    await missingCard.$('button=Recover').click();
    await browser.waitUntil(async () => {
      const missing = await invokeNative<MissingNoteSummary[]>('list_missing_notes');
      return missing.every((candidate) => candidate.noteId !== note.noteId);
    });
    expect(readdirSync(dirname(note.path)).filter((name) => name.startsWith(note.title))).toHaveLength(2);
    const recovered = await invokeNative<NoteSession>('open_note', {
      noteId: note.noteId,
      path: null
    });
    expect(recovered.path).not.toBe(note.path);
    expect(recovered.markdown).toContain('Retained recovery content');

    rmSync(note.path, { recursive: true });
    const indexedRecovered = await invokeNative<NoteSession>('save_note', {
      title: recovered.title,
      markdown: recovered.markdown,
      currentPath: recovered.path
    });
    await showNote(indexedRecovered);
    await replaceEditorText(`${indexedRecovered.markdown}\n\nContinued after native Missing Note recovery`);
    const history = await openHistory();
    expect(await $('[data-testid="historical-revision-diff"]').getText()).toContain(
      'Continued after native Missing Note recovery'
    );
    await $('button[aria-label="Back to workspace"]').click();
    await history.waitForExist({ reverse: true });
  });

  it('resets corrupt history, recovers a forgotten note, and keeps its timeline usable after restart', async () => {
    const note = await saveVersions('Native reset recovery', [
      'Forgotten version before corruption',
      'Forgotten current version before corruption'
    ]);
    const forgotten = await invokeNative<ForgottenNoteSummary | null>('forget_note', {
      currentPath: note.path,
      retentionDays: 30
    });
    expect(forgotten?.title).toBe(note.title);

    const corrupt = await invokeNative<HistoryHealthReport>('e2e_corrupt_history_store');
    expect(corrupt.state).toBe('corrupt');

    await openSettings();
    const historyCategory = await $('[aria-label="Settings categories"] button:nth-of-type(5)');
    await historyCategory.click();
    await browser.waitUntil(async () => (await $('body').getText()).includes('History is corrupt'));
    await $('button=Reset history').click();
    await $('button=Confirm reset history').click();
    await browser.pause(1_000);
    const healthy = await invokeNative<HistoryHealthReport>('get_history_health');
    if (healthy.integrity !== 'verified') {
      throw new Error(`Reset did not complete: ${JSON.stringify(healthy)}\n${await $('body').getText()}`);
    }
    await browser.waitUntil(async () => (await $('body').getText()).includes('History was reset'));
    expect(healthy.integrity).toBe('verified');
    expect(healthy.lastReset?.generation).toBeGreaterThan(1);

    await $('button=Forgotten Items').click();
    await browser.waitUntil(async () => (await $('body').getText()).includes(note.title));
    const forgottenRow = await $(`//*[normalize-space()="${note.title}"]/ancestor::div[.//input[@type="checkbox"]][1]`);
    await forgottenRow.$('input[type="checkbox"]').click();
    await $('button=Restore selected').click();
    await browser.waitUntil(async () => {
      const notes = await invokeNative<ForgottenNoteSummary[]>('list_forgotten_notes');
      return notes.every((candidate) => candidate.title !== note.title);
    });

    const recovered = await invokeNative<NoteSession>('open_note', {
      noteId: note.noteId,
      path: null
    });
    await showNote(recovered);
    const firstRecoveredEdit = `${recovered.markdown}\n\nFirst edit after reset recovery`;
    await replaceEditorText(firstRecoveredEdit);
    await openHistory();
    await $('button[aria-label="Back to workspace"]').click();
    await $('[data-testid="history-mode"]').waitForExist({ reverse: true });
    await replaceEditorText(`${firstRecoveredEdit}\n\nSecond edit before restart`);
    await browser.waitUntil(async () => {
      const records = await historyRecords(note.noteId);
      return records.filter(
        (record) => record.kind === 'revision' && record.source === 'editor'
      ).length >= 2;
    }, { timeout: 20_000, timeoutMsg: 'Expected the second recovered editor revision to persist' });

    await browser.reloadSession();
    await browser.switchToWindow('main');
    await waitForNote(note.title);
    const records = await historyRecords(note.noteId);
    const editorRevisions = records.filter(
      (record): record is HistoryRevisionRecord =>
        record.kind === 'revision' && record.source === 'editor'
    );
    expect(editorRevisions.length).toBeGreaterThanOrEqual(2);
    let firstEditRevision: HistoryRevisionRecord | undefined;
    const reconstructedEditorBodies: Array<{ revisionId: string; body: string }> = [];
    for (const record of editorRevisions) {
      const revision = await invokeNative<HistoricalRevision>('get_note_history_revision', {
        noteId: note.noteId,
        revisionId: record.revisionId
      });
      reconstructedEditorBodies.push({ revisionId: record.revisionId, body: revision.body });
      if (
        revision.body.includes('First edit after reset recovery') &&
        !revision.body.includes('Second edit before restart')
      ) {
        firstEditRevision = record;
        break;
      }
    }
    if (!firstEditRevision) {
      throw new Error(
        `Recovered editor revisions did not contain the expected boundary: ${JSON.stringify(reconstructedEditorBodies)}`
      );
    }

    await openHistory();
    await revealRevision(firstEditRevision.revisionId);
    await $(`[data-revision-id="${firstEditRevision.revisionId}"]`).click();
    const diff = await $('[data-testid="historical-revision-diff"]');
    await browser.waitUntil(async () => (await diff.getText()).includes('First edit after reset recovery'));
    await $('button=Preview complete replacement').click();
    const preview = await $('[aria-label="Complete replacement preview"]');
    await preview.waitForExist();
    expect(await preview.getText()).toContain('First edit after reset recovery');
    expect(await preview.getText()).not.toContain('Second edit before restart');
    await preview.$('button=Confirm Version Restore').click();
    await browser.waitUntil(async () =>
      (await $('[data-testid="history-mode"]').getText()).includes('Version restore')
    );
    await $('button[aria-label="Back to workspace"]').click();
    await $('[data-testid="history-mode"]').waitForExist({ reverse: true });
    expect(await editorText()).toContain('First edit after reset recovery');
    expect(await editorText()).not.toContain('Second edit before restart');
  });
});
