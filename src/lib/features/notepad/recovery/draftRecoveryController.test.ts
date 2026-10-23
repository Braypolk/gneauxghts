import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DraftRecoveryController, type DraftBackup } from './draftRecoveryController.svelte';
import { createNoteDraftState } from '../state/noteStore';
import { applySessionSnapshotToDocument, dispatchDocumentExternalSync, updateDocumentMarkdown, type NoteDraftState } from '../document/documentState';
import { createEmptySessionSnapshot } from '../session/session';

const uuid = '59118da1-47f3-4f8a-9657-ef2cd813d362';
function draft(markdown = 'A quick idea') { const note = createNoteDraftState(); updateDocumentMarkdown(note, markdown); return note; }
function clean(note: NoteDraftState) {
  const markdown = note.working.body.toMarkdown();
  applySessionSnapshotToDocument(note, { ...createEmptySessionSnapshot(), title: note.working.title, bodyMarkdown: markdown,
    currentNoteId: 'saved', currentNotePath: '/vault/saved.md', lastSavedNoteId: 'saved', lastSavedPath: '/vault/saved.md',
    lastSavedTitle: note.working.title, lastSavedMarkdown: markdown });
}
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function fixture(notes: NoteDraftState[] = [draft()]) {
  const save = vi.fn<(value: DraftBackup) => Promise<unknown>>().mockResolvedValue(undefined);
  const list = vi.fn<() => Promise<DraftBackup[]>>().mockResolvedValue([]);
  const remove = vi.fn<(id: string, version: number) => Promise<unknown>>().mockResolvedValue(undefined);
  const recover = vi.fn<(backup: DraftBackup) => Promise<NoteDraftState>>().mockImplementation(async backup => {
    const note = draft();
    if (backup.sourceNoteId) applySessionSnapshotToDocument(note, { ...createEmptySessionSnapshot(),
      currentNoteId: backup.sourceNoteId, currentNotePath: backup.sourcePath,
      lastSavedNoteId: backup.sourceNoteId, lastSavedPath: backup.sourcePath,
      lastSavedMarkdown: 'Saved base', bodyMarkdown: 'Saved base' });
    updateDocumentMarkdown(note, backup.markdown); notes.push(note); return note;
  });
  const recovery = new DraftRecoveryController({ getDocuments: () => notes, save, list, remove, recover, createId: () => crypto.randomUUID() });
  return { recovery, save, list, remove, recover, notes };
}
const backup: DraftBackup = { id: uuid, version: 4, title: 'Interrupted idea', markdown: 'Recover these bytes', tags: ['project'],
  tagsError: 'Unreadable tags', sourceNoteId: 'source', sourcePath: '/vault/source.md', updatedAtMillis: 1 };

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('private draft recovery', () => {
  it('coalesces immutable bodies without serializing on every keystroke', async () => {
    const f = fixture(); const note = f.notes[0];
    const first = vi.spyOn(note.working.body, 'toMarkdown');
    f.recovery.track(note);
    await vi.advanceTimersByTimeAsync(200);
    updateDocumentMarkdown(note, 'newest idea');
    const latest = vi.spyOn(note.working.body, 'toMarkdown');
    f.recovery.track(note);
    expect(first).not.toHaveBeenCalled(); expect(latest).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(400);
    expect(first).not.toHaveBeenCalled(); expect(latest).toHaveBeenCalledOnce();
    expect(f.save).toHaveBeenCalledOnce(); expect(f.save.mock.calls[0][0]).toMatchObject({ markdown: 'newest idea', version: 2 });
    f.recovery.dispose(); await f.recovery.retry();
  });

  it('writes periodically under continuous typing instead of resetting the delay forever', async () => {
    const f = fixture();
    for (let index = 0; index < 7; index++) {
      updateDocumentMarkdown(f.notes[0], `idea ${index}`); f.recovery.track(f.notes[0]); await vi.advanceTimersByTimeAsync(300);
    }
    expect(f.save).toHaveBeenCalledOnce();
    expect(f.save.mock.calls[0][0].markdown).toBe('idea 6');
    f.recovery.dispose(); await f.recovery.retry();
  });

  it('allows one backup write and replaces queued intermediate edits with the latest capture', async () => {
    const f = fixture(); const pending = deferred<unknown>();
    f.save.mockImplementationOnce(() => pending.promise);
    f.recovery.track(f.notes[0]); await vi.advanceTimersByTimeAsync(400);
    for (const text of ['second', 'third']) { updateDocumentMarkdown(f.notes[0], text); f.recovery.track(f.notes[0]); }
    const flushed = f.recovery.flushAll();
    expect(f.save).toHaveBeenCalledTimes(1);
    pending.resolve(undefined); await flushed;
    expect(f.save.mock.calls.map(([capture]) => capture.markdown)).toEqual(['A quick idea', 'third']);
    f.recovery.dispose(); await f.recovery.retry();
  });

  it('keeps newer dirty work after an earlier canonical save and retires only a clean buffer', async () => {
    const f = fixture(); const note = f.notes[0]; f.recovery.track(note); await f.recovery.flushAll();
    updateDocumentMarkdown(note, 'newer typing'); f.recovery.track(note); f.recovery.onSaved(note);
    await f.recovery.flushAll(); expect(f.remove).not.toHaveBeenCalled();
    clean(note); f.recovery.onSaved(note); await f.recovery.flushAll();
    expect(f.remove).toHaveBeenCalledOnce();
    expect(f.remove.mock.calls[0][1]).toBeGreaterThan(f.save.mock.calls.at(-1)![0].version);
    await f.recovery.flushAll(); expect(f.remove).toHaveBeenCalledOnce();
    f.recovery.dispose();
  });

  it('orders a tombstone after the active backup so stale work cannot revive a saved buffer', async () => {
    const f = fixture(); const pending = deferred<unknown>(); f.save.mockImplementationOnce(() => pending.promise);
    f.recovery.track(f.notes[0]); await vi.advanceTimersByTimeAsync(400);
    clean(f.notes[0]); f.recovery.onSaved(f.notes[0]); const flushing = f.recovery.flushAll();
    expect(f.remove).not.toHaveBeenCalled(); pending.resolve(undefined); await flushing;
    expect(f.remove).toHaveBeenCalledWith(f.save.mock.calls[0][0].id, 2); f.recovery.dispose();
  });

  it('retains UUID and advances versions across remounts of the same document', async () => {
    const notes = [draft()]; const first = fixture(notes); first.recovery.track(notes[0]); await first.recovery.flushAll(); first.recovery.dispose();
    updateDocumentMarkdown(notes[0], 'after remount'); const next = fixture(notes); next.recovery.track(notes[0]); await next.recovery.flushAll();
    expect(next.save.mock.calls[0][0].id).toBe(first.save.mock.calls[0][0].id);
    expect(next.save.mock.calls[0][0].version).toBeGreaterThan(first.save.mock.calls[0][0].version);
    next.list.mockResolvedValue([next.save.mock.calls[0][0]]); await next.recovery.load(); expect(next.recovery.backups).toEqual([]);
    next.recovery.dispose();
  });

  it('keeps failures visible and retryable without rejecting a canonical barrier', async () => {
    const f = fixture(); f.save.mockRejectedValueOnce(new Error('Disk full')); f.recovery.track(f.notes[0]);
    await expect(f.recovery.flushAll()).resolves.toBeUndefined(); expect(f.recovery.backupError).toContain('could not be saved');
    await f.recovery.retry(); expect(f.recovery.backupError).toBeNull(); expect(f.save).toHaveBeenCalledTimes(2); f.recovery.dispose();
  });

  it('retains the backup until restored work is backed up and reuses the document on retry', async () => {
    const f = fixture([]); f.list.mockResolvedValue([backup]); await f.recovery.load();
    f.save.mockRejectedValueOnce(new Error('Backup blocked')); await f.recovery.resume(backup);
    expect(f.remove).not.toHaveBeenCalled(); expect(f.recovery.backups).toEqual([backup]); expect(f.recovery.actionError).toBeTruthy();
    await f.recovery.resume(backup);
    expect(f.recover).toHaveBeenCalledOnce(); expect(f.remove).toHaveBeenCalledWith(uuid, 5); expect(f.recovery.backups).toEqual([]);
    f.recovery.dispose(); await f.recovery.retry();
  });

  it('never accepts a different note identity as the recovery destination', async () => {
    const f = fixture([]); const source = draft(); clean(source); f.recover.mockResolvedValue(source);
    await f.recovery.resume(backup); expect(f.remove).not.toHaveBeenCalled(); expect(f.save).not.toHaveBeenCalled(); expect(f.recovery.actionError).toBeTruthy(); f.recovery.dispose();
  });

  it('retains recoverable work when the original note cannot be opened', async () => {
    const f = fixture([]); f.list.mockResolvedValue([backup]); await f.recovery.load();
    f.recover.mockRejectedValue(new Error('Original note missing'));
    await f.recovery.resume(backup);
    expect(f.recovery.backups).toEqual([backup]); expect(f.recovery.actionError).toBeTruthy();
    expect(f.save).not.toHaveBeenCalled(); expect(f.remove).not.toHaveBeenCalled();
    f.recovery.dispose();
  });

  it('hands a never-saved idea back to an identity-free draft', async () => {
    const f = fixture([]); const idea = { ...backup, sourceNoteId: null, sourcePath: null };
    await f.recovery.resume(idea);
    expect(f.recovery.actionError).toBeNull();
    expect(f.save.mock.calls[0][0]).toMatchObject({ sourceNoteId: null, sourcePath: null, baseline: null, markdown: idea.markdown });
    expect(f.remove).toHaveBeenCalledWith(uuid, 5);
    f.recovery.dispose(); await f.recovery.retry();
  });

  it('keeps an unresolved recovery conflict uncertain in the next durable backup', async () => {
    const f = fixture(); const note = f.notes[0]; clean(note);
    updateDocumentMarkdown(note, 'Unfinished earlier work');
    dispatchDocumentExternalSync(note, { type: 'externalCaptured', external: { kind: 'snapshot', source: 'recovery',
      document: { content: note.savedBaseline!.content, identity: note.savedBaseline!.identity, savedBaseline: note.savedBaseline } } });
    await f.recovery.flushAll();
    expect(f.save.mock.calls[0][0]).toMatchObject({ baseline: null, sourceNoteId: 'saved', markdown: 'Unfinished earlier work' });
    f.recovery.dispose(); await f.recovery.retry();
  });

  it('ignores obsolete load completions and does not re-add a discarded row', async () => {
    const f = fixture([]); const loading = deferred<DraftBackup[]>(); f.list.mockReturnValueOnce(loading.promise);
    const load = f.recovery.load(); await f.recovery.discard(backup); loading.resolve([backup]); await load;
    expect(f.recovery.backups).toEqual([]); f.recovery.dispose();
  });

  it('backs up an uncommitted title field on a clean note without retiring it after another save', async () => {
    const note = draft(); clean(note);
    let titleField = 'A title still being typed';
    const save = vi.fn().mockResolvedValue(undefined), remove = vi.fn().mockResolvedValue(undefined);
    const recovery = new DraftRecoveryController({ getDocuments: () => [note], readTitle: () => titleField,
      recover: async () => draft(), save, remove });
    recovery.track(note); await recovery.flushAll(); recovery.onSaved(note); await recovery.flushAll();
    expect(save.mock.calls[0][0]).toMatchObject({ title: titleField, markdown: 'A quick idea', sourceNoteId: 'saved',
      baseline: { title: note.working.title, markdown: 'A quick idea', tags: [], tagsError: null } });
    expect(remove).not.toHaveBeenCalled();
    titleField = note.working.title;
    await recovery.flushAll(); expect(remove).toHaveBeenCalledOnce(); recovery.dispose();
  });
});
