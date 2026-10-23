import { DocumentBody } from '#lib/features/notepad/document/documentBody.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDocumentEditingService } from './documentEditingService';
import {
  createNoteDraftState,
  createNotepadState,
  bindNotepadStateToVault,
  findOpenDocument
} from '#lib/features/notepad/state/noteStore.js';
import { createEmptySessionSnapshot, createSessionSnapshot } from '#lib/features/notepad/session/session.js';
import type { DraftBackup } from '../recovery/draftBackup';
import {
  dispatchDocumentOperation,
  updateDocumentMarkdown,
  documentHasCleanBuffer,
  updateDocumentTitle
} from './documentState';
import { documentRegistry } from './documentRegistry';

function createHarness(
  options: { external?: boolean } = {},
  snapshot = createEmptySessionSnapshot()
) {
  const note = createNoteDraftState(snapshot);
  const state = createNotepadState(note);
  bindNotepadStateToVault(state, '/vault');
  const scheduleAutosave = vi.fn();
  const scheduleSearch = vi.fn();
  const scheduleRelated = vi.fn();
  const service = createDocumentEditingService({
    state,
    isApplyingProgrammaticUpdate: () => options.external ?? false,
    isTitleEditing: () => false,
    resetPaneCommandAfterBodyInput: vi.fn(),
    clearRecentlyForgotten: vi.fn(),
    scheduleAutosave,
    scheduleSearch,
    scheduleRelated
  });
  return {
    note,
    state,
    service,
    scheduleAutosave,
    scheduleSearch,
    scheduleRelated
  };
}

afterEach(() => {
  for (const runtime of [...documentRegistry.values()]) {
    documentRegistry.dispose(runtime.documentHandle);
  }
});

const savedRecoverySource = { noteId: 'source', path: '/vault/Source.md', title: 'Source', markdown: 'Saved body', tags: ['old'] };
function recoveryBackup(overrides: Partial<DraftBackup> = {}): DraftBackup {
  return { id: 'backup', version: 1, title: 'Recovered idea', markdown: 'The body', tags: ['garden'], tagsError: null,
    sourceNoteId: null, sourcePath: null, updatedAtMillis: 1, ...overrides };
}
function existingBackup(overrides: Partial<DraftBackup> = {}): DraftBackup {
  return recoveryBackup({ sourceNoteId: savedRecoverySource.noteId, sourcePath: savedRecoverySource.path,
    baseline: { title: savedRecoverySource.title, markdown: savedRecoverySource.markdown, tags: savedRecoverySource.tags, tagsError: null }, ...overrides });
}

describe('documentEditingService', () => {
  it('restores a never-saved idea into an empty draft through ordinary editor ownership', () => {
    const harness = createHarness();
    harness.service.restoreRecoveryDraft(harness.note, recoveryBackup());
    expect(harness.note.identity).toEqual({ kind: 'draft' });
    expect(harness.note.savedBaseline).toBeNull();
    expect(harness.note.working.title).toBe('Recovered idea');
    expect(harness.note.working.body.toMarkdown()).toBe('The body');
    expect(harness.note.working.tags).toEqual(['garden']);
    expect(documentHasCleanBuffer(harness.note)).toBe(false);
    expect(harness.scheduleAutosave).toHaveBeenCalledWith(harness.note);
    expect(() => harness.service.restoreRecoveryDraft(harness.note, recoveryBackup({
      title: 'Other', markdown: 'Do not overwrite', tags: []
    }))).toThrow('current edits');
    expect(harness.note.working.body.toMarkdown()).toBe('The body');
  });

  it('recovers into the original identity and saved baseline without creating a document', () => {
    const f = createHarness({}, createSessionSnapshot(savedRecoverySource));
    const handle = f.note.handle, baseline = f.note.savedBaseline;
    f.service.restoreRecoveryDraft(f.note, existingBackup());
    expect(f.note.handle).toBe(handle);
    expect(f.note.identity).toEqual({ kind: 'persisted', noteId: 'source', path: '/vault/Source.md' });
    expect(f.note.savedBaseline).toBe(baseline);
    expect(f.note.working.body.toMarkdown()).toBe('The body');
    expect(f.note.externalSync.kind).toBe('noConflict');
    expect(f.scheduleAutosave).toHaveBeenCalledWith(f.note);
    expect(Object.keys(f.state.documentsByHandle)).toEqual([handle]);
  });

  it.each(['body', 'title', 'tags', 'legacy'] as const)('requires a conflict choice when the saved %s differs or is unknown', kind => {
    const current = { ...savedRecoverySource,
      ...(kind === 'body' ? { markdown: 'Newer disk work' } : {}),
      ...(kind === 'title' ? { title: 'Externally renamed', path: '/vault/Externally renamed.md' } : {}),
      ...(kind === 'tags' ? { tags: ['newer'] } : {}) };
    const f = createHarness({}, createSessionSnapshot(current));
    f.service.restoreRecoveryDraft(f.note, existingBackup(kind === 'legacy' ? { baseline: undefined } : {}));
    expect(f.note.working.body.toMarkdown()).toBe('The body');
    expect(f.note.identity).toEqual({ kind: 'persisted', noteId: 'source', path: current.path });
    expect(f.note.externalSync).toMatchObject({ kind: 'conflict', external: { kind: 'snapshot', source: 'recovery' } });
    if (f.note.externalSync.kind === 'conflict' && f.note.externalSync.external.kind === 'snapshot') {
      expect(f.note.externalSync.external.document.content.body.toMarkdown()).toBe(current.markdown);
    }
    expect(f.scheduleAutosave).not.toHaveBeenCalled();
  });

  it('recognizes already-saved recovered work without another save', () => {
    const f = createHarness({}, createSessionSnapshot(savedRecoverySource));
    f.service.restoreRecoveryDraft(f.note, existingBackup({ title: savedRecoverySource.title,
      markdown: savedRecoverySource.markdown, tags: savedRecoverySource.tags, baseline: undefined }));
    expect(documentHasCleanBuffer(f.note)).toBe(true);
    expect(f.scheduleAutosave).not.toHaveBeenCalled();
    expect(f.note.externalSync.kind).toBe('noConflict');
  });

  it('refuses a replacement identity or newer unsaved editor work', () => {
    const f = createHarness({}, createSessionSnapshot(savedRecoverySource));
    expect(() => f.service.restoreRecoveryDraft(f.note, existingBackup({ sourceNoteId: 'different' }))).toThrow('original note');
    updateDocumentMarkdown(f.note, 'New unsaved edits');
    expect(() => f.service.restoreRecoveryDraft(f.note, existingBackup())).toThrow('current edits');
    expect(f.note.working.body.toMarkdown()).toBe('New unsaved edits');
  });

  it('increments the operation revision once per actual markdown change', () => {
    const harness = createHarness();
    const revision = harness.note.operation.revision;

    expect(harness.service.recordUserEdit('left', harness.note, DocumentBody.fromMarkdown('hello'))).toBe(true);
    expect(harness.note.operation.revision).toBe(revision + 1);
    expect(harness.service.recordUserEdit('left', harness.note, DocumentBody.fromMarkdown('hello'))).toBe(false);
    expect(harness.note.operation.revision).toBe(revision + 1);
  });


  it('does not treat a programmatic editor callback as another edit', () => {
    const harness = createHarness({ external: true });
    expect(
      harness.service.recordUserEdit('left', harness.note, DocumentBody.fromMarkdown('replacement'))
    ).toBe(false);

    expect(harness.note.working.body.toMarkdown()).toBe('');
    expect(harness.scheduleAutosave).not.toHaveBeenCalled();
    expect(harness.scheduleSearch).not.toHaveBeenCalled();
  });

  it('adopts saved identity, baseline, and warning while preserving later title and body edits', async () => {
    const harness = createHarness();
    updateDocumentTitle(harness.note, 'captured title');
    updateDocumentMarkdown(harness.note, 'captured body');
    dispatchDocumentOperation(harness.note, {
      type: 'start',
      operation: 'saving'
    });
    const capture = harness.service.captureSave(harness.note);

    updateDocumentTitle(harness.note, 'later title');
    updateDocumentMarkdown(harness.note, 'later body');
    const warning = {
      message: 'History finalization pending',
      issues: [{ stage: 'historyFinalization' as const, message: 'retry' }]
    };
    const adopted = await harness.service.adoptSavedResult(capture, {
      noteId: 'note-id',
      title: 'captured title',
      markdown: 'captured body',
      path: '/vault/saved.md',
      commitWarning: warning
    });

    expect(adopted?.working).toEqual({
      title: 'later title',
      body: DocumentBody.fromMarkdown('later body')
    });
    expect(adopted?.savedBaseline?.content).toEqual({
      title: 'captured title',
      body: DocumentBody.fromMarkdown('captured body')
    });
    expect(adopted?.publication.warning).toEqual(warning);
    expect(adopted?.identity).toEqual({
      kind: 'persisted',
      noteId: 'note-id',
      path: '/vault/saved.md'
    });
  });

  it('keeps one document, handle, registry entry, and editor root through first save and title rename', async () => {
    const harness = createHarness();
    const originalHandle = harness.note.handle;
    const registryEntry = documentRegistry.ensure(originalHandle);
    const resources = registryEntry.ensureResources({
      assetRootPath: '/vault/assets',
      storePastedImage: vi.fn()
    });
    updateDocumentTitle(harness.note, 'First title');
    updateDocumentMarkdown(harness.note, 'shared body');
    resources.runtime.ensureMarkdown('shared body');

    dispatchDocumentOperation(harness.note, {
      type: 'start',
      operation: 'saving'
    });
    await harness.service.adoptSavedResult(
      harness.service.captureSave(harness.note),
      {
        noteId: 'note-id',
        title: 'First title',
        markdown: 'shared body',
        path: '/vault/First title.md'
      }
    );
    updateDocumentTitle(harness.note, 'Renamed');
    dispatchDocumentOperation(harness.note, {
      type: 'start',
      operation: 'saving'
    });
    await harness.service.adoptSavedResult(
      harness.service.captureSave(harness.note),
      {
        noteId: 'note-id',
        title: 'Renamed',
        markdown: 'shared body',
        path: '/vault/Renamed.md'
      }
    );

    expect(harness.note.handle).toBe(originalHandle);
    expect(documentRegistry.get(originalHandle)).toBe(registryEntry);
    expect(registryEntry.resources()).toBe(resources);
    expect(registryEntry.resources()?.runtime).toBe(resources.runtime);
    expect(resources.runtime.markdown).toBe('shared body');
    expect(findOpenDocument(harness.state, {
      noteId: 'note-id',
      path: '/vault/Renamed.md'
    })).toBe(harness.note);
    expect(findOpenDocument(harness.state, {
      noteId: null,
      path: '/vault/First title.md'
    })).toBeNull();
  });

  it('ignores a saved result whose operation token was invalidated', async () => {
    const harness = createHarness();
    updateDocumentMarkdown(harness.note, 'captured');
    dispatchDocumentOperation(harness.note, {
      type: 'start',
      operation: 'saving'
    });
    const capture = harness.service.captureSave(harness.note);
    dispatchDocumentOperation(harness.note, { type: 'invalidate' });

    await expect(harness.service.adoptSavedResult(capture, {
      noteId: 'note-id',
      title: 'saved',
      markdown: 'captured',
      path: '/vault/saved.md'
    })).resolves.toBeNull();
    expect(harness.note.savedBaseline).toBeNull();
  });

  it('treats Version Restore of an unopened citation target as successful without creating documents or runtimes', async () => {
    const harness = createHarness();
    const existingRuntime = documentRegistry.ensure(harness.note.handle);
    const stateBefore = structuredClone(harness.state);
    const runtimesBefore = [...documentRegistry.values()];

    await expect(harness.service.adoptVersionRestore({
      noteId: 'citation-note',
      title: 'Citation',
      markdown: 'restored',
      path: '/vault/citation.md'
    })).resolves.toEqual({ kind: 'notOpen' });
    expect(harness.state).toEqual(stateBefore);
    expect(harness.state.documentsByHandle[harness.note.handle]).toBe(harness.note);
    expect([...documentRegistry.values()]).toEqual(runtimesBefore);
    expect(documentRegistry.get(harness.note.handle)).toBe(existingRuntime);
  });

  it('updates a chat-only retained document and its existing shared runtime', async () => {
    const harness = createHarness({}, {
      ...createEmptySessionSnapshot(),
      title: 'Note',
      bodyMarkdown: 'before',
      currentNoteId: 'note-id',
      currentNotePath: '/vault/note.md',
      lastSavedTitle: 'Note',
      lastSavedMarkdown: 'before',
      lastSavedNoteId: 'note-id',
      lastSavedPath: '/vault/note.md'
    });
    const runtime = documentRegistry
      .ensure(harness.note.handle)
      .ensureResources({
        assetRootPath: null,
        storePastedImage: vi.fn()
      }).runtime;
    runtime.ensureMarkdown('before');

    const outcome = await harness.service.adoptVersionRestore({
      noteId: 'note-id',
      title: 'Restored',
      markdown: 'after',
      path: '/vault/note.md'
    });

    expect(outcome).toMatchObject({ kind: 'adopted' });
    expect(harness.note.savedBaseline?.content).toEqual({
      title: 'Restored',
      body: DocumentBody.fromMarkdown('after')
    });
    expect(runtime.markdown).toBe('after');
    expect(runtime.attachedPaneCount).toBe(0);
    expect(runtime.undo(null)).toBe(false);
  });

  it('starts a fresh shared undo root for a properties-only Version Restore', async () => {
    const harness = createHarness({}, {
      ...createEmptySessionSnapshot(),
      title: 'Before',
      bodyMarkdown: 'same body',
      currentNoteId: 'note-id',
      currentNotePath: '/vault/note.md',
      lastSavedTitle: 'Before',
      lastSavedMarkdown: 'same body',
      lastSavedNoteId: 'note-id',
      lastSavedPath: '/vault/note.md'
    });
    const runtime = documentRegistry
      .ensure(harness.note.handle)
      .ensureResources({
        assetRootPath: null,
        storePastedImage: vi.fn()
      }).runtime;
    runtime.ensureMarkdown('same body');
    const revision = runtime.revision;

    await harness.service.adoptVersionRestore({
      noteId: 'note-id',
      title: 'After',
      markdown: 'same body',
      path: '/vault/note.md'
    });

    expect(harness.note.working.title).toBe('After');
    expect(runtime.markdown).toBe('same body');
    expect(runtime.revision).toBe(revision + 1);
    expect(runtime.undo(null)).toBe(false);
    expect(harness.scheduleAutosave).not.toHaveBeenCalled();
  });

  it('applies clean external refresh and transient Forgotten-Note Recovery with fixed policies', async () => {
    const harness = createHarness({}, {
      ...createEmptySessionSnapshot(),
      title: 'Note',
      bodyMarkdown: 'before',
      currentNoteId: 'note-id',
      currentNotePath: '/vault/note.md',
      lastSavedTitle: 'Note',
      lastSavedMarkdown: 'before',
      lastSavedNoteId: 'note-id',
      lastSavedPath: '/vault/note.md'
    });

    await harness.service.adoptCleanExternalRefresh(harness.note, {
      noteId: 'note-id',
      title: 'External',
      markdown: 'external body',
      path: '/vault/note.md'
    });
    expect(harness.note.working.body.toMarkdown()).toBe('external body');
    expect(harness.scheduleAutosave).not.toHaveBeenCalled();

    harness.service.restoreTransientForgotten(harness.note, {
      title: 'Recovered draft',
      bodyMarkdown: 'recovered body',
      currentNoteId: null,
      currentNotePath: null,
      forgottenPath: null
    });
    expect(harness.note.identity).toEqual({ kind: 'draft' });
    expect(harness.note.savedBaseline).toBeNull();
    expect(harness.note.working.body.toMarkdown()).toBe('recovered body');
    expect(harness.scheduleAutosave).toHaveBeenCalledOnce();
  });

  it('restores transient Forgotten content with its current identity but no saved baseline', () => {
    const harness = createHarness();

    harness.service.restoreTransientForgotten(harness.note, {
      title: 'Recovered note',
      bodyMarkdown: 'recovered body',
      currentNoteId: 'remembered-id',
      currentNotePath: '/vault/Remembered.md',
      forgottenPath: null
    });

    expect(harness.note.identity).toEqual({
      kind: 'persisted',
      noteId: 'remembered-id',
      path: '/vault/Remembered.md'
    });
    expect(harness.note.savedBaseline).toBeNull();
    expect(harness.note.working).toEqual({
      title: 'Recovered note',
      body: DocumentBody.fromMarkdown('recovered body')
    });
    expect(harness.scheduleAutosave).toHaveBeenCalledOnce();
  });

  it('reconciles a queued runtime replacement to a newer user edit', async () => {
    const harness = createHarness();
    let releaseFirstApply!: () => void;
    const firstApply = new Promise<void>((resolve) => {
      releaseFirstApply = resolve;
    });
    const appliedMarkdown: string[] = [];
    const applyRuntime = vi.fn(async (markdown: string) => {
      appliedMarkdown.push(markdown);
      if (appliedMarkdown.length === 1) await firstApply;
    });

    const replacement = harness.service.replaceMarkdown(
      harness.note,
      'programmatic',
      applyRuntime
    );
    await vi.waitFor(() => {
      expect(applyRuntime).toHaveBeenCalledOnce();
    });
    harness.service.recordUserEdit('left', harness.note, DocumentBody.fromMarkdown('newer user edit'));
    releaseFirstApply();
    await replacement;

    expect(appliedMarkdown).toEqual(['programmatic', 'newer user edit']);
    expect(harness.note.working.body.toMarkdown()).toBe('newer user edit');
  });
});

describe('authored note tags', () => {
  it('uses the shared draft and ordinary autosave without replacing the body', () => {
    const h = createHarness();
    h.service.recordUserEdit('left', h.note, DocumentBody.fromMarkdown('Body stays intact'));
    h.scheduleAutosave.mockClear();
    expect(h.service.updateTags(h.note, ['renovation'])).toBe(true);
    expect(h.note.working.body.toMarkdown()).toBe('Body stays intact');
    expect(h.scheduleAutosave).toHaveBeenCalledExactlyOnceWith(h.note);
    expect(documentHasCleanBuffer(h.note)).toBe(false);
    expect(h.service.captureSave(h.note).tagEdit).toEqual({ previous: [], tags: ['renovation'] });
  });

  it('preserves a later tag edit while adopting an in-flight save baseline', async () => {
    const h = createHarness();
    h.service.updateTags(h.note, ['first']);
    dispatchDocumentOperation(h.note, { type: 'start', operation: 'saving' });
    const capture = h.service.captureSave(h.note);
    h.service.updateTags(h.note, ['later']);
    await h.service.adoptSavedResult(capture, { noteId: 'tag-note', path: '/vault/Tag.md', title: '', markdown: '', tags: ['first'] });
    expect(h.note.working.tags).toEqual(['later']);
    expect(h.note.savedBaseline?.content.tags).toEqual(['first']);
    expect(documentHasCleanBuffer(h.note)).toBe(false);
    expect(h.service.captureSave(h.note).tagEdit).toEqual({ previous: ['first'], tags: ['later'] });
  });

  it('adopts externally changed tags while preserving newer body typing', async () => {
    const h = createHarness();
    await h.service.adoptCleanExternalRefresh(h.note, { noteId: 'tag-note', path: '/vault/Tag.md', title: '', markdown: 'before', tags: ['old'] });
    h.service.recordUserEdit('left', h.note, DocumentBody.fromMarkdown('captured body'));
    dispatchDocumentOperation(h.note, { type: 'start', operation: 'saving' });
    const capture = h.service.captureSave(h.note);
    h.service.recordUserEdit('left', h.note, DocumentBody.fromMarkdown('newer body'));
    await h.service.adoptSavedResult(capture, { noteId: 'tag-note', path: '/vault/Tag.md', title: '', markdown: 'captured body', tags: ['external'] });
    expect(h.note.working.body.toMarkdown()).toBe('newer body');
    expect(h.note.working.tags).toEqual(['external']);
    expect(h.service.captureSave(h.note).tagEdit).toBeUndefined();
  });

  it('keeps a tag removal made while the first tag save is in flight', async () => {
    const h = createHarness();
    h.service.updateTags(h.note, ['first']);
    dispatchDocumentOperation(h.note, { type: 'start', operation: 'saving' });
    const capture = h.service.captureSave(h.note);
    h.service.updateTags(h.note, []);
    await h.service.adoptSavedResult(capture, { noteId: 'tag-note', path: '/vault/Tag.md', title: '', markdown: '', tags: ['first'] });
    expect(h.note.working.tags).toEqual([]);
    expect(h.service.captureSave(h.note).tagEdit).toEqual({ previous: ['first'], tags: [] });
  });

  it('treats externally refreshed tags as content and clears stale parse errors', async () => {
    const h = createHarness();
    h.note.working.tagsError = 'Invalid YAML';
    await h.service.adoptCleanExternalRefresh(h.note, { noteId: 'tag-note', path: '/vault/Tag.md', title: '', markdown: '', tags: ['external'] });
    expect(h.note.working.tags).toEqual(['external']);
    expect(h.note.working.tagsError).toBeUndefined();
    expect(documentHasCleanBuffer(h.note)).toBe(true);
    expect(h.service.captureSave(h.note).tagEdit).toBeUndefined();
  });
});
