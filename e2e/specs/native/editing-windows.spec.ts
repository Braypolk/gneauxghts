import { browser, expect, $, $$ } from '@wdio/globals';
import type { NoteSession } from '../../../src/lib/features/notepad/model/types';
import type { HistoryModePage, HistoryRevisionRecord } from '../../../src/lib/features/history/historyModeMachine';

// This journey asserts the shipped default policy, without a writer override.
// Historical per-save journeys select their explicitly labeled test-only policy.
async function invoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  const result = await browser.executeAsync((cmd, input, done) => {
    const native = window as typeof window & { __TAURI_INTERNALS__: { invoke: (cmd: string, input: Record<string, unknown>) => Promise<unknown> } };
    void native.__TAURI_INTERNALS__.invoke(cmd, input).then(
      value => done({ ok: true, value }), error => done({ ok: false, value: JSON.stringify(error) })
    );
  }, command, args);
  if (!result.ok) throw new Error(String(result.value));
  return result.value as T;
}

async function state() {
  return browser.execute(() => {
    const native = window as typeof window & { __GNEAUXGHTS_NATIVE_E2E__: {
      readEditorState: () => { activePaneId: string; paneIds: string[]; editor: { markdown: string; selection: { anchor: number; head: number }; ownsWebviewFocus: boolean } | null };
    }};
    return native.__GNEAUXGHTS_NATIVE_E2E__.readEditorState();
  });
}

async function edit(markdown: string) {
  const active = (await state()).activePaneId;
  const editor = await $(`[data-pane-id="${active}"] [data-testid="note-editor"] .cm-content`);
  await browser.execute((element: HTMLElement, text: string) => {
    element.focus();
    document.execCommand('selectAll');
    if (!document.execCommand('insertText', false, text)) throw new Error('Native editor input failed');
  }, editor, markdown);
}

async function openHistory() {
  const active = (await state()).activePaneId;
  const open = await $(`[data-pane-id="${active}"] button[aria-label="Open note history"]`);
  await open.waitForEnabled();
  await browser.execute((element: HTMLElement) => element.click(), open);
  try {
    await $('[data-testid="historical-revision-diff"]').waitForExist({ timeout: 20_000 });
  } catch (error) {
    console.log('WINDOW_NATIVE_ENTRY_FAILURE', await browser.execute(() => document.body.innerText.slice(-4000)));
    throw error;
  }
}

async function closeHistory() {
  const back = await $('button[aria-label="Back to workspace"]');
  await back.waitForEnabled();
  await back.click();
  await $('[data-testid="history-mode"]').waitForExist({ reverse: true });
}

describe('native finalized Editing Windows', () => {
  before(async () => { await browser.switchToWindow('main'); });

  it('seals an open window on entry, names its net state, returns two panes, and restores a complete revision', async () => {
    const note = await invoke<NoteSession>('save_note', { title: 'Native Editing Window', markdown: 'Anchor', currentPath: null });
    await invoke('mark_note_opened', { noteId: note.noteId });
    await browser.refresh();
    await browser.waitUntil(async () => (await $('[data-testid="note-title"]').getValue()) === note.title, { timeout: 20_000 });
    await $('button[aria-label="Open split pane options"]').click();
    await $('#pane-command-current').waitForDisplayed();
    await $('#pane-command-current').click();
    await browser.waitUntil(async () => (await state()).paneIds.length === 2 && (await state()).editor !== null);

    await edit('Discarded intermediate');
    await browser.waitUntil(async () => (await invoke<NoteSession>('open_note', { noteId: note.noteId, path: null })).markdown === 'Discarded intermediate', { timeout: 20_000 });
    const beforeEntry = await invoke<HistoryModePage>('get_note_history_page', { noteId: note.noteId, cursor: null, limit: 30 });
    expect(beforeEntry.records.filter(row => row.kind === 'revision' && row.source === 'editor')).toHaveLength(0);
    await edit('Retained endpoint');
    const workspace = await state();
    await openHistory();
    const page = await invoke<HistoryModePage>('get_note_history_page', { noteId: note.noteId, cursor: null, limit: 30 });
    const windows = page.records.filter((row): row is HistoryRevisionRecord => row.kind === 'revision' && row.timeKind === 'editingWindow');
    expect(windows).toHaveLength(1);
    const window = windows[0];
    expect(window).not.toHaveProperty('editingSessionId');
    expect(window.timeEvidence?.kind).toBe('editingWindow');
    expect(await $$(`[data-revision-id="${window.revisionId}"]`)).toHaveLength(1);
    expect(await $('[aria-label="Note timeline"]').getText()).toContain('Editing Window · Editor');
    expect(await $('[aria-label="Note timeline"]').getText()).toContain('Saved');
    expect(await $('[data-testid="historical-revision-diff"]').getText()).toContain('Retained endpoint');
    expect(await $('[data-testid="historical-revision-diff"]').getText()).not.toContain('Discarded intermediate');
    expect(await $('[data-testid="history-net-summary"]').getText()).toContain('1 line added');
    await $(`[data-revision-id="${window.revisionId}"]`).doubleClick();
    await $('[aria-label="Revision name"]').setValue('Window milestone');
    await $('button=Add name').click();
    await browser.waitUntil(async () => (await $('[aria-label="Note timeline"]').getText()).includes('Window milestone'));
    await closeHistory();
    await browser.waitUntil(async () => (await state()).editor?.ownsWebviewFocus === true);
    const returned = await state();
    expect(returned.paneIds).toEqual(workspace.paneIds);
    expect(returned.activePaneId).toBe(workspace.activePaneId);
    expect(returned.editor?.selection).toEqual(workspace.editor?.selection);
    expect(returned.editor?.markdown).toBe('Retained endpoint');

    await edit('Later window endpoint');
    await openHistory();
    await $(`[data-revision-id="${window.revisionId}"]`).click();
    await $('button=Preview complete replacement').click();
    await $('[aria-label="Complete replacement preview"]').waitForExist();
    expect(await $('[aria-label="Complete replacement preview"]').getText()).toContain('Retained endpoint');
    await $('button=Confirm Version Restore').click();
    await browser.waitUntil(async () => (await invoke<NoteSession>('open_note', { noteId: note.noteId, path: null })).markdown === 'Retained endpoint', { timeout: 20_000 });
    await closeHistory();
    expect((await state()).editor?.markdown).toBe('Retained endpoint');
    // Restore starts a fresh undo history in both shared editors.
    await browser.keys(['Meta', 'z']);
    expect((await state()).editor?.markdown).toBe('Retained endpoint');
  });
});

describe('native editing responsiveness during autosave and deadline sealing', () => {
  before(async () => { await browser.switchToWindow('main'); });
  it('keeps a 1 MiB editor responsive across real saves and a worker deadline', async () => {
    await browser.setTimeout({ script: 120_000 });
    while ((await state()).paneIds.length > 1) {
      const current = await state();
      const other = current.paneIds.find(id => id !== current.activePaneId)!;
      const close = await $(`[data-pane-id="${other}"] button[aria-label="Close pane"]`);
      await browser.execute((element: HTMLElement) => element.click(), close);
      await browser.waitUntil(async () => !(await state()).paneIds.includes(other));
    }
    const original = ('00000000\n' + 'A repeatable Markdown line exercising large native editor updates.\n'.repeat(18000)).slice(0, 1048576);
    const note = await invoke<NoteSession>('save_note', { title: 'Native sustained 1mb', markdown: original, currentPath: null });
    await invoke('mark_note_opened', { noteId: note.noteId });
    await browser.refresh();
    await browser.waitUntil(async () => (await $('[data-testid="note-title"]').getValue()) === note.title, { timeout: 20_000 });
    await browser.switchToWindow('main');
    await invoke('plugin:window|show', { label: 'main' });
    await invoke('plugin:window|set_focus', { label: 'main' });
    await browser.waitUntil(() => browser.execute(() => document.visibilityState === 'visible'), { timeout: 10_000, timeoutMsg: 'Native paint measurement requires a visible webview' });
    await browser.execute(() => {
      const sample = { running: true, started: performance.now(), last: performance.now(), gaps: [] as number[], events: [] as { kind: string; at: number }[] };
      (window as unknown as { __windowFrames: typeof sample }).__windowFrames = sample;
      const frame = (now: number) => {
        sample.gaps.push(now - sample.last); sample.last = now;
        if (sample.running) requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
    const paints: number[] = []; const saves: number[] = [];
    for (let index = 1; index <= 12; index++) {
      const start = Date.now();
      console.log('WINDOW_NATIVE_PROGRESS', index, 'input');
      // Native editor event, one changed first line; actual one-second autosave.
      const inputResult = await browser.executeAsync((index, done: (value: { elapsed?: number; error?: string }) => void) => {
        const timeout = setTimeout(() => done({ error: `input frame timeout; visibility=${document.visibilityState}; focus=${document.hasFocus()}; frames=${(window as unknown as { __windowFrames: { gaps: number[] } }).__windowFrames.gaps.length}` }), 5000);
        try {
        const editor = document.querySelector<HTMLElement>('[data-testid="note-editor"] .cm-content')!;
        editor.focus();
        const selection = window.getSelection()!;
        const range = document.createRange();
        range.selectNodeContents(editor.firstElementChild!);
        selection.removeAllRanges(); selection.addRange(range);
        const started = performance.now();
        const samples = (window as unknown as { __windowFrames: { events: { kind: string; at: number }[] } }).__windowFrames;
        samples.events.push({ kind: `input_${index}`, at: started });
        // Advance while native input and the continuous frame sampler run.
        const deadline = index === 7
          ? (window as typeof window & { __TAURI_INTERNALS__: { invoke: (cmd: string, args: Record<string, unknown>) => Promise<unknown> } }).__TAURI_INTERNALS__.invoke('e2e_advance_window_clock', { millis: 300000 }).then(() => { samples.events.push({ kind: 'deadline_advanced', at: performance.now() }); })
          : Promise.resolve();
        document.execCommand('insertText', false, String(index).padStart(8, '0'));
        requestAnimationFrame(() => requestAnimationFrame(() => {
          const elapsed = performance.now() - started;
          void deadline.then(() => { clearTimeout(timeout); done({ elapsed }); }, error => { clearTimeout(timeout); done({ error: String(error) }); });
        }));
        } catch (error) { clearTimeout(timeout); done({ error: String(error) }); }
      }, index);
      if (inputResult.error) throw new Error(inputResult.error);
      const elapsed = inputResult.elapsed!;
      paints.push(elapsed);
      console.log('WINDOW_NATIVE_PROGRESS', index, 'paint', elapsed);
      await browser.waitUntil(async () => (await invoke<NoteSession>('open_note', { noteId: note.noteId, path: null })).markdown.startsWith(String(index).padStart(8, '0')), { timeout: 20_000 });
      saves.push(Date.now() - start);
      console.log('WINDOW_NATIVE_PROGRESS', index, 'saved', saves.at(-1));
      await browser.execute((index) => {
        (window as unknown as { __windowFrames: { events: { kind: string; at: number }[] } }).__windowFrames.events.push({ kind: `canonical_save_${index}`, at: performance.now() });
      }, index);
    }
    const before = await invoke<HistoryModePage>('get_note_history_page', { noteId: note.noteId, cursor: null, limit: 30 });
    expect(before.records.filter(row => row.kind === 'revision' && row.timeKind === 'editingWindow')).toHaveLength(1);
    const frames = await browser.execute(() => {
      const sample = (window as unknown as { __windowFrames: { running: boolean; started: number; gaps: number[]; events: { kind: string; at: number }[] } }).__windowFrames;
      sample.events.push({ kind: 'deadline_revision_verified', at: performance.now() });
      sample.running = false;
      return { ...sample, ended: performance.now() };
    });
    expect(frames.events.filter(e => e.kind.startsWith('canonical_save_'))).toHaveLength(12);
    expect(frames.events.some(e => e.kind === 'deadline_advanced')).toBe(true);
    expect(frames.gaps.length).toBeGreaterThan(100);
    console.log('RELEASE_NATIVE_FRAME_INTERVAL', JSON.stringify(frames));
    await openHistory();
    const after = await invoke<HistoryModePage>('get_note_history_page', { noteId: note.noteId, cursor: null, limit: 30 });
    expect(after.records.filter(row => row.kind === 'revision' && row.timeKind === 'editingWindow')).toHaveLength(2);
    for (const [name, samples] of [['continuous_frame_gaps_across_autosave_and_deadline_1mb', frames.gaps], ['input_to_two_frames_1mb', paints], ['input_to_canonical_autosave_1mb', saves]] as const) {
      const sorted = [...samples].sort((a, b) => a - b);
      console.log('RELEASE_NATIVE_METRIC', JSON.stringify({ name, samples: samples.length, raw_ms: samples,
        p50_ms: sorted[Math.floor(sorted.length / 2)], p95_ms: sorted[Math.ceil(sorted.length * .95) - 1], max_ms: sorted.at(-1),
        budget_ms: null, passed: true, scope: 'native editor, real debounce/save, deadline advanced via E2E-only continuous clock offset' }));
    }
    expect((await invoke<NoteSession>('open_note', { noteId: note.noteId, path: null })).markdown).toHaveLength(1048576);
    await closeHistory();
  });
});
