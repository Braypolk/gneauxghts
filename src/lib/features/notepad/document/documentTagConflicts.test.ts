import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDocumentEditingService } from './documentEditingService';
import { createDocumentConflictController } from './documentConflictController';
import { createNotepadPersistenceController } from '../orchestration/persistenceController';
import { createNoteCommandController } from '../orchestration/noteCommandController';
import { createNoteDraftState, createNotepadState, bindNotepadStateToVault } from '../state/noteStore';
import { createSessionSnapshot, readNoteSession } from '../session/session';
import { documentRegistry } from './documentRegistry';
import { dispatchDocumentExternalSync, externalDocumentSnapshotFromCommittedNote } from './documentState';
import type { NoteSession } from '../model/types';
import type { TagEdit } from '../session/session';

vi.mock('../session/session', async (original) => ({
  ...await original<typeof import('../session/session')>(), readNoteSession: vi.fn()
}));

function setup(tagsError?: string, tags = tagsError ? [] : ['old']) {
  let disk: NoteSession = { noteId: 'note', path: '/vault/Note.md', title: 'Note', markdown: 'body', tags, tagsError };
  const note = createNoteDraftState(createSessionSnapshot(disk));
  const state = createNotepadState(note);
  bindNotepadStateToVault(state, '/vault');
  const editing = createDocumentEditingService({
    state, isApplyingProgrammaticUpdate: () => false, shouldSuppressAutosave: () => false,
    isTitleEditing: () => false, resetPaneCommandAfterBodyInput: vi.fn(),
    clearRecentlyForgotten: vi.fn(), clearSelectedRelatedText: vi.fn(),
    scheduleAutosave: vi.fn(), scheduleSearch: vi.fn(), scheduleRelated: vi.fn()
  });
  const save = vi.fn(async (title: string, markdown: string, _path: string | null, edit?: TagEdit) => {
    if (edit && JSON.stringify(edit.previous) !== JSON.stringify(disk.tags)) throw new Error('Tags changed outside the app');
    disk = { ...disk, title, markdown, tags: edit?.tags ?? disk.tags };
    return disk;
  });
  const persistence = createNotepadPersistenceController({
    getDocumentSession: () => note, saveNoteSession: save, documentEditing: editing
  });
  const conflicts = createDocumentConflictController({
    replaceDocumentContentInPlace: async () => 'applied', enqueueSave: persistence.enqueueSave,
    resolveUsingExternal: editing.resolveUsingExternal, copyText: async () => {}
  });
  function observe(tags: string[]) {
    disk = { ...disk, tags };
    dispatchDocumentExternalSync(note, { type: 'externalCaptured', external: {
      kind: 'snapshot', source: 'watcher', document: externalDocumentSnapshotFromCommittedNote(disk)
    } });
  }
  return { note, editing, persistence, conflicts, save, observe, getDisk: () => disk };
}

afterEach(() => {
  for (const runtime of [...documentRegistry.values()]) documentRegistry.dispose(runtime.documentHandle);
  vi.clearAllMocks();
});

describe('tag conflict save coordination', () => {
  it('saves local tags against the reviewed external version through the normal save queue', async () => {
    const h = setup();
    h.editing.updateTags(h.note, ['local']);
    h.editing.recordUserEdit('left', h.note, 'local body');
    h.observe(['external']);
    await expect(h.conflicts.keepMyEdits(h.note)).resolves.toBe(true);
    expect(h.save).toHaveBeenCalledWith('Note', 'local body', '/vault/Note.md', { previous: ['external'], tags: ['local'] });
    expect(h.getDisk().tags).toEqual(['local']);
    expect(h.persistence.hasCleanBuffer(h.note)).toBe(true);
    expect(h.note.externalSync.kind).toBe('noConflict');
  });

  it('keeps the conflict available after publication fails, then permits retry', async () => {
    const h = setup();
    h.editing.updateTags(h.note, ['local']);
    h.observe(['external']);
    h.save.mockRejectedValueOnce(new Error('disk unavailable'));
    await expect(h.conflicts.keepMyEdits(h.note)).rejects.toThrow('disk unavailable');
    expect(h.note.externalSync.kind).toBe('conflict');
    expect(h.note.working.tags).toEqual(['local']);
    await expect(h.conflicts.keepMyEdits(h.note)).resolves.toBe(true);
    expect(h.getDisk().tags).toEqual(['local']);
  });

  it('preserves externally changed tags when keeping body-only edits', async () => {
    const h = setup();
    h.editing.recordUserEdit('left', h.note, 'local body');
    h.observe(['external']);
    await h.conflicts.keepMyEdits(h.note);
    expect(h.save).toHaveBeenCalledWith('Note', 'local body', '/vault/Note.md');
    expect(h.note.working.tags).toEqual(['external']);
    expect(h.getDisk().tags).toEqual(['external']);
  });

  it('retains an unsaved tag removal when external YAML cannot be patched', async () => {
    const h = setup();
    h.editing.updateTags(h.note, []);
    h.getDisk().tagsError = 'Invalid YAML';
    h.observe([]);
    await expect(h.conflicts.keepMyEdits(h.note)).rejects.toThrow('Invalid YAML');
    expect(h.note.externalSync.kind).toBe('conflict');
    expect(h.note.working.tags).toEqual([]);
    expect(h.save).not.toHaveBeenCalled();
  });

  it('does not replace a newer external conflict when an older save fails', async () => {
    const h = setup();
    h.editing.updateTags(h.note, ['local']);
    h.observe(['external']);
    h.save.mockImplementationOnce(async () => {
      h.observe(['newer']);
      throw new Error('Tags changed outside the app');
    });
    await expect(h.conflicts.keepMyEdits(h.note)).rejects.toThrow();
    expect(h.note.externalSync).toMatchObject({ kind: 'conflict', external: { document: { content: { tags: ['newer'] } } } });
  });

  it('keeps local tags when recreating an externally deleted note', async () => {
    const h = setup();
    h.editing.updateTags(h.note, ['local']);
    h.observe([]);
    dispatchDocumentExternalSync(h.note, { type: 'externalCaptured', external: { kind: 'deletion', source: 'watcher', path: '/vault/Note.md' } });
    await expect(h.conflicts.keepMyEdits(h.note)).resolves.toBe(true);
    expect(h.save).toHaveBeenCalledWith('Note', 'body', '/vault/Note.md', { previous: [], tags: ['local'] });
  });
});

describe('external YAML diagnostics refresh', () => {
  it.each([['Invalid YAML', undefined], [undefined, 'Invalid YAML']] as const)(
    'adopts a tags error change from %s to %s with unchanged authored content', async (before, after) => {
      // Start with a session-loaded note, whose saved authored baseline does
      // not contain parsing diagnostics. Both snapshots have empty tag values.
      const h = setup(before, []);
      vi.mocked(readNoteSession).mockResolvedValue({ ...h.getDisk(), tags: [], tagsError: after });
      const commands = createNoteCommandController({ base: { persistence: h.persistence, documentEditing: h.editing }, transitions: {} } as never);
      await expect(commands.refreshDocumentFromDisk(h.note, { source: 'watcher' })).resolves.toBe('refreshed');
      expect(h.note.working.tagsError).toBe(after);
      expect(h.persistence.hasCleanBuffer(h.note)).toBe(true);
      expect(h.save).not.toHaveBeenCalled();
      await expect(commands.refreshDocumentFromDisk(h.note)).resolves.toBe('unchanged');
    }
  );
});
