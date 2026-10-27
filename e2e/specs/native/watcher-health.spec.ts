import assert from 'node:assert/strict';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { browser, $, expect } from '@wdio/globals';
import { invokeNative as invoke } from '../../support/liveNative';
import type { WatcherHealth, VaultInfo } from '../../../src/lib/types/vault';
import type { NoteSession } from '../../../src/lib/features/notepad/model/types';
import type { NativeContractProbe } from '../../../src/lib/e2e/nativeContractProbeContract';

type SettingsSnapshot = { vault: VaultInfo; watcherHealth: WatcherHealth };
type ProbeWindow = Window & { __GNEAUXGHTS_NATIVE_E2E__?: { contractProbe: NativeContractProbe } };

describe('native watcher health and external edits', () => {
  it('reports the Running Vault watcher while retaining real external-edit detection', async () => {
    const root = process.env.GNEAUXGHTS_NATIVE_E2E_FIXTURE;
    assert(root && /gneauxghts-native-e2e-[^/]+$/.test(root), 'Requires the owned disposable fixture');
    await $('[data-testid="note-title"]').waitForExist({ timeout: 30_000 });
    let snapshot!: SettingsSnapshot;
    await browser.waitUntil(async () => {
      snapshot = await invoke<SettingsSnapshot>('get_settings_view');
      return snapshot.watcherHealth.status === 'watching';
    }, { timeout: 20_000, timeoutMsg: 'Native watcher did not finish startup' });
    assert.equal(realpathSync(snapshot.vault.runningPath), realpathSync(join(root, 'documents/vault')));
    assert.equal(snapshot.watcherHealth.reconciliationRunning, true);

    const note = await invoke<NoteSession>('save_note', {
      title: 'Watcher health external edit', markdown: 'Before external change', currentPath: null
    });
    assert(note.path && note.noteId);
    await browser.execute(() => (window as ProbeWindow).__GNEAUXGHTS_NATIVE_E2E__!.contractProbe.start());
    const raw = readFileSync(note.path, 'utf8');
    writeFileSync(note.path, raw.replace('Before external change', '- [ ] Watched external task'));
    await browser.waitUntil(async () => browser.execute(path =>
      (window as ProbeWindow).__GNEAUXGHTS_NATIVE_E2E__!.contractProbe.read().changed.some(event => event.notePath === path),
    note.path), { timeout: 20_000, timeoutMsg: 'Actual OS watcher event did not reach AppStore' });
    await browser.waitUntil(async () => {
      const tasks = await invoke<Array<{ displayTasks: Array<{ text: string }> }>>('list_tasks', { filter: 'all', showHidden: false });
      return tasks.some(group => group.displayTasks.some(task => task.text === 'Watched external task'));
    }, { timeout: 10_000 });

    await $('a[href="/settings"]').click();
    await $('[data-settings-section="vault"]').click();
    await expect($('[data-settings-anchor="watcher-health"]')).toHaveText(expect.stringContaining('Watching the Running Vault'));
    const before = (await invoke<SettingsSnapshot>('get_settings_view')).watcherHealth;
    try {
      await invoke('set_vault_directory', { path: join(root, 'next-vault') });
      const staged = await invoke<SettingsSnapshot>('get_settings_view');
      assert.equal(staged.vault.runningPath, snapshot.vault.runningPath);
      assert.equal(staged.vault.requiresRestart, true);
      assert.deepEqual(staged.watcherHealth, before);
    } finally {
      await invoke('set_vault_directory', { path: snapshot.vault.selectedPath });
    }
  });
});
