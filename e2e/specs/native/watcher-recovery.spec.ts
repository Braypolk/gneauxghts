import assert from 'node:assert/strict';
import { existsSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { browser, $, expect } from '@wdio/globals';
import { invokeNative as invoke } from '../../support/liveNative';
import type { NoteSession } from '../../../src/lib/features/notepad/model/types';
import type { WatcherHealth, VaultInfo } from '../../../src/lib/types/vault';
import type { HistoryModePage } from '../../../src/lib/features/history/historyModeMachine';
import type { NativeContractProbe } from '../../../src/lib/e2e/nativeContractProbeContract';

type ProbeWindow = Window & { __GNEAUXGHTS_NATIVE_E2E__?: {
  contractProbe: NativeContractProbe;
  readEditorState(): { noteId: string | null; editor: { markdown: string } | null };
} };
type Settings = { vault: VaultInfo; watcherHealth: WatcherHealth };
const probe = () => browser.execute(() => (window as ProbeWindow).__GNEAUXGHTS_NATIVE_E2E__!.contractProbe.read());
const resetProbe = () => browser.execute(() => (window as ProbeWindow).__GNEAUXGHTS_NATIVE_E2E__!.contractProbe.start());
const editorBody = () => browser.execute(() => (window as ProbeWindow).__GNEAUXGHTS_NATIVE_E2E__!.readEditorState().editor?.markdown);
async function changed(path: string, deleted: boolean) {
  await browser.waitUntil(async () => (await probe()).changed.some(event => event.notePath === path && event.deleted === deleted),
    { timeout: 15_000, timeoutMsg: 'Real reconciliation change did not reach AppStore' });
}
async function createAndOpen(title: string) {
  const note = await invoke<NoteSession>('save_note', { title, markdown: 'Before external change', currentPath: null });
  assert(note.noteId && note.path);
  await invoke('finalize_note_editing_window', { noteId: note.noteId });
  await invoke('mark_note_opened', { noteId: note.noteId });
  await browser.refresh();
  await browser.waitUntil(() => browser.execute(id =>
    (window as ProbeWindow).__GNEAUXGHTS_NATIVE_E2E__?.readEditorState().noteId === id, note.noteId));
  await $('[data-testid="note-editor"][aria-busy="false"]').waitForExist();
  return note as NoteSession & { noteId: string; path: string };
}
async function insertText(text: string) {
  const content = await $('[data-testid="note-editor"] .cm-content');
  assert(await browser.execute((element: HTMLElement, value: string) => {
    element.focus();
    return document.execCommand('insertText', false, value);
  }, content, text), 'Native WebKit must accept the unfinished edit');
}

describe('automatic watcher recovery in the real native app', () => {
  it('scans through failed registration, preserves editor conflicts, then resumes OS watching', async () => {
    const fixture = process.env.GNEAUXGHTS_NATIVE_E2E_FIXTURE;
    assert(fixture && /gneauxghts-native-e2e-[^/]+$/.test(fixture));
    const root = realpathSync(join(fixture, 'documents/vault'));
    const marker = join(root, '.gneauxghts/e2e-watch-unavailable');
    assert(existsSync(marker), 'Launcher must inject failure before production startup');
    await $('[data-testid="note-title"]').waitForExist({ timeout: 30_000 });
    await browser.waitUntil(async () => {
      const { watcherHealth } = await invoke<Settings>('get_settings_view');
      return watcherHealth.status === 'unavailable' && watcherHealth.reconciliationRunning;
    });
    await $('a[href="/settings"]').click();
    await $('[data-settings-section="vault"]').click();
    await expect($('[data-settings-anchor="watcher-health"]')).toHaveText(expect.stringContaining('File watching retries automatically'));
    await $('a[href="/"]').click();

    const note = await createAndOpen('Recovered scan source');
    await resetProbe();
    writeFileSync(note.path, readFileSync(note.path, 'utf8').replace('Before external change', '- [ ] Fallback external task'));
    await changed(note.path, false);
    await browser.waitUntil(async () => (await editorBody())?.trim() === '- [ ] Fallback external task',
      { timeoutMsg: 'Fallback change did not refresh the clean editor' });
    const groups = await invoke<Array<{ noteId: string; displayTasks: Array<{ text: string }> }>>('list_tasks', { filter: 'all', showHidden: false });
    assert(groups.some(group => group.noteId === note.noteId && group.displayTasks.some(task => task.text === 'Fallback external task')));
    const history = await invoke<HistoryModePage>('get_note_history_page', { noteId: note.noteId, cursor: null, limit: 30 });
    assert.equal(history.records.filter(row => row.kind === 'revision').length, 2);

    await resetProbe();
    const renamed = join(root, 'Recovered rename.md');
    renameSync(note.path, renamed);
    await changed(note.path, true);
    await changed(renamed, false);
    const moved = await invoke<NoteSession>('read_note', { noteId: note.noteId, path: null });
    assert.equal(moved.noteId, note.noteId);
    assert.equal(moved.path, renamed);
    const afterMove = await invoke<HistoryModePage>('get_note_history_page', { noteId: note.noteId, cursor: null, limit: 30 });
    assert(afterMove.records.some(row => row.kind === 'lifecycleEvent' && row.eventKind === 'renamed'));
    await resetProbe();
    unlinkSync(renamed);
    await changed(renamed, true);
    const missing = await invoke<Array<{ noteId: string; timeline: HistoryModePage }>>('list_missing_notes');
    assert.equal(missing.find(row => row.noteId === note.noteId)?.timeline.records.filter(row => row.kind === 'revision').length, 2);

    const conflict = await createAndOpen('Unfinished recovery edits');
    await insertText('Unfinished local text ');
    const disk = readFileSync(conflict.path, 'utf8').replace('Before external change', 'External version must survive');
    writeFileSync(conflict.path, disk);
    // Keep normal autosave pending until a real periodic scan observes disk.
    // This exercises the production dirty-conflict owner without a flush helper.
    await browser.waitUntil(async () => {
      if (await $('[aria-label="External note conflict"]').isExisting()) return true;
      await insertText('x');
      return false;
    }, { interval: 100, timeout: 10_000, timeoutMsg: 'Fallback scan did not preserve the dirty editor as a conflict' });
    assert((await editorBody())?.includes('Unfinished local text'));
    assert.equal(readFileSync(conflict.path, 'utf8'), disk);
    await $('button=Load disk version').click();
    await browser.waitUntil(async () => (await editorBody())?.trim() === 'External version must survive');

    const before = await invoke<Settings>('get_settings_view');
    try {
      await invoke('set_vault_directory', { path: join(fixture, 'next-vault') });
      const staged = await invoke<Settings>('get_settings_view');
      assert.equal(staged.vault.runningPath, before.vault.runningPath);
      assert.equal(staged.watcherHealth.status, 'unavailable');
      assert.equal(staged.watcherHealth.reconciliationRunning, true);
      await resetProbe();
      unlinkSync(marker);
      await browser.waitUntil(async () => {
        const health = (await invoke<Settings>('get_settings_view')).watcherHealth;
        return health.status === 'watching' && health.reason === null && health.reconciliationRunning;
      }, { timeout: 15_000 });
      writeFileSync(conflict.path, readFileSync(conflict.path, 'utf8').replace('External version must survive', 'Actual OS notifications resumed'));
      await changed(conflict.path, false);
      await browser.waitUntil(async () => (await editorBody())?.trim() === 'Actual OS notifications resumed');
    } finally {
      await invoke('set_vault_directory', { path: before.vault.selectedPath });
    }
    const receipt = await invoke<{ ready: boolean }>('prepare_restart');
    assert.equal(receipt.ready, true, 'Recovered watcher and scan worker must join before clean close');
  });
});
