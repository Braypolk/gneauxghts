import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { $, browser } from '@wdio/globals';
import type { DraftBackup } from '../../../src/lib/features/notepad/recovery/draftRecoveryController.svelte';
import type { NoteSession } from '../../../src/lib/features/notepad/model/types';
import { invokeNative } from '../../support/liveNative';
import { assertDisposable, savePiFixtureNote } from '../../support/piChatAcceptance';
import { listenerPids } from '../../support/nativeTransport.mjs';
import { nativeE2EBinary, nativeE2EPorts } from '../../support/nativeE2EBinary.mjs';

const titleField = () => $('[data-testid="note-title"]');
const recovery = () => $('[data-testid="draft-recovery"]');
const backups = () => invokeNative<DraftBackup[]>('list_draft_backups');
function markdownFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const path = join(root, entry.name);
    return entry.isDirectory() ? markdownFiles(path) : entry.name.endsWith('.md') ? [path] : [];
  }).sort();
}
async function openSource(title: string) {
  const note = await savePiFixtureNote(title, 'Original body that recovery must never overwrite.');
  await invokeNative('mark_note_opened', { noteId: note.noteId });
  await browser.refresh();
  await browser.waitUntil(async () => await titleField().getValue() === title, { timeout: 30_000 });
  return note;
}

/** Kill only the admitted disposable process, bypassing departure/close saves. */
async function crashAndRelaunch() {
  const root = await assertDisposable();
  const { binary } = nativeE2EBinary('debug');
  const args = ['--e2e-app-data-root', join(root, 'app-data'),
    '--e2e-documents-root', join(root, 'documents'), '--e2e-vault-root', join(root, 'documents/vault')];
  const pids = execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' }).split('\n')
    .filter(line => line.includes(binary) && args.every(arg => line.includes(arg)))
    .map(line => Number(line.trim().split(/\s+/)[0]));
  assert.equal(pids.length, 1, 'Crash requires exactly one admitted fixture-owned process');
  const port = nativeE2EPorts().driver;
  assert.deepEqual(listenerPids(port), pids);
  process.kill(pids[0], 'SIGKILL');
  await browser.waitUntil(() => listenerPids(port).length === 0);
  const child = spawn(binary, args, { stdio: 'ignore', env: {
    ...process.env, TAURI_WEBDRIVER_PORT: String(port), WDIO_EMBEDDED_SERVER: 'true'
  } });
  assert(child.pid);
  // The existing native launcher validates this receipt before cleaning it up.
  writeFileSync(join(root, 'restarted-app.pid'), String(child.pid));
  child.unref();
  await browser.waitUntil(async () => {
    if (listenerPids(port)[0] !== child.pid) return false;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/status`, { signal: AbortSignal.timeout(500) });
      return response.ok && (await response.json() as { value?: { ready?: boolean } }).value?.ready === true;
    } catch { return false; }
  }, { timeout: 30_000, timeoutMsg: 'Crashed fixture did not relaunch its embedded driver' });
  await browser.reloadSession();
  await browser.switchToWindow('main');
  await titleField().waitForExist({ timeout: 30_000 });
  return { beforePid: pids[0], afterPid: child.pid };
}

describe('native private draft recovery', function () {
  this.timeout(90_000);

  it('recovers interrupted title work into the same note identity without creating a duplicate', async () => {
    const root = realpathSync(await assertDisposable());
    const source = await openSource('Recovery original source');
    const raw = readFileSync(source.path, 'utf8');
    const before = markdownFiles(join(root, 'documents/vault'));
    const recoveredTitle = 'Recovered unfinished title';
    await titleField().setValue(recoveredTitle);
    await browser.waitUntil(async () => (await backups()).some(copy =>
      copy.sourceNoteId === source.noteId && copy.title === recoveredTitle
    ));
    assert.equal(await titleField().isFocused(), true, 'Title must remain uncommitted before the crash');
    assert.equal(readFileSync(source.path, 'utf8'), raw);
    const processes = await crashAndRelaunch();
    await browser.waitUntil(async () => await titleField().getValue() === source.title);
    await browser.waitUntil(async () => (await $('[data-testid="note-editor"] .cm-content').getText()).includes(source.markdown));
    await recovery().waitForDisplayed();
    await recovery().$('summary').click();
    assert((await recovery().getText()).includes(recoveredTitle));
    if (process.env.GNEAUX_RECOVERY_OUTPUT) {
      mkdirSync(process.env.GNEAUX_RECOVERY_OUTPUT, { recursive: true });
      await browser.saveScreenshot(join(process.env.GNEAUX_RECOVERY_OUTPUT, 'native-recovery-offer.png'));
    }
    await $('button=Recover work').click();
    const destination = join(root, 'documents/vault', `${recoveredTitle}.md`);
    await browser.waitUntil(() => markdownFiles(join(root, 'documents/vault')).includes(destination));
    const resumed = await invokeNative<NoteSession>('read_note', { noteId: null, path: destination });
    assert.equal(resumed.noteId, source.noteId);
    assert.equal(resumed.markdown, source.markdown);
    assert.equal(resumed.title, recoveredTitle);
    assert.equal(existsSync(source.path), false, 'Recovered title renames the original note');
    const after = markdownFiles(join(root, 'documents/vault'));
    assert.deepEqual(after.filter(path => !before.includes(path)), [destination]);
    assert.equal(after.length, before.length);
    await browser.waitUntil(async () => (await backups()).length === 0);
    await browser.refresh();
    await browser.waitUntil(async () => await titleField().getValue() === recoveredTitle);
    assert.equal(await recovery().isExisting(), false, 'Saved recovered work must not be offered again');
    assert.deepEqual(markdownFiles(join(root, 'documents/vault')), after);
    assert.equal(existsSync(source.path), false);
    if (process.env.GNEAUX_RECOVERY_OUTPUT) writeFileSync(join(process.env.GNEAUX_RECOVERY_OUTPUT, 'native-recovery-result.json'), JSON.stringify({
      source: { noteId: source.noteId, path: source.path },
      resumed: { noteId: resumed.noteId, path: resumed.path },
      originalIdentityRetained: true, noteCountUnchanged: true,
      remainingBackups: await backups(), offeredAgainAfterReload: false, processes
    }, null, 2));
  });

  it('retires a title backup after a normal committed save rather than offering a duplicate', async () => {
    const root = realpathSync(await assertDisposable());
    const source = await openSource('Recovery clean save source');
    const count = markdownFiles(join(root, 'documents/vault')).length;
    const changedTitle = 'Recovery clean save renamed';
    await titleField().setValue(changedTitle);
    await browser.waitUntil(async () => (await backups()).some(copy => copy.title === changedTitle));
    await browser.execute(() => (document.querySelector('[data-testid="note-title"]') as HTMLInputElement).blur());
    await browser.waitUntil(async () => {
      const current = await invokeNative<NoteSession>('read_note', { noteId: source.noteId, path: null });
      return current.title === changedTitle && (await backups()).length === 0;
    });
    await browser.refresh();
    await browser.waitUntil(async () => await titleField().getValue() === changedTitle);
    assert.equal(await recovery().isExisting(), false);
    assert.equal(markdownFiles(join(root, 'documents/vault')).length, count);
  });

  it('recovers unfinished body content into the original filename and identity', async () => {
    const root = realpathSync(await assertDisposable());
    const source = await openSource('Recovery same title');
    const raw = readFileSync(source.path, 'utf8');
    const before = markdownFiles(join(root, 'documents/vault'));
    const markdown = `${source.markdown}\n\nUnfinished body from before the interruption.`;
    // Seed the persisted interruption boundary through real native storage;
    // the crash case above separately exercises live input and backup capture.
    await invokeNative('save_draft_backup', { draft: {
      id: randomUUID(), version: 1, title: source.title, markdown,
      tags: [], tagsError: null, sourceNoteId: source.noteId, sourcePath: source.path,
      baseline: { title: source.title, markdown: source.markdown, tags: [], tagsError: null }, updatedAtMillis: 0
    } satisfies DraftBackup });
    await browser.refresh();
    await recovery().waitForDisplayed();
    await recovery().$('summary').click();
    await $('button=Recover work').click();
    await browser.waitUntil(() => readFileSync(source.path, 'utf8').includes('Unfinished body from before the interruption.'));
    const created = markdownFiles(join(root, 'documents/vault')).filter(path => !before.includes(path));
    assert.equal(created.length, 0);
    const resumed = await invokeNative<NoteSession>('read_note', { noteId: source.noteId, path: null });
    assert.equal(resumed.noteId, source.noteId);
    assert.equal(resumed.path, source.path);
    assert.equal(resumed.markdown, markdown);
    assert.notEqual(readFileSync(source.path, 'utf8'), raw);
    await browser.waitUntil(async () => (await backups()).length === 0);
    await browser.refresh();
    await browser.waitUntil(async () => await titleField().getValue() === resumed.title);
    assert.equal(await recovery().isExisting(), false);
    assert.equal(markdownFiles(join(root, 'documents/vault')).length, before.length);
    assert.equal((await invokeNative<NoteSession>('read_note', { noteId: source.noteId, path: null })).markdown, markdown);
    if (process.env.GNEAUX_RECOVERY_OUTPUT) writeFileSync(join(process.env.GNEAUX_RECOVERY_OUTPUT, 'native-same-title-result.json'), JSON.stringify({
      source: { noteId: source.noteId, path: source.path },
      resumed: { noteId: resumed.noteId, path: resumed.path, title: resumed.title },
      originalIdentityRetained: true, unfinishedContentRecovered: true, newFiles: created
    }, null, 2));
  });

  for (const choice of ['Keep my edits', 'Load disk version']) {
    it(`protects a newer disk version until choosing ${choice}`, async () => {
      const root = realpathSync(await assertDisposable());
      const source = await openSource(`Recovery conflict ${choice}`);
      const count = markdownFiles(join(root, 'documents/vault')).length;
      const unfinished = 'Earlier unfinished recovery content.';
      await invokeNative('save_draft_backup', { draft: {
        id: randomUUID(), version: 1, title: source.title, markdown: unfinished,
        tags: [], tagsError: null, sourceNoteId: source.noteId, sourcePath: source.path,
        baseline: { title: source.title, markdown: source.markdown, tags: [], tagsError: null }, updatedAtMillis: 0
      } satisfies DraftBackup });
      const newer = 'Newer content written outside the app.';
      writeFileSync(source.path, readFileSync(source.path, 'utf8').replace(source.markdown, newer));
      const raw = readFileSync(source.path, 'utf8');
      await browser.refresh();
      await recovery().waitForDisplayed(); await recovery().$('summary').click();
      await $('button=Recover work').click();
      const conflict = () => $('[aria-label="External note conflict"]');
      await conflict().waitForDisplayed();
      assert((await $('[data-testid="note-editor"] .cm-content').getText()).includes(unfinished));
      await browser.waitUntil(async () => (await backups()).some(item =>
        item.sourceNoteId === source.noteId && item.markdown === unfinished && !item.baseline));
      assert.equal(readFileSync(source.path, 'utf8'), raw, 'Recovery must wait for an explicit conflict choice');
      if (choice === 'Keep my edits') {
        // Interrupt recovery itself: an unresolved conflict must remain gated.
        await browser.refresh();
        await recovery().waitForDisplayed(); await recovery().$('summary').click();
        await $('button=Recover work').click(); await conflict().waitForDisplayed();
        assert.equal(readFileSync(source.path, 'utf8'), raw);
      }
      await $(`button=${choice}`).click();
      await browser.waitUntil(async () => !(await conflict().isExisting()) && (await backups()).length === 0);
      const result = await invokeNative<NoteSession>('read_note', { noteId: source.noteId, path: null });
      assert.equal(result.noteId, source.noteId); assert.equal(result.path, source.path);
      assert.equal(result.markdown, choice === 'Keep my edits' ? unfinished : newer);
      assert.equal(markdownFiles(join(root, 'documents/vault')).length, count);
      if (choice === 'Load disk version') assert.equal(readFileSync(source.path, 'utf8'), raw);
    });
  }

  it('continues a never-saved idea and publishes exactly one note', async () => {
    const root = realpathSync(await assertDisposable());
    const before = markdownFiles(join(root, 'documents/vault'));
    const title = 'Recovered never-saved idea', markdown = 'A new idea interrupted before its first save.';
    await invokeNative('save_draft_backup', { draft: {
      id: randomUUID(), version: 1, title, markdown, tags: [], tagsError: null,
      sourceNoteId: null, sourcePath: null, baseline: null, updatedAtMillis: 0
    } satisfies DraftBackup });
    await browser.refresh(); await recovery().waitForDisplayed(); await recovery().$('summary').click();
    await $('button=Recover work').click();
    const destination = join(root, 'documents/vault', `${title}.md`);
    await browser.waitUntil(() => existsSync(destination));
    const result = await invokeNative<NoteSession>('read_note', { noteId: null, path: destination });
    assert.equal(result.markdown, markdown);
    assert.equal(markdownFiles(join(root, 'documents/vault')).length, before.length + 1);
    await browser.waitUntil(async () => (await backups()).length === 0);
    await browser.refresh(); await browser.waitUntil(async () => await titleField().getValue() === title);
    assert.equal(await recovery().isExisting(), false);
  });

  it('retains a missing original’s backup without publishing a replacement', async () => {
    const root = realpathSync(await assertDisposable());
    const before = markdownFiles(join(root, 'documents/vault'));
    const id = randomUUID();
    await invokeNative('save_draft_backup', { draft: {
      id, version: 1, title: 'Missing original', markdown: 'Keep these unfinished bytes.', tags: [], tagsError: null,
      sourceNoteId: randomUUID(), sourcePath: join(root, 'documents/vault/Does not exist.md'), updatedAtMillis: 0
    } satisfies DraftBackup });
    await browser.refresh(); await recovery().waitForDisplayed(); await recovery().$('summary').click();
    await $('button=Recover work').click();
    await browser.waitUntil(async () => (await recovery().getText()).includes('Recovery could not complete'));
    assert((await backups()).some(item => item.id === id));
    assert.deepEqual(markdownFiles(join(root, 'documents/vault')), before);
    await $('button=Discard').click();
    await browser.waitUntil(async () => (await backups()).length === 0);
  });
});
