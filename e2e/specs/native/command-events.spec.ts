import assert from 'node:assert/strict';
import { realpathSync } from 'node:fs';
import { dirname, join, relative, isAbsolute } from 'node:path';
import { browser, $ } from '@wdio/globals';
import { invokeNative as invoke } from '../../support/liveNative';
import type { NativeContractProbe } from '../../../src/lib/e2e/nativeContractProbeContract';
import type { NoteSession } from '../../../src/lib/features/notepad/model/types';
import type { VaultInfo } from '../../../src/lib/types/vault';
import type { HistoryModePage, HistoricalRevision } from '../../../src/lib/features/history/historyModeMachine';

type ProbeWindow = Window & { __GNEAUXGHTS_NATIVE_E2E__?: { contractProbe: NativeContractProbe } };
const readProbe = () => browser.execute(() => (window as ProbeWindow).__GNEAUXGHTS_NATIVE_E2E__!.contractProbe.read());
const resetProbe = () => browser.execute(() => (window as ProbeWindow).__GNEAUXGHTS_NATIVE_E2E__!.contractProbe.start());

function assertWithin(path: string, root: string) {
  const suffix = relative(root, path);
  assert(suffix && !suffix.startsWith('..') && !isAbsolute(suffix), `Expected ${path} inside running vault ${root}`);
}

async function expectSaved(note: NoteSession) {
  assert(note.noteId && note.path, 'The canonical save must return stable identity and path');
  await browser.waitUntil(async () => (await readProbe()).saved.some(event =>
    event.noteId === note.noteId && event.notePath === note.path && event.title === note.title),
  { timeout: 10_000, timeoutMsg: 'Real note-saved event did not reach the production AppStore consumer' });
  const snapshot = await readProbe();
  const event = snapshot.saved.findLast(event => event.noteId === note.noteId && event.notePath === note.path)!;
  assert(Number.isInteger(event.revision) && event.revision > 0, 'Event must carry the canonical index revision');
  assert(snapshot.indexRevision >= event.revision, 'AppStore must admit the delivered revision');
}

describe('native command dispatch and production event admission', () => {
  before(async () => {
    assert(!process.env.GNEAUXGHTS_RELEASE_SCALE_RUN, 'Use the disposable native fixture');
    await browser.switchToWindow('main');
    await $('[data-testid="note-title"]').waitForExist({ timeout: 30_000 });
    await browser.waitUntil(async () => (await readProbe()).ready, { timeout: 30_000 });
  });

  it('publishes canonical save identity, task-save history source and task-mutation event payload', async () => {
    const vault = await invoke<VaultInfo>('get_vault_info');
    assert(vault.runningPath.includes('gneauxghts-native-e2e-'), 'Only the owned fixture may be written');
    await resetProbe();
    const created = await invoke<NoteSession>('save_note', { title: 'Native dispatch contract', markdown: '- [ ] Dispatch task', currentPath: null });
    await expectSaved(created);
    assertWithin(created.path!, vault.runningPath);
    await invoke('finalize_note_editing_window', { noteId: created.noteId });

    await resetProbe();
    const saved = await invoke<NoteSession>('save_task_note', { title: 'Native dispatch renamed', markdown: '- [x] Dispatch task', currentPath: created.path });
    assert.equal(saved.noteId, created.noteId, 'Renaming must preserve canonical identity');
    assert.notEqual(saved.path, created.path, 'Saved event must report the canonical renamed path');
    await expectSaved(saved);
    const opened = await invoke<NoteSession>('open_note', { noteId: saved.noteId, path: null });
    assert.equal(opened.path, saved.path);
    assert.equal(opened.markdown.trim(), '- [x] Dispatch task');
    await invoke('finalize_note_editing_window', { noteId: saved.noteId });
    const history = await invoke<HistoryModePage>('get_note_history_page', { noteId: saved.noteId, cursor: null, limit: 30 });
    const taskRevision = history.records.find(row => row.kind === 'revision' && row.source === 'taskAction');
    assert(taskRevision?.kind === 'revision', 'save_task_note must retain taskAction provenance through actual dispatch');
    const revision = await invoke<HistoricalRevision>('get_note_history_revision', { noteId: saved.noteId, revisionId: taskRevision.revisionId });
    assert.equal(revision.body.trim(), '- [x] Dispatch task');

    const groups = await invoke<Array<{ noteId: string; displayTasks: Array<{ taskId: string; text: string; completed: boolean }> }>>('list_tasks', { filter: 'all', showHidden: false });
    const task = groups.find(group => group.noteId === saved.noteId)?.displayTasks.find(task => task.text === 'Dispatch task');
    assert(task?.completed, 'Saved task must be projected before invoking the task command');
    await resetProbe();
    await invoke('toggle_task', { taskId: task.taskId, filter: 'all', showHidden: false });
    await browser.waitUntil(async () => (await readProbe()).changed.some(event => event.notePath === saved.path && event.source === 'taskMutation'),
      { timeout: 10_000, timeoutMsg: 'Task mutation event did not reach AppStore' });
    const changed = (await readProbe()).changed.find(event => event.notePath === saved.path && event.source === 'taskMutation')!;
    assert.equal(changed.deleted, false);
    assert.equal(changed.documentKind, 'note');
    assert.equal(Object.hasOwn(changed, 'chatId'), false);
    assert.equal((await invoke<NoteSession>('open_note', { noteId: saved.noteId, path: null })).markdown.trim(), '- [ ] Dispatch task');
    await expectSaved(saved);
  });

  it('admits the staged-vault payload without redirecting subsequent canonical writes', async () => {
    const initial = await invoke<VaultInfo>('get_vault_info');
    assert(initial.runningPath.includes('gneauxghts-native-e2e-'), 'Only the owned fixture may be staged');
    const selected = join(dirname(initial.runningPath), 'native-contract-next-vault');
    let restored: VaultInfo | undefined;
    await resetProbe();
    try {
      const staged = await invoke<VaultInfo>('set_vault_directory', { path: selected });
      assert.equal(staged.runningPath, initial.runningPath);
      assert.equal(staged.selectedPath, selected);
      assert.equal(staged.requiresRestart, true);
      await browser.waitUntil(async () => (await readProbe()).vaults.some(event => event.selectedPath === staged.selectedPath && event.requiresRestart),
        { timeout: 10_000, timeoutMsg: 'Staged vault event did not reach AppStore' });
      const snapshot = await readProbe();
      const event = snapshot.vaults.findLast(event => event.selectedPath === staged.selectedPath)!;
      assert.deepEqual(event, staged, 'EventBus must deliver the full staged VaultInfo payload');
      assert.deepEqual(snapshot.vaultInfo, staged, 'Production AppStore must adopt the same staged snapshot');
      const saved = await invoke<NoteSession>('save_note', { title: 'Saved while next vault staged', markdown: 'Still in the running vault.', currentPath: null });
      assert(saved.path);
      assertWithin(saved.path, initial.runningPath);
      await expectSaved(saved);
    } finally {
      restored = await invoke<VaultInfo>('set_vault_directory', { path: initial.selectedPath });
    }
    assert(restored);
    // The initial default may not exist yet. Staging creates it and resolves
    // macOS /var -> /private/var; compare actual filesystem identity.
    assert.equal(restored.selectedPath, realpathSync(initial.selectedPath));
    await browser.waitUntil(async () => (await readProbe()).vaultInfo?.selectedPath === restored!.selectedPath);
    const admitted = await readProbe();
    assert.deepEqual(admitted.vaults.findLast(event => event.selectedPath === restored!.selectedPath), restored);
    assert.deepEqual(admitted.vaultInfo, restored);
    assert.equal(admitted.vaultInfo?.runningPath, initial.runningPath);
  });
});
